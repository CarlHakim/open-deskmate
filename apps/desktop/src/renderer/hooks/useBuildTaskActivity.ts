import { useEffect, useRef } from 'react';
import type { Task } from '@accomplish/shared';
import { getAccomplish } from '../lib/accomplish';

export function isBuildTaskActive(task: Pick<Task, 'status'>): boolean {
  return !['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status);
}

/** Keep following the parent when supervision resumes it after a completed turn. */
export function useBuildTaskActivity(
  taskId: string | null,
  agentId: string | null,
  onActive: (task?: Task) => void,
) {
  const callback = useRef(onActive);
  callback.current = onActive;
  useEffect(() => {
    if (!taskId) return;
    const api = getAccomplish();
    let cancelled = false;
    let checking = false;
    const reconcile = async () => {
      if (cancelled || checking || document.hidden) return;
      checking = true;
      try {
        const task = await api.getTask(taskId, agentId || undefined);
        if (!cancelled && task && isBuildTaskActive(task)) callback.current(task);
      } catch {
        // A later event or reconciliation will retry after an IPC failure.
      } finally {
        checking = false;
      }
    };
    const offProgress = api.onTaskProgress(event => {
      if (event.taskId === taskId) callback.current();
    });
    const offStatus = api.onTaskStatusChange?.(event => {
      if (event.taskId === taskId && isBuildTaskActive(event)) callback.current();
    });
    const onVisible = () => { void reconcile(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, 10000);
    void reconcile();
    return () => {
      cancelled = true;
      offProgress();
      offStatus?.();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [taskId, agentId]);
}
