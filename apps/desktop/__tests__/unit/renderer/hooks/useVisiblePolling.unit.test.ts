// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisiblePolling } from '../../../../src/renderer/hooks/useVisiblePolling';

describe('visible panel polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not overlap slow refreshes and stops after unmount', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { unmount } = renderHook(() => useVisiblePolling(refresh, 1000));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { finish(); });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('pauses in a hidden window and refreshes when visible again', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get');
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useVisiblePolling(refresh, 1000));
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(refresh).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not poll a disabled panel and uses the latest callback', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ refresh, enabled }) => useVisiblePolling(refresh, 1000, enabled), {
      initialProps: { refresh: first, enabled: false },
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(first).not.toHaveBeenCalled();
    rerender({ refresh: first, enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(500));
    rerender({ refresh: second, enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
