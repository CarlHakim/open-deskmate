import { createContext, forwardRef, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import type { AgentProfile, SubagentRunRecord, TaskMessage, TaskStatus, ToolCapability, ToolsetId } from '@accomplish/shared';
import { X } from 'lucide-react';
import { AgentAvatarIcon } from '../layout/AgentAvatarPicker';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { useAgentStore } from '../../stores/agentStore';
import { getAccomplish } from '../../lib/accomplish';
import { formatSubagentRunStatus, getRelayedSubagentCompletionMeta, getSubagentLatestActivitySummary, isActiveSubagentRun } from '../../lib/subagent-presentation';
import { cn } from '../../lib/utils';

type CardTarget = { childAgentId?: string; runId?: string; label?: string; messageId?: string };
type Selection = { target: CardTarget; trigger: HTMLButtonElement };
const CharacterContext = createContext<((selection: Selection) => void) | null>(null);

/** The stable context keeps streaming task updates out of every avatar trigger. */
export const AgentCharacterButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'> & { target?: CardTarget }>(
  function AgentCharacterButton({ target = {}, children, className, onClick, ...props }, ref) {
    const open = useContext(CharacterContext);
    if (!open) return <span className={className} style={props.style} title={props.title}>{children}</span>;
    return <button {...props} ref={ref} type="button" aria-haspopup="dialog"
      className={cn('rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:ring-2 hover:ring-primary/30', className)}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) open({ target, trigger: event.currentTarget }); }}>
      {children}
    </button>;
  }
);

function excerpt(content: string, limit = 260) {
  const text = content.replace(/```[\s\S]*?```/g, '[Structured content — open history to view]').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function Capabilities({ ids, agent, observed }: { ids?: ToolsetId[]; agent?: AgentProfile; observed: string[] }) {
  const [tools, setTools] = useState<ToolCapability[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const signature = ids?.join('|') || '';
  useEffect(() => {
    let cancelled = false;
    setTools([]);
    if (!signature) { setState('ready'); return; }
    setState('loading');
    void (async () => {
      try {
        const result = await getAccomplish().listTools({ toolsetIds: signature.split('|') as ToolsetId[] });
        if (!cancelled) { setTools(result.tools); setState('ready'); }
      } catch { if (!cancelled) setState('error'); }
    })();
    return () => { cancelled = true; };
  }, [signature]);
  const blocked = agent?.permissionProfile?.enabled ? agent.permissionProfile.runtime?.blockedToolNames || [] : [];
  return <section className="space-y-2" aria-label="Agent capabilities">
    <h4 className="font-semibold">Capabilities</h4>
    {signature ? <>
      <p className="text-xs text-muted-foreground">Configured tool groups: {ids?.join(', ').replaceAll('_', ' ')}</p>
      {state === 'loading' ? <p role="status" className="text-xs text-muted-foreground">Loading capability descriptions…</p> : state === 'error' ? <p className="text-xs text-muted-foreground">Capability descriptions could not be loaded. Reopen the card to retry.</p> : <div className="flex flex-wrap gap-1.5">{tools.map(tool => <span key={tool.name} title={tool.description} className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">{tool.displayName}</span>)}</div>}
    </> : <p className="text-xs text-muted-foreground">No explicit tool groups recorded here; app and task defaults may apply.</p>}
    <p className="text-xs text-muted-foreground">Tool access also depends on task permissions and connected services.</p>
    {blocked.length > 0 && <p className="text-xs text-muted-foreground">Blocked by this agent’s profile: {blocked.join(', ')}</p>}
    {observed.length > 0 && <details className="text-xs"><summary className="cursor-pointer">Tools recorded in this task ({observed.length})</summary><p className="mt-1 break-words text-muted-foreground">{observed.join(', ')}</p></details>}
  </section>;
}

export function AgentCharacterProvider({ children, agentId, taskId, status, messages, runs, onOpenMessage, onOpenRun, onGuideParent }: {
  children: ReactNode; agentId?: string; taskId: string; status?: TaskStatus; messages: TaskMessage[]; runs: SubagentRunRecord[];
  onOpenMessage: (id: string) => void; onOpenRun: (run: SubagentRunRecord) => void; onGuideParent?: () => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const agents = useAgentStore(state => state.agents);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const anchor = useRef<{ getBoundingClientRect: () => DOMRect; contextElement?: HTMLElement }>({ getBoundingClientRect: () => document.documentElement.getBoundingClientRect() });
  const restoreFocus = useRef(true);
  const titleId = useId();
  const open = useMemo(() => (next: Selection) => {
    restoreFocus.current = true;
    trigger.current = next.trigger;
    const bounds = next.trigger.getBoundingClientRect();
    anchor.current = { contextElement: next.trigger, getBoundingClientRect: () => next.trigger.isConnected ? next.trigger.getBoundingClientRect() : bounds };
    setSelection(next);
  }, []);
  useEffect(() => { setSelection(null); }, [taskId, agentId]);
  const target = selection?.target;
  const child = Boolean(target?.runId || target?.childAgentId);
  // An agent profile may back multiple simultaneous helpers. Never select a
  // sibling run merely because its agent ID matches the clicked avatar.
  const matches = target?.runId ? runs.filter(run => run.runId === target.runId) : child
    ? runs.filter(run => run.childAgentId === target?.childAgentId && (!target.label || run.label === target.label)) : [];
  const run = matches.length === 1 ? matches[0] : undefined;
  const profileId = run?.childAgentId || target?.childAgentId || (child ? undefined : agentId);
  const agent = agents.find(entry => entry.id === profileId);
  const name = agent?.name || profileId || 'Agent';
  const visible = Boolean(selection);
  const recent = useMemo(() => visible && !child ? messages.filter(message => message.type === 'assistant' && !getRelayedSubagentCompletionMeta(message)).slice(-4).reverse() : [], [visible, child, messages]);
  const observed = useMemo(() => visible && !child ? [...new Set(messages.filter(message => message.type === 'tool' && message.toolName).map(message => message.toolName!))] : [], [visible, child, messages]);
  const prompt = visible && !child ? [...messages].reverse().find(message => message.type === 'user') : undefined;
  const statusLabel = run ? run.replacedByRunId ? 'Replaced' : ['stale', 'likely_stuck', 'blocked', 'timed_out', 'failed'].includes(run.supervisor?.state || '') ? 'Needs attention' : run.lifecycle === 'queued' ? 'Queued' : run.lifecycle === 'starting' ? 'Starting' : formatSubagentRunStatus(run.status, run.resultStatus)
    : child ? 'Recorded contribution' : status === 'completed' ? 'Turn finished' : status === 'waiting_permission' ? 'Waiting for permission' : status === 'failed' ? 'Needs attention' : status === 'cancelled' || status === 'interrupted' ? 'Stopped' : status === 'queued' ? 'Queued' : status === 'running' ? 'Working' : status === 'pending' ? 'Starting' : 'No active task';
  const assignment = child ? run?.lastPrompt || run?.task : prompt?.content;
  const recordedMessage = target?.messageId ? messages.find(message => message.id === target.messageId) : undefined;
  const closeAnd = (action: () => void) => { restoreFocus.current = false; setSelection(null); action(); };
  return <CharacterContext.Provider value={open}>
    {children}
    <Popover open={Boolean(selection)} onOpenChange={value => { if (!value) setSelection(null); }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent aria-labelledby={titleId} side="right" align="start" sideOffset={10}
        className="w-[360px] max-w-[calc(100vw-2rem)] max-h-[min(78vh,var(--radix-popover-content-available-height))] overflow-y-auto space-y-4 text-sm"
        onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus.current && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}>
        {selection && <>
          <div className="flex items-start gap-3">
            <AgentAvatarIcon avatar={agent?.avatar} color={agent?.avatarColor} imageDataUrl={agent?.avatarImageDataUrl} className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1"><h3 id={titleId} className="break-words text-base font-semibold">{name}</h3><p className="text-xs text-primary">{agent?.roleName || 'Agent'} · {statusLabel}</p></div>
            <button type="button" aria-label="Close agent card" onClick={() => setSelection(null)} className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
          </div>
          <section><h4 className="font-semibold">Specialty</h4><p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{agent?.description || agent?.roleName || 'No specialty has been set for this agent.'}</p></section>
          <section><h4 className="font-semibold">{(run && !isActiveSubagentRun(run)) || (!child && status === 'completed') ? 'Latest assignment' : 'Current assignment'}</h4>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{assignment ? excerpt(assignment, 650) : 'No specific assignment is available for this avatar.'}</p>
            {run && isActiveSubagentRun(run) && <p className="mt-1 text-xs text-muted-foreground">{getSubagentLatestActivitySummary(run)}</p>}
          </section>
          <Capabilities key={`${profileId}:${run?.runId || 'parent'}`} ids={run?.inheritedContext?.enabledToolsetIds ?? run?.inheritedContext?.toolsetIds ?? agent?.toolsetIds} agent={agent} observed={child ? [] : observed} />
          <section className="space-y-2"><h4 className="font-semibold">Recent contributions</h4>
            <p className="text-xs text-muted-foreground">From this {child ? 'helper run' : 'conversation'}.</p>
            {child ? run?.finalReport || recordedMessage ? <button type="button" className="w-full rounded-lg border border-border p-2 text-left text-xs hover:bg-accent" onClick={() => closeAnd(() => recordedMessage ? onOpenMessage(recordedMessage.id) : run && onOpenRun(run))}>
              <span className="block break-words">{excerpt(run?.finalReport || recordedMessage!.content)}</span><span className="mt-1 block text-primary">{recordedMessage ? 'Show in history' : 'Open helper report'} →</span>
            </button> : <p className="text-xs text-muted-foreground">No result recorded yet.</p> : recent.length ? recent.map(message => <button key={message.id} type="button" className="block w-full rounded-lg border border-border p-2 text-left text-xs hover:bg-accent" onClick={() => closeAnd(() => onOpenMessage(message.id))}>
              <span className="block break-words">{excerpt(message.content)}</span><span className="mt-1 block text-primary">Show in history →</span>
            </button>) : <p className="text-xs text-muted-foreground">No answer recorded yet.</p>}
          </section>
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {run ? <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={() => closeAnd(() => onOpenRun(run))}>Progress & guidance</button>
              : !child && <><button type="button" disabled={!recent.length} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50" onClick={() => closeAnd(() => { if (recent[0]) onOpenMessage(recent[0].id); })}>View latest answer</button>
                {onGuideParent && <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs" onClick={() => closeAnd(onGuideParent)}>Open prompt box</button>}</>}
          </div>
        </>}
      </PopoverContent>
    </Popover>
  </CharacterContext.Provider>;
}
