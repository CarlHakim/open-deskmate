import { beforeEach, expect, it, vi } from 'vitest';
import type { SubagentRunRecord } from '@accomplish/shared';
const state = vi.hoisted(() => ({ runs: {} as Record<string, SubagentRunRecord>, spawn: vi.fn(), prompt: vi.fn() }));
vi.mock('@main/store/taskHistory', () => ({ getTask: () => undefined, updateTaskStatus: vi.fn() }));
vi.mock('@main/store/subagentRegistry', () => ({
  getSubagentRun: (id: string) => state.runs[id], listSubagentRuns: () => Object.values(state.runs),
  countActiveSubagentRuns: () => 0,
  patchSubagentRun: (id: string, patch: Partial<SubagentRunRecord>) => Object.assign(state.runs[id], patch),
}));
vi.mock('@main/store/gatewaySessions', () => ({ getGatewaySessionByTaskId: () => undefined, deleteGatewaySession: vi.fn() }));
vi.mock('@main/store/taskModelOverrides', () => ({ setTaskModelOverride: vi.fn() }));
vi.mock('@main/runtime/agent-engine', () => ({ stopAgentEngineTask: vi.fn().mockResolvedValue('none'), resumeAgentEngineTask: vi.fn(), resolveAgentEngineKnownSessionId: vi.fn() }));
vi.mock('@main/runtime/task-runtime-messaging', () => ({ emitTaskActivityEvent: vi.fn() }));
vi.mock('@main/services/subagents/subagent-spawn', () => ({ spawnSubagent: state.spawn, attachTrackedSubagentCompletion: vi.fn() }));
vi.mock('@main/services/subagents/subagent-supervisor', () => ({
  syncSubagentRunSupervisor: (id: string) => state.runs[id], buildReplacementPrompt: state.prompt,
  appendSubagentProgressEvent: vi.fn(), diagnoseSubagentRun: vi.fn(),
  recordSubagentRecoveryStarted: () => ({ recoveryId: 'recovery' }), recordSubagentRecoveryFinished: vi.fn(),
}));
vi.mock('@main/services/subagents/subagent-build-handoff', () => ({ generateSubagentBuildHandoffBundle: vi.fn().mockResolvedValue(undefined), formatBuildHandoffForPrompt: vi.fn() }));
vi.mock('@main/services/subagents/subagent-shared-context', () => ({ buildSubagentSharedContext: () => ({}), formatInheritedToolContextForPrompt: vi.fn(), formatSubagentSharedContextForPrompt: vi.fn() }));
import { recoverSubagentRun, replaceSubagentRun } from '@main/services/subagents/subagent-control';
beforeEach(() => {
  state.runs = { old: { runId: 'old', childTaskId: 'task', childAgentId: 'helper', parentTaskId: 'parent', status: 'running', task: 'Original work' } as SubagentRunRecord };
  state.prompt.mockReset().mockReturnValue('Mandatory handoff plus custom instruction');
  state.spawn.mockReset().mockImplementation(async () => {
    state.runs.new = { ...state.runs.old, runId: 'new', childTaskId: 'new-task', replacesRunId: 'old' };
    return { status: 'accepted', runId: 'new', childTaskId: 'new-task' };
  });
});
it('dispatches the generated handoff with custom instructions and reserves assignment space', async () => {
  state.runs.old.ownedPaths = ['src'];
  await replaceSubagentRun({ runId: 'old', instruction: 'Inspect README' });
  expect(state.prompt.mock.calls[0][2]).toBe('Inspect README');
  expect(state.prompt.mock.calls[0][3]).toBeLessThan(8000);
  expect(state.spawn.mock.calls[0][0].task).toBe('Mandatory handoff plus custom instruction');
});
it('returns the same replacement for concurrent calls and later retries on the original', async () => {
  const results = await Promise.all([replaceSubagentRun({ runId: 'old' }), replaceSubagentRun({ runId: 'old' })]);
  expect(results.map(result => result.replacement.runId)).toEqual(['new', 'new']);
  expect((await replaceSubagentRun({ runId: 'old' })).replacement.runId).toBe('new');
  expect(state.spawn).toHaveBeenCalledOnce();
});
it('preserves a failed dispatch run ID through recover action=replace', async () => {
  state.spawn.mockResolvedValue({ status: 'error', runId: 'failed-child', childTaskId: 'failed-task', error: 'Dispatch failed' });
  const result = await recoverSubagentRun({ runId: 'old', action: 'replace' });
  expect(result).toMatchObject({ ok: false, replacementRunId: 'failed-child', error: 'Dispatch failed', replacement: { childTaskId: 'failed-task' } });
});
it('does not spawn a tracked child when the handoff cannot fit', async () => {
  state.prompt.mockImplementation(() => { throw new Error('File assignments leave too little room'); });
  await expect(replaceSubagentRun({ runId: 'old' })).rejects.toThrow('too little room');
  expect(state.spawn).not.toHaveBeenCalled();
});
