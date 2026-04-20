import Store from 'electron-store';
import type {
  BuildStartEntry,
  BuildEnvProfile,
  BuildProjectPreset,
  BuildProjectPresetInput,
  BuildProjectPresetListResult,
} from '@accomplish/shared';

interface BuildModePresetsStoreSchema {
  presets: BuildProjectPreset[];
  activePresetByAgent: Record<string, string>;
}

const store = new Store<BuildModePresetsStoreSchema>({
  name: 'build-mode-presets',
  defaults: {
    presets: [],
    activePresetByAgent: {},
  },
});

function normalizeId(input: string, fallback = 'preset'): string {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeText(input: unknown, fallback = ''): string {
  if (typeof input !== 'string') return fallback;
  return input.trim();
}

function normalizeEnvProfiles(value: unknown): BuildEnvProfile[] {
  if (!Array.isArray(value)) return [];
  const next: BuildEnvProfile[] = [];
  const usedIds = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<BuildEnvProfile>;
    const baseId = normalizeId(String(raw.id || raw.name || 'env'), 'env');
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const name = normalizeText(raw.name, id).slice(0, 80) || id;
    const variables: Record<string, string> = {};
    if (raw.variables && typeof raw.variables === 'object') {
      for (const [key, val] of Object.entries(raw.variables)) {
        const cleanKey = normalizeEnvKey(key);
        if (!cleanKey) continue;
        variables[cleanKey] = typeof val === 'string' ? val : String(val ?? '');
      }
    }

    next.push({ id, name, variables });
  }

  return next;
}

function normalizeEnvKey(input: string): string {
  const key = String(input || '').trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return '';
  return key;
}

function normalizeStartEntries(value: unknown): BuildStartEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: BuildStartEntry[] = [];
  for (const rawEntry of value) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    const command = normalizeText(entry.command);
    if (!command) continue;
    const workspaceRelativePath = normalizeText(entry.workspaceRelativePath);
    const role = entry.role === 'worker'
      ? ('worker' as const)
      : entry.role === 'preview'
        ? ('preview' as const)
        : undefined;
    entries.push({
      command,
      workspaceRelativePath: workspaceRelativePath || undefined,
      role,
    });
  }

  if (entries.length === 0) return undefined;

  let previewAssigned = false;
  return entries.map((entry, index) => {
    if (entry.role === 'preview') {
      previewAssigned = true;
      return entry;
    }
    if (!previewAssigned && index === 0) {
      previewAssigned = true;
      return { ...entry, role: 'preview' };
    }
    return { ...entry, role: entry.role || 'worker' };
  });
}

function resolveUniquePresetId(agentId: string, baseId: string, existing: BuildProjectPreset[]): string {
  const normalizedBase = normalizeId(baseId, 'preset');
  const ids = new Set(existing.filter((entry) => entry.agentId === agentId).map((entry) => entry.id));
  if (!ids.has(normalizedBase)) return normalizedBase;
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${normalizedBase}-${i}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString().slice(-6)}`;
}

function listAllPresets(): BuildProjectPreset[] {
  const presets = store.get('presets') ?? [];
  if (!Array.isArray(presets)) return [];

  let mutated = false;
  const hydrated = presets
    .filter((entry): entry is BuildProjectPreset => Boolean(entry && typeof entry === 'object'))
    .map((entry) => {
      const agentId = normalizeId(entry.agentId || 'main', 'main');
      const commands = {
        startCommand: normalizeText(entry.commands?.startCommand) || undefined,
        startEntries: normalizeStartEntries(entry.commands?.startEntries)
          || (normalizeText(entry.commands?.startCommand)
            ? [{ command: normalizeText(entry.commands?.startCommand), role: 'preview' as const }]
            : undefined),
        buildCommand: normalizeText(entry.commands?.buildCommand) || undefined,
        runCommand: normalizeText(entry.commands?.runCommand) || undefined,
      };
      const envProfiles = normalizeEnvProfiles(entry.envProfiles);
      const activeEnvProfileId = normalizeId(entry.activeEnvProfileId || '', '') || undefined;
      const next: BuildProjectPreset = {
        id: normalizeId(entry.id || 'preset', 'preset'),
        agentId,
        name: normalizeText(entry.name, 'Build preset').slice(0, 120) || 'Build preset',
        workspaceRelativePath: normalizeText(entry.workspaceRelativePath, '.').slice(0, 300) || '.',
        commands,
        envProfiles,
        activeEnvProfileId,
        createdAt: normalizeText(entry.createdAt, new Date().toISOString()) || new Date().toISOString(),
        updatedAt: normalizeText(entry.updatedAt, new Date().toISOString()) || new Date().toISOString(),
      };

      if (
        next.id !== entry.id
        || next.agentId !== entry.agentId
        || next.name !== entry.name
        || next.workspaceRelativePath !== entry.workspaceRelativePath
        || next.commands.startCommand !== entry.commands?.startCommand
        || JSON.stringify(next.commands.startEntries || []) !== JSON.stringify(entry.commands?.startEntries || [])
        || next.commands.buildCommand !== entry.commands?.buildCommand
        || next.commands.runCommand !== entry.commands?.runCommand
        || JSON.stringify(next.envProfiles) !== JSON.stringify(entry.envProfiles || [])
        || next.activeEnvProfileId !== entry.activeEnvProfileId
      ) {
        mutated = true;
      }

      return next;
    });

  if (mutated) {
    store.set('presets', hydrated);
  }

  return hydrated;
}

export function listBuildModePresets(agentId: string): BuildProjectPresetListResult {
  const normalizedAgentId = normalizeId(agentId, 'main');
  const presets = listAllPresets().filter((entry) => entry.agentId === normalizedAgentId);
  const activePresetByAgent = store.get('activePresetByAgent') ?? {};
  const activePresetId = normalizeId(activePresetByAgent[normalizedAgentId] || '', '') || undefined;
  const hasActive = activePresetId ? presets.some((entry) => entry.id === activePresetId) : false;
  return {
    presets,
    activePresetId: hasActive ? activePresetId : undefined,
  };
}

export function upsertBuildModePreset(input: BuildProjectPresetInput): BuildProjectPreset {
  const all = listAllPresets();
  const agentId = normalizeId(input.agentId || 'main', 'main');
  const now = new Date().toISOString();
  const normalizedInputId = normalizeId(input.id || '', '');
  const existing = normalizedInputId
    ? all.find((entry) => entry.agentId === agentId && entry.id === normalizedInputId)
    : undefined;

  const id = existing
    ? existing.id
    : resolveUniquePresetId(agentId, normalizedInputId || input.name || 'preset', all);

  const commands = {
    startCommand: normalizeText(input.commands?.startCommand) || undefined,
    startEntries: normalizeStartEntries(input.commands?.startEntries)
      || (normalizeText(input.commands?.startCommand)
        ? [{ command: normalizeText(input.commands?.startCommand), role: 'preview' as const }]
        : undefined),
    buildCommand: normalizeText(input.commands?.buildCommand) || undefined,
    runCommand: normalizeText(input.commands?.runCommand) || undefined,
  };

  const envProfiles = normalizeEnvProfiles(input.envProfiles ?? existing?.envProfiles ?? []);
  const fallbackEnvId = envProfiles[0]?.id;
  const requestedActiveEnv = normalizeId(input.activeEnvProfileId || existing?.activeEnvProfileId || '', '') || undefined;
  const activeEnvProfileId = requestedActiveEnv && envProfiles.some((entry) => entry.id === requestedActiveEnv)
    ? requestedActiveEnv
    : fallbackEnvId;

  const preset: BuildProjectPreset = {
    id,
    agentId,
    name: normalizeText(input.name, existing?.name || 'Build preset').slice(0, 120) || 'Build preset',
    workspaceRelativePath: normalizeText(input.workspaceRelativePath, existing?.workspaceRelativePath || '.').slice(0, 300) || '.',
    commands,
    envProfiles,
    activeEnvProfileId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const next = all.filter((entry) => !(entry.agentId === agentId && entry.id === id));
  next.push(preset);
  store.set('presets', next);

  return preset;
}

export function deleteBuildModePreset(agentId: string, presetId: string): { ok: boolean } {
  const normalizedAgentId = normalizeId(agentId, 'main');
  const normalizedPresetId = normalizeId(presetId, '');
  const all = listAllPresets();
  const next = all.filter((entry) => !(entry.agentId === normalizedAgentId && entry.id === normalizedPresetId));
  store.set('presets', next);

  const active = { ...(store.get('activePresetByAgent') ?? {}) };
  if (active[normalizedAgentId] === normalizedPresetId) {
    delete active[normalizedAgentId];
    store.set('activePresetByAgent', active);
  }

  return { ok: true };
}

export function setActiveBuildModePreset(agentId: string, presetId?: string | null): { activePresetId?: string } {
  const normalizedAgentId = normalizeId(agentId, 'main');
  const normalizedPresetId = normalizeId(presetId || '', '') || undefined;

  const all = listAllPresets().filter((entry) => entry.agentId === normalizedAgentId);
  if (normalizedPresetId && !all.some((entry) => entry.id === normalizedPresetId)) {
    throw new Error('Preset not found for this agent.');
  }

  const active = { ...(store.get('activePresetByAgent') ?? {}) };
  if (normalizedPresetId) {
    active[normalizedAgentId] = normalizedPresetId;
  } else {
    delete active[normalizedAgentId];
  }
  store.set('activePresetByAgent', active);
  return { activePresetId: normalizedPresetId };
}
