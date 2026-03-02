import fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { WebSocketServer, type WebSocket } from 'ws';
import { CANVAS_ACTION_PATH, CANVAS_API_PORT } from '../canvas-constants';

export const CANVAS_HOST_PATH = '/__opendeskmate__/canvas';
export const A2UI_PATH = '/__opendeskmate__/a2ui';
export const CANVAS_WS_PATH = '/__opendeskmate__/ws';

const DEFAULT_CANVAS_PORT = 18793;

export type CanvasHostStatus = {
  port: number;
  rootDir: string;
  baseUrl: string;
  a2uiUrl: string;
  liveReload: boolean;
};

type CanvasHostServer = {
  server: Server;
  port: number;
  rootDir: string;
  liveReload: boolean;
  close: () => Promise<void>;
};

let canvasHost: CanvasHostServer | null = null;

function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.js':
    case '.mjs':
      return 'application/javascript';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function normalizeUrlPath(rawPath: string): string {
  const decoded = decodeURIComponent(rawPath || '/');
  const normalized = path.posix.normalize(decoded);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function resolveFilePath(rootReal: string, urlPath: string) {
  const normalized = normalizeUrlPath(urlPath);
  const rel = normalized.replace(/^\/+/, '');
  if (rel.split('/').some((p) => p === '..')) return null;

  let candidate = path.join(rootReal, rel);
  if (normalized.endsWith('/')) {
    candidate = path.join(candidate, 'index.html');
  }

  try {
    const st = await fs.stat(candidate);
    if (st.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
    }
  } catch {
    // ignore
  }

  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  try {
    const lstat = await fs.lstat(candidate);
    if (lstat.isSymbolicLink()) return null;
    const real = await fs.realpath(candidate);
    if (!real.startsWith(rootPrefix)) return null;
    return real;
  } catch {
    return null;
  }
}

function defaultIndexHTML() {
  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Open Deskmate Canvas</title>
<style>
  html, body { height: 100%; margin: 0; background: #0b1221; color: #e2e8f0; font: 16px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { min-height: 100%; display: grid; place-items: center; padding: 24px; }
  .card { width: min(760px, 100%); background: rgba(15,23,42,0.8); border: 1px solid rgba(148,163,184,0.25); border-radius: 16px; padding: 20px; box-shadow: 0 20px 60px rgba(15,23,42,0.4); }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0 0 12px; color: #94a3b8; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; }
  button { appearance: none; border: 1px solid rgba(148,163,184,0.35); background: rgba(30,41,59,0.6); color: #e2e8f0; padding: 10px 12px; border-radius: 12px; font-weight: 600; cursor: pointer; }
  button:active { transform: translateY(1px); }
  .log { margin-top: 14px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; white-space: pre-wrap; background: rgba(2,6,23,0.6); border: 1px solid rgba(148,163,184,0.2); padding: 10px; border-radius: 12px; }
</style>
<div class="wrap">
  <div class="card">
    <h1>Open Deskmate Canvas</h1>
    <p>This canvas is a visual workspace for agent-driven layouts and demos.</p>
    <div class="row">
      <button id="btn-hello">Hello</button>
      <button id="btn-time">Time</button>
      <button id="btn-refresh">Refresh</button>
    </div>
    <div id="log" class="log">Canvas ready.</div>
  </div>
</div>
<script>
(() => {
  const logEl = document.getElementById("log");
  const log = (msg) => { logEl.textContent = String(msg); };
  document.getElementById("btn-hello").onclick = () => log("Hello from Open Deskmate Canvas.");
  document.getElementById("btn-time").onclick = () => log(new Date().toLocaleString());
  document.getElementById("btn-refresh").onclick = () => location.reload();
})();
</script>
`;
}

function injectCanvasLiveReload(html: string): string {
  const snippet = `
<script>
(() => {
  // Cross-platform action bridge helper.
  // Works on:
  // - iOS: window.webkit.messageHandlers.opendeskmateCanvasA2UIAction.postMessage(...)
  // - Android: window.opendeskmateCanvasA2UIAction.postMessage(...)
  // (legacy clawdbotCanvasA2UIAction is still supported)
  const actionHandlerName = "opendeskmateCanvasA2UIAction";
  const legacyActionHandlerName = "clawdbotCanvasA2UIAction";
  const canvasActionUrl = ${JSON.stringify(`http://127.0.0.1:${CANVAS_API_PORT}${CANVAS_ACTION_PATH}`)};
  function dispatchActionStatus(id, ok, error) {
    try {
      globalThis.dispatchEvent(
        new CustomEvent("opendeskmate:a2ui-action-status", {
          detail: { id, ok: !!ok, error: error ? String(error) : null },
        })
      );
      globalThis.dispatchEvent(
        new CustomEvent("clawdbot:a2ui-action-status", {
          detail: { id, ok: !!ok, error: error ? String(error) : null },
        })
      );
    } catch {}
  }
  function parsePayload(raw) {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return { userAction: raw };
      }
    }
    if (raw && typeof raw === "object") return raw;
    return { userAction: raw };
  }
  function getActionId(payload) {
    const action =
      payload && typeof payload === "object"
        ? (typeof payload.userAction === "string"
            ? (() => { try { return JSON.parse(payload.userAction); } catch { return null; } })()
            : payload.userAction)
        : null;
    const id =
      (action && typeof action.id === "string" && action.id.trim()) ||
      (payload && typeof payload.id === "string" && payload.id.trim()) ||
      null;
    return id || (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  }
  function ensureLocalActionHandler() {
    if (!globalThis[actionHandlerName]) {
      globalThis[actionHandlerName] = {
      postMessage: (payload) => {
        try {
          const parsed = parsePayload(payload);
          const actionId = getActionId(parsed);
          const taskId = globalThis.__opendeskmateCanvasTaskId;
          const body = {
            ...parsed,
            taskId: parsed.taskId ?? taskId,
          };
          fetch(canvasActionUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
            .then(async (res) => {
              let data = null;
              try {
                data = await res.json();
              } catch {}
              const ok = typeof data?.ok === "boolean" ? data.ok : res.ok;
              const error = ok ? null : (data?.error ?? "Action failed");
              dispatchActionStatus(actionId, ok, error);
            })
            .catch((err) => {
              dispatchActionStatus(actionId, false, err?.message ?? String(err));
            });
          return true;
        } catch {
          return false;
        }
      },
      };
    }
    // Provide legacy handler name as an alias.
    if (!globalThis[legacyActionHandlerName]) {
      globalThis[legacyActionHandlerName] = globalThis[actionHandlerName];
    }
  }
  ensureLocalActionHandler();
  function postToNode(payload) {
    try {
      const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
      const iosHandler =
        globalThis.webkit?.messageHandlers?.[actionHandlerName] ??
        globalThis.webkit?.messageHandlers?.[legacyActionHandlerName];
      if (iosHandler && typeof iosHandler.postMessage === "function") {
        iosHandler.postMessage(raw);
        return true;
      }
      const androidHandler = globalThis[actionHandlerName] ?? globalThis[legacyActionHandlerName];
      if (androidHandler && typeof androidHandler.postMessage === "function") {
        // Important: call as a method on the interface object (binding matters on Android WebView).
        androidHandler.postMessage(raw);
        return true;
      }
    } catch {}
    return false;
  }
  function sendUserAction(userAction) {
    const id =
      (userAction && typeof userAction.id === "string" && userAction.id.trim()) ||
      (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    const action = { ...userAction, id };
    return postToNode({ userAction: action });
  }
  globalThis.Clawdbot = globalThis.Clawdbot ?? {};
  globalThis.Clawdbot.postMessage = postToNode;
  globalThis.Clawdbot.sendUserAction = sendUserAction;
  globalThis.clawdbotPostMessage = postToNode;
  globalThis.clawdbotSendUserAction = sendUserAction;

  globalThis.OpenDeskmate = globalThis.OpenDeskmate ?? {};
  globalThis.OpenDeskmate.postMessage = postToNode;
  globalThis.OpenDeskmate.sendUserAction = sendUserAction;
  globalThis.opendeskmatePostMessage = postToNode;
  globalThis.opendeskmateSendUserAction = sendUserAction;

  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(proto + "://" + location.host + ${JSON.stringify(CANVAS_WS_PATH)});
    ws.onmessage = (ev) => {
      if (String(ev.data || "") === "reload") location.reload();
    };
  } catch {}
})();
</script>
`.trim();

  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx >= 0) {
    return `${html.slice(0, idx)}\n${snippet}\n${html.slice(idx)}`;
  }
  return `${html}\n${snippet}\n`;
}

async function resolveA2uiRoot(): Promise<string | null> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../canvas-host/a2ui'),
    path.resolve(here, '../../src/main/canvas-host/a2ui'),
    path.resolve(app.getAppPath(), 'src', 'main', 'canvas-host', 'a2ui'),
    path.resolve(process.resourcesPath, 'canvas-host', 'a2ui'),
  ];

  for (const dir of candidates) {
    try {
      const indexPath = path.join(dir, 'index.html');
      const bundlePath = path.join(dir, 'a2ui.bundle.js');
      await fs.stat(indexPath);
      await fs.stat(bundlePath);
      return dir;
    } catch {
      // try next
    }
  }
  return null;
}

async function handleA2uiHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) return false;

  const url = new URL(urlRaw, 'http://localhost');
  if (url.pathname !== A2UI_PATH && !url.pathname.startsWith(`${A2UI_PATH}/`)) {
    return false;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Method Not Allowed');
    return true;
  }

  const root = await resolveA2uiRoot();
  if (!root) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('A2UI assets not found');
    return true;
  }

  const rel = url.pathname.slice(A2UI_PATH.length);
  const filePath = await resolveFilePath(root, rel || '/');
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('not found');
    return true;
  }

  const mime = detectMime(filePath);
  res.setHeader('Cache-Control', 'no-store');

  if (mime === 'text/html') {
    const html = await fs.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(injectCanvasLiveReload(html));
    return true;
  }

  res.setHeader('Content-Type', mime);
  res.end(await fs.readFile(filePath));
  return true;
}

async function prepareCanvasRoot(rootDir: string) {
  await fs.mkdir(rootDir, { recursive: true });
  const rootReal = await fs.realpath(rootDir);
  try {
    const indexPath = path.join(rootReal, 'index.html');
    await fs.stat(indexPath);
  } catch {
    try {
      await fs.writeFile(path.join(rootReal, 'index.html'), defaultIndexHTML(), 'utf8');
    } catch {
      // ignore
    }
  }
  return rootReal;
}

function normalizeBasePath(rawPath?: string) {
  const trimmed = (rawPath ?? CANVAS_HOST_PATH).trim();
  const normalized = normalizeUrlPath(trimmed || CANVAS_HOST_PATH);
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

async function createCanvasServer(rootDir: string, port: number, liveReload: boolean): Promise<CanvasHostServer> {
  const basePath = normalizeBasePath(CANVAS_HOST_PATH);
  const rootReal = await prepareCanvasRoot(rootDir);

  const wss = liveReload ? new WebSocketServer({ noServer: true }) : null;
  const sockets = new Set<WebSocket>();
  if (wss) {
    wss.on('connection', (ws: WebSocket) => {
      sockets.add(ws);
      ws.on('close', () => sockets.delete(ws));
    });
  }

  let debounce: NodeJS.Timeout | null = null;
  const broadcastReload = () => {
    for (const ws of sockets) {
      try {
        ws.send('reload');
      } catch {
        // ignore
      }
    }
  };
  const scheduleReload = () => {
    if (!liveReload) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      broadcastReload();
    }, 100);
  };

  let watcher: FSWatcher | null = null;
  try {
    if (liveReload) {
      watcher = watch(rootReal, { recursive: true }, () => scheduleReload());
    }
  } catch {
    // Ignore watch failures; live reload will be disabled.
  }

  const server: Server = http.createServer((req, res) => {
    if (String(req.headers.upgrade ?? '').toLowerCase() === 'websocket') return;
    void (async () => {
      if (await handleA2uiHttpRequest(req, res)) return;

      const urlRaw = req.url;
      if (!urlRaw) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const url = new URL(urlRaw, 'http://localhost');
      if (url.pathname === CANVAS_WS_PATH) {
        res.statusCode = liveReload ? 426 : 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(liveReload ? 'upgrade required' : 'not found');
        return;
      }

      let urlPath = url.pathname;
      if (basePath !== '/') {
        if (urlPath === basePath) {
          urlPath = '/';
        } else if (urlPath.startsWith(`${basePath}/`)) {
          urlPath = urlPath.slice(basePath.length) || '/';
        } else {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Not Found');
          return;
        }
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Method Not Allowed');
        return;
      }

      const filePath = await resolveFilePath(rootReal, urlPath);
      if (!filePath) {
        if (urlPath === '/' || urlPath.endsWith('/')) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            `<!doctype html><meta charset="utf-8" /><title>Open Deskmate Canvas</title><pre>Missing file.\nCreate ${rootDir}/index.html</pre>`
          );
          return;
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('not found');
        return;
      }

      const mime = detectMime(filePath);
      res.setHeader('Cache-Control', 'no-store');
      if (mime === 'text/html') {
        const html = await fs.readFile(filePath, 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(liveReload ? injectCanvasLiveReload(html) : html);
        return;
      }

      res.setHeader('Content-Type', mime);
      res.end(await fs.readFile(filePath));
    })().catch((err) => {
      console.error('[Canvas Host] Request failed:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('error');
    });
  });

  server.on('upgrade', (req, socket, head) => {
    if (!wss) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== CANVAS_WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : 0;

  console.log(`[Canvas Host] Listening on http://127.0.0.1:${boundPort}${CANVAS_HOST_PATH}/`);

  return {
    server,
    port: boundPort,
    rootDir: rootReal,
    liveReload,
    close: async () => {
      if (debounce) clearTimeout(debounce);
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // ignore
        }
      }
      if (wss) {
        await new Promise<void>((resolve) => wss.close(() => resolve()));
      }
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

export async function startCanvasHost(): Promise<CanvasHostStatus> {
  if (canvasHost) {
    return getCanvasHostStatus()!;
  }

  const rootDir = path.join(os.homedir(), 'OpenDeskmate', 'canvas');
  const liveReload = true;

  try {
    canvasHost = await createCanvasServer(rootDir, DEFAULT_CANVAS_PORT, liveReload);
  } catch (err) {
    console.warn('[Canvas Host] Default port unavailable, falling back to random port.', err);
    canvasHost = await createCanvasServer(rootDir, 0, liveReload);
  }

  return getCanvasHostStatus()!;
}

export async function stopCanvasHost(): Promise<void> {
  if (!canvasHost) return;
  const host = canvasHost;
  canvasHost = null;
  await host.close();
}

export function getCanvasHostStatus(): CanvasHostStatus | null {
  if (!canvasHost) return null;
  const baseUrl = `http://127.0.0.1:${canvasHost.port}${CANVAS_HOST_PATH}/`;
  const a2uiUrl = `http://127.0.0.1:${canvasHost.port}${A2UI_PATH}/`;
  return {
    port: canvasHost.port,
    rootDir: canvasHost.rootDir,
    baseUrl,
    a2uiUrl,
    liveReload: canvasHost.liveReload,
  };
}
