#!/usr/bin/env node
/**
 * Node Tools MCP Server
 *
 * Exposes node tools (camera snapshot) for AI-initiated access.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const NODE_TOOLS_API_PORT = process.env.NODE_TOOLS_API_PORT || '9229';
const NODE_TOOLS_API_HOST = process.env.NODE_TOOLS_API_HOST || '127.0.0.1';
const NODE_TOOLS_API_URL = `http://${NODE_TOOLS_API_HOST}:${NODE_TOOLS_API_PORT}`;
const NODE_TOOLS_API_FALLBACK_URLS = Array.from(
  new Set(
    [
      NODE_TOOLS_API_URL,
      `http://127.0.0.1:${NODE_TOOLS_API_PORT}`,
      `http://localhost:${NODE_TOOLS_API_PORT}`,
    ].filter(Boolean)
  )
);
const CANVAS_API_PORT = process.env.CANVAS_API_PORT || '9227';
const CANVAS_API_URL = `http://127.0.0.1:${CANVAS_API_PORT}/canvas`;

interface CameraSnapshotInput {
  nodeId?: string;
  nodeName?: string;
}

interface ConnectorSendInput {
  connector?: string;
  connectorInstanceId?: string;
  targetId?: string;
  targetKind?: string;
  accountId?: string;
  text?: string;
}

interface AppConnectorExecuteInput {
  connector?: string;
  connectorInstanceId?: string;
  action?: string;
  args?: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause === 'string' && cause.trim()) {
      return `${error.message} (${cause})`;
    }
    if (cause && typeof cause === 'object') {
      try {
        return `${error.message} (${JSON.stringify(cause)})`;
      } catch {
        return `${error.message} (${String(cause)})`;
      }
    }
    return error.message;
  }
  return String(error);
}

function isRetriableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.message} ${formatNetworkError(error)}`.toLowerCase();
  return (
    message.includes('fetch failed')
    || message.includes('econnrefused')
    || message.includes('connection refused')
    || message.includes('network request failed')
    || message.includes('socket hang up')
  );
}

async function fetchNodeToolsApi(pathname: string, init: RequestInit): Promise<Response> {
  const attempts = 6;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const baseUrl of NODE_TOOLS_API_FALLBACK_URLS) {
      const url = `${baseUrl}${pathname}`;
      try {
        return await fetch(url, init);
      } catch (error) {
        lastError = error;
        if (!isRetriableConnectionError(error)) {
          throw new Error(`Node Tools API request failed at ${url}: ${formatNetworkError(error)}`);
        }
      }
    }
    if (attempt < attempts - 1) {
      await sleep(200);
    }
  }

  throw new Error(
    `Node Tools API unreachable at ${NODE_TOOLS_API_FALLBACK_URLS.join(', ')}: ${formatNetworkError(lastError)}`
  );
}

function buildSnapshotHtml(dataUrl: string, title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        background: #0b0b0f;
        color: #f5f5f7;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      .frame {
        max-width: min(1100px, 92vw);
        max-height: min(92vh, 920px);
        display: grid;
        gap: 12px;
        text-align: center;
      }
      img {
        width: 100%;
        height: auto;
        max-height: 82vh;
        object-fit: contain;
        border-radius: 16px;
        box-shadow: 0 18px 60px rgba(0,0,0,0.45);
        background: #11131a;
      }
      .meta {
        font-size: 12px;
        opacity: 0.75;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="meta">${title}</div>
      <img src='${dataUrl}' alt="${title}" />
    </div>
  </body>
</html>`;
}

async function showSnapshotOnCanvas(dataUrl: string, nodeLabel: string): Promise<string | null> {
  const title = `Snapshot from ${nodeLabel}`;
  const html = buildSnapshotHtml(dataUrl, title);
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  try {
    const response = await fetch(CANVAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'present', url }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return `Canvas API returned ${response.status}: ${errorText}`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function saveSnapshotToTemp(dataUrl: string, nodeLabel: string): Promise<string | null> {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) return null;
  const format = match[1]?.toLowerCase();
  const base64 = match[2];
  const ext = format === 'jpeg' || format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
  const fileName = `opendeskmate-node-${nodeLabel.replace(/[^a-z0-9_-]+/gi, '_')}-${Date.now()}.${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);
  const buffer = Buffer.from(base64, 'base64');
  await fs.writeFile(filePath, buffer);
  return filePath;
}

const server = new Server(
  { name: 'node-tools', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'nodes_camera_snapshot',
      description:
        'Request a camera snapshot from a paired node that has AI access enabled. You can pass nodeId or nodeName (display name). If omitted, uses the most recently active AI-enabled node. Shows the snapshot in the canvas on success.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: {
            type: 'string',
            description: 'Optional node ID to target.',
          },
          nodeName: {
            type: 'string',
            description: 'Optional node display name to target.',
          },
        },
      },
    },
    {
      name: 'connector_send_message',
      description:
        'Send a proactive message through a configured connector (Discord, Telegram, Slack, Matrix, Teams, Mattermost, Google Chat, and bridge connectors). If targetId is omitted, the runtime uses the latest observed allowed ID for that connector. If the user is active in desktop/webchat this is blocked, and routine heartbeat check-in/status messages are also blocked.',
      inputSchema: {
        type: 'object',
        properties: {
          connector: {
            type: 'string',
            description: 'Connector id from settings (e.g. telegram, discord, slack, matrix, msteams, mattermost, googlechat, signal, whatsapp).',
          },
          connectorInstanceId: {
            type: 'string',
            description: 'Optional connector instance id when multiple instances are configured for the same connector.',
          },
          targetId: {
            type: 'string',
            description: 'Optional target chat/user/channel id.',
          },
          targetKind: {
            type: 'string',
            description: 'Optional target kind: dm, group, channel, space, chat, or room.',
          },
          accountId: {
            type: 'string',
            description: 'Optional account scope for connectors that use account routing.',
          },
          text: {
            type: 'string',
            description: 'Message text to send.',
          },
        },
        required: ['connector', 'text'],
      },
    },
    {
      name: 'app_connector_list',
      description:
        'List configured App Connector Extensions and their runtime status, so you can choose the correct connector/instance before calling app_connector_execute.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'app_connector_execute',
      description:
        'Execute an action against an App Connector Extension (Notion, GitHub, Google Workspace apps, Slack, Trello, etc.). Use action=request for generic REST calls; some connectors expose convenience actions (send_message for Slack, create_issue for GitHub, search for Notion, read_note/write_note for Obsidian).',
      inputSchema: {
        type: 'object',
        properties: {
          connector: {
            type: 'string',
            description: 'App connector id from settings (e.g. notion, github, google-docs, slack).',
          },
          connectorInstanceId: {
            type: 'string',
            description: 'Optional connector instance id when multiple instances are configured.',
          },
          action: {
            type: 'string',
            description: 'Action name. Use request for generic HTTP action.',
          },
          args: {
            type: 'object',
            description: 'Action arguments. For request, include method/path/query/body/headers.',
          },
        },
        required: ['connector', 'action'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  if (
    request.params.name !== 'nodes_camera_snapshot'
    && request.params.name !== 'connector_send_message'
    && request.params.name !== 'app_connector_list'
    && request.params.name !== 'app_connector_execute'
  ) {
    return {
      content: [{ type: 'text', text: `Error: Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  if (request.params.name === 'app_connector_list') {
    try {
      const response = await fetchNodeToolsApi('/app-connectors/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const result = await response.json().catch(() => ({} as { error?: string; detail?: string; connectors?: unknown }));
      if (!response.ok) {
        return {
          content: [{
            type: 'text',
            text: `Error: App connector list failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.connectors ?? []),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to list app connectors: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'app_connector_execute') {
    const args = (request.params.arguments || {}) as AppConnectorExecuteInput;
    const connector = (args.connector || '').trim().toLowerCase();
    const action = (args.action || '').trim().toLowerCase();
    if (!connector) {
      return {
        content: [{ type: 'text', text: 'Error: connector is required.' }],
        isError: true,
      };
    }
    if (!action) {
      return {
        content: [{ type: 'text', text: 'Error: action is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/app-connectors/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector,
          connectorInstanceId: args.connectorInstanceId,
          action,
          args: args.args || {},
        }),
      });
      const result = await response.json().catch(() => ({} as {
        ok?: boolean;
        error?: string;
        detail?: string;
        connector?: string;
        connectorInstanceId?: string;
        data?: unknown;
      }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: App connector execute failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            connector: result.connector ?? connector,
            connectorInstanceId: result.connectorInstanceId ?? args.connectorInstanceId ?? 'default',
            action,
            detail: result.detail ?? 'Completed.',
            data: result.data ?? null,
          }),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to execute app connector action: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'connector_send_message') {
    const args = (request.params.arguments || {}) as ConnectorSendInput;
    const connector = (args.connector || '').trim().toLowerCase();
    const text = (args.text || '').trim();
    if (!connector) {
      return {
        content: [{ type: 'text', text: 'Error: connector is required.' }],
        isError: true,
      };
    }
    if (!text) {
      return {
        content: [{ type: 'text', text: 'Error: text is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/connectors/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector,
          connectorInstanceId: args.connectorInstanceId,
          targetId: args.targetId,
          targetKind: args.targetKind,
          accountId: args.accountId,
          text,
        }),
      });
      const result = await response.json().catch(() => ({} as { error?: string; detail?: string; targetId?: string }));
      if (!response.ok) {
        return {
          content: [{
            type: 'text',
            text: `Error: Connector send failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: `Sent message via ${connector}${result.targetId ? ` to ${result.targetId}` : ''}.`,
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to send connector message: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  const args = (request.params.arguments || {}) as CameraSnapshotInput;
  try {
    const response = await fetchNodeToolsApi('/nodes/camera/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: args.nodeId, nodeName: args.nodeName }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [{ type: 'text', text: `Error: Node tools API returned ${response.status}: ${errorText}` }],
        isError: true,
      };
    }

    const result = (await response.json()) as { ok?: boolean; nodeId?: string; nodeName?: string | null; dataUrl?: string; error?: string };
    if (!result?.dataUrl) {
      return {
        content: [{ type: 'text', text: `Error: Snapshot failed${result?.error ? ` (${result.error})` : ''}` }],
        isError: true,
      };
    }

    const nodeLabel = result.nodeName || result.nodeId || 'unknown';
    const canvasError = await showSnapshotOnCanvas(result.dataUrl, nodeLabel);
    let savedPath: string | null = null;
    try {
      savedPath = await saveSnapshotToTemp(result.dataUrl, nodeLabel);
    } catch {
      savedPath = null;
    }
    return {
      content: [
        {
          type: 'text',
          text: canvasError
            ? `Snapshot captured from node ${nodeLabel}. (Canvas error: ${canvasError})`
            : `Snapshot captured from node ${nodeLabel} and shown on the canvas.` +
              (savedPath ? ` Saved to: ${savedPath}` : ''),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: Failed to request snapshot: ${errorMessage}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Node Tools MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
