import { createHash, randomUUID } from 'crypto';
import { basename } from 'path';
import type {
  ConnectorDeliveryAttachmentInput,
  ConnectorDeliveryAttachmentRecord,
  ConnectorDeliveryChunkRecord,
  ConnectorDeliveryFormattingMode,
  ConnectorDeliveryParseMode,
  ConnectorDeliveryRecord,
  GatewayConnectorExtensionId,
  GatewayPeerKind,
} from '@accomplish/shared';
import {
  createConnectorDeliveryRecord,
  getConnectorDelivery,
  recordConnectorDeliveryAttempt,
  updateConnectorDeliveryAttachment,
  updateConnectorDeliveryChunk,
  updateConnectorDeliveryRecord,
} from '../store/connectorDeliveries';

const DEFAULT_MAX_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 750;
const RECENT_IMAGE_HASH_TTL_MS = 24 * 60 * 60 * 1000;

const SILENCE_DIRECTIVE_RE = /(?:<!--\s*silence\s*-->|^\s*\[(?:silent|silence|no[-_\s]?reply)\]\s*$|^\s*\/silent\b)/i;
const THINKING_BLOCK_RE = /<(?:think|thinking|reasoning|analysis|internal)\b[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|analysis|internal)>/gi;
const THINKING_PREFIX_RE = /^\s*(?:thinking|reasoning|analysis|internal thought|private thought)\s*:\s*/i;
const INTERNAL_PREFIX_RE = /^\s*(?:internal|private|system)\s*(?:message|note|update)?\s*:\s*/i;
const LEARNING_STATUS_RE = /^\s*(?:learning|memory|skill|post-task learning|skill curator|memory manager)\s*(?:update|write|automation|curation|summary|status)?\s*:\s*/i;
const LEARNING_SENTENCE_RE = /^\s*(?:wrote|updated|staged|applied|curated|saved)\s+(?:memory|skill|learning)\b/i;
const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi;
const MARKDOWN_DATA_IMAGE_RE = /!\[[^\]]*]\(\s*data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+\s*\)/gi;
const HISTORICAL_IMAGE_REFERENCE_RE = /\b(?:previous|earlier|last|prior|old|original|above|that|those)\s+(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\b/i;
const TELEGRAM_MARKDOWN_V2_ESCAPE_RE = /([\\_*\[\]()~`>#+\-=|{}.!])/g;
const TELEGRAM_MARKDOWN_V2_CODE_ESCAPE_RE = /([\\`])/g;
const TELEGRAM_MARKDOWN_V2_URL_ESCAPE_RE = /([\\)])/g;
const TELEGRAM_MARKDOWN_PLACEHOLDER_PREFIX = 'OPENDESKMATETGMDTOKEN';

const connectorDeliveryQueues = new Map<string, Promise<void>>();
const recentImageHashesByDeliveryScope = new Map<string, Map<string, number>>();

export interface TelegramConnectorFormattedText {
  text: string;
  formattingMode: ConnectorDeliveryFormattingMode;
  parseMode: ConnectorDeliveryParseMode;
  fallbackReason?: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function compactErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown connector delivery error');
}

function isRetryableError(error: unknown): boolean {
  const message = compactErrorMessage(error);
  return /\b(429|500|502|503|504|rate|timeout|temporar|network|fetch failed)\b/i.test(message);
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function escapeTelegramMarkdownText(value: string): string {
  return value.replace(TELEGRAM_MARKDOWN_V2_ESCAPE_RE, '\\$1');
}

function escapeTelegramMarkdownCode(value: string): string {
  return value.replace(TELEGRAM_MARKDOWN_V2_CODE_ESCAPE_RE, '\\$1');
}

function escapeTelegramMarkdownUrl(value: string): string {
  return value.replace(TELEGRAM_MARKDOWN_V2_URL_ESCAPE_RE, '\\$1');
}

function restoreTelegramPlaceholders(
  text: string,
  replacements: string[],
  tokenPrefix: string
): string {
  const placeholderRe = new RegExp(`${tokenPrefix}(\\d+)END`, 'g');
  let restored = text;
  let previous = '';
  while (restored !== previous) {
    previous = restored;
    restored = restored.replace(placeholderRe, (match, rawIndex: string) => {
      const index = Number(rawIndex);
      return replacements[index] ?? match;
    });
  }
  return restored;
}

function formatTelegramInlineMarkdown(input: string): string {
  const replacements: string[] = [];
  const reserve = (value: string): string => {
    const token = `${TELEGRAM_MARKDOWN_PLACEHOLDER_PREFIX}INLINE${replacements.length}END`;
    replacements.push(value);
    return token;
  };

  let working = input;
  working = working.replace(/`([^`\n]+)`/g, (_match, code: string) => (
    reserve(`\`${escapeTelegramMarkdownCode(code)}\``)
  ));
  working = working.replace(/\[([^\]\n]+)]\(([^)\n]+)\)/g, (_match, label: string, url: string) => (
    reserve(`[${formatTelegramInlineMarkdown(label)}](${escapeTelegramMarkdownUrl(url.trim())})`)
  ));
  working = working.replace(/\*\*([^*\n](?:.*?[^*\n])?)\*\*/g, (_match, content: string) => (
    reserve(`*${formatTelegramInlineMarkdown(content)}*`)
  ));
  working = working.replace(/__([^_\n](?:.*?[^_\n])?)__/g, (_match, content: string) => (
    reserve(`*${formatTelegramInlineMarkdown(content)}*`)
  ));
  working = working.replace(/~~([^~\n](?:.*?[^~\n])?)~~/g, (_match, content: string) => (
    reserve(`~${formatTelegramInlineMarkdown(content)}~`)
  ));
  working = working.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_match, content: string) => (
    reserve(`_${formatTelegramInlineMarkdown(content)}_`)
  ));
  working = working.replace(/(^|[^\w])_([^_\n]+)_($|[^\w])/g, (
    _match,
    prefix: string,
    content: string,
    suffix: string
  ) => (
    `${prefix}${reserve(`_${formatTelegramInlineMarkdown(content)}_`)}${suffix}`
  ));

  const escaped = escapeTelegramMarkdownText(working);
  return restoreTelegramPlaceholders(escaped, replacements, `${TELEGRAM_MARKDOWN_PLACEHOLDER_PREFIX}INLINE`);
}

function formatTelegramMarkdownV2(text: string): string {
  const replacements: string[] = [];
  const reserve = (value: string): string => {
    const token = `${TELEGRAM_MARKDOWN_PLACEHOLDER_PREFIX}BLOCK${replacements.length}END`;
    replacements.push(value);
    return token;
  };

  const withCodeBlocks = text.replace(/```([a-zA-Z0-9_-]+)?[ \t]*\n([\s\S]*?)```/g, (
    _match,
    language: string | undefined,
    code: string
  ) => {
    const safeLanguage = language ? language.replace(/[^a-zA-Z0-9_-]/g, '') : '';
    return reserve(`\`\`\`${safeLanguage ? `${safeLanguage}\n` : '\n'}${escapeTelegramMarkdownCode(code)}\`\`\``);
  });

  const formatted = withCodeBlocks
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        return `*${formatTelegramInlineMarkdown(heading[2])}*`;
      }
      return formatTelegramInlineMarkdown(line);
    })
    .join('\n');

  return restoreTelegramPlaceholders(formatted, replacements, `${TELEGRAM_MARKDOWN_PLACEHOLDER_PREFIX}BLOCK`);
}

export function formatTelegramConnectorMarkdown(
  text: string,
  options?: { maxLength?: number }
): TelegramConnectorFormattedText {
  const plainText = text || ' ';
  const formatted = formatTelegramMarkdownV2(plainText);
  const maxLength = Math.max(1, Math.round(options?.maxLength ?? 4096));
  if (formatted.length > maxLength) {
    return {
      text: plainText,
      formattingMode: 'telegram-markdown-v2-fallback',
      parseMode: 'none',
      fallbackReason: 'telegram-markdownv2-too-long',
    };
  }
  return {
    text: formatted || ' ',
    formattingMode: 'telegram-markdown-v2',
    parseMode: 'MarkdownV2',
  };
}

function inferAttachmentKind(input: ConnectorDeliveryAttachmentInput): 'file' | 'image' {
  if (input.kind === 'image') return 'image';
  if (input.mimeType?.toLowerCase().startsWith('image/')) return 'image';
  if (input.dataUrl && /^data:image\//i.test(input.dataUrl)) return 'image';
  const source = input.path || input.url || input.name || '';
  return /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(source) ? 'image' : 'file';
}

function inferAttachmentSource(input: ConnectorDeliveryAttachmentInput): 'path' | 'url' | 'data-url' | null {
  if (input.dataUrl) return 'data-url';
  if (input.url) return 'url';
  if (input.path) return 'path';
  return null;
}

function inferAttachmentName(input: ConnectorDeliveryAttachmentInput): string | undefined {
  const explicitName = normalizeText(input.name);
  if (explicitName) return explicitName.slice(0, 240);
  const source = normalizeText(input.path || input.url);
  if (!source) return undefined;
  try {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      return basename(url.pathname) || undefined;
    }
  } catch {
    // Fall through to path basename.
  }
  return basename(source) || undefined;
}

function inferAttachmentContentHash(input: ConnectorDeliveryAttachmentInput): string | undefined {
  const provided = normalizeText(input.contentHash);
  if (provided) return provided.slice(0, 128);
  const source = normalizeText(input.dataUrl || input.url || input.path);
  return source ? hashText(source) : undefined;
}

function buildAttachmentFallbackText(attachment: ConnectorDeliveryAttachmentRecord): string {
  const label = attachment.kind === 'image' ? 'Image' : 'File';
  const name = attachment.name ? ` "${attachment.name}"` : '';
  const source = attachment.url || attachment.path;
  if (source) return `${label}${name}: ${source}`;
  return `${label}${name} could not be uploaded by this connector.`;
}

function resolveDeliveryScope(input: {
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  accountId?: string;
  targetId?: string;
  targetKind?: GatewayPeerKind;
  threadId?: string;
  deliveryId?: string;
}): string {
  return [
    input.connectorId,
    input.connectorInstanceId || 'default',
    input.accountId || '',
    input.targetKind || '',
    input.targetId || '',
    input.threadId || input.targetId || input.deliveryId || '',
  ].join(':');
}

function cleanupRecentImageHashes(scope: string): Map<string, number> {
  const now = Date.now();
  const current = recentImageHashesByDeliveryScope.get(scope) ?? new Map<string, number>();
  for (const [hash, timestamp] of current.entries()) {
    if (now - timestamp > RECENT_IMAGE_HASH_TTL_MS) current.delete(hash);
  }
  recentImageHashesByDeliveryScope.set(scope, current);
  return current;
}

export function splitConnectorMessage(text: string, limit: number): string[] {
  const boundedLimit = Math.max(200, Math.min(40000, Math.floor(limit)));
  const chunks: string[] = [];
  let remaining = normalizeText(text);
  while (remaining.length > boundedLimit) {
    let sliceIndex = remaining.lastIndexOf('\n', boundedLimit);
    if (sliceIndex < boundedLimit * 0.6) {
      sliceIndex = remaining.lastIndexOf(' ', boundedLimit);
    }
    if (sliceIndex <= 0) {
      sliceIndex = boundedLimit;
    }
    chunks.push(remaining.slice(0, sliceIndex).trim());
    remaining = remaining.slice(sliceIndex).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length > 0 ? chunks : [];
}

function stripInternalParagraphs(text: string): { text: string; stripped: boolean; allInternal: boolean } {
  const paragraphs = text
    .split(/\n{2,}/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return { text: '', stripped: text.trim().length > 0, allInternal: true };
  }

  const publicParagraphs = paragraphs.filter((paragraph) => (
    !THINKING_PREFIX_RE.test(paragraph)
    && !INTERNAL_PREFIX_RE.test(paragraph)
    && !LEARNING_STATUS_RE.test(paragraph)
    && !LEARNING_SENTENCE_RE.test(paragraph)
  ));
  return {
    text: publicParagraphs.join('\n\n').trim(),
    stripped: publicParagraphs.length !== paragraphs.length,
    allInternal: publicParagraphs.length === 0,
  };
}

function stripInlineImageData(text: string): { text: string; stripped: boolean } {
  const withoutMarkdownImages = text.replace(MARKDOWN_DATA_IMAGE_RE, '[image omitted]');
  const withoutDataImages = withoutMarkdownImages.replace(DATA_IMAGE_RE, '[image data omitted]');
  return {
    text: withoutDataImages.replace(/\s+\[image data omitted]/g, ' [image data omitted]').trim(),
    stripped: withoutDataImages !== text,
  };
}

export function hasExplicitHistoricalImageReference(text: string): boolean {
  return HISTORICAL_IMAGE_REFERENCE_RE.test(normalizeText(text));
}

export function filterConnectorDeliveryText(rawText: string): {
  text: string;
  silenced: boolean;
  internalFiltered: boolean;
  reason?: string;
} {
  const original = normalizeText(rawText);
  if (!original) {
    return { text: '', silenced: true, internalFiltered: false, reason: 'empty' };
  }
  if (SILENCE_DIRECTIVE_RE.test(original)) {
    return { text: '', silenced: true, internalFiltered: false, reason: 'silence-directive' };
  }
  if (
    THINKING_PREFIX_RE.test(original)
    || INTERNAL_PREFIX_RE.test(original)
    || LEARNING_STATUS_RE.test(original)
    || LEARNING_SENTENCE_RE.test(original)
  ) {
    const strippedParagraphs = stripInternalParagraphs(original);
    if (strippedParagraphs.text) {
      return {
        text: strippedParagraphs.text,
        silenced: false,
        internalFiltered: true,
        reason: 'internal-stripped',
      };
    }
    return { text: '', silenced: true, internalFiltered: true, reason: 'internal-status' };
  }

  const withoutThinkingBlocks = original.replace(THINKING_BLOCK_RE, '').trim();
  const strippedParagraphs = stripInternalParagraphs(withoutThinkingBlocks);
  if (!strippedParagraphs.text) {
    return { text: '', silenced: true, internalFiltered: true, reason: 'reasoning-only' };
  }
  const withoutInlineImages = stripInlineImageData(strippedParagraphs.text);
  return {
    text: withoutInlineImages.text,
    silenced: false,
    internalFiltered: withoutThinkingBlocks !== original || strippedParagraphs.stripped || withoutInlineImages.stripped,
    reason: withoutThinkingBlocks !== original
      ? 'reasoning-stripped'
      : strippedParagraphs.stripped
        ? 'internal-stripped'
        : withoutInlineImages.stripped
          ? 'inline-image-stripped'
          : undefined,
  };
}

export function prepareConnectorDeliveryAttachments(
  attachments: ConnectorDeliveryAttachmentInput[] | undefined,
  options: {
    text: string;
    connectorId: GatewayConnectorExtensionId;
    connectorInstanceId?: string;
    accountId?: string;
    targetId?: string;
    targetKind?: GatewayPeerKind;
    threadId?: string;
    deliveryId?: string;
  }
): ConnectorDeliveryAttachmentRecord[] {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const explicitTextReference = hasExplicitHistoricalImageReference(options.text);
  const scope = resolveDeliveryScope(options);
  const recentImageHashes = cleanupRecentImageHashes(scope);
  const records: ConnectorDeliveryAttachmentRecord[] = [];

  for (const rawAttachment of attachments.slice(0, 10)) {
    if (!rawAttachment || typeof rawAttachment !== 'object') continue;
    const source = inferAttachmentSource(rawAttachment);
    if (!source) continue;
    const path = normalizeText(rawAttachment.path);
    const url = normalizeText(rawAttachment.url);
    const dataUrl = normalizeText(rawAttachment.dataUrl);
    const kind = inferAttachmentKind(rawAttachment);
    const contentHash = inferAttachmentContentHash(rawAttachment);
    const explicitReference = rawAttachment.explicitReference === true || explicitTextReference;
    const historical = rawAttachment.historical === true;
    const id = normalizeText(rawAttachment.id) || hashText([
      kind,
      source,
      contentHash || path || url || dataUrl.slice(0, 128),
    ].join(':')).slice(0, 32);

    let status: ConnectorDeliveryAttachmentRecord['status'] = 'pending';
    let error: string | undefined;
    if (kind === 'image' && historical && !explicitReference) {
      status = 'skipped';
      error = 'historical-image-not-referenced';
    } else if (kind === 'image' && contentHash && !explicitReference && recentImageHashes.has(contentHash)) {
      status = 'skipped';
      error = 'duplicate-image-not-referenced';
    }

    if (kind === 'image' && contentHash && status === 'pending') {
      recentImageHashes.set(contentHash, Date.now());
    }

    const record: ConnectorDeliveryAttachmentRecord = {
      id,
      kind,
      source,
      status,
      name: inferAttachmentName(rawAttachment),
      mimeType: normalizeText(rawAttachment.mimeType).slice(0, 120) || undefined,
      size: typeof rawAttachment.size === 'number' && Number.isFinite(rawAttachment.size)
        ? Math.max(0, Math.round(rawAttachment.size))
        : undefined,
      path: source === 'path' ? path : undefined,
      url: source === 'url' ? url : undefined,
      dataUrl: source === 'data-url' ? dataUrl : undefined,
      contentHash,
      explicitReference,
      historical,
      error,
    };
    record.fallbackText = buildAttachmentFallbackText(record);
    records.push(record);
  }
  return records;
}

export function appendConnectorAttachmentFallbackText(
  text: string,
  attachments: ConnectorDeliveryAttachmentRecord[]
): string {
  const fallbackLines = attachments
    .filter((attachment) => attachment.status !== 'skipped')
    .map((attachment) => attachment.fallbackText || buildAttachmentFallbackText(attachment))
    .filter(Boolean);
  if (fallbackLines.length === 0) return text;
  return [text.trim(), fallbackLines.join('\n')].filter(Boolean).join('\n\n');
}

export function updateConnectorDeliveryMetadata(
  deliveryId: string,
  metadata: Record<string, string | number | boolean | null | undefined>
): void {
  const record = getConnectorDelivery(deliveryId);
  if (!record) return;
  const nextMetadata: Record<string, string> = { ...(record.metadata ?? {}) };
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    const key = rawKey.trim();
    if (!key) continue;
    const value = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
    if (!value) {
      delete nextMetadata[key];
    } else {
      nextMetadata[key] = value;
    }
  }
  updateConnectorDeliveryRecord(deliveryId, {
    metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
  });
}

export function createConnectorDelivery(input: {
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  accountId?: string;
  targetId?: string;
  targetKind?: GatewayPeerKind;
  direction?: 'outbound' | 'reply';
  text: string;
  splitLimit: number;
  taskId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
  maxRetries?: number;
  attachments?: ConnectorDeliveryAttachmentInput[];
  attachmentMode?: 'upload' | 'fallback';
}): {
  record: ConnectorDeliveryRecord;
  text: string;
  chunks: string[];
  attachments: ConnectorDeliveryAttachmentRecord[];
  silenced: boolean;
} {
  const filtered = filterConnectorDeliveryText(input.text);
  const attachments = prepareConnectorDeliveryAttachments(input.attachments, {
    text: input.text,
    connectorId: input.connectorId,
    connectorInstanceId: input.connectorInstanceId,
    accountId: input.accountId,
    targetId: input.targetId,
    targetKind: input.targetKind,
    threadId: input.threadId,
  });
  const attachmentMode = input.attachmentMode ?? 'upload';
  const recordAttachments = filtered.silenced
    ? attachments.map((attachment) => (
        attachment.status === 'pending'
          ? {
              ...attachment,
              status: 'skipped' as const,
              error: filtered.reason || 'delivery-silenced',
            }
          : attachment
      ))
    : attachmentMode === 'fallback'
    ? attachments.map((attachment) => (
        attachment.status === 'pending'
          ? {
              ...attachment,
              status: 'fallback' as const,
              fallbackText: attachment.fallbackText || buildAttachmentFallbackText(attachment),
            }
          : attachment
      ))
    : attachments;
  const deliveryText = filtered.silenced || attachmentMode !== 'fallback'
    ? filtered.text
    : appendConnectorAttachmentFallbackText(filtered.text, recordAttachments);
  const chunks = filtered.silenced ? [] : splitConnectorMessage(deliveryText, input.splitLimit);
  const recordChunks: ConnectorDeliveryChunkRecord[] = chunks.map((chunk, index) => ({
    index,
    length: chunk.length,
    status: 'pending',
  }));
  const status = filtered.silenced ? (filtered.internalFiltered ? 'filtered' : 'silenced') : 'pending';
  const metadata = {
    ...(input.metadata ?? {}),
    chunkCount: String(chunks.length),
  };
  const record = createConnectorDeliveryRecord({
    id: randomUUID(),
    connectorId: input.connectorId,
    connectorInstanceId: input.connectorInstanceId,
    accountId: input.accountId,
    targetId: input.targetId,
    targetKind: input.targetKind,
    direction: input.direction,
    status,
    textPreview: filtered.text || normalizeText(input.text),
    originalLength: normalizeText(input.text).length,
    filteredLength: deliveryText.length,
    chunks: recordChunks,
    attachments: recordAttachments,
    internalFiltered: filtered.internalFiltered,
    silenced: filtered.silenced,
    filterReason: filtered.reason,
    maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
    taskId: input.taskId,
    threadId: input.threadId,
    metadata,
  });
  if (filtered.silenced) {
    recordConnectorDeliveryAttempt(record.id, {
      status: filtered.internalFiltered ? 'filtered' : 'silenced',
      error: filtered.reason,
    });
  }
  return { record, text: deliveryText, chunks, attachments: recordAttachments, silenced: filtered.silenced };
}

export function markConnectorDeliverySilenced(
  deliveryId: string,
  reason: string,
  internalFiltered = false
): void {
  const record = updateConnectorDeliveryRecord(deliveryId, {
    status: internalFiltered ? 'filtered' : 'silenced',
    silenced: true,
    internalFiltered,
    filterReason: reason,
    chunks: [],
    chunkCount: 0,
  } as Partial<ConnectorDeliveryRecord>);
  if (record) {
    recordConnectorDeliveryAttempt(deliveryId, {
      status: internalFiltered ? 'filtered' : 'silenced',
      error: reason,
    });
  }
}

export function markConnectorDeliveryFailed(deliveryId: string, error: unknown): void {
  const message = compactErrorMessage(error);
  updateConnectorDeliveryRecord(deliveryId, {
    status: 'failed',
    lastError: message,
    failureReason: message,
    nextRetryAt: undefined,
  });
  recordConnectorDeliveryAttempt(deliveryId, {
    status: 'failed',
    error: message,
  });
}

export function markConnectorDeliveryAttachmentSent(
  deliveryId: string,
  attachmentId: string
): void {
  updateConnectorDeliveryAttachment(deliveryId, attachmentId, {
    status: 'sent',
    sentAt: new Date().toISOString(),
    error: undefined,
  });
}

export function markConnectorDeliveryAttachmentFallback(
  deliveryId: string,
  attachmentId: string,
  error: unknown
): void {
  const message = compactErrorMessage(error);
  updateConnectorDeliveryAttachment(deliveryId, attachmentId, {
    status: 'fallback',
    error: message,
  });
}

function getQueueKeyForDelivery(deliveryId: string): string {
  const record = getConnectorDelivery(deliveryId);
  if (!record) return `delivery:${deliveryId}`;
  return resolveDeliveryScope({
    connectorId: record.connectorId,
    connectorInstanceId: record.connectorInstanceId,
    accountId: record.accountId,
    targetId: record.targetId,
    targetKind: record.targetKind,
    threadId: record.threadId,
    deliveryId,
  });
}

async function enqueueConnectorDelivery(
  deliveryId: string,
  run: () => Promise<void>
): Promise<void> {
  const queueKey = getQueueKeyForDelivery(deliveryId);
  const previous = connectorDeliveryQueues.get(queueKey);
  if (previous) {
    updateConnectorDeliveryRecord(deliveryId, {
      status: 'queued',
    });
    recordConnectorDeliveryAttempt(deliveryId, {
      status: 'queued',
    });
  }
  const current = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(run);
  let tracked: Promise<void>;
  tracked = current.catch(() => undefined).finally(() => {
    if (connectorDeliveryQueues.get(queueKey) === tracked) {
      connectorDeliveryQueues.delete(queueKey);
    }
  });
  connectorDeliveryQueues.set(queueKey, tracked);
  await current;
}

async function runConnectorDeliveryChunks(
  deliveryId: string,
  chunks: string[],
  sendChunk: (chunk: string, index: number) => Promise<void>,
  options?: { maxRetries?: number; retryBaseDelayMs?: number; afterChunks?: () => Promise<void> }
): Promise<void> {
  const maxRetries = Math.max(0, Math.round(options?.maxRetries ?? DEFAULT_MAX_RETRIES));
  const retryBaseDelayMs = Math.max(0, Math.round(options?.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS));
  updateConnectorDeliveryRecord(deliveryId, {
    status: 'sending',
    maxRetries,
    retryCount: 0,
    lastError: undefined,
    failureReason: undefined,
  });

  let retryCount = 0;
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] || ' ';
      let attempt = 0;
      for (;;) {
        try {
          updateConnectorDeliveryChunk(deliveryId, index, {
            status: 'sending',
            error: undefined,
          });
          await sendChunk(chunk, index);
          updateConnectorDeliveryChunk(deliveryId, index, {
            status: 'sent',
            sentAt: new Date().toISOString(),
            error: undefined,
          });
          recordConnectorDeliveryAttempt(deliveryId, { status: 'sent', chunkIndex: index });
          break;
        } catch (error) {
          const message = compactErrorMessage(error);
          if (attempt < maxRetries && isRetryableError(error)) {
            attempt += 1;
            retryCount += 1;
            const delayMs = retryBaseDelayMs * attempt;
            const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
            updateConnectorDeliveryChunk(deliveryId, index, {
              status: 'retrying',
              error: message,
            });
            updateConnectorDeliveryRecord(deliveryId, {
              status: 'retrying',
              retryCount,
              nextRetryAt,
              lastError: message,
            });
            recordConnectorDeliveryAttempt(deliveryId, {
              status: 'retrying',
              chunkIndex: index,
              error: message,
            });
            await wait(delayMs);
            continue;
          }
          updateConnectorDeliveryChunk(deliveryId, index, {
            status: 'failed',
            error: message,
          });
          recordConnectorDeliveryAttempt(deliveryId, {
            status: 'failed',
            chunkIndex: index,
            error: message,
          });
          throw error;
        }
      }
    }
    if (options?.afterChunks) {
      await options.afterChunks();
    }
    updateConnectorDeliveryRecord(deliveryId, {
      status: 'sent',
      retryCount,
      nextRetryAt: undefined,
      lastError: undefined,
      failureReason: undefined,
    });
  } catch (error) {
    const message = compactErrorMessage(error);
    updateConnectorDeliveryRecord(deliveryId, {
      status: 'failed',
      retryCount,
      nextRetryAt: undefined,
      lastError: message,
      failureReason: message,
    });
    throw error;
  }
}

export async function sendConnectorDeliveryChunks(
  deliveryId: string,
  chunks: string[],
  sendChunk: (chunk: string, index: number) => Promise<void>,
  options?: { maxRetries?: number; retryBaseDelayMs?: number; queued?: boolean; afterChunks?: () => Promise<void> }
): Promise<void> {
  if (options?.queued === false) {
    await runConnectorDeliveryChunks(deliveryId, chunks, sendChunk, options);
    return;
  }
  await enqueueConnectorDelivery(deliveryId, () => runConnectorDeliveryChunks(deliveryId, chunks, sendChunk, options));
}

export function resetConnectorDeliveryRuntimeStateForTests(): void {
  connectorDeliveryQueues.clear();
  recentImageHashesByDeliveryScope.clear();
}
