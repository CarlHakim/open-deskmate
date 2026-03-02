import Store from 'electron-store';
import type { GatewayPeerKind } from './gatewayBindings';

export interface GatewaySessionRecord {
  key: string;
  agentId: string;
  sessionId?: string;
  taskId?: string;
  channel?: string;
  accountId?: string;
  peerKind?: GatewayPeerKind;
  peerId?: string;
  lastPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

interface GatewaySessionsSchema {
  sessions: Record<string, GatewaySessionRecord>;
}

const MAX_SESSIONS = 2000;

const gatewaySessionsStore = new Store<GatewaySessionsSchema>({
  name: 'gateway-sessions',
  defaults: {
    sessions: {},
  },
});

function normalizeKey(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeText(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed || undefined;
}

function readAll(): Record<string, GatewaySessionRecord> {
  const current = gatewaySessionsStore.get('sessions');
  return current && typeof current === 'object' ? current : {};
}

function writeAll(next: Record<string, GatewaySessionRecord>): void {
  const values = Object.values(next);
  if (values.length <= MAX_SESSIONS) {
    gatewaySessionsStore.set('sessions', next);
    return;
  }
  values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const kept = values.slice(0, MAX_SESSIONS);
  const compact: Record<string, GatewaySessionRecord> = {};
  for (const entry of kept) compact[entry.key] = entry;
  gatewaySessionsStore.set('sessions', compact);
}

export function listGatewaySessions(agentId?: string): GatewaySessionRecord[] {
  const all = Object.values(readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agentId) return all;
  const normalized = agentId.trim().toLowerCase();
  return all.filter((entry) => entry.agentId.toLowerCase() === normalized);
}

export function getGatewaySession(sessionKey: string): GatewaySessionRecord | undefined {
  const key = normalizeKey(sessionKey);
  if (!key) return undefined;
  return readAll()[key];
}

export function getGatewaySessionByTaskId(taskId: string): GatewaySessionRecord | undefined {
  const normalized = normalizeText(taskId);
  if (!normalized) return undefined;
  return Object.values(readAll()).find((entry) => entry.taskId === normalized);
}

export function resolveGatewaySessionBySessionId(
  sessionId: string,
  agentId?: string,
): GatewaySessionRecord | undefined {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) return undefined;
  const normalizedAgentId = normalizeText(agentId)?.toLowerCase();
  return Object.values(readAll()).find((entry) => {
    if (entry.sessionId !== normalizedSessionId) return false;
    if (!normalizedAgentId) return true;
    return entry.agentId.toLowerCase() === normalizedAgentId;
  });
}

export function upsertGatewaySession(
  partial: Omit<GatewaySessionRecord, 'key' | 'createdAt' | 'updatedAt'> & { key: string },
): GatewaySessionRecord {
  const key = normalizeKey(partial.key);
  if (!key) throw new Error('session key is required');

  const all = readAll();
  const now = new Date().toISOString();
  const existing = all[key];
  const next: GatewaySessionRecord = {
    key,
    agentId: partial.agentId.trim().toLowerCase(),
    sessionId: normalizeText(partial.sessionId),
    taskId: normalizeText(partial.taskId),
    channel: normalizeText(partial.channel)?.toLowerCase(),
    accountId: normalizeText(partial.accountId),
    peerKind: partial.peerKind,
    peerId: normalizeText(partial.peerId),
    lastPrompt: normalizeText(partial.lastPrompt),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  all[key] = next;
  writeAll(all);
  return next;
}

export function patchGatewaySession(
  sessionKey: string,
  patch: Partial<Omit<GatewaySessionRecord, 'key' | 'createdAt' | 'updatedAt'>>,
): GatewaySessionRecord | undefined {
  const key = normalizeKey(sessionKey);
  if (!key) return undefined;
  const all = readAll();
  const existing = all[key];
  if (!existing) return undefined;
  const next = upsertGatewaySession({
    key,
    agentId: patch.agentId ?? existing.agentId,
    sessionId: patch.sessionId ?? existing.sessionId,
    taskId: patch.taskId ?? existing.taskId,
    channel: patch.channel ?? existing.channel,
    accountId: patch.accountId ?? existing.accountId,
    peerKind: patch.peerKind ?? existing.peerKind,
    peerId: patch.peerId ?? existing.peerId,
    lastPrompt: patch.lastPrompt ?? existing.lastPrompt,
  });
  return next;
}

export function deleteGatewaySession(sessionKey: string): boolean {
  const key = normalizeKey(sessionKey);
  if (!key) return false;
  const all = readAll();
  if (!all[key]) return false;
  delete all[key];
  writeAll(all);
  return true;
}

