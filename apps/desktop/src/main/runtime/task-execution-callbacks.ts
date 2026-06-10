import type { OpenCodeMessage, TaskActivityEvent, TaskResult, TaskStatus } from '@accomplish/shared';
import type { TaskCallbacks } from '../opencode/task-manager';
import { enqueueWebPermissionRequest } from '../services/webhook-permissions';
import { applyTaskCompletionLifecycle, applyTaskErrorLifecycle, type TaskGatewaySessionContext } from './task-execution-lifecycle';
import { finalizeTaskTurnTracking, type ActiveTurnRecord } from './task-execution-bootstrap';
import { TaskActivityRuntime } from './task-activity';

export function createTaskExecutionCallbacks(params: {
  taskId: string;
  agentId: string;
  source?: string;
  prompt: string;
  fallbackSessionId?: string;
  gatewaySession?: TaskGatewaySessionContext;
  activeTurnByTaskId: Map<string, ActiveTurnRecord>;
  finalizeTaskSkillRun: (taskId: string, payload: {
    success: boolean;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }) => void;
  resolveCompletion: (result: TaskResult) => void;
  rejectCompletion: (error: Error) => void;
  toTaskMessage: (message: OpenCodeMessage) => import('@accomplish/shared').TaskMessage | null;
  reconcileUsageFromOpenCodeMessage: (taskId: string, message: OpenCodeMessage) => void;
  recordAgenticRunSignal: (taskId: string, message: OpenCodeMessage) => void;
  addTaskMessage: (taskId: string, message: import('@accomplish/shared').TaskMessage) => void;
  notifyTaskUpdate: (payload: unknown) => void;
  notifyTaskProgress: (payload: unknown) => void;
  notifyTaskActivity: (payload: TaskActivityEvent) => void;
  notifyPermissionRequest: (request: unknown) => void;
  notifyDebugLog: (payload: unknown) => void;
  notifyStatusChange: (payload: unknown) => void;
  emitSystemMessage: (content: string) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, completedAt?: string) => void;
  getDebugMode: () => boolean;
  toPermissionRequest: (input: unknown) => import('@accomplish/shared').PermissionRequest | null;
  autoResolvePermissionRequest?: (request: import('@accomplish/shared').PermissionRequest) => Promise<boolean> | boolean;
  sendGatewayPermissionPrompt?: (params: {
    request: import('@accomplish/shared').PermissionRequest;
  }) => void | Promise<void>;
}): TaskCallbacks {
  const activity = new TaskActivityRuntime({
    taskId: params.taskId,
    agentId: params.agentId,
    emit: params.notifyTaskActivity,
  });

  return {
    onMessage: (message: OpenCodeMessage) => {
      params.reconcileUsageFromOpenCodeMessage(params.taskId, message);
      params.recordAgenticRunSignal(params.taskId, message);
      const taskMessage = params.toTaskMessage(message);
      if (!taskMessage) return;
      params.addTaskMessage(params.taskId, taskMessage);
      activity.recordTaskMessage(taskMessage);
      params.notifyTaskUpdate({
        taskId: params.taskId,
        type: 'message',
        message: taskMessage,
      });
    },
    onProgress: (progress: { stage: string; message?: string }) => {
      activity.emitStarted(progress.message);
      params.notifyTaskProgress({ taskId: params.taskId, ...progress });
    },
    onPermissionRequest: (request: unknown) => {
      const permissionRequest = params.toPermissionRequest(request);
      activity.recordPermissionRequested(permissionRequest?.toolName || permissionRequest?.question || 'Waiting for user response.');
      if (permissionRequest && params.autoResolvePermissionRequest) {
        void Promise.resolve(params.autoResolvePermissionRequest(permissionRequest))
          .then((handled) => {
            if (handled) {
              activity.recordPermissionResolved('Permission policy resolved this request.');
              return;
            }
            try {
              enqueueWebPermissionRequest(request);
            } catch (err) {
              console.warn('[TaskDispatch] Failed to enqueue web permission request:', err);
            }
            if (params.sendGatewayPermissionPrompt) {
              void params.sendGatewayPermissionPrompt({ request: permissionRequest });
            }
            params.notifyPermissionRequest(request);
          })
          .catch((err) => {
            console.warn('[TaskDispatch] Failed to auto-resolve permission request:', err);
            try {
              enqueueWebPermissionRequest(request);
            } catch (enqueueErr) {
              console.warn('[TaskDispatch] Failed to enqueue web permission request:', enqueueErr);
            }
            if (params.sendGatewayPermissionPrompt) {
              void params.sendGatewayPermissionPrompt({ request: permissionRequest });
            }
            params.notifyPermissionRequest(request);
          });
        return;
      }
      try {
        enqueueWebPermissionRequest(request);
      } catch (err) {
        console.warn('[TaskDispatch] Failed to enqueue web permission request:', err);
      }
      if (permissionRequest && params.sendGatewayPermissionPrompt) {
        void params.sendGatewayPermissionPrompt({ request: permissionRequest });
      }
      params.notifyPermissionRequest(request);
    },
    onComplete: (result: TaskResult) => {
      const { inputTokens: finalInputTokens, outputTokens: finalOutputTokens } = finalizeTaskTurnTracking({
        taskId: params.taskId,
        activeTurnByTaskId: params.activeTurnByTaskId,
      });

      const wasSuccess = result.status === 'success';
      params.finalizeTaskSkillRun(params.taskId, {
        success: wasSuccess,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        error: wasSuccess ? undefined : (result.status === 'interrupted' ? 'Task interrupted' : 'Task failed'),
      });

      activity.recordCompletion(result);
      applyTaskCompletionLifecycle({
        taskId: params.taskId,
        agentId: params.agentId,
        source: params.source,
        prompt: params.prompt,
        result,
        fallbackSessionId: params.fallbackSessionId,
        gatewaySession: params.gatewaySession,
        notifyRenderer: (payload) => params.notifyTaskUpdate({ taskId: params.taskId, ...payload }),
        emitSystemMessage: params.emitSystemMessage,
      });

      params.resolveCompletion(result);
      activity.dispose();
    },
    onError: (error: Error) => {
      const { inputTokens: finalInputTokens, outputTokens: finalOutputTokens } = finalizeTaskTurnTracking({
        taskId: params.taskId,
        activeTurnByTaskId: params.activeTurnByTaskId,
      });
      params.finalizeTaskSkillRun(params.taskId, {
        success: false,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        error: error.message,
      });

      activity.recordError(error);
      applyTaskErrorLifecycle({
        taskId: params.taskId,
        agentId: params.agentId,
        source: params.source,
        prompt: params.prompt,
        error,
        fallbackSessionId: params.fallbackSessionId,
        gatewaySession: params.gatewaySession,
        notifyRenderer: (payload) => params.notifyTaskUpdate({ taskId: params.taskId, ...payload }),
        emitSystemMessage: params.emitSystemMessage,
      });
      params.rejectCompletion(error);
      activity.dispose();
    },
    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (params.getDebugMode()) {
        params.notifyDebugLog({
          taskId: params.taskId,
          timestamp: new Date().toISOString(),
          ...log,
        });
      }
    },
    onStatusChange: (status: TaskStatus) => {
      params.notifyStatusChange({
        taskId: params.taskId,
        status,
      });
      params.updateTaskStatus(params.taskId, status, new Date().toISOString());
    },
  };
}
