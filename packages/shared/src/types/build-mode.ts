export type BuildStudioMode = 'chat' | 'build';

export type BuildProjectCategory = 'web' | 'backend' | 'desktop' | 'node' | 'generic';

export type BuildPreviewStrategy = 'iframe' | 'logs-only' | 'external-window';

export type BuildRuntimeStatus = 'stopped' | 'starting' | 'running' | 'error';

export type BuildExecutionMode = 'dev' | 'run';

export type BuildBuildStatus = 'unknown' | 'success' | 'failed';
export type BuildDiffEnforcementMode = 'auto-apply' | 'preview-only' | 'approval';

export type BuildStartEntryRole = 'preview' | 'worker';

export interface BuildStartEntry {
  command: string;
  workspaceRelativePath?: string;
  role?: BuildStartEntryRole;
}

export interface BuildRuntimeCommands {
  startCommand: string | null;
  startEntries?: BuildStartEntry[];
  buildCommand: string | null;
  runCommand: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  typecheckCommand?: string | null;
}

export interface BuildProjectDetection {
  runtimeAdapterId: string;
  projectType: string;
  category: BuildProjectCategory;
  previewStrategy: BuildPreviewStrategy;
  confidence: number;
  evidence: string[];
  packageManager: 'pnpm' | 'npm' | 'yarn';
  commands: BuildRuntimeCommands;
  requiresPort: boolean;
  defaultPort?: number;
  healthCheckPath?: string;
}

export interface BuildRuntimeState {
  status: BuildRuntimeStatus;
  mode: BuildExecutionMode;
  buildStatus: BuildBuildStatus;
  activeCommand?: string;
  activeStartEntries?: BuildStartEntry[];
  pid?: number;
  port?: number;
  previewUrl?: string;
  startedAt?: string;
  stoppedAt?: string;
  lastExitCode?: number | null;
  lastExitSignal?: string | null;
  restartCount: number;
  crashCount: number;
  autoRestart: boolean;
  healthy?: boolean;
  healthMessage?: string;
  lastHealthCheckAt?: string;
  lastError?: string;
  suggestedRepairPrompt?: string;
  autoRepairRequestedAt?: string;
}

export interface BuildLogEntry {
  seq: number;
  at: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}

export interface BuildSessionSnapshot {
  agentId: string;
  workspaceRoot: string;
  workspaceRelativePath: string;
  detection: BuildProjectDetection;
  runtime: BuildRuntimeState;
}

export interface BuildStartRequest {
  agentId: string;
  workspaceRelativePath?: string;
  mode?: BuildExecutionMode;
  commandOverride?: string;
  startEntries?: BuildStartEntry[];
  envOverrides?: Record<string, string>;
  autoRestart?: boolean;
  forceRestart?: boolean;
  portHint?: number;
}

export interface BuildBuildRequest {
  agentId: string;
  workspaceRelativePath?: string;
  commandOverride?: string;
  envOverrides?: Record<string, string>;
}

export interface BuildLogsResponse {
  logs: BuildLogEntry[];
  nextCursor: number;
}

export interface BuildRuntimeCommandResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  command: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: string;
}

export interface BuildFileTreeNode {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  children?: BuildFileTreeNode[];
}

export interface BuildWorkspaceFileContent {
  relativePath: string;
  content: string;
  encoding: 'utf8';
  size: number;
  modifiedAt: string;
}

export interface BuildWorkspaceDiff {
  available: boolean;
  summary: string;
  patch: string;
  truncated: boolean;
  mode?: 'none' | 'git' | 'synthetic';
  baselineId?: string;
  files?: BuildWorkspaceDiffFile[];
  needsApproval?: boolean;
}

export interface BuildWorkspaceDiffFile {
  relativePath: string;
  changeType: 'added' | 'modified' | 'deleted';
  beforeContent?: string;
  afterContent?: string;
  beforeTruncated?: boolean;
  afterTruncated?: boolean;
}

export interface BuildWorkspaceDiffFileContent {
  relativePath: string;
  beforeContent?: string;
  afterContent?: string;
  beforeAvailable: boolean;
  afterAvailable: boolean;
  beforeUnavailableReason?: string;
  afterUnavailableReason?: string;
  beforeSize?: number;
  afterSize?: number;
  baselineId?: string;
}

export type BuildGitChangedFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'unknown';

export interface BuildGitChangedFile {
  relativePath: string;
  status: BuildGitChangedFileStatus;
  indexStatus: string;
  workingTreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  addedLines: number;
  deletedLines: number;
}

export interface BuildGitToolStatus {
  available: boolean;
  version?: string;
  authenticated?: boolean;
  detail?: string;
  error?: string;
}

export interface BuildGitBranch {
  name: string;
  current: boolean;
  upstream?: string;
  remote?: boolean;
}

export interface BuildGitMismatchCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author?: string;
  date?: string;
}

export type BuildGitInProgressOperation = 'none' | 'merge' | 'rebase';

export interface BuildGitConflictHunk {
  id: string;
  startLine: number;
  endLine: number;
  localLabel: string;
  remoteLabel: string;
  localContent: string;
  remoteContent: string;
}

export interface BuildGitConflictFile {
  relativePath: string;
  status: BuildGitChangedFileStatus;
  hunks: BuildGitConflictHunk[];
  contentPreview?: string;
}

export interface BuildGitStageInput {
  paths: string[];
}

export interface BuildGitStashEntry {
  ref: string;
  hash?: string;
  message: string;
  date?: string;
}

export interface BuildGitRemoteRepositoryCreateInput {
  provider: BuildGitRemoteProvider;
  remoteName?: string;
  repositoryName?: string;
  visibility?: 'private' | 'public';
}

export interface BuildGitRemoteRepositoryCreateResult {
  ok: boolean;
  provider: BuildGitRemoteProvider;
  message: string;
  remoteUrl?: string;
  manualSteps?: string[];
  stdout?: string;
  stderr?: string;
  summary?: BuildGitSummary;
}

export interface BuildGitPullRequestCreateInput {
  provider?: BuildGitRemoteProvider;
  title: string;
  body?: string;
  baseBranch?: string;
  headBranch?: string;
  draft?: boolean;
}

export interface BuildGitPullRequestCreateResult {
  ok: boolean;
  provider: BuildGitRemoteProvider;
  message: string;
  url?: string;
  manualSteps?: string[];
  stdout?: string;
  stderr?: string;
}

export interface BuildGitBackupBranch {
  name: string;
  shortCommit?: string;
  subject?: string;
  createdAt?: string;
}

export interface BuildGitReflogEntry {
  hash: string;
  shortHash: string;
  selector?: string;
  author?: string;
  date?: string;
  message: string;
}

export interface BuildGitMismatchSummary {
  generatedAt: string;
  workspaceRoot: string;
  workspaceRelativePath: string;
  available: boolean;
  isRepository: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  syncStatus: BuildGitSyncStatus;
  syncDetail: string;
  hasLocalChanges: boolean;
  conflictedCount: number;
  inProgressOperation: BuildGitInProgressOperation;
  localCommits: BuildGitMismatchCommit[];
  remoteCommits: BuildGitMismatchCommit[];
  mergeBase?: string;
  mergeBaseShort?: string;
  conflictFiles: BuildGitConflictFile[];
  backupBranches: BuildGitBackupBranch[];
  reflog: BuildGitReflogEntry[];
  backupBranchName?: string;
  canMerge: boolean;
  canRebase: boolean;
  canResetToRemote: boolean;
  canForcePush: boolean;
  guidance: string[];
  summary: BuildGitSummary;
}

export type BuildGitResolveMismatchAction =
  | 'backup'
  | 'merge'
  | 'rebase'
  | 'reset-to-remote'
  | 'force-push'
  | 'abort-merge'
  | 'abort-rebase'
  | 'continue-rebase';

export interface BuildGitResolveMismatchInput {
  action: BuildGitResolveMismatchAction;
  createBackup?: boolean;
  backupBranchName?: string;
}

export type BuildGitNextActionKind =
  | 'none'
  | 'install-git'
  | 'init'
  | 'review'
  | 'commit'
  | 'push'
  | 'fetch'
  | 'pull'
  | 'set-upstream'
  | 'add-remote';

export interface BuildGitNextAction {
  kind: BuildGitNextActionKind;
  label: string;
  detail: string;
  disabled?: boolean;
  warnings?: string[];
}

export type BuildGitSyncStatus =
  | 'not-configured'
  | 'up-to-date'
  | 'ahead'
  | 'behind'
  | 'diverged'
  | 'remote-changed'
  | 'unknown';

export type BuildGitAuthStatus =
  | 'not-required'
  | 'configured'
  | 'unknown'
  | 'missing'
  | 'failed';

export type BuildGitAuthMethod =
  | 'ssh'
  | 'credential-helper'
  | 'github-cli'
  | 'environment'
  | 'none'
  | 'unknown';

export type BuildGitActionErrorKind =
  | 'auth'
  | 'remote'
  | 'network'
  | 'branch'
  | 'unknown';

export interface BuildGitSummary {
  generatedAt: string;
  workspaceRoot: string;
  workspaceRelativePath: string;
  available: boolean;
  isRepository: boolean;
  git: BuildGitToolStatus;
  githubCli: BuildGitToolStatus;
  branch?: string;
  commit?: string;
  shortCommit?: string;
  remoteName?: string;
  remoteUrl?: string;
  remoteProvider?: BuildGitRemoteProvider;
  repositoryHost?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryWebUrl?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  syncStatus: BuildGitSyncStatus;
  syncDetail: string;
  authStatus: BuildGitAuthStatus;
  authMethod?: BuildGitAuthMethod;
  authDetail: string;
  authSetupHints: string[];
  branches: BuildGitBranch[];
  conflictedCount: number;
  dirty: boolean;
  hasChanges: boolean;
  changedFileCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  totalAddedLines: number;
  totalDeletedLines: number;
  files: BuildGitChangedFile[];
  nextAction: BuildGitNextAction;
}

export interface BuildGitActionResult {
  ok: boolean;
  action:
    | 'init'
    | 'commit'
    | 'push'
    | 'add-remote'
    | 'update-remote'
    | 'fetch'
    | 'pull'
    | 'switch-branch'
    | 'create-branch'
    | 'discard'
    | 'resolve-mismatch'
    | 'stage-files'
    | 'finish-merge'
    | 'stash-create'
    | 'stash-apply'
    | 'stash-drop'
    | 'checkout-remote'
    | 'restore-backup';
  message: string;
  stdout?: string;
  stderr?: string;
  errorKind?: BuildGitActionErrorKind;
  hints?: string[];
  summary?: BuildGitSummary;
}

export type BuildGitRemoteProvider = 'github' | 'gitlab' | 'bitbucket' | 'custom';

export interface BuildGitRemoteInput {
  provider?: BuildGitRemoteProvider;
  remoteName: string;
  remoteUrl: string;
}

export interface BuildWorkspaceBaselineCaptureResult {
  baselineId: string;
  capturedAt: string;
  fileCount: number;
  totalBytes: number;
}

export type BuildWorkspaceBaselineDecision = 'approve' | 'reject';

export interface BuildWorkspaceBaselineResolveResult {
  ok: boolean;
  baselineId: string;
  decision: BuildWorkspaceBaselineDecision;
  restoredFiles?: number;
  deletedFiles?: number;
  message?: string;
}

export interface BuildWorkspaceFingerprint {
  workspaceRoot: string;
  workspaceRelativePath: string;
  generatedAt: string;
  packageName?: string;
  packageVersion?: string;
  git: {
    available: boolean;
    branch?: string;
    commit?: string;
    shortCommit?: string;
    dirty?: boolean;
  };
  next: {
    isNextProject: boolean;
    buildDirExists: boolean;
    buildId?: string;
  };
}

export interface BuildEnvProfile {
  id: string;
  name: string;
  variables: Record<string, string>;
}

export interface BuildProjectPreset {
  id: string;
  agentId: string;
  name: string;
  workspaceRelativePath: string;
  usageProjectId?: string | null;
  /**
   * People assigned to this Build preset.
   * null/undefined inherits from the assigned budget; [] explicitly means no assignees.
   */
  assigneeIds?: string[] | null;
  commands: {
    startCommand?: string;
    startEntries?: BuildStartEntry[];
    buildCommand?: string;
    runCommand?: string;
    testCommand?: string;
    lintCommand?: string;
    typecheckCommand?: string;
  };
  envProfiles: BuildEnvProfile[];
  activeEnvProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuildProjectPresetInput {
  id?: string;
  agentId: string;
  name: string;
  workspaceRelativePath: string;
  usageProjectId?: string | null;
  assigneeIds?: string[] | null;
  commands?: {
    startCommand?: string;
    startEntries?: BuildStartEntry[];
    buildCommand?: string;
    runCommand?: string;
    testCommand?: string;
    lintCommand?: string;
    typecheckCommand?: string;
  };
  envProfiles?: BuildEnvProfile[];
  activeEnvProfileId?: string;
}

export interface BuildProjectPresetListResult {
  presets: BuildProjectPreset[];
  activePresetId?: string;
}

export type BuildQualityCheckKind =
  | 'typecheck'
  | 'lint'
  | 'test'
  | 'build'
  | 'runtime-health'
  | 'preview';

export type BuildQualityCheckStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped';

export interface BuildQualityCheckResult {
  kind: BuildQualityCheckKind;
  label: string;
  status: BuildQualityCheckStatus;
  command?: string;
  exitCode?: number | null;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary: string;
  output?: string;
  artifactPath?: string;
  artifactLabel?: string;
}

export interface BuildQualityCheckRun {
  id: string;
  agentId: string;
  workspaceRoot: string;
  workspaceRelativePath: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  checks: BuildQualityCheckResult[];
  startedAt: string;
  completedAt?: string;
  diffSignature?: string;
  changedFileCount?: number;
  trigger?: 'manual' | 'suggested';
}

export interface BuildQualityCheckRunRequest {
  agentId: string;
  workspaceRelativePath?: string;
  kinds?: BuildQualityCheckKind[];
  commandOverrides?: Partial<Record<BuildQualityCheckKind, string>>;
  diffSignature?: string;
  changedFileCount?: number;
  trigger?: 'manual' | 'suggested';
}

export interface BuildRuntimeToolError {
  ok: false;
  error: string;
  detail?: string;
  recoverable?: boolean;
}

export interface BuildRuntimeToolStatus {
  ok: true;
  snapshot: BuildSessionSnapshot;
  previewUrl?: string;
  recommendedNextAction: string;
}

export interface BuildRuntimeLogsResult {
  ok: true;
  logs: BuildLogEntry[];
  nextCursor: number;
  truncated: boolean;
}

export interface BuildRuntimeScreenshotResult {
  ok: true;
  filePath: string;
  previewUrl: string;
  width: number;
  height: number;
  fullWidth?: number;
  fullHeight?: number;
  clipped?: boolean;
  kind: 'visible' | 'full-page';
}

export interface BuildPageSnapshotElement {
  tagName: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  selector: string;
  visible: boolean;
  disabled: boolean;
}

export interface BuildPageSnapshotResult {
  ok: true;
  previewUrl: string;
  title: string;
  url: string;
  elements: BuildPageSnapshotElement[];
  consoleErrors: string[];
}

export type BuildUiInteractionAction =
  | { type: 'click'; selector?: string; text?: string; label?: string; role?: string; exact?: boolean; nth?: number }
  | { type: 'type'; selector?: string; text?: string; label?: string; role?: string; exact?: boolean; nth?: number; value: string }
  | { type: 'press_key'; key: string; modifiers?: Array<'Control' | 'Ctrl' | 'Meta' | 'Command' | 'Cmd' | 'Shift' | 'Alt'> }
  | { type: 'expect_text'; text: string }
  | { type: 'wait'; ms?: number };

export interface BuildUiInteractionMatchedElement {
  selector: string;
  tagName: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
}

export interface BuildUiInteractionTestResult {
  ok: true;
  previewUrl: string;
  steps: Array<{
    action: BuildUiInteractionAction['type'];
    ok: boolean;
    detail: string;
    matchedElement?: BuildUiInteractionMatchedElement;
    candidates?: BuildUiInteractionMatchedElement[];
  }>;
  beforeScreenshotPath?: string;
  afterScreenshotPath?: string;
  consoleErrors: string[];
}

export type BuildTerminalEntryKind = 'output' | 'system' | 'example';

export interface BuildTerminalEntry {
  seq: number;
  at: string;
  kind: BuildTerminalEntryKind;
  text: string;
}

export interface BuildTerminalSessionSummary {
  id: string;
  title: string;
  shellLabel: string;
  cwd: string;
  workspaceRelativePath: string;
  createdAt: string;
  updatedAt: string;
  running: boolean;
  pid: number | null;
}

export interface BuildTerminalSnapshot {
  agentId: string;
  activeSessionId: string | null;
  sessions: BuildTerminalSessionSummary[];
}

export interface BuildTerminalOutputResponse {
  entries: BuildTerminalEntry[];
  nextCursor: number;
}
