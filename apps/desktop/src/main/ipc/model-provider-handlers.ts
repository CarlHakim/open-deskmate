import type { ModelConfig, ProviderConfig } from "@accomplish/shared";
import type { IpcMainInvokeEvent } from "electron";
import { listModelProviders } from "../services/model-providers";
import { sanitizeToolsetIds } from "../services/toolsets";
import { deleteBuiltinProviderModel, deleteCustomModelProvider, listBuiltinProviderModelOverrides, listCustomModelProviders, upsertBuiltinProviderModel, upsertCustomModelProvider } from "../store/modelProviders";
import { handle } from "./register-handler";
import { sanitizeProviderId, sanitizeString } from './sanitizers';

/**
 * Register provider catalog and custom model configuration handlers
 */
export function registerModelProviderHandlers(): void {

  // Model providers: merged list (built-ins + user custom)
  handle('model-providers:list', async () => {
    return listModelProviders();
  });


  // Model providers: custom providers only
  handle('model-providers:custom:list', async () => {
    return listCustomModelProviders();
  });


  // Model providers: user-added models for built-in providers such as Google/OpenAI/Anthropic/xAI.
  handle('model-providers:builtin-models:list', async () => {
    return listBuiltinProviderModelOverrides();
  });


  handle('model-providers:builtin-models:upsert', async (
    _event: IpcMainInvokeEvent,
    payload: { providerId: string; model: ModelConfig }
  ) => {
    const providerId = sanitizeProviderId(payload?.providerId, 'providerId');
    const model = payload?.model;
    if (!model || typeof model !== 'object') {
      throw new Error('model is required');
    }
    const modelId = sanitizeString(model.id, 'model.id', 128);
    const displayName = sanitizeString(model.displayName || modelId, 'model.displayName', 128);
    const contextWindow = typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow)
      ? Math.max(1, Math.floor(model.contextWindow))
      : undefined;
    const maxOutputTokens = typeof model.maxOutputTokens === 'number' && Number.isFinite(model.maxOutputTokens)
      ? Math.max(1, Math.floor(model.maxOutputTokens))
      : undefined;
    const toolsetIds = model.toolsetIds !== undefined
      ? sanitizeToolsetIds(model.toolsetIds, 'model.toolsetIds')
      : undefined;
    return upsertBuiltinProviderModel(providerId, {
      id: modelId,
      displayName,
      provider: providerId,
      fullId: `${providerId}/${modelId}`,
      contextWindow,
      maxOutputTokens,
      supportsVision: model.supportsVision === true ? true : undefined,
      toolsetIds,
    });
  });


  handle('model-providers:builtin-models:delete', async (
    _event: IpcMainInvokeEvent,
    payload: { providerId: string; modelId: string }
  ) => {
    const providerId = sanitizeProviderId(payload?.providerId, 'providerId');
    const modelId = sanitizeString(payload?.modelId, 'modelId', 256);
    return { ok: deleteBuiltinProviderModel(providerId, modelId) };
  });


  // Model providers: create/update custom provider
  handle('model-providers:upsert', async (_event: IpcMainInvokeEvent, config: ProviderConfig) => {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid provider configuration');
    }

    const providerId = sanitizeProviderId(config.id, 'provider.id');
    const name = sanitizeString(config.name || providerId, 'provider.name', 128);
    const requiresApiKey = config.requiresApiKey !== false;
    const baseUrl = config.baseUrl ? sanitizeString(config.baseUrl, 'provider.baseUrl', 1024) : undefined;
    const apiKeyEnvVar = config.apiKeyEnvVar ? sanitizeString(config.apiKeyEnvVar, 'provider.apiKeyEnvVar', 128) : undefined;

    const models = Array.isArray(config.models) ? config.models : [];
    if (models.length === 0) {
      throw new Error('Provider must include at least one model');
    }

    const sanitizedModels: ModelConfig[] = models.map((model, index) => {
      const modelId = sanitizeString(model?.id, `models[${index}].id`, 128);
      const displayName = sanitizeString(model?.displayName || modelId, `models[${index}].displayName`, 128);
      const fullId = model?.fullId
        ? sanitizeString(model.fullId, `models[${index}].fullId`, 256)
        : `${providerId}/${modelId}`;
      const contextWindow = typeof model?.contextWindow === 'number' && Number.isFinite(model.contextWindow)
        ? Math.max(1, Math.floor(model.contextWindow))
        : undefined;
      const maxOutputTokens = typeof model?.maxOutputTokens === 'number' && Number.isFinite(model.maxOutputTokens)
        ? Math.max(1, Math.floor(model.maxOutputTokens))
        : undefined;
      const toolsetIds = model?.toolsetIds !== undefined
        ? sanitizeToolsetIds(model.toolsetIds, `models[${index}].toolsetIds`)
        : undefined;
      return {
        id: modelId,
        displayName,
        provider: providerId,
        fullId,
        contextWindow,
        maxOutputTokens,
        supportsVision: model?.supportsVision === true ? true : undefined,
        toolsetIds,
      };
    });

    return upsertCustomModelProvider({
      id: providerId,
      name,
      requiresApiKey,
      baseUrl,
      apiKeyEnvVar,
      models: sanitizedModels,
    });
  });


  // Model providers: delete custom provider
  handle('model-providers:delete', async (_event: IpcMainInvokeEvent, providerId: string) => {
    const id = sanitizeProviderId(providerId, 'providerId');
    return { ok: deleteCustomModelProvider(id) };
  });
}
