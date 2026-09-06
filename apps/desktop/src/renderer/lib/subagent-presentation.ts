import type { SubagentRunRecord, SubagentRunTreeNode, TaskMessage } from "@accomplish/shared";

export function hashForRenderVersion(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `${value.length}:${hash}`;
}

export function formatSubagentRunStatus(status: SubagentRunRecord['status'], resultStatus?: SubagentRunRecord['resultStatus']): string {
  if (status === 'done') {
    if (resultStatus === 'interrupted') return 'Interrupted';
    if (resultStatus === 'error') return 'Failed';
    return 'Completed';
  }
  if (status === 'error') return 'Failed';
  if (status === 'accepted') return 'Queued';
  return 'Running';
}

export function getSubagentRunStatusClasses(status: SubagentRunRecord['status'], resultStatus?: SubagentRunRecord['resultStatus']): string {
  if (status === 'done' && resultStatus === 'success') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if ((status === 'done' && resultStatus === 'interrupted') || status === 'accepted') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'error' || (status === 'done' && resultStatus === 'error')) return 'bg-destructive/10 text-destructive';
  return 'bg-sky-500/10 text-sky-700 dark:text-sky-300';
}

export function formatSubagentModeLabel(run: Pick<SubagentRunRecord, 'mode' | 'sessionState' | 'reuseCount'> & { childTaskStatus?: string }): string {
  const parts = [run.mode === 'session' ? 'Session mode' : 'Run mode'];
  if (run.mode === 'session' && run.sessionState) {
    parts.push(`session ${run.sessionState}`);
  }
  if (run.mode === 'run' && run.childTaskStatus) {
    parts.push(`task ${run.childTaskStatus}`);
  }
  if (typeof run.reuseCount === 'number' && run.reuseCount > 0) {
    parts.push(`reused ${run.reuseCount}x`);
  }
  return parts.join(' · ');
}

export function isActiveSubagentRun(run: Pick<SubagentRunRecord, 'status'>): boolean {
  return run.status === 'running' || run.status === 'accepted';
}

export function formatSubagentShortDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatSubagentElapsed(run: Pick<SubagentRunRecord, 'createdAt' | 'updatedAt' | 'completedAt' | 'status'>): string {
  const started = Date.parse(run.createdAt);
  if (!Number.isFinite(started)) return 'n/a';
  const updated = Date.parse(run.updatedAt);
  const completed = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  const ended = Number.isFinite(completed)
    ? completed
    : isActiveSubagentRun(run)
      ? Date.now()
      : Number.isFinite(updated)
        ? updated
        : Date.now();
  return formatSubagentShortDuration(ended - started);
}

export function formatSubagentUpdatedAge(value?: string): string {
  if (!value) return 'n/a';
  const updated = Date.parse(value);
  if (!Number.isFinite(updated)) return 'n/a';
  return `${formatSubagentShortDuration(Date.now() - updated)} ago`;
}

export function compactSubagentActivitySummary(value: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= 420) return normalized;
  return `${normalized.slice(0, 420).trimEnd()}...`;
}

export function getSubagentLatestProgressEvent(run: Pick<SubagentRunRecord, 'progressEvents'>): NonNullable<SubagentRunRecord['progressEvents']>[number] | null {
  const events = run.progressEvents || [];
  if (events.length === 0) return null;
  return events.reduce((latest, event) => {
    const latestTime = Date.parse(latest.timestamp);
    const eventTime = Date.parse(event.timestamp);
    if (!Number.isFinite(eventTime)) return latest;
    if (!Number.isFinite(latestTime) || eventTime >= latestTime) return event;
    return latest;
  }, events[0]);
}

export function formatSubagentProgressEvent(run: Pick<SubagentRunRecord, 'progressEvents'>): string | null {
  const event = getSubagentLatestProgressEvent(run);
  if (!event) return null;
  const parts = [
    event.title || event.currentStep || event.type,
    typeof event.percentage === 'number' ? `${Math.round(event.percentage)}%` : null,
    typeof event.completedSteps === 'number' && typeof event.totalSteps === 'number'
      ? `${event.completedSteps}/${event.totalSteps}`
      : null,
    event.detail,
  ].filter(Boolean);
  return compactSubagentActivitySummary(parts.join(' · '));
}

export function getSubagentRecoverySummary(run: Pick<SubagentRunRecord, 'recoveryHistory'>): string | null {
  const history = run.recoveryHistory || [];
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  return `${history.length} recovery ${history.length === 1 ? 'attempt' : 'attempts'} · ${latest.action} ${latest.status}`;
}

export function getSubagentResultBundleSummary(run: Pick<SubagentRunRecord, 'resultBundle'>): string | null {
  const bundle = run.resultBundle;
  if (!bundle) return null;
  const itemCount = bundle.items?.length || 0;
  const missingCount = bundle.missingExpectedOutputIds?.length || 0;
  if (missingCount > 0) return `${itemCount} outputs · ${missingCount} missing`;
  return `${itemCount} outputs`;
}

export function getSubagentBuildHandoffSummary(run: Pick<SubagentRunRecord, 'buildHandoff'>): string | null {
  const handoff = run.buildHandoff;
  if (!handoff) return null;
  const changedCount = handoff.changedFiles?.length ?? handoff.gitSummary?.changedFileCount ?? 0;
  const stats = handoff.gitSummary
    ? `+${handoff.gitSummary.totalAddedLines} -${handoff.gitSummary.totalDeletedLines}`
    : null;
  const mode = handoff.diffMode || (handoff.baselineId ? 'synthetic' : 'workspace');
  const generated = handoff.generatedAt ? ` · refreshed ${new Date(handoff.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return `Build handoff: ${changedCount} file${changedCount === 1 ? '' : 's'}${stats ? ` · ${stats}` : ''} · ${mode}${generated}`;
}

export function getSubagentRunIndicators(run: SubagentRunRecord): Array<{ label: string; title: string; className: string }> {
  const latestProgress = getSubagentLatestProgressEvent(run);
  const heartbeatAt = Date.parse(run.supervisor?.heartbeatAt || run.supervisor?.lastCheckedAt || run.updatedAt);
  const latestProgressAt = latestProgress ? Date.parse(latestProgress.timestamp) : Number.NaN;
  const latestActivityAt = Math.max(
    Number.isFinite(heartbeatAt) ? heartbeatAt : 0,
    Number.isFinite(latestProgressAt) ? latestProgressAt : 0
  );
  const stale = isActiveSubagentRun(run) && latestActivityAt > 0 && Date.now() - latestActivityAt > 10 * 60_000;
  const stuck = Boolean(run.supervisor?.stallDetectedAt || run.supervisor?.stalledReason || latestProgress?.type === 'blocked');
  const recovering = Boolean((run.recoveryHistory || []).some((entry) => entry.status === 'planned' || entry.status === 'running'));
  const indicators: Array<{ label: string; title: string; className: string }> = [];
  if (stale) {
    indicators.push({
      label: 'Stale',
      title: `No heartbeat or progress for ${formatSubagentShortDuration(Date.now() - latestActivityAt)}`,
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    });
  }
  if (stuck) {
    indicators.push({
      label: 'Stuck',
      title: run.supervisor?.stalledReason || latestProgress?.detail || 'Supervisor marked this run as blocked',
      className: 'bg-destructive/10 text-destructive',
    });
  }
  if (recovering) {
    indicators.push({
      label: 'Recovering',
      title: getSubagentRecoverySummary(run) || 'Recovery is in progress',
      className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    });
  }
  if (run.replacesRunId) {
    indicators.push({
      label: `Replaces ${run.replacesRunId.slice(0, 8)}`,
      title: `Replacement for run ${run.replacesRunId}`,
      className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    });
  }
  if (run.replacedByRunId) {
    indicators.push({
      label: `Replaced by ${run.replacedByRunId.slice(0, 8)}`,
      title: `Superseded by run ${run.replacedByRunId}`,
      className: 'bg-muted text-muted-foreground',
    });
  }
  return indicators;
}

export function canRequestSubagentRecovery(run: SubagentRunRecord): boolean {
  const latestProgress = getSubagentLatestProgressEvent(run);
  return isActiveSubagentRun(run) && Boolean(run.supervisor?.recoveryEligible || latestProgress?.recoverable || run.supervisor?.stallDetectedAt);
}

export function getSubagentLatestActivitySummary(run: SubagentRunRecord & { childTaskSummary?: string; childTaskStatus?: string }): string | null {
  const finalReport = run.finalReport?.trim();
  if (finalReport) return compactSubagentActivitySummary(finalReport);
  const progressSummary = formatSubagentProgressEvent(run);
  if (progressSummary) return progressSummary;
  const childSummary = run.childTaskSummary?.trim();
  if (childSummary) return compactSubagentActivitySummary(childSummary);
  const lastPrompt = run.lastPrompt?.trim();
  if (lastPrompt && lastPrompt !== run.task.trim()) return `Latest prompt: ${lastPrompt}`;
  if (run.childTaskStatus) return `Child task ${run.childTaskStatus}`;
  return null;
}

export type RelayedSubagentCompletionMeta = {
  childAgentId: string;
  label?: string;
};

export function getRelayedSubagentCompletionMeta(message: Pick<TaskMessage, 'type' | 'content'>): RelayedSubagentCompletionMeta | null {
  const content = String(message.content || '').trim();
  if (
    message.type !== 'assistant'
    || !/\nStatus:\s*\S+/i.test(content)
    || !/\nSession:\s*\S+/i.test(content)
  ) {
    return null;
  }
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const match = firstLine.match(/^Subagent\s+(.+?)\s+completed\./i);
  if (!match) return null;
  const rawChildLabel = match[1].trim();
  const labelledChild = rawChildLabel.match(/^(.*?)\s+\((.*?)\)$/);
  const childAgentId = (labelledChild?.[1] || rawChildLabel).trim();
  if (!childAgentId) return null;
  return {
    childAgentId,
    label: labelledChild?.[2]?.trim() || undefined,
  };
}

export function isRelayedSubagentCompletionMessage(message: Pick<TaskMessage, 'type' | 'content'>): boolean {
  return Boolean(getRelayedSubagentCompletionMeta(message));
}

export function compactSubagentTextSignature(value: string | undefined | null, maxInlineChars = 160): string {
  if (!value) return '';
  return value.length <= maxInlineChars ? value : hashForRenderVersion(value);
}

export function buildSubagentPartSignature(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => part ?? '').join('\u001f');
}

export function getSubagentProgressEventsSignature(events: SubagentRunRecord['progressEvents']): string {
  if (!events?.length) return '0';
  const recentEvents = events.slice(-8).map((event) => buildSubagentPartSignature([
    event.id,
    event.type,
    event.timestamp,
    event.status,
    event.toolName,
    event.messageId,
    event.percentage,
    event.currentStep,
    event.totalSteps,
    event.completedSteps,
    event.recoverable,
    event.domain,
    event.httpStatus,
    event.failureKind,
    compactSubagentTextSignature(event.title, 80),
    compactSubagentTextSignature(event.detail, 80),
    compactSubagentTextSignature(event.fallbackSuggested, 80),
  ]));
  return `${events.length}\u001e${recentEvents.join('\u001e')}`;
}

export function getSubagentSupervisorSignature(supervisor: SubagentRunRecord['supervisor']): string {
  if (!supervisor) return '';
  return buildSubagentPartSignature([
    supervisor.state,
    supervisor.lastCheckedAt,
    supervisor.nextCheckAt,
    supervisor.heartbeatAt,
    supervisor.lastProgressAt,
    supervisor.lastMeaningfulProgressAt,
    supervisor.stallDetectedAt,
    supervisor.stalledReason,
    supervisor.staleReason,
    supervisor.stuckReason,
    supervisor.blockedReason,
    supervisor.repeatedToolName,
    supervisor.repeatedToolCount,
    supervisor.blockedSourceDomain,
    supervisor.blockedSourceUrl,
    supervisor.blockedHttpStatus,
    supervisor.blockedFailureKind,
    supervisor.blockedSourceCount,
    supervisor.recommendedAction,
    supervisor.recoveryEligible,
    supervisor.recoveryAttempts,
    compactSubagentTextSignature(supervisor.notes, 120),
  ]);
}

export function getSubagentResultBundleSignature(bundle: SubagentRunRecord['resultBundle']): string {
  if (!bundle) return '';
  const itemSignature = (bundle.items || []).map((item) => buildSubagentPartSignature([
    item.id,
    item.kind,
    item.label,
    item.path,
    compactSubagentTextSignature(item.content, 120),
  ])).join('\u001e');
  return buildSubagentPartSignature([
    bundle.generatedAt,
    bundle.finalReportTruncated,
    compactSubagentTextSignature(bundle.summary, 160),
    compactSubagentTextSignature(bundle.partialReport, 160),
    compactSubagentTextSignature(bundle.finalReport, 160),
    bundle.missingExpectedOutputIds?.join(',') || '',
    bundle.items?.length || 0,
    itemSignature,
  ]);
}

export function getSubagentRecoveryHistorySignature(history: SubagentRunRecord['recoveryHistory']): string {
  if (!history?.length) return '0';
  return history.map((entry) => buildSubagentPartSignature([
    entry.id,
    entry.action,
    entry.status,
    entry.startedAt,
    entry.completedAt,
    entry.replacementRunId,
    compactSubagentTextSignature(entry.reason, 100),
    compactSubagentTextSignature(entry.error, 100),
    compactSubagentTextSignature(entry.notes, 100),
  ])).join('\u001e');
}

export function getSubagentInheritedContextSignature(context: SubagentRunRecord['inheritedContext']): string {
  if (!context) return '';
  return buildSubagentPartSignature([
    context.workingDirectory,
    context.privacyMode,
    context.buildMode,
    context.buildWorkspaceRelativePath,
    context.attachedFiles?.join(',') || '',
    context.toolsetIds?.join(',') || '',
    context.deferredToolDiscoveryEnabled,
    context.enabledToolsetIds?.join(',') || '',
    context.availableToolsetIds?.join(',') || '',
    context.inheritedToolsetIds?.join(',') || '',
  ]);
}

export function getSubagentSharedContextSignature(context: SubagentRunRecord['sharedContext']): string {
  if (!context) return '';
  const blockedSources = (context.blockedSources || []).map((source) => buildSubagentPartSignature([
    source.domain,
    source.sourceUrl,
    source.httpStatus,
    source.failureKind,
    source.count,
    source.lastSeenAt,
    compactSubagentTextSignature(source.example, 80),
  ])).join('\u001e');
  return buildSubagentPartSignature([
    context.generatedAt,
    blockedSources,
    context.blockedTools?.join(',') || '',
    context.successfulFallbacks?.join(',') || '',
    context.confirmedFindings?.length || 0,
    context.openGaps?.length || 0,
  ]);
}

export function getSubagentBuildHandoffSignature(handoff: SubagentRunRecord['buildHandoff']): string {
  if (!handoff) return '';
  const changedFiles = (handoff.changedFiles || []).slice(0, 80).map((file) => buildSubagentPartSignature([
    file.relativePath,
    file.changeType,
    file.addedLines,
    file.deletedLines,
    file.beforeTruncated,
    file.afterTruncated,
  ])).join('\u001e');
  return buildSubagentPartSignature([
    handoff.workspaceAgentId,
    handoff.workspaceRelativePath,
    handoff.baselineId,
    handoff.diffMode,
    handoff.diffAvailable,
    handoff.diffSummary,
    handoff.changedFiles?.length || 0,
    changedFiles,
    handoff.patchTruncated,
    compactSubagentTextSignature(handoff.patchExcerpt, 120),
    handoff.gitSummary?.branch,
    handoff.gitSummary?.dirty,
    handoff.gitSummary?.changedFileCount,
    handoff.gitSummary?.totalAddedLines,
    handoff.gitSummary?.totalDeletedLines,
    handoff.generatedAt,
  ]);
}

export function getSubagentRunSignature(run: SubagentRunRecord & { childTaskStatus?: string; childTaskSummary?: string }): string {
  return buildSubagentPartSignature([
    JSON.stringify([run.lifecycle, run.startedAt, run.queuedAt, run.resultDelivery, run.ownedPaths, run.ownershipConflicts, run.worktree, run.costUsd, run.costIncomplete, run.limitReached, run.executionPolicy?.limitAction, run.executionPolicy?.maxCostUsd]),
    run.runId,
    run.childTaskId,
    run.childSessionKey,
    run.sessionId,
    run.sessionState,
    run.parentTaskId,
    run.parentRunId,
    run.parentSessionKey,
    run.parentAgentId,
    run.childAgentId,
    run.persistentKey,
    run.label,
    compactSubagentTextSignature(run.task, 160),
    compactSubagentTextSignature(run.lastPrompt, 160),
    run.depth,
    run.mode,
    run.reuseCount,
    run.status,
    run.resultStatus,
    compactSubagentTextSignature(run.error, 160),
    compactSubagentTextSignature(run.finalReport, 160),
    run.finalReportTruncated,
    getSubagentProgressEventsSignature(run.progressEvents),
    getSubagentSupervisorSignature(run.supervisor),
    run.expectedOutputs?.length || 0,
    getSubagentResultBundleSignature(run.resultBundle),
    getSubagentRecoveryHistorySignature(run.recoveryHistory),
    run.replacesRunId,
    run.replacedByRunId,
    run.replacementReason,
    run.model?.provider,
    run.model?.model,
    run.executionPolicy?.mode,
    run.executionPolicy?.maxChildren,
    run.executionPolicy?.maxDepth,
    run.executionPolicy?.runTimeoutMs,
    run.executionPolicy?.autoRelayCompletions,
    getSubagentInheritedContextSignature(run.inheritedContext),
    getSubagentSharedContextSignature(run.sharedContext),
    getSubagentBuildHandoffSignature(run.buildHandoff),
    run.childTaskStatus,
    compactSubagentTextSignature(run.childTaskSummary, 160),
    run.createdAt,
    run.updatedAt,
    run.completedAt,
    run.lastResumedAt,
    run.archivedAt,
    run.closedAt,
  ]);
}

export function preserveEquivalentSubagentRunReferences<T extends SubagentRunRecord>(current: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return current.length === 0 ? current : incoming;
  const currentById = new Map(current.map((run) => [run.runId, run]));
  let changed = incoming.length !== current.length;
  const next = incoming.map((run, index) => {
    const existing = currentById.get(run.runId);
    if (existing && getSubagentRunSignature(existing) === getSubagentRunSignature(run)) {
      if (current[index] !== existing) changed = true;
      return existing as T;
    }
    changed = true;
    return run;
  });
  return changed ? next : current;
}

export function preserveEquivalentSubagentTreeReferences(current: SubagentRunTreeNode[], incoming: SubagentRunTreeNode[]): SubagentRunTreeNode[] {
  if (incoming.length === 0) return current.length === 0 ? current : incoming;
  const currentById = new Map(current.map((run) => [run.runId, run]));
  let changed = incoming.length !== current.length;
  const next = incoming.map((run, index) => {
    const existing = currentById.get(run.runId);
    const children = preserveEquivalentSubagentTreeReferences(existing?.children || [], run.children || []);
    const sameRun = existing && getSubagentRunSignature(existing) === getSubagentRunSignature(run);
    if (sameRun && children === existing.children) {
      if (current[index] !== existing) changed = true;
      return existing;
    }
    changed = true;
    return children === run.children ? run : { ...run, children };
  });
  return changed ? next : current;
}
