import Store from 'electron-store';
import fs from 'fs';
import type {
  CloudWorkerExecutionProfileSettings,
  DockerExecutionProfileSettings,
  ExecutionProfile,
  ExecutionProfileCreateInput,
  ExecutionProfileHealth,
  ExecutionProfileKind,
  ExecutionProfileListResult,
  ExecutionProfileSettings,
  ExecutionProfileUpdateInput,
  LocalWindowsExecutionProfileSettings,
  SshExecutionProfileSettings,
} from '@accomplish/shared';

type StoredExecutionProfile = Omit<ExecutionProfile, 'health'>;

interface ExecutionProfilesStoreSchema {
  profiles: StoredExecutionProfile[];
  healthByProfileId: Record<string, ExecutionProfileHealth>;
}

const DEFAULT_LOCAL_WINDOWS_PROFILE_ID = 'local-windows';

const store = new Store<ExecutionProfilesStoreSchema>({
  name: 'execution-profiles',
  defaults: {
    profiles: [],
    healthByProfileId: {},
  },
});

const SECRET_FIELD_RE = /(?:password|passphrase|token|secret|api[_-]?key|private[_-]?key)/i;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeId(input: unknown, fallback = 'profile'): string {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeText(input: unknown, fallback = '', maxLength = 200): string {
  if (input === null || input === undefined) return fallback;
  if (typeof input !== 'string') {
    throw new Error('Execution profile field must be a string.');
  }
  return input.trim().slice(0, maxLength);
}

function normalizeOptionalText(input: unknown, maxLength = 200): string | undefined {
  const value = normalizeText(input, '', maxLength);
  return value || undefined;
}

function normalizeOptionalPath(input: unknown): string | null | undefined {
  if (input === null) return null;
  const value = normalizeOptionalText(input, 500);
  return value;
}

function normalizeOptionalReference(input: unknown): string | null | undefined {
  if (input === null) return null;
  const value = normalizeOptionalText(input, 300);
  if (!value) return undefined;
  if (SECRET_FIELD_RE.test(value)) {
    throw new Error('Execution profile auth references cannot contain secret-looking values.');
  }
  return value;
}

function normalizeKind(input: unknown): ExecutionProfileKind {
  if (
    input === 'local_windows'
    || input === 'ssh'
    || input === 'docker'
    || input === 'cloud_worker'
  ) {
    return input;
  }
  throw new Error('Execution profile kind must be local_windows, ssh, docker, or cloud_worker.');
}

function assertNoSecretFields(value: unknown, path = 'settings'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_RE.test(key)) {
      throw new Error(`Execution profiles cannot store secrets (${path}.${key}).`);
    }
    assertNoSecretFields(child, `${path}.${key}`);
  }
}

function normalizePort(input: unknown, fallback = 22): number {
  const raw = input === undefined || input === null || input === '' ? fallback : Number(input);
  if (!Number.isFinite(raw) || raw < 1 || raw > 65535) {
    throw new Error('SSH port must be between 1 and 65535.');
  }
  return Math.floor(raw);
}

function normalizeWorkerUrl(input: unknown): string {
  const value = normalizeText(input, '', 1024);
  if (!value) {
    throw new Error('Cloud worker URL is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Cloud worker URL must be a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Cloud worker URL must use http or https.');
  }
  return parsed.toString();
}

function createDefaultLocalWindowsProfile(timestamp = nowIso()): StoredExecutionProfile {
  return {
    id: DEFAULT_LOCAL_WINDOWS_PROFILE_ID,
    name: 'Local Windows',
    kind: 'local_windows',
    settings: {
      kind: 'local_windows',
      shell: 'powershell',
      workspaceRoot: null,
    },
    isDefault: true,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeSettings(
  kind: ExecutionProfileKind,
  input: unknown,
  existing?: ExecutionProfileSettings
): ExecutionProfileSettings {
  assertNoSecretFields(input);
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  if (kind === 'local_windows') {
    const fallback = existing?.kind === 'local_windows' ? existing : undefined;
    const shell = source.shell === 'cmd' ? 'cmd' : fallback?.shell || 'powershell';
    const workspaceRoot = Object.prototype.hasOwnProperty.call(source, 'workspaceRoot')
      ? normalizeOptionalPath(source.workspaceRoot) ?? null
      : fallback?.workspaceRoot ?? null;
    const settings: LocalWindowsExecutionProfileSettings = {
      kind: 'local_windows',
      shell,
      workspaceRoot,
    };
    return settings;
  }

  if (kind === 'ssh') {
    const fallback = existing?.kind === 'ssh' ? existing : undefined;
    const host = normalizeText(source.host ?? fallback?.host, '', 255);
    if (!host) {
      throw new Error('SSH host is required.');
    }
    const settings: SshExecutionProfileSettings = {
      kind: 'ssh',
      host,
      port: normalizePort(source.port ?? fallback?.port),
      username: normalizeOptionalText(source.username ?? fallback?.username, 128),
      workspaceRoot: Object.prototype.hasOwnProperty.call(source, 'workspaceRoot')
        ? normalizeOptionalPath(source.workspaceRoot) ?? null
        : fallback?.workspaceRoot ?? null,
      authReference: Object.prototype.hasOwnProperty.call(source, 'authReference')
        ? normalizeOptionalReference(source.authReference) ?? null
        : fallback?.authReference ?? null,
    };
    return settings;
  }

  if (kind === 'docker') {
    const fallback = existing?.kind === 'docker' ? existing : undefined;
    const image = normalizeText(source.image ?? fallback?.image, '', 300);
    if (!image) {
      throw new Error('Docker image is required.');
    }
    const settings: DockerExecutionProfileSettings = {
      kind: 'docker',
      image,
      dockerContext: normalizeOptionalText(source.dockerContext ?? fallback?.dockerContext, 128),
      containerName: normalizeOptionalText(source.containerName ?? fallback?.containerName, 128),
      workspaceRoot: Object.prototype.hasOwnProperty.call(source, 'workspaceRoot')
        ? normalizeOptionalPath(source.workspaceRoot) ?? null
        : fallback?.workspaceRoot ?? null,
      workingDir: normalizeOptionalText(source.workingDir ?? fallback?.workingDir, 300),
    };
    return settings;
  }

  const fallback = existing?.kind === 'cloud_worker' ? existing : undefined;
  const settings: CloudWorkerExecutionProfileSettings = {
    kind: 'cloud_worker',
    providerLabel: normalizeOptionalText(source.providerLabel ?? fallback?.providerLabel, 120),
    workerUrl: normalizeWorkerUrl(source.workerUrl ?? fallback?.workerUrl),
    region: normalizeOptionalText(source.region ?? fallback?.region, 120),
    workspaceRoot: Object.prototype.hasOwnProperty.call(source, 'workspaceRoot')
      ? normalizeOptionalPath(source.workspaceRoot) ?? null
      : fallback?.workspaceRoot ?? null,
    authReference: Object.prototype.hasOwnProperty.call(source, 'authReference')
      ? normalizeOptionalReference(source.authReference) ?? null
      : fallback?.authReference ?? null,
  };
  return settings;
}

function normalizeStoredProfile(input: StoredExecutionProfile): StoredExecutionProfile | null {
  try {
    const kind = normalizeKind(input.kind);
    const id = normalizeId(input.id, kind === 'local_windows' ? DEFAULT_LOCAL_WINDOWS_PROFILE_ID : 'profile');
    const name = normalizeText(input.name, kind === 'local_windows' ? 'Local Windows' : 'Execution profile', 120)
      || (kind === 'local_windows' ? 'Local Windows' : 'Execution profile');
    const settings = normalizeSettings(kind, input.settings);
    return {
      id,
      name,
      kind,
      settings,
      isDefault: input.isDefault === true,
      archived: input.archived === true,
      createdAt: normalizeText(input.createdAt, nowIso(), 64) || nowIso(),
      updatedAt: normalizeText(input.updatedAt, nowIso(), 64) || nowIso(),
    };
  } catch {
    return null;
  }
}

function listStoredProfiles(): StoredExecutionProfile[] {
  const rawProfiles = store.get('profiles') ?? [];
  const timestamp = nowIso();
  const profiles = Array.isArray(rawProfiles)
    ? rawProfiles
        .filter((entry): entry is StoredExecutionProfile => Boolean(entry && typeof entry === 'object'))
        .map(normalizeStoredProfile)
        .filter((entry): entry is StoredExecutionProfile => Boolean(entry))
    : [];

  const byId = new Map<string, StoredExecutionProfile>();
  for (const profile of profiles) {
    byId.set(profile.id, profile);
  }

  const local = byId.get(DEFAULT_LOCAL_WINDOWS_PROFILE_ID);
  if (!local || local.kind !== 'local_windows') {
    byId.set(DEFAULT_LOCAL_WINDOWS_PROFILE_ID, createDefaultLocalWindowsProfile(timestamp));
  } else if (local.archived) {
    byId.set(DEFAULT_LOCAL_WINDOWS_PROFILE_ID, {
      ...local,
      archived: false,
      updatedAt: timestamp,
    });
  }

  const all = Array.from(byId.values());
  const activeDefaults = all.filter((profile) => profile.isDefault && !profile.archived);
  const defaultId = activeDefaults[0]?.id || DEFAULT_LOCAL_WINDOWS_PROFILE_ID;
  const normalized = all.map((profile) => ({
    ...profile,
    isDefault: profile.id === defaultId,
  }));

  if (JSON.stringify(normalized) !== JSON.stringify(rawProfiles)) {
    store.set('profiles', normalized);
  }

  return normalized;
}

function getStoredHealth(profileId: string): ExecutionProfileHealth | undefined {
  const healthByProfileId = store.get('healthByProfileId') ?? {};
  const health = healthByProfileId[profileId];
  if (!health || typeof health !== 'object') return undefined;
  return health;
}

function persistHealth(profileId: string, health: ExecutionProfileHealth): ExecutionProfileHealth {
  const healthByProfileId = store.get('healthByProfileId') ?? {};
  store.set('healthByProfileId', {
    ...healthByProfileId,
    [profileId]: health,
  });
  return health;
}

function getProfileHealth(profile: StoredExecutionProfile): ExecutionProfileHealth {
  if (profile.archived) {
    return {
      status: 'not_checked',
      message: 'Archived profile. Health checks are disabled.',
      blocking: true,
    };
  }
  if (profile.kind === 'local_windows') {
    const settings = profile.settings as LocalWindowsExecutionProfileSettings;
    const workspaceRoot = settings.workspaceRoot;
    if (workspaceRoot && !fs.existsSync(workspaceRoot)) {
      return {
        status: 'error',
        message: 'Configured local workspace root does not exist.',
        blocking: true,
        details: [workspaceRoot],
      };
    }
    return {
      status: 'ready',
      message: 'Local Windows execution is the current runtime.',
      checkedAt: nowIso(),
      blocking: false,
    };
  }
  return getStoredHealth(profile.id) ?? {
    status: 'not_checked',
    message: 'Remote profile has not passed a health check yet.',
    blocking: true,
  };
}

function toExecutionProfile(profile: StoredExecutionProfile): ExecutionProfile {
  return {
    ...profile,
    health: getProfileHealth(profile),
  };
}

function resolveUniqueProfileId(baseId: string, existing: StoredExecutionProfile[]): string {
  const normalizedBase = normalizeId(baseId, 'profile');
  const ids = new Set(existing.map((entry) => entry.id));
  if (!ids.has(normalizedBase)) return normalizedBase;
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${normalizedBase}-${i}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString().slice(-6)}`;
}

function persistWithSingleDefault(profiles: StoredExecutionProfile[], defaultProfileId?: string): StoredExecutionProfile[] {
  const activeDefaultId = defaultProfileId
    || profiles.find((profile) => profile.isDefault && !profile.archived)?.id
    || DEFAULT_LOCAL_WINDOWS_PROFILE_ID;
  const next = profiles.map((profile) => ({
    ...profile,
    isDefault: profile.id === activeDefaultId && !profile.archived,
  }));
  store.set('profiles', next);
  return next;
}

export function listExecutionProfiles(options: { includeArchived?: boolean } = {}): ExecutionProfileListResult {
  const profiles = listStoredProfiles();
  const visible = options.includeArchived
    ? profiles
    : profiles.filter((profile) => !profile.archived);
  const defaultProfileId =
    profiles.find((profile) => profile.isDefault && !profile.archived)?.id || DEFAULT_LOCAL_WINDOWS_PROFILE_ID;
  return {
    profiles: visible.map(toExecutionProfile),
    defaultProfileId,
  };
}

export function getExecutionProfile(profileId: string): ExecutionProfile | null {
  const normalizedId = normalizeId(profileId, '');
  const profile = listStoredProfiles().find((entry) => entry.id === normalizedId);
  return profile ? toExecutionProfile(profile) : null;
}

export function checkExecutionProfileHealth(profileId: string): ExecutionProfile {
  const normalizedId = normalizeId(profileId, '');
  const profile = listStoredProfiles().find((entry) => entry.id === normalizedId);
  if (!profile) {
    throw new Error('Execution profile not found.');
  }
  if (profile.kind === 'local_windows') {
    return toExecutionProfile(profile);
  }

  const details: string[] = [];
  let message = 'Remote execution profile is configured but no remote runner has been verified.';
  if (profile.kind === 'ssh') {
    const settings = profile.settings as SshExecutionProfileSettings;
    details.push(`Host: ${settings.host}:${settings.port}`);
    if (settings.username) details.push(`User: ${settings.username}`);
    if (settings.authReference) details.push(`Auth reference: ${settings.authReference}`);
    message = settings.authReference
      ? 'SSH profile is waiting for runtime routing verification before it can run Build actions.'
      : 'SSH profile needs a system SSH setup or external auth reference before it can run Build actions.';
  } else if (profile.kind === 'docker') {
    const settings = profile.settings as DockerExecutionProfileSettings;
    details.push(`Image: ${settings.image}`);
    if (settings.dockerContext) details.push(`Context: ${settings.dockerContext}`);
    message = 'Docker profile is waiting for runtime routing verification before it can run Build actions.';
  } else if (profile.kind === 'cloud_worker') {
    const settings = profile.settings as CloudWorkerExecutionProfileSettings;
    details.push(`Worker: ${settings.workerUrl}`);
    if (settings.authReference) details.push(`Auth reference: ${settings.authReference}`);
    message = 'Cloud worker profile is waiting for worker protocol verification before it can run Build actions.';
  }

  const health = persistHealth(profile.id, {
    status: 'error',
    message,
    checkedAt: nowIso(),
    blocking: true,
    details,
  });
  return {
    ...profile,
    health,
  };
}

export function assertExecutionProfileRunnable(profileId?: string | null): ExecutionProfile {
  const normalizedId = normalizeId(profileId || DEFAULT_LOCAL_WINDOWS_PROFILE_ID, DEFAULT_LOCAL_WINDOWS_PROFILE_ID);
  const profile = getExecutionProfile(normalizedId);
  if (!profile) {
    throw new Error('Execution profile not found.');
  }
  if (profile.archived) {
    throw new Error(`Execution profile "${profile.name}" is archived.`);
  }
  if (profile.health.status !== 'ready' || profile.health.blocking) {
    throw new Error(`Execution profile "${profile.name}" is not ready: ${profile.health.message}`);
  }
  return profile;
}

export function createExecutionProfile(input: ExecutionProfileCreateInput): ExecutionProfile {
  const all = listStoredProfiles();
  const kind = normalizeKind(input?.kind);
  const name = normalizeText(input?.name, '', 120);
  if (!name) {
    throw new Error('Execution profile name is required.');
  }

  const requestedId = normalizeId(input?.id || name, 'profile');
  const id = kind === 'local_windows' && requestedId === DEFAULT_LOCAL_WINDOWS_PROFILE_ID
    ? DEFAULT_LOCAL_WINDOWS_PROFILE_ID
    : resolveUniqueProfileId(requestedId, all);
  if (all.some((profile) => profile.id === id)) {
    throw new Error('Execution profile already exists.');
  }

  const timestamp = nowIso();
  const profile: StoredExecutionProfile = {
    id,
    name,
    kind,
    settings: normalizeSettings(kind, input?.settings),
    isDefault: input?.isDefault === true,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const next = persistWithSingleDefault([...all, profile], profile.isDefault ? profile.id : undefined);
  return toExecutionProfile(next.find((entry) => entry.id === id) || profile);
}

export function updateExecutionProfile(profileId: string, input: ExecutionProfileUpdateInput): ExecutionProfile {
  const all = listStoredProfiles();
  const id = normalizeId(profileId, '');
  const existing = all.find((profile) => profile.id === id);
  if (!existing) {
    throw new Error('Execution profile not found.');
  }

  const kind = input?.kind ? normalizeKind(input.kind) : existing.kind;
  if (existing.id === DEFAULT_LOCAL_WINDOWS_PROFILE_ID && kind !== 'local_windows') {
    throw new Error('The default local Windows execution profile kind cannot be changed.');
  }
  const name = input?.name !== undefined
    ? normalizeText(input.name, existing.name, 120)
    : existing.name;
  if (!name) {
    throw new Error('Execution profile name is required.');
  }

  const settingsInput = input?.settings === undefined ? existing.settings : input.settings;
  const updated: StoredExecutionProfile = {
    ...existing,
    name,
    kind,
    settings: normalizeSettings(kind, settingsInput, kind === existing.kind ? existing.settings : undefined),
    isDefault: input?.isDefault === true ? true : existing.isDefault,
    updatedAt: nowIso(),
  };

  const nextProfiles = all.map((profile) => (profile.id === id ? updated : profile));
  const next = persistWithSingleDefault(nextProfiles, updated.isDefault ? updated.id : undefined);
  return toExecutionProfile(next.find((profile) => profile.id === id) || updated);
}

export function archiveExecutionProfile(profileId: string, archived = true): ExecutionProfile {
  const all = listStoredProfiles();
  const id = normalizeId(profileId, '');
  const existing = all.find((profile) => profile.id === id);
  if (!existing) {
    throw new Error('Execution profile not found.');
  }
  if (id === DEFAULT_LOCAL_WINDOWS_PROFILE_ID && archived) {
    throw new Error('The default local Windows execution profile cannot be archived.');
  }
  if (existing.isDefault && archived) {
    throw new Error('The default execution profile cannot be archived.');
  }

  const updated: StoredExecutionProfile = {
    ...existing,
    archived,
    updatedAt: nowIso(),
  };
  const next = persistWithSingleDefault(all.map((profile) => (profile.id === id ? updated : profile)));
  return toExecutionProfile(next.find((profile) => profile.id === id) || updated);
}

export function clearExecutionProfiles(): void {
  store.set('profiles', []);
  store.set('healthByProfileId', {});
}

export { DEFAULT_LOCAL_WINDOWS_PROFILE_ID };
