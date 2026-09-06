/**
 * Accomplish API - Interface to the Electron main process
 *
 * This module provides type-safe access to the accomplish API
 * exposed by the preload script via contextBridge.
 */

import type {
  Task,
  TaskConfig,
  TaskUpdateEvent,
  TaskStatus,
  PermissionRequest,
  PermissionResponse,
  TaskProgress,
  TaskActivityEvent,
  ApiKeyConfig,
  TaskMessage,
  AutomationDraftRequest,
  AutomationDraftResult,
  ChatToolCompatibilityCheckRequest,
  ChatToolCompatibilityCheckResult,
  ContextWindowEstimateResponse,
  UsagePricingAutofillResult,
  UsagePricingAutofillRequest,
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
  ChatPostcardDraftGenerateRequest,
  ChatPostcardDraftGenerateResponse,
  WorkItemNotePromptGenerateRequest,
  WorkItemNotePromptGenerateResponse,
  UsagePeriod,
  UsagePricingSettings,
  UsageSummary,
  ModelConfig,
  ProviderConfig,
  AgentConfig,
  AgentProfile,
  OpenCodePermissionPreview,
  PermissionPolicyAuditEntry,
  PermissionPolicySettings,
  PluginCommandContribution,
  PluginDiagnosticsState,
  PluginDiagnosticsRecord,
  PluginRecord,
  PluginRegistryState,
  ResolvedToolsetDefinition,
  ToolCapability,
  ToolCapabilityListResult,
  ToolDiscoveryEnableRequest,
  ToolDiscoveryEnableResult,
  ToolDiscoveryEnabledListResult,
  ToolDiscoverySearchResult,
  ToolsetId,
  ToolsetListResult,
  AppConnectorExtensionConfig,
  AppConnectorExtensionConfigInput,
  AppConnectorExtensionState,
  AppConnectorRuntimeStatus,
  AppConnectorRuntimeTestResult,
  BuildBuildRequest,
  BuildDiffEnforcementMode,
  BuildFileTreeNode,
  BuildGitActionResult,
  BuildGitBackupBranch,
  BuildGitConflictFile,
  BuildGitMismatchSummary,
  BuildGitPullRequestCreateInput,
  BuildGitPullRequestCreateResult,
  BuildGitRemoteInput,
  BuildGitRemoteRepositoryCreateInput,
  BuildGitRemoteRepositoryCreateResult,
  BuildGitResolveMismatchInput,
  BuildGitStageInput,
  BuildGitStashEntry,
  BuildGitSummary,
  BuildGitReflogEntry,
  BuildLogsResponse,
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
  BuildTerminalEntry,
  BuildTerminalOutputResponse,
  BuildTerminalSnapshot,
  BuildRuntimeCommandResult,
  BuildSessionSnapshot,
  BuildStartRequest,
  BuildWorkspaceBaselineCaptureResult,
  BuildWorkspaceBaselineResolveResult,
  BuildWorkspaceFingerprint,
  BuildWorkspaceDiff,
  BuildWorkspaceDiffFileContent,
  BuildWorkspaceFileContent,
  SubagentRunDetail,
  SubagentRunRecord,
  SubagentRunTreeNode,
  DiscordConnectorConfig,
  DiscordConnectorStatus,
  DiscordPairingRequest,
  TelegramConnectorConfig,
  TelegramConnectorStatus,
  TelegramPairingRequest,
  VoiceWakeConfig,
  NodePairingList,
  NodePairingPairedNode,
  GatewayConfig,
  GatewayConnectorRuntimeDiscoveryItem,
  GatewayConnectorDiscoverySnapshot,
  GatewayConnectorExtensionConfig,
  GatewayConnectorExtensionConfigInput,
  GatewayConnectorExtensionState,
  GatewayConnectorRuntimeStatus,
  GatewayConnectorRuntimeTestResult,
  GatewayRouteBinding,
  GatewayRunRecord,
  GatewayRuntimeStatus,
  GatewaySessionRecord,
  UserSkillCreateRequest,
  UserSkillDependencyStatusReport,
  UserSkillConfigGetRequest,
  UserSkillConfigGetResponse,
  UserSkillConfigSetRequest,
  UserSkillAssistantAskRequest,
  UserSkillAssistantAskResponse,
  UserSkillLifecycleUpdateRequest,
  UserSkillSharingUpdateRequest,
  UserSkillManifestResult,
  UserSkillPerformanceRecordRequest,
  UserSkillRollbackRequest,
  UserSkillInstallRequest,
  UserSkillInstallResult,
  UserSkillGenerateFromTaskRequest,
  UserSkillGenerateFromTaskResponse,
  UserSkillCuratorHistoryResponse,
  UserSkillCuratorRunRecord,
  UserSkillPostTaskAutomationRequest,
  UserSkillPostTaskAutomationResult,
  UserSkillReadFileRequest,
  UserSkillReadFileResponse,
  UserSkillStatusReport,
  UserSkillZipCleanupRequest,
  UserSkillZipInspectRequest,
  UserSkillZipInspectResponse,
  UserSkillZipInstallRequest,
  UserSkillZipInstallResult,
  UserSkillTestRequest,
  UserSkillWriteFileRequest,
  UserSkillDeleteRequest,
  UserSkillDeleteResponse,
  RuntimeHooksDiagnosticsState,
  RuntimeHooksSettingsState,
  HelpDocPageResponse,
  HelpDocsListResponse,
  HelpDocsSearchResponse,
  HelpDocsUpdatedEvent,
  ExecutionProfile,
  ExecutionProfileCreateInput,
  ExecutionProfileListResult,
  ExecutionProfileUpdateInput,
  AgentAlwaysOnStatus,
  AlwaysOnStatusSnapshot,
  ConnectorDeliveryListResponse,
  MemoryEntrySummary,
  MemoryChangeHistoryFilter,
  MemoryChangeRecord,
  MemorySearchResponse,
  AuditEventRecord,
  AuditExportRequest,
  AuditExportResult,
  AuditGetRequest,
  AuditListRequest,
  AuditListResult,
  SearchIndexRebuildRequest,
  SearchIndexRebuildResult,
  SearchItemDetail,
  SearchItemGetRequest,
  SearchQueryRequest,
  SearchQueryResult,
} from '@accomplish/shared';

export type TaskWindowKind = 'chat-task' | 'build-task' | 'subagent-run' | 'workboard-item';

export type TaskWindowOpenRequest =
  | { kind: 'chat-task'; taskId: string; agentId?: string; title?: string }
  | { kind: 'build-task'; sessionId: string; agentId?: string; taskId?: string; title?: string }
  | { kind: 'subagent-run'; runId: string; title?: string }
  | { kind: 'workboard-item'; projectId: string; itemId: string; title?: string };

export type TaskWindowFocusRequest = ({ key: string } | { windowId: number } | TaskWindowOpenRequest);

export type TaskWindowInfo = {
  key: string;
  windowId: number;
  kind: TaskWindowKind;
  title: string;
  route: string;
  target: TaskWindowOpenRequest;
  focused: boolean;
};

// Define the API interface
interface AccomplishAPI {
  // App info
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;

  // Shell
  openExternal(url: string): Promise<void>;
  openPath(filePath: string): Promise<{ ok: boolean; path: string; error?: string }>;

  // Task windows
  openTaskWindow(target: TaskWindowOpenRequest): Promise<TaskWindowInfo>;
  listTaskWindows(): Promise<TaskWindowInfo[]>;
  focusTaskWindow(target: TaskWindowFocusRequest): Promise<TaskWindowInfo | null>;

  // Help docs
  listHelpDocs(): Promise<HelpDocsListResponse>;
  readHelpDoc(docId: string): Promise<HelpDocPageResponse>;
  searchHelpDocs(query: string): Promise<HelpDocsSearchResponse>;
  getHelpAssetDataUrl(docId: string, assetPath: string): Promise<{ dataUrl: string }>;
  openHelpDocInEditor(docId: string): Promise<{ ok: boolean; path: string }>;
  openHelpDocsFolder(): Promise<{ ok: boolean; path: string }>;
  openHelpAsset(docId: string, assetPath: string): Promise<{ ok: boolean; path: string }>;

  // Local search and audit history
  rebuildSearchIndex(payload?: SearchIndexRebuildRequest): Promise<SearchIndexRebuildResult>;
  querySearch(payload: SearchQueryRequest): Promise<SearchQueryResult>;
  getSearchItem(payload: SearchItemGetRequest): Promise<SearchItemDetail | null>;
  listAuditEvents(payload?: AuditListRequest): Promise<AuditListResult>;
  getAuditEvent(payload: AuditGetRequest): Promise<AuditEventRecord | null>;
  exportAuditEvents(payload?: AuditExportRequest): Promise<AuditExportResult>;

  // Dialog
  selectFolder(defaultPath?: string): Promise<string | null>;
  selectFiles(): Promise<string[]>;

  // Task operations
  startTask(config: TaskConfig): Promise<Task>;
  cancelTask(taskId: string): Promise<void>;
  interruptTask(taskId: string): Promise<void>;
  getTask(taskId: string, agentId?: string): Promise<Task | null>;
  listTasks(agentId?: string): Promise<Task[]>;
  deleteTask(taskId: string): Promise<void>;
  clearTaskHistory(agentId?: string): Promise<void>;
  listSavedPrompts(): Promise<Array<{ id: string; title: string; content: string; category: string; description?: string; icon?: string; color?: string; createdAt: string; updatedAt: string }>>;
  listSavedPromptCategories(): Promise<string[]>;
  createSavedPromptCategory(name: string): Promise<string[]>;
  renameSavedPromptCategory(payload: { from: string; to: string }): Promise<{
    categories: string[];
    prompts: Array<{ id: string; title: string; content: string; category: string; description?: string; icon?: string; color?: string; createdAt: string; updatedAt: string }>;
  }>;
  deleteSavedPromptCategory(payload: { name: string; replacement?: string }): Promise<{
    categories: string[];
    prompts: Array<{ id: string; title: string; content: string; category: string; description?: string; icon?: string; color?: string; createdAt: string; updatedAt: string }>;
  }>;
  upsertSavedPrompt(payload: { id?: string; title: string; content: string; category?: string; description?: string; icon?: string; color?: string; createdAt?: string; updatedAt?: string }): Promise<{
    id: string;
    title: string;
    content: string;
    category: string;
    description?: string;
    icon?: string;
    color?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  deleteSavedPrompt(id: string): Promise<{ ok: boolean }>;

  // Permission responses
  getPendingPermissionRequests(payload?: { taskId?: string }): Promise<PermissionRequest[]>;
  respondToPermission(response: PermissionResponse): Promise<void>;

  // Session management
  resumeSession(
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
  ): Promise<Task>;

  // Proactive assistant (runs only when user clicks the button)
  planNextJobs(agentId?: string): Promise<{
    suggestions: Array<{
      id: string;
      title: string;
      why: string;
      prompt: string;
      confirmation: string;
    }>;
  }>;

  // Context window estimation (for live indicator)
  estimateContextWindow(payload: {
    prompt: string;
    taskId?: string;
    agentId?: string;
    systemPromptAppend?: string;
    attachedFiles?: string[];
    maxOutputTokensOverride?: number;
    headroomSafetyTokens?: number;
  }): Promise<ContextWindowEstimateResponse>;
  runChatToolCompatibilityCheck(payload: ChatToolCompatibilityCheckRequest): Promise<ChatToolCompatibilityCheckResult>;

  // Usage estimate (global)
  getUsageSummary(period: UsagePeriod): Promise<UsageSummary>;
  getUsagePricing(): Promise<UsagePricingSettings>;
  listUsageModelsUsed(): Promise<Record<string, string[]>>;
  setUsagePricing(settings: UsagePricingSettings): Promise<UsagePricingSettings>;
  autoFillUsagePricingWithAI(request: UsagePricingAutofillRequest): Promise<UsagePricingAutofillResult>;
  getUsageBudgets(): Promise<UsageBudgetSettings>;
  setUsageBudgets(settings: UsageBudgetSettings): Promise<UsageBudgetSettings>;
  getUsageBudgetStatus(payload?: { agentId?: string }): Promise<UsageBudgetStatus[]>;
  listUsageProjects(payload?: { includeArchived?: boolean }): Promise<UsageProject[]>;
  createUsageProject(input: UsageProjectInput): Promise<UsageProject>;
  updateUsageProject(projectId: string, update: UsageProjectUpdate): Promise<UsageProject>;
  archiveUsageProject(projectId: string, archived?: boolean): Promise<UsageProject>;
  listUsageProjectBudgetWindows(payload?: { projectId?: string }): Promise<UsageProjectBudgetWindow[]>;
  createUsageProjectBudgetWindow(input: UsageProjectBudgetWindowInput): Promise<UsageProjectBudgetWindow>;
  updateUsageProjectBudgetWindow(windowId: string, update: UsageProjectBudgetWindowUpdate): Promise<UsageProjectBudgetWindow>;
  deleteUsageProjectBudgetWindow(windowId: string): Promise<{ ok: true }>;
  getUsageProjectSummary(payload: { projectId: string; startsAt?: string; endsAt?: string | null; windowId?: string }): Promise<UsageProjectSummary>;
  getUsageProjectAnalytics(payload: { projectId: string; startsAt?: string; endsAt?: string | null; windowId?: string; days?: number }): Promise<UsageProjectAnalytics>;
  getUsageProjectBudgetStatus(payload?: { projectId?: string }): Promise<UsageProjectBudgetStatus[]>;
  listUsageProjectWorkItems(payload: { projectId: string; includeArchived?: boolean }): Promise<UsageProjectWorkItem[]>;
  createUsageProjectWorkItem(input: UsageProjectWorkItemInput): Promise<UsageProjectWorkItem>;
  updateUsageProjectWorkItem(itemId: string, update: UsageProjectWorkItemUpdate): Promise<UsageProjectWorkItem>;
  archiveUsageProjectWorkItem(itemId: string, archived?: boolean): Promise<UsageProjectWorkItem>;
  listUsageProjectKanbanColumns(payload: { projectId: string }): Promise<UsageProjectKanbanColumn[]>;
  createUsageProjectKanbanColumn(input: UsageProjectKanbanColumnInput): Promise<UsageProjectKanbanColumn>;
  updateUsageProjectKanbanColumn(columnId: string, update: UsageProjectKanbanColumnUpdate): Promise<UsageProjectKanbanColumn>;
  deleteUsageProjectKanbanColumn(columnId: string): Promise<{ ok: true }>;
  listUsageAssignees(payload?: { includeArchived?: boolean }): Promise<UsageAssignee[]>;
  createUsageAssignee(input: UsageAssigneeInput): Promise<UsageAssignee>;
  updateUsageAssignee(assigneeId: string, update: UsageAssigneeUpdate): Promise<UsageAssignee>;
  archiveUsageAssignee(assigneeId: string, archived?: boolean): Promise<UsageAssignee>;
  getUsageAssigneeOverview(payload?: { assigneeId?: string }): Promise<UsageAssigneeOverview[]>;

  // Settings
  getApiKeys(): Promise<ApiKeyConfig[]>;
  addApiKey(provider: string, key: string, label?: string): Promise<ApiKeyConfig>;
  removeApiKey(id: string): Promise<void>;
  getDebugMode(): Promise<boolean>;
  setDebugMode(enabled: boolean): Promise<void>;
  getAppSettings(): Promise<{ debugMode: boolean; onboardingComplete: boolean; runInBackground: boolean; launchAtLogin: boolean; browserProfile: string; workspaceRoot: string | null; activeAgentId: string; mobileNodesEnabled: boolean; mobileNodesMaxLivePreviews: number; mobileNodesDisplayName: string; webhookBindMode: 'localhost' | 'all'; agentSpeedMode: 'fast' | 'balanced' | 'deep'; buildDiffEnforcementMode: BuildDiffEnforcementMode }>;
  setRunInBackground(enabled: boolean): Promise<void>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  setMobileNodesEnabled(enabled: boolean): Promise<boolean>;
  setMobileNodesMaxLivePreviews(count: number): Promise<number>;
  setMobileNodesDisplayName(name: string): Promise<string>;
  setWebhookBindMode(mode: 'localhost' | 'all'): Promise<'localhost' | 'all'>;
  setAgentSpeedMode(mode: 'fast' | 'balanced' | 'deep'): Promise<'fast' | 'balanced' | 'deep'>;
  setBuildDiffEnforcementMode(mode: BuildDiffEnforcementMode): Promise<BuildDiffEnforcementMode>;
  listExecutionProfiles(payload?: { includeArchived?: boolean }): Promise<ExecutionProfileListResult>;
  createExecutionProfile(payload: ExecutionProfileCreateInput): Promise<ExecutionProfile>;
  updateExecutionProfile(profileId: string, update: ExecutionProfileUpdateInput): Promise<ExecutionProfile>;
  archiveExecutionProfile(profileId: string, archived?: boolean): Promise<ExecutionProfile>;
  checkExecutionProfileHealth(profileId: string): Promise<ExecutionProfile>;
  saveDataUrlToFile(dataUrl: string, baseName?: string): Promise<{ filePath: string }>;
  saveDataUrlToFileAs(dataUrl: string, baseName?: string): Promise<{ filePath?: string; cancelled?: boolean }>;
  saveTextToFileAs(content: string, options?: { baseName?: string; extension?: string; title?: string }): Promise<{ filePath?: string; cancelled?: boolean }>;
  captureWindowRect(rect: { x: number; y: number; width: number; height: number }): Promise<{ dataUrl: string }>;
  captureRuntimePreviewFullPage(url: string): Promise<{ dataUrl: string; width: number; height: number; fullWidth: number; fullHeight: number; clipped: boolean }>;
  setBrowserProfile(profile: string): Promise<string>;
  setWorkspaceRoot(root: string | null): Promise<string | null>;
  getMemoryState(payload?: { agentId?: string; date?: string }): Promise<{
    workspaceRoot: string;
    user: { path: string; content: string };
    longTerm: { path: string; content: string };
    daily: { date: string; path: string; content: string };
    dailyFiles: string[];
    snapshots: MemoryEntrySummary[];
    entries: MemoryEntrySummary[];
  }>;
  readMemoryFile(payload: { kind: 'user' | 'long-term' | 'daily' | 'snapshot'; date?: string; fileName?: string; agentId?: string }): Promise<{
    path: string;
    date?: string;
    fileName?: string;
    content: string;
  }>;
  saveMemoryFile(payload: { kind: 'user' | 'long-term' | 'daily' | 'snapshot'; date?: string; fileName?: string; agentId?: string; content?: string }): Promise<{
    path: string;
    date?: string;
    fileName?: string;
    changeId?: string;
  }>;
  deleteMemoryFile(payload: { kind: 'user' | 'long-term' | 'daily' | 'snapshot'; date?: string; fileName?: string; agentId?: string }): Promise<{
    path: string;
    date?: string;
    fileName?: string;
    changeId?: string;
  }>;
  searchMemory(payload: { query: string; agentId?: string; limit?: number }): Promise<MemorySearchResponse>;
  listMemoryChanges(payload?: MemoryChangeHistoryFilter): Promise<{ changes: MemoryChangeRecord[] }>;
  applyMemoryChange(changeId: string): Promise<MemoryChangeRecord>;
  rollbackMemoryChange(changeId: string): Promise<MemoryChangeRecord>;
  getRuntimeHooks(): Promise<RuntimeHooksSettingsState>;
  saveRuntimeHooks(raw: string): Promise<{ path: string; hookCount: number }>;
  getRuntimeHookDiagnostics(): Promise<RuntimeHooksDiagnosticsState>;
  clearRuntimeHookDiagnostics(): Promise<{ ok: boolean }>;
  getPermissionPolicySettings(): Promise<PermissionPolicySettings>;
  setPermissionPolicySettings(settings: PermissionPolicySettings): Promise<PermissionPolicySettings>;
  getPermissionPolicyAudit(): Promise<{ entries: PermissionPolicyAuditEntry[] }>;
  getOpenCodePermissionPreview(agentId?: string): Promise<OpenCodePermissionPreview>;
  clearPermissionPolicyAudit(): Promise<{ ok: boolean }>;
  listPlugins(): Promise<PluginRegistryState>;
  getPluginDiagnostics(): Promise<PluginDiagnosticsState>;
  clearPluginDiagnosticsHistory(): Promise<{ ok: true }>;
  listPluginCommands(): Promise<{ commands: PluginCommandContribution[] }>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginRecord>;
  installPluginFromDirectory(sourceDir: string): Promise<PluginRecord>;
  uninstallPlugin(pluginId: string): Promise<{ ok: true; pluginId: string }>;
  openManagedPluginsRoot(): Promise<{ ok: boolean; path: string; error?: string }>;

  // Agents
  listAgents(): Promise<{ agents: AgentProfile[]; defaultAgentId: string; activeAgentId: string }>;
  upsertAgent(config: AgentConfig): Promise<AgentProfile>;
  deleteAgent(agentId: string): Promise<void>;
  setDefaultAgent(agentId: string): Promise<string>;
  setActiveAgent(agentId: string): Promise<string>;
  getActiveAgent(): Promise<string>;
  getAlwaysOnStatus(): Promise<AlwaysOnStatusSnapshot>;
  startAlwaysOnManager(): Promise<AlwaysOnStatusSnapshot>;
  stopAlwaysOnManager(): Promise<AlwaysOnStatusSnapshot>;
  restartAlwaysOnManager(): Promise<AlwaysOnStatusSnapshot>;
  setAgentAlwaysOn(agentId: string, enabled: boolean): Promise<AgentAlwaysOnStatus>;
  restartAgentAlwaysOn(agentId: string): Promise<AlwaysOnStatusSnapshot['agents'][number]>;
  listConnectorDeliveries(payload?: { limit?: number }): Promise<ConnectorDeliveryListResponse>;

  // Discord connector
  getDiscordConfig(): Promise<{ config: DiscordConnectorConfig; status: DiscordConnectorStatus; tokenSet: boolean }>;
  setDiscordConfig(config: DiscordConnectorConfig): Promise<DiscordConnectorConfig>;
  setDiscordToken(token: string): Promise<{ tokenSet: boolean }>;
  clearDiscordToken(): Promise<{ tokenSet: boolean }>;
  listDiscordPairingRequests(): Promise<DiscordPairingRequest[]>;
  approveDiscordPairing(userId: string, code: string): Promise<{ approved: boolean }>;

  // Telegram connector
  getTelegramConfig(): Promise<{ config: TelegramConnectorConfig; status: TelegramConnectorStatus; tokenSet: boolean }>;
  setTelegramConfig(config: TelegramConnectorConfig): Promise<TelegramConnectorConfig>;
  setTelegramToken(token: string): Promise<{ tokenSet: boolean }>;
  clearTelegramToken(): Promise<{ tokenSet: boolean }>;
  listTelegramPairingRequests(): Promise<TelegramPairingRequest[]>;
  approveTelegramPairing(userId: string, code: string): Promise<{ approved: boolean }>;

  // Voice wake
  getVoiceWakeConfig(): Promise<VoiceWakeConfig>;
  setVoiceWakeConfig(config: VoiceWakeConfig): Promise<VoiceWakeConfig>;
  getVoiceWakeAccessKeyStatus(): Promise<{ accessKeySet: boolean }>;
  setVoiceWakeAccessKey(accessKey: string): Promise<{ accessKeySet: boolean }>;
  clearVoiceWakeAccessKey(): Promise<{ accessKeySet: boolean }>;
  onVoiceWakeLevel?(callback: (data: { level: number; at: string }) => void): () => void;
  onVoiceWakeDetected?(callback: (data: { keyword: string; at: string }) => void): () => void;
  transcribeWhisper(audioBase64: string): Promise<{ text: string }>;

  // Mobile nodes
  listNodePairing(): Promise<NodePairingList>;
  approveNodePairing(requestId: string): Promise<{ node: NodePairingPairedNode | null }>;
  rejectNodePairing(requestId: string): Promise<{ result: { requestId: string; nodeId: string } | null }>;
  removePairedNode(nodeId: string): Promise<{ result: { nodeId: string } | null }>;
  updatePairedNodeName(
    nodeId: string,
    displayName: string | null,
    badgeColor?: string | null,
    badgeIcon?: string | null
  ): Promise<{ node: NodePairingPairedNode | null }>;
  updatePairedNodeAiAccess(nodeId: string, allowed: boolean): Promise<{ node: NodePairingPairedNode | null }>;
  requestNodeCameraSnapshot(
    nodeId: string,
    target?: 'snapshot' | 'live'
  ): Promise<{ ok: boolean; payload?: unknown; error?: string | null }>;
  startNodeMicStream(nodeId: string, chunkMs?: number): Promise<{ streamId: string; result: { ok: boolean; payload?: unknown; error?: string | null } }>;
  stopNodeMicStream(nodeId: string, streamId?: string): Promise<{ ok: boolean; payload?: unknown; error?: string | null }>;
  startNodeScreenStream(nodeId: string, chunkMs?: number): Promise<{ streamId: string; result: { ok: boolean; payload?: unknown; error?: string | null } }>;
  stopNodeScreenStream(nodeId: string, streamId?: string): Promise<{ ok: boolean; payload?: unknown; error?: string | null }>;
  getLatestNodeStreamChunk(nodeId: string, kind: 'mic' | 'screen'): Promise<{ latest: { nodeId: string; streamId: string; kind: 'mic' | 'screen'; mime: string; dataBase64: string; receivedAtMs: number } | null }>;
  getNodeCameraStatus(nodeId: string): Promise<{ active: boolean; updatedAtMs: number | null }>;

  // Gateway (remote WebChat)
  getGatewayConfig(): Promise<{ config: GatewayConfig; status: GatewayRuntimeStatus }>;
  setGatewayConfig(config: GatewayConfig): Promise<GatewayConfig>;
  setGatewayToken(token: string): Promise<{ tokenSet: boolean }>;
  clearGatewayToken(): Promise<{ tokenSet: boolean }>;
  generateGatewayToken(): Promise<{ token: string; tokenSet: boolean }>;
  setGatewayPassword(password: string): Promise<{ passwordSet: boolean }>;
  clearGatewayPassword(): Promise<{ passwordSet: boolean }>;
  generateGatewayPassword(): Promise<{ password: string; passwordSet: boolean }>;
  listGatewayBindings(): Promise<GatewayRouteBinding[]>;
  setGatewayBindings(bindings: GatewayRouteBinding[]): Promise<GatewayRouteBinding[]>;
  upsertGatewayBinding(binding: GatewayRouteBinding): Promise<GatewayRouteBinding>;
  removeGatewayBinding(bindingId: string): Promise<{ ok: boolean }>;
  listGatewaySessions(agentId?: string): Promise<GatewaySessionRecord[]>;
  getGatewaySession(sessionKey: string): Promise<GatewaySessionRecord | null>;
  deleteGatewaySession(sessionKey: string): Promise<{ ok: boolean }>;
  listGatewayRuns(agentId?: string): Promise<GatewayRunRecord[]>;
  getGatewayRun(runId: string): Promise<GatewayRunRecord | null>;
  listGatewayConnectorExtensions(): Promise<GatewayConnectorExtensionState[]>;
  setGatewayConnectorExtensionConfig(config: GatewayConnectorExtensionConfigInput): Promise<{
    config: GatewayConnectorExtensionConfig;
    secretSet: boolean;
    bindingId: string;
    runtimeKey?: string;
  }>;
  createGatewayConnectorExtensionInstance(connectorId: string, name?: string): Promise<{ state: GatewayConnectorExtensionState }>;
  deleteGatewayConnectorExtensionInstance(connectorId: string, instanceId?: string): Promise<{ ok: boolean }>;
  setGatewayConnectorExtensionSecret(connectorId: string, secret: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  clearGatewayConnectorExtensionSecret(connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  generateGatewayConnectorExtensionSecret(connectorId: string, instanceId?: string): Promise<{ secret: string; secretSet: boolean }>;
  listGatewayConnectorDiscovery(): Promise<GatewayConnectorDiscoverySnapshot[]>;
  clearGatewayConnectorDiscovery(connectorId?: string, instanceId?: string): Promise<{ ok: boolean }>;
  listGatewayConnectorRuntimeStatuses(): Promise<GatewayConnectorRuntimeStatus[]>;
  restartGatewayConnectorRuntime(connectorId?: string, instanceId?: string): Promise<{ ok: boolean }>;
  testGatewayConnectorRuntime(connectorId: string, instanceId?: string): Promise<GatewayConnectorRuntimeTestResult>;
  discoverGatewayConnectorRuntimeTargets(connectorId: string, instanceId?: string): Promise<GatewayConnectorRuntimeDiscoveryItem[]>;

  // App connector extensions
  listAppConnectorExtensions(): Promise<AppConnectorExtensionState[]>;
  createAppConnectorExtensionInstance(connectorId: string, name?: string): Promise<{ state: AppConnectorExtensionState }>;
  deleteAppConnectorExtensionInstance(connectorId: string, instanceId?: string): Promise<{ ok: boolean }>;
  setAppConnectorExtensionConfig(config: AppConnectorExtensionConfigInput): Promise<{
    config: AppConnectorExtensionConfig;
    secretSet: boolean;
    runtimeKey: string;
  }>;
  setAppConnectorExtensionSecret(connectorId: string, secret: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  clearAppConnectorExtensionSecret(connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  generateAppConnectorExtensionSecret(connectorId: string, instanceId?: string): Promise<{ secret: string; secretSet: boolean }>;
  setAppConnectorOAuthClientSecret(connectorId: string, clientSecret: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  clearAppConnectorOAuthClientSecret(connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  getAppConnectorOAuthClientSecretStatus(connectorId: string, instanceId?: string): Promise<{ secretSet: boolean }>;
  listAppConnectorRuntimeStatuses(): Promise<AppConnectorRuntimeStatus[]>;
  testAppConnectorRuntime(connectorId: string, instanceId?: string): Promise<AppConnectorRuntimeTestResult>;
  executeAppConnector(payload: {
    connectorId: string;
    connectorInstanceId?: string;
    action: string;
    args?: Record<string, unknown>;
  }): Promise<unknown>;
  startAppConnectorOAuthFlow(payload: {
    connectorId: string;
    connectorInstanceId?: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string[] | string;
    redirectMode?: 'auto' | 'desktop' | 'loopback' | 'public';
    redirectUri?: string;
  }): Promise<{
    flowId: string;
    authorizeUrl: string;
    provider: string;
    runtimeKey: string;
    createdAt: string;
    expiresAt: string;
  }>;
  getAppConnectorOAuthFlowStatus(flowId: string): Promise<{
    flowId: string;
    connectorId: string;
    instanceId: string;
    runtimeKey: string;
    provider: string;
    status: 'pending' | 'completed' | 'error';
    detail?: string;
    createdAt: string;
    completedAt?: string;
    expiresAt: string;
  } | null>;
  disconnectAppConnectorOAuth(payload: {
    connectorId: string;
    connectorInstanceId?: string;
    remoteRevoke?: boolean;
  }): Promise<{
    connectorId: string;
    instanceId: string;
    runtimeKey: string;
    provider?: string;
    revoked: boolean;
    localCleared: boolean;
    detail: string;
  }>;
  handleAppConnectorOAuthCallback(callbackUrl: string): Promise<{
    flowId: string;
    connectorId: string;
    instanceId: string;
    runtimeKey: string;
    provider: string;
    status: 'pending' | 'completed' | 'error';
    detail?: string;
    createdAt: string;
    completedAt?: string;
    expiresAt: string;
  } | null>;

  // Build Mode
  detectBuildProject(payload: { agentId: string; workspaceRelativePath?: string }): Promise<BuildSessionSnapshot>;
  getBuildRuntimeSnapshot(payload: { agentId: string; workspaceRelativePath?: string }): Promise<BuildSessionSnapshot>;
  startBuildRuntime(payload: BuildStartRequest): Promise<BuildSessionSnapshot>;
  stopBuildRuntime(payload: { agentId: string }): Promise<BuildSessionSnapshot>;
  restartBuildRuntime(payload: { agentId: string }): Promise<BuildSessionSnapshot>;
  runBuildCommand(payload: BuildBuildRequest): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }>;
  runBuildQualityChecks(payload: BuildQualityCheckRunRequest): Promise<BuildQualityCheckRun>;
  getBuildQualityChecks(payload: { agentId: string; workspaceRelativePath?: string }): Promise<BuildQualityCheckRun | null>;
  runStartCommandOnce(payload: { agentId: string; workspaceRelativePath?: string; executionProfileId?: string | null; envOverrides?: Record<string, string>; commandOverride?: string }): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }>;
  getBuildRuntimeLogs(payload: { agentId: string; cursor?: number; limit?: number }): Promise<BuildLogsResponse>;
  clearBuildRuntimeLogs(payload: { agentId: string }): Promise<{ ok: boolean }>;
  getBuildTerminalSnapshot(payload: { agentId: string }): Promise<BuildTerminalSnapshot>;
  createBuildTerminalSession(payload: { agentId: string; workspaceRelativePath?: string; splitFromSessionId?: string }): Promise<BuildTerminalSnapshot>;
  setBuildTerminalActiveSession(payload: { agentId: string; sessionId: string }): Promise<BuildTerminalSnapshot>;
  getBuildTerminalOutput(payload: { agentId: string; sessionId: string; cursor?: number; limit?: number }): Promise<BuildTerminalOutputResponse>;
  runBuildTerminalCommand(payload: { agentId: string; sessionId: string; command: string }): Promise<{ ok: boolean }>;
  writeBuildTerminalInput(payload: { agentId: string; sessionId: string; input: string }): Promise<{ ok: boolean }>;
  interruptBuildTerminalSession(payload: { agentId: string; sessionId: string }): Promise<{ ok: boolean }>;
  resizeBuildTerminalSession(payload: { agentId: string; sessionId: string; cols: number; rows: number }): Promise<{ ok: boolean }>;
  clearBuildTerminalSession(payload: { agentId: string; sessionId: string }): Promise<{ ok: boolean }>;
  closeBuildTerminalSession(payload: { agentId: string; sessionId: string }): Promise<BuildTerminalSnapshot>;
  onBuildTerminalEntry(callback: (payload: { agentId: string; sessionId: string; entry: BuildTerminalEntry }) => void): (() => void);
  getBuildWorkspaceRoot(payload: { agentId: string }): Promise<{ workspaceRoot: string }>;
  openBuildWorkspacePath(payload: { agentId: string; relativePath?: string }): Promise<{ ok: boolean; path: string; error?: string }>;
  revealBuildWorkspacePath(payload: { agentId: string; relativePath?: string }): Promise<{ ok: boolean; path: string; error?: string }>;
  getBuildWorkspaceFingerprint(payload: { agentId: string; relativePath?: string }): Promise<BuildWorkspaceFingerprint>;
  getBuildWorkspaceTree(payload: { agentId: string; relativePath?: string; depth?: number; includeHidden?: boolean; maxEntries?: number }): Promise<BuildFileTreeNode>;
  readBuildWorkspaceFile(payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<BuildWorkspaceFileContent>;
  writeBuildWorkspaceFile(payload: { agentId: string; relativePath: string; content: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; size: number; modifiedAt: string }>;
  createBuildWorkspaceFolder(payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; createdAt: string }>;
  createBuildWorkspaceFile(payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; size: number; modifiedAt: string }>;
  renameBuildWorkspaceEntry(payload: { agentId: string; relativePath: string; nextName: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; renamedPath: string }>;
  deleteBuildWorkspaceEntry(payload: { agentId: string; relativePath: string; workspaceRelativePath?: string }): Promise<{ relativePath: string; ok: boolean }>;
  pasteBuildWorkspaceEntry(payload: {
    agentId: string;
    sourceRelativePath: string;
    destinationDirectoryRelativePath: string;
    mode: 'cut' | 'copy';
    sourceWorkspaceRelativePath?: string;
    destinationWorkspaceRelativePath?: string;
  }): Promise<{ sourceRelativePath: string; pastedPath: string; mode: 'cut' | 'copy' }>;
  getBuildWorkspaceDiff(payload: { agentId: string; relativePath?: string; maxChars?: number; baselineId?: string }): Promise<BuildWorkspaceDiff>;
  getBuildWorkspaceDiffFileContent(payload: { agentId: string; relativePath?: string; filePath: string; baselineId?: string }): Promise<BuildWorkspaceDiffFileContent>;
  getBuildGitSummary(payload: { agentId: string; relativePath?: string; lightweight?: boolean }): Promise<BuildGitSummary>;
  getBuildGitMismatchSummary(payload: { agentId: string; relativePath?: string }): Promise<BuildGitMismatchSummary>;
  resolveBuildGitMismatch(payload: { agentId: string; relativePath?: string } & BuildGitResolveMismatchInput): Promise<BuildGitActionResult>;
  initBuildGitRepository(payload: { agentId: string; relativePath?: string }): Promise<BuildGitActionResult>;
  commitBuildGitChanges(payload: { agentId: string; relativePath?: string; message: string }): Promise<BuildGitActionResult>;
  addBuildGitRemote(payload: { agentId: string; relativePath?: string } & BuildGitRemoteInput): Promise<BuildGitActionResult>;
  updateBuildGitRemote(payload: { agentId: string; relativePath?: string } & BuildGitRemoteInput): Promise<BuildGitActionResult>;
  fetchBuildGitRemote(payload: { agentId: string; relativePath?: string }): Promise<BuildGitActionResult>;
  pullBuildGitBranch(payload: { agentId: string; relativePath?: string }): Promise<BuildGitActionResult>;
  pushBuildGitBranch(payload: { agentId: string; relativePath?: string; branchName?: string }): Promise<BuildGitActionResult>;
  switchBuildGitBranch(payload: { agentId: string; relativePath?: string; branchName: string }): Promise<BuildGitActionResult>;
  createBuildGitBranch(payload: { agentId: string; relativePath?: string; branchName: string }): Promise<BuildGitActionResult>;
  discardBuildGitChanges(payload: { agentId: string; relativePath?: string; paths: string[] }): Promise<BuildGitActionResult>;
  getBuildGitConflicts(payload: { agentId: string; relativePath?: string }): Promise<{ files: BuildGitConflictFile[]; summary: BuildGitSummary }>;
  stageBuildGitFiles(payload: { agentId: string; relativePath?: string } & BuildGitStageInput): Promise<BuildGitActionResult>;
  finishBuildGitMerge(payload: { agentId: string; relativePath?: string; message?: string }): Promise<BuildGitActionResult>;
  createBuildGitStash(payload: { agentId: string; relativePath?: string; message?: string }): Promise<BuildGitActionResult>;
  listBuildGitStashes(payload: { agentId: string; relativePath?: string }): Promise<{ stashes: BuildGitStashEntry[]; summary: BuildGitSummary }>;
  applyBuildGitStash(payload: { agentId: string; relativePath?: string; stashRef: string }): Promise<BuildGitActionResult>;
  dropBuildGitStash(payload: { agentId: string; relativePath?: string; stashRef: string }): Promise<BuildGitActionResult>;
  checkoutBuildGitRemoteBranch(payload: { agentId: string; relativePath?: string; remoteBranchName: string; localBranchName?: string }): Promise<BuildGitActionResult>;
  createBuildGitRemoteRepository(payload: { agentId: string; relativePath?: string } & BuildGitRemoteRepositoryCreateInput): Promise<BuildGitRemoteRepositoryCreateResult>;
  createBuildGitPullRequest(payload: { agentId: string; relativePath?: string } & BuildGitPullRequestCreateInput): Promise<BuildGitPullRequestCreateResult>;
  listBuildGitBackupBranches(payload: { agentId: string; relativePath?: string }): Promise<{ branches: BuildGitBackupBranch[]; summary: BuildGitSummary }>;
  restoreBuildGitBackupBranch(payload: { agentId: string; relativePath?: string; branchName: string }): Promise<BuildGitActionResult>;
  listBuildGitReflog(payload: { agentId: string; relativePath?: string }): Promise<{ entries: BuildGitReflogEntry[]; summary: BuildGitSummary }>;
  captureBuildWorkspaceBaseline(payload: { agentId: string; relativePath?: string }): Promise<BuildWorkspaceBaselineCaptureResult>;
  resolveBuildWorkspaceBaseline(payload: { agentId: string; baselineId: string; decision: 'approve' | 'reject' }): Promise<BuildWorkspaceBaselineResolveResult>;
  exportBuildWorkspaceZip(payload: { agentId: string; relativePath?: string; suggestedName?: string }): Promise<{ ok: boolean; filePath?: string; cancelled?: boolean }>;
  listBuildPresets(payload: { agentId: string }): Promise<BuildProjectPresetListResult>;
  upsertBuildPreset(payload: BuildProjectPresetInput): Promise<BuildProjectPreset>;
  deleteBuildPreset(payload: { agentId: string; presetId: string }): Promise<{ ok: boolean }>;
  setActiveBuildPreset(payload: { agentId: string; presetId?: string | null }): Promise<{ activePresetId?: string }>;
  listBuildTaskHistorySessions(payload: BuildTaskHistoryListInput): Promise<BuildTaskSessionListResult>;
  getBuildTaskHistorySession(payload: { sessionId: string }): Promise<BuildTaskSession | null>;
  createBuildTaskHistorySession(payload: BuildTaskSessionCreateInput): Promise<BuildTaskSession>;
  updateBuildTaskHistorySession(payload: BuildTaskSessionUpdateInput): Promise<BuildTaskSession>;
  renameBuildTaskHistorySession(payload: BuildTaskSessionRenameInput): Promise<BuildTaskSession>;
  archiveBuildTaskHistorySession(payload: BuildTaskSessionArchiveInput): Promise<BuildTaskSession>;
  setBuildTaskHistorySessionPinned(payload: BuildTaskSessionPinInput): Promise<BuildTaskSession>;
  deleteBuildTaskHistorySession(payload: BuildTaskSessionDeleteInput): Promise<{ ok: boolean }>;
  onSubagentsChanged(callback: (event: { parentTaskIds: string[] }) => void): () => void;
  updateSubagentPolicy(payload: { runId: string; maxCostUsd?: number; runTimeoutMs?: number; limitAction: 'notify' | 'stop' }): Promise<void>;
  consumeSubagentResults(payload: { parentTaskId: string }): Promise<boolean>;
  listSubagents(payload: { parentTaskId: string }): Promise<{ runs: SubagentRunDetail[]; tree: SubagentRunTreeNode[]; activeCount: number }>;
  listAllSubagents(payload?: { includeArchived?: boolean; query?: string; limit?: number }): Promise<{ runs: SubagentRunDetail[]; total?: number; truncated?: boolean }>;
  getSubagent(payload: { runId: string }): Promise<SubagentRunDetail | null>;
  waitSubagent(payload: { runId: string; timeoutMs?: number; pollIntervalMs?: number }): Promise<{ completed: boolean; waitedMs: number; run: SubagentRunDetail | null }>;
  sendSubagent(payload: { runId: string; prompt: string; modelProvider?: string; modelId?: string; modelBaseUrl?: string }): Promise<{ ok: boolean; runId: string; childTaskId: string }>;
  archiveSubagent(payload: { runId: string; archived?: boolean }): Promise<SubagentRunDetail>;
  closeSubagent(payload: { runId: string }): Promise<SubagentRunDetail>;
  stopSubagent(payload: { runId: string }): Promise<{ ok: boolean; runId: string }>;

  // API Key management
  hasApiKey(): Promise<boolean>;
  setApiKey(key: string): Promise<void>;
  getApiKey(): Promise<string | null>;
  validateApiKey(key: string): Promise<{ valid: boolean; error?: string }>;
  validateApiKeyForProvider(provider: string, key: string): Promise<{ valid: boolean; error?: string }>;
  clearApiKey(): Promise<void>;

  // Multi-provider API keys
  getAllApiKeys(): Promise<Record<string, { exists: boolean; prefix?: string }>>;
  hasAnyApiKey(): Promise<boolean>;

  // Skills
  getSkillsStatus(): Promise<Array<{ id: string; name: string; description?: string; installed: boolean; installable: boolean }>>;
  installSkill(skillId: string): Promise<{ skillId: string; success: boolean; output: string }>;
  uninstallSkill(skillId: string): Promise<{ skillId: string; success: boolean; output: string }>;
  installAllSkills(): Promise<Array<{ skillId: string; success: boolean; output: string }>>;

  // User Skills (OpenDeskmate-style markdown playbooks)
  listUserSkills(agentId?: string): Promise<UserSkillStatusReport>;
  createUserSkill(payload: UserSkillCreateRequest): Promise<{ baseDir: string; skillId: string; manifest?: import('@accomplish/shared').UserSkillManifest }>;
  readUserSkillFile(payload: UserSkillReadFileRequest & { agentId?: string }): Promise<UserSkillReadFileResponse>;
  writeUserSkillFile(payload: UserSkillWriteFileRequest & { agentId?: string }): Promise<{ path: string; manifest?: import('@accomplish/shared').UserSkillManifest }>;
  deleteUserSkill(payload: UserSkillDeleteRequest): Promise<UserSkillDeleteResponse>;
  setUserSkillLifecycle(payload: UserSkillLifecycleUpdateRequest): Promise<UserSkillManifestResult>;
  setUserSkillSharing(payload: UserSkillSharingUpdateRequest): Promise<UserSkillManifestResult>;
  runUserSkillTests(payload: UserSkillTestRequest): Promise<UserSkillManifestResult>;
  rollbackUserSkill(payload: UserSkillRollbackRequest): Promise<UserSkillManifestResult>;
  recordUserSkillPerformance(payload: UserSkillPerformanceRecordRequest): Promise<UserSkillManifestResult>;
  getUserSkillsDependencyStatus(agentId?: string): Promise<UserSkillDependencyStatusReport>;
  installUserSkillDependency(payload: UserSkillInstallRequest): Promise<UserSkillInstallResult>;
  getUserSkillConfig(payload: UserSkillConfigGetRequest): Promise<UserSkillConfigGetResponse>;
  setUserSkillConfig(payload: UserSkillConfigSetRequest): Promise<UserSkillConfigGetResponse>;
  inspectUserSkillZip(payload: UserSkillZipInspectRequest): Promise<UserSkillZipInspectResponse>;
  installUserSkillFromZip(payload: UserSkillZipInstallRequest): Promise<UserSkillZipInstallResult>;
  cleanupUserSkillZipSession(payload: UserSkillZipCleanupRequest): Promise<{ ok: boolean }>;
  generateUserSkillFromTask(payload: UserSkillGenerateFromTaskRequest): Promise<UserSkillGenerateFromTaskResponse>;
  runPostTaskSkillAutomation(payload: UserSkillPostTaskAutomationRequest): Promise<UserSkillPostTaskAutomationResult>;
  runUserSkillCurator(payload?: { agentId?: string; dryRun?: boolean }): Promise<UserSkillCuratorRunRecord>;
  listUserSkillCuratorHistory(): Promise<UserSkillCuratorHistoryResponse>;
  askUserSkillAssistant(payload: UserSkillAssistantAskRequest): Promise<UserSkillAssistantAskResponse>;
  generateChecklistListPrompt(payload: ChecklistListPromptGenerateRequest): Promise<ChecklistListPromptGenerateResponse>;
  generateWorkItemNotePrompt(payload: WorkItemNotePromptGenerateRequest): Promise<WorkItemNotePromptGenerateResponse>;
  generateChatPostcardDraft(payload: ChatPostcardDraftGenerateRequest): Promise<ChatPostcardDraftGenerateResponse>;

  // Automations
  listSchedules(): Promise<Array<import('@accomplish/shared').ScheduledTask>>;
  upsertSchedule(config: import('@accomplish/shared').ScheduleConfig, scheduleId?: string): Promise<import('@accomplish/shared').ScheduledTask>;
  deleteSchedule(scheduleId: string): Promise<void>;
  toggleSchedule(scheduleId: string, enabled: boolean): Promise<import('@accomplish/shared').ScheduledTask | null>;
  runScheduleNow(scheduleId: string): Promise<void>;
  getAutomationInfo(): Promise<{ webhookUrl: string; localUrl: string; lanUrls: string[]; publicUrl: string | null; bindMode: 'localhost' | 'all'; port: number }>;
  draftAutomationFromText(request: AutomationDraftRequest): Promise<AutomationDraftResult>;

  // Onboarding
  getOnboardingComplete(): Promise<boolean>;
  setOnboardingComplete(complete: boolean): Promise<void>;

  // Claude CLI
  checkClaudeCli(): Promise<{ installed: boolean; version: string | null; installCommand: string }>;
  getClaudeVersion(): Promise<string | null>;

  // Model selection
  getSelectedModel(): Promise<{ provider: string; model: string; baseUrl?: string } | null>;
  setSelectedModel(model: { provider: string; model: string; baseUrl?: string }): Promise<void>;
  getUserSkillAssistantModel(): Promise<{ provider: string; model: string; baseUrl?: string } | null>;
  setUserSkillAssistantModel(model: { provider: string; model: string; baseUrl?: string } | null): Promise<void>;
  listModelProviders(): Promise<ProviderConfig[]>;
  listToolsets(): Promise<ToolsetListResult>;
  searchToolsets(query: string): Promise<ToolDiscoverySearchResult>;
  describeToolset(toolsetId: string): Promise<ResolvedToolsetDefinition | null>;
  listTools(payload?: { toolsetIds?: ToolsetId[] }): Promise<ToolCapabilityListResult>;
  searchTools(query: string): Promise<ToolDiscoverySearchResult>;
  describeTool(toolName: string): Promise<ToolCapability | null>;
  listEnabledTaskTools(payload?: { agentId?: string; taskId?: string; deferredToolDiscoveryEnabled?: boolean; requestedToolsetIds?: ToolsetId[]; initialToolsetIds?: ToolsetId[] }): Promise<ToolDiscoveryEnabledListResult>;
  enableTaskTools(payload: { request: ToolDiscoveryEnableRequest; agentId?: string; taskId?: string; deferredToolDiscoveryEnabled?: boolean; requestedToolsetIds?: ToolsetId[]; initialToolsetIds?: ToolsetId[] }): Promise<ToolDiscoveryEnableResult>;
  listCustomModelProviders(): Promise<ProviderConfig[]>;
  listBuiltinProviderModelOverrides(): Promise<Record<string, ModelConfig[]>>;
  upsertBuiltinProviderModel(payload: { providerId: string; model: ModelConfig }): Promise<ModelConfig>;
  deleteBuiltinProviderModel(payload: { providerId: string; modelId: string }): Promise<{ ok: boolean }>;
  upsertCustomModelProvider(provider: ProviderConfig): Promise<ProviderConfig>;
  deleteCustomModelProvider(providerId: string): Promise<{ ok: boolean }>;
  getModelLimitOverrides(): Promise<{ overrides: Record<string, { contextWindowTokens?: number }> }>;
  setModelContextLimitOverride(payload: { fullId: string; contextWindowTokens: number | null }): Promise<{ fullId: string; contextWindowTokens: number | null }>;

  // Ollama configuration
  testOllamaConnection(url: string): Promise<{
    success: boolean;
    models?: Array<{ id: string; displayName: string; size: number }>;
    error?: string;
  }>;
  getOllamaConfig(): Promise<{ baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; displayName: string; size: number; toolsetIds?: ToolsetId[] }>; toolMode?: 'off' | 'internet' | 'workspace-read' | 'workspace-edit' | 'desktop' | 'full'; toolsetIds?: ToolsetId[] } | null>;
  setOllamaConfig(config: { baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; displayName: string; size: number; toolsetIds?: ToolsetId[] }>; toolMode?: 'off' | 'internet' | 'workspace-read' | 'workspace-edit' | 'desktop' | 'full'; toolsetIds?: ToolsetId[] } | null): Promise<void>;

  // Event subscriptions
  onTaskUpdate(callback: (event: TaskUpdateEvent) => void): () => void;
  onTaskActivity?(callback: (event: TaskActivityEvent) => void): () => void;
  onTaskCreated?(callback: (task: Task) => void): () => void;
  onTaskUpdateBatch?(callback: (event: { taskId: string; messages: TaskMessage[] }) => void): () => void;
  onPermissionRequest(callback: (request: PermissionRequest) => void): () => void;
  onTaskProgress(callback: (progress: TaskProgress) => void): () => void;
  onDebugLog(callback: (log: unknown) => void): () => void;
  onDebugModeChange?(callback: (data: { enabled: boolean }) => void): () => void;
  onTaskStatusChange?(callback: (data: { taskId: string; status: TaskStatus }) => void): () => void;
  onTaskSummary?(callback: (data: { taskId: string; summary: string }) => void): () => void;
  onHelpDocsUpdated?(callback: (event: HelpDocsUpdatedEvent) => void): () => void;
  onHelpNavigate?(callback: (payload: { docId?: string; query?: string }) => void): () => void;

  // Logging
  logEvent(payload: { level?: string; message: string; context?: Record<string, unknown> }): Promise<unknown>;

  // Folder operations (synced with webchat)
  listFolders(): Promise<import('@accomplish/shared').Folder[]>;
  createFolder(config: { name: string; icon?: string; color?: string; usageProjectId?: string | null; assigneeIds?: string[] | null }): Promise<import('@accomplish/shared').Folder>;
  updateFolder(folderId: string, config: { name?: string; icon?: string; color?: string; usageProjectId?: string | null; assigneeIds?: string[] | null; isExpanded?: boolean; order?: number }): Promise<import('@accomplish/shared').Folder | undefined>;
  deleteFolder(folderId: string): Promise<{ success: boolean }>;
  getTaskFolderAssignments(): Promise<Record<string, string>>;
  assignTaskToFolder(taskId: string, folderId: string | null): Promise<{ success: boolean; usageProjectId?: string | null }>;
  assignTaskToUsageProject(taskId: string, usageProjectId: string | null): Promise<{ success: boolean; usageProjectId?: string | null }>;
}

interface AccomplishShell {
  version: string;
  platform: string;
  isElectron: true;
}

// Extend Window interface
declare global {
  interface Window {
    accomplish?: AccomplishAPI;
    accomplishShell?: AccomplishShell;
  }
}

/**
 * Get the accomplish API
 * Throws if not running in Electron
 */
export function getAccomplish(): AccomplishAPI {
  if (!window.accomplish) {
    throw new Error('Accomplish API not available - not running in Electron');
  }
  return window.accomplish;
}

/**
 * Check if running in Electron shell
 */
export function isRunningInElectron(): boolean {
  return window.accomplishShell?.isElectron === true;
}

/**
 * Get shell version if available
 */
export function getShellVersion(): string | null {
  return window.accomplishShell?.version ?? null;
}

/**
 * Get shell platform if available
 */
export function getShellPlatform(): string | null {
  return window.accomplishShell?.platform ?? null;
}

/**
 * React hook to use the accomplish API
 */
export function useAccomplish(): AccomplishAPI {
  const api = window.accomplish;
  if (!api) {
    throw new Error('Accomplish API not available - not running in Electron');
  }
  return api;
}
