/**
 * Canvas API Server
 *
 * Local HTTP server used by the canvas MCP tool to control the
 * desktop canvas window (present/hide/navigate/eval/snapshot/A2UI).
 */

import http from 'http';
import { URL } from 'url';
import { startCanvasHost, getCanvasHostStatus } from './services/canvas-host';
import { CANVAS_API_PORT, CANVAS_ACTION_PATH } from './canvas-constants';
import {
  presentCanvas,
  hideCanvas,
  navigateCanvas,
  evalCanvas,
  snapshotCanvas,
  getCanvasWindowUrl,
} from './services/canvas-window';
import { dispatchTask, resumeTaskSession } from './services/task-dispatch';
import { getTask } from './store/taskHistory';
import { getTaskManager } from './opencode/task-manager';

const CANVAS_API_HOST = '127.0.0.1';

export { CANVAS_API_PORT, CANVAS_ACTION_PATH };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let canvasApiServer: http.Server | null = null;

type CanvasAction =
  | 'present'
  | 'hide'
  | 'navigate'
  | 'eval'
  | 'snapshot'
  | 'a2ui_push'
  | 'a2ui_reset';

type CanvasContext = {
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  updatedAt?: number;
};

let lastCanvasContext: CanvasContext = {};

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(payload));
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function resolveSessionIdForTask(taskId?: string): string | undefined {
  if (!taskId) return undefined;
  const active = getTaskManager().getSessionId(taskId);
  if (active) return active;
  const stored = getTask(taskId);
  return stored?.sessionId;
}

function resolveAgentIdForTask(taskId?: string): string | undefined {
  if (!taskId) return undefined;
  const stored = getTask(taskId);
  return stored?.agentId;
}

async function ensureCanvasHost() {
  await startCanvasHost();
  return getCanvasHostStatus();
}

async function ensureA2uiReady(): Promise<string> {
  const host = await ensureCanvasHost();
  const a2uiUrl = host?.a2uiUrl;
  if (!a2uiUrl) {
    throw new Error('Canvas host not ready');
  }
  const currentUrl = getCanvasWindowUrl();
  if (!currentUrl || !currentUrl.startsWith(a2uiUrl)) {
    await navigateCanvas(a2uiUrl);
  }
  return a2uiUrl;
}

function parseJsonl(jsonl: string): unknown[] {
  const messages: unknown[] = [];
  const lines = jsonl.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSONL at line ${i + 1}: ${message}`);
    }
  }
  return messages;
}

async function handleCanvasAction(
  action: CanvasAction,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (action) {
    case 'present': {
      const host = await ensureCanvasHost();
      const target = readString(payload.target) ?? readString(payload.url);
      const placementInput = typeof payload.placement === 'object' && payload.placement
        ? (payload.placement as Record<string, unknown>)
        : null;
      const placement = {
        x: readNumber(payload.x) ?? (placementInput ? readNumber(placementInput.x) : undefined),
        y: readNumber(payload.y) ?? (placementInput ? readNumber(placementInput.y) : undefined),
        width: readNumber(payload.width) ?? (placementInput ? readNumber(placementInput.width) : undefined),
        height: readNumber(payload.height) ?? (placementInput ? readNumber(placementInput.height) : undefined),
      };
      await presentCanvas({
        url: target,
        ...placement,
      });
      return {
        ok: true,
        url: getCanvasWindowUrl() ?? target ?? host?.baseUrl ?? null,
      };
    }
    case 'hide':
      await hideCanvas();
      return { ok: true };
    case 'navigate': {
      const url = readString(payload.url) ?? readString(payload.target);
      if (!url) throw new Error('url is required');
      await ensureCanvasHost();
      await navigateCanvas(url);
      return { ok: true, url };
    }
    case 'eval': {
      const javaScript = readString(payload.javaScript);
      if (!javaScript) throw new Error('javaScript is required');
      await ensureCanvasHost();
      const result = await evalCanvas(javaScript);
      return { ok: true, result };
    }
    case 'snapshot': {
      const formatRaw = (readString(payload.outputFormat) ?? readString(payload.format) ?? 'png').toLowerCase();
      const format = formatRaw === 'jpg' || formatRaw === 'jpeg' ? 'jpeg' : 'png';
      const maxWidth = readNumber(payload.maxWidth);
      const quality = readNumber(payload.quality);
      await ensureCanvasHost();
      const snapshot = await snapshotCanvas({ format, maxWidth, quality });
      const mime = snapshot.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrl = `data:${mime};base64,${snapshot.base64}`;
      return { ok: true, ...snapshot, dataUrl };
    }
    case 'a2ui_push': {
      const taskId = readString(payload.taskId);
      const jsonl = readString(payload.jsonl);
      const messages =
        Array.isArray(payload.messages) ? payload.messages :
          jsonl ? parseJsonl(jsonl) : null;
      if (!messages || messages.length === 0) {
        throw new Error('jsonl or messages are required');
      }
      await ensureA2uiReady();
      const result = await evalCanvas(
        `(() => {
          const messages = ${JSON.stringify(messages)};
          const api = globalThis.opendeskmateA2UI ?? globalThis.clawdbotA2UI;
          if (!api || typeof api.applyMessages !== "function") {
            throw new Error("A2UI is not ready");
          }
          api.applyMessages(messages);
          ${taskId ? `globalThis.__opendeskmateCanvasTaskId = ${JSON.stringify(taskId)};` : ''}
          return "ok";
        })()`
      );
      if (taskId) {
        lastCanvasContext = {
          taskId,
          sessionId: resolveSessionIdForTask(taskId),
          agentId: resolveAgentIdForTask(taskId),
          updatedAt: Date.now(),
        };
      }
      return { ok: true, result };
    }
    case 'a2ui_reset': {
      await ensureA2uiReady();
      const result = await evalCanvas(
        `(() => {
          const api = globalThis.opendeskmateA2UI ?? globalThis.clawdbotA2UI;
          if (!api || typeof api.reset !== "function") {
            throw new Error("A2UI is not ready");
          }
          api.reset();
          return "ok";
        })()`
      );
      return { ok: true, result };
    }
    default:
      throw new Error(`Unknown action: ${action as string}`);
  }
}

async function handleCanvasUserAction(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawUserAction = payload.userAction;
  const userAction: Record<string, unknown> | null = (() => {
    if (typeof rawUserAction === 'string') {
      try {
        const parsed = JSON.parse(rawUserAction);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    if (rawUserAction && typeof rawUserAction === 'object') {
      return rawUserAction as Record<string, unknown>;
    }
    return null;
  })();

  const taskId =
    readString(payload.taskId) ||
    readString(userAction?.taskId) ||
    lastCanvasContext.taskId;
  const sessionId =
    readString(payload.sessionId) ||
    readString(userAction?.sessionId) ||
    lastCanvasContext.sessionId ||
    resolveSessionIdForTask(taskId);
  const agentId =
    readString(payload.agentId) ||
    readString(userAction?.agentId) ||
    lastCanvasContext.agentId ||
    resolveAgentIdForTask(taskId);

  if (taskId || sessionId || agentId) {
    lastCanvasContext = {
      taskId: taskId ?? lastCanvasContext.taskId,
      sessionId: sessionId ?? lastCanvasContext.sessionId,
      agentId: agentId ?? lastCanvasContext.agentId,
      updatedAt: Date.now(),
    };
  }

  const actionText = userAction ? JSON.stringify(userAction) : JSON.stringify(payload);
  const prompt = `A2UI user action received:\n${actionText}`;

  if (sessionId) {
    const result = await resumeTaskSession(sessionId, prompt, taskId, agentId);
    return { ok: true, taskId: result.taskId, sessionId };
  }

  const result = await dispatchTask({ prompt, agentId });
  return { ok: true, taskId: result.taskId };
}

export function startCanvasApiServer(): http.Server {
  if (canvasApiServer) return canvasApiServer;

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: 'Invalid request' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${CANVAS_API_HOST}:${CANVAS_API_PORT}`);
    if (req.method !== 'POST' || (url.pathname !== '/canvas' && url.pathname !== CANVAS_ACTION_PATH)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      const payload = await parseJsonBody(req);
      if (url.pathname === CANVAS_ACTION_PATH) {
        const result = await handleCanvasUserAction(payload);
        sendJson(res, 200, result);
        return;
      }

      const action = readString(payload.action) as CanvasAction | undefined;
      if (!action) {
        sendJson(res, 400, { error: 'action is required' });
        return;
      }

      const result = await handleCanvasAction(action, payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'Canvas request failed' });
    }
  });

  server.listen(CANVAS_API_PORT, CANVAS_API_HOST, () => {
    console.log(`[Canvas API] Server listening on http://${CANVAS_API_HOST}:${CANVAS_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Canvas API] Port ${CANVAS_API_PORT} already in use, skipping server start`);
    } else {
      console.error('[Canvas API] Server error:', error);
    }
  });

  canvasApiServer = server;
  return server;
}

export async function stopCanvasApiServer(): Promise<void> {
  if (!canvasApiServer) return;
  const server = canvasApiServer;
  canvasApiServer = null;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
