import type { GatewayPeerKind } from './gateway';
import type { GatewayConnectorExtensionId, GatewayConnectorRuntimeStatus } from './gateway-connectors';

export type ConnectorDeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sending'
  | 'retrying'
  | 'sent'
  | 'failed'
  | 'silenced'
  | 'filtered';

export type ConnectorDeliveryChunkStatus = 'pending' | 'sending' | 'retrying' | 'sent' | 'failed' | 'skipped';

export type ConnectorDeliveryAttachmentKind = 'file' | 'image';
export type ConnectorDeliveryAttachmentSource = 'path' | 'url' | 'data-url';
export type ConnectorDeliveryAttachmentStatus = 'pending' | 'sent' | 'failed' | 'fallback' | 'skipped';
export type ConnectorDeliveryFormattingMode =
  | 'plain'
  | 'telegram-markdown-v2'
  | 'telegram-markdown-v2-fallback';
export type ConnectorDeliveryParseMode = 'none' | 'mixed' | 'MarkdownV2';
export type ConnectorDeliveryMediaOutcome =
  | 'none'
  | 'pending'
  | 'sent'
  | 'partial-fallback'
  | 'fallback'
  | 'skipped'
  | 'failed';

export interface ConnectorDeliveryChunkRecord {
  index: number;
  length: number;
  status: ConnectorDeliveryChunkStatus;
  sentAt?: string;
  error?: string;
}

export interface ConnectorDeliveryAttemptRecord {
  at: string;
  status: 'queued' | 'sent' | 'failed' | 'retrying' | 'silenced' | 'filtered';
  chunkIndex?: number;
  error?: string;
}

export interface ConnectorDeliveryAttachmentRecord {
  id: string;
  kind: ConnectorDeliveryAttachmentKind;
  source: ConnectorDeliveryAttachmentSource;
  status: ConnectorDeliveryAttachmentStatus;
  name?: string;
  mimeType?: string;
  size?: number;
  path?: string;
  url?: string;
  dataUrl?: string;
  contentHash?: string;
  explicitReference?: boolean;
  historical?: boolean;
  fallbackText?: string;
  sentAt?: string;
  error?: string;
}

export interface ConnectorDeliveryAttachmentInput {
  id?: string;
  kind?: ConnectorDeliveryAttachmentKind;
  name?: string;
  mimeType?: string;
  size?: number;
  path?: string;
  url?: string;
  dataUrl?: string;
  contentHash?: string;
  explicitReference?: boolean;
  historical?: boolean;
}

export interface ConnectorDeliveryRecord {
  id: string;
  connectorId: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  accountId?: string;
  targetId?: string;
  targetKind?: GatewayPeerKind;
  direction: 'outbound' | 'reply';
  status: ConnectorDeliveryStatus;
  textPreview: string;
  originalLength: number;
  filteredLength: number;
  chunkCount: number;
  chunks: ConnectorDeliveryChunkRecord[];
  attachmentCount: number;
  attachments: ConnectorDeliveryAttachmentRecord[];
  internalFiltered: boolean;
  silenced: boolean;
  filterReason?: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
  lastError?: string;
  failureReason?: string;
  attempts: ConnectorDeliveryAttemptRecord[];
  taskId?: string;
  threadId?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ConnectorDeliveryHealth {
  status: 'healthy' | 'backlog' | 'degraded';
  pendingCount: number;
  sendingCount: number;
  retryingCount: number;
  failedCount: number;
  lastFailureReason?: string;
  lastFailedAt?: string;
}

export interface ConnectorDeliveryListResponse {
  deliveries: ConnectorDeliveryRecord[];
}

export interface AgentAlwaysOnStatus {
  agentId: string;
  agentName: string;
  enabled: boolean;
  status: 'off' | 'ready' | 'idle' | 'busy' | 'degraded';
  detail: string;
  activeTaskCount: number;
  connectorCount: number;
  runningConnectorCount: number;
  enabledScheduleCount: number;
  heartbeatEnabled: boolean;
  agenticLoopEnabled: boolean;
}

export type AlwaysOnRuntimeService =
  | 'manager'
  | 'connectors'
  | 'schedules'
  | 'heartbeat'
  | 'memory'
  | 'skills'
  | 'queued-connectors'
  | 'workboard-dispatch';

export type AlwaysOnRuntimeState =
  | 'stopped'
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'degraded';

export type AlwaysOnWorkState = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface AlwaysOnFailureRecord {
  id: string;
  service: AlwaysOnRuntimeService;
  message: string;
  at: string;
  agentId?: string;
  taskId?: string;
  connectorId?: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  recoverable: boolean;
}

export interface AlwaysOnRuntimeServiceStatus {
  service: AlwaysOnRuntimeService;
  state: AlwaysOnRuntimeState;
  detail: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
  lastError?: string;
}

export interface AlwaysOnConnectorWorkRecord {
  taskId: string;
  agentId: string;
  state: AlwaysOnWorkState;
  source: 'gateway' | 'webhook' | 'connector' | 'schedule' | 'heartbeat' | 'manual' | 'workboard';
  queuedAt: string;
  connectorId?: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
  error?: string;
}

export interface AlwaysOnAgentRuntimeStatus extends AgentAlwaysOnStatus {
  managerState: AlwaysOnRuntimeState;
  restartAvailable: boolean;
  connectorRuntimes: GatewayConnectorRuntimeStatus[];
  connectorRuntimeKeys: string[];
  activeTaskIds: string[];
  backgroundActiveTaskIds: string[];
  foregroundActiveTaskIds: string[];
  queuedConnectorTaskIds: string[];
  activeConnectorTaskIds: string[];
  queuedWorkboardTaskIds: string[];
  activeWorkboardTaskIds: string[];
  queuedConnectorTaskCount: number;
  queuedWorkboardTaskCount: number;
  activeWorkboardTaskCount: number;
  foregroundActiveTaskCount: number;
  backgroundActiveTaskCount: number;
  foregroundNonBlocking: boolean;
  nextScheduleAt?: string;
  lastHeartbeatAt?: string;
  nextHeartbeatAt?: string;
  memoryAutomationMode?: 'automatic' | 'approval' | 'off';
  skillAutomationMode?: 'automatic' | 'approval' | 'off';
  lastFailure?: AlwaysOnFailureRecord;
  failureHistory: AlwaysOnFailureRecord[];
}

export interface AlwaysOnStatusSnapshot {
  generatedAt: string;
  activeTaskIds: string[];
  agents: AlwaysOnAgentRuntimeStatus[];
  connectors: GatewayConnectorRuntimeStatus[];
  schedules: {
    total: number;
    enabled: number;
    nextRunAt?: string;
  };
  runtime?: {
    state: AlwaysOnRuntimeState;
    started: boolean;
    generatedAt: string;
    startedAt?: string;
    stoppedAt?: string;
    lastRestartAt?: string;
    enabledAgentCount: number;
    serviceStatuses: AlwaysOnRuntimeServiceStatus[];
    activeBackgroundTaskIds: string[];
    activeForegroundTaskIds: string[];
    queuedConnectorTaskIds: string[];
    activeConnectorTaskIds: string[];
    queuedWorkboardTaskIds: string[];
    activeWorkboardTaskIds: string[];
    taskQueueLength: number;
    failureHistory: AlwaysOnFailureRecord[];
    restartControls: {
      canRestartManager: boolean;
      canRestartAgents: boolean;
      canRestartConnectorRuntimes: boolean;
    };
  };
}
