import { useEffect, useRef, useState } from 'react';
import type { SubagentRunRecord, SubagentRunTreeNode } from '@accomplish/shared';
import { AgentAvatarIcon } from '../layout/AgentAvatarPicker';
import { AgentCharacterButton } from '../agents/AgentCharacterCard';
import { useAgentStore } from '../../stores/agentStore';
import { useExperienceStore } from '../../stores/experienceStore';
import { formatSubagentRunStatus, getSubagentLatestActivitySummary } from '../../lib/subagent-presentation';

export default function SubagentTeamView({ nodes, onOpen }: { nodes: SubagentRunTreeNode[]; onOpen: (run: SubagentRunRecord) => void }) {
  const agents = useAgentStore(state => state.agents);
  const calm = useExperienceStore(state => state.mode === 'calm');
  const flatten = (items: SubagentRunTreeNode[]): SubagentRunTreeNode[] => items.flatMap(run => [run, ...flatten(run.children || [])]);
  const runs = flatten(nodes);
  const parent = agents.find(agent => agent.id === runs[0]?.parentAgentId);
  const delivered = runs.filter(run => run.resultDelivery?.state === 'received' || run.resultDelivery?.state === 'incorporated').map(run => `${run.runId}:${run.lastResumedAt || run.createdAt}`);
  const previous = useRef(new Set(delivered));
  const [handoff, setHandoff] = useState(false);
  const signature = delivered.join('|');
  useEffect(() => {
    const next = new Set(signature ? signature.split('|') : []);
    const changed = [...next].some(id => !previous.current.has(id));
    previous.current = next;
    if (!changed) { setHandoff(false); return; }
    setHandoff(true);
    const timer = setTimeout(() => setHandoff(false), 1200);
    return () => clearTimeout(timer);
  }, [signature]);
  if (!runs.length) return null;
  return <section aria-label="Live agent team" className="mb-2 rounded-xl border border-border bg-background/70 p-2">
    <div className="mb-2 flex items-center gap-2 text-xs">
      <AgentCharacterButton aria-label={`Open agent card for ${parent?.name || runs[0].parentAgentId || 'Agent'}`}>
        <AgentAvatarIcon avatar={parent?.avatar} color={parent?.avatarColor} imageDataUrl={parent?.avatarImageDataUrl} className="h-7 w-7" />
      </AgentCharacterButton>
      <span><strong>{parent?.name || runs[0].parentAgentId}</strong><span className="ml-2 text-muted-foreground">Coordinates this task</span></span>
      {handoff && <span role="status" className={`ml-auto text-emerald-700 dark:text-emerald-400 ${calm ? '' : 'motion-safe:animate-pulse'}`}>← Result received</span>}
    </div>
    <div className="flex gap-2 overflow-x-auto pb-1">
      {runs.map(run => {
        const agent = agents.find(entry => entry.id === run.childAgentId);
        const blocked = ['stale', 'likely_stuck', 'blocked', 'timed_out', 'failed'].includes(run.supervisor?.state || '');
        const status = run.replacedByRunId ? 'Replaced' : blocked ? 'Needs attention' : run.lifecycle === 'queued' ? 'Queued' : run.lifecycle === 'starting' ? 'Starting' : formatSubagentRunStatus(run.status, run.resultStatus);
        return <div key={run.runId}
          className={`flex w-52 shrink-0 items-start gap-2 rounded-lg border p-2 text-left text-xs ${blocked ? 'border-amber-500/60' : 'border-border'}`}>
          <AgentCharacterButton target={{ runId: run.runId, childAgentId: run.childAgentId }} aria-label={`Open agent card for ${agent?.name || run.childAgentId}: ${run.label || run.task}`} className="shrink-0">
            <AgentAvatarIcon avatar={agent?.avatar} color={agent?.avatarColor} imageDataUrl={agent?.avatarImageDataUrl} className="h-8 w-8" />
          </AgentCharacterButton>
          <button type="button" onClick={() => onOpen(run)} aria-label={`Open ${run.label || agent?.name || run.childAgentId} progress`} className="min-w-0 flex-1 rounded text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0"><strong className="block truncate">{agent?.name || run.childAgentId}</strong><span className="block truncate" title={run.task}>{run.label || run.task}</span><span className="block text-primary">{status}</span><span className="block truncate text-muted-foreground" title={getSubagentLatestActivitySummary(run) || ''}>{getSubagentLatestActivitySummary(run) || 'Open progress and guidance'}</span></span>
          </button>
        </div>;
      })}
    </div>
  </section>;
}
