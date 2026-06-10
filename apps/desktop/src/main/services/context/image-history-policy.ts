import path from 'path';
import type { SelectedModel, TaskMessage } from '@accomplish/shared';
import { getTasks } from '../../store/taskHistory';
import { readSessionLines, type SessionLine } from './session-history';

type HistoricalImageTask = {
  agentId?: string;
  sessionId?: string;
  messages?: TaskMessage[];
  attachedFiles?: string[];
  sessionFilePath?: string;
  miniMaxHistoricalImageSessionResetAt?: string;
};

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
]);

const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\([^)]+\)/i;
const MARKDOWN_IMAGE_RE_GLOBAL = /!\[[^\]]*]\([^)]+\)/gi;
const IMAGE_URL_RE = /https?:\/\/[^\s"'<>)]*?\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#][^\s"'<>)]*)?/i;
const IMAGE_URL_RE_GLOBAL = /https?:\/\/[^\s"'<>)]*?\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#][^\s"'<>)]*)?/gi;
const IMAGE_FILE_RE = /(?:[A-Za-z]:\\|\/)?[^\s"'<>|]*?\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)\b/i;
const IMAGE_FILE_RE_GLOBAL = /(?:[A-Za-z]:\\|\/)?[^\s"'<>|]*?\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)\b/gi;
const ATTACHED_IMAGE_LINE_RE = /^\s*(?:[-*]|\d+\.)?\s*[^:\n]*\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)\b.*$/gim;

const EARLIER_IMAGE_REFERENCE_RE =
  /\b(?:previous|earlier|last|prior|old|original|above)\s+(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\b/i;
const EARLIER_IMAGE_CONTEXT_RE =
  /\b(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\s+(?:from|in|attached|sent|uploaded|shown|found|discussed|described)\s+(?:the\s+)?(?:previous|earlier|last|prior|old|original|above)\b/i;
const EARLIER_IMAGE_ACTION_RE =
  /\b(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\s+(?:i|we|you)\s+(?:sent|attached|uploaded|showed|found|discussed|described)\s+(?:earlier|before|previously|last time)\b/i;
const DEICTIC_EARLIER_IMAGE_RE =
  /\b(?:that|those|the)\s+(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\s+(?:you|we|i)\s+(?:sent|attached|uploaded|showed|found|discussed|described|looked at)\b/i;
const MINIMAX_HISTORICAL_IMAGE_SESSION_RESET_PREFIX = 'Started a fresh MiniMax session';

export function isMiniMaxSelectedModel(selectedModel: SelectedModel | null | undefined): boolean {
  const provider = String(selectedModel?.provider || '').toLowerCase();
  const model = String(selectedModel?.model || '').toLowerCase();
  const baseUrl = String(selectedModel?.baseUrl || '').toLowerCase();
  return provider.includes('minimax') || model.includes('minimax') || baseUrl.includes('minimax');
}

export function isLikelyImageFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function attachedFilesContainCurrentImage(attachedFiles: string[] | undefined | null): boolean {
  return Array.isArray(attachedFiles) && attachedFiles.some(isLikelyImageFilePath);
}

export function promptReferencesEarlierImage(prompt: string): boolean {
  const value = String(prompt || '');
  return (
    EARLIER_IMAGE_REFERENCE_RE.test(value) ||
    EARLIER_IMAGE_CONTEXT_RE.test(value) ||
    EARLIER_IMAGE_ACTION_RE.test(value) ||
    DEICTIC_EARLIER_IMAGE_RE.test(value)
  );
}

export function textContainsImageContent(text: string | undefined | null): boolean {
  const value = String(text || '');
  if (!value) return false;
  return (
    /data:image\//i.test(value) ||
    MARKDOWN_IMAGE_RE.test(value) ||
    IMAGE_URL_RE.test(value) ||
    IMAGE_FILE_RE.test(value)
  );
}

export function sanitizeHistoricalImageTextForMiniMax(text: string): string {
  return String(text || '')
    .replace(DATA_IMAGE_RE, '[historical image data omitted for MiniMax]')
    .replace(MARKDOWN_IMAGE_RE_GLOBAL, '[historical image omitted for MiniMax]')
    .replace(IMAGE_URL_RE_GLOBAL, '[historical image URL omitted for MiniMax]')
    .replace(ATTACHED_IMAGE_LINE_RE, '  [historical image attachment omitted for MiniMax]')
    .replace(IMAGE_FILE_RE_GLOBAL, '[historical image file omitted for MiniMax]');
}

export function sanitizeHistoricalImagesFromSessionLines(lines: SessionLine[]): SessionLine[] {
  return lines.map((line) => ({
    ...line,
    content: sanitizeHistoricalImageTextForMiniMax(line.content),
  }));
}

function messageContainsImageContent(message: TaskMessage): boolean {
  if (textContainsImageContent(message.content)) return true;
  return (message.attachments || []).some((attachment) => {
    if (typeof attachment.label === 'string' && textContainsImageContent(attachment.label)) return true;
    if (typeof attachment.data === 'string' && textContainsImageContent(attachment.data)) return true;
    return false;
  });
}

function isMiniMaxHistoricalImageResetMessage(message: TaskMessage): boolean {
  return message.type === 'system'
    && isMiniMaxHistoricalImageSessionResetReason(message.content);
}

export function isMiniMaxHistoricalImageSessionResetReason(reason: string | undefined | null): boolean {
  return String(reason || '').startsWith(MINIMAX_HISTORICAL_IMAGE_SESSION_RESET_PREFIX);
}

function lastMiniMaxHistoricalImageResetMessageIndex(messages: TaskMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isMiniMaxHistoricalImageResetMessage(messages[index])) return index;
  }
  return -1;
}

function taskMiniMaxResetBoundaryMs(task: HistoricalImageTask): number | null {
  const timestamp = Date.parse(String(task.miniMaxHistoricalImageSessionResetAt || ''));
  if (Number.isFinite(timestamp)) return timestamp;

  const messages = task.messages || [];
  const resetIndex = lastMiniMaxHistoricalImageResetMessageIndex(messages);
  if (resetIndex < 0) return null;
  const messageTimestamp = Date.parse(String(messages[resetIndex]?.timestamp || ''));
  return Number.isFinite(messageTimestamp) ? messageTimestamp : Date.now();
}

function taskHasMiniMaxResetBoundary(task: HistoricalImageTask | undefined | null): boolean {
  if (!task) return false;
  return taskMiniMaxResetBoundaryMs(task) !== null
    || lastMiniMaxHistoricalImageResetMessageIndex(task.messages || []) >= 0;
}

export function taskContainsHistoricalImageContent(task: HistoricalImageTask | undefined | null): boolean {
  if (!task) return false;
  const messages = task.messages || [];
  const resetBoundaryIndex = lastMiniMaxHistoricalImageResetMessageIndex(messages);
  const resetBoundaryMs = taskMiniMaxResetBoundaryMs(task);
  const messagesAfterResetBoundary = resetBoundaryIndex >= 0
    ? messages.slice(resetBoundaryIndex + 1)
    : resetBoundaryMs !== null
      ? messages.filter((message) => {
          const messageMs = Date.parse(String(message.timestamp || ''));
          return Number.isFinite(messageMs) && messageMs > resetBoundaryMs;
        })
    : messages;
  const hasResetBoundary = resetBoundaryIndex >= 0 || resetBoundaryMs !== null;

  if (messagesAfterResetBoundary.some(messageContainsImageContent)) return true;

  if (!hasResetBoundary && (task.attachedFiles || []).some(isLikelyImageFilePath)) return true;
  if (!hasResetBoundary && task.sessionFilePath) {
    return readSessionLines(task.sessionFilePath).some((line) => textContainsImageContent(line.content));
  }
  return false;
}

export function sessionIdHasHistoricalImageContent(sessionId: string | undefined | null, agentId?: string): boolean {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return false;
  return getTasks(agentId).some((task) => {
    if (task.sessionId !== normalizedSessionId) return false;
    return taskContainsHistoricalImageContent(task);
  });
}

export function shouldStripHistoricalImagesForMiniMax(params: {
  selectedModel?: SelectedModel | null;
  userMessage: string;
}): boolean {
  if (!isMiniMaxSelectedModel(params.selectedModel)) return false;
  return !promptReferencesEarlierImage(params.userMessage);
}

export function getMiniMaxHistoricalImageSessionResetReason(params: {
  selectedModel?: SelectedModel | null;
  prompt: string;
  currentAttachedFiles?: string[] | null;
  sessionId?: string | null;
  sessionFilePath?: string;
  task?: HistoricalImageTask | null;
}): string | undefined {
  if (!isMiniMaxSelectedModel(params.selectedModel)) return undefined;
  if (promptReferencesEarlierImage(params.prompt)) return undefined;
  const taskHasResetBoundary = taskHasMiniMaxResetBoundary(params.task);
  const hasHistoricalImages =
    sessionIdHasHistoricalImageContent(params.sessionId, params.task?.agentId) ||
    taskContainsHistoricalImageContent(params.task) ||
    (!taskHasResetBoundary && params.sessionFilePath
      ? readSessionLines(params.sessionFilePath).some((line) => textContainsImageContent(line.content))
      : false);
  if (!hasHistoricalImages) return undefined;
  if (attachedFilesContainCurrentImage(params.currentAttachedFiles)) {
    return 'Started a fresh MiniMax session so MiniMax receives the image attached to this prompt without older images from this thread. This prevents stale image context from being resent.';
  }
  return 'Started a fresh MiniMax session because this thread contains older image content and this prompt is not asking to use that earlier image. This prevents MiniMax from receiving old images again.';
}
