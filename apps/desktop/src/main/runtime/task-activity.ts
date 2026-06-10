import type { TaskActivityEvent, TaskActivityKind, TaskActivityStatus, TaskMessage, TaskResult } from '@accomplish/shared';
import { addTaskActivity } from '../store/taskHistory';

const DETAIL_LIMIT = 360;

type EmitActivity = (event: TaskActivityEvent) => void;

export interface TaskActivityTrackerState {
  lastToolFinishedAt: number | null;
  lastAssistantAt: number | null;
  lastActivityAt: number | null;
  toolInProgress: boolean;
  waitingForPermission: boolean;
  stallEmittedForToolAt: number | null;
  lastToolOutputCanStandAlone: boolean;
}

export function createInitialTaskActivityTrackerState(): TaskActivityTrackerState {
  return {
    lastToolFinishedAt: null,
    lastAssistantAt: null,
    lastActivityAt: null,
    toolInProgress: false,
    waitingForPermission: false,
    stallEmittedForToolAt: null,
    lastToolOutputCanStandAlone: false,
  };
}

export function shouldDetectTaskStall(state: TaskActivityTrackerState): boolean {
  if (state.toolInProgress) return false;
  if (state.waitingForPermission) return false;
  if (state.lastToolOutputCanStandAlone) return false;
  if (!state.lastToolFinishedAt) return false;
  if (state.lastActivityAt && state.lastActivityAt > state.lastToolFinishedAt) return false;
  if (state.stallEmittedForToolAt === state.lastToolFinishedAt) return false;
  if (!state.lastAssistantAt) return true;
  return state.lastAssistantAt < state.lastToolFinishedAt;
}

export function markAssistantSeen(state: TaskActivityTrackerState, at = Date.now()): TaskActivityTrackerState {
  return {
    ...state,
    lastAssistantAt: at,
    lastActivityAt: at,
    toolInProgress: false,
  };
}

export function markToolStarted(state: TaskActivityTrackerState, at = Date.now()): TaskActivityTrackerState {
  return {
    ...state,
    lastActivityAt: at,
    toolInProgress: true,
  };
}

export function markToolFinished(
  state: TaskActivityTrackerState,
  at = Date.now(),
  lastToolOutputCanStandAlone = false
): TaskActivityTrackerState {
  return {
    ...state,
    lastToolFinishedAt: at,
    lastActivityAt: at,
    toolInProgress: false,
    lastToolOutputCanStandAlone,
  };
}

function createActivityId(kind: TaskActivityKind): string {
  return `act_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function truncateDetail(input: string | undefined): string | undefined {
  const trimmed = String(input || '').trim();
  if (!trimmed) return undefined;
  return trimmed.length > DETAIL_LIMIT ? `${trimmed.slice(0, DETAIL_LIMIT - 1)}...` : trimmed;
}

function isToolStartedMessage(message: TaskMessage): boolean {
  return message.type === 'tool' && /^Using tool:/i.test(message.content || '');
}

function looksLikeStandaloneToolAnswer(message: TaskMessage): boolean {
  const content = String(message.content || '').trim();
  if (!content || content.length < 120) return false;

  const lower = content.toLowerCase();
  if (
    lower === 'tool result'
    || /^tool\s+\S+\s+(completed|error)$/i.test(content)
    || /^exit code:?\s*\d+/i.test(content)
    || /^no output$/i.test(content)
    || /^timed out\b/i.test(content)
    || /^error\b/i.test(content)
  ) {
    return false;
  }

  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sentenceCount = (content.match(/[.!?](?:\s|$)/g) || []).length;
  const hasMarkdownTable = /\|\s*:?-{3,}:?\s*\|/.test(content);
  const hasListOrSections = lines.some((line) => /^[-*]\s+\S/.test(line) || /^#{1,4}\s+\S/.test(line));

  return hasMarkdownTable || hasListOrSections || lines.length >= 4 || sentenceCount >= 2;
}

export class TaskActivityRuntime {
  private state = createInitialTaskActivityTrackerState();
  private startedEmitted = false;

  constructor(
    private readonly params: {
      taskId: string;
      agentId?: string;
      emit: EmitActivity;
    }
  ) {}

  emitStarted(detail?: string): void {
    if (this.startedEmitted) return;
    this.startedEmitted = true;
    this.emit({
      kind: 'task_started',
      title: 'Task started',
      detail,
      status: 'running',
    });
  }

  recordTaskMessage(message: TaskMessage): void {
    this.emitStarted();

    if (message.type === 'assistant') {
      this.state = markAssistantSeen(this.state);
      this.emit({
        kind: 'assistant_message',
        title: 'Assistant responded',
        detail: truncateDetail(message.content),
        status: 'success',
        messageId: message.id,
      });
      return;
    }

    if (message.type !== 'tool') {
      return;
    }

    if (isToolStartedMessage(message)) {
      this.state = markToolStarted(this.state);
      this.emit({
        kind: 'tool_started',
        title: message.toolName ? `Tool started: ${message.toolName}` : 'Tool started',
        detail: truncateDetail(message.content),
        status: 'running',
        toolName: message.toolName,
        messageId: message.id,
      });
      return;
    }

    this.state = markToolFinished(this.state, Date.now(), looksLikeStandaloneToolAnswer(message));
    this.emit({
      kind: 'tool_finished',
      title: message.toolName ? `Tool finished: ${message.toolName}` : 'Tool finished',
      detail: truncateDetail(message.content),
      status: 'success',
      toolName: message.toolName,
      messageId: message.id,
    });
  }

  recordPermissionRequested(detail?: string): void {
    this.emitStarted();
    this.state = {
      ...this.state,
      lastActivityAt: Date.now(),
      toolInProgress: false,
      waitingForPermission: true,
    };
    this.emit({
      kind: 'permission_requested',
      title: 'Permission requested',
      detail: truncateDetail(detail),
      status: 'pending',
    });
  }

  recordPermissionResolved(detail?: string): void {
    this.state = {
      ...this.state,
      lastActivityAt: Date.now(),
      toolInProgress: false,
      waitingForPermission: false,
    };
    this.emit({
      kind: 'permission_resolved',
      title: 'Permission resolved',
      detail: truncateDetail(detail),
      status: 'success',
    });
  }

  recordRecoveryStarted(detail?: string): void {
    this.emit({
      kind: 'recovery_started',
      title: 'Recovery requested',
      detail: truncateDetail(detail),
      status: 'running',
    });
  }

  recordCompletion(result: TaskResult): void {
    if (result.status === 'success' && shouldDetectTaskStall(this.state)) {
      this.emitStall('Tool output arrived, but no final assistant answer followed before the task ended.');
    }
    const status: TaskActivityStatus = result.status === 'success'
      ? 'success'
      : result.status === 'interrupted'
        ? 'warning'
        : 'error';
    this.emit({
      kind: 'task_finished',
      title: result.status === 'success' ? 'Task finished' : result.status === 'interrupted' ? 'Task interrupted' : 'Task failed',
      detail: result.error,
      status,
      recoverable: result.status === 'error' ? true : undefined,
    });
  }

  recordError(error: Error): void {
    this.emit({
      kind: 'task_finished',
      title: 'Task failed',
      detail: error.message,
      status: 'error',
      recoverable: true,
    });
  }

  dispose(): void {
    // No timer-backed stall detection: recovery prompts are emitted only after
    // the task actually finishes without a final assistant answer.
  }

  private emitStall(detail: string): void {
    if (!shouldDetectTaskStall(this.state)) return;
    this.state = {
      ...this.state,
      stallEmittedForToolAt: this.state.lastToolFinishedAt,
    };
    this.emit({
      kind: 'stall_detected',
      title: 'Final answer missing',
      detail,
      status: 'warning',
      recoverable: true,
    });
  }

  private emit(input: Omit<TaskActivityEvent, 'id' | 'taskId' | 'agentId' | 'timestamp'>): void {
    const event: TaskActivityEvent = {
      id: createActivityId(input.kind),
      taskId: this.params.taskId,
      agentId: this.params.agentId,
      timestamp: new Date().toISOString(),
      ...input,
    };
    addTaskActivity(this.params.taskId, event);
    this.params.emit(event);
  }
}
