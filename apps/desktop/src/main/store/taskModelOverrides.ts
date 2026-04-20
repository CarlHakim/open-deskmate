import type { SelectedModel } from '@accomplish/shared';

const taskModelOverrides = new Map<string, SelectedModel>();

export function setTaskModelOverride(taskId: string, model: SelectedModel): void {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) return;
  taskModelOverrides.set(normalizedTaskId, model);
}

export function getTaskModelOverride(taskId?: string): SelectedModel | null {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) return null;
  return taskModelOverrides.get(normalizedTaskId) ?? null;
}

export function clearTaskModelOverride(taskId?: string): void {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) return;
  taskModelOverrides.delete(normalizedTaskId);
}
