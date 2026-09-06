import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SubagentRunRecord } from '@accomplish/shared';
const state = vi.hoisted(() => ({ run: {} as SubagentRunRecord, ancestors: {} as Record<string, SubagentRunRecord>, status: 'queued' }));
vi.mock('@main/store/taskHistory', () => ({ getTask: () => ({ status: state.status, messages: [], activity: [] }) }));
vi.mock('@main/store/tokenUsage', () => ({ getTaskCost: () => ({ costUsd: 0, costIncomplete: true }) }));
vi.mock('@main/store/subagentRegistry', () => ({ getSubagentRun: (id: string) => id === state.run.runId ? state.run : state.ancestors[id], listSubagentRuns: () => [state.run], patchSubagentRun: (_id: string, patch: Partial<SubagentRunRecord>) => (state.run = { ...state.run, ...patch }) }));
vi.mock('@main/runtime/task-runtime-messaging', () => ({ emitTaskActivityEvent: vi.fn() }));
vi.mock('@main/services/subagents/subagent-build-handoff', () => ({ formatBuildHandoffForPrompt: () => '' }));
vi.mock('@main/services/subagents/subagent-shared-context', () => ({ buildSubagentSharedContext: () => (state.run.sharedContext || { blockedSources: [], blockedTools: [], successfulFallbacks: [], confirmedFindings: [], openGaps: [] }), extractSubagentFailureSignals: () => ({}) }));
import { buildReplacementPrompt, syncSubagentRunSupervisor } from '@main/services/subagents/subagent-supervisor';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  state.status = 'queued';
  state.ancestors = {};
  state.run = { runId: 'one', status: 'accepted', lifecycle: 'queued', createdAt: '2026-09-05T10:00:00Z', updatedAt: '2026-09-05T10:00:00Z', executionPolicy: { runTimeoutMs: 15000 } } as SubagentRunRecord;
});
afterEach(() => vi.useRealTimers());

it('retains the assignment and failure evidence when the parent supplies replacement instructions', () => {
  state.run.task = 'Repair the export command';
  state.run.error = 'ENOENT: missing export-config.json';
  state.run.progressEvents = [{ id: 'failure', runId: 'one', timestamp: '2026-09-05T11:59:00Z',
    type: 'tool', status: 'error', toolName: 'shell', detail: 'npm run export exited 1', currentStep: 'Generate output' }];
  state.run.recoveryHistory = [{ id: 'retry', action: 'retry', status: 'failed', startedAt: 'now', error: 'Same config missing', notes: 'Retried from project root' }];
  state.run.expectedOutputs = [{ id: 'export', kind: 'file', label: 'Generated export', path: 'dist/export.json', required: true }];
  state.run.sharedContext = { parentTaskId: 'parent', generatedAt: 'now', blockedSources: [], blockedTools: ['unavailable-browser'], successfulFallbacks: ['Use the local CLI'], confirmedFindings: [], openGaps: ['Export has not been validated'] };
  state.run.worktree = { path: 'old-worktree', branch: 'codex/old-child', sourcePath: 'source', baseCommit: 'abc' };
  const prompt = buildReplacementPrompt(state.run, 'Repeated export failure', 'Inspect the configuration before retrying');
  for (const expected of ['Repair the export command', 'Repeated export failure', 'ENOENT: missing export-config.json',
    'npm run export exited 1', 'Same config missing', 'Retried from project root', 'dist/export.json',
    'unavailable-browser', 'Use the local CLI', 'Export has not been validated', 'old-worktree',
    'Inspect the configuration before retrying']) expect(prompt).toContain(expected);
  expect(prompt.indexOf('Additional instructions from the parent')).toBeGreaterThan(prompt.indexOf('Original task:'));
  expect(prompt).toContain('does not prove completion');
});

it('bounds diagnostic history and marks truncated recorded errors', () => {
  state.run.progressEvents = Array.from({ length: 30 }, (_, index) => ({
    id: String(index), runId: 'one', timestamp: new Date(Date.UTC(2026, 8, 5, 11, index)).toISOString(),
    type: 'blocked' as const, status: 'error' as const, title: `Failure number ${index}`,
    detail: 'X'.repeat(10000),
  }));
  const prompt = buildReplacementPrompt(state.run);
  expect(prompt).toContain('Failure number 29');
  expect(prompt).not.toContain('Failure number 0');
  expect(prompt).toContain('[truncated]');
  expect(prompt.length).toBeLessThanOrEqual(8000);
});

it('fits the complete dispatch budget while retaining every handoff section', () => {
  state.run.task = 'Original assignment ' + 'T'.repeat(10000);
  state.run.error = 'Exact error ' + 'E'.repeat(10000);
  state.run.finalReport = 'Partial findings ' + 'P'.repeat(20000);
  state.run.expectedOutputs = [{ id: 'out', kind: 'file', label: 'Required output', description: 'D'.repeat(10000) }];
  const ownershipLength = 1400;
  const prompt = buildReplacementPrompt(state.run, 'Failure reason', 'Custom instruction ' + 'I'.repeat(8000), 8000 - ownershipLength);
  expect(prompt.length + ownershipLength).toBeLessThanOrEqual(8000);
  for (const text of ['Original assignment', 'Exact error', 'Partial findings', 'Required output', 'Custom instruction', 'Failure reason']) expect(prompt).toContain(text);
});

it('uses the root assignment instead of recursively copying previous handoff prompts', () => {
  state.ancestors.root = { ...state.run, runId: 'root', task: 'Read the README' };
  state.ancestors.previous = { ...state.run, runId: 'previous', task: 'OLD HANDOFF '.repeat(2000), replacesRunId: 'root' };
  state.run.replacesRunId = 'previous';
  state.run.task = 'ANOTHER HANDOFF '.repeat(2000);
  const prompt = buildReplacementPrompt(state.run, undefined, 'Try the local file');
  expect(prompt).toContain('Read the README');
  expect(prompt).not.toContain('OLD HANDOFF');
  expect(prompt).not.toContain('ANOTHER HANDOFF');
  expect(prompt.length).toBeLessThanOrEqual(8000);
});

it('states when the previous run has no detailed failure record', () => {
  const prompt = buildReplacementPrompt(state.run);
  expect(prompt).toContain('No detailed failure events were captured');
  expect(prompt).toContain('No useful partial findings were captured');
  expect(prompt).not.toContain('Additional instructions from the parent');
});
it('excludes queue time from timeout and starts the runtime clock when dispatched', () => {
  expect(syncSubagentRunSupervisor('one')?.supervisor?.state).toBe('queued');
  expect(state.run.startedAt).toBeUndefined();
  state.status = 'running';
  syncSubagentRunSupervisor('one');
  expect(state.run.lifecycle).toBe('working');
  expect(state.run.startedAt).toBe('2026-09-05T12:00:00.000Z');
  expect(state.run.supervisor?.state).not.toBe('timed_out');
  vi.advanceTimersByTime(16000);
  expect(syncSubagentRunSupervisor('one')?.supervisor?.state).toBe('timed_out');
});
