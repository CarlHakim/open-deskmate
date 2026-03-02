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

export const NODE_TOOLS_API_PORT = 9229;

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
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
        && req.url !== '/app-connectors/list')
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

    if (req.url === '/nodes/camera/snapshot') {
      if (!getMobileNodesEnabled()) {
        sendJson(res, 403, { error: 'mobile_nodes_disabled' });
        return;
      }

      const requestedNodeId = typeof data.nodeId === 'string' ? data.nodeId.trim() : '';
      const requestedNodeName = typeof data.nodeName === 'string' ? data.nodeName.trim() : '';
      const requested = requestedNodeId || requestedNodeName;
      const resolved = requested ? resolveNodeId(requested) : null;
      if (requested && !resolved) {
        sendJson(res, 404, { error: 'node_not_found', detail: 'No matching node for provided name/id.' });
        return;
      }
      const nodeId = resolved?.nodeId || selectDefaultNodeId();
      if (!nodeId) {
        sendJson(res, 404, { error: 'no_ai_allowed_nodes' });
        return;
      }

      const paired = listNodePairing().paired || [];
      const node = paired.find((entry) => entry.nodeId === nodeId);
      if (!node) {
        sendJson(res, 404, { error: 'node_not_found' });
        return;
      }
      if (!node.aiAccessAllowed) {
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
          sendJson(res, 500, { error: result.error || 'snapshot_failed' });
          return;
        }

        const payload = result.payload as { mime?: string; dataBase64?: string } | undefined;
        if (!payload?.dataBase64) {
          sendJson(res, 500, { error: 'snapshot_missing_payload' });
          return;
        }

        const mime = payload.mime || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${payload.dataBase64}`;
        sendJson(res, 200, { ok: true, nodeId, nodeName: node.displayName || null, dataUrl });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'snapshot_failed';
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
        sendJson(res, 400, {
          error: 'invalid_connector',
          detail: `Unknown app connector "${connector || ''}".`,
        });
        return;
      }
      if (!action) {
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
        sendJson(res, 400, { error: 'app_connector_execute_failed', detail: message });
      }
      return;
    }

    if (req.url === '/app-connectors/list') {
      try {
        const statuses = await listAppConnectorRuntimeStatuses();
        sendJson(res, 200, { ok: true, connectors: statuses });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'app_connector_list_failed';
        sendJson(res, 500, { error: 'app_connector_list_failed', detail: message });
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
      sendJson(res, 400, {
        error: 'invalid_connector',
        detail: `Unknown connector "${connector || ''}".`,
      });
      return;
    }
    if (!text) {
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
