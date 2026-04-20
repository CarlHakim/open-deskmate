import type { SelectedModel } from './provider';

export type SubagentRunStatus = 'accepted' | 'running' | 'done' | 'error';
export type SubagentRunResultStatus = 'success' | 'error' | 'interrupted';
export type SubagentSpawnMode = 'run' | 'session';
export type SubagentSessionState = 'pending' | 'ready' | 'missing';

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
  model?: SelectedModel | null;
  executionPolicy?: SubagentExecutionPolicy;
  inheritedContext?: SubagentInheritedContext;
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
  targetAgentId: string;
  task: string;
  label?: string;
  runTimeoutMs?: number;
  model?: SelectedModel | null;
  mode?: SubagentSpawnMode;
  reuseExistingSession?: boolean;
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
}
