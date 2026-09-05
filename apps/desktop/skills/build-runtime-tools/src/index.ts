#!/usr/bin/env node
/**
 * Build Runtime Tools MCP Server
 *
 * Exposes Build mode runtime inspection tools to the active OpenCode task.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

const API_PORT = process.env.BUILD_RUNTIME_TOOLS_API_PORT || '9231';
const API_URL = `http://127.0.0.1:${API_PORT}/build-runtime`;
const AGENT_ID = (process.env.ACCOMPLISH_AGENT_ID || '').trim().toLowerCase();
const WORKSPACE_RELATIVE_PATH = (process.env.ACCOMPLISH_BUILD_WORKSPACE_RELATIVE || '.').trim() || '.';
const BUILD_MODE_ENABLED = process.env.ACCOMPLISH_BUILD_MODE === '1';
const DUPLICATE_TOOL_CALL_LIMIT = 3;

type JsonObject = Record<string, unknown>;

let lastToolSignature: string | null = null;
let consecutiveDuplicateToolCalls = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function normalizeSignatureValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => normalizeSignatureValue(item, depth + 1));
  if (typeof value === 'object') {
    if (depth >= 8) return '[object]';
    const source = value as JsonObject;
    const normalized: JsonObject = {};
    for (const key of Object.keys(source).sort().slice(0, 80)) {
      normalized[key] = normalizeSignatureValue(source[key], depth + 1);
    }
    return normalized;
  }
  return String(value);
}

function buildToolSignature(tool: string, args: JsonObject): string {
  try {
    return `${tool}:${JSON.stringify(normalizeSignatureValue(args))}`.slice(0, 4000);
  } catch {
    return `${tool}:${String(args)}`.slice(0, 4000);
  }
}

function duplicateToolCallResult(tool: string): CallToolResult {
  const text = [
    `The exact same ${tool} call has already been run multiple times with the same arguments.`,
    'Do not call it again. Use the previous result already in the conversation and produce the next useful answer or choose a different, more specific tool call.',
  ].join(' ');
  return {
    content: [{ type: 'text', text }],
  };
}

async function callBuildRuntimeApi(tool: string, args: JsonObject = {}): Promise<CallToolResult> {
  if (!BUILD_MODE_ENABLED || !AGENT_ID) {
    return errorResult('Build runtime tools are only available inside an active Build mode AI task.');
  }

  const payload = {
    ...args,
    agentId: AGENT_ID,
    workspaceRelativePath: WORKSPACE_RELATIVE_PATH,
  };

  const signature = buildToolSignature(tool, payload);
  if (signature === lastToolSignature) {
    consecutiveDuplicateToolCalls += 1;
  } else {
    lastToolSignature = signature;
    consecutiveDuplicateToolCalls = 1;
  }
  if (consecutiveDuplicateToolCalls >= DUPLICATE_TOOL_CALL_LIMIT) {
    return duplicateToolCallResult(tool);
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok === false) {
        return errorResult(result?.detail || result?.error || `Build runtime API returned ${response.status}.`);
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result),
        }],
      };
    } catch (error) {
      lastError = error;
      await sleep(150 + attempt * 100);
    }
  }

  return errorResult(lastError instanceof Error ? lastError.message : 'Build runtime API is unavailable.');
}

const server = new Server(
  { name: 'build-runtime-tools', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_runtime_status',
      description:
        'Inspect the current Build runtime status, workspace, preview URL, health, and recommended next action. Start here before smoke testing.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'start_runtime',
      description:
        'Start the selected Build preset runtime for the active workspace. Use this before browser/screenshot testing when runtime is stopped. Pass forceRestart=true only when a clean restart is needed.',
      inputSchema: {
        type: 'object',
        properties: {
          forceRestart: { type: 'boolean', description: 'Restart even if a runtime process already exists.' },
        },
      },
    },
    {
      name: 'restart_runtime',
      description:
        'Restart the current Build runtime after a code fix or when the preview appears stale.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_runtime_logs',
      description:
        'Read recent Build runtime logs. Use after start/restart and when preview or UI tests fail.',
      inputSchema: {
        type: 'object',
        properties: {
          cursor: { type: 'number', description: 'Optional log cursor from a previous call.' },
          limit: { type: 'number', description: 'Maximum log rows to return, capped by the app.' },
        },
      },
    },
    {
      name: 'get_terminal_snapshot',
      description:
        'Read the active Build terminal sessions and recent terminal output. Use this for commands or errors visible in the Terminal panel.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Recent terminal entries to include.' },
        },
      },
    },
    {
      name: 'capture_preview_screenshot',
      description:
        'Capture the currently visible runtime preview as a PNG file. Returns the saved file path and image dimensions.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'capture_full_page_preview',
      description:
        'Capture the full local runtime preview page, including below-the-fold content when possible. Returns the saved PNG path, dimensions, and clipping status.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_page_snapshot',
      description:
        'Inspect the local runtime preview page structure. Returns title, URL, visible interactive controls, labels, selectors, and console errors.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'run_ui_interaction_test',
      description:
        'Run safe UI smoke-test actions against the runtime preview: click controls, type into fields, press keyboard shortcuts, wait, and check visible text. Captures before/after screenshots, matched element evidence, ambiguity candidates, and console errors. Prefer role+exact label or selectors from get_page_snapshot for short labels such as + or 0.',
      inputSchema: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Ordered actions. Use get_page_snapshot first to choose selectors, roles, labels, or visible text. For short labels, pass exact=true and role when possible. If a result says ambiguous, retry with selector or nth.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['click', 'type', 'press_key', 'expect_text', 'wait'] },
                selector: { type: 'string' },
                text: { type: 'string' },
                label: { type: 'string' },
                role: { type: 'string', description: 'Expected role such as button, link, textbox, checkbox, tab, or switch.' },
                exact: { type: 'boolean', description: 'Require exact label/text matching. Short labels default to exact unless exact=false is explicitly passed.' },
                nth: { type: 'number', description: 'Zero-based index into matched candidates when an intentionally repeated control must be selected.' },
                value: { type: 'string' },
                key: { type: 'string', description: 'Key to press for press_key, such as p, Enter, Escape, ArrowLeft, or v.' },
                modifiers: {
                  type: 'array',
                  items: { type: 'string', enum: ['Control', 'Ctrl', 'Meta', 'Command', 'Cmd', 'Shift', 'Alt'] },
                },
                ms: { type: 'number' },
              },
              required: ['type'],
            },
          },
        },
        required: ['actions'],
      },
    },
    {
      name: 'run_quality_checks',
      description:
        'Run configured Build quality checks such as typecheck, lint, tests, build, runtime health, and preview. Use after code changes or smoke-test failures.',
      inputSchema: {
        type: 'object',
        properties: {
          kinds: {
            type: 'array',
            items: { type: 'string', enum: ['typecheck', 'lint', 'test', 'build', 'runtime-health', 'preview'] },
          },
        },
      },
    },
    {
      name: 'get_git_summary',
      description:
        'Inspect the active Build workspace Git state, current branch, sync status, and changed files. Use before summarizing changed files.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments || {}) as JsonObject;
  switch (request.params.name) {
    case 'get_runtime_status':
    case 'start_runtime':
    case 'restart_runtime':
    case 'get_runtime_logs':
    case 'get_terminal_snapshot':
    case 'capture_preview_screenshot':
    case 'capture_full_page_preview':
    case 'get_page_snapshot':
    case 'run_ui_interaction_test':
    case 'run_quality_checks':
    case 'get_git_summary':
      return callBuildRuntimeApi(request.params.name, args);
    default:
      return errorResult(`Unknown Build runtime tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Build Runtime Tools MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start Build Runtime Tools MCP server:', error);
  process.exit(1);
});
