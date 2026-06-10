import type { TaskConfig } from '@accomplish/shared';
import { composeAgentSystemPromptAppend, resolveSelectedModelForAgent, type AgentContext } from '../services/agent-context';
import { buildMemoryFlushPrompt } from '../services/memory';
import { preparePayloadForSend } from '../services/context/prepare-payload';
import { detectTaskNeedsBrowser, getRuntimeSpeedMode } from '../services/task-intent';
import { buildOpenCodeSessionResetMessage, inspectOpenCodeSessionIntegrity } from '../opencode/session-integrity';
import { getMiniMaxHistoricalImageSessionResetReason } from '../services/context/image-history-policy';
import {
  appendAgenticLoopProtocol,
  applyTaskHookInputPatch,
  buildRetrievedAttachmentText,
  joinPromptParts,
  resolveAgenticLoopConfig,
  shouldRunMemoryFlushFromContext,
} from './task-execution-preparation';

type ExistingTaskSnapshot = {
  agentId?: string;
  sessionId?: string;
  sessionFilePath?: string;
  messages?: import('@accomplish/shared').TaskMessage[];
  attachedFiles?: string[];
  privacyMode?: 'normal' | 'incognito';
  memoryFlushCount?: number;
  usageProjectId?: string | null;
  miniMaxHistoricalImageSessionResetAt?: string;
};

export async function prepareResumeTaskExecution(params: {
  agentContext: AgentContext;
  taskId: string;
  validatedPrompt: string;
  effectivePrompt: string;
  validatedSessionId: string;
  sessionFilePath: string;
  hookInputPatch?: Record<string, unknown>;
  existingTask?: ExistingTaskSnapshot;
  allowMemoryFlush?: boolean;
  hookSystemPromptAppend?: string;
  resume?: {
    workingDirectory?: string;
    attachedFiles?: string[];
    privacyMode?: 'normal' | 'incognito';
  };
  options?: {
    internal?: {
      suppressAgenticLoop?: boolean;
    };
  };
}): Promise<{
  prepared: Awaited<ReturnType<typeof preparePayloadForSend>>;
  validatedConfig: TaskConfig;
  shouldFlush: boolean;
  sessionResetReason?: string;
}> {
  const patchedResumeConfig = applyTaskHookInputPatch(
    {
      prompt: params.validatedPrompt,
      workingDirectory: (params.resume?.workingDirectory ?? '').trim() || undefined,
      attachedFiles: Array.isArray(params.resume?.attachedFiles) ? params.resume?.attachedFiles : undefined,
      privacyMode:
        params.resume?.privacyMode === 'normal' || params.resume?.privacyMode === 'incognito'
          ? params.resume.privacyMode
          : params.existingTask?.privacyMode,
    },
    params.hookInputPatch
  );

  const resumeWorkingDirectory = (patchedResumeConfig.workingDirectory ?? '').trim() || undefined;
  const resumeAttachedFiles = Array.isArray(patchedResumeConfig.attachedFiles)
    ? patchedResumeConfig.attachedFiles
        .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)
        .map((filePath) => filePath.trim())
        .slice(0, 20)
    : [];
  const effectivePrivacyMode = patchedResumeConfig.privacyMode;
  const workingDirectory = resumeWorkingDirectory || params.agentContext.workspaceRoot || undefined;

  const loopConfig = resolveAgenticLoopConfig(params.agentContext.agent, params.options);
  const rawBaseSystemPromptAppendNoFlush = appendAgenticLoopProtocol(
    composeAgentSystemPromptAppend({
      agent: params.agentContext.agent,
      agentSystemPromptAppend: params.agentContext.systemPromptAppend,
    }),
    loopConfig.enabled
  );
  const baseSystemPromptAppendNoFlush =
    joinPromptParts(rawBaseSystemPromptAppendNoFlush, params.hookSystemPromptAppend)
    || rawBaseSystemPromptAppendNoFlush;

  const preflight = await preparePayloadForSend({
    agentId: params.agentContext.agentId,
    taskId: params.taskId,
    sessionFilePath: params.sessionFilePath,
    userMessage: params.validatedPrompt,
    baseSystemPromptAppend: baseSystemPromptAppendNoFlush,
    requireApiKey: false,
    compactionMode: 'unsafeOnly',
  });
  const shouldFlush = Boolean(params.allowMemoryFlush) && shouldRunMemoryFlushFromContext({
    memoryFlushCount: params.existingTask?.memoryFlushCount,
    contextLimitTokens: preflight.context.contextLimitTokens,
    usedPct: preflight.context.usedPct,
    safeRemainingForReply: preflight.context.safeRemainingForReply,
  });
  const flushPrompt = shouldFlush ? buildMemoryFlushPrompt() : '';

  const baseSystemPromptAppend = [baseSystemPromptAppendNoFlush, flushPrompt]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');

  const retrievedText = await buildRetrievedAttachmentText(resumeAttachedFiles);
  const prepared = await preparePayloadForSend({
    agentId: params.agentContext.agentId,
    taskId: params.taskId,
    sessionFilePath: params.sessionFilePath,
    userMessage: params.effectivePrompt,
    retrievedText,
    baseSystemPromptAppend,
    requireApiKey: true,
    compactionMode: shouldFlush ? 'unsafeOnly' : 'preemptive',
  });
  const sessionIntegrity = inspectOpenCodeSessionIntegrity(params.validatedSessionId);
  const sessionResetReason = sessionIntegrity.healthy
    ? getMiniMaxHistoricalImageSessionResetReason({
        selectedModel: resolveSelectedModelForAgent(params.agentContext.agentId),
        prompt: params.effectivePrompt,
        currentAttachedFiles: resumeAttachedFiles,
        sessionId: params.validatedSessionId,
        sessionFilePath: params.sessionFilePath,
        task: params.existingTask,
      })
    : buildOpenCodeSessionResetMessage(sessionIntegrity.issues);

  const validatedConfig: TaskConfig = {
    prompt: params.effectivePrompt,
    sessionId: params.validatedSessionId,
    taskId: params.taskId,
    agentId: params.agentContext.agentId,
    workingDirectory,
    attachedFiles: resumeAttachedFiles.length > 0 ? resumeAttachedFiles : undefined,
    privacyMode: effectivePrivacyMode,
    usageProjectId: params.existingTask?.usageProjectId ?? null,
    systemPromptAppend: prepared.systemPromptAppend,
    requiresBrowser: detectTaskNeedsBrowser({
      prompt: params.effectivePrompt,
      systemPromptAppend: prepared.systemPromptAppend,
    }),
    speedMode: getRuntimeSpeedMode(),
  };

  if (prepared.shouldResetSession || sessionResetReason) {
    delete validatedConfig.sessionId;
  }

  return {
    prepared,
    validatedConfig,
    shouldFlush,
    sessionResetReason,
  };
}
