import type { Task, TaskConfig, TaskResult } from '@accomplish/shared';
import type { TaskManager } from '../opencode/task-manager';
import { saveTask, updateTaskSessionFilePath, updateTaskStatus, updateTaskSummary } from '../store/taskHistory';

export async function startTaskWithExecutionCleanup(params: {
  taskManager: TaskManager;
  taskId: string;
  validatedConfig: TaskConfig;
  callbacks: Parameters<TaskManager['startTask']>[2];
  activeTurnByTaskId: Map<string, unknown>;
  activeSkillRunByTaskId: Map<string, unknown>;
}): Promise<Task> {
  try {
    return await params.taskManager.startTask(params.taskId, params.validatedConfig, params.callbacks);
  } catch (error) {
    params.activeTurnByTaskId.delete(params.taskId);
    params.activeSkillRunByTaskId.delete(params.taskId);
    throw error;
  }
}

export function persistStartedTask(params: {
  task: Task;
  taskId: string;
  sessionFilePath?: string;
  createTaskHistoryEntry: boolean;
  notifyTaskCreated: (task: Task) => void;
  notifyTaskSummary: (payload: { taskId: string; summary: string }) => void;
  promptForSummary: string;
  agentId?: string;
  updateRunningStatusWhenReused?: boolean;
  generateSummary: (prompt: string, agentId?: string) => Promise<string>;
}): void {
  if (params.sessionFilePath) {
    updateTaskSessionFilePath(params.taskId, params.sessionFilePath);
  }

  if (params.createTaskHistoryEntry) {
    saveTask(params.task);
    params.notifyTaskCreated(params.task);

    params.generateSummary(params.promptForSummary, params.agentId)
      .then((summary) => {
        updateTaskSummary(params.taskId, summary);
        params.notifyTaskSummary({ taskId: params.taskId, summary });
      })
      .catch((err) => {
        console.warn('[TaskDispatch] Failed to generate task summary:', err);
      });
    return;
  }

  if (params.updateRunningStatusWhenReused) {
    updateTaskStatus(params.taskId, params.task.status, new Date().toISOString());
  }
}

export function wrapTaskCompletionWithLoop(params: {
  completion: Promise<TaskResult>;
  completionFactory: (completion: Promise<TaskResult>) => Promise<TaskResult>;
}): Promise<TaskResult> {
  const completionWithLoop = params.completionFactory(params.completion);
  completionWithLoop.catch(() => {});
  return completionWithLoop;
}
