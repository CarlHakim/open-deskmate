#!/usr/bin/env node
/**
 * Canvas MCP Server
 *
 * Exposes a `canvas` tool for driving the Open Deskmate canvas window
 * (present/hide/navigate/eval/snapshot/A2UI).
 */

import fs from 'fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

const CANVAS_API_PORT = process.env.CANVAS_API_PORT || '9227';
const CANVAS_API_URL = `http://127.0.0.1:${CANVAS_API_PORT}/canvas`;
const TASK_ID = process.env.ACCOMPLISH_TASK_ID || '';

const CANVAS_ACTIONS = [
  'present',
  'hide',
  'navigate',
  'eval',
  'snapshot',
  'a2ui_push',
  'a2ui_reset',
] as const;

type CanvasAction = (typeof CANVAS_ACTIONS)[number];

interface CanvasInput {
  action: CanvasAction;
  target?: string;
  url?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  javaScript?: string;
  outputFormat?: 'png' | 'jpg' | 'jpeg';
  format?: 'png' | 'jpg' | 'jpeg';
  maxWidth?: number;
  quality?: number;
  jsonl?: string;
  jsonlPath?: string;
  messages?: unknown[];
}

const server = new Server(
  { name: 'canvas', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'canvas',
      description:
        'Control the Open Deskmate canvas (present/hide/navigate/eval/snapshot/A2UI). Use snapshot to capture rendered output.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: CANVAS_ACTIONS,
            description: 'Canvas action to perform',
          },
          target: {
            type: 'string',
            description: 'Target URL for present (alias of url)',
          },
          url: {
            type: 'string',
            description: 'URL for navigate or present',
          },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          javaScript: {
            type: 'string',
            description: 'JavaScript to execute in the canvas page',
          },
          outputFormat: {
            type: 'string',
            enum: ['png', 'jpg', 'jpeg'],
            description: 'Snapshot output format',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpg', 'jpeg'],
            description: 'Snapshot output format (alias)',
          },
          maxWidth: { type: 'number' },
          quality: { type: 'number' },
          jsonl: {
            type: 'string',
            description: 'A2UI JSONL string (one JSON object per line)',
          },
          jsonlPath: {
            type: 'string',
            description: 'Path to JSONL file for A2UI',
          },
          messages: {
            type: 'array',
            items: { type: 'object' },
            description: 'A2UI message objects (alternative to jsonl)',
          },
        },
        required: ['action'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  if (request.params.name !== 'canvas') {
    return {
      content: [{ type: 'text', text: `Error: Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const args = (request.params.arguments || {}) as CanvasInput;
  const action = args.action;
  if (!action) {
    return {
      content: [{ type: 'text', text: 'Error: action is required' }],
      isError: true,
    };
  }

  let jsonl = args.jsonl;
  if (!jsonl && args.jsonlPath) {
    try {
      jsonl = await fs.readFile(args.jsonlPath, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: Failed to read jsonlPath: ${message}` }],
        isError: true,
      };
    }
  }

  const payload: Record<string, unknown> = {
    action,
    target: args.target,
    url: args.url,
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    javaScript: args.javaScript,
    outputFormat: args.outputFormat,
    format: args.format,
    maxWidth: args.maxWidth,
    quality: args.quality,
    jsonl,
    messages: args.messages,
    taskId: TASK_ID || undefined,
  };

  try {
    const response = await fetch(CANVAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const resultText = await response.text();
    if (!response.ok) {
      return {
        content: [{ type: 'text', text: `Error: Canvas API returned ${response.status}: ${resultText}` }],
        isError: true,
      };
    }

    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(resultText) as Record<string, unknown>;
    } catch {
      result = { raw: resultText };
    }

    let text = '';
    if (action === 'snapshot' && typeof result.dataUrl === 'string') {
      text = result.dataUrl;
    } else if (typeof result.result === 'string') {
      text = result.result;
    } else if (typeof resultText === 'string' && resultText.trim()) {
      text = resultText;
    } else {
      text = JSON.stringify(result);
    }

    return {
      content: [{ type: 'text', text }],
      details: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: Canvas request failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Canvas MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
