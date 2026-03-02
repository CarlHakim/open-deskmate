import http from 'http';
import crypto from 'crypto';
import type { GatewayConnectorExtensionConfig } from '@accomplish/shared';
import {
  getGatewayConnectorRuntimeKey,
  listGatewayConnectorExtensionConfigs,
} from '../store/gatewayConnectorExtensions';
import { getGatewayConnectorSecret } from '../store/secureStorage';

const BRIDGE_HOST = '127.0.0.1';
const DEFAULT_CONNECTOR_BRIDGE_PORT = 9231;
const MAX_REQUEST_BODY_BYTES = 1_024 * 1_024;
const MAX_EVENTS_PER_INSTANCE = 2_000;
const MAX_SEEN_EVENT_IDS = 5_000;
const LINE_PUSH_TEXT_LIMIT = 4_500;
const LINE_PUSH_BATCH_SIZE = 5;
const WHATSAPP_PUSH_TEXT_LIMIT = 3_800;
const WHATSAPP_API_VERSION_DEFAULT = 'v22.0';

type BridgePeerKind = 'dm' | 'group' | 'channel';

type QueuedBridgeEvent = {
  id: string;
  cursor: string;
  createdAt: string;
  peerId: string;
  peerKind: BridgePeerKind;
  userId?: string;
  groupId?: string;
  channelId?: string;
  accountId: string;
  authorId: string;
  text: string;
  metadata?: Record<string, string>;
};

type LineTargetKind = 'dm' | 'group' | 'channel';

type LineTargetSnapshot = {
  id: string;
  name: string;
  kind: LineTargetKind;
  count: number;
  lastSeenAt: string;
};

type LineResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  lineChannelAccessToken: string;
  lineChannelSecret?: string;
};

type WhatsAppResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappVerifyToken?: string;
  whatsappAppSecret?: string;
  whatsappApiVersion: string;
  whatsappGraphBaseUrl: string;
};

type SignalResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  signalSender: string;
  signalProviderBaseUrl: string;
  signalSendEndpoint: string;
  signalProviderToken?: string;
  signalWebhookToken?: string;
  signalProviderHealthEndpoint?: string;
};

type BlueBubblesResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  bluebubblesApiBaseUrl: string;
  bluebubblesSendEndpoint: string;
  bluebubblesHealthEndpoint?: string;
  bluebubblesProviderToken?: string;
  bluebubblesWebhookToken?: string;
  bluebubblesAuthHeader: string;
  bluebubblesAuthScheme?: string;
  bluebubblesSender?: string;
};

type IMessageResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  imessageApiBaseUrl: string;
  imessageSendEndpoint: string;
  imessageHealthEndpoint?: string;
  imessageProviderToken?: string;
  imessageWebhookToken?: string;
  imessageAuthHeader: string;
  imessageAuthScheme?: string;
  imessageSender?: string;
};

type NextcloudTalkResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  nextcloudApiBaseUrl: string;
  nextcloudSendEndpointTemplate: string;
  nextcloudHealthEndpoint?: string;
  nextcloudProviderToken?: string;
  nextcloudWebhookToken?: string;
  nextcloudAuthHeader: string;
  nextcloudAuthScheme?: string;
  nextcloudAuthMode: 'bearer' | 'basic' | 'header';
  nextcloudUsername?: string;
  nextcloudSender?: string;
  nextcloudUseOcsHeaders: boolean;
  nextcloudSendMessageField: string;
  nextcloudSendAsForm: boolean;
};

type NostrResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  nostrApiBaseUrl: string;
  nostrSendEndpoint: string;
  nostrHealthEndpoint?: string;
  nostrProviderToken?: string;
  nostrWebhookToken?: string;
  nostrAuthHeader: string;
  nostrAuthScheme?: string;
  nostrAuthMode: 'bearer' | 'header';
  nostrSender?: string;
  nostrSendPeerField: string;
  nostrSendMessageField: string;
  nostrSendAsForm: boolean;
};

type TlonResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  tlonApiBaseUrl: string;
  tlonSendEndpoint: string;
  tlonHealthEndpoint?: string;
  tlonProviderToken?: string;
  tlonWebhookToken?: string;
  tlonAuthHeader: string;
  tlonAuthScheme?: string;
  tlonAuthMode: 'bearer' | 'header';
  tlonSender?: string;
  tlonSendPeerField: string;
  tlonSendMessageField: string;
  tlonSendAsForm: boolean;
};

type ZaloResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  zaloApiBaseUrl: string;
  zaloSendEndpoint: string;
  zaloHealthEndpoint?: string;
  zaloProviderToken?: string;
  zaloWebhookToken?: string;
  zaloAuthHeader: string;
  zaloAuthScheme?: string;
  zaloAuthMode: 'bearer' | 'header';
  zaloSender?: string;
  zaloSendPeerField: string;
  zaloSendMessageField: string;
  zaloSendAsForm: boolean;
};

type ZaloUserResolvedInstance = {
  config: GatewayConnectorExtensionConfig;
  runtimeKey: string;
  accountId: string;
  bridgeSecret: string;
  zalouserApiBaseUrl: string;
  zalouserSendEndpoint: string;
  zalouserHealthEndpoint?: string;
  zalouserProviderToken?: string;
  zalouserWebhookToken?: string;
  zalouserAuthHeader: string;
  zalouserAuthScheme?: string;
  zalouserAuthMode: 'bearer' | 'header';
  zalouserSender?: string;
  zalouserSendPeerField: string;
  zalouserSendMessageField: string;
  zalouserSendAsForm: boolean;
};

const eventsByRuntimeKey = new Map<string, QueuedBridgeEvent[]>();
const nextCursorByRuntimeKey = new Map<string, number>();
const seenEventIdsByRuntimeKey = new Map<string, { seen: Set<string>; order: string[] }>();
const targetsByRuntimeKey = new Map<string, Map<string, LineTargetSnapshot>>();

let connectorBridgeServer: http.Server | null = null;

function normalizeToken(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function normalizeLower(value: string | undefined | null): string {
  return normalizeToken(value).toLowerCase();
}

function getConnectorBridgeRuntimePort(): number {
  const fromEnv = Number(process.env.CONNECTOR_BRIDGE_PORT || process.env.ODM_CONNECTOR_BRIDGE_PORT || '');
  if (Number.isFinite(fromEnv) && fromEnv >= 1 && fromEnv <= 65_535) {
    return Math.round(fromEnv);
  }
  return DEFAULT_CONNECTOR_BRIDGE_PORT;
}

export function getConnectorBridgeRuntimeBaseUrl(): string {
  return `http://${BRIDGE_HOST}:${getConnectorBridgeRuntimePort()}`;
}

function getMetadata(config: GatewayConnectorExtensionConfig, key: string): string {
  if (!config.metadata) return '';
  const wanted = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(config.metadata)) {
    if (entryKey.toLowerCase() === wanted) {
      return normalizeToken(entryValue);
    }
  }
  return '';
}

function splitLineText(text: string, limit = LINE_PUSH_TEXT_LIMIT): string[] {
  const chunks: string[] = [];
  let remaining = normalizeToken(text);
  while (remaining.length > limit) {
    let idx = remaining.lastIndexOf('\n', limit);
    if (idx < limit * 0.6) idx = remaining.lastIndexOf(' ', limit);
    if (idx <= 0) idx = limit;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length > 0 ? chunks : [''];
}

function splitWhatsAppText(text: string, limit = WHATSAPP_PUSH_TEXT_LIMIT): string[] {
  const chunks: string[] = [];
  let remaining = normalizeToken(text);
  while (remaining.length > limit) {
    let idx = remaining.lastIndexOf('\n', limit);
    if (idx < limit * 0.6) idx = remaining.lastIndexOf(' ', limit);
    if (idx <= 0) idx = limit;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length > 0 ? chunks : [''];
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseBearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return '';
  const [scheme, token] = header.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return '';
  return normalizeToken(token);
}

function listEnabledLineConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('line').filter((config) => config.enabled);
}

function listEnabledWhatsAppConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('whatsapp').filter((config) => config.enabled);
}

function listEnabledSignalConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('signal').filter((config) => config.enabled);
}

function listEnabledBlueBubblesConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('bluebubbles').filter((config) => config.enabled);
}

function listEnabledIMessageConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('imessage').filter((config) => config.enabled);
}

function listEnabledNextcloudTalkConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('nextcloud-talk').filter((config) => config.enabled);
}

function listEnabledNostrConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('nostr').filter((config) => config.enabled);
}

function listEnabledTlonConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('tlon').filter((config) => config.enabled);
}

function listEnabledZaloConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('zalo').filter((config) => config.enabled);
}

function listEnabledZaloUserConfigs(): GatewayConnectorExtensionConfig[] {
  return listGatewayConnectorExtensionConfigs('zalouser').filter((config) => config.enabled);
}

function resolveLineAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'line';
}

function resolveWhatsAppAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'whatsapp';
}

function resolveSignalAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'signal';
}

function resolveBlueBubblesAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'bluebubbles';
}

function resolveIMessageAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'imessage';
}

function resolveNextcloudTalkAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'nextcloud-talk';
}

function resolveNostrAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'nostr';
}

function resolveTlonAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'tlon';
}

function resolveZaloAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'zalo';
}

function resolveZaloUserAccountId(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(config.accountId)
    || normalizeToken(config.instanceId)
    || 'zalouser';
}

function resolveWhatsAppApiVersion(config: GatewayConnectorExtensionConfig): string {
  const version = normalizeToken(getMetadata(config, 'whatsapp_api_version'));
  if (!version) return WHATSAPP_API_VERSION_DEFAULT;
  return version.startsWith('v') ? version : `v${version}`;
}

function resolveWhatsAppGraphBaseUrl(config: GatewayConnectorExtensionConfig): string {
  return normalizeToken(getMetadata(config, 'whatsapp_graph_base_url')) || 'https://graph.facebook.com';
}

function ensureLeadingSlash(pathValue: string, fallback: string): string {
  const normalized = normalizeToken(pathValue) || fallback;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function buildSignalResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<SignalResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('signal', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const accountId = resolveSignalAccountId(config);
  const signalSender = normalizeToken(getMetadata(config, 'signal_sender'))
    || normalizeToken(config.accountId)
    || '';
  if (!signalSender) return null;
  const signalProviderBaseUrl = normalizeToken(getMetadata(config, 'signal_provider_base_url')) || 'http://127.0.0.1:8080';
  return {
    config,
    runtimeKey,
    accountId,
    bridgeSecret: storedSecret,
    signalSender,
    signalProviderBaseUrl,
    signalSendEndpoint: ensureLeadingSlash(getMetadata(config, 'signal_send_endpoint'), '/v2/send'),
    signalProviderToken: normalizeToken(getMetadata(config, 'signal_provider_token')) || storedSecret,
    signalWebhookToken: normalizeToken(getMetadata(config, 'signal_webhook_token')) || undefined,
    signalProviderHealthEndpoint: normalizeToken(getMetadata(config, 'signal_provider_health_endpoint')) || undefined,
  };
}

async function buildBlueBubblesResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<BlueBubblesResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('bluebubbles', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const accountId = resolveBlueBubblesAccountId(config);
  const bluebubblesApiBaseUrl = normalizeToken(getMetadata(config, 'bluebubbles_api_base_url')) || 'http://127.0.0.1:1234';
  return {
    config,
    runtimeKey,
    accountId,
    bridgeSecret: storedSecret,
    bluebubblesApiBaseUrl,
    bluebubblesSendEndpoint: ensureLeadingSlash(getMetadata(config, 'bluebubbles_send_endpoint'), '/api/v1/message/text'),
    bluebubblesHealthEndpoint: normalizeToken(getMetadata(config, 'bluebubbles_health_endpoint')) || '/api/v1/ping',
    bluebubblesProviderToken: normalizeToken(getMetadata(config, 'bluebubbles_provider_token')) || storedSecret,
    bluebubblesWebhookToken: normalizeToken(getMetadata(config, 'bluebubbles_webhook_token')) || undefined,
    bluebubblesAuthHeader: normalizeToken(getMetadata(config, 'bluebubbles_auth_header')) || 'Authorization',
    bluebubblesAuthScheme: normalizeToken(getMetadata(config, 'bluebubbles_auth_scheme')) || 'Bearer',
    bluebubblesSender: normalizeToken(getMetadata(config, 'bluebubbles_sender')) || normalizeToken(config.accountId) || undefined,
  };
}

async function buildIMessageResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<IMessageResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('imessage', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const accountId = resolveIMessageAccountId(config);
  const imessageApiBaseUrl = normalizeToken(getMetadata(config, 'imessage_api_base_url')) || 'http://127.0.0.1:1234';
  return {
    config,
    runtimeKey,
    accountId,
    bridgeSecret: storedSecret,
    imessageApiBaseUrl,
    imessageSendEndpoint: ensureLeadingSlash(getMetadata(config, 'imessage_send_endpoint'), '/api/v1/message/text'),
    imessageHealthEndpoint: normalizeToken(getMetadata(config, 'imessage_health_endpoint')) || '/api/v1/ping',
    imessageProviderToken: normalizeToken(getMetadata(config, 'imessage_provider_token')) || storedSecret,
    imessageWebhookToken: normalizeToken(getMetadata(config, 'imessage_webhook_token')) || undefined,
    imessageAuthHeader: normalizeToken(getMetadata(config, 'imessage_auth_header')) || 'Authorization',
    imessageAuthScheme: normalizeToken(getMetadata(config, 'imessage_auth_scheme')) || 'Bearer',
    imessageSender: normalizeToken(getMetadata(config, 'imessage_sender')) || normalizeToken(config.accountId) || undefined,
  };
}

function normalizeNextcloudAuthMode(value: string): NextcloudTalkResolvedInstance['nextcloudAuthMode'] {
  const normalized = normalizeLower(value);
  if (normalized === 'basic') return 'basic';
  if (normalized === 'header') return 'header';
  return 'bearer';
}

function fillEndpointTemplate(template: string, peerId: string): string {
  return template
    .replaceAll('{peerId}', encodeURIComponent(peerId))
    .replaceAll('{roomToken}', encodeURIComponent(peerId))
    .replaceAll('{token}', encodeURIComponent(peerId));
}

async function buildNextcloudTalkResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<NextcloudTalkResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('nextcloud-talk', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const nextcloudApiBaseUrl = normalizeToken(getMetadata(config, 'nextcloud_api_base_url'))
    || normalizeToken(config.bridgeUrl)
    || 'http://127.0.0.1:8081';
  return {
    config,
    runtimeKey,
    accountId: resolveNextcloudTalkAccountId(config),
    bridgeSecret: storedSecret,
    nextcloudApiBaseUrl,
    nextcloudSendEndpointTemplate: normalizeToken(getMetadata(config, 'nextcloud_send_endpoint_template'))
      || '/ocs/v2.php/apps/spreed/api/v4/chat/{roomToken}',
    nextcloudHealthEndpoint: normalizeToken(getMetadata(config, 'nextcloud_health_endpoint'))
      || '/ocs/v2.php/cloud/capabilities',
    nextcloudProviderToken: normalizeToken(getMetadata(config, 'nextcloud_provider_token')) || storedSecret,
    nextcloudWebhookToken: normalizeToken(getMetadata(config, 'nextcloud_webhook_token')) || undefined,
    nextcloudAuthHeader: normalizeToken(getMetadata(config, 'nextcloud_auth_header')) || 'Authorization',
    nextcloudAuthScheme: normalizeToken(getMetadata(config, 'nextcloud_auth_scheme')) || 'Bearer',
    nextcloudAuthMode: normalizeNextcloudAuthMode(getMetadata(config, 'nextcloud_auth_mode')),
    nextcloudUsername: normalizeToken(getMetadata(config, 'nextcloud_username')) || undefined,
    nextcloudSender: normalizeToken(getMetadata(config, 'nextcloud_sender')) || normalizeToken(config.accountId) || undefined,
    nextcloudUseOcsHeaders: parseTruthy(getMetadata(config, 'nextcloud_use_ocs_headers') || 'true'),
    nextcloudSendMessageField: normalizeToken(getMetadata(config, 'nextcloud_send_message_field')) || 'message',
    nextcloudSendAsForm: parseTruthy(getMetadata(config, 'nextcloud_send_as_form') || ''),
  };
}

function normalizeNostrAuthMode(value: string): NostrResolvedInstance['nostrAuthMode'] {
  return normalizeLower(value) === 'header' ? 'header' : 'bearer';
}

async function buildNostrResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<NostrResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('nostr', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const nostrApiBaseUrl = normalizeToken(getMetadata(config, 'nostr_api_base_url'))
    || normalizeToken(config.bridgeUrl)
    || 'http://127.0.0.1:8090';
  return {
    config,
    runtimeKey,
    accountId: resolveNostrAccountId(config),
    bridgeSecret: storedSecret,
    nostrApiBaseUrl,
    nostrSendEndpoint: normalizeToken(getMetadata(config, 'nostr_send_endpoint')) || '/api/v1/send',
    nostrHealthEndpoint: normalizeToken(getMetadata(config, 'nostr_health_endpoint')) || '/health',
    nostrProviderToken: normalizeToken(getMetadata(config, 'nostr_provider_token')) || storedSecret,
    nostrWebhookToken: normalizeToken(getMetadata(config, 'nostr_webhook_token')) || undefined,
    nostrAuthHeader: normalizeToken(getMetadata(config, 'nostr_auth_header')) || 'Authorization',
    nostrAuthScheme: normalizeToken(getMetadata(config, 'nostr_auth_scheme')) || 'Bearer',
    nostrAuthMode: normalizeNostrAuthMode(getMetadata(config, 'nostr_auth_mode')),
    nostrSender: normalizeToken(getMetadata(config, 'nostr_sender')) || normalizeToken(config.accountId) || undefined,
    nostrSendPeerField: normalizeToken(getMetadata(config, 'nostr_send_peer_field')) || 'peerId',
    nostrSendMessageField: normalizeToken(getMetadata(config, 'nostr_send_message_field')) || 'text',
    nostrSendAsForm: parseTruthy(getMetadata(config, 'nostr_send_as_form') || ''),
  };
}

function normalizeTlonAuthMode(value: string): TlonResolvedInstance['tlonAuthMode'] {
  return normalizeLower(value) === 'header' ? 'header' : 'bearer';
}

async function buildTlonResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<TlonResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('tlon', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const tlonApiBaseUrl = normalizeToken(getMetadata(config, 'tlon_api_base_url'))
    || normalizeToken(config.bridgeUrl)
    || 'http://127.0.0.1:8091';
  return {
    config,
    runtimeKey,
    accountId: resolveTlonAccountId(config),
    bridgeSecret: storedSecret,
    tlonApiBaseUrl,
    tlonSendEndpoint: normalizeToken(getMetadata(config, 'tlon_send_endpoint')) || '/api/v1/send',
    tlonHealthEndpoint: normalizeToken(getMetadata(config, 'tlon_health_endpoint')) || '/health',
    tlonProviderToken: normalizeToken(getMetadata(config, 'tlon_provider_token')) || storedSecret,
    tlonWebhookToken: normalizeToken(getMetadata(config, 'tlon_webhook_token')) || undefined,
    tlonAuthHeader: normalizeToken(getMetadata(config, 'tlon_auth_header')) || 'Authorization',
    tlonAuthScheme: normalizeToken(getMetadata(config, 'tlon_auth_scheme')) || 'Bearer',
    tlonAuthMode: normalizeTlonAuthMode(getMetadata(config, 'tlon_auth_mode')),
    tlonSender: normalizeToken(getMetadata(config, 'tlon_sender')) || normalizeToken(config.accountId) || undefined,
    tlonSendPeerField: normalizeToken(getMetadata(config, 'tlon_send_peer_field')) || 'peerId',
    tlonSendMessageField: normalizeToken(getMetadata(config, 'tlon_send_message_field')) || 'text',
    tlonSendAsForm: parseTruthy(getMetadata(config, 'tlon_send_as_form') || ''),
  };
}

function normalizeZaloAuthMode(value: string): ZaloResolvedInstance['zaloAuthMode'] {
  return normalizeLower(value) === 'header' ? 'header' : 'bearer';
}

async function buildZaloResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<ZaloResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('zalo', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const zaloApiBaseUrl = normalizeToken(getMetadata(config, 'zalo_api_base_url'))
    || normalizeToken(config.bridgeUrl)
    || 'http://127.0.0.1:8092';
  return {
    config,
    runtimeKey,
    accountId: resolveZaloAccountId(config),
    bridgeSecret: storedSecret,
    zaloApiBaseUrl,
    zaloSendEndpoint: normalizeToken(getMetadata(config, 'zalo_send_endpoint')) || '/api/v1/send',
    zaloHealthEndpoint: normalizeToken(getMetadata(config, 'zalo_health_endpoint')) || '/health',
    zaloProviderToken: normalizeToken(getMetadata(config, 'zalo_provider_token')) || storedSecret,
    zaloWebhookToken: normalizeToken(getMetadata(config, 'zalo_webhook_token')) || undefined,
    zaloAuthHeader: normalizeToken(getMetadata(config, 'zalo_auth_header')) || 'Authorization',
    zaloAuthScheme: normalizeToken(getMetadata(config, 'zalo_auth_scheme')) || 'Bearer',
    zaloAuthMode: normalizeZaloAuthMode(getMetadata(config, 'zalo_auth_mode')),
    zaloSender: normalizeToken(getMetadata(config, 'zalo_sender')) || normalizeToken(config.accountId) || undefined,
    zaloSendPeerField: normalizeToken(getMetadata(config, 'zalo_send_peer_field')) || 'peerId',
    zaloSendMessageField: normalizeToken(getMetadata(config, 'zalo_send_message_field')) || 'text',
    zaloSendAsForm: parseTruthy(getMetadata(config, 'zalo_send_as_form') || ''),
  };
}

function normalizeZaloUserAuthMode(value: string): ZaloUserResolvedInstance['zalouserAuthMode'] {
  return normalizeLower(value) === 'header' ? 'header' : 'bearer';
}

async function buildZaloUserResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<ZaloUserResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('zalouser', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const zalouserApiBaseUrl = normalizeToken(getMetadata(config, 'zalouser_api_base_url'))
    || normalizeToken(config.bridgeUrl)
    || 'http://127.0.0.1:8093';
  return {
    config,
    runtimeKey,
    accountId: resolveZaloUserAccountId(config),
    bridgeSecret: storedSecret,
    zalouserApiBaseUrl,
    zalouserSendEndpoint: normalizeToken(getMetadata(config, 'zalouser_send_endpoint')) || '/api/v1/send',
    zalouserHealthEndpoint: normalizeToken(getMetadata(config, 'zalouser_health_endpoint')) || '/health',
    zalouserProviderToken: normalizeToken(getMetadata(config, 'zalouser_provider_token')) || storedSecret,
    zalouserWebhookToken: normalizeToken(getMetadata(config, 'zalouser_webhook_token')) || undefined,
    zalouserAuthHeader: normalizeToken(getMetadata(config, 'zalouser_auth_header')) || 'Authorization',
    zalouserAuthScheme: normalizeToken(getMetadata(config, 'zalouser_auth_scheme')) || 'Bearer',
    zalouserAuthMode: normalizeZaloUserAuthMode(getMetadata(config, 'zalouser_auth_mode')),
    zalouserSender: normalizeToken(getMetadata(config, 'zalouser_sender')) || normalizeToken(config.accountId) || undefined,
    zalouserSendPeerField: normalizeToken(getMetadata(config, 'zalouser_send_peer_field')) || 'peerId',
    zalouserSendMessageField: normalizeToken(getMetadata(config, 'zalouser_send_message_field')) || 'text',
    zalouserSendAsForm: parseTruthy(getMetadata(config, 'zalouser_send_as_form') || ''),
  };
}

async function buildWhatsAppResolvedInstance(
  config: GatewayConnectorExtensionConfig
): Promise<WhatsAppResolvedInstance | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey('whatsapp', config.instanceId);
  const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
  if (!storedSecret) return null;
  const whatsappPhoneNumberId = normalizeToken(getMetadata(config, 'whatsapp_phone_number_id'));
  if (!whatsappPhoneNumberId) return null;
  return {
    config,
    runtimeKey,
    accountId: resolveWhatsAppAccountId(config),
    bridgeSecret: storedSecret,
    whatsappAccessToken: storedSecret,
    whatsappPhoneNumberId,
    whatsappVerifyToken: normalizeToken(getMetadata(config, 'whatsapp_verify_token')) || undefined,
    whatsappAppSecret: normalizeToken(getMetadata(config, 'whatsapp_app_secret')) || undefined,
    whatsappApiVersion: resolveWhatsAppApiVersion(config),
    whatsappGraphBaseUrl: resolveWhatsAppGraphBaseUrl(config),
  };
}

async function resolveLineInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: LineResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: LineResolvedInstance | null = null;
  for (const config of listEnabledLineConfigs()) {
    const runtimeKey = getGatewayConnectorRuntimeKey('line', config.instanceId);
    const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
    if (!storedSecret || !safeEqual(storedSecret, normalizedSecret)) continue;
    const lineChannelAccessToken = normalizeToken(getMetadata(config, 'line_channel_access_token')) || storedSecret;
    const candidate: LineResolvedInstance = {
      config,
      runtimeKey,
      accountId: resolveLineAccountId(config),
      bridgeSecret: storedSecret,
      lineChannelAccessToken,
      lineChannelSecret: normalizeToken(getMetadata(config, 'line_channel_secret')) || undefined,
    };
    if (normalizedAccountIdHint && candidate.accountId !== normalizedAccountIdHint) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveWhatsAppInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: WhatsAppResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: WhatsAppResolvedInstance | null = null;
  for (const config of listEnabledWhatsAppConfigs()) {
    const candidate = await buildWhatsAppResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (normalizedAccountIdHint && candidate.accountId !== normalizedAccountIdHint) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveSignalInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: SignalResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: SignalResolvedInstance | null = null;
  for (const config of listEnabledSignalConfigs()) {
    const candidate = await buildSignalResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.signalSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveBlueBubblesInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: BlueBubblesResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: BlueBubblesResolvedInstance | null = null;
  for (const config of listEnabledBlueBubblesConfigs()) {
    const candidate = await buildBlueBubblesResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.bluebubblesSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveIMessageInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: IMessageResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: IMessageResolvedInstance | null = null;
  for (const config of listEnabledIMessageConfigs()) {
    const candidate = await buildIMessageResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.imessageSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveNextcloudTalkInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: NextcloudTalkResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: NextcloudTalkResolvedInstance | null = null;
  for (const config of listEnabledNextcloudTalkConfigs()) {
    const candidate = await buildNextcloudTalkResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.nextcloudSender !== normalizedAccountIdHint
      && candidate.nextcloudUsername !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveNostrInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: NostrResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: NostrResolvedInstance | null = null;
  for (const config of listEnabledNostrConfigs()) {
    const candidate = await buildNostrResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.nostrSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveTlonInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: TlonResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: TlonResolvedInstance | null = null;
  for (const config of listEnabledTlonConfigs()) {
    const candidate = await buildTlonResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.tlonSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveZaloInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: ZaloResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: ZaloResolvedInstance | null = null;
  for (const config of listEnabledZaloConfigs()) {
    const candidate = await buildZaloResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.zaloSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveZaloUserInstanceFromBridgeSecret(
  bridgeSecret: string,
  accountIdHint?: string
): Promise<{ instance: ZaloUserResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSecret = normalizeToken(bridgeSecret);
  const normalizedAccountIdHint = normalizeToken(accountIdHint);
  if (!normalizedSecret) {
    return { instance: null, ambiguous: false };
  }
  let matched: ZaloUserResolvedInstance | null = null;
  for (const config of listEnabledZaloUserConfigs()) {
    const candidate = await buildZaloUserResolvedInstance(config);
    if (!candidate || !safeEqual(candidate.bridgeSecret, normalizedSecret)) continue;
    if (
      normalizedAccountIdHint
      && candidate.accountId !== normalizedAccountIdHint
      && candidate.zalouserSender !== normalizedAccountIdHint
    ) {
      continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

function ensureQueue(runtimeKey: string): QueuedBridgeEvent[] {
  const existing = eventsByRuntimeKey.get(runtimeKey);
  if (existing) return existing;
  const created: QueuedBridgeEvent[] = [];
  eventsByRuntimeKey.set(runtimeKey, created);
  return created;
}

function ensureTargets(runtimeKey: string): Map<string, LineTargetSnapshot> {
  const existing = targetsByRuntimeKey.get(runtimeKey);
  if (existing) return existing;
  const created = new Map<string, LineTargetSnapshot>();
  targetsByRuntimeKey.set(runtimeKey, created);
  return created;
}

function ensureSeen(runtimeKey: string): { seen: Set<string>; order: string[] } {
  const existing = seenEventIdsByRuntimeKey.get(runtimeKey);
  if (existing) return existing;
  const created = { seen: new Set<string>(), order: [] };
  seenEventIdsByRuntimeKey.set(runtimeKey, created);
  return created;
}

function rememberBridgeEventId(runtimeKey: string, eventId: string): boolean {
  const normalized = normalizeToken(eventId);
  if (!normalized) return false;
  const store = ensureSeen(runtimeKey);
  if (store.seen.has(normalized)) return false;
  store.seen.add(normalized);
  store.order.push(normalized);
  while (store.order.length > MAX_SEEN_EVENT_IDS) {
    const removed = store.order.shift();
    if (removed) store.seen.delete(removed);
  }
  return true;
}

function enqueueBridgeEvent(runtimeKey: string, event: Omit<QueuedBridgeEvent, 'cursor'>): QueuedBridgeEvent {
  const queue = ensureQueue(runtimeKey);
  const nextCursor = (nextCursorByRuntimeKey.get(runtimeKey) ?? 0) + 1;
  nextCursorByRuntimeKey.set(runtimeKey, nextCursor);
  const queued: QueuedBridgeEvent = {
    ...event,
    cursor: String(nextCursor),
  };
  queue.push(queued);
  if (queue.length > MAX_EVENTS_PER_INSTANCE) {
    queue.splice(0, queue.length - MAX_EVENTS_PER_INSTANCE);
  }
  return queued;
}

function recordBridgeTarget(runtimeKey: string, peerId: string, kind: LineTargetKind): void {
  const id = normalizeToken(peerId);
  if (!id) return;
  const targets = ensureTargets(runtimeKey);
  const key = `${kind}:${id}`;
  const now = new Date().toISOString();
  const existing = targets.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = now;
    return;
  }
  targets.set(key, {
    id,
    name: id,
    kind,
    count: 1,
    lastSeenAt: now,
  });
}

function lineSourceToPeer(source: Record<string, unknown>): {
  peerKind: BridgePeerKind;
  peerId: string;
  userId?: string;
  groupId?: string;
  channelId?: string;
} | null {
  const sourceType = normalizeLower(String(source.type ?? ''));
  const userId = normalizeToken(String(source.userId ?? '')) || undefined;
  const groupId = normalizeToken(String(source.groupId ?? '')) || undefined;
  const roomId = normalizeToken(String(source.roomId ?? '')) || undefined;
  if (sourceType === 'user' && userId) {
    return {
      peerKind: 'dm',
      peerId: userId,
      userId,
    };
  }
  if (sourceType === 'group' && groupId) {
    return {
      peerKind: 'group',
      peerId: groupId,
      userId,
      groupId,
    };
  }
  if (sourceType === 'room' && roomId) {
    return {
      peerKind: 'channel',
      peerId: roomId,
      userId,
      channelId: roomId,
    };
  }
  return null;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts).toString('utf8');
}

async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req);
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON');
  }
}

function normalizeLineWebhookSignature(value: string | string[] | undefined): string {
  if (typeof value !== 'string') return '';
  return normalizeToken(value);
}

function computeLineWebhookSignature(rawBody: string, channelSecret: string): string {
  return crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody, 'utf8')
    .digest('base64');
}

async function resolveLineInstanceFromWebhook(
  rawBody: string,
  signature: string
): Promise<{ instance: LineResolvedInstance | null; ambiguous: boolean }> {
  const normalizedSignature = normalizeToken(signature);
  if (!normalizedSignature) {
    return { instance: null, ambiguous: false };
  }
  let matched: LineResolvedInstance | null = null;
  for (const config of listEnabledLineConfigs()) {
    const runtimeKey = getGatewayConnectorRuntimeKey('line', config.instanceId);
    const storedSecret = normalizeToken(await getGatewayConnectorSecret(runtimeKey));
    if (!storedSecret) continue;
    const channelSecret = normalizeToken(getMetadata(config, 'line_channel_secret'));
    if (!channelSecret) continue;
    const expectedSignature = computeLineWebhookSignature(rawBody, channelSecret);
    if (!safeEqual(expectedSignature, normalizedSignature)) continue;
    const lineChannelAccessToken = normalizeToken(getMetadata(config, 'line_channel_access_token')) || storedSecret;
    const candidate: LineResolvedInstance = {
      config,
      runtimeKey,
      accountId: resolveLineAccountId(config),
      bridgeSecret: storedSecret,
      lineChannelAccessToken,
      lineChannelSecret: channelSecret,
    };
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function pushLineMessage(
  lineChannelAccessToken: string,
  to: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (let index = 0; index < chunks.length; index += LINE_PUSH_BATCH_SIZE) {
    const batch = chunks.slice(index, index + LINE_PUSH_BATCH_SIZE).map((chunk) => ({
      type: 'text',
      text: chunk || ' ',
    }));
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lineChannelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        messages: batch,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`LINE push failed: ${detail || response.statusText}`);
    }
  }
}

function normalizeWhatsAppWebhookSignature(value: string | string[] | undefined): string {
  if (typeof value !== 'string') return '';
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  const prefix = 'sha256=';
  if (normalized.toLowerCase().startsWith(prefix)) {
    return normalized.slice(prefix.length).toLowerCase();
  }
  return normalized.toLowerCase();
}

function computeWhatsAppWebhookSignature(rawBody: string, appSecret: string): string {
  return crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex')
    .toLowerCase();
}

async function resolveWhatsAppInstanceFromWebhookVerifyToken(
  verifyToken: string
): Promise<{ instance: WhatsAppResolvedInstance | null; ambiguous: boolean }> {
  const normalizedVerifyToken = normalizeToken(verifyToken);
  if (!normalizedVerifyToken) {
    return { instance: null, ambiguous: false };
  }
  let matched: WhatsAppResolvedInstance | null = null;
  for (const config of listEnabledWhatsAppConfigs()) {
    const expectedToken = normalizeToken(getMetadata(config, 'whatsapp_verify_token'));
    if (!expectedToken || expectedToken !== normalizedVerifyToken) continue;
    const candidate = await buildWhatsAppResolvedInstance(config);
    if (!candidate) continue;
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

async function resolveWhatsAppInstanceFromWebhookPayload(
  payload: Record<string, unknown>
): Promise<{ instance: WhatsAppResolvedInstance | null; ambiguous: boolean }> {
  const entries = Array.isArray(payload.entry) ? payload.entry as Array<Record<string, unknown>> : [];
  const phoneIds = new Set<string>();
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : [];
    for (const change of changes) {
      const value = change.value && typeof change.value === 'object'
        ? change.value as Record<string, unknown>
        : null;
      const metadata = value?.metadata && typeof value.metadata === 'object'
        ? value.metadata as Record<string, unknown>
        : null;
      const phoneId = normalizeToken(String(metadata?.phone_number_id ?? ''));
      if (phoneId) phoneIds.add(phoneId);
    }
  }
  if (phoneIds.size === 0) {
    return { instance: null, ambiguous: false };
  }
  let matched: WhatsAppResolvedInstance | null = null;
  for (const config of listEnabledWhatsAppConfigs()) {
    const expectedPhoneId = normalizeToken(getMetadata(config, 'whatsapp_phone_number_id'));
    if (!expectedPhoneId || !phoneIds.has(expectedPhoneId)) continue;
    const candidate = await buildWhatsAppResolvedInstance(config);
    if (!candidate) continue;
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  return { instance: matched, ambiguous: false };
}

function buildWhatsAppApiUrl(
  instance: WhatsAppResolvedInstance,
  pathSuffix: string,
  query?: Record<string, string>
): string {
  const base = instance.whatsappGraphBaseUrl.endsWith('/')
    ? instance.whatsappGraphBaseUrl.slice(0, -1)
    : instance.whatsappGraphBaseUrl;
  const suffix = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  const url = new URL(`${base}/${instance.whatsappApiVersion}${suffix}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function sendWhatsAppMessage(
  instance: WhatsAppResolvedInstance,
  to: string,
  text: string
): Promise<void> {
  const chunks = splitWhatsAppText(text);
  for (const chunk of chunks) {
    const response = await fetch(
      buildWhatsAppApiUrl(instance, `/${encodeURIComponent(instance.whatsappPhoneNumberId)}/messages`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${instance.whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            body: chunk || ' ',
          },
        }),
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`WhatsApp send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateWhatsAppHealth(instance: WhatsAppResolvedInstance): Promise<void> {
  const response = await fetch(
    buildWhatsAppApiUrl(instance, `/${encodeURIComponent(instance.whatsappPhoneNumberId)}`, {
      fields: 'id',
    }),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${instance.whatsappAccessToken}`,
      },
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`WhatsApp health check failed: ${detail || response.statusText}`);
  }
}

function buildSignalProviderUrl(instance: SignalResolvedInstance, endpoint: string): string {
  const base = instance.signalProviderBaseUrl.endsWith('/')
    ? instance.signalProviderBaseUrl.slice(0, -1)
    : instance.signalProviderBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getSignalProviderHeaders(instance: SignalResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = normalizeToken(instance.signalProviderToken);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function sendSignalMessage(
  instance: SignalResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const response = await fetch(buildSignalProviderUrl(instance, instance.signalSendEndpoint), {
      method: 'POST',
      headers: getSignalProviderHeaders(instance),
      body: JSON.stringify({
        message: chunk || ' ',
        number: instance.signalSender,
        recipients: [recipient],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Signal send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateSignalHealth(instance: SignalResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.signalProviderHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildSignalProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getSignalProviderHeaders(instance),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Signal health check failed: ${detail || response.statusText}`);
  }
}

function parseSignalWebhookEvent(
  event: Record<string, unknown>
): { from: string; text: string; eventId: string; timestampMs: number } | null {
  const envelope = event.envelope && typeof event.envelope === 'object'
    ? event.envelope as Record<string, unknown>
    : null;
  const dataMessage = envelope?.dataMessage && typeof envelope.dataMessage === 'object'
    ? envelope.dataMessage as Record<string, unknown>
    : null;
  const syncMessage = envelope?.syncMessage && typeof envelope.syncMessage === 'object'
    ? envelope.syncMessage as Record<string, unknown>
    : null;
  const sentMessage = syncMessage?.sentMessage && typeof syncMessage.sentMessage === 'object'
    ? syncMessage.sentMessage as Record<string, unknown>
    : null;

  const from = normalizeToken(String(
    event.from
    ?? event.source
    ?? event.sourceNumber
    ?? envelope?.sourceNumber
    ?? ''
  ));
  const text = normalizeToken(String(
    event.text
    ?? event.message
    ?? dataMessage?.message
    ?? sentMessage?.message
    ?? ''
  ));
  const eventId = normalizeToken(String(
    event.id
    ?? event.messageId
    ?? envelope?.timestamp
    ?? event.timestamp
    ?? ''
  ));
  const timestampRaw = Number(
    event.timestamp
    ?? envelope?.timestamp
    ?? Date.now()
  );
  const timestampMs = Number.isFinite(timestampRaw)
    ? (timestampRaw < 10_000_000_000 ? timestampRaw * 1000 : timestampRaw)
    : Date.now();

  if (!from || !text) return null;
  return {
    from,
    text,
    eventId: eventId || `${from}_${timestampMs}`,
    timestampMs,
  };
}

function extractSignalAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.number);
  push(payload.receiver);
  const envelope = payload.envelope && typeof payload.envelope === 'object'
    ? payload.envelope as Record<string, unknown>
    : null;
  push(envelope?.destination);
  push(envelope?.account);
  return Array.from(hints);
}

async function resolveSignalInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: SignalResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractSignalAccountHints(payload, accountHint);
  let matched: SignalResolvedInstance | null = null;
  for (const config of listEnabledSignalConfigs()) {
    const candidate = await buildSignalResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.signalSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledSignalConfigs().map((config) => buildSignalResolvedInstance(config)));
    const candidates = all.filter((entry): entry is SignalResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildBlueBubblesProviderUrl(instance: BlueBubblesResolvedInstance, endpoint: string): string {
  const base = instance.bluebubblesApiBaseUrl.endsWith('/')
    ? instance.bluebubblesApiBaseUrl.slice(0, -1)
    : instance.bluebubblesApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getBlueBubblesProviderHeaders(instance: BlueBubblesResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = normalizeToken(instance.bluebubblesProviderToken);
  if (token) {
    const headerName = normalizeToken(instance.bluebubblesAuthHeader) || 'Authorization';
    const authScheme = normalizeToken(instance.bluebubblesAuthScheme);
    headers[headerName] = authScheme ? `${authScheme} ${token}` : token;
  }
  return headers;
}

async function sendBlueBubblesMessage(
  instance: BlueBubblesResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      chatGuid: recipient,
      message: chunk || ' ',
    };
    if (instance.bluebubblesSender) {
      body.from = instance.bluebubblesSender;
    }
    const response = await fetch(buildBlueBubblesProviderUrl(instance, instance.bluebubblesSendEndpoint), {
      method: 'POST',
      headers: getBlueBubblesProviderHeaders(instance),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`BlueBubbles send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateBlueBubblesHealth(instance: BlueBubblesResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.bluebubblesHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildBlueBubblesProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getBlueBubblesProviderHeaders(instance),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`BlueBubbles health check failed: ${detail || response.statusText}`);
  }
}

function parseTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === 'on';
}

function parseBlueBubblesWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : null;
  const message = event.message && typeof event.message === 'object' && !Array.isArray(event.message)
    ? event.message as Record<string, unknown>
    : null;
  const nestedMessage = data?.message && typeof data.message === 'object' && !Array.isArray(data.message)
    ? data.message as Record<string, unknown>
    : null;

  const isFromMe = parseTruthy(
    event.isFromMe
    ?? event.fromMe
    ?? message?.isFromMe
    ?? message?.fromMe
    ?? nestedMessage?.isFromMe
    ?? nestedMessage?.fromMe
  );
  if (isFromMe) return null;

  const textCandidate = [
    event.text,
    event.body,
    message?.text,
    message?.body,
    message?.message,
    nestedMessage?.text,
    nestedMessage?.body,
    nestedMessage?.message,
  ].find((entry) => typeof entry === 'string' || typeof entry === 'number');
  const text = normalizeToken(String(textCandidate ?? ''));
  if (!text) return null;

  const peerId = normalizeToken(String(
    event.chatGuid
    ?? event.chat_guid
    ?? event.threadId
    ?? event.conversationId
    ?? message?.chatGuid
    ?? message?.chat_guid
    ?? message?.threadId
    ?? message?.conversationId
    ?? nestedMessage?.chatGuid
    ?? nestedMessage?.chat_guid
    ?? nestedMessage?.threadId
    ?? nestedMessage?.conversationId
    ?? ''
  ));
  if (!peerId) return null;

  const authorId = normalizeToken(String(
    event.sender
    ?? event.handle
    ?? event.from
    ?? message?.sender
    ?? message?.handle
    ?? message?.from
    ?? nestedMessage?.sender
    ?? nestedMessage?.handle
    ?? nestedMessage?.from
    ?? peerId
  )) || peerId;

  const eventId = normalizeToken(String(
    event.guid
    ?? event.id
    ?? message?.guid
    ?? message?.id
    ?? nestedMessage?.guid
    ?? nestedMessage?.id
    ?? ''
  ));
  const timestampRaw = Number(
    event.date
    ?? event.timestamp
    ?? message?.date
    ?? message?.timestamp
    ?? nestedMessage?.date
    ?? nestedMessage?.timestamp
    ?? Date.now()
  );
  const timestampMs = Number.isFinite(timestampRaw)
    ? (timestampRaw < 10_000_000_000 ? timestampRaw * 1000 : timestampRaw)
    : Date.now();
  const peerKind: BridgePeerKind = /;|,/.test(peerId) ? 'group' : 'dm';

  return {
    peerId,
    peerKind,
    authorId,
    text,
    eventId: eventId || `${peerId}_${authorId}_${timestampMs}`,
    timestampMs,
  };
}

function extractBlueBubblesAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.from);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.from);
  return Array.from(hints);
}

async function resolveBlueBubblesInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: BlueBubblesResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractBlueBubblesAccountHints(payload, accountHint);
  let matched: BlueBubblesResolvedInstance | null = null;
  for (const config of listEnabledBlueBubblesConfigs()) {
    const candidate = await buildBlueBubblesResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.bluebubblesSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledBlueBubblesConfigs().map((config) => buildBlueBubblesResolvedInstance(config)));
    const candidates = all.filter((entry): entry is BlueBubblesResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildIMessageProviderUrl(instance: IMessageResolvedInstance, endpoint: string): string {
  const base = instance.imessageApiBaseUrl.endsWith('/')
    ? instance.imessageApiBaseUrl.slice(0, -1)
    : instance.imessageApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getIMessageProviderHeaders(instance: IMessageResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = normalizeToken(instance.imessageProviderToken);
  if (token) {
    const headerName = normalizeToken(instance.imessageAuthHeader) || 'Authorization';
    const authScheme = normalizeToken(instance.imessageAuthScheme);
    headers[headerName] = authScheme ? `${authScheme} ${token}` : token;
  }
  return headers;
}

async function sendIMessage(
  instance: IMessageResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      chatGuid: recipient,
      message: chunk || ' ',
    };
    if (instance.imessageSender) {
      body.from = instance.imessageSender;
    }
    const response = await fetch(buildIMessageProviderUrl(instance, instance.imessageSendEndpoint), {
      method: 'POST',
      headers: getIMessageProviderHeaders(instance),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`iMessage send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateIMessageHealth(instance: IMessageResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.imessageHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildIMessageProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getIMessageProviderHeaders(instance),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`iMessage health check failed: ${detail || response.statusText}`);
  }
}

function parseIMessageWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  return parseBlueBubblesWebhookMessage(event);
}

function extractIMessageAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.from);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.from);
  return Array.from(hints);
}

async function resolveIMessageInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: IMessageResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractIMessageAccountHints(payload, accountHint);
  let matched: IMessageResolvedInstance | null = null;
  for (const config of listEnabledIMessageConfigs()) {
    const candidate = await buildIMessageResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.imessageSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledIMessageConfigs().map((config) => buildIMessageResolvedInstance(config)));
    const candidates = all.filter((entry): entry is IMessageResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildNextcloudTalkProviderUrl(instance: NextcloudTalkResolvedInstance, endpoint: string): string {
  const base = instance.nextcloudApiBaseUrl.endsWith('/')
    ? instance.nextcloudApiBaseUrl.slice(0, -1)
    : instance.nextcloudApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getNextcloudTalkProviderHeaders(instance: NextcloudTalkResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': instance.nextcloudSendAsForm
      ? 'application/x-www-form-urlencoded'
      : 'application/json',
  };
  if (instance.nextcloudUseOcsHeaders) {
    headers['OCS-APIRequest'] = 'true';
    headers.Accept = 'application/json';
  }
  const token = normalizeToken(instance.nextcloudProviderToken);
  if (!token) return headers;
  if (instance.nextcloudAuthMode === 'basic') {
    const username = normalizeToken(instance.nextcloudUsername);
    if (username) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${token}`, 'utf8').toString('base64')}`;
      return headers;
    }
  }
  if (instance.nextcloudAuthMode === 'header') {
    const headerName = normalizeToken(instance.nextcloudAuthHeader) || 'Authorization';
    headers[headerName] = token;
    return headers;
  }
  const headerName = normalizeToken(instance.nextcloudAuthHeader) || 'Authorization';
  const authScheme = normalizeToken(instance.nextcloudAuthScheme) || 'Bearer';
  headers[headerName] = `${authScheme} ${token}`;
  return headers;
}

async function sendNextcloudTalkMessage(
  instance: NextcloudTalkResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  const endpoint = fillEndpointTemplate(instance.nextcloudSendEndpointTemplate, recipient);
  for (const chunk of chunks) {
    const headers = getNextcloudTalkProviderHeaders(instance);
    const response = await fetch(buildNextcloudTalkProviderUrl(instance, endpoint), {
      method: 'POST',
      headers,
      body: instance.nextcloudSendAsForm
        ? new URLSearchParams({ [instance.nextcloudSendMessageField]: chunk || ' ' }).toString()
        : JSON.stringify({ [instance.nextcloudSendMessageField]: chunk || ' ' }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Nextcloud Talk send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateNextcloudTalkHealth(instance: NextcloudTalkResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.nextcloudHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildNextcloudTalkProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getNextcloudTalkProviderHeaders({
      ...instance,
      nextcloudSendAsForm: false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Nextcloud Talk health check failed: ${detail || response.statusText}`);
  }
}

function parseNextcloudTalkWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : null;
  const object = event.object && typeof event.object === 'object' && !Array.isArray(event.object)
    ? event.object as Record<string, unknown>
    : null;

  const textCandidate = [
    event.message,
    event.text,
    event.body,
    data?.message,
    data?.text,
    data?.body,
    object?.message,
    object?.text,
    object?.body,
  ].find((entry) => typeof entry === 'string' || typeof entry === 'number');
  const text = normalizeToken(String(textCandidate ?? ''));
  if (!text) return null;

  const peerId = normalizeToken(String(
    event.roomToken
    ?? event.token
    ?? event.room
    ?? event.conversationId
    ?? event.chatId
    ?? data?.roomToken
    ?? data?.token
    ?? data?.room
    ?? data?.conversationId
    ?? data?.chatId
    ?? object?.roomToken
    ?? object?.token
    ?? object?.room
    ?? object?.conversationId
    ?? object?.chatId
    ?? ''
  ));
  if (!peerId) return null;

  const authorId = normalizeToken(String(
    event.actorId
    ?? event.userId
    ?? event.from
    ?? data?.actorId
    ?? data?.userId
    ?? data?.from
    ?? object?.actorId
    ?? object?.userId
    ?? object?.from
    ?? peerId
  )) || peerId;

  const eventId = normalizeToken(String(
    event.id
    ?? event.eventId
    ?? event.messageId
    ?? data?.id
    ?? data?.eventId
    ?? data?.messageId
    ?? object?.id
    ?? object?.eventId
    ?? object?.messageId
    ?? ''
  ));
  const timestampRaw = Number(
    event.timestamp
    ?? event.createdAt
    ?? data?.timestamp
    ?? data?.createdAt
    ?? object?.timestamp
    ?? object?.createdAt
    ?? Date.now()
  );
  const timestampMs = Number.isFinite(timestampRaw)
    ? (timestampRaw < 10_000_000_000 ? timestampRaw * 1000 : timestampRaw)
    : Date.now();

  return {
    peerId,
    peerKind: 'channel',
    authorId,
    text,
    eventId: eventId || `${peerId}_${authorId}_${timestampMs}`,
    timestampMs,
  };
}

function extractNextcloudTalkAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.username);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.username);
  return Array.from(hints);
}

async function resolveNextcloudTalkInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: NextcloudTalkResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractNextcloudTalkAccountHints(payload, accountHint);
  let matched: NextcloudTalkResolvedInstance | null = null;
  for (const config of listEnabledNextcloudTalkConfigs()) {
    const candidate = await buildNextcloudTalkResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some(
        (hint) => hint === candidate.accountId || hint === candidate.nextcloudSender || hint === candidate.nextcloudUsername
      );
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledNextcloudTalkConfigs().map((config) => buildNextcloudTalkResolvedInstance(config)));
    const candidates = all.filter((entry): entry is NextcloudTalkResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildNostrProviderUrl(instance: NostrResolvedInstance, endpoint: string): string {
  const base = instance.nostrApiBaseUrl.endsWith('/')
    ? instance.nostrApiBaseUrl.slice(0, -1)
    : instance.nostrApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getNostrProviderHeaders(instance: NostrResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': instance.nostrSendAsForm
      ? 'application/x-www-form-urlencoded'
      : 'application/json',
  };
  const token = normalizeToken(instance.nostrProviderToken);
  if (!token) return headers;
  if (instance.nostrAuthMode === 'header') {
    const headerName = normalizeToken(instance.nostrAuthHeader) || 'Authorization';
    headers[headerName] = token;
    return headers;
  }
  const headerName = normalizeToken(instance.nostrAuthHeader) || 'Authorization';
  const authScheme = normalizeToken(instance.nostrAuthScheme) || 'Bearer';
  headers[headerName] = `${authScheme} ${token}`;
  return headers;
}

async function sendNostrMessage(
  instance: NostrResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const payload: Record<string, string> = {
      [instance.nostrSendPeerField]: recipient,
      [instance.nostrSendMessageField]: chunk || ' ',
    };
    if (instance.nostrSender) payload.sender = instance.nostrSender;
    const response = await fetch(buildNostrProviderUrl(instance, instance.nostrSendEndpoint), {
      method: 'POST',
      headers: getNostrProviderHeaders(instance),
      body: instance.nostrSendAsForm
        ? new URLSearchParams(payload).toString()
        : JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Nostr send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateNostrHealth(instance: NostrResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.nostrHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildNostrProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getNostrProviderHeaders({
      ...instance,
      nostrSendAsForm: false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Nostr health check failed: ${detail || response.statusText}`);
  }
}

function parseNostrWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : null;
  const body = event.body && typeof event.body === 'object' && !Array.isArray(event.body)
    ? event.body as Record<string, unknown>
    : null;

  const textCandidate = [
    event.text,
    event.content,
    event.message,
    data?.text,
    data?.content,
    data?.message,
    body?.text,
    body?.content,
    body?.message,
  ].find((entry) => typeof entry === 'string' || typeof entry === 'number');
  const text = normalizeToken(String(textCandidate ?? ''));
  if (!text) return null;

  const peerId = normalizeToken(String(
    event.peerId
    ?? event.chatId
    ?? event.conversationId
    ?? event.channelId
    ?? event.pubkey
    ?? event.recipient
    ?? data?.peerId
    ?? data?.chatId
    ?? data?.conversationId
    ?? data?.channelId
    ?? data?.pubkey
    ?? data?.recipient
    ?? body?.peerId
    ?? body?.chatId
    ?? body?.conversationId
    ?? body?.channelId
    ?? body?.pubkey
    ?? body?.recipient
    ?? ''
  ));
  if (!peerId) return null;

  const authorId = normalizeToken(String(
    event.authorId
    ?? event.pubkey
    ?? event.from
    ?? event.sender
    ?? data?.authorId
    ?? data?.pubkey
    ?? data?.from
    ?? data?.sender
    ?? body?.authorId
    ?? body?.pubkey
    ?? body?.from
    ?? body?.sender
    ?? peerId
  )) || peerId;

  const kindRaw = normalizeLower(String(event.peerKind ?? event.kind ?? data?.peerKind ?? data?.kind ?? body?.peerKind ?? body?.kind ?? ''));
  const peerKind: BridgePeerKind =
    kindRaw === 'group'
      ? 'group'
      : kindRaw === 'channel' || kindRaw === 'room'
        ? 'channel'
        : 'dm';

  const eventId = normalizeToken(String(
    event.id
    ?? event.eventId
    ?? data?.id
    ?? data?.eventId
    ?? body?.id
    ?? body?.eventId
    ?? ''
  ));
  const timestampRaw = Number(
    event.timestamp
    ?? event.createdAt
    ?? event.created_at
    ?? data?.timestamp
    ?? data?.createdAt
    ?? data?.created_at
    ?? body?.timestamp
    ?? body?.createdAt
    ?? body?.created_at
    ?? Date.now()
  );
  const timestampMs = Number.isFinite(timestampRaw)
    ? (timestampRaw < 10_000_000_000 ? timestampRaw * 1000 : timestampRaw)
    : Date.now();

  return {
    peerId,
    peerKind,
    authorId,
    text,
    eventId: eventId || `${peerId}_${authorId}_${timestampMs}`,
    timestampMs,
  };
}

function extractNostrAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.pubkey);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.pubkey);
  return Array.from(hints);
}

async function resolveNostrInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: NostrResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractNostrAccountHints(payload, accountHint);
  let matched: NostrResolvedInstance | null = null;
  for (const config of listEnabledNostrConfigs()) {
    const candidate = await buildNostrResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.nostrSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledNostrConfigs().map((config) => buildNostrResolvedInstance(config)));
    const candidates = all.filter((entry): entry is NostrResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildTlonProviderUrl(instance: TlonResolvedInstance, endpoint: string): string {
  const base = instance.tlonApiBaseUrl.endsWith('/')
    ? instance.tlonApiBaseUrl.slice(0, -1)
    : instance.tlonApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getTlonProviderHeaders(instance: TlonResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': instance.tlonSendAsForm
      ? 'application/x-www-form-urlencoded'
      : 'application/json',
  };
  const token = normalizeToken(instance.tlonProviderToken);
  if (!token) return headers;
  if (instance.tlonAuthMode === 'header') {
    const headerName = normalizeToken(instance.tlonAuthHeader) || 'Authorization';
    headers[headerName] = token;
    return headers;
  }
  const headerName = normalizeToken(instance.tlonAuthHeader) || 'Authorization';
  const authScheme = normalizeToken(instance.tlonAuthScheme) || 'Bearer';
  headers[headerName] = `${authScheme} ${token}`;
  return headers;
}

async function sendTlonMessage(
  instance: TlonResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const payload: Record<string, string> = {
      [instance.tlonSendPeerField]: recipient,
      [instance.tlonSendMessageField]: chunk || ' ',
    };
    if (instance.tlonSender) payload.sender = instance.tlonSender;
    const response = await fetch(buildTlonProviderUrl(instance, instance.tlonSendEndpoint), {
      method: 'POST',
      headers: getTlonProviderHeaders(instance),
      body: instance.tlonSendAsForm
        ? new URLSearchParams(payload).toString()
        : JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Tlon send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateTlonHealth(instance: TlonResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.tlonHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildTlonProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getTlonProviderHeaders({
      ...instance,
      tlonSendAsForm: false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Tlon health check failed: ${detail || response.statusText}`);
  }
}

function parseTlonWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  return parseNostrWebhookMessage(event);
}

function extractTlonAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.pubkey);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.pubkey);
  return Array.from(hints);
}

async function resolveTlonInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: TlonResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractTlonAccountHints(payload, accountHint);
  let matched: TlonResolvedInstance | null = null;
  for (const config of listEnabledTlonConfigs()) {
    const candidate = await buildTlonResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.tlonSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledTlonConfigs().map((config) => buildTlonResolvedInstance(config)));
    const candidates = all.filter((entry): entry is TlonResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildZaloProviderUrl(instance: ZaloResolvedInstance, endpoint: string): string {
  const base = instance.zaloApiBaseUrl.endsWith('/')
    ? instance.zaloApiBaseUrl.slice(0, -1)
    : instance.zaloApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getZaloProviderHeaders(instance: ZaloResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': instance.zaloSendAsForm
      ? 'application/x-www-form-urlencoded'
      : 'application/json',
  };
  const token = normalizeToken(instance.zaloProviderToken);
  if (!token) return headers;
  if (instance.zaloAuthMode === 'header') {
    const headerName = normalizeToken(instance.zaloAuthHeader) || 'Authorization';
    headers[headerName] = token;
    return headers;
  }
  const headerName = normalizeToken(instance.zaloAuthHeader) || 'Authorization';
  const authScheme = normalizeToken(instance.zaloAuthScheme) || 'Bearer';
  headers[headerName] = `${authScheme} ${token}`;
  return headers;
}

async function sendZaloMessage(
  instance: ZaloResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const payload: Record<string, string> = {
      [instance.zaloSendPeerField]: recipient,
      [instance.zaloSendMessageField]: chunk || ' ',
    };
    if (instance.zaloSender) payload.sender = instance.zaloSender;
    const response = await fetch(buildZaloProviderUrl(instance, instance.zaloSendEndpoint), {
      method: 'POST',
      headers: getZaloProviderHeaders(instance),
      body: instance.zaloSendAsForm
        ? new URLSearchParams(payload).toString()
        : JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Zalo send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateZaloHealth(instance: ZaloResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.zaloHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildZaloProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getZaloProviderHeaders({
      ...instance,
      zaloSendAsForm: false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Zalo health check failed: ${detail || response.statusText}`);
  }
}

function parseZaloWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  return parseNostrWebhookMessage(event);
}

function extractZaloAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.oaid);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.oaid);
  return Array.from(hints);
}

async function resolveZaloInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: ZaloResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractZaloAccountHints(payload, accountHint);
  let matched: ZaloResolvedInstance | null = null;
  for (const config of listEnabledZaloConfigs()) {
    const candidate = await buildZaloResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.zaloSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledZaloConfigs().map((config) => buildZaloResolvedInstance(config)));
    const candidates = all.filter((entry): entry is ZaloResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

function buildZaloUserProviderUrl(instance: ZaloUserResolvedInstance, endpoint: string): string {
  const base = instance.zalouserApiBaseUrl.endsWith('/')
    ? instance.zalouserApiBaseUrl.slice(0, -1)
    : instance.zalouserApiBaseUrl;
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${pathPart}`;
}

function getZaloUserProviderHeaders(instance: ZaloUserResolvedInstance): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': instance.zalouserSendAsForm
      ? 'application/x-www-form-urlencoded'
      : 'application/json',
  };
  const token = normalizeToken(instance.zalouserProviderToken);
  if (!token) return headers;
  if (instance.zalouserAuthMode === 'header') {
    const headerName = normalizeToken(instance.zalouserAuthHeader) || 'Authorization';
    headers[headerName] = token;
    return headers;
  }
  const headerName = normalizeToken(instance.zalouserAuthHeader) || 'Authorization';
  const authScheme = normalizeToken(instance.zalouserAuthScheme) || 'Bearer';
  headers[headerName] = `${authScheme} ${token}`;
  return headers;
}

async function sendZaloUserMessage(
  instance: ZaloUserResolvedInstance,
  recipient: string,
  text: string
): Promise<void> {
  const chunks = splitLineText(text);
  for (const chunk of chunks) {
    const payload: Record<string, string> = {
      [instance.zalouserSendPeerField]: recipient,
      [instance.zalouserSendMessageField]: chunk || ' ',
    };
    if (instance.zalouserSender) payload.sender = instance.zalouserSender;
    const response = await fetch(buildZaloUserProviderUrl(instance, instance.zalouserSendEndpoint), {
      method: 'POST',
      headers: getZaloUserProviderHeaders(instance),
      body: instance.zalouserSendAsForm
        ? new URLSearchParams(payload).toString()
        : JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`ZaloUser send failed: ${detail || response.statusText}`);
    }
  }
}

async function validateZaloUserHealth(instance: ZaloUserResolvedInstance): Promise<void> {
  const endpoint = normalizeToken(instance.zalouserHealthEndpoint);
  if (!endpoint) return;
  const response = await fetch(buildZaloUserProviderUrl(instance, endpoint), {
    method: 'GET',
    headers: getZaloUserProviderHeaders({
      ...instance,
      zalouserSendAsForm: false,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`ZaloUser health check failed: ${detail || response.statusText}`);
  }
}

function parseZaloUserWebhookMessage(
  event: Record<string, unknown>
): { peerId: string; peerKind: BridgePeerKind; authorId: string; text: string; eventId: string; timestampMs: number } | null {
  return parseNostrWebhookMessage(event);
}

function extractZaloUserAccountHints(
  payload: Record<string, unknown>,
  explicitHint?: string
): string[] {
  const hints = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeToken(typeof value === 'string' ? value : String(value ?? ''));
    if (normalized) hints.add(normalized);
  };
  push(explicitHint || '');
  push(payload.accountId);
  push(payload.account);
  push(payload.sender);
  push(payload.userId);
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  push(data?.accountId);
  push(data?.account);
  push(data?.sender);
  push(data?.userId);
  return Array.from(hints);
}

async function resolveZaloUserInstanceFromWebhook(
  payload: Record<string, unknown>,
  accountHint?: string
): Promise<{ instance: ZaloUserResolvedInstance | null; ambiguous: boolean }> {
  const hints = extractZaloUserAccountHints(payload, accountHint);
  let matched: ZaloUserResolvedInstance | null = null;
  for (const config of listEnabledZaloUserConfigs()) {
    const candidate = await buildZaloUserResolvedInstance(config);
    if (!candidate) continue;
    if (hints.length > 0) {
      const matchesHint = hints.some((hint) => hint === candidate.accountId || hint === candidate.zalouserSender);
      if (!matchesHint) continue;
    }
    if (matched) {
      return { instance: null, ambiguous: true };
    }
    matched = candidate;
  }
  if (!matched && hints.length === 0) {
    const all = await Promise.all(listEnabledZaloUserConfigs().map((config) => buildZaloUserResolvedInstance(config)));
    const candidates = all.filter((entry): entry is ZaloUserResolvedInstance => Boolean(entry));
    if (candidates.length === 1) {
      return { instance: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
      return { instance: null, ambiguous: true };
    }
  }
  return { instance: matched, ambiguous: false };
}

async function handleBridgeHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const connector = normalizeLower(url.searchParams.get('connector'));
  const accountIdHint = normalizeToken(url.searchParams.get('accountId'));
  const token = parseBearerToken(req);

  if (connector === 'line') {
    const resolved = await resolveLineInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple LINE instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for LINE connector.' });
      return;
    }
    sendJson(res, 200, {
      status: 'ok',
      connector: 'line',
      runtimeKey: resolved.instance.runtimeKey,
      instanceId: resolved.instance.config.instanceId,
      accountId: resolved.instance.accountId,
      webhookPath: '/connector/line/webhook',
      inboundSignatureConfigured: Boolean(resolved.instance.lineChannelSecret),
    });
    return;
  }

  if (connector === 'whatsapp') {
    const resolved = await resolveWhatsAppInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple WhatsApp instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for WhatsApp connector.' });
      return;
    }
    try {
      await validateWhatsAppHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'whatsapp',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        phoneNumberId: resolved.instance.whatsappPhoneNumberId,
        webhookPath: '/connector/whatsapp/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'WhatsApp health check failed.',
      });
      return;
    }
  }

  if (connector === 'signal') {
    const resolved = await resolveSignalInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Signal instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Signal connector.' });
      return;
    }
    try {
      await validateSignalHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'signal',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.signalSender,
        webhookPath: '/connector/signal/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'Signal health check failed.',
      });
      return;
    }
  }

  if (connector === 'bluebubbles') {
    const resolved = await resolveBlueBubblesInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple BlueBubbles instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for BlueBubbles connector.' });
      return;
    }
    try {
      await validateBlueBubblesHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'bluebubbles',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.bluebubblesSender || '',
        webhookPath: '/connector/bluebubbles/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'BlueBubbles health check failed.',
      });
      return;
    }
  }

  if (connector === 'imessage') {
    const resolved = await resolveIMessageInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple iMessage instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for iMessage connector.' });
      return;
    }
    try {
      await validateIMessageHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'imessage',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.imessageSender || '',
        webhookPath: '/connector/imessage/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'iMessage health check failed.',
      });
      return;
    }
  }

  if (connector === 'nextcloud-talk') {
    const resolved = await resolveNextcloudTalkInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nextcloud Talk instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nextcloud Talk connector.' });
      return;
    }
    try {
      await validateNextcloudTalkHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'nextcloud-talk',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.nextcloudSender || resolved.instance.nextcloudUsername || '',
        webhookPath: '/connector/nextcloud-talk/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'Nextcloud Talk health check failed.',
      });
      return;
    }
  }

  if (connector === 'nostr') {
    const resolved = await resolveNostrInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nostr instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nostr connector.' });
      return;
    }
    try {
      await validateNostrHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'nostr',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.nostrSender || '',
        webhookPath: '/connector/nostr/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'Nostr health check failed.',
      });
      return;
    }
  }

  if (connector === 'tlon') {
    const resolved = await resolveTlonInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Tlon instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Tlon connector.' });
      return;
    }
    try {
      await validateTlonHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'tlon',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.tlonSender || '',
        webhookPath: '/connector/tlon/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'Tlon health check failed.',
      });
      return;
    }
  }

  if (connector === 'zalo') {
    const resolved = await resolveZaloInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Zalo instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Zalo connector.' });
      return;
    }
    try {
      await validateZaloHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'zalo',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.zaloSender || '',
        webhookPath: '/connector/zalo/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'Zalo health check failed.',
      });
      return;
    }
  }

  if (connector === 'zalouser') {
    const resolved = await resolveZaloUserInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple ZaloUser instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for ZaloUser connector.' });
      return;
    }
    try {
      await validateZaloUserHealth(resolved.instance);
      sendJson(res, 200, {
        status: 'ok',
        connector: 'zalouser',
        runtimeKey: resolved.instance.runtimeKey,
        instanceId: resolved.instance.config.instanceId,
        accountId: resolved.instance.accountId,
        sender: resolved.instance.zalouserSender || '',
        webhookPath: '/connector/zalouser/webhook',
      });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_health_failed',
        message: error instanceof Error ? error.message : 'ZaloUser health check failed.',
      });
      return;
    }
  }

  sendJson(res, 400, {
    error: 'unsupported_connector',
    message: 'This built-in bridge currently supports connector=signal, connector=line, connector=whatsapp, connector=bluebubbles, connector=imessage, connector=nextcloud-talk, connector=nostr, connector=tlon, connector=zalo, and connector=zalouser only.',
  });
}

async function handleBridgeEvents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const connector = normalizeLower(url.searchParams.get('connector'));
  const accountIdHint = normalizeToken(url.searchParams.get('accountId'));
  const token = parseBearerToken(req);

  let runtimeKey = '';
  if (connector === 'line') {
    const resolved = await resolveLineInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple LINE instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for LINE connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'whatsapp') {
    const resolved = await resolveWhatsAppInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple WhatsApp instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for WhatsApp connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'signal') {
    const resolved = await resolveSignalInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Signal instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Signal connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'bluebubbles') {
    const resolved = await resolveBlueBubblesInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple BlueBubbles instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for BlueBubbles connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'imessage') {
    const resolved = await resolveIMessageInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple iMessage instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for iMessage connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'nextcloud-talk') {
    const resolved = await resolveNextcloudTalkInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nextcloud Talk instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nextcloud Talk connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'nostr') {
    const resolved = await resolveNostrInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nostr instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nostr connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'tlon') {
    const resolved = await resolveTlonInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Tlon instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Tlon connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'zalo') {
    const resolved = await resolveZaloInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Zalo instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Zalo connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'zalouser') {
    const resolved = await resolveZaloUserInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple ZaloUser instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for ZaloUser connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else {
    sendJson(res, 400, {
      error: 'unsupported_connector',
      message: 'This built-in bridge currently supports connector=signal, connector=line, connector=whatsapp, connector=bluebubbles, connector=imessage, connector=nextcloud-talk, connector=nostr, connector=tlon, connector=zalo, and connector=zalouser only.',
    });
    return;
  }

  const queue = ensureQueue(runtimeKey);
  const sinceCursorRaw = normalizeToken(url.searchParams.get('cursor'));
  const sinceCursor = Number(sinceCursorRaw);
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.round(limitRaw))) : 50;
  const filtered = Number.isFinite(sinceCursor)
    ? queue.filter((entry) => Number(entry.cursor) > sinceCursor)
    : queue.slice();
  const events = filtered.slice(0, limit);
  const latestCursor = events.length > 0
    ? events[events.length - 1]?.cursor
    : (queue[queue.length - 1]?.cursor || sinceCursorRaw || '');
  sendJson(res, 200, {
    cursor: latestCursor,
    events,
  });
}

async function handleBridgeTargets(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const connector = normalizeLower(url.searchParams.get('connector'));
  const accountIdHint = normalizeToken(url.searchParams.get('accountId'));
  const token = parseBearerToken(req);

  let runtimeKey = '';
  if (connector === 'line') {
    const resolved = await resolveLineInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple LINE instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for LINE connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'whatsapp') {
    const resolved = await resolveWhatsAppInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple WhatsApp instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for WhatsApp connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'signal') {
    const resolved = await resolveSignalInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Signal instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Signal connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'bluebubbles') {
    const resolved = await resolveBlueBubblesInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple BlueBubbles instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for BlueBubbles connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'imessage') {
    const resolved = await resolveIMessageInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple iMessage instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for iMessage connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'nextcloud-talk') {
    const resolved = await resolveNextcloudTalkInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nextcloud Talk instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nextcloud Talk connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'nostr') {
    const resolved = await resolveNostrInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nostr instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nostr connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'tlon') {
    const resolved = await resolveTlonInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Tlon instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Tlon connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'zalo') {
    const resolved = await resolveZaloInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Zalo instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Zalo connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else if (connector === 'zalouser') {
    const resolved = await resolveZaloUserInstanceFromBridgeSecret(token, accountIdHint);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple ZaloUser instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for ZaloUser connector.' });
      return;
    }
    runtimeKey = resolved.instance.runtimeKey;
  } else {
    sendJson(res, 400, {
      error: 'unsupported_connector',
      message: 'This built-in bridge currently supports connector=signal, connector=line, connector=whatsapp, connector=bluebubbles, connector=imessage, connector=nextcloud-talk, connector=nostr, connector=tlon, connector=zalo, and connector=zalouser only.',
    });
    return;
  }

  const targets = Array.from(ensureTargets(runtimeKey).values())
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      metadata: {
        count: String(entry.count),
        lastSeenAt: entry.lastSeenAt,
      },
    }));
  sendJson(res, 200, { targets });
}

async function handleBridgeSend(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request body.' });
    return;
  }
  const connector = normalizeLower(String(body.connector ?? ''));
  const token = parseBearerToken(req);

  const peerId = normalizeToken(String(body.peerId ?? ''));
  const text = normalizeToken(String(body.text ?? ''));
  if (!peerId) {
    sendJson(res, 400, { error: 'invalid_request', message: 'peerId is required.' });
    return;
  }
  if (!text) {
    sendJson(res, 400, { error: 'invalid_request', message: 'text is required.' });
    return;
  }

  if (connector === 'line') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveLineInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple LINE instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for LINE connector.' });
      return;
    }
    if (accountId && accountId !== resolved.instance.accountId) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await pushLineMessage(resolved.instance.lineChannelAccessToken, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'line', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via LINE.',
      });
      return;
    }
  }

  if (connector === 'whatsapp') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveWhatsAppInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple WhatsApp instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for WhatsApp connector.' });
      return;
    }
    if (accountId && accountId !== resolved.instance.accountId) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendWhatsAppMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'whatsapp', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via WhatsApp.',
      });
      return;
    }
  }

  if (connector === 'signal') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveSignalInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Signal instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Signal connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.signalSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendSignalMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'signal', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via Signal.',
      });
      return;
    }
  }

  if (connector === 'bluebubbles') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveBlueBubblesInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple BlueBubbles instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for BlueBubbles connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.bluebubblesSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendBlueBubblesMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'bluebubbles', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via BlueBubbles.',
      });
      return;
    }
  }

  if (connector === 'imessage') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveIMessageInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple iMessage instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for iMessage connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.imessageSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendIMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'imessage', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via iMessage.',
      });
      return;
    }
  }

  if (connector === 'nextcloud-talk') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveNextcloudTalkInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nextcloud Talk instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nextcloud Talk connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.nextcloudSender
      && accountId !== resolved.instance.nextcloudUsername
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendNextcloudTalkMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'nextcloud-talk', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via Nextcloud Talk.',
      });
      return;
    }
  }

  if (connector === 'nostr') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveNostrInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Nostr instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Nostr connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.nostrSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendNostrMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'nostr', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via Nostr.',
      });
      return;
    }
  }

  if (connector === 'tlon') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveTlonInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Tlon instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Tlon connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.tlonSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendTlonMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'tlon', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via Tlon.',
      });
      return;
    }
  }

  if (connector === 'zalo') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveZaloInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple Zalo instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for Zalo connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.zaloSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendZaloMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'zalo', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via Zalo.',
      });
      return;
    }
  }

  if (connector === 'zalouser') {
    const accountId = normalizeToken(String(body.accountId ?? ''));
    const resolved = await resolveZaloUserInstanceFromBridgeSecret(token, accountId);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_secret', message: 'Multiple ZaloUser instances share the same secret/token.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Invalid bridge token for ZaloUser connector.' });
      return;
    }
    if (
      accountId
      && accountId !== resolved.instance.accountId
      && accountId !== resolved.instance.zalouserSender
    ) {
      sendJson(res, 403, { error: 'account_mismatch', message: `Token is not authorized for accountId "${accountId}".` });
      return;
    }
    try {
      await sendZaloUserMessage(resolved.instance, peerId, text);
      sendJson(res, 200, { ok: true, connector: 'zalouser', peerId });
      return;
    } catch (error) {
      sendJson(res, 502, {
        error: 'provider_send_failed',
        message: error instanceof Error ? error.message : 'Failed to send message via ZaloUser.',
      });
      return;
    }
  }

  sendJson(res, 400, {
    error: 'unsupported_connector',
    message: 'This built-in bridge currently supports connector=signal, connector=line, connector=whatsapp, connector=bluebubbles, connector=imessage, connector=nextcloud-talk, connector=nostr, connector=tlon, connector=zalo, and connector=zalouser only.',
  });
}

async function handleLineWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }
  const signature = normalizeLineWebhookSignature(req.headers['x-line-signature']);
  const resolved = await resolveLineInstanceFromWebhook(rawBody, signature);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_signature', message: 'Webhook signature matched multiple LINE connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 401, { error: 'signature_verification_failed', message: 'LINE webhook signature could not be verified.' });
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid LINE webhook JSON payload.' });
    return;
  }
  const events = Array.isArray(payload.events) ? payload.events as Array<Record<string, unknown>> : [];
  let accepted = 0;
  for (const event of events) {
    const eventType = normalizeLower(String(event.type ?? ''));
    if (eventType !== 'message') continue;
    const message = (event.message && typeof event.message === 'object')
      ? event.message as Record<string, unknown>
      : null;
    if (!message) continue;
    const messageType = normalizeLower(String(message.type ?? ''));
    if (messageType !== 'text') continue;
    const text = normalizeToken(String(message.text ?? ''));
    if (!text) continue;
    const source = (event.source && typeof event.source === 'object')
      ? event.source as Record<string, unknown>
      : null;
    if (!source) continue;
    const peer = lineSourceToPeer(source);
    if (!peer?.peerId) continue;
    const eventId = normalizeToken(String(event.webhookEventId ?? ''))
      || normalizeToken(String(message.id ?? ''))
      || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, eventId)) continue;
    const createdAt = Number(event.timestamp ?? Date.now());
    const createdAtIso = Number.isFinite(createdAt)
      ? new Date(createdAt).toISOString()
      : new Date().toISOString();
    const authorId = normalizeToken(String(peer.userId ?? peer.peerId)) || 'user';
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: eventId,
      createdAt: createdAtIso,
      peerId: peer.peerId,
      peerKind: peer.peerKind,
      userId: peer.userId,
      groupId: peer.groupId,
      channelId: peer.channelId,
      accountId: resolved.instance.accountId,
      authorId,
      text,
      metadata: {
        provider: 'line',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, peer.peerId, peer.peerKind);
    accepted += 1;
  }
  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleWhatsAppWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const mode = normalizeToken(url.searchParams.get('hub.mode'));
    const verifyToken = normalizeToken(url.searchParams.get('hub.verify_token'));
    const challenge = normalizeToken(url.searchParams.get('hub.challenge'));
    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      sendJson(res, 400, { error: 'invalid_verification_request', message: 'Missing hub verification parameters.' });
      return;
    }
    const resolved = await resolveWhatsAppInstanceFromWebhookVerifyToken(verifyToken);
    if (resolved.ambiguous) {
      sendJson(res, 409, { error: 'ambiguous_verify_token', message: 'Verify token matched multiple WhatsApp connector instances.' });
      return;
    }
    if (!resolved.instance) {
      sendJson(res, 403, { error: 'verify_token_mismatch', message: 'WhatsApp verify token did not match any enabled instance.' });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(challenge);
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid WhatsApp webhook JSON payload.' });
    return;
  }

  const resolved = await resolveWhatsAppInstanceFromWebhookPayload(payload);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_phone_number', message: 'Webhook payload matched multiple WhatsApp connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_phone_number', message: 'No enabled WhatsApp connector instance matched this webhook payload.' });
    return;
  }

  if (resolved.instance.whatsappAppSecret) {
    const providedSignature = normalizeWhatsAppWebhookSignature(req.headers['x-hub-signature-256']);
    if (!providedSignature) {
      sendJson(res, 401, { error: 'signature_required', message: 'Missing x-hub-signature-256 header for WhatsApp webhook.' });
      return;
    }
    const expectedSignature = computeWhatsAppWebhookSignature(rawBody, resolved.instance.whatsappAppSecret);
    if (!safeEqual(expectedSignature, providedSignature)) {
      sendJson(res, 401, { error: 'signature_verification_failed', message: 'WhatsApp webhook signature verification failed.' });
      return;
    }
  }

  const entries = Array.isArray(payload.entry) ? payload.entry as Array<Record<string, unknown>> : [];
  let accepted = 0;
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : [];
    for (const change of changes) {
      const value = change.value && typeof change.value === 'object'
        ? change.value as Record<string, unknown>
        : null;
      if (!value) continue;
      const metadata = value.metadata && typeof value.metadata === 'object'
        ? value.metadata as Record<string, unknown>
        : null;
      const phoneNumberId = normalizeToken(String(metadata?.phone_number_id ?? ''));
      if (phoneNumberId && phoneNumberId !== resolved.instance.whatsappPhoneNumberId) {
        continue;
      }
      const contacts = Array.isArray(value.contacts) ? value.contacts as Array<Record<string, unknown>> : [];
      const contactNameByWaId = new Map<string, string>();
      for (const contact of contacts) {
        const waId = normalizeToken(String(contact.wa_id ?? ''));
        const profile = contact.profile && typeof contact.profile === 'object'
          ? contact.profile as Record<string, unknown>
          : null;
        const profileName = normalizeToken(String(profile?.name ?? ''));
        if (waId) {
          contactNameByWaId.set(waId, profileName || waId);
        }
      }
      const messages = Array.isArray(value.messages) ? value.messages as Array<Record<string, unknown>> : [];
      for (const message of messages) {
        const messageType = normalizeLower(String(message.type ?? ''));
        if (messageType !== 'text') continue;
        const textObj = message.text && typeof message.text === 'object'
          ? message.text as Record<string, unknown>
          : null;
        const text = normalizeToken(String(textObj?.body ?? ''));
        if (!text) continue;
        const from = normalizeToken(String(message.from ?? ''));
        if (!from) continue;
        const eventId = normalizeToken(String(message.id ?? ''))
          || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        if (!rememberBridgeEventId(resolved.instance.runtimeKey, eventId)) continue;
        const timestampRaw = Number(message.timestamp ?? 0);
        const timestampMs = Number.isFinite(timestampRaw) && timestampRaw > 0
          ? (timestampRaw < 10_000_000_000 ? timestampRaw * 1000 : timestampRaw)
          : Date.now();
        enqueueBridgeEvent(resolved.instance.runtimeKey, {
          id: eventId,
          createdAt: new Date(timestampMs).toISOString(),
          peerId: from,
          peerKind: 'dm',
          userId: from,
          accountId: resolved.instance.accountId,
          authorId: from,
          text,
          metadata: {
            provider: 'whatsapp',
            phone_number_id: resolved.instance.whatsappPhoneNumberId,
            contact_name: contactNameByWaId.get(from) || from,
          },
        });
        recordBridgeTarget(resolved.instance.runtimeKey, from, 'dm');
        accepted += 1;
      }
    }
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleSignalWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-signal-account-id'] === 'string'
        ? req.headers['x-signal-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-signal-webhook-token'] === 'string'
        ? req.headers['x-signal-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid Signal webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveSignalInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_signal_instance', message: 'Signal webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_signal_instance', message: 'No enabled Signal connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.signalWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'Signal webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'Signal webhook token verification failed.' });
      return;
    }
  }

  const signalEvents: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      signalEvents.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of signalEvents) {
    const parsedEvent = parseSignalWebhookEvent(event);
    if (!parsedEvent) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsedEvent.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsedEvent.eventId,
      createdAt: new Date(parsedEvent.timestampMs).toISOString(),
      peerId: parsedEvent.from,
      peerKind: 'dm',
      userId: parsedEvent.from,
      accountId: resolved.instance.accountId,
      authorId: parsedEvent.from,
      text: parsedEvent.text,
      metadata: {
        provider: 'signal',
        sender: resolved.instance.signalSender,
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsedEvent.from, 'dm');
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleBlueBubblesWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-bluebubbles-account-id'] === 'string'
        ? req.headers['x-bluebubbles-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-bluebubbles-webhook-token'] === 'string'
        ? req.headers['x-bluebubbles-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid BlueBubbles webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveBlueBubblesInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_bluebubbles_instance', message: 'BlueBubbles webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_bluebubbles_instance', message: 'No enabled BlueBubbles connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.bluebubblesWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'BlueBubbles webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'BlueBubbles webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseBlueBubblesWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'bluebubbles',
        sender: resolved.instance.bluebubblesSender || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleIMessageWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-imessage-account-id'] === 'string'
        ? req.headers['x-imessage-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-imessage-webhook-token'] === 'string'
        ? req.headers['x-imessage-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid iMessage webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveIMessageInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_imessage_instance', message: 'iMessage webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_imessage_instance', message: 'No enabled iMessage connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.imessageWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'iMessage webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'iMessage webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseIMessageWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'imessage',
        sender: resolved.instance.imessageSender || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleNextcloudTalkWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-nextcloud-account-id'] === 'string'
        ? req.headers['x-nextcloud-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-nextcloud-webhook-token'] === 'string'
        ? req.headers['x-nextcloud-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid Nextcloud Talk webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveNextcloudTalkInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_nextcloud_instance', message: 'Nextcloud Talk webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_nextcloud_instance', message: 'No enabled Nextcloud Talk connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.nextcloudWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'Nextcloud Talk webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'Nextcloud Talk webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseNextcloudTalkWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'nextcloud-talk',
        sender: resolved.instance.nextcloudSender || resolved.instance.nextcloudUsername || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleNostrWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-nostr-account-id'] === 'string'
        ? req.headers['x-nostr-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-nostr-webhook-token'] === 'string'
        ? req.headers['x-nostr-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid Nostr webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveNostrInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_nostr_instance', message: 'Nostr webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_nostr_instance', message: 'No enabled Nostr connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.nostrWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'Nostr webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'Nostr webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseNostrWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'nostr',
        sender: resolved.instance.nostrSender || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleTlonWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-tlon-account-id'] === 'string'
        ? req.headers['x-tlon-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-tlon-webhook-token'] === 'string'
        ? req.headers['x-tlon-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid Tlon webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveTlonInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_tlon_instance', message: 'Tlon webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_tlon_instance', message: 'No enabled Tlon connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.tlonWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'Tlon webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'Tlon webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseTlonWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'tlon',
        sender: resolved.instance.tlonSender || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleZaloWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-zalo-account-id'] === 'string'
        ? req.headers['x-zalo-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-zalo-webhook-token'] === 'string'
        ? req.headers['x-zalo-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid Zalo webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveZaloInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_zalo_instance', message: 'Zalo webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_zalo_instance', message: 'No enabled Zalo connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.zaloWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'Zalo webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'Zalo webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseZaloWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'zalo',
        sender: resolved.instance.zaloSender || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleZaloUserWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const accountHint = normalizeToken(url.searchParams.get('accountId'))
    || normalizeToken(
      typeof req.headers['x-zalouser-account-id'] === 'string'
        ? req.headers['x-zalouser-account-id']
        : ''
    );
  const providedWebhookToken = normalizeToken(url.searchParams.get('token'))
    || normalizeToken(
      typeof req.headers['x-zalouser-webhook-token'] === 'string'
        ? req.headers['x-zalouser-webhook-token']
        : ''
    )
    || parseBearerToken(req);

  let rawBody = '';
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
    return;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_request', message: 'Invalid ZaloUser webhook JSON payload.' });
    return;
  }
  const payload = Array.isArray(parsedUnknown)
    ? { events: parsedUnknown as unknown[] }
    : (parsedUnknown && typeof parsedUnknown === 'object' ? parsedUnknown as Record<string, unknown> : {});

  const resolved = await resolveZaloUserInstanceFromWebhook(payload, accountHint);
  if (resolved.ambiguous) {
    sendJson(res, 409, { error: 'ambiguous_zalouser_instance', message: 'ZaloUser webhook matched multiple enabled connector instances.' });
    return;
  }
  if (!resolved.instance) {
    sendJson(res, 403, { error: 'unknown_zalouser_instance', message: 'No enabled ZaloUser connector instance matched this webhook payload.' });
    return;
  }

  const expectedWebhookToken = normalizeToken(resolved.instance.zalouserWebhookToken);
  if (expectedWebhookToken) {
    if (!providedWebhookToken) {
      sendJson(res, 401, { error: 'webhook_token_required', message: 'ZaloUser webhook token is required for this connector instance.' });
      return;
    }
    if (!safeEqual(expectedWebhookToken, providedWebhookToken)) {
      sendJson(res, 401, { error: 'webhook_token_mismatch', message: 'ZaloUser webhook token verification failed.' });
      return;
    }
  }

  const events: Array<Record<string, unknown>> = [];
  const appendEvent = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      events.push(entry as Record<string, unknown>);
    }
  };
  const appendEventArray = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      appendEvent(entry);
    }
  };
  appendEvent(payload);
  appendEventArray(payload.events);
  appendEventArray(payload.messages);
  appendEventArray(payload.data);
  const nestedData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null;
  appendEvent(nestedData);
  appendEventArray(nestedData?.events);
  appendEventArray(nestedData?.messages);

  let accepted = 0;
  for (const event of events) {
    const parsed = parseZaloUserWebhookMessage(event);
    if (!parsed) continue;
    if (!rememberBridgeEventId(resolved.instance.runtimeKey, parsed.eventId)) continue;
    enqueueBridgeEvent(resolved.instance.runtimeKey, {
      id: parsed.eventId,
      createdAt: new Date(parsed.timestampMs).toISOString(),
      peerId: parsed.peerId,
      peerKind: parsed.peerKind,
      userId: parsed.authorId,
      groupId: parsed.peerKind === 'group' ? parsed.peerId : undefined,
      channelId: parsed.peerKind === 'channel' ? parsed.peerId : undefined,
      accountId: resolved.instance.accountId,
      authorId: parsed.authorId,
      text: parsed.text,
      metadata: {
        provider: 'zalouser',
        sender: resolved.instance.zalouserSender || '',
      },
    });
    recordBridgeTarget(resolved.instance.runtimeKey, parsed.peerId, parsed.peerKind);
    accepted += 1;
  }

  sendJson(res, 200, {
    ok: true,
    accepted,
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/connector/v1/health') {
    await handleBridgeHealth(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/connector/v1/events') {
    await handleBridgeEvents(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/connector/v1/targets') {
    await handleBridgeTargets(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/v1/send') {
    await handleBridgeSend(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/line/webhook') {
    await handleLineWebhook(req, res);
    return;
  }
  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/connector/whatsapp/webhook') {
    await handleWhatsAppWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/signal/webhook') {
    await handleSignalWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/bluebubbles/webhook') {
    await handleBlueBubblesWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/imessage/webhook') {
    await handleIMessageWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/nextcloud-talk/webhook') {
    await handleNextcloudTalkWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/nostr/webhook') {
    await handleNostrWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/tlon/webhook') {
    await handleTlonWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/zalo/webhook') {
    await handleZaloWebhook(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/connector/zalouser/webhook') {
    await handleZaloUserWebhook(req, res);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

export function startConnectorBridgeRuntime(): http.Server {
  if (connectorBridgeServer) return connectorBridgeServer;
  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      console.error('[Connector Bridge Runtime] Request failed:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Connector bridge runtime request failed.' });
    });
  });
  const port = getConnectorBridgeRuntimePort();
  server.listen(port, BRIDGE_HOST, () => {
    console.log(`[Connector Bridge Runtime] Server listening on ${getConnectorBridgeRuntimeBaseUrl()}`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[Connector Bridge Runtime] Port ${port} already in use; assuming external bridge is running.`);
      return;
    }
    console.error('[Connector Bridge Runtime] Server error:', error);
  });
  connectorBridgeServer = server;
  return server;
}

export async function stopConnectorBridgeRuntime(): Promise<void> {
  if (!connectorBridgeServer) return;
  const server = connectorBridgeServer;
  connectorBridgeServer = null;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
