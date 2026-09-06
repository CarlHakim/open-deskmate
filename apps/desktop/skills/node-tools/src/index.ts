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
const SUBAGENT_WAIT_DEFAULT_TIMEOUT_MS = 10 * 60_000;
const SUBAGENT_WAIT_MAX_TIMEOUT_MS = 20 * 60_000;
const SUBAGENT_REPEAT_COMPLETED_REPORT_MAX_CHARS = 12_000;
const pendingSubagentWaitCounts = new Map<string, number>();
const completedSubagentWaitCounts = new Map<string, number>();

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

interface SubagentSpawnInput {
  targetAgentId?: string;
  task?: string;
  label?: string;
  runTimeoutMs?: number;
  mode?: 'run' | 'session';
  reuseExistingSession?: boolean;
  modelProvider?: string;
  modelId?: string;
  modelBaseUrl?: string;
  expectedOutputs?: unknown[];
}

interface SubagentListInput {
  parentTaskId?: string;
}

interface SubagentGetInput {
  runId?: string;
}

interface SubagentStopInput {
  runId?: string;
}

interface SubagentArchiveInput {
  runId?: string;
  archived?: boolean;
}

interface SubagentCloseInput {
  runId?: string;
}

interface SubagentSendInput {
  runId?: string;
  prompt?: string;
  modelProvider?: string;
  modelId?: string;
  modelBaseUrl?: string;
}

interface SubagentWaitInput {
  runId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface SubagentWaitManyInput {
  runIds?: string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  mode?: 'all' | 'any';
}

interface SubagentProgressInput {
  runId?: string;
  title?: string;
  detail?: string;
  type?: 'started' | 'status' | 'milestone' | 'output' | 'tool' | 'blocked' | 'recovery' | 'completed';
  percentage?: number;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
}

interface SubagentDiagnoseInput {
  runId?: string;
  staleAfterMs?: number;
}

interface SubagentRecoverInput {
  runId?: string;
  action?: 'resume' | 'retry' | 'replace' | 'cancel' | 'request_clarification' | 'manual_intervention';
  prompt?: string;
  reason?: string;
  targetAgentId?: string;
  task?: string;
  label?: string;
  runTimeoutMs?: number;
  modelProvider?: string;
  modelId?: string;
  modelBaseUrl?: string;
}

interface SubagentReplaceInput {
  runId?: string;
  task?: string;
  targetAgentId?: string;
  reason?: string;
  label?: string;
  runTimeoutMs?: number;
  modelProvider?: string;
  modelId?: string;
  modelBaseUrl?: string;
}

interface PluginToolDescriptor {
  id?: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  action?: unknown;
}

type WorkboardToolAction =
  | 'list'
  | 'show'
  | 'create'
  | 'update'
  | 'comment'
  | 'complete'
  | 'block'
  | 'unblock'
  | 'link'
  | 'heartbeat';

type WorkboardToolInput = Record<string, unknown>;

const BUILTIN_TOOL_NAMES = new Set([
  'nodes_camera_snapshot',
  'connector_send_message',
  'app_connector_list',
  'app_connector_execute',
  'subagent_spawn',
  'subagent_targets',
  'subagent_list',
  'subagent_get',
  'subagent_stop',
  'subagent_archive',
  'subagent_close',
  'subagent_send',
  'subagent_wait',
  'subagent_wait_many',
  'subagent_progress',
  'subagent_diagnose',
  'subagent_recover',
  'subagent_replace',
  'workboard_list',
  'workboard_show',
  'workboard_create',
  'workboard_update',
  'workboard_comment',
  'workboard_complete',
  'workboard_block',
  'workboard_unblock',
  'workboard_link',
  'workboard_heartbeat',
]);

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

function readStringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function truncateText(value: string, maxChars: number): string {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
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

async function fetchPluginTools(): Promise<PluginToolDescriptor[]> {
  const response = await fetchNodeToolsApi('/plugins/tools/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const result = await response.json().catch(() => ({} as {
    ok?: boolean;
    error?: string;
    detail?: string;
    tools?: unknown;
  }));
  if (!response.ok || result.ok === false) {
    throw new Error(
      `Plugin tool list failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`
    );
  }
  return Array.isArray(result.tools)
    ? result.tools.filter((tool: unknown): tool is PluginToolDescriptor => (
      !!tool
      && typeof tool === 'object'
      && typeof (tool as { name?: unknown }).name === 'string'
    ))
    : [];
}

async function executePluginTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    const response = await fetchNodeToolsApi('/plugins/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        arguments: args,
        parentTaskId: process.env.ACCOMPLISH_TASK_ID || undefined,
        parentAgentId: process.env.ACCOMPLISH_AGENT_ID || undefined,
      }),
    });
    const result = await response.json().catch(() => ({} as {
      ok?: boolean;
      error?: string;
      detail?: string;
      result?: unknown;
    }));
    if (!response.ok || result.ok === false) {
      const detail = result.detail || result.error || response.status;
      const unknownPluginTool = response.status === 404
        || `${detail}`.toLowerCase().includes('unknown plugin tool');
      return {
        content: [{ type: 'text', text: `Error: ${unknownPluginTool ? `Unknown tool: ${name}` : `Plugin tool execution failed (${detail}).`}` }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result.result ?? null),
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: Failed to execute plugin tool ${name}: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function executeWorkboardTool(
  action: WorkboardToolAction,
  args: WorkboardToolInput
): Promise<CallToolResult> {
  try {
    const response = await fetchNodeToolsApi(`/workboard/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        parentTaskId: process.env.ACCOMPLISH_TASK_ID || undefined,
        parentAgentId: process.env.ACCOMPLISH_AGENT_ID || undefined,
      }),
    });
    const result = await response.json().catch(() => ({} as {
      ok?: boolean;
      error?: string;
      detail?: string;
      result?: unknown;
    }));
    if (!response.ok || result.ok === false) {
      return {
        content: [{
          type: 'text',
          text: `Error: Workboard ${action} failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result.result ?? result),
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: Failed to run Workboard ${action}: ${errorMessage}` }],
      isError: true,
    };
  }
}

function workboardItemSelectorSchema(required: string[] = ['itemId']) {
  return {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'Workboard item id.',
      },
      workItemId: {
        type: 'string',
        description: 'Alias for itemId.',
      },
    },
    required,
  };
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const pluginTools = await fetchPluginTools().catch(() => []);
  return {
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
    {
      name: 'subagent_targets',
      description:
        'List valid helper subagent target agents for the current parent agent. Use this before subagent_spawn if you need a specific helper. If no specific helper is needed, subagent_spawn can omit targetAgentId and will use the current/first allowed agent automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          parentTaskId: {
            type: 'string',
            description: 'Optional parent task id override. Defaults to the current task.',
          },
        },
      },
    },
    {
      name: 'subagent_spawn',
      description:
        'Spawn a helper subagent for bounded parallel work. Requires subagents to be enabled for the current parent agent. Returns immediately with child run/session identifiers. Do not guess agent ids: call subagent_targets when you need a specific target. If no targetAgentId is provided, the app uses the current agent or first allowed subagent automatically. Prefer letting child runs continue in the background and rely on completion relay or subagent_get/subagent_list instead of blocking on long waits.',
      inputSchema: {
        type: 'object',
        properties: {
          targetAgentId: {
            type: 'string',
            description: 'Optional target agent id or exact agent name. Omit this for the default helper target, or call subagent_targets for valid choices.',
          },
          task: {
            type: 'string',
            description: 'Focused helper task for the child agent.',
          },
          label: {
            type: 'string',
            description: 'Optional short label shown in the parent UI.',
          },
          isolation: { type: 'string', enum: ['shared', 'worktree'], description: 'Optional isolated Git worktree for independent coding work. Requires a clean repository root; preserves a branch and worktree for parent review and integration. Shared is the default.' },
          ownedPaths: { type: 'array', items: { type: 'string' }, description: 'Relative files or directories assigned to this child. Choose disjoint paths for concurrent Build workers; no wildcards. These are coordination assignments, not a filesystem sandbox.' },
          maxCostUsd: { type: 'number', description: 'Optional recorded USD spending threshold for this child.' },
          limitAction: { type: 'string', enum: ['notify', 'stop'], description: 'Action at runtime or spending limit; defaults to notify.' },
          runTimeoutMs: {
            type: 'number',
            description: 'Optional timeout override in milliseconds.',
          },
          mode: {
            type: 'string',
            description: 'Optional spawn mode. Use run for one-shot child runs or session to reuse a persistent child session.',
          },
          reuseExistingSession: {
            type: 'boolean',
            description: 'Optional session-mode control. When false, force a fresh child session even in session mode.',
          },
          modelProvider: {
            type: 'string',
            description: 'Optional provider override for the child run.',
          },
          modelId: {
            type: 'string',
            description: 'Optional model id override for the child run.',
          },
          modelBaseUrl: {
            type: 'string',
            description: 'Optional base URL for local/custom model overrides.',
          },
          expectedOutputs: {
            type: 'array',
            description: 'Optional expected outputs the parent will use to judge completion, such as files, artifacts, JSON, diffs, or command results.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                kind: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
                required: { type: 'boolean' },
                path: { type: 'string' },
              },
              required: ['id', 'kind', 'label'],
            },
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'subagent_list',
      description:
        'List tracked subagents for the current parent task, including status and child run ids.',
      inputSchema: {
        type: 'object',
        properties: {
          parentTaskId: {
            type: 'string',
            description: 'Optional parent task id override. Defaults to the current task.',
          },
        },
      },
    },
    {
      name: 'subagent_get',
      description:
        'Get the current state of a tracked subagent run, including child task linkage and latest status.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id.',
          },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_stop',
      description:
        'Stop a running subagent by run id.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Subagent run id to stop.',
          },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_archive',
      description:
        'Archive or unarchive a tracked subagent run so it drops out of active listings without deleting its record.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id.',
          },
          archived: {
            type: 'boolean',
            description: 'Optional archived flag. Defaults to true.',
          },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_close',
      description:
        'Close a tracked subagent session. This clears its reusable session binding and interrupts it first if it is still active.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id.',
          },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_send',
      description:
        'Send a follow-up instruction to a tracked child subagent session. Use this to steer or refine an existing child run.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id.',
          },
          prompt: {
            type: 'string',
            description: 'Follow-up prompt to send to the child session.',
          },
          modelProvider: {
            type: 'string',
            description: 'Optional provider override for subsequent child turns.',
          },
          modelId: {
            type: 'string',
            description: 'Optional model id override for subsequent child turns.',
          },
          modelBaseUrl: {
            type: 'string',
            description: 'Optional base URL for local/custom model overrides.',
          },
        },
        required: ['runId', 'prompt'],
      },
    },
    {
      name: 'subagent_wait',
      description:
        'Wait for a tracked subagent run to finish. This is a bounded join with a long default wait so the parent agent can use child results before synthesizing. If it returns completed=true, do not call it again for the same run; use the returned child result and answer. For unusually long child work, rely on completion relay or call subagent_get/subagent_list later.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds. Defaults to 600000 and is capped at 1200000. Values below 60000 are raised to 60000 so the parent does not give up too quickly.',
          },
          pollIntervalMs: {
            type: 'number',
            description: 'Optional poll interval in milliseconds. Defaults to 500.',
          },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_progress',
      description:
        'Report or read progress-aware supervision state for a tracked subagent. Child agents should call this with milestone/status/output/blocked events. Parent agents should call it with runId to inspect progress, heartbeat/stall state, expected outputs, result bundle, and recovery history.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id. Child agents may omit this; the runtime resolves it from the current task id.',
          },
          title: {
            type: 'string',
            description: 'Optional concise progress title when reporting progress.',
          },
          detail: {
            type: 'string',
            description: 'Optional useful detail, partial finding, source summary, or blocked reason.',
          },
          type: {
            type: 'string',
            description: 'Progress event type: started, status, milestone, output, tool, blocked, recovery, or completed.',
          },
          percentage: {
            type: 'number',
            description: 'Optional percentage complete, from 0 to 100.',
          },
          currentStep: {
            type: 'string',
            description: 'Optional current step name.',
          },
          totalSteps: {
            type: 'number',
            description: 'Optional total expected steps.',
          },
          completedSteps: {
            type: 'number',
            description: 'Optional completed step count.',
          },
        },
        required: [],
      },
    },
    {
      name: 'subagent_diagnose',
      description:
        'Diagnose whether a tracked subagent appears stalled, blocked, missing expected outputs, or eligible for recovery, and return recommended supervision actions.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'Tracked subagent run id.',
          },
          staleAfterMs: {
            type: 'number',
            description: 'Optional inactivity threshold for stall detection. Defaults to 120000.',
          },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_recover',
      description:
        'Recover a tracked subagent by resuming, retrying, replacing, cancelling, requesting clarification, or recording manual intervention. Resume/retry/request_clarification require a prompt; replace can use task or prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Tracked subagent run id.' },
          action: {
            type: 'string',
            description: 'Recovery action: resume, retry, replace, cancel, request_clarification, or manual_intervention.',
          },
          prompt: { type: 'string', description: 'Prompt used for resume, retry, or request_clarification.' },
          reason: { type: 'string', description: 'Reason recorded in recovery history.' },
          targetAgentId: { type: 'string', description: 'Optional replacement target agent id or name when action=replace.' },
          task: { type: 'string', description: 'Optional replacement task or retry prompt.' },
          label: { type: 'string', description: 'Optional replacement label.' },
          runTimeoutMs: { type: 'number', description: 'Optional replacement timeout.' },
          modelProvider: { type: 'string', description: 'Optional provider override.' },
          modelId: { type: 'string', description: 'Optional model id override.' },
          modelBaseUrl: { type: 'string', description: 'Optional base URL for local/custom model overrides.' },
        },
        required: ['runId', 'action'],
      },
    },
    {
      name: 'subagent_replace',
      description:
        'Stop a tracked subagent if still active and spawn a replacement child run linked to the original run. Use this when diagnosis shows a stalled or unrecoverable child session.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Tracked subagent run id to replace.' },
          task: { type: 'string', description: 'Replacement task. Defaults to the original last prompt/task.' },
          targetAgentId: { type: 'string', description: 'Optional replacement target agent id or name. Defaults to original child agent.' },
          reason: { type: 'string', description: 'Reason recorded in replacement/recovery history.' },
          label: { type: 'string', description: 'Optional replacement label.' },
          runTimeoutMs: { type: 'number', description: 'Optional replacement timeout.' },
          modelProvider: { type: 'string', description: 'Optional provider override.' },
          modelId: { type: 'string', description: 'Optional model id override.' },
          modelBaseUrl: { type: 'string', description: 'Optional base URL for local/custom model overrides.' },
        },
        required: ['runId'],
      },
    },
    {
      name: 'subagent_wait_many',
      description:
        'Wait for multiple tracked subagent runs in one bounded join. Returns early when a run completes or needs recovery/replacement/partial synthesis, so do not loop blindly after recommendedAction is not wait.',
      inputSchema: {
        type: 'object',
        properties: {
          runIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tracked subagent run ids.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds. Defaults to 600000 and is capped at 1200000.',
          },
          pollIntervalMs: {
            type: 'number',
            description: 'Optional poll interval in milliseconds. Defaults to 500.',
          },
          mode: {
            type: 'string',
            description: 'all waits for every run to finish; any returns after one run finishes.',
          },
        },
        required: ['runIds'],
      },
    },
    {
      name: 'workboard_list',
      description:
        'List OpenDeskmate Workboard projects, columns, and work items. Use this before updating work items when you need ids or status columns.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Optional usage project id to scope the list.' },
          includeArchived: { type: 'boolean', description: 'Include archived projects/items when true.' },
        },
      },
    },
    {
      name: 'workboard_show',
      description:
        'Show one Workboard item with its notes, documents, sources, drawings, checklist lists, and project columns.',
      inputSchema: workboardItemSelectorSchema(),
    },
    {
      name: 'workboard_create',
      description:
        'Create a Workboard item inside an existing usage project. Use for follow-up tasks, project work, or durable task tracking.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Usage project id.' },
          title: { type: 'string', description: 'Short work item title.' },
          description: { type: 'string', description: 'Optional work item description or acceptance notes.' },
          statusId: { type: 'string', description: 'Optional target status column id.' },
          statusName: { type: 'string', description: 'Optional target status column name.' },
          priority: { type: 'string', description: 'Optional priority: low, normal, high, urgent.' },
          assigneeIds: { type: 'array', items: { type: 'string' }, description: 'Optional assignee ids.' },
          dueDate: { type: 'string', description: 'Optional due date.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        },
        required: ['projectId', 'title'],
      },
    },
    {
      name: 'workboard_update',
      description:
        'Update a Workboard item title, description, status, priority, assignees, due date, blocked flag, archive flag, or tags.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Workboard item id.' },
          title: { type: 'string' },
          description: { type: 'string' },
          statusId: { type: 'string' },
          statusName: { type: 'string' },
          priority: { type: 'string' },
          assigneeIds: { type: 'array', items: { type: 'string' } },
          dueDate: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          blocked: { type: 'boolean' },
          blockedReason: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['itemId'],
      },
    },
    {
      name: 'workboard_comment',
      description:
        'Add a dated agent comment/note to a Workboard item.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Workboard item id.' },
          title: { type: 'string', description: 'Optional note title.' },
          text: { type: 'string', description: 'Comment text.' },
        },
        required: ['itemId', 'text'],
      },
    },
    {
      name: 'workboard_complete',
      description:
        'Mark a Workboard item complete by moving it to the done column when available and clearing blocked state.',
      inputSchema: workboardItemSelectorSchema(),
    },
    {
      name: 'workboard_block',
      description:
        'Mark a Workboard item blocked, record the reason, and move it to a waiting/blocked column when available.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Workboard item id.' },
          reason: { type: 'string', description: 'Reason the item is blocked.' },
        },
        required: ['itemId', 'reason'],
      },
    },
    {
      name: 'workboard_unblock',
      description:
        'Clear blocked state on a Workboard item and optionally add an unblocked note.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Workboard item id.' },
          text: { type: 'string', description: 'Optional note explaining what changed.' },
        },
        required: ['itemId'],
      },
    },
    {
      name: 'workboard_link',
      description:
        'Attach a source URL, document URL, or local document path to a Workboard item.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Workboard item id.' },
          url: { type: 'string', description: 'URL or local path to link.' },
          link: { type: 'string', description: 'Alias for url.' },
          path: { type: 'string', description: 'Alias for url for local files.' },
          kind: { type: 'string', description: 'Use document to force a URL to be saved as a document link.' },
          title: { type: 'string', description: 'Link title or document label.' },
          description: { type: 'string', description: 'Optional source description.' },
        },
        required: ['itemId'],
      },
    },
    {
      name: 'workboard_heartbeat',
      description:
        'Add a brief heartbeat/progress note to a Workboard item while working in the background.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Workboard item id.' },
          text: { type: 'string', description: 'Progress update.' },
        },
        required: ['itemId', 'text'],
      },
    },
    ...pluginTools.map((tool) => ({
      name: tool.name,
      description: tool.description || `Plugin tool contributed by ${tool.id || 'a plugin'}.`,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    })),
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  if (!BUILTIN_TOOL_NAMES.has(request.params.name)) {
    return executePluginTool(request.params.name, (request.params.arguments || {}) as Record<string, unknown>);
  }

  if (request.params.name.startsWith('workboard_')) {
    const action = request.params.name.replace(/^workboard_/, '') as WorkboardToolAction;
    return executeWorkboardTool(action, (request.params.arguments || {}) as WorkboardToolInput);
  }

  if (request.params.name === 'subagent_spawn') {
    const args = (request.params.arguments || {}) as SubagentSpawnInput;
    const parentTaskId = (process.env.ACCOMPLISH_TASK_ID || '').trim();
    const parentAgentId = (process.env.ACCOMPLISH_AGENT_ID || '').trim().toLowerCase();
    const targetAgentId = (args.targetAgentId || '').trim();
    const task = (args.task || '').trim();
    if (!parentTaskId || !parentAgentId) {
      return {
        content: [{ type: 'text', text: 'Error: parent task context is unavailable for subagent spawning.' }],
        isError: true,
      };
    }
    if (!task) {
      return {
        content: [{ type: 'text', text: 'Error: task is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentTaskId,
          parentAgentId,
          targetAgentId,
          task,
          label: args.label,
          runTimeoutMs: typeof args.runTimeoutMs === 'number' ? args.runTimeoutMs : undefined,
          isolation: args.isolation === 'worktree' ? 'worktree' : 'shared',
          ownedPaths: Array.isArray(args.ownedPaths) ? args.ownedPaths.map(String) : undefined,
          maxCostUsd: typeof args.maxCostUsd === 'number' ? args.maxCostUsd : undefined,
          limitAction: args.limitAction === 'stop' ? 'stop' : 'notify',
          mode: args.mode === 'session' ? 'session' : 'run',
          reuseExistingSession: typeof args.reuseExistingSession === 'boolean' ? args.reuseExistingSession : undefined,
          modelProvider: args.modelProvider,
          modelId: args.modelId,
          modelBaseUrl: args.modelBaseUrl,
          expectedOutputs: Array.isArray(args.expectedOutputs) ? args.expectedOutputs : undefined,
        }),
      });
      const result = await response.json().catch(() => ({} as {
        status?: string;
        error?: string;
        targetAgentId?: string;
        runId?: string;
        childTaskId?: string;
        childSessionKey?: string;
        reusedExistingSession?: boolean;
        detail?: string;
      }));
      if (!response.ok || result.status !== 'accepted') {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent spawn failed (${result.error || result.detail || response.status}).`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: result.status,
            targetAgentId: result.targetAgentId || targetAgentId || undefined,
            runId: result.runId,
            childTaskId: result.childTaskId,
            childSessionKey: result.childSessionKey,
            reusedExistingSession: result.reusedExistingSession === true,
          }),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to spawn subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_targets') {
    const args = (request.params.arguments || {}) as SubagentListInput;
    const parentTaskId = (args.parentTaskId || process.env.ACCOMPLISH_TASK_ID || '').trim();
    const parentAgentId = (process.env.ACCOMPLISH_AGENT_ID || '').trim().toLowerCase();
    if (!parentAgentId) {
      return {
        content: [{ type: 'text', text: 'Error: parent agent context is unavailable for subagent target lookup.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentTaskId,
          parentAgentId,
        }),
      });
      const result = await response.json().catch(() => ({} as {
        ok?: boolean;
        error?: string;
        detail?: string;
      }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent targets lookup failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to list subagent targets: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_list') {
    const args = (request.params.arguments || {}) as SubagentListInput;
    const parentTaskId = (args.parentTaskId || process.env.ACCOMPLISH_TASK_ID || '').trim();
    if (!parentTaskId) {
      return {
        content: [{ type: 'text', text: 'Error: parentTaskId is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTaskId }),
      });
      const result = await response.json().catch(() => ({} as {
        ok?: boolean;
        error?: string;
        detail?: string;
        runs?: unknown;
        tree?: unknown;
        activeCount?: unknown;
      }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent list failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            runs: result.runs ?? [],
            tree: result.tree ?? [],
            activeCount: typeof result.activeCount === 'number' ? result.activeCount : 0,
          }),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to list subagents: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_get') {
    const args = (request.params.arguments || {}) as SubagentGetInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTaskId: process.env.ACCOMPLISH_TASK_ID, runId }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string; run?: unknown }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent get failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.run ?? null),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to get subagent state: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_stop') {
    const args = (request.params.arguments || {}) as SubagentStopInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string; runId?: string }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent stop failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: `Stopped subagent ${result.runId || runId}.`,
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to stop subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_archive') {
    const args = (request.params.arguments || {}) as SubagentArchiveInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }
    try {
      const response = await fetchNodeToolsApi('/subagents/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          archived: typeof args.archived === 'boolean' ? args.archived : true,
        }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string; run?: unknown }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent archive failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result.run ?? null) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to archive subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_close') {
    const args = (request.params.arguments || {}) as SubagentCloseInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }
    try {
      const response = await fetchNodeToolsApi('/subagents/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string; run?: unknown }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent close failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result.run ?? null) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to close subagent session: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_send') {
    const args = (request.params.arguments || {}) as SubagentSendInput;
    const runId = (args.runId || '').trim();
    const prompt = (args.prompt || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }
    if (!prompt) {
      return {
        content: [{ type: 'text', text: 'Error: prompt is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          prompt,
          modelProvider: args.modelProvider,
          modelId: args.modelId,
          modelBaseUrl: args.modelBaseUrl,
        }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string; runId?: string }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent send failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: `Sent follow-up to subagent ${result.runId || runId}.`,
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to send subagent follow-up: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_wait') {
    const args = (request.params.arguments || {}) as SubagentWaitInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }

    try {
      const requestedTimeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : SUBAGENT_WAIT_DEFAULT_TIMEOUT_MS;
      const safeTimeoutMs = Math.max(60_000, Math.min(SUBAGENT_WAIT_MAX_TIMEOUT_MS, Math.round(requestedTimeoutMs)));
      const response = await fetchNodeToolsApi('/subagents/wait', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTaskId: process.env.ACCOMPLISH_TASK_ID,
          runId,
          timeoutMs: safeTimeoutMs,
          pollIntervalMs: typeof args.pollIntervalMs === 'number' ? args.pollIntervalMs : undefined,
        }),
      });
      const result = await response.json().catch(() => ({} as {
        ok?: boolean;
        error?: string;
        detail?: string;
        completed?: boolean;
        waitedMs?: number;
        run?: unknown;
      }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent wait failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      const completed = result.completed === true;
      if (!completed) {
        const pendingWaitCount = pendingSubagentWaitCounts.get(runId) || 0;
        pendingSubagentWaitCounts.set(runId, pendingWaitCount + 1);
        completedSubagentWaitCounts.delete(runId);
        if (pendingWaitCount > 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                completed: false,
                waitedMs: typeof result.waitedMs === 'number' ? result.waitedMs : 0,
                run: result.run ?? null,
                repeatedWait: true,
                answerNow: pendingWaitCount >= 2,
                nextAction: pendingWaitCount >= 2
                  ? 'Stop polling this subagent in this turn. Tell the user the child work is still running and that the relayed completion will appear when it finishes.'
                  : 'The subagent is still running. Do other useful work, wait for a different child run, or wait once more later if a final synthesis depends on this result.',
              }),
            }],
          };
        }
      } else {
        pendingSubagentWaitCounts.delete(runId);
        const completedWaitCount = completedSubagentWaitCounts.get(runId) || 0;
        completedSubagentWaitCounts.set(runId, completedWaitCount + 1);
        if (completedWaitCount > 0) {
          const finalReport = truncateText(readStringProperty(result.run, 'finalReport'), SUBAGENT_REPEAT_COMPLETED_REPORT_MAX_CHARS);
          const childStatus = readStringProperty(result.run, 'resultStatus') || readStringProperty(result.run, 'status') || 'completed';
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                completed: true,
                waitedMs: typeof result.waitedMs === 'number' ? result.waitedMs : 0,
                run: result.run ?? null,
                repeatedWait: true,
                answerNow: true,
                status: childStatus,
                finalReport,
                nextAction: 'Do not call subagent_wait for this run again. Use this completed child result and produce the final answer now.',
              }),
            }],
          };
        }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            completed,
            waitedMs: typeof result.waitedMs === 'number' ? result.waitedMs : 0,
            run: result.run ?? null,
            answerNow: completed,
            finalReport: completed
              ? readStringProperty(result.run, 'finalReport')
              : undefined,
            nextAction: completed
              ? 'The subagent is complete. Do not call subagent_wait for this run again; use this run data and produce the final answer.'
              : 'The subagent is not complete yet. Continue other useful work or wait later with a short timeout if needed.',
          }),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to wait for subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_progress') {
    const args = (request.params.arguments || {}) as SubagentProgressInput;
    const runId = (args.runId || '').trim();
    const taskId = (process.env.ACCOMPLISH_TASK_ID || '').trim();

    try {
      const response = await fetchNodeToolsApi('/subagents/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: runId || undefined,
          taskId: taskId || undefined,
          title: args.title,
          detail: args.detail,
          type: args.type,
          percentage: typeof args.percentage === 'number' ? args.percentage : undefined,
          currentStep: args.currentStep,
          totalSteps: typeof args.totalSteps === 'number' ? args.totalSteps : undefined,
          completedSteps: typeof args.completedSteps === 'number' ? args.completedSteps : undefined,
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        supervisor?: { recommendedAction?: string };
        [key: string]: unknown;
      };
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent progress failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...result,
            guidance: result.supervisor?.recommendedAction && result.supervisor.recommendedAction !== 'wait'
              ? `Recommended action is ${result.supervisor.recommendedAction}; do not keep blind-polling. Recover, replace, synthesize partial output, or answer as recommended.`
              : 'Progress recorded/read. Continue useful work and report milestones when they materially change.',
          }),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to read subagent progress: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_diagnose') {
    const args = (request.params.arguments || {}) as SubagentDiagnoseInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          staleAfterMs: typeof args.staleAfterMs === 'number' ? args.staleAfterMs : undefined,
        }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent diagnose failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to diagnose subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_recover') {
    const args = (request.params.arguments || {}) as SubagentRecoverInput;
    const runId = (args.runId || '').trim();
    const action = (args.action || '').trim();
    if (!runId || !action) {
      return {
        content: [{ type: 'text', text: 'Error: runId and action are required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          action,
          prompt: args.prompt,
          reason: args.reason,
          targetAgentId: args.targetAgentId,
          task: args.task,
          label: args.label,
          runTimeoutMs: typeof args.runTimeoutMs === 'number' ? args.runTimeoutMs : undefined,
          modelProvider: args.modelProvider,
          modelId: args.modelId,
          modelBaseUrl: args.modelBaseUrl,
        }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Subagent recovery was not accepted. Inspect any returned replacementRunId before retrying. Result: ${JSON.stringify(result)}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to recover subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_replace') {
    const args = (request.params.arguments || {}) as SubagentReplaceInput;
    const runId = (args.runId || '').trim();
    if (!runId) {
      return {
        content: [{ type: 'text', text: 'Error: runId is required.' }],
        isError: true,
      };
    }

    try {
      const response = await fetchNodeToolsApi('/subagents/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          task: args.task,
          targetAgentId: args.targetAgentId,
          reason: args.reason,
          label: args.label,
          runTimeoutMs: typeof args.runTimeoutMs === 'number' ? args.runTimeoutMs : undefined,
          modelProvider: args.modelProvider,
          modelId: args.modelId,
          modelBaseUrl: args.modelBaseUrl,
        }),
      });
      const result = await response.json().catch(() => ({} as { ok?: boolean; error?: string; detail?: string }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Subagent replacement was not accepted. Inspect any returned replacementRunId before retrying. Result: ${JSON.stringify(result)}`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to replace subagent: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  if (request.params.name === 'subagent_wait_many') {
    const args = (request.params.arguments || {}) as SubagentWaitManyInput;
    const runIds = Array.isArray(args.runIds) ? args.runIds.map((runId) => runId.trim()).filter(Boolean) : [];
    if (runIds.length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: runIds is required.' }],
        isError: true,
      };
    }

    try {
      const requestedTimeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : SUBAGENT_WAIT_DEFAULT_TIMEOUT_MS;
      const safeTimeoutMs = Math.max(1_000, Math.min(SUBAGENT_WAIT_MAX_TIMEOUT_MS, Math.round(requestedTimeoutMs)));
      const response = await fetchNodeToolsApi('/subagents/wait-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTaskId: process.env.ACCOMPLISH_TASK_ID,
          runIds,
          timeoutMs: safeTimeoutMs,
          pollIntervalMs: typeof args.pollIntervalMs === 'number' ? args.pollIntervalMs : undefined,
          mode: args.mode === 'any' ? 'any' : 'all',
        }),
      });
      const result = await response.json().catch(() => ({} as {
        ok?: boolean;
        error?: string;
        detail?: string;
        completed?: boolean;
        waitedMs?: number;
        runs?: Array<Record<string, unknown>>;
        completedRuns?: Array<Record<string, unknown>>;
        pendingRuns?: Array<Record<string, unknown>>;
        staleRuns?: Array<Record<string, unknown>>;
        stuckRuns?: Array<Record<string, unknown>>;
        failedRuns?: Array<Record<string, unknown>>;
        recommendedAction?: string;
      }));
      if (!response.ok || result.ok === false) {
        return {
          content: [{
            type: 'text',
            text: `Error: Subagent wait_many failed (${result.error || response.status}).${result.detail ? ` ${result.detail}` : ''}`,
          }],
          isError: true,
        };
      }
      const completed = result.completed === true;
      const completedRuns = Array.isArray(result.completedRuns) ? result.completedRuns : [];
      const pendingRuns = Array.isArray(result.pendingRuns) ? result.pendingRuns : [];
      const runIdOf = (run: Record<string, unknown>) => typeof run.runId === 'string' ? run.runId : undefined;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            completed,
            mode: args.mode === 'any' ? 'any' : 'all',
            waitedMs: typeof result.waitedMs === 'number' ? result.waitedMs : 0,
            runs: result.runs ?? [],
            completedRuns,
            pendingRuns,
            staleRuns: result.staleRuns ?? [],
            stuckRuns: result.stuckRuns ?? [],
            failedRuns: result.failedRuns ?? [],
            completedRunIds: completedRuns.map(runIdOf).filter(Boolean),
            pendingRunIds: pendingRuns.map(runIdOf).filter(Boolean),
            recommendedAction: result.recommendedAction || (completed ? 'answer_now' : 'wait'),
            answerNow: completed || result.recommendedAction === 'answer_now',
            nextAction: completed || result.recommendedAction === 'answer_now'
              ? 'The requested subagent wait condition is complete. Use the returned child results and synthesize now.'
              : result.recommendedAction === 'recover_child'
                ? 'At least one child needs recovery. Use subagent_diagnose, then subagent_recover with a focused prompt. Do not blind-poll.'
                : result.recommendedAction === 'replace_child'
                  ? 'At least one child should be replaced. Use subagent_replace with the original task and useful partial findings. Do not blind-poll.'
                  : result.recommendedAction === 'synthesize_partial'
                    ? 'A child has useful partial output but is not healthy. Synthesize from partial output or replace it if the missing work is critical.'
                    : 'Some subagents are still running. Continue other useful work or wait later; do not repeat wait calls without doing something useful.',
          }),
        }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: Failed to wait for subagents: ${errorMessage}` }],
        isError: true,
      };
    }
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
