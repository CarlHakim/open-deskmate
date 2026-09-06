/**
 * Tool Discovery API Server
 *
 * Local HTTP bridge used by the deferred tool-discovery MCP server. The MCP
 * process is separate from Electron, so enable/search/list calls route through
 * this bridge to keep task-scoped state and audit events in the main process.
 */

import http from 'http';
import {
  describeToolDiscoveryTarget,
  enableTaskScopedTools,
  listEnabledTaskTools,
  searchToolsetsAndTools,
} from './services/toolsets';
import { summarizeCustomMcpRegistry } from './opencode/custom-mcp-registry';
import type {
  ToolDiscoveryDescribeResult,
  ToolDiscoverySearchResult,
} from '@accomplish/shared';

export const TOOL_DISCOVERY_API_PORT = 9232;

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return normalizeStringArray(parsed);
    } catch {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return undefined;
}

function getRuntimeContext(data: Record<string, unknown>) {
  return {
    agentId: normalizeText(data.agentId, 64) || undefined,
    taskId: normalizeText(data.taskId, 128) || undefined,
    deferredToolDiscoveryEnabled: normalizeBoolean(data.deferredToolDiscoveryEnabled),
    requestedToolsetIds: normalizeStringArray(data.requestedToolsetIds),
    initialToolsetIds: normalizeStringArray(data.initialToolsetIds),
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assertResearchEnabled(data: Record<string, unknown>): void {
  const context = getRuntimeContext(data);
  const enabled = listEnabledTaskTools(context);
  if (enabled.runtime.mode !== 'deferred') return;
  const hasResearch = enabled.runtime.enabledToolsetIds.includes('research')
    || enabled.runtime.enabledToolsetIds.includes('desktop_full');
  if (!hasResearch) {
    throw new Error(
      'Web fetch is not enabled for this deferred task. Call tools_enable with toolsetIds ["research"] and a short reason first.'
    );
  }
}

function queryRequestsCustomMcpSummary(query: string): boolean {
  const text = query.toLowerCase();
  return /\b(custom|mcp|registry|server|external)\b/.test(text);
}

function withCustomMcpRegistryForSearch(
  result: ToolDiscoverySearchResult,
  query: string
): ToolDiscoverySearchResult {
  if (!queryRequestsCustomMcpSummary(query)) return result;
  return {
    ...result,
    customMcpRegistry: summarizeCustomMcpRegistry(),
  };
}

function withCustomMcpRegistryForDescribe(
  result: ToolDiscoveryDescribeResult,
  query: string
): ToolDiscoveryDescribeResult {
  if (!queryRequestsCustomMcpSummary(query)) return result;
  return {
    ...result,
    customMcpRegistry: summarizeCustomMcpRegistry(),
  };
}

async function proxyWebFetch(data: Record<string, unknown>) {
  assertResearchEnabled(data);
  const url = normalizeText(data.url, 4096);
  if (!url) throw new Error('url is required');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('url must be a valid http or https URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }

  const response = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'OpenDeskmate/0.5.0 deferred-tool-discovery',
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8',
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  const format = normalizeText(data.format, 32).toLowerCase();
  const body = contentType.includes('text/html') && format !== 'html'
    ? htmlToText(raw)
    : raw.trim();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    contentType,
    text: body.slice(0, 120_000),
    truncated: body.length > 120_000,
  };
}

/**
 * Create and start the HTTP server for deferred tool-discovery requests.
 */
export function startToolDiscoveryApiServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const allowedPaths = new Set([
      '/tools/search',
      '/tools/describe',
      '/tools/enabled-list',
      '/tools/enable',
      '/tools/webfetch',
    ]);

    if (req.method !== 'POST' || !allowedPaths.has(req.url || '')) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 256_000) {
        sendJson(res, 413, { ok: false, error: 'request_too_large' });
        return;
      }
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body || '{}') as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    try {
      if (req.url === '/tools/search') {
        const query = normalizeText(data.query, 256);
        sendJson(res, 200, { ok: true, result: withCustomMcpRegistryForSearch(searchToolsetsAndTools(query), query) });
        return;
      }
      if (req.url === '/tools/describe') {
        const name = normalizeText(data.name, 256);
        sendJson(res, 200, { ok: true, result: withCustomMcpRegistryForDescribe(describeToolDiscoveryTarget(name), name) });
        return;
      }
      if (req.url === '/tools/enabled-list') {
        sendJson(res, 200, { ok: true, result: listEnabledTaskTools(getRuntimeContext(data)) });
        return;
      }
      if (req.url === '/tools/enable') {
        const context = getRuntimeContext(data);
        const result = await enableTaskScopedTools({
          ...context,
          request: {
            taskId: context.taskId,
            agentId: context.agentId,
            toolsetIds: normalizeStringArray(data.toolsetIds),
            capabilityNames: normalizeStringArray(data.capabilityNames),
            toolNames: normalizeStringArray(data.toolNames),
            reason: normalizeText(data.reason, 500),
          },
        });
        sendJson(res, 200, { ok: true, result });
        return;
      }
      if (req.url === '/tools/webfetch') {
        sendJson(res, 200, { ok: true, result: await proxyWebFetch(data) });
        return;
      }
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(TOOL_DISCOVERY_API_PORT, '127.0.0.1', () => {
    console.log(`[ToolDiscovery API] Server listening on port ${TOOL_DISCOVERY_API_PORT}`);
  });

  server.on('error', (err) => {
    console.error('[ToolDiscovery API] Server error:', err);
  });

  return server;
}
