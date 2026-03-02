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

export function getUsagePricingSettings(): UsagePricingSettings {
  const providers = (pricingStore.get('providers') ?? []).map((row) => ({
    ...row,
    model: row.model ?? null,
    effectiveFrom: row.effectiveFrom ?? null,
  }));
  return {
    currency: pricingStore.get('currency') ?? 'USD',
    updatedAt: pricingStore.get('updatedAt') ?? new Date(0).toISOString(),
    providers,
  };
}

export function setUsagePricingSettings(settings: UsagePricingSettings): void {
  pricingStore.set('currency', settings.currency);
  pricingStore.set('updatedAt', settings.updatedAt);
  pricingStore.set('providers', settings.providers);
}

export function upsertProviderPricing(row: ProviderPricingRow): void {
  const providers = pricingStore.get('providers') ?? [];
  const next = providers.filter((p) => !(
    p.provider === row.provider &&
    (p.model ?? null) === (row.model ?? null) &&
    (p.effectiveFrom ?? null) === (row.effectiveFrom ?? null)
  ));
  next.push(row);
  pricingStore.set('providers', next);
  pricingStore.set('updatedAt', new Date().toISOString());
}

export function clearProviderPricing(provider: ProviderType): void {
  const providers = pricingStore.get('providers') ?? [];
  pricingStore.set('providers', providers.filter((p) => p.provider !== provider));
  pricingStore.set('updatedAt', new Date().toISOString());
}
