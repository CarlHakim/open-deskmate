import { DEFAULT_PROVIDERS, type ProviderConfig } from '@accomplish/shared';
import { listCustomModelProviders } from '../store/modelProviders';

export function listModelProviders(): ProviderConfig[] {
  const custom = listCustomModelProviders();
  return [...DEFAULT_PROVIDERS, ...custom];
}

export function getModelProvider(providerId: string): ProviderConfig | undefined {
  const id = providerId.trim().toLowerCase();
  return listModelProviders().find((provider) => provider.id === id);
}
