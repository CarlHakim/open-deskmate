import type { ProviderType, UsagePeriod, UsagePricingSettings, UsageSummary, UsageProviderBreakdown } from '@accomplish/shared';
import type { TokenTurnLog } from '../store/tokenUsage';
import { getUsagePricingSettings } from '../store/usagePricing';
import Store from 'electron-store';

// We read turns via electron-store directly to avoid exporting internals from the tokenUsage store.
type TokenUsageSchema = { turns: TokenTurnLog[] };
const tokenUsageStore = new Store<TokenUsageSchema>({ name: 'token-usage', defaults: { turns: [] } });

export function getPeriodRange(period: UsagePeriod, now = new Date()): { start: Date; end: Date } {
  const end = now;
  const start = new Date(now);
  start.setMilliseconds(0);
  start.setSeconds(0);
  start.setMinutes(0);
  start.setHours(0);

  if (period === 'day') {
    return { start, end };
  }

  if (period === 'week') {
    // Week starts Monday.
    const day = start.getDay(); // 0=Sun ... 6=Sat
    const diffToMonday = (day + 6) % 7; // Mon -> 0, Sun -> 6
    start.setDate(start.getDate() - diffToMonday);
    return { start, end };
  }

  // month
  start.setDate(1);
  return { start, end };
}

function parseIsoDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickPricingRow(
  pricing: UsagePricingSettings,
  provider: ProviderType,
  model: string | null,
  eventTime: Date
) : { inputHitCostPer1m: number | null; inputMissCostPer1m: number | null; outputCostPer1m: number | null } | null {
  const rows = pricing.providers
    .filter((r) => r.provider === provider)
    .map((r) => ({ ...r, effectiveFromDate: parseIsoDate(r.effectiveFrom ?? null) }))
    .filter((r) => (r.inputMissCostPer1m ?? r.inputCostPer1m) != null || r.inputHitCostPer1m != null || r.outputCostPer1m != null);

  if (rows.length === 0) return null;

  // Prefer model-specific rows; fall back to provider-default rows.
  const modelRows = model ? rows.filter((r) => (r.model ?? null) === model) : [];
  const providerRows = rows.filter((r) => (r.model ?? null) == null);
  const scoped = modelRows.length > 0 ? modelRows : providerRows;

  const eligible = scoped.filter((r) => {
    if (!r.effectiveFromDate) return true;
    return r.effectiveFromDate.getTime() <= eventTime.getTime();
  });
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => (b.effectiveFromDate?.getTime() ?? 0) - (a.effectiveFromDate?.getTime() ?? 0));
  const best = eligible[0];
  return {
    inputHitCostPer1m: best.inputHitCostPer1m ?? null,
    inputMissCostPer1m: best.inputMissCostPer1m ?? best.inputCostPer1m ?? null,
    outputCostPer1m: best.outputCostPer1m ?? null,
  };
}

function computeEventCost(opts: {
  inputHitTokens: number;
  inputMissTokens: number;
  outputTokens: number;
  pricingRow: { inputHitCostPer1m: number | null; inputMissCostPer1m: number | null; outputCostPer1m: number | null } | null;
}): { inputHitCost: number; inputMissCost: number; outputCost: number; totalCost: number } | null {
  const { pricingRow, inputHitTokens, inputMissTokens, outputTokens } = opts;
  if (!pricingRow) return null;
  if (inputHitTokens > 0 && pricingRow.inputHitCostPer1m == null) return null;
  if (inputMissTokens > 0 && pricingRow.inputMissCostPer1m == null) return null;
  if (outputTokens > 0 && pricingRow.outputCostPer1m == null) return null;

  const inputHitCost = (inputHitTokens / 1_000_000) * (pricingRow.inputHitCostPer1m ?? 0);
  const inputMissCost = (inputMissTokens / 1_000_000) * (pricingRow.inputMissCostPer1m ?? 0);
  const outputCost = (outputTokens / 1_000_000) * (pricingRow.outputCostPer1m ?? 0);
  return {
    inputHitCost,
    inputMissCost,
    outputCost,
    totalCost: inputHitCost + inputMissCost + outputCost,
  };
}

function getTurnInputSplit(usage: TokenTurnLog['usage']): {
  inputHitTokens: number;
  inputMissTokens: number;
  inputTokens: number;
} {
  if (!usage) {
    return { inputHitTokens: 0, inputMissTokens: 0, inputTokens: 0 };
  }

  const rawInputTokens = Math.max(0, usage.inputTokens);
  const explicitHitTokens = typeof usage.inputHitTokens === 'number'
    ? Math.max(0, usage.inputHitTokens)
    : undefined;
  const explicitMissTokens = typeof usage.inputMissTokens === 'number'
    ? Math.max(0, usage.inputMissTokens)
    : undefined;

  if (explicitHitTokens !== undefined || explicitMissTokens !== undefined) {
    const inputHitTokens = explicitHitTokens ?? 0;
    const inputMissTokens = explicitMissTokens ?? Math.max(0, rawInputTokens - inputHitTokens);
    return {
      inputHitTokens,
      inputMissTokens,
      inputTokens: inputHitTokens + inputMissTokens,
    };
  }

  const cachedInputTokens = Math.max(0, usage.cachedInputTokens ?? 0);
  if (cachedInputTokens > rawInputTokens) {
    return {
      inputHitTokens: cachedInputTokens,
      inputMissTokens: rawInputTokens,
      inputTokens: cachedInputTokens + rawInputTokens,
    };
  }

  const inputHitTokens = Math.min(rawInputTokens, cachedInputTokens);
  const inputMissTokens = Math.max(0, rawInputTokens - inputHitTokens);
  return {
    inputHitTokens,
    inputMissTokens,
    inputTokens: inputHitTokens + inputMissTokens,
  };
}

export function computeUsageSummaryForPeriod(opts: {
  period: UsagePeriod;
  turns: TokenTurnLog[];
  pricing: UsagePricingSettings;
  now?: Date;
  usageProjectId?: string | null;
}): UsageSummary {
  const { period, turns, pricing } = opts;
  const now = opts.now ?? new Date();
  const { start, end } = getPeriodRange(period, now);
  return computeUsageSummaryForRange({
    period,
    turns,
    pricing,
    rangeStart: start,
    rangeEnd: end,
    now,
    usageProjectId: opts.usageProjectId,
  });
}

export function computeUsageSummaryForRange(opts: {
  period?: UsagePeriod;
  turns: TokenTurnLog[];
  pricing: UsagePricingSettings;
  rangeStart: Date | string;
  rangeEnd?: Date | string | null;
  now?: Date;
  usageProjectId?: string | null;
}): UsageSummary {
  const { turns, pricing } = opts;
  const now = opts.now ?? new Date();
  const start = typeof opts.rangeStart === 'string' ? new Date(opts.rangeStart) : opts.rangeStart;
  const end = opts.rangeEnd == null
    ? now
    : typeof opts.rangeEnd === 'string'
      ? new Date(opts.rangeEnd)
      : opts.rangeEnd;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const projectFilter = typeof opts.usageProjectId === 'string' && opts.usageProjectId.trim().length > 0
    ? opts.usageProjectId.trim()
    : null;

  const inRange = turns.filter((t) => {
    if (projectFilter && t.usageProjectId !== projectFilter) return false;
    const ts = parseIsoDate(t.createdAt)?.getTime();
    if (!ts) return false;
    return ts >= startMs && ts <= endMs;
  });

  const providers = new Map<ProviderType, UsageProviderBreakdown>();
  let inputTokens = 0;
  let inputHitTokens = 0;
  let inputMissTokens = 0;
  let outputTokens = 0;
  let inputHitCost: number | null = null;
  let inputMissCost: number | null = null;
  let outputCost: number | null = null;
  let estimatedEvents = 0;
  let totalEvents = 0;

  let totalCost: number | null = null;
  let usedProviderReportedCost = false;
  const unpricedProvidersSet = new Set<ProviderType>();

  for (const turn of inRange) {
    if (!turn.usage) continue;
    totalEvents += 1;
    if (turn.usage.estimated) estimatedEvents += 1;

    const {
      inputTokens: turnInputTokens,
      inputHitTokens: turnInputHitTokens,
      inputMissTokens: turnInputMissTokens,
    } = getTurnInputSplit(turn.usage);
    const turnOutputTokens = Math.max(0, turn.usage.outputTokens);

    inputTokens += turnInputTokens;
    inputHitTokens += turnInputHitTokens;
    inputMissTokens += turnInputMissTokens;
    outputTokens += turnOutputTokens;

    const provider = turn.provider;
    const model = typeof turn.model === 'string' && turn.model.trim().length > 0 ? turn.model.trim() : null;
    const existing = providers.get(provider) ?? {
      provider,
      inputTokens: 0,
      inputHitTokens: 0,
      inputMissTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputHitCost: null,
      inputMissCost: null,
      outputCost: null,
      cost: null,
      unpricedEvents: 0,
    };
    existing.inputTokens += turnInputTokens;
    existing.inputHitTokens += turnInputHitTokens;
    existing.inputMissTokens += turnInputMissTokens;
    existing.outputTokens += turnOutputTokens;
    existing.totalTokens += turnInputTokens + turnOutputTokens;

    const eventTime = parseIsoDate(turn.createdAt) ?? now;
    const row = pickPricingRow(pricing, provider, model, eventTime);
    const providerReportedCost = pricing.currency === 'USD' && typeof turn.usage.costUsd === 'number' && Number.isFinite(turn.usage.costUsd)
      ? Math.max(0, turn.usage.costUsd)
      : null;
    const computedCost = computeEventCost({
      inputHitTokens: turnInputHitTokens,
      inputMissTokens: turnInputMissTokens,
      outputTokens: turnOutputTokens,
      pricingRow: row,
    });
    const eventCost = computedCost?.totalCost ?? providerReportedCost ?? null;
    if (eventCost == null) {
      existing.unpricedEvents += 1;
      unpricedProvidersSet.add(provider);
    } else {
      if (computedCost) {
        existing.inputHitCost = (existing.inputHitCost ?? 0) + computedCost.inputHitCost;
        existing.inputMissCost = (existing.inputMissCost ?? 0) + computedCost.inputMissCost;
        existing.outputCost = (existing.outputCost ?? 0) + computedCost.outputCost;
        inputHitCost = (inputHitCost ?? 0) + computedCost.inputHitCost;
        inputMissCost = (inputMissCost ?? 0) + computedCost.inputMissCost;
        outputCost = (outputCost ?? 0) + computedCost.outputCost;
      } else if (providerReportedCost != null) {
        usedProviderReportedCost = true;
      }
      existing.cost = (existing.cost ?? 0) + eventCost;
      totalCost = (totalCost ?? 0) + eventCost;
    }

    providers.set(provider, existing);
  }

  const hasAnyPricing = pricing.providers.some((p) =>
    p.inputHitCostPer1m != null ||
    p.inputMissCostPer1m != null ||
    p.inputCostPer1m != null ||
    p.outputCostPer1m != null
  );
  const hasAnyCostSource = hasAnyPricing || usedProviderReportedCost;

  return {
    period: opts.period ?? 'month',
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    inputTokens,
    inputHitTokens,
    inputMissTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputHitCost: hasAnyCostSource ? inputHitCost : null,
    inputMissCost: hasAnyCostSource ? inputMissCost : null,
    outputCost: hasAnyCostSource ? outputCost : null,
    cost: hasAnyCostSource ? totalCost : null,
    currency: hasAnyCostSource ? pricing.currency : undefined,
    providerBreakdown: Array.from(providers.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    unpricedProviders: Array.from(unpricedProvidersSet.values()),
    estimatedEvents,
    totalEvents,
  };
}

export function getUsageSummary(period: UsagePeriod): UsageSummary {
  const pricing = getUsagePricingSettings();
  const turns = tokenUsageStore.get('turns') ?? [];
  return computeUsageSummaryForPeriod({ period, turns, pricing, now: new Date() });
}
