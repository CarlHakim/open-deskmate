'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BuildSessionSnapshot } from '@accomplish/shared';
import { Loader2, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAccomplish } from '@/lib/accomplish';

type BuildRuntimeIndicatorProps = {
  agentId?: string | null;
};

function formatBuildRuntimeText(snapshot: BuildSessionSnapshot | null): string {
  if (!snapshot) return '';
  if (snapshot.runtime.status === 'starting') {
    return 'Build runtime starting';
  }
  return 'Build runtime running';
}

export default function BuildRuntimeIndicator({ agentId }: BuildRuntimeIndicatorProps) {
  const accomplish = getAccomplish();
  const [snapshot, setSnapshot] = useState<BuildSessionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!agentId) {
      setSnapshot(null);
      return;
    }
    try {
      const next = await accomplish.getBuildRuntimeSnapshot({ agentId });
      setSnapshot(next);
    } catch {
      setSnapshot(null);
    }
  }, [accomplish, agentId]);

  useEffect(() => {
    void refresh();
    if (!agentId) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [agentId, refresh]);

  const visible = snapshot?.runtime.status === 'running' || snapshot?.runtime.status === 'starting';
  const workspaceLabel = useMemo(() => snapshot?.workspaceRelativePath || '.', [snapshot?.workspaceRelativePath]);

  if (!visible) return null;

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/18 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm shadow-emerald-500/15 ring-1 ring-emerald-500/15 dark:border-emerald-400/35 dark:bg-emerald-500/16 dark:text-emerald-200 dark:shadow-emerald-900/20 dark:ring-emerald-400/10 shrink-0"
      title={`Runtime is still active in Build Mode.\nWorkspace: ${workspaceLabel}`}
    >
      {snapshot?.runtime.status === 'starting' ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : (
        <Wrench className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate">Build runtime running</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 rounded-full border border-emerald-600/25 bg-white/55 px-2.5 text-[11px] font-semibold text-emerald-900 hover:bg-white/80 hover:text-emerald-950 dark:border-emerald-300/20 dark:bg-emerald-950/35 dark:text-emerald-100 dark:hover:bg-emerald-950/55 dark:hover:text-white"
        onClick={async () => {
          if (!agentId || busy) return;
          setBusy(true);
          try {
            const next = await accomplish.stopBuildRuntime({ agentId });
            setSnapshot(next);
          } finally {
            setBusy(false);
          }
        }}
        title="Stop the active Build Mode runtime."
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="mr-1 h-3 w-3" />}
        Stop
      </Button>
    </div>
  );
}
