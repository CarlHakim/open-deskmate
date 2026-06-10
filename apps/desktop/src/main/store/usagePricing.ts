import Store from 'electron-store';
import type { ProviderType, UsagePricingSettings, ProviderPricingRow, CurrencyCode } from '@accomplish/shared';

type UsagePricingSchema = {
  currency: CurrencyCode;
  updatedAt: string;
  providers: ProviderPricingRow[];
};

const pricingStore = new Store<UsagePricingSchema>({
  name: 'usage-pricing',
  defaults: {
    currency: 'USD',
    updatedAt: new Date(0).toISOString(),
    providers: [],
  },
});

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePricingRow(row: ProviderPricingRow): ProviderPricingRow {
  const legacyInputCost = numberOrNull(row.inputCostPer1m);
  const inputMissCostPer1m = numberOrNull(row.inputMissCostPer1m) ?? legacyInputCost;
  return {
    ...row,
    model: row.model ?? null,
    inputHitCostPer1m: numberOrNull(row.inputHitCostPer1m),
    inputMissCostPer1m,
    outputCostPer1m: numberOrNull(row.outputCostPer1m),
    effectiveFrom: row.effectiveFrom ?? null,
  };
}

export function getUsagePricingSettings(): UsagePricingSettings {
  const providers = (pricingStore.get('providers') ?? []).map(normalizePricingRow);
  return {
    currency: pricingStore.get('currency') ?? 'USD',
    updatedAt: pricingStore.get('updatedAt') ?? new Date(0).toISOString(),
    providers,
  };
}

export function setUsagePricingSettings(settings: UsagePricingSettings): void {
  pricingStore.set('currency', settings.currency);
  pricingStore.set('updatedAt', settings.updatedAt);
  pricingStore.set('providers', settings.providers.map(normalizePricingRow));
}

export function upsertProviderPricing(row: ProviderPricingRow): void {
  const providers = pricingStore.get('providers') ?? [];
  const next = providers.filter((p) => !(
    p.provider === row.provider &&
    (p.model ?? null) === (row.model ?? null) &&
    (p.effectiveFrom ?? null) === (row.effectiveFrom ?? null)
  ));
  next.push(normalizePricingRow(row));
  pricingStore.set('providers', next);
  pricingStore.set('updatedAt', new Date().toISOString());
}

export function clearProviderPricing(provider: ProviderType): void {
  const providers = pricingStore.get('providers') ?? [];
  pricingStore.set('providers', providers.filter((p) => p.provider !== provider));
  pricingStore.set('updatedAt', new Date().toISOString());
}
