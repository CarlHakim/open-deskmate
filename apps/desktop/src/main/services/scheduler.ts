import Cron from 'croner';
import type { ScheduledTask, ScheduleConfig } from '@accomplish/shared';
import { dispatchTask } from './task-dispatch';
import { getAgentContext } from './agent-context';
import {
  listSchedules,
  getSchedule,
  updateSchedule,
  createSchedule,
  deleteSchedule,
  setScheduleEnabled,
} from '../store/schedules';

type CronJob = InstanceType<typeof Cron>;

const jobs = new Map<string, CronJob>();

function computeNextRun(job: CronJob | null): string | undefined {
  if (!job) return undefined;
  const next = job.nextRun();
  return next ? next.toISOString() : undefined;
}

function stopJob(scheduleId: string): void {
  const job = jobs.get(scheduleId);
  if (job) {
    job.stop();
    jobs.delete(scheduleId);
  }
}

async function runSchedule(scheduleId: string, reason: 'cron' | 'manual'): Promise<void> {
  const schedule = getSchedule(scheduleId);
  if (!schedule || !schedule.enabled) return;

  updateSchedule(scheduleId, { lastRunAt: new Date().toISOString() });

  try {
    const agentContext = getAgentContext(schedule.agentId);
    const { completion } = await dispatchTask(
      {
        prompt: schedule.prompt,
        agentId: agentContext.agentId,
        workingDirectory: schedule.workingDirectory,
        sessionId: schedule.reuseSession ? schedule.sessionId : undefined,
        systemPromptAppend: schedule.systemPromptAppend ?? agentContext.systemPromptAppend,
      },
      { source: reason === 'cron' ? 'schedule' : 'manual' }
    );

    const result = await completion;
    if (schedule.reuseSession && result.sessionId) {
      updateSchedule(scheduleId, { sessionId: result.sessionId });
    }
  } catch (error) {
    console.warn('[Scheduler] Scheduled task failed:', error);
  } finally {
    const job = jobs.get(scheduleId) || null;
    updateSchedule(scheduleId, { nextRunAt: computeNextRun(job) });
  }
}

function scheduleJob(schedule: ScheduledTask): void {
  stopJob(schedule.id);
  if (!schedule.enabled) {
    updateSchedule(schedule.id, { nextRunAt: undefined });
    return;
  }

  const job = new Cron(
    schedule.cron,
    {
      timezone: schedule.timezone,
      protect: true,
    },
    () => {
      void runSchedule(schedule.id, 'cron');
    }
  );

  jobs.set(schedule.id, job);
  updateSchedule(schedule.id, { nextRunAt: computeNextRun(job) });
}

export function initScheduler(): void {
  const schedules = listSchedules();
  for (const schedule of schedules) {
    scheduleJob(schedule);
  }
}

export function upsertSchedule(config: ScheduleConfig, scheduleId?: string): ScheduledTask {
  const agentId = config.agentId;
  if (scheduleId) {
    const updated = updateSchedule(scheduleId, config);
    if (!updated) {
      throw new Error('Schedule not found');
    }
    scheduleJob(updated);
    return updated;
  }

  const created = createSchedule({
    ...config,
    agentId,
  });
  scheduleJob(created);
  return created;
}

export function removeSchedule(scheduleId: string): void {
  stopJob(scheduleId);
  deleteSchedule(scheduleId);
}

export function toggleSchedule(scheduleId: string, enabled: boolean): ScheduledTask | null {
  const updated = setScheduleEnabled(scheduleId, enabled);
  if (updated) {
    scheduleJob(updated);
  }
  return updated;
}

export function runScheduleNow(scheduleId: string): void {
  void runSchedule(scheduleId, 'manual');
}

export function resyncSchedules(): void {
  for (const scheduleId of jobs.keys()) {
    stopJob(scheduleId);
  }
  initScheduler();
}
