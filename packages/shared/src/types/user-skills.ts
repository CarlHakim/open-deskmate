import type { SelectedModel } from './provider';

export type UserSkillSource = 'managed' | 'workspace' | 'bundled' | 'extra';

export type UserSkillLifecycleState = 'active' | 'deprecated' | 'disabled';

export type UserSkillAutomationMode = 'automatic' | 'approval' | 'off';

export type UserSkillAutomationConfidenceLabel = 'low' | 'medium' | 'high';

export type UserSkillManifestValidation = {
  ok: boolean;
  issues: string[];
  checkedAt: string;
};

export type UserSkillManifestTestResult = {
  ok: boolean;
  command?: string[];
  durationMs: number;
  stdout?: string;
  stderr?: string;
  code: number | null;
  runAt: string;
};

export type UserSkillManifestVersionEntry = {
  version: string;
  archivedAt: string;
  checksum: string;
  relPath: string;
  changeReason?: string;
  sourceTaskId?: string;
  confidence?: number;
  changeSource?: string;
};

export type UserSkillManifestPerformance = {
  samples: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs?: number;
  avgInputTokens?: number;
  avgOutputTokens?: number;
  lastUsedAt?: string;
  lastError?: string;
  lastEvaluationAt?: string;
};

export type UserSkillManifest = {
  schemaVersion: 1;
  skillId: string;
  name: string;
  description?: string;
  version: string;
  state: UserSkillLifecycleState;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  deprecationReason?: string;
  test?: {
    command?: string[];
    timeoutMs?: number;
  };
  versions: UserSkillManifestVersionEntry[];
  lastValidation?: UserSkillManifestValidation;
  lastTest?: UserSkillManifestTestResult;
  performance?: UserSkillManifestPerformance;
  lastChange?: {
    changedAt: string;
    reason?: string;
    sourceTaskId?: string;
    confidence?: number;
    changeSource?: string;
  };
};

export type UserSkillInstallSpec =
  | {
      kind: 'node';
      id?: string;
      label?: string;
      bins?: string[];
      os?: string[];
      package: string;
    }
  | {
      kind: 'brew';
      id?: string;
      label?: string;
      bins?: string[];
      os?: string[];
      formula: string;
    }
  | {
      kind: 'go';
      id?: string;
      label?: string;
      bins?: string[];
      os?: string[];
      module: string;
    }
  | {
      kind: 'uv';
      id?: string;
      label?: string;
      bins?: string[];
      os?: string[];
      package: string;
    }
  | {
      kind: 'download';
      id?: string;
      label?: string;
      bins?: string[];
      os?: string[];
      url: string;
      archive?: string;
      extract?: boolean;
      stripComponents?: number;
      targetDir?: string;
    };

export type UserSkillMetadata = {
  // OpenDeskmate metadata envelope (legacy-compatible). Prefer `opendeskmate` going forward.
  opendeskmate?: {
    emoji?: string;
    homepage?: string;
    skillKey?: string;
    generatedBy?: string;
    generatedByAgentName?: string;
    generatedByAgentId?: string;
    createdBy?: string;
    origin?: string;
    requiresReview?: boolean;
    observedTools?: string[];
    automation?: {
      mode?: UserSkillAutomationMode;
      confidence?: number;
      confidenceLabel?: UserSkillAutomationConfidenceLabel;
      sourceTaskId?: string;
      draftId?: string;
      stagedAt?: string;
      appliedAt?: string;
      reason?: string;
      reasons?: string[];
    };
    curator?: {
      lastRunId?: string;
      lastReviewedAt?: string;
      findingTypes?: string[];
    };
    visibility?: {
      scope?: 'private' | 'selected' | 'all';
      ownerAgentId?: string;
      sharedWithAgentIds?: string[];
    };
    primaryEnv?: string;
    always?: boolean;
    os?: string[];
    requires?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
      config?: string[];
    };
    install?: UserSkillInstallSpec[];
  };
  // Legacy alias for older skills/playbooks. Kept for backward compatibility.
  clawdbot?: UserSkillMetadata['opendeskmate'];
};

export type UserSkillEntry = {
  id: string; // folder name
  name: string;
  description?: string;
  source: UserSkillSource;
  baseDir: string;
  filePath: string; // SKILL.md
  manifestPath?: string;
  manifest?: UserSkillManifest;
  metadata?: UserSkillMetadata;
  generatedByUserInstruction?: boolean;
  generatedByAgentName?: string;
  originLabel?: string;
  visibilityScope?: 'private' | 'selected' | 'all';
  visibilityOwnerAgentId?: string;
  visibilitySharedWithAgentIds?: string[];
  bodyPreview?: string; // short preview for UI
  editable: boolean;
};

export type UserSkillStatusReport = {
  managedSkillsDir: string;
  workspaceSkillsDir?: string | null;
  bundledSkillsDir?: string | null;
  version: number;
  skills: UserSkillEntry[];
};

export type UserSkillConfig = {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  // Allow arbitrary nested config for parity with OpenDeskmate playbook config paths.
  [key: string]: unknown;
};

export type UserSkillsConfigStore = {
  skills?: Record<string, UserSkillConfig>;
};

export type UserSkillStatusConfigCheck = {
  path: string;
  value: unknown;
  satisfied: boolean;
};

export type UserSkillInstallOption = {
  id: string;
  kind: UserSkillInstallSpec['kind'];
  label: string;
  bins: string[];
};

export type UserSkillDependencyStatusEntry = UserSkillEntry & {
  skillKey: string;
  always: boolean;
  disabled: boolean;
  eligible: boolean;
  requirements: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  configChecks: UserSkillStatusConfigCheck[];
  install: UserSkillInstallOption[];
};

export type UserSkillDependencyStatusReport = {
  managedSkillsDir: string;
  workspaceSkillsDir?: string | null;
  bundledSkillsDir?: string | null;
  version: number;
  skills: UserSkillDependencyStatusEntry[];
};

export type UserSkillReadFileRequest = { skillId: string; relPath: string; source?: UserSkillSource };
export type UserSkillReadFileResponse = { path: string; content: string };

export type UserSkillWriteFileRequest = {
  skillId: string;
  relPath: string;
  content: string;
  source?: UserSkillSource;
  changeReason?: string;
  sourceTaskId?: string;
  confidence?: number;
  changeSource?: string;
};

export type UserSkillDeleteRequest = { skillId: string; source?: UserSkillSource; agentId?: string };
export type UserSkillDeleteResponse = { ok: boolean; message: string };

export type UserSkillCreateRequest = {
  skillId?: string;
  name?: string;
  description?: string;
};

export type UserSkillConfigGetRequest = { skillKey: string };
export type UserSkillConfigGetResponse = { skillKey: string; config: UserSkillConfig };
export type UserSkillConfigSetRequest = { skillKey: string; config: UserSkillConfig };

export type UserSkillInstallRequest = { skillId: string; installId: string; source?: UserSkillSource; agentId?: string };
export type UserSkillInstallResult = { ok: boolean; message: string; stdout: string; stderr: string; code: number | null };

export type UserSkillZipSource = 'github' | 'url' | 'local';

export type UserSkillZipCandidate = {
  // Suggested folder name for install.
  skillId: string;
  name: string;
  description?: string;
  // Relative path to the skill folder inside the extracted ZIP session.
  relPath: string;
};

export type UserSkillZipInspectRequest =
  | { source: 'local'; filePath: string; agentId?: string }
  | { source: 'github' | 'url'; url: string; agentId?: string };

export type UserSkillZipInspectResponse = {
  sessionId: string;
  candidates: UserSkillZipCandidate[];
  message?: string;
};

export type UserSkillZipInstallRequest = {
  sessionId: string;
  relPath: string;
  destSkillId: string;
  overwrite?: boolean;
  agentId?: string;
};

export type UserSkillZipInstallResult = {
  ok: boolean;
  message: string;
  installedSkillId?: string;
  destDir?: string;
};

export type UserSkillZipCleanupRequest = { sessionId: string };

export type UserSkillWorkflowDraft = {
  skillId: string;
  name: string;
  description?: string;
  skillMd: string;
};

export type UserSkillGenerateFromTaskRequest = {
  taskId: string;
  agentId?: string;
};

export type UserSkillGenerateFromTaskResponse = {
  ok: boolean;
  draft?: UserSkillWorkflowDraft;
  error?: string;
};

export type UserSkillTaskReusabilityEvaluation = {
  reusable: boolean;
  confidence: number;
  confidenceLabel: UserSkillAutomationConfidenceLabel;
  reasons: string[];
  blockers: string[];
};

export type UserSkillAutomationDraftRecord = {
  id: string;
  taskId: string;
  agentId?: string;
  mode: UserSkillAutomationMode;
  status: 'staged' | 'applied' | 'dismissed';
  createdAt: string;
  appliedAt?: string;
  skillId?: string;
  source?: UserSkillSource;
  reason?: string;
  draft: UserSkillWorkflowDraft;
  evaluation: UserSkillTaskReusabilityEvaluation;
};

export type UserSkillPostTaskAutomationRequest = {
  taskId: string;
  agentId?: string;
  modeOverride?: UserSkillAutomationMode;
};

export type UserSkillPostTaskAutomationResult = {
  ok: boolean;
  mode: UserSkillAutomationMode;
  disposition: 'noop' | 'skipped' | 'staged' | 'saved' | 'updated' | 'error';
  message: string;
  taskId: string;
  agentId?: string;
  skillId?: string;
  draftRecord?: UserSkillAutomationDraftRecord;
  evaluation?: UserSkillTaskReusabilityEvaluation;
  manifest?: UserSkillManifest;
  error?: string;
};

export type UserSkillCuratorFindingType = 'duplicate' | 'stale' | 'unused' | 'broken' | 'weak' | 'metadata';
export type UserSkillCuratorSeverity = 'info' | 'warning' | 'error';

export type UserSkillCuratorFinding = {
  id: string;
  type: UserSkillCuratorFindingType;
  severity: UserSkillCuratorSeverity;
  skillId: string;
  source: UserSkillSource;
  message: string;
  evidence: string[];
  duplicateOfSkillId?: string;
};

export type UserSkillCuratorActionType = 'metadata-updated' | 'archived-stale' | 'archived-duplicate' | 'reported';

export type UserSkillCuratorAction = {
  id: string;
  type: UserSkillCuratorActionType;
  skillId: string;
  source: UserSkillSource;
  applied: boolean;
  message: string;
  findingIds: string[];
  reason?: string;
  sourceTaskId?: string;
  confidence?: number;
  historyRunId?: string;
  changeSource?: string;
  currentVersion?: string;
  rollbackVersion?: string;
  rollbackRelPath?: string;
  duplicateOfSkillId?: string;
};

export type UserSkillCuratorRunRequest = {
  agentId?: string;
  dryRun?: boolean;
};

export type UserSkillCuratorRunRecord = {
  id: string;
  startedAt: string;
  finishedAt: string;
  agentId?: string;
  dryRun: boolean;
  scanned: number;
  findings: UserSkillCuratorFinding[];
  actions: UserSkillCuratorAction[];
};

export type UserSkillCuratorHistoryResponse = {
  runs: UserSkillCuratorRunRecord[];
};

export type UserSkillAssistantMode = 'general' | 'configure' | 'edit';

export type UserSkillAssistantAskRequest = {
  question: string;
  skillId?: string;
  source?: UserSkillSource;
  skillKey?: string;
  mode?: UserSkillAssistantMode;
  agentId?: string;
  draftContent?: string;
};

export type UserSkillAssistantAskResponse = {
  ok: boolean;
  answer: string;
  skillId?: string;
  skillKey?: string;
  model?: SelectedModel | null;
  error?: string;
};

export type UserSkillLifecycleUpdateRequest = {
  skillId: string;
  state: UserSkillLifecycleState;
  reason?: string;
  source?: UserSkillSource;
  agentId?: string;
  sourceTaskId?: string;
  confidence?: number;
  changeSource?: string;
};

export type UserSkillSharingScope = 'private' | 'selected' | 'all';

export type UserSkillSharingUpdateRequest = {
  skillId: string;
  scope: UserSkillSharingScope;
  sharedWithAgentIds?: string[];
  source?: UserSkillSource;
  agentId?: string;
};

export type UserSkillSharingUpdateResult = UserSkillManifestResult;

export type UserSkillRollbackRequest = {
  skillId: string;
  targetVersion?: string;
  source?: UserSkillSource;
  agentId?: string;
};

export type UserSkillTestRequest = {
  skillId: string;
  source?: UserSkillSource;
  agentId?: string;
};

export type UserSkillPerformanceRecordRequest = {
  skillId: string;
  success: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  source?: UserSkillSource;
  agentId?: string;
};

export type UserSkillManifestResult = {
  ok: boolean;
  message: string;
  manifest?: UserSkillManifest;
};
