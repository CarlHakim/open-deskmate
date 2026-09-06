import { consumeSubagentResults } from '../services/subagents/subagent-runtime';
import type {
AgentReactionMode, AppConnectorExtensionConfigInput,
AppConnectorExtensionId,
AppConnectorExtensionState, AuditEventCategory, AuditExportRequest,
AuditGetRequest,
AuditListRequest, AutomationDraftRequest, BuildBuildRequest, BuildProjectPresetInput,
BuildQualityCheckKind,
BuildQualityCheckRunRequest,
BuildStartRequest, BuildTaskHistoryListInput,
BuildTaskSessionArchiveInput,
BuildTaskSessionCreateInput,
BuildTaskSessionDeleteInput,
BuildTaskSessionPinInput,
BuildTaskSessionRenameInput,
BuildTaskSessionUpdateInput, BuildWorkspaceBaselineDecision, ChatPostcardDraftGenerateRequest, ChatToolCompatibilityCheckResult, ChecklistListPromptGenerateRequest, ContextWindowEstimateResponse, DiscordConnectorConfig, ExecutionProfileCreateInput,
ExecutionProfileUpdateInput, FolderConfig, FolderUpdateConfig, GatewayConfig,
GatewayConnectorExtensionConfigInput,
GatewayConnectorExtensionId,
GatewayConnectorExtensionState, LocalSearchSource,
MemoryChangeStatus,
MemoryKind, OllamaConfig, PermissionPolicySettings, PermissionResponse, ScheduleConfig, SearchIndexRebuildRequest,
SearchItemGetRequest,
SearchQueryRequest, SelectedModel, TaskConfig, TelegramConnectorConfig, ToolsetId, UsageAssigneeInput,
UsageAssigneeUpdate, UsageBudgetSettings, UsagePeriod, UsagePricingAutofillRequest, UsagePricingSettings, UsageProjectBudgetWindowInput,
UsageProjectBudgetWindowUpdate, UsageProjectInput, UsageProjectKanbanColumnInput,
UsageProjectKanbanColumnUpdate, UsageProjectUpdate,
UsageProjectWorkItemInput,
UsageProjectWorkItemUpdate, VoiceWakeConfig, WorkItemNotePromptGenerateRequest
} from '@accomplish/shared';
import {
GATEWAY_CONNECTOR_EXTENSION_BINDING_PREFIX
} from '@accomplish/shared';
import { randomBytes, randomUUID } from 'crypto';
import type { IpcMainInvokeEvent } from 'electron';
import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { URL } from 'url';
import { setRunInBackground as setBackgroundRunInBackground } from '../background';
import { clearHookDiagnostics, listHookDiagnostics } from '../hooks/hook-diagnostics';
import { readRuntimeHooksRegistryRaw, saveRuntimeHooksRegistryRaw } from '../hooks/hook-registry';
import {
getOpenCodeCliVersion,
isOpenCodeCliInstalled,
} from '../opencode/adapter';
import { getOpenCodePermissionPreview } from '../opencode/config-generator';
import {
applyAllowAllForFileRequest,
isFilePermissionRequest,
listPendingPermissionRequests,
resolvePermission,
} from '../permission-api';
import {
clearPermissionPolicyAuditEntries,
getPermissionPolicySettings,
listPermissionPolicyAuditEntries,
setPermissionPolicySettings,
} from '../permissions/policy-store';
import {
clearPluginDiagnosticsHistory,
getPluginDiagnosticsState,
recordPluginRegistrationDiagnostics,
} from '../plugins/plugin-diagnostics-store';
import {
getManagedPluginsRootPath,
installManagedPluginFromDirectory,
listPluginRegistry,
setPluginEnabled,
uninstallManagedPlugin,
} from '../plugins/plugin-registry';
import { listRegisteredPluginCommands } from '../plugins/plugin-runtime';
import {
cancelAgentEngineTask,
hasActiveAgentEngineTask,
sendAgentEngineTaskResponse,
stopAgentEngineTask,
} from '../runtime/agent-engine';
import {
cleanupDesktopEphemeralSessionFilesOnQuit,
dropAndCleanupDesktopBatcher,
ensureDesktopRuntimeServices,
markDesktopTaskIgnored,
maybeStartDesktopMockTask,
resolveDesktopTaskWorkspaceRoot,
resumeDesktopSessionRequest,
startDesktopTaskRequest,
} from '../runtime/desktop-agent-engine';
import { composeAgentSystemPromptAppend, getAgentContext, resolveActiveAgentId } from '../services/agent-context';
import {
getAlwaysOnStatusSnapshot,
restartAgentAlwaysOnRuntime,
restartAlwaysOnRuntimeManager,
setAgentAlwaysOnEnabled,
startAlwaysOnRuntimeManager,
stopAlwaysOnRuntimeManager,
} from '../services/always-on-status';
import {
disconnectAppConnectorOAuth,
getAppConnectorOAuthFlowStatus,
handleAppConnectorOAuthCallback,
startAppConnectorOAuthFlow,
} from '../services/app-connector-oauth';
import {
executeAppConnectorAction,
listAppConnectorRuntimeStatuses,
testAppConnectorRuntime,
} from '../services/app-connector-runtimes';
import {
exportAuditEvents,
getAuditEvent,
listAuditEvents,
recordSystemAuditEvent,
} from '../services/audit';
import { draftAutomationFromText } from '../services/automation-draft';
import { buildDevProcessManager } from '../services/build-mode/dev-process-manager';
import {
captureWorkspaceBaseline,
createWorkspaceDirectory,
createWorkspaceFile,
deleteWorkspaceEntry,
exportWorkspaceZipToFile,
listWorkspaceTree,
pasteWorkspaceEntry,
readWorkspaceDiffFileContent,
readWorkspaceFile,
readWorkspaceFingerprint,
readWorkspaceGitDiff,
renameWorkspaceEntry,
resolveAgentWorkspaceRoot,
resolvePathInWorkspace,
resolveWorkspaceBaseline,
writeWorkspaceFile,
} from '../services/build-mode/file-service';
import {
addBuildGitRemote,
applyBuildGitStash,
checkoutBuildGitRemoteBranch,
commitBuildGitChanges,
createBuildGitBranch,
createBuildGitPullRequest,
createBuildGitRemoteRepository,
createBuildGitStash,
discardBuildGitChanges,
dropBuildGitStash,
fetchBuildGitRemote,
finishBuildGitMerge,
initBuildGitRepository,
listBuildGitBackupBranches,
listBuildGitReflog,
listBuildGitStashes,
pullBuildGitBranch,
pushBuildGitBranch,
readBuildGitConflicts,
readBuildGitMismatchSummary,
readBuildGitSummary,
resolveBuildGitMismatch,
restoreBuildGitBackupBranch,
stageBuildGitFiles,
switchBuildGitBranch,
updateBuildGitRemote,
} from '../services/build-mode/git-service';
import { getLatestBuildQualityCheckRun, runBuildQualityChecks } from '../services/build-mode/quality-checks';
import { buildTerminalManager } from '../services/build-mode/terminal-manager';
import { proveChatDeferredToolCompatibility } from '../services/chat-deferred-tool-compatibility';
import { generateChatPostcardDraft, generateChecklistListPrompt, generateWorkItemNotePrompt } from '../services/checklist-list-prompt-generator';
import { preparePayloadForSend } from '../services/context/prepare-payload';
import { getDiscordStatus, getDiscordTokenSet } from '../services/discord-connector';
import {
discoverGatewayConnectorRuntimeTargets,
listGatewayConnectorRuntimeStatuses,
restartGatewayConnectorRuntime,
testGatewayConnectorRuntime,
} from '../services/gateway-connector-runtimes';
import {
getHelpAssetDataUrl,
listHelpDocs,
notifyHelpDocsChanged,
openHelpAssetExternally,
openHelpDocInEditor,
openHelpDocsFolder,
readHelpDoc,
searchHelpDocs,
} from '../services/help-docs';
import {
getLocalSearchItem,
queryLocalSearch,
rebuildLocalSearchIndex,
} from '../services/local-search';
import {
applyStagedMemoryFileWrite,
deleteMemoryFile,
getMemoryState,
listMemoryChangeHistory,
readMemoryFile,
rollbackMemoryFileChange,
saveMemoryFile,
searchMemory,
} from '../services/memory';
import { invokeNodeCommand } from '../services/node-commands';
import { getNodeCameraActive } from '../services/node-runtime';
import { getLatestNodeStreamChunk } from '../services/node-streams';
import { planNextJobs } from '../services/proactive-planner';
import { removeSchedule, runScheduleNow, toggleSchedule, upsertSchedule } from '../services/scheduler';
import { listUserSkillCuratorHistory, runUserSkillCurator } from '../services/skill-curator';
import { generateUserSkillFromTask, runPostTaskSkillAutomation } from '../services/skill-workflow-generator';
import {
archiveSubagentRun,
closeSubagentSession,
getActiveSubagentCount,
getSubagentRunForUi,
listSubagentRunsForParentTask,
listSubagentRunTreeForParentTask,
sendSubagentPrompt,
waitForSubagentRun,
} from '../services/subagents/subagent-control';
import { getTelegramStatus, getTelegramTokenSet } from '../services/telegram-connector';
import {
sanitizeToolsetIds,
setToolDiscoveryAuditHook
} from '../services/toolsets';
import { listModelsUsed } from '../services/usage-models';
import { suggestPricingFromInternet } from '../services/usage-pricing-autofill';
import {
assignUsageProjectToBuildPresetSessions,
assignUsageProjectToBuildSessionTasks,
assignUsageProjectToFolderTasks,
assignUsageProjectToTasks,
} from '../services/usage-project-assignments';
import { getUsageProjectAnalytics, getUsageProjectBudgetStatus, getUsageProjectSummary } from '../services/usage-projects';
import { getUsageSummary } from '../services/usage-summary';
import { askUserSkillAssistant } from '../services/user-skill-assistant';
import {
buildUserSkillDependencyStatusReport,
cleanupUserSkillZipSession,
createUserSkill,
deleteUserSkill,
inspectUserSkillZip,
installUserSkillDependency,
installUserSkillFromZip,
listUserSkills,
readUserSkillFile,
recordUserSkillPerformance,
rollbackUserSkill,
runUserSkillTests,
setUserSkillLifecycle,
setUserSkillSharing,
writeUserSkillFile,
} from '../services/user-skills';
import { restartVoiceWakeService } from '../services/voice-wake';
import {
getGatewayRunStatus,
getGatewayRuntimeStatus,
getWebhookLanUrls,
getWebhookLocalUrl,
listGatewayRunStatuses,
refreshGatewayRuntimeConfig,
WEBHOOK_PORT,
} from '../services/webhook-server';
import { transcribeWithWhisper } from '../services/whisper';
import { deleteAgent, getAgent, getDefaultAgentId, listAgents, setDefaultAgentId, upsertAgent } from '../store/agents';
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
getAppSettings,
getBrowserProfile,
getDebugMode,
getMobileNodesEnabled,
getOllamaConfig,
getOnboardingComplete,
getSelectedModel,
getUserSkillAssistantModel,
getWebhookBindMode,
getWorkspaceRoot,
setActiveAgentId,
setAgentSpeedMode,
setBrowserProfile,
setBuildDiffEnforcementMode,
setDebugMode,
setLaunchAtLogin,
setMobileNodesDisplayName,
setMobileNodesEnabled,
setMobileNodesMaxLivePreviews,
setOllamaConfig,
setOnboardingComplete,
setRunInBackground,
setSelectedModel,
setUserSkillAssistantModel,
setWebhookBindMode,
setWorkspaceRoot
} from '../store/appSettings';
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
import { listConnectorDeliveries } from '../store/connectorDeliveries';
import { addDiscordDmAllowlistEntry, getDiscordConfig, setDiscordConfig } from '../store/discordConfig';
import { approveDiscordPairing, listDiscordPairingRequests } from '../store/discordPairing';
import {
archiveExecutionProfile,
assertExecutionProfileRunnable,
checkExecutionProfileHealth,
createExecutionProfile,
listExecutionProfiles,
updateExecutionProfile,
} from '../store/executionProfiles';
import {
createFolder,
deleteFolder as deleteFolderFromStore,
getFolder,
getFoldersForAgent,
getTaskFolderAssignments,
setTaskFolder,
updateFolder,
} from '../store/folderStore';
import {
listGatewayBindings,
removeGatewayBinding,
setGatewayBindings,
upsertGatewayBinding,
type GatewayRouteBinding,
} from '../store/gatewayBindings';
import { getGatewayConfig, setGatewayConfig } from '../store/gatewayConfig';
import {
clearGatewayConnectorDiscovery,
listGatewayConnectorDiscovery,
} from '../store/gatewayConnectorDiscovery';
import {
createGatewayConnectorExtensionInstance,
deleteGatewayConnectorExtensionInstance,
getGatewayConnectorExtensionConfig,
getGatewayConnectorRuntimeKey,
isGatewayConnectorExtensionId,
listGatewayConnectorExtensionConfigs,
listGatewayConnectorExtensionDefinitions,
setGatewayConnectorExtensionConfig,
} from '../store/gatewayConnectorExtensions';
import {
deleteGatewaySession,
getGatewaySession,
listGatewaySessions,
} from '../store/gatewaySessions';
import { getModelLimitOverrides, setModelContextLimitOverride } from '../store/modelLimits';
import {
approveNodePairing,
listNodePairing,
rejectNodePairing,
removePairedNode,
updatePairedNodeAiAccess,
updatePairedNodeBadge
} from '../store/nodePairing';
import {
createSavedPromptCategory,
deleteSavedPrompt,
deleteSavedPromptCategory,
listSavedPromptCategories,
listSavedPrompts,
renameSavedPromptCategory,
upsertSavedPrompt,
} from '../store/savedPrompts';
import { listSchedules } from '../store/schedules';
import {
deleteApiKey,
deleteAppConnectorOAuthClientSecret,
deleteAppConnectorSecret,
deleteDiscordToken,
deleteGatewayConnectorSecret,
deleteGatewayPassword,
deleteGatewayToken,
deleteTelegramToken,
deleteVoiceWakeAccessKey,
getApiKey,
getVoiceWakeAccessKey,
hasAnyApiKey,
hasAppConnectorOAuthClientSecret,
hasAppConnectorSecret,
hasGatewayConnectorSecret,
listStoredCredentials,
storeApiKey,
storeAppConnectorOAuthClientSecret,
storeAppConnectorSecret,
storeDiscordToken,
storeGatewayConnectorSecret,
storeGatewayPassword,
storeGatewayToken,
storeTelegramToken,
storeVoiceWakeAccessKey,
} from '../store/secureStorage';
import {
getSubagentRun,
listSubagentRuns,
patchSubagentRun,
} from '../store/subagentRegistry';
import {
addTaskActivity,
clearHistory,
deleteTask,
getTask,
getTaskList,
getTasks,
updateTaskStatus
} from '../store/taskHistory';
import { addTelegramDmAllowlistEntry, getTelegramConfig, setTelegramConfig } from '../store/telegramConfig';
import { approveTelegramPairing, listTelegramPairingRequests } from '../store/telegramPairing';
import { getUsageBudgetSettings, getUsageBudgetStatus, setUsageBudgetSettings } from '../store/usageBudgets';
import { getUsagePricingSettings, setUsagePricingSettings } from '../store/usagePricing';
import {
archiveUsageAssignee,
archiveUsageProject,
archiveUsageProjectWorkItem,
createUsageAssignee,
createUsageProject,
createUsageProjectBudgetWindow,
createUsageProjectKanbanColumn,
createUsageProjectWorkItem,
deleteUsageProjectBudgetWindow,
deleteUsageProjectKanbanColumn,
getUsageProject,
listUsageAssignees,
listUsageProjectBudgetWindows,
listUsageProjectKanbanColumns,
listUsageProjects,
listUsageProjectWorkItems,
updateUsageAssignee,
updateUsageProject,
updateUsageProjectBudgetWindow,
updateUsageProjectKanbanColumn,
updateUsageProjectWorkItem,
} from '../store/usageProjects';
import { getUserSkillConfig, setUserSkillConfig } from '../store/userSkillsConfig';
import { getVoiceWakeConfig, setVoiceWakeConfig } from '../store/voiceWake';
import { isMockTaskEventsEnabled } from '../test-utils/mock-task-flow';
import { buildAttachmentsPrefix } from '../utils/file-attachments';
import { installAllSkills, installSkill, listSkillsStatus, uninstallSkill } from '../utils/skills';
import { registerModelProviderHandlers } from './model-provider-handlers';
import { handle } from './register-handler';
import { MAX_TEXT_LENGTH, PROVIDER_ID_RE, sanitizeOptionalText, sanitizeProviderId, sanitizeString } from './sanitizers';
import { registerToolDiscoveryHandlers } from './tool-discovery-handlers';
import {
permissionResponseSchema,
validate
} from './validation';
const MAX_AVATAR_IMAGE_DATA_URL_LENGTH = 1_000_000;
const AVATAR_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i;
const ALLOWED_API_KEY_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'custom']);
const ALLOWED_SELECTED_MODEL_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'xai', 'ollama', 'custom']);
const ALLOWED_SEARCH_SOURCES = new Set<LocalSearchSource>([
  'chat_task',
  'build_task',
  'build_runtime',
  'tool_call',
  'project',
  'workboard_item',
  'workboard_note',
  'linked_document',
  'memory_file',
  'memory_change',
  'skill',
  'git_summary',
  'connector_message',
  'audit_event',
]);
const ALLOWED_AUDIT_CATEGORIES = new Set<AuditEventCategory>([
  'task',
  'tool_use',
  'discovery',
  'memory',
  'skill',
  'tool_discovery',
  'connector',
  'scheduled',
  'always_on',
  'execution_profile',
  'git',
  'build_runtime',
  'search',
  'settings',
  'system',
]);
const API_KEY_VALIDATION_TIMEOUT_MS = 15000;
app.once('before-quit', () => {
  cleanupDesktopEphemeralSessionFilesOnQuit();
});

function emitPermissionResolvedActivity(taskId: string, detail: string): void {
  const task = getTask(taskId);
  const activity = {
    id: `act_permission_resolved_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    taskId,
    agentId: task?.agentId,
    kind: 'permission_resolved' as const,
    title: 'Permission resolved',
    detail,
    timestamp: new Date().toISOString(),
    status: 'success' as const,
  };
  addTaskActivity(taskId, activity);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('task:activity', activity);
    }
  }
}

function sanitizeFileBaseName(input: unknown, fallback: string, maxLength = 64): string {
  const raw = String(input ?? fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  const normalized = raw || fallback;
  return normalized.slice(0, maxLength).trim().replace(/[. ]+$/g, '') || fallback;
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
  const safeBase = sanitizeFileBaseName(baseName, 'snapshot');
  const dir = path.join(os.tmpdir(), 'opendeskmate-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${safeBase}-${Date.now()}.${extension}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function saveDataUrlToChosenFile(window: BrowserWindow, dataUrl: string, baseName: string): Promise<{ filePath?: string; cancelled?: boolean }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const safeBase = sanitizeFileBaseName(baseName, 'snapshot');
  const saveResult = await dialog.showSaveDialog(window, {
    title: 'Export screenshot',
    defaultPath: path.join(os.homedir(), 'Downloads', `${safeBase}-${Date.now()}.${extension}`),
    filters: [
      { name: extension.toUpperCase(), extensions: [extension] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { cancelled: true };
  }

  fs.writeFileSync(saveResult.filePath, buffer);
  return { filePath: saveResult.filePath };
}

async function saveTextToChosenFile(window: BrowserWindow, params: {
  content: string;
  baseName?: string;
  extension?: string;
  title?: string;
  filters?: Electron.FileFilter[];
}): Promise<{ filePath?: string; cancelled?: boolean }> {
  const extension = sanitizeString(params.extension || 'txt', 'extension', 12).replace(/^\.+/, '') || 'txt';
  const safeBase = sanitizeFileBaseName(params.baseName, 'document');
  const saveResult = await dialog.showSaveDialog(window, {
    title: sanitizeOptionalText(params.title, 'title', 80) || 'Save file',
    defaultPath: path.join(os.homedir(), 'Downloads', `${safeBase}.${extension}`),
    filters: params.filters && params.filters.length > 0
      ? params.filters
      : [{ name: extension.toUpperCase(), extensions: [extension] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { cancelled: true };
  }

  try {
    fs.writeFileSync(saveResult.filePath, params.content, 'utf8');
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error('The selected file is open or locked by another app. Close it, or choose a different filename and try again.');
    }
    throw err;
  }
  return { filePath: saveResult.filePath };
}

const FULL_PREVIEW_CAPTURE_MAX_WIDTH = 6000;
const FULL_PREVIEW_CAPTURE_MAX_HEIGHT = 12000;

function normalizeLocalPreviewUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  const isLocalHost = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1'
    || hostname.endsWith('.localhost');

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLocalHost) {
    throw new Error('Full preview screenshots are only available for local runtime preview URLs.');
  }

  return url.toString();
}

async function captureRuntimePreviewFullPage(previewUrl: string): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  clipped: boolean;
}> {
  const url = normalizeLocalPreviewUrl(previewUrl);
  let previewWindow: BrowserWindow | null = null;
  try {
    previewWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    await Promise.race([
      previewWindow.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Full preview screenshot timed out.')), 15_000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 800));

    const dimensions = await previewWindow.webContents.executeJavaScript(`(() => {
      const doc = document.documentElement;
      const body = document.body;
      const width = Math.ceil(Math.max(
        window.innerWidth || 0,
        doc?.clientWidth || 0,
        doc?.scrollWidth || 0,
        doc?.offsetWidth || 0,
        body?.clientWidth || 0,
        body?.scrollWidth || 0,
        body?.offsetWidth || 0
      ));
      const height = Math.ceil(Math.max(
        window.innerHeight || 0,
        doc?.clientHeight || 0,
        doc?.scrollHeight || 0,
        doc?.offsetHeight || 0,
        body?.clientHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      ));
      return { width, height };
    })()`, true) as { width?: number; height?: number };

    const fullWidth = Math.max(1, Math.round(Number(dimensions?.width) || 1280));
    const fullHeight = Math.max(1, Math.round(Number(dimensions?.height) || 800));
    const captureWidth = Math.min(FULL_PREVIEW_CAPTURE_MAX_WIDTH, fullWidth);
    const captureHeight = Math.min(FULL_PREVIEW_CAPTURE_MAX_HEIGHT, fullHeight);
    const clipped = captureWidth < fullWidth || captureHeight < fullHeight;

    previewWindow.setContentSize(captureWidth, captureHeight);
    await previewWindow.webContents.executeJavaScript('window.scrollTo(0, 0); undefined;', true);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const image = await previewWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureWidth,
      height: captureHeight,
    });
    return {
      dataUrl: image.toDataURL(),
      width: captureWidth,
      height: captureHeight,
      fullWidth,
      fullHeight,
      clipped,
    };
  } finally {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.destroy();
    }
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

function sanitizeOptionalAvatarImageDataUrl(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input !== 'string') {
    throw new Error('avatarImageDataUrl must be a string');
  }
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_AVATAR_IMAGE_DATA_URL_LENGTH) {
    throw new Error('avatarImageDataUrl exceeds maximum length');
  }
  if (!AVATAR_IMAGE_DATA_URL_RE.test(trimmed)) {
    throw new Error('avatarImageDataUrl must be a supported image data URL');
  }
  return trimmed;
}

function sanitizeUsageProjectBillingType(input: unknown): UsageProjectInput['billingType'] {
  const raw = sanitizeOptionalText(input, 'billingType', 32).trim().toLowerCase();
  return ['internal', 'client_billable', 'fixed_fee', 'retainer', 'r_and_d', 'support', 'other'].includes(raw)
    ? raw as UsageProjectInput['billingType']
    : 'internal';
}

function sanitizeUsageProjectPriority(input: unknown): UsageProjectInput['priority'] {
  const raw = sanitizeOptionalText(input, 'priority', 32).trim().toLowerCase();
  return ['low', 'normal', 'high', 'urgent'].includes(raw)
    ? raw as UsageProjectInput['priority']
    : 'normal';
}

function isAllowedUsageProjectLinkUrl(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (/^\\\\/.test(value)) return true;
  if (/^\//.test(value)) return true;
  if (/^\.{1,2}[\\/]/.test(value)) return true;
  return false;
}

function sanitizeUsageProjectLinks(input: unknown): UsageProjectInput['links'] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const url = sanitizeOptionalText(source.url, `links.${index}.url`, 1024).trim();
    if (!url || !isAllowedUsageProjectLinkUrl(url)) return [];
    return [{
      id: sanitizeOptionalText(source.id, `links.${index}.id`, 80).trim() || randomUUID(),
      label: sanitizeOptionalText(source.label, `links.${index}.label`, 80).trim() || 'Link',
      url,
    }];
  });
}

function sanitizeUsageProjectTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  input.slice(0, 40).forEach((entry, index) => {
    const tag = sanitizeOptionalText(entry, `tags.${index}`, 40).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key) || tags.length >= 20) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function sanitizeIdList(input: unknown, field = 'ids'): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  input.slice(0, 120).forEach((entry, index) => {
    const id = sanitizeOptionalText(entry, `${field}.${index}`, 128).trim();
    if (!id || seen.has(id) || ids.length >= 80) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function sanitizeWorkItemOutlineColor(input: unknown, field = 'outlineColor'): string | undefined {
  const value = sanitizeOptionalText(input, field, 32).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function sanitizeOptionalIdOverride(input: unknown, field = 'assigneeIds'): string[] | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (Array.isArray(input)) return sanitizeIdList(input, field);
  throw new Error(`${field} must be an array or null`);
}

function sanitizeUsageProjectNotes(input: unknown, legacyNotes: unknown): UsageProjectInput['noteEntries'] {
  const hasStructuredNotes = Array.isArray(input);
  const notes = hasStructuredNotes ? input.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const text = sanitizeOptionalText(source.text, `noteEntries.${index}.text`, 5000).trim();
    if (!text) return [];
    return [{
      id: sanitizeOptionalText(source.id, `noteEntries.${index}.id`, 80).trim() || randomUUID(),
      text,
      createdAt: sanitizeOptionalText(source.createdAt, `noteEntries.${index}.createdAt`, 64).trim() || new Date().toISOString(),
      updatedAt: source.updatedAt ? sanitizeOptionalText(source.updatedAt, `noteEntries.${index}.updatedAt`, 64).trim() : undefined,
    }];
  }) : [];

  if (notes.length === 0 && !hasStructuredNotes) {
    const legacy = sanitizeOptionalText(legacyNotes, 'notes', 5000).trim();
    if (legacy) {
      return [{
        id: randomUUID(),
        text: legacy,
        createdAt: new Date().toISOString(),
      }];
    }
  }

  return notes;
}

function sanitizeUsageProjectMetadata(input: Partial<UsageProjectInput | UsageProjectUpdate>, includeMissing = false): Partial<UsageProjectInput> {
  const output: Partial<UsageProjectInput> = {};
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'clientName')) {
    output.clientName = sanitizeOptionalText(input.clientName, 'clientName', 120).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'projectCode')) {
    output.projectCode = sanitizeOptionalText(input.projectCode, 'projectCode', 64).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'owner')) {
    output.owner = sanitizeOptionalText(input.owner, 'owner', 120).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'billingType')) {
    output.billingType = sanitizeUsageProjectBillingType(input.billingType);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'billingReference')) {
    output.billingReference = sanitizeOptionalText(input.billingReference, 'billingReference', 160).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'priority')) {
    output.priority = sanitizeUsageProjectPriority(input.priority);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'dueDate')) {
    output.dueDate = input.dueDate ? sanitizeOptionalText(input.dueDate, 'dueDate', 64).trim() : null;
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'notes')) {
    output.notes = sanitizeOptionalText(input.notes, 'notes', 5000).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'noteEntries')) {
    output.noteEntries = sanitizeUsageProjectNotes(input.noteEntries, input.notes);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'links')) {
    output.links = sanitizeUsageProjectLinks(input.links);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'tags')) {
    output.tags = sanitizeUsageProjectTags(input.tags);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'assigneeIds')) {
    output.assigneeIds = sanitizeIdList(input.assigneeIds, 'assigneeIds');
  }
  return output;
}

function sanitizeUsageAssigneePayload(input: Partial<UsageAssigneeInput | UsageAssigneeUpdate>, includeMissing = false): Partial<UsageAssigneeInput> {
  const output: Partial<UsageAssigneeInput> = {};
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'name')) {
    output.name = sanitizeOptionalText(input.name, 'name', 120).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'role')) {
    output.role = sanitizeOptionalText(input.role, 'role', 120).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'email')) {
    output.email = sanitizeOptionalText(input.email, 'email', 160).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'phone')) {
    output.phone = sanitizeOptionalText(input.phone, 'phone', 80).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'company')) {
    output.company = sanitizeOptionalText(input.company, 'company', 120).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'notes')) {
    output.notes = sanitizeOptionalText(input.notes, 'notes', 5000).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'color')) {
    const rawColor = input.color === null ? '' : input.color;
    output.color = sanitizeOptionalText(rawColor, 'color', 32).trim() || undefined;
  }
  return output;
}

function sanitizeWorkItemSourceType(input: unknown): UsageProjectWorkItemInput['sourceType'] {
  const value = sanitizeOptionalText(input, 'sourceType', 40).trim();
  return ['manual', 'chat_project', 'chat_task', 'build_preset', 'build_session'].includes(value)
    ? value as UsageProjectWorkItemInput['sourceType']
    : 'manual';
}

function sanitizeWorkItemChecklist(input: unknown): UsageProjectWorkItemInput['checklist'] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 80).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const text = sanitizeOptionalText(source.text, `checklist.${index}.text`, 300).trim();
    if (!text) return [];
    return [{
      id: sanitizeOptionalText(source.id, `checklist.${index}.id`, 80).trim() || randomUUID(),
      text,
      completed: source.completed === true,
      assigneeIds: sanitizeIdList(source.assigneeIds, `checklist.${index}.assigneeIds`),
      dueDate: source.dueDate ? sanitizeOptionalText(source.dueDate, `checklist.${index}.dueDate`, 64).trim() : null,
      createdAt: sanitizeOptionalText(source.createdAt, `checklist.${index}.createdAt`, 64).trim() || new Date().toISOString(),
      updatedAt: source.updatedAt ? sanitizeOptionalText(source.updatedAt, `checklist.${index}.updatedAt`, 64).trim() : undefined,
    }];
  });
}

function sanitizeWorkItemChecklistLists(input: unknown): UsageProjectWorkItemInput['checklistLists'] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const name = sanitizeOptionalText(source.name, `checklistLists.${index}.name`, 80).trim();
    const items = sanitizeWorkItemChecklist(source.items) || [];
    if (!name && items.length === 0) return [];
    return [{
      id: sanitizeOptionalText(source.id, `checklistLists.${index}.id`, 80).trim() || randomUUID(),
      name: name || 'List',
      items,
      context: sanitizeOptionalText(source.context, `checklistLists.${index}.context`, 5000).trim() || undefined,
      outlineColor: sanitizeWorkItemOutlineColor(source.outlineColor, `checklistLists.${index}.outlineColor`),
      createdAt: sanitizeOptionalText(source.createdAt, `checklistLists.${index}.createdAt`, 64).trim() || new Date().toISOString(),
      updatedAt: source.updatedAt ? sanitizeOptionalText(source.updatedAt, `checklistLists.${index}.updatedAt`, 64).trim() : undefined,
    }];
  });
}

const WORK_ITEM_NOTE_TEXT_MAX_LENGTH = 100_000;
const WORK_ITEM_NOTE_HTML_MAX_LENGTH = 300_000;

function sanitizeWorkItemNotes(input: unknown): UsageProjectWorkItemInput['notes'] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const text = sanitizeOptionalText(source.text, `notes.${index}.text`, WORK_ITEM_NOTE_TEXT_MAX_LENGTH).trim();
    const html = sanitizeOptionalText(source.html, `notes.${index}.html`, WORK_ITEM_NOTE_HTML_MAX_LENGTH)
      .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
      .trim();
    if (!text) return [];
    return [{
      id: sanitizeOptionalText(source.id, `notes.${index}.id`, 80).trim() || randomUUID(),
      title: sanitizeOptionalText(source.title, `notes.${index}.title`, 160).trim() || undefined,
      text,
      html: html || undefined,
      outlineColor: sanitizeWorkItemOutlineColor(source.outlineColor, `notes.${index}.outlineColor`),
      createdAt: sanitizeOptionalText(source.createdAt, `notes.${index}.createdAt`, 64).trim() || new Date().toISOString(),
      updatedAt: source.updatedAt ? sanitizeOptionalText(source.updatedAt, `notes.${index}.updatedAt`, 64).trim() : undefined,
    }];
  });
}

function sanitizeDrawingNumber(input: unknown, fallback = 0): number {
  const num = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(-10000, Math.min(10000, num));
}

function sanitizeDrawingColor(input: unknown, fallback: string): string {
  const value = sanitizeOptionalText(input, 'drawingColor', 32).trim();
  return /^#[0-9a-f]{6}$/i.test(value) || value === 'transparent' ? value : fallback;
}

function sanitizeDrawingStrokeStyle(input: unknown): 'solid' | 'dashed' | 'dotted' {
  const value = sanitizeOptionalText(input, 'drawingStrokeStyle', 16).trim().toLowerCase();
  return value === 'dashed' || value === 'dotted' ? value : 'solid';
}

function sanitizeDrawingOpacity(input: unknown): number {
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function sanitizeWorkItemDrawings(input: unknown): UsageProjectWorkItemInput['drawings'] {
  if (!Array.isArray(input)) return [];
  const allowedKinds = ['rectangle', 'ellipse', 'triangle', 'line', 'arrow', 'text'];
  return input.slice(0, 20).flatMap((entry, drawingIndex) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const elementsInput = Array.isArray(source.elements) ? source.elements : [];
    const elements = elementsInput.slice(0, 80).flatMap((element, elementIndex) => {
      if (!element || typeof element !== 'object') return [];
      const elementSource = element as Record<string, unknown>;
      const kind = sanitizeOptionalText(elementSource.kind, `drawings.${drawingIndex}.elements.${elementIndex}.kind`, 24).trim();
      if (!allowedKinds.includes(kind)) return [];
      return [{
        id: sanitizeOptionalText(elementSource.id, `drawings.${drawingIndex}.elements.${elementIndex}.id`, 80).trim() || randomUUID(),
        kind: kind as 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow' | 'text',
        x1: sanitizeDrawingNumber(elementSource.x1),
        y1: sanitizeDrawingNumber(elementSource.y1),
        x2: sanitizeDrawingNumber(elementSource.x2),
        y2: sanitizeDrawingNumber(elementSource.y2),
        stroke: sanitizeDrawingColor(elementSource.stroke, '#38bdf8'),
        fill: sanitizeDrawingColor(elementSource.fill, 'transparent'),
        fillOpacity: sanitizeDrawingOpacity(elementSource.fillOpacity),
        strokeWidth: Math.max(1, Math.min(12, sanitizeDrawingNumber(elementSource.strokeWidth, 2))),
        strokeStyle: sanitizeDrawingStrokeStyle(elementSource.strokeStyle),
        text: sanitizeOptionalText(elementSource.text, `drawings.${drawingIndex}.elements.${elementIndex}.text`, 500).trim() || undefined,
        fontSize: Math.max(10, Math.min(72, sanitizeDrawingNumber(elementSource.fontSize, 24))),
      }];
    });
    return [{
      id: sanitizeOptionalText(source.id, `drawings.${drawingIndex}.id`, 80).trim() || randomUUID(),
      title: sanitizeOptionalText(source.title, `drawings.${drawingIndex}.title`, 120).trim() || 'Drawing',
      width: Math.max(320, Math.min(1600, sanitizeDrawingNumber(source.width, 640))),
      height: Math.max(200, Math.min(1200, sanitizeDrawingNumber(source.height, 360))),
      elements,
      outlineColor: sanitizeWorkItemOutlineColor(source.outlineColor, `drawings.${drawingIndex}.outlineColor`),
      createdAt: sanitizeOptionalText(source.createdAt, `drawings.${drawingIndex}.createdAt`, 64).trim() || new Date().toISOString(),
      updatedAt: source.updatedAt ? sanitizeOptionalText(source.updatedAt, `drawings.${drawingIndex}.updatedAt`, 64).trim() : undefined,
    }];
  });
}

function sanitizeWorkItemDocuments(input: unknown): UsageProjectWorkItemInput['documents'] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const kind = sanitizeOptionalText(source.kind, `documents.${index}.kind`, 16).trim() === 'url' ? 'url' : 'local';
    const path = sanitizeOptionalText(source.path, `documents.${index}.path`, 1024).trim();
    const url = sanitizeOptionalText(source.url, `documents.${index}.url`, 2048).trim();
    if (kind === 'url' && !/^https?:\/\//i.test(url)) return [];
    if (kind === 'local' && !path) return [];
    const fallbackLabel = kind === 'url'
      ? url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || 'Document link'
      : path.split(/[\\/]/).filter(Boolean).pop() || 'Local document';
    return [{
      id: sanitizeOptionalText(source.id, `documents.${index}.id`, 80).trim() || randomUUID(),
      label: sanitizeOptionalText(source.label, `documents.${index}.label`, 160).trim() || fallbackLabel,
      kind,
      path: kind === 'local' ? path : undefined,
      url: kind === 'url' ? url : undefined,
      outlineColor: sanitizeWorkItemOutlineColor(source.outlineColor, `documents.${index}.outlineColor`),
      createdAt: sanitizeOptionalText(source.createdAt, `documents.${index}.createdAt`, 64).trim() || new Date().toISOString(),
    }];
  });
}

function sanitizeWorkItemSources(input: unknown): UsageProjectWorkItemInput['sources'] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const url = sanitizeOptionalText(source.url, `sources.${index}.url`, 2048).trim();
    if (!/^https?:\/\//i.test(url)) return [];
    let fallbackTitle = 'Source';
    try {
      fallbackTitle = new URL(url).hostname.replace(/^www\./i, '') || fallbackTitle;
    } catch {
      fallbackTitle = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || fallbackTitle;
    }
    return [{
      id: sanitizeOptionalText(source.id, `sources.${index}.id`, 80).trim() || randomUUID(),
      title: sanitizeOptionalText(source.title, `sources.${index}.title`, 180).trim() || fallbackTitle,
      url,
      description: sanitizeOptionalText(source.description, `sources.${index}.description`, 1000).trim() || undefined,
      createdAt: sanitizeOptionalText(source.createdAt, `sources.${index}.createdAt`, 64).trim() || new Date().toISOString(),
      updatedAt: source.updatedAt ? sanitizeOptionalText(source.updatedAt, `sources.${index}.updatedAt`, 64).trim() : undefined,
    }];
  });
}

function sanitizeWorkItemPayload(input: Partial<UsageProjectWorkItemInput | UsageProjectWorkItemUpdate>, includeMissing = false): Partial<UsageProjectWorkItemInput> {
  const output: Partial<UsageProjectWorkItemInput> = {};
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'title')) {
    output.title = sanitizeOptionalText(input.title, 'title', 180).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'description')) {
    output.description = sanitizeOptionalText(input.description, 'description', 5000).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'color')) {
    output.color = input.color === null ? null : sanitizeOptionalText(input.color, 'color', 32).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'sourceType')) {
    output.sourceType = sanitizeWorkItemSourceType(input.sourceType);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'sourceId')) {
    output.sourceId = input.sourceId ? sanitizeOptionalText(input.sourceId, 'sourceId', 160).trim() : null;
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'statusId')) {
    output.statusId = sanitizeOptionalText(input.statusId, 'statusId', 128).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'priority')) {
    output.priority = sanitizeUsageProjectPriority(input.priority);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'assigneeIds')) {
    output.assigneeIds = sanitizeIdList(input.assigneeIds, 'assigneeIds');
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'startDate')) {
    output.startDate = input.startDate ? sanitizeOptionalText(input.startDate, 'startDate', 64).trim() : null;
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'dueDate')) {
    output.dueDate = input.dueDate ? sanitizeOptionalText(input.dueDate, 'dueDate', 64).trim() : null;
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'completedAt')) {
    output.completedAt = input.completedAt ? sanitizeOptionalText(input.completedAt, 'completedAt', 64).trim() : null;
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'blocked')) {
    output.blocked = input.blocked === true;
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'blockedReason')) {
    output.blockedReason = sanitizeOptionalText(input.blockedReason, 'blockedReason', 300).trim();
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'tags')) {
    output.tags = sanitizeUsageProjectTags(input.tags);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'checklist')) {
    output.checklist = sanitizeWorkItemChecklist(input.checklist);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'checklistLists')) {
    output.checklistLists = sanitizeWorkItemChecklistLists(input.checklistLists);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'notes')) {
    output.notes = sanitizeWorkItemNotes(input.notes);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'drawings')) {
    output.drawings = sanitizeWorkItemDrawings(input.drawings);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'documents')) {
    output.documents = sanitizeWorkItemDocuments(input.documents);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'sources')) {
    output.sources = sanitizeWorkItemSources(input.sources);
  }
  if (includeMissing || Object.prototype.hasOwnProperty.call(input, 'archived')) {
    output.archived = input.archived === true;
  }
  return output;
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
  if (config.usageProjectId) {
    validated.usageProjectId = sanitizeString(config.usageProjectId, 'usageProjectId', 128);
  } else if (config.usageProjectId === null) {
    validated.usageProjectId = null;
  }
  if (config.workingDirectory) {
    validated.workingDirectory = sanitizeString(config.workingDirectory, 'workingDirectory', 1024);
  }
  if (config.requiresBrowser === true || config.requiresBrowser === false) {
    validated.requiresBrowser = config.requiresBrowser;
  }
  if (config.buildMode === true) {
    validated.buildMode = true;
  }
  if (config.buildWorkspaceRelativePath) {
    validated.buildWorkspaceRelativePath = sanitizeString(
      config.buildWorkspaceRelativePath,
      'buildWorkspaceRelativePath',
      300
    );
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

export function registerIPCHandlers(): void {
  registerToolDiscoveryHandlers();
  registerModelProviderHandlers();
  const resolveDesktopRuntimeWorkspaceRoot = (taskId: string) =>
    resolveDesktopTaskWorkspaceRoot(taskId, (agentId?: string) =>
      agentId ? (getAgentContext(agentId).workspaceRoot || '') : ''
    );
  setToolDiscoveryAuditHook((event) => {
    recordSystemAuditEvent({
      category: 'tool_discovery',
      action: event.action,
      title: `Tool discovery ${event.status}`,
      summary: [
        event.reason,
        event.newlyEnabledToolsetIds.length ? `Enabled: ${event.newlyEnabledToolsetIds.join(', ')}` : '',
        event.missingToolsetIds.length ? `Missing toolsets: ${event.missingToolsetIds.join(', ')}` : '',
        event.missingCapabilities.length ? `Missing capabilities: ${event.missingCapabilities.join(', ')}` : '',
        event.missingToolNames.length ? `Missing tools: ${event.missingToolNames.join(', ')}` : '',
      ].filter(Boolean).join(' | '),
      status: event.status === 'enabled' || event.status === 'already_enabled'
        ? 'success'
        : event.status === 'partial'
          ? 'warning'
          : 'error',
      timestamp: event.timestamp,
      agentId: event.agentId,
      taskId: event.taskId,
      targetType: 'toolset',
      targetId: event.newlyEnabledToolsetIds[0] || event.alreadyEnabledToolsetIds[0] || event.missingToolsetIds[0],
      source: 'tool-discovery',
      metadata: {
        requested: event.requested,
        enabledToolsetIds: event.enabledToolsetIds,
        newlyEnabledToolsetIds: event.newlyEnabledToolsetIds,
        alreadyEnabledToolsetIds: event.alreadyEnabledToolsetIds,
        missingToolsetIds: event.missingToolsetIds,
        missingCapabilities: event.missingCapabilities,
        missingToolNames: event.missingToolNames,
        unavailableToolsetIds: event.unavailableToolsetIds,
        mcpConfigRegeneration: event.mcpConfigRegeneration,
      },
    });
  });

  // Desktop runtime services initialize lazily when the first desktop task starts or resumes.
  // Task: Start a new task
  handle('task:start', async (event: IpcMainInvokeEvent, config: TaskConfig) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const validatedConfig = applyAgentContext(validateTaskConfig(config));
    ensureDesktopRuntimeServices({
      window,
      resolveTaskWorkspaceRoot: resolveDesktopRuntimeWorkspaceRoot,
    });

    const mockTask = maybeStartDesktopMockTask(window, validatedConfig);
    if (mockTask) {
      return mockTask;
    }

    return await startDesktopTaskRequest({
      window,
      sender: event.sender,
      validatedConfig,
    });
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

  handle(
    'user-skills:automation:post-task',
    async (_event: IpcMainInvokeEvent, req: { taskId: string; agentId?: string; modeOverride?: 'automatic' | 'approval' | 'off' }) => {
      if (!req || typeof req.taskId !== 'string') {
        throw new Error('taskId is required');
      }
      const taskId = sanitizeString(req.taskId, 'taskId', 128);
      const agentId = req.agentId ? sanitizeString(req.agentId, 'agentId', 128) : undefined;
      const rawMode = req.modeOverride ? sanitizeString(req.modeOverride, 'modeOverride', 24).toLowerCase() : '';
      const modeOverride = rawMode === 'automatic' || rawMode === 'approval' || rawMode === 'off'
        ? rawMode
        : undefined;
      return await runPostTaskSkillAutomation({ taskId, agentId, modeOverride });
    }
  );

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

    const stopState = await stopAgentEngineTask(taskId, { interruptFirst: false });
    if (stopState !== 'none') {
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

    const stopState = await stopAgentEngineTask(taskId, { interruptFirst: true });
    if (stopState === 'queued') {
      updateTaskStatus(taskId, 'interrupted', new Date().toISOString());
      return;
    }

    if (stopState === 'active') {
      console.log(`[IPC] Task ${taskId} interrupted`);
      // Optimistically unblock UI immediately. The task manager will still emit
      // final updates when the process exits.
      updateTaskStatus(taskId, 'interrupted', new Date().toISOString());

      // Some provider/model combinations can ignore Ctrl+C momentarily.
      // If task is still active, force-cancel quickly so stop feels immediate
      // and queued tasks are unblocked.
      setTimeout(() => {
        if (!hasActiveAgentEngineTask(taskId)) return;
        console.warn(`[IPC] Task ${taskId} still active after interrupt; force-cancelling`);
        void cancelAgentEngineTask(taskId)
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
    return getTaskList(resolvedAgentId);
  });

  // Task: Delete task from history
  handle('task:delete', async (_event: IpcMainInvokeEvent, taskId: string) => {
    markDesktopTaskIgnored(taskId);
    // Stop any queued or running task to prevent lingering events after deletion
    await stopAgentEngineTask(taskId, { interruptFirst: false });
    // Drop any pending batched messages for this task
    dropAndCleanupDesktopBatcher(taskId);
    // Delete from history immediately so UI updates fast
    deleteTask(taskId);
  });

  // Task: Clear all history
  handle('task:clear-history', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    clearHistory(agentId || resolveActiveAgentId());
  });

  handle('permission:pending', async (_event: IpcMainInvokeEvent, payload?: { taskId?: unknown }) => {
    const taskId = payload?.taskId == null ? undefined : sanitizeOptionalText(payload.taskId, 'taskId', 128);
    return listPendingPermissionRequests(taskId);
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
    if (!hasActiveAgentEngineTask(taskId)) {
      console.warn(`[IPC] Permission response for inactive task ${taskId}`);
      return;
    }

    if (decision === 'allow') {
      // Send the response to the correct task's CLI
      const message = parsedResponse.selectedOptions?.join(', ') || parsedResponse.message || 'yes';
      const sanitizedMessage = sanitizeString(message, 'permissionResponse', 1024);
      await sendAgentEngineTaskResponse(taskId, sanitizedMessage);
      emitPermissionResolvedActivity(taskId, decision);
    } else {
      // Send denial to the correct task
      await sendAgentEngineTaskResponse(taskId, 'no');
      emitPermissionResolvedActivity(taskId, decision);
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
      privacyMode?: 'normal' | 'incognito',
      usageProjectId?: string | null,
      options?: {
        workingDirectory?: string;
        requiresBrowser?: boolean;
        buildMode?: boolean;
        buildWorkspaceRelativePath?: string;
      }
    ) => {
      const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
      ensureDesktopRuntimeServices({
        window,
        resolveTaskWorkspaceRoot: resolveDesktopRuntimeWorkspaceRoot,
      });
      const validatedSessionId = sanitizeString(sessionId, 'sessionId', 128);
      const validatedPrompt = sanitizeString(prompt, 'prompt');
      const validatedExistingTaskId = existingTaskId
        ? sanitizeString(existingTaskId, 'taskId', 128)
        : undefined;
      return await resumeDesktopSessionRequest({
        window,
        sender: event.sender,
        validatedSessionId,
        validatedPrompt,
        validatedExistingTaskId,
        attachedFiles,
        privacyMode,
        usageProjectId: usageProjectId ? sanitizeString(usageProjectId, 'usageProjectId', 128) : null,
        resumeOptions: options && typeof options === 'object'
          ? {
              workingDirectory: options.workingDirectory
                ? sanitizeString(options.workingDirectory, 'resumeOptions.workingDirectory', 1024)
                : undefined,
              requiresBrowser: options.requiresBrowser === true || options.requiresBrowser === false
                ? options.requiresBrowser
                : undefined,
              buildMode: options.buildMode === true,
              buildWorkspaceRelativePath: options.buildWorkspaceRelativePath
                ? sanitizeString(options.buildWorkspaceRelativePath, 'resumeOptions.buildWorkspaceRelativePath', 300)
                : undefined,
            }
          : undefined,
        applyAgentContext,
      });
    }
  );

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
      if (config.toolMode !== undefined) {
        const requestedToolMode = String(config.toolMode);
        const normalizedToolMode = requestedToolMode === 'basic' ? 'internet' : requestedToolMode;
        if (
          normalizedToolMode !== 'off'
          && normalizedToolMode !== 'internet'
          && normalizedToolMode !== 'workspace-read'
          && normalizedToolMode !== 'workspace-edit'
          && normalizedToolMode !== 'desktop'
          && normalizedToolMode !== 'full'
        ) {
          throw new Error('Invalid Ollama configuration: invalid tool mode');
        }
        config.toolMode = normalizedToolMode as OllamaConfig['toolMode'];
      }
      if (config.toolsetIds !== undefined) {
        config.toolsetIds = sanitizeToolsetIds(config.toolsetIds, 'toolsetIds');
      }
      // Validate optional models array if present
      if (config.models !== undefined) {
        if (!Array.isArray(config.models)) {
          throw new Error('Invalid Ollama configuration: models must be an array');
        }
        for (const [index, model] of config.models.entries()) {
          if (typeof model.id !== 'string' || typeof model.displayName !== 'string' || typeof model.size !== 'number') {
            throw new Error('Invalid Ollama configuration: invalid model format');
          }
          if (model.toolsetIds !== undefined) {
            model.toolsetIds = sanitizeToolsetIds(model.toolsetIds, `models[${index}].toolsetIds`);
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

  handle('settings:execution-profiles:list', async (_event: IpcMainInvokeEvent, payload?: { includeArchived?: unknown }) => {
    return listExecutionProfiles({ includeArchived: payload?.includeArchived === true });
  });

  handle('settings:execution-profiles:create', async (_event: IpcMainInvokeEvent, payload: ExecutionProfileCreateInput) => {
    return createExecutionProfile(payload);
  });

  handle('settings:execution-profiles:update', async (
    _event: IpcMainInvokeEvent,
    payload: { profileId?: unknown; update?: ExecutionProfileUpdateInput }
  ) => {
    const profileId = sanitizeString(payload?.profileId, 'profileId', 64);
    return updateExecutionProfile(profileId, payload?.update || {});
  });

  handle('settings:execution-profiles:archive', async (
    _event: IpcMainInvokeEvent,
    payload: { profileId?: unknown; archived?: unknown }
  ) => {
    const profileId = sanitizeString(payload?.profileId, 'profileId', 64);
    return archiveExecutionProfile(profileId, payload?.archived !== false);
  });

  handle('settings:execution-profiles:health-check', async (
    _event: IpcMainInvokeEvent,
    payload: { profileId?: unknown }
  ) => {
    const profileId = sanitizeString(payload?.profileId, 'profileId', 64);
    return checkExecutionProfileHealth(profileId);
  });

  handle('settings:runtime-hooks:get', async () => {
    return readRuntimeHooksRegistryRaw();
  });

  handle('settings:runtime-hooks:save', async (_event: IpcMainInvokeEvent, raw: string) => {
    if (typeof raw !== 'string') {
      throw new Error('Runtime hooks payload must be a string');
    }
    return saveRuntimeHooksRegistryRaw(raw);
  });

  handle('settings:runtime-hooks:diagnostics', async () => {
    return { entries: listHookDiagnostics() };
  });

  handle('settings:runtime-hooks:clear-diagnostics', async () => {
    clearHookDiagnostics();
    return { ok: true };
  });

  handle('settings:permission-policy:get', async () => {
    return getPermissionPolicySettings();
  });

  handle('settings:permission-policy:set', async (_event: IpcMainInvokeEvent, settings: unknown) => {
    return setPermissionPolicySettings(settings as PermissionPolicySettings);
  });

  handle('settings:permission-policy:audit', async () => {
    return { entries: listPermissionPolicyAuditEntries() };
  });

  handle('settings:permission-policy:opencode-preview', async (_event: IpcMainInvokeEvent, agentId?: string) => {
    const sanitizedAgentId = typeof agentId === 'string' && agentId.trim()
      ? sanitizeString(agentId, 'agentId', 64)
      : undefined;
    return getOpenCodePermissionPreview(sanitizedAgentId);
  });

  handle('settings:permission-policy:clear-audit', async () => {
    clearPermissionPolicyAuditEntries();
    return { ok: true };
  });

  handle('settings:plugins:list', async () => {
    return listPluginRegistry();
  });

  handle('plugins:commands:list', async () => {
    return { commands: listRegisteredPluginCommands() };
  });

  handle('settings:plugins:diagnostics', async () => {
    return getPluginDiagnosticsState();
  });

  handle('settings:plugins:clear-diagnostics-history', async () => {
    return clearPluginDiagnosticsHistory();
  });

  handle('settings:plugins:set-enabled', async (_event: IpcMainInvokeEvent, payload: { pluginId?: string; enabled?: boolean }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid plugin payload');
    }
    const pluginId = sanitizeString(payload.pluginId, 'pluginId', 80);
    if (typeof payload.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    const result = setPluginEnabled(pluginId, payload.enabled);
    recordPluginRegistrationDiagnostics(payload.enabled ? 'enable' : 'disable');
    notifyHelpDocsChanged();
    return result;
  });

  handle('settings:plugins:install-from-directory', async (_event: IpcMainInvokeEvent, payload: { sourceDir?: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid plugin install payload');
    }
    const sourceDir = sanitizeString(payload.sourceDir, 'sourceDir', 1024);
    const result = installManagedPluginFromDirectory(sourceDir);
    recordPluginRegistrationDiagnostics('install');
    notifyHelpDocsChanged();
    return result;
  });

  handle('settings:plugins:uninstall', async (_event: IpcMainInvokeEvent, payload: { pluginId?: string }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid plugin uninstall payload');
    }
    const pluginId = sanitizeString(payload.pluginId, 'pluginId', 80);
    const result = uninstallManagedPlugin(pluginId);
    recordPluginRegistrationDiagnostics('uninstall');
    notifyHelpDocsChanged();
    return result;
  });

  handle('settings:plugins:open-managed-root', async () => {
    const pluginRoot = getManagedPluginsRootPath();
    const result = await shell.openPath(pluginRoot);
    if (result) {
      return { ok: false, path: pluginRoot, error: result };
    }
    return { ok: true, path: pluginRoot };
  });

  handle('search:index:rebuild', async (_event: IpcMainInvokeEvent, payload?: SearchIndexRebuildRequest) => {
    const agentId = typeof payload?.agentId === 'string' && payload.agentId.trim()
      ? sanitizeString(payload.agentId, 'agentId', 64)
      : undefined;
    return rebuildLocalSearchIndex({
      agentId,
      includeGit: payload?.includeGit !== false,
    });
  });

  handle('search:query', async (_event: IpcMainInvokeEvent, payload: SearchQueryRequest) => {
    const query = sanitizeOptionalText(payload?.query, 'query', 1000);
    const sources = Array.isArray(payload?.sources)
      ? payload.sources.filter((source): source is LocalSearchSource => ALLOWED_SEARCH_SOURCES.has(source as LocalSearchSource))
      : undefined;
    const agentId = typeof payload?.agentId === 'string' && payload.agentId.trim()
      ? sanitizeString(payload.agentId, 'agentId', 64)
      : undefined;
    const taskId = typeof payload?.taskId === 'string' && payload.taskId.trim()
      ? sanitizeString(payload.taskId, 'taskId', 128)
      : undefined;
    const projectId = typeof payload?.projectId === 'string' && payload.projectId.trim()
      ? sanitizeString(payload.projectId, 'projectId', 128)
      : undefined;
    const connectorId = typeof payload?.connectorId === 'string' && payload.connectorId.trim()
      ? sanitizeString(payload.connectorId, 'connectorId', 128)
      : undefined;
    const connectorInstanceId = typeof payload?.connectorInstanceId === 'string' && payload.connectorInstanceId.trim()
      ? sanitizeString(payload.connectorInstanceId, 'connectorInstanceId', 128)
      : undefined;
    const skillId = typeof payload?.skillId === 'string' && payload.skillId.trim()
      ? sanitizeString(payload.skillId, 'skillId', 128)
      : undefined;
    const memoryKind = typeof payload?.memoryKind === 'string' && payload.memoryKind.trim()
      ? sanitizeString(payload.memoryKind, 'memoryKind', 64)
      : undefined;
    const category = typeof payload?.category === 'string' && ALLOWED_AUDIT_CATEGORIES.has(payload.category as AuditEventCategory)
      ? payload.category as AuditEventCategory
      : undefined;
    const status = typeof payload?.status === 'string'
      && ['info', 'success', 'warning', 'error'].includes(payload.status)
      ? payload.status as AuditListRequest['status']
      : undefined;
    const limit = typeof payload?.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(200, Math.floor(payload.limit)))
      : undefined;
    return queryLocalSearch({
      query,
      sources,
      agentId,
      taskId,
      projectId,
      connectorId,
      connectorInstanceId,
      skillId,
      memoryKind,
      category,
      status,
      since: sanitizeOptionalText(payload?.since, 'since', 80) || undefined,
      until: sanitizeOptionalText(payload?.until, 'until', 80) || undefined,
      limit,
    });
  });

  handle('search:item:get', async (_event: IpcMainInvokeEvent, payload: SearchItemGetRequest) => {
    const id = sanitizeString(payload?.id, 'id', 128);
    return getLocalSearchItem({ id });
  });

  handle('audit:list', async (_event: IpcMainInvokeEvent, payload?: AuditListRequest) => {
    const category = typeof payload?.category === 'string' && ALLOWED_AUDIT_CATEGORIES.has(payload.category as AuditEventCategory)
      ? payload.category as AuditEventCategory
      : undefined;
    const query = sanitizeOptionalText(payload?.query, 'query', 1000) || undefined;
    const limit = typeof payload?.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(1000, Math.floor(payload.limit)))
      : undefined;
    return listAuditEvents({
      category,
      query,
      status: typeof payload?.status === 'string' && ['info', 'success', 'warning', 'error'].includes(payload.status)
        ? payload.status as AuditListRequest['status']
        : undefined,
      agentId: typeof payload?.agentId === 'string' && payload.agentId.trim() ? sanitizeString(payload.agentId, 'agentId', 64) : undefined,
      taskId: typeof payload?.taskId === 'string' && payload.taskId.trim() ? sanitizeString(payload.taskId, 'taskId', 128) : undefined,
      projectId: typeof payload?.projectId === 'string' && payload.projectId.trim() ? sanitizeString(payload.projectId, 'projectId', 128) : undefined,
      connectorId: typeof payload?.connectorId === 'string' && payload.connectorId.trim() ? sanitizeString(payload.connectorId, 'connectorId', 128) : undefined,
      connectorInstanceId: typeof payload?.connectorInstanceId === 'string' && payload.connectorInstanceId.trim() ? sanitizeString(payload.connectorInstanceId, 'connectorInstanceId', 128) : undefined,
      skillId: typeof payload?.skillId === 'string' && payload.skillId.trim() ? sanitizeString(payload.skillId, 'skillId', 128) : undefined,
      memoryKind: typeof payload?.memoryKind === 'string' && payload.memoryKind.trim() ? sanitizeString(payload.memoryKind, 'memoryKind', 64) : undefined,
      targetType: typeof payload?.targetType === 'string' && payload.targetType.trim() ? sanitizeString(payload.targetType, 'targetType', 80) : undefined,
      targetId: typeof payload?.targetId === 'string' && payload.targetId.trim() ? sanitizeString(payload.targetId, 'targetId', 128) : undefined,
      since: sanitizeOptionalText(payload?.since, 'since', 80) || undefined,
      until: sanitizeOptionalText(payload?.until, 'until', 80) || undefined,
      limit,
      includeDerived: payload?.includeDerived !== false,
    });
  });

  handle('audit:get', async (_event: IpcMainInvokeEvent, payload: AuditGetRequest) => {
    const id = sanitizeString(payload?.id, 'id', 128);
    return getAuditEvent({ id });
  });

  handle('audit:export', async (_event: IpcMainInvokeEvent, payload?: AuditExportRequest) => {
    const category = typeof payload?.category === 'string' && ALLOWED_AUDIT_CATEGORIES.has(payload.category as AuditEventCategory)
      ? payload.category as AuditEventCategory
      : undefined;
    const format = payload?.format === 'jsonl' || payload?.format === 'csv' ? payload.format : 'json';
    const query = sanitizeOptionalText(payload?.query, 'query', 1000) || undefined;
    return exportAuditEvents({
      category,
      query,
      status: typeof payload?.status === 'string' && ['info', 'success', 'warning', 'error'].includes(payload.status)
        ? payload.status as AuditExportRequest['status']
        : undefined,
      agentId: typeof payload?.agentId === 'string' && payload.agentId.trim() ? sanitizeString(payload.agentId, 'agentId', 64) : undefined,
      taskId: typeof payload?.taskId === 'string' && payload.taskId.trim() ? sanitizeString(payload.taskId, 'taskId', 128) : undefined,
      projectId: typeof payload?.projectId === 'string' && payload.projectId.trim() ? sanitizeString(payload.projectId, 'projectId', 128) : undefined,
      connectorId: typeof payload?.connectorId === 'string' && payload.connectorId.trim() ? sanitizeString(payload.connectorId, 'connectorId', 128) : undefined,
      connectorInstanceId: typeof payload?.connectorInstanceId === 'string' && payload.connectorInstanceId.trim() ? sanitizeString(payload.connectorInstanceId, 'connectorInstanceId', 128) : undefined,
      skillId: typeof payload?.skillId === 'string' && payload.skillId.trim() ? sanitizeString(payload.skillId, 'skillId', 128) : undefined,
      memoryKind: typeof payload?.memoryKind === 'string' && payload.memoryKind.trim() ? sanitizeString(payload.memoryKind, 'memoryKind', 64) : undefined,
      targetType: typeof payload?.targetType === 'string' && payload.targetType.trim() ? sanitizeString(payload.targetType, 'targetType', 80) : undefined,
      targetId: typeof payload?.targetId === 'string' && payload.targetId.trim() ? sanitizeString(payload.targetId, 'targetId', 128) : undefined,
      since: sanitizeOptionalText(payload?.since, 'since', 80) || undefined,
      until: sanitizeOptionalText(payload?.until, 'until', 80) || undefined,
      includeDerived: payload?.includeDerived !== false,
      format,
    });
  });

  // Saved prompts (shared between desktop renderer and webchat)
  handle('saved-prompts:list', async () => {
    return listSavedPrompts();
  });

  handle('saved-prompts:categories:list', async () => {
    return listSavedPromptCategories();
  });

  handle('saved-prompts:categories:create', async (_event: IpcMainInvokeEvent, name: string) => {
    return createSavedPromptCategory(sanitizeString(name, 'category', 80));
  });

  handle(
    'saved-prompts:categories:rename',
    async (_event: IpcMainInvokeEvent, payload: { from?: unknown; to?: unknown }) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid category rename payload');
      }
      return renameSavedPromptCategory(
        sanitizeString(String(payload.from ?? ''), 'from', 80),
        sanitizeString(String(payload.to ?? ''), 'to', 80)
      );
    }
  );

  handle(
    'saved-prompts:categories:delete',
    async (_event: IpcMainInvokeEvent, payload: { name?: unknown; replacement?: unknown }) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid category delete payload');
      }
      const replacement = payload.replacement == null
        ? undefined
        : sanitizeString(String(payload.replacement), 'replacement', 80);
      return deleteSavedPromptCategory(
        sanitizeString(String(payload.name ?? ''), 'category', 80),
        replacement
      );
    }
  );

  handle(
    'saved-prompts:upsert',
    async (
      _event: IpcMainInvokeEvent,
      payload: { id?: string; title: string; content: string; category?: string; description?: string; icon?: string; color?: string; createdAt?: string; updatedAt?: string }
    ) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid saved prompt payload');
      }
      const id = payload.id ? sanitizeString(payload.id, 'id', 128) : undefined;
      const title = sanitizeString(payload.title, 'title', 256);
      const content = sanitizeString(payload.content, 'content', 50_000);
      const category = payload.category ? sanitizeString(payload.category, 'category', 80) : undefined;
      const description = payload.description ? sanitizeString(payload.description, 'description', 240) : undefined;
      const icon = payload.icon ? sanitizeString(payload.icon, 'icon', 12) : undefined;
      const color = payload.color ? sanitizeString(payload.color, 'color', 32) : undefined;
      const createdAt = payload.createdAt ? sanitizeString(payload.createdAt, 'createdAt', 64) : undefined;
      const updatedAt = payload.updatedAt ? sanitizeString(payload.updatedAt, 'updatedAt', 64) : undefined;
      return upsertSavedPrompt({ id, title, content, category, description, icon, color, createdAt, updatedAt });
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
      const legacyInputCostPer1m = typeof row.inputCostPer1m === 'number' && Number.isFinite(row.inputCostPer1m) ? row.inputCostPer1m : null;
      const inputHitCostPer1m = typeof row.inputHitCostPer1m === 'number' && Number.isFinite(row.inputHitCostPer1m) ? row.inputHitCostPer1m : null;
      const inputMissCostPer1m = typeof row.inputMissCostPer1m === 'number' && Number.isFinite(row.inputMissCostPer1m) ? row.inputMissCostPer1m : legacyInputCostPer1m;
      const outputCostPer1m = typeof row.outputCostPer1m === 'number' && Number.isFinite(row.outputCostPer1m) ? row.outputCostPer1m : null;
      const effectiveFrom = row.effectiveFrom ? sanitizeString(row.effectiveFrom, 'effectiveFrom', 32) : null;
      const pricingSource: 'manual' | 'ai' = row.pricingSource === 'ai' ? 'ai' : 'manual';
      const pricingUpdatedAt = row.pricingUpdatedAt ? sanitizeString(row.pricingUpdatedAt, 'pricingUpdatedAt', 64) : new Date().toISOString();
      const createdAt = row.createdAt ? sanitizeString(row.createdAt, 'createdAt', 64) : new Date().toISOString();
      return {
        provider,
        model,
        inputHitCostPer1m,
        inputMissCostPer1m,
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

  handle('usage:projects:list', async (_event: IpcMainInvokeEvent, payload?: { includeArchived?: unknown }) => {
    return listUsageProjects({ includeArchived: Boolean(payload?.includeArchived) });
  });

  handle('usage:projects:create', async (_event: IpcMainInvokeEvent, input: UsageProjectInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid usage project input');
    return createUsageProject({
      name: sanitizeString(input.name, 'name', 120),
      color: input.color ? sanitizeString(input.color, 'color', 32) : undefined,
      trackingEnabled: input.trackingEnabled !== false,
      ...sanitizeUsageProjectMetadata(input, true),
    });
  });

  handle('usage:projects:update', async (_event: IpcMainInvokeEvent, projectId: string, update: UsageProjectUpdate) => {
    const sanitizedId = sanitizeString(projectId, 'projectId', 128);
    if (!update || typeof update !== 'object') throw new Error('Invalid usage project update');
    return updateUsageProject(sanitizedId, {
      name: update.name !== undefined ? sanitizeString(update.name, 'name', 120) : undefined,
      color: update.color === null ? null : update.color !== undefined ? sanitizeString(update.color, 'color', 32) : undefined,
      trackingEnabled: update.trackingEnabled,
      status: update.status === 'archived' ? 'archived' : update.status === 'active' ? 'active' : undefined,
      ...sanitizeUsageProjectMetadata(update),
    });
  });

  handle('usage:projects:archive', async (_event: IpcMainInvokeEvent, projectId: string, archived?: boolean) => {
    return archiveUsageProject(sanitizeString(projectId, 'projectId', 128), archived !== false);
  });

  handle('usage:assignees:list', async (_event: IpcMainInvokeEvent, payload?: { includeArchived?: unknown }) => {
    return listUsageAssignees({ includeArchived: Boolean(payload?.includeArchived) });
  });

  handle('usage:assignees:create', async (_event: IpcMainInvokeEvent, input: UsageAssigneeInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid assignee input');
    return createUsageAssignee({
      ...sanitizeUsageAssigneePayload(input, true),
      name: sanitizeString(input.name, 'name', 120),
    });
  });

  handle('usage:assignees:update', async (_event: IpcMainInvokeEvent, assigneeId: string, update: UsageAssigneeUpdate) => {
    const sanitizedId = sanitizeString(assigneeId, 'assigneeId', 128);
    if (!update || typeof update !== 'object') throw new Error('Invalid assignee update');
    return updateUsageAssignee(sanitizedId, {
      ...sanitizeUsageAssigneePayload(update),
      name: update.name !== undefined ? sanitizeString(update.name, 'name', 120) : undefined,
      color: update.color === null ? null : update.color !== undefined ? sanitizeOptionalText(update.color, 'color', 32).trim() : undefined,
      status: update.status === 'archived' ? 'archived' : update.status === 'active' ? 'active' : undefined,
    });
  });

  handle('usage:assignees:archive', async (_event: IpcMainInvokeEvent, assigneeId: string, archived?: boolean) => {
    return archiveUsageAssignee(sanitizeString(assigneeId, 'assigneeId', 128), archived !== false);
  });

  handle('usage:assignee-overview:get', async (_event: IpcMainInvokeEvent, payload?: { assigneeId?: unknown }) => {
    const assigneeId = payload?.assigneeId ? sanitizeString(payload.assigneeId, 'assigneeId', 128) : null;
    const projects = listUsageProjects({ includeArchived: true });
    return listUsageAssignees({ includeArchived: true })
      .filter((assignee) => !assigneeId || assignee.id === assigneeId)
      .map((assignee) => {
        const assignedProjects = projects.filter((project) => (project.assigneeIds || []).includes(assignee.id));
        return {
          assignee,
          activeBudgetCount: assignedProjects.filter((project) => project.status === 'active').length,
          chatProjectCount: 0,
          buildPresetCount: 0,
          buildSessionCount: 0,
          taskCount: 0,
          runCount: 0,
          inputHitTokens: 0,
          inputMissTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: null,
          work: assignedProjects.map((project) => ({
            id: project.id,
            type: 'budget',
            name: project.name,
            usageProjectId: project.id,
            usageProjectName: project.name,
            detail: project.status,
          })),
        };
      });
  });

  handle('usage:project-budget-windows:list', async (_event: IpcMainInvokeEvent, payload?: { projectId?: unknown }) => {
    const projectId = payload?.projectId ? sanitizeString(payload.projectId, 'projectId', 128) : undefined;
    return listUsageProjectBudgetWindows(projectId);
  });

  handle('usage:project-budget-windows:create', async (_event: IpcMainInvokeEvent, input: UsageProjectBudgetWindowInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid budget window input');
    return createUsageProjectBudgetWindow({
      projectId: sanitizeString(input.projectId, 'projectId', 128),
      name: input.name ? sanitizeString(input.name, 'name', 120) : undefined,
      startsAt: sanitizeString(input.startsAt, 'startsAt', 64),
      endsAt: input.endsAt ? sanitizeString(input.endsAt, 'endsAt', 64) : null,
      enabled: input.enabled !== false,
      mode: input.mode === 'block' ? 'block' : 'warn',
      moneyLimit: typeof input.moneyLimit === 'number' && Number.isFinite(input.moneyLimit) ? input.moneyLimit : null,
      tokenLimit: typeof input.tokenLimit === 'number' && Number.isFinite(input.tokenLimit) ? input.tokenLimit : null,
      currency: input.currency,
    });
  });

  handle('usage:project-budget-windows:update', async (_event: IpcMainInvokeEvent, windowId: string, update: UsageProjectBudgetWindowUpdate) => {
    if (!update || typeof update !== 'object') throw new Error('Invalid budget window update');
    return updateUsageProjectBudgetWindow(sanitizeString(windowId, 'windowId', 128), {
      projectId: update.projectId ? sanitizeString(update.projectId, 'projectId', 128) : undefined,
      name: update.name !== undefined ? sanitizeString(update.name, 'name', 120) : undefined,
      startsAt: update.startsAt !== undefined ? sanitizeString(update.startsAt, 'startsAt', 64) : undefined,
      endsAt: update.endsAt ? sanitizeString(update.endsAt, 'endsAt', 64) : update.endsAt === null ? null : undefined,
      enabled: update.enabled,
      mode: update.mode === 'block' ? 'block' : update.mode === 'warn' ? 'warn' : undefined,
      moneyLimit: typeof update.moneyLimit === 'number' && Number.isFinite(update.moneyLimit) ? update.moneyLimit : update.moneyLimit === null ? null : undefined,
      tokenLimit: typeof update.tokenLimit === 'number' && Number.isFinite(update.tokenLimit) ? update.tokenLimit : update.tokenLimit === null ? null : undefined,
      currency: update.currency,
    });
  });

  handle('usage:project-budget-windows:delete', async (_event: IpcMainInvokeEvent, windowId: string) => {
    return deleteUsageProjectBudgetWindow(sanitizeString(windowId, 'windowId', 128));
  });

  handle('usage:project-summary:get', async (_event: IpcMainInvokeEvent, payload: { projectId?: unknown; startsAt?: unknown; endsAt?: unknown; windowId?: unknown }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid project summary request');
    return getUsageProjectSummary({
      projectId: sanitizeString(payload.projectId, 'projectId', 128),
      startsAt: payload.startsAt ? sanitizeString(payload.startsAt, 'startsAt', 64) : undefined,
      endsAt: payload.endsAt ? sanitizeString(payload.endsAt, 'endsAt', 64) : null,
      windowId: payload.windowId ? sanitizeString(payload.windowId, 'windowId', 128) : undefined,
    });
  });

  handle('usage:project-analytics:get', async (_event: IpcMainInvokeEvent, payload: { projectId?: unknown; startsAt?: unknown; endsAt?: unknown; windowId?: unknown; days?: unknown }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid project analytics request');
    return getUsageProjectAnalytics({
      projectId: sanitizeString(payload.projectId, 'projectId', 128),
      startsAt: payload.startsAt ? sanitizeString(payload.startsAt, 'startsAt', 64) : undefined,
      endsAt: payload.endsAt ? sanitizeString(payload.endsAt, 'endsAt', 64) : null,
      windowId: payload.windowId ? sanitizeString(payload.windowId, 'windowId', 128) : undefined,
      days: typeof payload.days === 'number' ? payload.days : undefined,
    });
  });

  handle('usage:project-budget-status:get', async (_event: IpcMainInvokeEvent, payload?: { projectId?: unknown }) => {
    const projectId = payload?.projectId ? sanitizeString(payload.projectId, 'projectId', 128) : null;
    return getUsageProjectBudgetStatus(projectId);
  });

  handle('usage:project-work-items:list', async (_event: IpcMainInvokeEvent, payload: { projectId?: unknown; includeArchived?: unknown }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid work item list request');
    return listUsageProjectWorkItems(
      sanitizeString(payload.projectId, 'projectId', 128),
      { includeArchived: payload.includeArchived === true }
    );
  });

  handle('usage:project-work-items:create', async (_event: IpcMainInvokeEvent, input: UsageProjectWorkItemInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid work item input');
    const sanitized = sanitizeWorkItemPayload(input, true);
    return createUsageProjectWorkItem({
      ...sanitized,
      usageProjectId: sanitizeString(input.usageProjectId, 'usageProjectId', 128),
      title: sanitizeString(input.title, 'title', 180),
    });
  });

  handle('usage:project-work-items:update', async (_event: IpcMainInvokeEvent, itemId: string, update: UsageProjectWorkItemUpdate) => {
    if (!update || typeof update !== 'object') throw new Error('Invalid work item update');
    return updateUsageProjectWorkItem(
      sanitizeString(itemId, 'itemId', 128),
      {
        ...sanitizeWorkItemPayload(update),
        usageProjectId: update.usageProjectId ? sanitizeString(update.usageProjectId, 'usageProjectId', 128) : undefined,
      }
    );
  });

  handle('usage:project-work-items:archive', async (_event: IpcMainInvokeEvent, itemId: string, archived?: boolean) => {
    return archiveUsageProjectWorkItem(sanitizeString(itemId, 'itemId', 128), archived !== false);
  });

  handle('usage:project-kanban-columns:list', async (_event: IpcMainInvokeEvent, payload: { projectId?: unknown }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid Kanban column list request');
    return listUsageProjectKanbanColumns(sanitizeString(payload.projectId, 'projectId', 128));
  });

  handle('usage:project-kanban-columns:create', async (_event: IpcMainInvokeEvent, input: UsageProjectKanbanColumnInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid Kanban column input');
    return createUsageProjectKanbanColumn({
      usageProjectId: sanitizeString(input.usageProjectId, 'usageProjectId', 128),
      name: sanitizeString(input.name, 'name', 80),
      order: typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : undefined,
      color: input.color ? sanitizeString(input.color, 'color', 32) : undefined,
      wipLimit: typeof input.wipLimit === 'number' && Number.isFinite(input.wipLimit) ? input.wipLimit : input.wipLimit === null ? null : undefined,
      doneState: input.doneState === true,
      archivedState: input.archivedState === true,
    });
  });

  handle('usage:project-kanban-columns:update', async (_event: IpcMainInvokeEvent, columnId: string, update: UsageProjectKanbanColumnUpdate) => {
    if (!update || typeof update !== 'object') throw new Error('Invalid Kanban column update');
    return updateUsageProjectKanbanColumn(sanitizeString(columnId, 'columnId', 128), {
      usageProjectId: update.usageProjectId ? sanitizeString(update.usageProjectId, 'usageProjectId', 128) : undefined,
      name: update.name !== undefined ? sanitizeString(update.name, 'name', 80) : undefined,
      order: typeof update.order === 'number' && Number.isFinite(update.order) ? update.order : undefined,
      color: update.color !== undefined ? sanitizeOptionalText(update.color, 'color', 32).trim() : undefined,
      wipLimit: typeof update.wipLimit === 'number' && Number.isFinite(update.wipLimit) ? update.wipLimit : update.wipLimit === null ? null : undefined,
      doneState: update.doneState,
      archivedState: update.archivedState,
    });
  });

  handle('usage:project-kanban-columns:delete', async (_event: IpcMainInvokeEvent, columnId: string) => {
    return deleteUsageProjectKanbanColumn(sanitizeString(columnId, 'columnId', 128));
  });

  handle('usage:budgets:get', async () => {
    return getUsageBudgetSettings();
  });

  handle('usage:budgets:set', async (_event: IpcMainInvokeEvent, settings: UsageBudgetSettings) => {
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings');
    return setUsageBudgetSettings(settings);
  });

  handle('usage:budget-status:get', async (_event: IpcMainInvokeEvent, payload?: { agentId?: unknown }) => {
    const agentId = payload?.agentId ? sanitizeString(payload.agentId, 'agentId', 64) : null;
    return getUsageBudgetStatus(agentId);
  });

  // Settings: Memory (user context)
  handle('settings:memory:get', async (_event: IpcMainInvokeEvent, payload?: { agentId?: string; date?: string }) => {
    return getMemoryState(payload?.agentId, payload?.date);
  });

  handle('settings:memory:read', async (_event: IpcMainInvokeEvent, payload: { kind: 'user' | 'long-term' | 'daily' | 'snapshot'; date?: string; fileName?: string; agentId?: string }) => {
    if (!payload || (payload.kind !== 'user' && payload.kind !== 'long-term' && payload.kind !== 'daily' && payload.kind !== 'snapshot')) {
      throw new Error('Invalid memory read request');
    }
    return readMemoryFile(payload.kind, payload.date, payload.agentId, payload.fileName);
  });

  handle('settings:memory:save', async (_event: IpcMainInvokeEvent, payload: { kind: 'user' | 'long-term' | 'daily' | 'snapshot'; date?: string; fileName?: string; agentId?: string; content?: string }) => {
    if (!payload || (payload.kind !== 'user' && payload.kind !== 'long-term' && payload.kind !== 'daily' && payload.kind !== 'snapshot')) {
      throw new Error('Invalid memory save request');
    }
    const content = sanitizeOptionalText(payload.content, 'content', 200000);
    return saveMemoryFile(payload.kind, content, payload.date, payload.agentId, payload.fileName);
  });

  handle('settings:memory:delete', async (_event: IpcMainInvokeEvent, payload: { kind?: unknown; date?: string; fileName?: string; agentId?: string }) => {
    const kind = sanitizeString(payload?.kind, 'kind', 24) as 'user' | 'long-term' | 'daily' | 'snapshot';
    if (kind !== 'user' && kind !== 'long-term' && kind !== 'daily' && kind !== 'snapshot') {
      throw new Error('Invalid memory delete request');
    }
    return deleteMemoryFile({
      kind,
      date: payload?.date,
      fileName: payload?.fileName,
      agentId: payload?.agentId,
    });
  });

  handle('settings:memory:search', async (_event: IpcMainInvokeEvent, payload?: { query?: unknown; agentId?: string; limit?: unknown }) => {
    const query = sanitizeOptionalText(payload?.query, 'query', 400) || '';
    const limit = payload?.limit == null
      ? 50
      : sanitizeIntegerRange(payload.limit, 'limit', 1, 100, 50);
    return searchMemory({ query, agentId: payload?.agentId, limit });
  });

  handle('memory:changes:list', async (_event: IpcMainInvokeEvent, payload?: {
    limit?: unknown;
    kind?: unknown;
    status?: unknown;
    agentId?: unknown;
    taskId?: unknown;
    source?: unknown;
    includeReverted?: unknown;
    since?: unknown;
    until?: unknown;
  }) => {
    const limit = payload?.limit == null
      ? 50
      : sanitizeIntegerRange(payload.limit, 'limit', 1, 200, 50);
    const allowedKinds = new Set(['user', 'long-term', 'daily', 'snapshot']);
    const allowedStatuses = new Set(['automatic', 'staged', 'applied', 'reverted']);
    const sanitizeStringArray = (value: unknown, field: string, maxLength: number): string[] | undefined => {
      if (value == null) return undefined;
      const raw = Array.isArray(value) ? value : [value];
      const sanitized = raw
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => sanitizeString(entry, field, maxLength));
      return sanitized.length > 0 ? Array.from(new Set(sanitized)) : undefined;
    };
    const kinds = sanitizeStringArray(payload?.kind, 'kind', 24)?.filter((entry): entry is MemoryKind =>
      allowedKinds.has(entry)
    );
    const statuses = sanitizeStringArray(payload?.status, 'status', 24)?.filter((entry): entry is MemoryChangeStatus =>
      allowedStatuses.has(entry)
    );
    const sources = sanitizeStringArray(payload?.source, 'source', 80);
    return {
      changes: listMemoryChangeHistory({
        limit,
        kind: kinds,
        status: statuses,
        agentId: typeof payload?.agentId === 'string' && payload.agentId.trim()
          ? sanitizeString(payload.agentId, 'agentId', 64)
          : undefined,
        taskId: typeof payload?.taskId === 'string' && payload.taskId.trim()
          ? sanitizeString(payload.taskId, 'taskId', 128)
          : undefined,
        source: sources,
        includeReverted: typeof payload?.includeReverted === 'boolean' ? payload.includeReverted : undefined,
        since: typeof payload?.since === 'string' && payload.since.trim()
          ? sanitizeString(payload.since, 'since', 40)
          : undefined,
        until: typeof payload?.until === 'string' && payload.until.trim()
          ? sanitizeString(payload.until, 'until', 40)
          : undefined,
      }),
    };
  });

  handle('memory:changes:apply', async (_event: IpcMainInvokeEvent, payload: { changeId?: unknown }) => {
    const changeId = sanitizeString(payload?.changeId, 'changeId', 128);
    return applyStagedMemoryFileWrite(changeId);
  });

  handle('memory:changes:rollback', async (_event: IpcMainInvokeEvent, payload: { changeId?: unknown }) => {
    const changeId = sanitizeString(payload?.changeId, 'changeId', 128);
    return rollbackMemoryFileChange(changeId);
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

  handle('files:save-data-url-as', async (event: IpcMainInvokeEvent, payload: { dataUrl?: string; baseName?: string }) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : '';
    const baseName = typeof payload?.baseName === 'string' ? payload.baseName : 'snapshot';
    if (!dataUrl) {
      throw new Error('dataUrl is required');
    }
    return saveDataUrlToChosenFile(window, dataUrl, baseName);
  });

  handle('files:save-text-as', async (event: IpcMainInvokeEvent, payload: {
    content?: string;
    baseName?: string;
    extension?: string;
    title?: string;
  }) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (!content) {
      throw new Error('content is required');
    }
    const extension = sanitizeString(payload?.extension || 'txt', 'extension', 12).replace(/^\.+/, '') || 'txt';
    return saveTextToChosenFile(window, {
      content,
      baseName: payload?.baseName || 'document',
      extension,
      title: payload?.title || 'Save file',
      filters: extension === 'rtf'
        ? [
            { name: 'Rich Text Format', extensions: ['rtf'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ]
        : undefined,
    });
  });

  handle('window:capture-rect', async (event: IpcMainInvokeEvent, payload: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }) => {
    const window = assertTrustedWindow(BrowserWindow.fromWebContents(event.sender));
    const x = Math.max(0, Math.round(Number(payload?.x) || 0));
    const y = Math.max(0, Math.round(Number(payload?.y) || 0));
    const width = Math.max(1, Math.min(6000, Math.round(Number(payload?.width) || 0)));
    const height = Math.max(1, Math.min(6000, Math.round(Number(payload?.height) || 0)));
    const image = await window.webContents.capturePage({ x, y, width, height });
    return { dataUrl: image.toDataURL() };
  });

  handle('runtime-preview:capture-full-page', async (_event: IpcMainInvokeEvent, payload: { url?: unknown }) => {
    const url = typeof payload?.url === 'string' ? payload.url : '';
    if (!url) {
      throw new Error('Runtime preview URL is required.');
    }
    return captureRuntimePreviewFullPage(url);
  });

  handle('chat-tool-compatibility:check', async (
    _event: IpcMainInvokeEvent,
    payload?: {
      agentId?: unknown;
      model?: SelectedModel | null;
      deferredToolDiscoveryEnabled?: unknown;
    }
  ): Promise<ChatToolCompatibilityCheckResult> => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const model = payload?.model == null
      ? undefined
      : sanitizeSelectedModel(payload.model, 'model');
    const deferredToolDiscoveryEnabled = payload?.deferredToolDiscoveryEnabled === true;
    const proof = proveChatDeferredToolCompatibility();
    const unique = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));
    const missingCapabilities = unique(proof.cases.flatMap((regressionCase) => [
      ...regressionCase.baselineAvailability.missingCapabilities,
      ...regressionCase.deferredAvailability.expanded.missingCapabilities,
    ]));
    const missingTools = unique(proof.cases.flatMap((regressionCase) => [
      ...regressionCase.baselineAvailability.missingTools,
      ...regressionCase.deferredAvailability.expanded.missingTools,
    ]));

    return {
      agentId,
      model,
      checkedAt: new Date().toISOString(),
      backendAvailable: true,
      safeToEnable: proof.passed,
      missingCapabilities,
      missingTools,
      recommendation: proof.passed
        ? (
          deferredToolDiscoveryEnabled
            ? 'On-demand tool discovery is enabled for this agent and the v1 compatibility pack passes.'
            : 'The v1 compatibility pack passes. It is safe to enable on-demand tool discovery for this agent/local model.'
        )
        : proof.recommendations.join(' '),
      cases: proof.cases.map((regressionCase) => ({
        id: regressionCase.id,
        label: regressionCase.name,
        passed: regressionCase.passed,
        missingCapabilities: unique([
          ...regressionCase.baselineAvailability.missingCapabilities,
          ...regressionCase.deferredAvailability.expanded.missingCapabilities,
        ]),
        missingTools: unique([
          ...regressionCase.baselineAvailability.missingTools,
          ...regressionCase.deferredAvailability.expanded.missingTools,
        ]),
        detail: `${regressionCase.description} Baseline coverage: ${regressionCase.baselineAvailability.coverage}; on-demand coverage: ${regressionCase.deferredAvailability.coverage} (${regressionCase.deferredAvailability.phase}).`,
        recommendation: regressionCase.recommendations.join(' '),
      })),
    };
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
      avatarImageDataUrl?: string;
      appearance?: {
        avatarFrame?: string;
        accentColor?: string;
        answerStyle?: string;
        chatBackgroundId?: string;
        showAvatarOnAnswers?: boolean;
        presenceAnimation?: string;
        reactionMode?: AgentReactionMode;
      } | null;
      workspaceRoot?: string;
      systemPromptAppend?: string;
      selectedModel?: SelectedModel | null;
      toolsetIds?: ToolsetId[];
      deferredToolDiscoveryEnabled?: boolean;
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
      alwaysOnEnabled?: boolean;
      alwaysOnWorkboardDispatchEnabled?: boolean;
      alwaysOnWorkboardProjectIds?: string[];
      autoSkillEnabled?: boolean;
      autoSkillAutoPromoteLowRisk?: boolean;
      skillAutomationMode?: 'automatic' | 'approval' | 'off';
      memoryWriteMode?: 'automatic' | 'approval' | 'off';
      memoryNotificationsEnabled?: boolean;
      subagentsEnabled?: boolean;
      subagentMaxChildren?: number;
      subagentMaxDepth?: number;
      subagentAllowedAgentIds?: string[];
      subagentAutoRelayCompletions?: boolean;
      subagentDefaultModel?: SelectedModel | null;
      subagentRunTimeoutMs?: number;
      subagentDefaultMode?: 'run' | 'session';
      subagentInheritWorkingDirectory?: boolean;
      subagentInheritAttachedFiles?: boolean;
      subagentInheritPrivacyMode?: boolean;
      permissionProfile?: {
        enabled?: boolean;
        file?: {
          allowWorkspaceWritesWithoutPrompt?: boolean;
          allowTaskScopedAllowAll?: boolean;
          defaultDecision?: 'allow' | 'deny' | 'prompt';
        };
        runtime?: {
          defaultToolDecision?: 'allow' | 'deny' | 'prompt';
          defaultQuestionDecision?: 'allow' | 'deny' | 'prompt';
          allowedToolNames?: string[];
          blockedToolNames?: string[];
        };
      } | null;
    }
  ) => {
    if (!config || typeof config.name !== 'string') {
      throw new Error('Agent name is required');
    }
    const hasRoleName = Object.prototype.hasOwnProperty.call(config, 'roleName');
    const hasDescription = Object.prototype.hasOwnProperty.call(config, 'description');
    const hasAvatar = Object.prototype.hasOwnProperty.call(config, 'avatar');
    const hasAvatarColor = Object.prototype.hasOwnProperty.call(config, 'avatarColor');
    const hasAvatarImageDataUrl = Object.prototype.hasOwnProperty.call(config, 'avatarImageDataUrl');
    const hasWorkspaceRoot = Object.prototype.hasOwnProperty.call(config, 'workspaceRoot');
    const hasSystemPromptAppend = Object.prototype.hasOwnProperty.call(config, 'systemPromptAppend');
    const hasSelectedModel = Object.prototype.hasOwnProperty.call(config, 'selectedModel');
    const hasAppearance = Object.prototype.hasOwnProperty.call(config, 'appearance');
    const hasToolsetIds = Object.prototype.hasOwnProperty.call(config, 'toolsetIds');
    const hasDeferredToolDiscoveryEnabled = Object.prototype.hasOwnProperty.call(config, 'deferredToolDiscoveryEnabled');
    const hasSubagentDefaultModel = Object.prototype.hasOwnProperty.call(config, 'subagentDefaultModel');
    const hasPermissionProfile = Object.prototype.hasOwnProperty.call(config, 'permissionProfile');
    const sanitizedConfig: {
      id?: string;
      name: string;
      roleName?: string;
      description?: string;
      avatar?: string;
      avatarColor?: string;
      avatarImageDataUrl?: string;
      appearance?: {
        avatarFrame?: string;
        accentColor?: string;
        answerStyle?: string;
        chatBackgroundId?: string;
        showAvatarOnAnswers?: boolean;
        presenceAnimation?: string;
        reactionMode?: AgentReactionMode;
      } | null;
      workspaceRoot?: string;
      systemPromptAppend?: string;
      selectedModel?: SelectedModel | null;
      toolsetIds?: ToolsetId[];
      deferredToolDiscoveryEnabled?: boolean;
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
      alwaysOnEnabled?: boolean;
      alwaysOnWorkboardDispatchEnabled?: boolean;
      alwaysOnWorkboardProjectIds?: string[];
      autoSkillEnabled?: boolean;
      autoSkillAutoPromoteLowRisk?: boolean;
      skillAutomationMode?: 'automatic' | 'approval' | 'off';
      memoryWriteMode?: 'automatic' | 'approval' | 'off';
      memoryNotificationsEnabled?: boolean;
      subagentsEnabled?: boolean;
      subagentMaxChildren?: number;
      subagentMaxDepth?: number;
      subagentAllowedAgentIds?: string[];
      subagentAutoRelayCompletions?: boolean;
      subagentDefaultModel?: SelectedModel | null;
      subagentRunTimeoutMs?: number;
      subagentDefaultMode?: 'run' | 'session';
      subagentInheritWorkingDirectory?: boolean;
      subagentInheritAttachedFiles?: boolean;
      subagentInheritPrivacyMode?: boolean;
      permissionProfile?: {
        enabled?: boolean;
        file?: {
          allowWorkspaceWritesWithoutPrompt?: boolean;
          allowTaskScopedAllowAll?: boolean;
          defaultDecision?: 'allow' | 'deny' | 'prompt';
        };
        runtime?: {
          defaultToolDecision?: 'allow' | 'deny' | 'prompt';
          defaultQuestionDecision?: 'allow' | 'deny' | 'prompt';
          allowedToolNames?: string[];
          blockedToolNames?: string[];
        };
      } | null;
    } = {
      id: config.id ? sanitizeString(config.id, 'agentId', 64) : undefined,
      name: sanitizeString(config.name, 'name', 128),
    };
    if (hasRoleName) {
      sanitizedConfig.roleName = config.roleName ? sanitizeString(config.roleName, 'roleName', 128) : undefined;
    }
    if (hasDescription) {
      sanitizedConfig.description = config.description ? sanitizeString(config.description, 'description', 256) : undefined;
    }
    if (hasAvatar) {
      sanitizedConfig.avatar = config.avatar ? sanitizeString(config.avatar, 'avatar', 64) : undefined;
    }
    if (hasAvatarColor) {
      sanitizedConfig.avatarColor = config.avatarColor ? sanitizeString(config.avatarColor, 'avatarColor', 16) : undefined;
    }
    if (hasAvatarImageDataUrl) {
      sanitizedConfig.avatarImageDataUrl = sanitizeOptionalAvatarImageDataUrl(config.avatarImageDataUrl);
    }
    if (hasWorkspaceRoot) {
      sanitizedConfig.workspaceRoot = config.workspaceRoot ? sanitizeString(config.workspaceRoot, 'workspaceRoot', 1024) : undefined;
    }
    if (hasSystemPromptAppend) {
      sanitizedConfig.systemPromptAppend = config.systemPromptAppend ? sanitizeString(config.systemPromptAppend, 'systemPromptAppend', MAX_TEXT_LENGTH) : undefined;
    }
    if (hasAppearance) {
      if (config.appearance == null) {
        sanitizedConfig.appearance = null;
      } else if (typeof config.appearance !== 'object') {
        throw new Error('appearance must be an object or null');
      } else {
        const source = config.appearance as Record<string, unknown>;
        const sanitizeAppearanceText = (field: string, maxLength = 80): string | undefined => {
          const value = source[field];
          if (value == null || value === '') return undefined;
          if (typeof value !== 'string') {
            throw new Error(`appearance.${field} must be a string`);
          }
          const trimmed = sanitizeString(value, `appearance.${field}`, maxLength).trim();
          return trimmed || undefined;
        };
        const sanitizeReactionMode = (): AgentReactionMode | undefined => {
          const value = source.reactionMode;
          if (value == null || value === '') return undefined;
          if (value === 'off' || value === 'minimal' || value === 'standard' || value === 'playful') {
            return value;
          }
          throw new Error('appearance.reactionMode must be off, minimal, standard, or playful');
        };
        const appearance = {
          avatarFrame: sanitizeAppearanceText('avatarFrame'),
          accentColor: sanitizeAppearanceText('accentColor', 32),
          answerStyle: sanitizeAppearanceText('answerStyle'),
          chatBackgroundId: sanitizeAppearanceText('chatBackgroundId'),
          showAvatarOnAnswers: typeof source.showAvatarOnAnswers === 'boolean' ? source.showAvatarOnAnswers : undefined,
          presenceAnimation: sanitizeAppearanceText('presenceAnimation'),
          reactionMode: sanitizeReactionMode(),
        };
        sanitizedConfig.appearance = Object.values(appearance).some((value) => value !== undefined)
          ? appearance
          : null;
      }
    }
    if (hasSelectedModel) {
      sanitizedConfig.selectedModel = config.selectedModel == null
        ? null
        : sanitizeSelectedModel(config.selectedModel, 'selectedModel');
    }
    if (hasToolsetIds) {
      sanitizedConfig.toolsetIds = sanitizeToolsetIds(config.toolsetIds, 'toolsetIds');
    }
    if (hasDeferredToolDiscoveryEnabled) {
      if (typeof config.deferredToolDiscoveryEnabled !== 'boolean') {
        throw new Error('deferredToolDiscoveryEnabled must be a boolean');
      }
      sanitizedConfig.deferredToolDiscoveryEnabled = config.deferredToolDiscoveryEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentsEnabled')) {
      if (typeof config.subagentsEnabled !== 'boolean') {
        throw new Error('subagentsEnabled must be a boolean');
      }
      sanitizedConfig.subagentsEnabled = config.subagentsEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentMaxChildren')) {
      sanitizedConfig.subagentMaxChildren = sanitizeIntegerRange(
        config.subagentMaxChildren,
        'subagentMaxChildren',
        1,
        12,
        3
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentMaxDepth')) {
      sanitizedConfig.subagentMaxDepth = sanitizeIntegerRange(
        config.subagentMaxDepth,
        'subagentMaxDepth',
        1,
        4,
        1
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentAllowedAgentIds')) {
      const values = Array.isArray(config.subagentAllowedAgentIds) ? config.subagentAllowedAgentIds : [];
      sanitizedConfig.subagentAllowedAgentIds = values
        .map((value, index) => sanitizeString(value, `subagentAllowedAgentIds[${index}]`, 64).trim().toLowerCase())
        .filter(Boolean);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentAutoRelayCompletions')) {
      if (typeof config.subagentAutoRelayCompletions !== 'boolean') {
        throw new Error('subagentAutoRelayCompletions must be a boolean');
      }
      sanitizedConfig.subagentAutoRelayCompletions = config.subagentAutoRelayCompletions;
    }
    if (hasSubagentDefaultModel) {
      sanitizedConfig.subagentDefaultModel = config.subagentDefaultModel == null
        ? null
        : sanitizeSelectedModel(config.subagentDefaultModel, 'subagentDefaultModel');
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentRunTimeoutMs')) {
      sanitizedConfig.subagentRunTimeoutMs = sanitizeIntegerRange(
        config.subagentRunTimeoutMs,
        'subagentRunTimeoutMs',
        15_000,
        3_600_000,
        300_000
      );
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentDefaultMode')) {
      if (config.subagentDefaultMode !== 'run' && config.subagentDefaultMode !== 'session') {
        throw new Error('subagentDefaultMode must be run or session');
      }
      sanitizedConfig.subagentDefaultMode = config.subagentDefaultMode;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentInheritWorkingDirectory')) {
      if (typeof config.subagentInheritWorkingDirectory !== 'boolean') {
        throw new Error('subagentInheritWorkingDirectory must be a boolean');
      }
      sanitizedConfig.subagentInheritWorkingDirectory = config.subagentInheritWorkingDirectory;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentInheritAttachedFiles')) {
      if (typeof config.subagentInheritAttachedFiles !== 'boolean') {
        throw new Error('subagentInheritAttachedFiles must be a boolean');
      }
      sanitizedConfig.subagentInheritAttachedFiles = config.subagentInheritAttachedFiles;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'subagentInheritPrivacyMode')) {
      if (typeof config.subagentInheritPrivacyMode !== 'boolean') {
        throw new Error('subagentInheritPrivacyMode must be a boolean');
      }
      sanitizedConfig.subagentInheritPrivacyMode = config.subagentInheritPrivacyMode;
    }
    if (hasPermissionProfile) {
      if (config.permissionProfile == null) {
        sanitizedConfig.permissionProfile = null;
      } else if (typeof config.permissionProfile !== 'object') {
        throw new Error('permissionProfile must be an object');
      } else {
        const profile = config.permissionProfile;
        const file = profile.file && typeof profile.file === 'object' ? profile.file : {};
        const runtime = profile.runtime && typeof profile.runtime === 'object' ? profile.runtime : {};
        const sanitizeDecision = (
          value: unknown,
          field: string
        ): 'allow' | 'deny' | 'prompt' | undefined => {
          if (value == null || value === '') return undefined;
          if (value === 'allow' || value === 'deny' || value === 'prompt') return value;
          throw new Error(`${field} must be allow, deny, or prompt`);
        };
        const sanitizeToolNames = (values: unknown, field: string): string[] => {
          if (!Array.isArray(values)) return [];
          return values
            .map((value, index) => sanitizeString(value, `${field}[${index}]`, 128).trim().toLowerCase())
            .filter(Boolean);
        };
        sanitizedConfig.permissionProfile = {
          enabled: typeof profile.enabled === 'boolean' ? profile.enabled : true,
          file: {
            allowWorkspaceWritesWithoutPrompt:
              typeof file.allowWorkspaceWritesWithoutPrompt === 'boolean'
                ? file.allowWorkspaceWritesWithoutPrompt
                : undefined,
            allowTaskScopedAllowAll:
              typeof file.allowTaskScopedAllowAll === 'boolean'
                ? file.allowTaskScopedAllowAll
                : undefined,
            defaultDecision: sanitizeDecision(file.defaultDecision, 'permissionProfile.file.defaultDecision'),
          },
          runtime: {
            defaultToolDecision: sanitizeDecision(runtime.defaultToolDecision, 'permissionProfile.runtime.defaultToolDecision'),
            defaultQuestionDecision: sanitizeDecision(runtime.defaultQuestionDecision, 'permissionProfile.runtime.defaultQuestionDecision'),
            allowedToolNames: sanitizeToolNames(runtime.allowedToolNames, 'permissionProfile.runtime.allowedToolNames'),
            blockedToolNames: sanitizeToolNames(runtime.blockedToolNames, 'permissionProfile.runtime.blockedToolNames'),
          },
        };
      }
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
    if (Object.prototype.hasOwnProperty.call(config, 'skillAutomationMode')) {
      const mode = sanitizeString(config.skillAutomationMode, 'skillAutomationMode', 24).toLowerCase();
      if (mode !== 'automatic' && mode !== 'approval' && mode !== 'off') {
        throw new Error('skillAutomationMode must be automatic, approval, or off');
      }
      sanitizedConfig.skillAutomationMode = mode;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'memoryWriteMode')) {
      const mode = sanitizeString(config.memoryWriteMode, 'memoryWriteMode', 24).toLowerCase();
      if (mode !== 'automatic' && mode !== 'approval' && mode !== 'off') {
        throw new Error('memoryWriteMode must be automatic, approval, or off');
      }
      sanitizedConfig.memoryWriteMode = mode;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'memoryNotificationsEnabled')) {
      if (typeof config.memoryNotificationsEnabled !== 'boolean') {
        throw new Error('memoryNotificationsEnabled must be a boolean');
      }
      sanitizedConfig.memoryNotificationsEnabled = config.memoryNotificationsEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'alwaysOnEnabled')) {
      if (typeof config.alwaysOnEnabled !== 'boolean') {
        throw new Error('alwaysOnEnabled must be a boolean');
      }
      sanitizedConfig.alwaysOnEnabled = config.alwaysOnEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'alwaysOnWorkboardDispatchEnabled')) {
      if (typeof config.alwaysOnWorkboardDispatchEnabled !== 'boolean') {
        throw new Error('alwaysOnWorkboardDispatchEnabled must be a boolean');
      }
      sanitizedConfig.alwaysOnWorkboardDispatchEnabled = config.alwaysOnWorkboardDispatchEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'alwaysOnWorkboardProjectIds')) {
      sanitizedConfig.alwaysOnWorkboardProjectIds = sanitizeIdList(
        config.alwaysOnWorkboardProjectIds,
        'alwaysOnWorkboardProjectIds'
      );
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

  handle('always-on:status:get', async () => {
    return getAlwaysOnStatusSnapshot();
  });

  handle('always-on:manager:start', async () => {
    return startAlwaysOnRuntimeManager();
  });

  handle('always-on:manager:stop', async () => {
    return stopAlwaysOnRuntimeManager();
  });

  handle('always-on:manager:restart', async () => {
    return restartAlwaysOnRuntimeManager();
  });

  handle('always-on:agent:set', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; enabled?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    if (typeof payload?.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    return setAgentAlwaysOnEnabled(agentId, payload.enabled);
  });

  handle('always-on:agent:restart', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    return restartAgentAlwaysOnRuntime(agentId);
  });

  handle('connector-deliveries:list', async (_event: IpcMainInvokeEvent, payload?: { limit?: unknown }) => {
    const limit = payload?.limit == null
      ? 100
      : sanitizeIntegerRange(payload.limit, 'limit', 1, 500, 100);
    return { deliveries: listConnectorDeliveries(limit) };
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

  handle('automation:draft-from-text', async (_event: IpcMainInvokeEvent, request: AutomationDraftRequest) => {
    const text = sanitizeString(request?.text, 'text', 2000);
    const agentId = request?.agentId ? sanitizeString(request.agentId, 'agentId', 64) : resolveActiveAgentId();
    const timezone = request?.timezone ? sanitizeString(request.timezone, 'timezone', 80) : undefined;
    return draftAutomationFromText({ text, agentId, timezone });
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

  handle('user-skills:curator:run', async (_event: IpcMainInvokeEvent, req?: { agentId?: string; dryRun?: boolean }) => {
    return runUserSkillCurator({
      agentId: req?.agentId ? sanitizeOptionalText(req.agentId, 'agentId', 128) || undefined : undefined,
      dryRun: req?.dryRun === true,
    });
  });

  handle('user-skills:curator:history', async () => {
    return listUserSkillCuratorHistory();
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

  handle(
    'settings-assistant:list-prompt:generate',
    async (_event: IpcMainInvokeEvent, req: ChecklistListPromptGenerateRequest) => {
      return generateChecklistListPrompt({
        agentId: sanitizeOptionalText(req?.agentId, 'agentId', 128) || undefined,
        purpose: req?.purpose,
        customPurpose: sanitizeOptionalText(req?.customPurpose, 'customPurpose', 500) || undefined,
        workItemTitle: sanitizeOptionalText(req?.workItemTitle, 'workItemTitle', 300) || undefined,
        listName: sanitizeOptionalText(req?.listName, 'listName', 300) || undefined,
        listContext: sanitizeOptionalText(req?.listContext, 'listContext', 5000) || undefined,
        extraInstruction: sanitizeOptionalText(req?.extraInstruction, 'extraInstruction', 2000) || undefined,
        includeWorkItemName: req?.includeWorkItemName === true,
        includeListName: req?.includeListName === true,
        includeListContext: req?.includeListContext !== false,
        includeAssignee: req?.includeAssignee === true,
        includeDueDate: req?.includeDueDate === true,
        includeCompletedItems: req?.includeCompletedItems === true,
        items: Array.isArray(req?.items) ? req.items : [],
      });
    }
  );

  handle(
    'settings-assistant:note-prompt:generate',
    async (_event: IpcMainInvokeEvent, req: WorkItemNotePromptGenerateRequest) => {
      return generateWorkItemNotePrompt({
        agentId: sanitizeOptionalText(req?.agentId, 'agentId', 128) || undefined,
        purpose: req?.purpose,
        customPurpose: sanitizeOptionalText(req?.customPurpose, 'customPurpose', 500) || undefined,
        workItemTitle: sanitizeOptionalText(req?.workItemTitle, 'workItemTitle', 300) || undefined,
        noteTitle: sanitizeOptionalText(req?.noteTitle, 'noteTitle', 300) || undefined,
        noteText: sanitizeOptionalText(req?.noteText, 'noteText', 12000) || '',
        noteHtml: sanitizeOptionalText(req?.noteHtml, 'noteHtml', 12000) || undefined,
        extraInstruction: sanitizeOptionalText(req?.extraInstruction, 'extraInstruction', 2000) || undefined,
        includeWorkItemName: req?.includeWorkItemName === true,
        includeNoteTitle: req?.includeNoteTitle !== false,
      });
    }
  );

  handle(
    'settings-assistant:postcard:generate',
    async (_event: IpcMainInvokeEvent, req: ChatPostcardDraftGenerateRequest) => {
      return generateChatPostcardDraft({
        agentId: sanitizeOptionalText(req?.agentId, 'agentId', 128) || undefined,
        source: req?.source === 'conversation' ? 'conversation' : 'answer',
        templateId: sanitizeOptionalText(req?.templateId, 'templateId', 80) || undefined,
        titleHint: sanitizeOptionalText(req?.titleHint, 'titleHint', 240) || undefined,
        content: sanitizeString(req?.content, 'content', 20000),
        sources: Array.isArray(req?.sources)
          ? req.sources.map((source) => sanitizeOptionalText(source, 'source', 1000)).filter(Boolean).slice(0, 12)
          : [],
        agentName: sanitizeOptionalText(req?.agentName, 'agentName', 160) || undefined,
        agentRole: sanitizeOptionalText(req?.agentRole, 'agentRole', 160) || undefined,
        projectName: sanitizeOptionalText(req?.projectName, 'projectName', 160) || undefined,
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

  // Shell: Open a local file or folder path with the OS default app.
  handle('shell:open-path', async (_event: IpcMainInvokeEvent, filePath: string) => {
    const targetPath = sanitizeOptionalText(filePath, 'filePath', 2048).trim();
    if (!targetPath) throw new Error('filePath is required');
    if (/^https?:\/\//i.test(targetPath)) throw new Error('Use openExternal for web URLs.');
    const resolvedPath = path.resolve(targetPath);
    const result = await shell.openPath(resolvedPath);
    if (result) return { ok: false, path: resolvedPath, error: result };
    return { ok: true, path: resolvedPath };
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
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300);
    if (!workspaceRelativePath) {
      return buildDevProcessManager.getActiveSnapshot(agentId);
    }
    try {
      return buildDevProcessManager.getSnapshot(agentId, workspaceRelativePath);
    } catch (error) {
      if (error instanceof Error && error.message === 'Cannot switch workspace path while process is running. Stop runtime first.') {
        return buildDevProcessManager.getActiveSnapshot(agentId);
      }
      throw error;
    }
  });

  handle('build-mode:runtime:start', async (_event: IpcMainInvokeEvent, payload: BuildStartRequest) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const executionProfileId = sanitizeOptionalText(payload?.executionProfileId, 'executionProfileId', 64) || null;
    assertExecutionProfileRunnable(executionProfileId);
    const mode = payload?.mode === 'run' ? 'run' : 'dev';
    const commandOverride = sanitizeOptionalText(payload?.commandOverride, 'commandOverride', 500);
    const startEntries = Array.isArray(payload?.startEntries)
      ? payload.startEntries
        .map((entry) => ({
          command: sanitizeOptionalText(entry?.command, 'startEntries.command', 500),
          workspaceRelativePath: sanitizeOptionalText(entry?.workspaceRelativePath, 'startEntries.workspaceRelativePath', 300) || undefined,
          role: entry?.role === 'worker'
            ? ('worker' as const)
            : entry?.role === 'preview'
              ? ('preview' as const)
              : undefined,
        }))
        .filter((entry) => Boolean(entry.command))
      : undefined;
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
      startEntries,
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
    const executionProfileId = sanitizeOptionalText(payload?.executionProfileId, 'executionProfileId', 64) || null;
    assertExecutionProfileRunnable(executionProfileId);
    const commandOverride = sanitizeOptionalText(payload?.commandOverride, 'commandOverride', 500);
    const envOverrides = normalizeEnvOverrides(payload?.envOverrides);
    return buildDevProcessManager.runBuildCommand({
      agentId,
      workspaceRelativePath,
      commandOverride: commandOverride || undefined,
      envOverrides,
    });
  });

  handle('build-mode:quality-checks:run', async (_event: IpcMainInvokeEvent, payload: BuildQualityCheckRunRequest) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const allowedKinds = new Set<BuildQualityCheckKind>(['typecheck', 'lint', 'test', 'build', 'runtime-health', 'preview']);
    const kinds = Array.isArray(payload?.kinds)
      ? payload.kinds.filter((kind): kind is BuildQualityCheckKind => allowedKinds.has(kind as BuildQualityCheckKind))
      : undefined;
    const commandOverrides = payload?.commandOverrides && typeof payload.commandOverrides === 'object'
      ? Object.fromEntries(
        Object.entries(payload.commandOverrides)
          .filter(([kind]) => allowedKinds.has(kind as BuildQualityCheckKind))
          .map(([kind, value]) => [kind, typeof value === 'string' ? sanitizeOptionalText(value, `commandOverrides.${kind}`, 500) : undefined])
          .filter(([, value]) => Boolean(value))
      ) as Partial<Record<BuildQualityCheckKind, string>>
      : undefined;
    return runBuildQualityChecks({
      agentId,
      workspaceRelativePath,
      kinds,
      commandOverrides,
      diffSignature: sanitizeOptionalText(payload?.diffSignature, 'diffSignature', 500),
      changedFileCount: typeof payload?.changedFileCount === 'number' && Number.isFinite(payload.changedFileCount)
        ? Math.max(0, Math.floor(payload.changedFileCount))
        : undefined,
      trigger: payload?.trigger === 'suggested' ? 'suggested' : payload?.trigger === 'manual' ? 'manual' : undefined,
    });
  });

  handle('build-mode:quality-checks:get', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; workspaceRelativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    return getLatestBuildQualityCheckRun(agentId, workspaceRelativePath);
  });

  handle('build-mode:runtime:run-once', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; workspaceRelativePath?: unknown; executionProfileId?: unknown; envOverrides?: unknown; commandOverride?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const workspaceRelativePath = sanitizeOptionalText(payload?.workspaceRelativePath, 'workspaceRelativePath', 300) || '.';
    const executionProfileId = sanitizeOptionalText(payload?.executionProfileId, 'executionProfileId', 64) || null;
    assertExecutionProfileRunnable(executionProfileId);
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
    const includeHidden = typeof payload?.includeHidden === 'boolean' ? payload.includeHidden : true;
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

  handle('build-mode:workspace:diff-file', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; filePath?: unknown; baselineId?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const filePath = sanitizeString(payload?.filePath, 'filePath', 800);
    const baselineId = sanitizeOptionalText(payload?.baselineId, 'baselineId', 120) || undefined;
    return readWorkspaceDiffFileContent(agentId, relativePath, filePath, baselineId);
  });

  handle('build-mode:git:summary', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; lightweight?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return readBuildGitSummary(agentId, relativePath, { lightweight: payload?.lightweight === true });
  });

  handle('build-mode:git:mismatch:summary', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return readBuildGitMismatchSummary(agentId, relativePath);
  });

  handle('build-mode:git:mismatch:resolve', async (
    _event: IpcMainInvokeEvent,
    payload: { agentId?: unknown; relativePath?: unknown; action?: unknown; createBackup?: unknown; backupBranchName?: unknown }
  ) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const actionRaw = sanitizeString(payload?.action, 'action', 40);
    const allowedActions = ['backup', 'merge', 'rebase', 'reset-to-remote', 'force-push', 'abort-merge', 'abort-rebase', 'continue-rebase'];
    if (!allowedActions.includes(actionRaw)) {
      throw new Error('Unsupported Git mismatch action.');
    }
    return resolveBuildGitMismatch(agentId, relativePath, {
      action: actionRaw as 'backup' | 'merge' | 'rebase' | 'reset-to-remote' | 'force-push' | 'abort-merge' | 'abort-rebase' | 'continue-rebase',
      createBackup: payload?.createBackup === true,
      backupBranchName: sanitizeOptionalText(payload?.backupBranchName, 'backupBranchName', 200) || undefined,
    });
  });

  handle('build-mode:git:init', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return initBuildGitRepository(agentId, relativePath);
  });

  handle('build-mode:git:commit', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; message?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const message = sanitizeString(payload?.message, 'message', 500);
    return commitBuildGitChanges(agentId, relativePath, message);
  });

  handle('build-mode:git:remote:add', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; remoteName?: unknown; remoteUrl?: unknown; provider?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const remoteName = sanitizeString(payload?.remoteName, 'remoteName', 80);
    const remoteUrl = sanitizeString(payload?.remoteUrl, 'remoteUrl', 1000);
    const providerRaw = sanitizeOptionalText(payload?.provider, 'provider', 32);
    const provider = ['github', 'gitlab', 'bitbucket', 'custom'].includes(providerRaw)
      ? providerRaw as 'github' | 'gitlab' | 'bitbucket' | 'custom'
      : 'custom';
    return addBuildGitRemote(agentId, relativePath, { provider, remoteName, remoteUrl });
  });

  handle('build-mode:git:remote:update', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; remoteName?: unknown; remoteUrl?: unknown; provider?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const remoteName = sanitizeString(payload?.remoteName, 'remoteName', 80);
    const remoteUrl = sanitizeString(payload?.remoteUrl, 'remoteUrl', 1000);
    const providerRaw = sanitizeOptionalText(payload?.provider, 'provider', 32);
    const provider = ['github', 'gitlab', 'bitbucket', 'custom'].includes(providerRaw)
      ? providerRaw as 'github' | 'gitlab' | 'bitbucket' | 'custom'
      : 'custom';
    return updateBuildGitRemote(agentId, relativePath, { provider, remoteName, remoteUrl });
  });

  handle('build-mode:git:fetch', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return fetchBuildGitRemote(agentId, relativePath);
  });

  handle('build-mode:git:pull', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return pullBuildGitBranch(agentId, relativePath);
  });

  handle('build-mode:git:push', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; branchName?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const branchName = sanitizeOptionalText(payload?.branchName, 'branchName', 200) || undefined;
    return pushBuildGitBranch(agentId, relativePath, branchName);
  });

  handle('build-mode:git:branch:switch', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; branchName?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const branchName = sanitizeString(payload?.branchName, 'branchName', 200);
    return switchBuildGitBranch(agentId, relativePath, branchName);
  });

  handle('build-mode:git:branch:create', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; branchName?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const branchName = sanitizeString(payload?.branchName, 'branchName', 200);
    return createBuildGitBranch(agentId, relativePath, branchName);
  });

  handle('build-mode:git:discard', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; paths?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const paths = Array.isArray(payload?.paths)
      ? payload.paths.map((entry, index) => sanitizeString(entry, `paths[${index}]`, 500))
      : [];
    return discardBuildGitChanges(agentId, relativePath, paths);
  });

  handle('build-mode:git:conflicts:get', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return readBuildGitConflicts(agentId, relativePath);
  });

  handle('build-mode:git:stage-files', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; paths?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const paths = Array.isArray(payload?.paths)
      ? payload.paths.map((entry, index) => sanitizeString(entry, `paths[${index}]`, 500))
      : [];
    return stageBuildGitFiles(agentId, relativePath, { paths });
  });

  handle('build-mode:git:finish-merge', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; message?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const message = sanitizeOptionalText(payload?.message, 'message', 500) || '';
    return finishBuildGitMerge(agentId, relativePath, message);
  });

  handle('build-mode:git:stash:create', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; message?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const message = sanitizeOptionalText(payload?.message, 'message', 500) || '';
    return createBuildGitStash(agentId, relativePath, message);
  });

  handle('build-mode:git:stash:list', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return listBuildGitStashes(agentId, relativePath);
  });

  handle('build-mode:git:stash:apply', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; stashRef?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const stashRef = sanitizeString(payload?.stashRef, 'stashRef', 80);
    return applyBuildGitStash(agentId, relativePath, stashRef);
  });

  handle('build-mode:git:stash:drop', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; stashRef?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const stashRef = sanitizeString(payload?.stashRef, 'stashRef', 80);
    return dropBuildGitStash(agentId, relativePath, stashRef);
  });

  handle('build-mode:git:branch:checkout-remote', async (
    _event: IpcMainInvokeEvent,
    payload: { agentId?: unknown; relativePath?: unknown; remoteBranchName?: unknown; localBranchName?: unknown }
  ) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const remoteBranchName = sanitizeString(payload?.remoteBranchName, 'remoteBranchName', 200);
    const localBranchName = sanitizeOptionalText(payload?.localBranchName, 'localBranchName', 200) || undefined;
    return checkoutBuildGitRemoteBranch(agentId, relativePath, remoteBranchName, localBranchName);
  });

  handle('build-mode:git:remote:create', async (
    _event: IpcMainInvokeEvent,
    payload: { agentId?: unknown; relativePath?: unknown; provider?: unknown; remoteName?: unknown; repositoryName?: unknown; visibility?: unknown }
  ) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const providerRaw = sanitizeOptionalText(payload?.provider, 'provider', 32);
    const provider = ['github', 'gitlab', 'bitbucket', 'custom'].includes(providerRaw)
      ? providerRaw as 'github' | 'gitlab' | 'bitbucket' | 'custom'
      : 'github';
    const visibilityRaw = sanitizeOptionalText(payload?.visibility, 'visibility', 16);
    const visibility = visibilityRaw === 'public' ? 'public' : 'private';
    return createBuildGitRemoteRepository(agentId, relativePath, {
      provider,
      remoteName: sanitizeOptionalText(payload?.remoteName, 'remoteName', 80) || 'origin',
      repositoryName: sanitizeOptionalText(payload?.repositoryName, 'repositoryName', 200) || undefined,
      visibility,
    });
  });

  handle('build-mode:git:pr:create-draft', async (
    _event: IpcMainInvokeEvent,
    payload: { agentId?: unknown; relativePath?: unknown; provider?: unknown; title?: unknown; body?: unknown; baseBranch?: unknown; headBranch?: unknown; draft?: unknown }
  ) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const providerRaw = sanitizeOptionalText(payload?.provider, 'provider', 32);
    const provider = ['github', 'gitlab', 'bitbucket', 'custom'].includes(providerRaw)
      ? providerRaw as 'github' | 'gitlab' | 'bitbucket' | 'custom'
      : undefined;
    return createBuildGitPullRequest(agentId, relativePath, {
      provider,
      title: sanitizeString(payload?.title, 'title', 300),
      body: sanitizeOptionalText(payload?.body, 'body', 10_000) || undefined,
      baseBranch: sanitizeOptionalText(payload?.baseBranch, 'baseBranch', 200) || undefined,
      headBranch: sanitizeOptionalText(payload?.headBranch, 'headBranch', 200) || undefined,
      draft: payload?.draft !== false,
    });
  });

  handle('build-mode:git:backup-branches:list', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return listBuildGitBackupBranches(agentId, relativePath);
  });

  handle('build-mode:git:restore-backup', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown; branchName?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    const branchName = sanitizeString(payload?.branchName, 'branchName', 200);
    return restoreBuildGitBackupBranch(agentId, relativePath, branchName);
  });

  handle('build-mode:git:reflog:list', async (_event: IpcMainInvokeEvent, payload: { agentId?: unknown; relativePath?: unknown }) => {
    const agentId = sanitizeString(payload?.agentId, 'agentId', 64);
    const relativePath = sanitizeOptionalText(payload?.relativePath, 'relativePath', 400) || '.';
    return listBuildGitReflog(agentId, relativePath);
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
    const usageProjectId = sanitizeOptionalText(payload?.usageProjectId, 'usageProjectId', 128) || null;
    const executionProfileId = Object.prototype.hasOwnProperty.call(payload || {}, 'executionProfileId')
      ? (sanitizeOptionalText(payload?.executionProfileId, 'executionProfileId', 64) || null)
      : undefined;
    const toolsetIds = payload?.toolsetIds !== undefined
      ? sanitizeToolsetIds(payload.toolsetIds, 'toolsetIds')
      : undefined;
    const assigneeIds = sanitizeOptionalIdOverride(payload?.assigneeIds, 'assigneeIds');
    const activeEnvProfileId = sanitizeOptionalText(payload?.activeEnvProfileId, 'activeEnvProfileId', 64) || undefined;

    const saved = upsertBuildModePreset({
      id,
      agentId,
      name,
      workspaceRelativePath,
      usageProjectId,
      ...(executionProfileId !== undefined ? { executionProfileId } : {}),
      ...(toolsetIds !== undefined ? { toolsetIds } : {}),
      ...(assigneeIds !== undefined ? { assigneeIds } : {}),
      commands: payload?.commands,
      envProfiles: payload?.envProfiles,
      activeEnvProfileId,
    });
    assignUsageProjectToBuildPresetSessions(agentId, saved.id, saved.usageProjectId ?? null);
    return saved;
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
    const usageProjectId = sanitizeOptionalText(payload?.usageProjectId, 'usageProjectId', 128) || null;
    return createBuildTaskSession({
      agentId,
      title,
      titleSourcePrompt,
      goalPrompt,
      workspaceRelativePath,
      selectedPresetId,
      usageProjectId,
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
    if (payload?.usageProjectId !== undefined) {
      next.usageProjectId = sanitizeOptionalText(payload.usageProjectId, 'usageProjectId', 128) || null;
    }
    if (payload?.lifecycleStatus !== undefined) {
      const lifecycleStatus = sanitizeOptionalText(payload.lifecycleStatus, 'lifecycleStatus', 32);
      if (!['active', 'completed', 'failed', 'interrupted', 'archived'].includes(lifecycleStatus)) {
        throw new Error('Invalid lifecycleStatus.');
      }
      next.lifecycleStatus = lifecycleStatus as BuildTaskSessionUpdateInput['lifecycleStatus'];
    }
    const updated = updateBuildTaskSession(next);
    if (payload?.usageProjectId !== undefined) {
      assignUsageProjectToBuildSessionTasks(sessionId, updated.execution.usageProjectId ?? null);
    }
    return updated;
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

  handle('subagents:policy', async (_event: IpcMainInvokeEvent, payload: { runId: string; maxCostUsd?: number; runTimeoutMs?: number; limitAction: 'notify' | 'stop' }) => {
    const run = getSubagentRun(sanitizeString(payload.runId, 'runId', 128));
    if (!run?.executionPolicy) throw new Error('Subagent run not found');
    if (payload.maxCostUsd !== undefined && (!Number.isFinite(payload.maxCostUsd) || payload.maxCostUsd <= 0)) throw new Error('Enter a positive USD amount');
    if (payload.runTimeoutMs !== undefined && (!Number.isFinite(payload.runTimeoutMs) || payload.runTimeoutMs < 15000 || payload.runTimeoutMs > 3600000)) throw new Error('Runtime limit must be between 15 and 3600 seconds');
    patchSubagentRun(run.runId, { executionPolicy: { ...run.executionPolicy, runTimeoutMs: payload.runTimeoutMs ?? run.executionPolicy.runTimeoutMs, maxCostUsd: payload.maxCostUsd, limitAction: payload.limitAction === 'stop' ? 'stop' : 'notify' }, limitReached: undefined });
  });
  handle('subagents:consume', async (_event: IpcMainInvokeEvent, payload: { parentTaskId: string }) => {
    const parentTaskId = sanitizeString(payload.parentTaskId, 'parentTaskId', 128);
    for (const run of listSubagentRuns(parentTaskId)) if (run.resultDelivery?.state === 'ready' && run.resultDelivery.error) patchSubagentRun(run.runId, { resultDelivery: { state: 'ready', updatedAt: new Date().toISOString() } });
    return consumeSubagentResults(parentTaskId);
  });
  handle('subagents:list', async (_event: IpcMainInvokeEvent, payload: { parentTaskId?: unknown }) => {
    const parentTaskId = sanitizeString(payload?.parentTaskId, 'parentTaskId', 128);
    return {
      runs: listSubagentRunsForParentTask(parentTaskId),
      tree: listSubagentRunTreeForParentTask(parentTaskId),
      activeCount: getActiveSubagentCount(parentTaskId),
    };
  });

  handle('subagents:list-all', async (_event: IpcMainInvokeEvent, payload: { includeArchived?: unknown; query?: unknown; limit?: unknown }) => {
    const includeArchived = payload?.includeArchived === true;
    const query = sanitizeOptionalText(payload?.query, 'query', 256).trim().toLowerCase();
    const requestedLimit = typeof payload?.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.floor(payload.limit)
      : 250;
    const limit = Math.min(500, Math.max(1, requestedLimit));
    const allRuns = listSubagentRuns(undefined, { includeArchived });
    const matchingRuns = query
      ? allRuns.filter((run) => {
        const haystack = [
          run.runId,
          run.label,
          run.task,
          run.childAgentId,
          run.parentAgentId,
          run.childTaskId,
          run.parentTaskId,
          run.sessionId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      : allRuns;
    const orderedRuns = [...matchingRuns].sort((a, b) => {
      const aActive = a.status === 'running' || a.status === 'accepted' ? 1 : 0;
      const bActive = b.status === 'running' || b.status === 'accepted' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    const runs = orderedRuns
      .slice(0, limit)
      .map((run) => getSubagentRunForUi(run.runId))
      .filter(Boolean);
    return {
      runs,
      total: orderedRuns.length,
      truncated: orderedRuns.length > runs.length,
    };
  });

  handle('subagents:get', async (_event: IpcMainInvokeEvent, payload: { runId?: unknown }) => {
    const runId = sanitizeString(payload?.runId, 'runId', 128);
    return getSubagentRunForUi(runId) ?? null;
  });

  handle('subagents:wait', async (_event: IpcMainInvokeEvent, payload: {
    runId?: unknown;
    timeoutMs?: unknown;
    pollIntervalMs?: unknown;
  }) => {
    const runId = sanitizeString(payload?.runId, 'runId', 128);
    const timeoutMs = typeof payload?.timeoutMs === 'number' ? payload.timeoutMs : undefined;
    const pollIntervalMs = typeof payload?.pollIntervalMs === 'number' ? payload.pollIntervalMs : undefined;
    return waitForSubagentRun({ runId, timeoutMs, pollIntervalMs });
  });

  handle('subagents:stop', async (_event: IpcMainInvokeEvent, payload: { runId?: unknown }) => {
    const runId = sanitizeString(payload?.runId, 'runId', 128);
    const run = getSubagentRun(runId);
    if (!run) {
      throw new Error('Subagent run not found.');
    }
    await stopAgentEngineTask(run.childTaskId, { interruptFirst: true }).catch(() => {});
    updateTaskStatus(run.childTaskId, 'interrupted', new Date().toISOString());
    patchSubagentRun(runId, {
      status: 'done',
      resultStatus: 'interrupted',
      completedAt: new Date().toISOString(),
    });
    return { ok: true, runId };
  });

  handle('subagents:archive', async (_event: IpcMainInvokeEvent, payload: { runId?: unknown; archived?: unknown }) => {
    const runId = sanitizeString(payload?.runId, 'runId', 128);
    const archived = payload?.archived !== false;
    return archiveSubagentRun(runId, archived);
  });

  handle('subagents:close', async (_event: IpcMainInvokeEvent, payload: { runId?: unknown }) => {
    const runId = sanitizeString(payload?.runId, 'runId', 128);
    return closeSubagentSession(runId);
  });

  handle('subagents:send', async (_event: IpcMainInvokeEvent, payload: {
    runId?: unknown;
    prompt?: unknown;
    modelProvider?: unknown;
    modelId?: unknown;
    modelBaseUrl?: unknown;
  }) => {
    const runId = sanitizeString(payload?.runId, 'runId', 128);
    const prompt = sanitizeString(payload?.prompt, 'prompt', MAX_TEXT_LENGTH);
    const modelProviderRaw = typeof payload?.modelProvider === 'string' ? payload.modelProvider.trim().toLowerCase() : '';
    const modelIdRaw = typeof payload?.modelId === 'string' ? payload.modelId.trim() : '';
    const modelBaseUrl = typeof payload?.modelBaseUrl === 'string' ? payload.modelBaseUrl.trim() : '';
    return sendSubagentPrompt({
      runId,
      prompt,
      model: modelProviderRaw && modelIdRaw
        ? {
          provider: modelProviderRaw,
          model: modelIdRaw,
          ...(modelBaseUrl ? { baseUrl: modelBaseUrl } : {}),
        }
        : null,
    });
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
    return createFolder({
      ...config,
      usageProjectId: sanitizeOptionalText(config?.usageProjectId, 'usageProjectId', 128) || null,
      assigneeIds: sanitizeOptionalIdOverride(config?.assigneeIds, 'assigneeIds') ?? null,
    }, resolveActiveAgentId());
  });

  // Folder: Update a folder
  handle('folder:update', async (_event: IpcMainInvokeEvent, folderId: string, config: FolderUpdateConfig) => {
    const sanitizedConfig: FolderUpdateConfig = { ...config };
    if (config?.usageProjectId !== undefined) {
      sanitizedConfig.usageProjectId = sanitizeOptionalText(config.usageProjectId, 'usageProjectId', 128) || null;
    }
    if (config?.assigneeIds !== undefined) {
      sanitizedConfig.assigneeIds = sanitizeOptionalIdOverride(config.assigneeIds, 'assigneeIds') ?? null;
    }
    const updated = updateFolder(folderId, sanitizedConfig);
    if (updated && config?.usageProjectId !== undefined) {
      assignUsageProjectToFolderTasks(folderId, updated.usageProjectId ?? null);
    }
    return updated;
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
    const usageProjectId = folderId ? (getFolder(folderId)?.usageProjectId ?? null) : null;
    assignUsageProjectToTasks([taskId], usageProjectId);
    return { success: true, usageProjectId };
  });

  handle('task:assignUsageProject', async (_event: IpcMainInvokeEvent, taskId: string, usageProjectId: string | null) => {
    const sanitizedTaskId = sanitizeString(taskId, 'taskId', 128);
    const sanitizedUsageProjectId = sanitizeOptionalText(usageProjectId, 'usageProjectId', 128).trim() || null;
    if (sanitizedUsageProjectId && !getUsageProject(sanitizedUsageProjectId)) {
      throw new Error('Usage project not found.');
    }
    assignUsageProjectToTasks([sanitizedTaskId], sanitizedUsageProjectId);
    return { success: true, usageProjectId: sanitizedUsageProjectId };
  });
}
