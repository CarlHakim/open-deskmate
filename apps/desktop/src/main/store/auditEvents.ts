import { randomUUID } from 'crypto';
import Store from 'electron-store';
import type {
  AuditEventCategory,
  AuditEventRecord,
  AuditEventStatus,
  SearchJumpTarget,
} from '@accomplish/shared';

interface AuditEventsStoreSchema {
  events: AuditEventRecord[];
  maxEvents: number;
}

export type AuditEventInput = {
  category: AuditEventCategory;
  action: string;
  title: string;
  summary?: string;
  status?: AuditEventStatus;
  timestamp?: string;
  agentId?: string;
  taskId?: string;
  projectId?: string;
  connectorId?: string;
  connectorInstanceId?: string;
  skillId?: string;
  memoryKind?: string;
  targetType?: string;
  targetId?: string;
  source?: string;
  jump?: SearchJumpTarget;
  metadata?: Record<string, unknown>;
};

const auditEventsStore = new Store<AuditEventsStoreSchema>({
  name: 'audit-events',
  defaults: {
    events: [],
    maxEvents: 500,
  },
});

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function cleanStatus(value: unknown): AuditEventStatus {
  return value === 'success' || value === 'warning' || value === 'error' || value === 'info'
    ? value
    : 'info';
}

function cleanJumpTarget(value: SearchJumpTarget | undefined): SearchJumpTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value;
}

function getMaxEvents(): number {
  const raw = auditEventsStore.get('maxEvents');
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(50, Math.min(5000, Math.floor(raw)))
    : 500;
}

function getStoredEvents(): AuditEventRecord[] {
  return auditEventsStore.get('events') ?? [];
}

function setStoredEvents(events: AuditEventRecord[]): void {
  auditEventsStore.set('events', events.slice(0, getMaxEvents()));
}

export function recordAuditEvent(input: AuditEventInput): AuditEventRecord {
  const event: AuditEventRecord = {
    id: `audit_${randomUUID()}`,
    category: input.category,
    action: cleanText(input.action, 120) || 'event',
    title: cleanText(input.title, 200) || input.action || 'Audit event',
    summary: cleanText(input.summary, 2000),
    status: cleanStatus(input.status),
    timestamp: input.timestamp || new Date().toISOString(),
    agentId: cleanText(input.agentId, 128),
    taskId: cleanText(input.taskId, 128),
    projectId: cleanText(input.projectId, 128),
    connectorId: cleanText(input.connectorId, 128),
    connectorInstanceId: cleanText(input.connectorInstanceId, 128),
    skillId: cleanText(input.skillId, 128),
    memoryKind: cleanText(input.memoryKind, 64),
    targetType: cleanText(input.targetType, 80),
    targetId: cleanText(input.targetId, 200),
    source: input.source ? cleanText(input.source, 80) : 'audit-store',
    jump: cleanJumpTarget(input.jump),
    metadata: input.metadata,
  };

  setStoredEvents([event, ...getStoredEvents()]);
  return event;
}

export function listStoredAuditEvents(limit?: number): AuditEventRecord[] {
  const events = getStoredEvents();
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return events;
  }
  return events.slice(0, Math.max(0, Math.min(5000, Math.floor(limit))));
}

export function getStoredAuditEvent(eventId: string): AuditEventRecord | null {
  const id = String(eventId || '').trim();
  if (!id) return null;
  return getStoredEvents().find((event) => event.id === id) ?? null;
}

export function clearAuditEvents(): void {
  auditEventsStore.set('events', []);
}
