import { Bot, type Context, type BotError } from 'grammy';
import type { TelegramConnectorConfig, TelegramConnectorStatus } from '@accomplish/shared';
import { addTelegramDmAllowlistEntry, getTelegramConfig } from '../store/telegramConfig';
import { getTelegramToken } from '../store/secureStorage';
import { startAgentEngineTask } from '../runtime/agent-engine';
import { getTask } from '../store/taskHistory';
import { resolveActiveAgentId } from './agent-context';
import { approveTelegramPairing, getOrCreateTelegramPairing } from '../store/telegramPairing';
import { resolveGatewayRoute } from './gateway-routing';
import { getGatewaySession } from '../store/gatewaySessions';
import { getGatewayConfig } from '../store/gatewayConfig';
import { resolveGatewayConnectorExtensionConfig } from '../store/gatewayConnectorExtensions';
import { recordGatewayConnectorObservation } from '../store/gatewayConnectorDiscovery';

const TELEGRAM_MESSAGE_LIMIT = 3900;
const DEFAULT_RUNTIME_KEY = 'default';

interface TelegramRuntimeState {
  bot: Bot | null;
  starting: boolean;
  status: TelegramConnectorStatus;
  config: TelegramConnectorConfig;
  accountId?: string;
}

const runtimeStates = new Map<string, TelegramRuntimeState>();

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

function normalizeText(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function normalizeRuntimeKey(value?: string): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || DEFAULT_RUNTIME_KEY;
}

function parseTelegramInstanceIdFromRuntimeKey(runtimeKey: string): string | undefined {
  const normalized = normalizeRuntimeKey(runtimeKey);
  if (!normalized || normalized === DEFAULT_RUNTIME_KEY || normalized === 'telegram') {
    return undefined;
  }
  if (normalized.startsWith('telegram::')) {
    const rawInstanceId = normalized.slice('telegram::'.length).trim();
    return rawInstanceId || undefined;
  }
  return undefined;
}

function getRuntimeState(runtimeKey: string): TelegramRuntimeState {
  const key = normalizeRuntimeKey(runtimeKey);
  const existing = runtimeStates.get(key);
  if (existing) return existing;
  const created: TelegramRuntimeState = {
    bot: null,
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
  patch: Partial<TelegramConnectorStatus>
): TelegramConnectorStatus {
  const state = getRuntimeState(runtimeKey);
  state.status = { ...state.status, ...patch };
  return state.status;
}

function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
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

function formatPrompt(ctx: Context, content: string): string {
  const chat = ctx.chat;
  const from = ctx.from;
  const chatLabel = chat ? `${chat.type}:${chat.id}` : 'unknown';
  const authorLabel = from ? `${from.first_name ?? 'User'} (${from.id})` : 'unknown';
  return `[Telegram ${chatLabel}] From ${authorLabel}\n\n${content}`;
}

function pickTelegramResponseText(resultStatus: string, taskId: string, agentId: string): string {
  const stored = getTask(taskId, agentId);
  const lastAssistant = stored?.messages
    ?.slice()
    .reverse()
    .find((msg) => msg.type === 'assistant');

  if (lastAssistant?.content) {
    return lastAssistant.content;
  }

  if (stored?.summary) {
    return stored.summary;
  }

  if (resultStatus === 'error') {
    return 'I hit an error while running that task. Check Open Deskmate for details.';
  }

  return 'Task completed.';
}

function resolveDmPolicy(config: TelegramConnectorConfig): 'pairing' | 'open' | 'disabled' {
  if (config.allowDms === false) {
    return 'disabled';
  }
  return config.dmPolicy ?? 'pairing';
}

function isDmAllowed(config: TelegramConnectorConfig, userId: string): boolean {
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
    `Your Telegram user id: ${userId}`,
    'Reply with this code to pair.',
  ].join('\n');
}

async function handleDmPairing(ctx: Context, userId: string): Promise<boolean> {
  const content = (ctx.message as { text?: string })?.text?.trim() ?? '';
  if (!content) {
    return false;
  }

  const approved = approveTelegramPairing(userId, content);
  if (approved) {
    addTelegramDmAllowlistEntry(userId);
    try {
      await ctx.reply('Pairing complete. You can now send tasks.');
    } catch {
      // ignore send errors
    }
    return true;
  }

  const { code, created } = getOrCreateTelegramPairing(userId);
  if (created && code) {
    try {
      await ctx.reply(buildPairingMessage(code, userId));
    } catch {
      // ignore send errors
    }
  }
  return true;
}

function isAllowedInGroup(config: TelegramConnectorConfig, chatId: number): boolean {
  if (config.channelAllowlist.length > 0) {
    return config.channelAllowlist.includes(String(chatId));
  }
  if (config.groupAllowlist.length > 0) {
    return config.groupAllowlist.includes(String(chatId));
  }
  return false;
}

function maybeRecordTelegramObservation(ctx: Context, runtimeKey: string, accountId: string): void {
  const gatewayConfig = getGatewayConfig();
  if (gatewayConfig.recordConnectorDiscovery === false) return;

  const instanceId = parseTelegramInstanceIdFromRuntimeKey(runtimeKey);
  const connectorConfig = resolveGatewayConnectorExtensionConfig({
    id: 'telegram',
    instanceId,
    enabledOnly: false,
  });
  if (connectorConfig.recordObservedIds === false) return;

  const chat = ctx.chat;
  const userId = ctx.from?.id ? String(ctx.from.id) : '';
  const chatId = chat?.id ? String(chat.id) : '';
  const isDm = chat?.type === 'private';
  const isChannel = chat?.type === 'channel';

  recordGatewayConnectorObservation({
    connectorId: 'telegram',
    instanceId: connectorConfig.instanceId,
    accountId,
    userId: isDm ? userId : undefined,
    groupId: !isDm && !isChannel ? chatId || undefined : undefined,
    channelId: isChannel ? chatId || undefined : undefined,
  });
}

async function handleTelegramMessage(
  ctx: Context,
  runtimeKey: string
): Promise<void> {
  const message = ctx.message as { text?: string } | undefined;
  if (!message?.text) return;
  if (ctx.from?.is_bot) return;

  const state = getRuntimeState(runtimeKey);
  const config = state.config;
  if (!config.enabled) return;

  const chat = ctx.chat;
  const isDm = chat?.type === 'private';
  const userId = ctx.from?.id ? String(ctx.from.id) : '';

  if (isDm) {
    if (!isDmAllowed(config, userId)) {
      const policy = resolveDmPolicy(config);
      if (policy === 'pairing') {
        await handleDmPairing(ctx, userId);
      }
      return;
    }
  } else {
    if (!chat || !isAllowedInGroup(config, chat.id)) {
      return;
    }
  }

  const prefix = config.commandPrefix?.trim() ?? '';
  let content = message.text.trim();

  let hasPrefix = false;
  if (prefix && content.toLowerCase().startsWith(prefix.toLowerCase())) {
    hasPrefix = true;
    content = content.slice(prefix.length).trim();
  }

  if (!isDm && config.requireMention && !hasPrefix) {
    return;
  }

  if (!content) {
    return;
  }

  const routePeerKind = isDm
    ? 'dm'
    : chat?.type === 'channel'
      ? 'channel'
      : 'group';
  const routePeerId = isDm ? userId : String(chat?.id ?? userId);
  const routeAccountId = state.accountId || String(ctx.me?.id ?? 'telegram');
  maybeRecordTelegramObservation(ctx, runtimeKey, routeAccountId);
  const route = resolveGatewayRoute({
    channel: 'telegram',
    accountId: routeAccountId,
    peer: { kind: routePeerKind, id: routePeerId },
    teamId: chat?.type === 'channel' ? String(chat.id) : undefined,
    agentIdOverride: config.agentId || resolveActiveAgentId(),
  });
  const existingGatewaySession = getGatewaySession(route.sessionKey);
  const agentId = route.agentId;
  const taskId = `telegram_${runtimeKey}_${chat?.id ?? 'dm'}_${Date.now()}`;

  try {
    await ctx.replyWithChatAction('typing');
  } catch {
    // ignore
  }

  try {
    const prompt = formatPrompt(ctx, content);
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
          peerKind: routePeerKind,
          peerId: routePeerId,
        },
      }
    );
    const result = await completion;
    const responseText = pickTelegramResponseText(result.status, taskId, agentId);
    const chunks = splitTelegramMessage(responseText);
    for (const chunk of chunks) {
      await ctx.reply(chunk || 'Task completed.');
    }
  } catch (error) {
    const fallback = error instanceof Error ? error.message : 'Unknown error';
    const errorText = `Sorry — I couldn't run that task (${fallback}).`;
    try {
      await ctx.reply(errorText);
    } catch {
      // ignore
    }
  }
}

export async function startTelegramConnector(options?: {
  runtimeKey?: string;
  config?: TelegramConnectorConfig;
  token?: string;
  accountId?: string;
}): Promise<TelegramConnectorStatus> {
  const runtimeKey = normalizeRuntimeKey(options?.runtimeKey);
  const state = getRuntimeState(runtimeKey);
  if (state.starting) return state.status;
  state.starting = true;
  try {
    const config = options?.config ?? (runtimeKey === DEFAULT_RUNTIME_KEY ? getTelegramConfig() : state.config);
    const token = options?.token ?? (runtimeKey === DEFAULT_RUNTIME_KEY ? await getTelegramToken() : '');
    state.config = { ...DEFAULT_CONFIG, ...config };
    setRuntimeStatus(runtimeKey, {
      configured: Boolean(token),
      running: false,
      botUser: undefined,
      lastError: undefined,
    });

    if (state.bot) {
      try {
        state.bot.stop();
      } catch {
        // ignore
      }
      state.bot = null;
    }

    if (!state.config.enabled || !token) {
      return state.status;
    }

    const bot = new Bot(token);
    state.bot = bot;

    bot.catch((err: BotError) => {
      setRuntimeStatus(runtimeKey, {
        running: false,
        lastError: err.message || 'Telegram bot error',
      });
    });

    bot.on('message:text', (ctx) => {
      void handleTelegramMessage(ctx, runtimeKey);
    });

    const me = await bot.api.getMe();
    state.accountId = normalizeText(options?.accountId) || String(me.id);
    setRuntimeStatus(runtimeKey, {
      running: true,
      botUser: {
        id: String(me.id),
        username: me.username,
        firstName: me.first_name,
      },
      lastStartAt: new Date().toISOString(),
      lastError: undefined,
    });

    bot.start();
    return state.status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setRuntimeStatus(runtimeKey, {
      running: false,
      lastError: message,
    });
    if (state.bot) {
      try {
        state.bot.stop();
      } catch {
        // ignore
      }
      state.bot = null;
    }
    return state.status;
  } finally {
    state.starting = false;
  }
}

export async function stopTelegramConnector(options?: { runtimeKey?: string }): Promise<void> {
  const runtimeKey = normalizeRuntimeKey(options?.runtimeKey);
  const state = getRuntimeState(runtimeKey);
  if (state.bot) {
    try {
      state.bot.stop();
    } catch {
      // ignore
    }
    state.bot = null;
  }
  setRuntimeStatus(runtimeKey, { running: false });
}

export async function restartTelegramConnector(options?: {
  runtimeKey?: string;
  config?: TelegramConnectorConfig;
  token?: string;
  accountId?: string;
}): Promise<TelegramConnectorStatus> {
  await stopTelegramConnector({ runtimeKey: options?.runtimeKey });
  return startTelegramConnector(options);
}

export async function getTelegramTokenSet(options?: { token?: string }): Promise<boolean> {
  if (options?.token !== undefined) {
    return Boolean(options.token);
  }
  const token = await getTelegramToken();
  return Boolean(token);
}

export function getTelegramStatus(runtimeKey?: string): TelegramConnectorStatus {
  const key = normalizeRuntimeKey(runtimeKey);
  return getRuntimeState(key).status;
}

export async function sendTelegramOutboundMessage(params: {
  targetId: string;
  text: string;
  token?: string;
}): Promise<void> {
  const token = params.token ?? await getTelegramToken();
  if (!token) {
    throw new Error('Telegram bot token is not set.');
  }
  const chatId = normalizeText(params.targetId);
  if (!chatId) {
    throw new Error('Telegram targetId is required.');
  }
  const text = normalizeText(params.text);
  if (!text) {
    throw new Error('Telegram text is required.');
  }

  const chunks = splitTelegramMessage(text, TELEGRAM_MESSAGE_LIMIT);
  for (const chunk of chunks) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk || ' ',
      }),
    });
    const payload = await response.json().catch(() => ({} as { description?: string; ok?: boolean }));
    if (!response.ok || payload?.ok === false) {
      const detail = payload?.description || response.statusText || 'Telegram send failed';
      throw new Error(detail);
    }
  }
}
