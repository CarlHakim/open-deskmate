import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type OpenCodeMcpServerConfig = {
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  timeout?: number;
};

type CustomMcpServerRecord = Record<string, OpenCodeMcpServerConfig>;

const BUILT_IN_MCP_SERVER_IDS = new Set([
  'file-permission',
  'node-tools',
  'memory-tools',
  'canvas',
  'build-runtime-tools',
]);

export function getCustomMcpRegistryPath(): string {
  return path.join(app.getPath('userData'), 'opencode', 'custom-mcp-servers.json');
}

function sanitizeString(value: unknown, maxLen = 4096): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.slice(0, maxLen);
}

function sanitizeEnvironment(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = sanitizeString(rawKey, 128);
    const value = sanitizeString(rawValue, 4096);
    if (!key || !value) continue;
    output[key] = value;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeCommand(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const command = input
    .map((segment) => sanitizeString(segment, 4096))
    .filter(Boolean)
    .slice(0, 64);
  return command.length > 0 ? command : undefined;
}

function sanitizeTimeout(input: unknown): number | undefined {
  const value = Number(input);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1000, Math.min(180_000, Math.round(value)));
}

function sanitizeServerConfig(config: unknown): OpenCodeMcpServerConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  const typeRaw = sanitizeString(record.type, 32).toLowerCase();
  const type: 'local' | 'remote' = typeRaw === 'remote' ? 'remote' : 'local';
  const enabledRaw = record.enabled;
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;
  const timeout = sanitizeTimeout(record.timeout);
  const environment = sanitizeEnvironment(record.environment);

  if (type === 'remote') {
    const url = sanitizeString(record.url, 4096);
    if (!url) return null;
    return {
      type,
      url,
      enabled,
      environment,
      timeout,
    };
  }

  const command = sanitizeCommand(record.command);
  if (!command) return null;
  return {
    type,
    command,
    enabled,
    environment,
    timeout,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRawRegistry(rawText: string): CustomMcpServerRecord {
  if (!rawText.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {};
  }

  const output: CustomMcpServerRecord = {};
  const append = (idInput: unknown, configInput: unknown): void => {
    const id = sanitizeString(idInput, 128).toLowerCase();
    if (!id || BUILT_IN_MCP_SERVER_IDS.has(id)) return;
    const safeId = id.replace(/[^a-z0-9._-]/g, '');
    if (!safeId) return;
    const server = sanitizeServerConfig(configInput);
    if (!server) return;
    output[safeId] = server;
  };

  if (isPlainObject(parsed) && isPlainObject(parsed.servers)) {
    for (const [id, cfg] of Object.entries(parsed.servers)) {
      append(id, cfg);
    }
    return output;
  }

  if (isPlainObject(parsed)) {
    for (const [id, cfg] of Object.entries(parsed)) {
      append(id, cfg);
    }
  }
  return output;
}

export function loadCustomMcpRegistry(): CustomMcpServerRecord {
  const filePath = getCustomMcpRegistryPath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseRawRegistry(raw);
  } catch (error) {
    console.warn('[OpenCode Config] Failed reading custom MCP registry:', error);
    return {};
  }
}
