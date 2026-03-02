import Store from 'electron-store';
import type { AgentConfig, AgentProfile } from '@accomplish/shared';

interface AgentsStoreSchema {
  agents: AgentProfile[];
  defaultAgentId: string;
}

const DEFAULT_AGENT_ID = 'main';
const DEFAULT_AGENT_NAME = 'Main';
const DEFAULT_AGENTIC_LOOP_ENABLED = false;
const DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS = 4;
const DEFAULT_AGENTIC_LOOP_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_ENABLED = false;
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 5 * 60;
const DEFAULT_HEARTBEAT_SCHEDULE_MODE: 'interval' | 'daily' = 'interval';
const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 5;
const DEFAULT_HEARTBEAT_DAILY_TIME = '09:00';
const DEFAULT_HEARTBEAT_TIME_ZONE = 'system';
const DEFAULT_HEARTBEAT_WINDOW_ENABLED = false;
const DEFAULT_HEARTBEAT_WINDOW_START_TIME = '09:00';
const DEFAULT_HEARTBEAT_WINDOW_END_TIME = '17:00';
const DEFAULT_AUTO_SKILL_ENABLED = false;
const DEFAULT_AUTO_SKILL_AUTO_PROMOTE_LOW_RISK = false;

const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return DEFAULT_AGENT_ID;
  if (VALID_ID_RE.test(trimmed)) return trimmed.toLowerCase();
  return (
    trimmed
      .toLowerCase()
      .replace(INVALID_CHARS_RE, '-')
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '')
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(typeof value === 'string' ? value : '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeAgenticLoopMaxIterations(value: unknown, fallback = DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS): number {
  return clampInteger(value, fallback, 1, 20);
}

function normalizeAgenticLoopTimeoutMs(value: unknown, fallback = DEFAULT_AGENTIC_LOOP_TIMEOUT_MS): number {
  return clampInteger(value, fallback, 15_000, 3_600_000);
}

function normalizeHeartbeatIntervalSeconds(value: unknown, fallback = DEFAULT_HEARTBEAT_INTERVAL_SECONDS): number {
  return clampInteger(value, fallback, 15, 86_400);
}

function normalizeHeartbeatScheduleMode(value: unknown): 'interval' | 'daily' {
  return value === 'daily' ? 'daily' : 'interval';
}

function normalizeHeartbeatIntervalMinutes(value: unknown, fallback = DEFAULT_HEARTBEAT_INTERVAL_MINUTES): number {
  return clampInteger(value, fallback, 1, 1_440);
}

function normalizeTimeOfDay(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function normalizeTimeZone(value: unknown, fallback = DEFAULT_HEARTBEAT_TIME_ZONE): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'system') return DEFAULT_HEARTBEAT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return fallback;
  }
}

function normalizeHeartbeatPrompt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalShortText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function createDefaultAgent(now: string): AgentProfile {
  return {
    id: DEFAULT_AGENT_ID,
    name: DEFAULT_AGENT_NAME,
    agenticLoopEnabled: DEFAULT_AGENTIC_LOOP_ENABLED,
    agenticLoopMaxIterations: DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS,
    agenticLoopTimeoutMs: DEFAULT_AGENTIC_LOOP_TIMEOUT_MS,
    heartbeatEnabled: DEFAULT_HEARTBEAT_ENABLED,
    heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    heartbeatScheduleMode: DEFAULT_HEARTBEAT_SCHEDULE_MODE,
    heartbeatIntervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
    heartbeatDailyTime: DEFAULT_HEARTBEAT_DAILY_TIME,
    heartbeatTimeZone: DEFAULT_HEARTBEAT_TIME_ZONE,
    heartbeatWindowEnabled: DEFAULT_HEARTBEAT_WINDOW_ENABLED,
    heartbeatWindowStartTime: DEFAULT_HEARTBEAT_WINDOW_START_TIME,
    heartbeatWindowEndTime: DEFAULT_HEARTBEAT_WINDOW_END_TIME,
    autoSkillEnabled: DEFAULT_AUTO_SKILL_ENABLED,
    autoSkillAutoPromoteLowRisk: DEFAULT_AUTO_SKILL_AUTO_PROMOTE_LOW_RISK,
    createdAt: now,
    updatedAt: now,
  };
}

const agentsStore = new Store<AgentsStoreSchema>({
  name: 'agents',
  defaults: {
    agents: [createDefaultAgent(new Date().toISOString())],
    defaultAgentId: DEFAULT_AGENT_ID,
  },
});

function ensureDefaultAgent(): void {
  const agents = agentsStore.get('agents') ?? [];
  if (agents.length > 0) return;
  const now = new Date().toISOString();
  agentsStore.set('agents', [createDefaultAgent(now)]);
  agentsStore.set('defaultAgentId', DEFAULT_AGENT_ID);
}

function resolveUniqueAgentId(baseId: string, existingIds: Set<string>): string {
  let candidate = baseId;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function listAgents(): AgentProfile[] {
  ensureDefaultAgent();
  const agents = agentsStore.get('agents') ?? [];
  let mutated = false;
  const hydrated = agents.map((agent) => {
    const loopEnabled = agent.agenticLoopEnabled ?? DEFAULT_AGENTIC_LOOP_ENABLED;
    const heartbeatEnabled = loopEnabled
      ? (agent.heartbeatEnabled ?? DEFAULT_HEARTBEAT_ENABLED)
      : false;
    const next: AgentProfile = {
      ...agent,
      roleName: normalizeOptionalShortText(agent.roleName),
      agenticLoopEnabled: loopEnabled,
      agenticLoopMaxIterations: normalizeAgenticLoopMaxIterations(
        agent.agenticLoopMaxIterations,
        DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS
      ),
      agenticLoopTimeoutMs: normalizeAgenticLoopTimeoutMs(
        agent.agenticLoopTimeoutMs,
        DEFAULT_AGENTIC_LOOP_TIMEOUT_MS
      ),
      heartbeatEnabled,
      heartbeatIntervalSeconds: normalizeHeartbeatIntervalSeconds(
        agent.heartbeatIntervalSeconds,
        DEFAULT_HEARTBEAT_INTERVAL_SECONDS
      ),
      heartbeatScheduleMode: normalizeHeartbeatScheduleMode(agent.heartbeatScheduleMode),
      heartbeatIntervalMinutes: normalizeHeartbeatIntervalMinutes(
        agent.heartbeatIntervalMinutes,
        Math.max(1, Math.round((agent.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS) / 60))
      ),
      heartbeatDailyTime: normalizeTimeOfDay(agent.heartbeatDailyTime, DEFAULT_HEARTBEAT_DAILY_TIME),
      heartbeatTimeZone: normalizeTimeZone(agent.heartbeatTimeZone, DEFAULT_HEARTBEAT_TIME_ZONE),
      heartbeatWindowEnabled: agent.heartbeatWindowEnabled ?? DEFAULT_HEARTBEAT_WINDOW_ENABLED,
      heartbeatWindowStartTime: normalizeTimeOfDay(agent.heartbeatWindowStartTime, DEFAULT_HEARTBEAT_WINDOW_START_TIME),
      heartbeatWindowEndTime: normalizeTimeOfDay(agent.heartbeatWindowEndTime, DEFAULT_HEARTBEAT_WINDOW_END_TIME),
      heartbeatPrompt: normalizeHeartbeatPrompt(agent.heartbeatPrompt),
      autoSkillEnabled: agent.autoSkillEnabled ?? DEFAULT_AUTO_SKILL_ENABLED,
      autoSkillAutoPromoteLowRisk: agent.autoSkillAutoPromoteLowRisk ?? DEFAULT_AUTO_SKILL_AUTO_PROMOTE_LOW_RISK,
    };
    if (
      next.roleName !== agent.roleName
      || next.agenticLoopEnabled !== agent.agenticLoopEnabled
      || next.agenticLoopMaxIterations !== agent.agenticLoopMaxIterations
      || next.agenticLoopTimeoutMs !== agent.agenticLoopTimeoutMs
      || next.heartbeatEnabled !== agent.heartbeatEnabled
      || next.heartbeatIntervalSeconds !== agent.heartbeatIntervalSeconds
      || next.heartbeatScheduleMode !== agent.heartbeatScheduleMode
      || next.heartbeatIntervalMinutes !== agent.heartbeatIntervalMinutes
      || next.heartbeatDailyTime !== agent.heartbeatDailyTime
      || next.heartbeatTimeZone !== agent.heartbeatTimeZone
      || next.heartbeatWindowEnabled !== agent.heartbeatWindowEnabled
      || next.heartbeatWindowStartTime !== agent.heartbeatWindowStartTime
      || next.heartbeatWindowEndTime !== agent.heartbeatWindowEndTime
      || next.heartbeatPrompt !== agent.heartbeatPrompt
      || next.autoSkillEnabled !== agent.autoSkillEnabled
      || next.autoSkillAutoPromoteLowRisk !== agent.autoSkillAutoPromoteLowRisk
    ) {
      mutated = true;
    }
    return next;
  });
  if (mutated) {
    agentsStore.set('agents', hydrated);
  }
  return hydrated;
}

export function getAgent(agentId: string): AgentProfile | undefined {
  const id = normalizeAgentId(agentId);
  return listAgents().find((agent) => agent.id === id);
}

export function getDefaultAgentId(): string {
  ensureDefaultAgent();
  return normalizeAgentId(agentsStore.get('defaultAgentId'));
}

export function setDefaultAgentId(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const agent = getAgent(id);
  if (!agent) {
    throw new Error('Agent not found');
  }
  agentsStore.set('defaultAgentId', id);
  return id;
}

export function upsertAgent(config: AgentConfig): AgentProfile {
  const agents = listAgents();
  const now = new Date().toISOString();
  const existingIds = new Set(agents.map((agent) => agent.id));
  const hasSelectedModel = Object.prototype.hasOwnProperty.call(config, 'selectedModel');
  const hasAgenticLoopEnabled = Object.prototype.hasOwnProperty.call(config, 'agenticLoopEnabled');
  const hasAgenticLoopMaxIterations = Object.prototype.hasOwnProperty.call(config, 'agenticLoopMaxIterations');
  const hasAgenticLoopTimeoutMs = Object.prototype.hasOwnProperty.call(config, 'agenticLoopTimeoutMs');
  const hasHeartbeatEnabled = Object.prototype.hasOwnProperty.call(config, 'heartbeatEnabled');
  const hasHeartbeatIntervalSeconds = Object.prototype.hasOwnProperty.call(config, 'heartbeatIntervalSeconds');
  const hasHeartbeatScheduleMode = Object.prototype.hasOwnProperty.call(config, 'heartbeatScheduleMode');
  const hasHeartbeatIntervalMinutes = Object.prototype.hasOwnProperty.call(config, 'heartbeatIntervalMinutes');
  const hasHeartbeatDailyTime = Object.prototype.hasOwnProperty.call(config, 'heartbeatDailyTime');
  const hasHeartbeatTimeZone = Object.prototype.hasOwnProperty.call(config, 'heartbeatTimeZone');
  const hasHeartbeatWindowEnabled = Object.prototype.hasOwnProperty.call(config, 'heartbeatWindowEnabled');
  const hasHeartbeatWindowStartTime = Object.prototype.hasOwnProperty.call(config, 'heartbeatWindowStartTime');
  const hasHeartbeatWindowEndTime = Object.prototype.hasOwnProperty.call(config, 'heartbeatWindowEndTime');
  const hasHeartbeatPrompt = Object.prototype.hasOwnProperty.call(config, 'heartbeatPrompt');
  const hasAutoSkillEnabled = Object.prototype.hasOwnProperty.call(config, 'autoSkillEnabled');
  const hasAutoSkillAutoPromoteLowRisk = Object.prototype.hasOwnProperty.call(config, 'autoSkillAutoPromoteLowRisk');

  const hasExplicitId = typeof config.id === 'string' && config.id.trim();
  const baseId = normalizeAgentId(hasExplicitId ? config.id : config.name);
  const existingIndex = agents.findIndex((agent) => agent.id === baseId);

  if (existingIndex >= 0 && hasExplicitId) {
    const nextLoopEnabled = hasAgenticLoopEnabled
      ? Boolean(config.agenticLoopEnabled)
      : (agents[existingIndex].agenticLoopEnabled ?? DEFAULT_AGENTIC_LOOP_ENABLED);
    const nextHeartbeatEnabled = nextLoopEnabled
      ? (
        hasHeartbeatEnabled
          ? Boolean(config.heartbeatEnabled)
          : (agents[existingIndex].heartbeatEnabled ?? DEFAULT_HEARTBEAT_ENABLED)
      )
      : false;
    const updated: AgentProfile = {
      ...agents[existingIndex],
      name: config.name || agents[existingIndex].name,
      roleName: normalizeOptionalShortText(config.roleName),
      description: config.description,
      avatar: config.avatar,
      avatarColor: config.avatarColor,
      workspaceRoot: config.workspaceRoot,
      systemPromptAppend: config.systemPromptAppend,
      selectedModel: hasSelectedModel
        ? (config.selectedModel ?? undefined)
        : agents[existingIndex].selectedModel,
      agenticLoopEnabled: nextLoopEnabled,
      agenticLoopMaxIterations: hasAgenticLoopMaxIterations
        ? normalizeAgenticLoopMaxIterations(
          config.agenticLoopMaxIterations,
          agents[existingIndex].agenticLoopMaxIterations ?? DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS
        )
        : (agents[existingIndex].agenticLoopMaxIterations ?? DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS),
      agenticLoopTimeoutMs: hasAgenticLoopTimeoutMs
        ? normalizeAgenticLoopTimeoutMs(
          config.agenticLoopTimeoutMs,
          agents[existingIndex].agenticLoopTimeoutMs ?? DEFAULT_AGENTIC_LOOP_TIMEOUT_MS
        )
        : (agents[existingIndex].agenticLoopTimeoutMs ?? DEFAULT_AGENTIC_LOOP_TIMEOUT_MS),
      heartbeatEnabled: nextHeartbeatEnabled,
      heartbeatIntervalSeconds: hasHeartbeatIntervalSeconds
        ? normalizeHeartbeatIntervalSeconds(
          config.heartbeatIntervalSeconds,
          agents[existingIndex].heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS
        )
        : (agents[existingIndex].heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS),
      heartbeatScheduleMode: hasHeartbeatScheduleMode
        ? normalizeHeartbeatScheduleMode(config.heartbeatScheduleMode)
        : normalizeHeartbeatScheduleMode(agents[existingIndex].heartbeatScheduleMode),
      heartbeatIntervalMinutes: hasHeartbeatIntervalMinutes
        ? normalizeHeartbeatIntervalMinutes(
          config.heartbeatIntervalMinutes,
          agents[existingIndex].heartbeatIntervalMinutes ?? DEFAULT_HEARTBEAT_INTERVAL_MINUTES
        )
        : (agents[existingIndex].heartbeatIntervalMinutes ?? DEFAULT_HEARTBEAT_INTERVAL_MINUTES),
      heartbeatDailyTime: hasHeartbeatDailyTime
        ? normalizeTimeOfDay(config.heartbeatDailyTime, agents[existingIndex].heartbeatDailyTime ?? DEFAULT_HEARTBEAT_DAILY_TIME)
        : (agents[existingIndex].heartbeatDailyTime ?? DEFAULT_HEARTBEAT_DAILY_TIME),
      heartbeatTimeZone: hasHeartbeatTimeZone
        ? normalizeTimeZone(config.heartbeatTimeZone, agents[existingIndex].heartbeatTimeZone ?? DEFAULT_HEARTBEAT_TIME_ZONE)
        : (agents[existingIndex].heartbeatTimeZone ?? DEFAULT_HEARTBEAT_TIME_ZONE),
      heartbeatWindowEnabled: hasHeartbeatWindowEnabled
        ? Boolean(config.heartbeatWindowEnabled)
        : (agents[existingIndex].heartbeatWindowEnabled ?? DEFAULT_HEARTBEAT_WINDOW_ENABLED),
      heartbeatWindowStartTime: hasHeartbeatWindowStartTime
        ? normalizeTimeOfDay(config.heartbeatWindowStartTime, agents[existingIndex].heartbeatWindowStartTime ?? DEFAULT_HEARTBEAT_WINDOW_START_TIME)
        : (agents[existingIndex].heartbeatWindowStartTime ?? DEFAULT_HEARTBEAT_WINDOW_START_TIME),
      heartbeatWindowEndTime: hasHeartbeatWindowEndTime
        ? normalizeTimeOfDay(config.heartbeatWindowEndTime, agents[existingIndex].heartbeatWindowEndTime ?? DEFAULT_HEARTBEAT_WINDOW_END_TIME)
        : (agents[existingIndex].heartbeatWindowEndTime ?? DEFAULT_HEARTBEAT_WINDOW_END_TIME),
      heartbeatPrompt: hasHeartbeatPrompt
        ? normalizeHeartbeatPrompt(config.heartbeatPrompt)
        : agents[existingIndex].heartbeatPrompt,
      autoSkillEnabled: hasAutoSkillEnabled
        ? Boolean(config.autoSkillEnabled)
        : (agents[existingIndex].autoSkillEnabled ?? DEFAULT_AUTO_SKILL_ENABLED),
      autoSkillAutoPromoteLowRisk: hasAutoSkillAutoPromoteLowRisk
        ? Boolean(config.autoSkillAutoPromoteLowRisk)
        : (agents[existingIndex].autoSkillAutoPromoteLowRisk ?? DEFAULT_AUTO_SKILL_AUTO_PROMOTE_LOW_RISK),
      updatedAt: now,
    };
    const next = [...agents];
    next[existingIndex] = updated;
    agentsStore.set('agents', next);
    return updated;
  }

  const id = existingIds.has(baseId) && !hasExplicitId
    ? resolveUniqueAgentId(baseId, existingIds)
    : baseId;

  const createdLoopEnabled = hasAgenticLoopEnabled ? Boolean(config.agenticLoopEnabled) : DEFAULT_AGENTIC_LOOP_ENABLED;
  const createdHeartbeatEnabled = createdLoopEnabled
    ? (hasHeartbeatEnabled ? Boolean(config.heartbeatEnabled) : DEFAULT_HEARTBEAT_ENABLED)
    : false;

  const created: AgentProfile = {
    id,
    name: config.name.trim() || DEFAULT_AGENT_NAME,
    roleName: normalizeOptionalShortText(config.roleName),
    description: config.description,
    avatar: config.avatar,
    avatarColor: config.avatarColor,
    workspaceRoot: config.workspaceRoot,
    systemPromptAppend: config.systemPromptAppend,
    selectedModel: config.selectedModel ?? undefined,
    agenticLoopEnabled: createdLoopEnabled,
    agenticLoopMaxIterations: normalizeAgenticLoopMaxIterations(
      config.agenticLoopMaxIterations,
      DEFAULT_AGENTIC_LOOP_MAX_ITERATIONS
    ),
    agenticLoopTimeoutMs: normalizeAgenticLoopTimeoutMs(
      config.agenticLoopTimeoutMs,
      DEFAULT_AGENTIC_LOOP_TIMEOUT_MS
    ),
    heartbeatEnabled: createdHeartbeatEnabled,
    heartbeatIntervalSeconds: normalizeHeartbeatIntervalSeconds(
      config.heartbeatIntervalSeconds,
      DEFAULT_HEARTBEAT_INTERVAL_SECONDS
    ),
    heartbeatScheduleMode: hasHeartbeatScheduleMode
      ? normalizeHeartbeatScheduleMode(config.heartbeatScheduleMode)
      : DEFAULT_HEARTBEAT_SCHEDULE_MODE,
    heartbeatIntervalMinutes: normalizeHeartbeatIntervalMinutes(
      config.heartbeatIntervalMinutes,
      Math.max(1, Math.round((config.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS) / 60))
    ),
    heartbeatDailyTime: normalizeTimeOfDay(config.heartbeatDailyTime, DEFAULT_HEARTBEAT_DAILY_TIME),
    heartbeatTimeZone: hasHeartbeatTimeZone
      ? normalizeTimeZone(config.heartbeatTimeZone, DEFAULT_HEARTBEAT_TIME_ZONE)
      : DEFAULT_HEARTBEAT_TIME_ZONE,
    heartbeatWindowEnabled: hasHeartbeatWindowEnabled ? Boolean(config.heartbeatWindowEnabled) : DEFAULT_HEARTBEAT_WINDOW_ENABLED,
    heartbeatWindowStartTime: normalizeTimeOfDay(config.heartbeatWindowStartTime, DEFAULT_HEARTBEAT_WINDOW_START_TIME),
    heartbeatWindowEndTime: normalizeTimeOfDay(config.heartbeatWindowEndTime, DEFAULT_HEARTBEAT_WINDOW_END_TIME),
    heartbeatPrompt: normalizeHeartbeatPrompt(config.heartbeatPrompt),
    autoSkillEnabled: hasAutoSkillEnabled ? Boolean(config.autoSkillEnabled) : DEFAULT_AUTO_SKILL_ENABLED,
    autoSkillAutoPromoteLowRisk: hasAutoSkillAutoPromoteLowRisk
      ? Boolean(config.autoSkillAutoPromoteLowRisk)
      : DEFAULT_AUTO_SKILL_AUTO_PROMOTE_LOW_RISK,
    createdAt: now,
    updatedAt: now,
  };
  agentsStore.set('agents', [created, ...agents]);
  return created;
}

export function deleteAgent(agentId: string): void {
  const id = normalizeAgentId(agentId);
  const agents = listAgents();
  if (agents.length <= 1) {
    throw new Error('At least one agent is required');
  }
  const defaultId = getDefaultAgentId();
  if (id === defaultId) {
    throw new Error('Cannot delete the default agent');
  }
  agentsStore.set('agents', agents.filter((agent) => agent.id !== id));
}

export function normalizeAgentIdForStore(value: string | undefined | null): string {
  return normalizeAgentId(value);
}
