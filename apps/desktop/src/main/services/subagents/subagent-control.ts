import { ownershipPrompt, findOwnershipConflicts } from './subagent-ownership';
import type {
  SelectedModel,
  SubagentRecoveryAction,
  SubagentRunDetail,
  SubagentRunRecord,
  SubagentRunTreeNode,
  SubagentWaitManyResult,
  SubagentWaitResult,
} from '@accomplish/shared';
import { getTask } from '../../store/taskHistory';
import { countActiveSubagentRuns, getSubagentRun, listSubagentRuns, patchSubagentRun } from '../../store/subagentRegistry';
import { deleteGatewaySession, getGatewaySessionByTaskId } from '../../store/gatewaySessions';
import { setTaskModelOverride } from '../../store/taskModelOverrides';
import { resolveAgentEngineKnownSessionId, resumeAgentEngineTask, stopAgentEngineTask } from '../../runtime/agent-engine';
import { attachTrackedSubagentCompletion, spawnSubagent } from './subagent-spawn';
import { updateTaskStatus } from '../../store/taskHistory';
import { emitTaskActivityEvent } from '../../runtime/task-runtime-messaging';
import {
  appendSubagentProgressEvent,
  buildReplacementPrompt,
  diagnoseSubagentRun,
  recordSubagentRecoveryFinished,
  recordSubagentRecoveryStarted,
  syncSubagentRunSupervisor,
} from './subagent-supervisor';
import { formatBuildHandoffForPrompt, generateSubagentBuildHandoffBundle } from './subagent-build-handoff';
import {
  buildSubagentSharedContext,
  formatInheritedToolContextForPrompt,
  formatSubagentSharedContextForPrompt,
} from './subagent-shared-context';

function enrichRun(run: SubagentRunRecord): SubagentRunDetail {
  const syncedRun = run;
  const childTask = getTask(syncedRun.childTaskId, syncedRun.childAgentId);
  const gatewaySession = getGatewaySessionByTaskId(syncedRun.childTaskId);
  const sessionId = childTask?.sessionId || gatewaySession?.sessionId || syncedRun.sessionId;
  return {
    ...syncedRun,
    sessionId,
    sessionState: sessionId ? 'ready' : (syncedRun.sessionState ?? 'missing'),
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
  emitTaskActivityEvent({
    id: `act_subagent_closed_${next.runId}_${Date.now()}`,
    taskId: next.parentTaskId,
    agentId: next.parentAgentId,
    kind: 'subagent_closed',
    title: 'Subagent closed',
    detail: 'The helper run was closed and will not block parent synthesis.',
    timestamp: new Date().toISOString(),
    status: 'warning',
    subagentRunId: next.runId,
    subagentTaskId: next.childTaskId,
    parentTaskId: next.parentTaskId,
  });
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

const SUBAGENT_WAIT_DEFAULT_MS = 10 * 60_000;
const SUBAGENT_WAIT_MAX_MS = 20 * 60_000;

export async function waitForSubagentRun(params: {
  runId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<SubagentWaitResult> {
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(0, Math.min(params.timeoutMs ?? 0, SUBAGENT_WAIT_MAX_MS)) : SUBAGENT_WAIT_DEFAULT_MS;
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
  if (run?.status === 'done' && !run.finalReport) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(250);
      const refreshed = getSubagentRunForUi(params.runId) ?? null;
      if (!refreshed) {
        throw new Error('Subagent run not found.');
      }
      run = refreshed;
      if (run.finalReport) break;
    }
  }
  return {
    completed: isSubagentRunTerminal(run),
    waitedMs: Date.now() - startedAt,
    run,
    recommendedAction: run?.supervisor?.recommendedAction,
  };
}

function summarizeWaitManyRecommendation(runs: SubagentRunDetail[]): SubagentWaitManyResult['recommendedAction'] {
  if (runs.length === 0) return 'answer_now';
  if (runs.every((run) => isSubagentRunTerminal(run) || run.supervisor?.state === 'replaced')) return 'answer_now';
  if (runs.some((run) => run.supervisor?.recommendedAction === 'replace_child')) return 'replace_child';
  if (runs.some((run) => run.supervisor?.recommendedAction === 'recover_child')) return 'recover_child';
  if (runs.some((run) => run.supervisor?.recommendedAction === 'synthesize_partial')) return 'synthesize_partial';
  return 'wait';
}

export async function waitForSubagentRuns(params: {
  runIds: string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  mode?: 'all' | 'any';
}): Promise<SubagentWaitManyResult> {
  const uniqueRunIds = Array.from(new Set((params.runIds || []).map((id) => id.trim()).filter(Boolean)));
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(0, Math.min(params.timeoutMs ?? 0, SUBAGENT_WAIT_MAX_MS)) : SUBAGENT_WAIT_DEFAULT_MS;
  const pollIntervalMs = Number.isFinite(params.pollIntervalMs)
    ? Math.max(100, Math.min(params.pollIntervalMs ?? 0, 5_000))
    : 500;
  const mode = params.mode === 'any' ? 'any' : 'all';
  const startedAt = Date.now();

  const readRuns = () => uniqueRunIds
    .map((runId) => getSubagentRunForUi(runId))
    .filter(Boolean) as SubagentRunDetail[];

  let runs = readRuns();
  const isCompleteEnough = () => {
    const terminalEnough = (run: SubagentRunDetail) => isSubagentRunTerminal(run) || run.supervisor?.state === 'replaced';
    return mode === 'any'
      ? runs.some(terminalEnough)
      : runs.length === uniqueRunIds.length && runs.every(terminalEnough);
  };
  const hasActionableProblem = () => runs.some((run) => (
    run.supervisor?.recommendedAction === 'recover_child'
    || run.supervisor?.recommendedAction === 'replace_child'
    || run.supervisor?.recommendedAction === 'synthesize_partial'
  ));
  while (
    !isCompleteEnough()
    && !hasActionableProblem()
    && Date.now() - startedAt < timeoutMs
  ) {
    await sleep(pollIntervalMs);
    runs = readRuns();
  }

  const completedRuns = runs.filter((run) => isSubagentRunTerminal(run) || run.supervisor?.state === 'replaced');
  const failedRuns = runs.filter((run) => run.status === 'error' || run.resultStatus === 'error' || run.supervisor?.state === 'failed' || run.supervisor?.state === 'timed_out');
  const staleRuns = runs.filter((run) => run.supervisor?.state === 'stale' || run.supervisor?.state === 'blocked');
  const stuckRuns = runs.filter((run) => run.supervisor?.state === 'likely_stuck');
  const pendingRuns = runs.filter((run) => !completedRuns.some((completed) => completed.runId === run.runId));
  const recommendedAction = summarizeWaitManyRecommendation(runs);

  return {
    completed: pendingRuns.length === 0,
    waitedMs: Date.now() - startedAt,
    runs,
    completedRuns,
    pendingRuns,
    staleRuns,
    stuckRuns,
    failedRuns,
    recommendedAction,
  };
}

export function addSubagentProgress(params: {
  runId: string;
  title?: string;
  detail?: string;
  type?: 'started' | 'status' | 'milestone' | 'output' | 'tool' | 'blocked' | 'recovery' | 'completed';
  percentage?: number;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
}): SubagentRunDetail {
  const run = appendSubagentProgressEvent(params.runId, {
    type: params.type || 'milestone',
    title: params.title || 'Subagent progress',
    detail: params.detail,
    status: params.type === 'blocked' ? 'warning' : 'info',
    percentage: params.percentage,
    currentStep: params.currentStep,
    totalSteps: params.totalSteps,
    completedSteps: params.completedSteps,
  });
  if (!run) throw new Error('Subagent run not found.');
  return enrichRun(run);
}

export function diagnoseSubagent(params: { runId: string }): SubagentRunDetail {
  const run = diagnoseSubagentRun(params.runId);
  if (!run) throw new Error('Subagent run not found.');
  return enrichRun(run);
}

export async function recoverSubagentRun(params: {
  runId: string;
  action?: SubagentRecoveryAction;
  instruction?: string;
  reason?: string;
  targetAgentId?: string;
  label?: string;
  runTimeoutMs?: number;
  model?: SelectedModel | null;
}): Promise<{ ok: boolean; run: SubagentRunDetail; recoveryId?: string; replacementRunId?: string; replacement?: Awaited<ReturnType<typeof spawnSubagent>>; error?: string }> {
  const run = getSubagentRun(params.runId);
  if (!run) throw new Error('Subagent run not found.');
  const action = params.action || 'resume';
  if (action === 'cancel') {
    const { recoveryId } = recordSubagentRecoveryStarted(params.runId, {
      action,
      reason: params.reason || 'Subagent cancelled by supervisor.',
      notes: params.instruction,
    });
    try {
      const closed = await closeSubagentSession(params.runId);
      recordSubagentRecoveryFinished(params.runId, recoveryId, {
        status: 'succeeded',
        notes: 'Subagent child run was closed.',
      });
      return { ok: true, recoveryId, run: closed };
    } catch (error) {
      recordSubagentRecoveryFinished(params.runId, recoveryId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Subagent cancel failed.',
      });
      throw error;
    }
  }
  if (action === 'replace') {
    const replaced = await replaceSubagentRun({
      runId: params.runId,
      targetAgentId: params.targetAgentId,
      instruction: params.instruction,
      reason: params.reason,
      label: params.label,
      runTimeoutMs: params.runTimeoutMs,
      model: params.model,
    });
    return { ok: replaced.ok, recoveryId: replaced.recoveryId, run: replaced.originalRun,
      replacementRunId: replaced.replacement.runId, replacement: replaced.replacement, error: replaced.replacement.error };
  }
  if (action === 'manual_intervention') {
    const { recoveryId } = recordSubagentRecoveryStarted(params.runId, {
      action,
      reason: params.reason || 'Manual intervention recorded by supervisor.',
      notes: params.instruction,
    });
    recordSubagentRecoveryFinished(params.runId, recoveryId, {
      status: 'succeeded',
      notes: 'No automatic runtime action was taken.',
    });
    return {
      ok: true,
      recoveryId,
      run: getSubagentRunForUi(params.runId) as SubagentRunDetail,
    };
  }
  const { recoveryId } = recordSubagentRecoveryStarted(params.runId, {
    action,
    reason: params.reason || run.supervisor?.stalledReason || `Subagent ${action} requested.`,
    notes: params.instruction,
  });
  const sessionId = resolveAgentEngineKnownSessionId(run.childTaskId, run.childAgentId, run.sessionId);
  if (!sessionId) {
    recordSubagentRecoveryFinished(params.runId, recoveryId, {
      status: 'failed',
      error: 'Subagent session is not available yet.',
    });
    throw new Error('Subagent session is not available yet.');
  }
  const buildHandoff = await generateSubagentBuildHandoffBundle(run, params.reason || `Subagent ${action} requested.`);
  const handoffPrompt = formatBuildHandoffForPrompt(buildHandoff);
  const sharedContext = buildSubagentSharedContext(run.parentTaskId, { excludeRunId: run.runId });
  const inheritedToolPrompt = formatInheritedToolContextForPrompt(run.inheritedContext || {});
  const sharedContextPrompt = formatSubagentSharedContextForPrompt(sharedContext);
  if (buildHandoff) {
    patchSubagentRun(run.runId, { buildHandoff });
    appendSubagentProgressEvent(run.runId, {
      type: 'recovery',
      title: 'Build handoff refreshed',
      detail: buildHandoff.diffSummary || `${buildHandoff.changedFiles?.length || 0} changed files`,
      status: buildHandoff.diffAvailable === false ? 'warning' : 'info',
    });
  }
  const promptBody = params.instruction?.trim() || [
    'Recovery instruction from the parent agent:',
    'Stop repeating any previous stuck action. Summarize current useful findings, choose a different method if needed, and finish the original subtask.',
    '',
    `Original subtask:\n${run.task}`,
  ].join('\n');
  const prompt = [handoffPrompt, promptBody].filter(Boolean).join('\n\n');
  const fullPrompt = [inheritedToolPrompt, sharedContextPrompt, prompt].filter(Boolean).join('\n\n');
  if (params.model) {
    setTaskModelOverride(run.childTaskId, params.model);
  }
  patchSubagentRun(run.runId, {
    status: 'running',
    lifecycle: 'starting',
    startedAt: undefined,
    queuedAt: new Date().toISOString(),
    resultDelivery: undefined,
    finalReport: undefined,
    limitReached: undefined,
    resultStatus: undefined,
    error: undefined,
    completedAt: undefined,
    sessionId,
    sessionState: 'ready',
    lastPrompt: fullPrompt,
    sharedContext,
    lastResumedAt: new Date().toISOString(),
  });
  appendSubagentProgressEvent(run.runId, {
    type: 'recovery',
    title: 'Recovery prompt sent',
    detail: params.reason || fullPrompt,
    status: 'running',
  });
  const resumed = await resumeAgentEngineTask(run.childTaskId, fullPrompt, {
    agentIdOverride: run.childAgentId,
    sessionId,
    options: {
      source: 'manual',
      resume: {
        workingDirectory: run.inheritedContext?.workingDirectory,
        attachedFiles: run.inheritedContext?.attachedFiles,
        privacyMode: run.inheritedContext?.privacyMode,
        buildMode: run.inheritedContext?.buildMode,
        buildWorkspaceRelativePath: run.inheritedContext?.buildWorkspaceRelativePath,
        toolsetOverrideIds: run.inheritedContext?.toolsetIds,
        deferredToolDiscoveryOverride: run.inheritedContext?.deferredToolDiscoveryEnabled,
      },
    },
  });
  patchSubagentRun(run.runId, { status: resumed.task.status === 'queued' ? 'accepted' : 'running', lifecycle: resumed.task.status === 'queued' ? 'queued' : 'working', startedAt: resumed.task.status === 'queued' ? undefined : new Date().toISOString() });
  attachTrackedSubagentCompletion({
    runId: run.runId,
    parentAgentId: run.parentAgentId,
    completion: resumed.completion,
  });
  recordSubagentRecoveryFinished(params.runId, recoveryId, {
    status: 'succeeded',
    notes: 'Recovery prompt accepted by child session.',
  });
  return {
    ok: true,
    recoveryId,
    run: getSubagentRunForUi(run.runId) as SubagentRunDetail,
  };
}

const pendingReplacements = new Map<string, ReturnType<typeof performSubagentReplacement>>();

export function replaceSubagentRun(params: Parameters<typeof performSubagentReplacement>[0]): ReturnType<typeof performSubagentReplacement> {
  const pending = pendingReplacements.get(params.runId);
  if (pending) return pending;
  const attempt = performSubagentReplacement(params).finally(() => pendingReplacements.delete(params.runId));
  pendingReplacements.set(params.runId, attempt);
  return attempt;
}

async function performSubagentReplacement(params: {
  runId: string;
  targetAgentId?: string;
  instruction?: string;
  reason?: string;
  label?: string;
  runTimeoutMs?: number;
  model?: SelectedModel | null;
}): Promise<{ ok: boolean; originalRun: SubagentRunDetail; replacement: Awaited<ReturnType<typeof spawnSubagent>>; recoveryId?: string }> {
  const run = getSubagentRun(params.runId);
  if (!run) throw new Error('Subagent run not found.');
  if (run.replacedByRunId) {
    const existing = getSubagentRun(run.replacedByRunId);
    if (!existing) throw new Error(`Previously created replacement ${run.replacedByRunId} not found; inspect the original run before retrying.`);
    return { ok: existing.status !== 'error', originalRun: enrichRun(run), replacement: {
      status: existing.status === 'error' ? 'error' : 'accepted', runId: existing.runId,
      childTaskId: existing.childTaskId, childSessionKey: existing.childSessionKey,
      targetAgentId: existing.childAgentId, error: existing.error,
    } };
  }
  const synced = syncSubagentRunSupervisor(run.runId) || run;
  const buildHandoff = await generateSubagentBuildHandoffBundle(
    synced,
    params.reason || synced.supervisor?.stalledReason || 'Subagent replacement requested.'
  );
  const handoffSynced = buildHandoff
    ? (patchSubagentRun(synced.runId, { buildHandoff }) || { ...synced, buildHandoff })
    : synced;
  // Validate the entire handoff before stopping the old child or creating a run.
  const replacementPrompt = buildReplacementPrompt(handoffSynced, params.reason, params.instruction,
    8000 - ownershipPrompt(synced.ownedPaths || []).length);
  if (buildHandoff) {
    appendSubagentProgressEvent(synced.runId, {
      type: 'recovery',
      title: 'Build handoff prepared',
      detail: buildHandoff.diffSummary || `${buildHandoff.changedFiles?.length || 0} changed files`,
      status: buildHandoff.diffAvailable === false ? 'warning' : 'info',
    });
  }
  const sharedContext = buildSubagentSharedContext(synced.parentTaskId, { excludeRunId: synced.runId });
  patchSubagentRun(synced.runId, { sharedContext });
  const { recoveryId } = recordSubagentRecoveryStarted(run.runId, {
    action: 'replace',
    reason: params.reason || synced.supervisor?.stalledReason || 'Subagent replacement requested.',
    notes: params.instruction,
  });
  // Transfer shared file assignments only after the previous writer has stopped.
  if (synced.ownedPaths?.length && !synced.worktree && (synced.status === 'accepted' || synced.status === 'running')) {
    await stopAgentEngineTask(synced.childTaskId, { interruptFirst: true });
    updateTaskStatus(synced.childTaskId, 'interrupted', new Date().toISOString());
    patchSubagentRun(synced.runId, { status: 'done', lifecycle: 'finished', resultStatus: 'interrupted', completedAt: new Date().toISOString() });
  }
  const replacement = await spawnSubagent(
    {
      targetAgentId: params.targetAgentId || synced.childAgentId,
      task: replacementPrompt,
      label: params.label || (synced.label ? `${synced.label} replacement` : 'Replacement'),
      runTimeoutMs: params.runTimeoutMs || synced.executionPolicy?.runTimeoutMs,
      model: params.model ?? synced.model ?? null,
      mode: 'run',
      expectedOutputs: synced.expectedOutputs,
      ownedPaths: synced.ownedPaths,
      isolation: synced.worktree ? 'worktree' : 'shared',
      maxCostUsd: synced.executionPolicy?.maxCostUsd,
      limitAction: synced.executionPolicy?.limitAction,
      buildHandoff,
      replacesRunId: synced.runId,
      replacementReason: params.reason || synced.supervisor?.stalledReason,
    },
    {
      parentTaskId: synced.parentTaskId,
      parentAgentId: synced.parentAgentId,
      parentRunId: synced.parentRunId,
      parentSessionKey: synced.parentSessionKey,
    }
  );
  if (replacement.status === 'accepted' && replacement.runId) {
    const stoppedState = await stopAgentEngineTask(synced.childTaskId, { interruptFirst: true }).catch(() => 'none' as const);
    if (stoppedState !== 'none') {
      updateTaskStatus(synced.childTaskId, 'interrupted', new Date().toISOString());
    }
    patchSubagentRun(synced.runId, {
      replacedByRunId: replacement.runId,
      status: synced.status === 'accepted' || synced.status === 'running' ? 'done' : synced.status,
      resultStatus: synced.status === 'accepted' || synced.status === 'running' ? 'interrupted' : synced.resultStatus,
      completedAt: synced.completedAt ?? new Date().toISOString(),
      supervisor: {
        ...(synced.supervisor || {}),
        state: 'replaced',
        recommendedAction: 'wait',
        recoveryEligible: false,
      },
    });
    recordSubagentRecoveryFinished(synced.runId, recoveryId, {
      status: 'succeeded',
      replacementRunId: replacement.runId,
      notes: 'Replacement child run accepted.',
    });
  } else {
    recordSubagentRecoveryFinished(synced.runId, recoveryId, {
      status: 'failed',
      error: replacement.error || 'Replacement child run was not accepted.',
    });
  }
  return {
    ok: replacement.status === 'accepted',
    recoveryId,
    originalRun: getSubagentRunForUi(synced.runId) as SubagentRunDetail,
    replacement,
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
  const sharedContext = buildSubagentSharedContext(run.parentTaskId, { excludeRunId: run.runId });
  const inheritedToolPrompt = formatInheritedToolContextForPrompt(run.inheritedContext || {});
  const sharedContextPrompt = formatSubagentSharedContextForPrompt(sharedContext);
  const conflicts = findOwnershipConflicts(run.ownedPaths || [], listSubagentRuns(undefined, { includeArchived: true }), run.inheritedContext?.workingDirectory, run.runId);
  if (conflicts.length) throw new Error('Overlapping file assignments: ' + conflicts.join('; '));
  const prompt = [inheritedToolPrompt, sharedContextPrompt, ownershipPrompt(run.ownedPaths || []), params.prompt].filter(Boolean).join('\n\n');
  patchSubagentRun(run.runId, {
    status: 'running',
    resultStatus: undefined,
    error: undefined,
    completedAt: undefined,
    sessionId,
    sessionState: sessionId ? 'ready' : 'missing',
    lastPrompt: prompt,
    sharedContext,
    lastResumedAt: new Date().toISOString(),
    reuseCount: run.mode === 'session' ? (run.reuseCount ?? 0) + 1 : run.reuseCount,
  });
  const resumed = await resumeAgentEngineTask(run.childTaskId, prompt, {
    agentIdOverride: run.childAgentId,
    sessionId,
    options: {
      source: 'manual',
      resume: {
        workingDirectory: run.inheritedContext?.workingDirectory,
        attachedFiles: run.inheritedContext?.attachedFiles,
        privacyMode: run.inheritedContext?.privacyMode,
        buildMode: run.inheritedContext?.buildMode,
        buildWorkspaceRelativePath: run.inheritedContext?.buildWorkspaceRelativePath,
        toolsetOverrideIds: run.inheritedContext?.toolsetIds,
        deferredToolDiscoveryOverride: run.inheritedContext?.deferredToolDiscoveryEnabled,
      },
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
