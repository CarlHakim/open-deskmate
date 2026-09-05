import { readFile } from 'fs/promises';
import { ChannelType, Client, GatewayIntentBits, Partials, type Message } from 'discord.js';
import type {
  ConnectorDeliveryAttachmentRecord,
  DiscordConnectorConfig,
  DiscordConnectorStatus,
} from '@accomplish/shared';
import { addDiscordDmAllowlistEntry, getDiscordConfig } from '../store/discordConfig';
import { getDiscordToken } from '../store/secureStorage';
import { startAgentEngineTask } from '../runtime/agent-engine';
import { getTask } from '../store/taskHistory';
import { resolveActiveAgentId } from './agent-context';
import { approveDiscordPairing, getOrCreateDiscordPairing } from '../store/discordPairing';
import { resolveGatewayRoute } from './gateway-routing';
import { getGatewaySession } from '../store/gatewaySessions';
import { stripReasoningForExternalReply } from '../runtime/task-message-reasoning';
import {
  createConnectorDelivery,
  filterConnectorDeliveryText,
  markConnectorDeliveryAttachmentFallback,
  markConnectorDeliveryAttachmentSent,
  markConnectorDeliveryFailed,
  sendConnectorDeliveryChunks,
  splitConnectorMessage,
} from './connector-delivery';

const DISCORD_MESSAGE_LIMIT = 1900;
const DEFAULT_RUNTIME_KEY = 'default';

interface DiscordRuntimeState {
  client: Client | null;
  starting: boolean;
  status: DiscordConnectorStatus;
  config: DiscordConnectorConfig;
  accountId?: string;
}

const runtimeStates = new Map<string, DiscordRuntimeState>();

const DEFAULT_CONFIG: DiscordConnectorConfig = {
  enabled: false,
  allowDms: false,
  dmPolicy: 'pairing',
  requireMention: true,
  commandPrefix: '!desk',
  dmAllowlist: [],
  channelAllowlist: [],
  guildAllowlist: [],
  agentId: undefined,
};

function normalizeText(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function normalizeRuntimeKey(value?: string): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || DEFAULT_RUNTIME_KEY;
}

function parseDiscordInstanceIdFromRuntimeKey(runtimeKey: string): string | undefined {
  const normalized = normalizeRuntimeKey(runtimeKey);
  if (!normalized || normalized === DEFAULT_RUNTIME_KEY || normalized === 'discord') {
    return undefined;
  }
  if (normalized.startsWith('discord::')) {
    const rawInstanceId = normalized.slice('discord::'.length).trim();
    return rawInstanceId || undefined;
  }
  return undefined;
}

function getRuntimeState(runtimeKey: string): DiscordRuntimeState {
  const key = normalizeRuntimeKey(runtimeKey);
  const existing = runtimeStates.get(key);
  if (existing) return existing;
  const created: DiscordRuntimeState = {
    client: null,
    starting: false,
    status: {
      configured: false,
      running: false,
    },
    config: { ...DEFAULT_CONFIG },
    accountId: undefined,
  };
  runtimeStates.set(key, created);
  return created;
}

function setRuntimeStatus(
  runtimeKey: string,
  patch: Partial<DiscordConnectorStatus>
): DiscordConnectorStatus {
  const state = getRuntimeState(runtimeKey);
  state.status = { ...state.status, ...patch };
  return state.status;
}

function splitDiscordMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  return splitConnectorMessage(text, limit);
}

function filterPublicReplyText(text: string): string {
  const filtered = filterConnectorDeliveryText(stripReasoningForExternalReply(text));
  return filtered.silenced ? '' : filtered.text;
}

function formatPrompt(message: Message, content: string): string {
  const isDm = message.channel.type === ChannelType.DM || !message.guild;
  let channelLabel = 'DM';
  if (!isDm) {
    const channel = message.channel;
    const channelName = 'name' in channel && typeof channel.name === 'string' ? channel.name : String(channel.id);
    channelLabel = `${message.guild?.name ?? 'Unknown'}#${channelName}`;
  }
  const authorLabel = `${message.author.username} (${message.author.id})`;
  return `[Discord ${channelLabel}] From ${authorLabel}\n\n${content}`;
}

function pickDiscordResponseText(resultStatus: string, taskId: string, agentId: string): string {
  const stored = getTask(taskId, agentId);
  const lastAssistant = stored?.messages
    ?.slice()
    .reverse()
    .find((msg) => msg.type === 'assistant');

  if (lastAssistant?.content) {
    const publicContent = filterPublicReplyText(lastAssistant.content);
    if (publicContent) {
      return publicContent;
    }
  }

  if (stored?.summary) {
    const publicSummary = filterPublicReplyText(stored.summary);
    if (publicSummary) {
      return publicSummary;
    }
  }

  if (resultStatus === 'error') {
    return 'I hit an error while running that task. Check Open Deskmate for details.';
  }

  return 'Task completed.';
}

function resolveDmPolicy(config: DiscordConnectorConfig): 'pairing' | 'open' | 'disabled' {
  if (config.allowDms === false) {
    return 'disabled';
  }
  return config.dmPolicy ?? 'pairing';
}

function isDmAllowed(config: DiscordConnectorConfig, userId: string): boolean {
  const allowlist = config.dmAllowlist ?? [];
  const policy = resolveDmPolicy(config);
  if (policy === 'disabled') {
    return false;
  }
  if (policy === 'open') {
    if (allowlist.length === 0) return true;
    return allowlist.includes(userId);
  }
  return allowlist.includes(userId);
}

function buildPairingMessage(code: string, userId: string): string {
  return [
    `Open Deskmate pairing code: ${code}`,
    `Your Discord user id: ${userId}`,
    'Reply with this code to pair.',
  ].join('\n');
}

async function handleDmPairing(message: Message, userId: string): Promise<boolean> {
  const content = message.content?.trim() ?? '';
  if (!content) {
    return false;
  }

  const approved = approveDiscordPairing(userId, content);
  if (approved) {
    addDiscordDmAllowlistEntry(userId);
    try {
      if ('send' in message.channel) {
        await (message.channel as { send: (opts: { content: string }) => Promise<unknown> }).send({
          content: 'Pairing complete. You can now send tasks.',
        });
      }
    } catch {
      // ignore send errors
    }
    return true;
  }

  const { code, created } = getOrCreateDiscordPairing(userId);
  if (created && code) {
    try {
      if ('send' in message.channel) {
        await (message.channel as { send: (opts: { content: string }) => Promise<unknown> }).send({
          content: buildPairingMessage(code, userId),
        });
      }
    } catch {
      // ignore send errors
    }
  }
  return true;
}

function isAllowedInGuild(config: DiscordConnectorConfig, message: Message): boolean {
  if (config.channelAllowlist.length > 0) {
    return config.channelAllowlist.includes(message.channelId);
  }
  if (config.guildAllowlist.length > 0) {
    return !!message.guildId && config.guildAllowlist.includes(message.guildId);
  }
  return false;
}

async function handleDiscordMessage(message: Message, runtimeKey: string): Promise<void> {
  if (message.author.bot) return;

  const state = getRuntimeState(runtimeKey);
  const config = state.config;
  if (!config.enabled) return;

  const isDm = message.channel.type === ChannelType.DM || !message.guild;
  if (isDm) {
    if (!isDmAllowed(config, message.author.id)) {
      const policy = resolveDmPolicy(config);
      if (policy === 'pairing') {
        await handleDmPairing(message, message.author.id);
      }
      return;
    }
  } else {
    if (!isAllowedInGuild(config, message)) {
      return;
    }
  }

  const prefix = config.commandPrefix?.trim() ?? '';
  let content = message.content?.trim() ?? '';
  const mentionId = message.client.user?.id;
  let hasMention = false;
  if (mentionId) {
    const mentionRegex = new RegExp(`<@!?${mentionId}>`, 'g');
    if (mentionRegex.test(content)) {
      hasMention = true;
      content = content.replace(mentionRegex, '').trim();
    }
  }

  let hasPrefix = false;
  if (prefix && content.toLowerCase().startsWith(prefix.toLowerCase())) {
    hasPrefix = true;
    content = content.slice(prefix.length).trim();
  }

  if (!isDm && config.requireMention && !hasMention && !hasPrefix) {
    return;
  }

  if (!content) {
    return;
  }

  const routePeer = isDm
    ? { kind: 'dm' as const, id: message.author.id }
    : { kind: 'channel' as const, id: message.channelId };
  const route = resolveGatewayRoute({
    channel: 'discord',
    accountId: state.accountId || message.client.user?.id || 'discord',
    peer: routePeer,
    guildId: message.guildId,
    agentIdOverride: config.agentId || resolveActiveAgentId(),
  });
  const existingGatewaySession = getGatewaySession(route.sessionKey);
  const agentId = route.agentId;
  const taskId = `discord_${runtimeKey}_${message.id}`;

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }
  } catch {
    // Ignore typing errors
  }

  const sendToChannel = async (text: string) => {
    if ('send' in message.channel) {
      await (message.channel as { send: (opts: { content: string }) => Promise<unknown> }).send({ content: text });
    }
  };
  const deliverReply = async (text: string) => {
    const delivery = createConnectorDelivery({
      connectorId: 'discord',
      connectorInstanceId: parseDiscordInstanceIdFromRuntimeKey(runtimeKey),
      accountId: route.accountId,
      targetId: routePeer.id,
      targetKind: routePeer.kind,
      direction: 'reply',
      text,
      splitLimit: DISCORD_MESSAGE_LIMIT,
      taskId,
      threadId: route.sessionKey,
      metadata: {
        runtimeKey,
      },
    });
    if (delivery.silenced) return;
    await sendConnectorDeliveryChunks(delivery.record.id, delivery.chunks, async (chunk, index) => {
      try {
        if ('sendTyping' in message.channel) {
          await message.channel.sendTyping();
        }
      } catch {
        // Ignore typing errors
      }
      if (isDm) {
        await sendToChannel(chunk || 'Task completed.');
      } else if (index === 0) {
        await message.reply({ content: chunk || 'Task completed.', allowedMentions: { repliedUser: false } });
      } else {
        await sendToChannel(chunk || ' ');
      }
    });
  };
  try {
    const prompt = formatPrompt(message, content);
    const { completion } = await startAgentEngineTask(
      {
        prompt,
        taskId,
        agentId,
        sessionId: existingGatewaySession?.sessionId,
      },
      {
        source: 'gateway',
        sessionKey: route.sessionKey,
        route: {
          channel: route.channel,
          accountId: route.accountId,
          peerKind: routePeer.kind,
          peerId: routePeer.id,
        },
      }
    );
    const result = await completion;
    const responseText = pickDiscordResponseText(result.status, taskId, agentId);
    await deliverReply(responseText || 'Task completed.');
  } catch (error) {
    const fallback = error instanceof Error ? error.message : 'Unknown error';
    const errorText = `Sorry — I couldn't run that task (${fallback}).`;
    try {
      await deliverReply(errorText);
    } catch {
      // Ignore follow-up errors
    }
  }
}

export async function startDiscordConnector(options?: {
  runtimeKey?: string;
  config?: DiscordConnectorConfig;
  token?: string;
  accountId?: string;
}): Promise<DiscordConnectorStatus> {
  const runtimeKey = normalizeRuntimeKey(options?.runtimeKey);
  const state = getRuntimeState(runtimeKey);
  if (state.starting) return state.status;
  state.starting = true;
  try {
    const config = options?.config ?? (runtimeKey === DEFAULT_RUNTIME_KEY ? getDiscordConfig() : state.config);
    const token = options?.token ?? (runtimeKey === DEFAULT_RUNTIME_KEY ? await getDiscordToken() : '');
    state.config = { ...DEFAULT_CONFIG, ...config };
    setRuntimeStatus(runtimeKey, {
      configured: Boolean(token),
      running: false,
      botUser: undefined,
      lastError: undefined,
    });

    if (state.client) {
      try {
        await state.client.destroy();
      } catch {
        // ignore
      }
      state.client = null;
    }

    if (!state.config.enabled || !token) {
      return state.status;
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
    state.client = client;

    client.on('ready', () => {
      state.accountId = normalizeText(options?.accountId) || client.user?.id || 'discord';
      setRuntimeStatus(runtimeKey, {
        running: true,
        botUser: client.user
          ? {
              id: client.user.id,
              tag: client.user.tag,
              username: client.user.username,
            }
          : undefined,
        lastStartAt: new Date().toISOString(),
        lastError: undefined,
      });
    });

    client.on('error', (err) => {
      setRuntimeStatus(runtimeKey, {
        running: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
    });

    client.on('messageCreate', (message) => {
      void handleDiscordMessage(message, runtimeKey);
    });

    await client.login(token);
    return state.status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setRuntimeStatus(runtimeKey, {
      running: false,
      lastError: message,
    });
    if (state.client) {
      try {
        await state.client.destroy();
      } catch {
        // ignore
      }
      state.client = null;
    }
    return state.status;
  } finally {
    state.starting = false;
  }
}

export async function stopDiscordConnector(options?: { runtimeKey?: string }): Promise<void> {
  const runtimeKey = normalizeRuntimeKey(options?.runtimeKey);
  const state = getRuntimeState(runtimeKey);
  if (state.client) {
    try {
      await state.client.destroy();
    } catch {
      // ignore
    }
    state.client = null;
  }
  setRuntimeStatus(runtimeKey, { running: false });
}

export async function restartDiscordConnector(options?: {
  runtimeKey?: string;
  config?: DiscordConnectorConfig;
  token?: string;
  accountId?: string;
}): Promise<DiscordConnectorStatus> {
  await stopDiscordConnector({ runtimeKey: options?.runtimeKey });
  return startDiscordConnector(options);
}

export async function getDiscordTokenSet(options?: { token?: string }): Promise<boolean> {
  if (options?.token !== undefined) {
    return Boolean(options.token);
  }
  const token = await getDiscordToken();
  return Boolean(token);
}

export function getDiscordStatus(runtimeKey?: string): DiscordConnectorStatus {
  const key = normalizeRuntimeKey(runtimeKey);
  return getRuntimeState(key).status;
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  return {
    mimeType: match[1] || 'application/octet-stream',
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  };
}

async function discordJsonApi(
  token: string,
  method: 'POST' | 'GET',
  endpoint: string,
  body?: Record<string, unknown>
): Promise<Record<string, any>> {
  const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({} as { message?: string }));
  if (!response.ok) {
    throw new Error(payload?.message || response.statusText || `Discord ${endpoint} failed`);
  }
  return payload as Record<string, any>;
}

async function discordFormApi(
  token: string,
  endpoint: string,
  form: FormData
): Promise<Record<string, any>> {
  const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({} as { message?: string }));
  if (!response.ok) {
    throw new Error(payload?.message || response.statusText || `Discord ${endpoint} failed`);
  }
  return payload as Record<string, any>;
}

async function openDiscordDmChannel(token: string, targetId: string): Promise<string> {
  const payload = await discordJsonApi(token, 'POST', '/users/@me/channels', {
    recipient_id: targetId,
  });
  const channelId = normalizeText(String(payload.id ?? ''));
  if (!channelId) {
    throw new Error('Failed to open Discord DM channel.');
  }
  return channelId;
}

async function sendDiscordTyping(token: string, channelId: string): Promise<void> {
  try {
    await discordJsonApi(token, 'POST', `/channels/${encodeURIComponent(channelId)}/typing`);
  } catch {
    // Typing indicators are best-effort.
  }
}

async function sendDiscordText(token: string, channelId: string, content: string): Promise<void> {
  await discordJsonApi(token, 'POST', `/channels/${encodeURIComponent(channelId)}/messages`, {
    content: content || ' ',
  });
}

async function sendDiscordAttachment(
  token: string,
  channelId: string,
  attachment: ConnectorDeliveryAttachmentRecord
): Promise<void> {
  if (attachment.source === 'url') {
    throw new Error('Discord URL attachment upload is not supported.');
  }

  const fileName = attachment.name || (attachment.kind === 'image' ? 'image.png' : 'attachment');
  let mimeType = attachment.mimeType || (attachment.kind === 'image' ? 'image/png' : 'application/octet-stream');
  let buffer: Buffer;
  if (attachment.source === 'data-url' && attachment.dataUrl) {
    const parsed = parseDataUrl(attachment.dataUrl);
    if (!parsed) throw new Error('Invalid attachment data URL.');
    mimeType = attachment.mimeType || parsed.mimeType;
    buffer = parsed.buffer;
  } else if (attachment.source === 'path' && attachment.path) {
    buffer = await readFile(attachment.path);
  } else {
    throw new Error('Attachment source is missing.');
  }

  const form = new FormData();
  const payload = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  form.append('payload_json', JSON.stringify({ content: '' }));
  form.append('files[0]', new Blob([payload], { type: mimeType }), fileName);
  await discordFormApi(token, `/channels/${encodeURIComponent(channelId)}/messages`, form);
}

export async function sendDiscordOutboundMessage(params: {
  targetId: string;
  targetKind?: 'dm' | 'group' | 'channel';
  text: string;
  token?: string;
  chunks?: string[];
  attachments?: ConnectorDeliveryAttachmentRecord[];
  deliveryId?: string;
  connectorInstanceId?: string;
  accountId?: string;
  taskId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
}): Promise<void> {
  const token = params.token ?? await getDiscordToken();
  if (!token) {
    throw new Error('Discord bot token is not set.');
  }
  const targetId = normalizeText(params.targetId);
  if (!targetId) {
    throw new Error('Discord targetId is required.');
  }
  const text = normalizeText(params.text);
  if (!text) {
    throw new Error('Discord text is required.');
  }

  const targetKind = params.targetKind ?? 'channel';
  const prepared = params.deliveryId
    ? {
        record: { id: params.deliveryId },
        chunks: params.chunks ?? splitDiscordMessage(text, DISCORD_MESSAGE_LIMIT),
        attachments: params.attachments ?? [],
        silenced: false,
      }
    : createConnectorDelivery({
        connectorId: 'discord',
        connectorInstanceId: params.connectorInstanceId,
        accountId: params.accountId,
        targetId,
        targetKind,
        text,
        splitLimit: DISCORD_MESSAGE_LIMIT,
        taskId: params.taskId,
        threadId: params.threadId,
        metadata: params.metadata,
      });
  if (prepared.silenced) {
    return;
  }

  let channelId = targetId;
  if (targetKind === 'dm') {
    try {
      channelId = await openDiscordDmChannel(token, targetId);
    } catch (error) {
      markConnectorDeliveryFailed(prepared.record.id, error);
      throw error;
    }
  }

  await sendConnectorDeliveryChunks(prepared.record.id, prepared.chunks, async (chunk) => {
    await sendDiscordTyping(token, channelId);
    await sendDiscordText(token, channelId, chunk || ' ');
  }, {
    afterChunks: async () => {
      for (const attachment of prepared.attachments ?? []) {
        if (attachment.status === 'skipped') continue;
        try {
          await sendDiscordTyping(token, channelId);
          await sendDiscordAttachment(token, channelId, attachment);
          markConnectorDeliveryAttachmentSent(prepared.record.id, attachment.id);
        } catch (error) {
          markConnectorDeliveryAttachmentFallback(prepared.record.id, attachment.id, error);
          await sendDiscordText(token, channelId, attachment.fallbackText || 'Attachment could not be uploaded.');
        }
      }
    },
  });
}
