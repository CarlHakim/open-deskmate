// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const events = vi.hoisted(() => ({ listener: undefined as (() => void) | undefined, unsubscribe: vi.fn() }));
vi.mock('../../../../src/renderer/lib/accomplish', () => ({ getAccomplish: () => ({ onSubagentsChanged: (listener: () => void) => { events.listener = listener; return events.unsubscribe; } }) }));
import { useSubagentRefresh } from '../../../../src/renderer/hooks/useSubagentRefresh';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('coalesces updates, pauses while hidden, reconciles on visibility and unsubscribes', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let resolve!: () => void;
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done; })).mockResolvedValue(undefined);
  const { unmount } = renderHook(() => useSubagentRefresh(refresh, 'parent'));
  await act(async () => { events.listener?.(); events.listener?.(); });
  expect(refresh).toHaveBeenCalledOnce();
  await act(async () => resolve());
  expect(refresh).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(true);
  await act(async () => { events.listener?.(); await vi.advanceTimersByTimeAsync(30000); });
  expect(refresh).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(refresh).toHaveBeenCalledTimes(3);
  unmount();
  expect(events.unsubscribe).toHaveBeenCalledOnce();
});
