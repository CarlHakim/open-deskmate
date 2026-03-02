import { BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCanvasHostStatus } from './canvas-host';

let canvasWindow: BrowserWindow | null = null;

function getDefaultCanvasUrl(): string {
  const status = getCanvasHostStatus();
  return status?.baseUrl || 'about:blank';
}

function getWindowBounds(params?: { x?: number; y?: number; width?: number; height?: number }) {
  const width = typeof params?.width === 'number' && params.width > 0 ? params.width : 900;
  const height = typeof params?.height === 'number' && params.height > 0 ? params.height : 700;
  const bounds: { width: number; height: number; x?: number; y?: number } = { width, height };
  if (typeof params?.x === 'number') bounds.x = params.x;
  if (typeof params?.y === 'number') bounds.y = params.y;
  return bounds;
}

function createCanvasWindow(): BrowserWindow {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const iconPath = path.join(process.env.APP_ROOT || path.join(__dirname, '../../..'), 'resources', 'icon.png');

  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 360,
    title: 'Open Deskmate Canvas',
    backgroundColor: '#0b1221',
    autoHideMenuBar: true,
    show: false,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on('closed', () => {
    if (canvasWindow === window) {
      canvasWindow = null;
    }
  });

  return window;
}

async function ensureCanvasLoaded(window: BrowserWindow) {
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      const handler = () => {
        window.webContents.removeListener('did-finish-load', handler);
        resolve();
      };
      window.webContents.on('did-finish-load', handler);
    });
  }
}

export async function presentCanvas(params?: {
  url?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  if (!canvasWindow || canvasWindow.isDestroyed()) {
    canvasWindow = createCanvasWindow();
  }

  const bounds = getWindowBounds(params);
  canvasWindow.setBounds(bounds);
  const target = params?.url || getDefaultCanvasUrl();
  if (target) {
    await canvasWindow.loadURL(target);
  }
  canvasWindow.show();
  canvasWindow.focus();
}

export async function hideCanvas(): Promise<void> {
  if (canvasWindow && !canvasWindow.isDestroyed()) {
    canvasWindow.hide();
  }
}

export async function navigateCanvas(url: string): Promise<void> {
  if (!canvasWindow || canvasWindow.isDestroyed()) {
    canvasWindow = createCanvasWindow();
  }
  await canvasWindow.loadURL(url);
  canvasWindow.show();
  canvasWindow.focus();
}

export async function evalCanvas(javaScript: string): Promise<string> {
  if (!canvasWindow || canvasWindow.isDestroyed()) {
    throw new Error('Canvas is not open');
  }
  await ensureCanvasLoaded(canvasWindow);
  const result = await canvasWindow.webContents.executeJavaScript(javaScript, true);
  if (typeof result === 'string') return result;
  return JSON.stringify(result);
}

export async function snapshotCanvas(opts?: { format?: 'png' | 'jpeg'; quality?: number; maxWidth?: number }) {
  if (!canvasWindow || canvasWindow.isDestroyed()) {
    throw new Error('Canvas is not open');
  }
  await ensureCanvasLoaded(canvasWindow);
  const image = await canvasWindow.webContents.capturePage();
  let processed = image;
  if (opts?.maxWidth && opts.maxWidth > 0 && image.getSize().width > opts.maxWidth) {
    processed = image.resize({ width: opts.maxWidth });
  }

  if (opts?.format === 'jpeg') {
    const quality = typeof opts.quality === 'number' ? Math.max(10, Math.min(100, opts.quality)) : 80;
    const jpegBuffer = processed.toJPEG(quality);
    return {
      format: 'jpeg' as const,
      base64: jpegBuffer.toString('base64'),
    };
  }

  const pngBuffer = processed.toPNG();
  return {
    format: 'png' as const,
    base64: pngBuffer.toString('base64'),
  };
}

export function getCanvasWindowUrl(): string | null {
  if (!canvasWindow || canvasWindow.isDestroyed()) return null;
  return canvasWindow.webContents.getURL();
}
