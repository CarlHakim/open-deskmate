import { DEFAULT_PROVIDERS, type ProviderConfig } from '@accomplish/shared';
import { getOllamaConfig } from '../store/appSettings';
import { listCustomModelProviders } from '../store/modelProviders';

export function listModelProviders(): ProviderConfig[] {
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
  return [...DEFAULT_PROVIDERS, ...ollamaProvider, ...custom];
}

export function getModelProvider(providerId: string): ProviderConfig | undefined {
  const id = providerId.trim().toLowerCase();
  return listModelProviders().find((provider) => provider.id === id);
}
