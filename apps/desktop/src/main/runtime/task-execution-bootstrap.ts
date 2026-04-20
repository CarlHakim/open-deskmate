import type { ContextTokenBreakdown, Task, TaskConfig, TaskMessage } from '@accomplish/shared';
import { addTurnLog, updateTurnUsage } from '../store/tokenUsage';

export type TurnUsageAccumulator = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

export type ActiveTurnRecord = {
  turnId: string;
  promptTokensEst: number;
  acc: TurnUsageAccumulator;
  outputTokensEst: number;
  textLensByMessageId: Record<string, number>;
};

export function createTaskCompletionController<T>(): {
  completion: Promise<T>;
  resolveCompletion: (value: T) => void;
  rejectCompletion: (error: Error) => void;
} {
  let resolveCompletion: (value: T) => void = () => {};
  let rejectCompletion: (error: Error) => void = () => {};
  const completion = new Promise<T>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  completion.catch(() => {});
  return { completion, resolveCompletion, rejectCompletion };
}

export function initializeTaskTurnTracking(params: {
  taskId: string;
  activeTurnByTaskId: Map<string, ActiveTurnRecord>;
  turnId: string;
  prepared: {
    provider: string;
    model: string;
    context: {
      contextLimitTokens: number;
      maxOutputTokens: number;
      headroomSafetyTokens: number;
    };
    estimate: {
      promptTokensEst: number;
      estimated: boolean;
      breakdown: ContextTokenBreakdown;
    };
    trimmed: boolean;
    droppedMessages: number;
    summaryInserted: boolean;
    shouldResetSession: boolean;
  };
}): void {
  params.activeTurnByTaskId.set(params.taskId, {
    turnId: params.turnId,
    promptTokensEst: params.prepared.estimate.promptTokensEst,
    acc: { inputTokens: 0, outputTokens: 0 },
    outputTokensEst: 0,
    textLensByMessageId: {},
  });

  addTurnLog({
    id: params.turnId,
    taskId: params.taskId,
    createdAt: new Date().toISOString(),
    provider: params.prepared.provider,
    model: params.prepared.model,
    contextLimitTokens: params.prepared.context.contextLimitTokens,
    maxOutputTokens: params.prepared.context.maxOutputTokens,
    headroomSafetyTokens: params.prepared.context.headroomSafetyTokens,
    promptTokensEst: params.prepared.estimate.promptTokensEst,
    estimated: params.prepared.estimate.estimated,
    breakdown: params.prepared.estimate.breakdown,
    trimmed: params.prepared.trimmed,
    droppedMessages: params.prepared.droppedMessages,
    summaryInserted: params.prepared.summaryInserted,
    shouldResetSession: params.prepared.shouldResetSession,
    usage: {
      inputTokens: params.prepared.estimate.promptTokensEst,
      outputTokens: 0,
      totalTokens: params.prepared.estimate.promptTokensEst,
      estimated: true,
    },
  });
}

export function finalizeTaskTurnTracking(params: {
  taskId: string;
  activeTurnByTaskId: Map<string, ActiveTurnRecord>;
}): { inputTokens?: number; outputTokens?: number } {
  const active = params.activeTurnByTaskId.get(params.taskId);
  if (!active) {
    return {};
  }

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  if (active.acc.inputTokens > 0 || active.acc.outputTokens > 0 || typeof active.acc.cachedInputTokens === 'number') {
    updateTurnUsage(active.turnId, {
      inputTokens: active.acc.inputTokens,
      outputTokens: active.acc.outputTokens,
      totalTokens: active.acc.inputTokens + active.acc.outputTokens,
      cachedInputTokens: active.acc.cachedInputTokens,
      estimated: false,
    });
    inputTokens = active.acc.inputTokens;
    outputTokens = active.acc.outputTokens;
  } else {
    updateTurnUsage(active.turnId, {
      inputTokens: active.promptTokensEst,
      outputTokens: active.outputTokensEst,
      totalTokens: active.promptTokensEst + active.outputTokensEst,
      estimated: true,
    });
    inputTokens = active.promptTokensEst;
    outputTokens = active.outputTokensEst;
  }

  params.activeTurnByTaskId.delete(params.taskId);
  return { inputTokens, outputTokens };
}

export function hydrateStartedTask(params: {
  task: Task;
  validatedConfig: TaskConfig;
  prompt: string;
  sessionFilePath: string;
}): void {
  params.task.agentId = params.validatedConfig.agentId;
  params.task.prompt = params.prompt;
  params.task.hiddenFromHistory = params.validatedConfig.hiddenFromHistory;
  params.task.parentTaskId = params.validatedConfig.parentTaskId;
  params.task.workingDirectory = params.validatedConfig.workingDirectory;
  params.task.attachedFiles = params.validatedConfig.attachedFiles;
  params.task.privacyMode = params.validatedConfig.privacyMode;
  (params.task as Task & { sessionFilePath?: string }).sessionFilePath = params.sessionFilePath;
}

export function createInitialUserTaskMessage(params: {
  prompt: string;
  createMessageId: () => string;
}): TaskMessage {
  return {
    id: params.createMessageId(),
    type: 'user',
    content: params.prompt,
    timestamp: new Date().toISOString(),
  };
}
