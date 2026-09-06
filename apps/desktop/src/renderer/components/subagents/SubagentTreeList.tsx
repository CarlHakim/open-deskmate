import type { ReactElement } from 'react';
import type { SubagentRunRecord, SubagentRunTreeNode } from '@accomplish/shared';
import { Archive, Eye, ExternalLink, Loader2, Play, RefreshCw, Square, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { canRequestSubagentRecovery, formatSubagentElapsed, formatSubagentModeLabel, formatSubagentProgressEvent, formatSubagentRunStatus, formatSubagentUpdatedAge, getSubagentBuildHandoffSummary, getSubagentLatestActivitySummary, getSubagentRecoverySummary, getSubagentResultBundleSummary, getSubagentRunIndicators, getSubagentRunStatusClasses, isActiveSubagentRun } from '../../lib/subagent-presentation';
import SubagentRunDetails from './SubagentRunDetails';
import SubagentTeamView from './SubagentTeamView';
export default function SubagentTreeList({
  nodes,
  level = 0,
  stoppingSubagentRunId,
  agentNames,
  onOpen,
  onInspect,
  onStop,
  onCloseSession,
  onArchive,
  onRecover,
  onReplace,
}: {
  nodes: SubagentRunTreeNode[];
  level?: number;
  stoppingSubagentRunId: string | null;
  agentNames: Map<string, string>;
  onOpen: (run: SubagentRunRecord) => void;
  onInspect: (run: SubagentRunRecord) => void;
  onStop: (runId: string) => void;
  onCloseSession?: (runId: string) => void;
  onArchive: (runId: string) => void;
  onRecover: (run: SubagentRunRecord) => void;
  onReplace: (run: SubagentRunRecord) => void;
}): ReactElement | null {
  if (nodes.length === 0) return null;
  return (
    <div className={cn('space-y-1.5', level > 0 ? 'ml-3 border-l border-border/50 pl-3 sm:ml-4' : '')}>
      {level === 0 && <SubagentTeamView key={nodes[0]?.parentTaskId} nodes={nodes} onOpen={onOpen} />}
      {nodes.map((run) => {
        const stoppable = isActiveSubagentRun(run);
        const childAgentName = agentNames.get(run.childAgentId) || run.childAgentId;
        const activitySummary = getSubagentLatestActivitySummary(run);
        const progressSummary = formatSubagentProgressEvent(run);
        const recoverySummary = getSubagentRecoverySummary(run);
        const resultBundleSummary = getSubagentResultBundleSummary(run);
        const buildHandoffSummary = getSubagentBuildHandoffSummary(run);
        const indicators = getSubagentRunIndicators(run);
        const canRecover = canRequestSubagentRecovery(run);
        const canReplace = canRecover && !run.replacedByRunId;
        const relayEnabled = run.status === 'done' && run.executionPolicy?.autoRelayCompletions === true;
        return (
          <div key={run.runId} className="rounded-md border border-border/50 bg-card/70 px-2 py-1.5 shadow-sm backdrop-blur-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <div className="truncate text-xs font-semibold text-foreground" title={run.label || run.task}>
                    {run.label || run.childAgentId}
                  </div>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', getSubagentRunStatusClasses(run.status, run.resultStatus))}>
                    {run.lifecycle === 'starting' ? 'Starting' : formatSubagentRunStatus(run.status, run.resultStatus)}
                  </span>
                  {relayEnabled ? (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                      Relay enabled
                    </span>
                  ) : null}
                  {indicators.map((indicator) => (
                    <span
                      key={`${run.runId}-${indicator.label}`}
                      className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', indicator.className)}
                      title={indicator.title}
                    >
                      {indicator.label}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span className="truncate">Child: {childAgentName}</span>
                  {run.model ? <span className="truncate">{run.model.provider}:{run.model.model}</span> : null}
                  <span>{formatSubagentModeLabel(run)}</span>
                  <span>Elapsed {formatSubagentElapsed(run)}</span>
                  <span>Updated {formatSubagentUpdatedAge(run.updatedAt)}</span>
                </div>
                <div className="mt-1 truncate text-[10px] text-muted-foreground" title={run.task}>
                  Goal: {run.task}
                </div>
                {activitySummary ? (
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={activitySummary}>
                    Latest: {activitySummary}
                  </div>
                ) : null}
                {progressSummary && progressSummary !== activitySummary ? (
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={progressSummary}>
                    Progress: {progressSummary}
                  </div>
                ) : null}
                {recoverySummary || resultBundleSummary ? (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {recoverySummary ? <span className="truncate" title={recoverySummary}>{recoverySummary}</span> : null}
                    {resultBundleSummary ? <span className="truncate" title={resultBundleSummary}>Results: {resultBundleSummary}</span> : null}
                  </div>
                ) : null}
                {buildHandoffSummary ? (
                  <div
                    className="mt-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-200"
                    title={run.buildHandoff?.diffSummary || buildHandoffSummary}
                  >
                    {buildHandoffSummary}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
                {canRecover ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-6 w-6"
                    onClick={() => onRecover(run)}
                    title="Ask subagent to recover"
                    aria-label="Ask subagent to recover"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {canReplace ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-6 w-6"
                    onClick={() => onReplace(run)}
                    title="Ask subagent to prepare replacement handoff"
                    aria-label="Ask subagent to prepare replacement handoff"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onOpen(run)}
                  title="Open subagent transcript"
                  aria-label="Open subagent transcript"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onInspect(run)}
                  title="Inspect in Subagents"
                  aria-label="Inspect in Subagents"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                {stoppable ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-6 w-6"
                    onClick={() => onStop(run.runId)}
                    disabled={stoppingSubagentRunId === run.runId}
                    title="Cancel child run"
                    aria-label="Cancel child run"
                  >
                    {stoppingSubagentRunId === run.runId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onCloseSession?.(run.runId)}
                  disabled={!onCloseSession}
                  title="Close child session"
                  aria-label="Close child session"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-6 w-6"
                  onClick={() => onArchive(run.runId)}
                  title="Archive subagent run"
                  aria-label="Archive subagent run"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <SubagentRunDetails run={run} />
            {run.children.length > 0 ? (
              <div className="mt-2">
                <SubagentTreeList
                  nodes={run.children}
                  level={level + 1}
                  stoppingSubagentRunId={stoppingSubagentRunId}
                  agentNames={agentNames}
                  onOpen={onOpen}
                  onInspect={onInspect}
                  onStop={onStop}
                  onCloseSession={onCloseSession}
                  onArchive={onArchive}
                  onRecover={onRecover}
                  onReplace={onReplace}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
