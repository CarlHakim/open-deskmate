import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import Store from 'electron-store';
import type {
  PluginAppCommandId,
  PluginCapabilityManifest,
  PluginCommandAction,
  PluginCommandContribution,
  PluginCommandVisibility,
  PluginContributionIssue,
  PluginContributionIssueKind,
  PluginHelpDocContribution,
  PluginManifest,
  PluginManifestContributions,
  PluginManifestMetadata,
  PluginPermissionScope,
  PluginRecord,
  PluginRegistryState,
  PluginSource,
  PluginToolContribution,
  RuntimeHookDefinition,
} from '@accomplish/shared';
import { sanitizeRuntimeHookDefinition } from '../hooks/hook-registry';

interface PluginLifecycleStoreSchema {
  enabledById: Record<string, boolean>;
}

const store = new Store<PluginLifecycleStoreSchema>({
  name: 'plugin-lifecycle',
  defaults: {
    enabledById: {},
  },
});

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,79}$/;
const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLUGIN_COMMAND_VISIBILITY_VALUES = new Set<PluginCommandVisibility>(['home', 'chat', 'build', 'global']);
const PLUGIN_COMMAND_INTENT_VALUES = new Set(['navigate', 'inspect', 'mutate', 'danger']);
const PLUGIN_TOOL_ACTION_VALUES = new Set(['connector_send_message', 'app_connector_execute', 'subagent_spawn']);
const PLUGIN_PERMISSION_SCOPE_VALUES = new Set<PluginPermissionScope>([
  'commands',
  'hooks',
  'tools',
  'help_docs',
  'app_command_dispatch',
  'connector_send_message',
  'app_connector_execute',
  'subagent_spawn',
]);
const PLUGIN_APP_COMMAND_IDS = new Set<PluginAppCommandId>([
  'task_stop',
  'task_save_skill',
  'subagents_refresh',
  'build_history_open',
  'build_history_new',
  'build_runtime_start',
  'build_runtime_stop',
  'build_runtime_restart',
  'build_runtime_build',
  'build_runtime_open_preview',
]);
const MANAGED_PLUGINS_README = `# Managed Plugins

This folder stores user-managed OpenDeskmate plugins.

## How Discovery Works

- Each live plugin must be inside its own subfolder.
- Each plugin folder must contain \`plugin.json\`.
- Files placed directly in this root are treated as authoring aids only.

## Recommended Layout

\`\`\`text
plugins/
  my-plugin/
    plugin.json
    docs/
      getting-started.md
\`\`\`

## Sample Files In This Folder

- \`plugin.example.json\`
  - Example manifest you can copy into a real plugin folder.
- \`help-doc.example.md\`
  - Example markdown help page for \`contributes.helpDocs\`.

## Next Step

Create a new plugin folder under this root, copy the sample manifest into that folder as \`plugin.json\`, then add any referenced help docs before refreshing the Plugins settings page.
`;
const MANAGED_PLUGIN_EXAMPLE_MANIFEST = `{
  "id": "example-docs-helper",
  "name": "Example Docs Helper",
  "version": "1.0.0",
  "description": "Example plugin showing commands, hooks, tools, and help docs.",
  "author": "Your Name",
  "defaultEnabled": true,
  "metadata": {
    "categories": ["docs", "workflow"],
    "minimumAppVersion": "1.0.0",
    "permissions": ["commands", "hooks", "tools", "help_docs", "app_command_dispatch", "subagent_spawn"]
  },
  "contributes": {
    "commands": [
      {
        "id": "open-example-guide",
        "command": "example-guide",
        "title": "Open Example Plugin Guide",
        "description": "Open this plugin's own help doc.",
        "group": "Plugins",
        "intent": "inspect",
        "visibility": ["home", "chat", "build", "global"],
        "action": {
          "type": "open_help_doc",
          "docId": "getting-started"
        }
      }
    ],
    "hooks": [
      {
        "id": "example-build-note",
        "event": "before_task_dispatch",
        "match": {
          "sources": ["build"]
        },
        "action": "record_note",
        "noteText": "Example plugin hook ran before Build dispatch."
      }
    ],
    "tools": [
      {
        "id": "spawn-helper",
        "name": "spawn_helper",
        "description": "Spawn a tracked helper subagent through the app boundary.",
        "action": "subagent_spawn",
        "inputSchema": {
          "type": "object",
          "properties": {
            "targetAgentId": { "type": "string" },
            "task": { "type": "string" },
            "label": { "type": "string" }
          },
          "required": ["targetAgentId", "task"]
        },
        "defaults": {
          "label": "Plugin helper"
        }
      }
    ],
    "helpDocs": [
      {
        "id": "getting-started",
        "title": "Getting Started",
        "file": "docs/getting-started.md",
        "description": "Example plugin help page."
      }
    ]
  }
}
`;
const MANAGED_PLUGIN_EXAMPLE_HELP_DOC = `# Example Plugin Guide

This help page was contributed by a plugin.

## What It Does

- Adds \`/example-guide\`
- Registers one example runtime hook
- Exposes one controlled \`subagent_spawn\` tool alias
`;

export interface EnabledPluginHelpDocRecord {
  pluginId: string;
  pluginName: string;
  pluginDir: string;
  doc: PluginHelpDocContribution;
}

interface ParsedPluginManifest {
  manifest: PluginManifest;
  issues: PluginContributionIssue[];
}

function pushContributionIssue(
  issues: PluginContributionIssue[],
  kind: PluginContributionIssueKind,
  severity: PluginContributionIssue['severity'],
  message: string,
  entry?: { id?: string; label?: string }
): void {
  issues.push({
    kind,
    severity,
    message,
    ...(entry?.id ? { entryId: entry.id } : {}),
    ...(entry?.label ? { entryLabel: entry.label } : {}),
  });
}

function normalizeId(input: unknown, fallback = 'plugin'): string {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeText(input: unknown, maxLength: number, fallback = ''): string {
  if (typeof input !== 'string') return fallback;
  const trimmed = input.trim();
  return trimmed.slice(0, maxLength) || fallback;
}

function normalizeStringList(input: unknown, maxItems = 100): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const next = Array.from(new Set(
    input
      .map((entry) => normalizeText(entry, 120))
      .filter(Boolean)
  )).slice(0, maxItems);
  return next.length > 0 ? next : undefined;
}

function normalizePermissions(input: unknown): PluginPermissionScope[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = Array.from(new Set(
    input
      .map((entry) => normalizeText(entry, 64).toLowerCase() as PluginPermissionScope)
      .filter((entry) => PLUGIN_PERMISSION_SCOPE_VALUES.has(entry))
  ));
  return values.length > 0 ? values : undefined;
}

function normalizeCapabilities(input: unknown): PluginCapabilityManifest | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const capabilities: PluginCapabilityManifest = {
    hooks: normalizeStringList(raw.hooks),
    commands: normalizeStringList(raw.commands),
    tools: normalizeStringList(raw.tools),
    mcpServers: normalizeStringList(raw.mcpServers),
    connectors: normalizeStringList(raw.connectors),
  };
  return Object.values(capabilities).some((entry) => Array.isArray(entry) && entry.length > 0)
    ? capabilities
    : undefined;
}

function sanitizeJsonObject(input: unknown, maxEntries = 40): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).slice(0, maxEntries));
}

function sanitizeVisibilityList(input: unknown): PluginCommandVisibility[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = Array.from(new Set(
    input
      .map((entry) => normalizeText(entry, 16).toLowerCase() as PluginCommandVisibility)
      .filter((entry) => PLUGIN_COMMAND_VISIBILITY_VALUES.has(entry))
  ));
  return values.length > 0 ? values : undefined;
}

export function buildPluginHelpDocId(pluginId: string, localDocId: string): string {
  const local = normalizeId(localDocId, 'help');
  const pluginHash = crypto.createHash('sha1').update(pluginId).digest('hex').slice(0, 8);
  const prefix = `plug-${pluginHash}-`;
  return `${prefix}${local.slice(0, Math.max(1, 64 - prefix.length))}`;
}

function sanitizeHelpDocFile(input: unknown): string | null {
  const file = normalizeText(input, 260).replace(/\\/g, '/');
  if (!file || path.isAbsolute(file) || file.includes('..')) return null;
  if (!file.toLowerCase().endsWith('.md')) return null;
  return file;
}

function sanitizePluginHelpDocContribution(
  input: unknown,
  pluginId: string,
  issues?: PluginContributionIssue[],
  index?: number
): { localId: string; doc: PluginHelpDocContribution } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (issues) {
      pushContributionIssue(
        issues,
        'help_doc',
        'error',
        'Ignored invalid help doc contribution. It must be a JSON object.',
        { label: `helpDocs[${index ?? 0}]` }
      );
    }
    return null;
  }
  const raw = input as Record<string, unknown>;
  const localId = normalizeId(raw.id, '');
  const title = normalizeText(raw.title, 120);
  const file = sanitizeHelpDocFile(raw.file);
  const description = normalizeText(raw.description, 400) || undefined;
  if (!localId || !title || !file) {
    if (issues) {
      pushContributionIssue(
        issues,
        'help_doc',
        'error',
        'Ignored invalid help doc contribution. It requires id, title, and a safe relative .md file path.',
        { id: localId || undefined, label: title || `helpDocs[${index ?? 0}]` }
      );
    }
    return null;
  }
  return {
    localId,
    doc: {
      id: buildPluginHelpDocId(pluginId, localId),
      title,
      file,
      ...(description ? { description } : {}),
    },
  };
}

function sanitizePluginMetadata(input: unknown): PluginManifestMetadata | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const minimumAppVersionCandidate = normalizeText(raw.minimumAppVersion, 32);
  const minimumAppVersion = minimumAppVersionCandidate
    ? validatePluginVersion(minimumAppVersionCandidate)
    : undefined;
  const metadata: PluginManifestMetadata = {
    categories: normalizeStringList(raw.categories, 16),
    minimumAppVersion,
    permissions: normalizePermissions(raw.permissions),
  };
  return metadata.categories || metadata.minimumAppVersion || metadata.permissions
    ? metadata
    : undefined;
}

function sanitizePluginCommandAction(input: unknown): PluginCommandAction | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const type = normalizeText(raw.type, 48).toLowerCase();

  if (type === 'navigate') {
    const navPath = normalizeText(raw.path, 260);
    if (!navPath.startsWith('/')) return null;
    return {
      type: 'navigate',
      path: navPath,
      search: normalizeText(raw.search, 260) || undefined,
    };
  }

  if (type === 'open_settings') {
    return { type: 'open_settings' };
  }

  if (type === 'open_settings_section') {
    const sectionQuery = normalizeText(raw.sectionQuery, 160);
    if (!sectionQuery) return null;
    return {
      type: 'open_settings_section',
      sectionQuery,
    };
  }

  if (type === 'open_help_doc') {
    const docId = normalizeText(raw.docId, 160);
    if (!docId) return null;
    return {
      type: 'open_help_doc',
      docId,
      query: normalizeText(raw.query, 160) || undefined,
    };
  }

  if (type === 'dispatch_app_command') {
    const commandId = normalizeText(raw.commandId, 64) as PluginAppCommandId;
    if (!PLUGIN_APP_COMMAND_IDS.has(commandId)) return null;
    return {
      type: 'dispatch_app_command',
      commandId,
    };
  }

  return null;
}

function sanitizePluginCommandContribution(
  input: unknown,
  pluginId: string,
  issues?: PluginContributionIssue[],
  index?: number
): PluginCommandContribution | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (issues) {
      pushContributionIssue(
        issues,
        'command',
        'error',
        'Ignored invalid command contribution. It must be a JSON object.',
        { label: `commands[${index ?? 0}]` }
      );
    }
    return null;
  }
  const raw = input as Record<string, unknown>;
  const command = normalizeId(raw.command, '');
  const title = normalizeText(raw.title, 120);
  const description = normalizeText(raw.description, 400);
  const action = sanitizePluginCommandAction(raw.action);
  if (!command || !title || !description || !action) {
    if (issues) {
      pushContributionIssue(
        issues,
        'command',
        'error',
        'Ignored invalid command contribution. It requires command, title, description, and a supported action.',
        { id: command || undefined, label: title || `commands[${index ?? 0}]` }
      );
    }
    return null;
  }

  const intentCandidate = normalizeText(raw.intent, 24).toLowerCase();
  const intent = PLUGIN_COMMAND_INTENT_VALUES.has(intentCandidate)
    ? (intentCandidate as PluginCommandContribution['intent'])
    : undefined;

  return {
    id: `${pluginId}:${normalizeId(raw.id || command, command)}`,
    command,
    title,
    description,
    group: normalizeText(raw.group, 64) || 'Plugins',
    intent,
    previewText: normalizeText(raw.previewText, 320) || undefined,
    aliases: normalizeStringList(raw.aliases, 16),
    keywords: normalizeStringList(raw.keywords, 24),
    visibility: sanitizeVisibilityList(raw.visibility),
    action,
  };
}

function sanitizePluginToolContribution(
  input: unknown,
  pluginId: string,
  issues?: PluginContributionIssue[],
  index?: number
): PluginToolContribution | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (issues) {
      pushContributionIssue(
        issues,
        'tool',
        'error',
        'Ignored invalid tool contribution. It must be a JSON object.',
        { label: `tools[${index ?? 0}]` }
      );
    }
    return null;
  }
  const raw = input as Record<string, unknown>;
  const id = normalizeId(raw.id || raw.name, '');
  const name = normalizeId(raw.name, '');
  const description = normalizeText(raw.description, 400);
  const action = normalizeText(raw.action, 48).toLowerCase();
  if (!id || !name || !description || !PLUGIN_TOOL_ACTION_VALUES.has(action)) {
    if (issues) {
      pushContributionIssue(
        issues,
        'tool',
        'error',
        'Ignored invalid tool contribution. It requires id/name, description, and a supported controlled action.',
        { id: id || name || undefined, label: name || `tools[${index ?? 0}]` }
      );
    }
    return null;
  }

  return {
    id: `${pluginId}:${id}`,
    name,
    description,
    action: action as PluginToolContribution['action'],
    inputSchema: sanitizeJsonObject(raw.inputSchema),
    defaults: sanitizeJsonObject(raw.defaults),
  };
}

function sanitizePluginContributions(
  input: unknown,
  pluginId: string,
  issues: PluginContributionIssue[]
): PluginManifestContributions | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  let commands = Array.isArray(raw.commands)
    ? raw.commands
      .map((entry, index) => sanitizePluginCommandContribution(entry, pluginId, issues, index))
      .filter((entry): entry is PluginCommandContribution => Boolean(entry))
    : undefined;
  const hooks = Array.isArray(raw.hooks)
    ? raw.hooks
      .map((entry, index) => {
        const hook = sanitizeRuntimeHookDefinition(entry);
        if (!hook) {
          pushContributionIssue(
            issues,
            'hook',
            'error',
            'Ignored invalid hook contribution. It requires a supported event/action shape.',
            { label: `hooks[${index}]` }
          );
          return null;
        }
        return { ...hook, id: `plugin:${pluginId}:${hook.id}` };
      })
      .filter((entry): entry is RuntimeHookDefinition => Boolean(entry))
    : undefined;
  const tools = Array.isArray(raw.tools)
    ? raw.tools
      .map((entry, index) => sanitizePluginToolContribution(entry, pluginId, issues, index))
      .filter((entry): entry is PluginToolContribution => Boolean(entry))
    : undefined;
  const helpDocs = Array.isArray(raw.helpDocs)
    ? raw.helpDocs
      .map((entry, index) => sanitizePluginHelpDocContribution(entry, pluginId, issues, index))
      .filter((entry): entry is { localId: string; doc: PluginHelpDocContribution } => Boolean(entry))
    : undefined;

  if (commands && helpDocs && helpDocs.length > 0) {
    const helpDocIdByLocalId = new Map(helpDocs.map((entry) => [entry.localId, entry.doc.id]));
    commands = commands.map((entry) => (
      entry.action.type === 'open_help_doc'
        ? helpDocIdByLocalId.has(entry.action.docId)
          ? {
              ...entry,
              action: {
                ...entry.action,
                docId: helpDocIdByLocalId.get(entry.action.docId) || entry.action.docId,
              },
            }
          : (
            pushContributionIssue(
              issues,
              'command',
              'error',
              `Command "/${entry.command}" references unknown plugin help doc id "${entry.action.docId}".`,
              { id: entry.id, label: `/${entry.command}` }
            ),
            entry
          )
        : entry
    ));
  }

  const contributes: PluginManifestContributions = {
    commands: commands && commands.length > 0 ? commands : undefined,
    hooks: hooks && hooks.length > 0 ? hooks : undefined,
    tools: tools && tools.length > 0 ? tools : undefined,
    helpDocs: helpDocs && helpDocs.length > 0 ? helpDocs.map((entry) => entry.doc) : undefined,
  };
  return contributes.commands || contributes.hooks || contributes.tools || contributes.helpDocs ? contributes : undefined;
}

function requireObject(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(message);
  }
  return input as Record<string, unknown>;
}

function requireString(input: unknown, field: string, maxLength: number): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`Manifest field "${field}" must be a non-empty string.`);
  }
  return input.trim().slice(0, maxLength);
}

function validatePluginId(id: string): string {
  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new Error('Manifest field "id" must match /^[a-z0-9][a-z0-9-_]{0,79}$/');
  }
  return id;
}

function validatePluginVersion(version: string): string {
  if (!PLUGIN_VERSION_PATTERN.test(version)) {
    throw new Error('Manifest field "version" must be a semantic version like 1.0.0');
  }
  return version;
}

function validateHomepage(input: unknown): string | undefined {
  if (input == null || input === '') return undefined;
  const homepage = requireString(input, 'homepage', 400);
  if (!/^https?:\/\//i.test(homepage)) {
    throw new Error('Manifest field "homepage" must start with http:// or https://');
  }
  return homepage;
}

function validateMain(input: unknown): string | undefined {
  if (input == null || input === '') return undefined;
  const main = requireString(input, 'main', 260);
  if (path.isAbsolute(main) || main.includes('..')) {
    throw new Error('Manifest field "main" must be a safe relative path.');
  }
  return main.replace(/\\/g, '/');
}

function parseManifest(raw: unknown, fallbackId: string): ParsedPluginManifest {
  const input = requireObject(raw, 'Plugin manifest must be a JSON object.');
  const requestedId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : fallbackId;
  const id = validatePluginId(requestedId);
  const name = requireString(input.name, 'name', 120);
  const version = validatePluginVersion(requireString(input.version, 'version', 32));
  const issues: PluginContributionIssue[] = [];
  return {
    manifest: {
      id,
      name,
      version,
      description: normalizeText(input.description, 400) || undefined,
      author: normalizeText(input.author, 160) || undefined,
      homepage: validateHomepage(input.homepage),
      main: validateMain(input.main),
      defaultEnabled: input.defaultEnabled === false ? false : true,
      metadata: sanitizePluginMetadata(input.metadata),
      capabilities: normalizeCapabilities(input.capabilities),
      contributes: sanitizePluginContributions(input.contributes, id, issues),
    },
    issues,
  };
}

function getBundledPluginsRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'plugins')
    : path.join(app.getAppPath(), 'plugins');
}

function getManagedPluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

function writeManagedPluginAuthoringFileIfMissing(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, `${content.trim()}\n`, 'utf8');
}

function ensureManagedPluginAuthoringDocs(root: string): void {
  writeManagedPluginAuthoringFileIfMissing(path.join(root, 'README.md'), MANAGED_PLUGINS_README);
  writeManagedPluginAuthoringFileIfMissing(path.join(root, 'plugin.example.json'), MANAGED_PLUGIN_EXAMPLE_MANIFEST);
  writeManagedPluginAuthoringFileIfMissing(path.join(root, 'help-doc.example.md'), MANAGED_PLUGIN_EXAMPLE_HELP_DOC);
}

function ensureManagedPluginsRoot(): string {
  const root = getManagedPluginsRoot();
  fs.mkdirSync(root, { recursive: true });
  ensureManagedPluginAuthoringDocs(root);
  return root;
}

export function getManagedPluginsRootPath(): string {
  return ensureManagedPluginsRoot();
}

function listPluginFolders(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function readPluginRecord(dir: string, source: PluginSource): PluginRecord {
  const discoveredAt = new Date().toISOString();
  const fallbackId = normalizeId(path.basename(dir), 'plugin');
  const manifestPath = path.join(dir, 'plugin.json');

  if (!fs.existsSync(manifestPath)) {
    return {
      id: fallbackId,
      source,
      dir,
      manifest: null,
      enabled: false,
      valid: false,
      error: 'Missing plugin.json manifest.',
      discoveredAt,
    };
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const parsedManifest = parseManifest(parsed, fallbackId);
    const manifest = parsedManifest.manifest;
    const enabledById = store.get('enabledById') ?? {};
    const enabled = Object.prototype.hasOwnProperty.call(enabledById, manifest.id)
      ? Boolean(enabledById[manifest.id])
      : manifest.defaultEnabled !== false;
    return {
      id: manifest.id,
      source,
      dir,
      manifest,
      enabled,
      valid: true,
      issues: parsedManifest.issues.length > 0 ? parsedManifest.issues : undefined,
      discoveredAt,
    };
  } catch (error) {
    return {
      id: fallbackId,
      source,
      dir,
      manifest: null,
      enabled: false,
      valid: false,
      error: `Invalid plugin manifest: ${(error as Error).message}`,
      discoveredAt,
    };
  }
}

function dedupePluginIds(records: PluginRecord[]): PluginRecord[] {
  const seen = new Set<string>();
  return records.map((record) => {
    if (!record.valid) return record;
    if (!seen.has(record.id)) {
      seen.add(record.id);
      return record;
    }
    return {
      ...record,
      enabled: false,
      valid: false,
      error: `Duplicate plugin id "${record.id}".`,
    };
  });
}

export function listPluginRegistry(): PluginRegistryState {
  const bundledRoot = getBundledPluginsRoot();
  const managedRoot = ensureManagedPluginsRoot();

  const records = [
    ...listPluginFolders(bundledRoot).map((dir) => readPluginRecord(dir, 'bundled')),
    ...listPluginFolders(managedRoot).map((dir) => readPluginRecord(dir, 'managed')),
  ];

  const plugins = dedupePluginIds(records).sort((a, b) => {
    if (a.source !== b.source) return a.source === 'bundled' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return {
    roots: {
      bundled: bundledRoot,
      managed: managedRoot,
    },
    plugins,
  };
}

export function setPluginEnabled(pluginId: string, enabled: boolean): PluginRecord {
  const normalizedId = normalizeId(pluginId, '');
  if (!normalizedId) {
    throw new Error('Invalid plugin id');
  }

  const registry = listPluginRegistry();
  const plugin = registry.plugins.find((entry) => entry.id === normalizedId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${normalizedId}`);
  }
  if (!plugin.valid) {
    throw new Error(`Cannot change invalid plugin: ${normalizedId}`);
  }

  const nextEnabledById = {
    ...(store.get('enabledById') ?? {}),
    [normalizedId]: enabled,
  };
  store.set('enabledById', nextEnabledById);

  const updatedRegistry = listPluginRegistry();
  const updated = updatedRegistry.plugins.find((entry) => entry.id === normalizedId);
  if (!updated) {
    throw new Error(`Plugin not found after update: ${normalizedId}`);
  }
  return updated;
}

export function listEnabledPlugins(): PluginRecord[] {
  return listPluginRegistry().plugins.filter((entry) => entry.valid && entry.enabled);
}

export function listEnabledPluginCommandContributions(): PluginCommandContribution[] {
  return listEnabledPlugins()
    .flatMap((entry) => entry.manifest?.contributes?.commands || []);
}

export function listEnabledPluginHookContributions() {
  return listEnabledPlugins()
    .flatMap((entry) => entry.manifest?.contributes?.hooks || []);
}

export function listEnabledPluginToolContributions(): PluginToolContribution[] {
  return listEnabledPlugins()
    .flatMap((entry) => entry.manifest?.contributes?.tools || []);
}

export function listEnabledPluginHelpDocContributions(): EnabledPluginHelpDocRecord[] {
  return listEnabledPlugins()
    .flatMap((entry) =>
      (entry.manifest?.contributes?.helpDocs || []).map((doc) => ({
        pluginId: entry.id,
        pluginName: entry.manifest?.name || entry.id,
        pluginDir: entry.dir,
        doc,
      }))
    );
}

export function installManagedPluginFromDirectory(sourceDir: string): PluginRecord {
  const resolvedSourceDir = path.resolve(String(sourceDir || ''));
  if (!resolvedSourceDir) {
    throw new Error('Source directory is required.');
  }
  if (!fs.existsSync(resolvedSourceDir) || !fs.statSync(resolvedSourceDir).isDirectory()) {
    throw new Error('Source directory does not exist.');
  }

  const managedRoot = ensureManagedPluginsRoot();
  const relativeToManagedRoot = path.relative(managedRoot, resolvedSourceDir);
  if (relativeToManagedRoot && !relativeToManagedRoot.startsWith('..') && !path.isAbsolute(relativeToManagedRoot)) {
    throw new Error('Source directory is already inside the managed plugins root.');
  }

  const manifestPath = path.join(resolvedSourceDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Selected folder does not contain plugin.json.');
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = parseManifest(JSON.parse(raw), normalizeId(path.basename(resolvedSourceDir), 'plugin')).manifest;
  const registry = listPluginRegistry();
  const existing = registry.plugins.find((entry) => entry.id === manifest.id);
  if (existing) {
    throw new Error(`Plugin id "${manifest.id}" already exists (${existing.source}).`);
  }

  const destinationDir = path.join(managedRoot, manifest.id);
  if (fs.existsSync(destinationDir)) {
    throw new Error(`Managed plugin folder already exists: ${destinationDir}`);
  }

  fs.cpSync(resolvedSourceDir, destinationDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });

  const installed = listPluginRegistry().plugins.find((entry) => entry.id === manifest.id && entry.source === 'managed');
  if (!installed) {
    throw new Error(`Plugin "${manifest.id}" was copied but not discovered.`);
  }
  return installed;
}

export function uninstallManagedPlugin(pluginId: string): { ok: true; pluginId: string } {
  const normalizedId = normalizeId(pluginId, '');
  if (!normalizedId) {
    throw new Error('Invalid plugin id');
  }

  const registry = listPluginRegistry();
  const plugin = registry.plugins.find((entry) => entry.id === normalizedId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${normalizedId}`);
  }
  if (plugin.source !== 'managed') {
    throw new Error('Only managed plugins can be uninstalled.');
  }

  fs.rmSync(plugin.dir, { recursive: true, force: true });

  const enabledById = { ...(store.get('enabledById') ?? {}) };
  delete enabledById[normalizedId];
  store.set('enabledById', enabledById);

  return { ok: true, pluginId: normalizedId };
}
