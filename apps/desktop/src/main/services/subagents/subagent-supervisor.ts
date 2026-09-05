import crypto from 'node:crypto';
import type {
  SubagentProgressEvent,
  SubagentProgressEventType,
  SubagentResultBundle,
  SubagentRunDetail,
  SubagentRunRecord,
  SubagentSupervisorRecommendedAction,
  SubagentSupervisorRunState,
  TaskActivityEvent,
} from '@accomplish/shared';
import { getTask } from '../../store/taskHistory';
import { getSubagentRun, listSubagentRuns, patchSubagentRun } from '../../store/subagentRegistry';
import { emitTaskActivityEvent } from '../../runtime/task-runtime-messaging';
import { formatBuildHandoffForPrompt } from './subagent-build-handoff';
import { buildSubagentSharedContext, extractSubagentFailureSignals } from './subagent-shared-context';

const MAX_PROGRESS_EVENTS = 100;
const STALE_AFTER_MS = 3 * 60_000;
const RECOVERY_GRACE_MS = 2 * 60_000;
const REPEATED_TOOL_STUCK_COUNT = 5;
const PARTIAL_REPORT_LIMIT = 12_000;
const SUMMARY_LIMIT = 1_200;

function nowIso(): string {
  return new Date().toISOString();
}

function createProgressId(type: SubagentProgressEventType): string {
  return `subprog_${type}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function createRecoveryId(): string {
  return `subrec_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function truncateText(value: string | undefined, limit: number): string | undefined {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  return trimmed.length > limit ? `${trimmed.slice(0, limit).trimEnd()}...` : trimmed;
}

function isTerminal(run: Pick<SubagentRunRecord, 'status'>): boolean {
  return run.status === 'done' || run.status === 'error';
}

function mapTaskActivityToProgress(run: SubagentRunRecord, event: TaskActivityEvent): SubagentProgressEvent | null {
  if (!event?.id || event.taskId !== run.childTaskId) return null;
  let type: SubagentProgressEventType = 'status';
  if (event.kind === 'task_started') type = 'started';
  if (event.kind === 'tool_started' || event.kind === 'tool_finished') type = 'tool';
  if (event.kind === 'permission_requested') type = 'blocked';
  if (event.kind === 'assistant_message') type = 'output';
  if (event.kind === 'task_finished') type = 'completed';

  const signals = extractSubagentFailureSignals({
    text: [event.title, event.detail].filter(Boolean).join(' '),
    toolName: event.toolName,
    metadata: event.metadata,
  });
  return {
    id: `taskact_${event.id}`,
    runId: run.runId,
    type,
    timestamp: event.timestamp,
    title: event.title,
    detail: event.detail,
    status: event.status,
    toolName: event.toolName,
    messageId: event.messageId,
    recoverable: event.recoverable,
    metadata: event.metadata,
    ...signals,
  };
}

function mergeProgressEvents(
  existing: SubagentProgressEvent[] | undefined,
  incoming: SubagentProgressEvent[]
): SubagentProgressEvent[] {
  const merged = [...(existing || [])];
  for (const event of incoming) {
    if (!event.id || merged.some((item) => item.id === event.id)) continue;
    merged.push(event);
  }
  return merged
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_PROGRESS_EVENTS);
}

function isMeaningfulProgress(event: SubagentProgressEvent): boolean {
  if (event.type === 'blocked') return true;
  if (event.type === 'output' || event.type === 'milestone' || event.type === 'completed' || event.type === 'recovery') return true;
  if (event.type === 'tool' && event.status === 'success') return Boolean(event.detail || event.toolName);
  return event.type === 'started';
}

function latestProgressAt(events: SubagentProgressEvent[]): string | undefined {
  return events[events.length - 1]?.timestamp;
}

function latestMeaningfulProgressAt(events: SubagentProgressEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && isMeaningfulProgress(event)) return event.timestamp;
  }
  return undefined;
}

function comparableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function comparableSupervisor(value: SubagentRunRecord['supervisor'] | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const { lastCheckedAt, ...rest } = value;
  return rest;
}

function resultBundleChanged(
  current: SubagentResultBundle | undefined,
  next: SubagentResultBundle | undefined,
): boolean {
  if (!current && !next) return false;
  if (!current || !next) return true;
  const stripGeneratedAt = (bundle: SubagentResultBundle) => {
    const { generatedAt, ...rest } = bundle;
    return rest;
  };
  return comparableJson(stripGeneratedAt(current)) !== comparableJson(stripGeneratedAt(next));
}

function comparableSharedContext(value: SubagentRunRecord['sharedContext'] | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const { generatedAt, ...rest } = value;
  return rest;
}

function detectRepeatedTool(events: SubagentProgressEvent[]): { toolName?: string; count: number } {
  let toolName: string | undefined;
  let count = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'tool' || event.status !== 'success') continue;
    const currentTool = event.toolName || event.title || 'tool';
    if (!toolName) {
      toolName = currentTool;
      count = 1;
      continue;
    }
    if (currentTool !== toolName) break;
    count += 1;
  }
  return { toolName, count };
}

function detectRepeatedSourceFailure(events: SubagentProgressEvent[]): {
  domain?: string;
  sourceUrl?: string;
  httpStatus?: number;
  failureKind?: SubagentProgressEvent['failureKind'];
  count: number;
  example?: string;
} {
  const failureEvents = [...events]
    .reverse()
    .filter((event) => event.failureKind || event.httpStatus || event.domain || event.sourceUrl)
    .slice(0, 12);
  const groups = new Map<string, {
    domain?: string;
    sourceUrl?: string;
    httpStatus?: number;
    failureKind?: SubagentProgressEvent['failureKind'];
    count: number;
    example?: string;
  }>();
  for (const event of failureEvents) {
    const key = [event.domain || event.sourceUrl || 'unknown-source', event.httpStatus || '', event.failureKind || ''].join('|');
    const existing = groups.get(key) || {
      domain: event.domain,
      sourceUrl: event.sourceUrl,
      httpStatus: event.httpStatus,
      failureKind: event.failureKind,
      count: 0,
      example: event.detail || event.title,
    };
    existing.count += 1;
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)[0] || { count: 0 };
}

function countRecoveryAttempts(run: SubagentRunRecord): number {
  return (run.recoveryHistory || []).filter((entry) => entry.action === 'resume' || entry.action === 'retry').length;
}

function inferResultBundle(run: SubagentRunRecord, events: SubagentProgressEvent[]): SubagentResultBundle | undefined {
  const finalReport = truncateText(run.finalReport, PARTIAL_REPORT_LIMIT);
  const latestOutput = [...events].reverse().find((event) => event.type === 'output' && event.detail)?.detail;
  const partialReport = finalReport || truncateText(latestOutput, PARTIAL_REPORT_LIMIT);
  if (!partialReport && !run.error) return run.resultBundle;
  return {
    summary: truncateText(finalReport || latestOutput || run.error, SUMMARY_LIMIT),
    partialReport,
    finalReport,
    finalReportTruncated: run.finalReportTruncated,
    items: [
      ...(partialReport ? [{
        id: 'summary',
        kind: 'summary' as const,
        label: finalReport ? 'Final report' : 'Partial report',
        content: partialReport,
      }] : []),
      ...(run.error ? [{
        id: 'error',
        kind: 'error' as const,
        label: 'Error',
        content: run.error,
      }] : []),
    ],
    missingExpectedOutputIds: (run.expectedOutputs || [])
      .filter((item) => item.required && !partialReport)
      .map((item) => item.id),
    generatedAt: nowIso(),
  };
}

function computeSupervisor(
  run: SubagentRunRecord,
  events: SubagentProgressEvent[],
): {
  state: SubagentSupervisorRunState;
  recommendedAction: SubagentSupervisorRecommendedAction;
  staleReason?: string;
  stuckReason?: string;
  blockedReason?: string;
  repeatedToolName?: string;
  repeatedToolCount?: number;
  blockedSourceDomain?: string;
  blockedSourceUrl?: string;
  blockedHttpStatus?: number;
  blockedFailureKind?: SubagentProgressEvent['failureKind'];
  blockedSourceCount?: number;
  recoveryEligible: boolean;
} {
  const currentTime = Date.now();
  const lastProgress = latestProgressAt(events);
  const lastMeaningful = latestMeaningfulProgressAt(events) || run.updatedAt || run.createdAt;
  const lastMeaningfulMs = Date.parse(lastMeaningful);
  const recoveryAttempts = countRecoveryAttempts(run);
  const lastRecovery = [...(run.recoveryHistory || [])]
    .reverse()
    .find((entry) => entry.action === 'resume' || entry.action === 'retry');
  const lastRecoveryMs = lastRecovery?.startedAt ? Date.parse(lastRecovery.startedAt) : NaN;
  const blockedEvent = [...events].reverse().find((event) => event.type === 'blocked' && event.status !== 'success');
  const repeatedTool = detectRepeatedTool(events);
  const repeatedSource = detectRepeatedSourceFailure(events);
  const runTimeoutMs = run.executionPolicy?.runTimeoutMs;
  const ageMs = currentTime - Date.parse(run.createdAt);

  if (run.replacedByRunId) {
    return { state: 'replaced', recommendedAction: 'wait', recoveryEligible: false };
  }
  if (run.status === 'error') {
    return { state: 'failed', recommendedAction: run.resultBundle?.partialReport ? 'synthesize_partial' : 'replace_child', recoveryEligible: true };
  }
  if (run.status === 'done') {
    return { state: 'complete', recommendedAction: 'answer_now', recoveryEligible: false };
  }
  if (runTimeoutMs && ageMs >= runTimeoutMs) {
    return {
      state: 'timed_out',
      recommendedAction: run.resultBundle?.partialReport ? 'synthesize_partial' : 'replace_child',
      staleReason: `Child exceeded its ${Math.round(runTimeoutMs / 1000)} second timeout.`,
      recoveryEligible: true,
    };
  }
  if (lastRecovery && Number.isFinite(lastRecoveryMs) && currentTime - lastRecoveryMs < RECOVERY_GRACE_MS) {
    return { state: 'recovering', recommendedAction: 'wait', recoveryEligible: false };
  }
  if (blockedEvent) {
    return {
      state: 'blocked',
      recommendedAction: recoveryAttempts >= 2 ? 'replace_child' : 'recover_child',
      blockedReason: blockedEvent.detail || blockedEvent.title || 'Child is waiting on a permission or tool block.',
      recoveryEligible: true,
    };
  }
  if (repeatedSource.count >= 2) {
    const sourceLabel = repeatedSource.domain || repeatedSource.sourceUrl || 'the same source';
    const status = repeatedSource.httpStatus ? ` HTTP ${repeatedSource.httpStatus}` : '';
    const kind = repeatedSource.failureKind ? ` ${repeatedSource.failureKind}` : '';
    return {
      state: 'likely_stuck',
      recommendedAction: recoveryAttempts >= 2 ? 'replace_child' : 'recover_child',
      stuckReason: `Repeated blocked source ${sourceLabel}${status}${kind} ${repeatedSource.count} times. Switch source type instead of retrying.`,
      blockedSourceDomain: repeatedSource.domain,
      blockedSourceUrl: repeatedSource.sourceUrl,
      blockedHttpStatus: repeatedSource.httpStatus,
      blockedFailureKind: repeatedSource.failureKind,
      blockedSourceCount: repeatedSource.count,
      recoveryEligible: true,
    };
  }
  if (repeatedTool.count >= REPEATED_TOOL_STUCK_COUNT) {
    return {
      state: 'likely_stuck',
      recommendedAction: recoveryAttempts >= 2 ? 'replace_child' : 'recover_child',
      stuckReason: `Repeated ${repeatedTool.toolName || 'the same tool'} ${repeatedTool.count} times without new useful output.`,
      repeatedToolName: repeatedTool.toolName,
      repeatedToolCount: repeatedTool.count,
      recoveryEligible: true,
    };
  }
  if (Number.isFinite(lastMeaningfulMs) && currentTime - lastMeaningfulMs >= STALE_AFTER_MS) {
    return {
      state: 'stale',
      recommendedAction: recoveryAttempts >= 2 ? 'replace_child' : 'recover_child',
      staleReason: `No meaningful child progress for more than ${Math.round(STALE_AFTER_MS / 60_000)} minutes.`,
      recoveryEligible: true,
    };
  }
  if (run.status === 'accepted') {
    return { state: 'queued', recommendedAction: 'wait', recoveryEligible: false };
  }
  if (lastProgress) {
    return { state: 'progressing', recommendedAction: 'wait', recoveryEligible: false };
  }
  return { state: 'active', recommendedAction: 'wait', recoveryEligible: false };
}

function subagentStateActivityKind(state?: SubagentSupervisorRunState): TaskActivityEvent['kind'] | null {
  if (state === 'stale') return 'subagent_stale';
  if (state === 'likely_stuck') return 'subagent_stuck';
  if (state === 'replaced') return 'subagent_replaced';
  if (state === 'complete') return 'subagent_completed';
  if (state === 'failed' || state === 'timed_out') return 'subagent_failed';
  return null;
}

function emitSubagentStateActivity(run: SubagentRunRecord, previousState?: SubagentSupervisorRunState): void {
  const state = run.supervisor?.state;
  if (!state || state === previousState) return;
  const kind = subagentStateActivityKind(state);
  if (!kind) return;
  const reason = run.supervisor?.stalledReason || run.supervisor?.blockedReason || run.error;
  emitTaskActivityEvent({
    id: `act_${kind}_${run.runId}_${Date.now()}`,
    taskId: run.parentTaskId,
    agentId: run.parentAgentId,
    kind,
    title: state === 'likely_stuck'
      ? 'Subagent appears stuck'
      : state === 'stale'
        ? 'Subagent is stale'
        : state === 'replaced'
          ? 'Subagent was replaced'
          : state === 'complete'
            ? 'Subagent completed'
            : 'Subagent failed',
    detail: reason,
    timestamp: nowIso(),
    status: state === 'complete' ? 'success' : state === 'replaced' || state === 'stale' ? 'warning' : 'error',
    subagentRunId: run.runId,
    subagentTaskId: run.childTaskId,
    parentTaskId: run.parentTaskId,
    recoverable: Boolean(run.supervisor?.recoveryEligible),
  });
}

export function syncSubagentRunSupervisor(runId: string): SubagentRunRecord | undefined {
  const run = getSubagentRun(runId);
  if (!run) return undefined;
  const childTask = getTask(run.childTaskId, run.childAgentId);
  const childEvents = (childTask?.activity || [])
    .map((event) => mapTaskActivityToProgress(run, event))
    .filter(Boolean) as SubagentProgressEvent[];
  const progressEvents = mergeProgressEvents(run.progressEvents, childEvents);
  const inferredResultBundle = inferResultBundle(run, progressEvents);
  const resultBundle = resultBundleChanged(run.resultBundle, inferredResultBundle)
    ? inferredResultBundle
    : run.resultBundle;
  const supervisor = computeSupervisor({ ...run, resultBundle }, progressEvents);
  const nextSupervisor = {
    ...(run.supervisor || {}),
    state: supervisor.state,
    agentId: run.childAgentId,
    taskId: run.childTaskId,
    sessionKey: run.childSessionKey,
    heartbeatAt: latestProgressAt(progressEvents) || run.updatedAt,
    lastProgressAt: latestProgressAt(progressEvents),
    lastMeaningfulProgressAt: latestMeaningfulProgressAt(progressEvents),
    staleReason: supervisor.staleReason,
    stuckReason: supervisor.stuckReason,
    blockedReason: supervisor.blockedReason,
    stalledReason: supervisor.stuckReason || supervisor.staleReason || supervisor.blockedReason,
    repeatedToolName: supervisor.repeatedToolName,
    repeatedToolCount: supervisor.repeatedToolCount,
    blockedSourceDomain: supervisor.blockedSourceDomain,
    blockedSourceUrl: supervisor.blockedSourceUrl,
    blockedHttpStatus: supervisor.blockedHttpStatus,
    blockedFailureKind: supervisor.blockedFailureKind,
    blockedSourceCount: supervisor.blockedSourceCount,
    recommendedAction: supervisor.recommendedAction,
    recoveryEligible: supervisor.recoveryEligible,
    recoveryAttempts: countRecoveryAttempts(run),
  };
  const progressChanged = comparableJson(run.progressEvents || []) !== comparableJson(progressEvents);
  const supervisorChanged = comparableJson(comparableSupervisor(run.supervisor)) !== comparableJson(comparableSupervisor(nextSupervisor));
  const bundleChanged = resultBundleChanged(run.resultBundle, resultBundle);
  const sharedContext = buildSubagentSharedContext(run.parentTaskId);
  const sharedContextChanged = comparableJson(comparableSharedContext(run.sharedContext)) !== comparableJson(comparableSharedContext(sharedContext));
  if (!progressChanged && !supervisorChanged && !bundleChanged && !sharedContextChanged) {
    return run;
  }
  const patched = patchSubagentRun(run.runId, {
    ...(progressChanged ? { progressEvents } : {}),
    ...(bundleChanged ? { resultBundle } : {}),
    ...(sharedContextChanged ? { sharedContext } : {}),
    supervisor: {
      ...nextSupervisor,
      lastCheckedAt: nowIso(),
    },
  });
  if (patched) {
    emitSubagentStateActivity(patched, run.supervisor?.state);
  }
  return patched;
}

export function syncAllActiveSubagentSupervisors(): void {
  for (const run of listSubagentRuns(undefined, { includeArchived: true })) {
    if (run.closedAt) continue;
    if (!isTerminal(run) || run.status === 'error' || run.replacedByRunId) {
      syncSubagentRunSupervisor(run.runId);
    }
  }
}

export function appendSubagentProgressEvent(
  runId: string,
  input: Omit<SubagentProgressEvent, 'id' | 'runId' | 'timestamp'> & { id?: string; timestamp?: string }
): SubagentRunRecord | undefined {
  const run = syncSubagentRunSupervisor(runId) || getSubagentRun(runId);
  if (!run) return undefined;
  const signals = extractSubagentFailureSignals({
    text: [input.title, input.detail].filter(Boolean).join(' '),
    toolName: input.toolName,
    metadata: input.metadata,
    sourceUrl: input.sourceUrl,
  });
  const event: SubagentProgressEvent = {
    ...signals,
    ...input,
    id: input.id || createProgressId(input.type),
    runId,
    timestamp: input.timestamp || nowIso(),
  };
  const progressEvents = mergeProgressEvents(run.progressEvents, [event]);
  const next = patchSubagentRun(runId, { progressEvents });
  const synced = next ? syncSubagentRunSupervisor(runId) : undefined;
  if (synced) {
    emitSubagentActivity(synced, event, 'subagent_progress');
    if (event.failureKind || event.domain || event.httpStatus) {
      emitSubagentActivity(synced, event, 'subagent_shared_context_updated');
    }
  }
  return synced;
}

function emitSubagentActivity(
  run: SubagentRunRecord,
  event: SubagentProgressEvent,
  kind: TaskActivityEvent['kind'],
): void {
  emitTaskActivityEvent({
    id: `act_${kind}_${event.id}`,
    taskId: run.parentTaskId,
    agentId: run.parentAgentId,
    kind,
    title: event.title || 'Subagent progress',
    detail: event.detail,
    timestamp: event.timestamp,
    status: event.status,
    toolName: event.toolName,
    messageId: event.messageId,
    recoverable: event.recoverable,
    subagentRunId: run.runId,
    subagentTaskId: run.childTaskId,
    parentTaskId: run.parentTaskId,
    metadata: {
      sourceUrl: event.sourceUrl,
      domain: event.domain,
      httpStatus: event.httpStatus,
      failureKind: event.failureKind,
      fallbackSuggested: event.fallbackSuggested,
    },
  });
}

export function diagnoseSubagentRun(runId: string): SubagentRunDetail | undefined {
  return syncSubagentRunSupervisor(runId) as SubagentRunDetail | undefined;
}

export function recordSubagentRecoveryStarted(
  runId: string,
  params: {
    action: 'resume' | 'retry' | 'replace' | 'cancel' | 'request_clarification' | 'manual_intervention';
    reason?: string;
    notes?: string;
  }
): { run?: SubagentRunRecord; recoveryId?: string } {
  const run = syncSubagentRunSupervisor(runId) || getSubagentRun(runId);
  if (!run) return {};
  const recoveryId = createRecoveryId();
  const entry = {
    id: recoveryId,
    action: params.action,
    status: 'running' as const,
    reason: params.reason,
    notes: params.notes,
    startedAt: nowIso(),
  };
  const next = patchSubagentRun(runId, {
    recoveryHistory: [...(run.recoveryHistory || []), entry],
    supervisor: {
      ...(run.supervisor || {}),
      state: 'recovering',
      recommendedAction: 'wait',
      recoveryAttempts: countRecoveryAttempts({ ...run, recoveryHistory: [...(run.recoveryHistory || []), entry] }),
    },
  });
  if (next) {
    emitTaskActivityEvent({
      id: `act_subagent_recovery_started_${recoveryId}`,
      taskId: next.parentTaskId,
      agentId: next.parentAgentId,
      kind: 'subagent_recovery_started',
      title: params.action === 'replace' ? 'Subagent replacement started' : 'Subagent recovery started',
      detail: params.reason || params.notes,
      timestamp: entry.startedAt,
      status: 'running',
      subagentRunId: next.runId,
      subagentTaskId: next.childTaskId,
      parentTaskId: next.parentTaskId,
      recoveryId,
    });
  }
  return { run: next, recoveryId };
}

export function recordSubagentRecoveryFinished(
  runId: string,
  recoveryId: string | undefined,
  params: {
    status: 'succeeded' | 'failed' | 'cancelled';
    replacementRunId?: string;
    error?: string;
    notes?: string;
  }
): SubagentRunRecord | undefined {
  const run = getSubagentRun(runId);
  if (!run) return undefined;
  const completedAt = nowIso();
  const recoveryHistory = (run.recoveryHistory || []).map((entry) => (
    recoveryId && entry.id === recoveryId
      ? {
        ...entry,
        status: params.status,
        completedAt,
        replacementRunId: params.replacementRunId,
        error: params.error,
        notes: params.notes ?? entry.notes,
      }
      : entry
  ));
  const next = patchSubagentRun(runId, { recoveryHistory });
  if (next) {
    emitTaskActivityEvent({
      id: `act_subagent_recovery_finished_${recoveryId || crypto.randomUUID()}`,
      taskId: next.parentTaskId,
      agentId: next.parentAgentId,
      kind: 'subagent_recovery_finished',
      title: params.status === 'succeeded' ? 'Subagent recovery finished' : 'Subagent recovery failed',
      detail: params.error || params.notes,
      timestamp: completedAt,
      status: params.status === 'succeeded' ? 'success' : params.status === 'cancelled' ? 'warning' : 'error',
      subagentRunId: next.runId,
      subagentTaskId: next.childTaskId,
      parentTaskId: next.parentTaskId,
      recoveryId,
    });
    if (params.status === 'succeeded') {
      emitTaskActivityEvent({
        id: `act_subagent_recovered_${recoveryId || crypto.randomUUID()}`,
        taskId: next.parentTaskId,
        agentId: next.parentAgentId,
        kind: 'subagent_recovered',
        title: 'Subagent recovered',
        detail: params.notes,
        timestamp: completedAt,
        status: 'success',
        subagentRunId: next.runId,
        subagentTaskId: next.childTaskId,
        parentTaskId: next.parentTaskId,
        recoveryId,
      });
    }
  }
  return next ? syncSubagentRunSupervisor(runId) : undefined;
}

export function buildReplacementPrompt(run: SubagentRunRecord, reason?: string): string {
  const synced = syncSubagentRunSupervisor(run.runId) || run;
  const partial = synced.resultBundle?.partialReport || synced.finalReport || synced.supervisor?.notes || '';
  const replacementReason = reason || synced.supervisor?.stalledReason;
  const buildHandoff = formatBuildHandoffForPrompt(synced.buildHandoff);
  const sharedContext = synced.sharedContext || buildSubagentSharedContext(synced.parentTaskId);
  const inheritedTools = synced.inheritedContext?.enabledToolsetIds?.length
    ? synced.inheritedContext.enabledToolsetIds.join(', ')
    : synced.inheritedContext?.toolsetIds?.join(', ');
  const blockedSources = sharedContext.blockedSources.length
    ? [
        'Blocked sources/tools to avoid:',
        ...sharedContext.blockedSources.slice(0, 8).map((source) => {
          const label = source.domain || source.sourceUrl || 'unknown source';
          const status = source.httpStatus ? ` HTTP ${source.httpStatus}` : '';
          const kind = source.failureKind ? ` ${source.failureKind}` : '';
          return `- ${label}${status}${kind}: ${source.example || 'avoid retrying this source'}`;
        }),
        ...sharedContext.blockedTools.slice(0, 6).map((tool) => `- Tool unavailable: ${tool}`),
      ].join('\n')
    : '';
  const fallbacks = sharedContext.successfulFallbacks.length
    ? ['Successful fallback methods already seen:', ...sharedContext.successfulFallbacks.slice(0, 5).map((item) => `- ${item}`)].join('\n')
    : '';
  return [
    'You are replacing a helper subagent that could not complete reliably.',
    '',
    `Original task:\n${synced.task}`,
    '',
    inheritedTools ? `Inherited toolsets available to this replacement:\n${inheritedTools}` : '',
    '',
    replacementReason ? `Reason replacement is needed:\n${replacementReason}` : '',
    '',
    blockedSources,
    '',
    fallbacks,
    '',
    partial ? `Useful partial findings from the previous child:\n${partial}` : 'No useful partial findings were captured from the previous child.',
    buildHandoff ? ['', buildHandoff].join('\n') : '',
    '',
    'Finish the original task. Avoid repeating the previous stuck behavior. Provide a complete final report for the parent agent.',
  ].filter(Boolean).join('\n');
}
