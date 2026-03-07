import { ipcMain, BrowserWindow, shell, app, dialog } from 'electron';
import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { IpcMainInvokeEvent } from 'electron';
import { URL } from 'url';
import {
  isOpenCodeCliInstalled,
  getOpenCodeCliVersion,
} from '../opencode/adapter';
import {
  getTaskManager,
  disposeTaskManager,
  type TaskCallbacks,
} from '../opencode/task-manager';
import {
  getTasks,
  getTask,
  saveTask,
  updateTaskStatus,
  updateTaskSessionId,
  updateTaskSummary,
  getLatestTask,
  updateTaskSessionMemorySaved,
  updateTaskSessionFilePath,
  addTaskMessage,
  deleteTask,
  clearHistory,
} from '../store/taskHistory';
import {
  listSavedPrompts,
  upsertSavedPrompt,
  deleteSavedPrompt,
} from '../store/savedPrompts';
import {
  getFoldersForAgent,
  createFolder,
  updateFolder,
  deleteFolder as deleteFolderFromStore,
  getTaskFolderAssignments,
  setTaskFolder,
} from '../store/folderStore';
import type { FolderConfig, FolderUpdateConfig } from '@accomplish/shared';
import { generateTaskSummary } from '../services/summarizer';
import { getMemoryState, readMemoryFile, saveMemoryFile, saveSessionMemorySnapshot, initSessionLog } from '../services/memory';
import { planNextJobs } from '../services/proactive-planner';
import { generateUserSkillFromTask } from '../services/skill-workflow-generator';
import { buildDevProcessManager } from '../services/build-mode/dev-process-manager';
import {
  captureWorkspaceBaseline,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  exportWorkspaceZipToFile,
  listWorkspaceTree,
  pasteWorkspaceEntry,
  readWorkspaceFile,
  readWorkspaceFingerprint,
  readWorkspaceGitDiff,
  renameWorkspaceEntry,
  resolveWorkspaceBaseline,
  resolveAgentWorkspaceRoot,
  resolvePathInWorkspace,
  writeWorkspaceFile,
} from '../services/build-mode/file-service';
import { buildTerminalManager } from '../services/build-mode/terminal-manager';
import {
  deleteBuildModePreset,
  listBuildModePresets,
  setActiveBuildModePreset,
  upsertBuildModePreset,
} from '../store/buildModePresets';
import {
  archiveBuildTaskSession,
  createBuildTaskSession,
  deleteBuildTaskSession,
  getBuildTaskSession,
  listBuildTaskSessions,
  renameBuildTaskSession,
  setPinnedBuildTaskSession,
  updateBuildTaskSession,
} from '../store/buildTaskHistory';
import { preparePayloadForSend } from '../services/context/prepare-payload';
import { normalizeOpenCodeUsage } from '../services/context/usage-normalize';
import { appendSessionLogMessage } from '../services/context/session-log';
import { addTurnLog, updateTurnUsage } from '../store/tokenUsage';
import { getUsagePricingSettings, setUsagePricingSettings } from '../store/usagePricing';
import { getUsageSummary } from '../services/usage-summary';
import { listModelsUsed } from '../services/usage-models';
import { suggestPricingFromInternet } from '../services/usage-pricing-autofill';
import {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  hasAnyApiKey,
  listStoredCredentials,
  storeDiscordToken,
  deleteDiscordToken,
  storeTelegramToken,
  deleteTelegramToken,
  storeVoiceWakeAccessKey,
  deleteVoiceWakeAccessKey,
  getVoiceWakeAccessKey,
  storeGatewayToken,
  deleteGatewayToken,
  storeGatewayPassword,
  deleteGatewayPassword,
  storeGatewayConnectorSecret,
  deleteGatewayConnectorSecret,
  hasGatewayConnectorSecret,
  storeAppConnectorSecret,
  storeAppConnectorOAuthClientSecret,
  deleteAppConnectorSecret,
  deleteAppConnectorOAuthClientSecret,
  hasAppConnectorSecret,
  hasAppConnectorOAuthClientSecret,
} from '../store/secureStorage';
import {
  getDebugMode,
  setDebugMode,
  getAppSettings,
  getOnboardingComplete,
  setOnboardingComplete,
  getMobileNodesEnabled,
  getMobileNodesMaxLivePreviews,
  getMobileNodesDisplayName,
  getWebhookBindMode,
  setMobileNodesEnabled,
  setMobileNodesMaxLivePreviews,
  setMobileNodesDisplayName,
  setWebhookBindMode,
  setAgentSpeedMode,
  setRunInBackground,
  setLaunchAtLogin,
  getBrowserProfile,
  setBrowserProfile,
  getWorkspaceRoot,
  setWorkspaceRoot,
  setActiveAgentId,
  getSelectedModel,
  getUserSkillAssistantModel,
  setSelectedModel,
  setUserSkillAssistantModel,
  getOllamaConfig,
  setOllamaConfig,
  setBuildDiffEnforcementMode,
} from '../store/appSettings';
import { getModelLimitOverrides, setModelContextLimitOverride } from '../store/modelLimits';
import { setRunInBackground as setBackgroundRunInBackground } from '../background';
import { listSkillsStatus, installSkill, uninstallSkill, installAllSkills } from '../utils/skills';
import {
  createUserSkill,
  deleteUserSkill,
  buildUserSkillDependencyStatusReport,
  cleanupUserSkillZipSession,
  inspectUserSkillZip,
  installUserSkillDependency,
  installUserSkillFromZip,
  listUserSkills,
  recordUserSkillRunBatch,
  recordUserSkillPerformance,
  readUserSkillFile,
  rollbackUserSkill,
  runUserSkillTests,
  setUserSkillSharing,
  setUserSkillLifecycle,
  writeUserSkillFile,
} from '../services/user-skills';
import { askUserSkillAssistant } from '../services/user-skill-assistant';
import { getUserSkillConfig, setUserSkillConfig } from '../store/userSkillsConfig';
import { buildAttachmentsPrefix } from '../utils/file-attachments';
import { getDesktopConfig } from '../config';
import {
  startPermissionApiServer,
  initPermissionApi,
  resolvePermission,
  isFilePermissionRequest,
  applyAllowAllForFileRequest,
  clearTaskFilePermissionPolicy,
} from '../permission-api';
import { startNodeToolsApiServer } from '../node-tools-api';
import type {
  Task,
  TaskConfig,
  PermissionResponse,
  OpenCodeMessage,
  TaskMessage,
  TaskResult,
  TaskStatus,
  ContextWindowEstimateResponse,
  UsagePeriod,
  UsagePricingSettings,
  UsagePricingAutofillRequest,
  SelectedModel,
  ProviderConfig,
  ModelConfig,
  OllamaConfig,
  ScheduleConfig,
  DiscordConnectorConfig,
  TelegramConnectorConfig,
  VoiceWakeConfig,
  GatewayConfig,
  GatewayConnectorExtensionConfigInput,
  GatewayConnectorExtensionId,
  GatewayConnectorExtensionState,
  AppConnectorExtensionConfigInput,
  AppConnectorExtensionId,
  AppConnectorExtensionState,
  BuildBuildRequest,
  BuildTaskHistoryListInput,
  BuildTaskSessionArchiveInput,
  BuildTaskSessionCreateInput,
  BuildTaskSessionDeleteInput,
  BuildTaskSessionPinInput,
  BuildTaskSessionRenameInput,
  BuildTaskSessionUpdateInput,
  BuildProjectPresetInput,
  BuildStartRequest,
  BuildWorkspaceBaselineDecision,
} from '@accomplish/shared';
import {
  DEFAULT_PROVIDERS,
  GATEWAY_CONNECTOR_EXTENSION_BINDING_PREFIX,
} from '@accomplish/shared';
import {
  normalizeIpcError,
  permissionResponseSchema,
  resumeSessionSchema,
  taskConfigSchema,
  validate,
} from './validation';
import {
  isMockTaskEventsEnabled,
  createMockTask,
  executeMockTaskFlow,
  detectScenarioFromPrompt,
} from '../test-utils/mock-task-flow';
import { listSchedules } from '../store/schedules';
import { upsertSchedule, removeSchedule, toggleSchedule, runScheduleNow } from '../services/scheduler';
import {
  WEBHOOK_PORT,
  getGatewayRunStatus,
  getGatewayRuntimeStatus,
  getWebhookLanUrls,
  getWebhookLocalUrl,
  listGatewayRunStatuses,
  refreshGatewayRuntimeConfig,
} from '../services/webhook-server';
import { listAgents, upsertAgent, deleteAgent, setDefaultAgentId, getDefaultAgentId, getAgent } from '../store/agents';
import { composeAgentSystemPromptAppend, getAgentContext, resolveActiveAgentId } from '../services/agent-context';
import { addDiscordDmAllowlistEntry, getDiscordConfig, setDiscordConfig } from '../store/discordConfig';
import { getDiscordStatus, getDiscordTokenSet } from '../services/discord-connector';
import { approveDiscordPairing, listDiscordPairingRequests } from '../store/discordPairing';
import { addTelegramDmAllowlistEntry, getTelegramConfig, setTelegramConfig } from '../store/telegramConfig';
import { getTelegramStatus, getTelegramTokenSet } from '../services/telegram-connector';
import { approveTelegramPairing, listTelegramPairingRequests } from '../store/telegramPairing';
import { getGatewayConfig, setGatewayConfig } from '../store/gatewayConfig';
import {
  getGatewayConnectorExtensionConfig,
  getGatewayConnectorRuntimeKey,
  isGatewayConnectorExtensionId,
  createGatewayConnectorExtensionInstance,
  deleteGatewayConnectorExtensionInstance,
  listGatewayConnectorExtensionConfigs,
  listGatewayConnectorExtensionDefinitions,
  setGatewayConnectorExtensionConfig,
} from '../store/gatewayConnectorExtensions';
import {
  createAppConnectorExtensionInstance,
  deleteAppConnectorExtensionInstance,
  getAppConnectorRuntimeKey,
  isAppConnectorExtensionId,
  listAppConnectorExtensionConfigs,
  listAppConnectorExtensionDefinitions,
  setAppConnectorExtensionConfig,
} from '../store/appConnectorExtensions';
import {
  clearGatewayConnectorDiscovery,
  listGatewayConnectorDiscovery,
} from '../store/gatewayConnectorDiscovery';
import {
  listGatewayBindings,
  removeGatewayBinding,
  setGatewayBindings,
  upsertGatewayBinding,
  type GatewayRouteBinding,
} from '../store/gatewayBindings';
import {
  deleteGatewaySession,
  getGatewaySession,
  listGatewaySessions,
} from '../store/gatewaySessions';
import { getVoiceWakeConfig, setVoiceWakeConfig } from '../store/voiceWake';
import {
  discoverGatewayConnectorRuntimeTargets,
  listGatewayConnectorRuntimeStatuses,
  restartGatewayConnectorRuntime,
  testGatewayConnectorRuntime,
} from '../services/gateway-connector-runtimes';
import {
  executeAppConnectorAction,
  listAppConnectorRuntimeStatuses,
  testAppConnectorRuntime,
} from '../services/app-connector-runtimes';
import {
  disconnectAppConnectorOAuth,
  getAppConnectorOAuthFlowStatus,
  handleAppConnectorOAuthCallback,
  startAppConnectorOAuthFlow,
} from '../services/app-connector-oauth';
import {
  listCustomModelProviders,
  upsertCustomModelProvider,
  deleteCustomModelProvider,
} from '../store/modelProviders';
import { listModelProviders } from '../services/model-providers';
import {
  approveNodePairing,
  listNodePairing,
  rejectNodePairing,
  removePairedNode,
  updatePairedNodeDisplayName,
  updatePairedNodeBadge,
  updatePairedNodeAiAccess,
} from '../store/nodePairing';
import { invokeNodeCommand } from '../services/node-commands';
import { getLatestNodeStreamChunk } from '../services/node-streams';
import { getNodeCameraActive } from '../services/node-runtime';
import { restartVoiceWakeService } from '../services/voice-wake';
import { transcribeWithWhisper } from '../services/whisper';
import {
  getHelpAssetDataUrl,
  listHelpDocs,
  openHelpAssetExternally,
  openHelpDocInEditor,
  openHelpDocsFolder,
  readHelpDoc,
  searchHelpDocs,
} from '../services/help-docs';

const MAX_TEXT_LENGTH = 8000;
const ALLOWED_API_KEY_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'custom']);
const ALLOWED_SELECTED_MODEL_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'ollama', 'custom']);
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_KEY_VALIDATION_TIMEOUT_MS = 15000;
const WARM_SESSION_WINDOW_MS = Number(process.env.OPENDESKMATE_WARM_SESSION_WINDOW_MS || 5 * 60 * 1000);
const INCOGNITO_SESSION_LOG_TTL_MS = Number(process.env.OPENDESKMATE_INCOGNITO_SESSION_LOG_TTL_MS || 30 * 60 * 1000);
const ephemeralSessionFiles = new Set<string>();

function scheduleEphemeralFileCleanup(filePath: string, ttlMs = INCOGNITO_SESSION_LOG_TTL_MS): void {
  ephemeralSessionFiles.add(filePath);
  const timer = setTimeout(() => {
    ephemeralSessionFiles.delete(filePath);
    cleanupTempFile(filePath);
  }, Math.max(5_000, ttlMs));
  timer.unref?.();
}

function initEphemeralSessionLog(taskId: string): string {
  const dir = path.join(os.tmpdir(), 'opendeskmate-incognito-sessions');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `session-${taskId}-${Date.now()}.jsonl`);
  scheduleEphemeralFileCleanup(filePath);
  return filePath;
}

app.once('before-quit', () => {
  for (const filePath of ephemeralSessionFiles) {
    cleanupTempFile(filePath);
  }
  ephemeralSessionFiles.clear();
});

/**
 * Write extracted file content to a temp .txt file so the CLI can read it
 * via --file flag. This handles binary files (DOCX, PDF) that the CLI
 * cannot read directly, and avoids Windows command-line length limits.
 */
function writeAttachmentsTempFile(content: string): string {
  const tempDir = app.getPath('temp');
  const tempFile = path.join(tempDir, `opencode-attachments-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, content, 'utf-8');
  return tempFile;
}

function saveDataUrlToTempFile(dataUrl: string, baseName: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  const mime = match[1];
  const data = match[2];
  const buffer = Buffer.from(data, 'base64');
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const safeBase = sanitizeString(baseName, 'fileBase', 64) || 'snapshot';
  const dir = path.join(os.tmpdir(), 'opendeskmate-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${safeBase}-${Date.now()}.${extension}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Silently delete a temp file (ignores errors if already gone). */
function cleanupTempFile(filePath: string | null): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore — file may already be gone
  }
}

interface OllamaModel {
  id: string;
  displayName: string;
  size: number;
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Message batching configuration
const MESSAGE_BATCH_DELAY_MS = 50;
const IGNORED_TASK_TTL_MS = 30_000;

// Per-task message batching state
interface MessageBatcher {
  pendingMessages: TaskMessage[];
  timeout: NodeJS.Timeout | null;
  taskId: string;
  flush: () => void;
}

const messageBatchers = new Map<string, MessageBatcher>();
const ignoredTaskIds = new Set<string>();

function markTaskIgnored(taskId: string): void {
  ignoredTaskIds.add(taskId);
  activeTurnByTaskId.delete(taskId);
  activeSkillRunByTaskId.delete(taskId);
  setTimeout(() => {
    ignoredTaskIds.delete(taskId);
  }, IGNORED_TASK_TTL_MS);
}

function isTaskIgnored(taskId: string): boolean {
  return ignoredTaskIds.has(taskId);
}

function createMessageBatcher(
  taskId: string,
  forwardToRenderer: (channel: string, data: unknown) => void,
  addTaskMessage: (taskId: string, message: TaskMessage) => void
): MessageBatcher {
  const batcher: MessageBatcher = {
    pendingMessages: [],
    timeout: null,
    taskId,
    flush: () => {
      if (batcher.pendingMessages.length === 0) return;

      // Send all pending messages in one IPC call
      forwardToRenderer('task:update:batch', {
        taskId,
        messages: batcher.pendingMessages,
      });

      // Also persist each message to history
      for (const msg of batcher.pendingMessages) {
        addTaskMessage(taskId, msg);
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

function queueMessage(
  taskId: string,
  message: TaskMessage,
  forwardToRenderer: (channel: string, data: unknown) => void,
  addTaskMessage: (taskId: string, message: TaskMessage) => void
): void {
  let batcher = messageBatchers.get(taskId);
  if (!batcher) {
    batcher = createMessageBatcher(taskId, forwardToRenderer, addTaskMessage);
  }

  batcher.pendingMessages.push(message);

  // Set up or reset the batch timer
  if (batcher.timeout) {
    clearTimeout(batcher.timeout);
  }

  batcher.timeout = setTimeout(() => {
    batcher.flush();
  }, MESSAGE_BATCH_DELAY_MS);
}

function flushAndCleanupBatcher(taskId: string): void {
  const batcher = messageBatchers.get(taskId);
  if (batcher) {
    batcher.flush();
    messageBatchers.delete(taskId);
  }
}

function dropAndCleanupBatcher(taskId: string): void {
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

function assertTrustedWindow(window: BrowserWindow | null): BrowserWindow {
  if (!window || window.isDestroyed()) {
    throw new Error('Untrusted window');
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (BrowserWindow.getAllWindows().length > 1 && focused && focused.id !== window.id) {
    throw new Error('IPC request must originate from the focused window');
  }

  return window;
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

function sanitizeOptionalText(input: unknown, field: string, maxLength: number): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  if (input.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return input;
}

function normalizeEnvOverrides(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || '').trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if (rawValue === null || rawValue === undefined) continue;
    result[key] = typeof rawValue === 'string' ? rawValue : String(rawValue);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeIntegerRange(
  input: unknown,
  field: string,
  min: number,
  max: number,
  fallback: number
): number {
  if (input === undefined || input === null || input === '') return fallback;
  const parsed = typeof input === 'number'
    ? input
    : Number.parseInt(typeof input === 'string' ? input : '', 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a number`);
  }
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return rounded;
}

function sanitizeProviderId(input: unknown, field = 'provider'): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const provider = input.trim().toLowerCase();
  if (!PROVIDER_ID_RE.test(provider)) {
    throw new Error(`${field} is invalid`);
  }
  return provider;
}

function sanitizeGatewayConnectorExtensionId(
  input: unknown,
  field = 'connectorId'
): GatewayConnectorExtensionId {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const id = input.trim().toLowerCase();
  if (!isGatewayConnectorExtensionId(id)) {
    throw new Error(`${field} is invalid`);
  }
  return id;
}

function sanitizeGatewayConnectorInstanceId(
  input: unknown,
  field = 'instanceId'
): string {
  const raw = sanitizeOptionalText(input, field, 64).trim().toLowerCase();
  if (!raw) return 'default';
  if (!/^[a-z0-9._-]+$/.test(raw)) {
    throw new Error(`${field} is invalid`);
  }
  return raw;
}

function sanitizeGatewayConnectorExtensionConfigInput(
  input: unknown
): GatewayConnectorExtensionConfigInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid connector extension configuration');
  }
  const source = input as GatewayConnectorExtensionConfigInput;
  const id = sanitizeGatewayConnectorExtensionId(source.id, 'config.id');
  const instanceId = sanitizeGatewayConnectorInstanceId(source.instanceId, 'config.instanceId');
  const sanitized: GatewayConnectorExtensionConfigInput = { id, instanceId };

  if (source.name !== undefined) {
    sanitized.name = sanitizeOptionalText(source.name, 'config.name', 64);
  }

  if (source.enabled !== undefined) {
    if (typeof source.enabled !== 'boolean') throw new Error('config.enabled must be a boolean');
    sanitized.enabled = source.enabled;
  }
  if (source.autoBindRouting !== undefined) {
    if (typeof source.autoBindRouting !== 'boolean') {
      throw new Error('config.autoBindRouting must be a boolean');
    }
    sanitized.autoBindRouting = source.autoBindRouting;
  }
  if (source.recordObservedIds !== undefined) {
    if (typeof source.recordObservedIds !== 'boolean') {
      throw new Error('config.recordObservedIds must be a boolean');
    }
    sanitized.recordObservedIds = source.recordObservedIds;
  }
  if (source.accessPolicyMode !== undefined) {
    const mode = sanitizeOptionalText(source.accessPolicyMode, 'config.accessPolicyMode', 16).trim().toLowerCase();
    if (mode === 'open' || mode === 'allowlist' || mode === 'disabled') {
      sanitized.accessPolicyMode = mode;
    } else {
      throw new Error('config.accessPolicyMode must be open, allowlist, or disabled');
    }
  }
  if (source.allowedUserIds !== undefined) {
    sanitized.allowedUserIds = sanitizeAllowlist(source.allowedUserIds, 'config.allowedUserIds');
  }
  if (source.allowedGroupIds !== undefined) {
    sanitized.allowedGroupIds = sanitizeAllowlist(source.allowedGroupIds, 'config.allowedGroupIds');
  }
  if (source.allowedChannelIds !== undefined) {
    sanitized.allowedChannelIds = sanitizeAllowlist(source.allowedChannelIds, 'config.allowedChannelIds');
  }
  if (source.allowedAccountIds !== undefined) {
    sanitized.allowedAccountIds = sanitizeAllowlist(source.allowedAccountIds, 'config.allowedAccountIds');
  }
  if (source.agentId !== undefined) {
    sanitized.agentId = sanitizeOptionalText(source.agentId, 'config.agentId', 64);
  }
  if (source.accountId !== undefined) {
    sanitized.accountId = sanitizeOptionalText(source.accountId, 'config.accountId', 128);
  }
  if (source.bridgeUrl !== undefined) {
    sanitized.bridgeUrl = sanitizeOptionalText(source.bridgeUrl, 'config.bridgeUrl', 1024);
  }
  if (source.notes !== undefined) {
    sanitized.notes = sanitizeOptionalText(source.notes, 'config.notes', 2000);
  }
  if (source.metadata !== undefined) {
    if (!source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata)) {
      throw new Error('config.metadata must be an object');
    }
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(source.metadata)) {
      const sanitizedKey = sanitizeOptionalText(key, 'config.metadata.key', 64).trim();
      if (!sanitizedKey) continue;
      const sanitizedValue = sanitizeOptionalText(value, `config.metadata.${sanitizedKey}`, 512).trim();
      if (!sanitizedValue) continue;
      metadata[sanitizedKey] = sanitizedValue;
    }
    sanitized.metadata = metadata;
  }

  return sanitized;
}

function sanitizeAppConnectorExtensionId(
  input: unknown,
  field = 'connectorId'
): AppConnectorExtensionId {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const id = input.trim().toLowerCase();
  if (!isAppConnectorExtensionId(id)) {
    throw new Error(`${field} is invalid`);
  }
  return id;
}

function sanitizeAppConnectorInstanceId(
  input: unknown,
  field = 'instanceId'
): string {
  const raw = sanitizeOptionalText(input, field, 64).trim().toLowerCase();
  if (!raw) return 'default';
  if (!/^[a-z0-9._-]+$/.test(raw)) {
    throw new Error(`${field} is invalid`);
  }
  return raw;
}

function sanitizeAppConnectorExtensionConfigInput(
  input: unknown
): AppConnectorExtensionConfigInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid app connector extension configuration');
  }
  const source = input as AppConnectorExtensionConfigInput;
  const id = sanitizeAppConnectorExtensionId(source.id, 'config.id');
  const instanceId = sanitizeAppConnectorInstanceId(source.instanceId, 'config.instanceId');
  const sanitized: AppConnectorExtensionConfigInput = { id, instanceId };

  if (source.name !== undefined) {
    sanitized.name = sanitizeOptionalText(source.name, 'config.name', 64);
  }
  if (source.enabled !== undefined) {
    if (typeof source.enabled !== 'boolean') throw new Error('config.enabled must be a boolean');
    sanitized.enabled = source.enabled;
  }
  if (source.autoBindTools !== undefined) {
    if (typeof source.autoBindTools !== 'boolean') {
      throw new Error('config.autoBindTools must be a boolean');
    }
    sanitized.autoBindTools = source.autoBindTools;
  }
  if (source.agentId !== undefined) {
    sanitized.agentId = sanitizeOptionalText(source.agentId, 'config.agentId', 64);
  }
  if (source.accountId !== undefined) {
    sanitized.accountId = sanitizeOptionalText(source.accountId, 'config.accountId', 128);
  }
  if (source.baseUrl !== undefined) {
    sanitized.baseUrl = sanitizeOptionalText(source.baseUrl, 'config.baseUrl', 1024);
  }
  if (source.notes !== undefined) {
    sanitized.notes = sanitizeOptionalText(source.notes, 'config.notes', 2000);
  }
  if (source.metadata !== undefined) {
    if (!source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata)) {
      throw new Error('config.metadata must be an object');
    }
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(source.metadata)) {
      const sanitizedKey = sanitizeOptionalText(key, 'config.metadata.key', 64).trim();
      if (!sanitizedKey) continue;
      const sanitizedValue = sanitizeOptionalText(value, `config.metadata.${sanitizedKey}`, 512).trim();
      if (!sanitizedValue) continue;
      metadata[sanitizedKey] = sanitizedValue;
    }
    sanitized.metadata = metadata;
  }

  return sanitized;
}

function getGatewayConnectorBindingId(
  connectorId: GatewayConnectorExtensionId,
  instanceId?: string
): string {
  const normalizedInstance = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
  if (normalizedInstance === 'default') {
    return `${GATEWAY_CONNECTOR_EXTENSION_BINDING_PREFIX}:${connectorId}`;
  }
  return `${GATEWAY_CONNECTOR_EXTENSION_BINDING_PREFIX}:${connectorId}:${normalizedInstance}`;
}

function isNativeGatewayConnector(connectorId: GatewayConnectorExtensionId): boolean {
  return connectorId === 'discord' || connectorId === 'telegram';
}

function mergeGatewayConnectorConfigWithNativeConnector(
  config: ReturnType<typeof listGatewayConnectorExtensionConfigs>[number]
): ReturnType<typeof listGatewayConnectorExtensionConfigs>[number] {
  if (config.instanceId && config.instanceId !== 'default') {
    return config;
  }
  if (config.id === 'discord') {
    const native = getDiscordConfig();
    return {
      ...config,
      enabled: Boolean(native.enabled),
      agentId: native.agentId,
      updatedAt: new Date().toISOString(),
    };
  }
  if (config.id === 'telegram') {
    const native = getTelegramConfig();
    return {
      ...config,
      enabled: Boolean(native.enabled),
      agentId: native.agentId,
      updatedAt: new Date().toISOString(),
    };
  }
  return config;
}

async function getGatewayConnectorSecretSet(
  connectorId: GatewayConnectorExtensionId,
  instanceId?: string
): Promise<boolean> {
  const runtimeKey = getGatewayConnectorRuntimeKey(connectorId, instanceId);
  if ((!instanceId || instanceId === 'default') && connectorId === 'discord') {
    return (await hasGatewayConnectorSecret(runtimeKey)) || (await getDiscordTokenSet());
  }
  if ((!instanceId || instanceId === 'default') && connectorId === 'telegram') {
    return (await hasGatewayConnectorSecret(runtimeKey)) || (await getTelegramTokenSet());
  }
  return hasGatewayConnectorSecret(runtimeKey);
}

function syncGatewayConnectorBinding(config: {
  id: GatewayConnectorExtensionId;
  instanceId?: string;
  enabled: boolean;
  autoBindRouting: boolean;
  agentId?: string;
  accountId?: string;
}): void {
  const bindingId = getGatewayConnectorBindingId(config.id, config.instanceId);
  if (!config.enabled || !config.autoBindRouting) {
    removeGatewayBinding(bindingId);
    return;
  }
  const normalizedInstance = sanitizeGatewayConnectorInstanceId(config.instanceId, 'instanceId');
  const accountMatch = (config.accountId ?? '').trim() || (normalizedInstance === 'default' ? '*' : normalizedInstance);

  upsertGatewayBinding({
    id: bindingId,
    agentId: (config.agentId ?? '').trim() || getDefaultAgentId(),
    match: {
      channel: config.id,
      accountId: accountMatch,
    },
  });
}

function sanitizeSelectedModel(input: unknown, field = 'selectedModel'): SelectedModel {
  if (!input || typeof input !== 'object') {
    throw new Error(`${field} must be an object`);
  }

  const source = input as Partial<SelectedModel>;
  const provider = sanitizeProviderId(source.provider, `${field}.provider`);
  if (!ALLOWED_SELECTED_MODEL_PROVIDERS.has(provider) && !PROVIDER_ID_RE.test(provider)) {
    throw new Error(`${field}.provider is invalid`);
  }

  const model = sanitizeString(source.model, `${field}.model`, 256);
  const baseUrl = source.baseUrl ? sanitizeString(source.baseUrl, `${field}.baseUrl`, 1024) : undefined;

  return {
    provider: provider as SelectedModel['provider'],
    model,
    baseUrl,
  };
}

function validateTaskConfig(config: TaskConfig): TaskConfig {
  const prompt = sanitizeString(config.prompt, 'prompt');
  const validated: TaskConfig = { prompt };

  if (config.taskId) {
    validated.taskId = sanitizeString(config.taskId, 'taskId', 128);
  }
  if (config.agentId) {
    validated.agentId = sanitizeString(config.agentId, 'agentId', 64);
  }
  if (config.sessionId) {
    validated.sessionId = sanitizeString(config.sessionId, 'sessionId', 128);
  }
  if (config.workingDirectory) {
    validated.workingDirectory = sanitizeString(config.workingDirectory, 'workingDirectory', 1024);
  }
  if (Array.isArray(config.allowedTools)) {
    validated.allowedTools = config.allowedTools
      .filter((tool): tool is string => typeof tool === 'string')
      .map((tool) => sanitizeString(tool, 'allowedTools', 64))
      .slice(0, 20);
  }
  if (config.systemPromptAppend) {
    validated.systemPromptAppend = sanitizeString(
      config.systemPromptAppend,
      'systemPromptAppend',
      MAX_TEXT_LENGTH
    );
  }
  if (config.outputSchema && typeof config.outputSchema === 'object') {
    validated.outputSchema = config.outputSchema;
  }
  if (Array.isArray(config.attachedFiles)) {
    validated.attachedFiles = config.attachedFiles
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map((f) => f.trim())
      .slice(0, 20); // limit to 20 files
  }
  if (config.speedMode) {
    const mode = String(config.speedMode).toLowerCase();
    if (mode === 'fast' || mode === 'balanced' || mode === 'deep') {
      validated.speedMode = mode;
    } else {
      throw new Error('speedMode must be one of: fast, balanced, deep');
    }
  }
  if (config.privacyMode) {
    const mode = String(config.privacyMode).toLowerCase();
    if (mode === 'normal' || mode === 'incognito') {
      validated.privacyMode = mode;
    } else {
      throw new Error('privacyMode must be one of: normal, incognito');
    }
  } else {
    validated.privacyMode = 'normal';
  }

  return validated;
}

function applyAgentContext(config: TaskConfig): TaskConfig {
  const context = getAgentContext(config.agentId);
  const workingDirectory = config.workingDirectory || context.workspaceRoot;
  return {
    ...config,
    agentId: context.agentId,
    workingDirectory,
    systemPromptAppend: composeAgentSystemPromptAppend({
      agent: context.agent,
      agentSystemPromptAppend: context.systemPromptAppend,
      requestSystemPromptAppend: config.systemPromptAppend,
    }),
  };
}

function validateScheduleConfig(config: ScheduleConfig): ScheduleConfig {
  const name = sanitizeString(config.name, 'name', 128);
  const prompt = sanitizeString(config.prompt, 'prompt');
  const cron = sanitizeString(config.cron, 'cron', 128);

  if (typeof config.enabled !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }

  const validated: ScheduleConfig = {
    name,
    prompt,
    cron,
    enabled: config.enabled,
    reuseSession: Boolean(config.reuseSession),
  };

  if (config.timezone) {
    validated.timezone = sanitizeString(config.timezone, 'timezone', 64);
  }
  if (config.agentId) {
    validated.agentId = sanitizeString(config.agentId, 'agentId', 64);
  }
  if (config.workingDirectory) {
    validated.workingDirectory = sanitizeString(config.workingDirectory, 'workingDirectory', 1024);
  }
  if (config.sessionId) {
    validated.sessionId = sanitizeString(config.sessionId, 'sessionId', 128);
  }
  if (config.systemPromptAppend) {
    validated.systemPromptAppend = sanitizeString(config.systemPromptAppend, 'systemPromptAppend', MAX_TEXT_LENGTH);
  }

  return validated;
}

function sanitizeAllowlist(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 200);
  const unique = Array.from(new Set(entries));
  if (unique.length > 200) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return unique;
}

function validateDiscordConfig(config: DiscordConnectorConfig): DiscordConnectorConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Discord config is required');
  }

  const enabled = Boolean(config.enabled);
  const dmPolicyRaw = typeof config.dmPolicy === 'string' ? config.dmPolicy : undefined;
  const dmPolicy = dmPolicyRaw === 'open' || dmPolicyRaw === 'pairing' || dmPolicyRaw === 'disabled'
    ? dmPolicyRaw
    : 'pairing';
  const allowDms = dmPolicy !== 'disabled' && Boolean(config.allowDms ?? true);
  const requireMention = config.requireMention !== false;
  const commandPrefix = config.commandPrefix
    ? sanitizeString(config.commandPrefix, 'commandPrefix', 32)
    : undefined;

  const validated: DiscordConnectorConfig = {
    enabled,
    allowDms,
    dmPolicy,
    requireMention,
    commandPrefix,
    dmAllowlist: sanitizeAllowlist(config.dmAllowlist, 'dmAllowlist'),
    channelAllowlist: sanitizeAllowlist(config.channelAllowlist, 'channelAllowlist'),
    guildAllowlist: sanitizeAllowlist(config.guildAllowlist, 'guildAllowlist'),
    agentId: config.agentId ? sanitizeString(config.agentId, 'agentId', 64) : undefined,
  };

  return validated;
}

function validateTelegramConfig(config: TelegramConnectorConfig): TelegramConnectorConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Telegram config is required');
  }

  const enabled = Boolean(config.enabled);
  const dmPolicyRaw = typeof config.dmPolicy === 'string' ? config.dmPolicy : undefined;
  const dmPolicy = dmPolicyRaw === 'open' || dmPolicyRaw === 'pairing' || dmPolicyRaw === 'disabled'
    ? dmPolicyRaw
    : 'pairing';
  const allowDms = dmPolicy !== 'disabled' && Boolean(config.allowDms ?? true);
  const requireMention = config.requireMention !== false;
  const commandPrefix = config.commandPrefix
    ? sanitizeString(config.commandPrefix, 'commandPrefix', 32)
    : undefined;

  const validated: TelegramConnectorConfig = {
    enabled,
    allowDms,
    dmPolicy,
    requireMention,
    commandPrefix,
    dmAllowlist: sanitizeAllowlist(config.dmAllowlist, 'dmAllowlist'),
    channelAllowlist: sanitizeAllowlist(config.channelAllowlist, 'channelAllowlist'),
    groupAllowlist: sanitizeAllowlist(config.groupAllowlist, 'groupAllowlist'),
    agentId: config.agentId ? sanitizeString(config.agentId, 'agentId', 64) : undefined,
  };

  return validated;
}

function validateVoiceWakeConfig(config: VoiceWakeConfig): VoiceWakeConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Voice wake config is required');
  }

  const enabled = Boolean(config.enabled);
  const autoStart = Boolean(config.autoStart);
  const rawTriggers = Array.isArray(config.triggers) ? config.triggers : [];
  const triggers = rawTriggers
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 32);
  const talkModeEnabled = config.talkModeEnabled !== false;
  const autoSubmit = Boolean(config.autoSubmit);
  const insertMode = config.insertMode === 'replace' ? 'replace' : 'append';
  const rawStopPhrases = Array.isArray(config.stopPhrases) ? config.stopPhrases : [];
  const stopPhrases = rawStopPhrases
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 32);
  let silenceTimeoutMs = typeof config.silenceTimeoutMs === 'number' ? config.silenceTimeoutMs : 1200;
  if (!Number.isFinite(silenceTimeoutMs)) {
    silenceTimeoutMs = 1200;
  }
  silenceTimeoutMs = Math.min(Math.max(silenceTimeoutMs, 400), 5000);
  const earconEnabled = config.earconEnabled !== false;
  const sttEngine = config.sttEngine === 'web-speech' ? 'web-speech' : 'whisper';
  const whisperBinPath = typeof config.whisperBinPath === 'string' ? config.whisperBinPath.trim() : '';
  const whisperModelPath = typeof config.whisperModelPath === 'string' ? config.whisperModelPath.trim() : '';
  const whisperLanguage =
    typeof config.whisperLanguage === 'string' && config.whisperLanguage.trim()
      ? config.whisperLanguage.trim()
      : 'en';

  return {
    enabled,
    autoStart,
    triggers,
    updatedAtMs: typeof config.updatedAtMs === 'number' ? config.updatedAtMs : 0,
    talkModeEnabled,
    autoSubmit,
    insertMode,
    stopPhrases,
    silenceTimeoutMs,
    earconEnabled,
    sttEngine,
    whisperBinPath,
    whisperModelPath,
    whisperLanguage,
  };
}

function validateGatewayConfig(config: GatewayConfig): GatewayConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Gateway config is required');
  }

  const tailscaleModeRaw = typeof config.tailscaleMode === 'string' ? config.tailscaleMode : 'off';
  const tailscaleMode =
    tailscaleModeRaw === 'serve' || tailscaleModeRaw === 'funnel' || tailscaleModeRaw === 'off'
      ? tailscaleModeRaw
      : 'off';

  let authModeRaw = typeof config.authMode === 'string' ? config.authMode : 'none';
  let authMode =
    authModeRaw === 'token' || authModeRaw === 'password' || authModeRaw === 'none'
      ? authModeRaw
      : 'none';

  let allowTailscale = config.allowTailscale !== false;
  const tailscaleResetOnExit = Boolean(config.tailscaleResetOnExit);

  if (tailscaleMode !== 'off' && authMode === 'none') {
    authMode = tailscaleMode === 'funnel' ? 'password' : 'token';
  }
  if (tailscaleMode === 'funnel') {
    authMode = 'password';
    allowTailscale = false;
  }
  if (authMode === 'password') {
    allowTailscale = false;
  }

  return {
    authMode,
    allowTailscale,
    tailscaleMode,
    tailscaleResetOnExit,
    recordConnectorDiscovery: config.recordConnectorDiscovery !== false,
  };
}

/**
 * Check if E2E auth bypass is enabled via global flag, command-line argument, or environment variable
 * Global flag is set by Playwright's app.evaluate() and is most reliable across platforms
 */
function isE2ESkipAuthEnabled(): boolean {
  return (
    (global as Record<string, unknown>).E2E_SKIP_AUTH === true ||
    process.argv.includes('--e2e-skip-auth') ||
    process.env.E2E_SKIP_AUTH === '1'
  );
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

function createTurnId(): string {
  // Separate from message IDs to avoid React key collisions.
  return `turn_${Date.now()}_${randomBytes(6).toString('hex')}`;
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

function handle<Args extends unknown[], ReturnType = unknown>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => ReturnType
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as Args));
    } catch (error) {
      console.error(`IPC handler ${channel} failed`, error);
      throw normalizeIpcError(error);
    }
  });
}

/**
 * Register all IPC handlers
 */
export function registerIPCHandlers(): void {
  const taskManager = getTaskManager();

  // Start the permission API server for file-permission MCP
  // Initialize when we have a window (deferred until first task:start)
let permissionApiInitialized = false;
let nodeToolsApiInitialized = false;

  // Task: Start a new task
  handle('task:start', async (event: IpcMainInvokeEvent, config: TaskConfig) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const sender = event.sender;
    const validatedConfig = applyAgentContext(validateTaskConfig(config));
    const privacyMode = validatedConfig.privacyMode ?? 'normal';
    const isIncognito = privacyMode === 'incognito';

    // Process attached files: extract text from binary formats (DOCX, PDF),
    // write the extracted content to a temp .txt file, and pass that via --file
    // to the CLI. This avoids:
    //  1. CLI rejecting binary files ("Cannot read binary file" error)
    //  2. Windows command-line length limits (~32K chars)
    const userVisiblePrompt = validatedConfig.prompt;
    let attachmentMeta: import('../utils/file-attachments').FileAttachmentMeta[] = [];
    let attachmentTempFile: string | null = null;
    let attachmentContentForEstimate = '';
    if (validatedConfig.attachedFiles && validatedConfig.attachedFiles.length > 0) {
      const { prompt: attachmentContent, meta } = await buildAttachmentsPrefix(validatedConfig.attachedFiles);
      attachmentMeta = meta;
      attachmentContentForEstimate = attachmentContent;
      // Write extracted content to a temp text file and pass via --file.
      // The CLI can always read .txt files, unlike binary DOCX/PDF originals.
      if (attachmentContent.trim().length > 0) {
        attachmentTempFile = writeAttachmentsTempFile(attachmentContent);
        validatedConfig.attachedFiles = [attachmentTempFile];
      } else {
        // No content extracted — don't pass any files
        validatedConfig.attachedFiles = undefined;
      }
    }

    // Initialize permission API server (once, when we have a window)
    if (!permissionApiInitialized) {
      initPermissionApi(window, {
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
    // Initialize node tools API server (once)
    if (!nodeToolsApiInitialized) {
      startNodeToolsApiServer();
      nodeToolsApiInitialized = true;
    }

    const taskId = validatedConfig.taskId || createTaskId();
    const sessionFilePath = isIncognito
      ? initEphemeralSessionLog(taskId)
      : initSessionLog(validatedConfig.agentId, taskId);
    const previousTask = getLatestTask(validatedConfig.agentId);
    if (!validatedConfig.sessionId && previousTask && previousTask.id !== taskId && previousTask.sessionId) {
      const terminalStatuses = new Set<TaskStatus>(['completed', 'interrupted', 'failed', 'cancelled']);
      if (terminalStatuses.has(previousTask.status)) {
        const completedAtMs = Date.parse(previousTask.completedAt || previousTask.createdAt || '');
        if (Number.isFinite(completedAtMs) && (Date.now() - completedAtMs) <= WARM_SESSION_WINDOW_MS) {
          validatedConfig.sessionId = previousTask.sessionId;
          console.log('[IPC] Reusing warm session for task start', {
            fromTaskId: previousTask.id,
            sessionId: previousTask.sessionId,
            ageMs: Date.now() - completedAtMs,
          });
        }
      }
    }
    if (
      !isIncognito &&
      previousTask &&
      previousTask.privacyMode !== 'incognito' &&
      previousTask.id !== taskId &&
      !previousTask.sessionMemorySavedAt &&
      previousTask.messages?.length
    ) {
      try {
        const memoryPath = await saveSessionMemorySnapshot(previousTask, validatedConfig.agentId, 'desktop');
        if (memoryPath) {
          updateTaskSessionMemorySaved(previousTask.id, new Date().toISOString());
        }
      } catch (error) {
        console.warn('[IPC] Failed to save session memory snapshot:', error);
      }
    }

    // E2E Mock Mode: Return mock task and emit simulated events
    if (isMockTaskEventsEnabled()) {
      const mockTask = createMockTask(taskId, validatedConfig.prompt, validatedConfig.agentId);
      const scenario = detectScenarioFromPrompt(validatedConfig.prompt);

      // Save task to history so Execution page can load it
      saveTask(mockTask);

      // Execute mock flow asynchronously (sends IPC events)
      void executeMockTaskFlow(window, {
        taskId,
        prompt: validatedConfig.prompt,
        scenario,
        delayMs: 50,
      });

      return mockTask;
    }

    // Prepare EXACT OpenCode payload: add memory + trimmed conversation snapshot into systemPromptAppend.
    // This is the source of truth for both send and UI token estimation.
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
    trackTaskSkillRun(taskId, {
      agentId: validatedConfig.agentId,
      skillIds: prepared.selectedSkillIds,
    });

    // Add the user's prompt to the session snapshot BEFORE OpenCode starts emitting assistant messages,
    // so future context windows keep correct chronological order.
    let sessionLogUserContent = userVisiblePrompt;
    if (attachmentMeta.length > 0) {
      const fileLines = attachmentMeta.map((m) => `  ${m.fileName} (${m.status})`);
      sessionLogUserContent = `${userVisiblePrompt}\n\n📎 Attached files:\n${fileLines.join('\n')}`;
    }
    appendSessionLogMessage({
      sessionFilePath,
      role: 'user',
      content: sessionLogUserContent,
    });

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

    // Setup event forwarding to renderer
    const forwardToRenderer = (channel: string, data: unknown) => {
      if (!window.isDestroyed() && !sender.isDestroyed()) {
        sender.send(channel, data);
      }
    };

    // Create task-scoped callbacks for the TaskManager
    const callbacks: TaskCallbacks = {
      onMessage: (message: OpenCodeMessage) => {
        if (isTaskIgnored(taskId)) return;
        reconcileUsageFromOpenCodeMessage(taskId, message);
        const taskMessage = toTaskMessage(message);
        if (!taskMessage) return;

        // Queue message for batching instead of immediate send
        queueMessage(taskId, taskMessage, forwardToRenderer, addTaskMessage);
      },

      onProgress: (progress: { stage: string; message?: string }) => {
        if (isTaskIgnored(taskId)) return;
        forwardToRenderer('task:progress', {
          taskId,
          ...progress,
        });
      },

      onPermissionRequest: (request: unknown) => {
        if (isTaskIgnored(taskId)) return;
        // Flush pending messages before showing permission request
        flushAndCleanupBatcher(taskId);
        forwardToRenderer('permission:request', request);
      },

      onComplete: (result: TaskResult) => {
        if (isTaskIgnored(taskId)) return;
        // Flush any pending messages before completing
        flushAndCleanupBatcher(taskId);
        cleanupTempFile(attachmentTempFile);
        clearTaskFilePermissionPolicy(taskId);

        // Finalize turn usage even if OpenCode didn't emit an end_turn/stop step_finish.
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

        forwardToRenderer('task:update', {
          taskId,
          type: 'complete',
          result,
        });

        // Map result status to task status
        let taskStatus: TaskStatus;
        if (result.status === 'success') {
          taskStatus = 'completed';
        } else if (result.status === 'interrupted') {
          taskStatus = 'interrupted';
        } else {
          taskStatus = 'failed';
        }

        // Update task status in history
        updateTaskStatus(taskId, taskStatus, new Date().toISOString());

        // Update session ID if available (important for interrupted tasks to allow continuation)
        const sessionId = result.sessionId || taskManager.getSessionId(taskId);
        if (sessionId) {
          updateTaskSessionId(taskId, sessionId);
        }
      },

      onError: (error: Error) => {
        if (isTaskIgnored(taskId)) return;
        // Flush any pending messages before error
        flushAndCleanupBatcher(taskId);
        cleanupTempFile(attachmentTempFile);
        clearTaskFilePermissionPolicy(taskId);

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

        forwardToRenderer('task:update', {
          taskId,
          type: 'error',
          error: error.message,
        });

        // Update task status in history
        updateTaskStatus(taskId, 'failed', new Date().toISOString());
      },

      onDebug: (log: { type: string; message: string; data?: unknown }) => {
        if (isTaskIgnored(taskId)) return;
        if (getDebugMode()) {
          forwardToRenderer('debug:log', {
            taskId,
            timestamp: new Date().toISOString(),
            ...log,
          });
        }
      },

      onStatusChange: (status: TaskStatus) => {
        if (isTaskIgnored(taskId)) return;
        // Notify renderer of status change (e.g., queued -> running)
        forwardToRenderer('task:status-change', {
          taskId,
          status,
        });
        // Update task status in history
        updateTaskStatus(taskId, status, new Date().toISOString());
      },
    };

    // Start the task via TaskManager (creates isolated adapter or queues if busy)
    let task: Task;
    try {
      task = await taskManager.startTask(taskId, validatedConfig, callbacks);
    } catch (error) {
      activeTurnByTaskId.delete(taskId);
      activeSkillRunByTaskId.delete(taskId);
      throw error;
    }
    task.agentId = validatedConfig.agentId;
    task.privacyMode = privacyMode;
    (task as Task & { sessionFilePath?: string }).sessionFilePath = sessionFilePath;

    // Add initial user message with the prompt to the chat
    // Show the user's original prompt (without inlined file contents) plus file status
    let displayContent = userVisiblePrompt;
    if (attachmentMeta.length > 0) {
      const fileLines = attachmentMeta.map((m) => `  ${m.fileName} (${m.status})`);
      displayContent = `${userVisiblePrompt}\n\n📎 Attached files:\n${fileLines.join('\n')}`;
    }
    const initialUserMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: displayContent,
      timestamp: new Date().toISOString(),
      // Store attachment meta for debugging/auditing (what the model actually received)
      ...(attachmentMeta.length > 0 && {
        attachments: [{
          type: 'json' as const,
          data: JSON.stringify(attachmentMeta),
          label: 'File attachment processing results',
        }],
      }),
    };
    task.messages = [initialUserMessage];

    // Store the user-visible prompt in task history — NOT the expanded one
    // which contains inlined file contents (avoids persisting file data to disk)
    task.prompt = userVisiblePrompt;

    // Save task to history (includes the initial user message)
    saveTask(task);
    updateTaskSessionFilePath(taskId, sessionFilePath);

    // Generate AI summary asynchronously (don't block task execution)
    if (!isIncognito) {
      generateTaskSummary(userVisiblePrompt, validatedConfig.agentId)
        .then((summary) => {
          updateTaskSummary(taskId, summary);
          forwardToRenderer('task:summary', { taskId, summary });
        })
        .catch((err) => {
          console.warn('[IPC] Failed to generate task summary:', err);
        });
    }

    return task;
  });

  handle('assistant:plan-next-jobs', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    const sanitizedAgentId = agentId ? sanitizeString(agentId, 'agentId', 128) : undefined;
    return await planNextJobs(sanitizedAgentId);
  });

  handle('user-skills:generate-from-task', async (_event: IpcMainInvokeEvent, req: { taskId: string; agentId?: string }) => {
    if (!req || typeof req.taskId !== 'string') {
      throw new Error('taskId is required');
    }
    const taskId = sanitizeString(req.taskId, 'taskId', 128);
    const agentId = req.agentId ? sanitizeString(req.agentId, 'agentId', 128) : undefined;
    return await generateUserSkillFromTask({ taskId, agentId });
  });

  // Context: Estimate prompt tokens for the EXACT payload we will send (same prep logic as send path).
  handle(
    'context:estimate',
    async (
      _event: IpcMainInvokeEvent,
      payload: {
        prompt: string;
        taskId?: string;
        agentId?: string;
        systemPromptAppend?: string;
        attachedFiles?: string[];
        maxOutputTokensOverride?: number;
        headroomSafetyTokens?: number;
      }
    ): Promise<ContextWindowEstimateResponse> => {
      const prompt = sanitizeOptionalText(payload.prompt, 'prompt', MAX_TEXT_LENGTH);
      const taskId = payload.taskId ? sanitizeString(payload.taskId, 'taskId', 128) : undefined;
      const agentId = payload.agentId ? sanitizeString(payload.agentId, 'agentId', 64) : undefined;
      const systemPromptAppend = payload.systemPromptAppend
        ? sanitizeOptionalText(payload.systemPromptAppend, 'systemPromptAppend', MAX_TEXT_LENGTH)
        : undefined;

      const config = applyAgentContext({ prompt, taskId, agentId, systemPromptAppend });
      const task = taskId ? getTask(taskId, config.agentId) : undefined;
      const sessionFilePath = task?.sessionFilePath;

      let retrievedText = '';
      if (Array.isArray(payload.attachedFiles) && payload.attachedFiles.length > 0) {
        const filePaths = payload.attachedFiles
          .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
          .slice(0, 20);
        if (filePaths.length > 0) {
          const { prompt: attachmentContent } = await buildAttachmentsPrefix(filePaths);
          retrievedText = attachmentContent;
        }
      }

      const prepared = await preparePayloadForSend({
        agentId: config.agentId,
        taskId,
        sessionFilePath,
        userMessage: prompt,
        retrievedText,
        baseSystemPromptAppend: config.systemPromptAppend,
        maxOutputTokensOverride: payload.maxOutputTokensOverride,
        headroomSafetyTokens: payload.headroomSafetyTokens,
        requireApiKey: false,
      });

      return {
        provider: prepared.provider,
        model: prepared.model,
        estimate: prepared.estimate,
        context: prepared.context,
        droppedMessages: prepared.droppedMessages,
        trimmed: prepared.trimmed,
        summaryInserted: prepared.summaryInserted,
        shouldResetSession: prepared.shouldResetSession,
      };
    }
  );

  // Task: Cancel current task (running or queued)
  handle('task:cancel', async (_event: IpcMainInvokeEvent, taskId?: string) => {
    if (!taskId) return;

    // Check if it's a queued task first
    if (taskManager.isTaskQueued(taskId)) {
      taskManager.cancelQueuedTask(taskId);
      updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
      return;
    }

    // Otherwise cancel the running task
    if (taskManager.hasActiveTask(taskId)) {
      await taskManager.cancelTask(taskId);
      updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
      return;
    }

    // Stale running task (e.g., app restarted/crashed). Mark it cancelled so UI unblocks.
    const existing = getTask(taskId);
    if (existing && existing.status === 'running') {
      updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
    }
  });

  // Task: Interrupt current task (graceful Ctrl+C with aggressive fallback)
  handle('task:interrupt', async (_event: IpcMainInvokeEvent, taskId?: string) => {
    if (!taskId) return;

    if (taskManager.isTaskQueued(taskId)) {
      taskManager.cancelQueuedTask(taskId);
      updateTaskStatus(taskId, 'interrupted', new Date().toISOString());
      return;
    }

    if (taskManager.hasActiveTask(taskId)) {
      await taskManager.interruptTask(taskId);
      console.log(`[IPC] Task ${taskId} interrupted`);
      // Optimistically unblock UI immediately. The task manager will still emit
      // final updates when the process exits.
      updateTaskStatus(taskId, 'interrupted', new Date().toISOString());

      // Some provider/model combinations can ignore Ctrl+C momentarily.
      // If task is still active, force-cancel quickly so stop feels immediate
      // and queued tasks are unblocked.
      setTimeout(() => {
        if (!taskManager.hasActiveTask(taskId)) return;
        console.warn(`[IPC] Task ${taskId} still active after interrupt; force-cancelling`);
        void taskManager.cancelTask(taskId)
          .then(() => {
            updateTaskStatus(taskId, 'interrupted', new Date().toISOString());
          })
          .catch((err) => {
            console.warn(`[IPC] Force cancel failed for ${taskId}:`, err);
          });
      }, 250);
      return;
    }

    // Stale running task (e.g., app restarted/crashed). Mark it interrupted so UI unblocks
    // and the user can continue the session if a sessionId exists.
    const existing = getTask(taskId);
    if (existing && existing.status === 'running') {
      updateTaskStatus(taskId, 'interrupted');
    }
  });

  // Task: Get task from history
  handle('task:get', async (_event: IpcMainInvokeEvent, taskId: string, agentId?: string) => {
    const resolvedAgentId = agentId || resolveActiveAgentId();
    return getTask(taskId, resolvedAgentId) || null;
  });

  // Task: List tasks from history
  handle('task:list', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    const resolvedAgentId = agentId || resolveActiveAgentId();
    return getTasks(resolvedAgentId);
  });

  // Task: Delete task from history
  handle('task:delete', async (_event: IpcMainInvokeEvent, taskId: string) => {
    markTaskIgnored(taskId);
    // Stop any queued or running task to prevent lingering events after deletion
    if (taskManager.isTaskQueued(taskId)) {
      taskManager.cancelQueuedTask(taskId);
    }
    // Drop any pending batched messages for this task
    dropAndCleanupBatcher(taskId);
    // Delete from history immediately so UI updates fast
    deleteTask(taskId);
    // Cancel active task in background (don't block IPC response)
    if (taskManager.hasActiveTask(taskId)) {
      taskManager.cancelTask(taskId).catch((err) => {
        console.warn(`[IPC] Background task cancellation failed for ${taskId}:`, err);
      });
    }
  });

  // Task: Clear all history
  handle('task:clear-history', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    clearHistory(agentId || resolveActiveAgentId());
  });

  // Permission: Respond to permission request
  handle('permission:respond', async (_event: IpcMainInvokeEvent, response: PermissionResponse) => {
    const parsedResponse = validate(permissionResponseSchema, response);
    const { taskId, decision, requestId } = parsedResponse;

    // Check if this is a file permission request from the MCP server
    if (requestId && isFilePermissionRequest(requestId)) {
      if (decision === 'allow_all') {
        applyAllowAllForFileRequest(requestId);
      }
      const allowed = decision === 'allow' || decision === 'allow_all';
      const resolved = resolvePermission(requestId, allowed);
      if (resolved) {
        console.log(`[IPC] File permission request ${requestId} resolved: ${allowed ? 'allowed' : 'denied'}`);
        return;
      }
      // If not found in pending, fall through to standard handling
      console.warn(`[IPC] File permission request ${requestId} not found in pending requests`);
    }

    // Check if the task is still active
    if (!taskManager.hasActiveTask(taskId)) {
      console.warn(`[IPC] Permission response for inactive task ${taskId}`);
      return;
    }

    if (decision === 'allow') {
      // Send the response to the correct task's CLI
      const message = parsedResponse.selectedOptions?.join(', ') || parsedResponse.message || 'yes';
      const sanitizedMessage = sanitizeString(message, 'permissionResponse', 1024);
      await taskManager.sendResponse(taskId, sanitizedMessage);
    } else {
      // Send denial to the correct task
      await taskManager.sendResponse(taskId, 'no');
    }
  });

  // Session: Resume (continue conversation)
  handle(
    'session:resume',
    async (
      event: IpcMainInvokeEvent,
      sessionId: string,
      prompt: string,
      existingTaskId?: string,
      attachedFiles?: string[],
      privacyMode?: 'normal' | 'incognito'
    ) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const sender = event.sender;
    const validatedSessionId = sanitizeString(sessionId, 'sessionId', 128);
    const validatedPrompt = sanitizeString(prompt, 'prompt');
    const validatedExistingTaskId = existingTaskId
      ? sanitizeString(existingTaskId, 'taskId', 128)
      : undefined;

    // Process attached files: extract text and write to temp file for --file flag.
    const validatedFiles = Array.isArray(attachedFiles)
      ? attachedFiles.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).slice(0, 20)
      : undefined;
    const augmentedPrompt = validatedPrompt;
    let resumeAttachmentMeta: import('../utils/file-attachments').FileAttachmentMeta[] = [];
    let resumeAttachmentTempFile: string | null = null;
    let resumeAttachmentContentForEstimate = '';
    let resumeAttachedFiles: string[] | undefined = validatedFiles;
    if (validatedFiles && validatedFiles.length > 0) {
      const { prompt: attachmentContent, meta } = await buildAttachmentsPrefix(validatedFiles);
      resumeAttachmentMeta = meta;
      resumeAttachmentContentForEstimate = attachmentContent;
      // Write extracted content to a temp text file so the CLI can read it.
      if (attachmentContent.trim().length > 0) {
        resumeAttachmentTempFile = writeAttachmentsTempFile(attachmentContent);
        resumeAttachedFiles = [resumeAttachmentTempFile];
      } else {
        resumeAttachedFiles = undefined;
      }
    }

    // Use existing task ID or create a new one
    const taskId = validatedExistingTaskId || createTaskId();
    const existingTask = validatedExistingTaskId ? getTask(validatedExistingTaskId) : undefined;
    const effectivePrivacyMode: 'normal' | 'incognito' =
      privacyMode || existingTask?.privacyMode || 'normal';
    const isIncognito = effectivePrivacyMode === 'incognito';
    const sessionFilePath =
      existingTask?.sessionFilePath || (isIncognito
        ? initEphemeralSessionLog(taskId)
        : initSessionLog(existingTask?.agentId, taskId));
    if (!existingTask?.sessionFilePath) {
      updateTaskSessionFilePath(taskId, sessionFilePath);
    }

    // Persist the user's follow-up message to task history (show original prompt + file status)
    let resumeSessionLogContent = validatedPrompt;
    if (validatedExistingTaskId) {
      let displayContent = validatedPrompt;
      if (resumeAttachmentMeta.length > 0) {
        const fileLines = resumeAttachmentMeta.map((m) => `  ${m.fileName} (${m.status})`);
        displayContent = `${validatedPrompt}\n\n📎 Attached files:\n${fileLines.join('\n')}`;
      }
      resumeSessionLogContent = displayContent;
      const userMessage: TaskMessage = {
        id: createMessageId(),
        type: 'user',
        content: displayContent,
        timestamp: new Date().toISOString(),
        // Store attachment meta for debugging/auditing
        ...(resumeAttachmentMeta.length > 0 && {
          attachments: [{
            type: 'json' as const,
            data: JSON.stringify(resumeAttachmentMeta),
            label: 'File attachment processing results',
          }],
        }),
      };
      addTaskMessage(validatedExistingTaskId, userMessage, { skipSessionLog: true });
    }

    // Setup event forwarding to renderer
    const forwardToRenderer = (channel: string, data: unknown) => {
      if (!window.isDestroyed() && !sender.isDestroyed()) {
        sender.send(channel, data);
      }
    };

    // Create task-scoped callbacks for the TaskManager (with batching for performance)
    const callbacks: TaskCallbacks = {
      onMessage: (message: OpenCodeMessage) => {
        if (isTaskIgnored(taskId)) return;
        reconcileUsageFromOpenCodeMessage(taskId, message);
        const taskMessage = toTaskMessage(message);
        if (!taskMessage) return;

        // Queue message for batching instead of immediate send
        queueMessage(taskId, taskMessage, forwardToRenderer, addTaskMessage);
      },

      onProgress: (progress: { stage: string; message?: string }) => {
        if (isTaskIgnored(taskId)) return;
        forwardToRenderer('task:progress', {
          taskId,
          ...progress,
        });
      },

      onPermissionRequest: (request: unknown) => {
        if (isTaskIgnored(taskId)) return;
        // Flush pending messages before showing permission request
        flushAndCleanupBatcher(taskId);
        forwardToRenderer('permission:request', request);
      },

      onComplete: (result: TaskResult) => {
        if (isTaskIgnored(taskId)) return;
        // Flush any pending messages before completing
        flushAndCleanupBatcher(taskId);
        cleanupTempFile(resumeAttachmentTempFile);
        clearTaskFilePermissionPolicy(taskId);

        // Finalize turn usage even if OpenCode didn't emit an end_turn/stop step_finish.
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

        forwardToRenderer('task:update', {
          taskId,
          type: 'complete',
          result,
        });

        // Map result status to task status
        let taskStatus: TaskStatus;
        if (result.status === 'success') {
          taskStatus = 'completed';
        } else if (result.status === 'interrupted') {
          taskStatus = 'interrupted';
        } else {
          taskStatus = 'failed';
        }

        // Update task status in history
        updateTaskStatus(taskId, taskStatus, new Date().toISOString());

        // Update session ID if available (important for interrupted tasks to allow continuation)
        const newSessionId = result.sessionId || taskManager.getSessionId(taskId);
        if (newSessionId) {
          updateTaskSessionId(taskId, newSessionId);
        }
      },

      onError: (error: Error) => {
        if (isTaskIgnored(taskId)) return;
        // Flush any pending messages before error
        flushAndCleanupBatcher(taskId);
        cleanupTempFile(resumeAttachmentTempFile);

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

        forwardToRenderer('task:update', {
          taskId,
          type: 'error',
          error: error.message,
        });

        // Update task status in history
        updateTaskStatus(taskId, 'failed', new Date().toISOString());
      },

      onDebug: (log: { type: string; message: string; data?: unknown }) => {
        if (isTaskIgnored(taskId)) return;
        if (getDebugMode()) {
          forwardToRenderer('debug:log', {
            taskId,
            timestamp: new Date().toISOString(),
            ...log,
          });
        }
      },

      onStatusChange: (status: TaskStatus) => {
        if (isTaskIgnored(taskId)) return;
        // Notify renderer of status change (e.g., queued -> running)
        forwardToRenderer('task:status-change', {
          taskId,
          status,
        });
        // Update task status in history
        updateTaskStatus(taskId, status, new Date().toISOString());
      },
    };

    // Start the task via TaskManager with sessionId for resume (creates isolated adapter or queues if busy)
    const resumeConfig = applyAgentContext({
      prompt: augmentedPrompt,
      sessionId: validatedSessionId,
      taskId,
      agentId: existingTask?.agentId,
      attachedFiles: resumeAttachedFiles,
      privacyMode: effectivePrivacyMode,
    });

    const prepared = await preparePayloadForSend({
      agentId: resumeConfig.agentId,
      taskId,
      sessionFilePath,
      userMessage: resumeConfig.prompt,
      retrievedText: resumeAttachmentContentForEstimate,
      baseSystemPromptAppend: resumeConfig.systemPromptAppend,
      requireApiKey: true,
    });
    resumeConfig.systemPromptAppend = prepared.systemPromptAppend;
    trackTaskSkillRun(taskId, {
      agentId: resumeConfig.agentId,
      skillIds: prepared.selectedSkillIds,
    });
    if (prepared.shouldResetSession) {
      // Start a new OpenCode session while carrying forward trimmed context via system prompt.
      delete resumeConfig.sessionId;
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

    // Add the user's follow-up into the session snapshot AFTER preparing the payload
    // so we don't duplicate the current prompt in "Recent conversation".
    appendSessionLogMessage({
      sessionFilePath,
      role: 'user',
      content: resumeSessionLogContent,
    });
    let task: Task;
    try {
      task = await taskManager.startTask(taskId, resumeConfig, callbacks);
    } catch (error) {
      activeTurnByTaskId.delete(taskId);
      activeSkillRunByTaskId.delete(taskId);
      throw error;
    }
    task.agentId = resumeConfig.agentId;
    task.privacyMode = effectivePrivacyMode;
    (task as Task & { sessionFilePath?: string }).sessionFilePath = sessionFilePath;
    updateTaskSessionFilePath(taskId, sessionFilePath);

    // Update task status in history (whether running or queued)
    if (validatedExistingTaskId) {
      updateTaskStatus(validatedExistingTaskId, task.status, new Date().toISOString());
    }

    return task;
  });

  // Settings: Get API keys
  // Note: In production, this should fetch from backend to get metadata
  // The actual keys are stored locally in secure storage
  handle('settings:api-keys', async (_event: IpcMainInvokeEvent) => {
    const storedCredentials = await listStoredCredentials();

    return storedCredentials
      .filter((credential) => credential.account.startsWith('apiKey:'))
      .map((credential) => {
        const provider = credential.account.replace('apiKey:', '');
        const keyPrefix =
          credential.password && credential.password.length > 0
            ? `${credential.password.substring(0, 8)}...`
            : '';

        return {
          id: `local-${provider}`,
          provider,
          label: 'Local API Key',
          keyPrefix,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
      });
  });

  // Settings: Add API key (stores securely in OS keychain)
  handle(
    'settings:add-api-key',
    async (_event: IpcMainInvokeEvent, provider: string, key: string, label?: string) => {
      const providerId = sanitizeProviderId(provider, 'provider');
      const sanitizedKey = sanitizeString(key, 'apiKey', 256);
      const sanitizedLabel = label ? sanitizeString(label, 'label', 128) : undefined;

      // Store the API key securely in OS keychain
      await storeApiKey(providerId, sanitizedKey);

      return {
        id: `local-${providerId}`,
        provider: providerId,
        label: sanitizedLabel || 'Local API Key',
        keyPrefix: sanitizedKey.substring(0, 8) + '...',
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }
  );

  // Settings: Remove API key
  handle('settings:remove-api-key', async (_event: IpcMainInvokeEvent, id: string) => {
    // Extract provider from id (format: local-{provider})
    const sanitizedId = sanitizeString(id, 'id', 128);
    const provider = sanitizedId.replace('local-', '');
    await deleteApiKey(provider);
  });

  // API Key: Check if API key exists
  handle('api-key:exists', async (_event: IpcMainInvokeEvent) => {
    const apiKey = await getApiKey('anthropic');
    return Boolean(apiKey);
  });

  // API Key: Set API key
  handle('api-key:set', async (_event: IpcMainInvokeEvent, key: string) => {
    const sanitizedKey = sanitizeString(key, 'apiKey', 256);
    await storeApiKey('anthropic', sanitizedKey);
    console.log('[API Key] Key set', { keyPrefix: sanitizedKey.substring(0, 8) });
  });

  // API Key: Get API key
  handle('api-key:get', async (_event: IpcMainInvokeEvent) => {
    return await getApiKey('anthropic');
  });

  // API Key: Validate API key by making a test request
  handle('api-key:validate', async (_event: IpcMainInvokeEvent, key: string) => {
    const sanitizedKey = sanitizeString(key, 'apiKey', 256);
    console.log('[API Key] Validation requested');

    try {
      // Make a simple API call to validate the key
      const response = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': sanitizedKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }],
          }),
        },
        API_KEY_VALIDATION_TIMEOUT_MS
      );

      if (response.ok) {
        console.log('[API Key] Validation succeeded');
        return { valid: true };
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { error?: { message?: string } })?.error?.message || `API returned status ${response.status}`;

      console.warn('[API Key] Validation failed', { status: response.status, error: errorMessage });

      return { valid: false, error: errorMessage };
    } catch (error) {
      console.error('[API Key] Validation error', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.name === 'AbortError') {
        return { valid: false, error: 'Request timed out. Please check your internet connection and try again.' };
      }
      return { valid: false, error: 'Failed to validate API key. Check your internet connection.' };
    }
  });

  // API Key: Validate API key for any provider
  handle('api-key:validate-provider', async (_event: IpcMainInvokeEvent, provider: string, key: string) => {
    const providerId = sanitizeProviderId(provider, 'provider');
    if (!ALLOWED_API_KEY_PROVIDERS.has(providerId)) {
      // Custom providers are currently treated as user-managed endpoints.
      // We cannot validate unknown providers generically from the desktop app.
      return { valid: true };
    }
    const sanitizedKey = sanitizeString(key, 'apiKey', 256);
    console.log(`[API Key] Validation requested for provider: ${providerId}`);

    try {
      let response: Response;

      switch (providerId) {
        case 'anthropic':
          response = await fetchWithTimeout(
            'https://api.anthropic.com/v1/messages',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': sanitizedKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'test' }],
              }),
            },
            API_KEY_VALIDATION_TIMEOUT_MS
          );
          break;

        case 'openai':
          response = await fetchWithTimeout(
            'https://api.openai.com/v1/models',
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${sanitizedKey}`,
              },
            },
            API_KEY_VALIDATION_TIMEOUT_MS
          );
          break;

        case 'google':
          response = await fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${sanitizedKey}`,
            {
              method: 'GET',
            },
            API_KEY_VALIDATION_TIMEOUT_MS
          );
          break;

        case 'xai':
          response = await fetchWithTimeout(
            'https://api.x.ai/v1/models',
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${sanitizedKey}`,
              },
            },
            API_KEY_VALIDATION_TIMEOUT_MS
          );
          break;

        default:
          // For 'custom' provider, skip validation
          console.log('[API Key] Skipping validation for custom provider');
          return { valid: true };
      }

      if (response.ok) {
        console.log(`[API Key] Validation succeeded for ${providerId}`);
        return { valid: true };
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { error?: { message?: string } })?.error?.message || `API returned status ${response.status}`;

      console.warn(`[API Key] Validation failed for ${providerId}`, { status: response.status, error: errorMessage });
      return { valid: false, error: errorMessage };
    } catch (error) {
      console.error(`[API Key] Validation error for ${providerId}`, { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.name === 'AbortError') {
        return { valid: false, error: 'Request timed out. Please check your internet connection and try again.' };
      }
      return { valid: false, error: 'Failed to validate API key. Check your internet connection.' };
    }
  });

  // API Key: Clear API key
  handle('api-key:clear', async (_event: IpcMainInvokeEvent) => {
    await deleteApiKey('anthropic');
    console.log('[API Key] Key cleared');
  });

  // OpenCode CLI: Check if installed
  handle('opencode:check', async (_event: IpcMainInvokeEvent) => {
    // E2E test bypass: return mock CLI status when E2E skip auth is enabled
    if (isE2ESkipAuthEnabled()) {
      return {
        installed: true,
        version: '1.0.0-test',
        installCommand: 'npm install -g opencode-ai',
      };
    }

    const installed = await isOpenCodeCliInstalled();
    const version = installed ? await getOpenCodeCliVersion() : null;
    return {
      installed,
      version,
      installCommand: 'npm install -g opencode-ai',
    };
  });

  // OpenCode CLI: Get version
  handle('opencode:version', async (_event: IpcMainInvokeEvent) => {
    return getOpenCodeCliVersion();
  });

  // Model: Get selected model
  handle('model:get', async (_event: IpcMainInvokeEvent) => {
    return getSelectedModel();
  });

  // Model: Set selected model
  handle('model:set', async (_event: IpcMainInvokeEvent, model: SelectedModel) => {
    setSelectedModel(sanitizeSelectedModel(model));
  });

  // User-skill assistant model override (falls back to global model when null)
  handle('user-skills:assistant:model:get', async (_event: IpcMainInvokeEvent) => {
    return getUserSkillAssistantModel();
  });

  handle('user-skills:assistant:model:set', async (_event: IpcMainInvokeEvent, model: SelectedModel | null) => {
    if (!model) return setUserSkillAssistantModel(null);
    return setUserSkillAssistantModel(sanitizeSelectedModel(model, 'userSkillAssistantModel'));
  });

  // Model providers: merged list (built-ins + user custom)
  handle('model-providers:list', async () => {
    return listModelProviders();
  });

  // Model providers: custom providers only
  handle('model-providers:custom:list', async () => {
    return listCustomModelProviders();
  });

  // Model providers: create/update custom provider
  handle('model-providers:upsert', async (_event: IpcMainInvokeEvent, config: ProviderConfig) => {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid provider configuration');
    }

    const providerId = sanitizeProviderId(config.id, 'provider.id');
    const name = sanitizeString(config.name || providerId, 'provider.name', 128);
    const requiresApiKey = config.requiresApiKey !== false;
    const baseUrl = config.baseUrl ? sanitizeString(config.baseUrl, 'provider.baseUrl', 1024) : undefined;
    const apiKeyEnvVar = config.apiKeyEnvVar ? sanitizeString(config.apiKeyEnvVar, 'provider.apiKeyEnvVar', 128) : undefined;

    const models = Array.isArray(config.models) ? config.models : [];
    if (models.length === 0) {
      throw new Error('Provider must include at least one model');
    }

    const sanitizedModels: ModelConfig[] = models.map((model, index) => {
      const modelId = sanitizeString(model?.id, `models[${index}].id`, 128);
      const displayName = sanitizeString(model?.displayName || modelId, `models[${index}].displayName`, 128);
      const fullId = model?.fullId
        ? sanitizeString(model.fullId, `models[${index}].fullId`, 256)
        : `${providerId}/${modelId}`;
      const contextWindow = typeof model?.contextWindow === 'number' && Number.isFinite(model.contextWindow)
        ? Math.max(1, Math.floor(model.contextWindow))
        : undefined;
      const maxOutputTokens = typeof model?.maxOutputTokens === 'number' && Number.isFinite(model.maxOutputTokens)
        ? Math.max(1, Math.floor(model.maxOutputTokens))
        : undefined;
      return {
        id: modelId,
        displayName,
        provider: providerId,
        fullId,
        contextWindow,
        maxOutputTokens,
        supportsVision: model?.supportsVision === true ? true : undefined,
      };
    });

    return upsertCustomModelProvider({
      id: providerId,
      name,
      requiresApiKey,
      baseUrl,
      apiKeyEnvVar,
      models: sanitizedModels,
    });
  });

  // Model providers: delete custom provider
  handle('model-providers:delete', async (_event: IpcMainInvokeEvent, providerId: string) => {
    const id = sanitizeProviderId(providerId, 'providerId');
    return { ok: deleteCustomModelProvider(id) };
  });

  // Model: Context limit overrides (per model)
  handle('model:limits:get', async () => {
    return { overrides: getModelLimitOverrides() };
  });

  handle('model:limits:set', async (_event: IpcMainInvokeEvent, payload: { fullId: string; contextWindowTokens: number | null }) => {
    if (!payload || typeof payload.fullId !== 'string') {
      throw new Error('fullId is required');
    }
    const fullId = sanitizeString(payload.fullId, 'fullId', 256);
    const value = payload.contextWindowTokens;
    if (value === null) {
      setModelContextLimitOverride(fullId, null);
      return { fullId, contextWindowTokens: null };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('contextWindowTokens must be a number or null');
    }
    const intVal = Math.floor(value);
    if (intVal < 1024 || intVal > 10_000_000) {
      throw new Error('contextWindowTokens must be between 1,024 and 10,000,000');
    }
    setModelContextLimitOverride(fullId, intVal);
    return { fullId, contextWindowTokens: intVal };
  });

  // Ollama: Test connection and get models
  handle('ollama:test-connection', async (_event: IpcMainInvokeEvent, url: string) => {
    const sanitizedUrl = sanitizeString(url, 'ollamaUrl', 256);

    // Validate URL format and protocol
    try {
      const parsed = new URL(sanitizedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, error: 'Only http and https URLs are allowed' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    try {
      const response = await fetchWithTimeout(
        `${sanitizedUrl}/api/tags`,
        { method: 'GET' },
        API_KEY_VALIDATION_TIMEOUT_MS
      );

      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }

      const data = await response.json() as { models?: Array<{ name: string; size: number }> };
      const models: OllamaModel[] = (data.models || []).map((m) => ({
        id: m.name,
        displayName: m.name,
        size: m.size,
      }));

      console.log(`[Ollama] Connection successful, found ${models.length} models`);
      return { success: true, models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      console.warn('[Ollama] Connection failed:', message);

      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Connection timed out. Make sure Ollama is running.' };
      }
      return { success: false, error: `Cannot connect to Ollama: ${message}` };
    }
  });

  // Ollama: Get stored config
  handle('ollama:get-config', async (_event: IpcMainInvokeEvent) => {
    return getOllamaConfig();
  });

  // Ollama: Set config
  handle('ollama:set-config', async (_event: IpcMainInvokeEvent, config: OllamaConfig | null) => {
    if (config !== null) {
      if (typeof config.baseUrl !== 'string' || typeof config.enabled !== 'boolean') {
        throw new Error('Invalid Ollama configuration');
      }
      // Validate URL format and protocol
      try {
        const parsed = new URL(config.baseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('Only http and https URLs are allowed');
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('http')) {
          throw e; // Re-throw our protocol error
        }
        throw new Error('Invalid base URL format');
      }
      // Validate optional lastValidated if present
      if (config.lastValidated !== undefined && typeof config.lastValidated !== 'number') {
        throw new Error('Invalid Ollama configuration');
      }
      // Validate optional models array if present
      if (config.models !== undefined) {
        if (!Array.isArray(config.models)) {
          throw new Error('Invalid Ollama configuration: models must be an array');
        }
        for (const model of config.models) {
          if (typeof model.id !== 'string' || typeof model.displayName !== 'string' || typeof model.size !== 'number') {
            throw new Error('Invalid Ollama configuration: invalid model format');
          }
        }
      }
    }
    setOllamaConfig(config);
    console.log('[Ollama] Config saved:', config);
  });

  // API Keys: Get all API keys (with masked values)
  handle('api-keys:all', async (_event: IpcMainInvokeEvent) => {
    const masked: Record<string, { exists: boolean; prefix?: string }> = {};
    const credentials = await listStoredCredentials();
    for (const credential of credentials) {
      if (!credential.account.startsWith('apiKey:')) continue;
      const provider = credential.account.replace('apiKey:', '').trim().toLowerCase();
      if (!provider) continue;
      const key = credential.password || '';
      masked[provider] = {
        exists: Boolean(key),
        prefix: key ? key.substring(0, 8) + '...' : undefined,
      };
    }
    // Ensure known providers are always present in the status map.
    for (const provider of ['anthropic', 'openai', 'google', 'xai', 'custom']) {
      if (!masked[provider]) {
        masked[provider] = { exists: false };
      }
    }
    return masked;
  });

  // API Keys: Check if any key exists
  handle('api-keys:has-any', async (_event: IpcMainInvokeEvent) => {
    // In E2E mock mode, pretend we have API keys
    if (isMockTaskEventsEnabled()) {
      return true;
    }
    return hasAnyApiKey();
  });

  // Settings: Get debug mode setting
  handle('settings:debug-mode', async (_event: IpcMainInvokeEvent) => {
    return getDebugMode();
  });

  // Settings: Set debug mode setting
  handle('settings:set-debug-mode', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid debug mode flag');
    }
    setDebugMode(enabled);
    // Broadcast the change to all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:debug-mode-changed', { enabled });
    }
  });

  // Settings: Set run-in-background setting (tray mode)
  handle('settings:set-run-in-background', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid run-in-background flag');
    }
    setRunInBackground(enabled);
    setBackgroundRunInBackground(enabled);
  });

  // Settings: Set launch-at-login setting
  handle('settings:set-launch-at-login', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid launch-at-login flag');
    }
    setLaunchAtLogin(enabled);
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
    });
  });

  // Settings: Set mobile nodes enabled
  handle('settings:set-mobile-nodes-enabled', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid mobile nodes flag');
    }
    setMobileNodesEnabled(enabled);
    return getMobileNodesEnabled();
  });

  // Settings: Set max live previews for mobile nodes
  handle('settings:set-mobile-nodes-max-live-previews', async (_event: IpcMainInvokeEvent, count: number) => {
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error('Invalid max live previews value');
    }
    return setMobileNodesMaxLivePreviews(count);
  });

  // Settings: Set mobile nodes display name
  handle('settings:set-mobile-nodes-name', async (_event: IpcMainInvokeEvent, name: string) => {
    if (typeof name !== 'string') {
      throw new Error('Invalid mobile nodes name');
    }
    return setMobileNodesDisplayName(name);
  });

  // Settings: Set webhook bind mode
  handle('settings:set-webhook-bind', async (_event: IpcMainInvokeEvent, mode: string) => {
    if (mode !== 'localhost' && mode !== 'all') {
      throw new Error('Invalid webhook bind mode');
    }
    return setWebhookBindMode(mode);
  });

  // Settings: Set runtime speed mode
  handle('settings:set-agent-speed-mode', async (_event: IpcMainInvokeEvent, mode: string) => {
    if (mode !== 'fast' && mode !== 'balanced' && mode !== 'deep') {
      throw new Error('Invalid speed mode');
    }
    return setAgentSpeedMode(mode);
  });

  // Settings: Set Build Mode diff enforcement mode
  handle('settings:set-build-diff-enforcement-mode', async (_event: IpcMainInvokeEvent, mode: string) => {
    if (mode !== 'auto-apply' && mode !== 'preview-only' && mode !== 'approval') {
      throw new Error('Invalid build diff enforcement mode');
    }
    return setBuildDiffEnforcementMode(mode);
  });

  // Settings: Set browser profile
  handle('settings:set-browser-profile', async (_event: IpcMainInvokeEvent, profile: string) => {
    const sanitizedProfile = sanitizeString(profile, 'browserProfile', 64);
    setBrowserProfile(sanitizedProfile);
    return getBrowserProfile();
  });

  // Settings: Set workspace root
  handle('settings:set-workspace-root', async (_event: IpcMainInvokeEvent, root: string | null) => {
    if (root === null || root === undefined || root === '') {
      setWorkspaceRoot(null);
      return getWorkspaceRoot();
    }
    const sanitizedRoot = sanitizeString(root, 'workspaceRoot', 1024);
    setWorkspaceRoot(sanitizedRoot);
    return getWorkspaceRoot();
  });

  // Settings: Get all app settings
  handle('settings:app-settings', async (_event: IpcMainInvokeEvent) => {
    return getAppSettings();
  });

  // Saved prompts (shared between desktop renderer and webchat)
  handle('saved-prompts:list', async () => {
    return listSavedPrompts();
  });

  handle(
    'saved-prompts:upsert',
    async (
      _event: IpcMainInvokeEvent,
      payload: { id?: string; title: string; content: string; createdAt?: string; updatedAt?: string }
    ) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid saved prompt payload');
      }
      const id = payload.id ? sanitizeString(payload.id, 'id', 128) : undefined;
      const title = sanitizeString(payload.title, 'title', 256);
      const content = sanitizeString(payload.content, 'content', 50_000);
      const createdAt = payload.createdAt ? sanitizeString(payload.createdAt, 'createdAt', 64) : undefined;
      const updatedAt = payload.updatedAt ? sanitizeString(payload.updatedAt, 'updatedAt', 64) : undefined;
      return upsertSavedPrompt({ id, title, content, createdAt, updatedAt });
    }
  );

  handle('saved-prompts:delete', async (_event: IpcMainInvokeEvent, id: string) => {
    const promptId = sanitizeString(id, 'id', 128);
    return { ok: deleteSavedPrompt(promptId) };
  });

  // Usage estimate: global token usage summary (all chats)
  handle('usage:get-summary', async (_event: IpcMainInvokeEvent, period: UsagePeriod) => {
    if (period !== 'day' && period !== 'week' && period !== 'month') {
      throw new Error('Invalid period');
    }
    return getUsageSummary(period);
  });

  // Usage estimate: pricing settings
  handle('usage:pricing:get', async () => {
    return getUsagePricingSettings();
  });

  handle('usage:models-used', async () => {
    return listModelsUsed();
  });

  handle('usage:pricing:set', async (_event: IpcMainInvokeEvent, settings: UsagePricingSettings) => {
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings');
    const allowedCurrencies = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
    if (!allowedCurrencies.has(settings.currency)) throw new Error('Invalid currency');

    const providers = Array.isArray(settings.providers) ? settings.providers : [];
    const sanitizedProviders = providers.map((row) => {
      const provider = sanitizeString(row.provider, 'provider', 32) as UsagePricingSettings['providers'][number]['provider'];
      const model = row.model ? sanitizeString(row.model, 'model', 256) : null;
      const inputCostPer1m = typeof row.inputCostPer1m === 'number' && Number.isFinite(row.inputCostPer1m) ? row.inputCostPer1m : null;
      const outputCostPer1m = typeof row.outputCostPer1m === 'number' && Number.isFinite(row.outputCostPer1m) ? row.outputCostPer1m : null;
      const effectiveFrom = row.effectiveFrom ? sanitizeString(row.effectiveFrom, 'effectiveFrom', 32) : null;
      const pricingSource: 'manual' | 'ai' = row.pricingSource === 'ai' ? 'ai' : 'manual';
      const pricingUpdatedAt = row.pricingUpdatedAt ? sanitizeString(row.pricingUpdatedAt, 'pricingUpdatedAt', 64) : new Date().toISOString();
      const createdAt = row.createdAt ? sanitizeString(row.createdAt, 'createdAt', 64) : new Date().toISOString();
      return {
        provider,
        model,
        inputCostPer1m,
        outputCostPer1m,
        effectiveFrom,
        pricingSource,
        pricingUpdatedAt,
        createdAt,
      };
    });

    setUsagePricingSettings({
      currency: settings.currency,
      updatedAt: new Date().toISOString(),
      providers: sanitizedProviders,
    });
    return getUsagePricingSettings();
  });

  handle('usage:pricing:autofill', async (_event: IpcMainInvokeEvent, request: UsagePricingAutofillRequest) => {
    const targets = Array.isArray(request?.targets) ? request.targets : [];
    return suggestPricingFromInternet({ currency: request?.currency, targets });
  });

  // Settings: Memory (user context)
  handle('settings:memory:get', async (_event: IpcMainInvokeEvent, payload?: { agentId?: string; date?: string }) => {
    return getMemoryState(payload?.agentId, payload?.date);
  });

  handle('settings:memory:read', async (_event: IpcMainInvokeEvent, payload: { kind: 'long-term' | 'daily'; date?: string; agentId?: string }) => {
    if (!payload || (payload.kind !== 'long-term' && payload.kind !== 'daily')) {
      throw new Error('Invalid memory read request');
    }
    return readMemoryFile(payload.kind, payload.date, payload.agentId);
  });

  handle('settings:memory:save', async (_event: IpcMainInvokeEvent, payload: { kind: 'long-term' | 'daily'; date?: string; agentId?: string; content?: string }) => {
    if (!payload || (payload.kind !== 'long-term' && payload.kind !== 'daily')) {
      throw new Error('Invalid memory save request');
    }
    const content = sanitizeOptionalText(payload.content, 'content', 200000);
    return saveMemoryFile(payload.kind, content, payload.date, payload.agentId);
  });

  // Files: Save data URL to temp file
  handle('files:save-data-url', async (_event: IpcMainInvokeEvent, payload: { dataUrl?: string; baseName?: string }) => {
    const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : '';
    const baseName = typeof payload?.baseName === 'string' ? payload.baseName : 'snapshot';
    if (!dataUrl) {
      throw new Error('dataUrl is required');
    }
    const filePath = saveDataUrlToTempFile(dataUrl, baseName);
    return { filePath };
  });

  // Agents: List agents with default/active info
  handle('agents:list', async () => {
    return {
      agents: listAgents(),
      defaultAgentId: getDefaultAgentId(),
      activeAgentId: resolveActiveAgentId(),
    };
  });

  // Agents: Create or update agent
  handle('agents:upsert', async (
    _event: IpcMainInvokeEvent,
    config: {
      id?: string;
      name: string;
      roleName?: string;
      description?: string;
      avatar?: string;
      avatarColor?: string;
      workspaceRoot?: string;
      systemPromptAppend?: string;
      selectedModel?: SelectedModel | null;
      agenticLoopEnabled?: boolean;
      agenticLoopMaxIterations?: number;
      agenticLoopTimeoutMs?: number;
      heartbeatEnabled?: boolean;
      heartbeatIntervalSeconds?: number;
      heartbeatScheduleMode?: 'interval' | 'daily';
      heartbeatIntervalMinutes?: number;
      heartbeatDailyTime?: string;
      heartbeatTimeZone?: string;
      heartbeatWindowEnabled?: boolean;
      heartbeatWindowStartTime?: string;
      heartbeatWindowEndTime?: string;
      heartbeatPrompt?: string;
      autoSkillEnabled?: boolean;
      autoSkillAutoPromoteLowRisk?: boolean;
    }
  ) => {
    if (!config || typeof config.name !== 'string') {
      throw new Error('Agent name is required');
    }
    const hasSelectedModel = Object.prototype.hasOwnProperty.call(config, 'selectedModel');
    const sanitizedConfig: {
      id?: string;
      name: string;
      roleName?: string;
      description?: string;
      avatar?: string;
      avatarColor?: string;
      workspaceRoot?: string;
      systemPromptAppend?: string;
      selectedModel?: SelectedModel | null;
      agenticLoopEnabled?: boolean;
      agenticLoopMaxIterations?: number;
      agenticLoopTimeoutMs?: number;
      heartbeatEnabled?: boolean;
      heartbeatIntervalSeconds?: number;
      heartbeatScheduleMode?: 'interval' | 'daily';
      heartbeatIntervalMinutes?: number;
      heartbeatDailyTime?: string;
      heartbeatTimeZone?: string;
      heartbeatWindowEnabled?: boolean;
      heartbeatWindowStartTime?: string;
      heartbeatWindowEndTime?: string;
      heartbeatPrompt?: string;
      autoSkillEnabled?: boolean;
      autoSkillAutoPromoteLowRisk?: boolean;
    } = {
      id: config.id ? sanitizeString(config.id, 'agentId', 64) : undefined,
      name: sanitizeString(config.name, 'name', 128),
      roleName: config.roleName ? sanitizeString(config.roleName, 'roleName', 128) : undefined,
      description: config.description ? sanitizeString(config.description, 'description', 256) : undefined,
      avatar: config.avatar ? sanitizeString(config.avatar, 'avatar', 64) : undefined,
      avatarColor: config.avatarColor ? sanitizeString(config.avatarColor, 'avatarColor', 16) : undefined,
      workspaceRoot: config.workspaceRoot ? sanitizeString(config.workspaceRoot, 'workspaceRoot', 1024) : undefined,
      systemPromptAppend: config.systemPromptAppend ? sanitizeString(config.systemPromptAppend, 'systemPromptAppend', MAX_TEXT_LENGTH) : undefined,
    };
    if (hasSelectedModel) {
      sanitizedConfig.selectedModel = config.selectedModel == null
        ? null
        : sanitizeSelectedModel(config.selectedModel, 'selectedModel');
    }
    if (Object.prototype.hasOwnProperty.call(config, 'agenticLoopEnabled')) {
      if (typeof config.agenticLoopEnabled !== 'boolean') {
        throw new Error('agenticLoopEnabled must be a boolean');
      }
      sanitizedConfig.agenticLoopEnabled = config.agenticLoopEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'agenticLoopMaxIterations')) {
      sanitizedConfig.agenticLoopMaxIterations = sanitizeIntegerRange(
        config.agenticLoopMaxIterations,
        'agenticLoopMaxIterations',
        1,
        20,
        4
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'agenticLoopTimeoutMs')) {
      sanitizedConfig.agenticLoopTimeoutMs = sanitizeIntegerRange(
        config.agenticLoopTimeoutMs,
        'agenticLoopTimeoutMs',
        15_000,
        3_600_000,
        300_000
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatEnabled')) {
      if (typeof config.heartbeatEnabled !== 'boolean') {
        throw new Error('heartbeatEnabled must be a boolean');
      }
      sanitizedConfig.heartbeatEnabled = config.heartbeatEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatIntervalSeconds')) {
      sanitizedConfig.heartbeatIntervalSeconds = sanitizeIntegerRange(
        config.heartbeatIntervalSeconds,
        'heartbeatIntervalSeconds',
        15,
        86_400,
        300
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatScheduleMode')) {
      if (config.heartbeatScheduleMode !== 'interval' && config.heartbeatScheduleMode !== 'daily') {
        throw new Error('heartbeatScheduleMode must be interval or daily');
      }
      sanitizedConfig.heartbeatScheduleMode = config.heartbeatScheduleMode;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatIntervalMinutes')) {
      sanitizedConfig.heartbeatIntervalMinutes = sanitizeIntegerRange(
        config.heartbeatIntervalMinutes,
        'heartbeatIntervalMinutes',
        1,
        1_440,
        5
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatDailyTime')) {
      const value = (config.heartbeatDailyTime ?? '').trim();
      if (value && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
        throw new Error('heartbeatDailyTime must be HH:MM');
      }
      sanitizedConfig.heartbeatDailyTime = value || undefined;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatTimeZone')) {
      const value = (config.heartbeatTimeZone ?? '').trim();
      if (!value || value.toLowerCase() === 'system') {
        sanitizedConfig.heartbeatTimeZone = 'system';
      } else {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
          sanitizedConfig.heartbeatTimeZone = value;
        } catch {
          throw new Error('heartbeatTimeZone must be a valid IANA timezone or system');
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatWindowEnabled')) {
      if (typeof config.heartbeatWindowEnabled !== 'boolean') {
        throw new Error('heartbeatWindowEnabled must be a boolean');
      }
      sanitizedConfig.heartbeatWindowEnabled = config.heartbeatWindowEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatWindowStartTime')) {
      const value = (config.heartbeatWindowStartTime ?? '').trim();
      if (value && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
        throw new Error('heartbeatWindowStartTime must be HH:MM');
      }
      sanitizedConfig.heartbeatWindowStartTime = value || undefined;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatWindowEndTime')) {
      const value = (config.heartbeatWindowEndTime ?? '').trim();
      if (value && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
        throw new Error('heartbeatWindowEndTime must be HH:MM');
      }
      sanitizedConfig.heartbeatWindowEndTime = value || undefined;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'heartbeatPrompt')) {
      sanitizedConfig.heartbeatPrompt = config.heartbeatPrompt
        ? sanitizeString(config.heartbeatPrompt, 'heartbeatPrompt', MAX_TEXT_LENGTH)
        : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'autoSkillEnabled')) {
      if (typeof config.autoSkillEnabled !== 'boolean') {
        throw new Error('autoSkillEnabled must be a boolean');
      }
      sanitizedConfig.autoSkillEnabled = config.autoSkillEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'autoSkillAutoPromoteLowRisk')) {
      if (typeof config.autoSkillAutoPromoteLowRisk !== 'boolean') {
        throw new Error('autoSkillAutoPromoteLowRisk must be a boolean');
      }
      sanitizedConfig.autoSkillAutoPromoteLowRisk = config.autoSkillAutoPromoteLowRisk;
    }
    return upsertAgent(sanitizedConfig);
  });

  // Agents: Delete agent
  handle('agents:delete', async (_event: IpcMainInvokeEvent, agentId: string) => {
    const sanitizedId = sanitizeString(agentId, 'agentId', 64);
    const activeBefore = resolveActiveAgentId();
    deleteAgent(sanitizedId);
    if (activeBefore === sanitizedId) {
      const fallback = getDefaultAgentId();
      setActiveAgentId(fallback);
    }
  });

  // Agents: Set default agent
  handle('agents:set-default', async (_event: IpcMainInvokeEvent, agentId: string) => {
    const sanitizedId = sanitizeString(agentId, 'agentId', 64);
    return setDefaultAgentId(sanitizedId);
  });

  // Agents: Set active agent
  handle('agents:set-active', async (_event: IpcMainInvokeEvent, agentId: string) => {
    const sanitizedId = sanitizeString(agentId, 'agentId', 64);
    const agent = getAgent(sanitizedId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    setActiveAgentId(agent.id);
    return agent.id;
  });

  // Agents: Get active agent id
  handle('agents:get-active', async () => {
    return resolveActiveAgentId();
  });

  // Discord: Get config + status
  handle('discord:get', async () => {
    return {
      config: getDiscordConfig(),
      status: getDiscordStatus(),
      tokenSet: await getDiscordTokenSet(),
    };
  });

  // Discord: Update config
  handle('discord:set-config', async (_event: IpcMainInvokeEvent, config: DiscordConnectorConfig) => {
    const validated = validateDiscordConfig(config);
    const updated = setDiscordConfig(validated);
    setGatewayConnectorExtensionConfig({
      id: 'discord',
      enabled: updated.enabled,
      agentId: updated.agentId,
    });
    syncGatewayConnectorBinding({
      id: 'discord',
      enabled: updated.enabled,
      autoBindRouting: getGatewayConnectorExtensionConfig('discord').autoBindRouting,
      agentId: updated.agentId,
      accountId: getGatewayConnectorExtensionConfig('discord').accountId,
    });
    await restartGatewayConnectorRuntime('discord');
    return updated;
  });

  // Discord: Store bot token
  handle('discord:set-token', async (_event: IpcMainInvokeEvent, token: string) => {
    const sanitized = sanitizeString(token, 'discordToken', 256);
    await storeDiscordToken(sanitized);
    await restartGatewayConnectorRuntime('discord');
    return { tokenSet: true };
  });

  // Discord: Clear bot token
  handle('discord:clear-token', async () => {
    await deleteDiscordToken();
    await restartGatewayConnectorRuntime('discord');
    return { tokenSet: false };
  });

  // Discord: List pending pairing requests
  handle('discord:pairing:list', async () => {
    return listDiscordPairingRequests();
  });

  // Discord: Approve pairing request
  handle('discord:pairing:approve', async (_event: IpcMainInvokeEvent, userId: string, code: string) => {
    const sanitizedUserId = sanitizeString(userId, 'discordUserId', 64);
    const sanitizedCode = sanitizeString(code, 'pairingCode', 32).toUpperCase();
    const approved = approveDiscordPairing(sanitizedUserId, sanitizedCode);
    if (approved) {
      addDiscordDmAllowlistEntry(sanitizedUserId);
    }
    return { approved };
  });

  // Telegram: Get config + status
  handle('telegram:get', async () => {
    return {
      config: getTelegramConfig(),
      status: getTelegramStatus(),
      tokenSet: await getTelegramTokenSet(),
    };
  });

  // Telegram: Update config
  handle('telegram:set-config', async (_event: IpcMainInvokeEvent, config: TelegramConnectorConfig) => {
    const validated = validateTelegramConfig(config);
    const updated = setTelegramConfig(validated);
    setGatewayConnectorExtensionConfig({
      id: 'telegram',
      enabled: updated.enabled,
      agentId: updated.agentId,
    });
    syncGatewayConnectorBinding({
      id: 'telegram',
      enabled: updated.enabled,
      autoBindRouting: getGatewayConnectorExtensionConfig('telegram').autoBindRouting,
      agentId: updated.agentId,
      accountId: getGatewayConnectorExtensionConfig('telegram').accountId,
    });
    await restartGatewayConnectorRuntime('telegram');
    return updated;
  });

  // Telegram: Store bot token
  handle('telegram:set-token', async (_event: IpcMainInvokeEvent, token: string) => {
    const sanitized = sanitizeString(token, 'telegramToken', 256);
    await storeTelegramToken(sanitized);
    await restartGatewayConnectorRuntime('telegram');
    return { tokenSet: true };
  });

  // Telegram: Clear bot token
  handle('telegram:clear-token', async () => {
    await deleteTelegramToken();
    await restartGatewayConnectorRuntime('telegram');
    return { tokenSet: false };
  });

  // Telegram: List pending pairing requests
  handle('telegram:pairing:list', async () => {
    return listTelegramPairingRequests();
  });

  // Telegram: Approve pairing request
  handle('telegram:pairing:approve', async (_event: IpcMainInvokeEvent, userId: string, code: string) => {
    const sanitizedUserId = sanitizeString(userId, 'telegramUserId', 64);
    const sanitizedCode = sanitizeString(code, 'pairingCode', 32).toUpperCase();
    const approved = approveTelegramPairing(sanitizedUserId, sanitizedCode);
    if (approved) {
      addTelegramDmAllowlistEntry(sanitizedUserId);
    }
    return { approved };
  });

  // Voice wake: Get config
  handle('voicewake:get', async () => {
    return getVoiceWakeConfig();
  });

  // Voice wake: Update config
  handle('voicewake:set', async (_event: IpcMainInvokeEvent, config: VoiceWakeConfig) => {
    const validated = validateVoiceWakeConfig(config);
    const updated = setVoiceWakeConfig(validated);
    await restartVoiceWakeService();
    return updated;
  });

  // Voice wake: Access key status
  handle('voicewake:get-access-key', async () => {
    const key = await getVoiceWakeAccessKey();
    return { accessKeySet: Boolean(key) };
  });

  // Voice wake: Store access key
  handle('voicewake:set-access-key', async (_event: IpcMainInvokeEvent, accessKey: string) => {
    const sanitized = sanitizeString(accessKey, 'voiceWakeAccessKey', 256);
    await storeVoiceWakeAccessKey(sanitized);
    await restartVoiceWakeService();
    return { accessKeySet: true };
  });

  // Voice wake: Clear access key
  handle('voicewake:clear-access-key', async () => {
    await deleteVoiceWakeAccessKey();
    await restartVoiceWakeService();
    return { accessKeySet: false };
  });

  // Voice wake: Whisper transcription
  handle('voicewake:transcribe-whisper', async (_event: IpcMainInvokeEvent, payload: { audioBase64: string }) => {
    if (!payload || typeof payload.audioBase64 !== 'string') {
      throw new Error('audioBase64 is required');
    }
    const buffer = Buffer.from(payload.audioBase64, 'base64');
    const text = await transcribeWithWhisper(buffer);
    return { text };
  });

  // Mobile nodes: List pairing state
  handle('nodes:pairing:list', async () => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    return listNodePairing();
  });

  // Mobile nodes: Approve pairing request
  handle('nodes:pairing:approve', async (_event: IpcMainInvokeEvent, requestId: string) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    const sanitized = sanitizeString(requestId, 'requestId', 128);
    const node = approveNodePairing(sanitized);
    return { node };
  });

  // Mobile nodes: Reject pairing request
  handle('nodes:pairing:reject', async (_event: IpcMainInvokeEvent, requestId: string) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    const sanitized = sanitizeString(requestId, 'requestId', 128);
    const result = rejectNodePairing(sanitized);
    return { result };
  });

  // Mobile nodes: Remove paired node
  handle('nodes:paired:remove', async (_event: IpcMainInvokeEvent, nodeId: string) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    const sanitized = sanitizeString(nodeId, 'nodeId', 128);
    const result = removePairedNode(sanitized);
    return { result };
  });

  // Mobile nodes: Update paired node display name / badge
  handle(
    'nodes:paired:update-name',
    async (
      _event: IpcMainInvokeEvent,
      payload: { nodeId: string; displayName?: string | null; badgeColor?: string | null; badgeIcon?: string | null }
    ) => {
      if (!getMobileNodesEnabled()) {
        throw new Error('Mobile nodes are disabled.');
      }
      if (!payload || typeof payload.nodeId !== 'string') {
        throw new Error('nodeId is required');
      }
      const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
      const sanitizedName =
        typeof payload.displayName === 'string' ? sanitizeString(payload.displayName, 'displayName', 128) : null;
      const sanitizedBadgeColor =
        typeof payload.badgeColor === 'string' ? sanitizeString(payload.badgeColor, 'badgeColor', 64) : null;
      const sanitizedBadgeIcon =
        typeof payload.badgeIcon === 'string' ? sanitizeString(payload.badgeIcon, 'badgeIcon', 64) : null;
      const node = updatePairedNodeBadge(sanitizedNodeId, {
        displayName: sanitizedName,
        badgeColor: sanitizedBadgeColor,
        badgeIcon: sanitizedBadgeIcon,
      });
      return { node };
    }
  );

  // Mobile nodes: Update AI access toggle
  handle(
    'nodes:paired:update-ai-access',
    async (_event: IpcMainInvokeEvent, payload: { nodeId: string; allowed: boolean }) => {
      if (!getMobileNodesEnabled()) {
        throw new Error('Mobile nodes are disabled.');
      }
      if (!payload || typeof payload.nodeId !== 'string') {
        throw new Error('nodeId is required');
      }
      const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
      const allowed = Boolean(payload.allowed);
      const node = updatePairedNodeAiAccess(sanitizedNodeId, allowed);
      return { node };
    }
  );

  // Mobile nodes: Request camera snapshot
  handle('nodes:camera:snapshot', async (_event: IpcMainInvokeEvent, payload: { nodeId: string; target?: 'snapshot' | 'live' }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const result = await invokeNodeCommand({
      nodeId: sanitizedNodeId,
      command: 'camera.snapshot',
      payload: { requestedAt: new Date().toISOString(), target: payload.target ?? 'snapshot' },
      timeoutMs: 25_000,
    });
    return result;
  });

  // Mobile nodes: Start mic stream
  handle('nodes:mic:start', async (_event: IpcMainInvokeEvent, payload: { nodeId: string; chunkMs?: number }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const streamId = randomUUID();
    const result = await invokeNodeCommand({
      nodeId: sanitizedNodeId,
      command: 'mic.stream.start',
      payload: { streamId, chunkMs: payload?.chunkMs ?? 1500 },
      timeoutMs: 25_000,
    });
    return { streamId, result };
  });

  // Mobile nodes: Stop mic stream
  handle('nodes:mic:stop', async (_event: IpcMainInvokeEvent, payload: { nodeId: string; streamId?: string }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const result = await invokeNodeCommand({
      nodeId: sanitizedNodeId,
      command: 'mic.stream.stop',
      payload: { streamId: payload?.streamId ?? '' },
      timeoutMs: 10_000,
    });
    return result;
  });

  // Mobile nodes: Start screen stream
  handle('nodes:screen:start', async (_event: IpcMainInvokeEvent, payload: { nodeId: string; chunkMs?: number }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const streamId = randomUUID();
    const result = await invokeNodeCommand({
      nodeId: sanitizedNodeId,
      command: 'screen.stream.start',
      payload: { streamId, chunkMs: payload?.chunkMs ?? 1500 },
      timeoutMs: 25_000,
    });
    return { streamId, result };
  });

  // Mobile nodes: Stop screen stream
  handle('nodes:screen:stop', async (_event: IpcMainInvokeEvent, payload: { nodeId: string; streamId?: string }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const result = await invokeNodeCommand({
      nodeId: sanitizedNodeId,
      command: 'screen.stream.stop',
      payload: { streamId: payload?.streamId ?? '' },
      timeoutMs: 10_000,
    });
    return result;
  });

  // Mobile nodes: Get latest stream chunk
  handle('nodes:stream:latest', async (_event: IpcMainInvokeEvent, payload: { nodeId: string; kind: 'mic' | 'screen' }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const kind = payload.kind === 'screen' ? 'screen' : 'mic';
    const latest = getLatestNodeStreamChunk(sanitizedNodeId, kind);
    return { latest };
  });

  // Mobile nodes: camera runtime status
  handle('nodes:camera:status', async (_event: IpcMainInvokeEvent, payload: { nodeId: string }) => {
    if (!getMobileNodesEnabled()) {
      throw new Error('Mobile nodes are disabled.');
    }
    if (!payload || typeof payload.nodeId !== 'string') {
      throw new Error('nodeId is required');
    }
    const sanitizedNodeId = sanitizeString(payload.nodeId, 'nodeId', 128);
    const state = getNodeCameraActive(sanitizedNodeId);
    return { active: state?.cameraActive ?? false, updatedAtMs: state?.updatedAtMs ?? null };
  });

  // Gateway: Get config + status
  handle('gateway:get', async () => {
    return {
      config: getGatewayConfig(),
      status: await getGatewayRuntimeStatus(),
    };
  });

  // Gateway: Update config
  handle('gateway:set-config', async (_event: IpcMainInvokeEvent, config: GatewayConfig) => {
    const validated = validateGatewayConfig(config);
    const updated = setGatewayConfig(validated);
    await refreshGatewayRuntimeConfig();
    return updated;
  });

  // Gateway: Store access token
  handle('gateway:set-token', async (_event: IpcMainInvokeEvent, token: string) => {
    const sanitized = sanitizeString(token, 'gatewayToken', 256);
    await storeGatewayToken(sanitized);
    await refreshGatewayRuntimeConfig();
    return { tokenSet: true };
  });

  // Gateway: Clear access token
  handle('gateway:clear-token', async () => {
    await deleteGatewayToken();
    await refreshGatewayRuntimeConfig();
    return { tokenSet: false };
  });

  // Gateway: Generate access token
  handle('gateway:generate-token', async () => {
    const token = randomBytes(32).toString('base64url');
    await storeGatewayToken(token);
    await refreshGatewayRuntimeConfig();
    return { token, tokenSet: true };
  });

  // Gateway: Store password
  handle('gateway:set-password', async (_event: IpcMainInvokeEvent, password: string) => {
    const sanitized = sanitizeString(password, 'gatewayPassword', 256);
    await storeGatewayPassword(sanitized);
    await refreshGatewayRuntimeConfig();
    return { passwordSet: true };
  });

  // Gateway: Clear password
  handle('gateway:clear-password', async () => {
    await deleteGatewayPassword();
    await refreshGatewayRuntimeConfig();
    return { passwordSet: false };
  });

  // Gateway: Generate password
  handle('gateway:generate-password', async () => {
    const password = randomBytes(24).toString('base64url');
    await storeGatewayPassword(password);
    await refreshGatewayRuntimeConfig();
    return { password, passwordSet: true };
  });

  // Gateway: Route bindings
  handle('gateway:bindings:list', async () => {
    return listGatewayBindings();
  });

  handle('gateway:bindings:set', async (_event: IpcMainInvokeEvent, bindings: GatewayRouteBinding[]) => {
    if (!Array.isArray(bindings)) {
      throw new Error('bindings must be an array');
    }
    return setGatewayBindings(bindings);
  });

  handle('gateway:bindings:upsert', async (_event: IpcMainInvokeEvent, binding: GatewayRouteBinding) => {
    if (!binding || typeof binding !== 'object') {
      throw new Error('binding is required');
    }
    return upsertGatewayBinding(binding);
  });

  handle('gateway:bindings:remove', async (_event: IpcMainInvokeEvent, bindingId: string) => {
    const id = sanitizeString(bindingId, 'bindingId', 128);
    const removed = removeGatewayBinding(id);
    return { ok: removed };
  });

  // Gateway: Session registry
  handle('gateway:sessions:list', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    const sanitizedAgentId = agentId ? sanitizeString(agentId, 'agentId', 128) : undefined;
    return listGatewaySessions(sanitizedAgentId);
  });

  handle('gateway:sessions:get', async (_event: IpcMainInvokeEvent, sessionKey: string) => {
    const key = sanitizeString(sessionKey, 'sessionKey', 512).toLowerCase();
    return getGatewaySession(key) ?? null;
  });

  handle('gateway:sessions:delete', async (_event: IpcMainInvokeEvent, sessionKey: string) => {
    const key = sanitizeString(sessionKey, 'sessionKey', 512).toLowerCase();
    return { ok: deleteGatewaySession(key) };
  });

  // Gateway: Agent run registry
  handle('gateway:runs:list', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    const sanitizedAgentId = agentId ? sanitizeString(agentId, 'agentId', 128) : undefined;
    return listGatewayRunStatuses(sanitizedAgentId);
  });

  handle('gateway:runs:get', async (_event: IpcMainInvokeEvent, runId: string) => {
    const sanitizedRunId = sanitizeString(runId, 'runId', 128);
    return getGatewayRunStatus(sanitizedRunId) ?? null;
  });

  // Gateway connector extensions (Clawdbot-style channel adapters)
  handle('gateway-connectors:list', async () => {
    const definitions = listGatewayConnectorExtensionDefinitions();
    const configs = listGatewayConnectorExtensionConfigs().map(mergeGatewayConnectorConfigWithNativeConnector);
    for (const mergedConfig of configs) {
      syncGatewayConnectorBinding(mergedConfig);
    }
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition] as const));
    const states: GatewayConnectorExtensionState[] = await Promise.all(
      configs.map(async (config) => ({
        definition: definitionById.get(config.id) ?? {
          id: config.id,
          channel: config.id,
          name: config.id,
          description: '',
          requiresExternalBridge: false,
        },
        config,
        secretSet: await getGatewayConnectorSecretSet(config.id, config.instanceId),
        bindingId: getGatewayConnectorBindingId(config.id, config.instanceId),
        runtimeKey: getGatewayConnectorRuntimeKey(config.id, config.instanceId),
      }))
    );
    return states;
  });

  handle(
    'gateway-connectors:create-instance',
    async (_event: IpcMainInvokeEvent, connectorId: string, name?: string) => {
      const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
      const sanitizedName = name !== undefined
        ? sanitizeOptionalText(name, 'name', 64)
        : undefined;
      const created = createGatewayConnectorExtensionInstance(sanitizedId, sanitizedName);
      syncGatewayConnectorBinding(created);
      const secretSet = await getGatewayConnectorSecretSet(created.id, created.instanceId);
      const definition = listGatewayConnectorExtensionDefinitions().find((entry) => entry.id === created.id);
      return {
        state: {
          definition: definition ?? {
            id: created.id,
            channel: created.id,
            name: created.id,
            description: '',
            requiresExternalBridge: false,
          },
          config: created,
          secretSet,
          bindingId: getGatewayConnectorBindingId(created.id, created.instanceId),
          runtimeKey: getGatewayConnectorRuntimeKey(created.id, created.instanceId),
        } as GatewayConnectorExtensionState,
      };
    }
  );

  handle(
    'gateway-connectors:delete-instance',
    async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
      const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
      const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
      const removed = deleteGatewayConnectorExtensionInstance(sanitizedId, sanitizedInstanceId);
      const bindingId = getGatewayConnectorBindingId(sanitizedId, sanitizedInstanceId);
      removeGatewayBinding(bindingId);
      await restartGatewayConnectorRuntime(sanitizedId, sanitizedInstanceId);
      if (!removed) return { ok: false };
      return { ok: true };
    }
  );

  handle(
    'gateway-connectors:set-config',
    async (_event: IpcMainInvokeEvent, config: GatewayConnectorExtensionConfigInput) => {
      const sanitized = sanitizeGatewayConnectorExtensionConfigInput(config);
      let nativeEnabled = sanitized.enabled;
      let nativeAgentId = sanitized.agentId;
      if (sanitized.id === 'discord' && sanitized.instanceId === 'default') {
        const current = getDiscordConfig();
        const updated = setDiscordConfig({
          ...current,
          enabled: sanitized.enabled ?? current.enabled,
          agentId:
            sanitized.agentId !== undefined
              ? (sanitized.agentId.trim() || undefined)
              : current.agentId,
        });
        nativeEnabled = updated.enabled;
        nativeAgentId = updated.agentId;
      } else if (sanitized.id === 'telegram' && sanitized.instanceId === 'default') {
        const current = getTelegramConfig();
        const updated = setTelegramConfig({
          ...current,
          enabled: sanitized.enabled ?? current.enabled,
          agentId:
            sanitized.agentId !== undefined
              ? (sanitized.agentId.trim() || undefined)
              : current.agentId,
        });
        nativeEnabled = updated.enabled;
        nativeAgentId = updated.agentId;
      }
      const saved = setGatewayConnectorExtensionConfig({
        ...sanitized,
        enabled: nativeEnabled,
        agentId: nativeAgentId,
      });
      const mergedSaved = mergeGatewayConnectorConfigWithNativeConnector(saved);
      syncGatewayConnectorBinding(mergedSaved);
      await restartGatewayConnectorRuntime(mergedSaved.id, mergedSaved.instanceId);
      const secretSet = await getGatewayConnectorSecretSet(mergedSaved.id, mergedSaved.instanceId);
      return {
        config: mergedSaved,
        secretSet,
        bindingId: getGatewayConnectorBindingId(mergedSaved.id, mergedSaved.instanceId),
        runtimeKey: getGatewayConnectorRuntimeKey(mergedSaved.id, mergedSaved.instanceId),
      };
    }
  );

  handle(
    'gateway-connectors:set-secret',
    async (_event: IpcMainInvokeEvent, connectorId: string, secret: string, instanceId?: string) => {
      const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
      const sanitizedSecret = sanitizeString(secret, 'connectorSecret', 512);
      const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
      const runtimeKey = getGatewayConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
      if (sanitizedId === 'discord' && sanitizedInstanceId === 'default') {
        await storeDiscordToken(sanitizedSecret);
      } else if (sanitizedId === 'telegram' && sanitizedInstanceId === 'default') {
        await storeTelegramToken(sanitizedSecret);
      }
      await storeGatewayConnectorSecret(runtimeKey, sanitizedSecret);
      await restartGatewayConnectorRuntime(sanitizedId, sanitizedInstanceId);
      return { secretSet: true };
    }
  );

  handle('gateway-connectors:clear-secret', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
    const runtimeKey = getGatewayConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
    if (sanitizedId === 'discord' && sanitizedInstanceId === 'default') {
      await deleteDiscordToken();
    } else if (sanitizedId === 'telegram' && sanitizedInstanceId === 'default') {
      await deleteTelegramToken();
    }
    await deleteGatewayConnectorSecret(runtimeKey);
    await restartGatewayConnectorRuntime(sanitizedId, sanitizedInstanceId);
    return { secretSet: false };
  });

  handle('gateway-connectors:generate-secret', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
    if (isNativeGatewayConnector(sanitizedId)) {
      throw new Error('Generate secret is not supported for native connectors. Paste the bot token.');
    }
    const secret = randomBytes(24).toString('base64url');
    await storeGatewayConnectorSecret(getGatewayConnectorRuntimeKey(sanitizedId, sanitizedInstanceId), secret);
    await restartGatewayConnectorRuntime(sanitizedId, sanitizedInstanceId);
    return { secret, secretSet: true };
  });

  handle('gateway-connectors:runtime:list', async () => {
    return listGatewayConnectorRuntimeStatuses();
  });

  handle('gateway-connectors:runtime:restart', async (_event: IpcMainInvokeEvent, connectorId?: string, instanceId?: string) => {
    const trimmed = typeof connectorId === 'string' ? connectorId.trim() : '';
    if (trimmed) {
      const sanitizedId = sanitizeGatewayConnectorExtensionId(trimmed);
      const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
      await restartGatewayConnectorRuntime(sanitizedId, sanitizedInstanceId);
      return { ok: true };
    }
    await restartGatewayConnectorRuntime();
    return { ok: true };
  });

  handle('gateway-connectors:runtime:test', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
    return testGatewayConnectorRuntime(sanitizedId, sanitizedInstanceId);
  });

  handle('gateway-connectors:runtime:discover', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeGatewayConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
    return discoverGatewayConnectorRuntimeTargets(sanitizedId, sanitizedInstanceId);
  });

  handle('gateway-connectors:discovery:list', async () => {
    return listGatewayConnectorDiscovery();
  });

  handle('gateway-connectors:discovery:clear', async (_event: IpcMainInvokeEvent, connectorId?: string, instanceId?: string) => {
    const trimmed = typeof connectorId === 'string' ? connectorId.trim() : '';
    if (trimmed) {
      const sanitizedId = sanitizeGatewayConnectorExtensionId(trimmed);
      const sanitizedInstanceId = sanitizeGatewayConnectorInstanceId(instanceId, 'instanceId');
      clearGatewayConnectorDiscovery(sanitizedId, sanitizedInstanceId);
    } else {
      clearGatewayConnectorDiscovery();
    }
    return { ok: true };
  });

  // App connector extensions (Notion/GitHub/Google/etc.)
  handle('app-connectors:list', async () => {
    const definitions = listAppConnectorExtensionDefinitions();
    const configs = listAppConnectorExtensionConfigs();
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition] as const));
    const states: AppConnectorExtensionState[] = await Promise.all(
      configs.map(async (config) => {
        const runtimeKey = getAppConnectorRuntimeKey(config.id, config.instanceId);
        return {
          definition: definitionById.get(config.id) ?? {
            id: config.id,
            name: config.id,
            description: '',
            authMethod: 'token',
            docsUrl: '',
          },
          config,
          secretSet: await hasAppConnectorSecret(runtimeKey),
          runtimeKey,
        };
      })
    );
    return states;
  });

  handle(
    'app-connectors:create-instance',
    async (_event: IpcMainInvokeEvent, connectorId: string, name?: string) => {
      const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
      const sanitizedName = name !== undefined
        ? sanitizeOptionalText(name, 'name', 64)
        : undefined;
      const created = createAppConnectorExtensionInstance(sanitizedId, sanitizedName);
      const definition = listAppConnectorExtensionDefinitions().find((entry) => entry.id === created.id);
      const runtimeKey = getAppConnectorRuntimeKey(created.id, created.instanceId);
      return {
        state: {
          definition: definition ?? {
            id: created.id,
            name: created.id,
            description: '',
            authMethod: 'token',
            docsUrl: '',
          },
          config: created,
          secretSet: await hasAppConnectorSecret(runtimeKey),
          runtimeKey,
        } as AppConnectorExtensionState,
      };
    }
  );

  handle(
    'app-connectors:delete-instance',
    async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
      const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
      const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
      const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
      const removed = deleteAppConnectorExtensionInstance(sanitizedId, sanitizedInstanceId);
      await deleteAppConnectorSecret(runtimeKey);
      await deleteAppConnectorOAuthClientSecret(runtimeKey);
      return { ok: removed };
    }
  );

  handle(
    'app-connectors:set-config',
    async (_event: IpcMainInvokeEvent, config: AppConnectorExtensionConfigInput) => {
      const sanitized = sanitizeAppConnectorExtensionConfigInput(config);
      const saved = setAppConnectorExtensionConfig(sanitized);
      const runtimeKey = getAppConnectorRuntimeKey(saved.id, saved.instanceId);
      return {
        config: saved,
        secretSet: await hasAppConnectorSecret(runtimeKey),
        runtimeKey,
      };
    }
  );

  handle(
    'app-connectors:set-secret',
    async (_event: IpcMainInvokeEvent, connectorId: string, secret: string, instanceId?: string) => {
      const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
      const sanitizedSecret = sanitizeString(secret, 'connectorSecret', 2048);
      const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
      const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
      await storeAppConnectorSecret(runtimeKey, sanitizedSecret);
      return { secretSet: true };
    }
  );

  handle('app-connectors:clear-secret', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
    const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
    await deleteAppConnectorSecret(runtimeKey);
    return { secretSet: false };
  });

  handle('app-connectors:generate-secret', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
    const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
    const secret = randomBytes(32).toString('base64url');
    await storeAppConnectorSecret(runtimeKey, secret);
    return { secret, secretSet: true };
  });

  handle('app-connectors:get-secret-status', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
    const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
    return { secretSet: await hasAppConnectorSecret(runtimeKey) };
  });

  handle(
    'app-connectors:oauth:set-client-secret',
    async (_event: IpcMainInvokeEvent, connectorId: string, clientSecret: string, instanceId?: string) => {
      const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
      const sanitizedSecret = sanitizeOptionalText(clientSecret, 'clientSecret', 2048).trim();
      const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
      const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
      if (!sanitizedSecret) {
        await deleteAppConnectorOAuthClientSecret(runtimeKey);
        return { secretSet: false };
      }
      await storeAppConnectorOAuthClientSecret(runtimeKey, sanitizedSecret);
      return { secretSet: true };
    }
  );

  handle(
    'app-connectors:oauth:clear-client-secret',
    async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
      const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
      const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
      const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
      await deleteAppConnectorOAuthClientSecret(runtimeKey);
      return { secretSet: false };
    }
  );

  handle(
    'app-connectors:oauth:get-client-secret-status',
    async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
      const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
      const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
      const runtimeKey = getAppConnectorRuntimeKey(sanitizedId, sanitizedInstanceId);
      return { secretSet: await hasAppConnectorOAuthClientSecret(runtimeKey) };
    }
  );

  handle('app-connectors:runtime:list', async () => {
    return listAppConnectorRuntimeStatuses();
  });

  handle('app-connectors:runtime:test', async (_event: IpcMainInvokeEvent, connectorId: string, instanceId?: string) => {
    const sanitizedId = sanitizeAppConnectorExtensionId(connectorId);
    const sanitizedInstanceId = sanitizeAppConnectorInstanceId(instanceId, 'instanceId');
    return testAppConnectorRuntime(sanitizedId, sanitizedInstanceId);
  });

  handle('app-connectors:execute', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload is required');
    }
    const input = payload as {
      connectorId?: unknown;
      connectorInstanceId?: unknown;
      action?: unknown;
      args?: unknown;
    };
    const connectorId = sanitizeAppConnectorExtensionId(input.connectorId, 'payload.connectorId');
    const connectorInstanceId = input.connectorInstanceId === undefined
      ? undefined
      : sanitizeAppConnectorInstanceId(input.connectorInstanceId, 'payload.connectorInstanceId');
    const action = sanitizeString(input.action, 'payload.action', 96).toLowerCase();
    const args = input.args && typeof input.args === 'object' && !Array.isArray(input.args)
      ? input.args as Record<string, unknown>
      : undefined;
    return executeAppConnectorAction({
      connectorId,
      connectorInstanceId,
      action,
      args,
    });
  });

  handle('app-connectors:oauth:start', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload is required');
    }
    const input = payload as {
      connectorId?: unknown;
      connectorInstanceId?: unknown;
      clientId?: unknown;
      clientSecret?: unknown;
      scopes?: unknown;
      redirectMode?: unknown;
      redirectUri?: unknown;
    };
    const connectorId = sanitizeAppConnectorExtensionId(input.connectorId, 'payload.connectorId');
    const connectorInstanceId = input.connectorInstanceId === undefined
      ? undefined
      : sanitizeAppConnectorInstanceId(input.connectorInstanceId, 'payload.connectorInstanceId');
    const clientId = sanitizeString(input.clientId, 'payload.clientId', 512);
    const clientSecret = input.clientSecret === undefined
      ? undefined
      : sanitizeOptionalText(input.clientSecret, 'payload.clientSecret', 1024).trim() || undefined;
    let scopes: string[] | string | undefined;
    if (typeof input.scopes === 'string') {
      scopes = sanitizeOptionalText(input.scopes, 'payload.scopes', 4000);
    } else if (Array.isArray(input.scopes)) {
      scopes = input.scopes
        .map((entry) => sanitizeOptionalText(entry, 'payload.scopes[]', 512).trim())
        .filter(Boolean);
    } else if (input.scopes !== undefined && input.scopes !== null) {
      throw new Error('payload.scopes must be a string or string[]');
    }
    const redirectModeRaw = input.redirectMode === undefined
      ? ''
      : sanitizeOptionalText(input.redirectMode, 'payload.redirectMode', 32).trim().toLowerCase();
    const redirectMode = redirectModeRaw === 'desktop'
      ? 'desktop'
      : redirectModeRaw === 'loopback'
        ? 'loopback'
        : redirectModeRaw === 'public'
          ? 'public'
          : redirectModeRaw === 'auto'
            ? 'auto'
            : undefined;
    if (redirectModeRaw && !redirectMode) {
      throw new Error('payload.redirectMode must be one of auto, desktop, loopback, public');
    }
    const redirectUri = input.redirectUri === undefined
      ? undefined
      : sanitizeOptionalText(input.redirectUri, 'payload.redirectUri', 2048).trim() || undefined;
    return startAppConnectorOAuthFlow({
      connectorId,
      instanceId: connectorInstanceId,
      clientId,
      clientSecret,
      scopes,
      redirectMode,
      redirectUri,
    });
  });

  handle('app-connectors:oauth:status', async (_event: IpcMainInvokeEvent, flowId: string) => {
    const sanitizedFlowId = sanitizeString(flowId, 'flowId', 128);
    return getAppConnectorOAuthFlowStatus(sanitizedFlowId);
  });

  handle('app-connectors:oauth:disconnect', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload is required');
    }
    const input = payload as {
      connectorId?: unknown;
      connectorInstanceId?: unknown;
      remoteRevoke?: unknown;
    };
    const connectorId = sanitizeAppConnectorExtensionId(input.connectorId, 'payload.connectorId');
    const connectorInstanceId = input.connectorInstanceId === undefined
      ? undefined
      : sanitizeAppConnectorInstanceId(input.connectorInstanceId, 'payload.connectorInstanceId');
    const remoteRevoke = input.remoteRevoke === undefined
      ? true
      : Boolean(input.remoteRevoke);
    return disconnectAppConnectorOAuth({
      connectorId,
      instanceId: connectorInstanceId,
      remoteRevoke,
    });
  });

  handle('app-connectors:oauth:handle-callback', async (_event: IpcMainInvokeEvent, callbackUrl: string) => {
    const url = sanitizeString(callbackUrl, 'callbackUrl', 4096);
    return handleAppConnectorOAuthCallback(url);
  });

  // Automations: List schedules
  handle('schedules:list', async () => {
    const activeAgentId = resolveActiveAgentId();
    return listSchedules().filter((schedule) => schedule.agentId === activeAgentId);
  });

  // Automations: Create or update schedule
  handle('schedules:upsert', async (_event: IpcMainInvokeEvent, config: ScheduleConfig, scheduleId?: string) => {
    const validated = validateScheduleConfig({
      ...config,
      agentId: config.agentId || resolveActiveAgentId(),
    });
    const sanitizedId = scheduleId ? sanitizeString(scheduleId, 'scheduleId', 128) : undefined;
    return upsertSchedule(validated, sanitizedId);
  });

  // Automations: Delete schedule
  handle('schedules:delete', async (_event: IpcMainInvokeEvent, scheduleId: string) => {
    const sanitizedId = sanitizeString(scheduleId, 'scheduleId', 128);
    removeSchedule(sanitizedId);
  });

  // Automations: Toggle schedule
  handle('schedules:toggle', async (_event: IpcMainInvokeEvent, scheduleId: string, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    const sanitizedId = sanitizeString(scheduleId, 'scheduleId', 128);
    return toggleSchedule(sanitizedId, enabled);
  });

  // Automations: Run schedule immediately
  handle('schedules:run', async (_event: IpcMainInvokeEvent, scheduleId: string) => {
    const sanitizedId = sanitizeString(scheduleId, 'scheduleId', 128);
    runScheduleNow(sanitizedId);
  });

  // Automations: Info (webhook URL)
  handle('automation:info', async () => {
    const runtime = await getGatewayRuntimeStatus();
    return {
      webhookUrl: getWebhookLocalUrl(),
      localUrl: getWebhookLocalUrl(),
      lanUrls: getWebhookLanUrls(),
      publicUrl: runtime.tailscaleUrl ?? null,
      bindMode: getWebhookBindMode(),
      port: WEBHOOK_PORT,
    };
  });

  // Skills: List skill status
  handle('skills:list', async () => {
    return listSkillsStatus();
  });

  // Skills: Install a specific skill
  handle('skills:install', async (_event: IpcMainInvokeEvent, skillId: string) => {
    if (!skillId || typeof skillId !== 'string') {
      throw new Error('Invalid skill id');
    }
    return installSkill(skillId);
  });

  // Skills: Uninstall a specific skill (removes node_modules only)
  handle('skills:uninstall', async (_event: IpcMainInvokeEvent, skillId: string) => {
    if (!skillId || typeof skillId !== 'string') {
      throw new Error('Invalid skill id');
    }
    return uninstallSkill(skillId);
  });

  // Skills: Install all skills
  handle('skills:install-all', async () => {
    return installAllSkills();
  });

  // User Skills: list/create/read/write (OpenDeskmate-style markdown skills)
  handle('user-skills:list', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    return listUserSkills({ agentId });
  });

  handle('user-skills:create', async (_event: IpcMainInvokeEvent, req: { skillId?: string; name?: string; description?: string }) => {
    return createUserSkill(req);
  });

  handle('user-skills:read-file', async (_event: IpcMainInvokeEvent, req: { skillId: string; relPath: string; source?: string; agentId?: string }) => {
    return readUserSkillFile(req as any);
  });

  handle('user-skills:write-file', async (_event: IpcMainInvokeEvent, req: { skillId: string; relPath: string; content: string; source?: string; agentId?: string }) => {
    return writeUserSkillFile(req as any);
  });

  handle('user-skills:delete', async (_event: IpcMainInvokeEvent, req: { skillId: string; source?: string; agentId?: string }) => {
    return deleteUserSkill(req as any);
  });

  handle('user-skills:lifecycle:set', async (_event: IpcMainInvokeEvent, req: { skillId: string; state: 'active' | 'deprecated' | 'disabled'; reason?: string; source?: string; agentId?: string }) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request');
    const skillId = sanitizeString(req.skillId, 'skillId', 64);
    const stateRaw = sanitizeString(req.state, 'state', 24).toLowerCase();
    const state = stateRaw === 'deprecated' || stateRaw === 'disabled' ? stateRaw : 'active';
    const reason = req.reason ? sanitizeOptionalText(req.reason, 'reason', 500) : undefined;
    return setUserSkillLifecycle({
      skillId,
      state,
      reason,
      source: req.source as any,
      agentId: req.agentId ? sanitizeOptionalText(req.agentId, 'agentId', 128) || undefined : undefined,
    });
  });

  handle('user-skills:sharing:set', async (_event: IpcMainInvokeEvent, req: { skillId: string; scope: 'private' | 'selected' | 'all'; sharedWithAgentIds?: string[]; source?: string; agentId?: string }) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request');
    const skillId = sanitizeString(req.skillId, 'skillId', 64);
    const scopeRaw = sanitizeString(req.scope, 'scope', 24).toLowerCase();
    const scope = scopeRaw === 'selected' || scopeRaw === 'all' ? scopeRaw : 'private';
    const sharedWithAgentIds = Array.isArray(req.sharedWithAgentIds)
      ? req.sharedWithAgentIds
        .filter((value): value is string => typeof value === 'string')
        .map((value) => sanitizeOptionalText(value, 'sharedWithAgentIds[]', 64).trim())
        .filter(Boolean)
      : [];
    return setUserSkillSharing({
      skillId,
      scope,
      sharedWithAgentIds,
      source: req.source as any,
      agentId: req.agentId ? sanitizeOptionalText(req.agentId, 'agentId', 128) || undefined : undefined,
    });
  });

  handle('user-skills:tests:run', async (_event: IpcMainInvokeEvent, req: { skillId: string; source?: string; agentId?: string }) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request');
    const skillId = sanitizeString(req.skillId, 'skillId', 64);
    return runUserSkillTests({
      skillId,
      source: req.source as any,
      agentId: req.agentId ? sanitizeOptionalText(req.agentId, 'agentId', 128) || undefined : undefined,
    });
  });

  handle('user-skills:rollback', async (_event: IpcMainInvokeEvent, req: { skillId: string; targetVersion?: string; source?: string; agentId?: string }) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request');
    const skillId = sanitizeString(req.skillId, 'skillId', 64);
    const targetVersion = req.targetVersion ? sanitizeOptionalText(req.targetVersion, 'targetVersion', 32) || undefined : undefined;
    return rollbackUserSkill({
      skillId,
      targetVersion,
      source: req.source as any,
      agentId: req.agentId ? sanitizeOptionalText(req.agentId, 'agentId', 128) || undefined : undefined,
    });
  });

  handle('user-skills:performance:record', async (_event: IpcMainInvokeEvent, req: { skillId: string; success: boolean; latencyMs?: number; inputTokens?: number; outputTokens?: number; error?: string; source?: string; agentId?: string }) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request');
    const skillId = sanitizeString(req.skillId, 'skillId', 64);
    return recordUserSkillPerformance({
      skillId,
      success: Boolean(req.success),
      latencyMs: Number.isFinite(Number(req.latencyMs)) ? Number(req.latencyMs) : undefined,
      inputTokens: Number.isFinite(Number(req.inputTokens)) ? Number(req.inputTokens) : undefined,
      outputTokens: Number.isFinite(Number(req.outputTokens)) ? Number(req.outputTokens) : undefined,
      error: req.error ? sanitizeOptionalText(req.error, 'error', 500) || undefined : undefined,
      source: req.source as any,
      agentId: req.agentId ? sanitizeOptionalText(req.agentId, 'agentId', 128) || undefined : undefined,
    });
  });

  handle('user-skills:deps-status', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    return buildUserSkillDependencyStatusReport({ agentId });
  });

  handle('user-skills:install-dep', async (_event: IpcMainInvokeEvent, req: { skillId: string; installId: string; source?: string; agentId?: string }) => {
    return installUserSkillDependency(req as any);
  });

  handle('user-skills:config:get', async (_event: IpcMainInvokeEvent, req: { skillKey: string }) => {
    const skillKey = sanitizeString(req?.skillKey, 'skillKey', 256);
    return { skillKey, config: getUserSkillConfig(skillKey) };
  });

  handle('user-skills:config:set', async (_event: IpcMainInvokeEvent, req: { skillKey: string; config: unknown }) => {
    const skillKey = sanitizeString(req?.skillKey, 'skillKey', 256);
    let config: Record<string, unknown> = {};
    if (req?.config !== undefined && req?.config !== null) {
      if (typeof req.config !== 'object' || Array.isArray(req.config)) {
        throw new Error('config must be a JSON object');
      }
      config = req.config as Record<string, unknown>;
    }
    return { skillKey, config: setUserSkillConfig(skillKey, config) };
  });

  handle(
    'user-skills:assistant:ask',
    async (
      _event: IpcMainInvokeEvent,
      req: {
        question: string;
        skillId?: string;
        source?: string;
        skillKey?: string;
        mode?: 'general' | 'configure' | 'edit';
        agentId?: string;
        draftContent?: string;
      }
    ) => {
      const question = sanitizeString(req?.question, 'question', 8000);
      const modeRaw = sanitizeOptionalText(req?.mode, 'mode', 32).trim().toLowerCase();
      const mode = modeRaw === 'configure' || modeRaw === 'edit' ? modeRaw : 'general';
      const sourceRaw = sanitizeOptionalText(req?.source, 'source', 32).trim().toLowerCase();
      const source = (
        sourceRaw === 'managed'
        || sourceRaw === 'workspace'
        || sourceRaw === 'bundled'
        || sourceRaw === 'extra'
      ) ? sourceRaw : undefined;
      return askUserSkillAssistant({
        question,
        skillId: sanitizeOptionalText(req?.skillId, 'skillId', 128) || undefined,
        source,
        skillKey: sanitizeOptionalText(req?.skillKey, 'skillKey', 256) || undefined,
        mode,
        agentId: sanitizeOptionalText(req?.agentId, 'agentId', 128) || undefined,
        draftContent: sanitizeOptionalText(req?.draftContent, 'draftContent', 20000) || undefined,
      });
    }
  );

  handle('user-skills:zip:inspect', async (_event: IpcMainInvokeEvent, req: unknown) => {
    return inspectUserSkillZip(req as any);
  });

  handle('user-skills:zip:install', async (_event: IpcMainInvokeEvent, req: unknown) => {
    return installUserSkillFromZip(req as any);
  });

  handle('user-skills:zip:cleanup', async (_event: IpcMainInvokeEvent, req: { sessionId: string }) => {
    return cleanupUserSkillZipSession(req as any);
  });

  // Onboarding: Get onboarding complete status
  // Also checks for existing task history to handle upgrades from pre-onboarding versions
  handle('onboarding:complete', async (_event: IpcMainInvokeEvent) => {
    // E2E test bypass: skip onboarding when E2E skip auth is enabled
    if (isE2ESkipAuthEnabled()) {
      return true;
    }

    // If onboarding is already marked complete, return true
    if (getOnboardingComplete()) {
      return true;
    }

    // Check if this is an existing user (has task history)
    // If so, mark onboarding as complete and skip the wizard
    const tasks = getTasks();
    if (tasks.length > 0) {
      setOnboardingComplete(true);
      return true;
    }

    return false;
  });

  // Onboarding: Set onboarding complete status
  handle('onboarding:set-complete', async (_event: IpcMainInvokeEvent, complete: boolean) => {
    setOnboardingComplete(complete);
  });

  // Dialog: Select folder
  handle('dialog:select-folder', async (event: IpcMainInvokeEvent, payload?: { defaultPath?: unknown }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No window found');
    }
    const defaultPath = sanitizeOptionalText(payload?.defaultPath, 'defaultPath', 1024).trim() || undefined;

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Working Folder',
      defaultPath,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Dialog: Select files
  handle('dialog:select-files', async (event: IpcMainInvokeEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No window found');
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: 'Add Files',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return result.filePaths;
  });

  // Shell: Open URL in external browser
  // Only allows http/https URLs for security
  handle('shell:open-external', async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http and https URLs are allowed');
      }
      await shell.openExternal(url);
    } catch (error) {
      console.error('Failed to open external URL:', error);
      throw error;
    }
  });

  // Help docs: List docs from writable help folder.
  handle('help-docs:list', async () => {
    return listHelpDocs();
  });

  // Help docs: Read markdown content for a selected help page.
  handle('help-docs:read', async (_event: IpcMainInvokeEvent, docId: string) => {
    const normalizedDocId = sanitizeOptionalText(docId, 'docId', 128).trim().toLowerCase();
    if (!normalizedDocId) throw new Error('docId is required');
    return readHelpDoc(normalizedDocId);
  });

  // Help docs: Search docs by title/body text.
  handle('help-docs:search', async (_event: IpcMainInvokeEvent, query: string) => {
    const normalizedQuery = sanitizeOptionalText(query, 'query', 300);
    return searchHelpDocs(normalizedQuery);
  });

  // Help docs: Resolve an image/asset to a safe data URL for renderer markdown.
  handle('help-docs:asset-data-url', async (
    _event: IpcMainInvokeEvent,
    payload: { docId?: string; assetPath?: string }
  ) => {
    const docId = sanitizeOptionalText(payload?.docId, 'docId', 128).trim().toLowerCase();
    const assetPath = sanitizeOptionalText(payload?.assetPath, 'assetPath', 1024).trim();
    if (!docId) throw new Error('docId is required');
    if (!assetPath) throw new Error('assetPath is required');
    return getHelpAssetDataUrl(docId, assetPath);
  });

  // Help docs: Open current page in external editor.
  handle('help-docs:open-in-editor', async (_event: IpcMainInvokeEvent, docId: string) => {
    const normalizedDocId = sanitizeOptionalText(docId, 'docId', 128).trim().toLowerCase();
    if (!normalizedDocId) throw new Error('docId is required');
    return openHelpDocInEditor(normalizedDocId);
  });

  // Help docs: Open writable docs folder in system file explorer.
  handle('help-docs:open-folder', async () => {
    return openHelpDocsFolder();
  });

  // Help docs: Open a linked non-markdown asset with OS default app.
  handle('help-docs:open-asset', async (
    _event: IpcMainInvokeEvent,
    payload: { docId?: string; assetPath?: string }
  ) => {
    const docId = sanitizeOptionalText(payload?.docId, 'docId', 128).trim().toLowerCase();
    const assetPath = sanitizeOptionalText(payload?.assetPath, 'assetPath', 1024).trim();
    if (!docId) throw new Error('docId is required');
    if (!assetPath) throw new Error('assetPath is required');
    return openHelpAssetExternally(docId, assetPath);
  });

  // ========== BUILD MODE HANDLERS ==========
  handle('build-mode:project:detect', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    return buildDevProcessManager.getSnapshot(agentId, workspaceRelativePath);
  });

  handle('build-mode:runtime:get', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    return buildDevProcessManager.getSnapshot(agentId, workspaceRelativePath);
  });

  handle('build-mode:runtime:start', async (_event: IpcMainInvokeEvent, payload: BuildStartRequest) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const mode = payload?.mode === 'run' ? 'run' : 'dev';
    const commandOverride = sanitizeOptionalText(payload?.commandOverride, 'commandOverride', 500);
    const autoRestart = payload?.autoRestart !== false;
    const forceRestart = payload?.forceRestart === true;
    const envOverrides = normalizeEnvOverrides(payload?.envOverrides);
    const portHint = typeof payload?.portHint === 'number' && Number.isFinite(payload.portHint)
      ? Math.max(1024, Math.min(65535, Math.floor(payload.portHint)))
      : undefined;

    return buildDevProcessManager.startDevelopmentProcess({
      agentId,
      workspaceRelativePath,
      mode,
      commandOverride: commandOverride || undefined,
      envOverrides,
      autoRestart,
      forceRestart,
      portHint,
    });
  });

  handle('build-mode:runtime:stop', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    return buildDevProcessManager.stopProcess(agentId);
  });

  handle('build-mode:runtime:restart', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    return buildDevProcessManager.restartProcess(agentId);
  });

  handle('build-mode:runtime:run-build', async (_event: IpcMainInvokeEvent, payload: BuildBuildRequest) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const commandOverride = sanitizeOptionalText(payload?.commandOverride, 'commandOverride', 500);
    const envOverrides = normalizeEnvOverrides(payload?.envOverrides);
    return buildDevProcessManager.runBuildCommand({
      agentId,
      workspaceRelativePath,
      commandOverride: commandOverride || undefined,
      envOverrides,
    });
  });

  handle('build-mode:runtime:run-once', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; workspaceRelativePath?: unknown; envOverrides?: unknown; commandOverride?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const envOverrides = normalizeEnvOverrides(payload?.envOverrides);
    const commandOverride = sanitizeOptionalText(payload?.commandOverride, 'commandOverride', 500) || undefined;
    return buildDevProcessManager.runStartCommandOnce(agentId, workspaceRelativePath, envOverrides, commandOverride);
  });

  handle('build-mode:runtime:logs', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; cursor?: unknown; limit?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const cursor = typeof payload?.cursor === 'number' && Number.isFinite(payload.cursor) ? payload.cursor : 0;
    const limit = typeof payload?.limit === 'number' && Number.isFinite(payload.limit) ? payload.limit : 300;
    return buildDevProcessManager.getLogs(agentId, cursor, limit);
  });

  handle('build-mode:runtime:clear-logs', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    await buildDevProcessManager.clearLogs(agentId);
    return { ok: true };
  });

  handle('build-mode:terminal:snapshot', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    return buildTerminalManager.getSnapshot(agentId);
  });

  handle('build-mode:terminal:create', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; workspaceRelativePath?: unknown; splitFromSessionId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const splitFromSessionId = sanitizeOptionalText(payload?.splitFromSessionId, 'splitFromSessionId', 120) || undefined;
    return buildTerminalManager.createSession(agentId, workspaceRelativePath, splitFromSessionId);
  });

  handle('build-mode:terminal:set-active', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    return buildTerminalManager.setActiveSession(agentId, sessionId);
  });

  handle('build-mode:terminal:output', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown; cursor?: unknown; limit?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    const cursor = typeof payload?.cursor === 'number' && Number.isFinite(payload.cursor) ? payload.cursor : 0;
    const limit = typeof payload?.limit === 'number' && Number.isFinite(payload.limit) ? payload.limit : 500;
    return buildTerminalManager.getOutput(agentId, sessionId, cursor, limit);
  });

  handle('build-mode:terminal:run', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown; command?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    const command = sanitizeString(payload?.command, 'command', 4_000);
    return buildTerminalManager.runCommand(agentId, sessionId, command);
  });

  handle('build-mode:terminal:write', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown; input?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    if (typeof payload?.input !== 'string') {
      throw new Error('input must be a string');
    }
    if (payload.input.length > 20_000) {
      throw new Error('input exceeds maximum length');
    }
    const input = payload.input;
    return buildTerminalManager.writeInput(agentId, sessionId, input);
  });

  handle('build-mode:terminal:interrupt', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    return buildTerminalManager.interruptSession(agentId, sessionId);
  });

  handle('build-mode:terminal:resize', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown; cols?: unknown; rows?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    const cols = typeof payload?.cols === 'number' && Number.isFinite(payload.cols) ? payload.cols : 120;
    const rows = typeof payload?.rows === 'number' && Number.isFinite(payload.rows) ? payload.rows : 24;
    return buildTerminalManager.resizeSession(agentId, sessionId, cols, rows);
  });

  handle('build-mode:terminal:clear', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    return buildTerminalManager.clearSession(agentId, sessionId);
  });

  handle('build-mode:terminal:close', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; sessionId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 120);
    return buildTerminalManager.closeSession(agentId, sessionId);
  });

  handle('build-mode:files:tree', async (_event: IpcMainInvokeEvent, payload: {
    agentId?: unknown;
    relativePath?: unknown;
    depth?: unknown;
    includeHidden?: unknown;
    maxEntries?: unknown;
  }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const depth = typeof payload?.depth === 'number' && Number.isFinite(payload.depth) ? payload.depth : undefined;
    const includeHidden = payload?.includeHidden === true;
    const maxEntries = typeof payload?.maxEntries === 'number' && Number.isFinite(payload.maxEntries) ? payload.maxEntries : undefined;
    return listWorkspaceTree(agentId, relativePath, { depth, includeHidden, maxEntries });
  });

  handle('build-mode:files:read', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeString(payload?.relativePath, 'relativePath', 500);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    return readWorkspaceFile(agentId, relativePath, workspaceRelativePath);
  });

  handle('build-mode:files:write', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; content?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeString(payload?.relativePath, 'relativePath', 500);
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    return writeWorkspaceFile(agentId, relativePath, content, workspaceRelativePath);
  });

  handle('build-mode:files:create-folder', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeString(payload?.relativePath, 'relativePath', 500);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    return createWorkspaceDirectory(agentId, relativePath, workspaceRelativePath);
  });

  handle('build-mode:files:create-file', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeString(payload?.relativePath, 'relativePath', 500);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    return createWorkspaceFile(agentId, relativePath, workspaceRelativePath);
  });

  handle('build-mode:files:rename', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; nextName?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeString(payload?.relativePath, 'relativePath', 500);
    const nextName = sanitizeString(payload?.nextName, 'nextName', 255);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    return renameWorkspaceEntry(agentId, relativePath, nextName, workspaceRelativePath);
  });

  handle('build-mode:files:delete', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeString(payload?.relativePath, 'relativePath', 500);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    return deleteWorkspaceEntry(agentId, relativePath, workspaceRelativePath);
  });

  handle('build-mode:files:paste', async (_event: IpcMainInvokeEvent, payload: {
    agentId?: unknown;
    sourceRelativePath?: unknown;
    destinationDirectoryRelativePath?: unknown;
    mode?: unknown;
    sourceWorkspaceRelativePath?: unknown;
    destinationWorkspaceRelativePath?: unknown;
  }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const sourceRelativePath = sanitizeString(payload?.sourceRelativePath, 'sourceRelativePath', 500);
    const destinationDirectoryRelativePath = sanitizeString(payload?.destinationDirectoryRelativePath, 'destinationDirectoryRelativePath', 500);
    const modeRaw = sanitizeString(payload?.mode, 'mode', 16).toLowerCase();
    const mode: 'cut' | 'copy' = modeRaw === 'cut' ? 'cut' : 'copy';
    const sourceWorkspaceRelativePath = sanitizeOptionalText(payload?.sourceWorkspaceRelativePath, 'sourceWorkspaceRelativePath', 400) || '.';
    const destinationWorkspaceRelativePath = sanitizeOptionalText(payload?.destinationWorkspaceRelativePath, 'destinationWorkspaceRelativePath', 400) || '.';
    return pasteWorkspaceEntry(
      agentId,
      sourceRelativePath,
      destinationDirectoryRelativePath,
      mode,
      sourceWorkspaceRelativePath,
      destinationWorkspaceRelativePath,
    );
  });

  handle('build-mode:workspace:root', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    return { workspaceRoot: resolveAgentWorkspaceRoot(agentId) };
  });

  handle('build-mode:workspace:open', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const absolutePath = resolvePathInWorkspace(agentId, relativePath);
    const result = await shell.openPath(absolutePath);
    if (result) {
      return { ok: false, path: absolutePath, error: result };
    }
    return { ok: true, path: absolutePath };
  });

  handle('build-mode:workspace:reveal', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const absolutePath = resolvePathInWorkspace(agentId, relativePath);
    const stat = await fs.promises.stat(absolutePath);

    if (stat.isDirectory()) {
      const result = await shell.openPath(absolutePath);
      if (result) {
        return { ok: false, path: absolutePath, error: result };
      }
      return { ok: true, path: absolutePath };
    }

    shell.showItemInFolder(absolutePath);
    return { ok: true, path: absolutePath };
  });

  handle('build-mode:workspace:fingerprint', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return readWorkspaceFingerprint(agentId, relativePath);
  });

  handle('build-mode:workspace:diff', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; maxChars?: unknown; baselineId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const maxChars = typeof payload?.maxChars === 'number' && Number.isFinite(payload.maxChars) ? payload.maxChars : undefined;
    const baselineId = sanitizeOptionalText(payload?.baselineId, 'baselineId', 120) || undefined;
    return readWorkspaceGitDiff(agentId, relativePath, { maxChars, baselineId });
  });

  handle('build-mode:workspace:baseline:capture', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return captureWorkspaceBaseline(agentId, relativePath);
  });

  handle(
    'build-mode:workspace:baseline:resolve',
    async (
      _event: IpcMainInvokeEvent,
      payload: { agentId?: unknown; baselineId?: unknown; decision?: unknown }
    ) => {
      const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
      const baselineId = sanitizeString(payload?.baselineId, 'baselineId', 120);
      const decisionRaw = sanitizeString(payload?.decision, 'decision', 24).toLowerCase();
      const decision: BuildWorkspaceBaselineDecision =
        decisionRaw === 'reject' ? 'reject' : 'approve';
      return resolveWorkspaceBaseline(agentId, baselineId, decision);
    }
  );

  handle('build-mode:workspace:export-zip', async (event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; suggestedName?: unknown }) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const suggestedName = sanitizeOptionalText(payload?.suggestedName, 'suggestedName', 120) || undefined;
    return exportWorkspaceZipToFile(window, agentId, relativePath, suggestedName);
  });

  handle('build-mode:presets:list', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    return listBuildModePresets(agentId);
  });

  handle('build-mode:presets:upsert', async (_event: IpcMainInvokeEvent, payload: BuildProjectPresetInput) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const name = sanitizeString(payload?.name, 'name', 120);
    const workspaceRelativePath = sanitizeString(payload?.workspaceRelativePath, 'workspaceRelativePath', 300);
    const id = sanitizeOptionalText(payload?.id, 'id', 64) || undefined;
    const activeEnvProfileId = sanitizeOptionalText(payload?.activeEnvProfileId, 'activeEnvProfileId', 64) || undefined;

    return upsertBuildModePreset({
      id,
      agentId,
      name,
      workspaceRelativePath,
      commands: payload?.commands,
      envProfiles: payload?.envProfiles,
      activeEnvProfileId,
    });
  });

  handle('build-mode:presets:delete', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; presetId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const presetId = sanitizeString(payload?.presetId, 'presetId', 64);
    return deleteBuildModePreset(agentId, presetId);
  });

  handle('build-mode:presets:set-active', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; presetId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const presetId = sanitizeOptionalText(payload?.presetId, 'presetId', 64) || null;
    return setActiveBuildModePreset(agentId, presetId);
  });

  handle('build-mode:history:list', async (_event: IpcMainInvokeEvent, payload: BuildTaskHistoryListInput) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const query = sanitizeOptionalText(payload?.query, 'query', 400) || undefined;
    const includeArchived = payload?.includeArchived === true;
    const limit = typeof payload?.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(500, Math.floor(payload.limit)))
      : undefined;
    return listBuildTaskSessions({ agentId, query, includeArchived, limit });
  });

  handle('build-mode:history:get', async (_event: IpcMainInvokeEvent, payload: { sessionId?: unknown }) => {
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 128);
    return getBuildTaskSession(sessionId);
  });

  handle('build-mode:history:create', async (_event: IpcMainInvokeEvent, payload: BuildTaskSessionCreateInput) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const title = sanitizeOptionalText(payload?.title, 'title', 120) || undefined;
    const titleSourcePrompt = sanitizeString(payload?.titleSourcePrompt, 'titleSourcePrompt', MAX_TEXT_LENGTH);
    const goalPrompt = sanitizeString(payload?.goalPrompt, 'goalPrompt', MAX_TEXT_LENGTH);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    const selectedPresetId = sanitizeOptionalText(payload?.selectedPresetId, 'selectedPresetId', 64) || null;
    return createBuildTaskSession({
      agentId,
      title,
      titleSourcePrompt,
      goalPrompt,
      workspaceRelativePath,
      selectedPresetId,
    });
  });

  handle('build-mode:history:update', async (_event: IpcMainInvokeEvent, payload: BuildTaskSessionUpdateInput) => {
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 128);
    const next: BuildTaskSessionUpdateInput = {
      ...payload,
      sessionId,
    };
    if (payload?.goalPrompt !== undefined) {
      next.goalPrompt = sanitizeOptionalText(payload.goalPrompt, 'goalPrompt', MAX_TEXT_LENGTH);
    }
    if (payload?.workspaceRelativePath !== undefined) {
      next.workspaceRelativePath = sanitizeOptionalText(payload.workspaceRelativePath, 'workspaceRelativePath', 400) || '.';
    }
    if (payload?.selectedPresetId !== undefined) {
      next.selectedPresetId = sanitizeOptionalText(payload.selectedPresetId, 'selectedPresetId', 64) || null;
    }
    if (payload?.lifecycleStatus !== undefined) {
      const lifecycleStatus = sanitizeOptionalText(payload.lifecycleStatus, 'lifecycleStatus', 32);
      if (!['active', 'completed', 'failed', 'interrupted', 'archived'].includes(lifecycleStatus)) {
        throw new Error('Invalid lifecycleStatus.');
      }
      next.lifecycleStatus = lifecycleStatus as BuildTaskSessionUpdateInput['lifecycleStatus'];
    }
    return updateBuildTaskSession(next);
  });

  handle('build-mode:history:rename', async (_event: IpcMainInvokeEvent, payload: BuildTaskSessionRenameInput) => {
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 128);
    const title = sanitizeString(payload?.title, 'title', 120);
    return renameBuildTaskSession({ sessionId, title });
  });

  handle('build-mode:history:archive', async (_event: IpcMainInvokeEvent, payload: BuildTaskSessionArchiveInput) => {
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 128);
    const archived = payload?.archived === true;
    return archiveBuildTaskSession({ sessionId, archived });
  });

  handle('build-mode:history:pin', async (_event: IpcMainInvokeEvent, payload: BuildTaskSessionPinInput) => {
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 128);
    const pinned = payload?.pinned === true;
    return setPinnedBuildTaskSession({ sessionId, pinned });
  });

  handle('build-mode:history:delete', async (_event: IpcMainInvokeEvent, payload: BuildTaskSessionDeleteInput) => {
    const sessionId = sanitizeString(payload?.sessionId, 'sessionId', 128);
    return deleteBuildTaskSession({ sessionId });
  });

  // Log event handler - now just returns ok (no external logging)
  handle(
    'log:event',
    async (_event: IpcMainInvokeEvent, _payload: { level?: string; message?: string; context?: Record<string, unknown> }) => {
      // No-op: external logging removed
      return { ok: true };
    }
  );

  // ========== FOLDER HANDLERS ==========
  // Folder: List folders for active agent
  handle('folder:list', async () => {
    return getFoldersForAgent(resolveActiveAgentId());
  });

  // Folder: Create a new folder (associated with active agent)
  handle('folder:create', async (_event: IpcMainInvokeEvent, config: FolderConfig) => {
    return createFolder(config, resolveActiveAgentId());
  });

  // Folder: Update a folder
  handle('folder:update', async (_event: IpcMainInvokeEvent, folderId: string, config: FolderUpdateConfig) => {
    return updateFolder(folderId, config);
  });

  // Folder: Delete a folder
  handle('folder:delete', async (_event: IpcMainInvokeEvent, folderId: string) => {
    deleteFolderFromStore(folderId);
    return { success: true };
  });

  // Folder: Get task-folder assignments
  handle('folder:getAssignments', async () => {
    return getTaskFolderAssignments();
  });

  // Folder: Assign task to folder
  handle('folder:assignTask', async (_event: IpcMainInvokeEvent, taskId: string, folderId: string | null) => {
    setTaskFolder(taskId, folderId);
    return { success: true };
  });
}

function createTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Extract base64 screenshots from tool output
 * Returns cleaned text (with images replaced by placeholders) and extracted attachments
 */
function extractScreenshots(output: string): {
  cleanedText: string;
  attachments: Array<{ type: 'screenshot' | 'json'; data: string; label?: string }>;
} {
  const attachments: Array<{ type: 'screenshot' | 'json'; data: string; label?: string }> = [];

  // Match data URLs (data:image/png;base64,...)
  const dataUrlRegex = /data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/g;
  let match;
  while ((match = dataUrlRegex.exec(output)) !== null) {
    attachments.push({
      type: 'screenshot',
      data: match[0],
      label: 'Browser screenshot',
    });
  }

  // Also check for raw base64 PNG (starts with iVBORw0)
  // This pattern matches PNG base64 that isn't already a data URL
  const rawBase64Regex = /(?<![;,])(?:^|["\s])?(iVBORw0[A-Za-z0-9+/=]{100,})(?:["\s]|$)/g;
  while ((match = rawBase64Regex.exec(output)) !== null) {
    const base64Data = match[1];
    // Wrap in data URL if it's valid base64 PNG
    if (base64Data && base64Data.length > 100) {
      attachments.push({
        type: 'screenshot',
        data: `data:image/png;base64,${base64Data}`,
        label: 'Browser screenshot',
      });
    }
  }

  // Clean the text - replace image data with placeholder
  let cleanedText = output
    .replace(dataUrlRegex, '[Screenshot captured]')
    .replace(rawBase64Regex, '[Screenshot captured]');

  // Also clean up common JSON wrappers around screenshots
  cleanedText = cleanedText
    .replace(/"[Screenshot captured]"/g, '"[Screenshot]"')
    .replace(/\[Screenshot captured\]\[Screenshot captured\]/g, '[Screenshot captured]');

  return { cleanedText, attachments };
}

/**
 * Sanitize tool output to remove technical details that confuse users
 */
function sanitizeToolOutput(text: string, isError: boolean): string {
  let result = text;

  // Strip any remaining ANSI escape codes
  result = result.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  // Also strip any leftover escape sequences that may have been partially matched
  result = result.replace(/\x1B\[2m|\x1B\[22m|\x1B\[0m/g, '');

  // Try to extract meaningful content from JSON responses (common with MCP tools)
  // Look for common result fields like "title", "result", "output", "content", "text"
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Extract meaningful fields from MCP/dev-browser responses
      if (parsed.title) {
        return `Title: ${parsed.title}`;
      }
      if (parsed.result) {
        return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
      }
      if (parsed.output) {
        return typeof parsed.output === 'string' ? parsed.output : JSON.stringify(parsed.output);
      }
      if (parsed.content) {
        return typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
      }
      if (parsed.text) {
        return typeof parsed.text === 'string' ? parsed.text : JSON.stringify(parsed.text);
      }
      // For page info responses, extract title if available
      if (parsed.pageInfo?.title) {
        return `Title: ${parsed.pageInfo.title}`;
      }
    }
  } catch {
    // Not valid JSON or parse error, continue with regular sanitization
  }

  // Remove WebSocket URLs
  result = result.replace(/ws:\/\/[^\s\]]+/g, '[connection]');

  // Remove "Call log:" sections and everything after
  result = result.replace(/\s*Call log:[\s\S]*/i, '');

  // Simplify common Playwright/CDP errors for users
  if (isError) {
    // Timeout errors: extract just the timeout duration
    const timeoutMatch = result.match(/timed? ?out after (\d+)ms/i);
    if (timeoutMatch) {
      const seconds = Math.round(parseInt(timeoutMatch[1]) / 1000);
      return `Timed out after ${seconds}s`;
    }

    // "browserType.connectOverCDP: Protocol error (X): Y" → "Y"
    const protocolMatch = result.match(/Protocol error \([^)]+\):\s*(.+)/i);
    if (protocolMatch) {
      result = protocolMatch[1].trim();
    }

    // "Error executing code: X" → just the meaningful part
    result = result.replace(/^Error executing code:\s*/i, '');

    // Clean up "browserType.connectOverCDP:" prefix
    result = result.replace(/browserType\.connectOverCDP:\s*/i, '');

    // Remove stack traces (lines starting with "at ")
    result = result.replace(/\s+at\s+.+/g, '');

    // Remove error class names like "CodeExecutionTimeoutError:"
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
  // OpenCode format: step_start, text, tool_call, tool_use, tool_result, step_finish

  // Handle text content
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

  // Handle tool calls (legacy format - just shows tool is starting)
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

  // Handle tool_result messages (legacy format - result delivered separately)
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

  // Handle tool_use messages (combined tool call + result)
  if (message.type === 'tool_use') {
    const toolUseMsg = message as import('@accomplish/shared').OpenCodeToolUseMessage;
    const toolName = toolUseMsg.part.tool || 'unknown';
    const toolInput = toolUseMsg.part.state?.input;
    const toolOutput = toolUseMsg.part.state?.output || '';
    const status = toolUseMsg.part.state?.status;

    // Only create message for completed/error status (not pending/running)
    if (status === 'completed' || status === 'error') {
      // Extract screenshots from tool output
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

      // Sanitize output - more aggressive for errors
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

  // Fallback: if a message has text content in an unexpected shape, surface it.
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
