import Store from 'electron-store';
import type {
  ConnectorDeliveryAttachmentRecord,
  ConnectorDeliveryChunkRecord,
  ConnectorDeliveryHealth,
  ConnectorDeliveryRecord,
  ConnectorDeliveryStatus,
  GatewayConnectorExtensionId,
  GatewayPeerKind,
} from '@accomplish/shared';

interface ConnectorDeliveriesSchema {
  deliveries: ConnectorDeliveryRecord[];
}

const MAX_DELIVERY_RECORDS = 500;

const connectorDeliveriesStore = new Store<ConnectorDeliveriesSchema>({
  name: 'connector-deliveries',
  defaults: {
    deliveries: [],
  },
});

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) => [key.trim(), String(entryValue ?? '').trim()] as const)
    .filter(([key, entryValue]) => key && entryValue);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeNumber(value: unknown, min = 0): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(min, Math.round(numberValue));
}

function normalizeAttachment(record: ConnectorDeliveryAttachmentRecord): ConnectorDeliveryAttachmentRecord {
  return {
    id: normalizeText(record.id, 128) || `${record.kind}-${record.source}`,
    kind: record.kind === 'image' ? 'image' : 'file',
    source: record.source === 'url' || record.source === 'data-url' ? record.source : 'path',
    status: record.status === 'sent'
      || record.status === 'failed'
      || record.status === 'fallback'
      || record.status === 'skipped'
      ? record.status
      : 'pending',
    name: normalizeText(record.name, 240),
    mimeType: normalizeText(record.mimeType, 120),
    size: normalizeNumber(record.size),
    path: normalizeText(record.path, 2048),
    url: normalizeText(record.url, 2048),
    dataUrl: normalizeText(record.dataUrl, 2_000_000),
    contentHash: normalizeText(record.contentHash, 128),
    explicitReference: record.explicitReference === true,
    historical: record.historical === true,
    fallbackText: normalizeText(record.fallbackText, 500),
    sentAt: normalizeText(record.sentAt, 64),
    error: normalizeText(record.error, 500),
  };
}

function normalizeRecord(record: ConnectorDeliveryRecord): ConnectorDeliveryRecord {
  return {
    ...record,
    connectorInstanceId: normalizeText(record.connectorInstanceId, 128),
    accountId: normalizeText(record.accountId, 128),
    targetId: normalizeText(record.targetId, 256),
    threadId: normalizeText(record.threadId, 128),
    taskId: normalizeText(record.taskId, 128),
    metadata: normalizeMetadata(record.metadata),
    attempts: Array.isArray(record.attempts) ? record.attempts : [],
    chunks: Array.isArray(record.chunks) ? record.chunks : [],
    attachmentCount: Array.isArray(record.attachments) ? record.attachments.length : 0,
    attachments: Array.isArray(record.attachments) ? record.attachments.map(normalizeAttachment) : [],
    failureReason: normalizeText(record.failureReason, 500),
  };
}

function readAll(): ConnectorDeliveryRecord[] {
  const current = connectorDeliveriesStore.get('deliveries');
  if (!Array.isArray(current)) return [];
  return current
    .filter((entry): entry is ConnectorDeliveryRecord => Boolean(entry && typeof entry === 'object'))
    .map(normalizeRecord);
}

function writeAll(records: ConnectorDeliveryRecord[]): void {
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  connectorDeliveriesStore.set('deliveries', sorted.slice(0, MAX_DELIVERY_RECORDS));
}

function upsertRecord(record: ConnectorDeliveryRecord): ConnectorDeliveryRecord {
  const normalized = normalizeRecord(record);
  const records = readAll();
  const index = records.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) {
    records[index] = normalized;
  } else {
    records.unshift(normalized);
  }
  writeAll(records);
  return normalized;
}

export function listConnectorDeliveries(limit = 100): ConnectorDeliveryRecord[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.round(limit)));
  return readAll().slice(0, boundedLimit);
}

export function getConnectorDelivery(id: string): ConnectorDeliveryRecord | undefined {
  const normalized = normalizeText(id, 128);
  if (!normalized) return undefined;
  return readAll().find((record) => record.id === normalized);
}

export function createConnectorDeliveryRecord(input: {
  id: string;
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  accountId?: string;
  targetId?: string;
  targetKind?: GatewayPeerKind;
  direction?: 'outbound' | 'reply';
  status?: ConnectorDeliveryStatus;
  textPreview: string;
  originalLength: number;
  filteredLength: number;
  chunks: ConnectorDeliveryChunkRecord[];
  attachments?: ConnectorDeliveryAttachmentRecord[];
  internalFiltered?: boolean;
  silenced?: boolean;
  filterReason?: string;
  retryCount?: number;
  maxRetries?: number;
  nextRetryAt?: string;
  lastError?: string;
  failureReason?: string;
  taskId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
}): ConnectorDeliveryRecord {
  const timestamp = nowIso();
  return upsertRecord({
    id: input.id,
    connectorId: input.connectorId,
    connectorInstanceId: normalizeText(input.connectorInstanceId, 128),
    accountId: normalizeText(input.accountId, 128),
    targetId: normalizeText(input.targetId, 256),
    targetKind: input.targetKind,
    direction: input.direction ?? 'outbound',
    status: input.status ?? 'pending',
    textPreview: input.textPreview.slice(0, 240),
    originalLength: Math.max(0, Math.round(input.originalLength)),
    filteredLength: Math.max(0, Math.round(input.filteredLength)),
    chunkCount: input.chunks.length,
    chunks: input.chunks,
    attachmentCount: (input.attachments ?? []).length,
    attachments: (input.attachments ?? []).map(normalizeAttachment),
    internalFiltered: input.internalFiltered === true,
    silenced: input.silenced === true,
    filterReason: normalizeText(input.filterReason, 120),
    retryCount: Math.max(0, Math.round(input.retryCount ?? 0)),
    maxRetries: Math.max(0, Math.round(input.maxRetries ?? 0)),
    nextRetryAt: normalizeText(input.nextRetryAt, 64),
    lastError: normalizeText(input.lastError, 500),
    failureReason: normalizeText(input.failureReason, 500),
    attempts: [],
    taskId: normalizeText(input.taskId, 128),
    threadId: normalizeText(input.threadId, 128),
    metadata: normalizeMetadata(input.metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: input.status === 'sent' || input.status === 'failed' || input.status === 'silenced' || input.status === 'filtered'
      ? timestamp
      : undefined,
  });
}

export function updateConnectorDeliveryRecord(
  id: string,
  patch: Partial<Omit<ConnectorDeliveryRecord, 'id' | 'createdAt'>>
): ConnectorDeliveryRecord | undefined {
  const existing = getConnectorDelivery(id);
  if (!existing) return undefined;
  const status = patch.status ?? existing.status;
  const completed = status === 'sent' || status === 'failed' || status === 'silenced' || status === 'filtered';
  return upsertRecord({
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
    completedAt: patch.completedAt ?? (completed ? (existing.completedAt ?? nowIso()) : existing.completedAt),
  });
}

export function updateConnectorDeliveryChunk(
  id: string,
  index: number,
  patch: Partial<Omit<ConnectorDeliveryChunkRecord, 'index'>>
): ConnectorDeliveryRecord | undefined {
  const existing = getConnectorDelivery(id);
  if (!existing) return undefined;
  const chunks = existing.chunks.map((chunk) => (
    chunk.index === index
      ? {
          ...chunk,
          ...patch,
          index: chunk.index,
          error: normalizeText(patch.error, 500),
        }
      : chunk
  ));
  return updateConnectorDeliveryRecord(id, { chunks });
}

export function updateConnectorDeliveryAttachment(
  id: string,
  attachmentId: string,
  patch: Partial<Omit<ConnectorDeliveryAttachmentRecord, 'id'>>
): ConnectorDeliveryRecord | undefined {
  const existing = getConnectorDelivery(id);
  if (!existing) return undefined;
  const normalizedId = normalizeText(attachmentId, 128);
  if (!normalizedId) return existing;
  const attachments = existing.attachments.map((attachment) => (
    attachment.id === normalizedId
      ? normalizeAttachment({
          ...attachment,
          ...patch,
          id: attachment.id,
        })
      : attachment
  ));
  return updateConnectorDeliveryRecord(id, {
    attachments,
    attachmentCount: attachments.length,
  } as Partial<ConnectorDeliveryRecord>);
}

export function recordConnectorDeliveryAttempt(
  id: string,
  attempt: {
    status: 'queued' | 'sent' | 'failed' | 'retrying' | 'silenced' | 'filtered';
    chunkIndex?: number;
    error?: string;
  }
): ConnectorDeliveryRecord | undefined {
  const existing = getConnectorDelivery(id);
  if (!existing) return undefined;
  const attempts = [
    ...existing.attempts,
    {
      at: nowIso(),
      status: attempt.status,
      chunkIndex: attempt.chunkIndex,
      error: normalizeText(attempt.error, 500),
    },
  ];
  return updateConnectorDeliveryRecord(id, { attempts });
}

export function summarizeConnectorDeliveryHealth(input: {
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  limit?: number;
}): ConnectorDeliveryHealth {
  const instanceId = normalizeText(input.connectorInstanceId, 128) ?? 'default';
  const records = readAll()
    .filter((record) => record.connectorId === input.connectorId)
    .filter((record) => (record.connectorInstanceId ?? 'default') === instanceId)
    .slice(0, Math.max(1, Math.min(500, Math.round(input.limit ?? 500))));

  let pendingCount = 0;
  let sendingCount = 0;
  let retryingCount = 0;
  let failedCount = 0;
  let lastFailureReason: string | undefined;
  let lastFailedAt: string | undefined;

  for (const record of records) {
    if (record.status === 'pending' || record.status === 'queued') pendingCount += 1;
    if (record.status === 'sending') sendingCount += 1;
    if (record.status === 'retrying') retryingCount += 1;
    if (record.status === 'failed') {
      failedCount += 1;
      if (!lastFailedAt || record.updatedAt > lastFailedAt) {
        lastFailedAt = record.updatedAt;
        lastFailureReason = record.failureReason || record.lastError;
      }
    }
  }

  const activeCount = pendingCount + sendingCount + retryingCount;
  const status: ConnectorDeliveryHealth['status'] = failedCount > 0
    ? 'degraded'
    : activeCount > 10
      ? 'backlog'
      : 'healthy';

  return {
    status,
    pendingCount,
    sendingCount,
    retryingCount,
    failedCount,
    lastFailureReason,
    lastFailedAt,
  };
}

export function clearConnectorDeliveries(): void {
  connectorDeliveriesStore.set('deliveries', []);
}
