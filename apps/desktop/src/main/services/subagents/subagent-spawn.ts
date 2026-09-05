import crypto from 'node:crypto';
import path from 'node:path';
import type { SelectedModel, SubagentExecutionPolicy, SubagentInheritedContext, SubagentRunRecord, SubagentSharedContext, SubagentSpawnMode, SubagentSpawnRequest, SubagentSpawnResult, TaskResult, ToolsetId } from '@accomplish/shared';
import { getAgent, listAgents } from '../../store/agents';
import { getOllamaConfig } from '../../store/appSettings';
import { getGatewaySessionByTaskId, patchGatewaySession, upsertGatewaySession } from '../../store/gatewaySessions';
import { getTask } from '../../store/taskHistory';
import { countActiveSubagentRuns, getSubagentRun, listSubagentRuns, patchSubagentRun, registerSubagentRun } from '../../store/subagentRegistry';
import { setTaskModelOverride } from '../../store/taskModelOverrides';
import { injectAgentEngineTaskMessage, resolveAgentEngineKnownSessionId, resumeAgentEngineTask, startAgentEngineTask } from '../../runtime/agent-engine';
import { resolveSelectedModelForAgent } from '../agent-context';
import {
  filterToolsetIdsForOllamaToolMode,
  mergeToolsetIds,
  resolveRuntimeToolsetIds,
  resolveToolDiscoveryRuntimeMetadata,
} from '../toolsets';
import { appendSubagentProgressEvent, syncSubagentRunSupervisor } from './subagent-supervisor';
import { captureSubagentBuildHandoffBaseline } from './subagent-build-handoff';
import { resolveAgentWorkspaceRoot } from '../build-mode/file-service';
import {
  buildSubagentSharedContext,
  formatInheritedToolContextForPrompt,
  formatSubagentSharedContextForPrompt,
} from './subagent-shared-context';

const SUBAGENT_RELAY_MAX_CHARS = 12000;
const SUBAGENT_REPORT_STORE_MAX_CHARS = 50000;
const SUBAGENT_RELAY_FLUSH_ATTEMPTS = 12;
const SUBAGENT_RELAY_FLUSH_INTERVAL_MS = 250;

type SpawnSubagentContext = {
  parentTaskId: string;
  parentAgentId: string;
  parentRunId?: string;
  parentSessionKey?: string;
};

function createRelayMessageId(): string {
  return `subagent_msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateSubagentReport(report: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = String(report || '').trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, maxChars)}…`,
    truncated: true,
  };
}

function readLatestChildAssistantReport(childTaskId: string, childAgentId: string): string {
  const childTask = getTask(childTaskId, childAgentId);
  const assistantMessages = childTask?.messages.filter((message) => message.type === 'assistant') ?? [];
  return assistantMessages[assistantMessages.length - 1]?.content?.trim() || '';
}

async function waitForChildAssistantReport(childTaskId: string, childAgentId: string): Promise<string> {
  for (let attempt = 0; attempt < SUBAGENT_RELAY_FLUSH_ATTEMPTS; attempt += 1) {
    const latest = readLatestChildAssistantReport(childTaskId, childAgentId);
    if (latest) return latest;
    await sleep(SUBAGENT_RELAY_FLUSH_INTERVAL_MS);
  }
  return '';
}

function summarizeChildTask(parentTaskId: string, run: SubagentRunRecord): string {
  const report = run.finalReport?.trim() || readLatestChildAssistantReport(run.childTaskId, run.childAgentId);
  if (!report) {
    return [
      `Subagent finished for parent task ${parentTaskId}, but no final report text was captured.`,
      'Open the subagent transcript from Background work to inspect the child run.',
    ].join('\n');
  }
  const truncated = truncateSubagentReport(report, SUBAGENT_RELAY_MAX_CHARS);
  return truncated.truncated
    ? `${truncated.text}\n\n[Relay note: this subagent report was shortened to ${SUBAGENT_RELAY_MAX_CHARS.toLocaleString()} characters. Open the subagent transcript for the full report.]`
    : truncated.text;
}

function isLikelyBuildTask(parentTask: ReturnType<typeof getTask>): boolean {
  return parentTask?.buildMode === true || String(parentTask?.prompt || '').trim().startsWith('Build Mode goal:');
}

function deriveBuildWorkspaceRelativePath(parentTask: ReturnType<typeof getTask>, parentAgentId: string): string | undefined {
  if (parentTask?.buildWorkspaceRelativePath) return parentTask.buildWorkspaceRelativePath;
  if (!parentTask?.workingDirectory) return undefined;
  try {
    const workspaceRoot = resolveAgentWorkspaceRoot(parentAgentId);
    const relative = path.relative(workspaceRoot, parentTask.workingDirectory);
    if (!relative || relative === '') return '.';
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return relative;
  } catch {
    return undefined;
  }
}

function resolveInheritedContext(parentTaskId: string, parentAgentId: string) {
  const parentTask = getTask(parentTaskId);
  const buildMode = isLikelyBuildTask(parentTask);
  return {
    workingDirectory: parentTask?.workingDirectory,
    attachedFiles: Array.isArray(parentTask?.attachedFiles) ? parentTask.attachedFiles.filter(Boolean).slice(0, 20) : undefined,
    privacyMode: parentTask?.privacyMode ?? 'normal',
    buildMode,
    buildWorkspaceRelativePath: buildMode ? deriveBuildWorkspaceRelativePath(parentTask, parentAgentId) : undefined,
  } as const;
}

function applyInheritancePolicy(parentAgentId: string, inheritedContext: ReturnType<typeof resolveInheritedContext>) {
  const parentAgent = getAgent(parentAgentId);
  return {
    workingDirectory: parentAgent?.subagentInheritWorkingDirectory === false ? undefined : inheritedContext.workingDirectory,
    attachedFiles: parentAgent?.subagentInheritAttachedFiles === false ? undefined : inheritedContext.attachedFiles,
    privacyMode: parentAgent?.subagentInheritPrivacyMode === false ? 'normal' : inheritedContext.privacyMode,
    buildMode: inheritedContext.buildMode,
    buildWorkspaceRelativePath: inheritedContext.buildWorkspaceRelativePath,
  } as const;
}

function isOllamaBuiltInMcpMode(value: unknown): boolean {
  return value === 'desktop' || value === 'full';
}

function resolveAgentToolRuntime(params: {
  agentId: string;
  taskId?: string;
  buildMode?: boolean;
  modelOverride?: SelectedModel | null;
}) {
  const agent = getAgent(params.agentId);
  const selectedModel = params.modelOverride ?? resolveSelectedModelForAgent(params.agentId);
  const ollamaConfig = getOllamaConfig();
  const localModel = selectedModel?.provider === 'ollama';
  const ollamaToolMode = ollamaConfig?.toolMode;
  const buildRuntimeToolsEnabled = Boolean(params.buildMode && (!localModel || isOllamaBuiltInMcpMode(ollamaToolMode)));
  const toolsetIds = resolveRuntimeToolsetIds({
    agentToolsetIds: agent?.toolsetIds,
    localModel,
    ollamaToolMode,
    ollamaToolsetIds: ollamaConfig?.toolsetIds,
    buildRuntimeToolsEnabled,
  });
  const runtime = resolveToolDiscoveryRuntimeMetadata({
    agentId: params.agentId,
    taskId: params.taskId,
    deferredToolDiscoveryEnabled: agent?.deferredToolDiscoveryEnabled,
    requestedToolsetIds: toolsetIds,
  });
  return { agent, selectedModel, localModel, ollamaToolMode, toolsetIds, runtime };
}

function resolveInheritedToolContext(params: {
  parentAgentId: string;
  parentTaskId: string;
  childAgentId: string;
  childTaskId: string;
  requestedModel?: SelectedModel | null;
  baseInheritedContext: ReturnType<typeof applyInheritancePolicy>;
}): Pick<SubagentInheritedContext, 'toolsetIds' | 'deferredToolDiscoveryEnabled' | 'enabledToolsetIds' | 'availableToolsetIds' | 'inheritedToolsetIds'> {
  const parentRuntime = resolveAgentToolRuntime({
    agentId: params.parentAgentId,
    taskId: params.parentTaskId,
    buildMode: params.baseInheritedContext.buildMode,
  });
  const childRuntime = resolveAgentToolRuntime({
    agentId: params.childAgentId,
    taskId: params.childTaskId,
    buildMode: params.baseInheritedContext.buildMode,
    modelOverride: params.requestedModel,
  });
  const parentEnabledForChild = childRuntime.localModel
    ? filterToolsetIdsForOllamaToolMode(parentRuntime.runtime.enabledToolsetIds, childRuntime.ollamaToolMode)
    : parentRuntime.runtime.enabledToolsetIds;
  const requestedToolsetIds = mergeToolsetIds(childRuntime.toolsetIds, parentEnabledForChild);
  const deferredToolDiscoveryEnabled = Boolean(
    parentRuntime.runtime.mode === 'deferred'
    || childRuntime.agent?.deferredToolDiscoveryEnabled
  );
  const effectiveRuntime = resolveToolDiscoveryRuntimeMetadata({
    agentId: params.childAgentId,
    taskId: params.childTaskId,
    deferredToolDiscoveryEnabled,
    requestedToolsetIds,
    initialToolsetIds: requestedToolsetIds,
  });
  return {
    toolsetIds: requestedToolsetIds,
    deferredToolDiscoveryEnabled,
    enabledToolsetIds: effectiveRuntime.enabledToolsetIds,
    availableToolsetIds: effectiveRuntime.availableToolsetIds,
    inheritedToolsetIds: parentEnabledForChild,
  };
}

function buildSubagentSystemPromptAppend(params: {
  label?: string;
  inheritedContext: SubagentInheritedContext;
  sharedContext?: SubagentSharedContext;
  replacing?: boolean;
}): string {
  return [
    params.label?.trim()
      ? `You are working as a spawned helper agent.\nLabel: ${params.label.trim()}`
      : 'You are working as a spawned helper agent.',
    formatInheritedToolContextForPrompt(params.inheritedContext),
    formatSubagentSharedContextForPrompt(params.sharedContext),
    'Your final answer is relayed back to the parent agent. Include the key findings, sources, decisions, and any output the parent needs.',
    'When your work has meaningful milestones, call subagent_progress with a short factual update. Do not call it for every small thought.',
    'If a source returns 403, 404, Cloudflare, captcha, login-wall, or other repeated access failure, call subagent_progress with type "blocked" and name the source/status. Do not retry the same source more than once; switch to official pages, vendor docs, public forums, Reddit, search snippets, or dev-browser/browser inspection when available.',
    'For research tasks, prefer dev-browser/browser inspection when raw webfetch is blocked or returns Cloudflare/login-wall content.',
    'If you are blocked, call subagent_progress with type "blocked" and explain what is blocking you and what fallback you will try.',
    'Finish with a structured final report: Findings, Sources used, Blocked sources, Confidence, Gaps, Recommended next step.',
    params.replacing
      ? 'You are replacing a previous child run. Avoid repeating the previous stuck behavior and use any partial findings provided in the prompt.'
      : '',
  ].filter(Boolean).join('\n');
}

function buildSubagentResumePrompt(task: string, inheritedContext: SubagentInheritedContext, sharedContext?: SubagentSharedContext): string {
  return [
    formatInheritedToolContextForPrompt(inheritedContext),
    formatSubagentSharedContextForPrompt(sharedContext),
    task.trim(),
  ].filter(Boolean).join('\n\n');
}

function inheritedRequiresBrowser(inheritedContext: Pick<SubagentInheritedContext, 'enabledToolsetIds' | 'toolsetIds'>): boolean {
  const ids = new Set<ToolsetId>([...(inheritedContext.enabledToolsetIds || []), ...(inheritedContext.toolsetIds || [])]);
  return ids.has('research') || ids.has('desktop_full') || ids.has('build_runtime');
}

async function captureBuildHandoffForRun(params: {
  request: SubagentSpawnRequest;
  parentAgentId: string;
  inheritedContext: ReturnType<typeof applyInheritancePolicy>;
}) {
  if (params.request.buildHandoff) return params.request.buildHandoff;
  if (!params.inheritedContext.buildMode || !params.inheritedContext.buildWorkspaceRelativePath) return undefined;
  return captureSubagentBuildHandoffBaseline({
    workspaceAgentId: params.parentAgentId,
    workspaceRelativePath: params.inheritedContext.buildWorkspaceRelativePath,
    reason: params.request.replacesRunId
      ? 'Captured for replacement Build subagent.'
      : 'Captured before Build subagent started.',
  });
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

function getAvailableSubagentTargets(parentAgentId: string) {
  const parentAgent = getAgent(parentAgentId);
  if (!parentAgent) return [];
  const allowed = parentAgent.subagentAllowedAgentIds ?? [];
  const allowedSet = new Set(allowed.map((id) => id.trim().toLowerCase()).filter(Boolean));
  const agents = listAgents();
  const targets = allowedSet.size > 0
    ? agents.filter((agent) => allowedSet.has(agent.id))
    : agents;
  return targets.map((agent) => ({
    id: agent.id,
    name: agent.name,
    roleName: agent.roleName,
  }));
}

function resolveTargetAgentId(requestedTarget: string | undefined, parentAgentId: string): {
  targetAgentId?: string;
  availableTargets: ReturnType<typeof getAvailableSubagentTargets>;
  error?: string;
} {
  const availableTargets = getAvailableSubagentTargets(parentAgentId);
  const raw = (requestedTarget ?? '').trim().toLowerCase();
  if (raw) {
    const exact = availableTargets.find((agent) =>
      agent.id.toLowerCase() === raw || agent.name.trim().toLowerCase() === raw
    );
    if (exact) return { targetAgentId: exact.id, availableTargets };

    const partial = availableTargets.filter((agent) =>
      agent.id.toLowerCase().includes(raw) || agent.name.trim().toLowerCase().includes(raw)
    );
    if (partial.length === 1 && partial[0]) {
      return { targetAgentId: partial[0].id, availableTargets };
    }

    return {
      availableTargets,
      error: availableTargets.length
        ? `Target agent "${requestedTarget}" was not found. Use one of: ${availableTargets.map((agent) => `${agent.name} (${agent.id})`).join(', ')}.`
        : 'No subagent targets are available for this parent agent.',
    };
  }

  const parentAsTarget = availableTargets.find((agent) => agent.id === parentAgentId);
  const defaultTarget = parentAsTarget ?? availableTargets[0];
  if (defaultTarget) {
    return { targetAgentId: defaultTarget.id, availableTargets };
  }
  return {
    availableTargets,
    error: 'No subagent targets are available for this parent agent.',
  };
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
    runTimeoutMs: Math.max(15_000, params.runTimeoutMs ?? parentAgent?.subagentRunTimeoutMs ?? 20 * 60 * 1000),
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
  const content = [
    `Subagent ${run.childAgentId}${run.label ? ` (${run.label})` : ''} completed.`,
    `Status: ${run.resultStatus || 'success'}`,
    `Session: ${run.childSessionKey}`,
    '',
    summarizeChildTask(run.parentTaskId, run),
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
    .then(async (completion) => {
      const current = getSubagentRun(params.runId);
      if (!current) return;
      const sessionId = completion.sessionId || current?.sessionId;
      const completedAt = new Date().toISOString();
      const report = await waitForChildAssistantReport(current.childTaskId, current.childAgentId);
      const stored = report
        ? truncateSubagentReport(report, SUBAGENT_REPORT_STORE_MAX_CHARS)
        : null;
      const next = patchSubagentRun(params.runId, {
        status: completion.status === 'error' ? 'error' : 'done',
        resultStatus: completion.status,
        sessionId,
        sessionState: sessionId ? 'ready' : (current?.sessionState ?? 'missing'),
        completedAt,
        finalReport: stored?.text,
        finalReportTruncated: stored?.truncated,
      });
      if (next) {
        appendSubagentProgressEvent(next.runId, {
          type: 'completed',
          title: completion.status === 'success' ? 'Subagent completed' : 'Subagent finished with an issue',
          detail: stored?.text || completion.error,
          status: completion.status === 'success' ? 'success' : 'error',
        });
        syncSubagentRunSupervisor(next.runId);
      }
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
      if (next) {
        appendSubagentProgressEvent(next.runId, {
          type: 'completed',
          title: 'Subagent failed',
          detail: next.error,
          status: 'error',
          recoverable: true,
        });
      }
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
  const resolvedTarget = resolveTargetAgentId(request.targetAgentId, context.parentAgentId);
  if (!resolvedTarget.targetAgentId) {
    return {
      status: 'error',
      error: resolvedTarget.error || 'Unable to resolve a subagent target.',
      availableTargets: resolvedTarget.availableTargets,
    };
  }
  const targetAgentId = resolvedTarget.targetAgentId;
  const targetAgent = getAgent(targetAgentId);
  if (!targetAgent) {
    return {
      status: 'error',
      error: `Target agent "${targetAgentId}" was not found.`,
      availableTargets: resolvedTarget.availableTargets,
    };
  }
  const parentDepth = resolveParentDepth(context.parentTaskId, context.parentAgentId);
  const maxDepth = parentAgent.subagentMaxDepth ?? 1;
  if (parentDepth > maxDepth) {
    return { status: 'forbidden', error: `Maximum subagent depth reached (${maxDepth}).` };
  }
  const allowed = parentAgent.subagentAllowedAgentIds ?? [];
  if (allowed.length > 0 && !allowed.includes(targetAgentId)) {
    return {
      status: 'forbidden',
      error: `Agent "${targetAgentId}" is not allowed for this parent agent.`,
      availableTargets: resolvedTarget.availableTargets,
    };
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
  const baseInheritedContext = applyInheritancePolicy(
    context.parentAgentId,
    resolveInheritedContext(context.parentTaskId, context.parentAgentId),
  );
  const buildHandoff = await captureBuildHandoffForRun({
    request,
    parentAgentId: context.parentAgentId,
    inheritedContext: baseInheritedContext,
  });

  if (mode === 'session' && request.reuseExistingSession !== false) {
    const existingRun = findReusableSessionRun({
      parentTaskId: context.parentTaskId,
      childAgentId: targetAgentId,
      label: request.label,
    });
    const existingSessionId = existingRun ? resolveKnownSessionId(existingRun) : undefined;
    if (existingRun && existingSessionId) {
      const inheritedToolContext = resolveInheritedToolContext({
        parentAgentId: context.parentAgentId,
        parentTaskId: context.parentTaskId,
        childAgentId: targetAgentId,
        childTaskId: existingRun.childTaskId,
        requestedModel,
        baseInheritedContext,
      });
      const inheritedContext: SubagentInheritedContext = {
        ...baseInheritedContext,
        ...inheritedToolContext,
      };
      const sharedContext = buildSubagentSharedContext(context.parentTaskId, { excludeRunId: existingRun.runId });
      const resumedPrompt = buildSubagentResumePrompt(request.task.trim(), inheritedContext, sharedContext);
      if (requestedModel) {
        setTaskModelOverride(existingRun.childTaskId, requestedModel);
      }
      patchSubagentRun(existingRun.runId, {
        task: request.task.trim(),
        lastPrompt: resumedPrompt,
        status: 'running',
        resultStatus: undefined,
        error: undefined,
        completedAt: undefined,
        model: requestedModel,
        sessionId: existingSessionId,
        sessionState: 'ready',
        executionPolicy,
        inheritedContext,
        sharedContext,
        buildHandoff,
        lastResumedAt: new Date().toISOString(),
        reuseCount: (existingRun.reuseCount ?? 0) + 1,
        expectedOutputs: request.expectedOutputs,
      });
      if (buildHandoff) {
        appendSubagentProgressEvent(existingRun.runId, {
          type: 'status',
          title: 'Build handoff baseline captured',
          detail: buildHandoff.baselineId
            ? `Baseline ${buildHandoff.baselineId} for ${buildHandoff.workspaceRelativePath}`
            : buildHandoff.baselineUnavailableReason,
          status: buildHandoff.baselineAvailable === false ? 'warning' : 'info',
        });
      }
      appendSubagentProgressEvent(existingRun.runId, {
        type: 'recovery',
        title: 'Subagent session reused',
        detail: request.task.trim(),
        status: 'running',
      });
      const resumed = await resumeAgentEngineTask(existingRun.childTaskId, resumedPrompt, {
        agentIdOverride: targetAgentId,
        sessionId: existingSessionId,
        options: {
          source: 'manual',
          sessionKey: existingRun.childSessionKey,
          resume: {
            workingDirectory: inheritedContext.workingDirectory,
            attachedFiles: inheritedContext.attachedFiles ? [...inheritedContext.attachedFiles] : undefined,
            privacyMode: inheritedContext.privacyMode,
            buildMode: inheritedContext.buildMode,
            buildWorkspaceRelativePath: inheritedContext.buildWorkspaceRelativePath,
            toolsetOverrideIds: inheritedContext.toolsetIds,
            deferredToolDiscoveryOverride: inheritedContext.deferredToolDiscoveryEnabled,
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
        targetAgentId,
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
  const inheritedToolContext = resolveInheritedToolContext({
    parentAgentId: context.parentAgentId,
    parentTaskId: context.parentTaskId,
    childAgentId: targetAgentId,
    childTaskId,
    requestedModel,
    baseInheritedContext,
  });
  const inheritedContext: SubagentInheritedContext = {
    ...baseInheritedContext,
    ...inheritedToolContext,
  };
  const sharedContext = buildSubagentSharedContext(context.parentTaskId);
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
    sharedContext,
    buildHandoff,
    expectedOutputs: request.expectedOutputs,
    replacesRunId: request.replacesRunId,
    replacementReason: request.replacementReason,
    createdAt,
    updatedAt: createdAt,
  };
  registerSubagentRun(record);
  appendSubagentProgressEvent(runId, {
    type: 'started',
    title: request.replacesRunId ? 'Replacement subagent started' : 'Subagent accepted',
    detail: request.task.trim(),
    status: 'running',
  });
  if (buildHandoff) {
    appendSubagentProgressEvent(runId, {
      type: 'status',
      title: 'Build handoff baseline captured',
      detail: buildHandoff.baselineId
        ? `Baseline ${buildHandoff.baselineId} for ${buildHandoff.workspaceRelativePath}`
        : buildHandoff.baselineUnavailableReason,
      status: buildHandoff.baselineAvailable === false ? 'warning' : 'info',
    });
  }
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
        buildMode: inheritedContext.buildMode,
        buildWorkspaceRelativePath: inheritedContext.buildWorkspaceRelativePath,
        requiresBrowser: inheritedRequiresBrowser(inheritedContext),
        toolsetOverrideIds: inheritedContext.toolsetIds,
        deferredToolDiscoveryOverride: inheritedContext.deferredToolDiscoveryEnabled,
        systemPromptAppend: buildSubagentSystemPromptAppend({
          label: request.label,
          inheritedContext,
          sharedContext,
          replacing: Boolean(request.replacesRunId),
        }),
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
    appendSubagentProgressEvent(runId, {
      type: 'status',
      title: 'Subagent running',
      detail: targetAgent.name || targetAgentId,
      status: 'running',
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
      targetAgentId,
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
      targetAgentId,
      error: error instanceof Error ? error.message : 'Subagent task failed',
    };
  }
}
