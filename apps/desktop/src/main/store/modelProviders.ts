import Store from 'electron-store';
import type { ModelConfig, ProviderConfig } from '@accomplish/shared';

interface ModelProvidersStoreSchema {
  customProviders: ProviderConfig[];
}

const BUILTIN_PROVIDER_IDS = new Set(['anthropic', 'openai', 'google', 'xai', 'ollama', 'custom']);
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const modelProvidersStore = new Store<ModelProvidersStoreSchema>({
  name: 'model-providers',
  defaults: {
    customProviders: [],
  },
});

function sanitizeProviderId(value: string): string {
  return value.trim().toLowerCase();
}

function assertValidProviderId(providerId: string): void {
  if (!PROVIDER_ID_RE.test(providerId)) {
    throw new Error('Provider id must be 1-64 chars and contain only letters, numbers, _ or -');
  }
  if (BUILTIN_PROVIDER_IDS.has(providerId)) {
    throw new Error(`Provider id "${providerId}" is reserved`);
  }
}

function sanitizeModelId(value: string): string {
  return value.trim();
}

function normalizeModel(providerId: string, model: ModelConfig): ModelConfig {
  const id = sanitizeModelId(model.id);
  const fullId = model.fullId?.trim() || `${providerId}/${id}`;
  return {
    ...model,
    id,
    fullId,
    provider: providerId,
    displayName: model.displayName?.trim() || id,
  };
}

export function listCustomModelProviders(): ProviderConfig[] {
  return modelProvidersStore.get('customProviders') ?? [];
}

export function getCustomModelProvider(providerId: string): ProviderConfig | undefined {
  const id = sanitizeProviderId(providerId);
  return listCustomModelProviders().find((provider) => provider.id === id);
}

export function upsertCustomModelProvider(config: ProviderConfig): ProviderConfig {
  const providerId = sanitizeProviderId(config.id);
  assertValidProviderId(providerId);

  const models = (config.models ?? [])
    .map((model) => normalizeModel(providerId, model))
    .filter((model) => model.id.length > 0 && model.fullId.length > 0);

  if (models.length === 0) {
    throw new Error('Provider must include at least one model');
  }

  const normalized: ProviderConfig = {
    id: providerId,
    name: config.name?.trim() || providerId,
    requiresApiKey: config.requiresApiKey !== false,
    apiKeyEnvVar: config.apiKeyEnvVar?.trim() || undefined,
    baseUrl: config.baseUrl?.trim() || undefined,
    models: models.reduce<ModelConfig[]>((acc, model) => {
      if (!acc.some((entry) => entry.fullId === model.fullId)) {
        acc.push(model);
      }
      return acc;
    }, []),
  };

  const existing = listCustomModelProviders();
  const index = existing.findIndex((provider) => provider.id === providerId);
  const next = [...existing];
  if (index >= 0) {
    // Merge models so repeated upserts can append to an existing provider.
    const prev = existing[index];
    const mergedModels = [...(prev.models ?? [])];
    for (const model of normalized.models) {
      const modelIndex = mergedModels.findIndex((entry) => entry.fullId === model.fullId);
      if (modelIndex >= 0) {
        mergedModels[modelIndex] = model;
      } else {
        mergedModels.push(model);
      }
    }
    next[index] = {
      ...prev,
      ...normalized,
      models: mergedModels,
    };
  } else {
    next.push(normalized);
  }
  modelProvidersStore.set('customProviders', next);
  return next.find((provider) => provider.id === providerId) as ProviderConfig;
}

export function replaceCustomModelProviders(providers: ProviderConfig[]): ProviderConfig[] {
  const normalized = providers.map((provider) => upsertCustomModelProvider(provider));
  modelProvidersStore.set('customProviders', normalized);
  return normalized;
}

export function deleteCustomModelProvider(providerId: string): boolean {
  const id = sanitizeProviderId(providerId);
  const existing = listCustomModelProviders();
  const next = existing.filter((provider) => provider.id !== id);
  if (next.length === existing.length) {
    return false;
  }
  modelProvidersStore.set('customProviders', next);
  return true;
}
