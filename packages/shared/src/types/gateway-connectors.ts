export type GatewayConnectorExtensionId =
  | 'discord'
  | 'telegram'
  | 'bluebubbles'
  | 'googlechat'
  | 'imessage'
  | 'line'
  | 'matrix'
  | 'mattermost'
  | 'msteams'
  | 'nextcloud-talk'
  | 'nostr'
  | 'signal'
  | 'slack'
  | 'tlon'
  | 'whatsapp'
  | 'zalo'
  | 'zalouser';

export interface GatewayConnectorExtensionDefinition {
  id: GatewayConnectorExtensionId;
  channel: string;
  name: string;
  description: string;
  requiresExternalBridge: boolean;
}

export type GatewayConnectorAccessPolicyMode = 'open' | 'allowlist' | 'disabled';

export interface GatewayConnectorExtensionConfig {
  id: GatewayConnectorExtensionId;
  instanceId: string;
  name?: string;
  enabled: boolean;
  autoBindRouting: boolean;
  recordObservedIds?: boolean;
  accessPolicyMode?: GatewayConnectorAccessPolicyMode;
  allowedUserIds?: string[];
  allowedGroupIds?: string[];
  allowedChannelIds?: string[];
  allowedAccountIds?: string[];
  agentId?: string;
  accountId?: string;
  bridgeUrl?: string;
  notes?: string;
  metadata?: Record<string, string>;
  updatedAt: string;
}

export interface GatewayConnectorExtensionConfigInput {
  id: GatewayConnectorExtensionId;
  instanceId?: string;
  name?: string;
  enabled?: boolean;
  autoBindRouting?: boolean;
  recordObservedIds?: boolean;
  accessPolicyMode?: GatewayConnectorAccessPolicyMode;
  allowedUserIds?: string[];
  allowedGroupIds?: string[];
  allowedChannelIds?: string[];
  allowedAccountIds?: string[];
  agentId?: string;
  accountId?: string;
  bridgeUrl?: string;
  notes?: string;
  metadata?: Record<string, string>;
}

export interface GatewayConnectorExtensionState {
  definition: GatewayConnectorExtensionDefinition;
  config: GatewayConnectorExtensionConfig;
  secretSet: boolean;
  bindingId: string;
  runtimeKey: string;
}

export interface GatewayConnectorObservedId {
  id: string;
  count: number;
  lastSeenAt: string;
}

export interface GatewayConnectorDiscoverySnapshot {
  connectorId: GatewayConnectorExtensionId;
  instanceId?: string;
  runtimeKey?: string;
  lastSeenAt?: string;
  accountIds: GatewayConnectorObservedId[];
  userIds: GatewayConnectorObservedId[];
  groupIds: GatewayConnectorObservedId[];
  channelIds: GatewayConnectorObservedId[];
}

export interface GatewayConnectorRuntimeStatus {
  connectorId: GatewayConnectorExtensionId;
  instanceId?: string;
  runtimeKey?: string;
  instanceName?: string;
  configured: boolean;
  running: boolean;
  mode: 'native' | 'first-party' | 'external-bridge';
  lastStartAt?: string;
  lastPollAt?: string;
  lastError?: string;
  accountId?: string;
  botUserId?: string;
  detail?: string;
}

export interface GatewayConnectorRuntimeTestResult {
  connectorId: GatewayConnectorExtensionId;
  instanceId?: string;
  runtimeKey?: string;
  ok: boolean;
  detail: string;
  metadata?: Record<string, string>;
}

export interface GatewayConnectorRuntimeDiscoveryItem {
  id: string;
  name: string;
  kind: 'dm' | 'group' | 'channel' | 'space' | 'chat' | 'room';
  metadata?: Record<string, string>;
}

export const GATEWAY_CONNECTOR_EXTENSION_BINDING_PREFIX = 'ext';

export const GATEWAY_CONNECTOR_EXTENSION_CATALOG: GatewayConnectorExtensionDefinition[] = [
  {
    id: 'discord',
    channel: 'discord',
    name: 'Discord',
    description: 'Native Discord bot connector.',
    requiresExternalBridge: false,
  },
  {
    id: 'telegram',
    channel: 'telegram',
    name: 'Telegram',
    description: 'Native Telegram bot connector.',
    requiresExternalBridge: false,
  },
  {
    id: 'bluebubbles',
    channel: 'bluebubbles',
    name: 'BlueBubbles',
    description: 'Bridge Android/Web to iMessage via the BlueBubbles stack.',
    requiresExternalBridge: true,
  },
  {
    id: 'googlechat',
    channel: 'googlechat',
    name: 'Google Chat',
    description: 'Google Workspace chat spaces and DMs.',
    requiresExternalBridge: false,
  },
  {
    id: 'imessage',
    channel: 'imessage',
    name: 'iMessage',
    description: 'Apple iMessage gateway channel.',
    requiresExternalBridge: true,
  },
  {
    id: 'line',
    channel: 'line',
    name: 'LINE',
    description: 'LINE messaging channel.',
    requiresExternalBridge: true,
  },
  {
    id: 'matrix',
    channel: 'matrix',
    name: 'Matrix',
    description: 'Matrix homeserver bridge channel.',
    requiresExternalBridge: false,
  },
  {
    id: 'mattermost',
    channel: 'mattermost',
    name: 'Mattermost',
    description: 'Mattermost team messaging.',
    requiresExternalBridge: false,
  },
  {
    id: 'msteams',
    channel: 'msteams',
    name: 'Microsoft Teams',
    description: 'Microsoft Teams chat and channel routing.',
    requiresExternalBridge: false,
  },
  {
    id: 'nextcloud-talk',
    channel: 'nextcloud-talk',
    name: 'Nextcloud Talk',
    description: 'Nextcloud Talk rooms and DMs.',
    requiresExternalBridge: true,
  },
  {
    id: 'nostr',
    channel: 'nostr',
    name: 'Nostr',
    description: 'Nostr relays and direct messaging.',
    requiresExternalBridge: true,
  },
  {
    id: 'signal',
    channel: 'signal',
    name: 'Signal',
    description: 'Signal messenger integration.',
    requiresExternalBridge: true,
  },
  {
    id: 'slack',
    channel: 'slack',
    name: 'Slack',
    description: 'Slack workspace channels and DMs.',
    requiresExternalBridge: false,
  },
  {
    id: 'tlon',
    channel: 'tlon',
    name: 'Tlon',
    description: 'Tlon/Urbit messaging channel.',
    requiresExternalBridge: true,
  },
  {
    id: 'whatsapp',
    channel: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp Business or personal bridge integrations.',
    requiresExternalBridge: true,
  },
  {
    id: 'zalo',
    channel: 'zalo',
    name: 'Zalo OA',
    description: 'Zalo Official Account connector.',
    requiresExternalBridge: true,
  },
  {
    id: 'zalouser',
    channel: 'zalouser',
    name: 'Zalo User',
    description: 'Zalo user-message connector.',
    requiresExternalBridge: true,
  },
];
