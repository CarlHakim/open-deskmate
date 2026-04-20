import type { TaskMessage } from '@accomplish/shared';
import { updateTaskMemoryFlush, updateTaskSessionFilePath } from '../store/taskHistory';
import { initSessionLog } from '../services/memory';
import { appendSessionLogMessage } from '../services/context/session-log';

type ExistingTaskSnapshot = {
  sessionFilePath?: string;
  memoryFlushCount?: number;
};

export function resolveResumeSessionFilePath(params: {
  existingTask?: ExistingTaskSnapshot;
  agentId: string;
  taskId: string;
}): string {
  const sessionFilePath = params.existingTask?.sessionFilePath || initSessionLog(params.agentId, params.taskId);
  if (!params.existingTask?.sessionFilePath) {
    updateTaskSessionFilePath(params.taskId, sessionFilePath);
  }
  return sessionFilePath;
}

export function injectResumeUserMessage(params: {
  existingTaskId?: string;
  hiddenPrompt: boolean;
  taskId: string;
  prompt: string;
  createMessageId: () => string;
  addTaskMessage: (taskId: string, message: TaskMessage, options?: { skipSessionLog?: boolean }) => void;
  notifyTaskUpdate: (payload: unknown) => void;
}): void {
  if (!params.existingTaskId || params.hiddenPrompt) {
    return;
  }
  const userMessage: TaskMessage = {
    id: params.createMessageId(),
    type: 'user',
    content: params.prompt,
    timestamp: new Date().toISOString(),
  };
  params.addTaskMessage(params.taskId, userMessage, { skipSessionLog: true });
  params.notifyTaskUpdate({
    taskId: params.taskId,
    type: 'message',
    message: userMessage,
  });
}

export function appendResumePromptToSessionLog(params: {
  hiddenPrompt: boolean;
  sessionFilePath: string;
  prompt: string;
}): void {
  if (params.hiddenPrompt) {
    return;
  }
  appendSessionLogMessage({
    sessionFilePath: params.sessionFilePath,
    role: 'user',
    content: params.prompt,
  });
}

export function finalizeResumeMemoryFlush(params: {
  shouldFlush: boolean;
  existingTaskId?: string;
  existingTask?: ExistingTaskSnapshot;
}): void {
  if (!params.shouldFlush || !params.existingTaskId) {
    return;
  }
  updateTaskMemoryFlush(params.existingTaskId, {
    memoryFlushAt: new Date().toISOString(),
    memoryFlushCount: (params.existingTask?.memoryFlushCount ?? 0) + 1,
  });
}
