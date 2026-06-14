import { ChannelType, Client, GatewayIntentBits, Partials, type Message } from 'discord.js';
import type { DiscordConnectorConfig, DiscordConnectorStatus } from '@accomplish/shared';
import { addDiscordDmAllowlistEntry, getDiscordConfig } from '../store/discordConfig';
import { getDiscordToken } from '../store/secureStorage';
import { startAgentEngineTask } from '../runtime/agent-engine';
import { getTask } from '../store/taskHistory';
import { resolveActiveAgentId } from './agent-context';
import { approveDiscordPairing, getOrCreateDiscordPairing } from '../store/discordPairing';
import { resolveGatewayRoute } from './gateway-routing';
import { getGatewaySession } from '../store/gatewaySessions';
import { stripReasoningForExternalReply } from '../runtime/task-message-reasoning';

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
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let sliceIndex = remaining.lastIndexOf('\n', limit);
    if (sliceIndex < limit * 0.6) {
      sliceIndex = remaining.lastIndexOf(' ', limit);
    }
    if (sliceIndex <= 0) {
      sliceIndex = limit;
    }
    chunks.push(remaining.slice(0, sliceIndex).trim());
    remaining = remaining.slice(sliceIndex).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.length > 0 ? chunks : [''];
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
    const publicContent = stripReasoningForExternalReply(lastAssistant.content);
    if (publicContent) {
      return publicContent;
    }
  }

  if (stored?.summary) {
    const publicSummary = stripReasoningForExternalReply(stored.summary);
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
    const chunks = splitDiscordMessage(responseText);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      if (isDm) {
        await sendToChannel(chunk || 'Task completed.');
      } else if (i === 0) {
        await message.reply({ content: chunk || 'Task completed.', allowedMentions: { repliedUser: false } });
      } else {
        await sendToChannel(chunk);
      }
    }
  } catch (error) {
    const fallback = error instanceof Error ? error.message : 'Unknown error';
    const errorText = `Sorry — I couldn't run that task (${fallback}).`;
    try {
      if (isDm) {
        await sendToChannel(errorText);
      } else {
        await message.reply({ content: errorText, allowedMentions: { repliedUser: false } });
      }
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

export async function sendDiscordOutboundMessage(params: {
  targetId: string;
  targetKind?: 'dm' | 'group' | 'channel';
  text: string;
  token?: string;
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

  const chunks = splitDiscordMessage(text, DISCORD_MESSAGE_LIMIT);
  const targetKind = params.targetKind ?? 'channel';
  let channelId = targetId;
  if (targetKind === 'dm') {
    const dmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: targetId }),
    });
    const dmPayload = await dmResponse.json().catch(() => ({} as { id?: string; message?: string }));
    if (!dmResponse.ok || !dmPayload?.id) {
      throw new Error(dmPayload?.message || dmResponse.statusText || 'Failed to open Discord DM channel.');
    }
    channelId = normalizeText(dmPayload.id);
  }

  for (const chunk of chunks) {
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: chunk || ' ',
      }),
    });
    const payload = await response.json().catch(() => ({} as { message?: string }));
    if (!response.ok) {
      throw new Error(payload?.message || response.statusText || 'Discord send failed');
    }
  }
}
