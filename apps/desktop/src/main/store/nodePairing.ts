import Store from 'electron-store';
import { randomBytes, randomUUID } from 'crypto';
import type {
  NodePairingPendingRequest,
  NodePairingPairedNode,
  NodePairingList,
} from '@accomplish/shared';

interface NodePairingSchema {
  pendingById: Record<string, NodePairingPendingRequest>;
  pairedByNodeId: Record<string, NodePairingPairedNode>;
}

const PENDING_TTL_MS = 5 * 60 * 1000;

const pairingStore = new Store<NodePairingSchema>({
  name: 'node-pairing',
  defaults: {
    pendingById: {},
    pairedByNodeId: {},
  },
});

function pruneExpired(): void {
  const pending = pairingStore.get('pendingById') ?? {};
  const now = Date.now();
  let changed = false;
  for (const [id, request] of Object.entries(pending)) {
    if (!request.createdAtMs || now - request.createdAtMs > PENDING_TTL_MS) {
      delete pending[id];
      changed = true;
    }
  }
  if (changed) {
    pairingStore.set('pendingById', pending);
  }
}

function normalizeNodeId(nodeId: string): string {
  return nodeId.trim();
}

function newToken(): string {
  return randomBytes(24).toString('hex');
}

export function listNodePairing(): NodePairingList {
  pruneExpired();
  const pending = Object.values(pairingStore.get('pendingById') ?? {}).sort(
    (a, b) => b.createdAtMs - a.createdAtMs
  );
  const paired = Object.values(pairingStore.get('pairedByNodeId') ?? {}).sort(
    (a, b) => b.approvedAtMs - a.approvedAtMs
  );
  return { pending, paired };
}

export function getPendingNodePairingByNodeId(nodeId: string): NodePairingPendingRequest | null {
  pruneExpired();
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const pending = pairingStore.get('pendingById') ?? {};
  return Object.values(pending).find((req) => req.nodeId === normalized) ?? null;
}

export function getPairedNode(nodeId: string): NodePairingPairedNode | null {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  return paired[normalized] ?? null;
}

export function requestNodePairing(params: Omit<NodePairingPendingRequest, 'requestId' | 'createdAtMs' | 'isRepair'>): {
  status: 'pending';
  request: NodePairingPendingRequest;
  created: boolean;
} {
  pruneExpired();
  const nodeId = normalizeNodeId(params.nodeId);
  if (!nodeId) {
    throw new Error('nodeId required');
  }
  const pending = pairingStore.get('pendingById') ?? {};
  const existing = Object.values(pending).find((req) => req.nodeId === nodeId);
  if (existing) {
    return { status: 'pending', request: existing, created: false };
  }

  const paired = pairingStore.get('pairedByNodeId') ?? {};
  const isRepair = Boolean(paired[nodeId]);
  const request: NodePairingPendingRequest = {
    requestId: randomUUID(),
    nodeId,
    displayName: params.displayName,
    platform: params.platform,
    version: params.version,
    deviceFamily: params.deviceFamily,
    modelIdentifier: params.modelIdentifier,
    caps: params.caps,
    commands: params.commands,
    permissions: params.permissions,
    remoteIp: params.remoteIp,
    createdAtMs: Date.now(),
    isRepair,
  };

  pending[request.requestId] = request;
  pairingStore.set('pendingById', pending);
  return { status: 'pending', request, created: true };
}

export function approveNodePairing(requestId: string): NodePairingPairedNode | null {
  pruneExpired();
  const pending = pairingStore.get('pendingById') ?? {};
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  const request = pending[requestId];
  if (!request) return null;

  const now = Date.now();
  const existing = paired[request.nodeId];
  const node: NodePairingPairedNode = {
    nodeId: request.nodeId,
    token: newToken(),
    displayName: request.displayName,
    badgeColor: existing?.badgeColor,
    badgeIcon: existing?.badgeIcon,
    aiAccessAllowed: existing?.aiAccessAllowed ?? false,
    platform: request.platform,
    version: request.version,
    deviceFamily: request.deviceFamily,
    modelIdentifier: request.modelIdentifier,
    caps: request.caps,
    commands: request.commands,
    permissions: request.permissions,
    remoteIp: request.remoteIp,
    createdAtMs: existing?.createdAtMs ?? now,
    approvedAtMs: now,
    lastConnectedAtMs: existing?.lastConnectedAtMs,
  };

  delete pending[requestId];
  paired[request.nodeId] = node;
  pairingStore.set('pendingById', pending);
  pairingStore.set('pairedByNodeId', paired);
  return node;
}

export function rejectNodePairing(requestId: string): { requestId: string; nodeId: string } | null {
  pruneExpired();
  const pending = pairingStore.get('pendingById') ?? {};
  const request = pending[requestId];
  if (!request) return null;
  delete pending[requestId];
  pairingStore.set('pendingById', pending);
  return { requestId, nodeId: request.nodeId };
}

export function cancelNodePairingByNodeId(nodeId: string): { requestId: string; nodeId: string } | null {
  pruneExpired();
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const pending = pairingStore.get('pendingById') ?? {};
  const entry = Object.entries(pending).find(([, request]) => request.nodeId === normalized);
  if (!entry) return null;
  const [requestId, request] = entry;
  delete pending[requestId];
  pairingStore.set('pendingById', pending);
  return { requestId, nodeId: request.nodeId };
}

export function verifyNodeToken(nodeId: string, token: string): { ok: boolean; node?: NodePairingPairedNode } {
  const node = getPairedNode(nodeId);
  if (!node) return { ok: false };
  return node.token === token ? { ok: true, node } : { ok: false };
}

export function updatePairedNodeLastSeen(nodeId: string): void {
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  const existing = paired[nodeId];
  if (!existing) return;
  paired[nodeId] = { ...existing, lastConnectedAtMs: Date.now() };
  pairingStore.set('pairedByNodeId', paired);
}

export function removePairedNode(nodeId: string): { nodeId: string } | null {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  if (!paired[normalized]) return null;
  delete paired[normalized];
  pairingStore.set('pairedByNodeId', paired);
  return { nodeId: normalized };
}

export function updatePairedNodeDisplayName(nodeId: string, displayName: string | null): NodePairingPairedNode | null {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  const existing = paired[normalized];
  if (!existing) return null;
  paired[normalized] = {
    ...existing,
    displayName: displayName && displayName.trim() ? displayName.trim() : undefined,
  };
  pairingStore.set('pairedByNodeId', paired);
  return paired[normalized];
}

export function updatePairedNodeBadge(
  nodeId: string,
  params: { displayName?: string | null; badgeColor?: string | null; badgeIcon?: string | null }
): NodePairingPairedNode | null {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  const existing = paired[normalized];
  if (!existing) return null;
  const next: NodePairingPairedNode = { ...existing };
  if (params.displayName !== undefined) {
    next.displayName = params.displayName && params.displayName.trim() ? params.displayName.trim() : undefined;
  }
  if (params.badgeColor !== undefined) {
    next.badgeColor = params.badgeColor && params.badgeColor.trim() ? params.badgeColor.trim() : undefined;
  }
  if (params.badgeIcon !== undefined) {
    next.badgeIcon = params.badgeIcon && params.badgeIcon.trim() ? params.badgeIcon.trim() : undefined;
  }
  paired[normalized] = next;
  pairingStore.set('pairedByNodeId', paired);
  return paired[normalized];
}

export function updatePairedNodeAiAccess(nodeId: string, allowed: boolean): NodePairingPairedNode | null {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  const paired = pairingStore.get('pairedByNodeId') ?? {};
  const existing = paired[normalized];
  if (!existing) return null;
  const next: NodePairingPairedNode = { ...existing, aiAccessAllowed: allowed };
  paired[normalized] = next;
  pairingStore.set('pairedByNodeId', paired);
  return paired[normalized];
}
