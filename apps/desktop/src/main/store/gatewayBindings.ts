import Store from 'electron-store';
import { getDefaultAgentId, listAgents, normalizeAgentIdForStore } from './agents';

export type GatewayPeerKind = 'dm' | 'group' | 'channel';

export interface GatewayRouteBinding {
  id: string;
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: GatewayPeerKind; id: string };
    guildId?: string;
    teamId?: string;
  };
}

interface GatewayBindingsSchema {
  bindings: GatewayRouteBinding[];
}

const gatewayBindingsStore = new Store<GatewayBindingsSchema>({
  name: 'gateway-bindings',
  defaults: {
    bindings: [],
  },
});

function normalizeToken(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function normalizePeerKind(value: string | undefined | null): GatewayPeerKind {
  const kind = normalizeToken(value);
  if (kind === 'group' || kind === 'channel') return kind;
  return 'dm';
}

function normalizeBinding(input: GatewayRouteBinding): GatewayRouteBinding {
  const fallbackAgentId = normalizeAgentIdForStore(getDefaultAgentId());
  const knownAgents = new Set(listAgents().map((agent) => agent.id));
  const normalizedAgentId = normalizeAgentIdForStore(input.agentId);
  const agentId = knownAgents.has(normalizedAgentId) ? normalizedAgentId : fallbackAgentId;
  const channel = normalizeToken(input.match?.channel);
  if (!channel) {
    throw new Error('binding.match.channel is required');
  }

  const peerId = normalizeText(input.match?.peer?.id);
  const hasPeer = peerId.length > 0;
  const normalized: GatewayRouteBinding = {
    id: normalizeText(input.id) || `binding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    match: {
      channel,
    },
  };

  const accountId = normalizeText(input.match?.accountId);
  if (accountId) {
    normalized.match.accountId = accountId;
  }

  if (hasPeer) {
    normalized.match.peer = {
      kind: normalizePeerKind(input.match?.peer?.kind),
      id: peerId,
    };
  }

  const guildId = normalizeText(input.match?.guildId);
  if (guildId) normalized.match.guildId = guildId;

  const teamId = normalizeText(input.match?.teamId);
  if (teamId) normalized.match.teamId = teamId;

  return normalized;
}

function getBindingsUnsafe(): GatewayRouteBinding[] {
  const current = gatewayBindingsStore.get('bindings');
  return Array.isArray(current) ? current : [];
}

export function listGatewayBindings(): GatewayRouteBinding[] {
  return getBindingsUnsafe();
}

export function setGatewayBindings(bindings: GatewayRouteBinding[]): GatewayRouteBinding[] {
  const normalized = bindings.map(normalizeBinding);
  gatewayBindingsStore.set('bindings', normalized);
  return normalized;
}

export function upsertGatewayBinding(binding: GatewayRouteBinding): GatewayRouteBinding {
  const normalized = normalizeBinding(binding);
  const current = getBindingsUnsafe();
  const idx = current.findIndex((item) => item.id === normalized.id);
  if (idx >= 0) {
    const next = [...current];
    next[idx] = normalized;
    gatewayBindingsStore.set('bindings', next);
  } else {
    gatewayBindingsStore.set('bindings', [normalized, ...current]);
  }
  return normalized;
}

export function removeGatewayBinding(bindingId: string): boolean {
  const id = normalizeText(bindingId);
  if (!id) return false;
  const current = getBindingsUnsafe();
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return false;
  gatewayBindingsStore.set('bindings', next);
  return true;
}

