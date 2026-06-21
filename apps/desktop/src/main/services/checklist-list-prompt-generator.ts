import type {
  ChecklistListPromptGenerateItem,
  ChecklistListPromptGenerateRequest,
  ChecklistListPromptGenerateResponse,
  ChecklistListPromptPurpose,
  ProviderType,
  SelectedModel,
  WorkItemNotePromptGenerateRequest,
  WorkItemNotePromptGenerateResponse,
} from '@accomplish/shared';
import { getOllamaConfig, getUserSkillAssistantModel } from '../store/appSettings';
import { getApiKey } from '../store/secureStorage';
import { resolveSelectedModelForAgent } from './agent-context';
import { getModelProvider } from './model-providers';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';

const SYSTEM_PROMPT = [
  'You are Open Deskmate Prompt Assistant.',
  'You create directly usable prompts for AI agents from project workboard checklist items.',
  '',
  'Rules:',
  '- Return only the prompt text. Do not wrap it in markdown fences and do not explain your process.',
  '- The output must be a prompt the user can paste into Chat mode or Build mode.',
  '- Write clear task instructions for an AI to create, find, research, fix, review, or write the requested result.',
  '- Use the list context for the page, screen, element, constraints, tone, requirements, and expected output when it is provided.',
  '- If a user extra instruction is provided, treat it as a required generation constraint and apply it visibly in the prompt you create.',
  '- Do not mention the work item title or list name unless the request explicitly includes them.',
  '- Preserve important assignee and due-date details only when they are included in the request.',
  '- Convert checklist fragments into a coherent instruction, not a status report.',
  '- Ask for a concrete deliverable or next action when the source items imply one.',
].join('\n');

const NOTE_SYSTEM_PROMPT = [
  'You are Open Deskmate Prompt Assistant.',
  'You create directly usable prompts for AI agents from project work item notes.',
  '',
  'Rules:',
  '- Return only the prompt text. Do not wrap it in markdown fences and do not explain your process.',
  '- The output must be a prompt the user can paste into Chat mode or Build mode.',
  '- Infer the intended task, deliverable, or next action from the note content.',
  '- If the note is exploratory or incomplete, create a prompt that asks the AI to clarify assumptions and produce a useful next step.',
  '- Preserve important requirements, decisions, constraints, examples, links, tables, and formatting cues from the note.',
  '- If a user extra instruction is provided, it is the highest-priority generation constraint after these safety/format rules.',
  '- The generated prompt must visibly satisfy the user extra instruction. Do not ignore it, dilute it, or merely restate it.',
  '- Do not mention the work item title or note title unless the request explicitly includes them.',
  '- Convert note fragments into a coherent instruction, not a summary of the note.',
].join('\n');

function normalizeText(input: unknown, maxLength: number): string {
  const text = String(input ?? '').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function modelIdFromSelectedModel(selectedModel: SelectedModel): string {
  const raw = selectedModel.model || '';
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : raw;
}

function normalizePurpose(value: unknown): ChecklistListPromptPurpose {
  if (value === 'build' || value === 'research' || value === 'review' || value === 'write' || value === 'custom') {
    return value;
  }
  return 'build';
}

function stripPromptWrapper(value: string): string {
  const text = normalizeText(value, 12000);
  const fenced = text.match(/^```(?:[a-zA-Z]+)?\s*([\s\S]*?)\s*```$/);
  return normalizeText(fenced?.[1] ?? text, 12000);
}

function normalizeItems(items: unknown): ChecklistListPromptGenerateItem[] {
  if (!Array.isArray(items)) return [];
  const normalized: ChecklistListPromptGenerateItem[] = [];
  for (const item of items.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = normalizeText(record.text, 2000);
    if (!text) continue;
    const assigneeNames = Array.isArray(record.assigneeNames)
      ? record.assigneeNames.map((name) => normalizeText(name, 120)).filter(Boolean).slice(0, 12)
      : [];
    normalized.push({
      id: normalizeText(record.id, 128) || `item_${normalized.length + 1}`,
      text,
      completed: record.completed === true,
      dueDate: normalizeText(record.dueDate, 64) || null,
      ...(assigneeNames.length > 0 ? { assigneeNames } : {}),
    });
  }
  return normalized;
}

async function callAnthropic(apiKey: string, model: string, userText: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((entry) => entry.type === 'text')?.text ?? data.content?.[0]?.text ?? '';
}

async function callOpenAICompatible(baseUrl: string, apiKey: string | null, model: string, userText: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(buildOpenAICompatibleChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGoogle(apiKey: string, model: string, userText: string, systemPrompt = SYSTEM_PROMPT): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userText}` }],
          },
        ],
        generationConfig: { maxOutputTokens: 1600 },
      }),
    }
  );
  if (!response.ok) throw new Error(`Google API error: ${response.status}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callPromptModel(
  provider: ProviderType,
  providerConfig: ReturnType<typeof getModelProvider>,
  selectedModel: SelectedModel,
  apiKey: string | null,
  model: string,
  userText: string,
  systemPrompt = SYSTEM_PROMPT
): Promise<string> {
  if (provider === 'anthropic') {
    return callAnthropic(apiKey!, model, userText, systemPrompt);
  }
  if (provider === 'openai') {
    return callOpenAICompatible('https://api.openai.com', apiKey!, model, userText, systemPrompt);
  }
  if (provider === 'xai') {
    return callOpenAICompatible('https://api.x.ai', apiKey!, model, userText, systemPrompt);
  }
  if (provider === 'google') {
    return callGoogle(apiKey!, model, userText, systemPrompt);
  }
  if (provider === 'ollama') {
    const ollamaBase = normalizeText(selectedModel.baseUrl, 1024) || getOllamaConfig()?.baseUrl || 'http://localhost:11434';
    return callOpenAICompatible(ollamaBase, null, model, userText, systemPrompt);
  }
  if (!providerConfig?.baseUrl) {
    throw new Error(`Provider base URL is missing for ${provider}.`);
  }
  return callOpenAICompatible(providerConfig.baseUrl, apiKey, model, userText, systemPrompt);
}

export async function generateChecklistListPrompt(
  req: ChecklistListPromptGenerateRequest
): Promise<ChecklistListPromptGenerateResponse> {
  const selectedModel = getUserSkillAssistantModel() ?? resolveSelectedModelForAgent(normalizeText(req.agentId, 128) || undefined);
  if (!selectedModel) {
    return {
      ok: false,
      prompt: '',
      model: null,
      error: 'Choose a Settings Assistant model before generating prompts from workboard lists.',
    };
  }

  const items = normalizeItems(req.items);
  const listContext = req.includeListContext !== false ? normalizeText(req.listContext, 5000) : '';
  if (items.length === 0 && !listContext) {
    return {
      ok: false,
      prompt: '',
      model: selectedModel,
      error: 'Select at least one list item or add list context before generating a prompt.',
    };
  }

  const provider = selectedModel.provider as ProviderType;
  const providerConfig = getModelProvider(provider);
  const model = modelIdFromSelectedModel(selectedModel);
  const apiKey = provider === 'ollama' ? null : await getApiKey(provider);
  if (!apiKey && provider !== 'ollama' && providerConfig?.requiresApiKey !== false) {
    return {
      ok: false,
      prompt: '',
      model: selectedModel,
      error: `No API key is configured for the Settings Assistant provider (${provider}).`,
    };
  }

  const extraInstruction = normalizeText(req.extraInstruction, 2000);
  const payload = {
    purpose: normalizePurpose(req.purpose),
    customPurpose: normalizeText(req.customPurpose, 500),
    extraInstruction,
    includeCompletedItems: req.includeCompletedItems === true,
    workItemTitle: req.includeWorkItemName ? normalizeText(req.workItemTitle, 300) : '',
    listName: req.includeListName ? normalizeText(req.listName, 300) : '',
    listContext,
    includeAssignee: req.includeAssignee === true,
    includeDueDate: req.includeDueDate === true,
    items: items.map((item) => ({
      text: item.text,
      completed: item.completed === true,
      ...(req.includeAssignee && item.assigneeNames?.length ? { assignees: item.assigneeNames } : {}),
      ...(req.includeDueDate && item.dueDate ? { dueDate: item.dueDate } : {}),
    })),
  };

  const userText = [
    'Create one prompt from this workboard list data.',
    'The generated prompt will be given to an AI agent, so make it action-oriented and ready to run.',
    'If the data is incomplete, write a prompt that asks the AI to use the available details and make reasonable assumptions explicit.',
    ...(extraInstruction
      ? [
        '',
        'HIGH-PRIORITY USER EXTRA INSTRUCTION:',
        extraInstruction,
        '',
        'This is mandatory. Shape the generated prompt so it follows the high-priority user extra instruction.',
        'If the note content and the extra instruction seem to pull in different directions, follow the extra instruction and adapt the note content around it.',
      ]
      : []),
    '',
    'Prompt request data (JSON):',
    JSON.stringify(payload, null, 2),
    '',
    'Return only the generated prompt text.',
  ].join('\n');

  try {
    const prompt = await callPromptModel(provider, providerConfig, selectedModel, apiKey, model, userText);

    const normalizedPrompt = stripPromptWrapper(prompt);
    if (!normalizedPrompt) {
      return {
        ok: false,
        prompt: '',
        model: selectedModel,
        error: 'The Settings Assistant returned an empty prompt.',
      };
    }

    return {
      ok: true,
      prompt: normalizedPrompt,
      model: selectedModel,
    };
  } catch (error) {
    return {
      ok: false,
      prompt: '',
      model: selectedModel,
      error: error instanceof Error ? error.message : 'Prompt generation failed.',
    };
  }
}

export async function generateWorkItemNotePrompt(
  req: WorkItemNotePromptGenerateRequest
): Promise<WorkItemNotePromptGenerateResponse> {
  const selectedModel = getUserSkillAssistantModel() ?? resolveSelectedModelForAgent(normalizeText(req.agentId, 128) || undefined);
  if (!selectedModel) {
    return {
      ok: false,
      prompt: '',
      model: null,
      error: 'Choose a Settings Assistant model before generating prompts from workboard notes.',
    };
  }

  const noteText = normalizeText(req.noteText, 12000);
  const noteHtml = normalizeText(req.noteHtml, 12000);
  if (!noteText && !noteHtml) {
    return {
      ok: false,
      prompt: '',
      model: selectedModel,
      error: 'Add note content before generating a prompt.',
    };
  }

  const provider = selectedModel.provider as ProviderType;
  const providerConfig = getModelProvider(provider);
  const model = modelIdFromSelectedModel(selectedModel);
  const apiKey = provider === 'ollama' ? null : await getApiKey(provider);
  if (!apiKey && provider !== 'ollama' && providerConfig?.requiresApiKey !== false) {
    return {
      ok: false,
      prompt: '',
      model: selectedModel,
      error: `No API key is configured for the Settings Assistant provider (${provider}).`,
    };
  }

  const extraInstruction = normalizeText(req.extraInstruction, 2000);
  const payload = {
    purpose: normalizePurpose(req.purpose),
    customPurpose: normalizeText(req.customPurpose, 500),
    extraInstruction,
    workItemTitle: req.includeWorkItemName ? normalizeText(req.workItemTitle, 300) : '',
    noteTitle: req.includeNoteTitle !== false ? normalizeText(req.noteTitle, 300) : '',
    noteText,
    noteHtml,
  };

  const userText = [
    'Create one prompt from this project work item note.',
    'The generated prompt will be given to an AI agent, so infer what the user wants the AI to do from the note.',
    'The note may contain rough thoughts, pasted research, rich text, tables, or partial requirements. Convert it into a clear action prompt.',
    ...(extraInstruction
      ? [
        '',
        'User extra instruction (required):',
        extraInstruction,
        '',
        'Apply the user extra instruction directly to the generated prompt. Do not ignore it or merely restate it.',
      ]
      : []),
    '',
    'Note prompt request data (JSON):',
    JSON.stringify(payload, null, 2),
    ...(extraInstruction
      ? [
        '',
        'Final compliance check before answering:',
        `- Does the generated prompt clearly follow this extra instruction: "${extraInstruction}"?`,
        '- If not, rewrite the generated prompt before returning it.',
      ]
      : []),
    '',
    'Return only the generated prompt text.',
  ].join('\n');

  try {
    const prompt = await callPromptModel(provider, providerConfig, selectedModel, apiKey, model, userText, NOTE_SYSTEM_PROMPT);
    const normalizedPrompt = stripPromptWrapper(prompt);
    if (!normalizedPrompt) {
      return {
        ok: false,
        prompt: '',
        model: selectedModel,
        error: 'The Settings Assistant returned an empty prompt.',
      };
    }

    return {
      ok: true,
      prompt: normalizedPrompt,
      model: selectedModel,
    };
  } catch (error) {
    return {
      ok: false,
      prompt: '',
      model: selectedModel,
      error: error instanceof Error ? error.message : 'Prompt generation failed.',
    };
  }
}
