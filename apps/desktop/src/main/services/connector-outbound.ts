import { randomUUID } from 'crypto';
import type { GatewayConnectorExtensionConfig, GatewayConnectorExtensionId, GatewayPeerKind } from '@accomplish/shared';
import {
  getGatewayConnectorRuntimeKey,
  resolveGatewayConnectorExtensionConfig,
} from '../store/gatewayConnectorExtensions';
import { getGatewayConnectorDiscovery } from '../store/gatewayConnectorDiscovery';
import { getGatewayConnectorSecret } from '../store/secureStorage';
import { sendDiscordOutboundMessage } from './discord-connector';
import { sendTelegramOutboundMessage } from './telegram-connector';
import { getUserPresenceState } from './user-presence';
import { getConnectorBridgeRuntimeBaseUrl } from './connector-bridge-runtime';

type OutboundTargetKind = GatewayPeerKind | 'space' | 'chat' | 'room';

const BRIDGE_CONNECTOR_IDS = new Set<GatewayConnectorExtensionId>([
  'signal',
  'whatsapp',
  'line',
  'bluebubbles',
  'imessage',
  'nextcloud-talk',
  'nostr',
  'tlon',
  'zalo',
  'zalouser',
]);

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function isRoutineHeartbeatStatusMessage(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return false;
  const hasHeartbeat = /\bheart\s*beat\b/.test(normalized);
  const hasCheckIn = /\bcheck[-\s]?in\b/.test(normalized);
  if (hasHeartbeat && hasCheckIn) return true;
  if (/^heartbeat\b/.test(normalized)) return true;
  if (hasHeartbeat && /\b(completed?|done|stable|no action needed)\b/.test(normalized)) return true;
  return false;
}

function normalizeLower(value: unknown, maxLength: number): string {
  return normalizeText(value, maxLength).toLowerCase();
}

function normalizeAccessSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => normalizeLower(value, 128)).filter(Boolean));
}

function getMetadata(config: GatewayConnectorExtensionConfig, key: string): string | undefined {
  if (!config.metadata) return undefined;
  const target = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(config.metadata)) {
    if (entryKey.toLowerCase() === target) return entryValue;
  }
  return undefined;
}

function getBridgeEndpoint(config: GatewayConnectorExtensionConfig, key: string, fallback: string): string {
  const fromMetadata = normalizeText(getMetadata(config, key), 512);
  if (fromMetadata) return fromMetadata;
  return fallback;
}

function resolvePeerKind(input?: OutboundTargetKind): GatewayPeerKind {
  if (input === 'dm') return 'dm';
  if (input === 'group') return 'group';
  return 'channel';
}

function selectMetadataDefaultTarget(
  config: GatewayConnectorExtensionConfig
): { targetId: string; peerKind: GatewayPeerKind } | null {
  const targetId = normalizeText(
    getMetadata(config, 'outbound_default_target_id')
      || getMetadata(config, 'default_target_id')
      || getMetadata(config, 'target_id'),
    256
  );
  if (!targetId) return null;
  const peerKindRaw = normalizeLower(
    getMetadata(config, 'outbound_default_target_kind')
      || getMetadata(config, 'default_target_kind')
      || getMetadata(config, 'target_kind'),
    32
  );
  const peerKind = peerKindRaw === 'dm' || peerKindRaw === 'group' || peerKindRaw === 'channel'
    ? peerKindRaw
    : 'dm';
  return { targetId, peerKind };
}

function selectDefaultTarget(
  config: GatewayConnectorExtensionConfig
): { targetId: string; peerKind: GatewayPeerKind } | null {
  const metadataTarget = selectMetadataDefaultTarget(config);
  if (metadataTarget) {
    return metadataTarget;
  }
  const discovery = getGatewayConnectorDiscovery(config.id, config.instanceId);
  if (discovery.userIds[0]?.id) {
    return { targetId: discovery.userIds[0].id, peerKind: 'dm' };
  }
  if (discovery.channelIds[0]?.id) {
    return { targetId: discovery.channelIds[0].id, peerKind: 'channel' };
  }
  if (discovery.groupIds[0]?.id) {
    return { targetId: discovery.groupIds[0].id, peerKind: 'group' };
  }
  if (config.allowedUserIds?.[0]) {
    return { targetId: config.allowedUserIds[0], peerKind: 'dm' };
  }
  if (config.allowedChannelIds?.[0]) {
    return { targetId: config.allowedChannelIds[0], peerKind: 'channel' };
  }
  if (config.allowedGroupIds?.[0]) {
    return { targetId: config.allowedGroupIds[0], peerKind: 'group' };
  }
  return null;
}

function evaluateConnectorAccessPolicy(
  config: GatewayConnectorExtensionConfig,
  identity: {
    accountId: string;
    peerKind: GatewayPeerKind;
    peerId: string;
    userId?: string;
    groupId?: string;
    channelId?: string;
  }
): string | null {
  const policyModeRaw = normalizeLower(config.accessPolicyMode ?? 'open', 16);
  const policyMode = policyModeRaw === 'allowlist' || policyModeRaw === 'disabled'
    ? policyModeRaw
    : 'open';
  const accountId = normalizeLower(identity.accountId, 128);
  const userId = normalizeLower(identity.userId || (identity.peerKind === 'dm' ? identity.peerId : ''), 128);
  const groupId = normalizeLower(identity.groupId || (identity.peerKind === 'group' ? identity.peerId : ''), 128);
  const channelId = normalizeLower(identity.channelId || (identity.peerKind === 'channel' ? identity.peerId : ''), 128);

  const allowedAccounts = normalizeAccessSet(config.allowedAccountIds);
  if (allowedAccounts.size > 0 && !allowedAccounts.has(accountId)) {
    return `Account "${identity.accountId}" is not allowed.`;
  }

  const allowedUsers = normalizeAccessSet(config.allowedUserIds);
  const allowedGroups = normalizeAccessSet(config.allowedGroupIds);
  const allowedChannels = normalizeAccessSet(config.allowedChannelIds);

  if (policyMode === 'disabled' && identity.peerKind === 'dm') {
    return 'DM access is disabled.';
  }

  if (policyMode === 'allowlist') {
    const hasAnyAllowlist =
      allowedAccounts.size > 0
      || allowedUsers.size > 0
      || allowedGroups.size > 0
      || allowedChannels.size > 0;
    if (!hasAnyAllowlist) {
      return 'Allowlist mode requires at least one allowed account/user/group/channel.';
    }
    const accountAllowed = allowedAccounts.size > 0 && allowedAccounts.has(accountId);
    const userAllowed = allowedUsers.size > 0 && Boolean(userId) && allowedUsers.has(userId);
    const groupAllowed = allowedGroups.size > 0 && Boolean(groupId) && allowedGroups.has(groupId);
    const channelAllowed = allowedChannels.size > 0 && Boolean(channelId) && allowedChannels.has(channelId);
    if (!accountAllowed && !userAllowed && !groupAllowed && !channelAllowed) {
      return 'No allowlist rule matched this target.';
    }
    return null;
  }

  if (allowedUsers.size > 0 && userId && !allowedUsers.has(userId)) {
    return `User "${userId}" is not allowed.`;
  }
  if (allowedGroups.size > 0 && groupId && !allowedGroups.has(groupId)) {
    return `Group "${groupId}" is not allowed.`;
  }
  if (allowedChannels.size > 0 && channelId && !allowedChannels.has(channelId)) {
    return `Channel "${channelId}" is not allowed.`;
  }
  return null;
}

async function slackApi(
  token: string,
  method: string,
  init?: {
    query?: Record<string, string | undefined>;
    body?: unknown;
  }
): Promise<Record<string, any>> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: init?.body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(`Slack ${method} failed: ${data.error ?? response.statusText}`);
  }
  return data as Record<string, any>;
}

async function matrixApi(
  baseUrl: string,
  accessToken: string,
  method: 'GET' | 'POST',
  endpoint: string,
  init?: {
    query?: Record<string, string | undefined>;
    body?: unknown;
  }
): Promise<Record<string, any>> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Matrix ${endpoint} failed: ${data.errcode ?? response.statusText}`);
  }
  return data as Record<string, any>;
}

async function teamsApi(
  token: string,
  method: 'GET' | 'POST',
  endpoint: string,
  init?: { body?: unknown }
): Promise<Record<string, any>> {
  const baseUrl = 'https://graph.microsoft.com/v1.0';
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Teams ${endpoint} failed: ${data.error?.message ?? response.statusText}`);
  }
  return data as Record<string, any>;
}

async function mattermostApi(
  baseUrl: string,
  token: string,
  method: 'GET' | 'POST',
  endpoint: string,
  init?: {
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  }
): Promise<Record<string, any>> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Mattermost ${endpoint} failed: ${data.message ?? response.statusText}`);
  }
  return data as Record<string, any>;
}

async function googleChatApi(
  token: string,
  method: 'GET' | 'POST',
  endpoint: string,
  init?: {
    query?: Record<string, string | undefined>;
    body?: unknown;
  }
): Promise<Record<string, any>> {
  const url = new URL(`https://chat.googleapis.com/v1${endpoint}`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = data?.error?.status;
    const message = data?.error?.message;
    throw new Error(`Google Chat ${endpoint} failed: ${status ?? message ?? response.statusText}`);
  }
  return data as Record<string, any>;
}

async function bridgeRuntimeApi(
  baseUrl: string,
  token: string,
  method: 'GET' | 'POST',
  endpoint: string,
  init?: {
    query?: Record<string, string | undefined>;
    body?: unknown;
  }
): Promise<Record<string, any>> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Bridge ${endpoint} failed: ${data.error ?? data.message ?? response.statusText}`);
  }
  return data as Record<string, any>;
}

export interface SendConnectorOutboundMessageInput {
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  text: string;
  targetId?: string;
  targetKind?: OutboundTargetKind;
  accountId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
}

export interface SendConnectorOutboundMessageResult {
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId: string;
  accountId: string;
  targetId: string;
  targetKind: GatewayPeerKind;
}

export async function sendConnectorOutboundMessage(
  input: SendConnectorOutboundMessageInput
): Promise<SendConnectorOutboundMessageResult> {
  const presence = getUserPresenceState();
  if (presence.active) {
    throw new Error('User is active in desktop/webchat. Reply in-app instead of using connectors.');
  }

  const config = resolveGatewayConnectorExtensionConfig({
    id: input.connectorId,
    instanceId: input.connectorInstanceId,
    accountId: input.accountId,
    enabledOnly: false,
  });
  if (!config.enabled) {
    const suffix = config.instanceId ? ` (${config.instanceId})` : '';
    throw new Error(`Connector "${input.connectorId}"${suffix} is disabled.`);
  }
  const runtimeKey = getGatewayConnectorRuntimeKey(config.id, config.instanceId);

  const text = normalizeText(input.text, 6000);
  if (!text) {
    throw new Error('Message text is required.');
  }
  if (isRoutineHeartbeatStatusMessage(text)) {
    throw new Error('Blocked connector send: routine heartbeat check-in status must stay in-app.');
  }

  const defaultTarget = selectDefaultTarget(config);
  const targetId = normalizeText(input.targetId, 256) || defaultTarget?.targetId || '';
  if (!targetId) {
    throw new Error(
      'No target ID provided and no default target is available. Provide targetId, configure outbound_default_target_id metadata, or set allowed user/channel/group IDs.'
    );
  }

  const targetKind = resolvePeerKind(input.targetKind ?? defaultTarget?.peerKind);
  const accountId = normalizeText(input.accountId, 128)
    || normalizeText(config.accountId, 128)
    || getGatewayConnectorDiscovery(input.connectorId, config.instanceId).accountIds[0]?.id
    || (config.instanceId && config.instanceId !== 'default' ? config.instanceId : input.connectorId);

  const identity = {
    accountId,
    peerKind: targetKind,
    peerId: targetId,
    userId: targetKind === 'dm' ? targetId : undefined,
    groupId: targetKind === 'group' ? targetId : undefined,
    channelId: targetKind === 'channel' ? targetId : undefined,
  };
  const deniedReason = evaluateConnectorAccessPolicy(config, identity);
  if (deniedReason) {
    throw new Error(`Blocked by connector access policy: ${deniedReason}`);
  }

  if (input.connectorId === 'telegram') {
    const token = await getGatewayConnectorSecret(runtimeKey);
    if (!token) throw new Error(`Connector "${input.connectorId}" secret/token is not set.`);
    await sendTelegramOutboundMessage({ targetId, text, token });
  } else if (input.connectorId === 'discord') {
    const token = await getGatewayConnectorSecret(runtimeKey);
    if (!token) throw new Error(`Connector "${input.connectorId}" secret/token is not set.`);
    await sendDiscordOutboundMessage({ targetId, targetKind, text, token });
  } else {
    const secret = await getGatewayConnectorSecret(runtimeKey);
    if (!secret) {
      throw new Error(`Connector "${input.connectorId}" secret/token is not set.`);
    }
    if (input.connectorId === 'slack') {
      await slackApi(secret, 'chat.postMessage', {
        body: {
          channel: targetId,
          text,
          thread_ts: normalizeText(input.threadId, 128) || undefined,
        },
      });
    } else if (input.connectorId === 'matrix') {
      const baseUrl = normalizeText(config.bridgeUrl, 512) || 'https://matrix-client.matrix.org';
      await matrixApi(baseUrl, secret, 'POST', `/_matrix/client/v3/rooms/${encodeURIComponent(targetId)}/send/m.room.message/${encodeURIComponent(randomUUID())}`, {
        body: {
          msgtype: 'm.text',
          body: text,
        },
      });
    } else if (input.connectorId === 'msteams') {
      await teamsApi(secret, 'POST', `/chats/${encodeURIComponent(targetId)}/messages`, {
        body: {
          body: {
            contentType: 'text',
            content: text,
          },
        },
      });
    } else if (input.connectorId === 'mattermost') {
      const baseUrl = normalizeText(config.bridgeUrl, 512);
      if (!baseUrl) {
        throw new Error('Bridge URL is required for Mattermost.');
      }
      await mattermostApi(baseUrl, secret, 'POST', '/api/v4/posts', {
        body: {
          channel_id: targetId,
          message: text,
          root_id: normalizeText(input.threadId, 128) || undefined,
        },
      });
    } else if (input.connectorId === 'googlechat') {
      const spaceId = targetId.startsWith('spaces/') ? targetId : `spaces/${targetId}`;
      await googleChatApi(secret, 'POST', `/${spaceId}/messages`, {
        body: {
          text,
        },
      });
    } else if (BRIDGE_CONNECTOR_IDS.has(input.connectorId)) {
      const baseUrl = normalizeText(config.bridgeUrl, 512)
        || (input.connectorId === 'line' || input.connectorId === 'whatsapp' || input.connectorId === 'signal' || input.connectorId === 'bluebubbles' || input.connectorId === 'imessage' || input.connectorId === 'nextcloud-talk' || input.connectorId === 'nostr' || input.connectorId === 'tlon' || input.connectorId === 'zalo' || input.connectorId === 'zalouser' ? getConnectorBridgeRuntimeBaseUrl() : '');
      if (!baseUrl) {
        throw new Error(`Bridge URL is required for connector "${input.connectorId}".`);
      }
      const sendEndpoint = getBridgeEndpoint(config, 'send_endpoint', '/connector/v1/send');
      await bridgeRuntimeApi(baseUrl, secret, 'POST', sendEndpoint, {
        body: {
          connector: input.connectorId,
          accountId,
          peerKind: targetKind,
          peerId: targetId,
          text,
          threadId: normalizeText(input.threadId, 128) || undefined,
          metadata: input.metadata,
        },
      });
    } else {
      throw new Error(`Connector "${input.connectorId}" is not supported for outbound send.`);
    }
  }

  return {
    connectorId: input.connectorId,
    connectorInstanceId: config.instanceId ?? 'default',
    accountId,
    targetId,
    targetKind,
  };
}
