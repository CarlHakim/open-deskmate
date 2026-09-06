import { findSubagentRunByChildTaskId } from '../store/subagentRegistry';
import { BrowserWindow } from 'electron';
import type { GatewayPeerKind } from '../store/gatewayBindings';
import { initPermissionApi, startPermissionApiServer } from '../permission-api';
import { startNodeToolsApiServer } from '../node-tools-api';
import { getAgentContext } from '../services/agent-context';
import {
  getActiveAgentEngineTaskCount,
  getActiveAgentEngineTaskId,
  getAgentEngineTaskConfig,
  hasActiveAgentEngineTask,
} from './agent-engine';
import { upsertGatewaySession } from '../store/gatewaySessions';
import type { TaskGatewaySessionContext } from './task-execution-lifecycle';

let permissionApiInitialized = false;
let nodeToolsApiInitialized = false;

export interface GatewayRouteContext {
  channel?: string;
  accountId?: string;
  connectorInstanceId?: string;
  peerKind?: GatewayPeerKind;
  peerId?: string;
}

export function ensureTaskDispatchRuntimeServices(): void {
  ensureTaskDispatchPermissionApi();
  ensureTaskDispatchNodeToolsApi();
}

export function ensureTaskDispatchPermissionApi(): void {
  if (permissionApiInitialized) return;
  const windows = BrowserWindow.getAllWindows();
  const mainWindow = windows.length > 0 ? windows[0] : null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  initPermissionApi(mainWindow, {
    resolveTaskId: (requestedTaskId?: string) => {
      if (requestedTaskId && hasActiveAgentEngineTask(requestedTaskId)) {
        return requestedTaskId;
      }
      if (getActiveAgentEngineTaskCount() === 1) {
        return getActiveAgentEngineTaskId();
      }
      return null;
    },
    resolveTaskWorkspaceRoot: (taskId: string) => {
      const taskConfig = getAgentEngineTaskConfig(taskId);
  const isolatedWorkspace = findSubagentRunByChildTaskId(taskId)?.worktree?.path;
  if (isolatedWorkspace) return isolatedWorkspace;
      const agentWorkspace = taskConfig?.agentId
        ? (getAgentContext(taskConfig.agentId).workspaceRoot || '').trim()
        : '';
      if (agentWorkspace) {
        return agentWorkspace;
      }
      const fallbackWorkingDir = String(taskConfig?.workingDirectory || '').trim();
      return fallbackWorkingDir || null;
    },
  });
  startPermissionApiServer();
  permissionApiInitialized = true;
}

export function ensureTaskDispatchNodeToolsApi(): void {
  if (nodeToolsApiInitialized) return;
  startNodeToolsApiServer();
  nodeToolsApiInitialized = true;
}

export function normalizeGatewaySessionKey(input: string | undefined): string | undefined {
  const normalized = (input ?? '').trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeGatewayRouteContext(route: GatewayRouteContext | undefined): GatewayRouteContext | undefined {
  if (!route) return undefined;
  const channel = (route.channel ?? '').trim().toLowerCase() || undefined;
  const accountId = (route.accountId ?? '').trim() || undefined;
  const connectorInstanceId = (route.connectorInstanceId ?? '').trim() || undefined;
  const peerId = (route.peerId ?? '').trim() || undefined;
  if (!channel && !accountId && !connectorInstanceId && !route.peerKind && !peerId) {
    return undefined;
  }
  return {
    channel,
    accountId,
    connectorInstanceId,
    peerKind: route.peerKind,
    peerId,
  };
}

export function createGatewaySessionContext(params: {
  sessionKey?: string;
  route?: GatewayRouteContext;
  agentId: string;
  taskId: string;
  sessionId?: string;
  lastPrompt: string;
}): TaskGatewaySessionContext | undefined {
  if (!params.sessionKey) {
    return undefined;
  }
  return {
    key: params.sessionKey,
    agentId: params.agentId,
    sessionId: params.sessionId,
    taskId: params.taskId,
    channel: params.route?.channel,
    accountId: params.route?.accountId,
    peerKind: params.route?.peerKind,
    peerId: params.route?.peerId,
    lastPrompt: params.lastPrompt,
  };
}

export function persistGatewaySessionContext(context?: TaskGatewaySessionContext): void {
  if (!context) return;
  upsertGatewaySession(context);
}
