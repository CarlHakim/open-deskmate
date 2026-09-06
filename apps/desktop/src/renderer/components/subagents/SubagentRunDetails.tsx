import { useState } from 'react';
import type { SubagentRunRecord } from '@accomplish/shared';
import { getAccomplish } from '../../lib/accomplish';
import { Button } from '../ui/button';

export default function SubagentRunDetails({ run }: { run: SubagentRunRecord }) {
  const [budget, setBudget] = useState(String(run.executionPolicy?.maxCostUsd ?? ''));
  const [runtimeLimit, setRuntimeLimit] = useState(String((run.executionPolicy?.runTimeoutMs ?? 1200000) / 1000));
  const [action, setAction] = useState<'notify' | 'stop'>(run.executionPolicy?.limitAction || 'notify');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invoke = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const queuedSeconds = Math.max(0, Math.round((Date.parse(run.startedAt || run.completedAt || new Date().toISOString()) - Date.parse(run.queuedAt || run.createdAt)) / 1000));
  const runtimeSeconds = run.startedAt ? Math.max(0, Math.round((Date.parse(run.completedAt || new Date().toISOString()) - Date.parse(run.startedAt)) / 1000)) : 0;
  return <div className="mt-2 space-y-1 text-xs text-muted-foreground">
    <div>Queue {queuedSeconds}s · Work {runtimeSeconds}s{run.costUsd !== undefined ? ` · Recorded $${run.costUsd.toFixed(4)}${run.costIncomplete ? ' (partial pricing)' : ''}` : ''}</div>
    {run.resultDelivery && <div>Result: {run.resultDelivery.state === 'ready' ? 'Ready for parent' : run.resultDelivery.state === 'received' ? 'Received by parent' : 'Parent review completed'}</div>}
    {run.resultDelivery?.state === 'ready' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void invoke(async () => {
      const consumed = await getAccomplish().consumeSubagentResults({ parentTaskId: run.parentTaskId });
      if (!consumed) throw new Error('Parent is busy or has no resumable session. Results remain available; retry when it is idle.');
    })}>Use results in parent</Button>}
    {run.ownedPaths?.length ? <div>Assigned files: {run.ownedPaths.join(', ')}</div> : run.inheritedContext?.buildMode ? <div>Shared workspace · No file assignment</div> : null}
    {run.worktree && <details><summary className="cursor-pointer">Isolated changes · Review before integrating</summary><p className="break-all">Folder: {run.worktree.path}</p><p className="break-all">Branch: {run.worktree.branch}</p><p>Use results in parent to review the diff and test results. The app does not merge or delete this worktree automatically.</p></details>}
    {!!run.ownershipConflicts?.length && <div className="text-amber-700">Overlap: {run.ownershipConflicts.join('; ')}</div>}
    {run.limitReached && <div className="text-amber-700">{run.limitReached}</div>}
    {run.resultDelivery?.error && <div className="text-destructive">{run.resultDelivery.error}</div>}
    <details>
      <summary className="cursor-pointer">Limits and next action</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label>Child spending limit (USD) <input className="w-24 rounded border bg-background p-1" type="number" min="0.001" step="0.01" placeholder="No limit" value={budget} onChange={event => setBudget(event.target.value)} /></label>
        <label>Runtime limit (seconds) <input className="w-24 rounded border bg-background p-1" type="number" min="15" max="3600" value={runtimeLimit} onChange={event => setRuntimeLimit(event.target.value)} /></label>
        <label>At limit <select className="rounded border bg-background p-1" value={action} onChange={event => setAction(event.target.value as 'notify' | 'stop')}><option value="notify">Notify</option><option value="stop">Stop child</option></select></label>
        <Button size="sm" variant="outline" disabled={busy || !run.executionPolicy} onClick={() => void invoke(() => getAccomplish().updateSubagentPolicy({ runId: run.runId, maxCostUsd: budget.trim() ? Number(budget) : undefined, runTimeoutMs: Number(runtimeLimit) * 1000, limitAction: action }))}>Save limits</Button>
      </div>
      <p>Applies to the runtime and recorded spending limits. Provider usage may arrive late; this is not a guaranteed billing cap.</p>
      <p>Next: {run.supervisor?.recommendedAction?.replace(/_/g, ' ') || 'wait for progress'}</p>
      {run.inheritedContext?.buildMode ? <p>Review changed files and test results in the transcript before using the changes.</p> : <p>Review findings, sources, and unresolved gaps in the transcript.</p>}
    </details>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
