import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Store from 'electron-store';

export type MemoryChangeKind = 'user' | 'long-term' | 'daily' | 'snapshot';
export type MemoryChangeMode = 'append' | 'replace';
export type MemoryChangeStatus = 'automatic' | 'staged' | 'applied' | 'reverted';

export interface MemoryChangeSnapshot {
  exists: boolean;
  content: string;
  sha256: string;
}

export interface MemoryChangePreview {
  file: string;
  kind: MemoryChangeKind;
  mode: MemoryChangeMode;
  beforeBytes: number;
  afterBytes: number;
  beforeExcerpt: string;
  afterExcerpt: string;
}

export interface MemoryChangeRecord {
  id: string;
  kind: MemoryChangeKind;
  mode: MemoryChangeMode;
  status: MemoryChangeStatus;
  filePath: string;
  relativePath?: string;
  date?: string;
  agentId?: string;
  source?: string;
  taskId?: string;
  reason?: string;
  before: MemoryChangeSnapshot;
  after: MemoryChangeSnapshot;
  preview: MemoryChangePreview;
  createdAt: string;
  appliedAt?: string;
  revertedAt?: string;
}

export interface MemoryChangeHistoryFilter {
  limit?: number;
  kind?: MemoryChangeKind | MemoryChangeKind[];
  status?: MemoryChangeStatus | MemoryChangeStatus[];
  agentId?: string;
  taskId?: string;
  source?: string | string[];
  includeReverted?: boolean;
  since?: string;
  until?: string;
}

interface MemoryChangeHistorySchema {
  changes: MemoryChangeRecord[];
  maxChanges: number;
}

export interface RecordMemoryChangeInput {
  kind: MemoryChangeKind;
  mode: MemoryChangeMode;
  status: Exclude<MemoryChangeStatus, 'reverted'>;
  filePath: string;
  relativePath?: string;
  date?: string;
  agentId?: string;
  source?: string;
  taskId?: string;
  reason?: string;
  beforeExists: boolean;
  beforeContent: string;
  afterExists: boolean;
  afterContent: string;
}

const PREVIEW_LIMIT = 900;

const memoryChangeHistoryStore = new Store<MemoryChangeHistorySchema>({
  name: 'memory-change-history',
  defaults: {
    changes: [],
    maxChanges: 200,
  },
});

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function createSnapshot(exists: boolean, content: string): MemoryChangeSnapshot {
  return {
    exists,
    content,
    sha256: hashContent(exists ? content : ''),
  };
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf-8');
}

function excerpt(content: string): string {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  if (normalized.length <= PREVIEW_LIMIT) return normalized;
  return `${normalized.slice(0, PREVIEW_LIMIT)}\n\n[Preview truncated]`;
}

function createPreview(input: {
  kind: MemoryChangeKind;
  mode: MemoryChangeMode;
  filePath: string;
  relativePath?: string;
  beforeContent: string;
  afterContent: string;
}): MemoryChangePreview {
  return {
    file: input.relativePath || input.filePath,
    kind: input.kind,
    mode: input.mode,
    beforeBytes: byteLength(input.beforeContent),
    afterBytes: byteLength(input.afterContent),
    beforeExcerpt: excerpt(input.beforeContent),
    afterExcerpt: excerpt(input.afterContent),
  };
}

function makeId(): string {
  return `mem_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function getStoredChanges(): MemoryChangeRecord[] {
  return memoryChangeHistoryStore.get('changes') ?? [];
}

function setStoredChanges(changes: MemoryChangeRecord[]): void {
  const maxChanges = memoryChangeHistoryStore.get('maxChanges') ?? 200;
  memoryChangeHistoryStore.set('changes', changes.slice(0, Math.max(1, maxChanges)));
}

function updateMemoryChange(id: string, updater: (record: MemoryChangeRecord) => MemoryChangeRecord): MemoryChangeRecord {
  const changes = getStoredChanges();
  const index = changes.findIndex((change) => change.id === id);
  if (index < 0) {
    throw new Error(`Memory change not found: ${id}`);
  }
  const next = updater(changes[index]);
  changes[index] = next;
  setStoredChanges(changes);
  return next;
}

function readCurrentSnapshot(filePath: string): MemoryChangeSnapshot {
  if (!fs.existsSync(filePath)) {
    return createSnapshot(false, '');
  }
  return createSnapshot(true, fs.readFileSync(filePath, 'utf-8'));
}

function snapshotsMatch(actual: MemoryChangeSnapshot, expected: MemoryChangeSnapshot): boolean {
  return actual.exists === expected.exists && actual.sha256 === expected.sha256;
}

function restoreSnapshot(filePath: string, snapshot: MemoryChangeSnapshot): void {
  if (snapshot.exists) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, snapshot.content, 'utf-8');
    return;
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function recordMemoryChange(input: RecordMemoryChangeInput): MemoryChangeRecord {
  const now = new Date().toISOString();
  const record: MemoryChangeRecord = {
    id: makeId(),
    kind: input.kind,
    mode: input.mode,
    status: input.status,
    filePath: input.filePath,
    relativePath: input.relativePath,
    date: input.date,
    agentId: input.agentId,
    source: input.source,
    taskId: input.taskId,
    reason: input.reason,
    before: createSnapshot(input.beforeExists, input.beforeContent),
    after: createSnapshot(input.afterExists, input.afterContent),
    preview: createPreview(input),
    createdAt: now,
    appliedAt: input.status === 'staged' ? undefined : now,
  };

  setStoredChanges([record, ...getStoredChanges()]);
  return record;
}

export function getMemoryChangeHistory(limit?: number): MemoryChangeRecord[] {
  const changes = getStoredChanges();
  if (limit === undefined) return changes;
  return changes.slice(0, Math.max(0, limit));
}

function normalizeSet<T extends string>(value?: T | T[]): Set<T> | null {
  if (value === undefined) return null;
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.filter((entry): entry is T => Boolean(entry));
  return normalized.length > 0 ? new Set(normalized) : null;
}

function matchesHistoryFilter(record: MemoryChangeRecord, filter: MemoryChangeHistoryFilter): boolean {
  const kinds = normalizeSet(filter.kind);
  if (kinds && !kinds.has(record.kind)) return false;

  const statuses = normalizeSet(filter.status);
  if (statuses && !statuses.has(record.status)) return false;

  const sources = normalizeSet(filter.source);
  if (sources && (!record.source || !sources.has(record.source))) return false;

  if (filter.includeReverted === false && record.status === 'reverted') return false;
  if (filter.agentId && record.agentId !== filter.agentId) return false;
  if (filter.taskId && record.taskId !== filter.taskId) return false;
  if (filter.since && record.createdAt < filter.since) return false;
  if (filter.until && record.createdAt > filter.until) return false;
  return true;
}

export function listMemoryChangeHistory(filter?: MemoryChangeHistoryFilter): MemoryChangeRecord[] {
  const filtered = filter
    ? getStoredChanges().filter((record) => matchesHistoryFilter(record, filter))
    : getStoredChanges();
  if (filter?.limit === undefined) return filtered;
  return filtered.slice(0, Math.max(0, filter.limit));
}

export function getMemoryChange(changeId: string): MemoryChangeRecord | null {
  return getStoredChanges().find((change) => change.id === changeId) ?? null;
}

export function applyStagedMemoryChange(
  changeId: string,
  options?: { allowDirty?: boolean }
): MemoryChangeRecord {
  return updateMemoryChange(changeId, (record) => {
    if (record.status !== 'staged') {
      throw new Error(`Memory change is not staged: ${changeId}`);
    }

    const current = readCurrentSnapshot(record.filePath);
    let before = record.before;
    if (!snapshotsMatch(current, record.before)) {
      if (!options?.allowDirty) {
        throw new Error(`Memory file changed since staging: ${record.filePath}`);
      }
      before = current;
    }

    restoreSnapshot(record.filePath, record.after);
    return {
      ...record,
      before,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    };
  });
}

export function rollbackMemoryChange(
  changeId: string,
  options?: { allowDirty?: boolean }
): MemoryChangeRecord {
  return updateMemoryChange(changeId, (record) => {
    if (record.status === 'reverted') return record;

    if (record.status !== 'staged') {
      const current = readCurrentSnapshot(record.filePath);
      if (!snapshotsMatch(current, record.after) && !options?.allowDirty) {
        throw new Error(`Memory file changed since memory change was applied: ${record.filePath}`);
      }
      restoreSnapshot(record.filePath, record.before);
    }

    return {
      ...record,
      status: 'reverted',
      revertedAt: new Date().toISOString(),
    };
  });
}

export function clearMemoryChangeHistory(): void {
  memoryChangeHistoryStore.set('changes', []);
}
