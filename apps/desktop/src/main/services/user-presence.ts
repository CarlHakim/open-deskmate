import { BrowserWindow } from 'electron';

const WEBCHAT_ACTIVE_WINDOW_MS = 60_000;

let lastWebchatActivityAtMs = 0;

export function markWebchatActivity(): void {
  lastWebchatActivityAtMs = Date.now();
}

export function isWebchatActive(nowMs = Date.now()): boolean {
  return (nowMs - lastWebchatActivityAtMs) <= WEBCHAT_ACTIVE_WINDOW_MS;
}

export function isDesktopAppActive(): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && focused.isVisible()) {
    return true;
  }
  return false;
}

export function getUserPresenceState(): {
  desktopActive: boolean;
  webchatActive: boolean;
  active: boolean;
} {
  const desktopActive = isDesktopAppActive();
  const webchatActive = isWebchatActive();
  return {
    desktopActive,
    webchatActive,
    active: desktopActive || webchatActive,
  };
}
