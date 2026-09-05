import Store from 'electron-store';
import type { SubagentRunRecord } from '@accomplish/shared';

interface SubagentRegistrySchema {
  runs: Record<string, SubagentRunRecord>;
}

const MAX_SUBAGENT_RUNS = 2000;

const subagentRegistryStore = new Store<SubagentRegistrySchema>({
  name: 'subagent-registry',
  defaults: {
    runs: {},
  },
});

function readAll(): Record<string, SubagentRunRecord> {
  const current = subagentRegistryStore.get('runs');
  return current && typeof current === 'object' ? current : {};
}

function writeAll(next: Record<string, SubagentRunRecord>): void {
  const values = Object.values(next);
  if (values.length <= MAX_SUBAGENT_RUNS) {
    subagentRegistryStore.set('runs', next);
    return;
  }
  values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const kept = values.slice(0, MAX_SUBAGENT_RUNS);
  const compact: Record<string, SubagentRunRecord> = {};
  for (const entry of kept) compact[entry.runId] = entry;
  subagentRegistryStore.set('runs', compact);
}

export function registerSubagentRun(run: SubagentRunRecord): SubagentRunRecord {
  const all = readAll();
  all[run.runId] = run;
  writeAll(all);
  return run;
}

export function patchSubagentRun(
  runId: string,
  patch: Partial<SubagentRunRecord>
): SubagentRunRecord | undefined {
  const key = (runId ?? '').trim();
  if (!key) return undefined;
  const all = readAll();
  const existing = all[key];
  if (!existing) return undefined;
  const next: SubagentRunRecord = {
    ...existing,
    ...patch,
    runId: existing.runId,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  all[key] = next;
  writeAll(all);
  return next;
}

export function getSubagentRun(runId: string): SubagentRunRecord | undefined {
  const key = (runId ?? '').trim();
  if (!key) return undefined;
  return readAll()[key];
}

export function findSubagentRunByChildTaskId(childTaskId: string): SubagentRunRecord | undefined {
  const key = (childTaskId ?? '').trim();
  if (!key) return undefined;
  return Object.values(readAll()).find((entry) => entry.childTaskId === key);
}

export function listSubagentRuns(parentTaskId?: string, options?: { includeArchived?: boolean }): SubagentRunRecord[] {
  const all = Object.values(readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const filtered = options?.includeArchived ? all : all.filter((entry) => !entry.archivedAt);
  if (!parentTaskId) return filtered;
  return filtered.filter((entry) => entry.parentTaskId === parentTaskId);
}

export function countActiveSubagentRuns(parentTaskId: string): number {
  return listSubagentRuns(parentTaskId).filter((entry) => entry.status === 'accepted' || entry.status === 'running').length;
}
