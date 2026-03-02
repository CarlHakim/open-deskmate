import Store from 'electron-store';
import {
  GATEWAY_CONNECTOR_EXTENSION_CATALOG,
  type GatewayConnectorDiscoverySnapshot,
  type GatewayConnectorExtensionId,
  type GatewayConnectorObservedId,
} from '@accomplish/shared';
import {
  getGatewayConnectorRuntimeKey,
  listGatewayConnectorExtensionConfigs,
} from './gatewayConnectorExtensions';

interface StoredObservedId {
  id: string;
  count: number;
  lastSeenAt: string;
}

interface StoredConnectorDiscovery {
  lastSeenAt?: string;
  accountIds: StoredObservedId[];
  userIds: StoredObservedId[];
  groupIds: StoredObservedId[];
  channelIds: StoredObservedId[];
}

interface GatewayConnectorDiscoverySchema {
  connectors: Record<string, StoredConnectorDiscovery>;
}

const gatewayConnectorDiscoveryStore = new Store<GatewayConnectorDiscoverySchema>({
  name: 'gateway-connector-discovery',
  defaults: {
    connectors: {},
  },
});

const connectorIdSet = new Set(
  GATEWAY_CONNECTOR_EXTENSION_CATALOG.map((definition) => definition.id)
);

const MAX_OBSERVED_IDS_PER_BUCKET = 50;

function isGatewayConnectorExtensionId(value: string): value is GatewayConnectorExtensionId {
  return connectorIdSet.has(value as GatewayConnectorExtensionId);
}

function normalizeToken(value: string | undefined | null, maxLength = 128): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase().slice(0, maxLength);
}

function normalizeInstanceId(value: string | undefined | null): string | undefined {
  const normalized = normalizeToken(value, 64);
  if (!normalized || normalized === 'default') return undefined;
  return normalized;
}

function resolveRuntimeTarget(input: {
  connectorId: string;
  instanceId?: string | null;
}): { connectorId: GatewayConnectorExtensionId; instanceId?: string; runtimeKey: string } | null {
  const connectorId = normalizeToken(input.connectorId, 64);
  if (!connectorId || !isGatewayConnectorExtensionId(connectorId)) return null;
  const instanceId = normalizeInstanceId(input.instanceId);
  return {
    connectorId,
    instanceId,
    runtimeKey: getGatewayConnectorRuntimeKey(connectorId, instanceId),
  };
}

function parseRuntimeKey(runtimeKey: string): { connectorId: GatewayConnectorExtensionId; instanceId?: string; runtimeKey: string } | null {
  const normalized = normalizeToken(runtimeKey, 128);
  if (!normalized) return null;
  const [connectorRaw, ...instanceParts] = normalized.split('::');
  if (!isGatewayConnectorExtensionId(connectorRaw)) return null;
  const instanceId = normalizeInstanceId(instanceParts.join('::'));
  return {
    connectorId: connectorRaw,
    instanceId,
    runtimeKey: getGatewayConnectorRuntimeKey(connectorRaw, instanceId),
  };
}

function createEmptyStoredConnectorDiscovery(): StoredConnectorDiscovery {
  return {
    accountIds: [],
    userIds: [],
    groupIds: [],
    channelIds: [],
  };
}

function readAll(): Record<string, StoredConnectorDiscovery> {
  const current = gatewayConnectorDiscoveryStore.get('connectors');
  return current && typeof current === 'object' ? current : {};
}

function writeAll(next: Record<string, StoredConnectorDiscovery>): void {
  gatewayConnectorDiscoveryStore.set('connectors', next);
}

function normalizeObservedIds(values: StoredObservedId[]): GatewayConnectorObservedId[] {
  return values
    .filter((item) => Boolean(item?.id))
    .map((item) => ({
      id: item.id,
      count: Number.isFinite(item.count) && item.count > 0 ? Math.round(item.count) : 1,
      lastSeenAt: item.lastSeenAt,
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, MAX_OBSERVED_IDS_PER_BUCKET);
}

function toSnapshot(
  target: { connectorId: GatewayConnectorExtensionId; instanceId?: string; runtimeKey: string },
  stored: StoredConnectorDiscovery | undefined
): GatewayConnectorDiscoverySnapshot {
  const safe = stored ?? createEmptyStoredConnectorDiscovery();
  return {
    connectorId: target.connectorId,
    instanceId: target.instanceId,
    runtimeKey: target.runtimeKey,
    lastSeenAt: safe.lastSeenAt,
    accountIds: normalizeObservedIds(safe.accountIds),
    userIds: normalizeObservedIds(safe.userIds),
    groupIds: normalizeObservedIds(safe.groupIds),
    channelIds: normalizeObservedIds(safe.channelIds),
  };
}

function upsertObservedId(values: StoredObservedId[], id: string, at: string): StoredObservedId[] {
  const existingIndex = values.findIndex((entry) => entry.id === id);
  const next = [...values];
  if (existingIndex >= 0) {
    const existing = next[existingIndex];
    next[existingIndex] = {
      id,
      count: (existing?.count ?? 0) + 1,
      lastSeenAt: at,
    };
  } else {
    next.unshift({
      id,
      count: 1,
      lastSeenAt: at,
    });
  }
  next.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  return next.slice(0, MAX_OBSERVED_IDS_PER_BUCKET);
}

export function recordGatewayConnectorObservation(input: {
  connectorId: string;
  instanceId?: string | null;
  accountId?: string | null;
  userId?: string | null;
  groupId?: string | null;
  channelId?: string | null;
}): GatewayConnectorDiscoverySnapshot | undefined {
  const target = resolveRuntimeTarget({
    connectorId: input.connectorId,
    instanceId: input.instanceId,
  });
  if (!target) return undefined;

  const accountId = normalizeToken(input.accountId, 128);
  const userId = normalizeToken(input.userId, 128);
  const groupId = normalizeToken(input.groupId, 128);
  const channelId = normalizeToken(input.channelId, 128);
  if (!accountId && !userId && !groupId && !channelId) {
    return getGatewayConnectorDiscovery(target.connectorId, target.instanceId);
  }

  const all = readAll();
  const now = new Date().toISOString();
  const current = all[target.runtimeKey] ?? createEmptyStoredConnectorDiscovery();
  const next: StoredConnectorDiscovery = {
    ...current,
    accountIds: accountId ? upsertObservedId(current.accountIds, accountId, now) : current.accountIds,
    userIds: userId ? upsertObservedId(current.userIds, userId, now) : current.userIds,
    groupIds: groupId ? upsertObservedId(current.groupIds, groupId, now) : current.groupIds,
    channelIds: channelId ? upsertObservedId(current.channelIds, channelId, now) : current.channelIds,
    lastSeenAt: now,
  };
  writeAll({
    ...all,
    [target.runtimeKey]: next,
  });
  return toSnapshot(target, next);
}

export function getGatewayConnectorDiscovery(
  connectorId: GatewayConnectorExtensionId,
  instanceId?: string
): GatewayConnectorDiscoverySnapshot {
  const target = resolveRuntimeTarget({ connectorId, instanceId });
  if (!target) {
    return {
      connectorId,
      accountIds: [],
      userIds: [],
      groupIds: [],
      channelIds: [],
    };
  }
  const all = readAll();
  return toSnapshot(target, all[target.runtimeKey]);
}

export function listGatewayConnectorDiscovery(): GatewayConnectorDiscoverySnapshot[] {
  const all = readAll();
  const runtimeKeys = new Set<string>();
  for (const config of listGatewayConnectorExtensionConfigs()) {
    runtimeKeys.add(getGatewayConnectorRuntimeKey(config.id, config.instanceId));
  }
  for (const key of Object.keys(all)) {
    runtimeKeys.add(key);
  }
  return Array.from(runtimeKeys)
    .map((key) => parseRuntimeKey(key))
    .filter((entry): entry is { connectorId: GatewayConnectorExtensionId; instanceId?: string; runtimeKey: string } => Boolean(entry))
    .sort((a, b) => {
      if (a.connectorId !== b.connectorId) return a.connectorId.localeCompare(b.connectorId);
      return (a.instanceId ?? 'default').localeCompare(b.instanceId ?? 'default');
    })
    .map((target) => toSnapshot(target, all[target.runtimeKey]));
}

export function clearGatewayConnectorDiscovery(
  connectorId?: GatewayConnectorExtensionId,
  instanceId?: string
): void {
  if (!connectorId) {
    writeAll({});
    return;
  }
  const target = resolveRuntimeTarget({ connectorId, instanceId });
  if (!target) return;
  const all = readAll();
  if (!all[target.runtimeKey]) return;
  const next = { ...all };
  delete next[target.runtimeKey];
  writeAll(next);
}

