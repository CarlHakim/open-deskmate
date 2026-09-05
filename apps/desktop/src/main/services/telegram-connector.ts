import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import type { Bot, Context, BotError } from 'grammy';
import type {
  ConnectorDeliveryMediaOutcome,
  ConnectorDeliveryParseMode,
  ConnectorDeliveryAttachmentRecord,
  TelegramConnectorConfig,
  TelegramConnectorStatus,
} from '@accomplish/shared';
import { addTelegramDmAllowlistEntry, getTelegramConfig } from '../store/telegramConfig';
import { getTelegramToken } from '../store/secureStorage';
import { hasActiveAgentEngineTask, isAgentEngineTaskQueued, startAgentEngineTask } from '../runtime/agent-engine';
import { getTask } from '../store/taskHistory';
import { resolveActiveAgentId } from './agent-context';
import { approveTelegramPairing, getOrCreateTelegramPairing } from '../store/telegramPairing';
import { resolveGatewayRoute } from './gateway-routing';
import { getGatewaySession } from '../store/gatewaySessions';
import { getGatewayConfig } from '../store/gatewayConfig';
import { resolveGatewayConnectorExtensionConfig } from '../store/gatewayConnectorExtensions';
import { recordGatewayConnectorObservation } from '../store/gatewayConnectorDiscovery';
import { stripReasoningForExternalReply } from '../runtime/task-message-reasoning';
import {
  createConnectorDelivery,
  filterConnectorDeliveryText,
  formatTelegramConnectorMarkdown,
  markConnectorDeliveryAttachmentFallback,
  markConnectorDeliveryAttachmentSent,
  sendConnectorDeliveryChunks,
  splitConnectorMessage,
  updateConnectorDeliveryMetadata,
} from './connector-delivery';

const TELEGRAM_MESSAGE_LIMIT = 3900;
const DEFAULT_RUNTIME_KEY = 'default';
const IN_FLIGHT_ROUTE_STALE_MS = 60 * 60 * 1000;
const RECENT_TELEGRAM_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const require = createRequire(import.meta.url);

const inFlightTelegramMessages = new Set<string>();
const inFlightTelegramRoutes = new Map<string, { taskId: string; startedAt: number }>();
const recentlyHandledTelegramMessages = new Map<string, number>();

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
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
  return splitConnectorMessage(text, limit);
}

function filterPublicReplyText(text: string): string {
  const filtered = filterConnectorDeliveryText(stripReasoningForExternalReply(text));
  return filtered.silenced ? '' : filtered.text;
}

function normalizeReplyComparisonText(value: string): string {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isTelegramPromptEcho(replyText: string, promptText: string): boolean {
  const reply = normalizeReplyComparisonText(replyText);
  const prompt = normalizeReplyComparisonText(promptText);
  if (!reply || !prompt) return false;
  return reply === prompt || reply === `"${prompt}"` || reply === `'${prompt}'`;
}

function loadTelegramBotConstructor(): typeof import('grammy').Bot {
  return (require('grammy') as typeof import('grammy')).Bot;
}

function isTaskBusy(taskId: string | undefined | null): boolean {
  const normalized = normalizeText(taskId);
  return Boolean(normalized && (hasActiveAgentEngineTask(normalized) || isAgentEngineTaskQueued(normalized)));
}

function cleanupStaleTelegramRouteLocks(): void {
  const now = Date.now();
  for (const [key, value] of inFlightTelegramRoutes.entries()) {
    if (!isTaskBusy(value.taskId) || now - value.startedAt > IN_FLIGHT_ROUTE_STALE_MS) {
      inFlightTelegramRoutes.delete(key);
    }
  }
  for (const [key, timestamp] of recentlyHandledTelegramMessages.entries()) {
    if (now - timestamp > RECENT_TELEGRAM_MESSAGE_TTL_MS) {
      recentlyHandledTelegramMessages.delete(key);
    }
  }
}

function buildTelegramTaskId(params: {
  runtimeKey: string;
  chatId: string;
  messageId?: string;
  updateId?: string;
}): string {
  const seed = params.messageId || params.updateId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `telegram_${params.runtimeKey}_${params.chatId}_${seed}`;
}

function buildTelegramMessageKey(params: {
  runtimeKey: string;
  chatId: string;
  messageId?: string;
  updateId?: string;
}): string {
  return [
    normalizeRuntimeKey(params.runtimeKey),
    params.chatId,
    params.messageId || '',
    params.updateId || '',
  ].join(':');
}

function buildTelegramSystemPromptAppend(ctx: Context): string {
  const chat = ctx.chat;
  const from = ctx.from;
  const chatType = chat?.type ?? 'unknown';
  const authorName = [
    from?.first_name,
    from?.last_name,
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ');

  return [
    '<connector_context>',
    'Source: Telegram',
    `Chat type: ${chatType}`,
    authorName ? `Sender display name: ${authorName}` : undefined,
    'Reply directly to the user. Do not mention connector metadata, routing labels, chat IDs, user IDs, or bracketed source prefixes such as "[Telegram private:...]".',
    'Keep the reply suitable for Telegram.',
    '</connector_context>',
  ].filter(Boolean).join('\n');
}

function pickTelegramResponseText(resultStatus: string, taskId: string, promptText: string): string | null {
  const stored = getTask(taskId);
  const lastAssistant = stored?.messages
    ?.slice()
    .reverse()
    .find((msg) => msg.type === 'assistant');

  if (lastAssistant?.content) {
    const publicContent = filterPublicReplyText(lastAssistant.content);
    if (publicContent && !isTelegramPromptEcho(publicContent, promptText)) {
      return publicContent;
    }
  }

  if (resultStatus === 'error') {
    return 'I hit an error while running that task. Check Open Deskmate for details.';
  }
  if (resultStatus === 'interrupted') {
    return 'That task was interrupted before I could send a final reply.';
  }

  return null;
}

async function waitForTelegramResponseText(params: {
  resultStatus: string;
  taskId: string;
  promptText: string;
}): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = pickTelegramResponseText(params.resultStatus, params.taskId, params.promptText);
    if (response) return response;
    if (params.resultStatus !== 'success') break;
    await wait(250);
  }

  const stored = getTask(params.taskId);
  console.warn('[Telegram Connector] Completed task without a public assistant reply:', {
    taskId: params.taskId,
    status: stored?.status,
    messageCount: stored?.messages?.length ?? 0,
    messageTypes: stored?.messages?.map((message) => message.type).slice(-8),
  });
  return 'Task completed, but I could not find a final reply to send back. Check Open Deskmate for details.';
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
  const message = ctx.message as { text?: string; message_id?: number | string; date?: number } | undefined;
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
  const chatId = String(chat?.id ?? (userId || 'dm'));
  const messageId = message.message_id !== undefined ? String(message.message_id) : undefined;
  const updateId = typeof ctx.update?.update_id === 'number' ? String(ctx.update.update_id) : undefined;
  const messageKey = buildTelegramMessageKey({ runtimeKey, chatId, messageId, updateId });
  const taskId = buildTelegramTaskId({ runtimeKey, chatId, messageId, updateId });

  cleanupStaleTelegramRouteLocks();

  if (recentlyHandledTelegramMessages.has(messageKey)) {
    return;
  }

  if (inFlightTelegramMessages.has(messageKey)) {
    return;
  }

  const inFlightRoute = inFlightTelegramRoutes.get(route.sessionKey);
  const existingTaskId = existingGatewaySession?.taskId;
  const activeRouteTaskId = isTaskBusy(inFlightRoute?.taskId)
    ? inFlightRoute?.taskId
    : isTaskBusy(existingTaskId)
      ? existingTaskId
      : undefined;

  if (activeRouteTaskId && activeRouteTaskId !== taskId) {
    recentlyHandledTelegramMessages.set(messageKey, Date.now());
    try {
      await ctx.reply('I am still working on the previous Telegram task in this chat. I will reply here when it finishes.');
    } catch {
      // ignore
    }
    return;
  }

  inFlightTelegramMessages.add(messageKey);
  recentlyHandledTelegramMessages.set(messageKey, Date.now());
  inFlightTelegramRoutes.set(route.sessionKey, { taskId, startedAt: Date.now() });

  const deliverReply = async (text: string) => {
    const delivery = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: parseTelegramInstanceIdFromRuntimeKey(runtimeKey),
      accountId: routeAccountId,
      targetId: chatId,
      targetKind: routePeerKind,
      direction: 'reply',
      text,
      splitLimit: TELEGRAM_MESSAGE_LIMIT,
      taskId,
      threadId: route.sessionKey,
      metadata: {
        runtimeKey,
      },
    });
    if (delivery.silenced) return;
    recordTelegramDeliveryStartMetadata(delivery.record.id, delivery.chunks, delivery.attachments);
    await sendConnectorDeliveryChunks(delivery.record.id, delivery.chunks, async (chunk) => {
      try {
        await ctx.replyWithChatAction('typing');
      } catch {
        // ignore
      }
      await deliverTelegramRichText(chunk || 'Task completed.', delivery.record.id, async (message, parseMode) => {
        if (parseMode) {
          await ctx.reply(message, { parse_mode: parseMode });
          return;
        }
        await ctx.reply(message);
      });
    });
  };

  try {
    await ctx.replyWithChatAction('typing');
  } catch {
    // ignore
  }

  try {
    const prompt = content;
    const { completion } = await startAgentEngineTask(
      {
        prompt,
        taskId,
        agentId,
        sessionId: existingGatewaySession?.sessionId,
        systemPromptAppend: buildTelegramSystemPromptAppend(ctx),
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
    const responseText = await waitForTelegramResponseText({
      resultStatus: result.status,
      taskId,
      promptText: prompt,
    });
    await deliverReply(responseText || 'Task completed.');
  } catch (error) {
    const fallback = error instanceof Error ? error.message : 'Unknown error';
    const errorText = /already running or queued/i.test(fallback)
      ? 'I am already working on that Telegram task and will reply when it finishes.'
      : `Sorry — I couldn't run that task (${fallback}).`;
    try {
      await deliverReply(errorText);
    } catch {
      // ignore
    }
  } finally {
    inFlightTelegramMessages.delete(messageKey);
    const inFlightRouteAfterRun = inFlightTelegramRoutes.get(route.sessionKey);
    if (inFlightRouteAfterRun?.taskId === taskId) {
      inFlightTelegramRoutes.delete(route.sessionKey);
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

    const BotConstructor = loadTelegramBotConstructor();
    const bot = new BotConstructor(token);
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

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  return {
    mimeType: match[1] || 'application/octet-stream',
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  };
}

async function sendTelegramJson(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<Record<string, any>> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({} as { description?: string; ok?: boolean }));
  if (!response.ok || payload?.ok === false) {
    const detail = payload?.description || response.statusText || `Telegram ${method} failed`;
    throw new Error(detail);
  }
  return payload as Record<string, any>;
}

async function sendTelegramForm(
  token: string,
  method: string,
  form: FormData
): Promise<Record<string, any>> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: form,
  });
  const payload = await response.json().catch(() => ({} as { description?: string; ok?: boolean }));
  if (!response.ok || payload?.ok === false) {
    const detail = payload?.description || response.statusText || `Telegram ${method} failed`;
    throw new Error(detail);
  }
  return payload as Record<string, any>;
}

async function sendTelegramTyping(token: string, chatId: string): Promise<void> {
  try {
    await sendTelegramJson(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    });
  } catch {
    // Typing indicators are best-effort.
  }
}

function compactTelegramDeliveryReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown Telegram send error');
  return message.trim().slice(0, 180) || 'Unknown Telegram send error';
}

function getInitialTelegramMediaOutcome(attachments: ConnectorDeliveryAttachmentRecord[] | undefined): ConnectorDeliveryMediaOutcome {
  const records = attachments ?? [];
  if (records.length === 0) return 'none';
  if (records.every((attachment) => attachment.status === 'skipped')) return 'skipped';
  return 'pending';
}

function resolveTelegramMediaOutcome(input: {
  sent: number;
  fallback: number;
  skipped: number;
}): ConnectorDeliveryMediaOutcome {
  const total = input.sent + input.fallback + input.skipped;
  if (total === 0) return 'none';
  if (input.sent > 0 && input.fallback > 0) return 'partial-fallback';
  if (input.fallback > 0) return 'fallback';
  if (input.sent > 0) return 'sent';
  return 'skipped';
}

function recordTelegramDeliveryStartMetadata(
  deliveryId: string,
  chunks: string[],
  attachments: ConnectorDeliveryAttachmentRecord[] | undefined
): void {
  updateConnectorDeliveryMetadata(deliveryId, {
    formattingMode: 'telegram-markdown-v2',
    parseMode: 'MarkdownV2',
    chunkCount: chunks.length,
    mediaOutcome: getInitialTelegramMediaOutcome(attachments),
  });
}

function recordTelegramFormattingFallback(deliveryId: string | undefined, reason: string): void {
  if (!deliveryId) return;
  updateConnectorDeliveryMetadata(deliveryId, {
    formattingMode: 'telegram-markdown-v2-fallback',
    parseMode: 'mixed',
    fallbackReason: reason,
  });
}

function recordTelegramMediaOutcome(
  deliveryId: string,
  outcome: ConnectorDeliveryMediaOutcome,
  fallbackReason?: string
): void {
  updateConnectorDeliveryMetadata(deliveryId, {
    mediaOutcome: outcome,
    ...(fallbackReason ? { fallbackReason } : {}),
  });
}

async function sendTelegramText(
  token: string,
  chatId: string,
  text: string,
  options?: { parseMode?: ConnectorDeliveryParseMode }
): Promise<void> {
  await sendTelegramJson(token, 'sendMessage', {
    chat_id: chatId,
    text: text || ' ',
    ...(options?.parseMode === 'MarkdownV2' ? { parse_mode: options.parseMode } : {}),
  });
}

async function deliverTelegramRichText(
  text: string,
  deliveryId: string | undefined,
  sendText: (message: string, parseMode?: 'MarkdownV2') => Promise<void>
): Promise<void> {
  const plainText = text || ' ';
  const formatted = formatTelegramConnectorMarkdown(plainText, { maxLength: TELEGRAM_MESSAGE_LIMIT });
  if (formatted.parseMode === 'MarkdownV2') {
    try {
      await sendText(formatted.text, formatted.parseMode);
      return;
    } catch (error) {
      recordTelegramFormattingFallback(
        deliveryId,
        `telegram-parse-mode-rejected: ${compactTelegramDeliveryReason(error)}`
      );
      await sendText(plainText);
      return;
    }
  }

  if (formatted.fallbackReason) {
    recordTelegramFormattingFallback(deliveryId, formatted.fallbackReason);
  }
  await sendText(plainText);
}

async function sendTelegramAttachment(
  token: string,
  chatId: string,
  attachment: ConnectorDeliveryAttachmentRecord
): Promise<void> {
  const method = attachment.kind === 'image' ? 'sendPhoto' : 'sendDocument';
  const field = attachment.kind === 'image' ? 'photo' : 'document';
  const fileName = attachment.name || (attachment.kind === 'image' ? 'image.png' : 'attachment');

  if (attachment.source === 'url' && attachment.url) {
    await sendTelegramJson(token, method, {
      chat_id: chatId,
      [field]: attachment.url,
    });
    return;
  }

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
  form.append('chat_id', chatId);
  form.append(field, new Blob([payload], { type: mimeType }), fileName);
  await sendTelegramForm(token, method, form);
}

export async function sendTelegramOutboundMessage(params: {
  targetId: string;
  text: string;
  token?: string;
  chunks?: string[];
  attachments?: ConnectorDeliveryAttachmentRecord[];
  deliveryId?: string;
  connectorInstanceId?: string;
  accountId?: string;
  targetKind?: 'dm' | 'group' | 'channel';
  taskId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
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

  const prepared = params.deliveryId
    ? {
        record: { id: params.deliveryId },
        chunks: params.chunks ?? splitTelegramMessage(text, TELEGRAM_MESSAGE_LIMIT),
        attachments: params.attachments ?? [],
        silenced: false,
      }
    : createConnectorDelivery({
        connectorId: 'telegram',
        connectorInstanceId: params.connectorInstanceId,
        accountId: params.accountId,
        targetId: chatId,
        targetKind: params.targetKind ?? 'dm',
        text,
        splitLimit: TELEGRAM_MESSAGE_LIMIT,
        taskId: params.taskId,
        threadId: params.threadId,
        metadata: params.metadata,
      });
  if (prepared.silenced) {
    return;
  }

  recordTelegramDeliveryStartMetadata(prepared.record.id, prepared.chunks, prepared.attachments);
  await sendConnectorDeliveryChunks(prepared.record.id, prepared.chunks, async (chunk) => {
    await sendTelegramTyping(token, chatId);
    await deliverTelegramRichText(chunk || ' ', prepared.record.id, (message, parseMode) => (
      sendTelegramText(token, chatId, message, { parseMode })
    ));
  }, {
    afterChunks: async () => {
      const media = { sent: 0, fallback: 0, skipped: 0 };
      for (const attachment of prepared.attachments ?? []) {
        if (attachment.status === 'skipped') {
          media.skipped += 1;
          continue;
        }
        try {
          await sendTelegramAttachment(token, chatId, attachment);
          markConnectorDeliveryAttachmentSent(prepared.record.id, attachment.id);
          media.sent += 1;
          recordTelegramMediaOutcome(prepared.record.id, resolveTelegramMediaOutcome(media));
        } catch (error) {
          markConnectorDeliveryAttachmentFallback(prepared.record.id, attachment.id, error);
          media.fallback += 1;
          const fallbackReason = `media-upload-failed: ${compactTelegramDeliveryReason(error)}`;
          recordTelegramMediaOutcome(prepared.record.id, resolveTelegramMediaOutcome(media), fallbackReason);
          await deliverTelegramRichText(
            attachment.fallbackText || 'Attachment could not be uploaded.',
            prepared.record.id,
            (message, parseMode) => sendTelegramText(token, chatId, message, { parseMode })
          );
        }
      }
      recordTelegramMediaOutcome(prepared.record.id, resolveTelegramMediaOutcome(media));
    },
  });
}
