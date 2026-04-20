import type {
  AgentPermissionProfile,
  PermissionPolicyAuditEntry,
  PermissionPolicyDecision,
  PermissionPolicySettings,
  PermissionRequest,
} from '@accomplish/shared';
import { getAgent } from '../store/agents';
import { getPermissionPolicySettings } from './policy-store';

function normalizePathForCompare(p: string): string {
  const resolved = require('path').resolve(p);
  let canonical = resolved;
  try {
    canonical = require('fs').realpathSync.native(resolved);
  } catch {
    canonical = resolved;
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function isSubPath(candidatePath: string, parentDir: string): boolean {
  const path = require('path');
  const cand = normalizePathForCompare(candidatePath);
  const parent = normalizePathForCompare(parentDir);
  const rel = path.relative(parent, cand);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function includesTool(list: string[], toolName?: string): boolean {
  const normalized = String(toolName || '').trim().toLowerCase();
  if (!normalized) return false;
  return list.includes(normalized);
}

function getAgentPermissionProfile(agentId?: string): AgentPermissionProfile | undefined {
  const normalized = String(agentId || '').trim();
  if (!normalized) return undefined;
  const profile = getAgent(normalized)?.permissionProfile;
  if (!profile || profile.enabled === false) return undefined;
  return profile;
}

export function coercePermissionRequest(input: unknown): PermissionRequest | null {
  if (!input || typeof input !== 'object') return null;
  const request = input as PermissionRequest;
  if (!request.id || !request.taskId || !request.type) return null;
  return request;
}

export function evaluateFilePermissionPolicy(params: {
  taskId: string;
  agentId?: string;
  operation: string;
  filePath: string;
  targetPath?: string;
  workspaceRoot?: string | null;
  allowAllForTask?: boolean;
  settings?: PermissionPolicySettings;
}): PermissionPolicyDecision {
  const settings = params.settings ?? getPermissionPolicySettings();
  const profile = getAgentPermissionProfile(params.agentId);
  const allowTaskScopedAllowAll =
    profile?.file?.allowTaskScopedAllowAll ?? settings.file.allowTaskScopedAllowAll;
  const allowWorkspaceWritesWithoutPrompt =
    profile?.file?.allowWorkspaceWritesWithoutPrompt ?? settings.file.allowWorkspaceWritesWithoutPrompt;
  const defaultDecision = profile?.file?.defaultDecision ?? settings.file.defaultDecision;

  if (allowTaskScopedAllowAll && params.allowAllForTask) {
    return {
      action: 'allow',
      source: profile?.file?.allowTaskScopedAllowAll !== undefined ? 'agent_task_allow_all' : 'task_allow_all',
      reason: 'Task-scoped allow-all file policy is active.',
    };
  }

  const workspaceRoot = String(params.workspaceRoot || '').trim();
  const operation = String(params.operation || '').trim().toLowerCase();
  const needsTarget = operation === 'move' || operation === 'rename';
  const targetPath = String(params.targetPath || '').trim();

  if (
    allowWorkspaceWritesWithoutPrompt
    && workspaceRoot
    && isSubPath(params.filePath, workspaceRoot)
    && (!needsTarget || (targetPath && isSubPath(targetPath, workspaceRoot)))
  ) {
    return {
      action: 'allow',
      source: profile?.file?.allowWorkspaceWritesWithoutPrompt !== undefined ? 'agent_workspace_auto_allow' : 'workspace_auto_allow',
      reason: 'Workspace-scoped file operation is allowed without prompting.',
    };
  }

  if (defaultDecision === 'deny') {
    return {
      action: 'deny',
      source: profile?.file?.defaultDecision ? 'agent_file_default' : 'file_default',
      reason: 'Default file permission policy is set to deny.',
    };
  }

  if (defaultDecision === 'allow') {
    return {
      action: 'allow',
      source: profile?.file?.defaultDecision ? 'agent_file_default' : 'file_default',
      reason: 'Default file permission policy is set to allow.',
    };
  }

  return {
    action: 'prompt',
    source: profile?.file?.defaultDecision ? 'agent_file_default' : 'file_default',
    reason: 'File operation requires explicit approval.',
  };
}

export function evaluateInteractivePermissionPolicy(
  request: PermissionRequest,
  settings = getPermissionPolicySettings(),
  agentId?: string
): PermissionPolicyDecision {
  const profile = getAgentPermissionProfile(agentId);
  if (request.type === 'tool') {
    if (includesTool(profile?.runtime?.blockedToolNames ?? [], request.toolName)) {
      return {
        action: 'deny',
        source: 'agent_tool_blocklist',
        reason: `Tool ${request.toolName} is blocked by the active agent permission profile.`,
      };
    }

    if (includesTool(profile?.runtime?.allowedToolNames ?? [], request.toolName)) {
      return {
        action: 'allow',
        source: 'agent_tool_allowlist',
        reason: `Tool ${request.toolName} is allowed by the active agent permission profile.`,
      };
    }

    if (includesTool(settings.runtime.blockedToolNames, request.toolName)) {
      return {
        action: 'deny',
        source: 'tool_blocklist',
        reason: `Tool ${request.toolName} is blocked by permission policy.`,
      };
    }

    if (includesTool(settings.runtime.allowedToolNames, request.toolName)) {
      return {
        action: 'allow',
        source: 'tool_allowlist',
        reason: `Tool ${request.toolName} is allowed by permission policy.`,
      };
    }

    const defaultToolDecision = profile?.runtime?.defaultToolDecision ?? settings.runtime.defaultToolDecision;
    return {
      action: defaultToolDecision,
      source: profile?.runtime?.defaultToolDecision ? 'agent_runtime_default' : 'runtime_default',
      reason:
        defaultToolDecision === 'allow'
          ? 'Default runtime tool policy is set to allow.'
          : defaultToolDecision === 'deny'
            ? 'Default runtime tool policy is set to deny.'
            : 'Runtime tool request requires explicit approval.',
    };
  }

  if (request.type === 'question') {
    const defaultQuestionDecision =
      profile?.runtime?.defaultQuestionDecision ?? settings.runtime.defaultQuestionDecision;
    return {
      action: defaultQuestionDecision,
      source: profile?.runtime?.defaultQuestionDecision ? 'agent_question_default' : 'question_default',
      reason:
        defaultQuestionDecision === 'deny'
          ? 'Default runtime question policy is set to deny.'
          : defaultQuestionDecision === 'allow'
            ? 'Default runtime question policy is set to allow.'
            : 'Runtime question requires explicit approval.',
    };
  }

  return {
    action: 'prompt',
    source: 'runtime_default',
    reason: 'Permission request requires explicit approval.',
  };
}

export function createPermissionPolicyAuditEntry(params: {
  origin: PermissionPolicyAuditEntry['origin'];
  agentId?: string;
  request: PermissionRequest | {
    taskId?: string;
    type: PermissionRequest['type'];
    toolName?: string;
    question?: string;
    fileOperation?: PermissionRequest['fileOperation'];
    filePath?: string;
    targetPath?: string;
  };
  decision: PermissionPolicyDecision;
}): PermissionPolicyAuditEntry {
  const request = params.request;
  return {
    id: `perm_policy_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    origin: params.origin,
    agentId: params.agentId,
    taskId: request.taskId,
    requestType: request.type,
    toolName: request.toolName,
    fileOperation: request.fileOperation,
    filePath: request.filePath,
    targetPath: request.targetPath,
    question: request.question,
    decision: params.decision,
  };
}
