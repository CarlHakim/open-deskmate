import Store from 'electron-store';
import {
  GATEWAY_CONNECTOR_EXTENSION_CATALOG,
  type GatewayConnectorExtensionConfig,
  type GatewayConnectorExtensionConfigInput,
  type GatewayConnectorExtensionDefinition,
  type GatewayConnectorExtensionId,
} from '@accomplish/shared';

interface GatewayConnectorExtensionsSchema {
  configs: Record<string, GatewayConnectorExtensionConfig>;
}

const gatewayConnectorExtensionsStore = new Store<GatewayConnectorExtensionsSchema>({
  name: 'gateway-connector-extensions',
  defaults: {
    configs: {},
  },
});

const DEFAULT_INSTANCE_ID = 'default';

const definitionById = new Map(
  GATEWAY_CONNECTOR_EXTENSION_CATALOG.map((definition) => [definition.id, definition] as const)
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

function normalizeIdList(input: string[] | undefined): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = Array.from(
    new Set(
      input
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0)
    )
  );
  return values.length > 0 ? values : undefined;
}

function normalizeAccessPolicyMode(value: string | undefined): 'open' | 'allowlist' | 'disabled' {
  if (value === 'allowlist' || value === 'disabled') return value;
  return 'open';
}

function normalizeInstanceId(value: string | undefined | null): string {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return normalized || DEFAULT_INSTANCE_ID;
}

function parseRuntimeKey(key: string): { connectorId: GatewayConnectorExtensionId; instanceId: string } | null {
  const parts = key.split('::');
  const connectorId = (parts[0] ?? '').trim().toLowerCase();
  if (!isGatewayConnectorExtensionId(connectorId)) return null;
  const rawInstance = parts.length > 1 ? parts.slice(1).join('::') : '';
  return {
    connectorId,
    instanceId: normalizeInstanceId(rawInstance || DEFAULT_INSTANCE_ID),
  };
}

export function getGatewayConnectorRuntimeKey(
  connectorId: GatewayConnectorExtensionId,
  instanceId?: string
): string {
  const normalizedInstance = normalizeInstanceId(instanceId);
  if (normalizedInstance === DEFAULT_INSTANCE_ID) return connectorId;
  return `${connectorId}::${normalizedInstance}`;
}

function createDefaultConfig(
  id: GatewayConnectorExtensionId,
  instanceId = DEFAULT_INSTANCE_ID
): GatewayConnectorExtensionConfig {
  return {
    id,
    instanceId: normalizeInstanceId(instanceId),
    enabled: false,
    autoBindRouting: true,
    recordObservedIds: true,
    accessPolicyMode: 'open',
    updatedAt: new Date().toISOString(),
  };
}

function normalizeConfig(
  input: GatewayConnectorExtensionConfigInput,
  existing: GatewayConnectorExtensionConfig
): GatewayConnectorExtensionConfig {
  return {
    id: input.id,
    instanceId: normalizeInstanceId(input.instanceId ?? existing.instanceId),
    name: normalizeText(input.name ?? existing.name),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
    autoBindRouting:
      typeof input.autoBindRouting === 'boolean' ? input.autoBindRouting : existing.autoBindRouting,
    recordObservedIds:
      typeof input.recordObservedIds === 'boolean' ? input.recordObservedIds : existing.recordObservedIds,
    accessPolicyMode: normalizeAccessPolicyMode(input.accessPolicyMode ?? existing.accessPolicyMode),
    allowedUserIds: normalizeIdList(input.allowedUserIds ?? existing.allowedUserIds),
    allowedGroupIds: normalizeIdList(input.allowedGroupIds ?? existing.allowedGroupIds),
    allowedChannelIds: normalizeIdList(input.allowedChannelIds ?? existing.allowedChannelIds),
    allowedAccountIds: normalizeIdList(input.allowedAccountIds ?? existing.allowedAccountIds),
    agentId: normalizeText(input.agentId ?? existing.agentId),
    accountId: normalizeText(input.accountId ?? existing.accountId),
    bridgeUrl: normalizeText(input.bridgeUrl ?? existing.bridgeUrl),
    notes: normalizeText(input.notes ?? existing.notes),
    metadata: normalizeMetadata(input.metadata ?? existing.metadata),
    updatedAt: new Date().toISOString(),
  };
}

function getConfigsUnsafe(): Record<string, GatewayConnectorExtensionConfig> {
  const current = gatewayConnectorExtensionsStore.get('configs');
  return current && typeof current === 'object' ? current : {};
}

function getConfigsNormalized(): Record<string, GatewayConnectorExtensionConfig> {
  const unsafe = getConfigsUnsafe();
  const normalized: Record<string, GatewayConnectorExtensionConfig> = {};
  for (const [storedKey, value] of Object.entries(unsafe)) {
    if (!value || typeof value !== 'object') continue;
    const runtimeFromValue = getGatewayConnectorRuntimeKey(
      value.id as GatewayConnectorExtensionId,
      value.instanceId
    );
    const parsedFromKey = parseRuntimeKey(storedKey);
    const parsed = parsedFromKey ?? parseRuntimeKey(runtimeFromValue);
    if (!parsed) continue;
    const merged: GatewayConnectorExtensionConfig = {
      ...createDefaultConfig(parsed.connectorId, parsed.instanceId),
      ...value,
      id: parsed.connectorId,
      instanceId: normalizeInstanceId(value.instanceId ?? parsed.instanceId),
      name: normalizeText(value.name),
      enabled: Boolean(value.enabled),
      autoBindRouting: value.autoBindRouting !== false,
      recordObservedIds: value.recordObservedIds !== false,
      accessPolicyMode: normalizeAccessPolicyMode(value.accessPolicyMode),
      allowedUserIds: normalizeIdList(value.allowedUserIds),
      allowedGroupIds: normalizeIdList(value.allowedGroupIds),
      allowedChannelIds: normalizeIdList(value.allowedChannelIds),
      allowedAccountIds: normalizeIdList(value.allowedAccountIds),
      agentId: normalizeText(value.agentId),
      accountId: normalizeText(value.accountId),
      bridgeUrl: normalizeText(value.bridgeUrl),
      notes: normalizeText(value.notes),
      metadata: normalizeMetadata(value.metadata),
      updatedAt: normalizeText(value.updatedAt) ?? new Date().toISOString(),
    };
    normalized[getGatewayConnectorRuntimeKey(merged.id, merged.instanceId)] = merged;
  }
  return normalized;
}

function writeConfigs(next: Record<string, GatewayConnectorExtensionConfig>): void {
  gatewayConnectorExtensionsStore.set('configs', next);
}

function getConfigsForConnector(
  id: GatewayConnectorExtensionId
): GatewayConnectorExtensionConfig[] {
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

export function listGatewayConnectorExtensionDefinitions(): GatewayConnectorExtensionDefinition[] {
  return GATEWAY_CONNECTOR_EXTENSION_CATALOG;
}

export function isGatewayConnectorExtensionId(value: string): value is GatewayConnectorExtensionId {
  return definitionById.has(value as GatewayConnectorExtensionId);
}

export function getGatewayConnectorExtensionConfig(
  id: GatewayConnectorExtensionId,
  instanceId?: string
): GatewayConnectorExtensionConfig {
  const runtimeKey = getGatewayConnectorRuntimeKey(id, instanceId);
  const current = getConfigsNormalized();
  return current[runtimeKey] ?? createDefaultConfig(id, normalizeInstanceId(instanceId));
}

export function resolveGatewayConnectorExtensionConfig(input: {
  id: GatewayConnectorExtensionId;
  instanceId?: string;
  accountId?: string;
  enabledOnly?: boolean;
}): GatewayConnectorExtensionConfig {
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

export function listGatewayConnectorExtensionConfigs(
  id?: GatewayConnectorExtensionId
): GatewayConnectorExtensionConfig[] {
  if (id) {
    return getConfigsForConnector(id);
  }
  return GATEWAY_CONNECTOR_EXTENSION_CATALOG.flatMap((definition) =>
    getConfigsForConnector(definition.id)
  );
}

export function setGatewayConnectorExtensionConfig(
  input: GatewayConnectorExtensionConfigInput
): GatewayConnectorExtensionConfig {
  const normalizedInstance = normalizeInstanceId(input.instanceId);
  const existing = getGatewayConnectorExtensionConfig(input.id, normalizedInstance);
  const nextConfig = normalizeConfig({
    ...input,
    instanceId: normalizedInstance,
  }, existing);
  const current = getConfigsNormalized();
  current[getGatewayConnectorRuntimeKey(input.id, normalizedInstance)] = nextConfig;
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

export function createGatewayConnectorExtensionInstance(
  id: GatewayConnectorExtensionId,
  name?: string
): GatewayConnectorExtensionConfig {
  const current = getConfigsNormalized();
  let base = slugifyInstanceId(name || `instance-${Date.now().toString(36)}`);
  if (base === DEFAULT_INSTANCE_ID) {
    base = `${base}-1`;
  }
  let candidate = base;
  let suffix = 2;
  while (current[getGatewayConnectorRuntimeKey(id, candidate)]) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  const config = createDefaultConfig(id, candidate);
  config.name = normalizeText(name) ?? `Instance ${candidate}`;
  current[getGatewayConnectorRuntimeKey(id, candidate)] = config;
  writeConfigs(current);
  return config;
}

export function deleteGatewayConnectorExtensionInstance(
  id: GatewayConnectorExtensionId,
  instanceId: string
): boolean {
  const normalizedInstance = normalizeInstanceId(instanceId);
  if (normalizedInstance === DEFAULT_INSTANCE_ID) {
    const configs = getConfigsForConnector(id);
    if (configs.length <= 1) {
      const reset = createDefaultConfig(id, DEFAULT_INSTANCE_ID);
      const current = getConfigsNormalized();
      current[getGatewayConnectorRuntimeKey(id, DEFAULT_INSTANCE_ID)] = reset;
      writeConfigs(current);
      return true;
    }
  }
  const runtimeKey = getGatewayConnectorRuntimeKey(id, normalizedInstance);
  const current = getConfigsNormalized();
  if (!current[runtimeKey]) return false;
  delete current[runtimeKey];
  writeConfigs(current);
  return true;
}

