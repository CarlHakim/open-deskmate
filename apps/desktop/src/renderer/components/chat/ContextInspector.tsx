import { useEffect, useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import type {
  ContextWindowEstimateResponse,
  UsageBudgetStatus,
  UsageProject,
  UsageProjectBudgetStatus,
  UsagePricingSettings,
} from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getAccomplish } from '@/lib/accomplish';
import { useAgentStore } from '@/stores/agentStore';
import { cn } from '@/lib/utils';

type PrivacyMode = 'normal' | 'incognito';

function formatTokens(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${Math.round(value)}%`;
}

function formatPricingState(settings: UsagePricingSettings | null, stats: ContextWindowEstimateResponse | null): string {
  if (!settings || !stats) return 'Unknown';
  const providerRows = settings.providers.filter((row) => row.provider === stats.provider);
  const exact = providerRows.find((row) => row.model === stats.model);
  const fallback = providerRows.find((row) => !row.model);
  const row = exact || fallback;
  if (!row) return `No pricing row for ${stats.provider}`;
  const hasInput = row.inputHitCostPer1m != null || row.inputMissCostPer1m != null;
  const hasOutput = row.outputCostPer1m != null;
  if (hasInput && hasOutput) return `${settings.currency} pricing active${exact ? ' for this model' : ' via provider default'}`;
  return `${settings.currency} pricing partial`;
}

function formatPermissionState(agent: ReturnType<typeof useAgentStore.getState>['agents'][number] | undefined): string {
  const profile = agent?.permissionProfile;
  if (!profile?.enabled) return 'Default permission policy';
  const fileDecision = profile.file?.defaultDecision || 'prompt';
  const toolDecision = profile.runtime?.defaultToolDecision || 'prompt';
  const allowed = profile.runtime?.allowedToolNames?.length || 0;
  const blocked = profile.runtime?.blockedToolNames?.length || 0;
  return `Agent policy: files ${fileDecision}, tools ${toolDecision}${allowed ? `, ${allowed} allowed` : ''}${blocked ? `, ${blocked} blocked` : ''}`;
}

export default function ContextInspector({
  stats,
  agentId,
  workspace,
  attachedFiles = [],
  privacyMode = 'normal',
  usageProjectId,
  className,
}: {
  stats: ContextWindowEstimateResponse | null;
  agentId?: string | null;
  workspace?: string | null;
  attachedFiles?: string[];
  privacyMode?: PrivacyMode;
  usageProjectId?: string | null;
  className?: string;
}) {
  const accomplish = getAccomplish();
  const { agents, activeAgentId, loadAgents } = useAgentStore();
  const resolvedAgentId = agentId || activeAgentId || undefined;
  const agent = useMemo(
    () => agents.find((entry) => entry.id === resolvedAgentId),
    [agents, resolvedAgentId]
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memorySummary, setMemorySummary] = useState<string>('Not loaded');
  const [pricingSummary, setPricingSummary] = useState<string>('Unknown');
  const [budgetStatuses, setBudgetStatuses] = useState<UsageBudgetStatus[]>([]);
  const [usageProject, setUsageProject] = useState<UsageProject | null>(null);
  const [projectBudgetStatuses, setProjectBudgetStatuses] = useState<UsageProjectBudgetStatus[]>([]);

  useEffect(() => {
    if (open && agents.length === 0) {
      void loadAgents();
    }
  }, [agents.length, loadAgents, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      accomplish.getMemoryState({ agentId: resolvedAgentId }),
      accomplish.getUsagePricing(),
      accomplish.getUsageBudgetStatus({ agentId: resolvedAgentId }),
      usageProjectId ? accomplish.listUsageProjects({ includeArchived: true }) : Promise.resolve([]),
      usageProjectId ? accomplish.getUsageProjectBudgetStatus({ projectId: usageProjectId }) : Promise.resolve([]),
    ]).then(([memory, pricing, budgets, projects, projectBudgets]) => {
      if (cancelled) return;
      if (memory.status === 'fulfilled') {
        const longTermChars = memory.value.longTerm.content.trim().length;
        const dailyChars = memory.value.daily.content.trim().length;
        setMemorySummary(`${longTermChars} long-term chars, ${dailyChars} daily chars`);
      } else {
        setMemorySummary('Unavailable');
      }
      setPricingSummary(pricing.status === 'fulfilled' ? formatPricingState(pricing.value, stats) : 'Unavailable');
      setBudgetStatuses(budgets.status === 'fulfilled' && Array.isArray(budgets.value) ? budgets.value : []);
      const projectList = projects.status === 'fulfilled' && Array.isArray(projects.value) ? projects.value : [];
      setUsageProject(projectList.find((project) => project.id === usageProjectId) || null);
      setProjectBudgetStatuses(projectBudgets.status === 'fulfilled' && Array.isArray(projectBudgets.value) ? projectBudgets.value : []);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accomplish, open, resolvedAgentId, stats, usageProjectId]);

  const budgetSummary = budgetStatuses.length === 0
    ? 'No active budget'
    : budgetStatuses.map((status) => {
      const spent = status.spent == null ? 'unknown' : status.spent.toFixed(4);
      const limit = status.limit == null ? 'none' : status.limit.toFixed(2);
      const currency = status.currency ? ` ${status.currency}` : '';
      const state = status.blocking ? 'blocking' : status.exceeded ? 'warning' : status.mode;
      return `${status.period}: ${spent}${currency} / ${limit}${currency} (${state})`;
    }).join('\n');
  const projectBudgetSummary = !usageProjectId
    ? 'No project assigned'
    : projectBudgetStatuses.length === 0
      ? `${usageProject?.name || 'Selected project'}: tracking only`
      : projectBudgetStatuses.map((status) => {
        const spent = status.spent == null ? 'unknown' : status.spent.toFixed(4);
        const moneyLimit = status.moneyLimit == null ? 'none' : status.moneyLimit.toFixed(2);
        const currency = status.currency ? ` ${status.currency}` : '';
        const tokenLimit = status.tokenLimit == null ? 'none' : Math.round(status.tokenLimit).toLocaleString();
        const state = status.blocking ? 'blocking' : status.exceeded ? 'warning' : status.mode;
        return `${usageProject?.name || 'Project'} / ${status.windowName}: ${spent}${currency} / ${moneyLimit}${currency}; ${status.tokens.toLocaleString()} / ${tokenLimit} tokens (${state})`;
      }).join('\n');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className={cn('h-7 w-7 rounded-full', className)}
          title="Open context inspector"
          aria-label="Open context inspector"
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] max-w-[calc(100vw-2rem)] text-xs" align="start">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-foreground">Context inspector</div>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
            <span className="text-muted-foreground">Agent</span>
            <span className="truncate text-foreground">{agent?.name || resolvedAgentId || 'Default'}</span>
            <span className="text-muted-foreground">Model</span>
            <span className="truncate text-foreground">
              {stats ? `${stats.provider} / ${stats.model}` : agent?.selectedModel ? `${agent.selectedModel.provider} / ${agent.selectedModel.model}` : 'Default'}
            </span>
            <span className="text-muted-foreground">Workspace</span>
            <span className="truncate text-foreground" title={workspace || agent?.workspaceRoot || undefined}>
              {workspace || agent?.workspaceRoot || 'Default workspace'}
            </span>
            <span className="text-muted-foreground">Files</span>
            <span className="text-foreground">{attachedFiles.length ? `${attachedFiles.length} attached` : 'None attached'}</span>
            <span className="text-muted-foreground">Privacy</span>
            <span className="text-foreground">{privacyMode === 'incognito' ? 'Incognito' : 'Normal'}</span>
            <span className="text-muted-foreground">Memory</span>
            <span className="text-foreground">{memorySummary}</span>
            <span className="text-muted-foreground">Permissions</span>
            <span className="text-foreground">{formatPermissionState(agent)}</span>
            <span className="text-muted-foreground">Pricing</span>
            <span className="text-foreground">{pricingSummary}</span>
            <span className="text-muted-foreground">Project</span>
            <span className="truncate text-foreground">{usageProject?.name || (usageProjectId ? 'Selected project' : 'None')}</span>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1 font-medium text-foreground">Context window</div>
            {stats ? (
              <div className="space-y-1 text-muted-foreground">
                <div>Used: {formatTokens(stats.estimate.promptTokensEst)} / {formatTokens(stats.context.contextLimitTokens)} tokens ({formatPercent(stats.context.usedPct * 100)})</div>
                <div>Safe reply room: ~{formatTokens(stats.context.safeRemainingForReply)} tokens</div>
                <div>Remaining input: ~{formatTokens(stats.context.remainingInput)} tokens</div>
                <div>Trimmed: {stats.trimmed ? `${stats.droppedMessages} message(s)` : 'No'}</div>
              </div>
            ) : (
              <div className="text-muted-foreground">No estimate yet.</div>
            )}
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1 font-medium text-foreground">Usage budget</div>
            <div className="whitespace-pre-line text-muted-foreground">{budgetSummary}</div>
            <div className="mt-2 border-t border-border/60 pt-2 whitespace-pre-line text-muted-foreground">{projectBudgetSummary}</div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
