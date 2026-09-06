import { useEffect, useRef } from 'react';
import { getAccomplish } from '../lib/accomplish';

/** Events drive updates; a slow reconciliation catches missed events after reconnects. */
export function useSubagentRefresh(refresh: () => Promise<unknown>, key?: string | null) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let busy = false;
    let pending = false;
    const tick = async () => {
      if (stopped || document.hidden) return;
      if (busy) { pending = true; return; }
      busy = true;
      try { await refreshRef.current(); }
      catch (error) { console.warn('Subagent refresh failed', error); }
      finally {
        busy = false;
        if (pending && !stopped) { pending = false; void tick(); }
      }
    };
    const unsubscribe = getAccomplish().onSubagentsChanged?.(() => void tick());
    const timer = setInterval(() => void tick(), 30000);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => { stopped = true; clearInterval(timer); unsubscribe?.(); document.removeEventListener('visibilitychange', onVisible); };
  }, [key]);
}
