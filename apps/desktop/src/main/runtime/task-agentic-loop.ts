import type { OpenCodeMessage, TaskResult } from '@accomplish/shared';
import { resolveAgenticLoopConfig } from './task-execution-preparation';

const AGENTIC_LOOP_CONTINUE_PROMPT = [
  'Continue the same task using your latest plan and observations.',
  'Do the next concrete step and continue progressing toward completion.',
].join('\n');

type AgenticLoopStatus = 'continue' | 'complete' | 'unknown';
type StepFinishReason = import('@accomplish/shared').OpenCodeStepFinishMessage['part']['reason'];
type AgenticRunSignal = {
  explicitStatus: Exclude<AgenticLoopStatus, 'unknown'> | null;
  lastStepFinishReason?: StepFinishReason;
  sawToolActivity: boolean;
  sawToolError: boolean;
  sawAssistantText: boolean;
  lastAssistantText?: string;
};

const agenticRunSignalByTaskId = new Map<string, AgenticRunSignal>();

function createAgenticRunSignal(): AgenticRunSignal {
  return {
    explicitStatus: null,
    sawToolActivity: false,
    sawToolError: false,
    sawAssistantText: false,
  };
}

function parseExplicitLoopStatusFromText(text: string): AgenticLoopStatus {
  if (!text) return 'unknown';
  const matches = Array.from(text.matchAll(/LOOP_STATUS:\s*(CONTINUE|COMPLETE)\b/gi));
  if (matches.length === 0) return 'unknown';
  const last = matches[matches.length - 1]?.[1]?.toLowerCase();
  if (last === 'continue') return 'continue';
  if (last === 'complete') return 'complete';
  return 'unknown';
}

function clearAgenticRunSignal(taskId: string): void {
  agenticRunSignalByTaskId.delete(taskId);
}

function decideAgenticLoopStatus(taskId: string): AgenticLoopStatus {
  const signal = agenticRunSignalByTaskId.get(taskId);
  if (!signal) return 'unknown';
  if (signal.explicitStatus) {
    return signal.explicitStatus;
  }
  if (signal.lastStepFinishReason === 'stop' || signal.lastStepFinishReason === 'error') {
    return 'complete';
  }
  if (signal.lastStepFinishReason === 'tool_use' || signal.lastStepFinishReason === 'tool-calls') {
    return 'continue';
  }
  if (signal.lastStepFinishReason === 'end_turn') {
    if (!signal.sawToolActivity) {
      return 'complete';
    }
    if (signal.sawToolError) {
      return 'continue';
    }
    if (!signal.sawAssistantText) {
      return 'continue';
    }
    return 'complete';
  }
  return 'unknown';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function initAgenticRunSignal(taskId: string): void {
  agenticRunSignalByTaskId.set(taskId, createAgenticRunSignal());
}

export function recordAgenticRunSignal(taskId: string, message: OpenCodeMessage): void {
  const signal = agenticRunSignalByTaskId.get(taskId) ?? createAgenticRunSignal();
  if (message.type === 'text') {
    const text = message.part.text || '';
    const trimmed = text.trim();
    if (trimmed) {
      signal.sawAssistantText = true;
      signal.lastAssistantText = trimmed;
      const explicit = parseExplicitLoopStatusFromText(trimmed);
      if (explicit !== 'unknown') {
        signal.explicitStatus = explicit;
      }
    }
    agenticRunSignalByTaskId.set(taskId, signal);
    return;
  }
  if (message.type === 'tool_call') {
    signal.sawToolActivity = true;
    agenticRunSignalByTaskId.set(taskId, signal);
    return;
  }
  if (message.type === 'tool_use') {
    signal.sawToolActivity = true;
    if (message.part.state?.status === 'error') {
      signal.sawToolError = true;
    }
    agenticRunSignalByTaskId.set(taskId, signal);
    return;
  }
  if (message.type === 'tool_result') {
    signal.sawToolActivity = true;
    if (Boolean(message.part.isError)) {
      signal.sawToolError = true;
    }
    agenticRunSignalByTaskId.set(taskId, signal);
    return;
  }
  if (message.type === 'step_finish') {
    signal.lastStepFinishReason = message.part.reason;
    agenticRunSignalByTaskId.set(taskId, signal);
  }
}

export async function runAgenticLoop(params: {
  taskId: string;
  agentId: string;
  sessionIdHint?: string;
  completion: Promise<TaskResult>;
  agent: {
    agenticLoopEnabled?: boolean;
    agenticLoopMaxIterations?: number;
    agenticLoopTimeoutMs?: number;
  };
  options?: {
    internal?: {
      suppressAgenticLoop?: boolean;
      hiddenPrompt?: boolean;
    };
  };
  resolveSessionId: () => string | undefined;
  resumeSession: (params: {
    sessionId: string;
    prompt: string;
    taskId: string;
    agentId: string;
    options?: {
      internal?: {
        suppressAgenticLoop?: boolean;
        hiddenPrompt?: boolean;
      };
    };
  }) => Promise<{ completion: Promise<TaskResult> }>;
  isTaskActive: () => boolean;
  interruptTask: () => Promise<unknown>;
}): Promise<TaskResult> {
  const loopConfig = resolveAgenticLoopConfig(params.agent, params.options);
  let result = await params.completion;
  try {
    if (!loopConfig.enabled) {
      return result;
    }

    const startedAt = Date.now();
    for (let iteration = 1; iteration < loopConfig.maxIterations; iteration += 1) {
      if (result.status !== 'success') {
        return result;
      }

      const loopStatus = decideAgenticLoopStatus(params.taskId);
      if (loopStatus !== 'continue') {
        return result;
      }

      const elapsedMs = Date.now() - startedAt;
      const remainingMs = loopConfig.timeoutMs - elapsedMs;
      if (remainingMs <= 0) {
        return {
          status: 'interrupted',
          sessionId: result.sessionId || params.sessionIdHint,
          error: `Agentic loop timeout reached (${loopConfig.timeoutMs}ms)`,
        };
      }

      const sessionId = result.sessionId || params.resolveSessionId() || params.sessionIdHint;
      if (!sessionId) {
        return result;
      }

      const resumed = await params.resumeSession({
        sessionId,
        prompt: AGENTIC_LOOP_CONTINUE_PROMPT,
        taskId: params.taskId,
        agentId: params.agentId,
        options: {
          ...params.options,
          internal: {
            ...(params.options?.internal ?? {}),
            suppressAgenticLoop: true,
            hiddenPrompt: true,
          },
        },
      });

      const timeoutMessage = `Agentic loop timeout reached while waiting for iteration ${iteration + 1}`;
      try {
        result = await withTimeout(resumed.completion, remainingMs, timeoutMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === timeoutMessage) {
          if (params.isTaskActive()) {
            await params.interruptTask().catch(() => {});
          }
          return {
            status: 'interrupted',
            sessionId,
            error: timeoutMessage,
          };
        }
        throw error;
      }
    }

    return result;
  } finally {
    clearAgenticRunSignal(params.taskId);
  }
}
