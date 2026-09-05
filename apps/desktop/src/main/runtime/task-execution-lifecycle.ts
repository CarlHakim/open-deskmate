import type { GatewayPeerKind, TaskResult, TaskStatus } from '@accomplish/shared';
import { clearTaskFilePermissionPolicy } from '../permission-api';
import { upsertGatewaySession } from '../store/gatewaySessions';
import { updateTaskSessionId, updateTaskStatus } from '../store/taskHistory';
import { runRuntimeHooks } from '../hooks/hook-runner';
import { schedulePostTaskLearning } from './post-task-learning';

export type TaskGatewaySessionContext = {
  key: string;
  agentId: string;
  taskId: string;
  sessionId?: string;
  channel?: string;
  accountId?: string;
  peerKind?: GatewayPeerKind;
  peerId?: string;
  lastPrompt: string;
};

function emitAfterTaskCompleteHookNotes(params: {
  agentId: string;
  taskId: string;
  source?: string;
  prompt: string;
  output: {
    status: string;
    sessionId?: string;
    error?: string;
  };
  emitSystemMessage: (content: string) => void;
}): void {
  void runRuntimeHooks({
    event: 'after_task_complete',
    agentId: params.agentId,
    taskId: params.taskId,
    source: params.source,
    prompt: params.prompt,
    output: params.output,
  }).then((hookResult) => {
    if (hookResult.notes?.length) {
      params.emitSystemMessage(`Runtime hooks: ${hookResult.notes.join(' | ')}`);
    }
  }).catch((hookError) => {
    console.warn('[Hooks] after_task_complete failed:', hookError);
  });
}

export function resolveTaskStatusFromResult(result: TaskResult): TaskStatus {
  if (result.status === 'success') {
    return 'completed';
  }
  if (result.status === 'interrupted') {
    return 'interrupted';
  }
  return 'failed';
}

export function applyTaskCompletionLifecycle(params: {
  taskId: string;
  agentId: string;
  source?: string;
  prompt: string;
  result: TaskResult;
  fallbackSessionId?: string | null;
  gatewaySession?: TaskGatewaySessionContext;
  notifyRenderer: (payload: { type: 'complete'; result: TaskResult }) => void;
  emitSystemMessage: (content: string) => void;
}): string | undefined {
  params.notifyRenderer({
    type: 'complete',
    result: params.result,
  });
  clearTaskFilePermissionPolicy(params.taskId);

  const taskStatus = resolveTaskStatusFromResult(params.result);
  updateTaskStatus(params.taskId, taskStatus, new Date().toISOString());

  const nextSessionId = params.result.sessionId || params.fallbackSessionId || undefined;
  if (nextSessionId) {
    updateTaskSessionId(params.taskId, nextSessionId);
  }
  if (params.gatewaySession) {
    upsertGatewaySession({
      key: params.gatewaySession.key,
      agentId: params.gatewaySession.agentId,
      sessionId: nextSessionId ?? params.gatewaySession.sessionId,
      taskId: params.gatewaySession.taskId,
      channel: params.gatewaySession.channel,
      accountId: params.gatewaySession.accountId,
      peerKind: params.gatewaySession.peerKind,
      peerId: params.gatewaySession.peerId,
      lastPrompt: params.gatewaySession.lastPrompt,
    });
  }

  emitAfterTaskCompleteHookNotes({
    agentId: params.agentId,
    taskId: params.taskId,
    source: params.source,
    prompt: params.prompt,
    output: {
      status: params.result.status,
      sessionId: params.result.sessionId,
      error: params.result.error,
    },
    emitSystemMessage: params.emitSystemMessage,
  });

  schedulePostTaskLearning({
    taskId: params.taskId,
    agentId: params.agentId,
    source: params.source,
    status: params.result.status,
  });

  return nextSessionId;
}

export function applyTaskErrorLifecycle(params: {
  taskId: string;
  agentId: string;
  source?: string;
  prompt: string;
  error: Error;
  fallbackSessionId?: string;
  gatewaySession?: TaskGatewaySessionContext;
  notifyRenderer: (payload: { type: 'error'; error: string }) => void;
  emitSystemMessage: (content: string) => void;
}): void {
  params.notifyRenderer({
    type: 'error',
    error: params.error.message,
  });
  clearTaskFilePermissionPolicy(params.taskId);
  updateTaskStatus(params.taskId, 'failed', new Date().toISOString());

  if (params.gatewaySession) {
    upsertGatewaySession({
      key: params.gatewaySession.key,
      agentId: params.gatewaySession.agentId,
      sessionId: params.fallbackSessionId ?? params.gatewaySession.sessionId,
      taskId: params.gatewaySession.taskId,
      channel: params.gatewaySession.channel,
      accountId: params.gatewaySession.accountId,
      peerKind: params.gatewaySession.peerKind,
      peerId: params.gatewaySession.peerId,
      lastPrompt: params.gatewaySession.lastPrompt,
    });
  }

  emitAfterTaskCompleteHookNotes({
    agentId: params.agentId,
    taskId: params.taskId,
    source: params.source,
    prompt: params.prompt,
    output: {
      status: 'error',
      error: params.error.message,
    },
    emitSystemMessage: params.emitSystemMessage,
  });
}
