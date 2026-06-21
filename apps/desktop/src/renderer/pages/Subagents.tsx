import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { ProviderConfig, SubagentRunDetail, Task, TaskMessage } from '@accomplish/shared';
import { getAccomplish } from '@/lib/accomplish';
import { useAgentStore } from '@/stores/agentStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { AgentAvatarIcon } from '@/components/layout/AgentAvatarPicker';
import { Archive, Bot, ExternalLink, Loader2, RefreshCw, Search, Send, Square, Users, X, XCircle } from 'lucide-react';

type StatusFilter = 'all' | 'active' | 'session' | 'archived' | 'closed';

type ModelOption = {
  value: string;
  providerId: string;
  modelId: string;
  baseUrl?: string;
  displayName: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  xai: 'xAI',
  ollama: 'Ollama',
};

function formatSubagentRunStatus(status: SubagentRunDetail['status'], resultStatus?: SubagentRunDetail['resultStatus']): string {
  if (status === 'done') {
    if (resultStatus === 'interrupted') return 'Interrupted';
    if (resultStatus === 'error') return 'Failed';
    return 'Completed';
  }
  if (status === 'error') return 'Failed';
  if (status === 'accepted') return 'Queued';
  return 'Running';
}

function getSubagentRunStatusClasses(status: SubagentRunDetail['status'], resultStatus?: SubagentRunDetail['resultStatus']): string {
  if (status === 'done' && resultStatus === 'success') return 'bg-emerald-500/10 text-emerald-700';
  if ((status === 'done' && resultStatus === 'interrupted') || status === 'accepted') return 'bg-amber-500/10 text-amber-700';
  if (status === 'error' || (status === 'done' && resultStatus === 'error')) return 'bg-destructive/10 text-destructive';
  return 'bg-sky-500/10 text-sky-700';
}

function formatSubagentModeLabel(run: Pick<SubagentRunDetail, 'mode' | 'sessionState' | 'reuseCount'>): string {
  const parts = [run.mode === 'session' ? 'Session mode' : 'Run mode'];
  if (run.mode === 'session' && run.sessionState) {
    parts.push(`session ${run.sessionState}`);
  }
  if (typeof run.reuseCount === 'number' && run.reuseCount > 0) {
    parts.push(`reused ${run.reuseCount}x`);
  }
  return parts.join(' · ');
}

function formatSubagentModeDetail(run: Pick<SubagentRunDetail, 'mode' | 'sessionState' | 'reuseCount' | 'childTaskStatus'>): string {
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

function formatMessageType(message: TaskMessage): string {
  if (message.type === 'assistant') return 'Assistant';
  if (message.type === 'user') return 'User';
  if (message.type === 'tool') return 'Tool';
  return message.type;
}

function getMessageCardClasses(message: TaskMessage): string {
  if (message.type === 'user') return 'border-primary/20 bg-primary/5';
  if (message.type === 'assistant') return 'border-border/60 bg-background';
  if (message.type === 'tool') return 'border-border/50 bg-muted/20';
  return 'border-border/50 bg-muted/10';
}

function formatRelativeTime(value?: string): string {
  if (!value) return '—';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return `${months}mo`;
}

export default function SubagentsPage() {
  const accomplish = getAccomplish();
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, loadAgents } = useAgentStore();

  const [runs, setRuns] = useState<SubagentRunDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [includeArchived, setIncludeArchived] = useState(true);
  const [detailRun, setDetailRun] = useState<SubagentRunDetail | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPrompt, setDetailPrompt] = useState('');
  const [detailSending, setDetailSending] = useState(false);
  const [detailMutating, setDetailMutating] = useState(false);
  const [detailModelOverride, setDetailModelOverride] = useState('');
  const [modelProviders, setModelProviders] = useState<ProviderConfig[]>([]);
  const [modelApiKeyStatus, setModelApiKeyStatus] = useState<Record<string, { exists: boolean; prefix?: string }>>({});

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextFilter = params.get('filter');
    const nextQuery = params.get('q');
    const includeArchivedParam = params.get('archived');
    const normalizedFilter: StatusFilter =
      nextFilter === 'active'
      || nextFilter === 'session'
      || nextFilter === 'archived'
      || nextFilter === 'closed'
        ? nextFilter
        : 'all';
    setStatusFilter(normalizedFilter);
    if (typeof nextQuery === 'string') {
      setQuery(nextQuery);
    }
    if (includeArchivedParam === '1' || normalizedFilter === 'archived' || normalizedFilter === 'closed') {
      setIncludeArchived(true);
    }
  }, [location.search]);

  const refreshRuns = useCallback(async (showBusy = false) => {
    if (showBusy) setRefreshing(true);
    try {
      const result = await accomplish.listAllSubagents({ includeArchived });
      setRuns(result.runs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (showBusy) setRefreshing(false);
    }
  }, [accomplish, includeArchived]);

  const loadDetail = useCallback(async (run: SubagentRunDetail, options?: { showLoading?: boolean; replaceRun?: boolean }) => {
    if (options?.replaceRun !== false) {
      setDetailRun(run);
    }
    if (options?.showLoading !== false) {
      setDetailLoading(true);
    }
    try {
      const [freshRun, task] = await Promise.all([
        accomplish.getSubagent({ runId: run.runId }),
        accomplish.getTask(run.childTaskId, run.childAgentId),
      ]);
      setDetailRun((current) => {
        if (current && current.runId !== run.runId) return current;
        return freshRun ?? current ?? run;
      });
      setDetailTask(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (options?.showLoading !== false) {
        setDetailLoading(false);
      }
    }
  }, [accomplish]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      accomplish.listModelProviders(),
      accomplish.getAllApiKeys(),
    ])
      .then(([providers, apiKeys]) => {
        if (cancelled) return;
        setModelProviders(Array.isArray(providers) ? providers : []);
        setModelApiKeyStatus(apiKeys ?? {});
      })
      .catch(() => {
        if (cancelled) return;
        setModelProviders([]);
        setModelApiKeyStatus({});
      });
    return () => {
      cancelled = true;
    };
  }, [accomplish]);

  useEffect(() => {
    void refreshRuns();
    const timer = window.setInterval(() => {
      void refreshRuns();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshRuns]);

  useEffect(() => {
    if (!detailRun) {
      setDetailTask(null);
      setDetailPrompt('');
      setDetailModelOverride('');
      return;
    }
    void loadDetail(detailRun, { showLoading: true, replaceRun: false });
    const timer = window.setInterval(() => {
      void loadDetail(detailRun, { showLoading: false, replaceRun: false });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [detailRun?.runId, loadDetail]);

  const availableModelOptions = useMemo(() => (
    modelProviders
      .filter((provider) => {
        const hasModels = Array.isArray(provider.models) && provider.models.length > 0;
        if (!hasModels) return false;
        if (provider.requiresApiKey === false || provider.id === 'ollama') return true;
        return Boolean(modelApiKeyStatus?.[provider.id]?.exists);
      })
      .flatMap((provider) => provider.models.map((model) => ({
        value: `${provider.id}::${model.fullId}::${provider.baseUrl || ''}`,
        providerId: String(provider.id),
        modelId: model.fullId,
        baseUrl: provider.baseUrl,
        displayName: `${PROVIDER_LABELS[String(provider.id).toLowerCase()] || provider.name}: ${model.displayName}`,
      } satisfies ModelOption)))
  ), [modelApiKeyStatus, modelProviders]);

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...runs]
      .filter((run) => {
        if (statusFilter === 'active' && !(run.status === 'running' || run.status === 'accepted')) return false;
        if (statusFilter === 'session' && run.mode !== 'session') return false;
        if (statusFilter === 'archived' && !run.archivedAt) return false;
        if (statusFilter === 'closed' && !run.closedAt) return false;
        if (!needle) return true;
        const haystack = [run.label, run.task, run.childAgentId, run.parentAgentId, run.childTaskId, run.parentTaskId, run.childTaskSummary]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => {
        const aActive = a.status === 'running' || a.status === 'accepted' ? 1 : 0;
        const bActive = b.status === 'running' || b.status === 'accepted' ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [query, runs, statusFilter]);

  const counts = useMemo(() => ({
    active: runs.filter((run) => run.status === 'running' || run.status === 'accepted').length,
    session: runs.filter((run) => run.mode === 'session').length,
    archived: runs.filter((run) => Boolean(run.archivedAt)).length,
  }), [runs]);

  const handleClosePage = useCallback(() => {
    const previousPath = typeof location.state === 'object' && location.state && 'from' in location.state
      ? String((location.state as { from?: unknown }).from || '').trim()
      : '';
    if (previousPath) {
      navigate(previousPath);
      return;
    }
    const targetRun = detailRun || filteredRuns[0] || null;
    if (targetRun?.parentTaskId) {
      navigate(`/execution/${targetRun.parentTaskId}`);
      return;
    }
    navigate('/');
  }, [detailRun, filteredRuns, location.state, navigate]);

  const stopRun = useCallback(async (runId: string) => {
    try {
      await accomplish.stopSubagent({ runId });
      await refreshRuns();
      if (detailRun?.runId === runId) {
        const refreshed = await accomplish.getSubagent({ runId });
        setDetailRun(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accomplish, detailRun?.runId, refreshRuns]);

  const archiveRun = useCallback(async (runId: string, archived: boolean) => {
    setDetailMutating(true);
    try {
      const next = await accomplish.archiveSubagent({ runId, archived });
      setDetailRun((current) => current?.runId === runId ? next : current);
      await refreshRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailMutating(false);
    }
  }, [accomplish, refreshRuns]);

  const closeSession = useCallback(async (runId: string) => {
    setDetailMutating(true);
    try {
      const next = await accomplish.closeSubagent({ runId });
      setDetailRun((current) => current?.runId === runId ? next : current);
      await refreshRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailMutating(false);
    }
  }, [accomplish, refreshRuns]);

  const sendFollowUp = useCallback(async () => {
    if (!detailRun || !detailTask || !detailPrompt.trim()) return;
    setDetailSending(true);
    try {
      const selectedOverride = availableModelOptions.find((entry) => entry.value === detailModelOverride) || null;
      await accomplish.sendSubagent({
        runId: detailRun.runId,
        prompt: detailPrompt.trim(),
        modelProvider: selectedOverride?.providerId,
        modelId: selectedOverride?.modelId,
        modelBaseUrl: selectedOverride?.baseUrl,
      });
      setDetailPrompt('');
      setDetailModelOverride('');
      await Promise.all([refreshRuns(), loadDetail(detailRun)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailSending(false);
    }
  }, [accomplish, availableModelOptions, detailModelOverride, detailPrompt, detailRun, detailTask, loadDetail, refreshRuns]);

  return (
    <div className="h-full overflow-hidden bg-background">
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">Subagents</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Global control surface for tracked child agent runs across Chat Mode and Build Mode.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">Active: <span className="font-medium text-foreground">{counts.active}</span></div>
            <div className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">Session mode: <span className="font-medium text-foreground">{counts.session}</span></div>
            <div className="rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">Archived: <span className="font-medium text-foreground">{counts.archived}</span></div>
            <Button variant="outline" size="sm" onClick={() => void refreshRuns(true)} disabled={refreshing} className="gap-2">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleClosePage} className="gap-2" title="Close subagents page">
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>
        </div>

        <Card className="border-border/60 bg-card/70 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by task, label, child agent, parent agent, or task id..." className="pl-9" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">All runs</option>
              <option value="active">Active only</option>
              <option value="session">Session mode</option>
              <option value="archived">Archived</option>
              <option value="closed">Closed sessions</option>
            </select>
            <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
              Include archived
            </label>
          </div>
        </Card>

        {error ? <Card className="border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</Card> : null}

        <Card className="min-h-0 flex-1 overflow-hidden border-border/60 bg-card/70">
          <div className="flex h-full flex-col">
            <div className="border-b border-border/60 px-4 py-3 text-sm text-muted-foreground">{loading ? 'Loading subagent runs…' : `${filteredRuns.length} subagent run${filteredRuns.length === 1 ? '' : 's'}`}</div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading subagent runs…</div>
              ) : filteredRuns.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"><Bot className="h-10 w-10 text-muted-foreground/50" /><div>No subagent runs match the current filters.</div></div>
              ) : (
                <div className="space-y-3">
                  {filteredRuns.map((run) => {
                    const childAgent = agentMap.get(run.childAgentId);
                    const parentAgent = agentMap.get(run.parentAgentId);
                    const stoppable = run.status === 'running' || run.status === 'accepted';
                    return (
                      <div key={run.runId} className="rounded-xl border border-border/60 bg-background/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-semibold text-foreground">{run.label || run.childTaskSummary || run.childAgentId}</div>
                              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getSubagentRunStatusClasses(run.status, run.resultStatus))}>{formatSubagentRunStatus(run.status, run.resultStatus)}</span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{run.mode === 'session' ? 'Session mode' : 'Run mode'}</span>
                              {run.archivedAt ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">Archived</span> : null}
                              {run.closedAt ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Closed</span> : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1"><AgentAvatarIcon avatar={childAgent?.avatar} color={childAgent?.avatarColor || 'hsl(var(--primary))'} imageDataUrl={childAgent?.avatarImageDataUrl} className="h-3.5 w-3.5" />Child: {childAgent?.name || run.childAgentId}</span>
                              <span className="inline-flex items-center gap-1"><AgentAvatarIcon avatar={parentAgent?.avatar} color={parentAgent?.avatarColor || 'hsl(var(--muted-foreground))'} imageDataUrl={parentAgent?.avatarImageDataUrl} className="h-3.5 w-3.5" />Parent: {parentAgent?.name || run.parentAgentId}</span>
                              <span>Depth {run.depth}</span>
                              {run.mode === 'session' && run.sessionState ? <span>Session {run.sessionState}</span> : null}
                              {typeof run.reuseCount === 'number' ? <span>Reuse {run.reuseCount}</span> : null}
                              <span>Updated {formatRelativeTime(run.updatedAt)}</span>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{run.task}</div>
                            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                              <span>Child task: {run.childTaskId}</span>
                              <span>Parent task: {run.parentTaskId}</span>
                              {run.inheritedContext?.workingDirectory ? <span>Working dir: {run.inheritedContext.workingDirectory}</span> : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => void loadDetail(run)}>Open</Button>
                            <Button variant="outline" size="sm" onClick={() => navigate(`/execution/${run.childTaskId}`)} className="gap-2"><ExternalLink className="h-3.5 w-3.5" />Open task</Button>
                            {stoppable ? <Button variant="outline" size="sm" onClick={() => void stopRun(run.runId)} className="gap-2"><Square className="h-3.5 w-3.5" />Stop</Button> : null}
                            <Button variant="outline" size="sm" onClick={() => void archiveRun(run.runId, !run.archivedAt)} className="gap-2"><Archive className="h-3.5 w-3.5" />{run.archivedAt ? 'Restore' : 'Archive'}</Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Dialog open={Boolean(detailRun)} onOpenChange={(open) => { if (!open && !detailSending && !detailMutating) setDetailRun(null); }}>
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{detailRun ? `Subagent: ${detailRun.label || detailRun.childAgentId}` : 'Subagent'}</DialogTitle>
            <DialogDescription>
              {detailRun ? `Child agent ${agentMap.get(detailRun.childAgentId)?.name || detailRun.childAgentId} · ${formatSubagentRunStatus(detailRun.status, detailRun.resultStatus)} · ${formatSubagentModeDetail(detailRun).toLowerCase()}` : 'Tracked child agent session'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
            <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">{detailRun?.task || 'No task summary available.'}</div>
            {detailRun ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">Session details</div>
                  <div>Child session key: {detailRun.childSessionKey}</div>
                  {detailRun.sessionId ? <div>Session id: {detailRun.sessionId}</div> : null}
                  {typeof detailRun.reuseCount === 'number' ? <div>Session reuse count: {detailRun.reuseCount}</div> : null}
                  {detailRun.closedAt ? <div>Closed at: {new Date(detailRun.closedAt).toLocaleString()}</div> : null}
                  {detailRun.archivedAt ? <div>Archived at: {new Date(detailRun.archivedAt).toLocaleString()}</div> : null}
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">Inherited context</div>
                  {detailRun.inheritedContext?.workingDirectory ? <div>Working directory: {detailRun.inheritedContext.workingDirectory}</div> : <div>Working directory: none</div>}
                  {Array.isArray(detailRun.inheritedContext?.attachedFiles) && detailRun.inheritedContext?.attachedFiles?.length ? <div>Attached files: {detailRun.inheritedContext.attachedFiles.length}</div> : <div>Attached files: none</div>}
                  <div>Privacy mode: {detailRun.inheritedContext?.privacyMode || 'normal'}</div>
                  {detailRun.executionPolicy ? (
                    <>
                      <div className="mt-2 font-medium text-foreground">Execution policy</div>
                      <div>Inherited from parent agent: {detailRun.executionPolicy.inheritedFromAgentId}</div>
                      <div>Default mode: {detailRun.executionPolicy.mode}</div>
                      <div>Max children: {detailRun.executionPolicy.maxChildren}</div>
                      <div>Max depth: {detailRun.executionPolicy.maxDepth}</div>
                      <div>Timeout: {Math.round(detailRun.executionPolicy.runTimeoutMs / 1000)}s</div>
                      <div>Auto relay completions: {detailRun.executionPolicy.autoRelayCompletions ? 'on' : 'off'}</div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/60 bg-background/70 p-3">
              {detailLoading ? (
                <div className="text-xs text-muted-foreground">Loading transcript…</div>
              ) : !detailTask || detailTask.messages.length === 0 ? (
                <div className="text-xs text-muted-foreground">No transcript available yet.</div>
              ) : (
                <div className="space-y-3">
                  {detailTask.messages.map((message, index) => (
                    <div key={`${message.id}-${index}`} className={cn('rounded-md border px-3 py-2', getMessageCardClasses(message))}>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{formatMessageType(message)}</div>
                      <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2"><ReactMarkdown>{message.content || ''}</ReactMarkdown></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-end">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Send follow-up to child session</label>
                <Textarea value={detailPrompt} onChange={(event) => setDetailPrompt(event.target.value)} placeholder="Ask the child agent to continue or refine its work..." className="min-h-[88px]" />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Model override for next child turns</label>
                <select value={detailModelOverride} onChange={(event) => setDetailModelOverride(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={detailSending || availableModelOptions.length === 0}>
                  <option value="">Keep current child model</option>
                  {modelProviders.filter((provider) => availableModelOptions.some((entry) => entry.providerId === String(provider.id))).map((provider) => (
                    <optgroup key={provider.id} label={provider.name}>
                      {availableModelOptions.filter((entry) => entry.providerId === String(provider.id)).map((entry) => (
                        <option key={entry.value} value={entry.value}>{entry.displayName}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="text-[11px] text-muted-foreground">{detailRun?.model ? `Current child model: ${detailRun.model.provider}:${detailRun.model.model}` : 'No explicit child model override is currently set.'}</div>
                <div className="text-[11px] text-muted-foreground">{availableModelOptions.length === 0 ? 'No selectable models are available here yet. Add an API key or local provider first.' : 'Only models with a configured API key or local runtime are listed.'}</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailRun(null)} disabled={detailSending || detailMutating}>Close</Button>
            <Button variant="outline" onClick={() => detailRun && void stopRun(detailRun.runId)} disabled={detailSending || detailMutating || !detailRun || !(detailRun.status === 'running' || detailRun.status === 'accepted')} className="gap-2"><Square className="h-3.5 w-3.5" />Stop</Button>
            <Button variant="outline" onClick={() => detailRun && void closeSession(detailRun.runId)} disabled={detailSending || detailMutating || !detailRun} className="gap-2"><XCircle className="h-3.5 w-3.5" />{detailMutating ? 'Working…' : 'Close session'}</Button>
            <Button variant="outline" onClick={() => detailRun && void archiveRun(detailRun.runId, !detailRun.archivedAt)} disabled={detailSending || detailMutating || !detailRun} className="gap-2"><Archive className="h-3.5 w-3.5" />{detailMutating ? 'Working…' : detailRun?.archivedAt ? 'Restore' : 'Archive'}</Button>
            <Button onClick={() => void sendFollowUp()} disabled={!detailPrompt.trim() || detailSending || detailMutating || !detailTask} className="gap-2">{detailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{detailSending ? 'Sending…' : 'Send follow-up'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
