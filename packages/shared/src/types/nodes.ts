export interface NodePairingPendingRequest {
  requestId: string;
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  remoteIp?: string;
  createdAtMs: number;
  isRepair?: boolean;
}

export interface NodePairingPairedNode {
  nodeId: string;
  token: string;
  displayName?: string;
  badgeColor?: string;
  badgeIcon?: string;
  aiAccessAllowed?: boolean;
  platform?: string;
  version?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  remoteIp?: string;
  createdAtMs: number;
  approvedAtMs: number;
  lastConnectedAtMs?: number;
}

export interface NodePairingList {
  pending: NodePairingPendingRequest[];
  paired: NodePairingPairedNode[];
}
