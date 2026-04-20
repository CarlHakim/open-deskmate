import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type {
  RuntimeHookAction,
  RuntimeHookDefinition,
  RuntimeHookEvent,
  RuntimeHookMatch,
  RuntimeHookRegistry,
} from '@accomplish/shared';

const VALID_EVENTS = new Set<RuntimeHookEvent>([
  'before_task_dispatch',
  'before_task_resume',
  'before_node_tool',
  'after_task_complete',
  'after_node_tool',
]);

const VALID_ACTIONS = new Set<RuntimeHookAction>([
  'allow',
  'block',
  'prepend_prompt',
  'append_system_prompt',
  'patch_input',
  'record_note',
]);

function getAppDataPath(): string {
  if (typeof (app as unknown as { getPath?: unknown }).getPath === 'function') {
    return app.getPath('userData');
  }
  return process.cwd();
}

export function getRuntimeHooksRegistryPath(): string {
  return path.join(getAppDataPath(), 'opencode', 'runtime-hooks.json');
}

function sanitizeText(value: unknown, maxLen = 4096): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeIdList(value: unknown, maxItems = 64): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const next = Array.from(
    new Set(
      value
        .map((entry) => sanitizeText(entry, 128).toLowerCase())
        .filter(Boolean)
        .slice(0, maxItems)
    )
  );
  return next.length > 0 ? next : undefined;
}

function sanitizeMatch(value: unknown): RuntimeHookMatch | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const next: RuntimeHookMatch = {
    agentIds: sanitizeIdList(record.agentIds),
    toolNames: sanitizeIdList(record.toolNames),
    sources: sanitizeIdList(record.sources),
  };
  return next.agentIds || next.toolNames || next.sources ? next : undefined;
}

function sanitizeInputPatch(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 32);
  const next = Object.fromEntries(entries);
  return Object.keys(next).length > 0 ? next : undefined;
}

export function sanitizeRuntimeHookDefinition(value: unknown): RuntimeHookDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = sanitizeText(record.id, 128).toLowerCase();
  const event = sanitizeText(record.event, 64).toLowerCase() as RuntimeHookEvent;
  const action = sanitizeText(record.action, 64).toLowerCase() as RuntimeHookAction;
  if (!id || !VALID_EVENTS.has(event) || !VALID_ACTIONS.has(action)) {
    return null;
  }
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
  return {
    id,
    event,
    enabled,
    description: sanitizeText(record.description, 512) || undefined,
    match: sanitizeMatch(record.match),
    action,
    message: sanitizeText(record.message, 2000) || undefined,
    promptText: sanitizeText(record.promptText, 8000) || undefined,
    systemPromptText: sanitizeText(record.systemPromptText, 8000) || undefined,
    inputPatch: sanitizeInputPatch(record.inputPatch),
    noteText: sanitizeText(record.noteText, 4000) || undefined,
  };
}

function parseRegistry(raw: string): RuntimeHookRegistry {
  if (!raw.trim()) return { hooks: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { hooks: [] };
  }
  const source = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { hooks?: unknown[] }).hooks)
      ? (parsed as { hooks: unknown[] }).hooks
      : []);
  const hooks = source
    .map((entry) => sanitizeRuntimeHookDefinition(entry))
    .filter((entry): entry is RuntimeHookDefinition => Boolean(entry));
  return { hooks };
}

export function loadRuntimeHooksRegistry(): RuntimeHookRegistry {
  const filePath = getRuntimeHooksRegistryPath();
  if (!fs.existsSync(filePath)) return { hooks: [] };
  try {
    return parseRegistry(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn('[Hooks] Failed to load runtime hooks registry:', error);
    return { hooks: [] };
  }
}

export function readRuntimeHooksRegistryRaw(): { path: string; raw: string; hookCount: number } {
  const filePath = getRuntimeHooksRegistryPath();
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      raw: '{\n  "hooks": []\n}\n',
      hookCount: 0,
    };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return {
      path: filePath,
      raw,
      hookCount: loadRuntimeHooksRegistry().hooks.length,
    };
  } catch (error) {
    console.warn('[Hooks] Failed to read runtime hooks registry raw:', error);
    return {
      path: filePath,
      raw: '{\n  "hooks": []\n}\n',
      hookCount: 0,
    };
  }
}

export function saveRuntimeHooksRegistryRaw(raw: string): { path: string; hookCount: number } {
  const filePath = getRuntimeHooksRegistryPath();
  const parsed = parseRegistry(raw);
  const normalized = `${JSON.stringify({ hooks: parsed.hooks }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalized, 'utf8');
  return {
    path: filePath,
    hookCount: parsed.hooks.length,
  };
}
