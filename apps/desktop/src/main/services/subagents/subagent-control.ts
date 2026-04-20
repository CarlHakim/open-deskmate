import type { SelectedModel, SubagentRunDetail, SubagentRunRecord, SubagentRunTreeNode, SubagentWaitResult } from '@accomplish/shared';
import { getTask } from '../../store/taskHistory';
import { countActiveSubagentRuns, getSubagentRun, listSubagentRuns, patchSubagentRun } from '../../store/subagentRegistry';
import { deleteGatewaySession, getGatewaySessionByTaskId } from '../../store/gatewaySessions';
import { setTaskModelOverride } from '../../store/taskModelOverrides';
import { resolveAgentEngineKnownSessionId, resumeAgentEngineTask, stopAgentEngineTask } from '../../runtime/agent-engine';
import { attachTrackedSubagentCompletion } from './subagent-spawn';
import { updateTaskStatus } from '../../store/taskHistory';

function enrichRun(run: SubagentRunRecord): SubagentRunDetail {
  const childTask = getTask(run.childTaskId, run.childAgentId);
  const gatewaySession = getGatewaySessionByTaskId(run.childTaskId);
  const sessionId = childTask?.sessionId || gatewaySession?.sessionId || run.sessionId;
  return {
    ...run,
    sessionId,
    sessionState: sessionId ? 'ready' : (run.sessionState ?? 'missing'),
    childTaskSummary: childTask?.summary,
    childTaskStatus: childTask?.status,
  };
}

export function listSubagentRunsForParentTask(parentTaskId: string) {
  return listSubagentRuns(parentTaskId)
    .filter((run) => !run.closedAt)
    .map(enrichRun);
}

export function listSubagentRunTreeForParentTask(parentTaskId: string): SubagentRunTreeNode[] {
  const allRuns = listSubagentRuns()
    .filter((run) => !run.closedAt)
    .map(enrichRun);
  const childrenByParentTaskId = new Map<string, Array<ReturnType<typeof enrichRun>>>();

  for (const run of allRuns) {
    const current = childrenByParentTaskId.get(run.parentTaskId) || [];
    current.push(run);
    childrenByParentTaskId.set(run.parentTaskId, current);
  }

  const buildTree = (taskId: string): SubagentRunTreeNode[] => {
    const direct = childrenByParentTaskId.get(taskId) || [];
    return direct.map((run) => ({
      ...run,
      children: buildTree(run.childTaskId),
    }));
  };

  return buildTree(parentTaskId);
}

export function getSubagentRunForUi(runId: string) {
  const run = getSubagentRun(runId);
  if (!run) return undefined;
  return enrichRun(run);
}

function isSubagentRunTerminal(run: SubagentRunRecord | SubagentRunDetail | null | undefined): boolean {
  return Boolean(run && (run.status === 'done' || run.status === 'error'));
}

export function getActiveSubagentCount(parentTaskId: string): number {
  return countActiveSubagentRuns(parentTaskId);
}

export function archiveSubagentRun(runId: string, archived = true): SubagentRunDetail {
  const run = getSubagentRun(runId);
  if (!run) {
    throw new Error('Subagent run not found.');
  }
  const next = patchSubagentRun(run.runId, {
    archivedAt: archived ? new Date().toISOString() : undefined,
  });
  if (!next) {
    throw new Error('Subagent run could not be updated.');
  }
  return enrichRun(next);
}

export async function closeSubagentSession(runId: string): Promise<SubagentRunDetail> {
  const run = getSubagentRun(runId);
  if (!run) {
    throw new Error('Subagent run not found.');
  }
  const stopState = await stopAgentEngineTask(run.childTaskId, { interruptFirst: true }).catch(() => 'none' as const);
  if (stopState !== 'none') {
    updateTaskStatus(run.childTaskId, 'interrupted', new Date().toISOString());
  }
  deleteGatewaySession(run.childSessionKey);
  const next = patchSubagentRun(run.runId, {
    sessionId: undefined,
    sessionState: 'missing',
    closedAt: new Date().toISOString(),
    status: run.status === 'accepted' || run.status === 'running' ? 'done' : run.status,
    resultStatus: run.status === 'accepted' || run.status === 'running' ? 'interrupted' : run.resultStatus,
    completedAt: run.completedAt ?? new Date().toISOString(),
  });
  if (!next) {
    throw new Error('Subagent run could not be updated.');
  }
  return enrichRun(next);
}

export async function disposeAllSubagentSessions(): Promise<void> {
  const runs = listSubagentRuns(undefined, { includeArchived: true });
  const completedAt = new Date().toISOString();

  await Promise.all(runs.map(async (run) => {
    const stopState = await stopAgentEngineTask(run.childTaskId, { interruptFirst: true }).catch(() => 'none' as const);
    if (stopState !== 'none') {
      updateTaskStatus(run.childTaskId, 'interrupted', completedAt);
    }

    deleteGatewaySession(run.childSessionKey);
    patchSubagentRun(run.runId, {
      sessionId: undefined,
      sessionState: 'missing',
      closedAt: run.closedAt ?? completedAt,
      status: run.status === 'accepted' || run.status === 'running' ? 'done' : run.status,
      resultStatus: run.status === 'accepted' || run.status === 'running' ? 'interrupted' : run.resultStatus,
      completedAt: run.completedAt ?? completedAt,
    });
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSubagentRun(params: {
  runId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<SubagentWaitResult> {
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(0, Math.min(params.timeoutMs ?? 0, 10 * 60_000)) : 60_000;
  const pollIntervalMs = Number.isFinite(params.pollIntervalMs)
    ? Math.max(100, Math.min(params.pollIntervalMs ?? 0, 5_000))
    : 500;
  const startedAt = Date.now();
  let run = getSubagentRunForUi(params.runId) ?? null;
  if (!run) {
    throw new Error('Subagent run not found.');
  }
  while (!isSubagentRunTerminal(run) && Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    run = getSubagentRunForUi(params.runId) ?? null;
    if (!run) {
      throw new Error('Subagent run not found.');
    }
  }
  return {
    completed: isSubagentRunTerminal(run),
    waitedMs: Date.now() - startedAt,
    run,
  };
}

export async function sendSubagentPrompt(params: {
  runId: string;
  prompt: string;
  model?: SelectedModel | null;
}): Promise<{ ok: boolean; runId: string; childTaskId: string }> {
  const run = getSubagentRun(params.runId);
  if (!run) {
    throw new Error('Subagent run not found.');
  }
  const sessionId = resolveAgentEngineKnownSessionId(run.childTaskId, run.childAgentId, run.sessionId);
  if (!sessionId) {
    throw new Error('Subagent session is not available yet.');
  }
  if (params.model) {
    setTaskModelOverride(run.childTaskId, params.model);
  }
  patchSubagentRun(run.runId, {
    status: 'running',
    resultStatus: undefined,
    error: undefined,
    completedAt: undefined,
    sessionId,
    sessionState: sessionId ? 'ready' : 'missing',
    lastPrompt: params.prompt,
    lastResumedAt: new Date().toISOString(),
    reuseCount: run.mode === 'session' ? (run.reuseCount ?? 0) + 1 : run.reuseCount,
  });
  const resumed = await resumeAgentEngineTask(run.childTaskId, params.prompt, {
    agentIdOverride: run.childAgentId,
    sessionId,
    options: {
      source: 'manual',
    },
  });
  attachTrackedSubagentCompletion({
    runId: run.runId,
    parentAgentId: run.parentAgentId,
    completion: resumed.completion,
  });
  return {
    ok: true,
    runId: run.runId,
    childTaskId: run.childTaskId,
  };
}
