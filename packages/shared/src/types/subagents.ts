import type { SelectedModel } from './provider';
import type { ToolsetId } from './toolsets';

export type SubagentRunStatus = 'accepted' | 'running' | 'done' | 'error';
export type SubagentRunResultStatus = 'success' | 'error' | 'interrupted';
export type SubagentSpawnMode = 'run' | 'session';
export type SubagentSessionState = 'pending' | 'ready' | 'missing';
export type SubagentProgressEventType =
  | 'started'
  | 'status'
  | 'milestone'
  | 'output'
  | 'tool'
  | 'blocked'
  | 'recovery'
  | 'completed';
export type SubagentExpectedOutputKind = 'text' | 'file' | 'artifact' | 'json' | 'diff' | 'command_result';
export type SubagentRecoveryAction =
  | 'resume'
  | 'retry'
  | 'replace'
  | 'cancel'
  | 'request_clarification'
  | 'manual_intervention';
export type SubagentRecoveryStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type SubagentSupervisorRunState =
  | 'queued'
  | 'active'
  | 'progressing'
  | 'waiting'
  | 'stale'
  | 'likely_stuck'
  | 'blocked'
  | 'recovering'
  | 'replaced'
  | 'complete'
  | 'failed'
  | 'timed_out';
export type SubagentSupervisorRecommendedAction =
  | 'wait'
  | 'recover_child'
  | 'replace_child'
  | 'synthesize_partial'
  | 'answer_now';

export interface SubagentExecutionPolicy {
  inheritedFromAgentId: string;
  maxChildren: number;
  maxDepth: number;
  runTimeoutMs: number;
  autoRelayCompletions: boolean;
  mode: SubagentSpawnMode;
}

export interface SubagentInheritedContext {
  workingDirectory?: string;
  attachedFiles?: string[];
  privacyMode?: 'normal' | 'incognito';
  buildMode?: boolean;
  buildWorkspaceRelativePath?: string;
  toolsetIds?: ToolsetId[];
  deferredToolDiscoveryEnabled?: boolean;
  enabledToolsetIds?: ToolsetId[];
  availableToolsetIds?: ToolsetId[];
  inheritedToolsetIds?: ToolsetId[];
}

export interface SubagentProgressEvent {
  id: string;
  runId: string;
  type: SubagentProgressEventType;
  timestamp: string;
  title?: string;
  detail?: string;
  status?: 'pending' | 'running' | 'success' | 'warning' | 'error' | 'info';
  toolName?: string;
  messageId?: string;
  percentage?: number;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
  recoverable?: boolean;
  metadata?: Record<string, unknown>;
  sourceUrl?: string;
  domain?: string;
  httpStatus?: number;
  failureKind?: 'http_error' | 'cloudflare' | 'captcha' | 'login_wall' | 'permission' | 'tool_unavailable' | 'loop' | 'unknown';
  fallbackSuggested?: string;
}

export interface SubagentSupervisorState {
  state?: SubagentSupervisorRunState;
  agentId?: string;
  taskId?: string;
  sessionKey?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  heartbeatAt?: string;
  lastProgressAt?: string;
  lastMeaningfulProgressAt?: string;
  stallDetectedAt?: string;
  stalledReason?: string;
  staleReason?: string;
  stuckReason?: string;
  blockedReason?: string;
  repeatedToolName?: string;
  repeatedToolCount?: number;
  blockedSourceDomain?: string;
  blockedSourceUrl?: string;
  blockedHttpStatus?: number;
  blockedFailureKind?: SubagentProgressEvent['failureKind'];
  blockedSourceCount?: number;
  recommendedAction?: SubagentSupervisorRecommendedAction;
  recoveryEligible?: boolean;
  recoveryAttempts?: number;
  notes?: string;
}

export interface SubagentSharedBlockedSource {
  domain?: string;
  sourceUrl?: string;
  httpStatus?: number;
  failureKind?: SubagentProgressEvent['failureKind'];
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  example?: string;
}

export interface SubagentSharedContext {
  parentTaskId: string;
  generatedAt: string;
  blockedSources: SubagentSharedBlockedSource[];
  blockedTools: string[];
  successfulFallbacks: string[];
  confirmedFindings: string[];
  openGaps: string[];
}

export interface SubagentExpectedOutput {
  id: string;
  kind: SubagentExpectedOutputKind;
  label: string;
  description?: string;
  required?: boolean;
  path?: string;
  schema?: object;
}

export interface SubagentResultBundleItem {
  id: string;
  kind: SubagentExpectedOutputKind | 'summary' | 'error';
  label: string;
  content?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface SubagentResultBundle {
  summary?: string;
  partialReport?: string;
  finalReport?: string;
  finalReportTruncated?: boolean;
  items: SubagentResultBundleItem[];
  missingExpectedOutputIds?: string[];
  generatedAt: string;
}

export interface SubagentRecoveryHistoryEntry {
  id: string;
  action: SubagentRecoveryAction;
  status: SubagentRecoveryStatus;
  reason?: string;
  startedAt: string;
  completedAt?: string;
  replacementRunId?: string;
  error?: string;
  notes?: string;
}

export interface SubagentBuildHandoffChangedFile {
  relativePath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'unknown';
  addedLines?: number;
  deletedLines?: number;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
}

export interface SubagentBuildHandoffGitSummary {
  isRepository: boolean;
  branch?: string;
  remoteName?: string;
  remoteUrl?: string;
  upstream?: string;
  dirty: boolean;
  syncStatus: string;
  ahead: number;
  behind: number;
  changedFileCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  totalAddedLines: number;
  totalDeletedLines: number;
}

export interface SubagentBuildHandoffBundle {
  workspaceAgentId: string;
  workspaceRelativePath: string;
  baselineId?: string;
  baselineCapturedAt?: string;
  baselineFileCount?: number;
  baselineTotalBytes?: number;
  baselineAvailable?: boolean;
  baselineUnavailableReason?: string;
  diffMode?: 'none' | 'git' | 'synthetic';
  diffAvailable?: boolean;
  diffSummary?: string;
  changedFiles?: SubagentBuildHandoffChangedFile[];
  patchExcerpt?: string;
  patchTruncated?: boolean;
  gitSummary?: SubagentBuildHandoffGitSummary;
  generatedAt?: string;
  reason?: string;
}

export interface SubagentRunRecord {
  runId: string;
  childTaskId: string;
  childSessionKey: string;
  sessionId?: string;
  sessionState?: SubagentSessionState;
  parentTaskId: string;
  parentRunId?: string;
  parentSessionKey?: string;
  parentAgentId: string;
  childAgentId: string;
  persistentKey?: string;
  label?: string;
  task: string;
  lastPrompt?: string;
  depth: number;
  mode: SubagentSpawnMode;
  reuseCount?: number;
  status: SubagentRunStatus;
  resultStatus?: SubagentRunResultStatus;
  error?: string;
  finalReport?: string;
  finalReportTruncated?: boolean;
  progressEvents?: SubagentProgressEvent[];
  supervisor?: SubagentSupervisorState;
  expectedOutputs?: SubagentExpectedOutput[];
  resultBundle?: SubagentResultBundle;
  recoveryHistory?: SubagentRecoveryHistoryEntry[];
  replacesRunId?: string;
  replacedByRunId?: string;
  replacementReason?: string;
  model?: SelectedModel | null;
  executionPolicy?: SubagentExecutionPolicy;
  inheritedContext?: SubagentInheritedContext;
  sharedContext?: SubagentSharedContext;
  buildHandoff?: SubagentBuildHandoffBundle;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastResumedAt?: string;
  archivedAt?: string;
  closedAt?: string;
}

export interface SubagentRunDetail extends SubagentRunRecord {
  childTaskSummary?: string;
  childTaskStatus?: string;
}

export interface SubagentRunTreeNode extends SubagentRunDetail {
  children: SubagentRunTreeNode[];
}

export interface SubagentSpawnRequest {
  targetAgentId?: string;
  task: string;
  label?: string;
  runTimeoutMs?: number;
  model?: SelectedModel | null;
  mode?: SubagentSpawnMode;
  reuseExistingSession?: boolean;
  expectedOutputs?: SubagentExpectedOutput[];
  buildHandoff?: SubagentBuildHandoffBundle;
  replacesRunId?: string;
  replacementReason?: string;
  parentTaskId?: string;
  parentRunId?: string;
}

export interface SubagentSpawnResult {
  status: 'accepted' | 'forbidden' | 'error';
  runId?: string;
  childTaskId?: string;
  childSessionKey?: string;
  reusedExistingSession?: boolean;
  error?: string;
  targetAgentId?: string;
  availableTargets?: Array<{
    id: string;
    name: string;
    roleName?: string;
  }>;
}

export interface SubagentListResponse {
  runs: SubagentRunDetail[];
  tree: SubagentRunTreeNode[];
  activeCount: number;
}

export interface SubagentWaitResult {
  completed: boolean;
  waitedMs: number;
  run: SubagentRunDetail | null;
  recommendedAction?: SubagentSupervisorRecommendedAction;
}

export interface SubagentWaitManyResult {
  completed: boolean;
  waitedMs: number;
  runs: SubagentRunDetail[];
  completedRuns: SubagentRunDetail[];
  pendingRuns: SubagentRunDetail[];
  staleRuns: SubagentRunDetail[];
  stuckRuns: SubagentRunDetail[];
  failedRuns: SubagentRunDetail[];
  recommendedAction: SubagentSupervisorRecommendedAction;
}
