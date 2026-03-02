#!/usr/bin/env node
/**
 * File Permission MCP Server
 *
 * Exposes a `request_file_permission` tool that the agent calls before
 * performing file operations. The tool communicates with the Electron
 * main process via HTTP to show a permission modal and wait for user response.
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

const PERMISSION_API_PORT = process.env.PERMISSION_API_PORT || '9226';
// Bind explicitly to IPv4. The Electron permission API server listens on 127.0.0.1,
// and on some systems `localhost` may resolve to IPv6 first, causing connection failures.
const PERMISSION_API_URL = `http://127.0.0.1:${PERMISSION_API_PORT}/permission`;
const NODE_TOOLS_API_PORT = process.env.NODE_TOOLS_API_PORT || '9229';
const NODE_TOOLS_API_URL = `http://127.0.0.1:${NODE_TOOLS_API_PORT}/nodes/camera/snapshot`;
const CONNECTOR_SEND_API_URL = `http://127.0.0.1:${NODE_TOOLS_API_PORT}/connectors/send-message`;
const CANVAS_API_PORT = process.env.CANVAS_API_PORT || '9227';
const CANVAS_API_URL = `http://127.0.0.1:${CANVAS_API_PORT}/canvas`;
const ACCOMPLISH_TASK_ID = process.env.ACCOMPLISH_TASK_ID?.trim() || '';
// The Electron permission API can hold the HTTP request open while waiting for
// a user decision. Keep this comfortably above the server-side timeout.
const PERMISSION_REQUEST_TIMEOUT_MS = Number(process.env.PERMISSION_REQUEST_TIMEOUT_MS || 16 * 60 * 1000);

interface FilePermissionInput {
  operation: 'create' | 'delete' | 'rename' | 'move' | 'modify' | 'overwrite';
  filePath: string;
  targetPath?: string;
  contentPreview?: string;
}

interface NodeCameraSnapshotInput {
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return `${error.message} (${cause.message})`;
    }
    return error.message;
  }
  return String(error);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: { retries?: number; initialDelayMs?: number; timeoutMs?: number }
): Promise<Response> {
  const retries = options?.retries ?? 8;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  let delayMs = options?.initialDelayMs ?? 120;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      // Retry briefly while the local API server is still warming up.
      if ((response.status === 404 || response.status === 503) && attempt < retries) {
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 1200);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= retries) break;
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 1200);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed');
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
  { name: 'file-permission', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'request_file_permission',
      description:
        'Request user permission before performing file operations (create, delete, rename, move, modify, overwrite). Always call this tool BEFORE executing any file modification. Returns "allowed" or "denied".',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'delete', 'rename', 'move', 'modify', 'overwrite'],
            description: 'The type of file operation to perform',
          },
          filePath: {
            type: 'string',
            description: 'Absolute path to the file being operated on',
          },
          targetPath: {
            type: 'string',
            description: 'Target path for rename/move operations',
          },
          contentPreview: {
            type: 'string',
            description: 'Preview of file content for create/modify operations (first ~500 chars)',
          },
        },
        required: ['operation', 'filePath'],
      },
    },
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
        'Send a proactive message through a configured connector (Discord, Telegram, Slack, Matrix, Teams, Mattermost, Google Chat, and bridge connectors). If targetId is omitted, uses the latest observed allowed target for that connector. If the user is active in desktop/webchat this is blocked, and routine heartbeat check-in/status messages are also blocked.',
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
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  if (request.params.name === 'request_file_permission') {
    const args = request.params.arguments as FilePermissionInput;
    const { operation, filePath, targetPath, contentPreview } = args;

    // Validate required fields
    if (!operation || !filePath) {
      return {
        content: [{ type: 'text', text: 'Error: operation and filePath are required' }],
        isError: true,
      };
    }

    try {
      // Call Electron main process HTTP endpoint
      const response = await fetchWithRetry(
        PERMISSION_API_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation,
            filePath,
            targetPath,
            contentPreview: contentPreview?.substring(0, 500), // Truncate preview
            ...(ACCOMPLISH_TASK_ID ? { taskId: ACCOMPLISH_TASK_ID } : {}),
          }),
        },
        {
          // Permission requests are interactive and can stay open for minutes.
          timeoutMs: PERMISSION_REQUEST_TIMEOUT_MS,
          // Only retry boot/warmup errors; do not spam duplicate permission prompts.
          retries: 2,
          initialDelayMs: 80,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: 'text', text: `Error: Permission API returned ${response.status}: ${errorText}` }],
          isError: true,
        };
      }

      const result = (await response.json()) as { allowed: boolean };
      return {
        content: [{ type: 'text', text: result.allowed ? 'allowed' : 'denied' }],
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to request permission: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'nodes_camera_snapshot') {
    const args = (request.params.arguments || {}) as NodeCameraSnapshotInput;
    try {
    const response = await fetchWithRetry(NODE_TOOLS_API_URL, {
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

      const result = (await response.json()) as {
        ok?: boolean;
        nodeId?: string;
        nodeName?: string | null;
        dataUrl?: string;
        error?: string;
      };
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
      const errorMessage = extractErrorMessage(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to request snapshot: ${errorMessage}` }],
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
      const response = await fetchWithRetry(CONNECTOR_SEND_API_URL, {
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
      const errorMessage = extractErrorMessage(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to send connector message: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Error: Unknown tool: ${request.params.name}` }],
    isError: true,
  };
});

// Start the MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('File Permission MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
