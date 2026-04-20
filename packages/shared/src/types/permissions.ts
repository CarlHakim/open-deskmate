import type { FileOperation, PermissionRequest } from './permission';

export type PermissionPolicyAction = 'allow' | 'deny' | 'prompt';

export type PermissionPolicyDecisionSource =
  | 'task_allow_all'
  | 'agent_task_allow_all'
  | 'workspace_auto_allow'
  | 'agent_workspace_auto_allow'
  | 'file_default'
  | 'agent_file_default'
  | 'tool_allowlist'
  | 'agent_tool_allowlist'
  | 'tool_blocklist'
  | 'agent_tool_blocklist'
  | 'runtime_default'
  | 'agent_runtime_default'
  | 'question_default'
  | 'agent_question_default';

export interface PermissionPolicySettings {
  file: {
    allowWorkspaceWritesWithoutPrompt: boolean;
    allowTaskScopedAllowAll: boolean;
    defaultDecision: PermissionPolicyAction;
  };
  runtime: {
    defaultToolDecision: PermissionPolicyAction;
    defaultQuestionDecision: Exclude<PermissionPolicyAction, 'allow'> | 'allow';
    allowedToolNames: string[];
    blockedToolNames: string[];
  };
  audit: {
    maxEntries: number;
  };
}

export type OpenCodePermissionConfig = Record<string, string | Record<string, string>>;

export type OpenCodePermissionRuleSource =
  | 'global_default'
  | 'global_builtin_override'
  | 'agent_override'
  | 'fixed_app_rule';

export interface OpenCodePermissionRulePreview {
  rule: string;
  action: string;
  source: OpenCodePermissionRuleSource;
  reason: string;
}

export interface OpenCodePermissionPreview {
  globalRules: OpenCodePermissionConfig;
  targetAgentId?: string;
  targetAgentName?: string;
  targetAgentOverride?: OpenCodePermissionConfig | null;
  effectiveRules: OpenCodePermissionConfig;
  effectiveRuleSources: OpenCodePermissionRulePreview[];
}

export interface PermissionPolicyDecision {
  action: PermissionPolicyAction;
  source: PermissionPolicyDecisionSource;
  reason: string;
}

export type PermissionPolicyAuditOrigin = 'file-permission-api' | 'task-runtime' | 'desktop-runtime';

export interface PermissionPolicyAuditEntry {
  id: string;
  createdAt: string;
  origin: PermissionPolicyAuditOrigin;
  agentId?: string;
  taskId?: string;
  requestType: PermissionRequest['type'];
  toolName?: string;
  fileOperation?: FileOperation;
  filePath?: string;
  targetPath?: string;
  question?: string;
  decision: PermissionPolicyDecision;
}
