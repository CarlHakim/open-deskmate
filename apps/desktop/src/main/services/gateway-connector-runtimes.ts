import { randomUUID } from 'crypto';
import type {
  DiscordConnectorConfig,
  GatewayConnectorExtensionConfig,
  GatewayConnectorExtensionId,
  GatewayConnectorRuntimeDiscoveryItem,
  GatewayConnectorRuntimeStatus,
  GatewayConnectorRuntimeTestResult,
  TelegramConnectorConfig,
} from '@accomplish/shared';
import { startAgentEngineTask } from '../runtime/agent-engine';
import { resolveActiveAgentId } from './agent-context';
import { resolveGatewayRoute } from './gateway-routing';
import { getTask } from '../store/taskHistory';
import { getGatewaySession } from '../store/gatewaySessions';
import { getDiscordToken, getGatewayConnectorSecret, getTelegramToken } from '../store/secureStorage';
import {
  getGatewayConnectorRuntimeKey,
  listGatewayConnectorExtensionConfigs,
  resolveGatewayConnectorExtensionConfig,
} from '../store/gatewayConnectorExtensions';
import { recordGatewayConnectorObservation } from '../store/gatewayConnectorDiscovery';
import { getGatewayConfig } from '../store/gatewayConfig';
import {
  getDiscordStatus,
  getDiscordTokenSet,
  startDiscordConnector,
  stopDiscordConnector,
} from './discord-connector';
import {
  getTelegramStatus,
  getTelegramTokenSet,
  startTelegramConnector,
  stopTelegramConnector,
} from './telegram-connector';
import { getConnectorBridgeRuntimeBaseUrl } from './connector-bridge-runtime';
import { resolveQuickPermissionReply } from './webhook-permissions';

type NativeManagedConnectorId =
  | 'discord'
  | 'telegram';

type DirectManagedConnectorId =
  | 'slack'
  | 'matrix'
  | 'msteams'
  | 'mattermost'
  | 'googlechat';

type BridgeManagedConnectorId =
  | 'signal'
  | 'whatsapp'
  | 'line'
  | 'bluebubbles'
  | 'imessage'
  | 'nextcloud-talk'
  | 'nostr'
  | 'tlon'
  | 'zalo'
  | 'zalouser';

type ManagedConnectorId = NativeManagedConnectorId | DirectManagedConnectorId | BridgeManagedConnectorId;

type ConnectorPeerKind = 'dm' | 'group' | 'channel';

type ConnectorAccessIdentity = {
  accountId: string;
  peerKind: ConnectorPeerKind;
  peerId: string;
  userId?: string;
  groupId?: string;
  channelId?: string;
};

type BridgeEventResult = {
  content: string;
  hasMention: boolean;
  hasPrefix: boolean;
};

interface ManagedRuntimeHandle {
  timer: NodeJS.Timeout | null;
  polling: boolean;
  slack?: {
    channelCursorTs: Map<string, string>;
    botUserId?: string;
    teamId?: string;
  };
  matrix?: {
    since?: string;
    selfUserId?: string;
    seenEventIds: string[];
    seenEventSet: Set<string>;
  };
  msteams?: {
    chatCursorAt: Map<string, string>;
    selfUserId?: string;
  };
  mattermost?: {
    channelCursorMs: Map<string, number>;
    selfUserId?: string;
    teamId?: string;
  };
  googlechat?: {
    spaceCursorAt: Map<string, string>;
    selfUserName?: string;
  };
  bridge?: {
    cursor?: string;
  };
}

const NATIVE_MANAGED_CONNECTOR_IDS: readonly NativeManagedConnectorId[] = [
  'discord',
  'telegram',
];

const DIRECT_MANAGED_CONNECTOR_IDS: readonly DirectManagedConnectorId[] = [
  'slack',
  'matrix',
  'msteams',
  'mattermost',
  'googlechat',
];

const BRIDGE_MANAGED_CONNECTOR_IDS: readonly BridgeManagedConnectorId[] = [
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
];

const MANAGED_CONNECTOR_IDS: ManagedConnectorId[] = [
  ...NATIVE_MANAGED_CONNECTOR_IDS,
  ...DIRECT_MANAGED_CONNECTOR_IDS,
  ...BRIDGE_MANAGED_CONNECTOR_IDS,
];
const runtimeHandles = new Map<string, ManagedRuntimeHandle>();
const runtimeStatuses = new Map<string, GatewayConnectorRuntimeStatus>();
const connectorRuntimeTimers = new Map<ManagedConnectorId, NodeJS.Timeout>();
const connectorPollingLocks = new Set<ManagedConnectorId>();
const connectorRuntimeContext = new Map<ManagedConnectorId, { runtimeKey: string; instanceId: string }>();

function isManagedConnectorId(connectorId: GatewayConnectorExtensionId | string): connectorId is ManagedConnectorId {
  return MANAGED_CONNECTOR_IDS.includes(connectorId as ManagedConnectorId);
}

function isBridgeManagedConnectorId(connectorId: ManagedConnectorId): connectorId is BridgeManagedConnectorId {
  return BRIDGE_MANAGED_CONNECTOR_IDS.includes(connectorId as BridgeManagedConnectorId);
}

function resolveRuntimeMode(connectorId: ManagedConnectorId): GatewayConnectorRuntimeStatus['mode'] {
  if (connectorId === 'discord' || connectorId === 'telegram') {
    return 'native';
  }
  if (isBridgeManagedConnectorId(connectorId)) {
    return 'external-bridge';
  }
  return 'first-party';
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeToken(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function normalizeLower(value: string | undefined | null): string {
  return normalizeToken(value).toLowerCase();
}

function splitChunks(text: string, limit = 1900): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
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

function parseCsvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\n,\s]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getMetadata(config: GatewayConnectorExtensionConfig, key: string): string | undefined {
  if (!config.metadata) return undefined;
  const target = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(config.metadata)) {
    if (entryKey.toLowerCase() === target) return entryValue;
  }
  return undefined;
}

function getMetadataBoolean(
  config: GatewayConnectorExtensionConfig,
  key: string,
  fallback: boolean
): boolean {
  const raw = normalizeLower(getMetadata(config, key));
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

function getMetadataNumber(
  config: GatewayConnectorExtensionConfig,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = Number(getMetadata(config, key));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function normalizeAccessToken(value: string | undefined | null): string {
  return normalizeToken(value).toLowerCase();
}

function resolveRuntimeAccountId(
  connectorId: ManagedConnectorId,
  config: GatewayConnectorExtensionConfig,
  fallback?: string
): string {
  return normalizeToken(config.accountId)
    || normalizeToken(fallback)
    || normalizeToken(config.instanceId)
    || connectorId;
}

function normalizeAccessSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => normalizeAccessToken(value)).filter(Boolean));
}

function evaluateConnectorAccessPolicy(
  config: GatewayConnectorExtensionConfig,
  identity: ConnectorAccessIdentity
): string | null {
  const policyModeRaw = normalizeAccessToken(config.accessPolicyMode ?? 'open');
  const policyMode = policyModeRaw === 'allowlist' || policyModeRaw === 'disabled'
    ? policyModeRaw
    : 'open';
  const accountId = normalizeAccessToken(identity.accountId);
  const userId = normalizeAccessToken(identity.userId || (identity.peerKind === 'dm' ? identity.peerId : ''));
  const groupId = normalizeAccessToken(identity.groupId || (identity.peerKind === 'group' ? identity.peerId : ''));
  const channelId = normalizeAccessToken(identity.channelId || (identity.peerKind === 'channel' ? identity.peerId : ''));

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
      return 'No allowlist rule matched this message.';
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

function shouldRecordConnectorObservation(config: GatewayConnectorExtensionConfig): boolean {
  const gatewayConfig = getGatewayConfig();
  if (gatewayConfig.recordConnectorDiscovery === false) return false;
  if (config.recordObservedIds === false) return false;
  return true;
}

function recordConnectorObservation(
  connectorId: ManagedConnectorId,
  config: GatewayConnectorExtensionConfig,
  identity: ConnectorAccessIdentity
): void {
  if (!shouldRecordConnectorObservation(config)) return;
  const context = getRuntimeContext(connectorId);
  recordGatewayConnectorObservation({
    connectorId,
    instanceId: context.instanceId,
    accountId: identity.accountId,
    userId: identity.userId || (identity.peerKind === 'dm' ? identity.peerId : undefined),
    groupId: identity.groupId || (identity.peerKind === 'group' ? identity.peerId : undefined),
    channelId: identity.channelId || (identity.peerKind === 'channel' ? identity.peerId : undefined),
  });
}

function shouldProcessInboundConnectorMessage(
  connectorId: ManagedConnectorId,
  config: GatewayConnectorExtensionConfig,
  identity: ConnectorAccessIdentity
): boolean {
  recordConnectorObservation(connectorId, config, identity);
  const deniedReason = evaluateConnectorAccessPolicy(config, identity);
  if (!deniedReason) return true;
  setRuntimeStatus(connectorId, {
    detail: `Skipping blocked message: ${deniedReason}`,
  });
  return false;
}

function getConnectorChannels(config: GatewayConnectorExtensionConfig, metadataKey: string): string[] {
  const metadataChannels = parseCsvList(getMetadata(config, metadataKey));
  if (metadataChannels.length > 0) return metadataChannels;
  return config.allowedChannelIds ?? [];
}

function formatPrompt(source: string, location: string, author: string, content: string): string {
  return `[${source} ${location}] From ${author}\n\n${content}`;
}

function extractPromptBody(prompt: string): string {
  const marker = '\n\n';
  const index = prompt.indexOf(marker);
  if (index < 0) return prompt.trim();
  return prompt.slice(index + marker.length).trim();
}

function pickTaskResponseText(resultStatus: string, taskId: string, agentId: string): string {
  const stored = getTask(taskId, agentId);
  const lastAssistant = stored?.messages
    ?.slice()
    .reverse()
    .find((msg) => msg.type === 'assistant');
  if (lastAssistant?.content) return lastAssistant.content;
  if (stored?.summary) return stored.summary;
  if (resultStatus === 'error') return 'I hit an error while running that task. Check Open Deskmate for details.';
  return 'Task completed.';
}

function sanitizeTaskId(prefix: string, value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return `${prefix}_${normalized}`;
}

function getRuntimeContext(connectorId: ManagedConnectorId): { runtimeKey: string; instanceId: string } {
  return connectorRuntimeContext.get(connectorId) ?? {
    runtimeKey: connectorId,
    instanceId: 'default',
  };
}

async function withRuntimeContext<T>(
  connectorId: ManagedConnectorId,
  runtimeKey: string,
  instanceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = connectorRuntimeContext.get(connectorId);
  connectorRuntimeContext.set(connectorId, { runtimeKey, instanceId });
  try {
    return await fn();
  } finally {
    if (previous) {
      connectorRuntimeContext.set(connectorId, previous);
    } else {
      connectorRuntimeContext.delete(connectorId);
    }
  }
}

function getHandle(connectorId: ManagedConnectorId): ManagedRuntimeHandle {
  const context = getRuntimeContext(connectorId);
  const existing = runtimeHandles.get(context.runtimeKey);
  if (existing) return existing;
  const created: ManagedRuntimeHandle = {
    timer: null,
    polling: false,
    slack: connectorId === 'slack' ? { channelCursorTs: new Map<string, string>() } : undefined,
    matrix: connectorId === 'matrix' ? { seenEventIds: [], seenEventSet: new Set<string>() } : undefined,
    msteams: connectorId === 'msteams' ? { chatCursorAt: new Map<string, string>() } : undefined,
    mattermost: connectorId === 'mattermost' ? { channelCursorMs: new Map<string, number>() } : undefined,
    googlechat: connectorId === 'googlechat' ? { spaceCursorAt: new Map<string, string>() } : undefined,
    bridge: isBridgeManagedConnectorId(connectorId) ? {} : undefined,
  };
  runtimeHandles.set(context.runtimeKey, created);
  return created;
}

function setRuntimeStatus(
  connectorId: ManagedConnectorId,
  patch: Partial<GatewayConnectorRuntimeStatus>
): GatewayConnectorRuntimeStatus {
  const context = getRuntimeContext(connectorId);
  const previous = runtimeStatuses.get(context.runtimeKey);
  const next: GatewayConnectorRuntimeStatus = {
    connectorId,
    instanceId: context.instanceId,
    runtimeKey: context.runtimeKey,
    configured: previous?.configured ?? false,
    running: previous?.running ?? false,
    ...previous,
    mode: resolveRuntimeMode(connectorId),
    ...patch,
  };
  runtimeStatuses.set(context.runtimeKey, next);
  return next;
}

function stopRuntimeTimer(connectorId: ManagedConnectorId): void {
  const timer = connectorRuntimeTimers.get(connectorId);
  if (timer) {
    clearInterval(timer);
    connectorRuntimeTimers.delete(connectorId);
  }
  connectorPollingLocks.delete(connectorId);
}

function syncDiscordRuntimeStatus(runtimeKey?: string): void {
  const status = getDiscordStatus(runtimeKey);
  setRuntimeStatus('discord', {
    configured: status.configured,
    running: status.running,
    accountId: status.botUser?.id,
    botUserId: status.botUser?.id,
    lastStartAt: status.lastStartAt,
    lastError: status.lastError,
    detail: status.running ? 'Discord gateway runtime active.' : (status.lastError || 'Discord runtime idle.'),
  });
}

function syncTelegramRuntimeStatus(runtimeKey?: string): void {
  const status = getTelegramStatus(runtimeKey);
  setRuntimeStatus('telegram', {
    configured: status.configured,
    running: status.running,
    accountId: status.botUser?.id,
    botUserId: status.botUser?.id,
    lastStartAt: status.lastStartAt,
    lastError: status.lastError,
    detail: status.running ? 'Telegram gateway runtime active.' : (status.lastError || 'Telegram runtime idle.'),
  });
}

async function runConnectorTask(params: {
  connectorId: ManagedConnectorId;
  routeChannel: string;
  accountId: string;
  peerKind: 'dm' | 'group' | 'channel';
  peerId: string;
  prompt: string;
  taskSeed: string;
  agentIdOverride?: string;
  reply: (text: string) => Promise<void>;
}): Promise<void> {
  const route = resolveGatewayRoute({
    channel: params.routeChannel,
    accountId: params.accountId,
    peer: { kind: params.peerKind, id: params.peerId },
    agentIdOverride: params.agentIdOverride || resolveActiveAgentId(),
  });
  const runtimeContext = getRuntimeContext(params.connectorId);
  const session = getGatewaySession(route.sessionKey);
  const quickPermission = await resolveQuickPermissionReply({
    text: extractPromptBody(params.prompt),
    taskIdHint: session?.taskId,
  });
  if (quickPermission.handled) {
    await params.reply(quickPermission.message);
    return;
  }
  const taskId = sanitizeTaskId(params.connectorId, params.taskSeed);
  const { completion } = await startAgentEngineTask(
    {
      prompt: params.prompt,
      taskId,
      agentId: route.agentId,
      sessionId: session?.sessionId,
    },
    {
      source: 'gateway',
      sessionKey: route.sessionKey,
      route: {
        channel: route.channel,
        accountId: route.accountId,
        connectorInstanceId: runtimeContext.instanceId,
        peerKind: params.peerKind,
        peerId: params.peerId,
      },
    }
  );
  const result = await completion;
  const response = pickTaskResponseText(result.status, taskId, route.agentId);
  for (const chunk of splitChunks(response)) {
    await params.reply(chunk || 'Task completed.');
  }
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

function isNewerTimestamp(a: string | undefined, b: string | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum > bNum;
  return a > b;
}

async function pollSlack(connectorId: ManagedConnectorId, config: GatewayConnectorExtensionConfig, token: string): Promise<void> {
  const handle = getHandle(connectorId);
  const slackState = handle.slack!;
  if (!slackState.botUserId || !slackState.teamId) {
    const auth = await slackApi(token, 'auth.test');
    slackState.botUserId = normalizeToken(String(auth.user_id ?? ''));
    slackState.teamId = normalizeToken(String(auth.team_id ?? '')) || 'slack';
    setRuntimeStatus(connectorId, {
      botUserId: slackState.botUserId,
      accountId: resolveRuntimeAccountId(connectorId, config, slackState.teamId),
    });
  }

  const channelIds = getConnectorChannels(config, 'channels');
  if (channelIds.length === 0) {
    setRuntimeStatus(connectorId, {
      detail: 'Set Allowed channel IDs (or metadata.channels) for Slack polling.',
    });
    return;
  }

  const requireMention = getMetadataBoolean(config, 'require_mention', true);
  const prefix = normalizeToken(getMetadata(config, 'command_prefix') ?? '!desk');
  const botMention = slackState.botUserId ? `<@${slackState.botUserId}>` : '';

  for (const channelId of channelIds) {
    const oldest = slackState.channelCursorTs.get(channelId);
    const history = await slackApi(token, 'conversations.history', {
      query: {
        channel: channelId,
        oldest,
        inclusive: 'false',
        limit: '30',
      },
    });
    const messages = Array.isArray(history.messages) ? history.messages as Array<Record<string, any>> : [];
    const sorted = messages
      .filter((message) => typeof message?.text === 'string' && !message?.bot_id && message?.subtype !== 'bot_message')
      .sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));

    let maxTs = oldest;
    for (const message of sorted) {
      const messageTs = normalizeToken(String(message.ts ?? ''));
      if (!messageTs) continue;
      if (isNewerTimestamp(messageTs, maxTs)) maxTs = messageTs;
      const fromUserId = normalizeToken(String(message.user ?? ''));
      if (!fromUserId || fromUserId === slackState.botUserId) continue;
      let content = normalizeToken(String(message.text ?? ''));
      if (!content) continue;
      let hasMention = false;
      if (botMention && content.includes(botMention)) {
        hasMention = true;
        content = content.split(botMention).join(' ').trim();
      }
      let hasPrefix = false;
      if (prefix && normalizeLower(content).startsWith(normalizeLower(prefix))) {
        hasPrefix = true;
        content = content.slice(prefix.length).trim();
      }
      const isDm = channelId.startsWith('D');
      if (!content) continue;
      if (!isDm && requireMention && !hasMention && !hasPrefix) continue;
      const identity: ConnectorAccessIdentity = {
        accountId: resolveRuntimeAccountId(connectorId, config, slackState.teamId || 'slack'),
        peerKind: isDm ? 'dm' : 'channel',
        peerId: channelId,
        userId: fromUserId,
        channelId: isDm ? undefined : channelId,
      };
      if (!shouldProcessInboundConnectorMessage(connectorId, config, identity)) continue;
      await runConnectorTask({
        connectorId,
        routeChannel: 'slack',
        accountId: identity.accountId,
        peerKind: identity.peerKind,
        peerId: identity.peerId,
        prompt: formatPrompt('Slack', channelId, fromUserId, content),
        taskSeed: `${channelId}_${messageTs}`,
        agentIdOverride: config.agentId,
        reply: async (text: string) => {
          await slackApi(token, 'chat.postMessage', {
            body: {
              channel: channelId,
              text,
              thread_ts: message.thread_ts ?? message.ts,
            },
          });
        },
      });
    }
    if (maxTs && isNewerTimestamp(maxTs, oldest)) {
      slackState.channelCursorTs.set(channelId, maxTs);
    }
  }
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

function rememberMatrixEvent(handle: ManagedRuntimeHandle, eventId: string): boolean {
  const state = handle.matrix!;
  if (!eventId) return false;
  if (state.seenEventSet.has(eventId)) return false;
  state.seenEventSet.add(eventId);
  state.seenEventIds.push(eventId);
  if (state.seenEventIds.length > 5000) {
    const removed = state.seenEventIds.shift();
    if (removed) state.seenEventSet.delete(removed);
  }
  return true;
}

async function pollMatrix(connectorId: ManagedConnectorId, config: GatewayConnectorExtensionConfig, accessToken: string): Promise<void> {
  const handle = getHandle(connectorId);
  const matrixState = handle.matrix!;
  const baseUrl = normalizeToken(config.bridgeUrl) || 'https://matrix-client.matrix.org';
  if (!matrixState.selfUserId) {
    const whoami = await matrixApi(baseUrl, accessToken, 'GET', '/_matrix/client/v3/account/whoami');
    matrixState.selfUserId = normalizeToken(String(whoami.user_id ?? ''));
    setRuntimeStatus(connectorId, {
      botUserId: matrixState.selfUserId,
      accountId: resolveRuntimeAccountId(connectorId, config, matrixState.selfUserId),
    });
  }

  const requireMention = getMetadataBoolean(config, 'require_mention', false);
  const prefix = normalizeToken(getMetadata(config, 'command_prefix') ?? '!desk');
  const roomAllowlist = getConnectorChannels(config, 'rooms');
  const sync = await matrixApi(baseUrl, accessToken, 'GET', '/_matrix/client/v3/sync', {
    query: {
      timeout: '0',
      since: matrixState.since,
    },
  });
  matrixState.since = normalizeToken(String(sync.next_batch ?? matrixState.since ?? '')) || matrixState.since;
  const joinRooms = (sync.rooms?.join ?? {}) as Record<string, { timeline?: { events?: Array<Record<string, any>> } }>;
  const roomEntries = Object.entries(joinRooms);
  for (const [roomId, roomData] of roomEntries) {
    if (roomAllowlist.length > 0 && !roomAllowlist.includes(roomId)) continue;
    const events = roomData.timeline?.events ?? [];
    for (const event of events) {
      const eventId = normalizeToken(String(event.event_id ?? ''));
      if (!eventId || !rememberMatrixEvent(handle, eventId)) continue;
      if (event.type !== 'm.room.message') continue;
      const sender = normalizeToken(String(event.sender ?? ''));
      if (!sender || sender === matrixState.selfUserId) continue;
      const msgType = normalizeToken(String(event.content?.msgtype ?? ''));
      if (msgType !== 'm.text' && msgType !== 'm.notice') continue;
      let content = normalizeToken(String(event.content?.body ?? ''));
      if (!content) continue;
      let hasMention = false;
      if (matrixState.selfUserId && content.includes(matrixState.selfUserId)) {
        hasMention = true;
      }
      let hasPrefix = false;
      if (prefix && normalizeLower(content).startsWith(normalizeLower(prefix))) {
        hasPrefix = true;
        content = content.slice(prefix.length).trim();
      }
      if (!content) continue;
      if (requireMention && !hasMention && !hasPrefix) continue;
      const identity: ConnectorAccessIdentity = {
        accountId: resolveRuntimeAccountId(connectorId, config, matrixState.selfUserId || 'matrix'),
        peerKind: 'channel',
        peerId: roomId,
        userId: sender,
        channelId: roomId,
      };
      if (!shouldProcessInboundConnectorMessage(connectorId, config, identity)) continue;
      await runConnectorTask({
        connectorId,
        routeChannel: 'matrix',
        accountId: identity.accountId,
        peerKind: identity.peerKind,
        peerId: identity.peerId,
        prompt: formatPrompt('Matrix', roomId, sender, content),
        taskSeed: eventId,
        agentIdOverride: config.agentId,
        reply: async (text: string) => {
          await matrixApi(baseUrl, accessToken, 'POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(randomUUID())}`, {
            body: {
              msgtype: 'm.text',
              body: text,
            },
          });
        },
      });
    }
  }
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

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function pollTeams(connectorId: ManagedConnectorId, config: GatewayConnectorExtensionConfig, accessToken: string): Promise<void> {
  const handle = getHandle(connectorId);
  const teamsState = handle.msteams!;
  if (!teamsState.selfUserId) {
    try {
      const me = await teamsApi(accessToken, 'GET', '/me');
      teamsState.selfUserId = normalizeToken(String(me.id ?? ''));
      setRuntimeStatus(connectorId, {
        botUserId: teamsState.selfUserId,
        accountId: resolveRuntimeAccountId(connectorId, config, teamsState.selfUserId),
      });
    } catch {
      const configuredBot = normalizeToken(getMetadata(config, 'bot_user_id'));
      if (configuredBot) {
        teamsState.selfUserId = configuredBot;
        setRuntimeStatus(connectorId, {
          botUserId: configuredBot,
          accountId: resolveRuntimeAccountId(connectorId, config, configuredBot),
        });
      }
    }
  }

  const chatIds = getConnectorChannels(config, 'chat_ids');
  if (chatIds.length === 0) {
    setRuntimeStatus(connectorId, {
      detail: 'Set Allowed channel IDs (chat IDs) or metadata.chat_ids for Teams polling.',
    });
    return;
  }

  const requireMention = getMetadataBoolean(config, 'require_mention', false);
  const prefix = normalizeToken(getMetadata(config, 'command_prefix') ?? '!desk');
  for (const chatId of chatIds) {
    const history = await teamsApi(accessToken, 'GET', `/chats/${encodeURIComponent(chatId)}/messages?$top=30`);
    const messages = Array.isArray(history.value) ? history.value as Array<Record<string, any>> : [];
    const sorted = messages.sort((a, b) =>
      String(a.createdDateTime ?? '').localeCompare(String(b.createdDateTime ?? ''))
    );
    const cursor = teamsState.chatCursorAt.get(chatId);
    let nextCursor = cursor;
    for (const message of sorted) {
      const messageAt = normalizeToken(String(message.createdDateTime ?? ''));
      if (!messageAt) continue;
      if (cursor && messageAt <= cursor) continue;
      if (!nextCursor || messageAt > nextCursor) nextCursor = messageAt;
      const fromUserId = normalizeToken(String(message.from?.user?.id ?? ''));
      if (!fromUserId || fromUserId === teamsState.selfUserId) continue;
      let content = stripHtml(normalizeToken(String(message.body?.content ?? '')));
      if (!content) continue;
      let hasMention = false;
      if (teamsState.selfUserId && content.includes(teamsState.selfUserId)) {
        hasMention = true;
      }
      let hasPrefix = false;
      if (prefix && normalizeLower(content).startsWith(normalizeLower(prefix))) {
        hasPrefix = true;
        content = content.slice(prefix.length).trim();
      }
      if (!content) continue;
      if (requireMention && !hasMention && !hasPrefix) continue;
      const messageId = normalizeToken(String(message.id ?? messageAt));
      const identity: ConnectorAccessIdentity = {
        accountId: resolveRuntimeAccountId(connectorId, config, teamsState.selfUserId || 'msteams'),
        peerKind: 'channel',
        peerId: chatId,
        userId: fromUserId,
        channelId: chatId,
      };
      if (!shouldProcessInboundConnectorMessage(connectorId, config, identity)) continue;
      await runConnectorTask({
        connectorId,
        routeChannel: 'msteams',
        accountId: identity.accountId,
        peerKind: identity.peerKind,
        peerId: identity.peerId,
        prompt: formatPrompt('Teams', chatId, fromUserId, content),
        taskSeed: messageId,
        agentIdOverride: config.agentId,
        reply: async (text: string) => {
          await teamsApi(accessToken, 'POST', `/chats/${encodeURIComponent(chatId)}/messages`, {
            body: {
              body: {
                contentType: 'text',
                content: text,
              },
            },
          });
        },
      });
    }
    if (nextCursor) {
      teamsState.chatCursorAt.set(chatId, nextCursor);
    }
  }
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

async function pollMattermost(
  connectorId: ManagedConnectorId,
  config: GatewayConnectorExtensionConfig,
  token: string
): Promise<void> {
  const handle = getHandle(connectorId);
  const state = handle.mattermost!;
  const baseUrl = normalizeToken(config.bridgeUrl);
  if (!baseUrl) {
    setRuntimeStatus(connectorId, {
      detail: 'Set Bridge URL to your Mattermost server base URL (e.g. https://chat.example.com).',
    });
    return;
  }
  if (!state.selfUserId) {
    const me = await mattermostApi(baseUrl, token, 'GET', '/api/v4/users/me');
    state.selfUserId = normalizeToken(String(me.id ?? ''));
    const teams = await mattermostApi(baseUrl, token, 'GET', '/api/v4/users/me/teams');
    const firstTeam = Array.isArray(teams) && teams.length > 0 ? teams[0] : undefined;
    state.teamId = normalizeToken(String(firstTeam?.id ?? '')) || 'mattermost';
    setRuntimeStatus(connectorId, {
      botUserId: state.selfUserId,
      accountId: resolveRuntimeAccountId(connectorId, config, state.teamId || 'mattermost'),
    });
  }

  const channelIds = getConnectorChannels(config, 'channels');
  if (channelIds.length === 0) {
    setRuntimeStatus(connectorId, {
      detail: 'Set Allowed channel IDs (or metadata.channels) for Mattermost polling.',
    });
    return;
  }

  const prefix = normalizeToken(getMetadata(config, 'command_prefix') ?? '!desk');
  const requireMention = getMetadataBoolean(config, 'require_mention', false);
  for (const channelId of channelIds) {
    const sinceMs = state.channelCursorMs.get(channelId) ?? 0;
    const postsResp = await mattermostApi(baseUrl, token, 'GET', `/api/v4/channels/${encodeURIComponent(channelId)}/posts`, {
      query: {
        since: sinceMs > 0 ? sinceMs : undefined,
        page: 0,
        per_page: 30,
      },
    });
    const order = Array.isArray(postsResp.order) ? postsResp.order as string[] : [];
    const posts = (postsResp.posts ?? {}) as Record<string, Record<string, any>>;
    const sorted = order
      .map((id) => posts[id])
      .filter(Boolean)
      .sort((a, b) => Number(a.create_at ?? 0) - Number(b.create_at ?? 0));

    let maxSeen = sinceMs;
    for (const post of sorted) {
      const createdAt = Number(post.create_at ?? 0);
      if (Number.isFinite(createdAt) && createdAt > maxSeen) maxSeen = createdAt;
      const fromUserId = normalizeToken(String(post.user_id ?? ''));
      if (!fromUserId || fromUserId === state.selfUserId) continue;
      if (post.type && String(post.type).startsWith('system_')) continue;
      let content = normalizeToken(String(post.message ?? ''));
      if (!content) continue;
      let hasMention = false;
      if (state.selfUserId && content.includes(`@${state.selfUserId}`)) {
        hasMention = true;
      }
      let hasPrefix = false;
      if (prefix && normalizeLower(content).startsWith(normalizeLower(prefix))) {
        hasPrefix = true;
        content = content.slice(prefix.length).trim();
      }
      if (!content) continue;
      if (requireMention && !hasMention && !hasPrefix) continue;
      const taskSeed = `${channelId}_${normalizeToken(String(post.id ?? createdAt))}`;
      const identity: ConnectorAccessIdentity = {
        accountId: resolveRuntimeAccountId(connectorId, config, state.teamId || 'mattermost'),
        peerKind: 'channel',
        peerId: channelId,
        userId: fromUserId,
        channelId,
      };
      if (!shouldProcessInboundConnectorMessage(connectorId, config, identity)) continue;
      await runConnectorTask({
        connectorId,
        routeChannel: 'mattermost',
        accountId: identity.accountId,
        peerKind: identity.peerKind,
        peerId: identity.peerId,
        prompt: formatPrompt('Mattermost', channelId, fromUserId, content),
        taskSeed,
        agentIdOverride: config.agentId,
        reply: async (text: string) => {
          await mattermostApi(baseUrl, token, 'POST', '/api/v4/posts', {
            body: {
              channel_id: channelId,
              message: text,
              root_id: normalizeToken(String(post.root_id ?? post.id ?? '')) || undefined,
            },
          });
        },
      });
    }
    if (maxSeen > sinceMs) {
      state.channelCursorMs.set(channelId, maxSeen);
    }
  }
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

async function pollGoogleChat(
  connectorId: ManagedConnectorId,
  config: GatewayConnectorExtensionConfig,
  token: string
): Promise<void> {
  const handle = getHandle(connectorId);
  const state = handle.googlechat!;
  const spaces = getConnectorChannels(config, 'spaces');
  if (spaces.length === 0) {
    setRuntimeStatus(connectorId, {
      detail: 'Set Allowed channel IDs (space IDs) or metadata.spaces for Google Chat polling.',
    });
    return;
  }

  if (!state.selfUserName) {
    const me = await googleChatApi(token, 'GET', '/users/me');
    state.selfUserName = normalizeToken(String(me.name ?? '')) || undefined;
    setRuntimeStatus(connectorId, {
      botUserId: state.selfUserName,
      accountId: resolveRuntimeAccountId(connectorId, config, state.selfUserName || 'googlechat'),
    });
  }

  const prefix = normalizeToken(getMetadata(config, 'command_prefix') ?? '!desk');
  const requireMention = getMetadataBoolean(config, 'require_mention', false);
  for (const spaceIdRaw of spaces) {
    const spaceId = spaceIdRaw.startsWith('spaces/') ? spaceIdRaw : `spaces/${spaceIdRaw}`;
    const cursor = state.spaceCursorAt.get(spaceId);
    const response = await googleChatApi(token, 'GET', `/${spaceId}/messages`, {
      query: {
        pageSize: '50',
      },
    });
    const messages = Array.isArray(response.messages) ? response.messages as Array<Record<string, any>> : [];
    const sorted = messages.sort((a, b) =>
      String(a.createTime ?? '').localeCompare(String(b.createTime ?? ''))
    );
    let nextCursor = cursor;
    for (const message of sorted) {
      const createTime = normalizeToken(String(message.createTime ?? ''));
      if (!createTime) continue;
      if (cursor && createTime <= cursor) continue;
      if (!nextCursor || createTime > nextCursor) nextCursor = createTime;
      const senderName = normalizeToken(String(message.sender?.name ?? ''));
      if (senderName && state.selfUserName && senderName === state.selfUserName) continue;
      const senderType = normalizeLower(String(message.sender?.type ?? ''));
      if (senderType === 'bot') continue;
      let content = normalizeToken(String(message.text ?? message.argumentText ?? ''));
      if (!content) continue;
      let hasMention = false;
      if (state.selfUserName && content.includes(state.selfUserName)) {
        hasMention = true;
      }
      let hasPrefix = false;
      if (prefix && normalizeLower(content).startsWith(normalizeLower(prefix))) {
        hasPrefix = true;
        content = content.slice(prefix.length).trim();
      }
      if (!content) continue;
      if (requireMention && !hasMention && !hasPrefix) continue;
      const taskSeed = `${spaceId}_${normalizeToken(String(message.name ?? createTime))}`;
      const identity: ConnectorAccessIdentity = {
        accountId: resolveRuntimeAccountId(connectorId, config, state.selfUserName || 'googlechat'),
        peerKind: 'channel',
        peerId: spaceId,
        userId: senderName || undefined,
        channelId: spaceId,
      };
      if (!shouldProcessInboundConnectorMessage(connectorId, config, identity)) continue;
      await runConnectorTask({
        connectorId,
        routeChannel: 'googlechat',
        accountId: identity.accountId,
        peerKind: identity.peerKind,
        peerId: identity.peerId,
        prompt: formatPrompt('GoogleChat', spaceId, senderName || 'user', content),
        taskSeed,
        agentIdOverride: config.agentId,
        reply: async (text: string) => {
          await googleChatApi(token, 'POST', `/${spaceId}/messages`, {
            body: {
              text,
            },
          });
        },
      });
    }
    if (nextCursor) {
      state.spaceCursorAt.set(spaceId, nextCursor);
    }
  }
}

type BridgePollEvent = {
  id?: string;
  cursor?: string;
  createdAt?: string;
  peerId?: string;
  peerKind?: 'dm' | 'group' | 'channel';
  userId?: string;
  groupId?: string;
  channelId?: string;
  accountId?: string;
  authorId?: string;
  text?: string;
  message?: string;
  prompt?: string;
  threadId?: string;
  metadata?: Record<string, string>;
};

function getBridgeEndpoint(config: GatewayConnectorExtensionConfig, key: string, fallback: string): string {
  const fromMetadata = normalizeToken(getMetadata(config, key));
  if (fromMetadata) return fromMetadata;
  return fallback;
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

function coerceBridgePeerKind(event: BridgePollEvent): 'dm' | 'group' | 'channel' {
  if (event.peerKind === 'group' || event.groupId) return 'group';
  if (event.peerKind === 'channel' || event.channelId) return 'channel';
  return 'dm';
}

function getBridgeEventPeerId(event: BridgePollEvent): string {
  return normalizeToken(event.peerId)
    || normalizeToken(event.channelId)
    || normalizeToken(event.groupId)
    || normalizeToken(event.userId)
    || 'unknown';
}

function getBridgeEventText(event: BridgePollEvent): string {
  return normalizeToken(event.prompt) || normalizeToken(event.message) || normalizeToken(event.text);
}

function parseBridgeEventContent(
  text: string,
  options: {
    prefix: string;
    mentionTokens: string[];
  }
): BridgeEventResult {
  let content = normalizeToken(text);
  let hasMention = false;
  for (const mentionToken of options.mentionTokens) {
    if (!mentionToken) continue;
    if (content.includes(mentionToken)) {
      hasMention = true;
      content = content.split(mentionToken).join(' ').trim();
    }
  }
  let hasPrefix = false;
  if (options.prefix && normalizeLower(content).startsWith(normalizeLower(options.prefix))) {
    hasPrefix = true;
    content = content.slice(options.prefix.length).trim();
  }
  return {
    content,
    hasMention,
    hasPrefix,
  };
}

async function pollBridgeManagedConnector(
  connectorId: BridgeManagedConnectorId,
  config: GatewayConnectorExtensionConfig,
  token: string
): Promise<void> {
  const handle = getHandle(connectorId);
  const bridgeState = handle.bridge;
  const baseUrl = normalizeToken(config.bridgeUrl)
    || (connectorId === 'line' || connectorId === 'whatsapp' || connectorId === 'signal' || connectorId === 'bluebubbles' || connectorId === 'imessage' || connectorId === 'nextcloud-talk' || connectorId === 'nostr' || connectorId === 'tlon' || connectorId === 'zalo' || connectorId === 'zalouser' ? getConnectorBridgeRuntimeBaseUrl() : '');
  if (!baseUrl) {
    setRuntimeStatus(connectorId, {
      detail: 'Bridge URL is required for this connector.',
    });
    return;
  }
  const pollIntervalMs = getMetadataNumber(config, 'poll_interval_ms', 5000, 1000, 60_000);
  const eventsEndpoint = getBridgeEndpoint(config, 'events_endpoint', '/connector/v1/events');
  const sendEndpoint = getBridgeEndpoint(config, 'send_endpoint', '/connector/v1/send');
  const requireMention = getMetadataBoolean(config, 'require_mention', false);
  const prefix = normalizeToken(getMetadata(config, 'command_prefix') ?? '!desk');
  const mentionTokens = parseCsvList(getMetadata(config, 'mention_tokens'));
  const response = await bridgeRuntimeApi(baseUrl, token, 'GET', eventsEndpoint, {
    query: {
      connector: connectorId,
      accountId: resolveRuntimeAccountId(connectorId, config, connectorId),
      cursor: bridgeState?.cursor,
      limit: '50',
    },
  });
  const events = Array.isArray(response.events) ? response.events as BridgePollEvent[] : [];
  let latestCursor = normalizeToken(String(response.cursor ?? bridgeState?.cursor ?? '')) || bridgeState?.cursor;

  for (const event of events) {
    const text = getBridgeEventText(event);
    if (!text) continue;
    const peerKind = coerceBridgePeerKind(event);
    const peerId = getBridgeEventPeerId(event);
    const accountId = normalizeToken(event.accountId) || resolveRuntimeAccountId(connectorId, config, connectorId);
    const authorId = normalizeToken(event.authorId) || normalizeToken(event.userId) || 'user';
    const parsedContent = parseBridgeEventContent(text, {
      prefix,
      mentionTokens,
    });
    if (!parsedContent.content) continue;
    if (peerKind !== 'dm' && requireMention && !parsedContent.hasMention && !parsedContent.hasPrefix) continue;
    const identity: ConnectorAccessIdentity = {
      accountId,
      peerKind,
      peerId,
      userId: normalizeToken(event.userId) || normalizeToken(event.authorId) || undefined,
      groupId: normalizeToken(event.groupId) || (peerKind === 'group' ? peerId : undefined),
      channelId: normalizeToken(event.channelId) || (peerKind === 'channel' ? peerId : undefined),
    };
    if (!shouldProcessInboundConnectorMessage(connectorId, config, identity)) continue;
    const taskSeed = normalizeToken(event.id) || normalizeToken(event.cursor) || `${peerId}_${normalizeToken(event.createdAt) || Date.now().toString()}`;
    await runConnectorTask({
      connectorId,
      routeChannel: connectorId,
      accountId: identity.accountId,
      peerKind: identity.peerKind,
      peerId: identity.peerId,
      prompt: formatPrompt(connectorId.toUpperCase(), peerId, authorId, parsedContent.content),
      taskSeed,
      agentIdOverride: config.agentId,
      reply: async (replyText: string) => {
        await bridgeRuntimeApi(baseUrl, token, 'POST', sendEndpoint, {
          body: {
            connector: connectorId,
            accountId: identity.accountId,
            peerKind,
            peerId,
            text: replyText,
            replyToEventId: normalizeToken(event.id) || undefined,
            threadId: normalizeToken(event.threadId) || undefined,
            metadata: event.metadata ?? undefined,
          },
        });
      },
    });
    latestCursor = normalizeToken(event.cursor) || normalizeToken(event.id) || latestCursor;
  }

  if (bridgeState) {
    bridgeState.cursor = latestCursor;
  }
  setRuntimeStatus(connectorId, {
    configured: true,
    running: true,
    lastPollAt: nowIso(),
    detail: `Bridge polling active (${pollIntervalMs}ms).`,
  });
}

function buildDiscordRuntimeConfig(config: GatewayConnectorExtensionConfig): DiscordConnectorConfig {
  const metadata = config.metadata ?? {};
  const dmPolicyRaw = normalizeLower(String(metadata.dm_policy ?? ''));
  const dmPolicy = dmPolicyRaw === 'pairing' || dmPolicyRaw === 'open' || dmPolicyRaw === 'disabled'
    ? dmPolicyRaw
    : 'pairing';
  const parseList = (value: string | undefined, fallback?: string[]): string[] => {
    const parsed = parseCsvList(value);
    if (parsed.length > 0) return Array.from(new Set(parsed));
    return fallback ?? [];
  };
  return {
    enabled: config.enabled,
    allowDms: dmPolicy !== 'disabled' && getMetadataBoolean(config, 'allow_dms', true),
    dmPolicy,
    requireMention: getMetadataBoolean(config, 'require_mention', true),
    commandPrefix: normalizeToken(String(metadata.command_prefix ?? '!desk')) || '!desk',
    dmAllowlist: parseList(String(metadata.dm_allowlist ?? ''), config.allowedUserIds),
    channelAllowlist: parseList(String(metadata.channel_allowlist ?? ''), config.allowedChannelIds),
    guildAllowlist: parseList(String(metadata.guild_allowlist ?? ''), config.allowedGroupIds),
    agentId: config.agentId,
  };
}

function buildTelegramRuntimeConfig(config: GatewayConnectorExtensionConfig): TelegramConnectorConfig {
  const metadata = config.metadata ?? {};
  const dmPolicyRaw = normalizeLower(String(metadata.dm_policy ?? ''));
  const dmPolicy = dmPolicyRaw === 'pairing' || dmPolicyRaw === 'open' || dmPolicyRaw === 'disabled'
    ? dmPolicyRaw
    : 'pairing';
  const parseList = (value: string | undefined, fallback?: string[]): string[] => {
    const parsed = parseCsvList(value);
    if (parsed.length > 0) return Array.from(new Set(parsed));
    return fallback ?? [];
  };
  return {
    enabled: config.enabled,
    allowDms: dmPolicy !== 'disabled' && getMetadataBoolean(config, 'allow_dms', true),
    dmPolicy,
    requireMention: getMetadataBoolean(config, 'require_mention', true),
    commandPrefix: normalizeToken(String(metadata.command_prefix ?? '/desk')) || '/desk',
    dmAllowlist: parseList(String(metadata.dm_allowlist ?? ''), config.allowedUserIds),
    channelAllowlist: parseList(String(metadata.channel_allowlist ?? ''), config.allowedChannelIds),
    groupAllowlist: parseList(String(metadata.group_allowlist ?? ''), config.allowedGroupIds),
    agentId: config.agentId,
  };
}

function getManagedConnectorConfigs(connectorId: ManagedConnectorId): GatewayConnectorExtensionConfig[] {
  const configs = listGatewayConnectorExtensionConfigs(connectorId)
    .filter((entry) => isManagedConnectorId(entry.id));
  if (configs.length > 0) {
    return configs;
  }
  return [resolveGatewayConnectorExtensionConfig({ id: connectorId, enabledOnly: false })];
}

async function getConnectorSecretForInstance(
  connectorId: ManagedConnectorId,
  instanceId?: string
): Promise<string | null> {
  const runtimeKey = getGatewayConnectorRuntimeKey(connectorId, instanceId);
  const fromRuntimeKey = await getGatewayConnectorSecret(runtimeKey);
  if (fromRuntimeKey) return fromRuntimeKey;
  if ((!instanceId || instanceId === 'default') && connectorId === 'discord') {
    return getDiscordToken();
  }
  if ((!instanceId || instanceId === 'default') && connectorId === 'telegram') {
    return getTelegramToken();
  }
  return null;
}

async function clearRemovedConnectorInstances(
  connectorId: ManagedConnectorId,
  activeRuntimeKeys: Set<string>
): Promise<void> {
  const currentForConnector = Array.from(runtimeStatuses.values())
    .filter((status) => status.connectorId === connectorId);
  for (const status of currentForConnector) {
    const runtimeKey = status.runtimeKey || connectorId;
    if (activeRuntimeKeys.has(runtimeKey)) continue;
    if (connectorId === 'discord') {
      await stopDiscordConnector({ runtimeKey });
    } else if (connectorId === 'telegram') {
      await stopTelegramConnector({ runtimeKey });
    }
    runtimeStatuses.delete(runtimeKey);
    runtimeHandles.delete(runtimeKey);
  }
}

async function pollManagedConnector(connectorId: ManagedConnectorId): Promise<void> {
  if (connectorPollingLocks.has(connectorId)) return;
  connectorPollingLocks.add(connectorId);
  try {
    const configs = getManagedConnectorConfigs(connectorId);
    const activeRuntimeKeys = new Set(configs.map((config) => getGatewayConnectorRuntimeKey(connectorId, config.instanceId)));
    await clearRemovedConnectorInstances(connectorId, activeRuntimeKeys);

    for (const config of configs) {
      const runtimeKey = getGatewayConnectorRuntimeKey(connectorId, config.instanceId);
      const secret = await getConnectorSecretForInstance(connectorId, config.instanceId);
      await withRuntimeContext(connectorId, runtimeKey, config.instanceId || 'default', async () => {
        if (connectorId === 'discord') {
          syncDiscordRuntimeStatus(runtimeKey);
          const nativeStatus = getDiscordStatus(runtimeKey);
          setRuntimeStatus(connectorId, {
            instanceName: config.name,
            accountId: resolveRuntimeAccountId(connectorId, config, nativeStatus.botUser?.id),
            detail: nativeStatus.running
              ? 'Discord gateway runtime active.'
              : (nativeStatus.lastError || 'Discord runtime idle.'),
          });
          return;
        }
        if (connectorId === 'telegram') {
          syncTelegramRuntimeStatus(runtimeKey);
          const nativeStatus = getTelegramStatus(runtimeKey);
          setRuntimeStatus(connectorId, {
            instanceName: config.name,
            accountId: resolveRuntimeAccountId(connectorId, config, nativeStatus.botUser?.id),
            detail: nativeStatus.running
              ? 'Telegram gateway runtime active.'
              : (nativeStatus.lastError || 'Telegram runtime idle.'),
          });
          return;
        }

        if (!config.enabled || !secret) {
          setRuntimeStatus(connectorId, {
            instanceName: config.name,
            configured: Boolean(secret),
            running: false,
            detail: !config.enabled ? 'Connector disabled.' : 'Connector secret not set.',
          });
          return;
        }

        try {
          if (connectorId === 'slack') {
            await pollSlack(connectorId, config, secret);
          } else if (connectorId === 'matrix') {
            await pollMatrix(connectorId, config, secret);
          } else if (connectorId === 'msteams') {
            await pollTeams(connectorId, config, secret);
          } else if (connectorId === 'mattermost') {
            await pollMattermost(connectorId, config, secret);
          } else if (connectorId === 'googlechat') {
            await pollGoogleChat(connectorId, config, secret);
          } else if (isBridgeManagedConnectorId(connectorId)) {
            await pollBridgeManagedConnector(connectorId, config, secret);
          }
          setRuntimeStatus(connectorId, {
            instanceName: config.name,
            configured: true,
            running: true,
            lastPollAt: nowIso(),
            lastError: undefined,
          });
        } catch (error) {
          setRuntimeStatus(connectorId, {
            instanceName: config.name,
            running: false,
            lastPollAt: nowIso(),
            lastError: error instanceof Error ? error.message : 'Connector poll failed.',
          });
        }
      });
    }
  } finally {
    connectorPollingLocks.delete(connectorId);
  }
}

async function startManagedConnectorRuntime(connectorId: ManagedConnectorId): Promise<void> {
  stopRuntimeTimer(connectorId);
  const configs = getManagedConnectorConfigs(connectorId);
  const activeRuntimeKeys = new Set(configs.map((config) => getGatewayConnectorRuntimeKey(connectorId, config.instanceId)));
  await clearRemovedConnectorInstances(connectorId, activeRuntimeKeys);

  if (connectorId === 'discord' || connectorId === 'telegram') {
    for (const config of configs) {
      const runtimeKey = getGatewayConnectorRuntimeKey(connectorId, config.instanceId);
      const secret = await getConnectorSecretForInstance(connectorId, config.instanceId);
      await withRuntimeContext(connectorId, runtimeKey, config.instanceId || 'default', async () => {
        if (!config.enabled || !secret) {
          setRuntimeStatus(connectorId, {
            instanceName: config.name,
            configured: Boolean(secret),
            running: false,
            detail: !config.enabled ? 'Connector disabled.' : 'Connector secret not set.',
          });
          if (connectorId === 'discord') {
            await stopDiscordConnector({ runtimeKey });
          } else {
            await stopTelegramConnector({ runtimeKey });
          }
          return;
        }

        if (connectorId === 'discord') {
          await startDiscordConnector({
            runtimeKey,
            config: buildDiscordRuntimeConfig(config),
            token: secret,
            accountId: normalizeToken(config.accountId) || config.instanceId,
          });
          syncDiscordRuntimeStatus(runtimeKey);
        } else {
          await startTelegramConnector({
            runtimeKey,
            config: buildTelegramRuntimeConfig(config),
            token: secret,
            accountId: normalizeToken(config.accountId) || config.instanceId,
          });
          syncTelegramRuntimeStatus(runtimeKey);
        }
        setRuntimeStatus(connectorId, {
          instanceName: config.name,
          configured: true,
          running: true,
          accountId: resolveRuntimeAccountId(
            connectorId,
            config,
            connectorId === 'discord'
              ? getDiscordStatus(runtimeKey).botUser?.id
              : getTelegramStatus(runtimeKey).botUser?.id
          ),
          lastStartAt: nowIso(),
        });
      });
    }
    connectorRuntimeTimers.set(connectorId, setInterval(() => {
      void pollManagedConnector(connectorId);
    }, 3000));
    return;
  }

  const enabledConfigured: GatewayConnectorExtensionConfig[] = [];
  for (const config of configs) {
    const secret = await getConnectorSecretForInstance(connectorId, config.instanceId);
    const runtimeKey = getGatewayConnectorRuntimeKey(connectorId, config.instanceId);
    await withRuntimeContext(connectorId, runtimeKey, config.instanceId || 'default', async () => {
      if (!config.enabled || !secret) {
        setRuntimeStatus(connectorId, {
          instanceName: config.name,
          configured: Boolean(secret),
          running: false,
          lastError: undefined,
          detail: !config.enabled ? 'Connector disabled.' : 'Connector secret not set.',
        });
      } else {
        enabledConfigured.push(config);
        setRuntimeStatus(connectorId, {
          instanceName: config.name,
          configured: true,
          running: true,
          lastStartAt: nowIso(),
          detail: connectorId === 'msteams'
            ? 'Polling Microsoft Graph chat messages.'
            : connectorId === 'matrix'
              ? 'Polling Matrix sync endpoint.'
              : connectorId === 'mattermost'
                ? 'Polling Mattermost channel posts.'
                : connectorId === 'googlechat'
                  ? 'Polling Google Chat spaces.'
                  : isBridgeManagedConnectorId(connectorId)
                    ? 'Polling bridge events endpoint.'
                    : 'Polling Slack conversation history.',
        });
      }
    });
  }

  if (enabledConfigured.length === 0) {
    return;
  }

  const intervalMs = Math.min(
    ...enabledConfigured.map((config) =>
      getMetadataNumber(config, 'poll_interval_ms', connectorId === 'matrix' ? 7000 : 5000, 1000, 60_000)
    )
  );
  connectorRuntimeTimers.set(connectorId, setInterval(() => {
    void pollManagedConnector(connectorId);
  }, intervalMs));
  void pollManagedConnector(connectorId);
}

export async function startGatewayConnectorRuntimes(): Promise<void> {
  for (const connectorId of MANAGED_CONNECTOR_IDS) {
    await startManagedConnectorRuntime(connectorId);
  }
}

export async function stopGatewayConnectorRuntimes(): Promise<void> {
  for (const connectorId of MANAGED_CONNECTOR_IDS) {
    stopRuntimeTimer(connectorId);
    const statuses = Array.from(runtimeStatuses.values()).filter((entry) => entry.connectorId === connectorId);
    for (const status of statuses) {
      const runtimeKey = status.runtimeKey || connectorId;
      if (connectorId === 'discord') {
        await stopDiscordConnector({ runtimeKey });
      } else if (connectorId === 'telegram') {
        await stopTelegramConnector({ runtimeKey });
      }
      await withRuntimeContext(connectorId, runtimeKey, status.instanceId || 'default', async () => {
        setRuntimeStatus(connectorId, {
          running: false,
          detail: 'Stopped.',
        });
      });
    }
  }
}

export async function restartGatewayConnectorRuntime(
  connectorId?: GatewayConnectorExtensionId,
  _instanceId?: string
): Promise<void> {
  if (!connectorId) {
    await startGatewayConnectorRuntimes();
    return;
  }
  if (isManagedConnectorId(connectorId)) {
    await startManagedConnectorRuntime(connectorId);
  }
}

export function listGatewayConnectorRuntimeStatuses(): GatewayConnectorRuntimeStatus[] {
  const statuses = listGatewayConnectorExtensionConfigs()
    .filter((config) => isManagedConnectorId(config.id))
    .map((config) => {
      const runtimeKey = getGatewayConnectorRuntimeKey(config.id as ManagedConnectorId, config.instanceId);
      const connectorId = config.id as ManagedConnectorId;
      const existing = runtimeStatuses.get(runtimeKey);
      if (existing) {
        return {
          ...existing,
          mode: resolveRuntimeMode(connectorId),
        };
      }
      return {
        connectorId: config.id,
        instanceId: config.instanceId,
        runtimeKey,
        instanceName: config.name,
        configured: false,
        running: false,
        mode: resolveRuntimeMode(connectorId),
      };
    });
  statuses.sort((a, b) => {
    if (a.connectorId !== b.connectorId) return a.connectorId.localeCompare(b.connectorId);
    return (a.instanceId ?? 'default').localeCompare(b.instanceId ?? 'default');
  });
  return statuses;
}

export async function testGatewayConnectorRuntime(
  connectorId: GatewayConnectorExtensionId,
  instanceId?: string
): Promise<GatewayConnectorRuntimeTestResult> {
  if (!isManagedConnectorId(connectorId)) {
    return {
      connectorId,
      instanceId,
      runtimeKey: connectorId,
      ok: false,
      detail: 'No first-party runtime is implemented for this connector yet.',
    };
  }
  const config = resolveGatewayConnectorExtensionConfig({
    id: connectorId,
    instanceId,
    enabledOnly: false,
  });
  const runtimeKey = getGatewayConnectorRuntimeKey(connectorId, config.instanceId);
  if (!config.enabled) {
    return { connectorId, instanceId: config.instanceId, runtimeKey, ok: false, detail: 'Connector is disabled.' };
  }
  try {
    const secret = await getConnectorSecretForInstance(connectorId, config.instanceId);
    if (!secret) {
      return { connectorId, instanceId: config.instanceId, runtimeKey, ok: false, detail: 'Connector secret/token is not set.' };
    }
    if (connectorId === 'discord') {
      const tokenSet = await getDiscordTokenSet({ token: secret });
      if (!tokenSet) {
        return {
          connectorId,
          instanceId: config.instanceId,
          runtimeKey,
          ok: false,
          detail: 'Discord bot token is not set.',
        };
      }
      syncDiscordRuntimeStatus(runtimeKey);
      const status = getDiscordStatus(runtimeKey);
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: Boolean(status.running),
        detail: status.running ? 'Discord runtime is connected.' : (status.lastError || 'Discord runtime is not connected.'),
        metadata: {
          botUserId: String(status.botUser?.id ?? ''),
          botTag: String(status.botUser?.tag ?? ''),
        },
      };
    }
    if (connectorId === 'telegram') {
      const tokenSet = await getTelegramTokenSet({ token: secret });
      if (!tokenSet) {
        return {
          connectorId,
          instanceId: config.instanceId,
          runtimeKey,
          ok: false,
          detail: 'Telegram bot token is not set.',
        };
      }
      syncTelegramRuntimeStatus(runtimeKey);
      const status = getTelegramStatus(runtimeKey);
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: Boolean(status.running),
        detail: status.running ? 'Telegram runtime is connected.' : (status.lastError || 'Telegram runtime is not connected.'),
        metadata: {
          botUserId: String(status.botUser?.id ?? ''),
          botUsername: String(status.botUser?.username ?? ''),
        },
      };
    }
    if (connectorId === 'slack') {
      const auth = await slackApi(secret, 'auth.test');
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: true,
        detail: 'Connected to Slack API.',
        metadata: {
          teamId: String(auth.team_id ?? ''),
          userId: String(auth.user_id ?? ''),
        },
      };
    }
    if (connectorId === 'matrix') {
      const baseUrl = normalizeToken(config.bridgeUrl) || 'https://matrix-client.matrix.org';
      const whoami = await matrixApi(baseUrl, secret, 'GET', '/_matrix/client/v3/account/whoami');
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: true,
        detail: 'Connected to Matrix client API.',
        metadata: {
          userId: String(whoami.user_id ?? ''),
          baseUrl,
        },
      };
    }
    if (connectorId === 'msteams') {
      const me = await teamsApi(secret, 'GET', '/me');
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: true,
        detail: 'Connected to Microsoft Graph.',
        metadata: {
          userId: String(me.id ?? ''),
          displayName: String(me.displayName ?? ''),
        },
      };
    }
    if (connectorId === 'mattermost') {
      const baseUrl = normalizeToken(config.bridgeUrl);
      if (!baseUrl) {
        return {
          connectorId,
          instanceId: config.instanceId,
          runtimeKey,
          ok: false,
          detail: 'Bridge URL is required for Mattermost.',
        };
      }
      const me = await mattermostApi(baseUrl, secret, 'GET', '/api/v4/users/me');
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: true,
        detail: 'Connected to Mattermost API.',
        metadata: {
          userId: String(me.id ?? ''),
          username: String(me.username ?? ''),
        },
      };
    }
    if (isBridgeManagedConnectorId(connectorId)) {
      const baseUrl = normalizeToken(config.bridgeUrl)
        || (connectorId === 'line' || connectorId === 'whatsapp' || connectorId === 'signal' || connectorId === 'bluebubbles' || connectorId === 'imessage' || connectorId === 'nextcloud-talk' || connectorId === 'nostr' || connectorId === 'tlon' || connectorId === 'zalo' || connectorId === 'zalouser' ? getConnectorBridgeRuntimeBaseUrl() : '');
      if (!baseUrl) {
        return {
          connectorId,
          instanceId: config.instanceId,
          runtimeKey,
          ok: false,
          detail: 'Bridge URL is required for this connector.',
        };
      }
      const healthEndpoint = getBridgeEndpoint(config, 'health_endpoint', '/connector/v1/health');
      const result = await bridgeRuntimeApi(baseUrl, secret, 'GET', healthEndpoint, {
        query: {
          connector: connectorId,
          accountId: resolveRuntimeAccountId(connectorId, config, connectorId),
        },
      });
      return {
        connectorId,
        instanceId: config.instanceId,
        runtimeKey,
        ok: true,
        detail: 'Connected to bridge runtime API.',
        metadata: {
          connector: connectorId,
          status: String(result.status ?? 'ok'),
        },
      };
    }
    const me = await googleChatApi(secret, 'GET', '/users/me');
    return {
      connectorId,
      instanceId: config.instanceId,
      runtimeKey,
      ok: true,
      detail: 'Connected to Google Chat API.',
      metadata: {
        user: String(me.name ?? ''),
      },
    };
  } catch (error) {
    return {
      connectorId,
      instanceId: config.instanceId,
      runtimeKey,
      ok: false,
      detail: error instanceof Error ? error.message : 'Connection test failed.',
    };
  }
}

export async function discoverGatewayConnectorRuntimeTargets(
  connectorId: GatewayConnectorExtensionId,
  instanceId?: string
): Promise<GatewayConnectorRuntimeDiscoveryItem[]> {
  if (!isManagedConnectorId(connectorId)) return [];
  const config = resolveGatewayConnectorExtensionConfig({
    id: connectorId,
    instanceId,
    enabledOnly: false,
  });
  const secret = await getConnectorSecretForInstance(connectorId, config.instanceId);
  if (!secret || !config.enabled) return [];
  if (connectorId === 'discord' || connectorId === 'telegram') {
    return [];
  }

  if (connectorId === 'slack') {
    const items: GatewayConnectorRuntimeDiscoveryItem[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i += 1) {
      const data = await slackApi(secret, 'conversations.list', {
        query: {
          types: 'public_channel,private_channel,mpim,im',
          limit: '200',
          cursor,
        },
      });
      const channels = Array.isArray(data.channels) ? data.channels as Array<Record<string, any>> : [];
      for (const channel of channels) {
        const id = String(channel.id ?? '').trim();
        if (!id) continue;
        const name = String(channel.name ?? channel.user ?? id);
        const isIm = Boolean(channel.is_im);
        const isMpim = Boolean(channel.is_mpim);
        items.push({
          id,
          name,
          kind: isIm ? 'dm' : isMpim ? 'group' : 'channel',
          metadata: {
            isMember: String(Boolean(channel.is_member)),
          },
        });
      }
      cursor = normalizeToken(String(data.response_metadata?.next_cursor ?? '')) || undefined;
      if (!cursor) break;
    }
    return items;
  }

  if (connectorId === 'matrix') {
    const baseUrl = normalizeToken(config.bridgeUrl) || 'https://matrix-client.matrix.org';
    const joined = await matrixApi(baseUrl, secret, 'GET', '/_matrix/client/v3/joined_rooms');
    const roomIds = Array.isArray(joined.joined_rooms) ? joined.joined_rooms as string[] : [];
    return roomIds.map((roomId) => ({
      id: roomId,
      name: roomId,
      kind: 'room',
    }));
  }

  if (connectorId === 'msteams') {
    const chats = await teamsApi(secret, 'GET', '/me/chats?$top=50');
    const values = Array.isArray(chats.value) ? chats.value as Array<Record<string, any>> : [];
    return values.map((chat) => ({
      id: String(chat.id ?? ''),
      name: String(chat.topic ?? chat.chatType ?? chat.id ?? ''),
      kind: 'chat' as const,
      metadata: {
        type: String(chat.chatType ?? ''),
      },
    })).filter((item) => Boolean(item.id));
  }

  if (connectorId === 'mattermost') {
    const baseUrl = normalizeToken(config.bridgeUrl);
    if (!baseUrl) return [];
    const channels = await mattermostApi(baseUrl, secret, 'GET', '/api/v4/users/me/channels');
    const list = Array.isArray(channels) ? channels as Array<Record<string, any>> : [];
    return list.map((channel) => ({
      id: String(channel.id ?? ''),
      name: String(channel.display_name ?? channel.name ?? channel.id ?? ''),
      kind: (channel.type === 'D' ? 'dm' : channel.type === 'G' ? 'group' : 'channel') as 'dm' | 'group' | 'channel',
      metadata: {
        teamId: String(channel.team_id ?? ''),
      },
    })).filter((item) => Boolean(item.id));
  }

  if (isBridgeManagedConnectorId(connectorId)) {
    const baseUrl = normalizeToken(config.bridgeUrl)
      || (connectorId === 'line' || connectorId === 'whatsapp' || connectorId === 'signal' || connectorId === 'bluebubbles' || connectorId === 'imessage' || connectorId === 'nextcloud-talk' || connectorId === 'nostr' || connectorId === 'tlon' || connectorId === 'zalo' || connectorId === 'zalouser' ? getConnectorBridgeRuntimeBaseUrl() : '');
    if (!baseUrl) return [];
    const discoverEndpoint = getBridgeEndpoint(config, 'discover_endpoint', '/connector/v1/targets');
    const response = await bridgeRuntimeApi(baseUrl, secret, 'GET', discoverEndpoint, {
      query: {
        connector: connectorId,
        accountId: resolveRuntimeAccountId(connectorId, config, connectorId),
      },
    });
    const targets = Array.isArray(response.targets) ? response.targets as Array<Record<string, any>> : [];
    return targets.map((target) => {
      const targetKindRaw = normalizeLower(String(target.kind ?? 'channel'));
      const kind: GatewayConnectorRuntimeDiscoveryItem['kind'] =
        targetKindRaw === 'dm'
          ? 'dm'
          : targetKindRaw === 'group'
            ? 'group'
            : targetKindRaw === 'room'
              ? 'room'
              : targetKindRaw === 'chat'
                ? 'chat'
                : targetKindRaw === 'space'
                  ? 'space'
                  : 'channel';
      return {
        id: String(target.id ?? ''),
        name: String(target.name ?? target.id ?? ''),
        kind,
        metadata: typeof target.metadata === 'object' && target.metadata
          ? Object.fromEntries(
              Object.entries(target.metadata as Record<string, unknown>)
                .map(([key, value]) => [key, String(value ?? '')] as const)
            )
          : undefined,
      };
    }).filter((item) => Boolean(item.id));
  }

  const spacesResp = await googleChatApi(secret, 'GET', '/spaces', { query: { pageSize: '100' } });
  const spaces = Array.isArray(spacesResp.spaces) ? spacesResp.spaces as Array<Record<string, any>> : [];
  return spaces.map((space) => ({
    id: String(space.name ?? ''),
    name: String(space.displayName ?? space.name ?? ''),
    kind: 'space' as const,
    metadata: {
      type: String(space.spaceType ?? ''),
    },
  })).filter((item) => Boolean(item.id));
}
