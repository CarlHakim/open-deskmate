import { randomUUID } from 'crypto';
import type { ProviderType, SelectedModel, UserSkillGenerateFromTaskRequest, UserSkillGenerateFromTaskResponse, UserSkillWorkflowDraft } from '@accomplish/shared';
import { getModelEntry } from './context/model-registry';
import { addTurnLog } from '../store/tokenUsage';
import { getTask } from '../store/taskHistory';
import { getApiKey } from '../store/secureStorage';
import { resolveSelectedModelForAgent } from './agent-context';
import { getModelProvider } from './model-providers';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';

const SYSTEM_PROMPT = [
  'You are Deskmate.',
  'The user wants to save the workflow that just happened in a chat as a reusable SKILL.md playbook (OpenDeskmate-style).',
  '',
  'You MUST output STRICT JSON only (no markdown, no code fences, no extra text).',
  '',
  'Return this exact JSON shape:',
  '{',
  '  "skillId": "kebab-case-id",',
  '  "name": "Human name",',
  '  "description": "One sentence",',
  '  "skillMd": "full SKILL.md contents as a string"',
  '}',
  '',
  'SKILL.md requirements:',
  '- Must start with frontmatter:',
  '  ---',
  '  name: ...',
  '  description: ...',
  '  metadata: |',
  '    { "opendeskmate": { ... } }',
  '  ---',
  '- The metadata.opendeskmate envelope must be present.',
  '- If you can infer requirements, set metadata.opendeskmate.requires with any of:',
  '  - bins: list of required CLI binaries',
  '  - anyBins: list of binaries where any ONE satisfies',
  '  - env: list of env var names the user must set (API keys, etc.)',
  '  - config: list of config paths the user must set via the app, preferably relative to the skill config object (e.g. apiKey, camera.nodes)',
  '- If you can infer installation actions, set metadata.opendeskmate.install as an array of install specs.',
  '- Keep the skill generic and reusable (avoid user-specific paths; use placeholders).',
  '- Write a clear "How to use" section with bullet steps and optional parameters.',
  '- Do not include secrets.',
  '- IMPORTANT: This app runs on Windows often. Do NOT require "bash" unless the user explicitly asked for bash. Prefer cmd.exe, PowerShell, or Node-based commands.',
].join('\n');

function modelIdFromSelectedModel(selectedModel: SelectedModel): string {
  const raw = selectedModel.model || '';
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : raw;
}

function extractJsonObject(text: string): unknown {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Empty response');
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in response');
  }
  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(candidate);
}

function safeString(value: unknown, maxLen: number): string {
  const s = String(value ?? '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\n...[truncated]';
}

function buildTranscript(req: UserSkillGenerateFromTaskRequest): { prompt: string; transcript: string } {
  const task = getTask(req.taskId, req.agentId);
  if (!task) throw new Error('Task not found');

  const lines: string[] = [];
  lines.push(`Task prompt: ${task.prompt}`);
  if (task.summary) lines.push(`Task summary: ${task.summary}`);
  lines.push('');
  lines.push('Transcript (chronological):');

  const maxPerMessage = 1800;
  const maxTotalChars = 30_000;
  let total = 0;

  for (const msg of task.messages ?? []) {
    let header: string = msg.type;
    if (msg.type === 'tool') {
      const tool = msg.toolName || 'tool';
      header = `tool:${tool}`;
    }

    // Avoid flooding the model with base64/data URLs.
    let content = msg.content ?? '';
    if (typeof content === 'string' && content.includes('data:image') && content.length > 600) {
      content = content.slice(0, 240) + '...[data-url-truncated]';
    }

    const block = `[${header}] ${safeString(content, maxPerMessage)}`.trim();
    if (!block) continue;

    if (total + block.length + 2 > maxTotalChars) {
      lines.push('');
      lines.push('[transcript truncated]');
      break;
    }

    lines.push(block);
    lines.push('');
    total += block.length + 2;
  }

  return { prompt: task.prompt, transcript: lines.join('\n').trim() };
}

async function callAnthropic(apiKey: string, model: string, userText: string): Promise<{ text: string; usage: { input: number; output: number } | null }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? data.content?.[0]?.text ?? '';
  const usage = data.usage ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 } : null;
  return { text, usage };
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  userText: string
): Promise<{ text: string; usage: { input: number; output: number } | null }> {
  const response = await fetch(buildOpenAICompatibleChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 } : null;
  return { text, usage };
}

async function callGoogle(apiKey: string, model: string, userText: string): Promise<{ text: string; usage: { input: number; output: number } | null }> {
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
        generationConfig: { maxOutputTokens: 2200, responseMimeType: 'application/json' },
      }),
    }
  );
  if (!response.ok) throw new Error(`Google API error: ${response.status}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const usage = data.usageMetadata
    ? { input: data.usageMetadata.promptTokenCount ?? 0, output: data.usageMetadata.candidatesTokenCount ?? 0 }
    : null;
  return { text, usage };
}

function normalizeDraft(value: unknown): UserSkillWorkflowDraft {
  const obj = value as Partial<UserSkillWorkflowDraft>;
  const skillId = String(obj.skillId ?? '').trim();
  const name = String(obj.name ?? '').trim();
  const skillMd = String((obj as { skillMd?: unknown }).skillMd ?? '').trim();
  if (!skillId || !name || !skillMd) {
    throw new Error('Invalid draft JSON: missing skillId/name/skillMd');
  }
  return {
    skillId: skillId.slice(0, 64),
    name: name.slice(0, 120),
    description: String(obj.description ?? '').trim().slice(0, 300) || undefined,
    skillMd,
  };
}

export function sanitizeGeneratedSkillMd(skillMd: string, platform = process.platform): string {
  // The app runs OpenCode with Windows shell rules (cmd.exe) in the system prompt.
  // Generated skills should not depend on bash on Windows unless the user explicitly adds it.
  if (platform !== 'win32') return skillMd;

  const lines = (skillMd || '').split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== '---') return skillMd;

  const endIdx = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
  if (endIdx === -1) return skillMd;

  const fmLines = lines.slice(0, endIdx + 1);
  const rest = lines.slice(endIdx + 1);

  const metaIdx = fmLines.findIndex((l) => /^metadata\s*:\s*\|/.test(l.trim()));
  if (metaIdx === -1) return skillMd;

  // Capture only the block scalar lines (the indented JSON), not any later YAML keys.
  // We infer the indentation from the first non-empty line after `metadata: |`.
  let contentStart = metaIdx + 1;
  while (contentStart < fmLines.length - 1 && (fmLines[contentStart] ?? '').trim() === '') contentStart += 1;
  if (contentStart >= fmLines.length - 1) return skillMd;

  const firstContentLine = fmLines[contentStart] ?? '';
  const indentMatch = firstContentLine.match(/^(\s+)/);
  const indentPrefix = indentMatch?.[1] ?? '    '; // default 4 spaces

  let contentEnd = contentStart;
  while (contentEnd < fmLines.length - 1) {
    const raw = fmLines[contentEnd] ?? '';
    if (raw.trim() === '') {
      contentEnd += 1;
      continue;
    }
    if (!raw.startsWith(indentPrefix)) break;
    contentEnd += 1;
  }

  const blockLines: string[] = [];
  for (let i = contentStart; i < contentEnd; i += 1) {
    const raw = fmLines[i] ?? '';
    blockLines.push(raw.startsWith(indentPrefix) ? raw.slice(indentPrefix.length) : raw);
  }

  const rawMeta = blockLines.join('\n').trim();
  if (!rawMeta.startsWith('{')) return skillMd;

  let meta: any;
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    return skillMd;
  }

  const requires = meta?.opendeskmate?.requires ?? meta?.clawdbot?.requires;
  if (requires && typeof requires === 'object') {
    const stripBash = (arr: unknown) => {
      if (!Array.isArray(arr)) return arr;
      return arr.filter((x) => String(x).trim().toLowerCase() !== 'bash');
    };
    requires.bins = stripBash(requires.bins);
    requires.anyBins = stripBash(requires.anyBins);
  }

  const nextMetaJson = JSON.stringify(meta, null, 2);
  const indented = nextMetaJson.split('\n').map((l) => `${indentPrefix}${l}`);

  const rebuiltFm = [
    ...fmLines.slice(0, contentStart),
    ...indented,
    ...fmLines.slice(contentEnd),
  ];

  return [...rebuiltFm, ...rest].join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function generateUserSkillFromTask(req: UserSkillGenerateFromTaskRequest): Promise<UserSkillGenerateFromTaskResponse> {
  const selectedModel = resolveSelectedModelForAgent(req.agentId);
  if (!selectedModel) {
    return { ok: false, error: 'No model selected' };
  }

  const provider = selectedModel.provider as ProviderType;
  const apiKey = await getApiKey(provider);
  if (!apiKey && provider !== 'ollama') {
    return { ok: false, error: `No API key configured for ${provider}` };
  }

  const { transcript } = buildTranscript(req);
  const userText = [
    'Create a reusable SKILL.md that captures the workflow from this chat.',
    'Focus on the repeatable procedure, assumptions, and parameters.',
    '',
    transcript,
  ].join('\n');

  const model = modelIdFromSelectedModel(selectedModel);

  let text = '';
  let usage: { input: number; output: number } | null = null;
  if (provider === 'anthropic') {
    const res = await callAnthropic(apiKey!, model, userText);
    text = res.text;
    usage = res.usage;
  } else if (provider === 'openai') {
    const res = await callOpenAICompatible('https://api.openai.com', apiKey!, model, userText);
    text = res.text;
    usage = res.usage;
  } else if (provider === 'xai') {
    const res = await callOpenAICompatible('https://api.x.ai', apiKey!, model, userText);
    text = res.text;
    usage = res.usage;
  } else if (provider === 'google') {
    const res = await callGoogle(apiKey!, model, userText);
    text = res.text;
    usage = res.usage;
  } else {
    const providerConfig = getModelProvider(provider);
    if (!providerConfig?.baseUrl) {
      return { ok: false, error: `Provider not supported: ${provider}` };
    }
    const res = await callOpenAICompatible(providerConfig.baseUrl.replace(/\/+$/, ''), apiKey!, model, userText);
    text = res.text;
    usage = res.usage;
  }

  // Log usage (global banner).
  const entry = getModelEntry(selectedModel);
  const contextLimitTokens = entry?.contextLimitTokens ?? 128000;
  const maxOutputTokens = entry?.defaultMaxOutputTokens ?? 4096;
  const headroomSafetyTokens = 512;
  const promptTokensEst = Math.max(1, Math.ceil((SYSTEM_PROMPT.length + userText.length) / 4));
  const nowIso = new Date().toISOString();

  addTurnLog({
    id: randomUUID(),
    taskId: req.taskId,
    createdAt: nowIso,
    provider,
    model: selectedModel.model,
    contextLimitTokens,
    maxOutputTokens,
    headroomSafetyTokens,
    promptTokensEst,
    estimated: usage == null,
    breakdown: {
      system: Math.ceil(SYSTEM_PROMPT.length / 4),
      tools: 0,
      retrieved: 0,
      history: Math.max(0, Math.ceil(transcript.length / 4)),
      newMessage: 0,
    },
    trimmed: false,
    droppedMessages: 0,
    summaryInserted: false,
    shouldResetSession: false,
    usage: usage
      ? { inputTokens: usage.input, outputTokens: usage.output, totalTokens: usage.input + usage.output, estimated: false }
      : { inputTokens: promptTokensEst, outputTokens: 0, totalTokens: promptTokensEst, estimated: true },
  });

  try {
    const parsed = extractJsonObject(text);
    const draft = normalizeDraft(parsed);
    draft.skillMd = sanitizeGeneratedSkillMd(draft.skillMd);
    return { ok: true, draft };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to parse AI response' };
  }
}
