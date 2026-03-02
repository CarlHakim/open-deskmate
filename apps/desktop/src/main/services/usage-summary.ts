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
) : { inputCostPer1m: number; outputCostPer1m: number } | null {
  const rows = pricing.providers
    .filter((r) => r.provider === provider)
    .map((r) => ({ ...r, effectiveFromDate: parseIsoDate(r.effectiveFrom ?? null) }))
    .filter((r) => r.inputCostPer1m != null && r.outputCostPer1m != null);

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
  if (best.inputCostPer1m == null || best.outputCostPer1m == null) return null;
  return { inputCostPer1m: best.inputCostPer1m, outputCostPer1m: best.outputCostPer1m };
}

function computeEventCost(opts: {
  inputTokens: number;
  outputTokens: number;
  pricingRow: { inputCostPer1m: number; outputCostPer1m: number } | null;
}): number | null {
  const { pricingRow, inputTokens, outputTokens } = opts;
  if (!pricingRow) return null;
  const inputCost = (inputTokens / 1_000_000) * pricingRow.inputCostPer1m;
  const outputCost = (outputTokens / 1_000_000) * pricingRow.outputCostPer1m;
  return inputCost + outputCost;
}

export function computeUsageSummaryForPeriod(opts: {
  period: UsagePeriod;
  turns: TokenTurnLog[];
  pricing: UsagePricingSettings;
  now?: Date;
}): UsageSummary {
  const { period, turns, pricing } = opts;
  const now = opts.now ?? new Date();
  const { start, end } = getPeriodRange(period, now);
  const startMs = start.getTime();
  const endMs = end.getTime();

  const inRange = turns.filter((t) => {
    const ts = parseIsoDate(t.createdAt)?.getTime();
    if (!ts) return false;
    return ts >= startMs && ts <= endMs;
  });

  const providers = new Map<ProviderType, UsageProviderBreakdown>();
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedEvents = 0;
  let totalEvents = 0;

  let totalCost: number | null = null;
  const unpricedProvidersSet = new Set<ProviderType>();

  for (const turn of inRange) {
    if (!turn.usage) continue;
    totalEvents += 1;
    if (turn.usage.estimated) estimatedEvents += 1;

    inputTokens += turn.usage.inputTokens;
    outputTokens += turn.usage.outputTokens;

    const provider = turn.provider;
    const model = typeof turn.model === 'string' && turn.model.trim().length > 0 ? turn.model.trim() : null;
    const existing = providers.get(provider) ?? {
      provider,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: null,
      unpricedEvents: 0,
    };
    existing.inputTokens += turn.usage.inputTokens;
    existing.outputTokens += turn.usage.outputTokens;
    existing.totalTokens += turn.usage.totalTokens;

    const eventTime = parseIsoDate(turn.createdAt) ?? now;
    const row = pickPricingRow(pricing, provider, model, eventTime);
    const eventCost = computeEventCost({
      inputTokens: turn.usage.inputTokens,
      outputTokens: turn.usage.outputTokens,
      pricingRow: row,
    });
    if (eventCost == null) {
      existing.unpricedEvents += 1;
      unpricedProvidersSet.add(provider);
    } else {
      existing.cost = (existing.cost ?? 0) + eventCost;
      totalCost = (totalCost ?? 0) + eventCost;
    }

    providers.set(provider, existing);
  }

  const hasAnyPricing = pricing.providers.some((p) => p.inputCostPer1m != null && p.outputCostPer1m != null);

  return {
    period,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: hasAnyPricing ? totalCost : null,
    currency: hasAnyPricing ? pricing.currency : undefined,
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
