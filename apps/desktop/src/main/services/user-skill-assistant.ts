import fs from 'fs';
import type {
  ProviderType,
  SelectedModel,
  UserSkillAssistantAskRequest,
  UserSkillAssistantAskResponse,
  UserSkillDependencyStatusEntry,
  UserSkillEntry,
  UserSkillSource,
} from '@accomplish/shared';
import { getApiKey } from '../store/secureStorage';
import { getAppSettings, getOllamaConfig, getUserSkillAssistantModel } from '../store/appSettings';
import { getModelProvider, listModelProviders } from './model-providers';
import { resolveSelectedModelForAgent } from './agent-context';
import { buildUserSkillDependencyStatusReport, listUserSkills } from './user-skills';
import { getUserSkillConfig } from '../store/userSkillsConfig';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';

const SYSTEM_PROMPT = [
  'You are Open Deskmate Skill Assistant.',
  'Your job is to help users configure and edit skills using the LIVE app state provided to you.',
  '',
  'Rules:',
  '- Be precise and practical.',
  '- Prefer concrete steps and examples.',
  '- When configuration keys are required, name the exact keys and show valid JSON.',
  '- If something is missing from current state, say exactly what is missing.',
  '- Do not invent tools, settings, connectors, or file paths.',
  '- Keep responses concise and focused on completing the task.',
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

function findSkillByMention(skills: UserSkillDependencyStatusEntry[], question: string): UserSkillDependencyStatusEntry | undefined {
  const q = question.toLowerCase();
  if (!q) return undefined;
  const byId = skills.find((skill) => q.includes(skill.id.toLowerCase()));
  if (byId) return byId;
  return skills.find((skill) => q.includes(skill.name.toLowerCase()));
}

function resolveTargetSkillEntry(
  depsSkills: UserSkillDependencyStatusEntry[],
  allSkills: UserSkillEntry[],
  req: UserSkillAssistantAskRequest
): { dep?: UserSkillDependencyStatusEntry; entry?: UserSkillEntry; skillKey?: string } {
  const skillId = normalizeText(req.skillId, 128);
  const source = normalizeText(req.source, 24) as UserSkillSource | '';
  const skillKey = normalizeText(req.skillKey, 256);

  let dep = skillId
    ? depsSkills.find((s) => s.id === skillId && (!source || s.source === source))
    : undefined;
  if (!dep && skillKey) {
    dep = depsSkills.find((s) => s.skillKey === skillKey);
  }
  if (!dep) {
    dep = findSkillByMention(depsSkills, normalizeText(req.question, 4000));
  }

  let entry = dep
    ? allSkills.find((s) => s.id === dep.id && s.source === dep.source)
    : undefined;
  if (!entry && skillId) {
    entry = allSkills.find((s) => s.id === skillId && (!source || s.source === source));
  }
  if (!entry && dep) {
    entry = allSkills.find((s) => s.id === dep.id);
  }

  const resolvedSkillKey = dep?.skillKey || skillKey || '';
  return { dep, entry, skillKey: resolvedSkillKey || undefined };
}

function buildFallbackAnswer(params: {
  question: string;
  targetDep?: UserSkillDependencyStatusEntry;
  skillKey?: string;
  skillConfig: Record<string, unknown>;
}): string {
  const { targetDep, skillKey, skillConfig } = params;
  if (!targetDep) {
    return [
      'I could not identify the target skill from your request.',
      'Include the skill name or skill ID, then ask again.',
    ].join('\n');
  }

  const required = targetDep.requirements?.config ?? [];
  const missing = targetDep.missing?.config ?? [];
  const lines: string[] = [];
  lines.push(`Skill: ${targetDep.name} (${targetDep.id})`);
  if (skillKey) lines.push(`Skill key: ${skillKey}`);
  if (required.length === 0) {
    lines.push('This skill does not declare required config keys in metadata.opendeskmate.requires.config.');
  } else {
    lines.push(`Required config keys: ${required.join(', ')}`);
    if (missing.length > 0) lines.push(`Missing keys now: ${missing.join(', ')}`);
  }
  lines.push('Current config JSON for this skill:');
  lines.push(JSON.stringify(skillConfig || {}, null, 2));
  lines.push('Set missing keys in Configure, then Save.');
  return lines.join('\n');
}

function readSkillMarkdownSnippet(entry: UserSkillEntry | undefined): string {
  if (!entry?.filePath) return '';
  try {
    const raw = fs.readFileSync(entry.filePath, 'utf8');
    return raw.length <= 12000 ? raw : `${raw.slice(0, 12000)}\n...[truncated]`;
  } catch {
    return '';
  }
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
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((c) => c.type === 'text')?.text ?? data.content?.[0]?.text ?? '';
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  userText: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(buildOpenAICompatibleChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1200,
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
        generationConfig: { maxOutputTokens: 1200 },
      }),
    }
  );
  if (!response.ok) throw new Error(`Google API error: ${response.status}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function askUserSkillAssistant(req: UserSkillAssistantAskRequest): Promise<UserSkillAssistantAskResponse> {
  const question = normalizeText(req.question, 8000);
  if (!question) {
    return { ok: false, answer: 'Question is required.', error: 'Question is required.' };
  }

  const depsReport = await buildUserSkillDependencyStatusReport({ agentId: req.agentId });
  const skillsReport = listUserSkills({ agentId: req.agentId });
  const target = resolveTargetSkillEntry(depsReport.skills, skillsReport.skills, req);
  const targetSkillKey = target.skillKey;
  const skillConfig = targetSkillKey ? (getUserSkillConfig(targetSkillKey) as Record<string, unknown>) : {};
  const fallbackAnswer = buildFallbackAnswer({
    question,
    targetDep: target.dep,
    skillKey: targetSkillKey,
    skillConfig,
  });

  const selectedModel = getUserSkillAssistantModel() ?? resolveSelectedModelForAgent(req.agentId);
  if (!selectedModel) {
    return {
      ok: true,
      answer: fallbackAnswer,
      skillId: target.dep?.id ?? target.entry?.id,
      skillKey: targetSkillKey,
      model: null,
    };
  }

  const provider = selectedModel.provider as ProviderType;
  const model = modelIdFromSelectedModel(selectedModel);
  const apiKey = provider === 'ollama' ? null : await getApiKey(provider);
  if (!apiKey && provider !== 'ollama') {
    return {
      ok: true,
      answer: `${fallbackAnswer}\n\nNote: No API key configured for ${provider}.`,
      skillId: target.dep?.id ?? target.entry?.id,
      skillKey: targetSkillKey,
      model: selectedModel,
    };
  }

  const runtimeContext = {
    mode: req.mode || 'general',
    appSettings: {
      activeAgentId: getAppSettings().activeAgentId,
      selectedModel: resolveSelectedModelForAgent(req.agentId),
      assistantModelOverride: getUserSkillAssistantModel(),
      providerCatalog: listModelProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        modelCount: provider.models?.length || 0,
      })),
    },
    targetSkill: target.dep
      ? {
          id: target.dep.id,
          name: target.dep.name,
          source: target.dep.source,
          skillKey: target.dep.skillKey,
          requiredConfig: target.dep.requirements?.config ?? [],
          missingConfig: target.dep.missing?.config ?? [],
          missingEnv: target.dep.missing?.env ?? [],
          missingBins: target.dep.missing?.bins ?? [],
        }
      : null,
    currentSkillConfig: skillConfig,
    draftContent: normalizeText(req.draftContent, 16000),
    skillMarkdownSnippet: readSkillMarkdownSnippet(target.entry),
    availableSkills: depsReport.skills.slice(0, 60).map((skill) => ({
      id: skill.id,
      name: skill.name,
      source: skill.source,
      skillKey: skill.skillKey,
      missingConfig: skill.missing?.config ?? [],
    })),
  };

  const userText = [
    'User question:',
    question,
    '',
    'Live app context (JSON):',
    JSON.stringify(runtimeContext, null, 2),
    '',
    'Answer with the exact config/edit actions needed for this app state.',
  ].join('\n');

  try {
    let answer = '';
    if (provider === 'anthropic') {
      answer = await callAnthropic(apiKey!, model, userText);
    } else if (provider === 'openai') {
      answer = await callOpenAICompatible('https://api.openai.com', apiKey!, model, userText);
    } else if (provider === 'xai') {
      answer = await callOpenAICompatible('https://api.x.ai', apiKey!, model, userText);
    } else if (provider === 'google') {
      answer = await callGoogle(apiKey!, model, userText);
    } else if (provider === 'ollama') {
      const ollamaBase = normalizeText(selectedModel.baseUrl, 1024) || getOllamaConfig()?.baseUrl || 'http://localhost:11434';
      answer = await callOpenAICompatible(ollamaBase, null, model, userText);
    } else {
      const providerConfig = getModelProvider(provider);
      if (!providerConfig?.baseUrl) {
        return {
          ok: true,
          answer: `${fallbackAnswer}\n\nNote: Provider base URL is missing for ${provider}.`,
          skillId: target.dep?.id ?? target.entry?.id,
          skillKey: targetSkillKey,
          model: selectedModel,
        };
      }
      answer = await callOpenAICompatible(providerConfig.baseUrl, apiKey!, model, userText);
    }

    const normalizedAnswer = normalizeText(answer, 12000) || fallbackAnswer;
    return {
      ok: true,
      answer: normalizedAnswer,
      skillId: target.dep?.id ?? target.entry?.id,
      skillKey: targetSkillKey,
      model: selectedModel,
    };
  } catch (error) {
    return {
      ok: true,
      answer: `${fallbackAnswer}\n\nNote: AI assistant call failed (${error instanceof Error ? error.message : 'unknown error'}).`,
      skillId: target.dep?.id ?? target.entry?.id,
      skillKey: targetSkillKey,
      model: selectedModel,
    };
  }
}
