import type {
  BuildLogEntry,
  BuildQualityCheckRun,
  BuildSessionSnapshot,
  BuildWorkspaceDiff,
  BuildWorkspaceFingerprint,
} from './build-mode';
import type { TaskMessage, TaskStatus } from './task';

export type BuildSessionLifecycleStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'archived';

export interface BuildSessionTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contextLimitTokens?: number;
  usedPct?: number;
  safeRemainingForReply?: number;
  updatedAt: string;
}

export interface BuildSessionRun {
  id: string;
  taskId?: string;
  sessionId?: string;
  status: TaskStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  tokenUsage?: BuildSessionTokenUsage;
}

export interface BuildSessionExecutionState {
  goalPrompt: string;
  workspaceRelativePath: string;
  selectedPresetId?: string | null;
  usageProjectId?: string | null;
  latestSnapshot?: BuildSessionSnapshot;
  latestDiff?: BuildWorkspaceDiff | null;
  latestFingerprint?: BuildWorkspaceFingerprint | null;
  latestQualityCheckRun?: BuildQualityCheckRun | null;
  runtimeLogs: BuildLogEntry[];
}

export interface BuildTaskSession {
  id: string;
  agentId: string;
  title: string;
  titleSourcePrompt: string;
  searchText: string;
  lifecycleStatus: BuildSessionLifecycleStatus;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  messages: TaskMessage[];
  runs: BuildSessionRun[];
  activeRunId?: string;
  execution: BuildSessionExecutionState;
  renamedByUser?: boolean;
  pinned?: boolean;
  pinnedAt?: string;
}

export interface BuildTaskHistoryStoreSchema {
  version: 1;
  sessionsById: Record<string, BuildTaskSession>;
  recentSessionIdsByAgent: Record<string, string[]>;
  archivedSessionIdsByAgent: Record<string, string[]>;
  settings: {
    maxSessionsPerAgent: number;
    maxLogsPerSession: number;
    maxMessagesPerSession: number;
  };
}

export interface BuildTaskSessionListItem {
  id: string;
  agentId: string;
  title: string;
  titleSourcePrompt: string;
  lifecycleStatus: BuildSessionLifecycleStatus;
  pinned?: boolean;
  tokenTotal?: number;
  workspaceRelativePath?: string;
  selectedPresetId?: string | null;
  usageProjectId?: string | null;
  runCount?: number;
  latestRunStatus?: TaskStatus;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface BuildTaskSessionListResult {
  sessions: BuildTaskSessionListItem[];
}

export interface BuildTaskHistoryListInput {
  agentId: string;
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface BuildTaskSessionCreateInput {
  agentId: string;
  title?: string;
  titleSourcePrompt: string;
  goalPrompt: string;
  workspaceRelativePath: string;
  selectedPresetId?: string | null;
  usageProjectId?: string | null;
}

export interface BuildTaskSessionUpdateInput {
  sessionId: string;
  lifecycleStatus?: BuildSessionLifecycleStatus;
  goalPrompt?: string;
  workspaceRelativePath?: string;
  selectedPresetId?: string | null;
  usageProjectId?: string | null;
  messages?: TaskMessage[];
  runtimeLogs?: BuildLogEntry[];
  latestSnapshot?: BuildSessionSnapshot;
  latestDiff?: BuildWorkspaceDiff | null;
  latestFingerprint?: BuildWorkspaceFingerprint | null;
  latestQualityCheckRun?: BuildQualityCheckRun | null;
  activeRun?: BuildSessionRun;
}

export interface BuildTaskSessionRenameInput {
  sessionId: string;
  title: string;
}

export interface BuildTaskSessionArchiveInput {
  sessionId: string;
  archived: boolean;
}

export interface BuildTaskSessionDeleteInput {
  sessionId: string;
}

export interface BuildTaskSessionPinInput {
  sessionId: string;
  pinned: boolean;
}
