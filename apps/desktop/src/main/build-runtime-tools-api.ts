/**
 * Build Runtime Tools API
 *
 * Local HTTP bridge used by the Build runtime MCP server. This keeps Electron
 * and Build mode internals in the main process while exposing a small tool
 * surface to OpenCode through stdio MCP.
 */

import http from 'http';
import type { BuildQualityCheckKind, BuildUiInteractionAction } from '@accomplish/shared';
import {
  captureBuildPreviewFullPageFromTool,
  captureBuildPreviewScreenshotFromTool,
  getBuildGitSummaryFromTool,
  getBuildPageSnapshotFromTool,
  getBuildRuntimeLogsFromTool,
  getBuildRuntimeToolStatus,
  getBuildTerminalSnapshotFromTool,
  restartBuildRuntimeFromTool,
  runBuildQualityChecksFromTool,
  runBuildUiInteractionTestFromTool,
  startBuildRuntimeFromTool,
} from './services/build-mode/runtime-tools';

export const BUILD_RUNTIME_TOOLS_API_PORT = 9231;

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeToolName(pathname: string | undefined): string | null {
  const prefix = '/build-runtime/';
  if (!pathname?.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).trim().toLowerCase();
}

function normalizeCheckKinds(value: unknown): BuildQualityCheckKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<BuildQualityCheckKind>(['typecheck', 'lint', 'test', 'build', 'runtime-health', 'preview']);
  const kinds = value.filter((item): item is BuildQualityCheckKind => allowed.has(item as BuildQualityCheckKind));
  return kinds.length > 0 ? Array.from(new Set(kinds)) : undefined;
}

function normalizeActions(value: unknown): BuildUiInteractionAction[] {
  if (!Array.isArray(value)) return [];
  const actions: BuildUiInteractionAction[] = [];
  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const type = normalizeText(source.type, 32).toLowerCase();
    const nth = typeof source.nth === 'number' && Number.isFinite(source.nth)
      ? Math.max(0, Math.min(50, Math.floor(source.nth)))
      : undefined;
    if (type === 'click') {
      actions.push({
        type,
        selector: normalizeText(source.selector, 500) || undefined,
        text: normalizeText(source.text, 300) || undefined,
        label: normalizeText(source.label, 300) || undefined,
        role: normalizeText(source.role, 80) || undefined,
        exact: source.exact === true ? true : source.exact === false ? false : undefined,
        nth,
      });
      continue;
    }
    if (type === 'type') {
      actions.push({
        type,
        selector: normalizeText(source.selector, 500) || undefined,
        text: normalizeText(source.text, 300) || undefined,
        label: normalizeText(source.label, 300) || undefined,
        role: normalizeText(source.role, 80) || undefined,
        exact: source.exact === true ? true : source.exact === false ? false : undefined,
        nth,
        value: normalizeText(source.value, 2000),
      });
      continue;
    }
    if (type === 'press_key') {
      const key = normalizeText(source.key, 80);
      if (!key) continue;
      const allowedModifiers = new Set(['Control', 'Ctrl', 'Meta', 'Command', 'Cmd', 'Shift', 'Alt']);
      const modifiers = Array.isArray(source.modifiers)
        ? source.modifiers
            .filter((modifier): modifier is NonNullable<Extract<BuildUiInteractionAction, { type: 'press_key' }>['modifiers']>[number] => (
              typeof modifier === 'string' && allowedModifiers.has(modifier)
            ))
            .slice(0, 4)
        : undefined;
      actions.push({ type, key, modifiers });
      continue;
    }
    if (type === 'expect_text') {
      const text = normalizeText(source.text, 500);
      if (text) actions.push({ type, text });
      continue;
    }
    if (type === 'wait') {
      const ms = typeof source.ms === 'number' && Number.isFinite(source.ms)
        ? Math.max(50, Math.min(5000, Math.floor(source.ms)))
        : undefined;
      actions.push({ type, ms });
    }
  }
  return actions;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 128_000) {
      throw new Error('Request body is too large.');
    }
  }
  if (!body.trim()) return {};
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function startBuildRuntimeToolsApiServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const toolName = normalizeToolName(req.url);
    if (req.method !== 'POST' || !toolName) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: 'Invalid request body',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const agentId = normalizeText(data.agentId, 64).toLowerCase();
    const workspaceRelativePath = normalizeText(data.workspaceRelativePath, 300) || undefined;
    if (!agentId) {
      sendJson(res, 400, { ok: false, error: 'agentId is required.' });
      return;
    }

    try {
      switch (toolName) {
        case 'get_runtime_status':
          sendJson(res, 200, await getBuildRuntimeToolStatus(agentId, workspaceRelativePath));
          return;
        case 'start_runtime':
          sendJson(res, 200, await startBuildRuntimeFromTool(agentId, workspaceRelativePath, data.forceRestart === true));
          return;
        case 'restart_runtime':
          sendJson(res, 200, await restartBuildRuntimeFromTool(agentId));
          return;
        case 'get_runtime_logs':
          sendJson(res, 200, await getBuildRuntimeLogsFromTool(
            agentId,
            typeof data.cursor === 'number' ? data.cursor : 0,
            typeof data.limit === 'number' ? data.limit : 300
          ));
          return;
        case 'get_terminal_snapshot':
          sendJson(res, 200, await getBuildTerminalSnapshotFromTool(
            agentId,
            typeof data.limit === 'number' ? data.limit : 200
          ));
          return;
        case 'capture_preview_screenshot':
          sendJson(res, 200, await captureBuildPreviewScreenshotFromTool(agentId, workspaceRelativePath));
          return;
        case 'capture_full_page_preview':
          sendJson(res, 200, await captureBuildPreviewFullPageFromTool(agentId, workspaceRelativePath));
          return;
        case 'get_page_snapshot':
          sendJson(res, 200, await getBuildPageSnapshotFromTool(agentId, workspaceRelativePath));
          return;
        case 'run_ui_interaction_test':
          sendJson(res, 200, await runBuildUiInteractionTestFromTool(agentId, workspaceRelativePath, normalizeActions(data.actions)));
          return;
        case 'run_quality_checks':
          sendJson(res, 200, await runBuildQualityChecksFromTool(agentId, workspaceRelativePath, normalizeCheckKinds(data.kinds)));
          return;
        case 'get_git_summary':
          sendJson(res, 200, await getBuildGitSummaryFromTool(agentId, workspaceRelativePath));
          return;
        default:
          sendJson(res, 404, { ok: false, error: `Unknown Build runtime tool: ${toolName}` });
      }
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'Build runtime tool failed.',
      });
    }
  });

  server.listen(BUILD_RUNTIME_TOOLS_API_PORT, '127.0.0.1', () => {
    console.log(`[Build Runtime Tools API] Server listening on port ${BUILD_RUNTIME_TOOLS_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Build Runtime Tools API] Port ${BUILD_RUNTIME_TOOLS_API_PORT} already in use, skipping server start`);
    } else {
      console.error('[Build Runtime Tools API] Server error:', error);
    }
  });

  return server;
}
