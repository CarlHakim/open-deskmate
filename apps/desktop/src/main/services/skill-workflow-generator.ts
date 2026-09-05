import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ProviderType,
  SelectedModel,
  UserSkillAutomationDraftRecord,
  UserSkillAutomationMode,
  UserSkillGenerateFromTaskRequest,
  UserSkillGenerateFromTaskResponse,
  UserSkillPostTaskAutomationRequest,
  UserSkillPostTaskAutomationResult,
  UserSkillSource,
  UserSkillTaskReusabilityEvaluation,
  UserSkillWorkflowDraft,
} from '@accomplish/shared';
import { getModelEntry } from './context/model-registry';
import { addTurnLog } from '../store/tokenUsage';
import { getTask, type StoredTask } from '../store/taskHistory';
import { getApiKey } from '../store/secureStorage';
import { getAgentContext, resolveSelectedModelForAgent } from './agent-context';
import { getModelProvider } from './model-providers';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';
import {
  getManagedSkillsDir,
  listUserSkills,
  resolveUserSkillAutomationMode,
  writeUserSkillFile,
} from './user-skills';

const SYSTEM_PROMPT = [
  'You are Deskmate.',
  'The user wants to save the workflow that just happened in a chat as a reusable SKILL.md playbook (OpenDeskmate-style).',
  'Your job is to transform the chat transcript into a reusable procedure, not to preserve or summarize the chat log.',
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
  '  name: kebab-case-skill-id',
  '  description: "short trigger phrase under 160 characters"',
  '  metadata: |',
  '    { "opendeskmate": { ... } }',
  '  ---',
  '- The metadata.opendeskmate envelope must be present.',
  '- Set metadata.opendeskmate.generatedBy to "task-save-skill-draft" and metadata.opendeskmate.requiresReview to true.',
  '- If you can infer requirements, set metadata.opendeskmate.requires with any of:',
  '  - bins: list of required CLI binaries',
  '  - anyBins: list of binaries where any ONE satisfies',
  '  - env: list of env var names the user must set (API keys, etc.)',
  '  - config: list of config paths the user must set via the app, preferably relative to the skill config object (e.g. apiKey, camera.nodes)',
  '- If you can infer installation actions, set metadata.opendeskmate.install as an array of install specs.',
  '- Follow OpenClaw-style skill shape: compact trigger metadata, lean markdown body, no chat log, no long generic AI advice.',
  '- Keep the frontmatter name equal to the skillId slug. Put the human-readable title as the first markdown heading.',
  '- Keep the skill generic and reusable (avoid user-specific paths; use placeholders).',
  '- Preserve the reusable method: useful tool categories, source choices, decision rules, fallback paths, checks, and output formatting.',
  '- Include a concise "Tool call overview" section that explains which tool categories were useful and why; do not include raw tool payloads.',
  '- Generalize the original target into inputs/placeholders like <place>, <client>, <repository>, <document>, or <goal>.',
  '- Remove raw transcript text, full tool logs, status messages, retries, failed branches, repeated actions, and chat-specific narration.',
  '- Collapse repeated exploration into durable steps a future agent should follow.',
  '- Include decision rules, inputs, outputs, verification checks, and fallback paths that are reusable.',
  '- Prefer these body sections when relevant: When to use, Inputs, Tool call overview, Workflow, Output format, Verification, Fallbacks.',
  '- Do not include secrets.',
  '- IMPORTANT: This app runs on Windows often. Do NOT require "bash" unless the user explicitly asked for bash. Prefer cmd.exe, PowerShell, or Node-based commands.',
].join('\n');

const AUTOMATION_STORE_DIR = '.automation';
const AUTOMATION_DRAFTS_FILE = 'skill-drafts.json';
const MAX_STAGED_DRAFTS = 100;
const AUTOMATIC_SAVE_CONFIDENCE = 0.72;
const STAGE_CONFIDENCE = 0.52;

type GeneratedDraftAutomationReadiness = {
  automatic: boolean;
  confidence: number;
  reasons: string[];
  blockers: string[];
};

function modelIdFromSelectedModel(selectedModel: SelectedModel): string {
  const raw = selectedModel.model || '';
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : raw;
}

type JsonObjectParseResult = {
  value: unknown;
  start: number;
  end: number;
};

function findFirstJsonObject(text: string): JsonObjectParseResult | null {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            return { value: JSON.parse(candidate), start, end: index + 1 };
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function extractSkillMdFallback(text: string): string {
  const fenced = text.match(/```(?:markdown|md)?\s*(---[\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();

  const frontmatterStart = text.indexOf('---');
  if (frontmatterStart === -1) return '';
  return text.slice(frontmatterStart).replace(/```$/g, '').trim();
}

function unwrapDraftObject(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  for (const key of ['draft', 'skill', 'workflow', 'result']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested;
    }
  }
  return value;
}

function extractJsonObject(text: string): unknown {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Empty response');

  const sources: string[] = [];
  const fencedJsonMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedJsonMatches) {
    if (match[1]?.trim()) sources.push(match[1].trim());
  }
  sources.push(trimmed);

  for (const source of sources) {
    const parsed = findFirstJsonObject(source);
    if (!parsed) continue;
    const value = unwrapDraftObject(parsed.value);

    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && !String((value as { skillMd?: unknown; skill_md?: unknown; skillMarkdown?: unknown }).skillMd
        ?? (value as { skill_md?: unknown }).skill_md
        ?? (value as { skillMarkdown?: unknown }).skillMarkdown
        ?? '').trim()
    ) {
      const skillMd = extractSkillMdFallback(source.slice(parsed.end)) || extractSkillMdFallback(trimmed);
      if (skillMd) {
        return { ...(value as Record<string, unknown>), skillMd };
      }
    }

    return value;
  }

  throw new Error('No JSON object found in response');
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

function normalizeSkillId(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  const collapsed = raw
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefixed = /^[a-z0-9]/.test(collapsed) ? collapsed : `skill-${collapsed}`;
  return prefixed.replace(/[^a-z0-9-_]/g, '').slice(0, 64) || 'skill';
}

function titleFromText(value: string, fallback = 'Reusable Workflow'): string {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!cleaned) return fallback;
  return cleaned
    .split(' ')
    .slice(0, 8)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ')
    || fallback;
}

function yamlQuoted(value: string): string {
  return JSON.stringify(String(value || ''));
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SKILL_NAME_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'by',
  'can',
  'could',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'please',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'use',
  'using',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'you',
  'your',
]);

const SKILL_ACTION_WORDS = new Set([
  'add',
  'answer',
  'build',
  'change',
  'check',
  'compare',
  'create',
  'describe',
  'edit',
  'explain',
  'find',
  'fix',
  'generate',
  'get',
  'give',
  'implement',
  'image',
  'images',
  'look',
  'make',
  'overview',
  'photo',
  'photos',
  'picture',
  'pictures',
  'recommend',
  'report',
  'research',
  'save',
  'search',
  'show',
  'summarize',
  'tell',
  'update',
  'workflow',
]);

const SKILL_TARGET_GENERIC_WORDS = new Set([
  'app',
  'apps',
  'article',
  'client',
  'clients',
  'component',
  'components',
  'data',
  'document',
  'documents',
  'file',
  'files',
  'folder',
  'folders',
  'image',
  'images',
  'issue',
  'issues',
  'page',
  'pages',
  'photo',
  'photos',
  'place',
  'places',
  'project',
  'projects',
  'repo',
  'repository',
  'result',
  'results',
  'site',
  'source',
  'sources',
  'link',
  'links',
  'task',
  'tasks',
  'town',
  'workflow',
  'workflows',
]);

function splitNameLikeText(value: string): string {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[._/\\:]+/g, ' ');
}

function skillNameTokens(value: string, includeActionWords = true): string[] {
  return splitNameLikeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !SKILL_NAME_STOP_WORDS.has(token))
    .filter((token) => includeActionWords || !SKILL_ACTION_WORDS.has(token));
}

function targetSpecificTokens(value: string): string[] {
  return skillNameTokens(value, false)
    .filter((token) => !SKILL_TARGET_GENERIC_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function normalizedNameForComparison(value: string): string {
  return skillNameTokens(value, true).join(' ');
}

function firstMarkdownHeading(skillMd: string): string {
  const match = normalizeSkillMarkdownText(skillMd).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim().replace(/\s+#*$/, '') || '';
}

function promptTargetTokenSet(prompt: string): Set<string> {
  const text = String(prompt || '');
  const targets = new Set<string>();
  const addTokens = (value: string) => {
    for (const token of targetSpecificTokens(value)) {
      targets.add(token);
    }
  };

  for (const match of text.matchAll(/[`"']([^`"']{3,120})[`"']/g)) {
    addTokens(match[1] || '');
  }

  for (const match of text.matchAll(/\b[A-Za-z]:[\\/][^\s"'`]+|(?:[./\\]?[\w.-]+[\\/])+[\w.-]+/g)) {
    addTokens(match[0] || '');
  }

  for (const match of text.matchAll(/\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|mdx|ya?ml|toml|css|scss|html|py|go|rs|java|kt|swift|cs|cpp|c|h|sql|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|webp|svg|gif)\b/gi)) {
    addTokens(match[0] || '');
  }

  for (const match of text.matchAll(/\b(?:of|about|for|called|named|from|in|at|with|using|inside|within|against|into|under)\s+([^,.!?;\n]{3,120})/gi)) {
    const phrase = String(match[1] || '')
      .replace(/\b(?:please|and|then|that|where|which|while|without|before|after)\b[\s\S]*$/i, '')
      .trim();
    addTokens(phrase);
  }

  const words = text.match(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)?\b/g) || [];
  for (const word of words.slice(0, 40)) {
    addTokens(word);
  }

  return targets;
}

function looksTaskSpecificName(name: string, prompt: string): boolean {
  const normalizedName = normalizedNameForComparison(name);
  if (!normalizedName) return false;
  if (normalizedName === normalizedNameForComparison(titleFromText(prompt))) return true;

  const nameTokens = skillNameTokens(name, true);
  if (nameTokens.length === 0) return false;

  const targetTokens = promptTargetTokenSet(prompt);
  const nameSpecificTokens = targetSpecificTokens(name);
  const targetOverlap = nameSpecificTokens.filter((token) => targetTokens.has(token)).length;
  if (targetOverlap >= 1) return true;

  const promptTokens = new Set(skillNameTokens(prompt, true));
  const promptSpecificTokens = new Set(skillNameTokens(prompt, false));
  const overlap = nameTokens.filter((token) => promptTokens.has(token)).length;
  const specificOverlap = nameTokens.filter((token) => promptSpecificTokens.has(token)).length;

  if (specificOverlap >= 2) return true;
  return nameTokens.length >= 4 && overlap / nameTokens.length >= 0.75;
}

function genericPromptName(prompt: string): string {
  const cleaned = String(prompt || '')
    .replace(/\s+/g, ' ')
    .replace(/^(please\s+)?(can|could|would)\s+you\s+/i, '')
    .replace(/^(please\s+)?(i\s+want\s+you\s+to|i\s+need\s+you\s+to|i\s+want\s+to)\s+/i, '')
    .replace(/\b(me|for me)\b/gi, '')
    .replace(/\b(of|about|for|called|named|from|in|at|with|using)\b[\s\S]*$/i, '')
    .trim();
  const title = titleFromText(cleaned, '');
  if (!title || looksTaskSpecificName(title, prompt)) return '';
  return /\b(workflow|skill|process)\b/i.test(title) ? title : `${title} Workflow`;
}

function isPathLikeTarget(value: string): boolean {
  return /\b[A-Za-z]:[\\/]/.test(value)
    || /(?:[./\\]?[\w.-]+[\\/])+[\w.-]+/.test(value)
    || /\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|mdx|ya?ml|toml|css|scss|html|py|go|rs|java|kt|swift|cs|cpp|c|h|sql|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|webp|svg|gif)\b/i.test(value);
}

function placeholderForPromptTarget(prompt: string, phrase: string): string {
  if (isPathLikeTarget(phrase)) return '<file>';
  if (isImageGalleryPrompt(prompt)) return '<place>';
  if (/\b(document|doc|pdf|spreadsheet|sheet|deck|slide|file)\b/i.test(prompt)) return '<document>';
  if (/\b(repo|repository|codebase|project|app|website|component|runtime|bug|fix|implement|build)\b/i.test(prompt)) return '<target>';
  if (/\b(research|look up|find|compare|summari[sz]e|overview|report)\b/i.test(prompt)) return '<topic>';
  return '<target>';
}

function cleanReplacementPhrase(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$/g, '')
    .trim();
}

function collectTargetReplacementPhrases(prompt: string): Array<{ phrase: string; placeholder: string }> {
  const promptText = String(prompt || '');
  const replacements = new Map<string, { phrase: string; placeholder: string }>();
  const addPhrase = (raw: string, placeholder?: string) => {
    const phrase = cleanReplacementPhrase(raw);
    if (phrase.length < 3 || phrase.length > 160) return;
    if (/^<[^>\n]+>$/.test(phrase)) return;
    const specificTokens = targetSpecificTokens(phrase);
    if (specificTokens.length === 0 && !isPathLikeTarget(phrase)) return;
    const lower = phrase.toLowerCase();
    if (SKILL_ACTION_WORDS.has(lower) || SKILL_TARGET_GENERIC_WORDS.has(lower)) return;
    replacements.set(lower, {
      phrase,
      placeholder: placeholder || placeholderForPromptTarget(promptText, phrase),
    });
  };

  for (const match of promptText.matchAll(/[`"']([^`"']{3,120})[`"']/g)) {
    addPhrase(match[1] || '');
  }

  for (const match of promptText.matchAll(/\b[A-Za-z]:[\\/][^\s"'`]+|(?:[./\\]?[\w.-]+[\\/])+[\w.-]+/g)) {
    const phrase = match[0] || '';
    addPhrase(phrase, '<file>');
    const base = path.basename(phrase);
    addPhrase(base, '<file>');
    addPhrase(base.replace(/\.[^.]+$/, ''), '<file>');
  }

  for (const match of promptText.matchAll(/\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|mdx|ya?ml|toml|css|scss|html|py|go|rs|java|kt|swift|cs|cpp|c|h|sql|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|webp|svg|gif)\b/gi)) {
    const phrase = match[0] || '';
    addPhrase(phrase, '<file>');
    addPhrase(phrase.replace(/\.[^.]+$/, ''), '<file>');
  }

  for (const match of promptText.matchAll(/\b(?:of|about|for|called|named|from|in|at|inside|within|against|into|under)\s+([^,.!?;\n]{3,120})/gi)) {
    const phrase = String(match[1] || '')
      .replace(/\b(?:please|and|then|that|where|which|while|without|before|after|with|using)\b[\s\S]*$/i, '')
      .trim();
    addPhrase(phrase);
  }

  for (const match of promptText.matchAll(/\b[A-Z][A-Za-z0-9._-]*(?:\s+[A-Z][A-Za-z0-9._-]*){0,3}\b/g)) {
    addPhrase(match[0] || '');
  }

  return Array.from(replacements.values())
    .filter((entry) => entry.phrase.length >= 3)
    .sort((a, b) => b.phrase.length - a.phrase.length);
}

function replaceTargetPhrase(text: string, phrase: string, placeholder: string): string {
  if (!text || !phrase) return text;
  const escaped = escapeRegExp(phrase);
  const isWordLike = /^[A-Za-z0-9][A-Za-z0-9 _.-]*[A-Za-z0-9]$/.test(phrase);
  const pattern = isWordLike
    ? new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'gi')
    : new RegExp(escaped, 'gi');
  return text.replace(pattern, placeholder);
}

function generalizeTargetText(text: string, prompt: string): string {
  let out = String(text || '');
  for (const replacement of collectTargetReplacementPhrases(prompt)) {
    out = replaceTargetPhrase(out, replacement.phrase, replacement.placeholder);
  }
  return out
    .replace(/(<place>)(?:\s+(?:in|from|of|at)\s+(?:the\s+)?<place>)+/gi, '$1')
    .replace(/(<file>)(?:\s+(?:in|from|of|at)\s+(?:the\s+)?<file>)+/gi, '$1')
    .replace(/\s+([.,;:!?])/g, '$1');
}

function generalizeSkillMarkdownTargets(skillMd: string, prompt: string): string {
  const split = splitSkillMarkdown(skillMd);
  const body = split.bodyLines.join('\n');
  const generalizedBody = generalizeTargetText(body, prompt);
  if (!split.hasFrontMatter) return generalizedBody.trim();
  return [
    '---',
    ...split.frontMatterLines,
    '---',
    ...generalizedBody.replace(/^\n+/, '').split(/\n/),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function reusableIdentityForDraft(params: {
  prompt: string;
  skillMd: string;
  inferredName: string;
  inferredDescription: string;
}): FallbackSkillPlan | { skillId: string; name: string; description: string } | null {
  const frontmatterName = frontmatterField(params.skillMd, 'name');
  const nameLooksSpecific =
    looksTaskSpecificName(params.inferredName, params.prompt)
    || (frontmatterName ? looksTaskSpecificName(frontmatterName, params.prompt) : false);
  if (!nameLooksSpecific) return null;

  const heading = firstMarkdownHeading(params.skillMd);
  if (heading && !looksTaskSpecificName(heading, params.prompt) && !/^how to use$/i.test(heading)) {
    return {
      skillId: normalizeSkillId(heading),
      name: titleFromText(heading),
      description: params.inferredDescription || `Reusable workflow for ${heading.toLowerCase()}.`,
    };
  }

  const plan = fallbackPlanFromPrompt(params.prompt);
  if (plan.skillId !== 'reusable-task-workflow') return plan;

  const genericName = genericPromptName(params.prompt);
  if (genericName) {
    return {
      skillId: normalizeSkillId(genericName),
      name: genericName,
      description: `Reusable workflow for ${genericName.toLowerCase().replace(/\.$/, '')}.`,
    };
  }

  return plan;
}

type FallbackSkillPlan = {
  skillId: string;
  name: string;
  description: string;
  whenToUse: string[];
  inputs: string[];
  steps: string[];
  outputFormat: string[];
  verification: string[];
  fallbackPaths: string[];
};

function isImageGalleryPrompt(prompt: string): boolean {
  const text = String(prompt || '').toLowerCase();
  const asksForImages = /\b(image|images|picture|pictures|photo|photos|gallery)\b/i.test(text);
  const lookupIntent = /\b(find|show|get|search|collect|source|present|gallery)\b/i.test(text)
    || /\b(images|pictures|photos)\s+(of|for)\b/i.test(text);
  const creationIntent = /\b(generate|create|draw|edit|modify|remove|replace|upscale|annotate)\b/i.test(text);
  return asksForImages && lookupIntent && !creationIntent;
}

function observedToolNamesFromTranscript(transcript: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of transcript.matchAll(/^\[tool:([^\]\s]+)\]/gm)) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(raw);
    if (result.length >= 12) break;
  }
  return result;
}

function toolPurpose(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (lower.includes('web') || lower.includes('fetch')) {
    return 'Retrieve source pages, search result pages, or reference material without relying on remembered facts.';
  }
  if (lower.includes('browser') || lower.includes('navigate') || lower.includes('screenshot')) {
    return 'Inspect pages visually, extract page data, or capture visual proof when a browser session is available.';
  }
  if (lower.includes('image')) {
    return 'Collect, inspect, or prepare candidate image links and previews.';
  }
  if (lower.includes('grep') || lower.includes('search') || lower.includes('find')) {
    return 'Search cached output or local/reference files for reusable evidence.';
  }
  if (lower.includes('file') || lower.includes('read') || lower.includes('write')) {
    return 'Read or write local supporting files only when the workflow requires saved artifacts.';
  }
  if (lower.includes('shell') || lower.includes('command') || lower.includes('powershell')) {
    return 'Run Windows-friendly commands for inspection, extraction, or verification.';
  }
  return 'Support the workflow where this tool is available and appropriate.';
}

function fallbackPlanFromPrompt(prompt: string): FallbackSkillPlan {
  if (isImageGalleryPrompt(prompt)) {
    return {
      skillId: 'find-images',
      name: 'Find Images',
      description: 'Find and present a curated image gallery for any place, landmark, or location.',
      whenToUse: [
        'The user asks for images, pictures, photos, or a visual gallery of a place, landmark, venue, region, or location.',
        'The output should be human-readable, with captions and links instead of a raw dump of URLs.',
      ],
      inputs: [
        '`<place>`: The place, landmark, venue, region, or location to find images for.',
        '`<count>`: Optional target number of images to return.',
        '`<sourcePreference>`: Optional preferred source such as Wikimedia Commons, Wikipedia, a known official site, or general web results.',
        '`<constraints>`: Optional limits such as licensing, image size, viewpoint, landmark type, or whether to include full-size links.',
      ],
      steps: [
        'Extract `<place>`, desired image count, and any source or licensing constraints from the user request.',
        'Search reliable and inspectable sources first. Prefer Wikimedia Commons and Wikipedia for places and landmarks because image pages usually include stable file pages, captions, and licensing context.',
        'Use web or browser tools to collect candidate image pages and direct preview URLs. Keep the search broad enough to cover landmarks, streets, civic buildings, landscape views, and notable local features.',
        'Deduplicate candidates and reject broken, irrelevant, tiny, or purely decorative images. Prefer a varied set that helps the user understand the place visually.',
        'For each selected image, keep a short caption, source page link, and preview or thumbnail URL. When possible, keep a full-size source link separately from the thumbnail.',
        'Present the result as a concise gallery with markdown image previews, captions, and source/full-size links. If the app supports thumbnails or image preview cards, include direct image URLs that the UI can render.',
      ],
      outputFormat: [
        'A 1-2 sentence introduction naming `<place>` and the visual focus.',
        'A numbered or grouped gallery where each item has a caption, an image preview, and a source or full-size link.',
        'Optional source links at the end for the main pages used.',
      ],
      verification: [
        'Check that each image URL is reachable or comes from a page that clearly contains the image.',
        'Check that captions match the visible subject and do not claim certainty beyond the source.',
        'If only weak or broken image links are available, say so and provide the best source pages instead of pretending the gallery is complete.',
      ],
      fallbackPaths: [
        'If a browser/image-search tool is unavailable, use web fetch against Wikipedia and Wikimedia Commons category pages.',
        'If source output is truncated, search the cached output for `upload.wikimedia.org`, image file extensions, or Commons file links.',
        'If direct image rendering fails, provide source page links and label them clearly so the user can open them.',
      ],
    };
  }

  if (/\b(build|fix|implement|code|app|website|runtime|bug)\b/i.test(prompt)) {
    return {
      skillId: 'software-change-workflow',
      name: 'Software Change Workflow',
      description: 'Plan, implement, verify, and summarize a repeatable software change.',
      whenToUse: [
        'The user asks for a software fix, feature, UI change, or app behavior change.',
        'The work should be carried through code inspection, implementation, verification, and a concise handoff.',
      ],
      inputs: [
        '`<goal>`: The requested software behavior or fix.',
        '`<workspace>`: The repository or project to inspect.',
        '`<constraints>`: Existing patterns, test expectations, platform constraints, or files that must not be changed.',
      ],
      steps: [
        'Inspect the relevant files and existing patterns before editing.',
        'Identify the smallest scoped change that satisfies `<goal>` without unrelated refactors.',
        'Edit the implementation and any focused tests or types needed for the changed behavior.',
        'Run the most relevant checks available for the project, such as typecheck, unit tests, lint, or build.',
        'Summarize changed files, verification results, and any remaining risk.',
      ],
      outputFormat: [
        'A concise summary of what changed.',
        'The checks that were run and their result.',
        'Any follow-up or limitation that still matters.',
      ],
      verification: [
        'Prefer project scripts over invented commands.',
        'Check the UI or runtime when the change is user-facing.',
        'Do not overwrite unrelated user changes.',
      ],
      fallbackPaths: [
        'If a test command is missing or broken for unrelated reasons, report that directly and run the next best focused check.',
        'If the code path is unclear, search for neighboring components, stores, IPC handlers, and shared types before editing.',
      ],
    };
  }

  if (/\b(research|look up|find|compare|summarize|overview|report)\b/i.test(prompt)) {
    return {
      skillId: 'research-brief-workflow',
      name: 'Research Brief Workflow',
      description: 'Gather, verify, and present a concise research answer with useful sources.',
      whenToUse: [
        'The user asks for research, comparison, lookup, summary, or recommendation work.',
        'The answer benefits from source checking and a structured final response.',
      ],
      inputs: [
        '`<topic>`: The subject to research.',
        '`<scope>`: Optional geography, date range, market, audience, or depth.',
        '`<outputFormat>`: Optional preference such as table, bullets, brief, or detailed report.',
      ],
      steps: [
        'Clarify the topic and scope from the user request.',
        'Gather current information from reliable primary or high-quality sources where possible.',
        'Compare sources, remove duplicates, and keep only evidence that affects the answer.',
        'Organize the result into the requested output format.',
        'Include source links or attribution when the answer depends on external material.',
      ],
      outputFormat: [
        'A direct answer first.',
        'A structured summary using bullets, sections, or tables when helpful.',
        'Source links for claims that need attribution.',
      ],
      verification: [
        'Check dates and make sure current claims are not based only on old information.',
        'Prefer primary sources when technical, financial, legal, medical, or product details matter.',
      ],
      fallbackPaths: [
        'If a source is unavailable, use another credible source and mention the limitation.',
        'If the data conflicts, surface the conflict instead of forcing a false conclusion.',
      ],
    };
  }

  return {
    skillId: 'reusable-task-workflow',
    name: 'Reusable Task Workflow',
    description: 'Turn a completed task into a repeatable workflow with inputs, steps, checks, and output format.',
    whenToUse: [
      'A future task has the same repeatable shape as the original completed chat.',
      'The exact subject should change, but the method, checks, and final format should stay useful.',
    ],
    inputs: [
      '`<goal>`: The user-facing result to produce.',
      '`<target>`: The place, file, repository, document, client, or other object the workflow operates on.',
      '`<constraints>`: Any limits, preferred sources, formatting needs, permissions, or environment details.',
    ],
    steps: [
      'Identify the reusable goal and required inputs.',
      'Gather only the information needed for the current target.',
      'Use the same tool categories and decision points that made the original task work.',
      'Remove one-off details and keep the final output focused on the user goal.',
      'Verify the result using the most relevant checks for the task.',
      'Present the final result with any files, links, screenshots, or notes the user needs.',
    ],
    outputFormat: [
      'A direct answer or artifact that matches the user request.',
      'Relevant links, files, tables, screenshots, or notes when they are part of the workflow.',
    ],
    verification: [
      'Check that the output matches the requested target, not the source task target.',
      'Avoid carrying over user-specific names, paths, or private data from the original chat.',
    ],
    fallbackPaths: [
      'If a preferred tool is unavailable, use an equivalent available app tool or explain what is missing.',
      'If the result cannot be fully verified, state the limitation clearly.',
    ],
  };
}

export function normalizeSkillMarkdownText(input: string): string {
  let text = String(input || '').trim();
  if (!text) return '';

  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed.trim();
    } catch {
      // Leave non-JSON quoted text alone.
    }
  }

  const literalNewlineCount = (text.match(/\\n/g) || []).length;
  const actualNewlineCount = (text.match(/\n/g) || []).length;
  const looksEscapedMarkdown =
    text.startsWith('---\\n')
    || text.includes('\\nmetadata:')
    || text.includes('\\n# ')
    || text.includes('\\n## ')
    || (literalNewlineCount >= 3 && actualNewlineCount <= 2);

  if (looksEscapedMarkdown) {
    text = text
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ')
      .replace(/\\"/g, '"');
  }

  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function frontmatterField(skillMd: string, field: 'name' | 'description'): string {
  const lines = normalizeSkillMarkdownText(skillMd).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return '';
  const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIdx === -1) return '';
  const pattern = new RegExp(`^${field}\\s*:\\s*(.+)$`, 'i');
  for (const line of lines.slice(1, endIdx)) {
    const match = line.match(pattern);
    if (!match?.[1]) continue;
    return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function ensureSkillMarkdownFrontmatter(params: {
  skillId: string;
  name: string;
  description: string;
  skillMd: string;
}): string {
  const raw = normalizeSkillMarkdownText(params.skillMd);
  if (raw.startsWith('---')) return raw;
  const metadata = {
    opendeskmate: {
      skillKey: params.skillId,
      generatedBy: 'task-save-skill-draft',
      requiresReview: true,
    },
  };
  return [
    '---',
    `name: ${params.skillId}`,
    `description: ${yamlQuoted(params.description)}`,
    'metadata: |',
    ...JSON.stringify(metadata, null, 2).split('\n').map((line) => `  ${line}`),
    '---',
    '',
    raw || [
      '# How to use',
      '',
      '- Review the source chat and adapt these steps before relying on the skill.',
      '- Add concrete instructions, required inputs, and expected outputs.',
    ].join('\n'),
  ].join('\n');
}

function applySkillIdentityToFrontmatter(params: {
  skillMd: string;
  skillId: string;
  description: string;
}): string {
  const raw = normalizeSkillMarkdownText(params.skillMd);
  if (!raw.startsWith('---')) return raw;

  const lines = raw.split(/\n/);
  const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIdx === -1) return raw;

  let sawName = false;
  let sawDescription = false;
  const next = [...lines];
  for (let index = 1; index < endIdx; index += 1) {
    const line = next[index] ?? '';
    if (/^name\s*:/i.test(line)) {
      next[index] = `name: ${params.skillId}`;
      sawName = true;
      continue;
    }
    if (/^description\s*:/i.test(line)) {
      next[index] = `description: ${yamlQuoted(params.description)}`;
      sawDescription = true;
    }
  }

  const insertAt = 1;
  const additions: string[] = [];
  if (!sawName) additions.push(`name: ${params.skillId}`);
  if (!sawDescription) additions.push(`description: ${yamlQuoted(params.description)}`);
  if (additions.length > 0) {
    next.splice(insertAt, 0, ...additions);
  }

  return next.join('\n').trim();
}

function applySkillHeading(params: { skillMd: string; name: string }): string {
  const raw = normalizeSkillMarkdownText(params.skillMd);
  const lines = raw.split(/\n/);
  const endIdx = lines[0]?.trim() === '---'
    ? lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    : -1;
  const startIndex = endIdx >= 0 ? endIdx + 1 : 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!/^#\s+\S/.test(lines[index] || '')) continue;
    lines[index] = `# ${params.name}`;
    return lines.join('\n').trim();
  }
  lines.splice(startIndex, 0, '', `# ${params.name}`, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

type SkillMarkdownSplit = {
  frontMatterLines: string[];
  bodyLines: string[];
  hasFrontMatter: boolean;
};

function splitSkillMarkdown(raw: string): SkillMarkdownSplit {
  const lines = normalizeSkillMarkdownText(raw).split(/\n/);
  if (lines[0]?.trim() !== '---') {
    return {
      frontMatterLines: [],
      bodyLines: lines,
      hasFrontMatter: false,
    };
  }
  const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIdx === -1) {
    return {
      frontMatterLines: [],
      bodyLines: lines,
      hasFrontMatter: false,
    };
  }
  return {
    frontMatterLines: lines.slice(1, endIdx),
    bodyLines: lines.slice(endIdx + 1),
    hasFrontMatter: true,
  };
}

function stripMetadataFromFrontMatter(frontMatterLines: string[]): { cleanLines: string[]; metadata: Record<string, unknown> } {
  const cleanLines: string[] = [];
  let metadata: Record<string, unknown> = {};

  for (let i = 0; i < frontMatterLines.length; i += 1) {
    const line = frontMatterLines[i] ?? '';
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match || /^\s/.test(line)) {
      cleanLines.push(line);
      continue;
    }

    const key = String(match[1] || '').trim().toLowerCase();
    const rawValue = String(match[2] || '').trim();
    if (key !== 'metadata') {
      cleanLines.push(line);
      continue;
    }

    if (rawValue === '|' || rawValue === '>') {
      const block: string[] = [];
      i += 1;
      while (i < frontMatterLines.length) {
        const next = frontMatterLines[i] ?? '';
        if (!next.trim()) {
          block.push('');
          i += 1;
          continue;
        }
        if (!/^\s/.test(next)) {
          i -= 1;
          break;
        }
        block.push(next.replace(/^\s{2,}/, ''));
        i += 1;
      }
      const rawJson = block.join('\n').trim();
      if (rawJson.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
          }
        } catch {
          // Leave invalid metadata behind; the generated draft will receive fresh metadata.
        }
      }
      continue;
    }
  }

  return { cleanLines, metadata };
}

function renderMetadataFrontMatterLines(metadata: Record<string, unknown>): string[] {
  return [
    'metadata: |',
    ...JSON.stringify(metadata, null, 2).split('\n').map((line) => `  ${line}`),
  ];
}

function upsertAutomationMetadata(params: {
  skillMd: string;
  skillId: string;
  agentId?: string;
  agentName?: string;
  taskId: string;
  mode: UserSkillAutomationMode;
  draftId: string;
  evaluation: UserSkillTaskReusabilityEvaluation;
  applied: boolean;
  nowIso?: string;
}): string {
  const nowIso = params.nowIso || new Date().toISOString();
  const split = splitSkillMarkdown(params.skillMd);
  const { cleanLines, metadata } = stripMetadataFromFrontMatter(split.frontMatterLines);
  const existingOpenDeskmate =
    metadata.opendeskmate && typeof metadata.opendeskmate === 'object' && !Array.isArray(metadata.opendeskmate)
      ? metadata.opendeskmate as Record<string, unknown>
      : {};
  const existingVisibility =
    existingOpenDeskmate.visibility && typeof existingOpenDeskmate.visibility === 'object' && !Array.isArray(existingOpenDeskmate.visibility)
      ? existingOpenDeskmate.visibility as Record<string, unknown>
      : {};

  const nextOpenDeskmate: Record<string, unknown> = {
    ...existingOpenDeskmate,
    skillKey: String(existingOpenDeskmate.skillKey || params.skillId),
    generatedBy: String(existingOpenDeskmate.generatedBy || 'hermes-task-automation'),
    generatedByAgentName: String(existingOpenDeskmate.generatedByAgentName || params.agentName || '').trim() || undefined,
    generatedByAgentId: String(existingOpenDeskmate.generatedByAgentId || params.agentId || '').trim() || undefined,
    origin: String(existingOpenDeskmate.origin || 'post-task-automation'),
    requiresReview: !params.applied,
    automation: {
      mode: params.mode,
      confidence: params.evaluation.confidence,
      confidenceLabel: params.evaluation.confidenceLabel,
      sourceTaskId: params.taskId,
      draftId: params.draftId,
      reason: automationReasonFromEvaluation(params.evaluation, params.applied),
      reasons: params.evaluation.reasons.slice(0, 8),
      ...(params.applied ? { appliedAt: nowIso } : { stagedAt: nowIso }),
    },
  };

  if (params.agentId) {
    nextOpenDeskmate.visibility = {
      ...existingVisibility,
      scope: existingVisibility.scope || 'private',
      ownerAgentId: existingVisibility.ownerAgentId || params.agentId,
      sharedWithAgentIds: Array.isArray(existingVisibility.sharedWithAgentIds)
        ? existingVisibility.sharedWithAgentIds
        : [],
    };
  }

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    opendeskmate: Object.fromEntries(
      Object.entries(nextOpenDeskmate).filter(([, value]) => value !== undefined)
    ),
  };

  const frontMatterLines = [
    ...cleanLines.filter((line, index, arr) => {
      if (line.trim()) return true;
      return arr.slice(index + 1).some((later) => later.trim());
    }),
    ...renderMetadataFrontMatterLines(nextMetadata),
  ];
  const bodyLines = split.hasFrontMatter ? split.bodyLines : split.bodyLines;
  return [
    '---',
    ...frontMatterLines,
    '---',
    ...bodyLines,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function automationDraftStorePath(): string {
  return path.join(getManagedSkillsDir(), AUTOMATION_STORE_DIR, AUTOMATION_DRAFTS_FILE);
}

function readAutomationDraftRecords(): UserSkillAutomationDraftRecord[] {
  const filePath = automationDraftStorePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { drafts?: unknown };
    if (!Array.isArray(parsed.drafts)) return [];
    return parsed.drafts
      .filter((entry): entry is UserSkillAutomationDraftRecord =>
        Boolean(entry && typeof entry === 'object' && (entry as UserSkillAutomationDraftRecord).id)
      )
      .slice(0, MAX_STAGED_DRAFTS);
  } catch {
    return [];
  }
}

function writeAutomationDraftRecords(records: UserSkillAutomationDraftRecord[]): void {
  const filePath = automationDraftStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ drafts: records.slice(0, MAX_STAGED_DRAFTS) }, null, 2),
    'utf8'
  );
}

export function listStagedUserSkillAutomationDrafts(params?: { agentId?: string }): UserSkillAutomationDraftRecord[] {
  const records = readAutomationDraftRecords()
    .filter((record) => record.status === 'staged')
    .filter((record) => !params?.agentId || record.agentId === params.agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}

function stageAutomationDraftRecord(params: {
  taskId: string;
  agentId?: string;
  mode: UserSkillAutomationMode;
  draft: UserSkillWorkflowDraft;
  evaluation: UserSkillTaskReusabilityEvaluation;
  nowIso?: string;
}): UserSkillAutomationDraftRecord {
  const nowIso = params.nowIso || new Date().toISOString();
  const draftId = randomUUID();
  const record: UserSkillAutomationDraftRecord = {
    id: draftId,
    taskId: params.taskId,
    agentId: params.agentId,
    mode: params.mode,
    status: 'staged',
    createdAt: nowIso,
    reason: automationReasonFromEvaluation(params.evaluation, false),
    draft: {
      ...params.draft,
      skillMd: upsertAutomationMetadata({
        skillMd: params.draft.skillMd,
        skillId: params.draft.skillId,
        agentId: params.agentId,
        taskId: params.taskId,
        mode: params.mode,
        draftId,
        evaluation: params.evaluation,
        applied: false,
        nowIso,
      }),
    },
    evaluation: params.evaluation,
  };
  const records = [record, ...readAutomationDraftRecords().filter((entry) => entry.id !== draftId)];
  writeAutomationDraftRecords(records);
  return record;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function confidenceLabel(confidence: number): UserSkillTaskReusabilityEvaluation['confidenceLabel'] {
  if (confidence >= AUTOMATIC_SAVE_CONFIDENCE) return 'high';
  if (confidence >= STAGE_CONFIDENCE) return 'medium';
  return 'low';
}

function automationReasonFromEvaluation(
  evaluation: UserSkillTaskReusabilityEvaluation,
  applied: boolean
): string {
  const prefix = applied ? 'Applied' : 'Staged';
  const reason = evaluation.reasons[0] || evaluation.blockers[0] || 'Task looked reusable enough for skill learning.';
  return `${prefix} from completed task with ${evaluation.confidenceLabel} confidence: ${reason}`;
}

function taskMessageText(task: Pick<StoredTask, 'prompt' | 'summary' | 'messages'>): string {
  return [
    task.prompt,
    task.summary,
    ...(task.messages || []).map((message) => message.content || ''),
  ].join('\n');
}

export function evaluateTaskForSkillReuse(
  task: Pick<StoredTask, 'prompt' | 'summary' | 'status' | 'messages' | 'privacyMode'>
): UserSkillTaskReusabilityEvaluation {
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 0;

  if (task.status !== 'completed') {
    blockers.push('Task is not completed.');
  }
  if (task.privacyMode === 'incognito') {
    blockers.push('Incognito tasks are not used for automatic skill learning.');
  }

  const prompt = String(task.prompt || '').trim();
  const text = taskMessageText(task).toLowerCase();
  const messages = task.messages || [];
  const toolCount = messages.filter((message) => message.type === 'tool').length;
  const assistantCount = messages.filter((message) => message.type === 'assistant').length;

  if (prompt.length < 18) {
    blockers.push('Prompt is too short to infer a reusable workflow.');
  } else {
    score += 0.12;
  }

  if (task.summary && task.summary.trim().length > 20) {
    score += 0.1;
    reasons.push('Task has a useful summary.');
  }

  if (toolCount >= 2) {
    score += 0.24;
    reasons.push('Workflow used multiple tool calls.');
  } else if (toolCount === 1) {
    score += 0.1;
    reasons.push('Workflow used a tool call.');
  }

  if (assistantCount >= 2 || messages.length >= 5) {
    score += 0.12;
    reasons.push('Task had enough steps to generalize.');
  }

  if (/\b(workflow|repeat|reusable|template|process|standard|checklist|playbook|steps?)\b/i.test(text)) {
    score += 0.16;
    reasons.push('Task text suggests repeatable procedure.');
  }

  if (/\b(build|implement|fix|debug|research|compare|summari[sz]e|generate|create|update|audit|review|analy[sz]e|collect|find)\b/i.test(prompt)) {
    score += 0.12;
    reasons.push('Prompt has a reusable task verb.');
  }

  if (/\b(verify|test|check|source|fallback|format|criteria|requirements?)\b/i.test(text)) {
    score += 0.1;
    reasons.push('Task included checks, sources, or constraints.');
  }

  if (/\b(thanks|thank you|yes|no|ok|okay|cool|great|hello|hi)\b\.?$/i.test(prompt) && prompt.length < 40) {
    score -= 0.3;
    blockers.push('Prompt looks conversational rather than procedural.');
  }

  if (/\b(password|secret|token|api key|credential|private key)\b/i.test(text)) {
    score -= 0.2;
    blockers.push('Task appears to involve secrets or credentials.');
  }

  const confidence = clampConfidence(blockers.length > 0 ? Math.min(score, 0.49) : score);
  return {
    reusable: blockers.length === 0 && confidence >= STAGE_CONFIDENCE,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    reasons,
    blockers,
  };
}

function isGeneratedSkillMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  const env =
    metadata.opendeskmate && typeof metadata.opendeskmate === 'object'
      ? metadata.opendeskmate as Record<string, unknown>
      : metadata.clawdbot && typeof metadata.clawdbot === 'object'
        ? metadata.clawdbot as Record<string, unknown>
        : {};
  const markers = [
    env.generatedBy,
    env.origin,
    env.createdBy,
  ].map((entry) => String(entry || '').trim().toLowerCase());
  return markers.some((marker) =>
    marker.includes('task-save-skill')
    || marker.includes('hermes')
    || marker === 'agent-auto'
    || marker === 'agent_auto'
    || marker === 'agent-user-instruction'
  );
}

function isAutomationOwnedSkillMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  const env =
    metadata.opendeskmate && typeof metadata.opendeskmate === 'object'
      ? metadata.opendeskmate as Record<string, unknown>
      : metadata.clawdbot && typeof metadata.clawdbot === 'object'
        ? metadata.clawdbot as Record<string, unknown>
        : {};
  const automation = env.automation && typeof env.automation === 'object' && !Array.isArray(env.automation)
    ? env.automation as Record<string, unknown>
    : {};
  const markers = [
    env.generatedBy,
    env.origin,
    env.createdBy,
  ].map((entry) => String(entry || '').trim().toLowerCase());

  if (String(env.origin || '').trim().toLowerCase() === 'post-task-automation') return true;
  if (String(env.generatedBy || '').trim().toLowerCase().includes('hermes-task-automation')) return true;
  if (String(automation.appliedAt || '').trim()) return true;
  if (String(automation.mode || '').trim().toLowerCase() === 'automatic' && String(automation.sourceTaskId || '').trim()) {
    return true;
  }
  return markers.some((marker) => marker === 'agent-auto' || marker === 'agent_auto');
}

type ListedUserSkill = ReturnType<typeof listUserSkills>['skills'][number];

function metadataEnvelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  if (metadata.opendeskmate && typeof metadata.opendeskmate === 'object' && !Array.isArray(metadata.opendeskmate)) {
    return metadata.opendeskmate as Record<string, unknown>;
  }
  if (metadata.clawdbot && typeof metadata.clawdbot === 'object' && !Array.isArray(metadata.clawdbot)) {
    return metadata.clawdbot as Record<string, unknown>;
  }
  return {};
}

function normalizedIdentityKey(value: unknown): string {
  return normalizeSkillId(String(value || '').trim()).toLowerCase();
}

function skillMetadataKey(skill: ListedUserSkill): string {
  const env = metadataEnvelope(skill.metadata);
  return normalizedIdentityKey(env.skillKey || skill.id);
}

function draftMetadataKey(draft: UserSkillWorkflowDraft): string {
  const split = splitSkillMarkdown(draft.skillMd);
  const { metadata } = stripMetadataFromFrontMatter(split.frontMatterLines);
  const env = metadataEnvelope(metadata);
  return normalizedIdentityKey(env.skillKey || draft.skillId);
}

function normalizeAgentIdForComparison(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function canModifySkillForAgent(skill: ListedUserSkill, agentId?: string): boolean {
  const ownerAgentId = normalizeAgentIdForComparison(skill.visibilityOwnerAgentId);
  if (!ownerAgentId) return true;
  const requesterAgentId = normalizeAgentIdForComparison(agentId)
    || normalizeAgentIdForComparison(getAgentContext(agentId).agentId);
  if (!requesterAgentId) return true;
  return requesterAgentId === ownerAgentId;
}

function uniqueManagedSkillId(baseSkillId: string, takenIds: Set<string>): string {
  const base = normalizeSkillId(baseSkillId);
  if (!takenIds.has(base) && !fs.existsSync(path.join(getManagedSkillsDir(), base))) return base;

  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    if (takenIds.has(candidate)) continue;
    if (fs.existsSync(path.join(getManagedSkillsDir(), candidate))) continue;
    return candidate;
  }

  return `${base.slice(0, 54)}-${Date.now().toString(36)}`.slice(0, 64);
}

function skillIdentityTokens(value: string): Set<string> {
  return new Set(
    skillNameTokens(value, true)
      .filter((token) => !SKILL_TARGET_GENERIC_WORDS.has(token))
      .filter((token) => token !== 'skill' && token !== 'workflow' && token !== 'process')
  );
}

function skillIdentitySimilarity(a: string, b: string): number {
  const left = skillIdentityTokens(a);
  const right = skillIdentityTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function findGeneratedSkillUpdateTarget(
  skills: ListedUserSkill[],
  draft: UserSkillWorkflowDraft
): ListedUserSkill | undefined {
  const exact = skills.find((skill) => skill.id === draft.skillId);
  if (
    exact?.editable
    && (exact.manifest?.state ?? 'active') === 'active'
    && isAutomationOwnedSkillMetadata(exact.metadata)
  ) {
    return exact;
  }

  const draftIdentity = `${draft.skillId} ${draft.name} ${draft.description || ''}`;
  const candidates = skills
    .filter((skill) =>
      skill.editable
      && (skill.manifest?.state ?? 'active') === 'active'
      && isAutomationOwnedSkillMetadata(skill.metadata)
    )
    .map((skill) => ({
      skill,
      score: skillIdentitySimilarity(draftIdentity, `${skill.id} ${skill.name} ${skill.description || ''}`),
    }))
    .filter((entry) => entry.score >= 0.82)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.skill;
}

function generatedSkillPriority(skill: ListedUserSkill, agentId?: string): number {
  const perf = skill.manifest?.performance;
  return (
    (canModifySkillForAgent(skill, agentId) ? 1_000 : 0)
    + (isAutomationOwnedSkillMetadata(skill.metadata) ? 100 : 0)
    + (skill.source === 'managed' ? 20 : 0)
    + (skill.id.match(/-\d+$/) ? 0 : 10)
    + ((perf?.successCount ?? 0) * 3)
    + (perf?.samples ?? 0)
  );
}

function findGeneratedSkillDuplicateTarget(
  skills: ListedUserSkill[],
  draft: UserSkillWorkflowDraft,
  agentId?: string
): ListedUserSkill | undefined {
  const draftKey = draftMetadataKey(draft);
  const draftIdentity = `${draft.skillId} ${draft.name} ${draft.description || ''}`;
  const activeGenerated = skills
    .filter((skill) =>
      skill.editable
      && (skill.manifest?.state ?? 'active') === 'active'
      && isGeneratedSkillMetadata(skill.metadata)
    );

  const exactKeyMatches = activeGenerated
    .filter((skill) => skillMetadataKey(skill) === draftKey)
    .sort((a, b) => generatedSkillPriority(b, agentId) - generatedSkillPriority(a, agentId));
  if (exactKeyMatches[0]) return exactKeyMatches[0];

  const similar = activeGenerated
    .map((skill) => ({
      skill,
      score: skillIdentitySimilarity(draftIdentity, `${skill.id} ${skill.name} ${skill.description || ''}`),
    }))
    .filter((entry) => entry.score >= 0.9)
    .sort((a, b) =>
      b.score - a.score
      || generatedSkillPriority(b.skill, agentId) - generatedSkillPriority(a.skill, agentId)
    );

  return similar[0]?.skill;
}

function remainingTaskSpecificHits(draft: UserSkillWorkflowDraft, prompt: string): string[] {
  const text = `${draft.skillId}\n${draft.name}\n${draft.description || ''}\n${draft.skillMd}`;
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const replacement of collectTargetReplacementPhrases(prompt)) {
    const phrase = replacement.phrase;
    if (phrase.length < 4) continue;
    const escaped = escapeRegExp(phrase);
    const pattern = /^[A-Za-z0-9][A-Za-z0-9 _.-]*[A-Za-z0-9]$/.test(phrase)
      ? new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'i')
      : new RegExp(escaped, 'i');
    if (!pattern.test(text)) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(phrase);
  }
  return hits.slice(0, 8);
}

function assessDraftAutomationReadiness(params: {
  draft: UserSkillWorkflowDraft;
  prompt: string;
  evaluation: UserSkillTaskReusabilityEvaluation;
}): GeneratedDraftAutomationReadiness {
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = params.evaluation.confidence;
  const normalizedSkillMd = normalizeSkillMarkdownText(params.draft.skillMd);
  const split = splitSkillMarkdown(normalizedSkillMd);
  const body = split.bodyLines.join('\n').trim();
  const placeholderCount = (body.match(/<[^>\n]{2,80}>/g) || []).length;
  const headingCount = (body.match(/^#{1,3}\s+\S.+$/gm) || []).length;

  if (!params.evaluation.reusable) {
    blockers.push(params.evaluation.blockers[0] || 'Task was not evaluated as reusable.');
  }
  if (params.evaluation.confidence < AUTOMATIC_SAVE_CONFIDENCE) {
    blockers.push('Task confidence is below the automatic save threshold.');
  }
  if (body.length < 220) {
    blockers.push('Draft body is too thin for automatic save.');
  } else {
    score += 0.03;
    reasons.push('Draft body has enough detail.');
  }
  if (headingCount < 3) {
    blockers.push('Draft is missing reusable workflow sections.');
  }
  if (!/\b(tool call overview|workflow|steps?)\b/i.test(body)) {
    blockers.push('Draft is missing a workflow or tool overview section.');
  }
  if (!/\b(verify|verification|check|test|fallback)\b/i.test(body)) {
    blockers.push('Draft is missing verification or fallback guidance.');
  } else {
    score += 0.02;
    reasons.push('Draft includes verification or fallback guidance.');
  }
  if (placeholderCount === 0 && collectTargetReplacementPhrases(params.prompt).length > 0) {
    blockers.push('Draft does not expose generalized placeholders for the original target.');
  } else if (placeholderCount > 0) {
    score += 0.02;
    reasons.push('Draft uses generalized placeholders.');
  }

  const rawTranscriptMarkers = [
    'Transcript (chronological):',
    'Task prompt:',
    '[tool:',
    '[assistant]',
    '[user]',
  ];
  const marker = rawTranscriptMarkers.find((candidate) => normalizedSkillMd.includes(candidate));
  if (marker) {
    blockers.push(`Draft still contains raw transcript marker: ${marker}`);
  }

  const remainingTargets = remainingTaskSpecificHits(params.draft, params.prompt);
  if (remainingTargets.length > 0) {
    blockers.push(`Draft still mentions task-specific target text: ${remainingTargets.slice(0, 3).join(', ')}`);
  }

  if (looksTaskSpecificName(params.draft.name, params.prompt) || looksTaskSpecificName(params.draft.skillId, params.prompt)) {
    blockers.push('Draft name or skill ID still looks tied to the completed task target.');
  }

  const confidence = clampConfidence(score);
  return {
    automatic: blockers.length === 0 && confidence >= AUTOMATIC_SAVE_CONFIDENCE,
    confidence,
    reasons,
    blockers,
  };
}

async function applyAutomationDraft(params: {
  taskId: string;
  agentId?: string;
  mode: UserSkillAutomationMode;
  draft: UserSkillWorkflowDraft;
  evaluation: UserSkillTaskReusabilityEvaluation;
}): Promise<{
  disposition: 'saved' | 'updated' | 'skipped';
  skillId: string;
  source: UserSkillSource;
  manifest?: UserSkillPostTaskAutomationResult['manifest'];
  draftRecord?: UserSkillAutomationDraftRecord;
  message?: string;
}> {
  const nowIso = new Date().toISOString();
  const draftId = randomUUID();
  const report = listUserSkills({ agentId: params.agentId });
  const allSkillsReport = listUserSkills();
  const takenIds = new Set(allSkillsReport.skills.map((skill) => skill.id));
  const scopedExisting = findGeneratedSkillUpdateTarget(report.skills, params.draft);
  const globalDuplicate = scopedExisting
    ? undefined
    : findGeneratedSkillDuplicateTarget(allSkillsReport.skills, params.draft, params.agentId);
  const existing = scopedExisting
    ?? (
      globalDuplicate
      && isAutomationOwnedSkillMetadata(globalDuplicate.metadata)
      && canModifySkillForAgent(globalDuplicate, params.agentId)
        ? globalDuplicate
        : undefined
    );

  if (!existing && globalDuplicate) {
    return {
      disposition: 'skipped',
      skillId: globalDuplicate.id,
      source: globalDuplicate.source,
      message: `Skipped creating duplicate generated skill ${params.draft.skillId}; existing skill ${globalDuplicate.id} already uses the same workflow key.`,
    };
  }

  const canUpdateExisting = Boolean(existing);
  const skillId = canUpdateExisting
    ? existing!.id
    : uniqueManagedSkillId(params.draft.skillId, takenIds);
  const source: UserSkillSource = canUpdateExisting && existing?.source ? existing.source : 'managed';
  const agentContext = getAgentContext(params.agentId);
  const reason = automationReasonFromEvaluation(params.evaluation, true);
  const skillMd = upsertAutomationMetadata({
    skillMd: applySkillIdentityToFrontmatter({
      skillMd: params.draft.skillMd,
      skillId,
      description: params.draft.description || 'Reusable workflow saved from a completed task.',
    }),
    skillId,
    agentId: agentContext.agentId || params.agentId,
    agentName: agentContext.agent?.name,
    taskId: params.taskId,
    mode: params.mode,
    draftId,
    evaluation: params.evaluation,
    applied: true,
    nowIso,
  });

  const writeResult = await writeUserSkillFile({
    skillId,
    relPath: 'SKILL.md',
    content: skillMd,
    source,
    agentId: params.agentId,
    changeReason: reason,
    sourceTaskId: params.taskId,
    confidence: params.evaluation.confidence,
    changeSource: 'post-task-skill-automation',
  });
  const draftRecord: UserSkillAutomationDraftRecord = {
    id: draftId,
    taskId: params.taskId,
    agentId: params.agentId,
    mode: params.mode,
    status: 'applied',
    createdAt: nowIso,
    appliedAt: nowIso,
    skillId,
    source,
    reason,
    draft: {
      ...params.draft,
      skillId,
      skillMd,
    },
    evaluation: params.evaluation,
  };
  const records = [draftRecord, ...readAutomationDraftRecords().filter((entry) => entry.id !== draftId)];
  writeAutomationDraftRecords(records);

  return {
    disposition: canUpdateExisting ? 'updated' : 'saved',
    skillId,
    source,
    manifest: writeResult.manifest,
    draftRecord,
  };
}

function fallbackSkillMarkdown(params: { plan: FallbackSkillPlan; transcript: string }): string {
  const tools = observedToolNamesFromTranscript(params.transcript);
  const metadata = {
    opendeskmate: {
      skillKey: params.plan.skillId,
      generatedBy: 'task-save-skill-fallback',
      requiresReview: true,
      observedTools: tools,
    },
  };
  const toolOverview = tools.length > 0
    ? tools.map((tool) => `- \`${tool}\`: ${toolPurpose(tool)}`)
    : [
        '- Web/browser tools: Retrieve and inspect external sources when the task depends on current or visual information.',
        '- File/search tools: Inspect local or cached content when the workflow uses saved artifacts.',
        '- Verification tools: Check that the result is reachable, accurate for the target, and formatted as requested.',
      ];
  return [
    '---',
    `name: ${params.plan.skillId}`,
    `description: ${yamlQuoted(params.plan.description)}`,
    'metadata: |',
    ...JSON.stringify(metadata, null, 2).split('\n').map((line) => `  ${line}`),
    '---',
    '',
    `# ${params.plan.name}`,
    '',
    params.plan.description,
    '',
    '## When to use',
    '',
    ...params.plan.whenToUse.map((item) => `- ${item}`),
    '',
    '## Inputs',
    '',
    ...params.plan.inputs.map((item) => `- ${item}`),
    '',
    '## Tool call overview',
    '',
    ...toolOverview,
    '',
    '## Workflow',
    '',
    ...params.plan.steps.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## Output format',
    '',
    ...params.plan.outputFormat.map((item) => `- ${item}`),
    '',
    '## Verification',
    '',
    ...params.plan.verification.map((item) => `- ${item}`),
    '',
    '## Fallbacks',
    '',
    ...params.plan.fallbackPaths.map((item) => `- ${item}`),
    '',
    '## Notes',
    '',
    '- This fallback was created because the AI draft could not be parsed as strict JSON.',
    '- Review before sharing, but keep the reusable method and placeholders rather than the original task target.',
    '- Do not include raw chat logs, full tool payloads, retries, or private user data in the skill.',
  ].join('\n');
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

function normalizeDraft(value: unknown, fallback: { taskPrompt: string; transcript: string; responseText?: string }): UserSkillWorkflowDraft {
  const obj = unwrapDraftObject(value) as Partial<UserSkillWorkflowDraft> & Record<string, unknown>;
  let skillMd = String(
    obj.skillMd
      ?? obj.skill_md
      ?? obj.skillMarkdown
      ?? obj.skill_markdown
      ?? obj.markdown
      ?? obj.content
      ?? ''
  ).trim();
  if (!skillMd && fallback.responseText) {
    skillMd = extractSkillMdFallback(fallback.responseText);
  }
  skillMd = normalizeSkillMarkdownText(skillMd);
  if (!skillMd) {
    throw new Error('Invalid draft JSON: missing skillMd');
  }

  const inferredName =
    String(obj.name ?? obj.skillName ?? obj.skill_name ?? '').trim()
    || frontmatterField(skillMd, 'name')
    || titleFromText(fallback.taskPrompt);
  const inferredDescription =
    String(obj.description ?? obj.summary ?? '').trim()
    || frontmatterField(skillMd, 'description')
    || 'Reusable workflow saved from a completed chat.';
  const reusableIdentity = reusableIdentityForDraft({
    prompt: fallback.taskPrompt,
    skillMd,
    inferredName,
    inferredDescription,
  });
  const skillId = reusableIdentity?.skillId
    ?? normalizeSkillId(String(obj.skillId ?? obj.skill_id ?? obj.id ?? '').trim() || inferredName || fallback.taskPrompt);
  const name = reusableIdentity?.name ?? inferredName ?? titleFromText(skillId);
  const description = generalizeTargetText(reusableIdentity?.description ?? inferredDescription, fallback.taskPrompt);
  skillMd = ensureSkillMarkdownFrontmatter({
    skillId,
    name,
    description,
    skillMd,
  });
  skillMd = applySkillIdentityToFrontmatter({
    skillMd,
    skillId,
    description,
  });
  skillMd = applySkillHeading({
    skillMd,
    name,
  });
  skillMd = generalizeSkillMarkdownTargets(skillMd, fallback.taskPrompt);

  return {
    skillId,
    name: name.slice(0, 120),
    description: description.slice(0, 300) || undefined,
    skillMd,
  };
}

export function sanitizeGeneratedSkillMd(skillMd: string, platform = process.platform): string {
  skillMd = normalizeSkillMarkdownText(skillMd);

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

  const { prompt, transcript } = buildTranscript(req);
  const userText = [
    'Create a reusable SKILL.md that captures the workflow from this chat.',
    'Focus on the repeatable procedure, assumptions, parameters, useful tool categories, source strategy, checks, and final output shape.',
    'Generalize the original target into placeholders. For example, an image search for one town should become a reusable image-gallery workflow for <place>, not a skill named after that town.',
    'Use OpenClaw-style skill writing: frontmatter name is a kebab-case slug, description is a short trigger phrase, and the body contains the reusable instructions.',
    'Include a concise Tool call overview section that explains what the important tool calls were for, but do not copy raw tool output or the full transcript.',
    'Remove duplicated attempts, transient errors, one-off details, and chat-specific narration.',
    'The result should read like instructions for a future agent, not a record of what happened in this task.',
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
    const draft = normalizeDraft(parsed, { taskPrompt: prompt, transcript, responseText: text });
    draft.skillMd = sanitizeGeneratedSkillMd(draft.skillMd);
    return { ok: true, draft };
  } catch (err) {
    const plan = fallbackPlanFromPrompt(prompt);
    const draft: UserSkillWorkflowDraft = {
      skillId: plan.skillId,
      name: plan.name,
      description: plan.description,
      skillMd: sanitizeGeneratedSkillMd(fallbackSkillMarkdown({ plan, transcript })),
    };
    return { ok: true, draft };
  }
}

export async function runPostTaskSkillAutomation(
  req: UserSkillPostTaskAutomationRequest
): Promise<UserSkillPostTaskAutomationResult> {
  const task = getTask(req.taskId, req.agentId);
  const agentContext = getAgentContext(req.agentId);
  const mode = req.modeOverride ?? resolveUserSkillAutomationMode(agentContext.agent);

  if (!task) {
    return {
      ok: false,
      mode,
      disposition: 'error',
      message: 'Task not found.',
      taskId: req.taskId,
      agentId: req.agentId,
      error: 'Task not found',
    };
  }

  if (mode === 'off') {
    return {
      ok: true,
      mode,
      disposition: 'noop',
      message: 'Skill automation is off.',
      taskId: req.taskId,
      agentId: task.agentId ?? req.agentId,
    };
  }

  const evaluation = evaluateTaskForSkillReuse(task);
  if (!evaluation.reusable) {
    return {
      ok: true,
      mode,
      disposition: 'skipped',
      message: evaluation.blockers[0] || 'Task did not look reusable enough to turn into a skill.',
      taskId: req.taskId,
      agentId: task.agentId ?? req.agentId,
      evaluation,
    };
  }

  const generated = await generateUserSkillFromTask({
    taskId: req.taskId,
    agentId: task.agentId ?? req.agentId,
  });
  if (!generated.ok || !generated.draft) {
    return {
      ok: false,
      mode,
      disposition: 'error',
      message: generated.error || 'Failed to generate a reusable skill draft.',
      taskId: req.taskId,
      agentId: task.agentId ?? req.agentId,
      evaluation,
      error: generated.error || 'Failed to generate draft',
    };
  }

  const draftReadiness = assessDraftAutomationReadiness({
    draft: generated.draft,
    prompt: task.prompt,
    evaluation,
  });

  if (mode === 'automatic' && draftReadiness.automatic) {
    try {
      const applied = await applyAutomationDraft({
        taskId: req.taskId,
        agentId: task.agentId ?? req.agentId,
        mode,
        draft: generated.draft,
        evaluation,
      });
      return {
        ok: true,
        mode,
        disposition: applied.disposition,
        message: applied.message || (applied.disposition === 'skipped'
          ? `Skipped duplicate generated skill ${applied.skillId}.`
          : applied.disposition === 'updated'
          ? `Updated generated skill ${applied.skillId} (${Math.round(evaluation.confidence * 100)}% confidence).`
          : `Saved generated skill ${applied.skillId} (${Math.round(evaluation.confidence * 100)}% confidence).`),
        taskId: req.taskId,
        agentId: task.agentId ?? req.agentId,
        skillId: applied.skillId,
        draftRecord: applied.draftRecord,
        evaluation,
        manifest: applied.manifest,
      };
    } catch (error) {
      return {
        ok: false,
        mode,
        disposition: 'error',
        message: (error as Error)?.message || 'Failed to save generated skill.',
        taskId: req.taskId,
        agentId: task.agentId ?? req.agentId,
        evaluation,
        error: (error as Error)?.message || 'Failed to save generated skill',
      };
    }
  }

  const staged = stageAutomationDraftRecord({
    taskId: req.taskId,
    agentId: task.agentId ?? req.agentId,
    mode,
    draft: generated.draft,
    evaluation,
  });
  return {
    ok: true,
    mode,
    disposition: 'staged',
    message: mode === 'approval'
      ? `Reusable skill draft staged for approval (${Math.round(evaluation.confidence * 100)}% confidence).`
      : evaluation.confidence >= AUTOMATIC_SAVE_CONFIDENCE && draftReadiness.blockers.length > 0
        ? `Reusable skill draft staged for review: ${draftReadiness.blockers[0]}`
        : `Reusable skill draft staged because confidence was below the automatic save threshold (${Math.round(evaluation.confidence * 100)}%).`,
    taskId: req.taskId,
    agentId: task.agentId ?? req.agentId,
    skillId: generated.draft.skillId,
    draftRecord: staged,
    evaluation,
  };
}

export const __automationTest = {
  assessDraftAutomationReadiness,
  evaluateTaskForSkillReuse,
  fallbackPlanFromPrompt,
  findGeneratedSkillDuplicateTarget,
  findGeneratedSkillUpdateTarget,
  generalizeTargetText,
  looksTaskSpecificName,
  normalizeDraft,
  upsertAutomationMetadata,
  uniqueManagedSkillId,
};
