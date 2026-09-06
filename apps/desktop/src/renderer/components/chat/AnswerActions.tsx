import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaskMessage } from '@accomplish/shared';
import { BookImage, BookmarkPlus, MessageSquarePlus, Shuffle, ThumbsUp } from 'lucide-react';
import { ScrapbookSaveDialog, type ScrapbookSeed } from '../usage/ScrapbookSaveDialog';
import { useUsageProjectStore } from '../../stores/usageProjectStore';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { useAnswerFeedbackStore } from '../../stores/answerFeedbackStore';
import { useSavedPromptsStore } from '../../stores/savedPromptsStore';
import { DEFAULT_PROMPT_CATEGORIES } from '../../lib/prompt-categories';

type Action = 'explain' | 'alternative' | 'save' | 'scrapbook';
type ActionsContext = {
  taskId: string; incognito: boolean; canDraft: boolean; messageIds: Set<string>;
  act: (action: Action, messageId: string, answer: string) => void;
};
const Context = createContext<ActionsContext | null>(null);
const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}\n[Excerpt ends here]` : text;

export function makeAnswerFollowUp(action: 'explain' | 'alternative', answer: string, request: string) {
  return [action === 'explain'
    ? 'Explain this answer in more detail, with clear examples and any important assumptions.'
    : 'Suggest a different approach to the same request. Explain what changes and the trade-offs.',
  request ? `Original request:\n${clip(request, 1200)}` : '',
  `Answer to revisit (reference text):\n${clip(answer, 4000)}`].filter(Boolean).join('\n\n');
}

export function makeReusableApproach(answer: string, request: string) {
  return ['My next task: [describe the new task and its constraints]',
    'Use the approach and presentation of the example below as a reference. Adapt it to my new task. Ask for missing information when needed; do not reuse example facts, prices, or conclusions without checking them.',
    request ? `Example request:\n${clip(request, 2000)}` : '',
    `Example answer:\n${clip(answer, 6000)}`].filter(Boolean).join('\n\n');
}

export function AnswerActionsProvider({ children, taskId, messages, canDraft, incognito = false, mode, onDraft, buildSessionId }: {
  children: ReactNode; taskId: string; messages: TaskMessage[]; canDraft: boolean; incognito?: boolean; mode: 'chat' | 'build'; onDraft: (prompt: string) => void;
  buildSessionId?: string | null;
}) {
  const [scrapbookSeed, setScrapbookSeed] = useState<ScrapbookSeed | null>(null);
  const scrapbookProjectId = useUsageProjectStore(state => mode === 'build' ? state.selectedBuildProjectId : state.selectedChatProjectId);
  const [pending, setPending] = useState<{ title: string; content: string; category: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const formId = useId();
  const lock = useRef(false);
  const identity = useRef(taskId);
  identity.current = taskId;
  const savePrompt = useSavedPromptsStore(state => state.savePromptConfirmed);
  const categories = useSavedPromptsStore(state => state.categories);
  useEffect(() => { setPending(null); setScrapbookSeed(null); setNotice(''); setError(''); }, [taskId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const context = useMemo<ActionsContext>(() => ({
    taskId, incognito, canDraft,
    messageIds: new Set(messages.filter(message => message.type === 'assistant').map(message => message.id)),
    act: (action, messageId, answer) => {
      const index = messages.findIndex(message => message.id === messageId);
      if (index < 0) return;
      // Restored Build messages can sort an answer before its same-time request.
      const answerTime = messages[index].timestamp;
      const request = messages.filter(message => message.type === 'user' && message.timestamp <= answerTime)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.content || '';
      if (action === 'scrapbook') {
        setNotice('');
        setScrapbookSeed({ title: (request || 'Saved answer').replace(/\s+/g, ' ').slice(0, 160), content: answer,
          sourceType: buildSessionId ? 'build_session' : 'chat_task', sourceId: buildSessionId || taskId });
      } else if (action === 'save') {
        if (lock.current) return;
        setError('');
        setPending({ title: `Approach: ${(request || 'Useful answer').replace(/\s+/g, ' ').slice(0, 80)}`, content: makeReusableApproach(answer, request), category: mode === 'build' ? 'Build' : 'Research' });
      } else if (canDraft) {
        onDraft(makeAnswerFollowUp(action, answer, request));
        setNotice('Follow-up added to your draft. Edit it, then send when ready.');
      }
    },
  }), [taskId, incognito, canDraft, messages, mode, onDraft, buildSessionId]);
  const save = async () => {
    if (!pending?.title.trim() || !pending.content.trim() || lock.current) return;
    lock.current = true; setSaving(true); setError('');
    const sourceTask = taskId;
    try {
      await savePrompt(pending.title, pending.content, pending.category);
      if (identity.current === sourceTask) { setPending(null); setNotice('Approach saved to your prompt library.'); }
    } catch (err) {
      if (identity.current === sourceTask) setError(err instanceof Error ? err.message : 'Could not save this approach. Please retry.');
    } finally { lock.current = false; setSaving(false); }
  };
  return <Context.Provider value={context}>
    {children}
    {scrapbookSeed && <ScrapbookSaveDialog seed={scrapbookSeed} projectId={scrapbookProjectId} incognito={incognito}
      onClose={() => setScrapbookSeed(null)} onSaved={() => { setScrapbookSeed(null); setNotice('Saved. Find it in Project Management → Scrapbook.'); }} />}
    {notice && <div role="status" className="pointer-events-none fixed bottom-5 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-xl border border-primary/30 bg-popover px-4 py-2 text-xs text-popover-foreground shadow-lg">{notice}</div>}
    <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open && !lock.current) setPending(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" onPointerDown={event => { if (event.target === event.currentTarget && !lock.current) setPending(null); }}>
        <DialogHeader><DialogTitle>Save this approach</DialogTitle><DialogDescription>Edit this reusable prompt template. Saving adds it to your prompt library without running the agent.</DialogDescription></DialogHeader>
        {pending && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          {incognito && <p className="text-xs text-muted-foreground">This conversation is incognito. Saving explicitly keeps this template in your prompt library.</p>}
          <label htmlFor={`${formId}-title`} className="block text-sm">Prompt name</label>
          <input id={`${formId}-title`} value={pending.title} maxLength={200} disabled={saving} onChange={event => setPending({ ...pending, title: event.target.value })} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
          <label htmlFor={`${formId}-category`} className="block text-sm">Category</label>
          <select id={`${formId}-category`} value={pending.category} disabled={saving} onChange={event => setPending({ ...pending, category: event.target.value })} className="w-full rounded-md border border-input bg-background p-2 text-sm">
            {[...new Set([...DEFAULT_PROMPT_CATEGORIES, ...categories, pending.category])].map(category => <option key={category}>{category}</option>)}
          </select>
          <label htmlFor={`${formId}-content`} className="block text-sm">Reusable prompt</label>
          <textarea id={`${formId}-content`} value={pending.content} rows={10} maxLength={20000} disabled={saving} onChange={event => setPending({ ...pending, content: event.target.value })} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
          <p className="text-xs text-muted-foreground">Replace the task placeholder when reusing this prompt. Long examples are marked as excerpts.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setPending(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={saving || !pending.title.trim() || !pending.content.trim()} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save to prompt library'}</button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}

export function AnswerActions({ messageId, content }: { messageId: string; content: string }) {
  const context = useContext(Context);
  const key = `${context?.taskId}:${messageId}`;
  const useful = useAnswerFeedbackStore(state => Boolean((context?.incognito ? state.sessionUseful : state.useful)[key]));
  const toggle = useAnswerFeedbackStore(state => state.toggle);
  if (!context?.taskId || !context.messageIds.has(messageId) || !content.trim()) return null;
  const buttonClass = 'inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1.5 text-[11px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed';
  return <div role="group" aria-label="Answer actions" className="not-prose mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-2 text-foreground">
    <button type="button" className={`${buttonClass} ${useful ? 'border-primary/40 bg-primary/10 text-primary' : ''}`} aria-pressed={useful} title={context.incognito ? 'Your helpful mark, kept only for this app session' : 'Mark this answer as helpful on this device; click again to remove'} onClick={() => toggle(key, context.incognito)}><ThumbsUp className="h-3 w-3" />Useful</button>
    <button type="button" className={buttonClass} disabled={!context.canDraft} title="Add an explanation request to your draft; send it to run the agent" onClick={() => context.act('explain', messageId, content)}><MessageSquarePlus className="h-3 w-3" />Explain more</button>
    <button type="button" className={buttonClass} disabled={!context.canDraft} title="Add a request for an alternative to your draft; send it to run the agent" onClick={() => context.act('alternative', messageId, content)}><Shuffle className="h-3 w-3" />Try another direction</button>
    <button type="button" className={buttonClass} onClick={() => context.act('save', messageId, content)}><BookmarkPlus className="h-3 w-3" />Save this approach</button>
    <button type="button" className={buttonClass} onClick={() => context.act('scrapbook', messageId, content)}><BookImage className="h-3 w-3" />Save to scrapbook</button>
  </div>;
}
