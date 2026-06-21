import type {
  Task,
  TaskConfig,
  TaskMessage,
  TaskResult,
} from '@accomplish/shared';
import { getTaskManager } from '../opencode/task-manager';
import { generateTaskSummary } from '../services/summarizer';
import {
  addTaskMessage,
  getLatestTask,
  getTask,
  updateTaskSessionId,
  updateTaskStatus,
  updateTaskMemoryFlush,
  updateTaskSessionFilePath,
  markTaskMiniMaxHistoricalImageSessionReset,
} from '../store/taskHistory';
import { getDebugMode } from '../store/appSettings';
import {
  createPermissionPolicyAuditEntry,
  evaluateInteractivePermissionPolicy,
} from '../permissions/policy-engine';
import { recordPermissionPolicyAuditEntry } from '../permissions/policy-store';
import { composeAgentSystemPromptAppend, getAgentContext } from '../services/agent-context';
import { buildMemoryFlushPrompt, initSessionLog } from '../services/memory';
import { assertOllamaReadyForAgent } from '../services/ollama-runtime';
import { preparePayloadForSend } from '../services/context/prepare-payload';
import { isMiniMaxHistoricalImageSessionResetReason } from '../services/context/image-history-policy';
import { appendSessionLogMessage } from '../services/context/session-log';
import { clearTaskFilePermissionPolicy } from '../permission-api';
import { detectTaskNeedsBrowser, getRuntimeSpeedMode } from '../services/task-intent';
import { runRuntimeHooks } from '../hooks/hook-runner';
import { getAgentEngineSessionId, hasActiveAgentEngineTask, interruptAgentEngineTask } from './agent-engine';
import {
  appendAgenticLoopProtocol,
  applyTaskHookInputPatch,
  buildRetrievedAttachmentText,
  joinPromptParts,
  maybeReuseWarmSession,
  resolveAgenticLoopConfig,
  sanitizeAttachedFiles,
  schedulePreviousSessionMemorySnapshot,
  shouldRunMemoryFlushFromContext,
} from './task-execution-preparation';
import { initAgenticRunSignal, recordAgenticRunSignal, runAgenticLoop } from './task-agentic-loop';
import {
  createInitialUserTaskMessage,
  createTaskCompletionController,
  hydrateStartedTask,
  initializeTaskTurnTracking,
} from './task-execution-bootstrap';
import { createTaskExecutionCallbacks } from './task-execution-callbacks';
import { persistStartedTask, startTaskWithExecutionCleanup, wrapTaskCompletionWithLoop } from './task-execution-post-start';
import { prepareResumeTaskExecution } from './task-resume-preparation';
import {
  appendResumePromptToSessionLog,
  finalizeResumeMemoryFlush,
  injectResumeUserMessage,
  resolveResumeSessionFilePath,
} from './task-resume-glue';
import {
  createGatewaySessionContext,
  ensureTaskDispatchRuntimeServices,
  normalizeGatewayRouteContext,
  normalizeGatewaySessionKey,
  type GatewayRouteContext,
  persistGatewaySessionContext,
} from './task-dispatch-runtime';
import { sendGatewayPermissionPrompt, toPermissionRequest } from './task-gateway-permissions';
import {
  createMessageId,
  emitSystemTaskMessage,
  forwardToAllRenderers,
  toTaskMessage,
} from './task-runtime-messaging';
import {
  activeSkillRunByTaskId,
  activeTurnByTaskId,
  createTaskId,
  createTurnId,
  finalizeTaskSkillRun,
  reconcileUsageFromOpenCodeMessage,
  trackTaskSkillRun,
} from './task-runtime-state';

const MAX_TEXT_LENGTH = 8000;

function sanitizeString(input: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return trimmed;
}

async function maybeAutoResolveRuntimePermissionRequest(params: {
  taskId: string;
  agentId: string;
  taskManager: ReturnType<typeof getTaskManager>;
  request: import('@accomplish/shared').PermissionRequest;
  emitSystemMessage: (content: string) => void;
}): Promise<boolean> {
  const decision = evaluateInteractivePermissionPolicy(params.request, undefined, params.agentId);
  recordPermissionPolicyAuditEntry(createPermissionPolicyAuditEntry({
    origin: 'task-runtime',
    agentId: params.agentId,
    request: params.request,
    decision,
  }));

  if (decision.action === 'prompt') {
    return false;
  }

  let responseText: string | null = null;
  if (decision.action === 'deny') {
    responseText = 'no';
  } else if (params.request.type === 'tool') {
    responseText = 'yes';
  } else if (params.request.type === 'question') {
    const optionLabels = Array.isArray(params.request.options)
      ? params.request.options
        .map((option) => String(option?.label || '').trim())
        .filter(Boolean)
      : [];
    if (optionLabels.length === 1) {
      responseText = optionLabels[0];
    } else {
      return false;
    }
  }

  if (!responseText) {
    return false;
  }

  await params.taskManager.sendResponse(params.taskId, responseText);
  params.emitSystemMessage(
    `Permission policy auto-${decision.action === 'allow' ? 'allowed' : 'denied'} ${params.request.type}${params.request.toolName ? ` ${params.request.toolName}` : ''}.`
  );
  return true;
}

export interface DispatchResult {
  taskId: string;
  task: Task;
  completion: Promise<TaskResult>;
}

export interface DispatchTaskOptions {
  source?: 'schedule' | 'webhook' | 'manual' | 'gateway' | 'heartbeat';
  sessionKey?: string;
  route?: GatewayRouteContext;
  resume?: {
    workingDirectory?: string;
    attachedFiles?: string[];
    privacyMode?: 'normal' | 'incognito';
    requiresBrowser?: boolean;
    buildMode?: boolean;
    buildWorkspaceRelativePath?: string;
  };
  internal?: {
    suppressAgenticLoop?: boolean;
    hiddenPrompt?: boolean;
  };
}

export async function dispatchTask(
  config: TaskConfig,
  options?: DispatchTaskOptions
): Promise<DispatchResult> {
  ensureTaskDispatchRuntimeServices();

  const taskManager = getTaskManager();
  const gatewaySessionKey = normalizeGatewaySessionKey(options?.sessionKey);
  const gatewayRoute = normalizeGatewayRouteContext(options?.route);
  const taskId = config.taskId || createTaskId(options?.source || 'task');
  const validatedPrompt = sanitizeString(config.prompt, 'prompt');
  const agentContext = getAgentContext(config.agentId);
  await assertOllamaReadyForAgent(agentContext.agentId);
  const hookResult = await runRuntimeHooks({
    event: 'before_task_dispatch',
    agentId: agentContext.agentId,
    taskId,
    source: options?.source,
    prompt: validatedPrompt,
    systemPromptAppend: config.systemPromptAppend,
    input: {
      workingDirectory: config.workingDirectory,
      attachedFiles: config.attachedFiles,
      requiresBrowser: config.requiresBrowser,
      speedMode: config.speedMode,
      privacyMode: config.privacyMode,
    },
  });
  if (!hookResult.ok) {
    throw new Error(hookResult.blockReason || 'Task blocked by runtime hook');
  }
  const effectivePrompt = joinPromptParts(hookResult.promptPrefix, validatedPrompt) || validatedPrompt;
  const patchedConfig = applyTaskHookInputPatch(config, hookResult.inputPatch);
  const requestSystemPromptAppend = joinPromptParts(config.systemPromptAppend, hookResult.systemPromptAppend);
  const sessionFilePath = initSessionLog(agentContext.agentId, taskId);
  const previousTask = getLatestTask(agentContext.agentId);
  maybeReuseWarmSession({
    config,
    taskId,
    previousTask,
    gatewaySessionKey,
    agentId: agentContext.agentId,
    prompt: effectivePrompt,
  });
  schedulePreviousSessionMemorySnapshot({
    previousTask,
    nextTaskId: taskId,
    agentId: agentContext.agentId,
    source: options?.source,
  });
  const workspaceRoot = agentContext.workspaceRoot;
  const workingDirectory = patchedConfig.workingDirectory || workspaceRoot || undefined;
  const loopConfig = resolveAgenticLoopConfig(agentContext.agent, options);
  const baseSystemPromptAppend = appendAgenticLoopProtocol(
    composeAgentSystemPromptAppend({
      agent: agentContext.agent,
      agentSystemPromptAppend: agentContext.systemPromptAppend,
      requestSystemPromptAppend,
    }),
    loopConfig.enabled
  );

  const retrievedText = await buildRetrievedAttachmentText(patchedConfig.attachedFiles);

  const prepared = await preparePayloadForSend({
    agentId: agentContext.agentId,
    taskId,
    sessionFilePath,
    userMessage: effectivePrompt,
    retrievedText,
    baseSystemPromptAppend,
    requireApiKey: true,
  });
  trackTaskSkillRun(taskId, {
    agentId: agentContext.agentId,
    skillIds: prepared.selectedSkillIds,
  });

  const validatedConfig: TaskConfig = {
    ...patchedConfig,
    prompt: effectivePrompt,
    taskId,
    agentId: agentContext.agentId,
    workingDirectory,
    systemPromptAppend: prepared.systemPromptAppend,
    requiresBrowser: detectTaskNeedsBrowser({
      prompt: effectivePrompt,
      systemPromptAppend: prepared.systemPromptAppend,
      requiresBrowser: patchedConfig.requiresBrowser,
    }),
    speedMode: getRuntimeSpeedMode(patchedConfig),
  };

  const gatewaySession = createGatewaySessionContext({
    sessionKey: gatewaySessionKey,
    route: gatewayRoute,
    agentId: agentContext.agentId,
    taskId,
    sessionId: validatedConfig.sessionId,
    lastPrompt: validatedPrompt,
  });
  persistGatewaySessionContext(gatewaySession);

  const turnId = createTurnId();
  initializeTaskTurnTracking({
    taskId,
    activeTurnByTaskId,
    turnId,
    prepared,
    usageProjectId: validatedConfig.usageProjectId,
  });

  // Ensure chronological order in the session snapshot (user prompt before assistant).
  appendSessionLogMessage({ sessionFilePath, role: 'user', content: validatedPrompt });

  const { completion, resolveCompletion, rejectCompletion } = createTaskCompletionController<TaskResult>();
  initAgenticRunSignal(taskId);

  const callbacks = createTaskExecutionCallbacks({
    taskId,
    agentId: agentContext.agentId,
    source: options?.source,
    prompt: validatedPrompt,
    fallbackSessionId: getAgentEngineSessionId(taskId) ?? validatedConfig.sessionId,
    gatewaySession,
    activeTurnByTaskId,
    finalizeTaskSkillRun,
    resolveCompletion,
    rejectCompletion,
    toTaskMessage,
    reconcileUsageFromOpenCodeMessage,
    recordAgenticRunSignal,
    addTaskMessage: (nextTaskId, message) => addTaskMessage(nextTaskId, message),
    notifyTaskUpdate: (payload) => forwardToAllRenderers('task:update', payload),
    notifyTaskProgress: (payload) => forwardToAllRenderers('task:progress', payload),
    notifyTaskActivity: (payload) => forwardToAllRenderers('task:activity', payload),
    notifyPermissionRequest: (request) => forwardToAllRenderers('permission:request', request),
    notifyDebugLog: (payload) => forwardToAllRenderers('debug:log', payload),
    notifyStatusChange: (payload) => forwardToAllRenderers('task:status-change', payload),
    emitSystemMessage: (content) => emitSystemTaskMessage(taskId, content),
    updateTaskStatus,
    getDebugMode,
    toPermissionRequest,
    autoResolvePermissionRequest: (request) => maybeAutoResolveRuntimePermissionRequest({
      taskId,
      agentId: agentContext.agentId,
      taskManager,
      request,
      emitSystemMessage: (content) => emitSystemTaskMessage(taskId, content),
    }),
    sendGatewayPermissionPrompt: options?.source === 'gateway'
      ? ({ request }) => sendGatewayPermissionPrompt({ route: gatewayRoute, request })
      : undefined,
  });

  const task = await startTaskWithExecutionCleanup({
    taskManager,
    taskId,
    validatedConfig,
    callbacks,
    activeTurnByTaskId,
    activeSkillRunByTaskId,
  });
  hydrateStartedTask({
    task,
    validatedConfig,
    prompt: validatedPrompt,
    sessionFilePath,
  });
  task.messages = [createInitialUserTaskMessage({ prompt: validatedPrompt, createMessageId })];

  persistStartedTask({
    task,
    taskId,
    sessionFilePath,
    createTaskHistoryEntry: true,
    notifyTaskCreated: (nextTask) => forwardToAllRenderers('task:created', nextTask),
    notifyTaskSummary: (payload) => forwardToAllRenderers('task:summary', payload),
    promptForSummary: validatedPrompt,
    agentId: validatedConfig.agentId,
    generateSummary: generateTaskSummary,
  });

  const completionWithLoop = wrapTaskCompletionWithLoop({
    completion,
    completionFactory: (baseCompletion) => runAgenticLoop({
      taskId,
      agentId: agentContext.agentId,
      sessionIdHint: validatedConfig.sessionId,
      completion: baseCompletion,
      agent: agentContext.agent,
      options,
      resolveSessionId: () => getTask(taskId)?.sessionId || getAgentEngineSessionId(taskId) || undefined,
      resumeSession: ({ sessionId: nextSessionId, prompt: nextPrompt, taskId: nextTaskId, agentId: nextAgentId, options: nextOptions }) =>
        resumeTaskSession(nextSessionId, nextPrompt, nextTaskId, nextAgentId, nextOptions),
      isTaskActive: () => hasActiveAgentEngineTask(taskId),
      interruptTask: () => interruptAgentEngineTask(taskId),
    }),
  });

  return { taskId, task, completion: completionWithLoop };
}

export async function resumeTaskSession(
  sessionId: string,
  prompt: string,
  existingTaskId?: string,
  agentIdOverride?: string,
  options?: DispatchTaskOptions
): Promise<DispatchResult> {
  ensureTaskDispatchRuntimeServices();

  const taskManager = getTaskManager();
  const gatewaySessionKey = normalizeGatewaySessionKey(options?.sessionKey);
  const gatewayRoute = normalizeGatewayRouteContext(options?.route);
  const validatedSessionId = sanitizeString(sessionId, 'sessionId', 128);
  const validatedPrompt = sanitizeString(prompt, 'prompt');
  const taskId = existingTaskId ? sanitizeString(existingTaskId, 'taskId', 128) : createTaskId('task');
  const hiddenPrompt = options?.internal?.hiddenPrompt === true;
  const existingTask = existingTaskId ? getTask(existingTaskId) : undefined;
  const agentContext = getAgentContext(agentIdOverride ?? existingTask?.agentId);
  await assertOllamaReadyForAgent(agentContext.agentId);
  const hookResult = await runRuntimeHooks({
    event: 'before_task_resume',
    agentId: agentContext.agentId,
    taskId,
    source: options?.source,
    prompt: validatedPrompt,
    input: {
      workingDirectory: options?.resume?.workingDirectory,
      attachedFiles: options?.resume?.attachedFiles,
      privacyMode: options?.resume?.privacyMode ?? existingTask?.privacyMode,
      requiresBrowser: options?.resume?.requiresBrowser,
      buildMode: options?.resume?.buildMode,
      buildWorkspaceRelativePath: options?.resume?.buildWorkspaceRelativePath,
    },
  });
  if (!hookResult.ok) {
    throw new Error(hookResult.blockReason || 'Task resume blocked by runtime hook');
  }
  const effectivePrompt = joinPromptParts(hookResult.promptPrefix, validatedPrompt) || validatedPrompt;

  injectResumeUserMessage({
    existingTaskId,
    hiddenPrompt,
    taskId,
    prompt: validatedPrompt,
    createMessageId,
    addTaskMessage,
    notifyTaskUpdate: (payload) => forwardToAllRenderers('task:update', payload),
  });
  const sessionFilePath = resolveResumeSessionFilePath({
    existingTask,
    agentId: agentContext.agentId,
    taskId,
  });
  const { prepared, validatedConfig, shouldFlush, sessionResetReason } = await prepareResumeTaskExecution({
    agentContext,
    taskId,
    validatedPrompt,
    effectivePrompt,
    validatedSessionId,
    sessionFilePath,
    hookInputPatch: hookResult.inputPatch,
    existingTask,
    allowMemoryFlush: Boolean(existingTaskId),
    hookSystemPromptAppend: hookResult.systemPromptAppend,
    resume: options?.resume,
    options,
  });
  trackTaskSkillRun(taskId, {
    agentId: agentContext.agentId,
    skillIds: prepared.selectedSkillIds,
  });

  const gatewaySession = createGatewaySessionContext({
    sessionKey: gatewaySessionKey,
    route: gatewayRoute,
    agentId: agentContext.agentId,
    taskId,
    sessionId: validatedSessionId,
    lastPrompt: validatedPrompt,
  });
  persistGatewaySessionContext(gatewaySession);

  const turnId = createTurnId();
  initializeTaskTurnTracking({
    taskId,
    activeTurnByTaskId,
    turnId,
    prepared,
    usageProjectId: validatedConfig.usageProjectId,
  });

  finalizeResumeMemoryFlush({
    shouldFlush,
    existingTaskId,
    existingTask,
  });

  const { completion, resolveCompletion, rejectCompletion } = createTaskCompletionController<TaskResult>();
  initAgenticRunSignal(taskId);

  const callbacks = createTaskExecutionCallbacks({
    taskId,
    agentId: agentContext.agentId,
    source: options?.source,
    prompt: validatedPrompt,
    fallbackSessionId: getAgentEngineSessionId(taskId) ?? (validatedConfig.sessionId ?? validatedSessionId),
    gatewaySession: gatewaySession ? {
      ...gatewaySession,
      sessionId: validatedConfig.sessionId ?? validatedSessionId,
    } : undefined,
    activeTurnByTaskId,
    finalizeTaskSkillRun,
    resolveCompletion,
    rejectCompletion,
    toTaskMessage,
    reconcileUsageFromOpenCodeMessage,
    recordAgenticRunSignal,
    addTaskMessage: (nextTaskId, message) => addTaskMessage(nextTaskId, message),
    notifyTaskUpdate: (payload) => forwardToAllRenderers('task:update', payload),
    notifyTaskProgress: (payload) => forwardToAllRenderers('task:progress', payload),
    notifyTaskActivity: (payload) => forwardToAllRenderers('task:activity', payload),
    notifyPermissionRequest: (request) => forwardToAllRenderers('permission:request', request),
    notifyDebugLog: (payload) => forwardToAllRenderers('debug:log', payload),
    notifyStatusChange: (payload) => forwardToAllRenderers('task:status-change', payload),
    emitSystemMessage: (content) => emitSystemTaskMessage(taskId, content),
    updateTaskStatus,
    getDebugMode,
    toPermissionRequest,
    autoResolvePermissionRequest: (request) => maybeAutoResolveRuntimePermissionRequest({
      taskId,
      agentId: agentContext.agentId,
      taskManager,
      request,
      emitSystemMessage: (content) => emitSystemTaskMessage(taskId, content),
    }),
    sendGatewayPermissionPrompt: options?.source === 'gateway'
      ? ({ request }) => sendGatewayPermissionPrompt({ route: gatewayRoute, request })
      : undefined,
  });

  // Add the user's follow-up AFTER preparing the payload to avoid duplicating the current prompt
  // inside "Recent conversation".
  appendResumePromptToSessionLog({
    hiddenPrompt,
    sessionFilePath,
    prompt: validatedPrompt,
  });

  const task = await startTaskWithExecutionCleanup({
    taskManager,
    taskId,
    validatedConfig,
    callbacks,
    activeTurnByTaskId,
    activeSkillRunByTaskId,
  });
  hydrateStartedTask({
    task,
    validatedConfig,
    prompt: validatedConfig.prompt,
    sessionFilePath,
  });

  if (!existingTaskId) {
    task.messages = [createInitialUserTaskMessage({ prompt: validatedConfig.prompt, createMessageId })];
  }
  persistStartedTask({
    task,
    taskId,
    createTaskHistoryEntry: !existingTaskId,
    notifyTaskCreated: (nextTask) => forwardToAllRenderers('task:created', nextTask),
    notifyTaskSummary: (payload) => forwardToAllRenderers('task:summary', payload),
    promptForSummary: validatedConfig.prompt,
    agentId: validatedConfig.agentId,
    updateRunningStatusWhenReused: Boolean(existingTaskId),
    generateSummary: generateTaskSummary,
  });
  if (sessionResetReason) {
    if (isMiniMaxHistoricalImageSessionResetReason(sessionResetReason)) {
      markTaskMiniMaxHistoricalImageSessionReset(taskId, new Date().toISOString());
    } else {
      emitSystemTaskMessage(taskId, sessionResetReason);
    }
  }

  const completionWithLoop = wrapTaskCompletionWithLoop({
    completion,
    completionFactory: (baseCompletion) => runAgenticLoop({
      taskId,
      agentId: agentContext.agentId,
      sessionIdHint: validatedSessionId,
      completion: baseCompletion,
      agent: agentContext.agent,
      options,
      resolveSessionId: () => getTask(taskId)?.sessionId || getAgentEngineSessionId(taskId) || undefined,
      resumeSession: ({ sessionId: nextSessionId, prompt: nextPrompt, taskId: nextTaskId, agentId: nextAgentId, options: nextOptions }) =>
        resumeTaskSession(nextSessionId, nextPrompt, nextTaskId, nextAgentId, nextOptions),
      isTaskActive: () => hasActiveAgentEngineTask(taskId),
      interruptTask: () => interruptAgentEngineTask(taskId),
    }),
  });

  return { taskId, task, completion: completionWithLoop };
}

