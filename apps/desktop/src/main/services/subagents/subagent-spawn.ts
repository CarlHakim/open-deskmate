import crypto from 'node:crypto';
import type { SelectedModel, SubagentExecutionPolicy, SubagentRunRecord, SubagentSpawnMode, SubagentSpawnRequest, SubagentSpawnResult, TaskResult } from '@accomplish/shared';
import { getAgent } from '../../store/agents';
import { getGatewaySessionByTaskId, patchGatewaySession, upsertGatewaySession } from '../../store/gatewaySessions';
import { getTask } from '../../store/taskHistory';
import { countActiveSubagentRuns, getSubagentRun, listSubagentRuns, patchSubagentRun, registerSubagentRun } from '../../store/subagentRegistry';
import { setTaskModelOverride } from '../../store/taskModelOverrides';
import { injectAgentEngineTaskMessage, resolveAgentEngineKnownSessionId, resumeAgentEngineTask, startAgentEngineTask } from '../../runtime/agent-engine';

type SpawnSubagentContext = {
  parentTaskId: string;
  parentAgentId: string;
  parentRunId?: string;
  parentSessionKey?: string;
};

function createRelayMessageId(): string {
  return `subagent_msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function summarizeChildTask(parentTaskId: string, childTaskId: string, childAgentId: string): string {
  const childTask = getTask(childTaskId, childAgentId);
  const assistantMessages = childTask?.messages.filter((message) => message.type === 'assistant') ?? [];
  const latest = assistantMessages[assistantMessages.length - 1]?.content?.trim() || '';
  if (!latest) {
    return `Subagent finished for parent task ${parentTaskId}.`;
  }
  return latest.length > 1200 ? `${latest.slice(0, 1200)}…` : latest;
}

function resolveInheritedContext(parentTaskId: string) {
  const parentTask = getTask(parentTaskId);
  return {
    workingDirectory: parentTask?.workingDirectory,
    attachedFiles: Array.isArray(parentTask?.attachedFiles) ? parentTask.attachedFiles.filter(Boolean).slice(0, 20) : undefined,
    privacyMode: parentTask?.privacyMode ?? 'normal',
  } as const;
}

function applyInheritancePolicy(parentAgentId: string, inheritedContext: ReturnType<typeof resolveInheritedContext>) {
  const parentAgent = getAgent(parentAgentId);
  return {
    workingDirectory: parentAgent?.subagentInheritWorkingDirectory === false ? undefined : inheritedContext.workingDirectory,
    attachedFiles: parentAgent?.subagentInheritAttachedFiles === false ? undefined : inheritedContext.attachedFiles,
    privacyMode: parentAgent?.subagentInheritPrivacyMode === false ? 'normal' : inheritedContext.privacyMode,
  } as const;
}

function buildPersistentSubagentKey(parentTaskId: string, childAgentId: string, label?: string): string {
  const normalizedLabel = (label ?? '').trim().toLowerCase();
  return [parentTaskId.trim().toLowerCase(), childAgentId.trim().toLowerCase(), normalizedLabel].join('::');
}

function resolveSubagentMode(request: SubagentSpawnRequest, parentAgentId: string): SubagentSpawnMode {
  const parentAgent = getAgent(parentAgentId);
  if (request.mode === 'session' || request.mode === 'run') return request.mode;
  return parentAgent?.subagentDefaultMode === 'session' ? 'session' : 'run';
}

function buildExecutionPolicy(params: {
  parentAgentId: string;
  mode: SubagentSpawnMode;
  runTimeoutMs?: number;
}): SubagentExecutionPolicy {
  const parentAgent = getAgent(params.parentAgentId);
  return {
    inheritedFromAgentId: params.parentAgentId,
    maxChildren: parentAgent?.subagentMaxChildren ?? 3,
    maxDepth: parentAgent?.subagentMaxDepth ?? 1,
    runTimeoutMs: Math.max(15_000, params.runTimeoutMs ?? parentAgent?.subagentRunTimeoutMs ?? 5 * 60 * 1000),
    autoRelayCompletions: parentAgent?.subagentAutoRelayCompletions ?? true,
    mode: params.mode,
  };
}

function resolveKnownSessionId(run: SubagentRunRecord): string | undefined {
  return resolveAgentEngineKnownSessionId(run.childTaskId, run.childAgentId, run.sessionId);
}

function findReusableSessionRun(params: {
  parentTaskId: string;
  childAgentId: string;
  label?: string;
}): SubagentRunRecord | undefined {
  const persistentKey = buildPersistentSubagentKey(params.parentTaskId, params.childAgentId, params.label);
  return listSubagentRuns(params.parentTaskId).find((run) => (
    run.mode === 'session'
    && run.childAgentId === params.childAgentId
    && run.persistentKey === persistentKey
  ));
}

function resolveParentDepth(taskId: string, agentId: string): number {
  let depth = 1;
  let currentTaskId: string | undefined = taskId;
  let currentAgentId: string | undefined = agentId;
  const seen = new Set<string>();

  while (currentTaskId && currentAgentId) {
    const key = `${currentAgentId}:${currentTaskId}`;
    if (seen.has(key)) break;
    seen.add(key);
    const task = getTask(currentTaskId, currentAgentId);
    const parentTaskId = task?.parentTaskId?.trim();
    if (!parentTaskId) break;
    depth += 1;
    currentTaskId = parentTaskId;
    currentAgentId = currentAgentId;
  }

  return depth;
}

function relaySubagentCompletionToParent(run: SubagentRunRecord): void {
  const childTask = getTask(run.childTaskId, run.childAgentId);
  const content = [
    `Subagent ${run.childAgentId}${run.label ? ` (${run.label})` : ''} completed.`,
    `Status: ${run.resultStatus || 'success'}`,
    `Session: ${run.childSessionKey}`,
    '',
    summarizeChildTask(run.parentTaskId, run.childTaskId, run.childAgentId),
  ].join('\n');
  injectAgentEngineTaskMessage(
    run.parentTaskId,
    {
      id: createRelayMessageId(),
      type: 'assistant',
      content,
      timestamp: new Date().toISOString(),
    },
    { sessionLogContent: content }
  );
}

export function attachTrackedSubagentCompletion(params: {
  runId: string;
  parentAgentId: string;
  completion: Promise<TaskResult>;
}): void {
  const parentAgent = getAgent(params.parentAgentId);
  void params.completion
    .then((completion) => {
      const current = getSubagentRun(params.runId);
      const sessionId = completion.sessionId || current?.sessionId;
      const next = patchSubagentRun(params.runId, {
        status: completion.status === 'error' ? 'error' : 'done',
        resultStatus: completion.status,
        sessionId,
        sessionState: sessionId ? 'ready' : (current?.sessionState ?? 'missing'),
        completedAt: new Date().toISOString(),
      });
      if (next?.childSessionKey && sessionId) {
        patchGatewaySession(next.childSessionKey, {
          sessionId,
          taskId: next.childTaskId,
          lastPrompt: next.lastPrompt ?? next.task,
        });
      }
      if ((parentAgent?.subagentAutoRelayCompletions ?? true) && next) {
        relaySubagentCompletionToParent(next);
      }
    })
    .catch((error) => {
      const next = patchSubagentRun(params.runId, {
        status: 'error',
        resultStatus: 'error',
        error: error instanceof Error ? error.message : 'Subagent task failed',
        completedAt: new Date().toISOString(),
      });
      if ((parentAgent?.subagentAutoRelayCompletions ?? true) && next) {
        relaySubagentCompletionToParent(next);
      }
    });
}

export async function spawnSubagent(
  request: SubagentSpawnRequest,
  context: SpawnSubagentContext
): Promise<SubagentSpawnResult> {
  const parentAgent = getAgent(context.parentAgentId);
  if (!parentAgent?.subagentsEnabled) {
    return { status: 'forbidden', error: 'Subagents are disabled for this agent.' };
  }
  const targetAgentId = request.targetAgentId.trim().toLowerCase();
  const targetAgent = getAgent(targetAgentId);
  if (!targetAgent) {
    return { status: 'error', error: `Target agent "${targetAgentId}" was not found.` };
  }
  const parentDepth = resolveParentDepth(context.parentTaskId, context.parentAgentId);
  const maxDepth = parentAgent.subagentMaxDepth ?? 1;
  if (parentDepth > maxDepth) {
    return { status: 'forbidden', error: `Maximum subagent depth reached (${maxDepth}).` };
  }
  const allowed = parentAgent.subagentAllowedAgentIds ?? [];
  if (allowed.length > 0 && !allowed.includes(targetAgentId)) {
    return { status: 'forbidden', error: `Agent "${targetAgentId}" is not allowed for this parent agent.` };
  }
  const mode = resolveSubagentMode(request, context.parentAgentId);
  const persistentKey = mode === 'session'
    ? buildPersistentSubagentKey(context.parentTaskId, targetAgentId, request.label)
    : undefined;
  const requestedModel = (request.model as SelectedModel | null | undefined) ?? parentAgent.subagentDefaultModel ?? null;
  const executionPolicy = buildExecutionPolicy({
    parentAgentId: context.parentAgentId,
    mode,
    runTimeoutMs: request.runTimeoutMs,
  });
  const inheritedContext = applyInheritancePolicy(
    context.parentAgentId,
    resolveInheritedContext(context.parentTaskId),
  );

  if (mode === 'session' && request.reuseExistingSession !== false) {
    const existingRun = findReusableSessionRun({
      parentTaskId: context.parentTaskId,
      childAgentId: targetAgentId,
      label: request.label,
    });
    const existingSessionId = existingRun ? resolveKnownSessionId(existingRun) : undefined;
    if (existingRun && existingSessionId) {
      if (requestedModel) {
        setTaskModelOverride(existingRun.childTaskId, requestedModel);
      }
      patchSubagentRun(existingRun.runId, {
        task: request.task.trim(),
        lastPrompt: request.task.trim(),
        status: 'running',
        resultStatus: undefined,
        error: undefined,
        completedAt: undefined,
        model: requestedModel,
        sessionId: existingSessionId,
        sessionState: 'ready',
        executionPolicy,
        inheritedContext,
        lastResumedAt: new Date().toISOString(),
        reuseCount: (existingRun.reuseCount ?? 0) + 1,
      });
      const resumed = await resumeAgentEngineTask(existingRun.childTaskId, request.task.trim(), {
        agentIdOverride: targetAgentId,
        sessionId: existingSessionId,
        options: {
          source: 'manual',
          sessionKey: existingRun.childSessionKey,
          resume: {
            workingDirectory: inheritedContext.workingDirectory,
            attachedFiles: inheritedContext.attachedFiles ? [...inheritedContext.attachedFiles] : undefined,
            privacyMode: inheritedContext.privacyMode,
          },
        },
      });
      attachTrackedSubagentCompletion({
        runId: existingRun.runId,
        parentAgentId: context.parentAgentId,
        completion: resumed.completion,
      });
      return {
        status: 'accepted',
        runId: existingRun.runId,
        childTaskId: existingRun.childTaskId,
        childSessionKey: existingRun.childSessionKey,
        reusedExistingSession: true,
      };
    }
  }

  const maxChildren = parentAgent.subagentMaxChildren ?? 3;
  if (countActiveSubagentRuns(context.parentTaskId) >= maxChildren) {
    return { status: 'forbidden', error: `Maximum active subagents reached (${maxChildren}).` };
  }

  const runId = `subrun_${crypto.randomUUID()}`;
  const childTaskId = `subtask_${crypto.randomUUID()}`;
  const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
  const parentSession =
    context.parentSessionKey
    || getGatewaySessionByTaskId(context.parentTaskId)?.key
    || `agent:${context.parentAgentId}:task:${context.parentTaskId}`;
  const createdAt = new Date().toISOString();
  const record: SubagentRunRecord = {
    runId,
    childTaskId,
    childSessionKey,
    parentTaskId: context.parentTaskId,
    parentRunId: context.parentRunId,
    parentSessionKey: parentSession,
    parentAgentId: context.parentAgentId,
    childAgentId: targetAgentId,
    persistentKey,
    label: request.label?.trim() || undefined,
    task: request.task.trim(),
    lastPrompt: request.task.trim(),
    depth: parentDepth,
    mode,
    reuseCount: 0,
    status: 'accepted',
    model: requestedModel,
    sessionState: 'pending',
    executionPolicy,
    inheritedContext,
    createdAt,
    updatedAt: createdAt,
  };
  registerSubagentRun(record);
  if (record.model) {
    setTaskModelOverride(childTaskId, record.model);
  }
  upsertGatewaySession({
    key: childSessionKey,
    agentId: targetAgentId,
    taskId: childTaskId,
    lastPrompt: request.task.trim(),
  });

  try {
    const result = await startAgentEngineTask(
      {
        prompt: request.task.trim(),
        taskId: childTaskId,
        agentId: targetAgentId,
        speedMode: 'balanced',
        workingDirectory: inheritedContext.workingDirectory || targetAgent.workspaceRoot || undefined,
        attachedFiles: inheritedContext.attachedFiles ? [...inheritedContext.attachedFiles] : undefined,
        privacyMode: inheritedContext.privacyMode,
        systemPromptAppend: request.label?.trim()
          ? `You are working as a spawned helper agent.\nLabel: ${request.label.trim()}\nReport back concise, useful results for the parent agent.`
          : 'You are working as a spawned helper agent. Report back concise, useful results for the parent agent.',
        hiddenFromHistory: true,
        parentTaskId: context.parentTaskId,
      },
      { source: 'manual' }
    );
    patchSubagentRun(runId, {
      status: 'running',
      sessionId: getTask(childTaskId, targetAgentId)?.sessionId || getGatewaySessionByTaskId(childTaskId)?.sessionId,
      sessionState: (getTask(childTaskId, targetAgentId)?.sessionId || getGatewaySessionByTaskId(childTaskId)?.sessionId) ? 'ready' : 'pending',
      updatedAt: new Date().toISOString(),
    });
    attachTrackedSubagentCompletion({
      runId,
      parentAgentId: context.parentAgentId,
      completion: result.completion,
    });
    return {
      status: 'accepted',
      runId,
      childTaskId,
      childSessionKey,
    };
  } catch (error) {
    patchSubagentRun(runId, {
      status: 'error',
      resultStatus: 'error',
      error: error instanceof Error ? error.message : 'Subagent task failed',
      completedAt: new Date().toISOString(),
    });
    return {
      status: 'error',
      runId,
      childTaskId,
      childSessionKey,
      error: error instanceof Error ? error.message : 'Subagent task failed',
    };
  }
}
