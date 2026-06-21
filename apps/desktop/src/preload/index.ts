/**
 * Preload Script for Local Renderer
 *
 * This preload script exposes a secure API to the local React renderer
 * for communicating with the Electron main process via IPC.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConnectorExtensionConfig,
  AppConnectorExtensionConfigInput,
  AppConnectorExtensionState,
  AppConnectorRuntimeStatus,
  AppConnectorRuntimeTestResult,
  BuildBuildRequest,
  BuildDiffEnforcementMode,
  BuildGitActionResult,
  BuildGitBackupBranch,
  BuildGitConflictFile,
  BuildGitMismatchSummary,
  BuildGitPullRequestCreateInput,
  BuildGitPullRequestCreateResult,
  BuildGitRemoteInput,
  BuildGitRemoteRepositoryCreateInput,
  BuildGitRemoteRepositoryCreateResult,
  BuildGitStageInput,
  BuildGitResolveMismatchInput,
  BuildGitStashEntry,
  BuildGitSummary,
  BuildGitReflogEntry,
  BuildQualityCheckRun,
  BuildQualityCheckRunRequest,
  BuildTaskHistoryListInput,
  BuildTaskSession,
  BuildTaskSessionArchiveInput,
  BuildTaskSessionCreateInput,
  BuildTaskSessionDeleteInput,
  BuildTaskSessionListResult,
  BuildTaskSessionPinInput,
  BuildTaskSessionRenameInput,
  BuildTaskSessionUpdateInput,
  BuildProjectPreset,
  BuildProjectPresetInput,
  BuildProjectPresetListResult,
  BuildFileTreeNode,
  BuildLogsResponse,
  BuildRuntimeCommandResult,
  BuildSessionSnapshot,
  BuildStartRequest,
  BuildWorkspaceFingerprint,
  BuildWorkspaceDiff,
  BuildWorkspaceDiffFileContent,
  BuildWorkspaceBaselineCaptureResult,
  BuildWorkspaceBaselineResolveResult,
  BuildWorkspaceFileContent,
  SubagentRunDetail,
  SubagentRunRecord,
  SubagentRunTreeNode,
  GatewayConnectorRuntimeDiscoveryItem,
  GatewayConnectorDiscoverySnapshot,
  GatewayConnectorExtensionConfig,
  GatewayConnectorExtensionConfigInput,
  GatewayConnectorExtensionState,
  GatewayConnectorRuntimeStatus,
  GatewayConnectorRuntimeTestResult,
  GatewayRouteBinding,
  GatewayRunRecord,
  GatewaySessionRecord,
  PermissionResponse,
  ModelConfig,
  ProviderConfig,
  TaskConfig,
  AutomationDraftRequest,
  AutomationDraftResult,
  UsagePeriod,
  UsageBudgetSettings,
  UsageBudgetStatus,
  UsageAssignee,
  UsageAssigneeInput,
  UsageAssigneeOverview,
  UsageAssigneeUpdate,
  UsageProject,
  UsageProjectBudgetStatus,
  UsageProjectBudgetWindow,
  UsageProjectBudgetWindowInput,
  UsageProjectBudgetWindowUpdate,
  UsageProjectKanbanColumn,
  UsageProjectKanbanColumnInput,
  UsageProjectKanbanColumnUpdate,
  UsageProjectInput,
  UsageProjectAnalytics,
  UsageProjectSummary,
  UsageProjectUpdate,
  UsageProjectWorkItem,
  UsageProjectWorkItemInput,
  UsageProjectWorkItemUpdate,
  ChecklistListPromptGenerateRequest,
  ChecklistListPromptGenerateResponse,
  WorkItemNotePromptGenerateRequest,
  WorkItemNotePromptGenerateResponse,
  UsagePricingAutofillRequest,
  UsagePricingAutofillResult,
  UsagePricingSettings,
  HelpDocPageResponse,
  HelpDocsListResponse,
  HelpDocsSearchResponse,
  HelpDocsUpdatedEvent,
  PluginCommandContribution,
  PluginDiagnosticsState,
  PluginDiagnosticsRecord,
  PluginRecord,
  PluginRegistryState,
} from '@accomplish/shared';

// Expose the accomplish API to the renderer
const accomplishAPI = {
  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:platform'),

  // Shell
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-external', url),
  openPath: (filePath: string): Promise<{ ok: boolean; path: string; error?: string }> =>
    ipcRenderer.invoke('shell:open-path', filePath),

  // Help docs
  listHelpDocs: (): Promise<HelpDocsListResponse> =>
    ipcRenderer.invoke('help-docs:list'),
  readHelpDoc: (docId: string): Promise<HelpDocPageResponse> =>
    ipcRenderer.invoke('help-docs:read', docId),
  searchHelpDocs: (query: string): Promise<HelpDocsSearchResponse> =>
    ipcRenderer.invoke('help-docs:search', query),
  getHelpAssetDataUrl: (docId: string, assetPath: string): Promise<{ dataUrl: string }> =>
    ipcRenderer.invoke('help-docs:asset-data-url', { docId, assetPath }),
  openHelpDocInEditor: (docId: string): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('help-docs:open-in-editor', docId),
  openHelpDocsFolder: (): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('help-docs:open-folder'),
  openHelpAsset: (docId: string, assetPath: string): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('help-docs:open-asset', { docId, assetPath }),

  // Dialog
  selectFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:select-folder', defaultPath ? { defaultPath } : undefined),
  selectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('dialog:select-files'),

  // Task operations
  startTask: (config: TaskConfig): Promise<unknown> =>
    ipcRenderer.invoke('task:start', config),
  cancelTask: (taskId: string): Promise<void> =>
    ipcRenderer.invoke('task:cancel', taskId),
  interruptTask: (taskId: string): Promise<void> =>
    ipcRenderer.invoke('task:interrupt', taskId),
  getTask: (taskId: string, agentId?: string): Promise<unknown> =>
    ipcRenderer.invoke('task:get', taskId, agentId),
  listTasks: (agentId?: string): Promise<unknown[]> => ipcRenderer.invoke('task:list', agentId),
  deleteTask: (taskId: string): Promise<void> =>
    ipcRenderer.invoke('task:delete', taskId),
  clearTaskHistory: (agentId?: string): Promise<void> => ipcRenderer.invoke('task:clear-history', agentId),
  listSavedPrompts: (): Promise<Array<{ id: string; title: string; content: string; category: string; createdAt: string; updatedAt: string }>> =>
    ipcRenderer.invoke('saved-prompts:list'),
  listSavedPromptCategories: (): Promise<string[]> =>
    ipcRenderer.invoke('saved-prompts:categories:list'),
  createSavedPromptCategory: (name: string): Promise<string[]> =>
    ipcRenderer.invoke('saved-prompts:categories:create', name),
  renameSavedPromptCategory: (payload: { from: string; to: string }): Promise<{
    categories: string[];
    prompts: Array<{ id: string; title: string; content: string; category: string; createdAt: string; updatedAt: string }>;
  }> => ipcRenderer.invoke('saved-prompts:categories:rename', payload),
  deleteSavedPromptCategory: (payload: { name: string; replacement?: string }): Promise<{
    categories: string[];
    prompts: Array<{ id: string; title: string; content: string; category: string; createdAt: string; updatedAt: string }>;
  }> => ipcRenderer.invoke('saved-prompts:categories:delete', payload),
  upsertSavedPrompt: (payload: { id?: string; title: string; content: string; category?: string; createdAt?: string; updatedAt?: string }): Promise<{
    id: string;
    title: string;
    content: string;
    category: string;
    createdAt: string;
    updatedAt: string;
  }> => ipcRenderer.invoke('saved-prompts:upsert', payload),
  deleteSavedPrompt: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('saved-prompts:delete', id),

  // Permission responses
  respondToPermission: (response: PermissionResponse): Promise<void> =>
    ipcRenderer.invoke('permission:respond', response),

  // Session management
  resumeSession: (
    sessionId: string,
    prompt: string,
    taskId?: string,
    attachedFiles?: string[],
    privacyMode?: 'normal' | 'incognito',
    usageProjectId?: string | null,
    options?: {
      workingDirectory?: string;
      requiresBrowser?: boolean;
      buildMode?: boolean;
      buildWorkspaceRelativePath?: string;
    }
  ): Promise<unknown> =>
    ipcRenderer.invoke('session:resume', sessionId, prompt, taskId, attachedFiles, privacyMode, usageProjectId, options),

  // Proactive assistant (runs only when user clicks the button)
  planNextJobs: (agentId?: string): Promise<unknown> =>
    ipcRenderer.invoke('assistant:plan-next-jobs', agentId),

  // Context window estimation (for live indicator in chat composer)
  estimateContextWindow: (payload: {
    prompt: string;
    taskId?: string;
    agentId?: string;
    systemPromptAppend?: string;
    attachedFiles?: string[];
    maxOutputTokensOverride?: number;
    headroomSafetyTokens?: number;
  }): Promise<unknown> => ipcRenderer.invoke('context:estimate', payload),

  // Usage estimate (global)
  getUsageSummary: (period: UsagePeriod): Promise<unknown> =>
    ipcRenderer.invoke('usage:get-summary', period),
  getUsagePricing: (): Promise<unknown> =>
    ipcRenderer.invoke('usage:pricing:get'),
  listUsageModelsUsed: (): Promise<unknown> =>
    ipcRenderer.invoke('usage:models-used'),
  setUsagePricing: (settings: UsagePricingSettings): Promise<unknown> =>
    ipcRenderer.invoke('usage:pricing:set', settings),
  autoFillUsagePricingWithAI: (request: UsagePricingAutofillRequest): Promise<UsagePricingAutofillResult> =>
    ipcRenderer.invoke('usage:pricing:autofill', request),
  getUsageBudgets: (): Promise<UsageBudgetSettings> =>
    ipcRenderer.invoke('usage:budgets:get'),
  setUsageBudgets: (settings: UsageBudgetSettings): Promise<UsageBudgetSettings> =>
    ipcRenderer.invoke('usage:budgets:set', settings),
  getUsageBudgetStatus: (payload?: { agentId?: string }): Promise<UsageBudgetStatus[]> =>
    ipcRenderer.invoke('usage:budget-status:get', payload),
  listUsageProjects: (payload?: { includeArchived?: boolean }): Promise<UsageProject[]> =>
    ipcRenderer.invoke('usage:projects:list', payload),
  createUsageProject: (input: UsageProjectInput): Promise<UsageProject> =>
    ipcRenderer.invoke('usage:projects:create', input),
  updateUsageProject: (projectId: string, update: UsageProjectUpdate): Promise<UsageProject> =>
    ipcRenderer.invoke('usage:projects:update', projectId, update),
  archiveUsageProject: (projectId: string, archived?: boolean): Promise<UsageProject> =>
    ipcRenderer.invoke('usage:projects:archive', projectId, archived),
  listUsageProjectBudgetWindows: (payload?: { projectId?: string }): Promise<UsageProjectBudgetWindow[]> =>
    ipcRenderer.invoke('usage:project-budget-windows:list', payload),
  createUsageProjectBudgetWindow: (input: UsageProjectBudgetWindowInput): Promise<UsageProjectBudgetWindow> =>
    ipcRenderer.invoke('usage:project-budget-windows:create', input),
  updateUsageProjectBudgetWindow: (windowId: string, update: UsageProjectBudgetWindowUpdate): Promise<UsageProjectBudgetWindow> =>
    ipcRenderer.invoke('usage:project-budget-windows:update', windowId, update),
  deleteUsageProjectBudgetWindow: (windowId: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('usage:project-budget-windows:delete', windowId),
  getUsageProjectSummary: (payload: { projectId: string; startsAt?: string; endsAt?: string | null; windowId?: string }): Promise<UsageProjectSummary> =>
    ipcRenderer.invoke('usage:project-summary:get', payload),
  getUsageProjectAnalytics: (payload: { projectId: string; startsAt?: string; endsAt?: string | null; windowId?: string; days?: number }): Promise<UsageProjectAnalytics> =>
    ipcRenderer.invoke('usage:project-analytics:get', payload),
  getUsageProjectBudgetStatus: (payload?: { projectId?: string }): Promise<UsageProjectBudgetStatus[]> =>
    ipcRenderer.invoke('usage:project-budget-status:get', payload),
  listUsageProjectWorkItems: (payload: { projectId: string; includeArchived?: boolean }): Promise<UsageProjectWorkItem[]> =>
    ipcRenderer.invoke('usage:project-work-items:list', payload),
  createUsageProjectWorkItem: (input: UsageProjectWorkItemInput): Promise<UsageProjectWorkItem> =>
    ipcRenderer.invoke('usage:project-work-items:create', input),
  updateUsageProjectWorkItem: (itemId: string, update: UsageProjectWorkItemUpdate): Promise<UsageProjectWorkItem> =>
    ipcRenderer.invoke('usage:project-work-items:update', itemId, update),
  archiveUsageProjectWorkItem: (itemId: string, archived?: boolean): Promise<UsageProjectWorkItem> =>
    ipcRenderer.invoke('usage:project-work-items:archive', itemId, archived),
  listUsageProjectKanbanColumns: (payload: { projectId: string }): Promise<UsageProjectKanbanColumn[]> =>
    ipcRenderer.invoke('usage:project-kanban-columns:list', payload),
  createUsageProjectKanbanColumn: (input: UsageProjectKanbanColumnInput): Promise<UsageProjectKanbanColumn> =>
    ipcRenderer.invoke('usage:project-kanban-columns:create', input),
  updateUsageProjectKanbanColumn: (columnId: string, update: UsageProjectKanbanColumnUpdate): Promise<UsageProjectKanbanColumn> =>
    ipcRenderer.invoke('usage:project-kanban-columns:update', columnId, update),
  deleteUsageProjectKanbanColumn: (columnId: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('usage:project-kanban-columns:delete', columnId),
  listUsageAssignees: (payload?: { includeArchived?: boolean }): Promise<UsageAssignee[]> =>
    ipcRenderer.invoke('usage:assignees:list', payload),
  createUsageAssignee: (input: UsageAssigneeInput): Promise<UsageAssignee> =>
    ipcRenderer.invoke('usage:assignees:create', input),
  updateUsageAssignee: (assigneeId: string, update: UsageAssigneeUpdate): Promise<UsageAssignee> =>
    ipcRenderer.invoke('usage:assignees:update', assigneeId, update),
  archiveUsageAssignee: (assigneeId: string, archived?: boolean): Promise<UsageAssignee> =>
    ipcRenderer.invoke('usage:assignees:archive', assigneeId, archived),
  getUsageAssigneeOverview: (payload?: { assigneeId?: string }): Promise<UsageAssigneeOverview[]> =>
    ipcRenderer.invoke('usage:assignee-overview:get', payload),

  // Settings
  getApiKeys: (): Promise<unknown[]> => ipcRenderer.invoke('settings:api-keys'),
  addApiKey: (
    provider: string,
    key: string,
    label?: string
  ): Promise<unknown> =>
    ipcRenderer.invoke('settings:add-api-key', provider, key, label),
  removeApiKey: (id: string): Promise<void> =>
    ipcRenderer.invoke('settings:remove-api-key', id),
  getDebugMode: (): Promise<boolean> =>
    ipcRenderer.invoke('settings:debug-mode'),
  setDebugMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:set-debug-mode', enabled),
  getAppSettings: (): Promise<{ debugMode: boolean; onboardingComplete: boolean; runInBackground: boolean; launchAtLogin: boolean; browserProfile: string; workspaceRoot: string | null; activeAgentId: string; mobileNodesEnabled: boolean; mobileNodesMaxLivePreviews: number; mobileNodesDisplayName: string; webhookBindMode: 'localhost' | 'all'; agentSpeedMode: 'fast' | 'balanced' | 'deep'; buildDiffEnforcementMode: BuildDiffEnforcementMode }> =>
    ipcRenderer.invoke('settings:app-settings'),
  setRunInBackground: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:set-run-in-background', enabled),
  setLaunchAtLogin: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('settings:set-launch-at-login', enabled),
  setMobileNodesEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:set-mobile-nodes-enabled', enabled),
  setMobileNodesMaxLivePreviews: (count: number): Promise<number> =>
    ipcRenderer.invoke('settings:set-mobile-nodes-max-live-previews', count),
  setMobileNodesDisplayName: (name: string): Promise<string> =>
    ipcRenderer.invoke('settings:set-mobile-nodes-name', name),
  setWebhookBindMode: (mode: 'localhost' | 'all'): Promise<'localhost' | 'all'> =>
    ipcRenderer.invoke('settings:set-webhook-bind', mode),
  setAgentSpeedMode: (mode: 'fast' | 'balanced' | 'deep'): Promise<'fast' | 'balanced' | 'deep'> =>
    ipcRenderer.invoke('settings:set-agent-speed-mode', mode),
  setBuildDiffEnforcementMode: (mode: BuildDiffEnforcementMode): Promise<BuildDiffEnforcementMode> =>
    ipcRenderer.invoke('settings:set-build-diff-enforcement-mode', mode),
  saveDataUrlToFile: (dataUrl: string, baseName?: string): Promise<{ filePath: string }> =>
    ipcRenderer.invoke('files:save-data-url', { dataUrl, baseName }),
  saveDataUrlToFileAs: (dataUrl: string, baseName?: string): Promise<{ filePath?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('files:save-data-url-as', { dataUrl, baseName }),
  saveTextToFileAs: (content: string, options?: { baseName?: string; extension?: string; title?: string }): Promise<{ filePath?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('files:save-text-as', { content, ...options }),
  captureWindowRect: (rect: { x: number; y: number; width: number; height: number }): Promise<{ dataUrl: string }> =>
    ipcRenderer.invoke('window:capture-rect', rect),
  captureRuntimePreviewFullPage: (url: string): Promise<{ dataUrl: string; width: number; height: number; fullWidth: number; fullHeight: number; clipped: boolean }> =>
    ipcRenderer.invoke('runtime-preview:capture-full-page', { url }),
  setBrowserProfile: (profile: string): Promise<string> =>
    ipcRenderer.invoke('settings:set-browser-profile', profile),
  setWorkspaceRoot: (root: string | null): Promise<string | null> =>
    ipcRenderer.invoke('settings:set-workspace-root', root),
  getMemoryState: (payload?: { agentId?: string; date?: string }): Promise<unknown> =>
    ipcRenderer.invoke('settings:memory:get', payload),
  readMemoryFile: (payload: { kind: 'long-term' | 'daily'; date?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('settings:memory:read', payload),
  saveMemoryFile: (payload: { kind: 'long-term' | 'daily'; date?: string; agentId?: string; content?: string }): Promise<unknown> =>
    ipcRenderer.invoke('settings:memory:save', payload),
  getRuntimeHooks: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:runtime-hooks:get'),
  saveRuntimeHooks: (raw: string): Promise<unknown> =>
    ipcRenderer.invoke('settings:runtime-hooks:save', raw),
  getRuntimeHookDiagnostics: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:runtime-hooks:diagnostics'),
  clearRuntimeHookDiagnostics: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:runtime-hooks:clear-diagnostics'),
  getPermissionPolicySettings: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:permission-policy:get'),
  setPermissionPolicySettings: (settings: unknown): Promise<unknown> =>
    ipcRenderer.invoke('settings:permission-policy:set', settings),
  getPermissionPolicyAudit: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:permission-policy:audit'),
  getOpenCodePermissionPreview: (agentId?: string): Promise<unknown> =>
    ipcRenderer.invoke('settings:permission-policy:opencode-preview', agentId),
  clearPermissionPolicyAudit: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:permission-policy:clear-audit'),
  listPlugins: (): Promise<PluginRegistryState> =>
    ipcRenderer.invoke('settings:plugins:list'),
  getPluginDiagnostics: (): Promise<PluginDiagnosticsState> =>
    ipcRenderer.invoke('settings:plugins:diagnostics'),
  clearPluginDiagnosticsHistory: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke('settings:plugins:clear-diagnostics-history'),
  listPluginCommands: (): Promise<{ commands: PluginCommandContribution[] }> =>
    ipcRenderer.invoke('plugins:commands:list'),
  setPluginEnabled: (pluginId: string, enabled: boolean): Promise<PluginRecord> =>
    ipcRenderer.invoke('settings:plugins:set-enabled', { pluginId, enabled }),
  installPluginFromDirectory: (sourceDir: string): Promise<PluginRecord> =>
    ipcRenderer.invoke('settings:plugins:install-from-directory', { sourceDir }),
  uninstallPlugin: (pluginId: string): Promise<{ ok: true; pluginId: string }> =>
    ipcRenderer.invoke('settings:plugins:uninstall', { pluginId }),
  openManagedPluginsRoot: (): Promise<{ ok: boolean; path: string; error?: string }> =>
    ipcRenderer.invoke('settings:plugins:open-managed-root'),

  // Agents
  listAgents: (): Promise<unknown> =>
    ipcRenderer.invoke('agents:list'),
  upsertAgent: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('agents:upsert', config),
  deleteAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke('agents:delete', agentId),
  setDefaultAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke('agents:set-default', agentId),
  setActiveAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke('agents:set-active', agentId),
  getActiveAgent: (): Promise<string> =>
    ipcRenderer.invoke('agents:get-active'),

  // Discord connector
  getDiscordConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('discord:get'),
  setDiscordConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('discord:set-config', config),
  setDiscordToken: (token: string): Promise<unknown> =>
    ipcRenderer.invoke('discord:set-token', token),
  clearDiscordToken: (): Promise<unknown> =>
    ipcRenderer.invoke('discord:clear-token'),
  listDiscordPairingRequests: (): Promise<unknown> =>
    ipcRenderer.invoke('discord:pairing:list'),
  approveDiscordPairing: (userId: string, code: string): Promise<unknown> =>
    ipcRenderer.invoke('discord:pairing:approve', userId, code),

  // Telegram connector
  getTelegramConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('telegram:get'),
  setTelegramConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('telegram:set-config', config),
  setTelegramToken: (token: string): Promise<unknown> =>
    ipcRenderer.invoke('telegram:set-token', token),
  clearTelegramToken: (): Promise<unknown> =>
    ipcRenderer.invoke('telegram:clear-token'),
  listTelegramPairingRequests: (): Promise<unknown> =>
    ipcRenderer.invoke('telegram:pairing:list'),
  approveTelegramPairing: (userId: string, code: string): Promise<unknown> =>
    ipcRenderer.invoke('telegram:pairing:approve', userId, code),

  // Voice wake
  getVoiceWakeConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('voicewake:get'),
  setVoiceWakeConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('voicewake:set', config),
  getVoiceWakeAccessKeyStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('voicewake:get-access-key'),
  setVoiceWakeAccessKey: (accessKey: string): Promise<unknown> =>
    ipcRenderer.invoke('voicewake:set-access-key', accessKey),
  clearVoiceWakeAccessKey: (): Promise<unknown> =>
    ipcRenderer.invoke('voicewake:clear-access-key'),
  onVoiceWakeLevel: (callback: (data: { level: number; at: string }) => void) => {
    const listener = (_: unknown, data: { level: number; at: string }) => callback(data);
    ipcRenderer.on('voicewake:level', listener);
    return () => ipcRenderer.removeListener('voicewake:level', listener);
  },
  onVoiceWakeDetected: (callback: (data: { keyword: string; at: string }) => void) => {
    const listener = (_: unknown, data: { keyword: string; at: string }) => callback(data);
    ipcRenderer.on('voicewake:detected', listener);
    return () => ipcRenderer.removeListener('voicewake:detected', listener);
  },
  transcribeWhisper: (audioBase64: string): Promise<{ text: string }> =>
    ipcRenderer.invoke('voicewake:transcribe-whisper', { audioBase64 }),

  // Mobile node pairing
  listNodePairing: (): Promise<unknown> =>
    ipcRenderer.invoke('nodes:pairing:list'),
  approveNodePairing: (requestId: string): Promise<unknown> =>
    ipcRenderer.invoke('nodes:pairing:approve', requestId),
  rejectNodePairing: (requestId: string): Promise<unknown> =>
    ipcRenderer.invoke('nodes:pairing:reject', requestId),
  removePairedNode: (nodeId: string): Promise<unknown> =>
    ipcRenderer.invoke('nodes:paired:remove', nodeId),
  updatePairedNodeName: (
    nodeId: string,
    displayName: string | null,
    badgeColor?: string | null,
    badgeIcon?: string | null
  ): Promise<unknown> =>
    ipcRenderer.invoke('nodes:paired:update-name', { nodeId, displayName, badgeColor, badgeIcon }),
  updatePairedNodeAiAccess: (nodeId: string, allowed: boolean): Promise<unknown> =>
    ipcRenderer.invoke('nodes:paired:update-ai-access', { nodeId, allowed }),
  requestNodeCameraSnapshot: (nodeId: string, target?: 'snapshot' | 'live'): Promise<unknown> =>
    ipcRenderer.invoke('nodes:camera:snapshot', { nodeId, target }),
  startNodeMicStream: (nodeId: string, chunkMs?: number): Promise<unknown> =>
    ipcRenderer.invoke('nodes:mic:start', { nodeId, chunkMs }),
  stopNodeMicStream: (nodeId: string, streamId?: string): Promise<unknown> =>
    ipcRenderer.invoke('nodes:mic:stop', { nodeId, streamId }),
  startNodeScreenStream: (nodeId: string, chunkMs?: number): Promise<unknown> =>
    ipcRenderer.invoke('nodes:screen:start', { nodeId, chunkMs }),
  stopNodeScreenStream: (nodeId: string, streamId?: string): Promise<unknown> =>
    ipcRenderer.invoke('nodes:screen:stop', { nodeId, streamId }),
  getLatestNodeStreamChunk: (nodeId: string, kind: 'mic' | 'screen'): Promise<unknown> =>
    ipcRenderer.invoke('nodes:stream:latest', { nodeId, kind }),
  getNodeCameraStatus: (nodeId: string): Promise<unknown> =>
    ipcRenderer.invoke('nodes:camera:status', { nodeId }),

  // Gateway (remote WebChat)
  getGatewayConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('gateway:get'),
  setGatewayConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('gateway:set-config', config),
  setGatewayToken: (token: string): Promise<unknown> =>
    ipcRenderer.invoke('gateway:set-token', token),
  clearGatewayToken: (): Promise<unknown> =>
    ipcRenderer.invoke('gateway:clear-token'),
  generateGatewayToken: (): Promise<unknown> =>
    ipcRenderer.invoke('gateway:generate-token'),
  setGatewayPassword: (password: string): Promise<unknown> =>
    ipcRenderer.invoke('gateway:set-password', password),
  clearGatewayPassword: (): Promise<unknown> =>
    ipcRenderer.invoke('gateway:clear-password'),
  generateGatewayPassword: (): Promise<unknown> =>
    ipcRenderer.invoke('gateway:generate-password'),
  listGatewayBindings: (): Promise<GatewayRouteBinding[]> =>
    ipcRenderer.invoke('gateway:bindings:list'),
  setGatewayBindings: (bindings: GatewayRouteBinding[]): Promise<GatewayRouteBinding[]> =>
    ipcRenderer.invoke('gateway:bindings:set', bindings),
  upsertGatewayBinding: (binding: GatewayRouteBinding): Promise<GatewayRouteBinding> =>
    ipcRenderer.invoke('gateway:bindings:upsert', binding),
  removeGatewayBinding: (bindingId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gateway:bindings:remove', bindingId),
  listGatewaySessions: (agentId?: string): Promise<GatewaySessionRecord[]> =>
    ipcRenderer.invoke('gateway:sessions:list', agentId),
  getGatewaySession: (sessionKey: string): Promise<GatewaySessionRecord | null> =>
    ipcRenderer.invoke('gateway:sessions:get', sessionKey),
  deleteGatewaySession: (sessionKey: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gateway:sessions:delete', sessionKey),
  listGatewayRuns: (agentId?: string): Promise<GatewayRunRecord[]> =>
    ipcRenderer.invoke('gateway:runs:list', agentId),
  getGatewayRun: (runId: string): Promise<GatewayRunRecord | null> =>
    ipcRenderer.invoke('gateway:runs:get', runId),
  listGatewayConnectorExtensions: (): Promise<GatewayConnectorExtensionState[]> =>
    ipcRenderer.invoke('gateway-connectors:list'),
  setGatewayConnectorExtensionConfig: (config: GatewayConnectorExtensionConfigInput): Promise<{
    config: GatewayConnectorExtensionConfig;
    secretSet: boolean;
    bindingId: string;
    runtimeKey?: string;
  }> => ipcRenderer.invoke('gateway-connectors:set-config', config),
  createGatewayConnectorExtensionInstance: (connectorId: string, name?: string): Promise<{ state: GatewayConnectorExtensionState }> =>
    ipcRenderer.invoke('gateway-connectors:create-instance', connectorId, name),
  deleteGatewayConnectorExtensionInstance: (connectorId: string, instanceId?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gateway-connectors:delete-instance', connectorId, instanceId),
  setGatewayConnectorExtensionSecret: (connectorId: string, secret: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('gateway-connectors:set-secret', connectorId, secret, instanceId),
  clearGatewayConnectorExtensionSecret: (connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('gateway-connectors:clear-secret', connectorId, instanceId),
  generateGatewayConnectorExtensionSecret: (connectorId: string, instanceId?: string): Promise<{ secret: string; secretSet: boolean }> =>
    ipcRenderer.invoke('gateway-connectors:generate-secret', connectorId, instanceId),
  listGatewayConnectorDiscovery: (): Promise<GatewayConnectorDiscoverySnapshot[]> =>
    ipcRenderer.invoke('gateway-connectors:discovery:list'),
  clearGatewayConnectorDiscovery: (connectorId?: string, instanceId?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gateway-connectors:discovery:clear', connectorId, instanceId),
  listGatewayConnectorRuntimeStatuses: (): Promise<GatewayConnectorRuntimeStatus[]> =>
    ipcRenderer.invoke('gateway-connectors:runtime:list'),
  restartGatewayConnectorRuntime: (connectorId?: string, instanceId?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('gateway-connectors:runtime:restart', connectorId, instanceId),
  testGatewayConnectorRuntime: (connectorId: string, instanceId?: string): Promise<GatewayConnectorRuntimeTestResult> =>
    ipcRenderer.invoke('gateway-connectors:runtime:test', connectorId, instanceId),
  discoverGatewayConnectorRuntimeTargets: (connectorId: string, instanceId?: string): Promise<GatewayConnectorRuntimeDiscoveryItem[]> =>
    ipcRenderer.invoke('gateway-connectors:runtime:discover', connectorId, instanceId),

  // App connector extensions
  listAppConnectorExtensions: (): Promise<AppConnectorExtensionState[]> =>
    ipcRenderer.invoke('app-connectors:list'),
  createAppConnectorExtensionInstance: (connectorId: string, name?: string): Promise<{ state: AppConnectorExtensionState }> =>
    ipcRenderer.invoke('app-connectors:create-instance', connectorId, name),
  deleteAppConnectorExtensionInstance: (connectorId: string, instanceId?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app-connectors:delete-instance', connectorId, instanceId),
  setAppConnectorExtensionConfig: (config: AppConnectorExtensionConfigInput): Promise<{
    config: AppConnectorExtensionConfig;
    secretSet: boolean;
    runtimeKey: string;
  }> => ipcRenderer.invoke('app-connectors:set-config', config),
  setAppConnectorExtensionSecret: (connectorId: string, secret: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('app-connectors:set-secret', connectorId, secret, instanceId),
  clearAppConnectorExtensionSecret: (connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('app-connectors:clear-secret', connectorId, instanceId),
  generateAppConnectorExtensionSecret: (connectorId: string, instanceId?: string): Promise<{ secret: string; secretSet: boolean }> =>
    ipcRenderer.invoke('app-connectors:generate-secret', connectorId, instanceId),
  setAppConnectorOAuthClientSecret: (connectorId: string, clientSecret: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('app-connectors:oauth:set-client-secret', connectorId, clientSecret, instanceId),
  clearAppConnectorOAuthClientSecret: (connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('app-connectors:oauth:clear-client-secret', connectorId, instanceId),
  getAppConnectorOAuthClientSecretStatus: (connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }> =>
    ipcRenderer.invoke('app-connectors:oauth:get-client-secret-status', connectorId, instanceId),
  listAppConnectorRuntimeStatuses: (): Promise<AppConnectorRuntimeStatus[]> =>
    ipcRenderer.invoke('app-connectors:runtime:list'),
  testAppConnectorRuntime: (connectorId: string, instanceId?: string): Promise<AppConnectorRuntimeTestResult> =>
    ipcRenderer.invoke('app-connectors:runtime:test', connectorId, instanceId),
  executeAppConnector: (payload: {
    connectorId: string;
    connectorInstanceId?: string;
    action: string;
    args?: Record<string, unknown>;
  }): Promise<unknown> => ipcRenderer.invoke('app-connectors:execute', payload),
  startAppConnectorOAuthFlow: (payload: {
    connectorId: string;
    connectorInstanceId?: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string[] | string;
    redirectMode?: 'auto' | 'desktop' | 'loopback' | 'public';
    redirectUri?: string;
  }): Promise<unknown> => ipcRenderer.invoke('app-connectors:oauth:start', payload),
  getAppConnectorOAuthFlowStatus: (flowId: string): Promise<unknown> =>
    ipcRenderer.invoke('app-connectors:oauth:status', flowId),
  disconnectAppConnectorOAuth: (payload: {
    connectorId: string;
    connectorInstanceId?: string;
    remoteRevoke?: boolean;
  }): Promise<unknown> => ipcRenderer.invoke('app-connectors:oauth:disconnect', payload),
  handleAppConnectorOAuthCallback: (callbackUrl: string): Promise<unknown> =>
    ipcRenderer.invoke('app-connectors:oauth:handle-callback', callbackUrl),

  // Build Mode
  detectBuildProject: (payload: { agentId: string; workspaceRelativePath?: string }): Promise<BuildSessionSnapshot> =>
    ipcRenderer.invoke('build-mode:project:detect', payload),
  getBuildRuntimeSnapshot: (payload: { agentId: string; workspaceRelativePath?: string }): Promise<BuildSessionSnapshot> =>
    ipcRenderer.invoke('build-mode:runtime:get', payload),
  startBuildRuntime: (payload: BuildStartRequest): Promise<BuildSessionSnapshot> =>
    ipcRenderer.invoke('build-mode:runtime:start', payload),
  stopBuildRuntime: (payload: { agentId: string }): Promise<BuildSessionSnapshot> =>
    ipcRenderer.invoke('build-mode:runtime:stop', payload),
  restartBuildRuntime: (payload: { agentId: string }): Promise<BuildSessionSnapshot> =>
    ipcRenderer.invoke('build-mode:runtime:restart', payload),
  runBuildCommand: (payload: BuildBuildRequest): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }> =>
    ipcRenderer.invoke('build-mode:runtime:run-build', payload),
  runBuildQualityChecks: (payload: BuildQualityCheckRunRequest): Promise<BuildQualityCheckRun> =>
    ipcRenderer.invoke('build-mode:quality-checks:run', payload),
  getBuildQualityChecks: (payload: { agentId: string; workspaceRelativePath?: string }): Promise<BuildQualityCheckRun | null> =>
    ipcRenderer.invoke('build-mode:quality-checks:get', payload),
  runStartCommandOnce: (payload: { agentId: string; workspaceRelativePath?: string; envOverrides?: Record<string, string>; commandOverride?: string }): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }> =>
    ipcRenderer.invoke('build-mode:runtime:run-once', payload),
  getBuildRuntimeLogs: (payload: { agentId: string; cursor?: number; limit?: number }): Promise<BuildLogsResponse> =>
    ipcRenderer.invoke('build-mode:runtime:logs', payload),
  clearBuildRuntimeLogs: (payload: { agentId: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:runtime:clear-logs', payload),
  getBuildTerminalSnapshot: (payload: { agentId: string }): Promise<import('@accomplish/shared').BuildTerminalSnapshot> =>
    ipcRenderer.invoke('build-mode:terminal:snapshot', payload),
  createBuildTerminalSession: (payload: { agentId: string; workspaceRelativePath?: string; splitFromSessionId?: string }): Promise<import('@accomplish/shared').BuildTerminalSnapshot> =>
    ipcRenderer.invoke('build-mode:terminal:create', payload),
  setBuildTerminalActiveSession: (payload: { agentId: string; sessionId: string }): Promise<import('@accomplish/shared').BuildTerminalSnapshot> =>
    ipcRenderer.invoke('build-mode:terminal:set-active', payload),
  getBuildTerminalOutput: (payload: { agentId: string; sessionId: string; cursor?: number; limit?: number }): Promise<import('@accomplish/shared').BuildTerminalOutputResponse> =>
    ipcRenderer.invoke('build-mode:terminal:output', payload),
  runBuildTerminalCommand: (payload: { agentId: string; sessionId: string; command: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:terminal:run', payload),
  writeBuildTerminalInput: (payload: { agentId: string; sessionId: string; input: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:terminal:write', payload),
  interruptBuildTerminalSession: (payload: { agentId: string; sessionId: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:terminal:interrupt', payload),
  resizeBuildTerminalSession: (payload: { agentId: string; sessionId: string; cols: number; rows: number }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:terminal:resize', payload),
  clearBuildTerminalSession: (payload: { agentId: string; sessionId: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:terminal:clear', payload),
  closeBuildTerminalSession: (payload: { agentId: string; sessionId: string }): Promise<import('@accomplish/shared').BuildTerminalSnapshot> =>
    ipcRenderer.invoke('build-mode:terminal:close', payload),
  onBuildTerminalEntry: (callback: (payload: { agentId: string; sessionId: string; entry: import('@accomplish/shared').BuildTerminalEntry }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { agentId: string; sessionId: string; entry: import('@accomplish/shared').BuildTerminalEntry }) => callback(payload);
    ipcRenderer.on('build-mode:terminal:entry', listener);
    return () => ipcRenderer.removeListener('build-mode:terminal:entry', listener);
  },
  getBuildWorkspaceRoot: (payload: { agentId: string }): Promise<{ workspaceRoot: string }> =>
    ipcRenderer.invoke('build-mode:workspace:root', payload),
  openBuildWorkspacePath: (payload: { agentId: string; relativePath?: string }): Promise<{ ok: boolean; path: string; error?: string }> =>
    ipcRenderer.invoke('build-mode:workspace:open', payload),
  revealBuildWorkspacePath: (payload: { agentId: string; relativePath?: string }): Promise<{ ok: boolean; path: string; error?: string }> =>
    ipcRenderer.invoke('build-mode:workspace:reveal', payload),
  getBuildWorkspaceFingerprint: (payload: { agentId: string; relativePath?: string }): Promise<BuildWorkspaceFingerprint> =>
    ipcRenderer.invoke('build-mode:workspace:fingerprint', payload),
  getBuildWorkspaceTree: (payload: { agentId: string; relativePath?: string; depth?: number; includeHidden?: boolean; maxEntries?: number }): Promise<BuildFileTreeNode> =>
    ipcRenderer.invoke('build-mode:files:tree', payload),
  readBuildWorkspaceFile: (payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<BuildWorkspaceFileContent> =>
    ipcRenderer.invoke('build-mode:files:read', payload),
  writeBuildWorkspaceFile: (payload: { agentId: string; relativePath: string; content: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; size: number; modifiedAt: string }> =>
    ipcRenderer.invoke('build-mode:files:write', payload),
  createBuildWorkspaceFolder: (payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; createdAt: string }> =>
    ipcRenderer.invoke('build-mode:files:create-folder', payload),
  createBuildWorkspaceFile: (payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; size: number; modifiedAt: string }> =>
    ipcRenderer.invoke('build-mode:files:create-file', payload),
  renameBuildWorkspaceEntry: (payload: { agentId: string; relativePath: string; nextName: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; renamedPath: string }> =>
    ipcRenderer.invoke('build-mode:files:rename', payload),
  deleteBuildWorkspaceEntry: (payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; ok: boolean }> =>
    ipcRenderer.invoke('build-mode:files:delete', payload),
  pasteBuildWorkspaceEntry: (payload: {
    agentId: string;
    sourceRelativePath: string;
    destinationDirectoryRelativePath: string;
    mode: 'cut' | 'copy';
    sourceWorkspaceRelativePath?: string;
    destinationWorkspaceRelativePath?: string;
  }): Promise<{ sourceRelativePath: string; pastedPath: string; mode: 'cut' | 'copy' }> =>
    ipcRenderer.invoke('build-mode:files:paste', payload),
  getBuildWorkspaceDiff: (payload: { agentId: string; relativePath?: string; maxChars?: number; baselineId?: string }): Promise<BuildWorkspaceDiff> =>
    ipcRenderer.invoke('build-mode:workspace:diff', payload),
  getBuildWorkspaceDiffFileContent: (payload: { agentId: string; relativePath?: string; filePath: string; baselineId?: string }): Promise<BuildWorkspaceDiffFileContent> =>
    ipcRenderer.invoke('build-mode:workspace:diff-file', payload),
  getBuildGitSummary: (payload: { agentId: string; relativePath?: string; lightweight?: boolean }): Promise<BuildGitSummary> =>
    ipcRenderer.invoke('build-mode:git:summary', payload),
  getBuildGitMismatchSummary: (payload: { agentId: string; relativePath?: string }): Promise<BuildGitMismatchSummary> =>
    ipcRenderer.invoke('build-mode:git:mismatch:summary', payload),
  resolveBuildGitMismatch: (payload: { agentId: string; relativePath?: string } & BuildGitResolveMismatchInput): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:mismatch:resolve', payload),
  initBuildGitRepository: (payload: { agentId: string; relativePath?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:init', payload),
  commitBuildGitChanges: (payload: { agentId: string; relativePath?: string; message: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:commit', payload),
  addBuildGitRemote: (payload: { agentId: string; relativePath?: string } & BuildGitRemoteInput): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:remote:add', payload),
  updateBuildGitRemote: (payload: { agentId: string; relativePath?: string } & BuildGitRemoteInput): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:remote:update', payload),
  fetchBuildGitRemote: (payload: { agentId: string; relativePath?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:fetch', payload),
  pullBuildGitBranch: (payload: { agentId: string; relativePath?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:pull', payload),
  pushBuildGitBranch: (payload: { agentId: string; relativePath?: string; branchName?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:push', payload),
  switchBuildGitBranch: (payload: { agentId: string; relativePath?: string; branchName: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:branch:switch', payload),
  createBuildGitBranch: (payload: { agentId: string; relativePath?: string; branchName: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:branch:create', payload),
  discardBuildGitChanges: (payload: { agentId: string; relativePath?: string; paths: string[] }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:discard', payload),
  getBuildGitConflicts: (payload: { agentId: string; relativePath?: string }): Promise<{ files: BuildGitConflictFile[]; summary: BuildGitSummary }> =>
    ipcRenderer.invoke('build-mode:git:conflicts:get', payload),
  stageBuildGitFiles: (payload: { agentId: string; relativePath?: string } & BuildGitStageInput): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:stage-files', payload),
  finishBuildGitMerge: (payload: { agentId: string; relativePath?: string; message?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:finish-merge', payload),
  createBuildGitStash: (payload: { agentId: string; relativePath?: string; message?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:stash:create', payload),
  listBuildGitStashes: (payload: { agentId: string; relativePath?: string }): Promise<{ stashes: BuildGitStashEntry[]; summary: BuildGitSummary }> =>
    ipcRenderer.invoke('build-mode:git:stash:list', payload),
  applyBuildGitStash: (payload: { agentId: string; relativePath?: string; stashRef: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:stash:apply', payload),
  dropBuildGitStash: (payload: { agentId: string; relativePath?: string; stashRef: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:stash:drop', payload),
  checkoutBuildGitRemoteBranch: (payload: { agentId: string; relativePath?: string; remoteBranchName: string; localBranchName?: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:branch:checkout-remote', payload),
  createBuildGitRemoteRepository: (payload: { agentId: string; relativePath?: string } & BuildGitRemoteRepositoryCreateInput): Promise<BuildGitRemoteRepositoryCreateResult> =>
    ipcRenderer.invoke('build-mode:git:remote:create', payload),
  createBuildGitPullRequest: (payload: { agentId: string; relativePath?: string } & BuildGitPullRequestCreateInput): Promise<BuildGitPullRequestCreateResult> =>
    ipcRenderer.invoke('build-mode:git:pr:create-draft', payload),
  listBuildGitBackupBranches: (payload: { agentId: string; relativePath?: string }): Promise<{ branches: BuildGitBackupBranch[]; summary: BuildGitSummary }> =>
    ipcRenderer.invoke('build-mode:git:backup-branches:list', payload),
  restoreBuildGitBackupBranch: (payload: { agentId: string; relativePath?: string; branchName: string }): Promise<BuildGitActionResult> =>
    ipcRenderer.invoke('build-mode:git:restore-backup', payload),
  listBuildGitReflog: (payload: { agentId: string; relativePath?: string }): Promise<{ entries: BuildGitReflogEntry[]; summary: BuildGitSummary }> =>
    ipcRenderer.invoke('build-mode:git:reflog:list', payload),
  captureBuildWorkspaceBaseline: (payload: { agentId: string; relativePath?: string }): Promise<BuildWorkspaceBaselineCaptureResult> =>
    ipcRenderer.invoke('build-mode:workspace:baseline:capture', payload),
  resolveBuildWorkspaceBaseline: (payload: { agentId: string; baselineId: string; decision: 'approve' | 'reject' }): Promise<BuildWorkspaceBaselineResolveResult> =>
    ipcRenderer.invoke('build-mode:workspace:baseline:resolve', payload),
  exportBuildWorkspaceZip: (payload: { agentId: string; relativePath?: string; suggestedName?: string }): Promise<{ ok: boolean; filePath?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('build-mode:workspace:export-zip', payload),
  listBuildPresets: (payload: { agentId: string }): Promise<BuildProjectPresetListResult> =>
    ipcRenderer.invoke('build-mode:presets:list', payload),
  upsertBuildPreset: (payload: BuildProjectPresetInput): Promise<BuildProjectPreset> =>
    ipcRenderer.invoke('build-mode:presets:upsert', payload),
  deleteBuildPreset: (payload: { agentId: string; presetId: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:presets:delete', payload),
  setActiveBuildPreset: (payload: { agentId: string; presetId?: string | null }): Promise<{ activePresetId?: string }> =>
    ipcRenderer.invoke('build-mode:presets:set-active', payload),
  listBuildTaskHistorySessions: (payload: BuildTaskHistoryListInput): Promise<BuildTaskSessionListResult> =>
    ipcRenderer.invoke('build-mode:history:list', payload),
  getBuildTaskHistorySession: (payload: { sessionId: string }): Promise<BuildTaskSession | null> =>
    ipcRenderer.invoke('build-mode:history:get', payload),
  createBuildTaskHistorySession: (payload: BuildTaskSessionCreateInput): Promise<BuildTaskSession> =>
    ipcRenderer.invoke('build-mode:history:create', payload),
  updateBuildTaskHistorySession: (payload: BuildTaskSessionUpdateInput): Promise<BuildTaskSession> =>
    ipcRenderer.invoke('build-mode:history:update', payload),
  renameBuildTaskHistorySession: (payload: BuildTaskSessionRenameInput): Promise<BuildTaskSession> =>
    ipcRenderer.invoke('build-mode:history:rename', payload),
  archiveBuildTaskHistorySession: (payload: BuildTaskSessionArchiveInput): Promise<BuildTaskSession> =>
    ipcRenderer.invoke('build-mode:history:archive', payload),
  setBuildTaskHistorySessionPinned: (payload: BuildTaskSessionPinInput): Promise<BuildTaskSession> =>
    ipcRenderer.invoke('build-mode:history:pin', payload),
  deleteBuildTaskHistorySession: (payload: BuildTaskSessionDeleteInput): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('build-mode:history:delete', payload),
  listSubagents: (payload: { parentTaskId: string }): Promise<{ runs: SubagentRunDetail[]; tree: SubagentRunTreeNode[]; activeCount: number }> =>
    ipcRenderer.invoke('subagents:list', payload),
  listAllSubagents: (payload?: { includeArchived?: boolean }): Promise<{ runs: SubagentRunDetail[] }> =>
    ipcRenderer.invoke('subagents:list-all', payload ?? {}),
  getSubagent: (payload: { runId: string }): Promise<SubagentRunDetail | null> =>
    ipcRenderer.invoke('subagents:get', payload),
  waitSubagent: (payload: { runId: string; timeoutMs?: number; pollIntervalMs?: number }): Promise<{ completed: boolean; waitedMs: number; run: SubagentRunDetail | null }> =>
    ipcRenderer.invoke('subagents:wait', payload),
  sendSubagent: (payload: { runId: string; prompt: string; modelProvider?: string; modelId?: string; modelBaseUrl?: string }): Promise<{ ok: boolean; runId: string; childTaskId: string }> =>
    ipcRenderer.invoke('subagents:send', payload),
  archiveSubagent: (payload: { runId: string; archived?: boolean }): Promise<SubagentRunDetail> =>
    ipcRenderer.invoke('subagents:archive', payload),
  closeSubagent: (payload: { runId: string }): Promise<SubagentRunDetail> =>
    ipcRenderer.invoke('subagents:close', payload),
  stopSubagent: (payload: { runId: string }): Promise<{ ok: boolean; runId: string }> =>
    ipcRenderer.invoke('subagents:stop', payload),

  // API Key management (new simplified handlers)
  hasApiKey: (): Promise<boolean> =>
    ipcRenderer.invoke('api-key:exists'),
  setApiKey: (key: string): Promise<void> =>
    ipcRenderer.invoke('api-key:set', key),
  getApiKey: (): Promise<string | null> =>
    ipcRenderer.invoke('api-key:get'),
  validateApiKey: (key: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke('api-key:validate', key),
  validateApiKeyForProvider: (provider: string, key: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke('api-key:validate-provider', provider, key),
  clearApiKey: (): Promise<void> =>
    ipcRenderer.invoke('api-key:clear'),

  // Onboarding
  getOnboardingComplete: (): Promise<boolean> =>
    ipcRenderer.invoke('onboarding:complete'),
  setOnboardingComplete: (complete: boolean): Promise<void> =>
    ipcRenderer.invoke('onboarding:set-complete', complete),

  // OpenCode CLI status
  checkOpenCodeCli: (): Promise<{
    installed: boolean;
    version: string | null;
    installCommand: string;
  }> => ipcRenderer.invoke('opencode:check'),
  getOpenCodeVersion: (): Promise<string | null> =>
    ipcRenderer.invoke('opencode:version'),

  // Model selection
  getSelectedModel: (): Promise<{ provider: string; model: string; baseUrl?: string } | null> =>
    ipcRenderer.invoke('model:get'),
  setSelectedModel: (model: { provider: string; model: string; baseUrl?: string }): Promise<void> =>
    ipcRenderer.invoke('model:set', model),
  getUserSkillAssistantModel: (): Promise<{ provider: string; model: string; baseUrl?: string } | null> =>
    ipcRenderer.invoke('user-skills:assistant:model:get'),
  setUserSkillAssistantModel: (model: { provider: string; model: string; baseUrl?: string } | null): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:assistant:model:set', model),
  listModelProviders: (): Promise<ProviderConfig[]> =>
    ipcRenderer.invoke('model-providers:list'),
  listCustomModelProviders: (): Promise<ProviderConfig[]> =>
    ipcRenderer.invoke('model-providers:custom:list'),
  listBuiltinProviderModelOverrides: (): Promise<Record<string, ModelConfig[]>> =>
    ipcRenderer.invoke('model-providers:builtin-models:list'),
  upsertBuiltinProviderModel: (payload: { providerId: string; model: ModelConfig }): Promise<ModelConfig> =>
    ipcRenderer.invoke('model-providers:builtin-models:upsert', payload),
  deleteBuiltinProviderModel: (payload: { providerId: string; modelId: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('model-providers:builtin-models:delete', payload),
  upsertCustomModelProvider: (provider: ProviderConfig): Promise<ProviderConfig> =>
    ipcRenderer.invoke('model-providers:upsert', provider),
  deleteCustomModelProvider: (providerId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('model-providers:delete', providerId),
  getModelLimitOverrides: (): Promise<unknown> =>
    ipcRenderer.invoke('model:limits:get'),
  setModelContextLimitOverride: (payload: { fullId: string; contextWindowTokens: number | null }): Promise<unknown> =>
    ipcRenderer.invoke('model:limits:set', payload),

  // Multi-provider API keys
  getAllApiKeys: (): Promise<Record<string, { exists: boolean; prefix?: string }>> =>
    ipcRenderer.invoke('api-keys:all'),
  hasAnyApiKey: (): Promise<boolean> =>
    ipcRenderer.invoke('api-keys:has-any'),

  // Skills
  getSkillsStatus: (): Promise<unknown[]> =>
    ipcRenderer.invoke('skills:list'),
  installSkill: (skillId: string): Promise<unknown> =>
    ipcRenderer.invoke('skills:install', skillId),
  uninstallSkill: (skillId: string): Promise<unknown> =>
    ipcRenderer.invoke('skills:uninstall', skillId),
  installAllSkills: (): Promise<unknown> =>
    ipcRenderer.invoke('skills:install-all'),

  // User Skills (markdown skills, OpenDeskmate-style)
  listUserSkills: (agentId?: string): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:list', agentId),
  createUserSkill: (payload: { skillId?: string; name?: string; description?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:create', payload),
  readUserSkillFile: (payload: { skillId: string; relPath: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:read-file', payload),
  writeUserSkillFile: (payload: { skillId: string; relPath: string; content: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:write-file', payload),
  deleteUserSkill: (payload: { skillId: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:delete', payload),
  setUserSkillLifecycle: (payload: { skillId: string; state: 'active' | 'deprecated' | 'disabled'; reason?: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:lifecycle:set', payload),
  setUserSkillSharing: (payload: { skillId: string; scope: 'private' | 'selected' | 'all'; sharedWithAgentIds?: string[]; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:sharing:set', payload),
  runUserSkillTests: (payload: { skillId: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:tests:run', payload),
  rollbackUserSkill: (payload: { skillId: string; targetVersion?: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:rollback', payload),
  recordUserSkillPerformance: (payload: { skillId: string; success: boolean; latencyMs?: number; inputTokens?: number; outputTokens?: number; error?: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:performance:record', payload),
  getUserSkillsDependencyStatus: (agentId?: string): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:deps-status', agentId),
  installUserSkillDependency: (payload: { skillId: string; installId: string; source?: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:install-dep', payload),
  getUserSkillConfig: (payload: { skillKey: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:config:get', payload),
  setUserSkillConfig: (payload: { skillKey: string; config: unknown }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:config:set', payload),
  inspectUserSkillZip: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:zip:inspect', payload),
  installUserSkillFromZip: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:zip:install', payload),
  cleanupUserSkillZipSession: (payload: { sessionId: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:zip:cleanup', payload),
  generateUserSkillFromTask: (payload: { taskId: string; agentId?: string }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:generate-from-task', payload),
  askUserSkillAssistant: (payload: {
    question: string;
    skillId?: string;
    source?: string;
    skillKey?: string;
    mode?: 'general' | 'configure' | 'edit';
    agentId?: string;
    draftContent?: string;
  }): Promise<unknown> =>
    ipcRenderer.invoke('user-skills:assistant:ask', payload),
  generateChecklistListPrompt: (payload: ChecklistListPromptGenerateRequest): Promise<ChecklistListPromptGenerateResponse> =>
    ipcRenderer.invoke('settings-assistant:list-prompt:generate', payload),
  generateWorkItemNotePrompt: (payload: WorkItemNotePromptGenerateRequest): Promise<WorkItemNotePromptGenerateResponse> =>
    ipcRenderer.invoke('settings-assistant:note-prompt:generate', payload),

  // Automations
  listSchedules: (): Promise<unknown[]> =>
    ipcRenderer.invoke('schedules:list'),
  upsertSchedule: (config: unknown, scheduleId?: string): Promise<unknown> =>
    ipcRenderer.invoke('schedules:upsert', config, scheduleId),
  deleteSchedule: (scheduleId: string): Promise<void> =>
    ipcRenderer.invoke('schedules:delete', scheduleId),
  toggleSchedule: (scheduleId: string, enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke('schedules:toggle', scheduleId, enabled),
  runScheduleNow: (scheduleId: string): Promise<void> =>
    ipcRenderer.invoke('schedules:run', scheduleId),
  getAutomationInfo: (): Promise<{ webhookUrl: string }> =>
    ipcRenderer.invoke('automation:info'),
  draftAutomationFromText: (request: AutomationDraftRequest): Promise<AutomationDraftResult> =>
    ipcRenderer.invoke('automation:draft-from-text', request),

  // Ollama configuration
  testOllamaConnection: (url: string): Promise<{
    success: boolean;
    models?: Array<{ id: string; displayName: string; size: number }>;
    error?: string;
  }> => ipcRenderer.invoke('ollama:test-connection', url),

  getOllamaConfig: (): Promise<{ baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; displayName: string; size: number }>; toolMode?: 'off' | 'internet' | 'workspace-read' | 'workspace-edit' | 'desktop' | 'full' } | null> =>
    ipcRenderer.invoke('ollama:get-config'),

  setOllamaConfig: (config: { baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; displayName: string; size: number }>; toolMode?: 'off' | 'internet' | 'workspace-read' | 'workspace-edit' | 'desktop' | 'full' } | null): Promise<void> =>
    ipcRenderer.invoke('ollama:set-config', config),

  // Event subscriptions
  onTaskUpdate: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on('task:update', listener);
    return () => ipcRenderer.removeListener('task:update', listener);
  },
  onTaskActivity: (callback: (event: unknown) => void) => {
    const listener = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on('task:activity', listener);
    return () => ipcRenderer.removeListener('task:activity', listener);
  },
  onTaskCreated: (callback: (task: unknown) => void) => {
    const listener = (_: unknown, task: unknown) => callback(task);
    ipcRenderer.on('task:created', listener);
    return () => ipcRenderer.removeListener('task:created', listener);
  },
  // Batched task updates for performance - multiple messages in single IPC call
  onTaskUpdateBatch: (callback: (event: { taskId: string; messages: unknown[] }) => void) => {
    const listener = (_: unknown, event: { taskId: string; messages: unknown[] }) => callback(event);
    ipcRenderer.on('task:update:batch', listener);
    return () => ipcRenderer.removeListener('task:update:batch', listener);
  },
  onPermissionRequest: (callback: (request: unknown) => void) => {
    const listener = (_: unknown, request: unknown) => callback(request);
    ipcRenderer.on('permission:request', listener);
    return () => ipcRenderer.removeListener('permission:request', listener);
  },
  onTaskProgress: (callback: (progress: unknown) => void) => {
    const listener = (_: unknown, progress: unknown) => callback(progress);
    ipcRenderer.on('task:progress', listener);
    return () => ipcRenderer.removeListener('task:progress', listener);
  },
  onDebugLog: (callback: (log: unknown) => void) => {
    const listener = (_: unknown, log: unknown) => callback(log);
    ipcRenderer.on('debug:log', listener);
    return () => ipcRenderer.removeListener('debug:log', listener);
  },
  // Debug mode setting changes
  onDebugModeChange: (callback: (data: { enabled: boolean }) => void) => {
    const listener = (_: unknown, data: { enabled: boolean }) => callback(data);
    ipcRenderer.on('settings:debug-mode-changed', listener);
    return () => ipcRenderer.removeListener('settings:debug-mode-changed', listener);
  },
  // Task status changes (e.g., queued -> running)
  onTaskStatusChange: (callback: (data: { taskId: string; status: string }) => void) => {
    const listener = (_: unknown, data: { taskId: string; status: string }) => callback(data);
    ipcRenderer.on('task:status-change', listener);
    return () => ipcRenderer.removeListener('task:status-change', listener);
  },
  // Task summary updates (AI-generated summary)
  onTaskSummary: (callback: (data: { taskId: string; summary: string }) => void) => {
    const listener = (_: unknown, data: { taskId: string; summary: string }) => callback(data);
    ipcRenderer.on('task:summary', listener);
    return () => ipcRenderer.removeListener('task:summary', listener);
  },
  onHelpDocsUpdated: (callback: (event: HelpDocsUpdatedEvent) => void) => {
    const listener = (_: unknown, event: HelpDocsUpdatedEvent) => callback(event);
    ipcRenderer.on('help-docs:updated', listener);
    return () => ipcRenderer.removeListener('help-docs:updated', listener);
  },
  onHelpNavigate: (callback: (payload: { docId?: string; query?: string }) => void) => {
    const listener = (_: unknown, payload: { docId?: string; query?: string }) => callback(payload);
    ipcRenderer.on('help:navigate', listener);
    return () => ipcRenderer.removeListener('help:navigate', listener);
  },

  logEvent: (payload: { level?: string; message: string; context?: Record<string, unknown> }) =>
    ipcRenderer.invoke('log:event', payload),

  // Folder operations (synced with webchat)
  listFolders: (): Promise<unknown[]> =>
    ipcRenderer.invoke('folder:list'),
  createFolder: (config: { name: string; icon?: string; color?: string; usageProjectId?: string | null; assigneeIds?: string[] | null }): Promise<unknown> =>
    ipcRenderer.invoke('folder:create', config),
  updateFolder: (folderId: string, config: { name?: string; icon?: string; color?: string; usageProjectId?: string | null; assigneeIds?: string[] | null; isExpanded?: boolean; order?: number }): Promise<unknown> =>
    ipcRenderer.invoke('folder:update', folderId, config),
  deleteFolder: (folderId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('folder:delete', folderId),
  getTaskFolderAssignments: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('folder:getAssignments'),
  assignTaskToFolder: (taskId: string, folderId: string | null): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('folder:assignTask', taskId, folderId),
  assignTaskToUsageProject: (taskId: string, usageProjectId: string | null): Promise<{ success: boolean; usageProjectId?: string | null }> =>
    ipcRenderer.invoke('task:assignUsageProject', taskId, usageProjectId),
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('accomplish', accomplishAPI);

// Also expose shell info for compatibility checks
contextBridge.exposeInMainWorld('accomplishShell', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
  isElectron: true,
});

// Type declarations
export type AccomplishAPI = typeof accomplishAPI;
