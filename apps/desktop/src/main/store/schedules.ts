import Store from 'electron-store';
import type { ScheduledTask, ScheduleConfig } from '@accomplish/shared';

interface ScheduleStoreSchema {
  schedules: ScheduledTask[];
}

const scheduleStore = new Store<ScheduleStoreSchema>({
  name: 'task-schedules',
  defaults: {
    schedules: [],
  },
});

function generateScheduleId(): string {
  return `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listSchedules(): ScheduledTask[] {
  return scheduleStore.get('schedules') ?? [];
}

export function getSchedule(scheduleId: string): ScheduledTask | undefined {
  return listSchedules().find((schedule) => schedule.id === scheduleId);
}

export function createSchedule(config: ScheduleConfig): ScheduledTask {
  const now = new Date().toISOString();
  const schedule: ScheduledTask = {
    id: generateScheduleId(),
    createdAt: now,
    updatedAt: now,
    ...config,
  };

  const schedules = listSchedules();
  scheduleStore.set('schedules', [schedule, ...schedules]);
  return schedule;
}

export function updateSchedule(scheduleId: string, patch: Partial<ScheduleConfig & { lastRunAt?: string; nextRunAt?: string }>): ScheduledTask | null {
  const schedules = listSchedules();
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId);
  if (index < 0) return null;

  const existing = schedules[index];
  const updated: ScheduledTask = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const next = [...schedules];
  next[index] = updated;
  scheduleStore.set('schedules', next);
  return updated;
}

export function deleteSchedule(scheduleId: string): void {
  const schedules = listSchedules();
  scheduleStore.set('schedules', schedules.filter((schedule) => schedule.id !== scheduleId));
}

export function setScheduleEnabled(scheduleId: string, enabled: boolean): ScheduledTask | null {
  return updateSchedule(scheduleId, { enabled });
}
