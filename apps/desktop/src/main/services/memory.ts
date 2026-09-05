import fs from 'fs';
import path from 'path';
import type { ProviderType, SelectedModel } from '@accomplish/shared';
import { getOllamaConfig } from '../store/appSettings';
import { getApiKey } from '../store/secureStorage';
import { getAgentContext, resolveSelectedModelForAgent } from './agent-context';
import type { StoredTask } from '../store/taskHistory';
import { generateTaskSummary } from './summarizer';
import { getModelProvider } from './model-providers';
import { buildOpenAICompatibleChatCompletionsUrl } from './openai-compatible';
import {
  applyStagedMemoryChange,
  getMemoryChangeHistory,
  listMemoryChangeHistory as listStoredMemoryChangeHistory,
  recordMemoryChange,
  rollbackMemoryChange,
  type MemoryChangeHistoryFilter,
  type MemoryChangePreview,
  type MemoryChangeRecord,
  type MemoryChangeStatus,
} from '../store/memoryChangeHistory';

const MEMORY_DIR = 'memory';
const USER_FILE = 'USER.md';
const LONG_TERM_FILE = 'MEMORY.md';
const SESSION_LOG_DIR = path.join('.opendeskmate', 'sessions');
const MEMORY_FLUSH_SYSTEM_PROMPT =
  'Session nearing compaction. Before responding, store durable user context into memory files if needed.';
const MEMORY_FLUSH_USER_PROMPT =
  'Write lasting notes to USER.md, MEMORY.md, and/or memory/YYYY-MM-DD.md using memory_write. If nothing to store, skip the write and continue with the response.';
const AUTOMATIC_MEMORY_TIMEOUT_MS = 9000;
const AUTOMATIC_MEMORY_TRANSCRIPT_LIMIT = 12000;
const AUTOMATIC_MEMORY_ITEM_LIMIT = 6;

const AUTOMATIC_MEMORY_SYSTEM_PROMPT = [
  'You are Open Deskmate Memory Curator.',
  'Extract only durable, useful memory from a completed task.',
  'Return strict JSON only, no markdown and no code fences.',
  '',
  'Return this exact shape:',
  '{ "user": ["..."], "longTerm": ["..."], "daily": ["..."] }',
  '',
  'Memory destinations:',
  '- user: stable facts about the user, their preferences, communication style, recurring clients, or standing instructions.',
  '- longTerm: durable project/workspace/product facts likely useful in future tasks.',
  '- daily: short-lived working context from this task that may help later today.',
  '',
  'Rules:',
  '- If there is no useful durable memory, return empty arrays.',
  '- Do not store secrets, API keys, tokens, passwords, private raw logs, or full transcripts.',
  '- Do not store one-off tool output, generic advice, or facts that are only useful inside this completed task.',
  '- Keep each item one short sentence, under 220 characters.',
  '- Maximum 3 user items, 3 longTerm items, and 3 daily items.',
].join('\n');

export type MemoryFileKind = 'user' | 'long-term' | 'daily' | 'snapshot';
export type MemoryWriteMode = 'append' | 'replace';

export interface MemoryEntrySummary {
  id: string;
  kind: MemoryFileKind;
  label: string;
  path: string;
  relativePath: string;
  exists: boolean;
  bytes: number;
  updatedAt?: string;
  date?: string;
  fileName?: string;
  taskId?: string;
  sessionId?: string;
  source?: string;
  excerpt: string;
}

export interface MemorySearchResult extends MemoryEntrySummary {
  lineNumber?: number;
  matchExcerpt: string;
}

export interface MemoryWriteOptions {
  kind: MemoryFileKind;
  content: string;
  mode?: MemoryWriteMode;
  date?: string;
  fileName?: string;
  agentId?: string;
  source?: string;
  taskId?: string;
  reason?: string;
}

export interface MemoryWriteResult {
  path: string;
  date?: string;
  changeId: string;
  status: MemoryChangeStatus;
  preview: MemoryChangePreview;
}

export interface AutomaticMemoryLearningResult {
  ok: boolean;
  mode: 'automatic' | 'approval' | 'off';
  changes: MemoryWriteResult[];
  skippedReason?: string;
  error?: string;
}

interface MemoryTarget {
  workspaceRoot: string;
  path: string;
  date?: string;
  fileName?: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date: Date, delta: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? formatLocalDate(date);
}

function formatUtcTime(date: Date): string {
  return (date.toISOString().split('T')[1] ?? '').split('.')[0] ?? '';
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readTextIfExists(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function fileUpdatedAt(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function listDailyFiles(memoryDir: string): string[] {
  try {
    if (!fs.existsSync(memoryDir)) return [];
    return fs
      .readdirSync(memoryDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .map((name) => name.replace(/\.md$/, ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function listRecentSnapshotFiles(memoryDir: string, dates: string[], limit = 8): string[] {
  try {
    if (!fs.existsSync(memoryDir)) return [];
    const prefixes = new Set(dates.map((d) => `${d}-`));
    return fs
      .readdirSync(memoryDir)
      .filter((name) => name.endsWith('.md'))
      .filter((name) => {
        // Exclude canonical daily files (YYYY-MM-DD.md); those are handled separately.
        if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return false;
        return Array.from(prefixes).some((prefix) => name.startsWith(prefix));
      })
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

function isDailyMemoryFileName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(name);
}

function isSnapshotMemoryFileName(name: string): boolean {
  return name.endsWith('.md') && !isDailyMemoryFileName(name);
}

function listSnapshotFiles(memoryDir: string): string[] {
  try {
    if (!fs.existsSync(memoryDir)) return [];
    return fs
      .readdirSync(memoryDir)
      .filter(isSnapshotMemoryFileName)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function sanitizeSnapshotFileName(fileName: unknown): string {
  const name = path.basename(String(fileName || '').trim());
  if (!name || !isSnapshotMemoryFileName(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid memory snapshot filename');
  }
  return name;
}

function parseSnapshotMetadata(content: string): Pick<MemoryEntrySummary, 'taskId' | 'sessionId' | 'source'> {
  const taskId = content.match(/^\s*-\s*\*\*Task ID\*\*:\s*(.+)$/m)?.[1]?.trim();
  const sessionId = content.match(/^\s*-\s*\*\*Session ID\*\*:\s*(.+)$/m)?.[1]?.trim();
  const source = content.match(/^\s*-\s*\*\*Source\*\*:\s*(.+)$/m)?.[1]?.trim();
  return {
    taskId: taskId && taskId !== 'unknown' ? taskId : undefined,
    sessionId: sessionId && sessionId !== 'unknown' ? sessionId : undefined,
    source: source || undefined,
  };
}

function createExcerpt(content: string, limit = 500): string {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n\n[Excerpt truncated]`;
}

function createMemoryEntrySummary(input: {
  workspaceRoot: string;
  kind: MemoryFileKind;
  label: string;
  filePath: string;
  date?: string;
  fileName?: string;
  content?: string;
}): MemoryEntrySummary {
  const exists = fs.existsSync(input.filePath);
  const content = input.content ?? (exists ? readTextIfExists(input.filePath) : '');
  const metadata = input.kind === 'snapshot' ? parseSnapshotMetadata(content) : {};
  return {
    id: input.kind === 'daily'
      ? `daily:${input.date || path.basename(input.filePath, '.md')}`
      : input.kind === 'snapshot'
        ? `snapshot:${input.fileName || path.basename(input.filePath)}`
        : input.kind,
    kind: input.kind,
    label: input.label,
    path: input.filePath,
    relativePath: path.relative(input.workspaceRoot, input.filePath),
    exists,
    bytes: Buffer.byteLength(content, 'utf-8'),
    updatedAt: fileUpdatedAt(input.filePath),
    date: input.date,
    fileName: input.fileName,
    excerpt: createExcerpt(content),
    ...metadata,
  };
}

function resolveWorkspaceRoot(agentId?: string): string {
  const ctx = getAgentContext(agentId);
  const root = ctx.workspaceRoot;
  if (!root) {
    throw new Error('Workspace root is not configured');
  }
  return root;
}

function resolvePaths(agentId?: string) {
  const workspaceRoot = resolveWorkspaceRoot(agentId);
  const memoryDir = path.join(workspaceRoot, MEMORY_DIR);
  const userPath = path.join(workspaceRoot, USER_FILE);
  const longTermPath = path.join(workspaceRoot, LONG_TERM_FILE);
  const sessionDir = path.join(workspaceRoot, SESSION_LOG_DIR);
  return { workspaceRoot, memoryDir, userPath, longTermPath, sessionDir };
}

export function getMemoryState(agentId?: string, date?: string) {
  const { workspaceRoot, memoryDir, userPath, longTermPath } = resolvePaths(agentId);
  ensureDir(memoryDir);
  const today = date || formatLocalDate(new Date());
  const dailyPath = path.join(memoryDir, `${today}.md`);
  const dailyFiles = listDailyFiles(memoryDir);
  const dailyEntries = dailyFiles.map((dailyDate) => createMemoryEntrySummary({
    workspaceRoot,
    kind: 'daily',
    label: `Daily memory ${dailyDate}`,
    filePath: path.join(memoryDir, `${dailyDate}.md`),
    date: dailyDate,
  }));
  const snapshots = listSnapshotFiles(memoryDir).map((fileName) => createMemoryEntrySummary({
    workspaceRoot,
    kind: 'snapshot',
    label: fileName.replace(/\.md$/, ''),
    filePath: path.join(memoryDir, fileName),
    fileName,
  }));
  return {
    workspaceRoot,
    user: { path: userPath, content: readTextIfExists(userPath) },
    longTerm: { path: longTermPath, content: readTextIfExists(longTermPath) },
    daily: { date: today, path: dailyPath, content: readTextIfExists(dailyPath) },
    dailyFiles,
    snapshots,
    entries: [
      createMemoryEntrySummary({
        workspaceRoot,
        kind: 'user',
        label: 'USER.md',
        filePath: userPath,
      }),
      createMemoryEntrySummary({
        workspaceRoot,
        kind: 'long-term',
        label: 'MEMORY.md',
        filePath: longTermPath,
      }),
      ...dailyEntries,
      ...snapshots,
    ],
  };
}

export function readMemoryFile(kind: MemoryFileKind, date?: string, agentId?: string, fileName?: string) {
  const { memoryDir, userPath, longTermPath } = resolvePaths(agentId);
  ensureDir(memoryDir);
  if (kind === 'user') {
    return { path: userPath, content: readTextIfExists(userPath) };
  }
  if (kind === 'long-term') {
    return { path: longTermPath, content: readTextIfExists(longTermPath) };
  }
  if (kind === 'snapshot') {
    const safeFileName = sanitizeSnapshotFileName(fileName);
    const snapshotPath = path.join(memoryDir, safeFileName);
    return { path: snapshotPath, fileName: safeFileName, content: readTextIfExists(snapshotPath) };
  }
  const effectiveDate = date || formatLocalDate(new Date());
  const dailyPath = path.join(memoryDir, `${effectiveDate}.md`);
  return { path: dailyPath, date: effectiveDate, content: readTextIfExists(dailyPath) };
}

export function saveMemoryFile(
  kind: MemoryFileKind,
  content: string,
  date?: string,
  agentId?: string,
  fileName?: string
) {
  return writeMemoryFileWithHistory({
    kind,
    content,
    date,
    agentId,
    fileName,
    mode: 'replace',
    status: 'applied',
    source: 'manual',
  });
}

function resolveMemoryTarget(kind: MemoryFileKind, date?: string, agentId?: string): MemoryTarget {
  const { workspaceRoot, memoryDir, userPath, longTermPath } = resolvePaths(agentId);
  ensureDir(memoryDir);
  if (kind === 'user') {
    return { workspaceRoot, path: userPath };
  }
  if (kind === 'long-term') {
    return { workspaceRoot, path: longTermPath };
  }
  if (kind === 'snapshot') {
    throw new Error('Snapshot memory writes require a filename');
  }
  const effectiveDate = date || formatLocalDate(new Date());
  const dailyPath = path.join(memoryDir, `${effectiveDate}.md`);
  return { workspaceRoot, path: dailyPath, date: effectiveDate };
}

function resolveMemoryTargetFromOptions(options: Pick<MemoryWriteOptions, 'kind' | 'date' | 'agentId' | 'fileName'>): MemoryTarget {
  if (options.kind !== 'snapshot') {
    return resolveMemoryTarget(options.kind, options.date, options.agentId);
  }
  const { workspaceRoot, memoryDir } = resolvePaths(options.agentId);
  ensureDir(memoryDir);
  const fileName = sanitizeSnapshotFileName(options.fileName);
  return {
    workspaceRoot,
    path: path.join(memoryDir, fileName),
    fileName,
  };
}

function applyWriteMode(beforeContent: string, content: string, mode: MemoryWriteMode): string {
  if (mode !== 'append') return content;
  const normalized = beforeContent.replace(/\s*$/, '');
  if (!normalized) return content;
  return `${normalized}\n\n${content}`;
}

function redactSensitiveText(input: string): string {
  return String(input || '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[private key redacted]')
    .replace(/\b(password|passcode|secret|api[_ -]?key|token|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[api key redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, '[token redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[token redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[api key redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, 'Bearer [token redacted]')
    .replace(/^(\s*(?:[-*]\s*)?[\w.-]*(?:password|passcode|secret|api[_ -]?key|token|credential)[\w.-]*\s*[:=]\s*)(.+)$/gim, '$1[redacted]');
}

function stripTranscriptRolePrefix(line: string): string {
  return line.replace(/^\s*(?:user|assistant|system|tool)\s*:\s*/i, '');
}

function removeRawMemoryLogPayloads(input: string): string {
  return input
    .replace(/data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+/gi, '[image data removed]')
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, '[base64 data removed]')
    .split('\n')
    .filter((line) => !/^\s*(?:trace|debug|verbose)\b[:\s-]/i.test(stripTranscriptRolePrefix(line)))
    .filter((line) => !/^\s*(?:[-*]\s*)?(?:raw\s+)?(?:request|response|payload|transcript|stdout|stderr|log)\b\s*[:=-]/i.test(stripTranscriptRolePrefix(line)))
    .filter((line) => !/^\s*(?:\[[^\]]+\]\s*)?(?:info|warn|warning|error|debug|trace|verbose)\b\s*[:|-]/i.test(stripTranscriptRolePrefix(line)))
    .filter((line) => !/^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s+(?:info|warn|warning|error|debug|trace|verbose)\b/i.test(stripTranscriptRolePrefix(line)))
    .filter((line) => !/^\s*\{.*"(?:level|severity)"\s*:\s*"(?:debug|trace|verbose|info|warn|warning|error)".*\}\s*$/i.test(stripTranscriptRolePrefix(line)))
    .filter((line) => !/^\s+at\s+.+:\d+:\d+\)?\s*$/.test(stripTranscriptRolePrefix(line)))
    .join('\n');
}

function sanitizeMemoryWriteContent(content: string): string {
  return removeRawMemoryLogPayloads(redactSensitiveText(content)).trim();
}

export function sanitizeMemorySourceText(content: string, limit = AUTOMATIC_MEMORY_TRANSCRIPT_LIMIT): string {
  const sanitized = sanitizeMemoryWriteContent(String(content || '').replace(/\r\n/g, '\n'));
  if (sanitized.length <= limit) return sanitized;
  return sanitized.slice(-limit);
}

function shouldSanitizeMemoryWrite(options: MemoryWriteOptions & { status: Exclude<MemoryChangeStatus, 'reverted'> }): boolean {
  if (options.source === 'manual') return false;
  return options.status === 'automatic' || options.status === 'staged' || options.source === 'task_completion';
}

function writeMemoryFileWithHistory(
  options: MemoryWriteOptions & { status: Exclude<MemoryChangeStatus, 'reverted'> }
): MemoryWriteResult {
  const mode = options.mode ?? 'replace';
  const target = resolveMemoryTargetFromOptions(options);
  const beforeExists = fs.existsSync(target.path);
  const beforeContent = beforeExists ? fs.readFileSync(target.path, 'utf-8') : '';
  const nextContent = shouldSanitizeMemoryWrite(options)
    ? sanitizeMemoryWriteContent(options.content ?? '')
    : (options.content ?? '');
  const afterContent = applyWriteMode(beforeContent, nextContent, mode);
  const relativePath = path.relative(target.workspaceRoot, target.path);

  const change = recordMemoryChange({
    kind: options.kind,
    mode,
    status: options.status,
    filePath: target.path,
    relativePath,
    date: target.date,
    agentId: options.agentId,
    source: options.source,
    taskId: options.taskId,
    reason: options.reason,
    beforeExists,
    beforeContent,
    afterExists: true,
    afterContent,
  });

  if (options.status !== 'staged') {
    fs.writeFileSync(target.path, afterContent, 'utf-8');
  }

  return {
    path: target.path,
    date: target.date,
    changeId: change.id,
    status: change.status,
    preview: change.preview,
  };
}

export function saveAutomaticMemoryFileWrite(options: MemoryWriteOptions): MemoryWriteResult {
  return writeMemoryFileWithHistory({
    ...options,
    status: 'automatic',
    source: options.source || 'automatic',
  });
}

export function stageMemoryFileWrite(options: MemoryWriteOptions): MemoryWriteResult {
  return writeMemoryFileWithHistory({
    ...options,
    status: 'staged',
    source: options.source || 'staged',
  });
}

export function applyStagedMemoryFileWrite(
  changeId: string,
  options?: { allowDirty?: boolean }
): MemoryChangeRecord {
  return applyStagedMemoryChange(changeId, options);
}

export function rollbackMemoryFileChange(
  changeId: string,
  options?: { allowDirty?: boolean }
): MemoryChangeRecord {
  return rollbackMemoryChange(changeId, options);
}

export function listMemoryChangeHistory(filter?: number | MemoryChangeHistoryFilter): MemoryChangeRecord[] {
  if (typeof filter === 'number' || filter === undefined) {
    return getMemoryChangeHistory(filter);
  }
  return listStoredMemoryChangeHistory(filter);
}

export function deleteMemoryFile(options: {
  kind: MemoryFileKind;
  date?: string;
  fileName?: string;
  agentId?: string;
  source?: string;
  reason?: string;
}): MemoryWriteResult {
  const target = resolveMemoryTargetFromOptions({
    kind: options.kind,
    date: options.date,
    agentId: options.agentId,
    fileName: options.fileName,
  });
  const beforeExists = fs.existsSync(target.path);
  const beforeContent = beforeExists ? fs.readFileSync(target.path, 'utf-8') : '';
  if (!beforeExists) {
    throw new Error('Memory file does not exist');
  }
  const relativePath = path.relative(target.workspaceRoot, target.path);
  const change = recordMemoryChange({
    kind: options.kind,
    mode: 'replace',
    status: 'applied',
    filePath: target.path,
    relativePath,
    date: target.date,
    agentId: options.agentId,
    source: options.source || 'manual_delete',
    reason: options.reason || 'Deleted from Memory Manager',
    beforeExists,
    beforeContent,
    afterExists: false,
    afterContent: '',
  });
  fs.unlinkSync(target.path);
  return {
    path: target.path,
    date: target.date,
    changeId: change.id,
    status: change.status,
    preview: change.preview,
  };
}

export function searchMemory(params: {
  query: string;
  agentId?: string;
  limit?: number;
}): { results: MemorySearchResult[] } {
  const query = String(params.query || '').trim().toLowerCase();
  if (!query) return { results: [] };

  const state = getMemoryState(params.agentId);
  const limit = Math.max(1, Math.min(100, params.limit ?? 50));
  const results: MemorySearchResult[] = [];
  for (const entry of state.entries as MemoryEntrySummary[]) {
    if (!entry.exists) continue;
    const content = readTextIfExists(entry.path);
    const haystack = `${entry.label}\n${entry.relativePath}\n${content}`.toLowerCase();
    if (!haystack.includes(query)) continue;

    const lines = content.split(/\r?\n/);
    let lineNumber: number | undefined;
    let matchExcerpt = entry.excerpt;
    const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(query));
    if (lineIndex >= 0) {
      lineNumber = lineIndex + 1;
      const start = Math.max(0, lineIndex - 1);
      const end = Math.min(lines.length, lineIndex + 2);
      matchExcerpt = createExcerpt(lines.slice(start, end).join('\n'), 360);
    }

    results.push({
      ...entry,
      lineNumber,
      matchExcerpt,
    });
    if (results.length >= limit) break;
  }
  return { results };
}

export async function runAutomaticMemoryLearning(params: {
  task: StoredTask;
  agentId?: string;
  source?: string;
}): Promise<AutomaticMemoryLearningResult> {
  const { task } = params;
  const agentContext = getAgentContext(params.agentId ?? task.agentId);
  const mode = agentContext.agent.memoryWriteMode === 'approval'
    ? 'approval'
    : agentContext.agent.memoryWriteMode === 'off'
      ? 'off'
      : 'automatic';

  if (mode === 'off') {
    return { ok: true, mode, changes: [], skippedReason: 'Memory learning is off.' };
  }
  if (!task || task.status !== 'completed') {
    return { ok: true, mode, changes: [], skippedReason: 'Task did not complete successfully.' };
  }
  if (task.privacyMode === 'incognito') {
    return { ok: true, mode, changes: [], skippedReason: 'Incognito task.' };
  }
  if (task.hiddenFromHistory) {
    return { ok: true, mode, changes: [], skippedReason: 'Hidden helper task.' };
  }

  const selectedModel = resolveSelectedModelForAgent(agentContext.agentId);
  if (!selectedModel) {
    return { ok: true, mode, changes: [], skippedReason: 'No selected model for memory learning.' };
  }

  try {
    const userText = buildAutomaticMemoryLearningPrompt(task);
    const responseText = await callAutomaticMemoryModel(selectedModel, userText);
    const parsed = extractJsonObject(responseText);
    if (!parsed) {
      return { ok: true, mode, changes: [], skippedReason: 'Memory model did not return JSON.' };
    }

    const userItems = normalizeMemoryItems(parsed.user).slice(0, 3);
    const longTermItems = normalizeMemoryItems(parsed.longTerm).slice(0, 3);
    const dailyItems = normalizeMemoryItems(parsed.daily).slice(0, 3);
    const writes: Array<{ kind: MemoryFileKind; items: string[] }> = [
      { kind: 'user', items: userItems },
      { kind: 'long-term', items: longTermItems },
      { kind: 'daily', items: dailyItems },
    ];
    const changes: MemoryWriteResult[] = [];
    const writer = mode === 'approval' ? stageMemoryFileWrite : saveAutomaticMemoryFileWrite;

    for (const write of writes) {
      if (!write.items.length) continue;
      const content = write.items.map((item) => `- ${item}`).join('\n');
      changes.push(writer({
        kind: write.kind,
        content,
        mode: 'append',
        agentId: agentContext.agentId,
        taskId: task.id,
        source: params.source || 'task_completion',
        reason: 'Post-task automatic memory learning',
      }));
    }

    if (!changes.length) {
      return { ok: true, mode, changes: [], skippedReason: 'No durable memory found.' };
    }

    return { ok: true, mode, changes };
  } catch (error) {
    return {
      ok: false,
      mode,
      changes: [],
      error: (error as Error)?.message || 'Automatic memory learning failed.',
    };
  }
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[Truncated…]`;
}

function slugify(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4);
  return words.join('-').slice(0, 32);
}

function pickSessionSlug(task: StoredTask): string {
  const base = task.summary || task.prompt || '';
  const slug = slugify(base);
  if (slug) return slug;
  const fallback = formatUtcTime(new Date());
  return fallback.replace(/:/g, '').slice(0, 4) || 'session';
}

function buildSessionTranscript(task: StoredTask, limit = 15): string {
  const messages = task.messages ?? [];
  const relevant = messages.filter((m) => m.type === 'user' || m.type === 'assistant');
  const recent = relevant.slice(-limit);
  return recent.map((m) => `${m.type}: ${m.content}`).join('\n');
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.find((c) => typeof c?.text === 'string')?.text;
    return typeof text === 'string' ? text : null;
  }
  return null;
}

function getRecentSessionContentFromFile(sessionFilePath: string, limit = 15): string | null {
  try {
    if (!fs.existsSync(sessionFilePath)) return null;
    const raw = fs.readFileSync(sessionFilePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const collected: string[] = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (collected.length >= limit) break;
      try {
        const entry = JSON.parse(lines[i] as string);
        if (entry?.type !== 'message' || !entry.message) continue;
        const role = entry.message.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const content = normalizeMessageContent(entry.message.content);
        if (!content || content.startsWith('/')) continue;
        collected.push(`${role}: ${content}`);
      } catch {
        continue;
      }
    }
    return collected.reverse().join('\n');
  } catch {
    return null;
  }
}

function modelIdFromSelectedModel(selectedModel: SelectedModel): string {
  const raw = selectedModel.model || '';
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : raw;
}

function truncateForMemoryLearning(text: string): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (normalized.length <= AUTOMATIC_MEMORY_TRANSCRIPT_LIMIT) return normalized;
  return normalized.slice(-AUTOMATIC_MEMORY_TRANSCRIPT_LIMIT);
}

function isSensitiveMemoryItem(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(password|passcode|secret|api\s*key|token|bearer|private\s+key|credential)\b/i.test(text)) {
    return true;
  }
  if (/\b(sk-[a-z0-9_-]{16,}|xox[baprs]-[a-z0-9-]{12,}|gh[pousr]_[a-z0-9_]{20,})\b/i.test(text)) {
    return true;
  }
  if (lower.includes('-----begin') && lower.includes('private key')) {
    return true;
  }
  return false;
}

function normalizeMemoryItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const text = String(item || '')
      .replace(/\s+/g, ' ')
      .replace(/^[-*\d.)\s]+/, '')
      .trim();
    if (!text || text.length < 8 || text.length > 260) continue;
    if (isSensitiveMemoryItem(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= AUTOMATIC_MEMORY_ITEM_LIMIT) break;
  }
  return output;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const ch = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(raw.slice(start, index + 1));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : null;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTOMATIC_MEMORY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callAutomaticMemoryModel(
  selectedModel: SelectedModel,
  userText: string
): Promise<string> {
  const provider = selectedModel.provider as ProviderType;
  const model = modelIdFromSelectedModel(selectedModel);
  const providerConfig = getModelProvider(provider);
  const apiKey = provider === 'ollama' ? null : await getApiKey(provider);

  if (!apiKey && provider !== 'ollama' && providerConfig?.requiresApiKey !== false) {
    throw new Error(`No API key configured for ${provider}.`);
  }

  if (provider === 'anthropic') {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        system: AUTOMATIC_MEMORY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((part) => part.type === 'text')?.text ?? data.content?.[0]?.text ?? '';
  }

  if (provider === 'google') {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${AUTOMATIC_MEMORY_SYSTEM_PROMPT}\n\n${userText}` }],
            },
          ],
          generationConfig: { maxOutputTokens: 700, responseMimeType: 'application/json' },
        }),
      }
    );
    if (!response.ok) throw new Error(`Google API error: ${response.status}`);
    const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  const baseUrl = provider === 'openai'
    ? 'https://api.openai.com'
    : provider === 'xai'
      ? 'https://api.x.ai'
      : provider === 'ollama'
        ? (selectedModel.baseUrl || getOllamaConfig()?.baseUrl || 'http://localhost:11434')
        : providerConfig?.baseUrl;
  if (!baseUrl) {
    throw new Error(`Provider base URL is missing for ${provider}.`);
  }

  const response = await fetchWithTimeout(buildOpenAICompatibleChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AUTOMATIC_MEMORY_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Provider API error: ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

function buildAutomaticMemoryLearningPrompt(task: StoredTask): string {
  const transcript = truncateForMemoryLearning(
    (task.sessionFilePath && getRecentSessionContentFromFile(task.sessionFilePath, 24))
    || buildSessionTranscript(task, 24)
  );
  const safeTranscript = sanitizeMemorySourceText(transcript);
  return [
    'Completed task metadata:',
    JSON.stringify({
      taskId: task.id,
      prompt: sanitizeMemorySourceText(task.prompt || task.summary || '', 2500),
      status: task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    }, null, 2),
    '',
    'Recent user/assistant transcript:',
    safeTranscript || '(No transcript available.)',
    '',
    'Extract durable memory now. Return empty arrays when nothing should be remembered.',
  ].join('\n');
}

function ensureUniquePath(filePath: string): string {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let counter = 1;
  while (true) {
    const candidate = path.join(dir, `${base}-${counter}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

export function buildMemoryPrompt(agentId?: string): string {
  let state: ReturnType<typeof getMemoryState>;
  try {
    state = getMemoryState(agentId);
  } catch {
    return '';
  }

  const now = new Date();
  const today = formatLocalDate(now);
  const yesterday = formatLocalDate(addDays(now, -1));
  const recentDateSet = new Set<string>();
  for (let i = 0; i < 7; i += 1) {
    recentDateSet.add(formatLocalDate(addDays(now, -i)));
    recentDateSet.add(formatUtcDate(addDays(now, -i)));
  }
  const recentDates = Array.from(recentDateSet);
  const userMemory = truncate(state.user.content.trim(), 4000);
  const longTerm = truncate(state.longTerm.content.trim(), 4000);
  const todayContent = truncate(readTextIfExists(state.daily.path).trim(), 2500);
  const yesterdayPath = path.join(path.dirname(state.daily.path), `${yesterday}.md`);
  const yesterdayContent = truncate(readTextIfExists(yesterdayPath).trim(), 2500);
  const recentSnapshots = listRecentSnapshotFiles(path.dirname(state.daily.path), recentDates, 20);

  const blocks: string[] = [];
  if (userMemory) {
    blocks.push(`USER.md\n${userMemory}`);
  }
  if (longTerm) {
    blocks.push(`MEMORY.md\n${longTerm}`);
  }
  if (todayContent) {
    blocks.push(`memory/${today}.md\n${todayContent}`);
  }
  if (yesterdayContent) {
    blocks.push(`memory/${yesterday}.md\n${yesterdayContent}`);
  }
  if (recentSnapshots.length > 0) {
    for (const fileName of recentSnapshots) {
      const filePath = path.join(path.dirname(state.daily.path), fileName);
      const content = truncate(readTextIfExists(filePath).trim(), 1500);
      if (!content) continue;
      blocks.push(`memory/${fileName}\n${content}`);
    }
  }

  if (blocks.length === 0) return '';
  return [
    'User memory (from workspace files: USER.md, MEMORY.md, memory/YYYY-MM-DD.md):',
    'Use this as durable user context; if conflicts, prefer the latest info.',
    '',
    blocks.join('\n\n---\n\n'),
  ].join('\n');
}

export function buildMemoryFlushPrompt(): string {
  return [MEMORY_FLUSH_SYSTEM_PROMPT, MEMORY_FLUSH_USER_PROMPT].join('\n');
}

export function initSessionLog(agentId: string | undefined, taskId: string): string {
  const { sessionDir } = resolvePaths(agentId);
  ensureDir(sessionDir);
  const filePath = path.join(sessionDir, `${taskId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }
  return filePath;
}

export async function saveSessionMemorySnapshot(
  task: StoredTask,
  agentId?: string,
  source = 'desktop'
): Promise<string | null> {
  if (!task || !task.messages || task.messages.length === 0) return null;
  const { memoryDir } = resolvePaths(agentId);
  ensureDir(memoryDir);

  const now = new Date();
  const dateStr = formatUtcDate(now);
  const timeStr = formatUtcTime(now);
  let slug = pickSessionSlug(task);

  let sessionContent =
    (task.sessionFilePath && getRecentSessionContentFromFile(task.sessionFilePath)) || null;
  if (!sessionContent) {
    sessionContent = buildSessionTranscript(task);
  }
  sessionContent = sanitizeMemorySourceText(sessionContent || '', 8000);
  const safePrompt = sanitizeMemorySourceText(task.prompt || '', 4000);

  try {
    if (sessionContent) {
      const summary = await generateTaskSummary(sessionContent, agentId);
      const candidate = slugify(summary);
      if (candidate) {
        slug = candidate;
      }
    }
  } catch {
    // ignore LLM failures, keep slug fallback
  }

  const finalFilename = path.basename(ensureUniquePath(path.join(memoryDir, `${dateStr}-${slug}.md`)));

  const entryParts = [
    `# Session: ${dateStr} ${timeStr} UTC`,
    '',
    `- **Task ID**: ${task.id}`,
    `- **Session ID**: ${task.sessionId || 'unknown'}`,
    `- **Status**: ${task.status}`,
    `- **Source**: ${source}`,
    '',
  ];

  if (safePrompt) {
    entryParts.push('## Prompt', '', safePrompt, '');
  }

  if (sessionContent) {
    entryParts.push('## Conversation Notes', '', sessionContent, '');
  }

  const result = writeMemoryFileWithHistory({
    kind: 'snapshot',
    fileName: finalFilename,
    content: entryParts.join('\n'),
    mode: 'replace',
    status: 'automatic',
    agentId,
    taskId: task.id,
    source,
    reason: 'Saved session memory snapshot',
  });
  return result.path;
}
