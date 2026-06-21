import fs from 'fs';
import path from 'path';
import { app, BrowserWindow } from 'electron';
import type {
  BuildPageSnapshotElement,
  BuildPageSnapshotResult,
  BuildQualityCheckKind,
  BuildRuntimeLogsResult,
  BuildRuntimeScreenshotResult,
  BuildRuntimeToolError,
  BuildRuntimeToolStatus,
  BuildTerminalEntry,
  BuildUiInteractionAction,
  BuildUiInteractionMatchedElement,
  BuildUiInteractionTestResult,
} from '@accomplish/shared';
import { buildDevProcessManager } from './dev-process-manager';
import { buildTerminalManager } from './terminal-manager';
import { runBuildQualityChecks } from './quality-checks';
import { readBuildGitSummary } from './git-service';
import { listBuildModePresets } from '../../store/buildModePresets';

const FULL_PREVIEW_CAPTURE_MAX_WIDTH = 6000;
const FULL_PREVIEW_CAPTURE_MAX_HEIGHT = 12000;
const TOOL_SCREENSHOT_DIR = 'build-runtime-tool-screenshots';

type ToolResult<T> = T | BuildRuntimeToolError;

interface ToolContext {
  agentId: string;
  workspaceRelativePath: string;
}

interface ConsoleEvent {
  level: string;
  message: string;
}

function normalizeContext(agentId: string, workspaceRelativePath?: string): ToolContext {
  const normalizedAgentId = String(agentId || '').trim().toLowerCase();
  if (!normalizedAgentId) {
    throw new Error('agentId is required.');
  }
  const normalizedWorkspace = String(workspaceRelativePath || '.').trim() || '.';
  return { agentId: normalizedAgentId, workspaceRelativePath: normalizedWorkspace };
}

function normalizeLocalPreviewUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  const isLocalHost = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1'
    || hostname.endsWith('.localhost');

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLocalHost) {
    throw new Error('Build runtime tools can only inspect local runtime preview URLs.');
  }

  return url.toString();
}

function screenshotDirectory(): string {
  const dir = path.join(app.getPath('userData'), TOOL_SCREENSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function screenshotPath(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'preview';
  return path.join(screenshotDirectory(), `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
}

function toToolError(error: unknown, fallback = 'Build runtime tool failed.'): BuildRuntimeToolError {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
    recoverable: true,
  };
}

function getActivePresetStartOptions(agentId: string) {
  const result = listBuildModePresets(agentId);
  const preset = result.activePresetId
    ? result.presets.find((entry) => entry.id === result.activePresetId)
    : undefined;
  if (!preset) return {};
  const activeProfile = preset.activeEnvProfileId
    ? preset.envProfiles.find((entry) => entry.id === preset.activeEnvProfileId)
    : undefined;
  return {
    commandOverride: preset.commands.startCommand,
    startEntries: preset.commands.startEntries,
    envOverrides: activeProfile?.variables,
  };
}

function recommendedNextAction(status: string, previewUrl?: string): string {
  if (status === 'running' && previewUrl) return 'open_preview_capture_snapshot_and_test_controls';
  if (status === 'running') return 'read_logs_and_run_quality_checks';
  if (status === 'starting') return 'wait_then_check_runtime_status_again';
  if (status === 'error') return 'read_runtime_logs_then_restart_or_fix';
  return 'start_runtime';
}

function withConsoleCapture(window: BrowserWindow, events: ConsoleEvent[]): void {
  window.webContents.on('console-message', (_event, level, message) => {
    events.push({ level: String(level), message: String(message || '').slice(0, 1000) });
    if (events.length > 80) events.splice(0, events.length - 80);
  });
}

async function loadPreviewWindow(previewUrl: string, options?: { width?: number; height?: number }): Promise<{
  window: BrowserWindow;
  consoleEvents: ConsoleEvent[];
}> {
  const url = normalizeLocalPreviewUrl(previewUrl);
  const consoleEvents: ConsoleEvent[] = [];
  const previewWindow = new BrowserWindow({
    show: false,
    width: options?.width ?? 1280,
    height: options?.height ?? 800,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  withConsoleCapture(previewWindow, consoleEvents);
  await Promise.race([
    previewWindow.loadURL(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Runtime preview load timed out.')), 15_000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 650));
  return { window: previewWindow, consoleEvents };
}

async function saveVisibleScreenshot(window: BrowserWindow, prefix: string): Promise<{
  filePath: string;
  width: number;
  height: number;
}> {
  const image = await window.webContents.capturePage();
  const size = image.getSize();
  const filePath = screenshotPath(prefix);
  fs.writeFileSync(filePath, image.toPNG());
  return { filePath, width: size.width, height: size.height };
}

async function captureFullPage(previewUrl: string): Promise<BuildRuntimeScreenshotResult> {
  const url = normalizeLocalPreviewUrl(previewUrl);
  let previewWindow: BrowserWindow | null = null;
  try {
    const loaded = await loadPreviewWindow(url);
    previewWindow = loaded.window;
    const dimensions = await previewWindow.webContents.executeJavaScript(`(() => {
      const doc = document.documentElement;
      const body = document.body;
      const width = Math.ceil(Math.max(
        window.innerWidth || 0,
        doc?.clientWidth || 0,
        doc?.scrollWidth || 0,
        doc?.offsetWidth || 0,
        body?.clientWidth || 0,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0
      ));
      const height = Math.ceil(Math.max(
        window.innerHeight || 0,
        doc?.clientHeight || 0,
        doc?.scrollHeight || 0,
        doc?.offsetHeight || 0,
        body?.clientHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      ));
      return { width, height };
    })()`, true) as { width?: number; height?: number };

    const fullWidth = Math.max(1, Math.round(Number(dimensions?.width) || 1280));
    const fullHeight = Math.max(1, Math.round(Number(dimensions?.height) || 800));
    const captureWidth = Math.min(FULL_PREVIEW_CAPTURE_MAX_WIDTH, fullWidth);
    const captureHeight = Math.min(FULL_PREVIEW_CAPTURE_MAX_HEIGHT, fullHeight);
    const clipped = captureWidth < fullWidth || captureHeight < fullHeight;
    previewWindow.setContentSize(captureWidth, captureHeight);
    await previewWindow.webContents.executeJavaScript('window.scrollTo(0, 0); undefined;', true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const image = await previewWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureWidth,
      height: captureHeight,
    });
    const filePath = screenshotPath('full-preview');
    fs.writeFileSync(filePath, image.toPNG());
    return {
      ok: true,
      kind: 'full-page',
      filePath,
      previewUrl: url,
      width: captureWidth,
      height: captureHeight,
      fullWidth,
      fullHeight,
      clipped,
    };
  } finally {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
}

function summarizeConsoleErrors(events: ConsoleEvent[]): string[] {
  return events
    .filter((event) => event.level === '3' || event.level.toLowerCase().includes('error'))
    .map((event) => event.message)
    .filter(Boolean)
    .slice(-30);
}

async function snapshotPage(window: BrowserWindow): Promise<Omit<BuildPageSnapshotResult, 'ok' | 'previewUrl' | 'consoleErrors'>> {
  return await window.webContents.executeJavaScript(`(() => {
    const interactiveSelector = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="menuitem"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const cssEscape = (value) => {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    };
    const pathFor = (el) => {
      if (el.id) return '#' + cssEscape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const elements = Array.from(document.querySelectorAll(interactiveSelector)).slice(0, 160).map((el) => ({
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      text: textOf(el).slice(0, 180) || undefined,
      label: (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 180) || undefined,
      placeholder: (el.getAttribute('placeholder') || '').trim().slice(0, 180) || undefined,
      selector: pathFor(el),
      visible: isVisible(el),
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
    }));
    return {
      title: document.title || '',
      url: location.href,
      elements,
    };
  })()`, true) as {
    title: string;
    url: string;
    elements: BuildPageSnapshotElement[];
  };
}

function safeActionDescription(action: BuildUiInteractionAction): string {
  if (action.type === 'wait') return `wait ${action.ms ?? 500}ms`;
  if (action.type === 'expect_text') return `expect text "${action.text}"`;
  if (action.type === 'press_key') {
    const modifiers = action.modifiers?.length ? `${action.modifiers.join('+')}+` : '';
    return `press ${modifiers}${action.key}`;
  }
  if ('selector' in action && action.selector) return `${action.type} ${action.selector}`;
  if ('role' in action && action.role && 'label' in action && action.label) return `${action.type} ${action.role} "${action.label}"`;
  if ('label' in action && action.label) return `${action.type} label "${action.label}"`;
  if ('text' in action && action.text) return `${action.type} text "${action.text}"`;
  return action.type;
}

function normalizeKeyboardModifiers(modifiers: Extract<BuildUiInteractionAction, { type: 'press_key' }>['modifiers']): Array<'control' | 'meta' | 'shift' | 'alt'> {
  const normalized = new Set<'control' | 'meta' | 'shift' | 'alt'>();
  for (const modifier of modifiers || []) {
    const lower = modifier.toLowerCase();
    if (lower === 'control' || lower === 'ctrl') normalized.add('control');
    if (lower === 'meta' || lower === 'command' || lower === 'cmd') normalized.add('meta');
    if (lower === 'shift') normalized.add('shift');
    if (lower === 'alt') normalized.add('alt');
  }
  return Array.from(normalized);
}

type RunActionResult = {
  ok: boolean;
  detail: string;
  matchedElement?: BuildUiInteractionMatchedElement;
  candidates?: BuildUiInteractionMatchedElement[];
};

async function runKeyboardAction(window: BrowserWindow, action: Extract<BuildUiInteractionAction, { type: 'press_key' }>): Promise<RunActionResult> {
  const key = String(action.key || '').trim();
  if (!key) return { ok: false, detail: 'No key was provided.' };
  const modifiers = normalizeKeyboardModifiers(action.modifiers);
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
  if (key.length === 1 && modifiers.length === 0) {
    window.webContents.sendInputEvent({ type: 'char', keyCode: key });
  }
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  return {
    ok: true,
    detail: `Pressed ${modifiers.length ? `${modifiers.join('+')}+` : ''}${key}.`,
  };
}

async function runAction(window: BrowserWindow, action: BuildUiInteractionAction): Promise<RunActionResult> {
  if (action.type === 'wait') {
    const ms = Math.max(50, Math.min(5000, Math.floor(Number(action.ms) || 500)));
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { ok: true, detail: `Waited ${ms}ms.` };
  }

  if (action.type === 'expect_text') {
    const found = await window.webContents.executeJavaScript(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(action.text.toLowerCase())})`, true);
    return {
      ok: Boolean(found),
      detail: found ? `Found text "${action.text}".` : `Text "${action.text}" was not found.`,
    };
  }

  if (action.type === 'press_key') {
    return runKeyboardAction(window, action);
  }

  const payload = JSON.stringify(action);
  return await window.webContents.executeJavaScript(`(() => {
    const action = ${payload};
    const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const cssEscape = (value) => {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    };
    const pathFor = (el) => {
      if (el.id) return '#' + cssEscape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const implicitRole = (el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input' && type === 'checkbox') return 'checkbox';
      if (tag === 'input' && type === 'radio') return 'radio';
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return 'button';
      if (tag === 'input') return 'textbox';
      return undefined;
    };
    const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const labelOf = (el) => {
      const direct = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      if (direct) return direct;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').replace(/\\s+/g, ' ').trim();
      }
      return '';
    };
    const describe = (el) => ({
      selector: pathFor(el),
      tagName: el.tagName.toLowerCase(),
      role: implicitRole(el),
      text: textOf(el).slice(0, 180) || undefined,
      label: labelOf(el).slice(0, 180) || undefined,
      placeholder: (el.getAttribute('placeholder') || '').trim().slice(0, 180) || undefined,
    });
    const scoreCandidate = (el) => {
      if (!visible(el)) return -1;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return -1;
      const requestedRole = norm(action.role);
      const role = norm(implicitRole(el));
      if (requestedRole && role !== requestedRole) return -1;
      const needle = norm(action.label || action.text);
      if (!needle) return requestedRole ? 80 : -1;
      const fields = [
        labelOf(el),
        textOf(el),
        el.getAttribute('placeholder'),
        el.value
      ].map(norm).filter(Boolean);
      const exactMatches = fields.filter((field) => field === needle).length;
      if (exactMatches > 0) return 120 + exactMatches + (requestedRole ? 10 : 0);
      const forceExactForShortNeedles = needle.length <= 2 && action.exact !== false;
      if (action.exact === true || forceExactForShortNeedles) return -1;
      const containsMatches = fields.filter((field) => field.includes(needle)).length;
      return containsMatches > 0 ? 50 + containsMatches + (requestedRole ? 10 : 0) : -1;
    };
    let el = null;
    let matchedElement = null;
    let candidates = [];
    if (action.selector) {
      el = document.querySelector(action.selector);
      if (!el) return { ok: false, detail: 'Target selector not found.' };
      if (!visible(el)) return { ok: false, detail: 'Target selector matched an element that is not visible.', matchedElement: describe(el) };
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, detail: 'Target selector matched a disabled element.', matchedElement: describe(el) };
      matchedElement = describe(el);
    } else {
      const candidates = Array.from(document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[tabindex]:not([tabindex="-1"])'));
      const scored = candidates
        .map((candidate) => ({ el: candidate, score: scoreCandidate(candidate) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 0) {
        return { ok: false, detail: 'Target element not found.' };
      }
      const bestScore = scored[0].score;
      const best = scored.filter((entry) => entry.score === bestScore);
      const nth = Number.isFinite(action.nth) ? Math.max(0, Math.floor(action.nth)) : undefined;
      if (best.length > 1 && nth === undefined) {
        return {
          ok: false,
          detail: 'Target element is ambiguous. Use a selector, role plus exact label, or nth to choose one candidate.',
          candidates: best.slice(0, 8).map((entry) => describe(entry.el)),
        };
      }
      const selected = nth !== undefined ? scored[nth] : best[0];
      if (!selected) {
        return {
          ok: false,
          detail: 'Target nth value is outside the matched candidate list.',
          candidates: scored.slice(0, 8).map((entry) => describe(entry.el)),
        };
      }
      el = selected.el;
      matchedElement = describe(el);
    }
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (action.type === 'click') {
      el.click();
      return { ok: true, detail: 'Clicked ' + (matchedElement.label || matchedElement.text || matchedElement.role || matchedElement.tagName || 'element') + '.', matchedElement };
    }
    if (action.type === 'type') {
      if (!('value' in el)) return { ok: false, detail: 'Target element is not text-editable.' };
      el.focus();
      el.value = action.value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: 'Typed into ' + (matchedElement.placeholder || matchedElement.label || matchedElement.role || matchedElement.tagName || 'field') + '.', matchedElement };
    }
    return { ok: false, detail: 'Unsupported action.' };
  })()`, true) as RunActionResult;
}

export async function getBuildRuntimeToolStatus(agentId: string, workspaceRelativePath?: string): Promise<ToolResult<BuildRuntimeToolStatus>> {
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    const snapshot = await buildDevProcessManager.getSnapshot(context.agentId, context.workspaceRelativePath);
    return {
      ok: true,
      snapshot,
      previewUrl: snapshot.runtime.previewUrl,
      recommendedNextAction: recommendedNextAction(snapshot.runtime.status, snapshot.runtime.previewUrl),
    };
  } catch (error) {
    return toToolError(error);
  }
}

export async function startBuildRuntimeFromTool(agentId: string, workspaceRelativePath?: string, forceRestart = false): Promise<ToolResult<BuildRuntimeToolStatus>> {
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    const startOptions = getActivePresetStartOptions(context.agentId);
    const snapshot = await buildDevProcessManager.startDevelopmentProcess({
      agentId: context.agentId,
      workspaceRelativePath: context.workspaceRelativePath,
      mode: 'dev',
      forceRestart,
      ...startOptions,
    });
    return {
      ok: true,
      snapshot,
      previewUrl: snapshot.runtime.previewUrl,
      recommendedNextAction: recommendedNextAction(snapshot.runtime.status, snapshot.runtime.previewUrl),
    };
  } catch (error) {
    return toToolError(error);
  }
}

export async function restartBuildRuntimeFromTool(agentId: string): Promise<ToolResult<BuildRuntimeToolStatus>> {
  try {
    const context = normalizeContext(agentId);
    const snapshot = await buildDevProcessManager.restartProcess(context.agentId);
    return {
      ok: true,
      snapshot,
      previewUrl: snapshot.runtime.previewUrl,
      recommendedNextAction: recommendedNextAction(snapshot.runtime.status, snapshot.runtime.previewUrl),
    };
  } catch (error) {
    return toToolError(error);
  }
}

export async function getBuildRuntimeLogsFromTool(agentId: string, cursor = 0, limit = 300): Promise<ToolResult<BuildRuntimeLogsResult>> {
  try {
    const context = normalizeContext(agentId);
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 300)));
    const response = await buildDevProcessManager.getLogs(context.agentId, Math.max(0, Math.floor(Number(cursor) || 0)), safeLimit);
    return {
      ok: true,
      logs: response.logs,
      nextCursor: response.nextCursor,
      truncated: response.logs.length >= safeLimit,
    };
  } catch (error) {
    return toToolError(error);
  }
}

export async function getBuildTerminalSnapshotFromTool(agentId: string, limit = 200): Promise<ToolResult<{
  ok: true;
  snapshot: Awaited<ReturnType<typeof buildTerminalManager.getSnapshot>>;
  activeEntries: BuildTerminalEntry[];
  truncated: boolean;
}>> {
  try {
    const context = normalizeContext(agentId);
    const safeLimit = Math.max(20, Math.min(1000, Math.floor(Number(limit) || 200)));
    const snapshot = await buildTerminalManager.getSnapshot(context.agentId);
    const activeSessionId = snapshot.activeSessionId;
    if (!activeSessionId) {
      return { ok: true, snapshot, activeEntries: [], truncated: false };
    }
    const output = await buildTerminalManager.getOutput(context.agentId, activeSessionId, 0, 2000);
    const activeEntries = output.entries.slice(-safeLimit);
    return {
      ok: true,
      snapshot,
      activeEntries,
      truncated: output.entries.length > activeEntries.length,
    };
  } catch (error) {
    return toToolError(error);
  }
}

export async function captureBuildPreviewScreenshotFromTool(agentId: string, workspaceRelativePath?: string): Promise<ToolResult<BuildRuntimeScreenshotResult>> {
  let previewWindow: BrowserWindow | null = null;
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    const snapshot = await buildDevProcessManager.getSnapshot(context.agentId, context.workspaceRelativePath);
    if (!snapshot.runtime.previewUrl) {
      throw new Error('No runtime preview URL is available. Start the runtime first.');
    }
    const loaded = await loadPreviewWindow(snapshot.runtime.previewUrl);
    previewWindow = loaded.window;
    const saved = await saveVisibleScreenshot(previewWindow, 'visible-preview');
    return {
      ok: true,
      kind: 'visible',
      filePath: saved.filePath,
      previewUrl: normalizeLocalPreviewUrl(snapshot.runtime.previewUrl),
      width: saved.width,
      height: saved.height,
    };
  } catch (error) {
    return toToolError(error);
  } finally {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
}

export async function captureBuildPreviewFullPageFromTool(agentId: string, workspaceRelativePath?: string): Promise<ToolResult<BuildRuntimeScreenshotResult>> {
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    const snapshot = await buildDevProcessManager.getSnapshot(context.agentId, context.workspaceRelativePath);
    if (!snapshot.runtime.previewUrl) {
      throw new Error('No runtime preview URL is available. Start the runtime first.');
    }
    return await captureFullPage(snapshot.runtime.previewUrl);
  } catch (error) {
    return toToolError(error);
  }
}

export async function getBuildPageSnapshotFromTool(agentId: string, workspaceRelativePath?: string): Promise<ToolResult<BuildPageSnapshotResult>> {
  let previewWindow: BrowserWindow | null = null;
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    const snapshot = await buildDevProcessManager.getSnapshot(context.agentId, context.workspaceRelativePath);
    if (!snapshot.runtime.previewUrl) {
      throw new Error('No runtime preview URL is available. Start the runtime first.');
    }
    const loaded = await loadPreviewWindow(snapshot.runtime.previewUrl);
    previewWindow = loaded.window;
    const page = await snapshotPage(previewWindow);
    return {
      ok: true,
      previewUrl: normalizeLocalPreviewUrl(snapshot.runtime.previewUrl),
      ...page,
      consoleErrors: summarizeConsoleErrors(loaded.consoleEvents),
    };
  } catch (error) {
    return toToolError(error);
  } finally {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
}

export async function runBuildUiInteractionTestFromTool(
  agentId: string,
  workspaceRelativePath: string | undefined,
  actions: BuildUiInteractionAction[]
): Promise<ToolResult<BuildUiInteractionTestResult>> {
  let previewWindow: BrowserWindow | null = null;
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    const snapshot = await buildDevProcessManager.getSnapshot(context.agentId, context.workspaceRelativePath);
    if (!snapshot.runtime.previewUrl) {
      throw new Error('No runtime preview URL is available. Start the runtime first.');
    }
    const loaded = await loadPreviewWindow(snapshot.runtime.previewUrl);
    previewWindow = loaded.window;
    const before = await saveVisibleScreenshot(previewWindow, 'ui-test-before').catch(() => null);
    const safeActions = Array.isArray(actions) ? actions.slice(0, 20) : [];
    const steps: BuildUiInteractionTestResult['steps'] = [];
    for (const action of safeActions) {
      try {
        const result = await runAction(previewWindow, action);
        steps.push({
          action: action.type,
          ok: result.ok,
          detail: result.detail || safeActionDescription(action),
          matchedElement: result.matchedElement,
          candidates: result.candidates,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error) {
        steps.push({
          action: action.type,
          ok: false,
          detail: error instanceof Error ? error.message : safeActionDescription(action),
        });
      }
    }
    const after = await saveVisibleScreenshot(previewWindow, 'ui-test-after').catch(() => null);
    return {
      ok: true,
      previewUrl: normalizeLocalPreviewUrl(snapshot.runtime.previewUrl),
      steps,
      beforeScreenshotPath: before?.filePath,
      afterScreenshotPath: after?.filePath,
      consoleErrors: summarizeConsoleErrors(loaded.consoleEvents),
    };
  } catch (error) {
    return toToolError(error);
  } finally {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
  }
}

export async function runBuildQualityChecksFromTool(
  agentId: string,
  workspaceRelativePath?: string,
  kinds?: BuildQualityCheckKind[]
) {
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    return await runBuildQualityChecks({
      agentId: context.agentId,
      workspaceRelativePath: context.workspaceRelativePath,
      kinds,
      trigger: 'manual',
    });
  } catch (error) {
    return toToolError(error);
  }
}

export async function getBuildGitSummaryFromTool(agentId: string, workspaceRelativePath?: string) {
  try {
    const context = normalizeContext(agentId, workspaceRelativePath);
    return await readBuildGitSummary(context.agentId, context.workspaceRelativePath, { lightweight: true });
  } catch (error) {
    return toToolError(error);
  }
}
