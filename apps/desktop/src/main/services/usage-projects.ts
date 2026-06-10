import Store from 'electron-store';
import type {
  UsageProjectAnalytics,
  UsageProjectBudgetStatus,
  UsageProjectBudgetWindow,
  UsageProjectSummary,
} from '@accomplish/shared';
import type { TokenTurnLog } from '../store/tokenUsage';
import { getUsagePricingSettings } from '../store/usagePricing';
import {
  getUsageProject,
  listUsageProjectBudgetWindows,
  listUsageProjects,
} from '../store/usageProjects';
import { computeUsageSummaryForRange } from './usage-summary';

type TokenUsageSchema = { turns: TokenTurnLog[] };
const tokenUsageStore = new Store<TokenUsageSchema>({ name: 'token-usage', defaults: { turns: [] } });

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWindowActive(window: UsageProjectBudgetWindow, now = new Date()): boolean {
  if (!window.enabled) return false;
  const start = parseDate(window.startsAt);
  if (!start || start.getTime() > now.getTime()) return false;
  const end = parseDate(window.endsAt);
  return !end || end.getTime() >= now.getTime();
}

function clampPercent(spent: number | null, limit: number | null | undefined): number | null {
  if (spent == null || limit == null || limit <= 0) return null;
  return Math.min(999, (spent / limit) * 100);
}

export function getUsageProjectSummary(input: {
  projectId: string;
  startsAt?: string;
  endsAt?: string | null;
  windowId?: string;
}): UsageProjectSummary {
  const project = getUsageProject(input.projectId);
  if (!project) throw new Error('Usage project not found.');
  const window = input.windowId
    ? listUsageProjectBudgetWindows(project.id).find((entry) => entry.id === input.windowId)
    : undefined;
  const now = new Date();
  const rangeStart = input.startsAt || window?.startsAt || project.createdAt;
  const rangeEnd = input.endsAt !== undefined ? input.endsAt : window?.endsAt ?? null;
  const summary = computeUsageSummaryForRange({
    turns: tokenUsageStore.get('turns') ?? [],
    pricing: getUsagePricingSettings(),
    rangeStart,
    rangeEnd,
    now,
    usageProjectId: project.id,
  });
  return { projectId: project.id, project, window, summary };
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clampAnalyticsDays(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(7, Math.min(366, Math.round(parsed)));
}

function costSortValue(value: number | null | undefined): number {
  return value == null ? -1 : value;
}

export function getUsageProjectAnalytics(input: {
  projectId: string;
  startsAt?: string;
  endsAt?: string | null;
  windowId?: string;
  days?: number;
}): UsageProjectAnalytics {
  const project = getUsageProject(input.projectId);
  if (!project) throw new Error('Usage project not found.');

  const window = input.windowId
    ? listUsageProjectBudgetWindows(project.id).find((entry) => entry.id === input.windowId)
    : undefined;
  const now = new Date();
  const requestedDays = clampAnalyticsDays(input.days, window ? 62 : 31);
  const parsedEnd = parseDate(input.endsAt ?? window?.endsAt ?? null);
  const rangeEnd = parsedEnd && parsedEnd.getTime() < now.getTime() ? parsedEnd : now;
  const fallbackStart = startOfDay(addDays(rangeEnd, -(requestedDays - 1)));
  const parsedStart = parseDate(input.startsAt || window?.startsAt || null);
  const rangeStart = parsedStart || fallbackStart;
  const pricing = getUsagePricingSettings();
  const allTurns = tokenUsageStore.get('turns') ?? [];
  const summary = computeUsageSummaryForRange({
    turns: allTurns,
    pricing,
    rangeStart,
    rangeEnd,
    now,
    usageProjectId: project.id,
  });

  const dailyStart = new Date(Math.max(
    startOfDay(rangeStart).getTime(),
    startOfDay(addDays(rangeEnd, -(requestedDays - 1))).getTime()
  ));
  const daily = [];
  for (let dayStart = dailyStart; dayStart.getTime() <= rangeEnd.getTime(); dayStart = addDays(dayStart, 1)) {
    const dayEnd = new Date(Math.min(endOfDay(dayStart).getTime(), rangeEnd.getTime()));
    const daySummary = computeUsageSummaryForRange({
      turns: allTurns,
      pricing,
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      now,
      usageProjectId: project.id,
    });
    daily.push({
      date: dayStart.toISOString().slice(0, 10),
      rangeStart: daySummary.rangeStart,
      rangeEnd: daySummary.rangeEnd,
      inputHitTokens: daySummary.inputHitTokens,
      inputMissTokens: daySummary.inputMissTokens,
      outputTokens: daySummary.outputTokens,
      totalTokens: daySummary.totalTokens,
      inputHitCost: daySummary.inputHitCost,
      inputMissCost: daySummary.inputMissCost,
      outputCost: daySummary.outputCost,
      cost: daySummary.cost,
      totalEvents: daySummary.totalEvents,
      estimatedEvents: daySummary.estimatedEvents,
    });
  }

  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const projectTurns = allTurns.filter((turn) => {
    if (turn.usageProjectId !== project.id) return false;
    const createdAt = parseDate(turn.createdAt);
    if (!createdAt) return false;
    const timestamp = createdAt.getTime();
    return timestamp >= startMs && timestamp <= endMs;
  });

  const modelGroups = new Map<string, TokenTurnLog[]>();
  const workGroups = new Map<string, TokenTurnLog[]>();
  for (const turn of projectTurns) {
    const modelKey = `${turn.provider}:${turn.model || 'unknown'}`;
    modelGroups.set(modelKey, [...(modelGroups.get(modelKey) || []), turn]);
    workGroups.set(turn.taskId, [...(workGroups.get(turn.taskId) || []), turn]);
  }

  const modelBreakdown = Array.from(modelGroups.entries()).map(([key, turns]) => {
    const separator = key.indexOf(':');
    const provider = key.slice(0, separator) as TokenTurnLog['provider'];
    const model = key.slice(separator + 1);
    const rowSummary = computeUsageSummaryForRange({
      turns,
      pricing,
      rangeStart,
      rangeEnd,
      now,
      usageProjectId: project.id,
    });
    return {
      provider,
      model,
      inputHitTokens: rowSummary.inputHitTokens,
      inputMissTokens: rowSummary.inputMissTokens,
      outputTokens: rowSummary.outputTokens,
      totalTokens: rowSummary.totalTokens,
      inputHitCost: rowSummary.inputHitCost,
      inputMissCost: rowSummary.inputMissCost,
      outputCost: rowSummary.outputCost,
      cost: rowSummary.cost,
      totalEvents: rowSummary.totalEvents,
      estimatedEvents: rowSummary.estimatedEvents,
      unpricedProviders: rowSummary.unpricedProviders,
    };
  }).sort((a, b) => costSortValue(b.cost) - costSortValue(a.cost) || b.totalTokens - a.totalTokens);

  const workBreakdown = Array.from(workGroups.entries()).map(([taskId, turns]) => {
    const rowSummary = computeUsageSummaryForRange({
      turns,
      pricing,
      rangeStart,
      rangeEnd,
      now,
      usageProjectId: project.id,
    });
    const timestamps = turns
      .map((turn) => parseDate(turn.createdAt))
      .filter((date): date is Date => Boolean(date))
      .map((date) => date.getTime())
      .sort((a, b) => a - b);
    return {
      taskId,
      inputHitTokens: rowSummary.inputHitTokens,
      inputMissTokens: rowSummary.inputMissTokens,
      outputTokens: rowSummary.outputTokens,
      totalTokens: rowSummary.totalTokens,
      inputHitCost: rowSummary.inputHitCost,
      inputMissCost: rowSummary.inputMissCost,
      outputCost: rowSummary.outputCost,
      cost: rowSummary.cost,
      totalEvents: rowSummary.totalEvents,
      estimatedEvents: rowSummary.estimatedEvents,
      unpricedProviders: rowSummary.unpricedProviders,
      firstSeenAt: new Date(timestamps[0] ?? rangeStart.getTime()).toISOString(),
      lastSeenAt: new Date(timestamps[timestamps.length - 1] ?? rangeEnd.getTime()).toISOString(),
    };
  }).sort((a, b) => costSortValue(b.cost) - costSortValue(a.cost) || b.totalTokens - a.totalTokens);

  return {
    projectId: project.id,
    project,
    window,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    summary,
    daily,
    modelBreakdown,
    workBreakdown,
  };
}

export function getUsageProjectBudgetStatus(projectId?: string | null): UsageProjectBudgetStatus[] {
  const now = new Date();
  const projects = projectId
    ? listUsageProjects({ includeArchived: true }).filter((project) => project.id === projectId)
    : listUsageProjects({ includeArchived: true });
  const statuses: UsageProjectBudgetStatus[] = [];

  for (const project of projects) {
    for (const window of listUsageProjectBudgetWindows(project.id).filter((entry) => isWindowActive(entry, now))) {
      const { summary } = getUsageProjectSummary({
        projectId: project.id,
        windowId: window.id,
      });
      const spent = summary.cost;
      const tokens = summary.totalTokens;
      const moneyLimit = window.moneyLimit ?? null;
      const tokenLimit = window.tokenLimit ?? null;
      const exceededMoney = spent != null && moneyLimit != null && spent >= moneyLimit;
      const exceededTokens = tokenLimit != null && tokens >= tokenLimit;
      const exceeded = exceededMoney || exceededTokens;
      statuses.push({
        id: `${project.id}:${window.id}`,
        projectId: project.id,
        windowId: window.id,
        windowName: window.name,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        spent,
        moneyLimit,
        tokens,
        tokenLimit,
        currency: window.currency || summary.currency,
        moneyPercent: clampPercent(spent, moneyLimit),
        tokenPercent: clampPercent(tokens, tokenLimit),
        exceededMoney,
        exceededTokens,
        exceeded,
        blocking: exceeded && window.mode === 'block',
        mode: window.mode,
      });
    }
  }

  return statuses;
}

export function getBlockingUsageProjectBudgetStatus(projectId?: string | null): UsageProjectBudgetStatus | null {
  if (!projectId) return null;
  return getUsageProjectBudgetStatus(projectId).find((status) => status.blocking) || null;
}
