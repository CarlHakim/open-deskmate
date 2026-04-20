import type { HelpDocIndexEntry } from './help';
import type { RuntimeHookDefinition } from './hooks';

export type PluginSource = 'bundled' | 'managed';

export type PluginCommandIntent = 'navigate' | 'inspect' | 'mutate' | 'danger';
export type PluginCommandVisibility = 'home' | 'chat' | 'build' | 'global';
export type PluginAppCommandId =
  | 'task_stop'
  | 'task_save_skill'
  | 'subagents_refresh'
  | 'build_history_open'
  | 'build_history_new'
  | 'build_runtime_start'
  | 'build_runtime_stop'
  | 'build_runtime_restart'
  | 'build_runtime_build'
  | 'build_runtime_open_preview';
export type PluginPermissionScope =
  | 'commands'
  | 'hooks'
  | 'tools'
  | 'help_docs'
  | 'app_command_dispatch'
  | 'connector_send_message'
  | 'app_connector_execute'
  | 'subagent_spawn';

export type PluginCommandAction =
  | {
      type: 'navigate';
      path: string;
      search?: string;
    }
  | {
      type: 'open_settings';
    }
  | {
      type: 'open_settings_section';
      sectionQuery: string;
    }
  | {
      type: 'open_help_doc';
      docId: string;
      query?: string;
    }
  | {
      type: 'dispatch_app_command';
      commandId: PluginAppCommandId;
    };

export interface PluginCommandContribution {
  id: string;
  command: string;
  title: string;
  description: string;
  group?: string;
  intent?: PluginCommandIntent;
  previewText?: string;
  aliases?: string[];
  keywords?: string[];
  visibility?: PluginCommandVisibility[];
  action: PluginCommandAction;
}

export type PluginToolActionType = 'connector_send_message' | 'app_connector_execute' | 'subagent_spawn';

export interface PluginToolContribution {
  id: string;
  name: string;
  description: string;
  action: PluginToolActionType;
  inputSchema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

export interface PluginHelpDocContribution extends HelpDocIndexEntry {}

export interface PluginManifestMetadata {
  categories?: string[];
  minimumAppVersion?: string;
  permissions?: PluginPermissionScope[];
}

export type PluginContributionIssueKind = 'command' | 'hook' | 'tool' | 'help_doc';
export type PluginContributionIssueSeverity = 'warning' | 'error';

export interface PluginContributionIssue {
  kind: PluginContributionIssueKind;
  severity: PluginContributionIssueSeverity;
  message: string;
  entryId?: string;
  entryLabel?: string;
}

export interface PluginManifestContributions {
  commands?: PluginCommandContribution[];
  hooks?: RuntimeHookDefinition[];
  tools?: PluginToolContribution[];
  helpDocs?: PluginHelpDocContribution[];
}

export interface PluginCapabilityManifest {
  hooks?: string[];
  commands?: string[];
  tools?: string[];
  mcpServers?: string[];
  connectors?: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  defaultEnabled?: boolean;
  metadata?: PluginManifestMetadata;
  capabilities?: PluginCapabilityManifest;
  contributes?: PluginManifestContributions;
}

export interface PluginRecord {
  id: string;
  source: PluginSource;
  dir: string;
  manifest: PluginManifest | null;
  enabled: boolean;
  valid: boolean;
  error?: string;
  issues?: PluginContributionIssue[];
  discoveredAt: string;
}

export interface PluginRegistryState {
  roots: {
    bundled: string;
    managed: string;
  };
  plugins: PluginRecord[];
}

export interface PluginContributionCounts {
  commands: number;
  hooks: number;
  tools: number;
  helpDocs: number;
}

export type PluginRegistrationState =
  | 'active'
  | 'disabled'
  | 'invalid'
  | 'incompatible'
  | 'warning';

export interface PluginDiagnosticsRecord {
  pluginId: string;
  appVersion: string;
  minimumAppVersion?: string;
  compatible: boolean;
  ready: boolean;
  registrationState: PluginRegistrationState;
  blockedReasons: string[];
  warnings: string[];
  issues: PluginContributionIssue[];
  counts: PluginContributionCounts;
  categories: string[];
  permissions: PluginPermissionScope[];
  commands: PluginCommandContribution[];
  tools: PluginToolContribution[];
  helpDocs: PluginHelpDocContribution[];
}

export type PluginDiagnosticsEventReason =
  | 'startup'
  | 'enable'
  | 'disable'
  | 'install'
  | 'uninstall';

export interface PluginDiagnosticsHistoryEntry {
  id: string;
  recordedAt: string;
  reason: PluginDiagnosticsEventReason;
  pluginId: string;
  registrationState: PluginRegistrationState;
  ready: boolean;
  compatible: boolean;
  blockedReasons: string[];
  warnings: string[];
  issues: PluginContributionIssue[];
}

export interface PluginDiagnosticsState {
  diagnostics: PluginDiagnosticsRecord[];
  history: PluginDiagnosticsHistoryEntry[];
}
