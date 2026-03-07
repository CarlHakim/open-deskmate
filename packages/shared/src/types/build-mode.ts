export type BuildStudioMode = 'chat' | 'build';

export type BuildProjectCategory = 'web' | 'backend' | 'desktop' | 'node' | 'generic';

export type BuildPreviewStrategy = 'iframe' | 'logs-only' | 'external-window';

export type BuildRuntimeStatus = 'stopped' | 'starting' | 'running' | 'error';

export type BuildExecutionMode = 'dev' | 'run';

export type BuildBuildStatus = 'unknown' | 'success' | 'failed';
export type BuildDiffEnforcementMode = 'auto-apply' | 'preview-only' | 'approval';

export interface BuildRuntimeCommands {
  startCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
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
  commands: {
    startCommand?: string;
    buildCommand?: string;
    runCommand?: string;
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
  commands?: {
    startCommand?: string;
    buildCommand?: string;
    runCommand?: string;
  };
  envProfiles?: BuildEnvProfile[];
  activeEnvProfileId?: string;
}

export interface BuildProjectPresetListResult {
  presets: BuildProjectPreset[];
  activePresetId?: string;
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
