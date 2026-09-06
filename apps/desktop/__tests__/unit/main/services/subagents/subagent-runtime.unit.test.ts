import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SubagentRunRecord } from '@accomplish/shared';
const state = vi.hoisted(() => ({ runs: [] as SubagentRunRecord[], active: false, queued: false, parentStatus: 'completed', resume: vi.fn(), stop: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('@main/store/taskHistory', () => ({ getTask: () => ({ id: 'parent', sessionId: 'session', agentId: 'main', status: state.parentStatus, workingDirectory: 'workspace', buildMode: true, buildWorkspaceRelativePath: 'project', privacyMode: true }) }));
vi.mock('@main/store/agents', () => ({ getAgent: () => ({ subagentAutoRelayCompletions: true }) }));
vi.mock('@main/store/subagentRegistry', () => ({
  getSubagentRun: (id: string) => state.runs.find(run => run.runId === id),
  listSubagentRuns: (parent?: string) => state.runs.filter(run => !parent || run.parentTaskId === parent),
  patchSubagentRun: (id: string, patch: Partial<SubagentRunRecord>) => { const run = state.runs.find(run => run.runId === id)!; Object.assign(run, patch); return run; },
  onSubagentRegistryChange: () => () => {},
}));
vi.mock('@main/runtime/agent-engine', () => ({ hasActiveAgentEngineTask: () => state.active, isAgentEngineTaskQueued: () => state.queued, resumeAgentEngineTask: state.resume, stopAgentEngineTask: state.stop }));
vi.mock('@main/services/subagents/subagent-supervisor', () => ({ syncSubagentRunSupervisor: (id: string) => state.runs.find(run => run.runId === id) }));
import { consumeSubagentResults, startSubagentRuntime, wakeParentForSubagentRecovery } from '@main/services/subagents/subagent-runtime';

const child = (id: string) => ({ runId: id, parentTaskId: 'parent', parentAgentId: 'main', childTaskId: id, status: 'done', resultStatus: 'success', finalReport: 'Verified findings', resultDelivery: { state: 'ready', updatedAt: 'now' } } as SubagentRunRecord);
beforeEach(() => { state.runs = [child('one'), child('two')]; state.active = false; state.queued = false; state.parentStatus = 'completed'; state.resume.mockReset().mockResolvedValue({ completion: Promise.resolve({ status: 'success' }) }); state.stop.mockReset().mockResolvedValue('cancelled'); });
afterEach(() => vi.useRealTimers());

const stuck = (id: string) => ({ ...child(id), status: 'running', resultDelivery: undefined,
  supervisor: { state: 'stale', recommendedAction: 'recover_child', recoveryAttempts: 0 },
} as SubagentRunRecord);

it('wakes an idle parent for stuck siblings once, including after runtime restart', async () => {
  vi.useFakeTimers();
  state.runs = [stuck('one'), stuck('two')];
  let stop = startSubagentRuntime();
  try {
    await vi.advanceTimersByTimeAsync(15000);
    expect(state.resume).toHaveBeenCalledOnce();
    expect(state.resume.mock.calls[0][1]).toContain('subagent_replace');
    expect(state.resume.mock.calls[0][1]).toContain('one');
    expect(state.resume.mock.calls[0][1]).toContain('two');
    expect(state.resume.mock.calls[0][2]).toMatchObject({ options: { resume: {
      workingDirectory: 'workspace', buildMode: true, buildWorkspaceRelativePath: 'project', privacyMode: true,
    } } });
    stop();
    stop = startSubagentRuntime();
    await vi.advanceTimersByTimeAsync(10000);
    expect(state.resume).toHaveBeenCalledOnce();
  } finally { stop(); }
});

it('allows escalation after recovery but bounds wake-ups across replacement runs', async () => {
  state.runs = [stuck('one')];
  expect(await wakeParentForSubagentRecovery('parent')).toBe(true);
  state.runs[0].supervisor!.recommendedAction = 'replace_child';
  state.runs[0].supervisor!.recoveryAttempts = 2;
  expect(await wakeParentForSubagentRecovery('parent')).toBe(true);
  state.runs[0].supervisionWake!.attempts = 6;
  state.runs.push(stuck('replacement'));
  expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
  expect(state.resume).toHaveBeenCalledTimes(2);
});

it('does not interrupt an active parent or restart stopped work', async () => {
  state.runs = [stuck('one')];
  state.active = true;
  expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
  state.active = false;
  state.queued = true;
  expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
  state.queued = false;
  state.parentStatus = 'interrupted';
  expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
  state.parentStatus = 'completed';
  state.runs[0].limitReached = 'Spending limit reached';
  state.runs[0].executionPolicy = { limitAction: 'stop' } as SubagentRunRecord['executionPolicy'];
  expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
  expect(state.resume).not.toHaveBeenCalled();
});

it('respects disabled automatic relay and closed or archived runs', async () => {
  for (const patch of [{ executionPolicy: { autoRelayCompletions: false } }, { archivedAt: 'now' }, { closedAt: 'now' }, { replacedByRunId: 'new' }, { status: 'done' }]) {
    state.runs = [{ ...stuck('one'), ...patch } as SubagentRunRecord];
    expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
  }
  expect(state.resume).not.toHaveBeenCalled();
});

it('deduplicates concurrent wake-ups and retains failure without retrying', async () => {
  state.runs = [stuck('one')];
  state.resume.mockRejectedValue(new Error('Provider unavailable'));
  await Promise.all([wakeParentForSubagentRecovery('parent'), wakeParentForSubagentRecovery('parent'), consumeSubagentResults('parent', true)]);
  expect(state.resume).toHaveBeenCalledOnce();
  expect(state.runs[0].supervisionWake?.error).toContain('Provider unavailable');
  expect(await wakeParentForSubagentRecovery('parent')).toBe(false);
});

it('batches sibling results into one parent turn and does not deliver twice', async () => {
  await Promise.all([consumeSubagentResults('parent', true), consumeSubagentResults('parent', true)]);
  expect(state.resume).toHaveBeenCalledOnce();
  expect(state.resume.mock.calls[0][1]).toContain('Result one');
  expect(state.resume.mock.calls[0][1]).toContain('Result two');
  expect(state.runs.every(run => run.resultDelivery?.state === 'incorporated')).toBe(true);
  expect(await consumeSubagentResults('parent', true)).toBe(false);
});
it('does not interrupt active parents or automatically resume interrupted parents', async () => {
  state.active = true;
  expect(await consumeSubagentResults('parent', true)).toBe(false);
  state.active = false; state.parentStatus = 'interrupted';
  expect(await consumeSubagentResults('parent', true)).toBe(false);
  expect(state.resume).not.toHaveBeenCalled();
});
it('retains reports after failed delivery without an automatic retry loop', async () => {
  state.resume.mockRejectedValue(new Error('Provider unavailable'));
  expect(await consumeSubagentResults('parent', true)).toBe(false);
  expect(state.runs[0].resultDelivery).toMatchObject({ state: 'ready', error: 'Provider unavailable' });
  await consumeSubagentResults('parent', true);
  expect(state.resume).toHaveBeenCalledOnce();
});
it('enforces an opted-in limit once while the UI is closed', async () => {
  vi.useFakeTimers();
  state.runs = [{ ...child('one'), status: 'running', resultDelivery: undefined, supervisor: { state: 'timed_out' }, executionPolicy: { limitAction: 'stop' } as SubagentRunRecord['executionPolicy'] }];
  const stop = startSubagentRuntime();
  await vi.advanceTimersByTimeAsync(15000);
  expect(state.stop).toHaveBeenCalledOnce();
  expect(state.runs[0].limitReached).toContain('runtime');
  stop();
});
