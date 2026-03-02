import fs from 'fs';
import path from 'path';
import { getAgentContext } from './agent-context';
import type { StoredTask } from '../store/taskHistory';
import { generateTaskSummary } from './summarizer';

const MEMORY_DIR = 'memory';
const LONG_TERM_FILE = 'MEMORY.md';
const SESSION_LOG_DIR = path.join('.opendeskmate', 'sessions');
const MEMORY_FLUSH_SYSTEM_PROMPT =
  'Session nearing compaction. Before responding, store durable user context into memory files if needed.';
const MEMORY_FLUSH_USER_PROMPT =
  'Write lasting notes to MEMORY.md and/or memory/YYYY-MM-DD.md using memory_write. If nothing to store, skip the write and continue with the response.';

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
  const longTermPath = path.join(workspaceRoot, LONG_TERM_FILE);
  const sessionDir = path.join(workspaceRoot, SESSION_LOG_DIR);
  return { workspaceRoot, memoryDir, longTermPath, sessionDir };
}

export function getMemoryState(agentId?: string, date?: string) {
  const { workspaceRoot, memoryDir, longTermPath } = resolvePaths(agentId);
  ensureDir(memoryDir);
  const today = date || formatLocalDate(new Date());
  const dailyPath = path.join(memoryDir, `${today}.md`);
  const dailyFiles = listDailyFiles(memoryDir);
  return {
    workspaceRoot,
    longTerm: { path: longTermPath, content: readTextIfExists(longTermPath) },
    daily: { date: today, path: dailyPath, content: readTextIfExists(dailyPath) },
    dailyFiles,
  };
}

export function readMemoryFile(kind: 'long-term' | 'daily', date?: string, agentId?: string) {
  const { memoryDir, longTermPath } = resolvePaths(agentId);
  ensureDir(memoryDir);
  if (kind === 'long-term') {
    return { path: longTermPath, content: readTextIfExists(longTermPath) };
  }
  const effectiveDate = date || formatLocalDate(new Date());
  const dailyPath = path.join(memoryDir, `${effectiveDate}.md`);
  return { path: dailyPath, date: effectiveDate, content: readTextIfExists(dailyPath) };
}

export function saveMemoryFile(
  kind: 'long-term' | 'daily',
  content: string,
  date?: string,
  agentId?: string
) {
  const { memoryDir, longTermPath } = resolvePaths(agentId);
  ensureDir(memoryDir);
  if (kind === 'long-term') {
    fs.writeFileSync(longTermPath, content ?? '', 'utf-8');
    return { path: longTermPath };
  }
  const effectiveDate = date || formatLocalDate(new Date());
  const dailyPath = path.join(memoryDir, `${effectiveDate}.md`);
  fs.writeFileSync(dailyPath, content ?? '', 'utf-8');
  return { path: dailyPath, date: effectiveDate };
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
  const longTerm = truncate(state.longTerm.content.trim(), 4000);
  const todayContent = truncate(readTextIfExists(state.daily.path).trim(), 2500);
  const yesterdayPath = path.join(path.dirname(state.daily.path), `${yesterday}.md`);
  const yesterdayContent = truncate(readTextIfExists(yesterdayPath).trim(), 2500);
  const recentSnapshots = listRecentSnapshotFiles(path.dirname(state.daily.path), recentDates, 20);

  const blocks: string[] = [];
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
    'User memory (from workspace files):',
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
  const filename = `${dateStr}-${slug}.md`;
  const memoryFilePath = ensureUniquePath(path.join(memoryDir, filename));

  let sessionContent =
    (task.sessionFilePath && getRecentSessionContentFromFile(task.sessionFilePath)) || null;
  if (!sessionContent) {
    sessionContent = buildSessionTranscript(task);
  }

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

  const finalFilename = `${dateStr}-${slug}.md`;
  const finalPath = ensureUniquePath(path.join(memoryDir, finalFilename));

  const entryParts = [
    `# Session: ${dateStr} ${timeStr} UTC`,
    '',
    `- **Task ID**: ${task.id}`,
    `- **Session ID**: ${task.sessionId || 'unknown'}`,
    `- **Status**: ${task.status}`,
    `- **Source**: ${source}`,
    '',
  ];

  if (task.prompt) {
    entryParts.push('## Prompt', '', task.prompt, '');
  }

  if (sessionContent) {
    entryParts.push('## Conversation Summary', '', sessionContent, '');
  }

  fs.writeFileSync(finalPath, entryParts.join('\n'), 'utf-8');
  return finalPath;
}
