import { BrowserWindow } from 'electron';
import type {
  Task,
  TaskConfig,
  TaskMessage,
  TaskResult,
  TaskStatus,
  OpenCodeMessage,
  PermissionRequest,
  GatewayConnectorExtensionId,
} from '@accomplish/shared';
import { getTaskManager, type TaskCallbacks } from '../opencode/task-manager';
import { generateTaskSummary } from './summarizer';
import {
  addTaskMessage,
  getLatestTask,
  getTask,
  saveTask,
  updateTaskSessionId,
  updateTaskStatus,
  updateTaskSummary,
  updateTaskMemoryFlush,
  updateTaskSessionMemorySaved,
  updateTaskSessionFilePath,
} from '../store/taskHistory';
import { getDebugMode } from '../store/appSettings';
import { composeAgentSystemPromptAppend, getAgentContext } from './agent-context';
import { buildMemoryFlushPrompt, saveSessionMemorySnapshot, initSessionLog } from './memory';
import { preparePayloadForSend } from './context/prepare-payload';
import { normalizeOpenCodeUsage } from './context/usage-normalize';
import { appendSessionLogMessage } from './context/session-log';
import { addTurnLog, updateTurnUsage } from '../store/tokenUsage';
import { recordUserSkillRunBatch } from './user-skills';
import { buildAttachmentsPrefix } from '../utils/file-attachments';
import { clearTaskFilePermissionPolicy, initPermissionApi, startPermissionApiServer } from '../permission-api';
import { startNodeToolsApiServer } from '../node-tools-api';
import { enqueueWebPermissionRequest } from './webhook-permissions';
import { computeCompactionThresholds } from './context/compaction-thresholds';
import { detectTaskNeedsBrowser, getRuntimeSpeedMode } from './task-intent';
import { upsertGatewaySession } from '../store/gatewaySessions';
import type { GatewayPeerKind } from '../store/gatewayBindings';
import { sendConnectorOutboundMessage } from './connector-outbound';

const MAX_TEXT_LENGTH = 8000;
const WARM_SESSION_WINDOW_MS = Number(process.env.OPENDESKMATE_WARM_SESSION_WINDOW_MS || 5 * 60 * 1000);
const AGENTIC_LOOP_DEFAULT_MAX_ITERATIONS = 4;
const AGENTIC_LOOP_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const AGENTIC_LOOP_PROTOCOL_APPEND = [
  'Agentic loop protocol:',
  '- Work in cycles: think, plan, act, observe.',
  '- Continue until the task is complete or blocked by a real constraint.',
  '- Optional (helps orchestration): include LOOP_STATUS: CONTINUE or LOOP_STATUS: COMPLETE near the end.',
].join('\n');
const AGENTIC_LOOP_CONTINUE_PROMPT = [
  'Continue the same task using your latest plan and observations.',
  'Do the next concrete step and continue progressing toward completion.',
].join('\n');
let permissionApiInitialized = false;
let nodeToolsApiInitialized = false;

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

function createTaskId(prefix = 'task'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

type TurnUsageAccumulator = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
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
const agenticRunSignalByTaskId = new Map<string, AgenticRunSignal>();
const AGENTIC_LOOP_COMPLETION_CUE_RE = /\b(done|completed?|finished|resolved|all set|successful(?:ly)?)\b/i;

function createTurnId(): string {
  // Separate from message IDs to avoid any UI key collisions.
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function trackTaskSkillRun(taskId: string, params: { agentId?: string; skillIds?: string[] }): void {
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

function finalizeTaskSkillRun(
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

function reconcileUsageFromOpenCodeMessage(taskId: string, message: OpenCodeMessage): void {
  const active = activeTurnByTaskId.get(taskId);
  if (!active) return;

  const approxTokensForChars = (chars: number) => Math.max(0, Math.ceil(chars / 4));

  if (message.type === 'text') {
    const textMsg = message as import('@accomplish/shared').OpenCodeTextMessage;
    const messageId = textMsg.part.messageID || 'unknown';
    const nextLen = (textMsg.part.text || '').length;
    const prevLen = active.textLensByMessageId[messageId] ?? 0;
    // OpenCode may stream deltas or full-so-far text. Count only the delta.
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

  // Update continuously when provider-reported usage is available.
  updateTurnUsage(active.turnId, {
    inputTokens: active.acc.inputTokens,
    outputTokens: active.acc.outputTokens,
    totalTokens: active.acc.inputTokens + active.acc.outputTokens,
    cachedInputTokens: active.acc.cachedInputTokens,
    estimated: false,
  });

  const reason = (message as import('@accomplish/shared').OpenCodeStepFinishMessage).part.reason;
  if (reason === 'end_turn' || reason === 'stop' || reason === 'error') {
    console.log('[ContextIndicator] Reconciled usage', {
      taskId,
      turnId: active.turnId,
      inputTokens: active.acc.inputTokens,
      outputTokens: active.acc.outputTokens,
      cachedInputTokens: active.acc.cachedInputTokens ?? 0,
      reason,
    });
  }
}

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

function shouldRunMemoryFlushFromContext(params: {
  memoryFlushCount?: number;
  contextLimitTokens: number;
  usedPct: number;
  safeRemainingForReply: number;
}): boolean {
  if ((params.memoryFlushCount ?? 0) >= 1) return false;
  const thresholds = computeCompactionThresholds({ contextLimitTokens: params.contextLimitTokens });
  return params.usedPct > 0.75 || params.safeRemainingForReply < thresholds.triggerTokens;
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

  let cleanedText = output
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

function toTaskMessage(message: OpenCodeMessage): TaskMessage | null {
  if (message.type === 'text') {
    if (message.part.text) {
      return {
        id: createMessageId(),
        type: 'assistant',
        content: message.part.text,
        timestamp: new Date().toISOString(),
      };
    }
    return null;
  }

  if (message.type === 'tool_call') {
    return {
      id: createMessageId(),
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
      id: createMessageId(),
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
            id: createMessageId(),
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
        id: createMessageId(),
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
  if (typeof fallbackText === 'string' && fallbackText.trim()) {
    return {
      id: createMessageId(),
      type: 'assistant',
      content: fallbackText.trim(),
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

function forwardToAllRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function ensurePermissionApi(): void {
  if (permissionApiInitialized) return;
  const windows = BrowserWindow.getAllWindows();
  const mainWindow = windows.length > 0 ? windows[0] : null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const taskManager = getTaskManager();
  initPermissionApi(mainWindow, {
    resolveTaskId: (requestedTaskId?: string) => {
      if (requestedTaskId && taskManager.hasActiveTask(requestedTaskId)) {
        return requestedTaskId;
      }
      if (taskManager.getActiveTaskCount() === 1) {
        return taskManager.getActiveTaskId();
      }
      return null;
    },
    resolveTaskWorkspaceRoot: (taskId: string) => {
      const taskConfig = taskManager.getTaskConfig(taskId);
      const agentWorkspace = taskConfig?.agentId
        ? (getAgentContext(taskConfig.agentId).workspaceRoot || '').trim()
        : '';
      if (agentWorkspace) {
        return agentWorkspace;
      }
      const fallbackWorkingDir = String(taskConfig?.workingDirectory || '').trim();
      return fallbackWorkingDir || null;
    },
  });
  startPermissionApiServer();
  permissionApiInitialized = true;
}

function ensureNodeToolsApi(): void {
  if (nodeToolsApiInitialized) return;
  startNodeToolsApiServer();
  nodeToolsApiInitialized = true;
}

export interface DispatchResult {
  taskId: string;
  task: Task;
  completion: Promise<TaskResult>;
}

export interface GatewayRouteContext {
  channel?: string;
  accountId?: string;
  connectorInstanceId?: string;
  peerKind?: GatewayPeerKind;
  peerId?: string;
}

export interface DispatchTaskOptions {
  source?: 'schedule' | 'webhook' | 'manual' | 'gateway' | 'heartbeat';
  sessionKey?: string;
  route?: GatewayRouteContext;
  resume?: {
    workingDirectory?: string;
    attachedFiles?: string[];
    privacyMode?: 'normal' | 'incognito';
  };
  internal?: {
    suppressAgenticLoop?: boolean;
    hiddenPrompt?: boolean;
  };
}

function normalizeGatewaySessionKey(input: string | undefined): string | undefined {
  const normalized = (input ?? '').trim().toLowerCase();
  return normalized || undefined;
}

function normalizeGatewayRouteContext(route: GatewayRouteContext | undefined): GatewayRouteContext | undefined {
  if (!route) return undefined;
  const channel = (route.channel ?? '').trim().toLowerCase() || undefined;
  const accountId = (route.accountId ?? '').trim() || undefined;
  const connectorInstanceId = (route.connectorInstanceId ?? '').trim() || undefined;
  const peerId = (route.peerId ?? '').trim() || undefined;
  if (!channel && !accountId && !connectorInstanceId && !route.peerKind && !peerId) {
    return undefined;
  }
  return {
    channel,
    accountId,
    connectorInstanceId,
    peerKind: route.peerKind,
    peerId,
  };
}

const SUPPORTED_GATEWAY_CONNECTOR_IDS = new Set<GatewayConnectorExtensionId>([
  'discord',
  'telegram',
  'slack',
  'matrix',
  'msteams',
  'mattermost',
  'googlechat',
  'signal',
  'whatsapp',
  'line',
  'bluebubbles',
  'imessage',
  'nextcloud-talk',
  'nostr',
  'tlon',
  'zalo',
  'zalouser',
]);

function asGatewayConnectorId(input: string | undefined): GatewayConnectorExtensionId | null {
  const normalized = (input ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return SUPPORTED_GATEWAY_CONNECTOR_IDS.has(normalized as GatewayConnectorExtensionId)
    ? (normalized as GatewayConnectorExtensionId)
    : null;
}

function toPermissionRequest(input: unknown): PermissionRequest | null {
  if (!input || typeof input !== 'object') return null;
  const request = input as PermissionRequest;
  if (!request.id || !request.taskId) return null;
  return request;
}

function formatPermissionPromptForConnector(request: PermissionRequest): string {
  const headline = request.type === 'file'
    ? `Permission needed: ${String(request.fileOperation || 'file').toUpperCase()} ${request.filePath || ''}`.trim()
    : `Permission needed: ${request.question || `Allow ${request.toolName || 'this action'}?`}`;
  const targetLine = request.targetPath ? `Target: ${request.targetPath}` : '';
  const previewLine = request.contentPreview ? `Preview: ${request.contentPreview}` : '';
  return [
    headline,
    targetLine,
    previewLine,
    'Reply: a=allow, d=deny, aa=allow-all-task.',
    'If multiple pending, use index: a2 / d2 / aa2 (1 = latest).',
    'Example: reply `a` now.',
  ].filter(Boolean).join('\n');
}

async function sendGatewayPermissionPrompt(params: {
  route?: GatewayRouteContext;
  request: PermissionRequest;
}): Promise<void> {
  const route = params.route;
  if (!route?.channel || !route.peerKind || !route.peerId) return;
  const connectorId = asGatewayConnectorId(route.channel);
  if (!connectorId) return;
  try {
    await sendConnectorOutboundMessage({
      connectorId,
      connectorInstanceId: route.connectorInstanceId,
      accountId: route.accountId,
      targetId: route.peerId,
      targetKind: route.peerKind,
      text: formatPermissionPromptForConnector(params.request),
    });
  } catch (error) {
    console.warn('[TaskDispatch] Failed to send connector permission prompt:', error);
  }
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(typeof value === 'string' ? value : '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function resolveAgenticLoopConfig(
  agent: {
    agenticLoopEnabled?: boolean;
    agenticLoopMaxIterations?: number;
    agenticLoopTimeoutMs?: number;
  },
  options?: DispatchTaskOptions
): { enabled: boolean; maxIterations: number; timeoutMs: number } {
  if (options?.internal?.suppressAgenticLoop) {
    return {
      enabled: false,
      maxIterations: AGENTIC_LOOP_DEFAULT_MAX_ITERATIONS,
      timeoutMs: AGENTIC_LOOP_DEFAULT_TIMEOUT_MS,
    };
  }
  return {
    enabled: Boolean(agent.agenticLoopEnabled),
    maxIterations: clampInteger(agent.agenticLoopMaxIterations, AGENTIC_LOOP_DEFAULT_MAX_ITERATIONS, 1, 20),
    timeoutMs: clampInteger(agent.agenticLoopTimeoutMs, AGENTIC_LOOP_DEFAULT_TIMEOUT_MS, 15_000, 3_600_000),
  };
}

function appendAgenticLoopProtocol(baseSystemPromptAppend: string, loopEnabled: boolean): string {
  if (!loopEnabled) return baseSystemPromptAppend;
  return [baseSystemPromptAppend, AGENTIC_LOOP_PROTOCOL_APPEND]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');
}

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

function initAgenticRunSignal(taskId: string): void {
  agenticRunSignalByTaskId.set(taskId, createAgenticRunSignal());
}

function recordAgenticRunSignal(taskId: string, message: OpenCodeMessage): void {
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
  if (signal.lastStepFinishReason === 'tool_use') {
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
    if (signal.lastAssistantText && AGENTIC_LOOP_COMPLETION_CUE_RE.test(signal.lastAssistantText)) {
      return 'complete';
    }
    return 'continue';
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

async function maybeRunAgenticLoop(params: {
  taskId: string;
  agentId: string;
  sessionIdHint?: string;
  completion: Promise<TaskResult>;
  agent: {
    agenticLoopEnabled?: boolean;
    agenticLoopMaxIterations?: number;
    agenticLoopTimeoutMs?: number;
  };
  options?: DispatchTaskOptions;
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

      const sessionId = result.sessionId
        || getTask(params.taskId)?.sessionId
        || getTaskManager().getSessionId(params.taskId)
        || params.sessionIdHint;
      if (!sessionId) {
        return result;
      }

      const resumed = await resumeTaskSession(
        sessionId,
        AGENTIC_LOOP_CONTINUE_PROMPT,
        params.taskId,
        params.agentId,
        {
          ...params.options,
          internal: {
            ...(params.options?.internal ?? {}),
            suppressAgenticLoop: true,
            hiddenPrompt: true,
          },
        }
      );

      const timeoutMessage = `Agentic loop timeout reached while waiting for iteration ${iteration + 1}`;
      try {
        result = await withTimeout(resumed.completion, remainingMs, timeoutMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === timeoutMessage) {
          const taskManager = getTaskManager();
          if (taskManager.hasActiveTask(params.taskId)) {
            await taskManager.interruptTask(params.taskId).catch(() => {});
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

export async function dispatchTask(
  config: TaskConfig,
  options?: DispatchTaskOptions
): Promise<DispatchResult> {
  ensurePermissionApi();
  ensureNodeToolsApi();

  const taskManager = getTaskManager();
  const gatewaySessionKey = normalizeGatewaySessionKey(options?.sessionKey);
  const gatewayRoute = normalizeGatewayRouteContext(options?.route);
  const taskId = config.taskId || createTaskId(options?.source || 'task');
  const validatedPrompt = sanitizeString(config.prompt, 'prompt');
  const agentContext = getAgentContext(config.agentId);
  const sessionFilePath = initSessionLog(agentContext.agentId, taskId);
  const previousTask = getLatestTask(agentContext.agentId);
  const canWarmReuseSession = !gatewaySessionKey;
  if (canWarmReuseSession && !config.sessionId && previousTask && previousTask.id !== taskId && previousTask.sessionId) {
    const terminalStatuses = new Set<TaskStatus>(['completed', 'interrupted', 'failed', 'cancelled']);
    if (terminalStatuses.has(previousTask.status)) {
      const completedAtMs = Date.parse(previousTask.completedAt || previousTask.createdAt || '');
      if (Number.isFinite(completedAtMs) && (Date.now() - completedAtMs) <= WARM_SESSION_WINDOW_MS) {
        config.sessionId = previousTask.sessionId;
        console.log('[TaskDispatch] Reusing warm session', {
          fromTaskId: previousTask.id,
          sessionId: previousTask.sessionId,
          ageMs: Date.now() - completedAtMs,
        });
      }
    }
  }
  if (
    previousTask &&
    previousTask.id !== taskId &&
    !previousTask.sessionMemorySavedAt &&
    previousTask.messages?.length
  ) {
    // Best-effort snapshot of the previous session (Clawdbot parity behavior).
    // Do NOT block starting the next task, and prefer running when idle so we
    // don't slow down the user's active task completion.
    const runSnapshotWhenIdle = (attempt = 0) => {
      const active = taskManager.getActiveTaskId();
      if (active) {
        if (attempt < 36) {
          setTimeout(() => runSnapshotWhenIdle(attempt + 1), 5000);
        } else {
          console.warn('[TaskDispatch] Skipping session memory snapshot (still busy after retries)');
        }
        return;
      }
      void (async () => {
        try {
          const memoryPath = await saveSessionMemorySnapshot(previousTask, agentContext.agentId, options?.source || 'manual');
          if (memoryPath) {
            updateTaskSessionMemorySaved(previousTask.id, new Date().toISOString());
          }
        } catch (error) {
          console.warn('[TaskDispatch] Failed to save session memory snapshot:', error);
        }
      })();
    };
    setTimeout(() => runSnapshotWhenIdle(), 0);
  }
  const workspaceRoot = agentContext.workspaceRoot;
  const workingDirectory = config.workingDirectory || workspaceRoot || undefined;
  const loopConfig = resolveAgenticLoopConfig(agentContext.agent, options);
  const baseSystemPromptAppend = appendAgenticLoopProtocol(
    composeAgentSystemPromptAppend({
      agent: agentContext.agent,
      agentSystemPromptAppend: agentContext.systemPromptAppend,
      requestSystemPromptAppend: config.systemPromptAppend,
    }),
    loopConfig.enabled
  );

  let retrievedText = '';
  if (Array.isArray(config.attachedFiles) && config.attachedFiles.length > 0) {
    const filePaths = config.attachedFiles
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .slice(0, 20);
    if (filePaths.length > 0) {
      const { prompt: attachmentContent } = await buildAttachmentsPrefix(filePaths);
      retrievedText = attachmentContent;
    }
  }

  const prepared = await preparePayloadForSend({
    agentId: agentContext.agentId,
    taskId,
    sessionFilePath,
    userMessage: validatedPrompt,
    retrievedText,
    baseSystemPromptAppend,
    requireApiKey: true,
  });
  trackTaskSkillRun(taskId, {
    agentId: agentContext.agentId,
    skillIds: prepared.selectedSkillIds,
  });

  const validatedConfig: TaskConfig = {
    ...config,
    prompt: validatedPrompt,
    taskId,
    agentId: agentContext.agentId,
    workingDirectory,
    systemPromptAppend: prepared.systemPromptAppend,
    requiresBrowser: detectTaskNeedsBrowser({
      prompt: validatedPrompt,
      systemPromptAppend: prepared.systemPromptAppend,
      requiresBrowser: config.requiresBrowser,
    }),
    speedMode: getRuntimeSpeedMode(config),
  };

  if (gatewaySessionKey) {
    upsertGatewaySession({
      key: gatewaySessionKey,
      agentId: agentContext.agentId,
      sessionId: validatedConfig.sessionId,
      taskId,
      channel: gatewayRoute?.channel,
      accountId: gatewayRoute?.accountId,
      peerKind: gatewayRoute?.peerKind,
      peerId: gatewayRoute?.peerId,
      lastPrompt: validatedPrompt,
    });
  }

  const turnId = createTurnId();
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
    usage: {
      inputTokens: prepared.estimate.promptTokensEst,
      outputTokens: 0,
      totalTokens: prepared.estimate.promptTokensEst,
      estimated: true,
    },
  });

  // Ensure chronological order in the session snapshot (user prompt before assistant).
  appendSessionLogMessage({ sessionFilePath, role: 'user', content: validatedPrompt });

  let resolveCompletion: (result: TaskResult) => void = () => {};
  let rejectCompletion: (error: Error) => void = () => {};
  const completion = new Promise<TaskResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  completion.catch(() => {});
  initAgenticRunSignal(taskId);

  const callbacks: TaskCallbacks = {
    onMessage: (message: OpenCodeMessage) => {
      reconcileUsageFromOpenCodeMessage(taskId, message);
      recordAgenticRunSignal(taskId, message);
      const taskMessage = toTaskMessage(message);
      if (!taskMessage) return;
      addTaskMessage(taskId, taskMessage);
      forwardToAllRenderers('task:update', {
        taskId,
        type: 'message',
        message: taskMessage,
      });
    },
    onProgress: (progress: { stage: string; message?: string }) => {
      forwardToAllRenderers('task:progress', { taskId, ...progress });
    },
    onPermissionRequest: (request: unknown) => {
      try {
        enqueueWebPermissionRequest(request);
      } catch (err) {
        console.warn('[TaskDispatch] Failed to enqueue web permission request:', err);
      }
      const permissionRequest = toPermissionRequest(request);
      if (permissionRequest && options?.source === 'gateway') {
        void sendGatewayPermissionPrompt({
          route: gatewayRoute,
          request: permissionRequest,
        });
      }
      forwardToAllRenderers('permission:request', request);
    },
    onComplete: (result: TaskResult) => {
      // Finalize turn usage if OpenCode didn't emit a terminal step_finish reason.
      let finalInputTokens: number | undefined;
      let finalOutputTokens: number | undefined;
      const active = activeTurnByTaskId.get(taskId);
      if (active) {
        if (active.acc.inputTokens > 0 || active.acc.outputTokens > 0 || typeof active.acc.cachedInputTokens === 'number') {
          updateTurnUsage(active.turnId, {
            inputTokens: active.acc.inputTokens,
            outputTokens: active.acc.outputTokens,
            totalTokens: active.acc.inputTokens + active.acc.outputTokens,
            cachedInputTokens: active.acc.cachedInputTokens,
            estimated: false,
          });
          finalInputTokens = active.acc.inputTokens;
          finalOutputTokens = active.acc.outputTokens;
        } else {
          // Provider didn't report usage; keep estimated input and estimate output from streamed text.
          updateTurnUsage(active.turnId, {
            inputTokens: active.promptTokensEst,
            outputTokens: active.outputTokensEst,
            totalTokens: active.promptTokensEst + active.outputTokensEst,
            estimated: true,
          });
          finalInputTokens = active.promptTokensEst;
          finalOutputTokens = active.outputTokensEst;
        }
        activeTurnByTaskId.delete(taskId);
      }

      const wasSuccess = result.status === 'success';
      finalizeTaskSkillRun(taskId, {
        success: wasSuccess,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        error: wasSuccess ? undefined : (result.status === 'interrupted' ? 'Task interrupted' : 'Task failed'),
      });

      forwardToAllRenderers('task:update', {
        taskId,
        type: 'complete',
        result,
      });
      clearTaskFilePermissionPolicy(taskId);

      let taskStatus: TaskStatus = 'failed';
      if (result.status === 'success') {
        taskStatus = 'completed';
      } else if (result.status === 'interrupted') {
        taskStatus = 'interrupted';
      }
      updateTaskStatus(taskId, taskStatus, new Date().toISOString());

      const newSessionId = result.sessionId || taskManager.getSessionId(taskId);
      if (newSessionId) {
        updateTaskSessionId(taskId, newSessionId);
      }
      if (gatewaySessionKey) {
        upsertGatewaySession({
          key: gatewaySessionKey,
          agentId: agentContext.agentId,
          sessionId: newSessionId ?? validatedConfig.sessionId,
          taskId,
          channel: gatewayRoute?.channel,
          accountId: gatewayRoute?.accountId,
          peerKind: gatewayRoute?.peerKind,
          peerId: gatewayRoute?.peerId,
          lastPrompt: validatedPrompt,
        });
      }

      resolveCompletion(result);
    },
    onError: (error: Error) => {
      let finalInputTokens: number | undefined;
      let finalOutputTokens: number | undefined;
      const active = activeTurnByTaskId.get(taskId);
      if (active) {
        finalInputTokens = active.acc.inputTokens > 0 ? active.acc.inputTokens : active.promptTokensEst;
        finalOutputTokens = active.acc.outputTokens > 0 ? active.acc.outputTokens : active.outputTokensEst;
        activeTurnByTaskId.delete(taskId);
      }
      finalizeTaskSkillRun(taskId, {
        success: false,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        error: error.message,
      });

      forwardToAllRenderers('task:update', {
        taskId,
        type: 'error',
        error: error.message,
      });
      clearTaskFilePermissionPolicy(taskId);
      updateTaskStatus(taskId, 'failed', new Date().toISOString());
      if (gatewaySessionKey) {
        upsertGatewaySession({
          key: gatewaySessionKey,
          agentId: agentContext.agentId,
          sessionId: validatedConfig.sessionId,
          taskId,
          channel: gatewayRoute?.channel,
          accountId: gatewayRoute?.accountId,
          peerKind: gatewayRoute?.peerKind,
          peerId: gatewayRoute?.peerId,
          lastPrompt: validatedPrompt,
        });
      }
      rejectCompletion(error);
    },
    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (getDebugMode()) {
        forwardToAllRenderers('debug:log', {
          taskId,
          timestamp: new Date().toISOString(),
          ...log,
        });
      }
    },
    onStatusChange: (status: TaskStatus) => {
      forwardToAllRenderers('task:status-change', {
        taskId,
        status,
      });
      updateTaskStatus(taskId, status, new Date().toISOString());
    },
  };

  let task: Task;
  try {
    task = await taskManager.startTask(taskId, validatedConfig, callbacks);
  } catch (error) {
    activeTurnByTaskId.delete(taskId);
    activeSkillRunByTaskId.delete(taskId);
    throw error;
  }
  task.agentId = validatedConfig.agentId;
  (task as Task & { sessionFilePath?: string }).sessionFilePath = sessionFilePath;

  const initialUserMessage: TaskMessage = {
    id: createMessageId(),
    type: 'user',
    content: validatedConfig.prompt,
    timestamp: new Date().toISOString(),
  };
  task.messages = [initialUserMessage];

  saveTask(task);
  updateTaskSessionFilePath(taskId, sessionFilePath);
  forwardToAllRenderers('task:created', task);

  generateTaskSummary(validatedConfig.prompt, validatedConfig.agentId)
    .then((summary) => {
      updateTaskSummary(taskId, summary);
      forwardToAllRenderers('task:summary', { taskId, summary });
    })
    .catch((err) => {
      console.warn('[TaskDispatch] Failed to generate task summary:', err);
    });

  const completionWithLoop = maybeRunAgenticLoop({
    taskId,
    agentId: agentContext.agentId,
    sessionIdHint: validatedConfig.sessionId,
    completion,
    agent: agentContext.agent,
    options,
  });
  completionWithLoop.catch(() => {});

  return { taskId, task, completion: completionWithLoop };
}

export async function resumeTaskSession(
  sessionId: string,
  prompt: string,
  existingTaskId?: string,
  agentIdOverride?: string,
  options?: DispatchTaskOptions
): Promise<DispatchResult> {
  ensurePermissionApi();

  const taskManager = getTaskManager();
  const gatewaySessionKey = normalizeGatewaySessionKey(options?.sessionKey);
  const gatewayRoute = normalizeGatewayRouteContext(options?.route);
  const validatedSessionId = sanitizeString(sessionId, 'sessionId', 128);
  const validatedPrompt = sanitizeString(prompt, 'prompt');
  const taskId = existingTaskId ? sanitizeString(existingTaskId, 'taskId', 128) : createTaskId('task');
  const hiddenPrompt = options?.internal?.hiddenPrompt === true;

  if (existingTaskId && !hiddenPrompt) {
    const userMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: validatedPrompt,
      timestamp: new Date().toISOString(),
    };
    addTaskMessage(taskId, userMessage, { skipSessionLog: true });
    forwardToAllRenderers('task:update', {
      taskId,
      type: 'message',
      message: userMessage,
    });
  }

  const existingTask = existingTaskId ? getTask(existingTaskId) : undefined;
  const agentContext = getAgentContext(agentIdOverride ?? existingTask?.agentId);
  const sessionFilePath = existingTask?.sessionFilePath || initSessionLog(agentContext.agentId, taskId);
  if (!existingTask?.sessionFilePath) {
    updateTaskSessionFilePath(taskId, sessionFilePath);
  }
  const resumeWorkingDirectory = (options?.resume?.workingDirectory ?? '').trim() || undefined;
  const resumeAttachedFiles = Array.isArray(options?.resume?.attachedFiles)
    ? options.resume.attachedFiles
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)
      .map((filePath) => filePath.trim())
      .slice(0, 20)
    : [];
  const effectivePrivacyMode =
    options?.resume?.privacyMode === 'normal' || options?.resume?.privacyMode === 'incognito'
      ? options.resume.privacyMode
      : existingTask?.privacyMode;
  const workspaceRoot = agentContext.workspaceRoot;
  const workingDirectory = resumeWorkingDirectory || workspaceRoot || undefined;
  const loopConfig = resolveAgenticLoopConfig(agentContext.agent, options);
  const baseSystemPromptAppendNoFlush = appendAgenticLoopProtocol(
    composeAgentSystemPromptAppend({
      agent: agentContext.agent,
      agentSystemPromptAppend: agentContext.systemPromptAppend,
    }),
    loopConfig.enabled
  );
  // Preflight in unsafe-only mode so we can decide whether we should run a "memory flush"
  // before preemptive compaction drops older history.
  const preflight = await preparePayloadForSend({
    agentId: agentContext.agentId,
    taskId,
    sessionFilePath,
    userMessage: validatedPrompt,
    baseSystemPromptAppend: baseSystemPromptAppendNoFlush,
    requireApiKey: false,
    compactionMode: 'unsafeOnly',
  });
  const shouldFlush =
    Boolean(existingTaskId) &&
    shouldRunMemoryFlushFromContext({
      memoryFlushCount: existingTask?.memoryFlushCount,
      contextLimitTokens: preflight.context.contextLimitTokens,
      usedPct: preflight.context.usedPct,
      safeRemainingForReply: preflight.context.safeRemainingForReply,
    });
  const flushPrompt = shouldFlush ? buildMemoryFlushPrompt() : '';

  const baseSystemPromptAppend = [baseSystemPromptAppendNoFlush, flushPrompt]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');

  let retrievedText = '';
  if (resumeAttachedFiles.length > 0) {
    const { prompt: attachmentContent } = await buildAttachmentsPrefix(resumeAttachedFiles);
    retrievedText = attachmentContent;
  }

  const prepared = await preparePayloadForSend({
    agentId: agentContext.agentId,
    taskId,
    sessionFilePath,
    userMessage: validatedPrompt,
    retrievedText,
    baseSystemPromptAppend,
    requireApiKey: true,
    // Preserve more history for the memory flush turn if it still fits.
    compactionMode: shouldFlush ? 'unsafeOnly' : 'preemptive',
  });
  trackTaskSkillRun(taskId, {
    agentId: agentContext.agentId,
    skillIds: prepared.selectedSkillIds,
  });
  const validatedConfig: TaskConfig = {
    prompt: validatedPrompt,
    sessionId: validatedSessionId,
    taskId,
    agentId: agentContext.agentId,
    workingDirectory,
    attachedFiles: resumeAttachedFiles.length > 0 ? resumeAttachedFiles : undefined,
    privacyMode: effectivePrivacyMode,
    systemPromptAppend: prepared.systemPromptAppend,
    requiresBrowser: detectTaskNeedsBrowser({
      prompt: validatedPrompt,
      systemPromptAppend: prepared.systemPromptAppend,
    }),
    speedMode: getRuntimeSpeedMode(),
  };

  if (gatewaySessionKey) {
    upsertGatewaySession({
      key: gatewaySessionKey,
      agentId: agentContext.agentId,
      sessionId: validatedSessionId,
      taskId,
      channel: gatewayRoute?.channel,
      accountId: gatewayRoute?.accountId,
      peerKind: gatewayRoute?.peerKind,
      peerId: gatewayRoute?.peerId,
      lastPrompt: validatedPrompt,
    });
  }

  if (prepared.shouldResetSession) {
    delete validatedConfig.sessionId;
  }

  const turnId = createTurnId();
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
    usage: {
      inputTokens: prepared.estimate.promptTokensEst,
      outputTokens: 0,
      totalTokens: prepared.estimate.promptTokensEst,
      estimated: true,
    },
  });

  if (shouldFlush && existingTaskId) {
    updateTaskMemoryFlush(existingTaskId, {
      memoryFlushAt: new Date().toISOString(),
      memoryFlushCount: (existingTask?.memoryFlushCount ?? 0) + 1,
    });
  }

  let resolveCompletion: (result: TaskResult) => void = () => {};
  let rejectCompletion: (error: Error) => void = () => {};
  const completion = new Promise<TaskResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  completion.catch(() => {});
  initAgenticRunSignal(taskId);

  const callbacks: TaskCallbacks = {
    onMessage: (message: OpenCodeMessage) => {
      reconcileUsageFromOpenCodeMessage(taskId, message);
      recordAgenticRunSignal(taskId, message);
      const taskMessage = toTaskMessage(message);
      if (!taskMessage) return;
      addTaskMessage(taskId, taskMessage);
      forwardToAllRenderers('task:update', {
        taskId,
        type: 'message',
        message: taskMessage,
      });
    },
    onProgress: (progress: { stage: string; message?: string }) => {
      forwardToAllRenderers('task:progress', { taskId, ...progress });
    },
    onPermissionRequest: (request: unknown) => {
      try {
        enqueueWebPermissionRequest(request);
      } catch (err) {
        console.warn('[TaskDispatch] Failed to enqueue web permission request:', err);
      }
      const permissionRequest = toPermissionRequest(request);
      if (permissionRequest && options?.source === 'gateway') {
        void sendGatewayPermissionPrompt({
          route: gatewayRoute,
          request: permissionRequest,
        });
      }
      forwardToAllRenderers('permission:request', request);
    },
    onComplete: (result: TaskResult) => {
      // Finalize turn usage if OpenCode didn't emit a terminal step_finish reason.
      let finalInputTokens: number | undefined;
      let finalOutputTokens: number | undefined;
      const active = activeTurnByTaskId.get(taskId);
      if (active) {
        if (active.acc.inputTokens > 0 || active.acc.outputTokens > 0 || typeof active.acc.cachedInputTokens === 'number') {
          updateTurnUsage(active.turnId, {
            inputTokens: active.acc.inputTokens,
            outputTokens: active.acc.outputTokens,
            totalTokens: active.acc.inputTokens + active.acc.outputTokens,
            cachedInputTokens: active.acc.cachedInputTokens,
            estimated: false,
          });
          finalInputTokens = active.acc.inputTokens;
          finalOutputTokens = active.acc.outputTokens;
        } else {
          updateTurnUsage(active.turnId, {
            inputTokens: active.promptTokensEst,
            outputTokens: active.outputTokensEst,
            totalTokens: active.promptTokensEst + active.outputTokensEst,
            estimated: true,
          });
          finalInputTokens = active.promptTokensEst;
          finalOutputTokens = active.outputTokensEst;
        }
        activeTurnByTaskId.delete(taskId);
      }

      const wasSuccess = result.status === 'success';
      finalizeTaskSkillRun(taskId, {
        success: wasSuccess,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        error: wasSuccess ? undefined : (result.status === 'interrupted' ? 'Task interrupted' : 'Task failed'),
      });

      forwardToAllRenderers('task:update', {
        taskId,
        type: 'complete',
        result,
      });
      clearTaskFilePermissionPolicy(taskId);

      let taskStatus: TaskStatus = 'failed';
      if (result.status === 'success') {
        taskStatus = 'completed';
      } else if (result.status === 'interrupted') {
        taskStatus = 'interrupted';
      }
      updateTaskStatus(taskId, taskStatus, new Date().toISOString());

      const newSessionId = result.sessionId || taskManager.getSessionId(taskId);
      if (newSessionId) {
        updateTaskSessionId(taskId, newSessionId);
      }
      if (gatewaySessionKey) {
        upsertGatewaySession({
          key: gatewaySessionKey,
          agentId: agentContext.agentId,
          sessionId: newSessionId ?? validatedSessionId,
          taskId,
          channel: gatewayRoute?.channel,
          accountId: gatewayRoute?.accountId,
          peerKind: gatewayRoute?.peerKind,
          peerId: gatewayRoute?.peerId,
          lastPrompt: validatedPrompt,
        });
      }

      resolveCompletion(result);
    },
    onError: (error: Error) => {
      let finalInputTokens: number | undefined;
      let finalOutputTokens: number | undefined;
      const active = activeTurnByTaskId.get(taskId);
      if (active) {
        finalInputTokens = active.acc.inputTokens > 0 ? active.acc.inputTokens : active.promptTokensEst;
        finalOutputTokens = active.acc.outputTokens > 0 ? active.acc.outputTokens : active.outputTokensEst;
        activeTurnByTaskId.delete(taskId);
      }
      finalizeTaskSkillRun(taskId, {
        success: false,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        error: error.message,
      });

      forwardToAllRenderers('task:update', {
        taskId,
        type: 'error',
        error: error.message,
      });
      clearTaskFilePermissionPolicy(taskId);
      updateTaskStatus(taskId, 'failed', new Date().toISOString());
      if (gatewaySessionKey) {
        upsertGatewaySession({
          key: gatewaySessionKey,
          agentId: agentContext.agentId,
          sessionId: validatedConfig.sessionId ?? validatedSessionId,
          taskId,
          channel: gatewayRoute?.channel,
          accountId: gatewayRoute?.accountId,
          peerKind: gatewayRoute?.peerKind,
          peerId: gatewayRoute?.peerId,
          lastPrompt: validatedPrompt,
        });
      }
      rejectCompletion(error);
    },
    onDebug: (log: { type: string; message: string; data?: unknown }) => {
      if (getDebugMode()) {
        forwardToAllRenderers('debug:log', {
          taskId,
          timestamp: new Date().toISOString(),
          ...log,
        });
      }
    },
    onStatusChange: (status: TaskStatus) => {
      forwardToAllRenderers('task:status-change', {
        taskId,
        status,
      });
      updateTaskStatus(taskId, status, new Date().toISOString());
    },
  };

  // Add the user's follow-up AFTER preparing the payload to avoid duplicating the current prompt
  // inside "Recent conversation".
  if (!hiddenPrompt) {
    appendSessionLogMessage({ sessionFilePath, role: 'user', content: validatedPrompt });
  }

  let task: Task;
  try {
    task = await taskManager.startTask(taskId, validatedConfig, callbacks);
  } catch (error) {
    activeTurnByTaskId.delete(taskId);
    activeSkillRunByTaskId.delete(taskId);
    throw error;
  }
  task.agentId = validatedConfig.agentId;

  if (!existingTaskId) {
    const initialUserMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: validatedConfig.prompt,
      timestamp: new Date().toISOString(),
    };
    task.messages = [initialUserMessage];
    saveTask(task);
    forwardToAllRenderers('task:created', task);

    generateTaskSummary(validatedConfig.prompt, validatedConfig.agentId)
      .then((summary) => {
        updateTaskSummary(taskId, summary);
        forwardToAllRenderers('task:summary', { taskId, summary });
      })
      .catch((err) => {
        console.warn('[TaskDispatch] Failed to generate task summary:', err);
      });
  } else {
    updateTaskStatus(taskId, task.status, new Date().toISOString());
  }

  const completionWithLoop = maybeRunAgenticLoop({
    taskId,
    agentId: agentContext.agentId,
    sessionIdHint: validatedSessionId,
    completion,
    agent: agentContext.agent,
    options,
  });
  completionWithLoop.catch(() => {});

  return { taskId, task, completion: completionWithLoop };
}
