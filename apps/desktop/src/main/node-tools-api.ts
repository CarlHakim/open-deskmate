/**
 * Node Tools API Server
 *
 * HTTP server that MCP node tools call to request node actions
 * from the Electron main process.
 */

import http from 'http';
import { getMobileNodesEnabled } from './store/appSettings';
import { listNodePairing } from './store/nodePairing';
import { invokeNodeCommand } from './services/node-commands';
import type { GatewayConnectorExtensionId } from '@accomplish/shared';
import { sendConnectorOutboundMessage } from './services/connector-outbound';
import { isGatewayConnectorExtensionId } from './store/gatewayConnectorExtensions';
import { isAppConnectorExtensionId } from './store/appConnectorExtensions';
import { executeAppConnectorAction, listAppConnectorRuntimeStatuses } from './services/app-connector-runtimes';
import { spawnSubagent } from './services/subagents/subagent-spawn';
import {
  archiveSubagentRun,
  closeSubagentSession,
  getActiveSubagentCount,
  getSubagentRunForUi,
  listSubagentRunTreeForParentTask,
  listSubagentRunsForParentTask,
  sendSubagentPrompt,
  waitForSubagentRun,
} from './services/subagents/subagent-control';
import { getSubagentRun, patchSubagentRun } from './store/subagentRegistry';
import { stopAgentEngineTask } from './runtime/agent-engine';
import { updateTaskStatus } from './store/taskHistory';
import { runRuntimeHooks } from './hooks/hook-runner';
import { executeRegisteredPluginTool, getRegisteredPluginToolByName, listRegisteredPluginTools } from './plugins/plugin-runtime';

export const NODE_TOOLS_API_PORT = 9229;

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function resolveNodeToolName(pathname?: string): string | null {
  switch (pathname) {
    case '/nodes/camera/snapshot':
      return 'nodes_camera_snapshot';
    case '/connectors/send-message':
      return 'connector_send_message';
    case '/app-connectors/execute':
      return 'app_connector_execute';
    case '/app-connectors/list':
      return 'app_connector_list';
    case '/subagents/spawn':
      return 'subagent_spawn';
    case '/subagents/list':
      return 'subagent_list';
    case '/subagents/get':
      return 'subagent_get';
    case '/subagents/wait':
      return 'subagent_wait';
    case '/subagents/send':
      return 'subagent_send';
    case '/subagents/archive':
      return 'subagent_archive';
    case '/subagents/close':
      return 'subagent_close';
    case '/subagents/stop':
      return 'subagent_stop';
    case '/plugins/tools/list':
      return 'plugin_tools_list';
    default:
      return null;
  }
}

function resolveHookAgentId(toolName: string | null, data: Record<string, unknown>): string | undefined {
  if (!toolName) return undefined;
  if (toolName === 'subagent_spawn') {
    const agentId = normalizeText(data.parentAgentId ?? data.agentId, 64).toLowerCase();
    return agentId || undefined;
  }
  if (
    toolName === 'subagent_get'
    || toolName === 'subagent_wait'
    || toolName === 'subagent_send'
    || toolName === 'subagent_archive'
    || toolName === 'subagent_close'
    || toolName === 'subagent_stop'
  ) {
    const runId = normalizeText(data.runId, 128);
    const run = runId ? getSubagentRun(runId) : null;
    return run?.parentAgentId;
  }
  if (getRegisteredPluginToolByName(toolName)) {
    const agentId = normalizeText(data.parentAgentId ?? data.agentId, 64).toLowerCase();
    return agentId || undefined;
  }
  return undefined;
}

async function emitAfterNodeToolHook(params: {
  toolName: string | null;
  data: Record<string, unknown>;
  output: Record<string, unknown>;
}): Promise<void> {
  if (!params.toolName) return;
  await runRuntimeHooks({
    event: 'after_node_tool',
    toolName: params.toolName,
    agentId: resolveHookAgentId(params.toolName, params.data),
    input: params.data,
    output: params.output,
  });
}

function selectDefaultNodeId(): string | null {
  const paired = listNodePairing().paired || [];
  const allowed = paired.filter((node) => node.aiAccessAllowed);
  if (allowed.length === 0) return null;
  allowed.sort((a, b) => {
    const aTs = a.lastConnectedAtMs ?? a.approvedAtMs ?? 0;
    const bTs = b.lastConnectedAtMs ?? b.approvedAtMs ?? 0;
    return bTs - aTs;
  });
  return allowed[0]?.nodeId ?? null;
}

function resolveNodeId(input?: string): { nodeId: string; displayName?: string } | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const paired = listNodePairing().paired || [];
  const normalizedInput = trimmed.toLowerCase();
  const matchById = paired.find((node) => node.nodeId.toLowerCase() === normalizedInput);
  if (matchById) return { nodeId: matchById.nodeId, displayName: matchById.displayName };
  const exactName = paired.find(
    (node) => (node.displayName || '').trim().toLowerCase() === normalizedInput
  );
  if (exactName) return { nodeId: exactName.nodeId, displayName: exactName.displayName };
  const partialMatches = paired.filter((node) =>
    (node.displayName || '').trim().toLowerCase().includes(normalizedInput)
  );
  if (partialMatches.length === 1) {
    return { nodeId: partialMatches[0]?.nodeId ?? '', displayName: partialMatches[0]?.displayName };
  }
  return null;
}

/**
 * Create and start the HTTP server for node tool requests
 */
export function startNodeToolsApiServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (
      req.method !== 'POST'
      || (req.url !== '/nodes/camera/snapshot'
        && req.url !== '/connectors/send-message'
        && req.url !== '/app-connectors/execute'
        && req.url !== '/app-connectors/list'
        && req.url !== '/plugins/tools/list'
        && req.url !== '/plugins/tools/execute'
        && req.url !== '/subagents/spawn'
        && req.url !== '/subagents/list'
        && req.url !== '/subagents/get'
        && req.url !== '/subagents/wait'
        && req.url !== '/subagents/send'
        && req.url !== '/subagents/archive'
        && req.url !== '/subagents/close'
        && req.url !== '/subagents/stop')
    ) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body || '{}') as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON' });
      return;
    }
    let toolName = resolveNodeToolName(req.url);
    if (req.url === '/plugins/tools/execute') {
      toolName = normalizeText(data.name, 128).toLowerCase() || 'plugin_tool';
    }
    const hookResult = await runRuntimeHooks({
      event: 'before_node_tool',
      toolName: toolName || undefined,
      agentId: resolveHookAgentId(toolName, data),
      input: data,
    });
    if (!hookResult.ok) {
      sendJson(res, 403, {
        error: 'blocked_by_hook',
        detail: hookResult.blockReason || 'Blocked by runtime hook',
      });
      return;
    }
    if (hookResult.inputPatch) {
      data = { ...data, ...hookResult.inputPatch };
    }

    if (req.url === '/nodes/camera/snapshot') {
      if (!getMobileNodesEnabled()) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'mobile_nodes_disabled' } }).catch(() => {});
        sendJson(res, 403, { error: 'mobile_nodes_disabled' });
        return;
      }

      const requestedNodeId = typeof data.nodeId === 'string' ? data.nodeId.trim() : '';
      const requestedNodeName = typeof data.nodeName === 'string' ? data.nodeName.trim() : '';
      const requested = requestedNodeId || requestedNodeName;
      const resolved = requested ? resolveNodeId(requested) : null;
      if (requested && !resolved) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'node_not_found' } }).catch(() => {});
        sendJson(res, 404, { error: 'node_not_found', detail: 'No matching node for provided name/id.' });
        return;
      }
      const nodeId = resolved?.nodeId || selectDefaultNodeId();
      if (!nodeId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'no_ai_allowed_nodes' } }).catch(() => {});
        sendJson(res, 404, { error: 'no_ai_allowed_nodes' });
        return;
      }

      const paired = listNodePairing().paired || [];
      const node = paired.find((entry) => entry.nodeId === nodeId);
      if (!node) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'node_not_found' } }).catch(() => {});
        sendJson(res, 404, { error: 'node_not_found' });
        return;
      }
      if (!node.aiAccessAllowed) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'ai_access_disabled' } }).catch(() => {});
        sendJson(res, 403, { error: 'ai_access_disabled' });
        return;
      }

      try {
        const result = await invokeNodeCommand({
          nodeId,
          command: 'camera.snapshot',
          payload: { requestedAt: new Date().toISOString(), target: 'snapshot' },
          timeoutMs: 25_000,
        });

        if (!result.ok) {
          await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: result.error || 'snapshot_failed' } }).catch(() => {});
          sendJson(res, 500, { error: result.error || 'snapshot_failed' });
          return;
        }

        const payload = result.payload as { mime?: string; dataBase64?: string } | undefined;
        if (!payload?.dataBase64) {
          await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'snapshot_missing_payload' } }).catch(() => {});
          sendJson(res, 500, { error: 'snapshot_missing_payload' });
          return;
        }

        const mime = payload.mime || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${payload.dataBase64}`;
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, nodeId, nodeName: node.displayName || null, mime } }).catch(() => {});
        sendJson(res, 200, { ok: true, nodeId, nodeName: node.displayName || null, dataUrl });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'snapshot_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: message });
      }
      return;
    }

    if (req.url === '/app-connectors/execute') {
      const connector = normalizeText(data.connector, 64).toLowerCase();
      const connectorInstanceId = normalizeText(data.connectorInstanceId, 64) || undefined;
      const action = normalizeText(data.action, 96).toLowerCase();
      const args = data.args && typeof data.args === 'object' && !Array.isArray(data.args)
        ? data.args as Record<string, unknown>
        : undefined;

      if (!isAppConnectorExtensionId(connector)) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'invalid_connector' } }).catch(() => {});
        sendJson(res, 400, {
          error: 'invalid_connector',
          detail: `Unknown app connector "${connector || ''}".`,
        });
        return;
      }
      if (!action) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'action_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'action_required', detail: 'action is required' });
        return;
      }

      try {
        const result = await executeAppConnectorAction({
          connectorId: connector,
          connectorInstanceId,
          action,
          args,
        });
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, connector: result.connectorId, action: result.action } }).catch(() => {});
        sendJson(res, 200, {
          ok: true,
          connector: result.connectorId,
          connectorInstanceId: result.connectorInstanceId,
          runtimeKey: result.runtimeKey,
          action: result.action,
          detail: result.detail,
          data: result.data,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'app_connector_execute_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 400, { error: 'app_connector_execute_failed', detail: message });
      }
      return;
    }

    if (req.url === '/app-connectors/list') {
      try {
        const statuses = await listAppConnectorRuntimeStatuses();
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, count: statuses.length } }).catch(() => {});
        sendJson(res, 200, { ok: true, connectors: statuses });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'app_connector_list_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'app_connector_list_failed', detail: message });
      }
      return;
    }

    if (req.url === '/plugins/tools/list') {
      try {
        const tools = listRegisteredPluginTools().map((tool) => ({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
          action: tool.action,
        }));
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, count: tools.length } }).catch(() => {});
        sendJson(res, 200, { ok: true, tools });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'plugin_tools_list_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'plugin_tools_list_failed', detail: message });
      }
      return;
    }

    if (req.url === '/plugins/tools/execute') {
      const name = normalizeText(data.name, 128).toLowerCase();
      const args = data.arguments;
      if (!name) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'tool_name_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'tool_name_required', detail: 'name is required.' });
        return;
      }
      try {
        const result = await executeRegisteredPluginTool(name, args, {
          parentTaskId: normalizeText(data.parentTaskId ?? data.taskId, 128) || undefined,
          parentAgentId: normalizeText(data.parentAgentId ?? data.agentId, 64).toLowerCase() || undefined,
        });
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, tool: name } }).catch(() => {});
        sendJson(res, 200, { ok: true, tool: name, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'plugin_tool_execute_failed';
        const status = message.toLowerCase().includes('unknown plugin tool') ? 404 : 400;
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, status, { error: 'plugin_tool_execute_failed', detail: message });
      }
      return;
    }

    if (req.url === '/subagents/spawn') {
      const taskId = normalizeText(data.parentTaskId ?? data.taskId, 128);
      const agentId = normalizeText(data.parentAgentId ?? data.agentId, 64).toLowerCase();
      const targetAgentId = normalizeText(data.targetAgentId, 64).toLowerCase();
      const task = normalizeText(data.task, 8000);
      const label = normalizeText(data.label, 128) || undefined;
      const runTimeoutMs = typeof data.runTimeoutMs === 'number' ? data.runTimeoutMs : undefined;
      const mode = normalizeText(data.mode, 16).toLowerCase() === 'session' ? 'session' : 'run';
      const reuseExistingSession = typeof data.reuseExistingSession === 'boolean' ? data.reuseExistingSession : undefined;
      const modelProvider = normalizeText(data.modelProvider, 64).toLowerCase();
      const modelId = normalizeText(data.modelId, 256);
      const modelBaseUrl = normalizeText(data.modelBaseUrl, 1024) || undefined;
      if (!taskId || !agentId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'parent_context_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'parent_context_required', detail: 'parentTaskId and parentAgentId are required.' });
        return;
      }
      if (!targetAgentId || !task) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'target_agent_and_task_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'target_agent_and_task_required', detail: 'targetAgentId and task are required.' });
        return;
      }
      try {
        const result = await spawnSubagent(
          {
            targetAgentId,
            task,
            label,
            runTimeoutMs,
            mode,
            reuseExistingSession,
            model: modelProvider && modelId
              ? { provider: modelProvider, model: modelId, ...(modelBaseUrl ? { baseUrl: modelBaseUrl } : {}) }
              : null,
          },
          {
            parentTaskId: taskId,
            parentAgentId: agentId,
          }
        );
        await emitAfterNodeToolHook({ toolName, data, output: { ok: result.status === 'accepted', status: result.status, runId: result.runId } }).catch(() => {});
        sendJson(res, result.status === 'accepted' ? 200 : 400, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subagent_spawn_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'subagent_spawn_failed', detail: message });
      }
      return;
    }

    if (req.url === '/subagents/list') {
      const taskId = normalizeText(data.parentTaskId ?? data.taskId, 128);
      if (!taskId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'parent_task_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'parent_task_required', detail: 'parentTaskId is required.' });
        return;
      }
      await emitAfterNodeToolHook({ toolName, data, output: { ok: true, parentTaskId: taskId } }).catch(() => {});
      sendJson(res, 200, {
        ok: true,
        runs: listSubagentRunsForParentTask(taskId),
        tree: listSubagentRunTreeForParentTask(taskId),
        activeCount: getActiveSubagentCount(taskId),
      });
      return;
    }

    if (req.url === '/subagents/get') {
      const runId = normalizeText(data.runId, 128);
      if (!runId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'run_id_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'run_id_required', detail: 'runId is required.' });
        return;
      }
      const run = getSubagentRunForUi(runId);
      if (!run) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'subagent_not_found' } }).catch(() => {});
        sendJson(res, 404, { error: 'subagent_not_found' });
        return;
      }
      await emitAfterNodeToolHook({ toolName, data, output: { ok: true, runId } }).catch(() => {});
      sendJson(res, 200, { ok: true, run });
      return;
    }

    if (req.url === '/subagents/wait') {
      const runId = normalizeText(data.runId, 128);
      const timeoutMs = typeof data.timeoutMs === 'number' ? data.timeoutMs : undefined;
      const pollIntervalMs = typeof data.pollIntervalMs === 'number' ? data.pollIntervalMs : undefined;
      if (!runId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'run_id_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'run_id_required', detail: 'runId is required.' });
        return;
      }
      try {
        const result = await waitForSubagentRun({ runId, timeoutMs, pollIntervalMs });
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, runId, completed: result.completed } }).catch(() => {});
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subagent_wait_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'subagent_wait_failed', detail: message });
      }
      return;
    }

    if (req.url === '/subagents/send') {
      const runId = normalizeText(data.runId, 128);
      const prompt = normalizeText(data.prompt, 8000);
      const modelProvider = normalizeText(data.modelProvider, 64).toLowerCase();
      const modelId = normalizeText(data.modelId, 256);
      const modelBaseUrl = normalizeText(data.modelBaseUrl, 1024) || undefined;
      if (!runId || !prompt) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'run_id_and_prompt_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'run_id_and_prompt_required', detail: 'runId and prompt are required.' });
        return;
      }
      try {
        const result = await sendSubagentPrompt({
          runId,
          prompt,
          model: modelProvider && modelId
            ? { provider: modelProvider, model: modelId, ...(modelBaseUrl ? { baseUrl: modelBaseUrl } : {}) }
            : null,
        });
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, runId } }).catch(() => {});
        sendJson(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subagent_send_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'subagent_send_failed', detail: message });
      }
      return;
    }

    if (req.url === '/subagents/archive') {
      const runId = normalizeText(data.runId, 128);
      const archived = data.archived !== false;
      if (!runId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'run_id_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'run_id_required', detail: 'runId is required.' });
        return;
      }
      try {
        const result = archiveSubagentRun(runId, archived);
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, runId, archived } }).catch(() => {});
        sendJson(res, 200, { ok: true, run: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subagent_archive_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'subagent_archive_failed', detail: message });
      }
      return;
    }

    if (req.url === '/subagents/close') {
      const runId = normalizeText(data.runId, 128);
      if (!runId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'run_id_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'run_id_required', detail: 'runId is required.' });
        return;
      }
      try {
        const result = await closeSubagentSession(runId);
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, runId } }).catch(() => {});
        sendJson(res, 200, { ok: true, run: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subagent_close_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'subagent_close_failed', detail: message });
      }
      return;
    }

    if (req.url === '/subagents/stop') {
      const runId = normalizeText(data.runId, 128);
      if (!runId) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'run_id_required' } }).catch(() => {});
        sendJson(res, 400, { error: 'run_id_required', detail: 'runId is required.' });
        return;
      }
      const run = getSubagentRun(runId);
      if (!run) {
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'subagent_not_found' } }).catch(() => {});
        sendJson(res, 404, { error: 'subagent_not_found' });
        return;
      }
      try {
        await stopAgentEngineTask(run.childTaskId, { interruptFirst: true }).catch(() => {});
        updateTaskStatus(run.childTaskId, 'interrupted', new Date().toISOString());
        patchSubagentRun(runId, {
          status: 'done',
          resultStatus: 'interrupted',
          completedAt: new Date().toISOString(),
        });
        await emitAfterNodeToolHook({ toolName, data, output: { ok: true, runId } }).catch(() => {});
        sendJson(res, 200, { ok: true, runId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subagent_stop_failed';
        await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
        sendJson(res, 500, { error: 'subagent_stop_failed', detail: message });
      }
      return;
    }

    const connector = normalizeText(data.connector, 64).toLowerCase();
    const connectorInstanceId = normalizeText(data.connectorInstanceId, 64) || undefined;
    const text = normalizeText(data.text, 6000);
    const targetId = normalizeText(data.targetId, 256) || undefined;
    const targetKindRaw = normalizeText(data.targetKind, 32).toLowerCase();
    const targetKind = targetKindRaw
      ? (targetKindRaw as 'dm' | 'group' | 'channel' | 'space' | 'chat' | 'room')
      : undefined;
    const accountId = normalizeText(data.accountId, 128) || undefined;
    if (!isGatewayConnectorExtensionId(connector)) {
      await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'invalid_connector' } }).catch(() => {});
      sendJson(res, 400, {
        error: 'invalid_connector',
        detail: `Unknown connector "${connector || ''}".`,
      });
      return;
    }
    if (!text) {
      await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: 'text_required' } }).catch(() => {});
      sendJson(res, 400, { error: 'text_required', detail: 'text is required' });
      return;
    }

    try {
      const result = await sendConnectorOutboundMessage({
        connectorId: connector as GatewayConnectorExtensionId,
        connectorInstanceId,
        targetId,
        targetKind,
        accountId,
        text,
      });
      await emitAfterNodeToolHook({ toolName, data, output: { ok: true, connector: result.connectorId, targetId: result.targetId } }).catch(() => {});
      sendJson(res, 200, {
        ok: true,
        connector: result.connectorId,
        connectorInstanceId: result.connectorInstanceId,
        targetId: result.targetId,
        targetKind: result.targetKind,
        accountId: result.accountId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'connector_send_failed';
      const lowered = String(message).toLowerCase();
      const status = lowered.includes('active in desktop/webchat')
        ? 409
        : (lowered.includes('heartbeat check-in') || lowered.includes('routine heartbeat')
          ? 400
          : (lowered.includes('disabled') || lowered.includes('required') || lowered.includes('allowlist') || lowered.includes('not allowed')
          ? 400
          : 500));
      await emitAfterNodeToolHook({ toolName, data, output: { ok: false, error: message } }).catch(() => {});
      sendJson(res, status, { error: 'connector_send_failed', detail: message });
    }
  });

  server.listen(NODE_TOOLS_API_PORT, '127.0.0.1', () => {
    console.log(`[Node Tools API] Server listening on port ${NODE_TOOLS_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Node Tools API] Port ${NODE_TOOLS_API_PORT} already in use, skipping server start`);
    } else {
      console.error('[Node Tools API] Server error:', error);
    }
  });

  return server;
}
