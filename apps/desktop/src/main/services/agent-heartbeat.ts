import type { AgentProfile } from '@accomplish/shared';
import { getTaskManager } from '../opencode/task-manager';
import { getTask } from '../store/taskHistory';
import { listAgents } from '../store/agents';
import { dispatchTask } from './task-dispatch';

const HEARTBEAT_TICK_MS = 5_000;
const HEARTBEAT_DEFAULT_INTERVAL_SECONDS = 5 * 60;
const HEARTBEAT_DEFAULT_INTERVAL_MINUTES = 5;
const HEARTBEAT_DEFAULT_DAILY_TIME = '09:00';
const HEARTBEAT_DEFAULT_TIME_ZONE = 'system';
const HEARTBEAT_DEFAULT_WINDOW_START = '09:00';
const HEARTBEAT_DEFAULT_WINDOW_END = '17:00';
const HEARTBEAT_DEFAULT_PROMPT = [
  'Heartbeat check-in:',
  '- Review your current context and memory.',
  '- If there is actionable follow-up work, do it.',
  '- If nothing is needed, briefly report that systems are stable.',
].join('\n');

let heartbeatTimer: NodeJS.Timeout | null = null;
const nextHeartbeatAtByAgentId = new Map<string, number>();
const heartbeatScheduleKeyByAgentId = new Map<string, string>();
const inFlightAgents = new Set<string>();
const SYSTEM_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const timeZoneFormatterById = new Map<string, Intl.DateTimeFormat>();

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(typeof value === 'string' ? value : '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function parseTimeOfDayToMinutes(value: unknown, fallback: string): number {
  const normalized = typeof value === 'string' ? value.trim() : fallback;
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return parseTimeOfDayToMinutes(fallback, HEARTBEAT_DEFAULT_DAILY_TIME);
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return (hours * 60) + minutes;
}

function isWithinWindow(nowMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function resolveHeartbeatTimeZone(agent: AgentProfile): string {
  const configured = (agent.heartbeatTimeZone ?? '').trim();
  if (!configured || configured.toLowerCase() === 'system') {
    return SYSTEM_TIME_ZONE;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
    return configured;
  } catch {
    return SYSTEM_TIME_ZONE;
  }
}

function getTimeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = timeZoneFormatterById.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  timeZoneFormatterById.set(timeZone, formatter);
  return formatter;
}

function getZonedDateTimeParts(epochMs: number, timeZone: string): ZonedDateTimeParts {
  const parts = getTimeZoneFormatter(timeZone).formatToParts(new Date(epochMs));
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  return {
    year: Number.parseInt(bag.year || '1970', 10),
    month: Number.parseInt(bag.month || '01', 10),
    day: Number.parseInt(bag.day || '01', 10),
    hour: Number.parseInt(bag.hour || '00', 10),
    minute: Number.parseInt(bag.minute || '00', 10),
    second: Number.parseInt(bag.second || '00', 10),
  };
}

function getTimeZoneOffsetMs(epochMs: number, timeZone: string): number {
  const zoned = getZonedDateTimeParts(epochMs, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return asUtc - epochMs;
}

function zonedDateTimeToUtcMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): number {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = localAsUtc;
  for (let i = 0; i < 6; i += 1) {
    const offset = getTimeZoneOffsetMs(guess, timeZone);
    const candidate = localAsUtc - offset;
    if (Math.abs(candidate - guess) < 1000) {
      guess = candidate;
      break;
    }
    guess = candidate;
  }
  return guess;
}

function shiftYmd(parts: Pick<ZonedDateTimeParts, 'year' | 'month' | 'day'>, days: number): {
  year: number;
  month: number;
  day: number;
} {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function nextWindowStartAt(agent: AgentProfile, referenceMs: number, startMinutes: number, endMinutes: number): number {
  const timeZone = resolveHeartbeatTimeZone(agent);
  const ref = getZonedDateTimeParts(referenceMs, timeZone);
  const nowMinutes = (ref.hour * 60) + ref.minute;
  if (isWithinWindow(nowMinutes, startMinutes, endMinutes)) {
    return referenceMs;
  }
  let targetYmd = { year: ref.year, month: ref.month, day: ref.day };
  if (startMinutes < endMinutes) {
    if (nowMinutes >= startMinutes) {
      targetYmd = shiftYmd(targetYmd, 1);
    }
  }
  let candidate = zonedDateTimeToUtcMs(
    timeZone,
    targetYmd.year,
    targetYmd.month,
    targetYmd.day,
    Math.floor(startMinutes / 60),
    startMinutes % 60
  );
  while (candidate <= referenceMs) {
    targetYmd = shiftYmd(targetYmd, 1);
    candidate = zonedDateTimeToUtcMs(
      timeZone,
      targetYmd.year,
      targetYmd.month,
      targetYmd.day,
      Math.floor(startMinutes / 60),
      startMinutes % 60
    );
  }
  return candidate;
}

function alignToWindow(agent: AgentProfile, candidateMs: number, startMinutes: number, endMinutes: number): number {
  return nextWindowStartAt(agent, candidateMs, startMinutes, endMinutes);
}

function resolveHeartbeatIntervalMs(agent: AgentProfile): number {
  const intervalMinutes = agent.heartbeatIntervalMinutes == null
    ? Math.max(1, Math.round(clampInteger(agent.heartbeatIntervalSeconds, HEARTBEAT_DEFAULT_INTERVAL_SECONDS, 15, 86_400) / 60))
    : clampInteger(agent.heartbeatIntervalMinutes, HEARTBEAT_DEFAULT_INTERVAL_MINUTES, 1, 1_440);
  return intervalMinutes * 60 * 1000;
}

function resolveHeartbeatScheduleMode(agent: AgentProfile): 'interval' | 'daily' {
  return agent.heartbeatScheduleMode === 'daily' ? 'daily' : 'interval';
}

function resolveHeartbeatWindow(agent: AgentProfile): {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
} {
  return {
    enabled: Boolean(agent.heartbeatWindowEnabled),
    startMinutes: parseTimeOfDayToMinutes(agent.heartbeatWindowStartTime, HEARTBEAT_DEFAULT_WINDOW_START),
    endMinutes: parseTimeOfDayToMinutes(agent.heartbeatWindowEndTime, HEARTBEAT_DEFAULT_WINDOW_END),
  };
}

function nextDailyRunAt(agent: AgentProfile, nowMs: number): number {
  const timeZone = resolveHeartbeatTimeZone(agent);
  const dailyMinutes = parseTimeOfDayToMinutes(agent.heartbeatDailyTime, HEARTBEAT_DEFAULT_DAILY_TIME);
  const now = getZonedDateTimeParts(nowMs, timeZone);
  let targetYmd = { year: now.year, month: now.month, day: now.day };
  let candidate = zonedDateTimeToUtcMs(
    timeZone,
    targetYmd.year,
    targetYmd.month,
    targetYmd.day,
    Math.floor(dailyMinutes / 60),
    dailyMinutes % 60
  );
  if (candidate <= nowMs) {
    targetYmd = shiftYmd(targetYmd, 1);
    candidate = zonedDateTimeToUtcMs(
      timeZone,
      targetYmd.year,
      targetYmd.month,
      targetYmd.day,
      Math.floor(dailyMinutes / 60),
      dailyMinutes % 60
    );
  }
  return candidate;
}

function computeInitialDueAt(agent: AgentProfile, nowMs: number): number {
  const mode = resolveHeartbeatScheduleMode(agent);
  if (mode === 'daily') {
    return nextDailyRunAt(agent, nowMs);
  }
  const intervalMs = resolveHeartbeatIntervalMs(agent);
  const window = resolveHeartbeatWindow(agent);
  const candidate = nowMs + intervalMs;
  if (!window.enabled) return candidate;
  return alignToWindow(agent, candidate, window.startMinutes, window.endMinutes);
}

function computeNextDueAt(agent: AgentProfile, nowMs: number): number {
  const mode = resolveHeartbeatScheduleMode(agent);
  if (mode === 'daily') {
    return nextDailyRunAt(agent, nowMs + 1_000);
  }
  const intervalMs = resolveHeartbeatIntervalMs(agent);
  const window = resolveHeartbeatWindow(agent);
  const candidate = nowMs + intervalMs;
  if (!window.enabled) return candidate;
  return alignToWindow(agent, candidate, window.startMinutes, window.endMinutes);
}

function isNowAllowedByWindow(agent: AgentProfile, nowMs: number): boolean {
  const mode = resolveHeartbeatScheduleMode(agent);
  if (mode !== 'interval') return true;
  const window = resolveHeartbeatWindow(agent);
  if (!window.enabled) return true;
  const timeZone = resolveHeartbeatTimeZone(agent);
  const now = getZonedDateTimeParts(nowMs, timeZone);
  const nowMinutes = (now.hour * 60) + now.minute;
  return isWithinWindow(nowMinutes, window.startMinutes, window.endMinutes);
}

function nextAllowedWindowAt(agent: AgentProfile, nowMs: number): number {
  const mode = resolveHeartbeatScheduleMode(agent);
  if (mode !== 'interval') return nowMs;
  const window = resolveHeartbeatWindow(agent);
  if (!window.enabled) return nowMs;
  return nextWindowStartAt(agent, nowMs, window.startMinutes, window.endMinutes);
}

function resolveHeartbeatPrompt(agent: AgentProfile): string {
  const prompt = (agent.heartbeatPrompt ?? '').trim();
  return prompt || HEARTBEAT_DEFAULT_PROMPT;
}

function buildScheduleKey(agent: AgentProfile): string {
  return [
    agent.heartbeatEnabled ? '1' : '0',
    resolveHeartbeatScheduleMode(agent),
    String(agent.heartbeatIntervalMinutes ?? ''),
    String(agent.heartbeatIntervalSeconds ?? ''),
    String(agent.heartbeatDailyTime ?? ''),
    String(agent.heartbeatTimeZone ?? HEARTBEAT_DEFAULT_TIME_ZONE),
    agent.heartbeatWindowEnabled ? '1' : '0',
    String(agent.heartbeatWindowStartTime ?? ''),
    String(agent.heartbeatWindowEndTime ?? ''),
  ].join('|');
}

function isAgentBusy(agentId: string): boolean {
  const taskManager = getTaskManager();
  const activeTaskIds = taskManager.getActiveTaskIds();
  for (const taskId of activeTaskIds) {
    const task = getTask(taskId);
    if (task?.agentId === agentId) {
      return true;
    }
  }
  return false;
}

async function runAgentHeartbeat(agent: AgentProfile): Promise<void> {
  const { completion } = await dispatchTask(
    {
      prompt: resolveHeartbeatPrompt(agent),
      agentId: agent.id,
    },
    {
      source: 'heartbeat',
    }
  );
  await completion;
}

async function tickHeartbeats(): Promise<void> {
  const agents = listAgents();
  const now = Date.now();
  const enabledAgentIds = new Set<string>();

  for (const agent of agents) {
    if (!agent.heartbeatEnabled) {
      continue;
    }
    enabledAgentIds.add(agent.id);
    const scheduleKey = buildScheduleKey(agent);
    const previousScheduleKey = heartbeatScheduleKeyByAgentId.get(agent.id);
    const shouldResetSchedule = previousScheduleKey !== scheduleKey;
    heartbeatScheduleKeyByAgentId.set(agent.id, scheduleKey);
    const dueAt = shouldResetSchedule
      ? computeInitialDueAt(agent, now)
      : (nextHeartbeatAtByAgentId.get(agent.id) ?? computeInitialDueAt(agent, now));
    if (!nextHeartbeatAtByAgentId.has(agent.id) || shouldResetSchedule) {
      nextHeartbeatAtByAgentId.set(agent.id, dueAt);
    }
    if (inFlightAgents.has(agent.id)) {
      continue;
    }
    if (now < dueAt) {
      continue;
    }
    if (!isNowAllowedByWindow(agent, now)) {
      nextHeartbeatAtByAgentId.set(agent.id, nextAllowedWindowAt(agent, now));
      continue;
    }
    if (isAgentBusy(agent.id)) {
      nextHeartbeatAtByAgentId.set(agent.id, now + 10_000);
      continue;
    }

    inFlightAgents.add(agent.id);
    nextHeartbeatAtByAgentId.set(agent.id, computeNextDueAt(agent, now));
    void runAgentHeartbeat(agent)
      .catch((error) => {
        console.warn('[AgentHeartbeat] Heartbeat run failed:', {
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlightAgents.delete(agent.id);
      });
  }

  for (const agentId of Array.from(nextHeartbeatAtByAgentId.keys())) {
    if (!enabledAgentIds.has(agentId)) {
      nextHeartbeatAtByAgentId.delete(agentId);
      heartbeatScheduleKeyByAgentId.delete(agentId);
      inFlightAgents.delete(agentId);
    }
  }
}

export function startAgentHeartbeatService(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    void tickHeartbeats();
  }, HEARTBEAT_TICK_MS);
  void tickHeartbeats();
}

export function stopAgentHeartbeatService(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  nextHeartbeatAtByAgentId.clear();
  heartbeatScheduleKeyByAgentId.clear();
  inFlightAgents.clear();
}
