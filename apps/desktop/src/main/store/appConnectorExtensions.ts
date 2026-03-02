import Store from 'electron-store';
import {
  APP_CONNECTOR_EXTENSION_CATALOG,
  type AppConnectorExtensionConfig,
  type AppConnectorExtensionConfigInput,
  type AppConnectorExtensionDefinition,
  type AppConnectorExtensionId,
} from '@accomplish/shared';

interface AppConnectorExtensionsSchema {
  configs: Record<string, AppConnectorExtensionConfig>;
}

const appConnectorExtensionsStore = new Store<AppConnectorExtensionsSchema>({
  name: 'app-connector-extensions',
  defaults: {
    configs: {},
  },
});

const DEFAULT_INSTANCE_ID = 'default';

const definitionById = new Map(
  APP_CONNECTOR_EXTENSION_CATALOG.map((definition) => [definition.id, definition] as const)
);

function normalizeText(value: string | undefined | null): string | undefined {
  const normalized = (value ?? '').trim();
  return normalized || undefined;
}

function normalizeMetadata(input: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const entries = Object.entries(input)
    .map(([key, value]) => [String(key).trim(), String(value).trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function normalizeConnectorBaseUrl(
  connectorId: AppConnectorExtensionId,
  value: string | undefined | null
): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  if (connectorId !== 'notion') return normalized;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const looksOAuthUrl =
      pathname.includes('/oauth/')
      || pathname.includes('/install-integration')
      || host === 'www.notion.so';
    if (looksOAuthUrl) {
      const fallback = definitionById.get('notion')?.defaultBaseUrl;
      return normalizeText(fallback) ?? 'https://api.notion.com/v1';
    }
    if (host === 'api.notion.com' && !pathname.startsWith('/v1')) {
      const fallback = definitionById.get('notion')?.defaultBaseUrl;
      return normalizeText(fallback) ?? 'https://api.notion.com/v1';
    }
  } catch {
    // Keep value; runtime/network layer will surface invalid URLs.
  }

  return normalized;
}

function normalizeInstanceId(value: string | undefined | null): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return normalized || DEFAULT_INSTANCE_ID;
}

function parseRuntimeKey(key: string): { connectorId: AppConnectorExtensionId; instanceId: string } | null {
  const parts = key.split('::');
  const connectorId = (parts[0] ?? '').trim().toLowerCase();
  if (!isAppConnectorExtensionId(connectorId)) return null;
  const rawInstance = parts.length > 1 ? parts.slice(1).join('::') : '';
  return {
    connectorId,
    instanceId: normalizeInstanceId(rawInstance || DEFAULT_INSTANCE_ID),
  };
}

export function getAppConnectorRuntimeKey(
  connectorId: AppConnectorExtensionId,
  instanceId?: string
): string {
  const normalizedInstance = normalizeInstanceId(instanceId);
  if (normalizedInstance === DEFAULT_INSTANCE_ID) return connectorId;
  return `${connectorId}::${normalizedInstance}`;
}

function createDefaultConfig(
  id: AppConnectorExtensionId,
  instanceId = DEFAULT_INSTANCE_ID
): AppConnectorExtensionConfig {
  const definition = definitionById.get(id);
  return {
    id,
    instanceId: normalizeInstanceId(instanceId),
    enabled: false,
    autoBindTools: true,
    baseUrl: definition?.defaultBaseUrl,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeConfig(
  input: AppConnectorExtensionConfigInput,
  existing: AppConnectorExtensionConfig
): AppConnectorExtensionConfig {
  return {
    id: input.id,
    instanceId: normalizeInstanceId(input.instanceId ?? existing.instanceId),
    name: normalizeText(input.name ?? existing.name),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
    autoBindTools:
      typeof input.autoBindTools === 'boolean' ? input.autoBindTools : existing.autoBindTools,
    agentId: normalizeText(input.agentId ?? existing.agentId),
    accountId: normalizeText(input.accountId ?? existing.accountId),
    baseUrl: normalizeConnectorBaseUrl(input.id, input.baseUrl ?? existing.baseUrl),
    notes: normalizeText(input.notes ?? existing.notes),
    metadata: normalizeMetadata(input.metadata ?? existing.metadata),
    updatedAt: new Date().toISOString(),
  };
}

function getConfigsUnsafe(): Record<string, AppConnectorExtensionConfig> {
  const current = appConnectorExtensionsStore.get('configs');
  return current && typeof current === 'object' ? current : {};
}

function getConfigsNormalized(): Record<string, AppConnectorExtensionConfig> {
  const unsafe = getConfigsUnsafe();
  const normalized: Record<string, AppConnectorExtensionConfig> = {};
  for (const [storedKey, value] of Object.entries(unsafe)) {
    if (!value || typeof value !== 'object') continue;
    const runtimeFromValue = getAppConnectorRuntimeKey(
      value.id as AppConnectorExtensionId,
      value.instanceId
    );
    const parsedFromKey = parseRuntimeKey(storedKey);
    const parsed = parsedFromKey ?? parseRuntimeKey(runtimeFromValue);
    if (!parsed) continue;
    const merged: AppConnectorExtensionConfig = {
      ...createDefaultConfig(parsed.connectorId, parsed.instanceId),
      ...value,
      id: parsed.connectorId,
      instanceId: normalizeInstanceId(value.instanceId ?? parsed.instanceId),
      name: normalizeText(value.name),
      enabled: Boolean(value.enabled),
      autoBindTools: value.autoBindTools !== false,
      agentId: normalizeText(value.agentId),
      accountId: normalizeText(value.accountId),
      baseUrl: normalizeConnectorBaseUrl(parsed.connectorId, value.baseUrl),
      notes: normalizeText(value.notes),
      metadata: normalizeMetadata(value.metadata),
      updatedAt: normalizeText(value.updatedAt) ?? new Date().toISOString(),
    };
    normalized[getAppConnectorRuntimeKey(merged.id, merged.instanceId)] = merged;
  }
  return normalized;
}

function writeConfigs(next: Record<string, AppConnectorExtensionConfig>): void {
  appConnectorExtensionsStore.set('configs', next);
}

function getConfigsForConnector(
  id: AppConnectorExtensionId
): AppConnectorExtensionConfig[] {
  const all = Object.values(getConfigsNormalized())
    .filter((config) => config.id === id);
  if (all.length === 0) {
    return [createDefaultConfig(id)];
  }
  all.sort((a, b) => {
    if (a.instanceId === DEFAULT_INSTANCE_ID && b.instanceId !== DEFAULT_INSTANCE_ID) return -1;
    if (b.instanceId === DEFAULT_INSTANCE_ID && a.instanceId !== DEFAULT_INSTANCE_ID) return 1;
    const aName = (a.name ?? '').toLowerCase();
    const bName = (b.name ?? '').toLowerCase();
    if (aName !== bName) return aName.localeCompare(bName);
    return a.instanceId.localeCompare(b.instanceId);
  });
  return all;
}

export function listAppConnectorExtensionDefinitions(): AppConnectorExtensionDefinition[] {
  return APP_CONNECTOR_EXTENSION_CATALOG;
}

export function isAppConnectorExtensionId(value: string): value is AppConnectorExtensionId {
  return definitionById.has(value as AppConnectorExtensionId);
}

export function getAppConnectorExtensionConfig(
  id: AppConnectorExtensionId,
  instanceId?: string
): AppConnectorExtensionConfig {
  const runtimeKey = getAppConnectorRuntimeKey(id, instanceId);
  const current = getConfigsNormalized();
  return current[runtimeKey] ?? createDefaultConfig(id, normalizeInstanceId(instanceId));
}

export function resolveAppConnectorExtensionConfig(input: {
  id: AppConnectorExtensionId;
  instanceId?: string;
  accountId?: string;
  enabledOnly?: boolean;
}): AppConnectorExtensionConfig {
  const all = getConfigsForConnector(input.id);
  const enabledOnly = input.enabledOnly === true;
  const candidateList = enabledOnly ? all.filter((config) => config.enabled) : all;
  const byInstanceId = normalizeInstanceId(input.instanceId);
  if (input.instanceId && byInstanceId) {
    const exact = candidateList.find((config) => config.instanceId === byInstanceId);
    if (exact) return exact;
  }
  const normalizedAccountId = normalizeText(input.accountId);
  if (normalizedAccountId) {
    const exactAccount = candidateList.find(
      (config) => normalizeText(config.accountId) === normalizedAccountId
    );
    if (exactAccount) return exactAccount;
  }
  const defaultConfig = candidateList.find((config) => config.instanceId === DEFAULT_INSTANCE_ID);
  if (defaultConfig) return defaultConfig;
  if (candidateList.length > 0) return candidateList[0];
  return createDefaultConfig(input.id);
}

export function listAppConnectorExtensionConfigs(
  id?: AppConnectorExtensionId
): AppConnectorExtensionConfig[] {
  if (id) {
    return getConfigsForConnector(id);
  }
  return APP_CONNECTOR_EXTENSION_CATALOG.flatMap((definition) =>
    getConfigsForConnector(definition.id)
  );
}

export function setAppConnectorExtensionConfig(
  input: AppConnectorExtensionConfigInput
): AppConnectorExtensionConfig {
  const normalizedInstance = normalizeInstanceId(input.instanceId);
  const existing = getAppConnectorExtensionConfig(input.id, normalizedInstance);
  const nextConfig = normalizeConfig({
    ...input,
    instanceId: normalizedInstance,
  }, existing);
  const current = getConfigsNormalized();
  current[getAppConnectorRuntimeKey(input.id, normalizedInstance)] = nextConfig;
  writeConfigs(current);
  return nextConfig;
}

function slugifyInstanceId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return normalized || 'instance';
}

export function createAppConnectorExtensionInstance(
  id: AppConnectorExtensionId,
  name?: string
): AppConnectorExtensionConfig {
  const current = getConfigsNormalized();
  let base = slugifyInstanceId(name || `instance-${Date.now().toString(36)}`);
  if (base === DEFAULT_INSTANCE_ID) {
    base = `${base}-1`;
  }
  let candidate = base;
  let suffix = 2;
  while (current[getAppConnectorRuntimeKey(id, candidate)]) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  const config = createDefaultConfig(id, candidate);
  config.name = normalizeText(name) ?? `Instance ${candidate}`;
  current[getAppConnectorRuntimeKey(id, candidate)] = config;
  writeConfigs(current);
  return config;
}

export function deleteAppConnectorExtensionInstance(
  id: AppConnectorExtensionId,
  instanceId: string
): boolean {
  const normalizedInstance = normalizeInstanceId(instanceId);
  if (normalizedInstance === DEFAULT_INSTANCE_ID) {
    const configs = getConfigsForConnector(id);
    if (configs.length <= 1) {
      const reset = createDefaultConfig(id, DEFAULT_INSTANCE_ID);
      const current = getConfigsNormalized();
      current[getAppConnectorRuntimeKey(id, DEFAULT_INSTANCE_ID)] = reset;
      writeConfigs(current);
      return true;
    }
  }
  const runtimeKey = getAppConnectorRuntimeKey(id, normalizedInstance);
  const current = getConfigsNormalized();
  if (!current[runtimeKey]) return false;
  delete current[runtimeKey];
  writeConfigs(current);
  return true;
}
