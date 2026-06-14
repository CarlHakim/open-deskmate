import type { SelectedModel } from '@accomplish/shared';
import { getOllamaConfig } from '../store/appSettings';
import { resolveSelectedModelForAgent } from './agent-context';

const OLLAMA_PREFLIGHT_TIMEOUT_MS = 5000;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function modelNameFromSelectedModel(selectedModel: SelectedModel): string {
  return normalizeText(selectedModel.model).replace(/^ollama\//i, '').trim();
}

function normalizeBaseUrl(value: unknown): string {
  return normalizeText(value).replace(/\/+$/, '');
}

async function fetchOllamaTags(baseUrl: string): Promise<Array<{ name?: string }>> {
  const response = await fetch(`${baseUrl}/api/tags`, {
    method: 'GET',
    signal: AbortSignal.timeout(OLLAMA_PREFLIGHT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }
  const data = await response.json() as { models?: Array<{ name?: string }> };
  return Array.isArray(data.models) ? data.models : [];
}

export async function assertOllamaReadyForAgent(agentId?: string): Promise<void> {
  const selectedModel = resolveSelectedModelForAgent(agentId);
  if (selectedModel?.provider !== 'ollama') {
    return;
  }

  const storedConfig = getOllamaConfig();
  const baseUrl = normalizeBaseUrl(selectedModel.baseUrl) || normalizeBaseUrl(storedConfig?.baseUrl);
  const modelName = modelNameFromSelectedModel(selectedModel);

  if (!baseUrl) {
    throw new Error('Ollama is selected for this agent, but no Ollama server URL is configured.');
  }
  if (!modelName) {
    throw new Error('Ollama is selected for this agent, but no local model is selected.');
  }

  let models: Array<{ name?: string }>;
  try {
    models = await fetchOllamaTags(baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'connection failed';
    throw new Error(`Cannot connect to Ollama at ${baseUrl}. Make sure Ollama is running. (${message})`);
  }

  const availableNames = new Set(
    models
      .map((model) => normalizeText(model.name))
      .filter(Boolean)
  );
  if (!availableNames.has(modelName)) {
    throw new Error(
      `Ollama is running, but the selected model "${modelName}" is not available. Pull it with "ollama pull ${modelName}" or re-test Ollama in Settings.`
    );
  }
}
