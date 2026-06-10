import type {
  AutomationDraftRequest,
  AutomationDraftResult,
  ProviderType,
  ScheduleConfig,
  SelectedModel,
} from '@accomplish/shared';
import { getApiKey } from '../store/secureStorage';
import { getOllamaConfig } from '../store/appSettings';
import { resolveSelectedModelForAgent } from './agent-context';
import { getModelProvider } from './model-providers';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';

const LOCAL_CONFIDENCE_THRESHOLD = 0.75;
const AI_TIMEOUT_MS = 10_000;
const MAX_AI_OUTPUT_TOKENS = 900;

const AI_SYSTEM_PROMPT = [
  'You convert natural-language automation requests into one strict JSON object.',
  'Return JSON only. Do not wrap it in markdown.',
  'Schema:',
  '{"name":"short schedule name","prompt":"task prompt to run","cron":"5-part cron","timezone":"optional IANA timezone or empty string","warnings":["optional warning"]}',
  '',
  'Rules:',
  '- cron must be standard 5-part cron: minute hour day-of-month month day-of-week.',
  '- Use numbers, *, ranges, comma lists, and */step only.',
  '- Prefer the user timezone when provided.',
  '- Put what should be done in prompt; do not include schedule words unless needed for task meaning.',
  '- If timing is ambiguous, choose the safest reasonable cron and add a warning.',
].join('\n');

function normalizeText(input: unknown, maxLength: number): string {
  const text = String(input ?? '').trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function modelIdFromSelectedModel(selectedModel: SelectedModel): string {
  const raw = selectedModel.model || '';
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : raw;
}

function nextPromptFromText(text: string): string {
  const cleaned = text
    .replace(/\b(every|daily|weekly|weekday|weekdays|weekend|weekends|at|on|schedule|remind|run|check)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || text.trim() || 'Run scheduled task';
}

function parseHourMinute(text: string): { hour: number; minute: number; found: boolean } {
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!timeMatch) return { hour: 9, minute: 0, found: false };
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridian = (timeMatch[3] || '').toLowerCase();
  if (meridian === 'pm' && hour < 12) hour += 12;
  if (meridian === 'am' && hour === 12) hour = 0;
  return {
    hour: Math.max(0, Math.min(23, hour)),
    minute: Math.max(0, Math.min(59, minute)),
    found: true,
  };
}

function createLocalDraft(request: AutomationDraftRequest): AutomationDraftResult {
  const text = normalizeText(request.text, 2000);
  const lower = text.toLowerCase();
  const warnings: string[] = [];
  const { hour, minute, found: foundTime } = parseHourMinute(lower);
  let cron = `${minute} ${hour} * * *`;
  let confidence = 0.55;

  const intervalMatch = lower.match(/\bevery\s+(\d+)\s+(minute|minutes|hour|hours|day|days)\b/);
  if (intervalMatch) {
    const count = Math.max(1, Number(intervalMatch[1]));
    const unit = intervalMatch[2];
    if (unit.startsWith('minute')) {
      cron = `*/${Math.min(count, 59)} * * * *`;
    } else if (unit.startsWith('hour')) {
      cron = `${minute} */${Math.min(count, 23)} * * *`;
    } else {
      cron = `${minute} ${hour} */${Math.min(count, 31)} * *`;
    }
    confidence = 0.78;
  } else if (/\bweekly\b|\bevery week\b/.test(lower)) {
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const day = Object.entries(dayMap).find(([name]) => lower.includes(name))?.[1] ?? 1;
    cron = `${minute} ${hour} * * ${day}`;
    confidence = 0.82;
  } else if (/\bweekday|weekdays|workday|workdays\b/.test(lower)) {
    cron = `${minute} ${hour} * * 1-5`;
    confidence = 0.8;
  } else if (/\bdaily\b|\bevery day\b|\btomorrow\b/.test(lower)) {
    cron = `${minute} ${hour} * * *`;
    confidence = 0.8;
  } else {
    warnings.push('No clear schedule cadence found. Defaulted to daily.');
  }

  if (!foundTime) {
    warnings.push('No clear time found. Defaulted to 09:00.');
  }

  const prompt = nextPromptFromText(text);
  const schedule: ScheduleConfig = {
    name: prompt.slice(0, 80) || 'Scheduled task',
    prompt,
    cron,
    agentId: request.agentId,
    timezone: request.timezone,
    enabled: true,
  };

  return {
    schedule,
    confidence,
    warnings,
    source: 'local',
  };
}

function parseCronField(field: string, min: number, max: number): boolean {
  const partPattern = /^(?:\*|\*\/\d+|\d+|\d+-\d+|\d+-\d+\/\d+)$/;
  return field.split(',').every((part) => {
    if (!partPattern.test(part)) return false;
    if (part === '*') return true;
    const step = part.includes('/') ? Number(part.split('/')[1]) : null;
    if (step !== null && (!Number.isInteger(step) || step < 1)) return false;
    const rangePart = part.split('/')[0];
    if (rangePart === '*') return true;
    if (rangePart.includes('-')) {
      const [start, end] = rangePart.split('-').map(Number);
      return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end;
    }
    const value = Number(rangePart);
    return Number.isInteger(value) && value >= min && value <= max;
  });
}

function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parseCronField(parts[0], 0, 59)
    && parseCronField(parts[1], 0, 23)
    && parseCronField(parts[2], 1, 31)
    && parseCronField(parts[3], 1, 12)
    && parseCronField(parts[4], 0, 7);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validateAiDraft(
  parsed: Record<string, unknown>,
  request: AutomationDraftRequest,
  local: AutomationDraftResult
): AutomationDraftResult | null {
  const cron = normalizeText(parsed.cron, 120);
  if (!isValidCron(cron)) return null;
  const prompt = normalizeText(parsed.prompt, 4000) || local.schedule.prompt;
  if (!prompt) return null;
  const name = normalizeText(parsed.name, 120) || prompt.slice(0, 80) || 'Scheduled task';
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((entry) => normalizeText(entry, 240)).filter(Boolean).slice(0, 5)
    : [];
  const timezone = normalizeText(parsed.timezone, 120) || request.timezone || undefined;

  return {
    schedule: {
      name,
      prompt,
      cron,
      agentId: request.agentId,
      timezone,
      enabled: true,
    },
    confidence: 0.9,
    warnings,
    source: 'ai',
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(apiKey: string, model: string, userText: string): Promise<string> {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_AI_OUTPUT_TOKENS,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((item) => item.type === 'text')?.text ?? data.content?.[0]?.text ?? '';
}

async function callOpenAICompatible(baseUrl: string, apiKey: string | null, model: string, userText: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchWithTimeout(buildOpenAICompatibleChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: MAX_AI_OUTPUT_TOKENS,
      temperature: 0,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Provider API error: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGoogle(apiKey: string, model: string, userText: string): Promise<string> {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${AI_SYSTEM_PROMPT}\n\n${userText}` }] }],
        generationConfig: { maxOutputTokens: MAX_AI_OUTPUT_TOKENS, temperature: 0 },
      }),
    }
  );
  if (!response.ok) throw new Error(`Google API error: ${response.status}`);
  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callSelectedModel(request: AutomationDraftRequest, local: AutomationDraftResult): Promise<AutomationDraftResult | null> {
  const selectedModel = resolveSelectedModelForAgent(request.agentId);
  if (!selectedModel) return null;

  const provider = selectedModel.provider as ProviderType;
  const model = modelIdFromSelectedModel(selectedModel);
  const apiKey = provider === 'ollama' ? null : await getApiKey(provider);
  if (!apiKey && provider !== 'ollama') return null;

  const userText = [
    'Natural-language automation request:',
    normalizeText(request.text, 2000),
    '',
    `User timezone: ${request.timezone || 'system default'}`,
    '',
    'Local parser draft JSON:',
    JSON.stringify(local.schedule, null, 2),
    '',
    'Return the best corrected JSON object for the schema.',
  ].join('\n');

  let raw = '';
  if (provider === 'anthropic') {
    raw = await callAnthropic(apiKey!, model, userText);
  } else if (provider === 'openai') {
    raw = await callOpenAICompatible('https://api.openai.com', apiKey!, model, userText);
  } else if (provider === 'xai') {
    raw = await callOpenAICompatible('https://api.x.ai', apiKey!, model, userText);
  } else if (provider === 'google') {
    raw = await callGoogle(apiKey!, model, userText);
  } else if (provider === 'ollama') {
    const ollamaBase = normalizeText(selectedModel.baseUrl, 1024) || getOllamaConfig()?.baseUrl || 'http://localhost:11434';
    raw = await callOpenAICompatible(ollamaBase, null, model, userText);
  } else {
    const providerConfig = getModelProvider(provider);
    if (!providerConfig?.baseUrl) return null;
    raw = await callOpenAICompatible(providerConfig.baseUrl.replace(/\/+$/, ''), apiKey!, model, userText);
  }

  const parsed = extractJsonObject(raw);
  return parsed ? validateAiDraft(parsed, request, local) : null;
}

export async function draftAutomationFromText(request: AutomationDraftRequest): Promise<AutomationDraftResult> {
  const local = createLocalDraft(request);
  if (local.confidence >= LOCAL_CONFIDENCE_THRESHOLD) {
    return local;
  }

  try {
    const aiDraft = await callSelectedModel(request, local);
    if (aiDraft) {
      return {
        ...aiDraft,
        warnings: [
          ...aiDraft.warnings,
          ...local.warnings.map((warning) => `Local parser warning: ${warning}`),
        ],
      };
    }
  } catch (error) {
    return {
      ...local,
      source: 'fallback',
      warnings: [
        ...local.warnings,
        `AI schedule refinement failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      ],
    };
  }

  return {
    ...local,
    source: 'fallback',
    warnings: [
      ...local.warnings,
      'AI schedule refinement was unavailable, so this preview uses the local parser fallback.',
    ],
  };
}

export const automationDraftInternalsForTest = {
  createLocalDraft,
  isValidCron,
  validateAiDraft,
};
