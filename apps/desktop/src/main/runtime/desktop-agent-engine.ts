import { app, type BrowserWindow, type WebContents } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  OpenCodeMessage,
  Task,
  TaskConfig,
  TaskMessage,
  TaskResult,
  TaskStatus,
} from '@accomplish/shared';
import { getTaskManager, type TaskManager, type TaskCallbacks } from '../opencode/task-manager';
import { buildOpenCodeSessionResetMessage, inspectOpenCodeSessionIntegrity } from '../opencode/session-integrity';
import { getDebugMode } from '../store/appSettings';
import {
  getActiveAgentEngineTaskCount,
  getActiveAgentEngineTaskId,
  getAgentEngineTaskConfig,
  hasActiveAgentEngineTask,
} from './agent-engine';
import {
  addTaskMessage,
  getLatestTask,
  getTask,
  saveTask,
  updateTaskSessionFilePath,
  updateTaskSessionId,
  updateTaskSessionMemorySaved,
  markTaskMiniMaxHistoricalImageSessionReset,
  updateTaskStatus,
  updateTaskSummary,
} from '../store/taskHistory';
import { recordUserSkillRunBatch } from '../services/user-skills';
import { saveSessionMemorySnapshot, initSessionLog } from '../services/memory';
import type { FileAttachmentMeta } from '../utils/file-attachments';
import { buildAttachmentsPrefix } from '../utils/file-attachments';
import { preparePayloadForSend } from '../services/context/prepare-payload';
import { normalizeOpenCodeUsage } from '../services/context/usage-normalize';
import { appendSessionLogMessage } from '../services/context/session-log';
import { addTurnLog, updateTurnUsage } from '../store/tokenUsage';
import { getUsageBudgetStatus } from '../store/usageBudgets';
import { getBlockingUsageProjectBudgetStatus } from '../services/usage-projects';
import { generateTaskSummary } from '../services/summarizer';
import {
  clearTaskFilePermissionPolicy,
  initPermissionApi,
  startPermissionApiServer,
} from '../permission-api';
import {
  createPermissionPolicyAuditEntry,
  evaluateInteractivePermissionPolicy,
} from '../permissions/policy-engine';
import { recordPermissionPolicyAuditEntry } from '../permissions/policy-store';
import { startNodeToolsApiServer } from '../node-tools-api';
import {
  isMockTaskEventsEnabled,
  createMockTask,
  executeMockTaskFlow,
  detectScenarioFromPrompt,
} from '../test-utils/mock-task-flow';
import { TaskActivityRuntime } from './task-activity';
import { schedulePostTaskLearning } from './post-task-learning';
import { buildAssistantContentWithReasoning } from './task-message-reasoning';
import { resolveSelectedModelForAgent } from '../services/agent-context';
import {
  getMiniMaxHistoricalImageSessionResetReason,
  isMiniMaxHistoricalImageSessionResetReason,
} from '../services/context/image-history-policy';

const WARM_SESSION_WINDOW_MS = Number(process.env.OPENDESKMATE_WARM_SESSION_WINDOW_MS || 5 * 60 * 1000);
const INCOGNITO_SESSION_LOG_TTL_MS = Number(process.env.OPENDESKMATE_INCOGNITO_SESSION_LOG_TTL_MS || 30 * 60 * 1000);
const MESSAGE_BATCH_DELAY_MS = 50;
const IGNORED_TASK_TTL_MS = 30_000;

const ephemeralSessionFiles = new Set<string>();

function assertUsageBudgetAllowsRun(agentId?: string, usageProjectId?: string | null): void {
  const blocking = getUsageBudgetStatus(agentId).find((status) => status.blocking);
  if (blocking) {
    const spent = blocking.spent == null ? 'unknown' : blocking.spent.toFixed(4);
    const limit = blocking.limit == null ? 'none' : blocking.limit.toFixed(2);
    const currency = blocking.currency ? ` ${blocking.currency}` : '';
    throw new Error(
      `Usage budget blocked this task for ${blocking.period}. Spent ${spent}${currency}; limit ${limit}${currency}. Change the budget mode in Settings > Usage estimate to continue.`
    );
  }

  const projectBlocking = getBlockingUsageProjectBudgetStatus(usageProjectId);
  if (!projectBlocking) return;
  const spent = projectBlocking.spent == null ? 'unknown' : projectBlocking.spent.toFixed(4);
  const moneyLimit = projectBlocking.moneyLimit == null ? 'none' : projectBlocking.moneyLimit.toFixed(2);
  const currency = projectBlocking.currency ? ` ${projectBlocking.currency}` : '';
  const tokenLimit = projectBlocking.tokenLimit == null ? 'none' : Math.round(projectBlocking.tokenLimit).toLocaleString();
  throw new Error(
    `Project usage budget blocked this task for "${projectBlocking.windowName}". Spent ${spent}${currency} / ${moneyLimit}${currency}; tokens ${projectBlocking.tokens.toLocaleString()} / ${tokenLimit}. Change the project budget mode in Project Management to continue.`
  );
}

type TurnUsageAccumulator = {
  inputTokens: number;
  inputHitTokens?: number;
  inputMissTokens?: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd?: number;
};

type MessageBatcher = {
  pendingMessages: TaskMessage[];
  timeout: NodeJS.Timeout | null;
  taskId: string;
  flush: () => void;
};

const activeTurnByTaskId = new Map<
  string,
  {
    turnId: string;
    promptTokensEst: number;
    acc: TurnUsageAccumulator;
    outputTokensEst: number;
    textLensByMessageId: Record<string, number>;
  }
>();

const activeSkillRunByTaskId = new Map<
  string,
  {
    agentId?: string;
    skillIds: string[];
    startedAtMs: number;
  }
>();

const messageBatchers = new Map<string, MessageBatcher>();
const activeActivityByTaskId = new Map<string, TaskActivityRuntime>();
const ignoredTaskIds = new Set<string>();
let desktopPermissionApiInitialized = false;
let desktopNodeToolsApiInitialized = false;

function scheduleEphemeralFileCleanup(filePath: string, ttlMs = INCOGNITO_SESSION_LOG_TTL_MS): void {
  ephemeralSessionFiles.add(filePath);
  const timer = setTimeout(() => {
    ephemeralSessionFiles.delete(filePath);
    cleanupDesktopTempFile(filePath);
  }, Math.max(5_000, ttlMs));
  timer.unref?.();
}

export function initDesktopEphemeralSessionLog(taskId: string): string {
  const dir = path.join(os.tmpdir(), 'opendeskmate-incognito-sessions');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `session-${taskId}-${Date.now()}.jsonl`);
  scheduleEphemeralFileCleanup(filePath);
  return filePath;
}

export function cleanupDesktopTempFile(filePath: string | null): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export function cleanupDesktopEphemeralSessionFilesOnQuit(): void {
  for (const filePath of ephemeralSessionFiles) {
    cleanupDesktopTempFile(filePath);
  }
  ephemeralSessionFiles.clear();
}

function writeAttachmentsTempFile(content: string): string {
  const tempDir = app.getPath('temp');
  const tempFile = path.join(tempDir, `opencode-attachments-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, content, 'utf-8');
  return tempFile;
}

export async function prepareDesktopAttachedFiles(attachedFiles?: string[]): Promise<{
  attachmentMeta: FileAttachmentMeta[];
  attachmentTempFile: string | null;
  attachmentContentForEstimate: string;
  runtimeAttachedFiles: string[] | undefined;
}> {
  const validatedFiles = Array.isArray(attachedFiles)
    ? attachedFiles.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).slice(0, 20)
    : undefined;

  let attachmentMeta: FileAttachmentMeta[] = [];
  let attachmentTempFile: string | null = null;
  let attachmentContentForEstimate = '';
  let runtimeAttachedFiles: string[] | undefined = validatedFiles;

  if (validatedFiles && validatedFiles.length > 0) {
    const { prompt: attachmentContent, meta } = await buildAttachmentsPrefix(validatedFiles);
    attachmentMeta = meta;
    attachmentContentForEstimate = attachmentContent;
    if (attachmentContent.trim().length > 0) {
      attachmentTempFile = writeAttachmentsTempFile(attachmentContent);
      runtimeAttachedFiles = [attachmentTempFile];
    } else {
      runtimeAttachedFiles = undefined;
    }
  }

  return {
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    runtimeAttachedFiles,
  };
}

export function formatDesktopPromptWithAttachments(prompt: string, attachmentMeta: FileAttachmentMeta[]): string {
  const basePrompt = String(prompt || '').trim();
  if (!attachmentMeta.length) return basePrompt;
  const fileLines = attachmentMeta.map((m) => `  ${m.fileName} (${m.status})`);
  return `${basePrompt}\n\n📎 Attached files:\n${fileLines.join('\n')}`;
}

export function maybeReuseDesktopWarmSession(
  taskId: string,
  sessionId: string | undefined,
  previousTask: Task | undefined,
  params?: {
    agentId?: string;
    prompt?: string;
    currentAttachedFiles?: string[];
  }
): string | undefined {
  if (sessionId || !previousTask || previousTask.id === taskId || !previousTask.sessionId) {
    return sessionId;
  }
  const terminalStatuses = new Set<TaskStatus>(['completed', 'interrupted', 'failed', 'cancelled']);
  if (!terminalStatuses.has(previousTask.status)) {
    return sessionId;
  }
  const completedAtMs = Date.parse(previousTask.completedAt || previousTask.createdAt || '');
  if (!Number.isFinite(completedAtMs) || (Date.now() - completedAtMs) > WARM_SESSION_WINDOW_MS) {
    return sessionId;
  }
  const agentId = params?.agentId || previousTask.agentId;
  const resetReason = getMiniMaxHistoricalImageSessionResetReason({
    selectedModel: resolveSelectedModelForAgent(agentId),
    prompt: params?.prompt || previousTask.prompt,
    currentAttachedFiles: params?.currentAttachedFiles,
    sessionId: previousTask.sessionId,
    sessionFilePath: (previousTask as Task & { sessionFilePath?: string }).sessionFilePath,
    task: previousTask as Task & { sessionFilePath?: string },
  });
  if (resetReason) {
    console.log('[DesktopAgentEngine] Skipping warm MiniMax session reuse:', {
      fromTaskId: previousTask.id,
      sessionId: previousTask.sessionId,
      reason: resetReason,
    });
    return sessionId;
  }
  return previousTask.sessionId;
}

export async function maybeSaveDesktopPreviousSessionMemory(params: {
  previousTask?: Task & { sessionMemorySavedAt?: string };
  agentId?: string;
  taskId: string;
  source: string;
  skip?: boolean;
}): Promise<boolean> {
  const { previousTask, agentId, taskId, source, skip } = params;
  if (skip || !previousTask || previousTask.id === taskId || !previousTask.messages?.length || previousTask.sessionMemorySavedAt) {
    return false;
  }
  try {
    const memoryPath = await saveSessionMemorySnapshot(previousTask, agentId, source);
    if (memoryPath) {
      return true;
    }
  } catch (error) {
    console.warn('[DesktopAgentEngine] Failed to save session memory snapshot:', error);
  }
  return false;
}

export function createDesktopRendererForwarder(window: BrowserWindow, sender: WebContents) {
  return (channel: string, data: unknown) => {
    if (!window.isDestroyed() && !sender.isDestroyed()) {
      sender.send(channel, data);
    }
  };
}

export function ensureDesktopRuntimeServices(params: {
  window: BrowserWindow;
  resolveTaskWorkspaceRoot: (taskId: string) => string | null;
}): void {
  const { window, resolveTaskWorkspaceRoot } = params;

  if (!desktopPermissionApiInitialized) {
    initPermissionApi(window, {
      resolveTaskId: (requestedTaskId?: string) => {
        if (requestedTaskId && hasActiveAgentEngineTask(requestedTaskId)) {
          return requestedTaskId;
        }
        if (getActiveAgentEngineTaskCount() === 1) {
          return getActiveAgentEngineTaskId();
        }
        return null;
      },
      resolveTaskWorkspaceRoot,
    });
    startPermissionApiServer();
    desktopPermissionApiInitialized = true;
  }

  if (!desktopNodeToolsApiInitialized) {
    startNodeToolsApiServer();
    desktopNodeToolsApiInitialized = true;
  }
}

export function resolveDesktopTaskWorkspaceRoot(
  taskId: string,
  getAgentWorkspaceRoot: (agentId?: string) => string
): string | null {
  const taskConfig = getAgentEngineTaskConfig(taskId);
  const agentWorkspace = getAgentWorkspaceRoot(taskConfig?.agentId).trim();
  if (agentWorkspace) {
    return agentWorkspace;
  }
  const fallbackWorkingDir = String(taskConfig?.workingDirectory || '').trim();
  return fallbackWorkingDir || null;
}

export function maybeStartDesktopMockTask(window: BrowserWindow, validatedConfig: TaskConfig): Task | null {
  if (!isMockTaskEventsEnabled()) {
    return null;
  }

  const taskId = validatedConfig.taskId || createDesktopTaskId();
  validatedConfig.taskId = taskId;
  const mockTask = createMockTask(taskId, validatedConfig.prompt, validatedConfig.agentId);
  const scenario = detectScenarioFromPrompt(validatedConfig.prompt);
  saveTask(mockTask);
  void executeMockTaskFlow(window, {
    taskId,
    prompt: validatedConfig.prompt,
    scenario,
    delayMs: 50,
  });
  return mockTask;
}

export function createDesktopTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createDesktopMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createDesktopTurnId(): string {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function markDesktopTaskIgnored(taskId: string): void {
  ignoredTaskIds.add(taskId);
  activeTurnByTaskId.delete(taskId);
  activeSkillRunByTaskId.delete(taskId);
  cleanupDesktopActivity(taskId);
  setTimeout(() => {
    ignoredTaskIds.delete(taskId);
  }, IGNORED_TASK_TTL_MS);
}

function isDesktopTaskIgnored(taskId: string): boolean {
  return ignoredTaskIds.has(taskId);
}

function createMessageBatcher(
  taskId: string,
  forwardToRenderer: (channel: string, data: unknown) => void
): MessageBatcher {
  const batcher: MessageBatcher = {
    pendingMessages: [],
    timeout: null,
    taskId,
    flush: () => {
      if (batcher.pendingMessages.length === 0) return;

      forwardToRenderer('task:update:batch', {
        taskId,
        messages: batcher.pendingMessages,
      });

      for (const msg of batcher.pendingMessages) {
        addTaskMessage(taskId, msg);
        activeActivityByTaskId.get(taskId)?.recordTaskMessage(msg);
      }

      batcher.pendingMessages = [];
      if (batcher.timeout) {
        clearTimeout(batcher.timeout);
        batcher.timeout = null;
      }
    },
  };

  messageBatchers.set(taskId, batcher);
  return batcher;
}

function queueDesktopMessage(
  taskId: string,
  message: TaskMessage,
  forwardToRenderer: (channel: string, data: unknown) => void
): void {
  let batcher = messageBatchers.get(taskId);
  if (!batcher) {
    batcher = createMessageBatcher(taskId, forwardToRenderer);
  }

  batcher.pendingMessages.push(message);

  if (batcher.timeout) {
    clearTimeout(batcher.timeout);
  }

  batcher.timeout = setTimeout(() => {
    batcher.flush();
  }, MESSAGE_BATCH_DELAY_MS);
}

function flushAndCleanupDesktopBatcher(taskId: string): void {
  const batcher = messageBatchers.get(taskId);
  if (batcher) {
    batcher.flush();
    messageBatchers.delete(taskId);
  }
}

export function dropAndCleanupDesktopBatcher(taskId: string): void {
  const batcher = messageBatchers.get(taskId);
  if (batcher) {
    if (batcher.timeout) {
      clearTimeout(batcher.timeout);
    }
    batcher.pendingMessages = [];
    batcher.timeout = null;
    messageBatchers.delete(taskId);
  }
}

function cleanupDesktopActivity(taskId: string): void {
  const activity = activeActivityByTaskId.get(taskId);
  activity?.dispose();
  activeActivityByTaskId.delete(taskId);
}

function trackDesktopTaskSkillRun(taskId: string, params: { agentId?: string; skillIds?: string[] }): void {
  const ids = Array.from(new Set((params.skillIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    activeSkillRunByTaskId.delete(taskId);
    return;
  }
  activeSkillRunByTaskId.set(taskId, {
    agentId: params.agentId,
    skillIds: ids,
    startedAtMs: Date.now(),
  });
}

function finalizeDesktopTaskSkillRun(
  taskId: string,
  params: {
    success: boolean;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }
): void {
  const tracked = activeSkillRunByTaskId.get(taskId);
  if (!tracked) return;
  activeSkillRunByTaskId.delete(taskId);
  const latencyMs = Math.max(0, Date.now() - tracked.startedAtMs);
  void recordUserSkillRunBatch({
    agentId: tracked.agentId,
    skillIds: tracked.skillIds,
    success: params.success,
    latencyMs,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    error: params.error,
  });
}

function reconcileDesktopUsageFromOpenCodeMessage(taskId: string, message: OpenCodeMessage): void {
  const active = activeTurnByTaskId.get(taskId);
  if (!active) return;

  const approxTokensForChars = (chars: number) => Math.max(0, Math.ceil(chars / 4));

  if (message.type === 'text') {
    const textMsg = message as import('@accomplish/shared').OpenCodeTextMessage;
    const messageId = textMsg.part.messageID || 'unknown';
    const nextLen = (textMsg.part.text || '').length;
    const prevLen = active.textLensByMessageId[messageId] ?? 0;
    const deltaChars = nextLen >= prevLen ? (nextLen - prevLen) : nextLen;
    active.textLensByMessageId[messageId] = nextLen;
    active.outputTokensEst += approxTokensForChars(deltaChars);
    return;
  }

  if (message.type !== 'step_finish') return;
  const usage = normalizeOpenCodeUsage(message as import('@accomplish/shared').OpenCodeStepFinishMessage);
  if (!usage) return;

  active.acc.inputTokens += usage.inputTokens;
  active.acc.outputTokens += usage.outputTokens;
  if (typeof usage.cachedInputTokens === 'number') {
    active.acc.cachedInputTokens = (active.acc.cachedInputTokens ?? 0) + usage.cachedInputTokens;
  }
  if (typeof usage.inputHitTokens === 'number') {
    active.acc.inputHitTokens = (active.acc.inputHitTokens ?? 0) + usage.inputHitTokens;
  }
  if (typeof usage.inputMissTokens === 'number') {
    active.acc.inputMissTokens = (active.acc.inputMissTokens ?? 0) + usage.inputMissTokens;
  }
  if (typeof usage.costUsd === 'number') {
    active.acc.costUsd = (active.acc.costUsd ?? 0) + usage.costUsd;
  }

  const inputHitTokens = active.acc.inputHitTokens ?? active.acc.cachedInputTokens;
  const inputMissTokens = active.acc.inputMissTokens ?? Math.max(0, active.acc.inputTokens - (inputHitTokens ?? 0));
  const billableInputTokens = (inputHitTokens ?? 0) + inputMissTokens;

  updateTurnUsage(active.turnId, {
    inputTokens: active.acc.inputTokens,
    outputTokens: active.acc.outputTokens,
    totalTokens: billableInputTokens + active.acc.outputTokens,
    cachedInputTokens: active.acc.cachedInputTokens,
    inputHitTokens,
    inputMissTokens,
    costUsd: active.acc.costUsd,
    estimated: false,
  });
}

function extractScreenshots(output: string): {
  cleanedText: string;
  attachments: Array<{ type: 'screenshot' | 'json'; data: string; label?: string }>;
} {
  const attachments: Array<{ type: 'screenshot' | 'json'; data: string; label?: string }> = [];

  const dataUrlRegex = /data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/g;
  let match;
  while ((match = dataUrlRegex.exec(output)) !== null) {
    attachments.push({
      type: 'screenshot',
      data: match[0],
      label: 'Browser screenshot',
    });
  }

  const rawBase64Regex = /(?<![;,])(?:^|["\s])?(iVBORw0[A-Za-z0-9+/=]{100,})(?:["\s]|$)/g;
  while ((match = rawBase64Regex.exec(output)) !== null) {
    const base64Data = match[1];
    if (base64Data && base64Data.length > 100) {
      attachments.push({
        type: 'screenshot',
        data: `data:image/png;base64,${base64Data}`,
        label: 'Browser screenshot',
      });
    }
  }

  const cleanedText = output
    .replace(dataUrlRegex, '[Screenshot captured]')
    .replace(rawBase64Regex, '[Screenshot captured]');

  return { cleanedText, attachments };
}

function sanitizeToolOutput(text: string, isError: boolean): string {
  let result = text;

  if (isError) {
    const timeoutMatch = result.match(/timed? ?out after (\d+)ms/i);
    if (timeoutMatch) {
      const seconds = Math.round(parseInt(timeoutMatch[1]) / 1000);
      return `Timed out after ${seconds}s`;
    }

    const protocolMatch = result.match(/Protocol error \([^)]+\):\s*(.+)/i);
    if (protocolMatch) {
      result = protocolMatch[1].trim();
    }

    result = result.replace(/^Error executing code:\s*/i, '');
    result = result.replace(/browserType\.connectOverCDP:\s*/i, '');
    result = result.replace(/\s+at\s+.+/g, '');
    result = result.replace(/\w+Error:\s*/g, '');
  }

  return result.trim();
}

function extractAssistantFromToolOutput(toolName: string, toolOutput: string): string | null {
  if (toolName.toLowerCase() !== 'bash') {
    return null;
  }

  const trimmed = toolOutput.trim();
  if (!trimmed) {
    return null;
  }

  const pageTitleMatch = trimmed.match(/(?:RESULT_TITLE|PAGE_TITLE|TITLE):\s*([^\r\n]+)/i);
  if (pageTitleMatch) {
    return `Page title: ${pageTitleMatch[1].trim()}`;
  }

  const jsonMatch = trimmed.match(/\{[^\r\n]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { title?: unknown; url?: unknown };
      if (typeof parsed.title === 'string' && parsed.title.trim()) {
        const title = parsed.title.trim();
        const url = typeof parsed.url === 'string' ? parsed.url.trim() : '';
        return url ? `Page title: ${title}\nURL: ${url}` : `Page title: ${title}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function toDesktopTaskMessage(message: OpenCodeMessage): TaskMessage | null {
  if (message.type === 'text') {
    const content = buildAssistantContentWithReasoning(message, message.part.text);
    if (content) {
      return {
        id: createDesktopMessageId(),
        type: 'assistant',
        content,
        timestamp: new Date().toISOString(),
      };
    }
    return null;
  }

  if (message.type === 'tool_call') {
    return {
      id: createDesktopMessageId(),
      type: 'tool',
      content: `Using tool: ${message.part.tool}`,
      toolName: message.part.tool,
      toolInput: message.part.input,
      timestamp: new Date().toISOString(),
    };
  }

  if (message.type === 'tool_result') {
    const toolResultMsg = message as import('@accomplish/shared').OpenCodeToolResultMessage;
    const toolOutput = toolResultMsg.part.output || '';
    const isError = Boolean(toolResultMsg.part.isError);
    const { cleanedText, attachments } = extractScreenshots(toolOutput);
    const sanitizedText = sanitizeToolOutput(cleanedText, isError);

    return {
      id: createDesktopMessageId(),
      type: 'tool',
      content: sanitizedText || 'Tool result',
      toolName: 'tool_result',
      timestamp: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  if (message.type === 'tool_use') {
    const toolUseMsg = message as import('@accomplish/shared').OpenCodeToolUseMessage;
    const toolName = toolUseMsg.part.tool || 'unknown';
    const toolInput = toolUseMsg.part.state?.input;
    const toolOutput = toolUseMsg.part.state?.output || '';
    const status = toolUseMsg.part.state?.status;

    if (status === 'completed' || status === 'error') {
      const { cleanedText, attachments } = extractScreenshots(toolOutput);

      if (status === 'completed') {
        const assistantContent = extractAssistantFromToolOutput(toolName, cleanedText);
        if (assistantContent) {
          return {
            id: createDesktopMessageId(),
            type: 'assistant',
            content: assistantContent,
            timestamp: new Date().toISOString(),
            attachments: attachments.length > 0 ? attachments : undefined,
          };
        }
      }

      const isError = status === 'error';
      const sanitizedText = sanitizeToolOutput(cleanedText, isError);

      return {
        id: createDesktopMessageId(),
        type: 'tool',
        content: sanitizedText || `Tool ${toolName} ${status}`,
        toolName,
        toolInput,
        timestamp: new Date().toISOString(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }
    return null;
  }

  const fallbackText = (message as { part?: { text?: unknown }; text?: unknown; content?: unknown }).part?.text
    ?? (message as { text?: unknown }).text
    ?? (message as { content?: unknown }).content;
  const fallbackContent = buildAssistantContentWithReasoning(
    message,
    typeof fallbackText === 'string' ? fallbackText : undefined
  );
  if (fallbackContent) {
    return {
      id: createDesktopMessageId(),
      type: 'assistant',
      content: fallbackContent,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

function finalizeDesktopTurnUsage(taskId: string): {
  inputTokens?: number;
  outputTokens?: number;
} {
  const active = activeTurnByTaskId.get(taskId);
  if (!active) return {};

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  if (active.acc.inputTokens > 0 || active.acc.outputTokens > 0 || typeof active.acc.cachedInputTokens === 'number') {
    const inputHitTokens = active.acc.inputHitTokens ?? active.acc.cachedInputTokens;
    const inputMissTokens = active.acc.inputMissTokens ?? Math.max(0, active.acc.inputTokens - (inputHitTokens ?? 0));
    const billableInputTokens = (inputHitTokens ?? 0) + inputMissTokens;
    updateTurnUsage(active.turnId, {
      inputTokens: active.acc.inputTokens,
      outputTokens: active.acc.outputTokens,
      totalTokens: billableInputTokens + active.acc.outputTokens,
      cachedInputTokens: active.acc.cachedInputTokens,
      inputHitTokens,
      inputMissTokens,
      costUsd: active.acc.costUsd,
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
  activeTurnByTaskId.delete(taskId);
  return { inputTokens, outputTokens };
}

function createDesktopTaskCallbacks(params: {
  taskId: string;
  agentId?: string;
  source?: string;
  taskManager: TaskManager;
  forwardToRenderer: (channel: string, data: unknown) => void;
  attachmentTempFile: string | null;
  clearPermissionsOnError?: boolean;
}): TaskCallbacks {
  const { taskId, agentId, taskManager, forwardToRenderer, attachmentTempFile, clearPermissionsOnError = true } = params;
  const activity = new TaskActivityRuntime({
    taskId,
    agentId,
    emit: (event) => forwardToRenderer('task:activity', event),
  });
  activeActivityByTaskId.set(taskId, activity);

  return {
    onMessage: (message: OpenCodeMessage) => {
      if (isDesktopTaskIgnored(taskId)) return;
      reconcileDesktopUsageFromOpenCodeMessage(taskId, message);
      const taskMessage = toDesktopTaskMessage(message);
      if (!taskMessage) return;
      queueDesktopMessage(taskId, taskMessage, forwardToRenderer);
    },

    onProgress: (progress: { stage: string; message?: string }) => {
      if (isDesktopTaskIgnored(taskId)) return;
      activity.emitStarted(progress.message);
      forwardToRenderer('task:progress', {
        taskId,
        ...progress,
      });
    },

    onPermissionRequest: (request: unknown) => {
      if (isDesktopTaskIgnored(taskId)) return;
      flushAndCleanupDesktopBatcher(taskId);
      const permissionDetail = request && typeof request === 'object'
        ? ((request as import('@accomplish/shared').PermissionRequest).toolName
          || (request as import('@accomplish/shared').PermissionRequest).question
          || 'Waiting for user response.')
        : 'Waiting for user response.';
      activity.recordPermissionRequested(permissionDetail);
      if (request && typeof request === 'object') {
        const permissionRequest = request as import('@accomplish/shared').PermissionRequest;
        if (permissionRequest.id && permissionRequest.taskId && permissionRequest.type) {
          const agentId = getTask(permissionRequest.taskId)?.agentId;
          const decision = evaluateInteractivePermissionPolicy(permissionRequest, undefined, agentId);
          recordPermissionPolicyAuditEntry(createPermissionPolicyAuditEntry({
            origin: 'desktop-runtime',
            agentId,
            request: permissionRequest,
            decision,
          }));

          if (decision.action !== 'prompt') {
            let responseText: string | null = null;
            if (decision.action === 'deny') {
              responseText = 'no';
            } else if (permissionRequest.type === 'tool') {
              responseText = 'yes';
            } else if (permissionRequest.type === 'question') {
              const optionLabels = Array.isArray(permissionRequest.options)
                ? permissionRequest.options
                  .map((option) => String(option?.label || '').trim())
                  .filter(Boolean)
                : [];
              if (optionLabels.length === 1) {
                responseText = optionLabels[0];
              }
            }

            if (responseText) {
              void taskManager.sendResponse(taskId, responseText).then(() => {
                activity.recordPermissionResolved('Permission policy resolved this request.');
                const systemMessage: TaskMessage = {
                  id: createDesktopMessageId(),
                  type: 'system',
                  content: `Permission policy auto-${decision.action === 'allow' ? 'allowed' : 'denied'} ${permissionRequest.type}${permissionRequest.toolName ? ` ${permissionRequest.toolName}` : ''}.`,
                  timestamp: new Date().toISOString(),
                };
                addTaskMessage(taskId, systemMessage);
                forwardToRenderer('task:update', {
                  taskId,
                  type: 'message',
                  message: systemMessage,
                });
              }).catch((error) => {
                console.warn('[DesktopAgentEngine] Failed to auto-resolve permission request:', error);
                forwardToRenderer('permission:request', request);
              });
              return;
            }
          }
        }
      }
      forwardToRenderer('permission:request', request);
    },

    onComplete: (result: TaskResult) => {
      if (isDesktopTaskIgnored(taskId)) return;
      flushAndCleanupDesktopBatcher(taskId);
      activity.recordCompletion(result);
      cleanupDesktopTempFile(attachmentTempFile);
      clearTaskFilePermissionPolicy(taskId);

      const { inputTokens, outputTokens } = finalizeDesktopTurnUsage(taskId);
      const wasSuccess = result.status === 'success';
      finalizeDesktopTaskSkillRun(taskId, {
        success: wasSuccess,
        inputTokens,
        outputTokens,
        error: wasSuccess ? undefined : (result.status === 'interrupted' ? 'Task interrupted' : 'Task failed'),
      });

      forwardToRenderer('task:update', {
        taskId,
        type: 'complete',
        result,
      });

      let taskStatus: TaskStatus;
      if (result.status === 'success') {
        taskStatus = 'completed';
      } else if (result.status === 'interrupted') {
        taskStatus = 'interrupted';
      } else {
        taskStatus = 'failed';
      }

      updateTaskStatus(taskId, taskStatus, new Date().toISOString());

      const sessionId = result.sessionId || taskManager.getSessionId(taskId);
      if (sessionId) {
        updateTaskSessionId(taskId, sessionId);
      }
      schedulePostTaskLearning({
        taskId,
        agentId,
        source: params.source,
        status: result.status,
      });
      cleanupDesktopActivity(taskId);
    },

    onError: (error: Error) => {
      if (isDesktopTaskIgnored(taskId)) return;
      flushAndCleanupDesktopBatcher(taskId);
      activity.recordError(error);
      cleanupDesktopTempFile(attachmentTempFile);
      if (clearPermissionsOnError) {
        clearTaskFilePermissionPolicy(taskId);
      }

      const active = activeTurnByTaskId.get(taskId);
      const inputTokens = active ? (active.acc.inputTokens > 0 ? active.acc.inputTokens : active.promptTokensEst) : undefined;
      const outputTokens = active ? (active.acc.outputTokens > 0 ? active.acc.outputTokens : active.outputTokensEst) : undefined;
      if (active) {
        activeTurnByTaskId.delete(taskId);
      }
      finalizeDesktopTaskSkillRun(taskId, {
        success: false,
        inputTokens,
        outputTokens,
        error: error.message,
      });

      forwardToRenderer('task:update', {
        taskId,
        type: 'error',
        error: error.message,
      });

      updateTaskStatus(taskId, 'failed', new Date().toISOString());
      cleanupDesktopActivity(taskId);
    },

    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (isDesktopTaskIgnored(taskId)) return;
      if (getDebugMode()) {
        forwardToRenderer('debug:log', {
          taskId,
          timestamp: new Date().toISOString(),
          ...log,
        });
      }
    },

    onStatusChange: (status: TaskStatus) => {
      if (isDesktopTaskIgnored(taskId)) return;
      forwardToRenderer('task:status-change', {
        taskId,
        status,
      });
      updateTaskStatus(taskId, status, new Date().toISOString());
    },
  };
}

export async function startDesktopTaskFlow(params: {
  taskManager: TaskManager;
  window: BrowserWindow;
  sender: WebContents;
  validatedConfig: TaskConfig;
  taskId: string;
  userVisiblePrompt: string;
  attachmentMeta: FileAttachmentMeta[];
  attachmentTempFile: string | null;
  attachmentContentForEstimate: string;
  currentAttachedFiles?: string[];
  privacyMode: 'normal' | 'incognito';
  isIncognito: boolean;
}): Promise<Task> {
  const {
    taskManager,
    window,
    sender,
    validatedConfig,
    taskId,
    userVisiblePrompt,
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    currentAttachedFiles,
    privacyMode,
    isIncognito,
  } = params;

  const sessionFilePath = isIncognito
    ? initDesktopEphemeralSessionLog(taskId)
    : initSessionLog(validatedConfig.agentId, taskId);
  const previousTask = getLatestTask(validatedConfig.agentId);
  validatedConfig.sessionId = maybeReuseDesktopWarmSession(taskId, validatedConfig.sessionId, previousTask, {
    agentId: validatedConfig.agentId,
    prompt: validatedConfig.prompt,
    currentAttachedFiles,
  });
  if (
    !isIncognito &&
    previousTask &&
    previousTask.privacyMode !== 'incognito' &&
    previousTask.id !== taskId &&
    !previousTask.sessionMemorySavedAt &&
    previousTask.messages?.length
  ) {
    const memorySaved = await maybeSaveDesktopPreviousSessionMemory({
      previousTask,
      agentId: validatedConfig.agentId,
      taskId,
      source: 'desktop',
    });
    if (memorySaved) {
      updateTaskSessionMemorySaved(previousTask.id, new Date().toISOString());
    }
  }

  const prepared = await preparePayloadForSend({
    agentId: validatedConfig.agentId,
    taskId,
    sessionFilePath,
    userMessage: validatedConfig.prompt,
    retrievedText: attachmentContentForEstimate,
    baseSystemPromptAppend: validatedConfig.systemPromptAppend,
    requireApiKey: true,
  });
  validatedConfig.systemPromptAppend = prepared.systemPromptAppend;
  trackDesktopTaskSkillRun(taskId, {
    agentId: validatedConfig.agentId,
    skillIds: prepared.selectedSkillIds,
  });

  appendSessionLogMessage({
    sessionFilePath,
    role: 'user',
    content: formatDesktopPromptWithAttachments(userVisiblePrompt, attachmentMeta),
  });

  const turnId = createDesktopTurnId();
  activeTurnByTaskId.set(taskId, {
    turnId,
    promptTokensEst: prepared.estimate.promptTokensEst,
    acc: { inputTokens: 0, outputTokens: 0 },
    outputTokensEst: 0,
    textLensByMessageId: {},
  });
  addTurnLog({
    id: turnId,
    taskId,
    createdAt: new Date().toISOString(),
    provider: prepared.provider,
    model: prepared.model,
    contextLimitTokens: prepared.context.contextLimitTokens,
    maxOutputTokens: prepared.context.maxOutputTokens,
    headroomSafetyTokens: prepared.context.headroomSafetyTokens,
    promptTokensEst: prepared.estimate.promptTokensEst,
    estimated: prepared.estimate.estimated,
    breakdown: prepared.estimate.breakdown,
    trimmed: prepared.trimmed,
    droppedMessages: prepared.droppedMessages,
    summaryInserted: prepared.summaryInserted,
    shouldResetSession: prepared.shouldResetSession,
    usageProjectId: validatedConfig.usageProjectId,
    usage: {
      inputTokens: prepared.estimate.promptTokensEst,
      outputTokens: 0,
      totalTokens: prepared.estimate.promptTokensEst,
      estimated: true,
    },
  });

  const callbacks = createDesktopTaskCallbacks({
    taskId,
    agentId: validatedConfig.agentId,
    source: validatedConfig.buildMode ? 'build' : 'chat',
    taskManager,
    forwardToRenderer: createDesktopRendererForwarder(window, sender),
    attachmentTempFile,
  });

  let task: Task;
  try {
    task = await taskManager.startTask(taskId, validatedConfig, callbacks);
  } catch (error) {
    activeTurnByTaskId.delete(taskId);
    activeSkillRunByTaskId.delete(taskId);
    cleanupDesktopActivity(taskId);
    throw error;
  }
  task.agentId = validatedConfig.agentId;
  task.privacyMode = privacyMode;
  task.usageProjectId = validatedConfig.usageProjectId;
  (task as Task & { sessionFilePath?: string }).sessionFilePath = sessionFilePath;

  const initialUserMessage: TaskMessage = {
    id: createDesktopMessageId(),
    type: 'user',
    content: formatDesktopPromptWithAttachments(userVisiblePrompt, attachmentMeta),
    timestamp: new Date().toISOString(),
    ...(attachmentMeta.length > 0 && {
      attachments: [{
        type: 'json' as const,
        data: JSON.stringify(attachmentMeta),
        label: 'File attachment processing results',
      }],
    }),
  };
  task.messages = [initialUserMessage];
  task.prompt = userVisiblePrompt;

  saveTask(task);
  updateTaskSessionFilePath(taskId, sessionFilePath);

  if (!isIncognito) {
    generateTaskSummary(userVisiblePrompt, validatedConfig.agentId)
      .then((summary) => {
        updateTaskSummary(taskId, summary);
        if (!window.isDestroyed() && !sender.isDestroyed()) {
          sender.send('task:summary', { taskId, summary });
        }
      })
      .catch((err) => {
        console.warn('[DesktopAgentEngine] Failed to generate task summary:', err);
      });
  }

  return task;
}

export async function startDesktopTaskRequest(params: {
  window: BrowserWindow;
  sender: WebContents;
  validatedConfig: TaskConfig;
}): Promise<Task> {
  const { window, sender, validatedConfig } = params;
  const taskManager = getTaskManager();
  const privacyMode = validatedConfig.privacyMode ?? 'normal';
  const isIncognito = privacyMode === 'incognito';
  const userVisiblePrompt = validatedConfig.prompt;
  const currentAttachedFiles = Array.isArray(validatedConfig.attachedFiles)
    ? [...validatedConfig.attachedFiles]
    : undefined;
  assertUsageBudgetAllowsRun(validatedConfig.agentId, validatedConfig.usageProjectId);
  const {
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    runtimeAttachedFiles,
  } = await prepareDesktopAttachedFiles(validatedConfig.attachedFiles);
  validatedConfig.attachedFiles = runtimeAttachedFiles;

  const taskId = validatedConfig.taskId || createDesktopTaskId();
  validatedConfig.taskId = taskId;

  return startDesktopTaskFlow({
    taskManager,
    window,
    sender,
    validatedConfig,
    taskId,
    userVisiblePrompt,
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    currentAttachedFiles,
    privacyMode,
    isIncognito,
  });
}

export async function resumeDesktopSessionFlow(params: {
  taskManager: TaskManager;
  window: BrowserWindow;
  sender: WebContents;
  validatedSessionId: string;
  validatedPrompt: string;
  validatedExistingTaskId?: string;
  existingTask?: Task & { sessionFilePath?: string };
  resumeConfig: TaskConfig;
  attachmentMeta: FileAttachmentMeta[];
  attachmentTempFile: string | null;
  attachmentContentForEstimate: string;
  currentAttachedFiles?: string[];
  effectivePrivacyMode: 'normal' | 'incognito';
}): Promise<Task> {
  const {
    taskManager,
    window,
    sender,
    validatedSessionId,
    validatedPrompt,
    validatedExistingTaskId,
    existingTask,
    resumeConfig,
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    currentAttachedFiles,
    effectivePrivacyMode,
  } = params;

  const taskId = validatedExistingTaskId || createDesktopTaskId();
  const isIncognito = effectivePrivacyMode === 'incognito';
  const sessionFilePath = existingTask?.sessionFilePath || (isIncognito
    ? initDesktopEphemeralSessionLog(taskId)
    : initSessionLog(existingTask?.agentId, taskId));
  if (!existingTask?.sessionFilePath) {
    updateTaskSessionFilePath(taskId, sessionFilePath);
  }

  let resumeSessionLogContent = validatedPrompt;
  if (validatedExistingTaskId) {
    const displayContent = formatDesktopPromptWithAttachments(validatedPrompt, attachmentMeta);
    resumeSessionLogContent = displayContent;
    const userMessage: TaskMessage = {
      id: createDesktopMessageId(),
      type: 'user',
      content: displayContent,
      timestamp: new Date().toISOString(),
      ...(attachmentMeta.length > 0 && {
        attachments: [{
          type: 'json' as const,
          data: JSON.stringify(attachmentMeta),
          label: 'File attachment processing results',
        }],
      }),
    };
    addTaskMessage(validatedExistingTaskId, userMessage, { skipSessionLog: true });
  }

  const prepared = await preparePayloadForSend({
    agentId: resumeConfig.agentId,
    taskId,
    sessionFilePath,
    userMessage: resumeConfig.prompt,
    retrievedText: attachmentContentForEstimate,
    baseSystemPromptAppend: resumeConfig.systemPromptAppend,
    requireApiKey: true,
  });
  const sessionIntegrity = inspectOpenCodeSessionIntegrity(validatedSessionId);
  const sessionResetReason = sessionIntegrity.healthy
    ? (getMiniMaxHistoricalImageSessionResetReason({
        selectedModel: resolveSelectedModelForAgent(resumeConfig.agentId),
        prompt: resumeConfig.prompt,
        currentAttachedFiles,
        sessionId: validatedSessionId,
        sessionFilePath,
        task: existingTask,
      }) || '')
    : buildOpenCodeSessionResetMessage(sessionIntegrity.issues);
  resumeConfig.systemPromptAppend = prepared.systemPromptAppend;
  trackDesktopTaskSkillRun(taskId, {
    agentId: resumeConfig.agentId,
    skillIds: prepared.selectedSkillIds,
  });
  if (prepared.shouldResetSession || sessionResetReason) {
    delete resumeConfig.sessionId;
  }

  const turnId = createDesktopTurnId();
  activeTurnByTaskId.set(taskId, {
    turnId,
    promptTokensEst: prepared.estimate.promptTokensEst,
    acc: { inputTokens: 0, outputTokens: 0 },
    outputTokensEst: 0,
    textLensByMessageId: {},
  });
  addTurnLog({
    id: turnId,
    taskId,
    createdAt: new Date().toISOString(),
    provider: prepared.provider,
    model: prepared.model,
    contextLimitTokens: prepared.context.contextLimitTokens,
    maxOutputTokens: prepared.context.maxOutputTokens,
    headroomSafetyTokens: prepared.context.headroomSafetyTokens,
    promptTokensEst: prepared.estimate.promptTokensEst,
    estimated: prepared.estimate.estimated,
    breakdown: prepared.estimate.breakdown,
    trimmed: prepared.trimmed,
    droppedMessages: prepared.droppedMessages,
    summaryInserted: prepared.summaryInserted,
    shouldResetSession: prepared.shouldResetSession,
    usageProjectId: resumeConfig.usageProjectId,
    usage: {
      inputTokens: prepared.estimate.promptTokensEst,
      outputTokens: 0,
      totalTokens: prepared.estimate.promptTokensEst,
      estimated: true,
    },
  });

  appendSessionLogMessage({
    sessionFilePath,
    role: 'user',
    content: resumeSessionLogContent,
  });

  const callbacks = createDesktopTaskCallbacks({
    taskId,
    agentId: resumeConfig.agentId,
    source: resumeConfig.buildMode ? 'build' : 'chat',
    taskManager,
    forwardToRenderer: createDesktopRendererForwarder(window, sender),
    attachmentTempFile,
    clearPermissionsOnError: false,
  });

  let task: Task;
  try {
    task = await taskManager.startTask(taskId, resumeConfig, callbacks);
  } catch (error) {
    activeTurnByTaskId.delete(taskId);
    activeSkillRunByTaskId.delete(taskId);
    cleanupDesktopActivity(taskId);
    throw error;
  }
  task.agentId = resumeConfig.agentId;
  task.privacyMode = effectivePrivacyMode;
  task.usageProjectId = resumeConfig.usageProjectId;
  (task as Task & { sessionFilePath?: string }).sessionFilePath = sessionFilePath;
  updateTaskSessionFilePath(taskId, sessionFilePath);
  if (sessionResetReason) {
    if (isMiniMaxHistoricalImageSessionResetReason(sessionResetReason)) {
      markTaskMiniMaxHistoricalImageSessionReset(taskId, new Date().toISOString());
    } else {
      const systemMessage: TaskMessage = {
        id: createDesktopMessageId(),
        type: 'system',
        content: sessionResetReason,
        timestamp: new Date().toISOString(),
      };
      addTaskMessage(taskId, systemMessage);
      createDesktopRendererForwarder(window, sender)('task:update', {
        taskId,
        type: 'message',
        message: systemMessage,
      });
    }
  }

  if (validatedExistingTaskId) {
    updateTaskStatus(validatedExistingTaskId, task.status, new Date().toISOString());
  }

  return task;
}

export async function resumeDesktopSessionRequest(params: {
  window: BrowserWindow;
  sender: WebContents;
  validatedSessionId: string;
  validatedPrompt: string;
  validatedExistingTaskId?: string;
  attachedFiles?: string[];
  privacyMode?: 'normal' | 'incognito';
  usageProjectId?: string | null;
  resumeOptions?: {
    workingDirectory?: string;
    requiresBrowser?: boolean;
    buildMode?: boolean;
    buildWorkspaceRelativePath?: string;
  };
  applyAgentContext: (config: TaskConfig) => TaskConfig;
}): Promise<Task> {
  const {
    window,
    sender,
    validatedSessionId,
    validatedPrompt,
    validatedExistingTaskId,
    attachedFiles,
    privacyMode,
    usageProjectId,
    resumeOptions,
    applyAgentContext,
  } = params;
  const taskManager = getTaskManager();

  const {
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    runtimeAttachedFiles,
  } = await prepareDesktopAttachedFiles(attachedFiles);

  const taskId = validatedExistingTaskId || createDesktopTaskId();
  const existingTask = validatedExistingTaskId ? getTask(validatedExistingTaskId) : undefined;
  const effectivePrivacyMode: 'normal' | 'incognito' =
    privacyMode || existingTask?.privacyMode || 'normal';

  const resumeConfig = applyAgentContext({
    prompt: validatedPrompt,
    sessionId: validatedSessionId,
    taskId,
    agentId: existingTask?.agentId,
    workingDirectory: resumeOptions?.workingDirectory,
    attachedFiles: runtimeAttachedFiles,
    privacyMode: effectivePrivacyMode,
    usageProjectId: usageProjectId ?? existingTask?.usageProjectId ?? null,
    requiresBrowser: resumeOptions?.requiresBrowser,
    buildMode: resumeOptions?.buildMode === true ? true : undefined,
    buildWorkspaceRelativePath: resumeOptions?.buildWorkspaceRelativePath,
  });
  assertUsageBudgetAllowsRun(resumeConfig.agentId, resumeConfig.usageProjectId);

  return resumeDesktopSessionFlow({
    taskManager,
    window,
    sender,
    validatedSessionId,
    validatedPrompt,
    validatedExistingTaskId,
    existingTask,
    resumeConfig,
    attachmentMeta,
    attachmentTempFile,
    attachmentContentForEstimate,
    currentAttachedFiles: Array.isArray(attachedFiles) ? [...attachedFiles] : undefined,
    effectivePrivacyMode,
  });
}
