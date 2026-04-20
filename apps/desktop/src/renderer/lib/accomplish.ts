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
  ApiKeyConfig,
  TaskMessage,
  ContextWindowEstimateResponse,
  UsagePricingAutofillResult,
  UsagePricingAutofillRequest,
  UsagePeriod,
  UsagePricingSettings,
  UsageSummary,
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
  AppConnectorExtensionConfig,
  AppConnectorExtensionConfigInput,
  AppConnectorExtensionState,
  AppConnectorRuntimeStatus,
  AppConnectorRuntimeTestResult,
  BuildBuildRequest,
  BuildDiffEnforcementMode,
  BuildFileTreeNode,
  BuildLogsResponse,
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
} from '@accomplish/shared';

// Define the API interface
interface AccomplishAPI {
  // App info
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;

  // Shell
  openExternal(url: string): Promise<void>;

  // Help docs
  listHelpDocs(): Promise<HelpDocsListResponse>;
  readHelpDoc(docId: string): Promise<HelpDocPageResponse>;
  searchHelpDocs(query: string): Promise<HelpDocsSearchResponse>;
  getHelpAssetDataUrl(docId: string, assetPath: string): Promise<{ dataUrl: string }>;
  openHelpDocInEditor(docId: string): Promise<{ ok: boolean; path: string }>;
  openHelpDocsFolder(): Promise<{ ok: boolean; path: string }>;
  openHelpAsset(docId: string, assetPath: string): Promise<{ ok: boolean; path: string }>;

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
  listSavedPrompts(): Promise<Array<{ id: string; title: string; content: string; createdAt: string; updatedAt: string }>>;
  upsertSavedPrompt(payload: { id?: string; title: string; content: string; createdAt?: string; updatedAt?: string }): Promise<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>;
  deleteSavedPrompt(id: string): Promise<{ ok: boolean }>;

  // Permission responses
  respondToPermission(response: PermissionResponse): Promise<void>;

  // Session management
  resumeSession(
    sessionId: string,
    prompt: string,
    taskId?: string,
    attachedFiles?: string[],
    privacyMode?: 'normal' | 'incognito'
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

  // Usage estimate (global)
  getUsageSummary(period: UsagePeriod): Promise<UsageSummary>;
  getUsagePricing(): Promise<UsagePricingSettings>;
  listUsageModelsUsed(): Promise<Record<string, string[]>>;
  setUsagePricing(settings: UsagePricingSettings): Promise<UsagePricingSettings>;
  autoFillUsagePricingWithAI(request: UsagePricingAutofillRequest): Promise<UsagePricingAutofillResult>;

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
  saveDataUrlToFile(dataUrl: string, baseName?: string): Promise<{ filePath: string }>;
  setBrowserProfile(profile: string): Promise<string>;
  setWorkspaceRoot(root: string | null): Promise<string | null>;
  getMemoryState(payload?: { agentId?: string; date?: string }): Promise<{
    workspaceRoot: string;
    longTerm: { path: string; content: string };
    daily: { date: string; path: string; content: string };
    dailyFiles: string[];
  }>;
  readMemoryFile(payload: { kind: 'long-term' | 'daily'; date?: string; agentId?: string }): Promise<{
    path: string;
    date?: string;
    content: string;
  }>;
  saveMemoryFile(payload: { kind: 'long-term' | 'daily'; date?: string; agentId?: string; content?: string }): Promise<{
    path: string;
    date?: string;
  }>;
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
  runStartCommandOnce(payload: { agentId: string; workspaceRelativePath?: string; envOverrides?: Record<string, string>; commandOverride?: string }): Promise<{ snapshot: BuildSessionSnapshot; result: BuildRuntimeCommandResult }>;
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
  listSubagents(payload: { parentTaskId: string }): Promise<{ runs: SubagentRunDetail[]; tree: SubagentRunTreeNode[]; activeCount: number }>;
  listAllSubagents(payload?: { includeArchived?: boolean }): Promise<{ runs: SubagentRunDetail[] }>;
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
  askUserSkillAssistant(payload: UserSkillAssistantAskRequest): Promise<UserSkillAssistantAskResponse>;

  // Automations
  listSchedules(): Promise<Array<import('@accomplish/shared').ScheduledTask>>;
  upsertSchedule(config: import('@accomplish/shared').ScheduleConfig, scheduleId?: string): Promise<import('@accomplish/shared').ScheduledTask>;
  deleteSchedule(scheduleId: string): Promise<void>;
  toggleSchedule(scheduleId: string, enabled: boolean): Promise<import('@accomplish/shared').ScheduledTask | null>;
  runScheduleNow(scheduleId: string): Promise<void>;
  getAutomationInfo(): Promise<{ webhookUrl: string; localUrl: string; lanUrls: string[]; publicUrl: string | null; bindMode: 'localhost' | 'all'; port: number }>;

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
  listCustomModelProviders(): Promise<ProviderConfig[]>;
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
  getOllamaConfig(): Promise<{ baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; displayName: string; size: number }> } | null>;
  setOllamaConfig(config: { baseUrl: string; enabled: boolean; lastValidated?: number; models?: Array<{ id: string; displayName: string; size: number }> } | null): Promise<void>;

  // Event subscriptions
  onTaskUpdate(callback: (event: TaskUpdateEvent) => void): () => void;
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
  createFolder(config: { name: string; icon?: string; color?: string }): Promise<import('@accomplish/shared').Folder>;
  updateFolder(folderId: string, config: { name?: string; icon?: string; color?: string; isExpanded?: boolean; order?: number }): Promise<import('@accomplish/shared').Folder | undefined>;
  deleteFolder(folderId: string): Promise<{ success: boolean }>;
  getTaskFolderAssignments(): Promise<Record<string, string>>;
  assignTaskToFolder(taskId: string, folderId: string | null): Promise<{ success: boolean }>;
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
