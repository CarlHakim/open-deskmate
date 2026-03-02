import type { SelectedModel, ProviderType } from '@accomplish/shared';
import { getModelContextLimitOverride } from '../../store/modelLimits';
import { listModelProviders } from '../model-providers';

export type Pricing = {
  inputPer1MTokens?: number;
  outputPer1MTokens?: number;
  cachedInputPer1MTokens?: number;
};

export type ModelRegistryEntry = {
  provider: ProviderType;
  fullId: string;
  contextLimitTokens: number;
  defaultMaxOutputTokens: number;
  pricing?: Pricing;
};

const PRICING_OVERRIDES: Record<string, Pricing> = {
  // Optional: fill in if you want cost computation.
};

export function getPricingForModel(fullId: string): Pricing | undefined {
  return PRICING_OVERRIDES[fullId];
}

export function computeCostUsd(params: { usageInputTokens: number; usageOutputTokens: number; cachedInputTokens?: number; pricing?: Pricing }): number | null {
  const pricing = params.pricing;
  if (!pricing) return null;

  const input = Math.max(0, params.usageInputTokens);
  const output = Math.max(0, params.usageOutputTokens);
  const cached = Math.max(0, params.cachedInputTokens ?? 0);
  const uncachedInput = Math.max(0, input - cached);

  const inputCost = pricing.inputPer1MTokens ? (uncachedInput / 1_000_000) * pricing.inputPer1MTokens : 0;
  const cachedCost = pricing.cachedInputPer1MTokens ? (cached / 1_000_000) * pricing.cachedInputPer1MTokens : 0;
  const outputCost = pricing.outputPer1MTokens ? (output / 1_000_000) * pricing.outputPer1MTokens : 0;

  const total = inputCost + cachedCost + outputCost;
  // If all pricing fields are missing, treat as no pricing configured.
  if (!pricing.inputPer1MTokens && !pricing.outputPer1MTokens && !pricing.cachedInputPer1MTokens) return null;
  return total;
}

export function getModelEntry(selectedModel: SelectedModel | null): ModelRegistryEntry | null {
  if (!selectedModel?.model) return null;
  const fullId = selectedModel.model;
  const provider = selectedModel.provider;

  const providerConfig = listModelProviders().find((p) => p.id === provider);
  const modelConfig = providerConfig?.models?.find((m) => m.fullId === fullId);

  const defaultContextLimitTokens = modelConfig?.contextWindow ?? 128000;
  const overrideLimit = getModelContextLimitOverride(fullId);
  const contextLimitTokens = overrideLimit ?? defaultContextLimitTokens;
  const defaultMaxOutputTokens = modelConfig?.maxOutputTokens ?? 4096;

  return {
    provider,
    fullId,
    contextLimitTokens,
    defaultMaxOutputTokens,
    pricing: getPricingForModel(fullId),
  };
}
