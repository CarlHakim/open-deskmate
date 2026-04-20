import type { TaskConfig } from '@accomplish/shared';
import { getTaskManager } from '../opencode/task-manager';
import { getTask } from '../store/taskHistory';
import { getGatewaySessionByTaskId } from '../store/gatewaySessions';
import {
  dispatchTask,
  resumeTaskSession,
  type DispatchResult,
  type DispatchTaskOptions,
} from './task-orchestrator';
import { injectTaskMessage } from './task-runtime-messaging';

export type AgentEngineDispatchResult = DispatchResult;
export type AgentEngineDispatchOptions = DispatchTaskOptions;

export async function startAgentEngineTask(
  config: TaskConfig,
  options?: DispatchTaskOptions
): Promise<DispatchResult> {
  return dispatchTask(config, options);
}

export async function resumeAgentEngineSession(
  sessionId: string,
  prompt: string,
  existingTaskId?: string,
  agentIdOverride?: string,
  options?: DispatchTaskOptions
): Promise<DispatchResult> {
  return resumeTaskSession(sessionId, prompt, existingTaskId, agentIdOverride, options);
}

export function resolveAgentEngineKnownSessionId(
  taskId: string,
  agentIdOverride?: string,
  fallbackSessionId?: string | null
): string | undefined {
  return (
    getTask(taskId, agentIdOverride)?.sessionId
    || getGatewaySessionByTaskId(taskId)?.sessionId
    || getAgentEngineSessionId(taskId)
    || fallbackSessionId
    || undefined
  );
}

export async function resumeAgentEngineTask(
  taskId: string,
  prompt: string,
  params?: {
    agentIdOverride?: string;
    sessionId?: string | null;
    options?: DispatchTaskOptions;
  }
): Promise<DispatchResult> {
  const sessionId = resolveAgentEngineKnownSessionId(taskId, params?.agentIdOverride, params?.sessionId);
  if (!sessionId) {
    throw new Error('Task session is not available yet.');
  }
  return resumeTaskSession(
    sessionId,
    prompt,
    taskId,
    params?.agentIdOverride,
    params?.options
  );
}

export async function resumeAgentEnginePrompt(params: {
  prompt: string;
  taskId?: string;
  sessionId?: string | null;
  agentIdOverride?: string;
  options?: DispatchTaskOptions;
}): Promise<DispatchResult> {
  if (params.taskId) {
    return resumeAgentEngineTask(params.taskId, params.prompt, {
      agentIdOverride: params.agentIdOverride,
      sessionId: params.sessionId,
      options: params.options,
    });
  }
  if (params.sessionId) {
    return resumeTaskSession(
      params.sessionId,
      params.prompt,
      undefined,
      params.agentIdOverride,
      params.options
    );
  }
  throw new Error('Task id or session id is required to resume an agent engine prompt.');
}

export function injectAgentEngineTaskMessage(
  taskId: string,
  message: import('@accomplish/shared').TaskMessage,
  options?: { skipSessionLog?: boolean; sessionLogContent?: string }
): void {
  injectTaskMessage(taskId, message, options);
}

export function isAgentEngineTaskQueued(taskId: string): boolean {
  return getTaskManager().isTaskQueued(taskId);
}

export function cancelQueuedAgentEngineTask(taskId: string): void {
  getTaskManager().cancelQueuedTask(taskId);
}

export function hasActiveAgentEngineTask(taskId: string): boolean {
  return getTaskManager().hasActiveTask(taskId);
}

export async function cancelAgentEngineTask(taskId: string): Promise<void> {
  await getTaskManager().cancelTask(taskId);
}

export async function interruptAgentEngineTask(taskId: string): Promise<void> {
  await getTaskManager().interruptTask(taskId);
}

export async function sendAgentEngineTaskResponse(taskId: string, response: string): Promise<void> {
  await getTaskManager().sendResponse(taskId, response);
}

export function getActiveAgentEngineTaskCount(): number {
  return getTaskManager().getActiveTaskCount();
}

export function getActiveAgentEngineTaskId(): string | null {
  return getTaskManager().getActiveTaskId();
}

export function getActiveAgentEngineTaskIds(): string[] {
  return getTaskManager().getActiveTaskIds();
}

export function getAgentEngineTaskConfig(taskId: string) {
  return getTaskManager().getTaskConfig(taskId);
}

export function getAgentEngineSessionId(taskId: string): string | null {
  return getTaskManager().getSessionId(taskId);
}

export async function stopAgentEngineTask(taskId: string, options?: {
  interruptFirst?: boolean;
}): Promise<'queued' | 'active' | 'none'> {
  if (isAgentEngineTaskQueued(taskId)) {
    cancelQueuedAgentEngineTask(taskId);
    return 'queued';
  }

  if (!hasActiveAgentEngineTask(taskId)) {
    return 'none';
  }

  if (options?.interruptFirst !== false) {
    await interruptAgentEngineTask(taskId).catch(() => {});
  }
  await cancelAgentEngineTask(taskId).catch(() => {});
  return 'active';
}
