import { getBuildTaskSession, listBuildTaskSessions, updateBuildTaskSession } from '../store/buildTaskHistory';
import { getTaskFolderAssignments } from '../store/folderStore';
import { updateTasksUsageProject } from '../store/taskHistory';
import { updateTaskTurnUsageProject } from '../store/tokenUsage';

export function assignUsageProjectToTasks(taskIds: string[], usageProjectId: string | null): {
  taskCount: number;
  turnCount: number;
} {
  const normalizedTaskIds = Array.from(new Set(
    taskIds.map((taskId) => String(taskId || '').trim()).filter(Boolean)
  ));
  return {
    taskCount: updateTasksUsageProject(normalizedTaskIds, usageProjectId),
    turnCount: updateTaskTurnUsageProject(normalizedTaskIds, usageProjectId),
  };
}

export function assignUsageProjectToFolderTasks(folderId: string, usageProjectId: string | null): {
  taskCount: number;
  turnCount: number;
  totalTaskIds: number;
} {
  const assignments = getTaskFolderAssignments();
  const taskIds = Object.entries(assignments)
    .filter(([, assignedFolderId]) => assignedFolderId === folderId)
    .map(([taskId]) => taskId);
  const result = assignUsageProjectToTasks(taskIds, usageProjectId);
  return { ...result, totalTaskIds: taskIds.length };
}

export function assignUsageProjectToBuildSessionTasks(sessionId: string, usageProjectId: string | null): {
  taskCount: number;
  turnCount: number;
  totalTaskIds: number;
} {
  const session = getBuildTaskSession(sessionId);
  const taskIds = (session?.runs || [])
    .map((run) => run.taskId)
    .filter((taskId): taskId is string => Boolean(taskId && taskId.trim()));
  const result = assignUsageProjectToTasks(taskIds, usageProjectId);
  return { ...result, totalTaskIds: taskIds.length };
}

export function assignUsageProjectToBuildPresetSessions(
  agentId: string,
  presetId: string,
  usageProjectId: string | null
): {
  sessionCount: number;
  taskCount: number;
  turnCount: number;
  totalSessions: number;
} {
  const sessions = listBuildTaskSessions({
    agentId,
    includeArchived: true,
    limit: 500,
  }).sessions.filter((session) => session.selectedPresetId === presetId);

  let sessionCount = 0;
  let taskCount = 0;
  let turnCount = 0;

  for (const session of sessions) {
    const fullSession = getBuildTaskSession(session.id);
    if (!fullSession) continue;
    if ((fullSession.execution.usageProjectId ?? null) !== usageProjectId) {
      updateBuildTaskSession({ sessionId: session.id, usageProjectId });
      sessionCount += 1;
    }
    const result = assignUsageProjectToBuildSessionTasks(session.id, usageProjectId);
    taskCount += result.taskCount;
    turnCount += result.turnCount;
  }

  return {
    sessionCount,
    taskCount,
    turnCount,
    totalSessions: sessions.length,
  };
}
