import { create } from 'zustand';
import type {
  Task,
  TaskConfig,
  TaskStatus,
  TaskUpdateEvent,
  PermissionRequest,
  PermissionResponse,
  TaskMessage,
  TaskActivityEvent,
} from '@accomplish/shared';
import { getAccomplish } from '../lib/accomplish';
import { useAgentStore } from './agentStore';

// Batch update event type for performance optimization
interface TaskUpdateBatchEvent {
  taskId: string;
  messages: TaskMessage[];
}

// Setup progress event type
interface SetupProgressEvent {
  taskId: string;
  stage: string;
  message?: string;
}

interface TaskState {
  // Current task
  currentTask: Task | null;
  isLoading: boolean;
  error: string | null;

  // Task history
  tasks: Task[];

  // Permission handling
  permissionRequest: PermissionRequest | null;

  // Setup progress (e.g., browser download)
  setupProgress: string | null;
  setupProgressTaskId: string | null;
  setupDownloadStep: number; // 1=Chromium, 2=FFMPEG, 3=Headless Shell

  // Task launcher
  isLauncherOpen: boolean;
  openLauncher: () => void;
  closeLauncher: () => void;

  // Actions
  startTask: (config: TaskConfig) => Promise<Task | null>;
  setSetupProgress: (taskId: string | null, message: string | null) => void;
  sendFollowUp: (message: string, attachedFiles?: string[], usageProjectId?: string | null) => Promise<void>;
  setTaskUsageProject: (taskId: string, usageProjectId: string | null) => Promise<void>;
  cancelTask: () => Promise<void>;
  interruptTask: () => Promise<void>;
  setPermissionRequest: (request: PermissionRequest | null) => void;
  respondToPermission: (response: PermissionResponse) => Promise<void>;
  addTaskUpdate: (event: TaskUpdateEvent) => void;
  addTaskActivity: (event: TaskActivityEvent) => void;
  addTaskUpdateBatch: (event: TaskUpdateBatchEvent) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  setTaskSummary: (taskId: string, summary: string) => void;
  insertTask: (task: Task) => void;
  loadTasks: () => Promise<void>;
  loadTaskById: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  clearCurrentTask: () => void;
  clearHistory: () => Promise<void>;
  reset: () => void;
  // Folder management
  setTaskFolder: (taskId: string, folderId: string | null) => void;
  getTasksByFolder: (folderId: string | null) => Task[];
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const DELETED_TASK_TTL_MS = 30_000;
const deletedTaskIds = new Set<string>();

// Cache for folder assignments (synced with main process via IPC)
let folderAssignmentsCache: Record<string, string> = {};
const taskUsageProjectAssignmentSeq = new Map<string, number>();

function markTaskDeleted(taskId: string): void {
  deletedTaskIds.add(taskId);
  setTimeout(() => {
    deletedTaskIds.delete(taskId);
  }, DELETED_TASK_TTL_MS);
}

function unmarkTaskDeleted(taskId: string): void {
  deletedTaskIds.delete(taskId);
}

function isKnownTask(taskId: string, currentTaskId: string | null, tasks: Task[]): boolean {
  if (currentTaskId === taskId) return true;
  return tasks.some((t) => t.id === taskId);
}

// Read folder assignments from cache (sync, returns cached data)
function readFolderAssignments(): Record<string, string> {
  return folderAssignmentsCache;
}

// Load folder assignments from main process via IPC
async function loadFolderAssignmentsFromIPC(): Promise<Record<string, string>> {
  if (typeof window === 'undefined' || !window.accomplish) {
    return {};
  }
  try {
    const assignments = await window.accomplish.getTaskFolderAssignments();
    folderAssignmentsCache = assignments || {};
    return folderAssignmentsCache;
  } catch (err) {
    console.warn('Failed to load task folder assignments via IPC:', err);
    return {};
  }
}

// Assign task to folder via IPC (async)
async function assignTaskToFolderIPC(taskId: string, folderId: string | null): Promise<void> {
  if (typeof window === 'undefined' || !window.accomplish) {
    return;
  }
  try {
    const result = await window.accomplish.assignTaskToFolder(taskId, folderId);
    // Update cache
    if (folderId) {
      folderAssignmentsCache[taskId] = folderId;
    } else {
      delete folderAssignmentsCache[taskId];
    }
    if (result && Object.prototype.hasOwnProperty.call(result, 'usageProjectId')) {
      const usageProjectId = result.usageProjectId ?? null;
      useTaskStore.setState((state) => ({
        tasks: state.tasks.map((task) => (
          task.id === taskId ? { ...task, usageProjectId } : task
        )),
        currentTask: state.currentTask?.id === taskId
          ? { ...state.currentTask, usageProjectId }
          : state.currentTask,
      }));
    }
  } catch (err) {
    console.warn('Failed to assign task to folder via IPC:', err);
  }
}

async function assignTaskToUsageProjectIPC(taskId: string, usageProjectId: string | null): Promise<string | null> {
  if (typeof window === 'undefined' || !window.accomplish) {
    return usageProjectId;
  }
  const result = await window.accomplish.assignTaskToUsageProject(taskId, usageProjectId);
  return result?.usageProjectId ?? usageProjectId;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  currentTask: null,
  isLoading: false,
  error: null,
  tasks: [],
  permissionRequest: null,
  setupProgress: null,
  setupProgressTaskId: null,
  setupDownloadStep: 1,
  isLauncherOpen: false,

  setSetupProgress: (taskId: string | null, message: string | null) => {
    // Detect which package is being downloaded from the message
    let step = useTaskStore.getState().setupDownloadStep;
    if (message) {
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes('downloading chromium headless')) {
        step = 3;
      } else if (lowerMsg.includes('downloading ffmpeg')) {
        step = 2;
      } else if (lowerMsg.includes('downloading chromium')) {
        step = 1;
      }
    }
    set({ setupProgress: message, setupProgressTaskId: taskId, setupDownloadStep: step });
  },

  startTask: async (config: TaskConfig) => {
    const accomplish = getAccomplish();
    const agentId = config.agentId ?? useAgentStore.getState().activeAgentId;
    const finalConfig = { ...config, agentId };
    const optimisticTaskId = finalConfig.taskId;
    if (optimisticTaskId) {
      const now = new Date().toISOString();
      const optimisticTask: Task = {
        id: optimisticTaskId,
        prompt: finalConfig.prompt,
        agentId,
        status: 'queued',
        messages: [{
          id: `optimistic_${createMessageId()}`,
          type: 'user',
          content: finalConfig.prompt,
          timestamp: now,
        }],
        createdAt: now,
        workingDirectory: finalConfig.workingDirectory,
        attachedFiles: finalConfig.attachedFiles,
        privacyMode: finalConfig.privacyMode ?? 'normal',
        usageProjectId: finalConfig.usageProjectId ?? null,
        hiddenFromHistory: finalConfig.hiddenFromHistory,
        parentTaskId: finalConfig.parentTaskId,
      };
      set((state) => ({
        currentTask: state.currentTask?.id === optimisticTaskId ? state.currentTask : optimisticTask,
        tasks: [optimisticTask, ...state.tasks.filter((task) => task.id !== optimisticTaskId)],
        isLoading: true,
        error: null,
      }));
    } else {
      set({ isLoading: true, error: null });
    }
    try {
      void accomplish.logEvent({
        level: 'info',
        message: 'UI start task',
        context: { prompt: config.prompt, taskId: config.taskId, agentId },
      });
      const task = await accomplish.startTask(finalConfig);
      const existingCurrent = get().currentTask;
      const existingMessages = existingCurrent?.id === task.id
        ? existingCurrent.messages.filter((message) => !(
          message.id.startsWith('optimistic_')
          && task.messages.some((incoming) => (
            incoming.type === message.type
            && String(incoming.content || '').trim() === String(message.content || '').trim()
          ))
        ))
        : [];
      const mergedMessages = existingCurrent?.id === task.id
        ? [...existingMessages, ...task.messages]
        : task.messages;
      const nextTask = existingCurrent?.id === task.id
        ? { ...task, messages: mergedMessages }
        : task;
      // Task might be 'running' or 'queued' depending on if another task is running
      // Also add to tasks list so sidebar updates immediately
      const currentTasks = get().tasks;
      set({
        currentTask: nextTask,
        tasks: [nextTask, ...currentTasks.filter((t) => t.id !== nextTask.id)],
        // Keep loading state if queued (waiting for queue)
        isLoading: nextTask.status === 'queued',
      });
      void accomplish.logEvent({
        level: 'info',
        message: nextTask.status === 'queued' ? 'UI task queued' : 'UI task started',
        context: { taskId: nextTask.id, status: nextTask.status },
      });
      return nextTask;
    } catch (err) {
      set({
        currentTask: optimisticTaskId && get().currentTask?.id === optimisticTaskId ? null : get().currentTask,
        tasks: optimisticTaskId ? get().tasks.filter((task) => task.id !== optimisticTaskId) : get().tasks,
        error: err instanceof Error ? err.message : 'Failed to start task',
        isLoading: false,
      });
      void accomplish.logEvent({
        level: 'error',
        message: 'UI task start failed',
        context: { error: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }
  },

  sendFollowUp: async (message: string, attachedFiles?: string[], usageProjectId?: string | null) => {
    const accomplish = getAccomplish();
    const { currentTask, startTask } = get();
    if (!currentTask) {
      set({ error: 'No active task to continue' });
      void accomplish.logEvent({
        level: 'warn',
        message: 'UI follow-up failed: no active task',
      });
      return;
    }

    const rawSessionId = currentTask.result?.sessionId || currentTask.sessionId;
    const sessionId = typeof rawSessionId === 'string' && rawSessionId.startsWith('ses')
      ? rawSessionId
      : null;

    const nextUsageProjectId = usageProjectId !== undefined ? usageProjectId : currentTask.usageProjectId ?? null;

    // If no session but task was interrupted, start a fresh task with the new message
    if (!sessionId && currentTask.status === 'interrupted') {
      void accomplish.logEvent({
        level: 'info',
        message: 'UI follow-up: starting fresh task (no session from interrupted task)',
        context: { taskId: currentTask.id },
      });
      await startTask({
        prompt: message,
        attachedFiles,
        privacyMode: currentTask.privacyMode ?? 'normal',
        usageProjectId: nextUsageProjectId,
      });
      return;
    }

    if (!sessionId) {
      set({ error: 'No session to continue - please start a new task' });
      void accomplish.logEvent({
        level: 'warn',
        message: 'UI follow-up failed: missing session',
        context: { taskId: currentTask.id },
      });
      return;
    }

    const userMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    // Optimistically add user message and set status to running
    const taskId = currentTask.id;
    set((state) => ({
      isLoading: true,
      error: null,
      currentTask: state.currentTask
        ? {
            ...state.currentTask,
            status: 'running',
            result: undefined,
            usageProjectId: nextUsageProjectId,
            messages: [...state.currentTask.messages, userMessage],
          }
        : null,
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'running' as TaskStatus, usageProjectId: nextUsageProjectId } : t
      ),
    }));

    try {
      void accomplish.logEvent({
        level: 'info',
        message: 'UI follow-up sent',
        context: { taskId: currentTask.id, message },
      });
      const task = await accomplish.resumeSession(
        sessionId,
        message,
        currentTask.id,
        attachedFiles,
        currentTask.privacyMode ?? 'normal',
        nextUsageProjectId
      );

      // Update status based on response (could be 'running' or 'queued')
      set((state) => ({
        currentTask: state.currentTask
          ? { ...state.currentTask, status: task.status, usageProjectId: task.usageProjectId ?? nextUsageProjectId }
          : null,
        isLoading: task.status === 'queued',
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, status: task.status, usageProjectId: task.usageProjectId ?? nextUsageProjectId } : t
        ),
      }));
    } catch (err) {
      set((state) => ({
        error: err instanceof Error ? err.message : 'Failed to send message',
        isLoading: false,
        currentTask: state.currentTask
          ? { ...state.currentTask, status: 'failed' }
          : null,
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, status: 'failed' as TaskStatus } : t
        ),
      }));
      void accomplish.logEvent({
        level: 'error',
        message: 'UI follow-up failed',
        context: { taskId: currentTask.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  },

  setTaskUsageProject: async (taskId: string, usageProjectId: string | null) => {
    const nextUsageProjectId = usageProjectId || null;
    const sequence = (taskUsageProjectAssignmentSeq.get(taskId) ?? 0) + 1;
    taskUsageProjectAssignmentSeq.set(taskId, sequence);
    const previousUsageProjectId = get().currentTask?.id === taskId
      ? get().currentTask?.usageProjectId ?? null
      : get().tasks.find((task) => task.id === taskId)?.usageProjectId ?? null;

    const applyUsageProject = (projectId: string | null) => {
      set((state) => ({
        tasks: state.tasks.map((task) => (
          task.id === taskId ? { ...task, usageProjectId: projectId } : task
        )),
        currentTask: state.currentTask?.id === taskId
          ? { ...state.currentTask, usageProjectId: projectId }
          : state.currentTask,
      }));
    };

    applyUsageProject(nextUsageProjectId);

    try {
      const savedUsageProjectId = await assignTaskToUsageProjectIPC(taskId, nextUsageProjectId);
      if (taskUsageProjectAssignmentSeq.get(taskId) === sequence) {
        applyUsageProject(savedUsageProjectId);
        set({ error: null });
      }
    } catch (err) {
      if (taskUsageProjectAssignmentSeq.get(taskId) === sequence) {
        applyUsageProject(previousUsageProjectId);
        set({ error: err instanceof Error ? err.message : 'Failed to save task budget project' });
      }
      throw err;
    }
  },

  cancelTask: async () => {
    const accomplish = getAccomplish();
    const { currentTask } = get();
    if (currentTask) {
      void accomplish.logEvent({
        level: 'info',
        message: 'UI cancel task',
        context: { taskId: currentTask.id },
      });
      await accomplish.cancelTask(currentTask.id);
      set((state) => ({
        currentTask: state.currentTask
          ? { ...state.currentTask, status: 'cancelled' }
          : null,
        tasks: state.tasks.map((t) =>
          t.id === currentTask.id ? { ...t, status: 'cancelled' as TaskStatus } : t
        ),
      }));
    }
  },

  interruptTask: async () => {
    const accomplish = getAccomplish();
    const { currentTask } = get();
    if (currentTask && (currentTask.status === 'running' || currentTask.status === 'queued')) {
      void accomplish.logEvent({
        level: 'info',
        message: 'UI interrupt task',
        context: { taskId: currentTask.id },
      });
      await accomplish.interruptTask(currentTask.id);
      set((state) => ({
        currentTask: state.currentTask
          ? { ...state.currentTask, status: 'interrupted', completedAt: new Date().toISOString() }
          : null,
        isLoading: false,
        tasks: state.tasks.map((t) =>
          t.id === currentTask.id ? { ...t, status: 'interrupted' as TaskStatus, completedAt: new Date().toISOString() } : t
        ),
      }));
    }
  },

  setPermissionRequest: (request) => {
    set({ permissionRequest: request });
  },

  respondToPermission: async (response: PermissionResponse) => {
    const accomplish = getAccomplish();
    void accomplish.logEvent({
      level: 'info',
      message: 'UI permission response',
      context: { ...response },
    });
    await accomplish.respondToPermission(response);
    set({ permissionRequest: null });
  },

  addTaskUpdate: (event: TaskUpdateEvent) => {
    const { currentTask, tasks } = get();
    if (deletedTaskIds.has(event.taskId)) {
      return;
    }
    if (!isKnownTask(event.taskId, currentTask?.id ?? null, tasks)) {
      return;
    }

    const accomplish = getAccomplish();
    set((state) => {
      if (deletedTaskIds.has(event.taskId)) {
        return state;
      }
      if (!isKnownTask(event.taskId, state.currentTask?.id ?? null, state.tasks)) {
        return state;
      }

      void accomplish.logEvent({
        level: 'debug',
        message: 'UI task update received',
        context: { ...event },
      });

      // Determine if this event is for the currently viewed task
      const isCurrentTask = state.currentTask?.id === event.taskId;

      // Start with current state
      let updatedCurrentTask = state.currentTask;
      let updatedTasks = state.tasks;
      let newStatus: TaskStatus | null = null;

      // Handle message events - only if viewing this task
      if (event.type === 'message' && event.message && isCurrentTask && state.currentTask) {
        updatedCurrentTask = {
          ...state.currentTask,
          messages: [...state.currentTask.messages, event.message],
        };
      }

      if (event.type === 'activity' && event.activity) {
        const appendActivity = (task: Task): Task => {
          const activity = task.activity || [];
          if (activity.some((item) => item.id === event.activity?.id)) return task;
          return {
            ...task,
            activity: [...activity, event.activity!].slice(-120),
          };
        };
        if (isCurrentTask && state.currentTask) {
          updatedCurrentTask = appendActivity(state.currentTask);
        }
        updatedTasks = state.tasks.map((task) => task.id === event.taskId ? appendActivity(task) : task);
      }

      // Handle complete events
      if (event.type === 'complete' && event.result) {
        // Map result status to task status
        if (event.result.status === 'success') {
          newStatus = 'completed';
        } else if (event.result.status === 'interrupted') {
          newStatus = 'interrupted';
        } else {
          newStatus = 'failed';
        }

        // Update currentTask if viewing this task
        if (isCurrentTask && state.currentTask) {
          updatedCurrentTask = {
            ...state.currentTask,
            status: newStatus,
            result: event.result,
            // Don't set completedAt for interrupted tasks - they can continue
            completedAt: newStatus === 'interrupted' ? undefined : new Date().toISOString(),
            sessionId: event.result.sessionId || state.currentTask.sessionId,
          };
        }
      }

      // Handle error events
      if (event.type === 'error') {
        newStatus = 'failed';

        // Update currentTask if viewing this task
        if (isCurrentTask && state.currentTask) {
          updatedCurrentTask = {
            ...state.currentTask,
            status: newStatus,
            result: { status: 'error', error: event.error },
          };
        }
      }

      // Always update sidebar tasks list if status changed
      if (newStatus) {
        const finalStatus = newStatus;
        updatedTasks = state.tasks.map((t) =>
          t.id === event.taskId ? { ...t, status: finalStatus } : t
        );
      }

      return {
        currentTask: updatedCurrentTask,
        tasks: updatedTasks,
        isLoading: false,
      };
    });
  },

  addTaskActivity: (event: TaskActivityEvent) => {
    const { currentTask, tasks } = get();
    if (deletedTaskIds.has(event.taskId)) {
      return;
    }
    if (!isKnownTask(event.taskId, currentTask?.id ?? null, tasks)) {
      return;
    }

    set((state) => {
      if (deletedTaskIds.has(event.taskId)) {
        return state;
      }
      if (!isKnownTask(event.taskId, state.currentTask?.id ?? null, state.tasks)) {
        return state;
      }

      const mergeActivity = (task: Task): Task => {
        const activity = task.activity || [];
        if (activity.some((item) => item.id === event.id)) return task;
        return {
          ...task,
          activity: [...activity, event]
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
            .slice(-120),
        };
      };

      return {
        currentTask: state.currentTask?.id === event.taskId
          ? mergeActivity(state.currentTask)
          : state.currentTask,
        tasks: state.tasks.map((task) => task.id === event.taskId ? mergeActivity(task) : task),
      };
    });
  },

  // Batch update handler for performance - processes multiple messages in single state update
  addTaskUpdateBatch: (event: TaskUpdateBatchEvent) => {
    const { currentTask, tasks } = get();
    if (deletedTaskIds.has(event.taskId)) {
      return;
    }
    if (!isKnownTask(event.taskId, currentTask?.id ?? null, tasks)) {
      return;
    }

    const accomplish = getAccomplish();
    set((state) => {
      if (deletedTaskIds.has(event.taskId)) {
        return state;
      }
      if (!isKnownTask(event.taskId, state.currentTask?.id ?? null, state.tasks)) {
        return state;
      }

      void accomplish.logEvent({
        level: 'debug',
        message: 'UI task batch update received',
        context: { taskId: event.taskId, messageCount: event.messages.length },
      });

      if (!state.currentTask || state.currentTask.id !== event.taskId) {
        return state;
      }

      // Add all messages in a single state update
      const updatedTask = {
        ...state.currentTask,
        messages: [...state.currentTask.messages, ...event.messages],
      };

      return { currentTask: updatedTask, isLoading: false };
    });
  },

  // Update task status (e.g., queued -> running)
  updateTaskStatus: (taskId: string, status: TaskStatus) => {
    const { currentTask, tasks } = get();
    if (deletedTaskIds.has(taskId)) {
      return;
    }
    if (!isKnownTask(taskId, currentTask?.id ?? null, tasks)) {
      return;
    }

    set((state) => {
      if (deletedTaskIds.has(taskId)) {
        return state;
      }
      if (!isKnownTask(taskId, state.currentTask?.id ?? null, state.tasks)) {
        return state;
      }

      // Update in tasks list
      const updatedTasks = state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status, updatedAt: new Date().toISOString() }
          : task
      );

      // Update currentTask if it matches
      const updatedCurrentTask =
        state.currentTask?.id === taskId
          ? { ...state.currentTask, status, updatedAt: new Date().toISOString() }
          : state.currentTask;

      return {
        tasks: updatedTasks,
        currentTask: updatedCurrentTask,
      };
    });
  },

  // Update task summary (AI-generated)
  setTaskSummary: (taskId: string, summary: string) => {
    const { currentTask, tasks } = get();
    if (deletedTaskIds.has(taskId)) {
      return;
    }
    if (!isKnownTask(taskId, currentTask?.id ?? null, tasks)) {
      return;
    }

    set((state) => {
      if (deletedTaskIds.has(taskId)) {
        return state;
      }
      if (!isKnownTask(taskId, state.currentTask?.id ?? null, state.tasks)) {
        return state;
      }

      // Update in tasks list
      const updatedTasks = state.tasks.map((task) =>
        task.id === taskId ? { ...task, summary } : task
      );

      // Update currentTask if it matches
      const updatedCurrentTask =
        state.currentTask?.id === taskId
          ? { ...state.currentTask, summary }
          : state.currentTask;

      return {
        tasks: updatedTasks,
        currentTask: updatedCurrentTask,
      };
    });
  },

  insertTask: (task: Task) => {
    if (task.hiddenFromHistory) {
      return;
    }
    set((state) => {
      const filtered = state.tasks.filter((t) => t.id !== task.id);
      return {
        tasks: [task, ...filtered],
      };
    });
  },

  loadTasks: async () => {
    const accomplish = getAccomplish();
    const agentId = useAgentStore.getState().activeAgentId;
    // Load tasks and folder assignments in parallel
    const [tasks, folderAssignments] = await Promise.all([
      accomplish.listTasks(agentId),
      loadFolderAssignmentsFromIPC(),
    ]);
    // Apply folder assignments from main process
    const tasksWithFolders = tasks.map((task) => ({
      ...task,
      folderId: folderAssignments[task.id] || task.folderId,
    }));
    for (const task of tasksWithFolders) {
      deletedTaskIds.delete(task.id);
    }
    set({ tasks: tasksWithFolders });
  },

  loadTaskById: async (taskId: string) => {
    const accomplish = getAccomplish();
    const agentId = useAgentStore.getState().activeAgentId;
    const task = await accomplish.getTask(taskId, agentId);
    set((state) => {
      if (task) {
        return { currentTask: task, error: null };
      }
      if (state.currentTask?.id === taskId) {
        return { currentTask: state.currentTask, error: null };
      }
      return { currentTask: null, error: 'Task not found' };
    });
  },

  deleteTask: async (taskId: string) => {
    const accomplish = getAccomplish();
    markTaskDeleted(taskId);
    set((state) => {
      const isCurrentTask = state.currentTask?.id === taskId;
      const isSetupTask = state.setupProgressTaskId === taskId;
      return {
        tasks: state.tasks.filter((t) => t.id !== taskId),
        currentTask: isCurrentTask ? null : state.currentTask,
        error: isCurrentTask ? null : state.error,
        isLoading: isCurrentTask ? false : state.isLoading,
        permissionRequest: isCurrentTask ? null : state.permissionRequest,
        setupProgress: isSetupTask ? null : state.setupProgress,
        setupProgressTaskId: isSetupTask ? null : state.setupProgressTaskId,
      };
    });

    // Clean up any folder assignment for the deleted task via IPC
    if (folderAssignmentsCache[taskId]) {
      assignTaskToFolderIPC(taskId, null);
    }

    try {
      await accomplish.deleteTask(taskId);
    } catch (err) {
      console.error('Task deletion failed, refreshing task list:', err);
      try {
        const agentId = useAgentStore.getState().activeAgentId;
        const tasks = await accomplish.listTasks(agentId);
        const folderAssignments = readFolderAssignments();
        const tasksWithFolders = tasks.map((task) => ({
          ...task,
          folderId: folderAssignments[task.id] || task.folderId,
        }));
        set({ tasks: tasksWithFolders });
        unmarkTaskDeleted(taskId);
      } catch (refreshErr) {
        console.error('Failed to refresh tasks after delete failure:', refreshErr);
      }
    }
  },

  clearCurrentTask: () => {
    set({
      currentTask: null,
      isLoading: false,
      error: null,
      permissionRequest: null,
      setupProgress: null,
      setupProgressTaskId: null,
      setupDownloadStep: 1,
      isLauncherOpen: false,
    });
  },

  clearHistory: async () => {
    const accomplish = getAccomplish();
    const agentId = useAgentStore.getState().activeAgentId;
    await accomplish.clearTaskHistory(agentId);
    deletedTaskIds.clear();
    set({ tasks: [] });
  },

  reset: () => {
    set({
      currentTask: null,
      isLoading: false,
      error: null,
      permissionRequest: null,
      setupProgress: null,
      setupProgressTaskId: null,
      setupDownloadStep: 1,
      isLauncherOpen: false,
    });
  },

  openLauncher: () => set({ isLauncherOpen: true }),
  closeLauncher: () => set({ isLauncherOpen: false }),

  // Set a task's folder (null to remove from folder)
  setTaskFolder: (taskId: string, folderId: string | null) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, folderId: folderId ?? undefined } : task
      ),
      currentTask:
        state.currentTask?.id === taskId
          ? { ...state.currentTask, folderId: folderId ?? undefined }
          : state.currentTask,
    }));
    // Persist the folder assignment via IPC to main process
    assignTaskToFolderIPC(taskId, folderId);
  },

  // Get tasks by folder ID (null for unfiled tasks)
  getTasksByFolder: (folderId: string | null) => {
    const { tasks } = get();
    if (folderId === null) {
      return tasks.filter((task) => !task.folderId);
    }
    return tasks.filter((task) => task.folderId === folderId);
  },
}));

// Global subscription to setup progress events (browser download, etc.)
// This runs when the module is loaded to catch early progress events
if (typeof window !== 'undefined' && window.accomplish) {
  window.accomplish.onTaskProgress((progress: unknown) => {
    const event = progress as SetupProgressEvent;
    if (event.message) {
      // Clear progress if installation completed
      if (event.message.toLowerCase().includes('installed successfully')) {
        useTaskStore.getState().setSetupProgress(null, null);
      } else {
        useTaskStore.getState().setSetupProgress(event.taskId, event.message);
      }
    }
  });

  // Clear progress when task completes or errors (not on messages - download continues during messages)
  window.accomplish.onTaskUpdate((event: unknown) => {
    const updateEvent = event as TaskUpdateEvent;
    if (updateEvent.type === 'complete' || updateEvent.type === 'error') {
      const state = useTaskStore.getState();
      if (state.setupProgressTaskId === updateEvent.taskId) {
        state.setSetupProgress(null, null);
      }
    }
  });

  // Subscribe to task summary updates
  window.accomplish.onTaskSummary?.(( data: { taskId: string; summary: string }) => {
    useTaskStore.getState().setTaskSummary(data.taskId, data.summary);
  });
}
