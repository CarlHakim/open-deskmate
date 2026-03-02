export type GatewayAuthMode = 'none' | 'token' | 'password';
export type GatewayTailscaleMode = 'off' | 'serve' | 'funnel';

export interface GatewayConfig {
  authMode: GatewayAuthMode;
  allowTailscale: boolean;
  tailscaleMode: GatewayTailscaleMode;
  tailscaleResetOnExit: boolean;
  enableTaskGrouping?: boolean;
  recordConnectorDiscovery?: boolean;
}

export interface GatewayRuntimeStatus {
  localUrl: string;
  tailscaleUrl: string | null;
  tailscaleMode: GatewayTailscaleMode;
  authMode: GatewayAuthMode;
  allowTailscale: boolean;
  tokenSet: boolean;
  passwordSet: boolean;
  tailscaleError?: string | null;
}

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

export type GatewayRunStatus = 'accepted' | 'running' | 'done' | 'error';
export type GatewayRunResultStatus = 'success' | 'error' | 'interrupted';

export interface GatewayRunRecord {
  runId: string;
  taskId: string;
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  status: GatewayRunStatus;
  resultStatus?: GatewayRunResultStatus;
  error?: string;
  parentRunId?: string;
  spawnedBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
