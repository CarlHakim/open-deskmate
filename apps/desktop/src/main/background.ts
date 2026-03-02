import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let runInBackground = false;
let isQuitting = false;

function getTrayIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(process.env.APP_ROOT || app.getAppPath(), 'resources', 'icon.png');
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Deskmate',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: runInBackground ? 'Running in background' : 'Background mode disabled',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function ensureTray(): void {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
    return;
  }
  const iconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  const trayIcon = icon.isEmpty() ? iconPath : icon;
  tray = new Tray(trayIcon);
  tray.setToolTip('Open Deskmate');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showMainWindow());
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

export function initBackground(window: BrowserWindow, initialRunInBackground: boolean): void {
  mainWindow = window;
  runInBackground = initialRunInBackground;

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (!runInBackground) return;
    event.preventDefault();
    mainWindow?.hide();
    ensureTray();
  });

  if (runInBackground) {
    ensureTray();
  }
}

export function setRunInBackground(enabled: boolean): void {
  runInBackground = enabled;
  if (runInBackground) {
    ensureTray();
  } else {
    destroyTray();
  }
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

export function setQuitting(flag: boolean): void {
  isQuitting = flag;
}

export function getRunInBackgroundState(): boolean {
  return runInBackground;
}
