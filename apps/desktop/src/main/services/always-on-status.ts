import type {
  AgentAlwaysOnStatus,
  AgentProfile,
  AlwaysOnStatusSnapshot,
  GatewayConnectorExtensionConfig,
  GatewayConnectorExtensionId,
  GatewayConnectorRuntimeStatus,
  ScheduledTask,
} from '@accomplish/shared';
import { getTaskManager } from '../opencode/task-manager';
import { getActiveAgentEngineTaskIds, getAgentEngineTaskConfig } from '../runtime/agent-engine';
import { getActiveAgentId } from '../store/appSettings';
import { listAgents, upsertAgent } from '../store/agents';
import { getGatewayConnectorRuntimeKey, listGatewayConnectorExtensionConfigs } from '../store/gatewayConnectorExtensions';
import { listSchedules } from '../store/schedules';
import { startAgentHeartbeatService, stopAgentHeartbeatService } from './agent-heartbeat';
import {
  listActiveWorkboardTaskIds,
  listAlwaysOnWorkboardDispatchRecords,
  listQueuedWorkboardTaskIds,
  startAlwaysOnWorkboardDispatchService,
  stopAlwaysOnWorkboardDispatchService,
} from './always-on-workboard-dispatch';
import {
  listGatewayConnectorRuntimeStatuses,
  restartGatewayConnectorRuntime,
  startGatewayConnectorRuntimes,
  stopGatewayConnectorRuntimes,
} from './gateway-connector-runtimes';
import { resyncSchedules } from './scheduler';

type AlwaysOnRuntimeService =
  | 'manager'
  | 'connectors'
  | 'schedules'
  | 'heartbeat'
  | 'memory'
  | 'skills'
  | 'queued-connectors'
  | 'workboard-dispatch';

type AlwaysOnRuntimeState =
  | 'stopped'
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'degraded';

type AlwaysOnWorkState = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';

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
  memoryAutomationMode: AgentProfile['memoryWriteMode'];
  skillAutomationMode: AgentProfile['skillAutomationMode'];
  lastFailure?: AlwaysOnFailureRecord;
  failureHistory: AlwaysOnFailureRecord[];
}

export interface AlwaysOnRuntimeStatusSnapshot extends AlwaysOnStatusSnapshot {
  agents: AlwaysOnAgentRuntimeStatus[];
  runtime: {
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

interface AgentRuntimeRecord {
  agentId: string;
  state: AlwaysOnRuntimeState;
  startedAt?: string;
  stoppedAt?: string;
  lastRestartAt?: string;
  lastHeartbeatAt?: string;
  nextHeartbeatAt?: string;
}

const MAX_FAILURE_HISTORY = 25;
const BACKGROUND_TASK_PREFIXES = [
  'gateway_',
  'heartbeat_',
  'schedule_',
  'webhook_',
  'manual_',
  'workboard_',
  'discord_',
  'telegram_',
  'slack_',
  'matrix_',
  'msteams_',
  'mattermost_',
  'googlechat_',
  'signal_',
  'whatsapp_',
  'line_',
  'bluebubbles_',
  'imessage_',
  'nextcloud-talk_',
  'nostr_',
  'tlon_',
  'zalo_',
  'zalouser_',
];

let runtimeState: AlwaysOnRuntimeState = 'stopped';
let runtimeStartedAt: string | undefined;
let runtimeStoppedAt: string | undefined;
let runtimeLastRestartAt: string | undefined;
let failureSequence = 0;

const agentRuntimeRecords = new Map<string, AgentRuntimeRecord>();
const serviceStatuses = new Map<AlwaysOnRuntimeService, AlwaysOnRuntimeServiceStatus>();
const failureHistory: AlwaysOnFailureRecord[] = [];
const connectorWorkRecords = new Map<string, AlwaysOnConnectorWorkRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function resolveAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function setServiceStatus(
  service: AlwaysOnRuntimeService,
  patch: Partial<AlwaysOnRuntimeServiceStatus>
): AlwaysOnRuntimeServiceStatus {
  const previous = serviceStatuses.get(service);
  const next: AlwaysOnRuntimeServiceStatus = {
    service,
    state: previous?.state ?? 'stopped',
    detail: previous?.detail ?? 'Not started.',
    updatedAt: nowIso(),
    ...previous,
    ...patch,
  };
  serviceStatuses.set(service, next);
  return next;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown always-on runtime error.');
}

export function recordAlwaysOnRuntimeFailure(input: {
  service: AlwaysOnRuntimeService;
  error: unknown;
  agentId?: string;
  taskId?: string;
  connectorId?: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  recoverable?: boolean;
}): AlwaysOnFailureRecord {
  const failure: AlwaysOnFailureRecord = {
    id: `always_on_failure_${Date.now()}_${failureSequence += 1}`,
    service: input.service,
    message: normalizeErrorMessage(input.error),
    at: nowIso(),
    agentId: input.agentId,
    taskId: input.taskId,
    connectorId: input.connectorId,
    connectorInstanceId: input.connectorInstanceId,
    recoverable: input.recoverable !== false,
  };
  failureHistory.unshift(failure);
  failureHistory.splice(MAX_FAILURE_HISTORY);
  if (input.agentId) {
    const record = ensureAgentRuntimeRecord(input.agentId);
    record.state = 'degraded';
  }
  setServiceStatus(input.service, {
    state: 'degraded',
    detail: failure.message,
    lastError: failure.message,
  });
  return failure;
}

function ensureAgentRuntimeRecord(agentId: string): AgentRuntimeRecord {
  const normalized = resolveAgentId(agentId);
  const existing = agentRuntimeRecords.get(normalized);
  if (existing) return existing;
  const created: AgentRuntimeRecord = {
    agentId: normalized,
    state: runtimeState === 'stopped' ? 'stopped' : 'idle',
  };
  agentRuntimeRecords.set(normalized, created);
  return created;
}

function markEnabledAgentRuntimeStarted(agent: AgentProfile): void {
  const record = ensureAgentRuntimeRecord(agent.id);
  if (!record.startedAt) {
    record.startedAt = runtimeStartedAt ?? nowIso();
  }
  if (record.state !== 'degraded') {
    record.state = 'running';
  }
  record.stoppedAt = undefined;
  record.nextHeartbeatAt = computeNextHeartbeatAt(agent, record);
}

function markAgentRuntimeStopped(agentId: string): void {
  const record = ensureAgentRuntimeRecord(agentId);
  record.state = 'stopped';
  record.stoppedAt = nowIso();
}

function isBackgroundTaskId(taskId: string): boolean {
  return BACKGROUND_TASK_PREFIXES.some((prefix) => taskId.startsWith(prefix));
}

function getTaskQueueLength(): number {
  const taskManager = getTaskManager() as ReturnType<typeof getTaskManager> & {
    getQueueLength?: () => number;
  };
  if (typeof taskManager.getQueueLength !== 'function') return 0;
  return taskManager.getQueueLength();
}

function resolveRuntimeKey(status: Pick<GatewayConnectorRuntimeStatus, 'connectorId' | 'instanceId' | 'runtimeKey'>): string {
  return status.runtimeKey
    ? status.runtimeKey
    : getGatewayConnectorRuntimeKey(status.connectorId, status.instanceId);
}

function getRelevantConnectorConfigs(params: {
  agentId: string;
  activeAgentId: string;
  connectorConfigs: GatewayConnectorExtensionConfig[];
}): GatewayConnectorExtensionConfig[] {
  return params.connectorConfigs.filter((config) => {
    const configAgentId = resolveAgentId(config.agentId);
    if (configAgentId) return configAgentId === params.agentId;
    return params.activeAgentId === params.agentId;
  });
}

function getRelevantConnectors(params: {
  connectorConfigs: GatewayConnectorExtensionConfig[];
  connectors: GatewayConnectorRuntimeStatus[];
}): GatewayConnectorRuntimeStatus[] {
  const relevantRuntimeKeys = new Set(
    params.connectorConfigs.map((config) => getGatewayConnectorRuntimeKey(config.id, config.instanceId))
  );
  const relevantConnectorIds = new Set(params.connectorConfigs.map((config) => config.id));
  return params.connectors.filter((status) =>
    relevantRuntimeKeys.has(resolveRuntimeKey(status)) || relevantConnectorIds.has(status.connectorId)
  );
}

function getEnabledSchedulesForAgent(schedules: ScheduledTask[], agentId: string): ScheduledTask[] {
  return schedules.filter((schedule) =>
    schedule.enabled && resolveAgentId(schedule.agentId) === agentId
  );
}

function getNextScheduleAt(schedules: ScheduledTask[]): string | undefined {
  return schedules
    .filter((schedule) => schedule.enabled && schedule.nextRunAt)
    .map((schedule) => schedule.nextRunAt as string)
    .sort()[0];
}

function toIsoFromMs(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  return new Date(value as number).toISOString();
}

function parseTimeOfDay(value: unknown, fallback = '09:00'): { hours: number; minutes: number } {
  const raw = typeof value === 'string' ? value.trim() : fallback;
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return parseTimeOfDay(fallback, '09:00');
  return {
    hours: Number.parseInt(match[1], 10),
    minutes: Number.parseInt(match[2], 10),
  };
}

function computeNextDailyHeartbeatAt(agent: AgentProfile, now = new Date()): string {
  const { hours, minutes } = parseTimeOfDay(agent.heartbeatDailyTime);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function computeNextHeartbeatAt(agent: AgentProfile, record?: AgentRuntimeRecord): string | undefined {
  if (!agent.heartbeatEnabled) return undefined;
  if (record?.nextHeartbeatAt && Date.parse(record.nextHeartbeatAt) > Date.now()) {
    return record.nextHeartbeatAt;
  }
  if (agent.heartbeatScheduleMode === 'daily') {
    return computeNextDailyHeartbeatAt(agent);
  }
  const intervalMinutes = typeof agent.heartbeatIntervalMinutes === 'number'
    ? agent.heartbeatIntervalMinutes
    : Math.max(1, Math.round((agent.heartbeatIntervalSeconds ?? 5 * 60) / 60));
  const base = record?.lastHeartbeatAt ? Date.parse(record.lastHeartbeatAt) : Date.now();
  return toIsoFromMs(base + Math.max(1, intervalMinutes) * 60 * 1000);
}

function getAgentFailures(agentId: string): AlwaysOnFailureRecord[] {
  return failureHistory.filter((failure) => resolveAgentId(failure.agentId) === agentId);
}

function getConnectorWorkForAgent(agentId: string): AlwaysOnConnectorWorkRecord[] {
  return Array.from(connectorWorkRecords.values())
    .filter((record) => resolveAgentId(record.agentId) === agentId)
    .filter((record) => record.state === 'queued' || record.state === 'active');
}

function getQueuedConnectorTaskIds(): string[] {
  return Array.from(connectorWorkRecords.values())
    .filter((record) => record.state === 'queued')
    .map((record) => record.taskId);
}

function getActiveConnectorTaskIds(): string[] {
  return Array.from(connectorWorkRecords.values())
    .filter((record) => record.state === 'active')
    .map((record) => record.taskId);
}

function buildRuntimeTaskPartition(activeTaskIds: string[]): {
  background: string[];
  foreground: string[];
} {
  const background: string[] = [];
  const foreground: string[] = [];
  for (const taskId of activeTaskIds) {
    if (isBackgroundTaskId(taskId)) {
      background.push(taskId);
    } else {
      foreground.push(taskId);
    }
  }
  return { background, foreground };
}

function hasEnabledAgentRuntimeWork(params: {
  enabledAgents: AgentProfile[];
  activeAgentId: string;
  connectorConfigs: GatewayConnectorExtensionConfig[];
  schedules: ScheduledTask[];
}): {
  hasConnectors: boolean;
  hasSchedules: boolean;
  hasHeartbeat: boolean;
  hasMemory: boolean;
  hasSkills: boolean;
  hasWorkboardDispatch: boolean;
} {
  const enabledAgentIds = new Set(params.enabledAgents.map((agent) => resolveAgentId(agent.id)));
  const hasConnectors = params.connectorConfigs.some((config) => {
    const configAgentId = resolveAgentId(config.agentId);
    const ownerAgentId = configAgentId || params.activeAgentId;
    return config.enabled && enabledAgentIds.has(ownerAgentId);
  });
  const hasSchedules = params.schedules.some((schedule) =>
    schedule.enabled && enabledAgentIds.has(resolveAgentId(schedule.agentId))
  );
  const hasHeartbeat = params.enabledAgents.some((agent) => Boolean(agent.heartbeatEnabled));
  const hasMemory = params.enabledAgents.some((agent) => agent.memoryWriteMode !== 'off');
  const hasSkills = params.enabledAgents.some((agent) => agent.skillAutomationMode !== 'off');
  const hasWorkboardDispatch = params.enabledAgents.some((agent) =>
    agent.alwaysOnWorkboardDispatchEnabled === true
    && Array.isArray(agent.alwaysOnWorkboardProjectIds)
    && agent.alwaysOnWorkboardProjectIds.length > 0
  );
  return { hasConnectors, hasSchedules, hasHeartbeat, hasMemory, hasSkills, hasWorkboardDispatch };
}

async function startRuntimeService(
  service: AlwaysOnRuntimeService,
  detail: string,
  starter: () => Promise<void> | void
): Promise<void> {
  const startedAt = nowIso();
  setServiceStatus(service, {
    state: 'starting',
    detail,
    startedAt,
    stoppedAt: undefined,
    lastError: undefined,
  });
  try {
    await starter();
    setServiceStatus(service, {
      state: 'running',
      detail,
      startedAt,
      stoppedAt: undefined,
      lastError: undefined,
    });
  } catch (error) {
    recordAlwaysOnRuntimeFailure({ service, error, recoverable: true });
  }
}

async function stopRuntimeService(
  service: AlwaysOnRuntimeService,
  detail: string,
  stopper: () => Promise<void> | void
): Promise<void> {
  setServiceStatus(service, {
    state: 'stopping',
    detail,
  });
  try {
    await stopper();
    setServiceStatus(service, {
      state: 'stopped',
      detail: 'Stopped.',
      stoppedAt: nowIso(),
      lastError: undefined,
    });
  } catch (error) {
    recordAlwaysOnRuntimeFailure({ service, error, recoverable: true });
  }
}

export async function startAlwaysOnRuntimeManager(): Promise<AlwaysOnRuntimeStatusSnapshot> {
  runtimeState = 'starting';
  runtimeStartedAt = runtimeStartedAt ?? nowIso();
  runtimeStoppedAt = undefined;
  setServiceStatus('manager', {
    state: 'starting',
    startedAt: runtimeStartedAt,
    stoppedAt: undefined,
    detail: 'Starting always-on runtime manager.',
    lastError: undefined,
  });

  const agents = listAgents();
  const activeAgentId = resolveAgentId(getActiveAgentId());
  const connectorConfigs = listGatewayConnectorExtensionConfigs();
  const schedules = listSchedules();
  const enabledAgents = agents.filter((agent) => agent.alwaysOnEnabled === true);
  const work = hasEnabledAgentRuntimeWork({
    enabledAgents,
    activeAgentId,
    connectorConfigs,
    schedules,
  });

  for (const agent of enabledAgents) {
    markEnabledAgentRuntimeStarted(agent);
  }

  for (const agent of agents) {
    if (agent.alwaysOnEnabled !== true) {
      markAgentRuntimeStopped(agent.id);
    }
  }

  if (enabledAgents.length === 0) {
    runtimeState = 'idle';
    setServiceStatus('manager', {
      state: 'idle',
      detail: 'No agents have always-on enabled.',
      startedAt: runtimeStartedAt,
    });
    return getAlwaysOnStatusSnapshot();
  }

  if (work.hasConnectors) {
    await startRuntimeService('connectors', 'Connector listeners are supervised by always-on.', () =>
      startGatewayConnectorRuntimes()
    );
  } else {
    setServiceStatus('connectors', {
      state: 'idle',
      detail: 'No enabled connector listeners for always-on agents.',
    });
  }

  if (work.hasSchedules) {
    await startRuntimeService('schedules', 'Schedules are synced for always-on agents.', () => {
      resyncSchedules();
    });
  } else {
    setServiceStatus('schedules', {
      state: 'idle',
      detail: 'No enabled schedules for always-on agents.',
    });
  }

  if (work.hasHeartbeat) {
    await startRuntimeService('heartbeat', 'Heartbeat service is supervised by always-on.', () => {
      startAgentHeartbeatService();
    });
  } else {
    setServiceStatus('heartbeat', {
      state: 'idle',
      detail: 'No heartbeat triggers enabled for always-on agents.',
    });
  }

  setServiceStatus('memory', {
    state: work.hasMemory ? 'running' : 'idle',
    detail: work.hasMemory
      ? 'Automatic memory policy is visible to always-on status.'
      : 'Memory automation is disabled for always-on agents.',
  });
  setServiceStatus('skills', {
    state: work.hasSkills ? 'running' : 'idle',
    detail: work.hasSkills
      ? 'Skill automation policy is visible to always-on status.'
      : 'Skill automation is disabled for always-on agents.',
  });
  setServiceStatus('queued-connectors', {
    state: 'running',
    detail: 'Connector task queue observer is active.',
  });
  if (work.hasWorkboardDispatch) {
    await startRuntimeService('workboard-dispatch', 'Workboard dispatch is scanning ready assigned items.', () => {
      startAlwaysOnWorkboardDispatchService();
    });
  } else {
    stopAlwaysOnWorkboardDispatchService();
    setServiceStatus('workboard-dispatch', {
      state: 'idle',
      detail: 'No enabled Workboard dispatch projects for always-on agents.',
    });
  }

  runtimeState = Array.from(serviceStatuses.values()).some((status) => status.state === 'degraded')
    ? 'degraded'
    : 'running';
  setServiceStatus('manager', {
    state: runtimeState,
    detail: runtimeState === 'degraded'
      ? 'Always-on runtime manager started with degraded services.'
      : 'Always-on runtime manager is running.',
    startedAt: runtimeStartedAt,
  });
  return getAlwaysOnStatusSnapshot();
}

export async function stopAlwaysOnRuntimeManager(): Promise<AlwaysOnRuntimeStatusSnapshot> {
  runtimeState = 'stopping';
  setServiceStatus('manager', {
    state: 'stopping',
    detail: 'Stopping always-on runtime manager.',
  });

  await stopRuntimeService('connectors', 'Stopping connector listeners.', async () => {
    await stopGatewayConnectorRuntimes();
  });
  stopAgentHeartbeatService();
  stopAlwaysOnWorkboardDispatchService();

  runtimeState = 'stopped';
  runtimeStoppedAt = nowIso();
  for (const record of agentRuntimeRecords.values()) {
    record.state = 'stopped';
    record.stoppedAt = runtimeStoppedAt;
  }
  for (const service of serviceStatuses.keys()) {
    setServiceStatus(service, {
      state: 'stopped',
      detail: 'Stopped.',
      stoppedAt: runtimeStoppedAt,
    });
  }
  setServiceStatus('manager', {
    state: 'stopped',
    detail: 'Always-on runtime manager is stopped.',
    stoppedAt: runtimeStoppedAt,
  });
  return getAlwaysOnStatusSnapshot();
}

export async function restartAlwaysOnRuntimeManager(): Promise<AlwaysOnRuntimeStatusSnapshot> {
  runtimeLastRestartAt = nowIso();
  await stopAlwaysOnRuntimeManager();
  runtimeStartedAt = nowIso();
  return startAlwaysOnRuntimeManager();
}

export async function restartAgentAlwaysOnRuntime(agentId: string): Promise<AlwaysOnAgentRuntimeStatus> {
  const normalizedAgentId = resolveAgentId(agentId);
  const agents = listAgents();
  const agent = agents.find((entry) => resolveAgentId(entry.id) === normalizedAgentId);
  if (!agent) {
    throw new Error('Agent not found');
  }
  const record = ensureAgentRuntimeRecord(agent.id);
  record.lastRestartAt = nowIso();
  record.state = agent.alwaysOnEnabled ? 'starting' : 'stopped';

  if (agent.alwaysOnEnabled) {
    let restartHadFailure = false;
    const activeAgentId = resolveAgentId(getActiveAgentId());
    const connectorConfigs = getRelevantConnectorConfigs({
      agentId: normalizedAgentId,
      activeAgentId,
      connectorConfigs: listGatewayConnectorExtensionConfigs(),
    }).filter((config) => config.enabled);
    for (const config of connectorConfigs) {
      try {
        await restartGatewayConnectorRuntime(config.id, config.instanceId);
      } catch (error) {
        restartHadFailure = true;
        recordAlwaysOnRuntimeFailure({
          service: 'connectors',
          error,
          agentId: agent.id,
          connectorId: config.id,
          connectorInstanceId: config.instanceId,
          recoverable: true,
        });
      }
    }
    if (agent.heartbeatEnabled) {
      startAgentHeartbeatService();
    }
    if (agent.alwaysOnWorkboardDispatchEnabled && (agent.alwaysOnWorkboardProjectIds || []).length > 0) {
      startAlwaysOnWorkboardDispatchService();
    }
    resyncSchedules();
    if (!restartHadFailure) {
      record.state = 'running';
    }
  }

  const status = getAlwaysOnStatusSnapshot().agents.find((entry) => entry.agentId === agent.id);
  if (!status) {
    throw new Error('Unable to resolve always-on status.');
  }
  return status;
}

export function registerAlwaysOnQueuedConnectorTask(input: {
  taskId: string;
  agentId: string;
  source?: AlwaysOnConnectorWorkRecord['source'];
  connectorId?: GatewayConnectorExtensionId;
  connectorInstanceId?: string;
  detail?: string;
}): AlwaysOnConnectorWorkRecord {
  const record: AlwaysOnConnectorWorkRecord = {
    taskId: input.taskId,
    agentId: input.agentId,
    source: input.source ?? 'connector',
    connectorId: input.connectorId,
    connectorInstanceId: input.connectorInstanceId,
    state: 'queued',
    queuedAt: nowIso(),
    detail: input.detail,
  };
  connectorWorkRecords.set(input.taskId, record);
  return record;
}

export function markAlwaysOnConnectorTaskActive(taskId: string): AlwaysOnConnectorWorkRecord | null {
  const record = connectorWorkRecords.get(taskId);
  if (!record) return null;
  record.state = 'active';
  record.startedAt = record.startedAt ?? nowIso();
  return record;
}

export function finalizeAlwaysOnConnectorTask(taskId: string, input?: {
  state?: Extract<AlwaysOnWorkState, 'completed' | 'failed' | 'cancelled'>;
  error?: unknown;
  detail?: string;
}): AlwaysOnConnectorWorkRecord | null {
  const record = connectorWorkRecords.get(taskId);
  if (!record) return null;
  record.state = input?.state ?? (input?.error ? 'failed' : 'completed');
  record.finishedAt = nowIso();
  record.detail = input?.detail ?? record.detail;
  if (input?.error) {
    record.error = normalizeErrorMessage(input.error);
    recordAlwaysOnRuntimeFailure({
      service: 'queued-connectors',
      error: record.error,
      agentId: record.agentId,
      taskId,
      connectorId: record.connectorId,
      connectorInstanceId: record.connectorInstanceId,
      recoverable: true,
    });
  }
  return record;
}

export function recordAlwaysOnHeartbeat(agentId: string, input?: {
  nextHeartbeatAt?: string;
  error?: unknown;
}): void {
  const record = ensureAgentRuntimeRecord(agentId);
  if (input?.error) {
    recordAlwaysOnRuntimeFailure({
      service: 'heartbeat',
      error: input.error,
      agentId,
      recoverable: true,
    });
    return;
  }
  record.lastHeartbeatAt = nowIso();
  record.nextHeartbeatAt = input?.nextHeartbeatAt;
}

export function getAlwaysOnStatusSnapshot(): AlwaysOnRuntimeStatusSnapshot {
  const agents = listAgents();
  const activeAgentId = resolveAgentId(getActiveAgentId());
  const connectors = listGatewayConnectorRuntimeStatuses();
  const connectorConfigs = listGatewayConnectorExtensionConfigs();
  const schedules = listSchedules();
  const activeTaskIds = getActiveAgentEngineTaskIds();
  const taskPartition = buildRuntimeTaskPartition(activeTaskIds);
  const taskQueueLength = getTaskQueueLength();

  const agentStatuses: AlwaysOnAgentRuntimeStatus[] = agents.map((agent) => {
    const agentId = resolveAgentId(agent.id);
    const runtimeRecord = ensureAgentRuntimeRecord(agent.id);
    const relevantConnectorConfigs = getRelevantConnectorConfigs({
      agentId,
      activeAgentId,
      connectorConfigs,
    });
    const relevantConnectors = getRelevantConnectors({
      connectorConfigs: relevantConnectorConfigs,
      connectors,
    });
    const connectorRuntimeKeys = Array.from(new Set(
      relevantConnectorConfigs.map((config) => getGatewayConnectorRuntimeKey(config.id, config.instanceId))
    ));
    const enabledSchedules = getEnabledSchedulesForAgent(schedules, agentId);
    const agentActiveTaskIds = activeTaskIds.filter((taskId) => {
      const config = getAgentEngineTaskConfig(taskId) as { agentId?: string } | undefined;
      return resolveAgentId(config?.agentId) === agentId;
    });
    const backgroundActiveTaskIds = agentActiveTaskIds.filter(isBackgroundTaskId);
    const foregroundActiveTaskIds = agentActiveTaskIds.filter((taskId) => !isBackgroundTaskId(taskId));
    const activeTaskCount = agentActiveTaskIds.length;
    const connectorWork = getConnectorWorkForAgent(agentId);
    const workboardWork = listAlwaysOnWorkboardDispatchRecords()
      .filter((record) => resolveAgentId(record.agentId) === agentId)
      .filter((record) => record.state === 'queued' || record.state === 'active');
    const queuedConnectorTaskIds = connectorWork
      .filter((record) => record.state === 'queued')
      .map((record) => record.taskId);
    const activeConnectorTaskIds = connectorWork
      .filter((record) => record.state === 'active')
      .map((record) => record.taskId);
    const queuedWorkboardTaskIds = workboardWork
      .filter((record) => record.state === 'queued')
      .map((record) => record.taskId);
    const activeWorkboardTaskIds = workboardWork
      .filter((record) => record.state === 'active')
      .map((record) => record.taskId);
    const runningConnectorCount = relevantConnectors.filter((status) => status.running).length;
    const connectorCount = relevantConnectors.length;
    const heartbeatEnabled = Boolean(agent.heartbeatEnabled);
    const agenticLoopEnabled = Boolean(agent.agenticLoopEnabled);
    const workboardDispatchEnabled = agent.alwaysOnWorkboardDispatchEnabled === true
      && (agent.alwaysOnWorkboardProjectIds || []).length > 0;
    const enabled = agent.alwaysOnEnabled === true;
    const failures = getAgentFailures(agentId);
    const lastFailure = failures[0];

    let status: AlwaysOnAgentRuntimeStatus['status'] = 'off';
    let detail = 'Always-on is disabled.';
    if (enabled) {
      if (lastFailure && runtimeRecord.state === 'degraded') {
        status = 'degraded';
        detail = lastFailure.message;
      } else if (backgroundActiveTaskIds.length > 0 || activeConnectorTaskIds.length > 0 || activeWorkboardTaskIds.length > 0) {
        status = 'busy';
        detail = 'Agent is currently running background work.';
      } else if (queuedConnectorTaskIds.length > 0 || queuedWorkboardTaskIds.length > 0) {
        status = 'ready';
        detail = queuedWorkboardTaskIds.length > 0
          ? 'Agent has queued Workboard dispatch work.'
          : 'Agent has queued connector work.';
      } else if (runningConnectorCount > 0 || enabledSchedules.length > 0 || heartbeatEnabled || workboardDispatchEnabled) {
        status = 'ready';
        detail = 'Always-on triggers are configured and runtime state is available.';
      } else if (connectorCount > 0) {
        status = 'degraded';
        detail = 'Connectors are configured but no connector runtime is currently running.';
      } else {
        status = 'idle';
        detail = 'Always-on is enabled, but no connectors, schedules, or heartbeat are configured.';
      }
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      enabled,
      status,
      detail,
      activeTaskCount,
      activeTaskIds: agentActiveTaskIds,
      backgroundActiveTaskIds,
      foregroundActiveTaskIds,
      foregroundActiveTaskCount: foregroundActiveTaskIds.length,
      backgroundActiveTaskCount: backgroundActiveTaskIds.length,
      foregroundNonBlocking: true,
      connectorCount,
      runningConnectorCount,
      connectorRuntimes: relevantConnectors,
      connectorRuntimeKeys,
      enabledScheduleCount: enabledSchedules.length,
      heartbeatEnabled,
      agenticLoopEnabled,
      queuedConnectorTaskIds,
      activeConnectorTaskIds,
      queuedWorkboardTaskIds,
      activeWorkboardTaskIds,
      queuedConnectorTaskCount: queuedConnectorTaskIds.length,
      queuedWorkboardTaskCount: queuedWorkboardTaskIds.length,
      activeWorkboardTaskCount: activeWorkboardTaskIds.length,
      managerState: enabled ? runtimeRecord.state : 'stopped',
      restartAvailable: enabled,
      nextScheduleAt: getNextScheduleAt(enabledSchedules),
      lastHeartbeatAt: runtimeRecord.lastHeartbeatAt,
      nextHeartbeatAt: computeNextHeartbeatAt(agent, runtimeRecord),
      memoryAutomationMode: agent.memoryWriteMode,
      skillAutomationMode: agent.skillAutomationMode,
      lastFailure,
      failureHistory: failures,
    };
  });

  const generatedAt = nowIso();
  const enabledAgentCount = agentStatuses.filter((agent) => agent.enabled).length;

  return {
    generatedAt,
    activeTaskIds,
    agents: agentStatuses,
    connectors,
    schedules: {
      total: schedules.length,
      enabled: schedules.filter((schedule) => schedule.enabled).length,
      nextRunAt: getNextScheduleAt(schedules),
    },
    runtime: {
      state: runtimeState,
      started: runtimeState !== 'stopped',
      generatedAt,
      startedAt: runtimeStartedAt,
      stoppedAt: runtimeStoppedAt,
      lastRestartAt: runtimeLastRestartAt,
      enabledAgentCount,
      serviceStatuses: Array.from(serviceStatuses.values()),
      activeBackgroundTaskIds: taskPartition.background,
      activeForegroundTaskIds: taskPartition.foreground,
      queuedConnectorTaskIds: getQueuedConnectorTaskIds(),
      activeConnectorTaskIds: getActiveConnectorTaskIds(),
      queuedWorkboardTaskIds: listQueuedWorkboardTaskIds(),
      activeWorkboardTaskIds: listActiveWorkboardTaskIds(),
      taskQueueLength,
      failureHistory: [...failureHistory],
      restartControls: {
        canRestartManager: true,
        canRestartAgents: true,
        canRestartConnectorRuntimes: true,
      },
    },
  };
}

export function setAgentAlwaysOnEnabled(agentId: string, enabled: boolean): AgentAlwaysOnStatus {
  const normalizedAgentId = resolveAgentId(agentId);
  const existing = listAgents().find((agent) => resolveAgentId(agent.id) === normalizedAgentId);
  if (!existing) {
    throw new Error('Agent not found');
  }
  upsertAgent({
    id: existing.id,
    name: existing.name,
    alwaysOnEnabled: enabled,
  });
  if (!enabled) {
    markAgentRuntimeStopped(existing.id);
  } else if (runtimeState !== 'stopped') {
    const updated = listAgents().find((agent) => resolveAgentId(agent.id) === normalizedAgentId);
    if (updated) {
      markEnabledAgentRuntimeStarted(updated);
      void startAlwaysOnRuntimeManager().catch((error) => {
        recordAlwaysOnRuntimeFailure({
          service: 'manager',
          error,
          agentId: existing.id,
          recoverable: true,
        });
      });
    }
  }
  const status = getAlwaysOnStatusSnapshot().agents.find((agent) => agent.agentId === existing.id);
  if (!status) {
    throw new Error('Unable to resolve always-on status.');
  }
  return status;
}
