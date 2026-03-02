import { getDefaultAgentId, listAgents, normalizeAgentIdForStore } from '../store/agents';
import { listGatewayBindings, type GatewayPeerKind } from '../store/gatewayBindings';

export type GatewayRoutePeer = {
  kind: GatewayPeerKind;
  id: string;
};

export type GatewayRouteMatchKind =
  | 'binding.peer'
  | 'binding.guild'
  | 'binding.team'
  | 'binding.account'
  | 'binding.channel'
  | 'explicit'
  | 'default';

export interface ResolveGatewayRouteInput {
  channel: string;
  accountId?: string | null;
  peer?: GatewayRoutePeer | null;
  guildId?: string | null;
  teamId?: string | null;
  agentIdOverride?: string | null;
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer';
}

export interface ResolvedGatewayRoute {
  agentId: string;
  channel: string;
  accountId: string;
  sessionKey: string;
  mainSessionKey: string;
  matchedBy: GatewayRouteMatchKind;
}

const DEFAULT_ACCOUNT_ID = 'default';

function normalizeToken(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? '').trim();
}

export function normalizeGatewayChannel(channel: string | undefined | null): string {
  return normalizeToken(channel) || 'unknown';
}

export function normalizeGatewayAccountId(accountId: string | undefined | null): string {
  const normalized = normalizeText(accountId);
  return normalized || DEFAULT_ACCOUNT_ID;
}

function pickExistingAgentId(agentId: string | undefined | null): string {
  const normalized = normalizeAgentIdForStore(agentId);
  const known = new Set(listAgents().map((agent) => agent.id));
  if (known.has(normalized)) return normalized;
  const fallback = normalizeAgentIdForStore(getDefaultAgentId());
  if (known.has(fallback)) return fallback;
  return normalized || 'main';
}

function matchAccount(bindingAccountId: string | undefined, actualAccountId: string): boolean {
  const expected = normalizeText(bindingAccountId);
  if (!expected) return actualAccountId === DEFAULT_ACCOUNT_ID;
  if (expected === '*') return true;
  return expected === actualAccountId;
}

export function buildGatewayMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentIdForStore(agentId)}:main`;
}

export function buildGatewaySessionKey(params: {
  agentId: string;
  channel: string;
  peer?: GatewayRoutePeer | null;
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer';
}): string {
  const normalizedAgent = normalizeAgentIdForStore(params.agentId);
  const normalizedChannel = normalizeGatewayChannel(params.channel);
  const peer = params.peer;

  if (!peer) {
    return buildGatewayMainSessionKey(normalizedAgent);
  }

  const peerKind = peer.kind;
  const peerId = normalizeText(peer.id).toLowerCase() || 'unknown';
  if (peerKind === 'dm') {
    const dmScope = params.dmScope ?? 'per-peer';
    if (dmScope === 'main') return buildGatewayMainSessionKey(normalizedAgent);
    if (dmScope === 'per-channel-peer') {
      return `agent:${normalizedAgent}:${normalizedChannel}:dm:${peerId}`;
    }
    return `agent:${normalizedAgent}:dm:${peerId}`;
  }

  return `agent:${normalizedAgent}:${normalizedChannel}:${peerKind}:${peerId}`;
}

export function resolveAgentIdFromSessionKey(sessionKey: string | undefined | null): string {
  const key = normalizeToken(sessionKey);
  if (!key.startsWith('agent:')) return pickExistingAgentId(undefined);
  const parts = key.split(':');
  const agentId = parts.length >= 2 ? parts[1] : '';
  return pickExistingAgentId(agentId);
}

export function resolveGatewayRoute(input: ResolveGatewayRouteInput): ResolvedGatewayRoute {
  const channel = normalizeGatewayChannel(input.channel);
  const accountId = normalizeGatewayAccountId(input.accountId);
  const peer = input.peer
    ? { kind: input.peer.kind, id: normalizeText(input.peer.id) }
    : null;
  const guildId = normalizeText(input.guildId);
  const teamId = normalizeText(input.teamId);
  const dmScope = input.dmScope ?? 'per-peer';

  const explicitAgentId = normalizeText(input.agentIdOverride);
  if (explicitAgentId) {
    const agentId = pickExistingAgentId(explicitAgentId);
    const sessionKey = buildGatewaySessionKey({
      agentId,
      channel,
      peer,
      dmScope,
    });
    return {
      agentId,
      channel,
      accountId,
      sessionKey,
      mainSessionKey: buildGatewayMainSessionKey(agentId),
      matchedBy: 'explicit',
    };
  }

  const bindings = listGatewayBindings().filter((binding) => {
    const bindingChannel = normalizeGatewayChannel(binding.match?.channel);
    if (bindingChannel !== channel) return false;
    return matchAccount(binding.match?.accountId, accountId);
  });

  const choose = (agentId: string, matchedBy: GatewayRouteMatchKind): ResolvedGatewayRoute => {
    const resolvedAgentId = pickExistingAgentId(agentId);
    return {
      agentId: resolvedAgentId,
      channel,
      accountId,
      sessionKey: buildGatewaySessionKey({
        agentId: resolvedAgentId,
        channel,
        peer,
        dmScope,
      }),
      mainSessionKey: buildGatewayMainSessionKey(resolvedAgentId),
      matchedBy,
    };
  };

  if (peer) {
    const peerMatch = bindings.find((binding) => {
      const matchedPeer = binding.match?.peer;
      if (!matchedPeer) return false;
      return matchedPeer.kind === peer.kind && normalizeText(matchedPeer.id) === peer.id;
    });
    if (peerMatch) return choose(peerMatch.agentId, 'binding.peer');
  }

  if (guildId) {
    const guildMatch = bindings.find((binding) => normalizeText(binding.match?.guildId) === guildId);
    if (guildMatch) return choose(guildMatch.agentId, 'binding.guild');
  }

  if (teamId) {
    const teamMatch = bindings.find((binding) => normalizeText(binding.match?.teamId) === teamId);
    if (teamMatch) return choose(teamMatch.agentId, 'binding.team');
  }

  const accountMatch = bindings.find((binding) => {
    const accountMatchValue = normalizeText(binding.match?.accountId);
    return accountMatchValue !== '*' && !binding.match?.peer && !binding.match?.guildId && !binding.match?.teamId;
  });
  if (accountMatch) return choose(accountMatch.agentId, 'binding.account');

  const channelMatch = bindings.find((binding) => {
    return normalizeText(binding.match?.accountId) === '*' &&
      !binding.match?.peer &&
      !binding.match?.guildId &&
      !binding.match?.teamId;
  });
  if (channelMatch) return choose(channelMatch.agentId, 'binding.channel');

  return choose(getDefaultAgentId(), 'default');
}

