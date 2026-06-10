import type { TaskActivityEvent } from '@accomplish/shared';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock3, RotateCcw, ScrollText, StepForward, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DISMISSED_RECOVERY_STORAGE_KEY = 'opendeskmate-dismissed-task-recovery-events';
const HIDDEN_ACTIVITY_CHAIN_STORAGE_KEY = 'opendeskmate-hidden-task-activity-chains';
const ACTIVITY_HIDDEN_BY_DEFAULT_STORAGE_KEY = 'opendeskmate-activity-hidden-by-default';

const STATUS_CLASSES: Record<string, string> = {
  running: 'bg-primary/10 text-primary',
  pending: 'bg-amber-500/10 text-amber-600',
  warning: 'bg-amber-500/10 text-amber-600',
  error: 'bg-destructive/10 text-destructive',
  success: 'bg-green-500/10 text-green-600',
  info: 'bg-muted text-muted-foreground',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ActivityIcon({ event }: { event: TaskActivityEvent }) {
  if (event.kind === 'stall_detected') return <AlertTriangle className="h-3.5 w-3.5" />;
  if (event.kind === 'tool_started' || event.kind === 'tool_finished') return <Wrench className="h-3.5 w-3.5" />;
  if (event.status === 'success') return <CheckCircle2 className="h-3.5 w-3.5" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

function readDismissedRecoveryIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_RECOVERY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDismissedRecoveryIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISSED_RECOVERY_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(-300)));
  } catch {
    // Ignore storage failures; dismissal still works for this render.
  }
}

function readHiddenActivityChains(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_ACTIVITY_CHAIN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeHiddenActivityChains(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_ACTIVITY_CHAIN_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(-300)));
  } catch {
    // Ignore storage failures; hiding still works for this render.
  }
}

function readActivityHiddenByDefault(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ACTIVITY_HIDDEN_BY_DEFAULT_STORAGE_KEY) === 'true';
}

function writeActivityHiddenByDefault(hidden: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVITY_HIDDEN_BY_DEFAULT_STORAGE_KEY, hidden ? 'true' : 'false');
  } catch {
    // Ignore storage failures; the current render still updates.
  }
}

export default function TaskActivityTimeline({
  activity,
  onContinue,
  onRetry,
  onViewRawLog,
  busy = false,
  className,
}: {
  activity?: TaskActivityEvent[];
  onContinue?: () => void;
  onRetry?: () => void;
  onViewRawLog?: () => void;
  busy?: boolean;
  className?: string;
}) {
  const [dismissedRecoveryIds, setDismissedRecoveryIds] = useState<Set<string>>(() => readDismissedRecoveryIds());
  const [hiddenActivityChains, setHiddenActivityChains] = useState<Set<string>>(() => readHiddenActivityChains());
  const [activityHiddenByDefault, setActivityHiddenByDefault] = useState(() => readActivityHiddenByDefault());
  const [activityExpanded, setActivityExpanded] = useState(false);
  const events = (activity || [])
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = events.slice(-8);
  const latestEvent = events[events.length - 1];
  const activityChainId = latestEvent ? `${latestEvent.taskId}:${latestEvent.id}` : null;
  const recoverable = useMemo(
    () => {
      for (const event of [...events].reverse()) {
        if (dismissedRecoveryIds.has(event.id)) continue;
        if (event.kind !== 'stall_detected' || !event.recoverable) continue;

        const laterEvents = events.filter((candidate) => candidate.timestamp > event.timestamp);
        const laterWorkContinued = laterEvents.some((candidate) => (
          candidate.kind === 'assistant_message'
          || candidate.kind === 'tool_started'
          || candidate.kind === 'tool_finished'
          || candidate.kind === 'permission_requested'
          || candidate.kind === 'permission_resolved'
          || candidate.kind === 'recovery_started'
        ));
        if (laterWorkContinued) continue;

        const taskFinishedAfterStall = laterEvents.some((candidate) => (
          candidate.kind === 'task_finished' && candidate.status === 'success'
        ));
        if (taskFinishedAfterStall) return event;
      }
      return undefined;
    },
    [dismissedRecoveryIds, events]
  );
  if (events.length === 0) return null;
  const hasProblem = Boolean(recoverable);
  const hiddenForChain = Boolean(activityChainId && hiddenActivityChains.has(activityChainId));

  const setPersistentActivityHidden = (hidden: boolean) => {
    setActivityHiddenByDefault(hidden);
    writeActivityHiddenByDefault(hidden);
  };

  const hideActivity = () => {
    if (!activityChainId) return;
    setHiddenActivityChains((current) => {
      const next = new Set(current);
      next.add(activityChainId);
      writeHiddenActivityChains(next);
      return next;
    });
  };

  const showActivity = () => {
    if (activityChainId) {
      setHiddenActivityChains((current) => {
        const next = new Set(current);
        next.delete(activityChainId);
        writeHiddenActivityChains(next);
        return next;
      });
    }
    setPersistentActivityHidden(false);
    setActivityExpanded(true);
  };

  const dismissRecovery = () => {
    if (!recoverable) return;
    setDismissedRecoveryIds((current) => {
      const next = new Set(current);
      next.add(recoverable.id);
      writeDismissedRecoveryIds(next);
      return next;
    });
  };

  if (hiddenForChain) {
    return null;
  }

  if (activityHiddenByDefault && !hasProblem) {
    return null;
  }

  const recoveryIsFailure = recoverable?.kind === 'task_finished' && recoverable.status === 'error';
  const recoveryTitle = recoveryIsFailure ? 'Task failed' : 'Final answer missing';
  const recoveryDescription = recoveryIsFailure
    ? 'The agent stopped with an error before completing. Continue asks it to resume from the existing session and current workspace state.'
    : 'The agent finished tool work without sending a final answer. Continue asks it to answer from the tool results already in the session.';

  return (
    <div className={cn('max-w-full overflow-hidden rounded-lg border border-border/70 bg-card/40 p-3', className)}>
      {recoverable ? (
        <div className={cn(
          'mb-2 rounded-md border px-2.5 py-2',
          recoveryIsFailure ? 'border-destructive/30 bg-destructive/10' : 'border-amber-500/30 bg-amber-500/10'
        )}>
          <div className="grid min-w-0 gap-1.5">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                recoveryIsFailure ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'
              )} />
              <div className="min-w-0 flex-1">
                <div className={cn(
                  'truncate text-xs font-medium',
                  recoveryIsFailure ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'
                )}>
                  {recoveryTitle}
                </div>
                <p className="mt-0.5 line-clamp-1 whitespace-normal text-[11px] leading-snug text-muted-foreground">
                  {recoveryDescription}
                </p>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={dismissRecovery} title="Dismiss">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(74px,1fr))] gap-1.5">
              <Button size="sm" className="h-7 min-w-0 px-2 text-[11px]" onClick={onContinue} disabled={!onContinue || busy}>
                <StepForward className="mr-1.5 h-3.5 w-3.5" />
                <span className="truncate">Continue</span>
              </Button>
              <Button size="sm" variant="outline" className="h-7 min-w-0 px-2 text-[11px]" onClick={onRetry} disabled={!onRetry || busy}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                <span className="truncate">Retry</span>
              </Button>
              <Button size="sm" variant="ghost" className="h-7 min-w-0 px-2 text-[11px]" onClick={onViewRawLog} disabled={!onViewRawLog}>
                <ScrollText className="mr-1.5 h-3.5 w-3.5" />
                <span className="truncate">Raw log</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setActivityExpanded((current) => !current)}
          aria-expanded={activityExpanded}
        >
          {activityExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Activity</span>
          {!activityExpanded && latestEvent ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {latestEvent.title}{latestEvent.detail ? `: ${latestEvent.detail}` : ''}
            </span>
          ) : null}
        </button>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-muted-foreground">{events.length} events</div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setPersistentActivityHidden(true)}
            title="Hide activity by default unless something goes wrong"
          >
            Hide by default
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={hideActivity} title="Hide activity">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {activityExpanded ? (
      <div className="mt-2 space-y-1.5">
        {latest.map((event) => (
          <div key={event.id} className="flex items-start gap-2 text-xs">
            <span className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full', STATUS_CLASSES[event.status || 'info'] || STATUS_CLASSES.info)}>
              <ActivityIcon event={event} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-foreground">{event.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(event.timestamp)}</span>
              </div>
              {event.detail ? (
                <div className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
                  {event.detail}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      ) : null}
    </div>
  );
}
