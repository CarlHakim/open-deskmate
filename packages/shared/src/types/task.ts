/**
 * Task-related types for execution management
 */

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface TaskConfig {
  /** The task prompt/description */
  prompt: string;
  /** Optional task ID to correlate events */
  taskId?: string;
  /** Optional agent identifier */
  agentId?: string;
  /** Working directory for Claude Code operations */
  workingDirectory?: string;
  /** List of allowed tools */
  allowedTools?: string[];
  /** System prompt to append */
  systemPromptAppend?: string;
  /** JSON schema for structured output */
  outputSchema?: object;
  /** Session ID for resuming */
  sessionId?: string;
  /** File paths attached by the user (text files are inlined, binary files referenced by path) */
  attachedFiles?: string[];
  /** Hint: task likely needs browser automation tooling */
  requiresBrowser?: boolean;
  /** Runtime speed preference for OpenCode model routing */
  speedMode?: 'fast' | 'balanced' | 'deep';
  /** Per-session/task privacy mode */
  privacyMode?: 'normal' | 'incognito';
  /** Optional manual usage project for per-project cost/token tracking. */
  usageProjectId?: string | null;
  /** Internal helper tasks such as subagents should not appear in normal task history. */
  hiddenFromHistory?: boolean;
  /** Parent task id when this task is a spawned helper/subagent. */
  parentTaskId?: string;
}

export interface Task {
  id: string;
  prompt: string;
  /** Agent identifier for this task */
  agentId?: string;
  /** AI-generated short summary of the task (displayed in history) */
  summary?: string;
  status: TaskStatus;
  sessionId?: string;
  messages: TaskMessage[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: TaskResult;
  /** Optional folder ID for organizing tasks */
  folderId?: string;
  /** Working directory used for the task run */
  workingDirectory?: string;
  /** File paths attached by the user or inherited into the task */
  attachedFiles?: string[];
  /** Per-session/task privacy mode */
  privacyMode?: 'normal' | 'incognito';
  /** Optional manual usage project for per-project cost/token tracking. */
  usageProjectId?: string | null;
  /** Internal helper tasks such as subagents should not appear in normal task history. */
  hiddenFromHistory?: boolean;
  /** Parent task id when this task is a spawned helper/subagent. */
  parentTaskId?: string;
  /** Internal MiniMax image-history reset boundary; not shown to users. */
  miniMaxHistoricalImageSessionResetAt?: string;
  /** Runtime activity timeline for visibility into model/tool/permission progress. */
  activity?: TaskActivityEvent[];
}

export type TaskActivityKind =
  | 'task_started'
  | 'assistant_message'
  | 'tool_started'
  | 'tool_finished'
  | 'permission_requested'
  | 'permission_resolved'
  | 'model_result'
  | 'stall_detected'
  | 'recovery_started'
  | 'task_finished';

export type TaskActivityStatus = 'pending' | 'running' | 'success' | 'warning' | 'error' | 'info';

export interface TaskActivityEvent {
  id: string;
  taskId: string;
  agentId?: string;
  kind: TaskActivityKind;
  title: string;
  detail?: string;
  timestamp: string;
  status?: TaskActivityStatus;
  toolName?: string;
  messageId?: string;
  recoverable?: boolean;
}

export interface TaskAttachment {
  type: 'screenshot' | 'json';
  data: string; // base64 for images, JSON string for data
  label?: string; // e.g., "Screenshot after clicking Submit"
}

export interface TaskMessage {
  id: string;
  type: 'assistant' | 'user' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  timestamp: string;
  /** Attachments like screenshots captured during browser automation */
  attachments?: TaskAttachment[];
}

export interface TaskResult {
  status: 'success' | 'error' | 'interrupted';
  sessionId?: string;
  durationMs?: number;
  error?: string;
}

export interface TaskProgress {
  taskId: string;
  stage: 'init' | 'thinking' | 'tool-use' | 'waiting' | 'complete';
  toolName?: string;
  toolInput?: unknown;
  percentage?: number;
  message?: string;
}

export interface TaskUpdateEvent {
  taskId: string;
  type: 'message' | 'progress' | 'complete' | 'error' | 'activity';
  message?: TaskMessage;
  activity?: TaskActivityEvent;
  progress?: TaskProgress;
  result?: TaskResult;
  error?: string;
}
