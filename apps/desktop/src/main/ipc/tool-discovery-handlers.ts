import type { IpcMainInvokeEvent } from "electron";
import { describeTool, describeToolset, enableTaskScopedTools, listAvailableTools, listAvailableToolsets, listEnabledTaskTools, sanitizeToolsetIds, searchToolsetsAndTools } from "../services/toolsets";
import { handle } from "./register-handler";
import { sanitizeOptionalText, sanitizeString } from './sanitizers';

export function registerToolDiscoveryHandlers(): void {

  // Toolsets/tools: formal registry discovery metadata.
  handle('toolsets:list', async () => {
    return listAvailableToolsets();
  });


  handle('toolsets:search', async (_event: IpcMainInvokeEvent, query?: unknown) => {
    const sanitizedQuery = query == null ? '' : sanitizeOptionalText(query, 'query', 256);
    return searchToolsetsAndTools(sanitizedQuery);
  });


  handle('toolsets:describe', async (_event: IpcMainInvokeEvent, toolsetId: unknown) => {
    const id = sanitizeString(toolsetId, 'toolsetId', 64);
    return describeToolset(id);
  });


  handle('tools:list', async (_event: IpcMainInvokeEvent, payload?: { toolsetIds?: unknown }) => {
    const toolsetIds = payload && Object.prototype.hasOwnProperty.call(payload, 'toolsetIds')
      ? sanitizeToolsetIds(payload.toolsetIds, 'toolsetIds')
      : undefined;
    return listAvailableTools(toolsetIds);
  });


  handle('tools:search', async (_event: IpcMainInvokeEvent, query?: unknown) => {
    const sanitizedQuery = query == null ? '' : sanitizeOptionalText(query, 'query', 256);
    return searchToolsetsAndTools(sanitizedQuery);
  });


  handle('tools:describe', async (_event: IpcMainInvokeEvent, toolName: unknown) => {
    const name = sanitizeString(toolName, 'toolName', 128);
    return describeTool(name);
  });


  handle('tools:enabled:list', async (_event: IpcMainInvokeEvent, payload?: {
    agentId?: unknown;
    taskId?: unknown;
    deferredToolDiscoveryEnabled?: unknown;
    requestedToolsetIds?: unknown;
    initialToolsetIds?: unknown;
  }) => {
    const requestedToolsetIds = payload && Object.prototype.hasOwnProperty.call(payload, 'requestedToolsetIds')
      ? sanitizeToolsetIds(payload.requestedToolsetIds, 'requestedToolsetIds')
      : undefined;
    const initialToolsetIds = payload && Object.prototype.hasOwnProperty.call(payload, 'initialToolsetIds')
      ? sanitizeToolsetIds(payload.initialToolsetIds, 'initialToolsetIds')
      : undefined;
    return listEnabledTaskTools({
      agentId: typeof payload?.agentId === 'string' && payload.agentId.trim() ? sanitizeString(payload.agentId, 'agentId', 64) : undefined,
      taskId: typeof payload?.taskId === 'string' && payload.taskId.trim() ? sanitizeString(payload.taskId, 'taskId', 128) : undefined,
      deferredToolDiscoveryEnabled: payload?.deferredToolDiscoveryEnabled === true,
      requestedToolsetIds,
      initialToolsetIds,
    });
  });


  handle('tools:enable', async (_event: IpcMainInvokeEvent, payload?: {
    request?: {
      agentId?: unknown;
      taskId?: unknown;
      toolsetIds?: unknown;
      capabilityNames?: unknown;
      toolNames?: unknown;
      reason?: unknown;
    };
    agentId?: unknown;
    taskId?: unknown;
    deferredToolDiscoveryEnabled?: unknown;
    requestedToolsetIds?: unknown;
    initialToolsetIds?: unknown;
  }) => {
    const request = payload?.request || {};
    const requestedToolsetIds = payload && Object.prototype.hasOwnProperty.call(payload, 'requestedToolsetIds')
      ? sanitizeToolsetIds(payload.requestedToolsetIds, 'requestedToolsetIds')
      : undefined;
    const initialToolsetIds = payload && Object.prototype.hasOwnProperty.call(payload, 'initialToolsetIds')
      ? sanitizeToolsetIds(payload.initialToolsetIds, 'initialToolsetIds')
      : undefined;
    return enableTaskScopedTools({
      request: {
        agentId: typeof request.agentId === 'string' && request.agentId.trim() ? sanitizeString(request.agentId, 'request.agentId', 64) : undefined,
        taskId: typeof request.taskId === 'string' && request.taskId.trim() ? sanitizeString(request.taskId, 'request.taskId', 128) : undefined,
        toolsetIds: Array.isArray(request.toolsetIds)
          ? request.toolsetIds.map((entry) => sanitizeString(entry, 'request.toolsetIds', 64))
          : undefined,
        capabilityNames: Array.isArray(request.capabilityNames)
          ? request.capabilityNames.map((entry) => sanitizeString(entry, 'request.capabilityNames', 128))
          : undefined,
        toolNames: Array.isArray(request.toolNames)
          ? request.toolNames.map((entry) => sanitizeString(entry, 'request.toolNames', 128))
          : undefined,
        reason: typeof request.reason === 'string' && request.reason.trim()
          ? sanitizeOptionalText(request.reason, 'request.reason', 500)
          : undefined,
      },
      agentId: typeof payload?.agentId === 'string' && payload.agentId.trim() ? sanitizeString(payload.agentId, 'agentId', 64) : undefined,
      taskId: typeof payload?.taskId === 'string' && payload.taskId.trim() ? sanitizeString(payload.taskId, 'taskId', 128) : undefined,
      deferredToolDiscoveryEnabled: payload?.deferredToolDiscoveryEnabled === true,
      requestedToolsetIds,
      initialToolsetIds,
    });
  });
}
