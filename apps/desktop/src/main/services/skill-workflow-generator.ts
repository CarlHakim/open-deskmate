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

function skillNameTokens(value: string, includeActionWords = true): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !SKILL_NAME_STOP_WORDS.has(token))
    .filter((token) => includeActionWords || !SKILL_ACTION_WORDS.has(token));
}

function normalizedNameForComparison(value: string): string {
  return skillNameTokens(value, true).join(' ');
}

function firstMarkdownHeading(skillMd: string): string {
  const match = normalizeSkillMarkdownText(skillMd).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim().replace(/\s+#*$/, '') || '';
}

function looksTaskSpecificName(name: string, prompt: string): boolean {
  const normalizedName = normalizedNameForComparison(name);
  if (!normalizedName) return false;
  if (normalizedName === normalizedNameForComparison(titleFromText(prompt))) return true;

  const nameTokens = skillNameTokens(name, true);
  if (nameTokens.length === 0) return false;

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
  const description = reusableIdentity?.description ?? inferredDescription;
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
