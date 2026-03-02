import type { TelegramConnectorConfig } from '@accomplish/shared';
import {
  getGatewayConnectorExtensionConfig,
  setGatewayConnectorExtensionConfig,
} from './gatewayConnectorExtensions';

const DEFAULT_CONFIG: TelegramConnectorConfig = {
  enabled: false,
  allowDms: false,
  dmPolicy: 'pairing',
  requireMention: true,
  commandPrefix: '/desk',
  dmAllowlist: [],
  channelAllowlist: [],
  groupAllowlist: [],
  agentId: undefined,
};


function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  const normalized = (input ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function parseList(input: string | undefined, fallback: string[]): string[] {
  const values = (input ?? '')
    .split(/[\n,\s]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.length === 0) return fallback;
  return Array.from(new Set(values));
}

function serializeList(values: string[]): string | undefined {
  const filtered = values.map((entry) => entry.trim()).filter(Boolean);
  if (filtered.length === 0) return undefined;
  return Array.from(new Set(filtered)).join(',');
}

function getMetadataValue(metadata: Record<string, string> | undefined, key: string): string | undefined {
  if (!metadata) return undefined;
  const target = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(metadata)) {
    if (entryKey.toLowerCase() === target) return entryValue;
  }
  return undefined;
}

export function getTelegramConfig(): TelegramConnectorConfig {
  const extensionConfig = getGatewayConnectorExtensionConfig('telegram');
  const metadata = extensionConfig.metadata;
  const dmPolicyRaw = getMetadataValue(metadata, 'dm_policy');
  const dmPolicy = dmPolicyRaw === 'open' || dmPolicyRaw === 'pairing' || dmPolicyRaw === 'disabled'
    ? dmPolicyRaw
    : DEFAULT_CONFIG.dmPolicy;
  const allowDms = parseBoolean(getMetadataValue(metadata, 'allow_dms'), DEFAULT_CONFIG.allowDms);
  const requireMention = parseBoolean(
    getMetadataValue(metadata, 'require_mention'),
    DEFAULT_CONFIG.requireMention
  );
  const commandPrefix = getMetadataValue(metadata, 'command_prefix') ?? DEFAULT_CONFIG.commandPrefix;
  return {
    enabled: extensionConfig.enabled,
    allowDms: dmPolicy !== 'disabled' && allowDms,
    dmPolicy,
    requireMention,
    commandPrefix,
    dmAllowlist: parseList(
      getMetadataValue(metadata, 'dm_allowlist'),
      extensionConfig.allowedUserIds ?? []
    ),
    channelAllowlist: parseList(
      getMetadataValue(metadata, 'channel_allowlist'),
      extensionConfig.allowedChannelIds ?? []
    ),
    groupAllowlist: parseList(
      getMetadataValue(metadata, 'group_allowlist'),
      extensionConfig.allowedGroupIds ?? []
    ),
    agentId: extensionConfig.agentId,
  };
}

export function setTelegramConfig(config: TelegramConnectorConfig): TelegramConnectorConfig {
  const next: TelegramConnectorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  const existing = getGatewayConnectorExtensionConfig('telegram');
  const metadata: Record<string, string> = {
    ...(existing.metadata ?? {}),
  };
  const commandPrefix = next.commandPrefix?.trim() || '';
  if (commandPrefix) {
    metadata.command_prefix = commandPrefix;
  } else {
    delete metadata.command_prefix;
  }
  metadata.require_mention = next.requireMention ? 'true' : 'false';
  metadata.allow_dms = next.allowDms ? 'true' : 'false';
  metadata.dm_policy = next.dmPolicy ?? 'pairing';
  const dmAllowlist = serializeList(next.dmAllowlist ?? []);
  const channelAllowlist = serializeList(next.channelAllowlist ?? []);
  const groupAllowlist = serializeList(next.groupAllowlist ?? []);
  if (dmAllowlist) metadata.dm_allowlist = dmAllowlist;
  else delete metadata.dm_allowlist;
  if (channelAllowlist) metadata.channel_allowlist = channelAllowlist;
  else delete metadata.channel_allowlist;
  if (groupAllowlist) metadata.group_allowlist = groupAllowlist;
  else delete metadata.group_allowlist;
  metadata.native_config_source = 'connector-extension';

  setGatewayConnectorExtensionConfig({
    id: 'telegram',
    enabled: next.enabled,
    agentId: next.agentId,
    accessPolicyMode: next.dmPolicy === 'disabled' ? 'disabled' : existing.accessPolicyMode,
    allowedUserIds: next.dmAllowlist,
    allowedChannelIds: next.channelAllowlist,
    allowedGroupIds: next.groupAllowlist,
    metadata,
  });
  return getTelegramConfig();
}

export function addTelegramDmAllowlistEntry(userId: string): TelegramConnectorConfig {
  const config = getTelegramConfig();
  const trimmed = userId.trim();
  if (!trimmed) {
    return config;
  }
  const next = new Set(config.dmAllowlist ?? []);
  if (!next.has(trimmed)) {
    next.add(trimmed);
    return setTelegramConfig({
      ...config,
      dmAllowlist: Array.from(next),
    });
  }
  return config;
}
