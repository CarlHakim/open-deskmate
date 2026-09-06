import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AgentCharacterButton } from '../agents/AgentCharacterCard';
import { CheckCircle2, Circle, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { TaskActivityEvent, TaskMessage, TaskStatus } from '@accomplish/shared';
import { AgentAvatarIcon } from '../layout/AgentAvatarPicker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { buildTaskJourney, journeyStages, type JourneyStage } from '../../lib/task-journey';
import { useExperienceStore } from '../../stores/experienceStore';
import { ExperienceSettings } from './ExperienceSettings';

const useCompletion = create<{ messageId: string | null; set: (messageId: string | null) => void }>(set => ({ messageId: null, set: messageId => set({ messageId }) }));
const celebrated = new Set<string>();
const isActive = (status?: TaskStatus) => Boolean(status && ['running', 'pending', 'queued', 'waiting_permission'].includes(status));

async function playChime() {
  if (!window.AudioContext) return;
  const audio = new AudioContext();
  try {
    // Some environments disallow audio until the user interacts; never hold up the result.
    if (audio.state !== 'running') return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.frequency.setValueAtTime(660, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, audio.currentTime + 0.16);
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.32);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.34);
    await new Promise<void>(resolve => { oscillator.onended = () => resolve(); });
  } finally { await audio.close(); }
}

export function AnswerHighlight({ messageId, children }: { messageId: string; children: ReactNode }) {
  const highlighted = useCompletion(state => state.messageId === messageId);
  const enabled = useExperienceStore(state => state.celebrations && state.mode !== 'calm');
  return <div className={highlighted && enabled ? 'task-result-highlight rounded-xl' : undefined}>{children}</div>;
}

export function TaskJourney({ taskId, status, messages, activity = EMPTY_ACTIVITY, agent, onOpenMessage }: {
  taskId: string; status?: TaskStatus; messages: TaskMessage[]; activity?: TaskActivityEvent[];
  agent?: { name?: string; avatar?: string; avatarColor?: string; avatarImageDataUrl?: string };
  onOpenMessage?: (id: string) => void;
}) {
  const journey = useMemo(() => buildTaskJourney(messages, activity, status), [messages, activity, status]);
  const [selected, setSelected] = useState<JourneyStage | null>(null);
  const stageTrigger = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moment, setMoment] = useState(false);
  const { mode, celebrations, sound } = useExperienceStore();
  const preferences = useRef({ mode, celebrations, sound });
  preferences.current = { mode, celebrations, sound };
  const lastAnswer = [...messages].reverse().find(message => message.type === 'assistant');
  const answerId = lastAnswer?.id;
  const previous = useRef({ taskId, status });
  useEffect(() => {
    const before = previous.current;
    previous.current = { taskId, status };
    setMoment(false);
    if (before.taskId !== taskId) setSelected(null);
    if (before.taskId !== taskId || !isActive(before.status) || status !== 'completed' || journey.needsGuidance || !answerId) return;
    const key = `${taskId}:${answerId}`;
    if (celebrated.has(key)) return;
    celebrated.add(key);
    if (celebrated.size > 200) celebrated.delete(celebrated.values().next().value!);
    const prefs = preferences.current;
    if (prefs.mode === 'calm') return;
    if (prefs.sound) void playChime().catch(() => {});
    if (!prefs.celebrations || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setMoment(true);
    useCompletion.getState().set(answerId);
    const timer = setTimeout(() => { setMoment(false); useCompletion.getState().set(null); }, 1800);
    return () => { clearTimeout(timer); useCompletion.getState().set(null); };
  }, [taskId, status, journey.needsGuidance, answerId]);

  const stages = journey.entries.some(entry => entry.stage === 'Working') ? [...journeyStages, 'Working' as const] : journeyStages;
  return <section aria-label="Task journey" className="shrink-0 rounded-lg border border-border/60 bg-card/80 px-2 py-1.5 text-xs">
    <div className="flex items-center gap-2">
      <span className={moment && celebrations && mode !== 'calm' ? 'task-completion-avatar' : ''}>
        <AgentCharacterButton aria-label={`Open agent card for ${agent?.name || 'Agent'}`}>
          <AgentAvatarIcon avatar={agent?.avatar} color={agent?.avatarColor} imageDataUrl={agent?.avatarImageDataUrl} className="h-6 w-6" />
        </AgentCharacterButton>
      </span>
      <span role="status" className={journey.label === 'Needs attention' || journey.needsGuidance || status === 'waiting_permission' ? 'font-medium text-amber-600 dark:text-amber-400' : 'font-medium'}>{journey.label}</span>
      {moment && mode === 'playful' && celebrations && <Sparkles aria-hidden="true" className="task-completion-sparkle h-4 w-4 text-primary" />}
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger asChild><button type="button" className="ml-auto rounded p-1 hover:bg-accent" aria-label="Interaction appearance" title="Calm, Balanced or Playful"><SlidersHorizontal className="h-3.5 w-3.5" /></button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Interaction appearance</h3><button type="button" aria-label="Close appearance options" onClick={() => setSettingsOpen(false)}><X className="h-4 w-4" /></button></div>
          <ExperienceSettings />
        </PopoverContent>
      </Popover>
    </div>
    <nav aria-label="Recorded task stages" className="mt-1 flex gap-1 overflow-x-auto pb-0.5">
      {stages.map(stage => {
        const count = journey.entries.filter(entry => entry.stage === stage).length;
        return <button key={stage} type="button" onClick={event => { stageTrigger.current = event.currentTarget; setSelected(stage); }} aria-label={`${stage}: ${count} recorded ${count === 1 ? 'item' : 'items'}`}
          className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-accent ${count ? 'text-foreground' : 'text-muted-foreground'}`}>
          {stage === 'Ready' && count ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <Circle className={`h-2 w-2 ${count ? 'fill-primary text-primary' : ''}`} />}{stage}
        </button>;
      })}
    </nav>
    <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg"
        onPointerDown={event => { if (event.target === event.currentTarget) setSelected(null); }}
        onCloseAutoFocus={event => { event.preventDefault(); stageTrigger.current?.focus(); }}>
        <DialogHeader><DialogTitle>{selected} · Task journey</DialogTitle><DialogDescription>Recorded activity for the latest prompt. Stages can repeat or be skipped; a recorded check does not imply it passed.</DialogDescription></DialogHeader>
        {journey.entries.filter(entry => entry.stage === selected).length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded for this stage.</p> : journey.entries.filter(entry => entry.stage === selected).map(entry => <article key={entry.id} className="rounded-lg border border-border p-3 text-sm">
          <div className="font-medium">{entry.title}</div>
          {entry.timestamp && <time className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</time>}
          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{entry.detail}</p>
          {entry.messageId && onOpenMessage && <button type="button" className="mt-2 text-primary underline" onClick={() => { onOpenMessage(entry.messageId!); setSelected(null); }}>Show in history</button>}
        </article>)}
      </DialogContent>
    </Dialog>
  </section>;
}
const EMPTY_ACTIVITY: TaskActivityEvent[] = [];
