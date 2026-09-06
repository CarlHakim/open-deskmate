import { useEffect, useRef } from 'react';

/** Refresh visible panels without overlapping slow IPC requests. */
export function useVisiblePolling(refresh: () => Promise<unknown>, intervalMs: number, enabled = true) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!stopped && !document.hidden) timer = setTimeout(tick, intervalMs);
    };
    const tick = async () => {
      if (stopped || document.hidden || running) return;
      running = true;
      try {
        await refreshRef.current();
      } catch (error) {
        console.warn('Panel refresh failed', error);
      } finally {
        running = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (!document.hidden) void tick();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
