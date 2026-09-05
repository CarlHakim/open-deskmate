#!/usr/bin/env node
/**
 * Tool Discovery MCP Server
 *
 * Exposes task-scoped deferred tool discovery commands to OpenCode.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

const TOOL_DISCOVERY_API_PORT = process.env.TOOL_DISCOVERY_API_PORT || '9232';
const TOOL_DISCOVERY_API_HOST = process.env.TOOL_DISCOVERY_API_HOST || '127.0.0.1';
const TOOL_DISCOVERY_API_URL = `http://${TOOL_DISCOVERY_API_HOST}:${TOOL_DISCOVERY_API_PORT}`;

const RUNTIME_CONTEXT = {
  agentId: process.env.ACCOMPLISH_AGENT_ID || undefined,
  taskId: process.env.ACCOMPLISH_TASK_ID || undefined,
  deferredToolDiscoveryEnabled: process.env.ACCOMPLISH_DEFERRED_TOOL_DISCOVERY === '1',
  requestedToolsetIds: parseJsonArray(process.env.ACCOMPLISH_REQUESTED_TOOLSET_IDS),
  initialToolsetIds: parseJsonArray(process.env.ACCOMPLISH_INITIAL_TOOLSET_IDS),
};

function parseJsonArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : undefined;
  } catch {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function toolResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: stringify(value) }],
    isError,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function callApi(pathname: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${TOOL_DISCOVERY_API_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...RUNTIME_CONTEXT,
      ...payload,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    const detail = result?.error || result?.detail || response.statusText;
    throw new Error(String(detail || `Tool discovery API failed with ${response.status}`));
  }
  return result?.result ?? result;
}

const server = new Server(
  { name: 'tools', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search',
      description: 'Search formal toolsets, capabilities, and discovery commands by keyword before enabling tools.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query such as web, research, files, skills, browser, build, git, or mcp.' },
        },
      },
    },
    {
      name: 'describe',
      description: 'Describe a formal toolset, capability, concrete tool name, or discovery command.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to describe, for example research, webfetch, build_runtime, or tools_enable.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'enable',
      description: 'Enable the smallest relevant formal toolset for the current task. Include a short reason.',
      inputSchema: {
        type: 'object',
        properties: {
          toolsetIds: { type: 'array', items: { type: 'string' } },
          capabilityNames: { type: 'array', items: { type: 'string' } },
          toolNames: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
    {
      name: 'enabled_list',
      description: 'List enabled, available, and deferred toolsets for this task.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'webfetch',
      description: 'Deferred-mode web fetch proxy. Enable the research toolset before using it.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL to fetch.' },
          format: { type: 'string', enum: ['text', 'html'], description: 'Return text by default, or raw HTML.' },
        },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const input = asObject(request.params.arguments);
  try {
    switch (name) {
      case 'search':
        return toolResult(await callApi('/tools/search', input));
      case 'describe':
        return toolResult(await callApi('/tools/describe', input));
      case 'enable':
        return toolResult(await callApi('/tools/enable', input));
      case 'enabled_list':
        return toolResult(await callApi('/tools/enabled-list', input));
      case 'webfetch':
        return toolResult(await callApi('/tools/webfetch', input));
      default:
        return toolResult({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (error) {
    return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
