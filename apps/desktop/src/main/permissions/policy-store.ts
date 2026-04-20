import Store from 'electron-store';
import type {
  PermissionPolicyAuditEntry,
  PermissionPolicySettings,
} from '@accomplish/shared';

type PermissionPolicyStoreSchema = {
  settings: PermissionPolicySettings;
};

const DEFAULT_PERMISSION_POLICY_SETTINGS: PermissionPolicySettings = {
  file: {
    allowWorkspaceWritesWithoutPrompt: true,
    allowTaskScopedAllowAll: true,
    defaultDecision: 'prompt',
  },
  runtime: {
    defaultToolDecision: 'prompt',
    defaultQuestionDecision: 'prompt',
    allowedToolNames: [],
    blockedToolNames: [],
  },
  audit: {
    maxEntries: 200,
  },
};

const permissionPolicyStore = new Store<PermissionPolicyStoreSchema>({
  name: 'permission-policy',
  defaults: {
    settings: DEFAULT_PERMISSION_POLICY_SETTINGS,
  },
});

const permissionPolicyAuditEntries: PermissionPolicyAuditEntry[] = [];

function normalizeDecision(input: unknown): 'allow' | 'deny' | 'prompt' {
  return input === 'allow' || input === 'deny' || input === 'prompt' ? input : 'prompt';
}

function normalizeToolList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter(Boolean)
    )
  );
}

function sanitizeSettings(input: unknown): PermissionPolicySettings {
  const value = (input && typeof input === 'object') ? (input as Partial<PermissionPolicySettings>) : {};
  const file = (value.file && typeof value.file === 'object')
    ? (value.file as Partial<PermissionPolicySettings['file']>)
    : {};
  const runtime = (value.runtime && typeof value.runtime === 'object')
    ? (value.runtime as Partial<PermissionPolicySettings['runtime']>)
    : {};
  const audit = (value.audit && typeof value.audit === 'object')
    ? (value.audit as Partial<PermissionPolicySettings['audit']>)
    : {};

  const maxEntriesRaw = typeof audit.maxEntries === 'number' && Number.isFinite(audit.maxEntries)
    ? Math.floor(audit.maxEntries)
    : DEFAULT_PERMISSION_POLICY_SETTINGS.audit.maxEntries;

  return {
    file: {
      allowWorkspaceWritesWithoutPrompt:
        typeof file.allowWorkspaceWritesWithoutPrompt === 'boolean'
          ? file.allowWorkspaceWritesWithoutPrompt
          : DEFAULT_PERMISSION_POLICY_SETTINGS.file.allowWorkspaceWritesWithoutPrompt,
      allowTaskScopedAllowAll:
        typeof file.allowTaskScopedAllowAll === 'boolean'
          ? file.allowTaskScopedAllowAll
          : DEFAULT_PERMISSION_POLICY_SETTINGS.file.allowTaskScopedAllowAll,
      defaultDecision: normalizeDecision(file.defaultDecision),
    },
    runtime: {
      defaultToolDecision: normalizeDecision(runtime.defaultToolDecision),
      defaultQuestionDecision: normalizeDecision(runtime.defaultQuestionDecision),
      allowedToolNames: normalizeToolList(runtime.allowedToolNames),
      blockedToolNames: normalizeToolList(runtime.blockedToolNames),
    },
    audit: {
      maxEntries: Math.max(10, Math.min(1000, maxEntriesRaw)),
    },
  };
}

export function getPermissionPolicySettings(): PermissionPolicySettings {
  return sanitizeSettings(permissionPolicyStore.get('settings'));
}

export function setPermissionPolicySettings(settings: PermissionPolicySettings): PermissionPolicySettings {
  const sanitized = sanitizeSettings(settings);
  permissionPolicyStore.set('settings', sanitized);
  trimPermissionPolicyAuditEntries(sanitized.audit.maxEntries);
  return sanitized;
}

export function trimPermissionPolicyAuditEntries(maxEntries = getPermissionPolicySettings().audit.maxEntries): void {
  if (permissionPolicyAuditEntries.length <= maxEntries) return;
  permissionPolicyAuditEntries.splice(0, permissionPolicyAuditEntries.length - maxEntries);
}

export function recordPermissionPolicyAuditEntry(entry: PermissionPolicyAuditEntry): void {
  permissionPolicyAuditEntries.push(entry);
  trimPermissionPolicyAuditEntries();
}

export function listPermissionPolicyAuditEntries(): PermissionPolicyAuditEntry[] {
  return permissionPolicyAuditEntries.slice().reverse();
}

export function clearPermissionPolicyAuditEntries(): void {
  permissionPolicyAuditEntries.length = 0;
}
