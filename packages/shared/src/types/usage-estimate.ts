/**
 * Global token usage + estimated cost (informational only; not billing).
 */

import type { ProviderType } from './provider';

export type UsagePeriod = 'day' | 'week' | 'month';

export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CAD'
  | 'AUD'
  | 'JPY';

export type PricingSource = 'manual' | 'ai';

export type ProviderPricingRow = {
  provider: ProviderType;
  /**
   * Optional model id. When set, this row applies only to that model.
   * When null/undefined, it acts as the provider default (fallback).
   */
  model?: string | null;
  /** Price per 1,000,000 tokens (in selected currency). */
  inputCostPer1m: number | null;
  /** Price per 1,000,000 tokens (in selected currency). */
  outputCostPer1m: number | null;
  /** ISO date string (YYYY-MM-DD) in local timezone semantics; nullable means "always". */
  effectiveFrom?: string | null;
  pricingSource: PricingSource;
  pricingUpdatedAt: string;
  createdAt: string;
};

export type UsagePricingSettings = {
  currency: CurrencyCode;
  updatedAt: string;
  providers: ProviderPricingRow[];
};

export type UsagePricingAutofillResult = {
  /** Suggested currency (only provided if the app can infer it). */
  currency?: CurrencyCode;
  /** Suggested provider pricing rows. */
  providers: ProviderPricingRow[];
  /**
   * Per-row metadata explaining where the values came from. Key is `${provider}:${model ?? 'default'}`.
   */
  meta: Record<string, { sourceUrl?: string; note?: string; confidence: 'high' | 'medium' | 'low' }>;
  generatedAt: string;
  message: string;
};

export type UsagePricingAutofillRequest = {
  currency?: CurrencyCode;
  /** Explicit list of provider/model pairs to fetch. */
  targets: Array<{ provider: ProviderType; model?: string | null }>;
};

export type UsageProviderBreakdown = {
  provider: ProviderType;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Sum of costs for priced events; null when provider pricing missing for this period. */
  cost: number | null;
  /** Number of events that were missing pricing at the time they occurred. */
  unpricedEvents: number;
};

export type UsageSummary = {
  period: UsagePeriod;
  rangeStart: string;
  rangeEnd: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /**
   * Sum of costs for priced events; null when no pricing configured at all.
   * When only some providers are priced, this is a partial sum and `unpricedProviders`
   * indicates what's missing.
   */
  cost: number | null;
  currency?: CurrencyCode;
  providerBreakdown: UsageProviderBreakdown[];
  unpricedProviders: ProviderType[];
  estimatedEvents: number;
  totalEvents: number;
};
