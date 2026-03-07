import { config } from 'dotenv';
import { app, BrowserWindow, shell, ipcMain, nativeImage, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { MenuItemConstructorOptions } from 'electron';
import { registerIPCHandlers } from './ipc/handlers';
import { flushPendingTasks } from './store/taskHistory';
import { reconcileStaleTasksOnStartup } from './store/taskHistory';
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
import { startVoiceWakeService, stopVoiceWakeService } from './services/voice-wake';
import { applyVoiceWakeAutoStart } from './store/voiceWake';
import { disposeUserSkillsWatcher, ensureUserSkillsWatcher } from './services/user-skills';
import { startAgentHeartbeatService, stopAgentHeartbeatService } from './services/agent-heartbeat';
import { maybeHandleAppConnectorOAuthProtocolUrl } from './services/app-connector-oauth';
import { startAppConnectorOAuthRefreshService, stopAppConnectorOAuthRefreshService } from './services/app-connector-runtimes';
import { buildDevProcessManager } from './services/build-mode/dev-process-manager';
import { buildTerminalManager } from './services/build-mode/terminal-manager';
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
let unsubscribeHelpDocs: (() => void) | null = null;
let pendingHelpNavigation: { docId?: string; query?: string } | null = null;
let shutdownInProgress = false;
let parentWatchdogTimer: NodeJS.Timeout | null = null;
let unsubscribeBuildTerminalEntry: (() => void) | null = null;

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
    withTimeout(hadCanvasApi ? stopCanvasApiServer() : Promise.resolve(), SHUTDOWN_STEP_TIMEOUT_MS, 'Canvas API stop'),
    withTimeout(stopCanvasHost(), SHUTDOWN_STEP_TIMEOUT_MS, 'Canvas host stop'),
    withTimeout(stopGatewayConnectorRuntimes(), SHUTDOWN_STEP_TIMEOUT_MS, 'Gateway connector runtimes stop'),
    withTimeout(stopConnectorBridgeRuntime(), SHUTDOWN_STEP_TIMEOUT_MS, 'Connector bridge stop'),
    withTimeout(stopVoiceWakeService(), SHUTDOWN_STEP_TIMEOUT_MS, 'Voice wake stop'),
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
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length > 0);
    const isEditable = Boolean(params.isEditable);
    if (!hasSelection && !isEditable) return;

    const template: MenuItemConstructorOptions[] = [];

    if (isEditable) {
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
    menu.popup({ window: mainWindow ?? undefined });
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
    openAsHidden: true,
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
    console.log('[Main] IPC handlers registered');
    unsubscribeBuildTerminalEntry = buildTerminalManager.onEntry((payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('build-mode:terminal:entry', payload);
    });

    await initializeHelpDocs();
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
