import type { TaskActivityEvent } from '@accomplish/shared';
import { getTask } from '../store/taskHistory';
import { getAgentContext } from '../services/agent-context';
import { runAutomaticMemoryLearning } from '../services/memory';
import { runPostTaskSkillAutomation } from '../services/skill-workflow-generator';
import { runUserSkillCurator } from '../services/skill-curator';
import { emitTaskActivityEvent } from './task-runtime-messaging';

const activeLearningByTaskId = new Map<string, Promise<void>>();
const DESKTOP_LEARNING_NOTIFICATION_SOURCES = new Set(['desktop', 'chat', 'build', 'task_completion']);

function createLearningActivityId(kind: TaskActivityEvent['kind']): string {
  return `act_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function emitLearningActivity(
  input: Omit<TaskActivityEvent, 'id' | 'timestamp'>
): void {
  emitTaskActivityEvent({
    id: createLearningActivityId(input.kind),
    timestamp: new Date().toISOString(),
    ...input,
  });
}

function shouldSkipTask(task: ReturnType<typeof getTask> | undefined): boolean {
  if (!task) return true;
  if (task.status !== 'completed') return true;
  if (task.privacyMode === 'incognito') return true;
  if (task.hiddenFromHistory) return true;
  return false;
}

function truncateDetail(text: string, limit = 360): string {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 3)}...`;
}

function shouldEmitDesktopLearningNotifications(source?: string): boolean {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'gateway' || normalized.includes('connector')) return false;
  return DESKTOP_LEARNING_NOTIFICATION_SOURCES.has(normalized);
}

function shouldEmitLearningNotifications(input: {
  source?: string;
  enabled: boolean;
}): boolean {
  return input.enabled && shouldEmitDesktopLearningNotifications(input.source);
}

export function schedulePostTaskLearning(params: {
  taskId: string;
  agentId?: string;
  source?: string;
  status: 'success' | 'error' | 'interrupted';
}): void {
  if (params.status !== 'success') return;
  if (activeLearningByTaskId.has(params.taskId)) return;

  const run = (async () => {
    const task = getTask(params.taskId, params.agentId);
    if (shouldSkipTask(task)) return;

    const agentId = task?.agentId ?? params.agentId;
    const notificationsEnabled = shouldEmitLearningNotifications({
      source: params.source,
      enabled: getAgentContext(agentId).agent.memoryNotificationsEnabled !== false,
    });
    try {
      const memoryResult = await runAutomaticMemoryLearning({
        task: task!,
        agentId,
        source: params.source || 'task_completion',
      });
      if (notificationsEnabled && memoryResult.mode !== 'off' && memoryResult.changes.length > 0) {
        const title = memoryResult.mode === 'approval'
          ? 'Memory change staged'
          : 'Memory updated';
        for (const change of memoryResult.changes) {
          emitLearningActivity({
            taskId: params.taskId,
            agentId,
            kind: 'memory_updated',
            title,
            detail: truncateDetail(`${change.preview.file}: ${change.preview.afterExcerpt || change.preview.beforeExcerpt || 'Memory changed.'} Review in Settings > Memory.`),
            status: memoryResult.mode === 'approval' ? 'pending' : 'success',
            recoverable: true,
          });
        }
      }
      if (notificationsEnabled && !memoryResult.ok && memoryResult.error) {
        emitLearningActivity({
          taskId: params.taskId,
          agentId,
          kind: 'memory_updated',
          title: 'Memory learning failed',
          detail: truncateDetail(memoryResult.error),
          status: 'warning',
          recoverable: true,
        });
      }
    } catch (error) {
      console.warn('[PostTaskLearning] Memory learning failed:', error);
    }

    try {
      const skillResult = await runPostTaskSkillAutomation({
        taskId: params.taskId,
        agentId,
      });
      if (notificationsEnabled && (skillResult.disposition === 'saved' || skillResult.disposition === 'updated' || skillResult.disposition === 'staged')) {
        emitLearningActivity({
          taskId: params.taskId,
          agentId,
          kind: skillResult.disposition === 'updated' ? 'skill_updated' : 'skill_created',
          title: skillResult.disposition === 'staged'
            ? 'Skill draft staged'
            : skillResult.disposition === 'updated'
              ? 'Skill updated'
              : 'Skill created',
          detail: skillResult.message,
          status: skillResult.disposition === 'staged' ? 'pending' : 'success',
          recoverable: true,
        });
      }

      if (skillResult.disposition === 'saved' || skillResult.disposition === 'updated') {
        const curatorRun = await runUserSkillCurator({ dryRun: false });
        const appliedActions = curatorRun.actions.filter((action) => action.applied);
        if (notificationsEnabled && appliedActions.length > 0) {
          emitLearningActivity({
            taskId: params.taskId,
            agentId,
            kind: 'skill_curated',
            title: 'Skills curated',
            detail: `${appliedActions.length} skill maintenance action${appliedActions.length === 1 ? '' : 's'} applied.`,
            status: 'success',
            recoverable: true,
          });
        }
      }
    } catch (error) {
      console.warn('[PostTaskLearning] Skill learning failed:', error);
    }
  })().finally(() => {
    activeLearningByTaskId.delete(params.taskId);
  });

  activeLearningByTaskId.set(params.taskId, run);
}

export const __postTaskLearningTest = {
  shouldEmitDesktopLearningNotifications,
  shouldEmitLearningNotifications,
};
