import Store from 'electron-store';
import fs from 'fs';
import type { Task, TaskActivityEvent, TaskMessage, TaskStatus } from '@accomplish/shared';
import { getDefaultAgentId } from './agents';

/**
 * Task entry stored in history
 */
export interface StoredTask {
  id: string;
  prompt: string;
  agentId?: string;
  /** AI-generated short summary of the task (displayed in history) */
  summary?: string;
  status: TaskStatus;
  messages: TaskMessage[];
  activity?: TaskActivityEvent[];
  sessionId?: string;
  sessionFilePath?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  memoryFlushAt?: string;
  memoryFlushCount?: number;
  sessionMemorySavedAt?: string;
  workingDirectory?: string;
  attachedFiles?: string[];
  privacyMode?: 'normal' | 'incognito';
  usageProjectId?: string | null;
  hiddenFromHistory?: boolean;
  parentTaskId?: string;
  miniMaxHistoricalImageSessionResetAt?: string;
}

interface TaskHistorySchema {
  tasks: StoredTask[];
  maxHistoryItems: number;
}

const taskHistoryStore = new Store<TaskHistorySchema>({
  name: 'task-history',
  defaults: {
    tasks: [],
    maxHistoryItems: 100,
  },
});

const PERSIST_DEBOUNCE_MS = 250;
const MAX_TASK_ACTIVITY_EVENTS = 120;
const INCOGNITO_TTL_MS = Number(process.env.OPENDESKMATE_INCOGNITO_TTL_MS || 30 * 60 * 1000);
let pendingTasks: StoredTask[] | null = null;
let persistTimeout: NodeJS.Timeout | null = null;
const incognitoTasks = new Map<string, { task: StoredTask; expiresAt: number; timer?: NodeJS.Timeout }>();

function scheduleIncognitoTaskExpiry(taskId: string): void {
  const entry = incognitoTasks.get(taskId);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  const delay = Math.max(5_000, entry.expiresAt - Date.now());
  const timer = setTimeout(() => {
    incognitoTasks.delete(taskId);
  }, delay);
  timer.unref?.();
  entry.timer = timer;
  incognitoTasks.set(taskId, entry);
}

function pruneIncognitoTasks(now = Date.now()): void {
  for (const [taskId, entry] of incognitoTasks.entries()) {
    if (entry.expiresAt <= now) {
      if (entry.timer) clearTimeout(entry.timer);
      incognitoTasks.delete(taskId);
    }
  }
}

function touchIncognitoTask(taskId: string): void {
  const entry = incognitoTasks.get(taskId);
  if (!entry) return;
  entry.expiresAt = Date.now() + INCOGNITO_TTL_MS;
  incognitoTasks.set(taskId, entry);
  scheduleIncognitoTaskExpiry(taskId);
}

function mergePersistentAndIncognito(tasks: StoredTask[]): StoredTask[] {
  pruneIncognitoTasks();
  if (incognitoTasks.size === 0) return tasks;
  const incognitoList = Array.from(incognitoTasks.values()).map((entry) => entry.task);
  return [...incognitoList, ...tasks]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getCurrentTasks(): StoredTask[] {
  if (pendingTasks) {
    return pendingTasks;
  }
  const tasks = taskHistoryStore.get('tasks') ?? [];
  let mutated = false;
  const defaultAgentId = getDefaultAgentId();
  const hydrated = tasks.map((task) => {
    if (!task.agentId) {
      mutated = true;
      return { ...task, agentId: defaultAgentId };
    }
    return task;
  });
  if (mutated) {
    taskHistoryStore.set('tasks', hydrated);
  }
  return hydrated;
}

function schedulePersist(tasks: StoredTask[]): void {
  pendingTasks = tasks;
  if (persistTimeout) {
    return;
  }
  persistTimeout = setTimeout(() => {
    if (pendingTasks) {
      taskHistoryStore.set('tasks', pendingTasks);
      pendingTasks = null;
    }
    persistTimeout = null;
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Immediately flush any pending task history writes to disk.
 * Call this on app shutdown (e.g., 'before-quit' event) to prevent data loss.
 */
export function flushPendingTasks(): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  if (pendingTasks) {
    taskHistoryStore.set('tasks', pendingTasks);
    pendingTasks = null;
  }
}

/**
 * On startup, if the app previously crashed or was force-closed, tasks may remain
 * persisted as "running"/"queued" even though there is no active OpenCode process.
 *
 * This function reconciles those stale statuses so the UI doesn't get stuck showing
 * an "Agent is working..." state that can't be stopped.
 */
export function reconcileStaleTasksOnStartup(): { interrupted: number; cancelled: number } {
  const tasks = taskHistoryStore.get('tasks') ?? [];
  let interrupted = 0;
  let cancelled = 0;
  let changed = false;

  const next = tasks.map((task) => {
    if (task.status === 'running') {
      changed = true;
      interrupted += 1;
      return { ...task, status: 'interrupted' as TaskStatus, completedAt: undefined };
    }
    if (task.status === 'queued') {
      changed = true;
      cancelled += 1;
      // Queued tasks cannot survive restarts; mark as cancelled.
      return { ...task, status: 'cancelled' as TaskStatus, completedAt: new Date().toISOString() };
    }
    return task;
  });

  if (changed) {
    // Write immediately (do not debounce) so the renderer sees the corrected state on first load.
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    pendingTasks = null;
    taskHistoryStore.set('tasks', next);
  }

  return { interrupted, cancelled };
}

/**
 * Get all tasks from history
 */
export function getTasks(agentId?: string): StoredTask[] {
  const tasks = mergePersistentAndIncognito(getCurrentTasks()).filter((task) => !task.hiddenFromHistory);
  if (!agentId) {
    return tasks;
  }
  return tasks.filter((task) => task.agentId === agentId);
}

export function getLatestTask(agentId?: string): StoredTask | undefined {
  const tasks = getTasks(agentId);
  if (tasks.length === 0) return undefined;
  return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Get a specific task by ID
 */
export function getTask(taskId: string, agentId?: string): StoredTask | undefined {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId)?.task;
  if (incognito) {
    if (agentId && incognito.agentId !== agentId) return undefined;
    touchIncognitoTask(taskId);
    return incognito;
  }
  const tasks = getCurrentTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return undefined;
  if (agentId && task.agentId !== agentId) return undefined;
  return task;
}

/**
 * Save a new task to history
 */
export function saveTask(task: Task): void {
  const privacyMode = task.privacyMode || 'normal';
  if (privacyMode === 'incognito') {
    const storedTask: StoredTask = {
      id: task.id,
      prompt: task.prompt,
      agentId: task.agentId,
      summary: task.summary,
      status: task.status,
      messages: task.messages || [],
      activity: task.activity || [],
      sessionId: task.sessionId,
      sessionFilePath: (task as Task & { sessionFilePath?: string }).sessionFilePath,
      sessionMemorySavedAt: (task as Task & { sessionMemorySavedAt?: string }).sessionMemorySavedAt,
      workingDirectory: task.workingDirectory,
      attachedFiles: task.attachedFiles,
      usageProjectId: task.usageProjectId,
      miniMaxHistoricalImageSessionResetAt: task.miniMaxHistoricalImageSessionResetAt,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      privacyMode,
      hiddenFromHistory: task.hiddenFromHistory,
      parentTaskId: task.parentTaskId,
    };
    const previous = incognitoTasks.get(task.id)?.task;
    if (previous) {
      const mergedMessages = [...previous.messages];
      for (const msg of storedTask.messages) {
        if (!mergedMessages.some((m) => m.id === msg.id)) {
          mergedMessages.push(msg);
        }
      }
      storedTask.messages = mergedMessages;
      const mergedActivity = [...(previous.activity || [])];
      for (const event of storedTask.activity || []) {
        if (!mergedActivity.some((activity) => activity.id === event.id)) {
          mergedActivity.push(event);
        }
      }
      storedTask.activity = mergedActivity.slice(-MAX_TASK_ACTIVITY_EVENTS);
      storedTask.createdAt = previous.createdAt;
      storedTask.startedAt = previous.startedAt ?? storedTask.startedAt;
      storedTask.miniMaxHistoricalImageSessionResetAt =
        storedTask.miniMaxHistoricalImageSessionResetAt ?? previous.miniMaxHistoricalImageSessionResetAt;
    }
    incognitoTasks.set(task.id, {
      task: storedTask,
      expiresAt: Date.now() + INCOGNITO_TTL_MS,
    });
    scheduleIncognitoTaskExpiry(task.id);
    return;
  }

  const tasks = getCurrentTasks();
  const maxItems = taskHistoryStore.get('maxHistoryItems');

  const storedTask: StoredTask = {
    id: task.id,
    prompt: task.prompt,
    agentId: task.agentId,
    summary: task.summary,
    status: task.status,
    messages: task.messages || [],
    activity: task.activity || [],
    sessionId: task.sessionId,
    sessionFilePath: (task as Task & { sessionFilePath?: string }).sessionFilePath,
    sessionMemorySavedAt: (task as Task & { sessionMemorySavedAt?: string }).sessionMemorySavedAt,
    workingDirectory: task.workingDirectory,
    attachedFiles: task.attachedFiles,
    privacyMode,
    usageProjectId: task.usageProjectId,
    miniMaxHistoricalImageSessionResetAt: task.miniMaxHistoricalImageSessionResetAt,
    hiddenFromHistory: task.hiddenFromHistory,
    parentTaskId: task.parentTaskId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };

  // Check if task already exists (update it)
  const existingIndex = tasks.findIndex((t) => t.id === task.id);
  if (existingIndex >= 0) {
    const existing = tasks[existingIndex];
    const mergedMessages = [...existing.messages];
    for (const msg of storedTask.messages) {
      if (!mergedMessages.some((m) => m.id === msg.id)) {
        mergedMessages.push(msg);
      }
    }
    tasks[existingIndex] = {
      ...storedTask,
      messages: mergedMessages,
      activity: mergeTaskActivity(existing.activity, storedTask.activity),
      miniMaxHistoricalImageSessionResetAt: storedTask.miniMaxHistoricalImageSessionResetAt ?? existing.miniMaxHistoricalImageSessionResetAt,
      createdAt: existing.createdAt,
      startedAt: existing.startedAt ?? storedTask.startedAt,
      completedAt: storedTask.completedAt,
    };
  } else {
    // Add new task at the beginning
    tasks.unshift(storedTask);
  }

  // Limit history size
  if (tasks.length > maxItems) {
    tasks.splice(maxItems);
  }

  schedulePersist([...tasks]);
}

function mergeTaskActivity(
  existing: TaskActivityEvent[] | undefined,
  incoming: TaskActivityEvent[] | undefined
): TaskActivityEvent[] {
  const merged = [...(existing || [])];
  for (const event of incoming || []) {
    if (!merged.some((activity) => activity.id === event.id)) {
      merged.push(event);
    }
  }
  return merged
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_TASK_ACTIVITY_EVENTS);
}

export function addTaskActivity(taskId: string, activity: TaskActivityEvent): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    const next = mergeTaskActivity(incognito.task.activity, [activity]);
    incognito.task.activity = next;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex >= 0) {
    tasks[taskIndex].activity = mergeTaskActivity(tasks[taskIndex].activity, [activity]);
    schedulePersist([...tasks]);
  }
}

/**
 * Update a task's status
 */
export function updateTaskStatus(
  taskId: string,
  status: StoredTask['status'],
  completedAt?: string
): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.status = status;
    if (completedAt) {
      incognito.task.completedAt = completedAt;
    }
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex >= 0) {
    tasks[taskIndex].status = status;
    if (completedAt) {
      tasks[taskIndex].completedAt = completedAt;
    }
    schedulePersist([...tasks]);
  }
}

/**
 * Add a message to a task
 */
export function addTaskMessage(
  taskId: string,
  message: TaskMessage,
  options?: { skipSessionLog?: boolean; sessionLogContent?: string }
): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.messages.push(message);
    const sessionFilePath = incognito.task.sessionFilePath;
    if (sessionFilePath && (message.type === 'user' || message.type === 'assistant')) {
      if (!options?.skipSessionLog) {
        const content = (options?.sessionLogContent ?? message.content ?? '').trimEnd();
        if (content.trim() && !content.trim().startsWith('/')) {
          const payload = {
            type: 'message',
            message: {
              role: message.type,
              content,
            },
          };
          try {
            fs.appendFileSync(sessionFilePath, `${JSON.stringify(payload)}\n`, 'utf-8');
          } catch (error) {
            console.warn('[TaskHistory] Failed to append incognito session log:', error);
          }
        }
      }
    }
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex >= 0) {
    tasks[taskIndex].messages.push(message);
    const sessionFilePath = tasks[taskIndex].sessionFilePath;
    if (sessionFilePath && (message.type === 'user' || message.type === 'assistant')) {
      if (!options?.skipSessionLog) {
        const content = (options?.sessionLogContent ?? message.content ?? '').trimEnd();
        if (content.trim() && !content.trim().startsWith('/')) {
          const payload = {
            type: 'message',
            message: {
              role: message.type,
              content,
            },
          };
          try {
            fs.appendFileSync(sessionFilePath, `${JSON.stringify(payload)}\n`, 'utf-8');
          } catch (error) {
            console.warn('[TaskHistory] Failed to append session log:', error);
          }
        }
      }
    }
    schedulePersist([...tasks]);
  }
}

/**
 * Update task's session ID
 */
export function updateTaskSessionId(taskId: string, sessionId: string): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.sessionId = sessionId;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex >= 0) {
    tasks[taskIndex].sessionId = sessionId;
    schedulePersist([...tasks]);
  }
}

export function updateTaskSessionFilePath(taskId: string, sessionFilePath: string): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.sessionFilePath = sessionFilePath;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex >= 0) {
    tasks[taskIndex].sessionFilePath = sessionFilePath;
    schedulePersist([...tasks]);
  }
}

/**
 * Update task's AI-generated summary
 */
export function updateTaskSummary(taskId: string, summary: string): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.summary = summary;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex >= 0) {
    tasks[taskIndex].summary = summary;
    schedulePersist([...tasks]);
  }
}

export function updateTaskSessionMemorySaved(taskId: string, timestamp: string): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.sessionMemorySavedAt = timestamp;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex >= 0) {
    tasks[taskIndex].sessionMemorySavedAt = timestamp;
    schedulePersist([...tasks]);
  }
}

export function markTaskMiniMaxHistoricalImageSessionReset(taskId: string, timestamp: string): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.miniMaxHistoricalImageSessionResetAt = timestamp;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex >= 0) {
    tasks[taskIndex].miniMaxHistoricalImageSessionResetAt = timestamp;
    schedulePersist([...tasks]);
  }
}

export function updateTaskMemoryFlush(taskId: string, payload: { memoryFlushAt: string; memoryFlushCount: number }): void {
  pruneIncognitoTasks();
  const incognito = incognitoTasks.get(taskId);
  if (incognito) {
    incognito.task.memoryFlushAt = payload.memoryFlushAt;
    incognito.task.memoryFlushCount = payload.memoryFlushCount;
    touchIncognitoTask(taskId);
    return;
  }

  const tasks = getCurrentTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex >= 0) {
    tasks[taskIndex].memoryFlushAt = payload.memoryFlushAt;
    tasks[taskIndex].memoryFlushCount = payload.memoryFlushCount;
    schedulePersist([...tasks]);
  }
}

export function updateTasksUsageProject(taskIds: string[], usageProjectId: string | null): number {
  const ids = new Set(taskIds.map((taskId) => String(taskId || '').trim()).filter(Boolean));
  if (ids.size === 0) return 0;

  pruneIncognitoTasks();
  let changed = 0;
  for (const taskId of ids) {
    const incognito = incognitoTasks.get(taskId);
    if (incognito && (incognito.task.usageProjectId ?? null) !== usageProjectId) {
      incognito.task.usageProjectId = usageProjectId;
      touchIncognitoTask(taskId);
      changed += 1;
    }
  }

  const tasks = getCurrentTasks();
  let persistentChanged = false;
  const next = tasks.map((task) => {
    if (!ids.has(task.id) || (task.usageProjectId ?? null) === usageProjectId) {
      return task;
    }
    persistentChanged = true;
    changed += 1;
    return { ...task, usageProjectId };
  });

  if (persistentChanged) {
    schedulePersist(next);
  }
  return changed;
}

/**
 * Delete a task from history
 */
export function deleteTask(taskId: string): void {
  const entry = incognitoTasks.get(taskId);
  if (entry?.timer) {
    clearTimeout(entry.timer);
  }
  incognitoTasks.delete(taskId);
  const tasks = getCurrentTasks();
  const filteredTasks = tasks.filter((t) => t.id !== taskId);
  schedulePersist(filteredTasks);
}

/**
 * Clear all task history
 */
export function clearHistory(agentId?: string): void {
  if (!agentId) {
    for (const entry of incognitoTasks.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    incognitoTasks.clear();
  } else {
    for (const [taskId, entry] of incognitoTasks.entries()) {
      if (entry.task.agentId === agentId) {
        if (entry.timer) clearTimeout(entry.timer);
        incognitoTasks.delete(taskId);
      }
    }
  }
  if (!agentId) {
    schedulePersist([]);
    return;
  }
  const tasks = getCurrentTasks();
  schedulePersist(tasks.filter((task) => task.agentId !== agentId));
}

/**
 * Set maximum history items
 */
export function setMaxHistoryItems(max: number): void {
  taskHistoryStore.set('maxHistoryItems', max);

  // Trim existing history if needed
  const tasks = getCurrentTasks();
  if (tasks.length > max) {
    tasks.splice(max);
    schedulePersist([...tasks]);
  }
}

/**
 * Clear all task history data (reset store to defaults)
 * Used during fresh install cleanup
 */
export function clearTaskHistoryStore(): void {
  // Clear any pending writes
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  pendingTasks = null;

  // Clear the store (resets to defaults)
  taskHistoryStore.clear();
  for (const entry of incognitoTasks.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  incognitoTasks.clear();
}
