import { DEFAULT_PROVIDERS, type ProviderConfig } from '@accomplish/shared';
import { getOllamaConfig } from '../store/appSettings';
import { listBuiltinProviderModelOverrides, listCustomModelProviders } from '../store/modelProviders';

function mergeBuiltinProviderModelOverrides(provider: ProviderConfig): ProviderConfig {
  const overrides = listBuiltinProviderModelOverrides()[provider.id] ?? [];
  if (overrides.length === 0) return provider;
  const models = [...provider.models];
  for (const model of overrides) {
    const index = models.findIndex((entry) => entry.id === model.id || entry.fullId === model.fullId);
    if (index >= 0) {
      models[index] = model;
    } else {
      models.push(model);
    }
  }
  return { ...provider, models };
}

export function listModelProviders(): ProviderConfig[] {
  const builtinProviders = DEFAULT_PROVIDERS.map(mergeBuiltinProviderModelOverrides);
  const ollamaConfig = getOllamaConfig();
  const ollamaProvider: ProviderConfig[] = ollamaConfig?.enabled
    ? [{
        id: 'ollama',
        name: 'Ollama',
        requiresApiKey: false,
        baseUrl: ollamaConfig.baseUrl,
        models: (ollamaConfig.models ?? []).map((model) => ({
          id: model.id,
          displayName: model.displayName || model.id,
          provider: 'ollama',
          fullId: model.id.startsWith('ollama/') ? model.id : `ollama/${model.id}`,
          contextWindow: 8192,
          maxOutputTokens: 2048,
        })),
      }]
    : [];
  const custom = listCustomModelProviders();
  return [...builtinProviders, ...ollamaProvider, ...custom];
}

export function getModelProvider(providerId: string): ProviderConfig | undefined {
  const id = providerId.trim().toLowerCase();
  return listModelProviders().find((provider) => provider.id === id);
}
