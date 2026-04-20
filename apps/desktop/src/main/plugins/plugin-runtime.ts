import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type {
  PluginCommandContribution,
  PluginContributionIssue,
  PluginDiagnosticsRecord,
  PluginRegistrationState,
  PluginToolContribution,
  RuntimeHookDefinition,
  SelectedModel,
} from '@accomplish/shared';
import { executeAppConnectorAction } from '../services/app-connector-runtimes';
import { sendConnectorOutboundMessage } from '../services/connector-outbound';
import { spawnSubagent } from '../services/subagents/subagent-spawn';
import { isAppConnectorExtensionId } from '../store/appConnectorExtensions';
import { isGatewayConnectorExtensionId } from '../store/gatewayConnectorExtensions';
import {
  buildPluginHelpDocId,
  listEnabledPluginCommandContributions,
  listEnabledPluginHookContributions,
  listPluginRegistry,
  listEnabledPluginToolContributions,
} from './plugin-registry';

export interface PluginToolExecutionContext {
  parentTaskId?: string;
  parentAgentId?: string;
}

type PluginConnectorTargetKind = 'dm' | 'group' | 'channel' | 'space' | 'chat' | 'room';

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeConnectorTargetKind(value: unknown): PluginConnectorTargetKind | undefined {
  const normalized = normalizeText(value, 32).toLowerCase();
  if (
    normalized === 'dm'
    || normalized === 'group'
    || normalized === 'channel'
    || normalized === 'space'
    || normalized === 'chat'
    || normalized === 'room'
  ) {
    return normalized;
  }
  return undefined;
}

function compareSemverLike(left: string, right: string): number {
  const parse = (value: string): number[] => value
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function appendIssue(
  issues: PluginContributionIssue[],
  issue: PluginContributionIssue
): void {
  const signature = JSON.stringify(issue);
  if (issues.some((entry) => JSON.stringify(entry) === signature)) {
    return;
  }
  issues.push(issue);
}

function buildSelectedModel(input: Record<string, unknown>): SelectedModel | null {
  const provider = normalizeText(input.modelProvider, 64).toLowerCase();
  const model = normalizeText(input.modelId, 256);
  const baseUrl = normalizeText(input.modelBaseUrl, 1024) || undefined;
  if (!provider || !model) return null;
  return {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function listRegisteredPluginCommands(): PluginCommandContribution[] {
  return listEnabledPluginCommandContributions();
}

export function listRegisteredPluginHooks(): RuntimeHookDefinition[] {
  return listEnabledPluginHookContributions();
}

export function listRegisteredPluginTools(): PluginToolContribution[] {
  const seen = new Set<string>();
  const tools: PluginToolContribution[] = [];
  for (const tool of listEnabledPluginToolContributions()) {
    if (!tool.name || seen.has(tool.name)) continue;
    seen.add(tool.name);
    tools.push(tool);
  }
  return tools;
}

export function getRegisteredPluginToolByName(name: string): PluginToolContribution | null {
  const normalized = normalizeText(name, 128).toLowerCase();
  if (!normalized) return null;
  return listRegisteredPluginTools().find((tool) => tool.name === normalized) || null;
}

export function getPluginRegistrationDiagnostics(): PluginDiagnosticsRecord[] {
  const registry = listPluginRegistry();
  const appVersion = app.getVersion();
  const enabledValidPlugins = registry.plugins.filter((plugin) => plugin.valid && plugin.enabled);

  const toolOwners = new Map<string, string[]>();
  const commandOwners = new Map<string, string[]>();
  for (const plugin of enabledValidPlugins) {
    for (const tool of plugin.manifest?.contributes?.tools || []) {
      const owners = toolOwners.get(tool.name) || [];
      owners.push(plugin.id);
      toolOwners.set(tool.name, owners);
    }
    for (const command of plugin.manifest?.contributes?.commands || []) {
      const owners = commandOwners.get(command.command) || [];
      owners.push(plugin.id);
      commandOwners.set(command.command, owners);
    }
  }

  return registry.plugins.map((plugin) => {
    const manifest = plugin.manifest;
    const minimumAppVersion = manifest?.metadata?.minimumAppVersion;
    const compatible = !minimumAppVersion || compareSemverLike(appVersion, minimumAppVersion) >= 0;
    const blockedReasons: string[] = [];
    const warnings: string[] = [];
    const issues: PluginContributionIssue[] = [...(plugin.issues || [])];

    if (!plugin.valid) {
      blockedReasons.push(plugin.error || 'Plugin manifest is invalid.');
    }
    if (plugin.valid && !plugin.enabled) {
      blockedReasons.push('Plugin is disabled.');
    }
    if (plugin.valid && plugin.enabled && !compatible && minimumAppVersion) {
      blockedReasons.push(`Requires app version ${minimumAppVersion} or newer.`);
    }

    const commands = manifest?.contributes?.commands || [];
    const tools = manifest?.contributes?.tools || [];
    const helpDocs = manifest?.contributes?.helpDocs || [];

    for (const tool of tools) {
      const owners = toolOwners.get(tool.name) || [];
      if (owners.length > 1) {
        const message = `Tool "${tool.name}" is also declared by ${owners.filter((id) => id !== plugin.id).join(', ')}. Only one tool with that name is active at runtime.`;
        warnings.push(message);
        appendIssue(issues, {
          kind: 'tool',
          severity: 'warning',
          message,
          entryId: tool.id,
          entryLabel: tool.name,
        });
      }
    }

    for (const command of commands) {
      const owners = commandOwners.get(command.command) || [];
      if (owners.length > 1) {
        const message = `Command "/${command.command}" is also declared by ${owners.filter((id) => id !== plugin.id).join(', ')}.`;
        warnings.push(message);
        appendIssue(issues, {
          kind: 'command',
          severity: 'warning',
          message,
          entryId: command.id,
          entryLabel: `/${command.command}`,
        });
      }
    }

    for (const helpDoc of helpDocs) {
      const absolutePath = path.resolve(plugin.dir, helpDoc.file);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        const message = `Help doc "${helpDoc.title}" is missing file ${helpDoc.file}.`;
        warnings.push(message);
        appendIssue(issues, {
          kind: 'help_doc',
          severity: 'error',
          message,
          entryId: helpDoc.id,
          entryLabel: helpDoc.title,
        });
      }
      if (helpDoc.id !== buildPluginHelpDocId(plugin.id, helpDoc.id.replace(/^plug-[0-9a-f]{8}-/, ''))) {
        // Keep warning simple if the rewritten id no longer looks local.
        const message = `Help doc "${helpDoc.title}" uses a runtime-scoped help id.`;
        warnings.push(message);
        appendIssue(issues, {
          kind: 'help_doc',
          severity: 'warning',
          message,
          entryId: helpDoc.id,
          entryLabel: helpDoc.title,
        });
        break;
      }
    }

    let registrationState: PluginRegistrationState;
    if (!plugin.valid) {
      registrationState = 'invalid';
    } else if (!plugin.enabled) {
      registrationState = 'disabled';
    } else if (!compatible) {
      registrationState = 'incompatible';
    } else if (warnings.length > 0 || issues.length > 0) {
      registrationState = 'warning';
    } else {
      registrationState = 'active';
    }

    return {
      pluginId: plugin.id,
      appVersion,
      minimumAppVersion,
      compatible,
      ready: registrationState === 'active',
      registrationState,
      blockedReasons,
      warnings,
      issues,
      counts: {
        commands: commands.length,
        hooks: manifest?.contributes?.hooks?.length || 0,
        tools: tools.length,
        helpDocs: helpDocs.length,
      },
      categories: manifest?.metadata?.categories || [],
      permissions: manifest?.metadata?.permissions || [],
      commands,
      tools,
      helpDocs,
    };
  });
}

export async function executeRegisteredPluginTool(
  name: string,
  rawArgs: unknown,
  context: PluginToolExecutionContext = {}
): Promise<Record<string, unknown>> {
  const tool = getRegisteredPluginToolByName(name);
  if (!tool) {
    throw new Error(`Unknown plugin tool: ${name}`);
  }

  const args = {
    ...(tool.defaults || {}),
    ...normalizeObject(rawArgs),
  };

  if (tool.action === 'connector_send_message') {
    const connector = normalizeText(args.connector, 64).toLowerCase();
    const text = normalizeText(args.text, 8000);
    if (!isGatewayConnectorExtensionId(connector)) {
      throw new Error(`Invalid connector for plugin tool "${tool.name}".`);
    }
    if (!text) {
      throw new Error(`Plugin tool "${tool.name}" requires text.`);
    }

    const result = await sendConnectorOutboundMessage({
      connectorId: connector,
      connectorInstanceId: normalizeText(args.connectorInstanceId, 64) || undefined,
      targetId: normalizeText(args.targetId, 256) || undefined,
      targetKind: normalizeConnectorTargetKind(args.targetKind),
      accountId: normalizeText(args.accountId, 128) || undefined,
      text,
    });

    return {
      ok: true,
      action: tool.action,
      connector: result.connectorId,
      connectorInstanceId: result.connectorInstanceId,
      accountId: result.accountId,
      targetId: result.targetId,
      targetKind: result.targetKind,
    };
  }

  if (tool.action === 'app_connector_execute') {
    const connector = normalizeText(args.connector, 64).toLowerCase();
    const action = normalizeText(args.action, 96).toLowerCase();
    if (!isAppConnectorExtensionId(connector)) {
      throw new Error(`Invalid app connector for plugin tool "${tool.name}".`);
    }
    if (!action) {
      throw new Error(`Plugin tool "${tool.name}" requires action.`);
    }

    const result = await executeAppConnectorAction({
      connectorId: connector,
      connectorInstanceId: normalizeText(args.connectorInstanceId, 64) || undefined,
      action,
      args: normalizeObject(args.args),
    });

    return {
      ok: true,
      action: tool.action,
      connector: result.connectorId,
      connectorInstanceId: result.connectorInstanceId,
      runtimeKey: result.runtimeKey,
      detail: result.detail,
      data: result.data,
    };
  }

  if (tool.action === 'subagent_spawn') {
    const parentTaskId = normalizeText(args.parentTaskId, 128) || normalizeText(context.parentTaskId, 128);
    const parentAgentId = normalizeText(args.parentAgentId, 64).toLowerCase() || normalizeText(context.parentAgentId, 64).toLowerCase();
    const targetAgentId = normalizeText(args.targetAgentId, 64).toLowerCase();
    const task = normalizeText(args.task, 8000);
    if (!parentTaskId || !parentAgentId) {
      throw new Error(`Plugin tool "${tool.name}" requires parent task context.`);
    }
    if (!targetAgentId || !task) {
      throw new Error(`Plugin tool "${tool.name}" requires targetAgentId and task.`);
    }

    return spawnSubagent(
      {
        targetAgentId,
        task,
        label: normalizeText(args.label, 128) || undefined,
        runTimeoutMs: typeof args.runTimeoutMs === 'number' ? args.runTimeoutMs : undefined,
        mode: normalizeText(args.mode, 16).toLowerCase() === 'session' ? 'session' : 'run',
        reuseExistingSession: typeof args.reuseExistingSession === 'boolean' ? args.reuseExistingSession : undefined,
        model: buildSelectedModel(args),
      },
      {
        parentTaskId,
        parentAgentId,
      }
    ) as unknown as Record<string, unknown>;
  }

  throw new Error(`Unsupported plugin tool action: ${tool.action}`);
}
