// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getTask: vi.fn(),
  progress: undefined as ((event: { taskId: string }) => void) | undefined,
  status: undefined as ((event: { taskId: string; status: string }) => void) | undefined,
  offProgress: vi.fn(), offStatus: vi.fn(),
}));
vi.mock('../../../../src/renderer/lib/accomplish', () => ({ getAccomplish: () => ({
  getTask: api.getTask,
  onTaskProgress: (cb: typeof api.progress) => { api.progress = cb; return api.offProgress; },
  onTaskStatusChange: (cb: typeof api.status) => { api.status = cb; return api.offStatus; },
}) }));
import { useBuildTaskActivity } from '../../../../src/renderer/hooks/useBuildTaskActivity';
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); api.getTask.mockResolvedValue({ id: 'parent', status: 'completed' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('follows a resumed parent after completion and ignores other tasks', async () => {
  const active = vi.fn();
  renderHook(() => useBuildTaskActivity('parent', 'main', active));
  await act(async () => {});
  expect(active).not.toHaveBeenCalled();
  act(() => { api.progress?.({ taskId: 'child' }); api.status?.({ taskId: 'other', status: 'running' }); });
  expect(active).not.toHaveBeenCalled();
  act(() => api.progress?.({ taskId: 'parent' }));
  expect(active).toHaveBeenCalledOnce();
  act(() => api.status?.({ taskId: 'parent', status: 'completed' }));
  expect(active).toHaveBeenCalledOnce();
  act(() => api.status?.({ taskId: 'parent', status: 'queued' }));
  expect(active).toHaveBeenCalledTimes(2);
});

it('restores live task state and catches missed wake-up events', async () => {
  const task = { id: 'parent', status: 'running', sessionId: 'fresh' };
  api.getTask.mockResolvedValueOnce(task);
  const active = vi.fn();
  renderHook(() => useBuildTaskActivity('parent', 'main', active));
  await act(async () => {});
  expect(active).toHaveBeenCalledWith(task);
  api.getTask.mockResolvedValue(task);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(active).toHaveBeenCalledTimes(2);
});

it('discards an old task read after switching tasks and removes subscriptions', async () => {
  let resolve!: (task: unknown) => void;
  api.getTask.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const active = vi.fn();
  const { rerender, unmount } = renderHook(({ id }) => useBuildTaskActivity(id, 'main', active), { initialProps: { id: 'parent' } });
  rerender({ id: 'other' });
  await act(async () => resolve({ id: 'parent', status: 'running' }));
  expect(active).not.toHaveBeenCalled();
  unmount();
  expect(api.offProgress).toHaveBeenCalledTimes(2);
  expect(api.offStatus).toHaveBeenCalledTimes(2);
});
