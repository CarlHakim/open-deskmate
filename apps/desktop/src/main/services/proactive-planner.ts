import { getApiKey } from '../store/secureStorage';
import type { ProviderType, SelectedModel } from '@accomplish/shared';
import { buildMemoryPrompt } from './memory';
import { getTasks } from '../store/taskHistory';
import { resolveSelectedModelForAgent } from './agent-context';
import { getModelProvider } from './model-providers';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';

export type ProactiveSuggestion = {
  id: string;
  title: string;
  why: string;
  prompt: string;
  confirmation: string;
};

export type ProactivePlan = {
  suggestions: ProactiveSuggestion[];
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'being', 'build', 'built', 'could', 'date', 'does', 'from', 'have',
  'into', 'just', 'know', 'make', 'more', 'need', 'next', 'only', 'over', 'some', 'task', 'that', 'them', 'then',
  'there', 'they', 'this', 'today', 'want', 'what', 'when', 'with', 'would', 'your',
]);

function truncateText(value: string, max = 120): string {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function topKeywords(text: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  const words = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function compactTaskHistory(agentId?: string): string {
  const tasks = getTasks(agentId).slice(0, 30);
  if (tasks.length === 0) return '[No task history found]';
  return tasks
    .map((t, idx) => {
      const summary = truncateText((t.summary && t.summary.trim()) || t.prompt || '', 140);
      return `${idx + 1}. [${t.status}] ${summary}`;
    })
    .join('\n');
}

function fallbackSuggestionsFromRecentWork(agentId?: string): ProactiveSuggestion[] {
  try {
    const tasks = getTasks(agentId)
      .filter((t) => typeof t.prompt === 'string' && t.prompt.trim().length > 0)
      .slice(0, 30);
    if (tasks.length === 0) return [];

    const pending = tasks.filter((t) => t.status === 'running' || t.status === 'interrupted' || t.status === 'failed');
    const historyText = tasks
      .map((t) => `${t.prompt || ''}\n${t.summary || ''}`)
      .join('\n');
    const keywords = topKeywords(historyText, 4);
    const out: ProactiveSuggestion[] = [];

    out.push({
      id: '1',
      title: 'Build a prioritized next-step plan',
      why: 'Uses your recent activity to pick highest-impact work for today.',
      prompt: `Review the recent task history below and produce a prioritized plan with the top 3 next tasks, each with expected outcome and first action.\n\n${compactTaskHistory(agentId)}`,
      confirmation: 'Generate a prioritized plan from recent activity?',
    });

    if (pending.length > 0) {
      const sample = pending
        .slice(0, 6)
        .map((t) => `- [${t.status}] ${truncateText((t.summary && t.summary.trim()) || t.prompt || '', 120)}`)
        .join('\n');
      out.push({
        id: '2',
        title: 'Resolve interrupted or failed work',
        why: 'You have unfinished tasks that can likely be completed quickly.',
        prompt: `Analyze these interrupted/failed tasks and create one consolidated recovery task with concrete steps:\n${sample}`,
        confirmation: 'Create a recovery task for unfinished work?',
      });
    }

    if (keywords.length > 0) {
      const topic = keywords.slice(0, 2).join(' + ');
      out.push({
        id: String(out.length + 1),
        title: `Research refresh for: ${topic}`,
        why: 'This topic appears repeatedly in your recent work.',
        prompt: `Use recent history to identify open questions related to "${topic}", then run a focused update task and summarize what changed since the last run.`,
        confirmation: `Run a focused update on "${topic}"?`,
      });
    }

    if (out.length < 3) {
      out.push({
        id: String(out.length + 1),
        title: 'Create reusable automation from repeated work',
        why: 'Turn recurring manual steps into a reusable workflow/skill.',
        prompt: 'Inspect recent repeated tasks and propose one reusable workflow (with inputs/outputs and run steps) that saves time going forward.',
        confirmation: 'Generate a reusable automation idea from recent work?',
      });
    }

    return out.slice(0, 3);
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = [
  'You are Deskmate.',
  'The user can click a button to ask you for proactive job ideas based on their saved memory.',
  'Your job: propose up to 3 concrete, high-value jobs the user might want to run next.',
  '',
  'Rules:',
  '- Do NOT perform any actions and do NOT call tools.',
  '- Base suggestions only on the provided memory text.',
  '- Each suggestion must be runnable as a single task prompt.',
  '- Keep it safe: avoid destructive steps; ask for confirmation text that the UI can show before running.',
  '- Output STRICT JSON only (no markdown, no extra text).',
].join('\n');

const USER_PROMPT_PREFIX = [
  'Using only the memory below, propose up to 3 next jobs.',
  'If memory is empty or there is nothing actionable, return {"suggestions": []}.',
  '',
  'Return JSON with this shape:',
  '{',
  '  "suggestions": [',
  '    { "id": "1", "title": "...", "why": "...", "prompt": "...", "confirmation": "..." }',
  '  ]',
  '}',
  '',
  'Memory:',
].join('\n');

function modelIdFromSelectedModel(selectedModel: SelectedModel): string {
  const raw = selectedModel.model || '';
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : raw;
}

function extractJsonValue(text: string): unknown {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Empty response');

  // Direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // If wrapped in markdown code fences, try to parse fence body.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  // Extract largest object candidate.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  // Extract largest array candidate.
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error('No JSON object found in response');
}

function normalizePlan(value: unknown): ProactivePlan {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray((value as { suggestions?: unknown })?.suggestions)
      ? ((value as { suggestions?: unknown }).suggestions as unknown[])
      : [];
  const suggestions: ProactiveSuggestion[] = [];
  for (const entry of raw) {
    const e = entry as Partial<ProactiveSuggestion>;
    if (!e || typeof e !== 'object') continue;
    if (!e.title || !e.prompt) continue;
    suggestions.push({
      id: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : String(suggestions.length + 1),
      title: String(e.title).trim().slice(0, 120),
      why: String(e.why || '').trim().slice(0, 500),
      prompt: String(e.prompt).trim().slice(0, 4000),
      confirmation: String(e.confirmation || 'Run this task now?').trim().slice(0, 300),
    });
  }
  return { suggestions: suggestions.slice(0, 3) };
}

async function callAnthropic(apiKey: string, model: string, userText: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? data.content?.[0]?.text ?? '';
  return text;
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  userText: string
): Promise<string> {
  const response = await fetch(buildOpenAICompatibleChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGoogle(apiKey: string, model: string, userText: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${SYSTEM_PROMPT}\n\n${userText}` }],
          },
        ],
        generationConfig: { maxOutputTokens: 900 },
      }),
    }
  );
  if (!response.ok) throw new Error(`Google API error: ${response.status}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function planNextJobs(agentId?: string): Promise<ProactivePlan> {
  const selectedModel = resolveSelectedModelForAgent(agentId);
  if (!selectedModel) {
    throw new Error('No model selected');
  }
  const provider = selectedModel.provider as ProviderType;
  const apiKey = await getApiKey(provider);
  if (!apiKey && provider !== 'ollama') {
    throw new Error(`No API key configured for ${provider}`);
  }

  const memory = buildMemoryPrompt(agentId);
  const history = compactTaskHistory(agentId);
  const userText = `${USER_PROMPT_PREFIX}\n\n${memory || '[No memory found]'}\n\nRecent task history:\n${history}\n\nIf there is any activity at all, return at least 1 suggestion.`;
  const model = modelIdFromSelectedModel(selectedModel);

  let text = '';
  if (provider === 'anthropic') {
    text = await callAnthropic(apiKey!, model, userText);
  } else if (provider === 'openai') {
    text = await callOpenAICompatible('https://api.openai.com', apiKey!, model, userText);
  } else if (provider === 'xai') {
    text = await callOpenAICompatible('https://api.x.ai', apiKey!, model, userText);
  } else if (provider === 'google') {
    text = await callGoogle(apiKey!, model, userText);
  } else {
    const providerConfig = getModelProvider(provider);
    if (!providerConfig?.baseUrl) {
      throw new Error(`Proactive planning not supported for provider: ${provider}`);
    }
    text = await callOpenAICompatible(providerConfig.baseUrl.replace(/\/+$/, ''), apiKey!, model, userText);
  }

  try {
    const parsed = extractJsonValue(text);
    const plan = normalizePlan(parsed);
    if (plan.suggestions.length > 0) return plan;
    const fallback = fallbackSuggestionsFromRecentWork(agentId);
    return { suggestions: fallback };
  } catch (error) {
    console.warn('[ProactivePlanner] Failed to parse suggestions JSON, returning empty plan:', error);
    const fallback = fallbackSuggestionsFromRecentWork(agentId);
    return { suggestions: fallback };
  }
}
