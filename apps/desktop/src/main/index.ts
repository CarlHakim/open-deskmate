import { config } from 'dotenv';
import { app, BrowserWindow, shell, ipcMain, nativeImage, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { MenuItemConstructorOptions } from 'electron';
import { registerIPCHandlers } from './ipc/handlers';
import { flushPendingTasks, getTask } from './store/taskHistory';
import { reconcileStaleTasksOnStartup } from './store/taskHistory';
import { getBuildTaskSession } from './store/buildTaskHistory';
import { getSubagentRun } from './store/subagentRegistry';
import { getUsageProject, listUsageProjectWorkItems } from './store/usageProjects';
import { disposeTaskManager } from './opencode/task-manager';
import { checkAndCleanupFreshInstall } from './store/freshInstallCleanup';
import { cleanupLegacyConnectorConfigStores } from './store/legacyConnectorConfigCleanup';
import { getLaunchAtLogin, getRunInBackground } from './store/appSettings';
import { initBackground, setQuitting } from './background';
import { initScheduler } from './services/scheduler';
import { startWebhookServer } from './services/webhook-server';
import { startGatewayConnectorRuntimes, stopGatewayConnectorRuntimes } from './services/gateway-connector-runtimes';
import { startConnectorBridgeRuntime, stopConnectorBridgeRuntime } from './services/connector-bridge-runtime';
import { startCanvasHost, stopCanvasHost } from './services/canvas-host';
import { startCanvasApiServer, stopCanvasApiServer } from './canvas-api';
import { startNodeToolsApiServer } from './node-tools-api';
import { startBuildRuntimeToolsApiServer } from './build-runtime-tools-api';
import { startToolDiscoveryApiServer } from './tool-discovery-api';
import { startVoiceWakeService, stopVoiceWakeService } from './services/voice-wake';
import { applyVoiceWakeAutoStart } from './store/voiceWake';
import { disposeUserSkillsWatcher, ensureUserSkillsWatcher } from './services/user-skills';
import { startAgentHeartbeatService, stopAgentHeartbeatService } from './services/agent-heartbeat';
import { startAlwaysOnRuntimeManager, stopAlwaysOnRuntimeManager } from './services/always-on-status';
import { maybeHandleAppConnectorOAuthProtocolUrl } from './services/app-connector-oauth';
import { startAppConnectorOAuthRefreshService, stopAppConnectorOAuthRefreshService } from './services/app-connector-runtimes';
import { buildDevProcessManager } from './services/build-mode/dev-process-manager';
import { buildTerminalManager } from './services/build-mode/terminal-manager';
import { disposeAllSubagentSessions } from './services/subagents/subagent-control';
import { recordPluginRegistrationDiagnostics } from './plugins/plugin-diagnostics-store';
import {
  initializeHelpDocs,
  listHelpDocs,
  onHelpDocsChanged,
  openHelpDocsFolder,
  startHelpDocsWatcher,
  stopHelpDocsWatcher,
} from './services/help-docs';

// Local UI - no longer uses remote URL

// Early E2E flag detection - check command-line args before anything else
// This must run synchronously at module load time
if (process.argv.includes('--e2e-skip-auth')) {
  (global as Record<string, unknown>).E2E_SKIP_AUTH = true;
}
if (process.argv.includes('--e2e-mock-tasks') || process.env.E2E_MOCK_TASK_EVENTS === '1') {
  (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS = true;
}

// Clean mode - wipe all stored data for a fresh start
// Use CLEAN_START env var since CLI args don't pass through vite to Electron
if (process.env.CLEAN_START === '1') {
  const userDataPath = app.getPath('userData');
  console.log('[Clean Mode] Clearing userData directory:', userDataPath);
  try {
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      console.log('[Clean Mode] Successfully cleared userData');
    }
  } catch (err) {
    console.error('[Clean Mode] Failed to clear userData:', err);
  }
  // Note: Secure storage (API keys, auth tokens) is stored in electron-store
  // which lives in userData, so it gets cleared with the directory above
}

// Set app name before anything else (affects deep link dialogs)
app.name = 'Open Deskmate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file from app root
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../../.env');
config({ path: envPath });

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.js    > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let webhookServer: ReturnType<typeof startWebhookServer> | null = null;
let canvasApiServer: ReturnType<typeof startCanvasApiServer> | null = null;
let nodeToolsApiServer: ReturnType<typeof startNodeToolsApiServer> | null = null;
let buildRuntimeToolsApiServer: ReturnType<typeof startBuildRuntimeToolsApiServer> | null = null;
let toolDiscoveryApiServer: ReturnType<typeof startToolDiscoveryApiServer> | null = null;
let unsubscribeHelpDocs: (() => void) | null = null;
let pendingHelpNavigation: { docId?: string; query?: string } | null = null;
let shutdownInProgress = false;
let parentWatchdogTimer: NodeJS.Timeout | null = null;
let unsubscribeBuildTerminalEntry: (() => void) | null = null;
let taskWindowIpcRegistered = false;

type TaskWindowKind = 'chat-task' | 'build-task' | 'subagent-run' | 'workboard-item';

type TaskWindowTarget =
  | { kind: 'chat-task'; taskId: string; agentId?: string; title?: string }
  | { kind: 'build-task'; sessionId: string; agentId?: string; taskId?: string; title?: string }
  | { kind: 'subagent-run'; runId: string; title?: string }
  | { kind: 'workboard-item'; projectId: string; itemId: string; title?: string };

type TaskWindowInfo = {
  key: string;
  windowId: number;
  kind: TaskWindowKind;
  title: string;
  route: string;
  target: TaskWindowTarget;
  focused: boolean;
};

type TaskWindowRecord = TaskWindowInfo & {
  window: BrowserWindow;
};

const taskWindows = new Map<string, TaskWindowRecord>();

const SHUTDOWN_TIMEOUT_MS = 8000;
const SHUTDOWN_STEP_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function closeNodeServer(server: { close: (cb?: (err?: Error) => void) => void } | null, label: string): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch (error) {
      console.warn(`[Main] ${label} close threw:`, error);
      resolve();
    }
  });
}

async function runShutdownCleanup(): Promise<void> {
  setQuitting(true);
  stopDevParentWatchdog();
  if (unsubscribeBuildTerminalEntry) {
    unsubscribeBuildTerminalEntry();
    unsubscribeBuildTerminalEntry = null;
  }

  const webhook = webhookServer;
  webhookServer = null;
  const nodeTools = nodeToolsApiServer;
  nodeToolsApiServer = null;
  const buildRuntimeTools = buildRuntimeToolsApiServer;
  buildRuntimeToolsApiServer = null;
  const toolDiscovery = toolDiscoveryApiServer;
  toolDiscoveryApiServer = null;
  const hadCanvasApi = Boolean(canvasApiServer);
  canvasApiServer = null;

  stopAgentHeartbeatService();
  stopAppConnectorOAuthRefreshService();
  stopHelpDocsWatcher();
  if (unsubscribeHelpDocs) {
    unsubscribeHelpDocs();
    unsubscribeHelpDocs = null;
  }
  disposeUserSkillsWatcher();
  flushPendingTasks();
  disposeTaskManager();

  const cleanupTasks: Array<Promise<unknown>> = [
    withTimeout(closeNodeServer(webhook, 'Webhook server'), SHUTDOWN_STEP_TIMEOUT_MS, 'Webhook server close'),
    withTimeout(closeNodeServer(nodeTools, 'Node Tools API server'), SHUTDOWN_STEP_TIMEOUT_MS, 'Node Tools API server close'),
    withTimeout(closeNodeServer(buildRuntimeTools, 'Build Runtime Tools API server'), SHUTDOWN_STEP_TIMEOUT_MS, 'Build Runtime Tools API server close'),
    withTimeout(closeNodeServer(toolDiscovery, 'Tool Discovery API server'), SHUTDOWN_STEP_TIMEOUT_MS, 'Tool Discovery API server close'),
    withTimeout(hadCanvasApi ? stopCanvasApiServer() : Promise.resolve(), SHUTDOWN_STEP_TIMEOUT_MS, 'Canvas API stop'),
    withTimeout(stopCanvasHost(), SHUTDOWN_STEP_TIMEOUT_MS, 'Canvas host stop'),
    withTimeout(stopAlwaysOnRuntimeManager(), SHUTDOWN_STEP_TIMEOUT_MS, 'Always-on runtime manager stop'),
    withTimeout(stopGatewayConnectorRuntimes(), SHUTDOWN_STEP_TIMEOUT_MS, 'Gateway connector runtimes stop'),
    withTimeout(stopConnectorBridgeRuntime(), SHUTDOWN_STEP_TIMEOUT_MS, 'Connector bridge stop'),
    withTimeout(stopVoiceWakeService(), SHUTDOWN_STEP_TIMEOUT_MS, 'Voice wake stop'),
    withTimeout(disposeAllSubagentSessions(), SHUTDOWN_STEP_TIMEOUT_MS, 'Subagent dispose'),
    withTimeout(buildDevProcessManager.disposeAll(), SHUTDOWN_STEP_TIMEOUT_MS, 'Build runtime dispose'),
    Promise.resolve(buildTerminalManager.disposeAll()),
  ];

  const results = await Promise.allSettled(cleanupTasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[Main] Shutdown cleanup warning:', result.reason);
    }
  }
}

function triggerSignalShutdown(signal: NodeJS.Signals | 'disconnect'): void {
  console.log(`[Main] Received ${signal}; starting shutdown.`);
  if (shutdownInProgress) {
    app.exit(0);
    return;
  }
  shutdownInProgress = true;
  void withTimeout(runShutdownCleanup(), SHUTDOWN_TIMEOUT_MS, `Signal shutdown (${signal})`)
    .catch((error) => {
      console.warn(`[Main] ${signal} shutdown cleanup failed/timed out; forcing exit.`, error);
    })
    .finally(() => {
      setQuitting(true);
      app.exit(0);
    });
}

process.on('SIGINT', () => triggerSignalShutdown('SIGINT'));
process.on('SIGTERM', () => triggerSignalShutdown('SIGTERM'));
process.on('SIGBREAK', () => triggerSignalShutdown('SIGBREAK'));
process.on('disconnect', () => triggerSignalShutdown('disconnect'));

function startDevParentWatchdog(): void {
  if (app.isPackaged) return;
  if (parentWatchdogTimer) return;
  const parentPid = process.ppid;
  if (!Number.isFinite(parentPid) || parentPid <= 1) return;

  parentWatchdogTimer = setInterval(() => {
    if (shutdownInProgress) return;
    try {
      process.kill(parentPid, 0);
    } catch {
      console.warn('[Main] Parent dev process exited; shutting down Electron.');
      triggerSignalShutdown('disconnect');
    }
  }, 1500);
  parentWatchdogTimer.unref?.();
}

function stopDevParentWatchdog(): void {
  if (!parentWatchdogTimer) return;
  clearInterval(parentWatchdogTimer);
  parentWatchdogTimer = null;
}

function findProtocolUrlInArgv(argv: string[]): string | null {
  for (const entry of argv) {
    if (typeof entry === 'string' && entry.startsWith('accomplish://')) {
      return entry;
    }
  }
  return null;
}

async function handleProtocolUrl(url: string): Promise<void> {
  if (!url.startsWith('accomplish://callback')) return;
  await maybeHandleAppConnectorOAuthProtocolUrl(url);
  mainWindow?.webContents?.send('auth:callback', url);
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

function sendHelpNavigation(payload: { docId?: string; query?: string }): void {
  pendingHelpNavigation = payload;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoadingMainFrame()) return;
  mainWindow.webContents.send('help:navigate', payload);
  pendingHelpNavigation = null;
}

function flushPendingHelpNavigation(): void {
  if (!pendingHelpNavigation) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = pendingHelpNavigation;
  pendingHelpNavigation = null;
  mainWindow.webContents.send('help:navigate', payload);
}

function broadcastHelpDocsUpdated(event: { changedAt: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('help-docs:updated', event);
    }
  }
}

function broadcastToAppWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function sanitizeTaskWindowText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text.slice(0, 256);
}

function taskWindowQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const result = query.toString();
  return result ? `?${result}` : '';
}

function normalizeTaskWindowTarget(input: unknown): TaskWindowTarget {
  if (!input || typeof input !== 'object') {
    throw new Error('Task window target is required.');
  }
  const payload = input as Record<string, unknown>;
  const kind = sanitizeTaskWindowText(payload.kind, 'kind') as TaskWindowKind;
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim().slice(0, 160)
    : undefined;

  if (kind === 'chat-task') {
    return {
      kind,
      taskId: sanitizeTaskWindowText(payload.taskId, 'taskId'),
      agentId: typeof payload.agentId === 'string' && payload.agentId.trim() ? payload.agentId.trim().slice(0, 128) : undefined,
      title,
    };
  }

  if (kind === 'build-task') {
    return {
      kind,
      sessionId: sanitizeTaskWindowText(payload.sessionId, 'sessionId'),
      agentId: typeof payload.agentId === 'string' && payload.agentId.trim() ? payload.agentId.trim().slice(0, 128) : undefined,
      taskId: typeof payload.taskId === 'string' && payload.taskId.trim() ? payload.taskId.trim().slice(0, 128) : undefined,
      title,
    };
  }

  if (kind === 'subagent-run') {
    return {
      kind,
      runId: sanitizeTaskWindowText(payload.runId, 'runId'),
      title,
    };
  }

  if (kind === 'workboard-item') {
    return {
      kind,
      projectId: sanitizeTaskWindowText(payload.projectId, 'projectId'),
      itemId: sanitizeTaskWindowText(payload.itemId, 'itemId'),
      title,
    };
  }

  throw new Error('Unsupported task window kind.');
}

function getTaskWindowKey(target: TaskWindowTarget): string {
  if (target.kind === 'chat-task') {
    return `${target.kind}:${target.agentId || 'any'}:${target.taskId}`;
  }
  if (target.kind === 'build-task') {
    return `${target.kind}:${target.agentId || 'any'}:${target.sessionId}`;
  }
  if (target.kind === 'subagent-run') {
    return `${target.kind}:${target.runId}`;
  }
  return `${target.kind}:${target.projectId}:${target.itemId}`;
}

function resolveTaskWindowRoute(target: TaskWindowTarget): { route: string; title: string; target: TaskWindowTarget } {
  if (target.kind === 'chat-task') {
    const task = getTask(target.taskId, target.agentId) ?? getTask(target.taskId);
    if (!task) {
      throw new Error('Task not found.');
    }
    const title = target.title || task.summary || task.prompt || 'Chat task';
    return {
      title: `Chat: ${title}`.slice(0, 180),
      route: `/execution/${encodeURIComponent(target.taskId)}${taskWindowQuery({ taskWindow: '1', agentId: target.agentId || task.agentId })}`,
      target: {
        ...target,
        agentId: target.agentId || task.agentId,
      },
    };
  }

  if (target.kind === 'build-task') {
    const session = getBuildTaskSession(target.sessionId);
    if (!session) {
      throw new Error('Build task session not found.');
    }
    const title = target.title || session.title || session.titleSourcePrompt || 'Build task';
    return {
      title: `Build: ${title}`.slice(0, 180),
      route: `/build${taskWindowQuery({
        taskWindow: '1',
        sessionId: session.id,
        agentId: target.agentId || session.agentId,
        taskId: target.taskId,
      })}`,
      target: {
        ...target,
        agentId: target.agentId || session.agentId,
      },
    };
  }

  if (target.kind === 'subagent-run') {
    const run = getSubagentRun(target.runId);
    if (!run) {
      throw new Error('Subagent run not found.');
    }
    const title = target.title || run.label || run.task || run.childTaskId;
    return {
      title: `Subagent: ${title}`.slice(0, 180),
      route: `/subagents${taskWindowQuery({ taskWindow: '1', runId: run.runId, archived: '1' })}`,
      target,
    };
  }

  const project = getUsageProject(target.projectId);
  if (!project) {
    throw new Error('Usage project not found.');
  }
  const item = listUsageProjectWorkItems(project.id, { includeArchived: true }).find((entry) => entry.id === target.itemId);
  if (!item) {
    throw new Error('Workboard item not found.');
  }
  const title = target.title || item.title || 'Workboard item';
  return {
    title: `Workboard: ${title}`.slice(0, 180),
    route: `/workboard/${encodeURIComponent(project.id)}/${encodeURIComponent(item.id)}${taskWindowQuery({ taskWindow: '1' })}`,
    target,
  };
}

function getAppIcon(): ReturnType<typeof nativeImage.createFromPath> | undefined {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(process.env.APP_ROOT!, 'resources', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

function loadRendererRoute(window: BrowserWindow, route: string): void {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  if (VITE_DEV_SERVER_URL) {
    const baseUrl = VITE_DEV_SERVER_URL.endsWith('/') ? VITE_DEV_SERVER_URL : `${VITE_DEV_SERVER_URL}/`;
    window.loadURL(`${baseUrl}#${normalizedRoute}`);
    return;
  }

  window.loadFile(path.join(RENDERER_DIST, 'index.html'), {
    hash: normalizedRoute,
  });
}

function focusBrowserWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
}

function toTaskWindowInfo(record: TaskWindowRecord): TaskWindowInfo {
  return {
    key: record.key,
    windowId: record.window.id,
    kind: record.kind,
    title: record.title,
    route: record.route,
    target: record.target,
    focused: record.window.isFocused(),
  };
}

function pruneTaskWindowRecords(): void {
  for (const [key, record] of taskWindows.entries()) {
    if (record.window.isDestroyed()) {
      taskWindows.delete(key);
    }
  }
}

function createTaskWindow(target: TaskWindowTarget): TaskWindowInfo {
  pruneTaskWindowRecords();
  const resolved = resolveTaskWindowRoute(target);
  const key = getTaskWindowKey(resolved.target);
  const existing = taskWindows.get(key);
  if (existing && !existing.window.isDestroyed()) {
    focusBrowserWindow(existing.window);
    return toTaskWindowInfo(existing);
  }

  const preloadPath = getPreloadPath();
  const taskWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: resolved.title,
    icon: getAppIcon(),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  taskWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const record: TaskWindowRecord = {
    key,
    windowId: taskWindow.id,
    kind: resolved.target.kind,
    title: resolved.title,
    route: resolved.route,
    target: resolved.target,
    focused: false,
    window: taskWindow,
  };
  taskWindows.set(key, record);
  taskWindow.on('closed', () => {
    taskWindows.delete(key);
  });
  loadRendererRoute(taskWindow, resolved.route);
  taskWindow.once('ready-to-show', () => {
    if (!taskWindow.isDestroyed()) {
      taskWindow.show();
    }
  });
  focusBrowserWindow(taskWindow);
  return toTaskWindowInfo(record);
}

function listTaskWindows(): TaskWindowInfo[] {
  pruneTaskWindowRecords();
  return Array.from(taskWindows.values()).map(toTaskWindowInfo);
}

function focusTaskWindow(payload: unknown): TaskWindowInfo | null {
  pruneTaskWindowRecords();
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const windowId = typeof input.windowId === 'number' && Number.isFinite(input.windowId)
    ? input.windowId
    : undefined;
  const key = typeof input.key === 'string' && input.key.trim() ? input.key.trim() : undefined;
  let record = key ? taskWindows.get(key) : undefined;
  if (!record && windowId !== undefined) {
    record = Array.from(taskWindows.values()).find((entry) => entry.window.id === windowId);
  }
  if (!record && input.kind) {
    const target = normalizeTaskWindowTarget(input);
    record = taskWindows.get(getTaskWindowKey(target));
    if (!record) {
      try {
        const resolved = resolveTaskWindowRoute(target);
        record = taskWindows.get(getTaskWindowKey(resolved.target));
      } catch {
        record = undefined;
      }
    }
  }
  if (!record || record.window.isDestroyed()) {
    return null;
  }
  focusBrowserWindow(record.window);
  return toTaskWindowInfo(record);
}

function registerTaskWindowIpcHandlers(): void {
  if (taskWindowIpcRegistered) return;
  taskWindowIpcRegistered = true;
  ipcMain.handle('task-window:open', (_event, payload) => {
    const target = normalizeTaskWindowTarget(payload);
    return createTaskWindow(target);
  });
  ipcMain.handle('task-window:list', () => listTaskWindows());
  ipcMain.handle('task-window:focus', (_event, payload) => focusTaskWindow(payload));
}

function buildHelpMenuItems(docs: Awaited<ReturnType<typeof listHelpDocs>>['docs']): MenuItemConstructorOptions[] {
  const openDoc = (docId?: string) => {
    focusMainWindow();
    sendHelpNavigation(docId ? { docId } : {});
  };

  const docItems: MenuItemConstructorOptions[] = docs.length > 0
    ? docs.map((doc) => ({
      label: doc.title,
      click: () => openDoc(doc.id),
    }))
    : [{
      label: 'No help pages found',
      enabled: false,
    }];

  return [
    {
      label: 'Help Viewer',
      click: () => openDoc(),
    },
    {
      label: 'Search Help',
      click: () => {
        focusMainWindow();
        sendHelpNavigation({ query: '' });
      },
    },
    { type: 'separator' },
    ...docItems,
    { type: 'separator' },
    {
      label: 'Open Help Folder',
      click: () => {
        void openHelpDocsFolder();
      },
    },
  ];
}

async function rebuildApplicationMenu(): Promise<void> {
  let docs: Awaited<ReturnType<typeof listHelpDocs>>['docs'] = [];
  try {
    docs = (await listHelpDocs()).docs;
  } catch (error) {
    console.warn('[HelpDocs] Failed to load docs for menu:', error);
  }

  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' as const },
          { type: 'separator' as const },
          { role: 'services' as const },
          { type: 'separator' as const },
          { role: 'hide' as const },
          { role: 'hideOthers' as const },
          { role: 'unhide' as const },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ],
      }]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const },
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const },
        ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' as const }, { role: 'zoom' as const }, { type: 'separator' as const }, { role: 'front' as const }]
        : [{ role: 'minimize' as const }, { role: 'close' as const }],
    },
    {
      role: 'help',
      submenu: buildHelpMenuItems(docs),
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Get the preload script path
function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.cjs');
}

function createWindow() {
  console.log('[Main] Creating main application window');

  // Get app icon
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(process.env.APP_ROOT!, 'resources', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  const preloadPath = getPreloadPath();
  console.log('[Main] Using preload script:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Open Deskmate',
    icon: icon.isEmpty() ? undefined : icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const currentWindow = mainWindow;
    if (!currentWindow || currentWindow.isDestroyed()) return;

    const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length > 0);
    const isEditable = Boolean(params.isEditable);
    if (!hasSelection && !isEditable) return;

    const template: MenuItemConstructorOptions[] = [];

    if (isEditable) {
      if (params.misspelledWord) {
        const suggestions = params.dictionarySuggestions?.slice(0, 8) ?? [];
        if (suggestions.length > 0) {
          suggestions.forEach((suggestion) => {
            template.push({
              label: suggestion,
              click: () => {
                if (!currentWindow.isDestroyed()) {
                  currentWindow.webContents.replaceMisspelling(suggestion);
                }
              },
            });
          });
        } else {
          template.push({ label: 'No spelling suggestions', enabled: false });
        }

        template.push({
          label: `Add "${params.misspelledWord}" to dictionary`,
          click: () => {
            if (!currentWindow.isDestroyed()) {
              currentWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
            }
          },
        });
        template.push({ type: 'separator' as const });
      }

      template.push(
        { role: 'undo' as const, enabled: params.editFlags.canUndo },
        { role: 'redo' as const, enabled: params.editFlags.canRedo },
        { type: 'separator' as const },
        { role: 'cut' as const, enabled: params.editFlags.canCut },
        { role: 'copy' as const, enabled: params.editFlags.canCopy || hasSelection },
        { role: 'paste' as const, enabled: params.editFlags.canPaste },
        { role: 'delete' as const, enabled: params.editFlags.canDelete },
      );
      if (process.platform === 'darwin') {
        template.push({ role: 'pasteAndMatchStyle' as const, enabled: params.editFlags.canPaste });
      }
      template.push({ type: 'separator' as const });
    } else if (hasSelection) {
      template.push({ role: 'copy' as const, enabled: true });
      template.push({ type: 'separator' as const });
    }

    template.push({ role: 'selectAll' as const });

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: currentWindow });
  });

  // Maximize window by default
  mainWindow.maximize();

  // Open DevTools in dev mode (non-packaged), but not during E2E tests
  const isE2EMode = (global as Record<string, unknown>).E2E_SKIP_AUTH === true;
  if (!app.isPackaged && !isE2EMode) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  // Load the local UI
  if (VITE_DEV_SERVER_URL) {
    console.log('[Main] Loading from Vite dev server:', VITE_DEV_SERVER_URL);
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(RENDERER_DIST, 'index.html');
    console.log('[Main] Loading from file:', indexPath);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    flushPendingHelpNavigation();
  });
}

function applyLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Second instance attempted; quitting');
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const protocolUrl = findProtocolUrlInArgv(argv);
    if (protocolUrl) {
      void handleProtocolUrl(protocolUrl);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      console.log('[Main] Focused existing instance after second-instance event');
    }
  });

  app.whenReady().then(async () => {
    console.log('[Main] Electron app ready, version:', app.getVersion());
    startDevParentWatchdog();

    // Check for fresh install and cleanup old data BEFORE initializing stores
    // This ensures users get a clean slate after reinstalling from DMG
    try {
      const didCleanup = await checkAndCleanupFreshInstall();
      if (didCleanup) {
        console.log('[Main] Cleaned up data from previous installation');
      }
    } catch (err) {
      console.error('[Main] Fresh install cleanup failed:', err);
    }
    cleanupLegacyConnectorConfigStores();

    // Set dock icon on macOS
    if (process.platform === 'darwin' && app.dock) {
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(process.env.APP_ROOT!, 'resources', 'icon.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    }

    // Register IPC handlers before creating window
    registerIPCHandlers();
    registerTaskWindowIpcHandlers();
    console.log('[Main] IPC handlers registered');
    unsubscribeBuildTerminalEntry = buildTerminalManager.onEntry((payload) => {
      broadcastToAppWindows('build-mode:terminal:entry', payload);
    });

    await initializeHelpDocs();
    recordPluginRegistrationDiagnostics('startup');
    startHelpDocsWatcher();
    unsubscribeHelpDocs = onHelpDocsChanged((event) => {
      broadcastHelpDocsUpdated(event);
      void rebuildApplicationMenu();
    });

    // Reconcile any stale running/queued tasks from a previous session (crash/force-close).
    try {
      const reconciled = reconcileStaleTasksOnStartup();
      if (reconciled.interrupted || reconciled.cancelled) {
        console.log('[Main] Reconciled stale tasks on startup:', reconciled);
      }
    } catch (err) {
      console.warn('[Main] Failed to reconcile stale tasks on startup:', err);
    }

    try {
      const cleanedRuntimeCount = await withTimeout(
        buildDevProcessManager.cleanupPersistedRuntimeProcessesOnStartup(),
        SHUTDOWN_STEP_TIMEOUT_MS,
        'Build runtime stale-process cleanup'
      );
      if (cleanedRuntimeCount > 0) {
        console.log(`[Main] Cleaned up ${cleanedRuntimeCount} stale build runtime process(es) from previous session.`);
      }
    } catch (err) {
      console.warn('[Main] Failed to clean stale build runtime processes on startup:', err);
    }

    createWindow();
    await rebuildApplicationMenu();
    const startupProtocolUrl = findProtocolUrlInArgv(process.argv);
    if (startupProtocolUrl) {
      void handleProtocolUrl(startupProtocolUrl);
    }
    if (mainWindow) {
      initBackground(mainWindow, getRunInBackground());
    }
    applyLaunchAtLogin(getLaunchAtLogin());
    initScheduler();
    // Start skills watcher early so skill edits are picked up across sessions.
    ensureUserSkillsWatcher({});
    nodeToolsApiServer = startNodeToolsApiServer();
    buildRuntimeToolsApiServer = startBuildRuntimeToolsApiServer();
    toolDiscoveryApiServer = startToolDiscoveryApiServer();
    webhookServer = startWebhookServer();
    startConnectorBridgeRuntime();
    try {
      await startCanvasHost();
    } catch (err) {
      console.warn('[Canvas Host] Failed to start:', err);
    }
    canvasApiServer = startCanvasApiServer();
    void startGatewayConnectorRuntimes();
    applyVoiceWakeAutoStart();
    void startVoiceWakeService();
    startAgentHeartbeatService();
    startAppConnectorOAuthRefreshService();
    void startAlwaysOnRuntimeManager().catch((err) => {
      console.warn('[Always-On] Failed to start runtime manager:', err);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        console.log('[Main] Application reactivated; recreated window');
        return;
      }
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    console.log('[Main] All windows closed; quitting app');
    app.quit();
  }
});

// Flush pending task history writes and dispose TaskManager before quitting.
app.on('before-quit', (event) => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  event.preventDefault();
  console.log('[Main] App before-quit event fired');

  void withTimeout(runShutdownCleanup(), SHUTDOWN_TIMEOUT_MS, 'Overall shutdown cleanup')
    .catch((error) => {
      console.warn('[Main] Shutdown cleanup failed/timed out; forcing exit.', error);
    })
    .finally(() => {
      setQuitting(true);
      app.exit(0);
    });
});

// Handle custom protocol (accomplish://)
app.setAsDefaultProtocolClient('accomplish');

app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('[Main] Received protocol URL:', url);
  // Handle protocol URL
  if (url.startsWith('accomplish://callback')) {
    void handleProtocolUrl(url);
  }
});

// IPC Handlers
ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.handle('app:platform', () => {
  return process.platform;
});
