import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Pin, Plus, X } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { Button } from '../ui/button';
import { useSavedPromptsStore } from '../../stores/savedPromptsStore';
import { MAX_PIN_LIMIT, normalizePinLimit, useActionShelfStore } from '../../stores/actionShelfStore';
import { useUsageProjectStore } from '../../stores/usageProjectStore';
import { actionFields, actionScope, fillAction, STARTER_ACTIONS, type ActionMode, type ShelfAction } from '../../lib/action-shelf';

type Props = {
  compact?: boolean;
  mode: ActionMode; projectId?: string | null; disabled?: boolean; incognito?: boolean;
  side?: 'top' | 'bottom'; getDraft: () => string; onInsert: (text: string) => void;
  onManage: () => void;
};

export default function ActionShelf(props: Props) {
  return <ScopedShelf key={actionScope(props.mode, props.projectId)} {...props} />;
}

function ScopedShelf({ mode, projectId, disabled = false, incognito = false, compact = false, side = 'top', getDraft, onInsert, onManage }: Props) {
  const [open, setOpen] = useState(false);
  const [popupView, setPopupView] = useState<'library' | 'overflow'>('library');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ShelfAction | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const lock = useRef(false);
  const pendingInsertion = useRef<string | null>(null);
  const allButton = useRef<HTMLButtonElement>(null);
  const overflowButton = useRef<HTMLButtonElement>(null);
  const shelfRow = useRef<HTMLDivElement>(null);
  const pinMeasurements = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(0);
  const prompts = useSavedPromptsStore(state => state.prompts);
  const savePrompt = useSavedPromptsStore(state => state.savePromptConfirmed);
  const pins = useActionShelfStore(state => state.pins);
  const setPins = useActionShelfStore(state => state.setPins);
  const limits = useActionShelfStore(state => state.limits);
  const setPinLimit = useActionShelfStore(state => state.setPinLimit);
  const projectName = useUsageProjectStore(state => state.projects.find(project => project.id === projectId)?.name);
  const scope = actionScope(mode, projectId);
  const pinLimit = normalizePinLimit(limits[scope]);
  const [limitDraft, setLimitDraft] = useState(String(pinLimit));
  useEffect(() => { setLimitDraft(String(pinLimit)); }, [pinLimit]);
  const starters = STARTER_ACTIONS[mode];
  const actions = useMemo(() => [...starters, ...prompts.map(prompt => ({ ...prompt, id: `saved:${prompt.id}` }))], [starters, prompts]);
  const pinnedIds = pins[scope] ?? starters.map(action => action.id);
  const pinned = pinnedIds.map(id => actions.find(action => action.id === id)).filter((action): action is ShelfAction => Boolean(action));
  const pinLayoutKey = JSON.stringify(pinned.map(action => [action.id, action.title]));
  useLayoutEffect(() => {
    if (!shelfRow.current || !pinMeasurements.current || !allButton.current) return;
    const row = shelfRow.current, measurements = pinMeasurements.current, trigger = allButton.current;
    const measure = () => {
      // A hidden composer will be measured again when it becomes visible.
      if (!row.clientWidth) { setFitCount(measurements.children.length); return; }
      let remaining = row.clientWidth - trigger.offsetWidth - (overflowButton.current?.offsetWidth ?? 36) - 6;
      let count = 0;
      for (const child of Array.from(measurements.children)) {
        remaining -= child.getBoundingClientRect().width + 6;
        if (remaining < 1) break;
        count++;
      }
      setFitCount(current => current === count ? current : count);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row); observer.observe(measurements); observer.observe(trigger);
    return () => observer.disconnect();
  }, [compact, pinLayoutKey]);
  const fields = selected ? actionFields(selected.content) : [];
  const filtered = useMemo(() => actions.filter(action => `${action.title} ${action.description || ''} ${action.content}`.toLowerCase().includes(query.trim().toLowerCase())), [actions, query]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const insert = (text: string) => {
    if (disabled) return;
    pendingInsertion.current = text;
    setOpen(false); setSelected(null);
    setNotice('Added to your prompt. Review it, then send when ready.');
  };
  const choose = (action: ShelfAction) => {
    setNotice(''); setCreating(false); setSelected(action); setValues({}); setOpen(true);
  };
  const togglePin = (id: string) => {
    const valid = pinned.map(action => action.id);
    if (valid.includes(id)) { setPins(scope, valid.filter(value => value !== id)); setNotice('Action unpinned.'); }
    else if (valid.length >= pinLimit) setNotice(`Pinning limit: ${pinLimit}. Unpin an action or increase the limit to make room.`);
    else { setPins(scope, [...valid, id]); setNotice('Action pinned to this shelf.'); }
  };
  const save = async () => {
    if (lock.current || !title.trim() || !content.trim()) return;
    lock.current = true; setSaving(true); setNotice('');
    try {
      const saved = await savePrompt(title, content);
      if (!alive.current) return;
      const valid = pinned.map(action => action.id);
      if (valid.length < pinLimit) setPins(scope, [...valid, `saved:${saved.id}`]);
      setCreating(false); setQuery(saved.title);
      setNotice(valid.length < pinLimit ? 'Saved to the prompt library and pinned.' : 'Saved to the prompt library. Unpin an action or increase the pinning limit, then pin your new one.');
    } catch (err) { if (alive.current) setNotice(err instanceof Error ? err.message : 'Could not save action.'); }
    finally { lock.current = false; if (alive.current) setSaving(false); }
  };
  const fieldClass = 'w-full rounded-md border border-input bg-background p-2 text-sm text-foreground placeholder:text-muted-foreground';
  const pinClass = 'max-w-[10rem] shrink-0 truncate rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const overflowPins = pinned.slice(fitCount);
  return <div role="region" aria-label={`${mode === 'chat' ? 'Chat' : 'Build'} action shelf`} className={compact ? 'relative min-w-[144px] flex-1 overflow-hidden' : 'relative w-full min-w-0 max-w-full overflow-hidden py-1'}>
    <div ref={pinMeasurements} aria-hidden="true" className="pointer-events-none invisible absolute flex h-0 w-max overflow-hidden">{pinned.map(action => <span key={action.id} className={pinClass}>{action.title}</span>)}</div>
    <Popover modal open={open} onOpenChange={value => { if (!lock.current) setOpen(value); }}>
      <PopoverAnchor asChild><div ref={shelfRow} className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
        {pinned.slice(0, fitCount).map(action => <button key={action.id} type="button" disabled={disabled} title={action.title} onClick={() => choose(action)} className={pinClass}>{action.title}</button>)}
        <button ref={overflowButton} type="button" disabled={disabled} aria-label="More pinned actions" aria-expanded={open && popupView === 'overflow'} aria-haspopup="dialog" title={`${overflowPins.length} more pinned actions`} tabIndex={overflowPins.length ? 0 : -1} aria-hidden={!overflowPins.length} onClick={() => { setPopupView('overflow'); setSelected(null); setCreating(false); setNotice(''); setOpen(true); }} className={`inline-flex h-8 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${overflowPins.length ? '' : 'invisible pointer-events-none'}`}><ChevronDown aria-hidden="true" className="h-4 w-4" /></button>
        <button ref={allButton} type="button" disabled={disabled} aria-label="All actions" aria-expanded={open && popupView === 'library'} aria-haspopup="dialog" title="Open the action library and pinning settings" onClick={() => { setPopupView('library'); setSelected(null); setCreating(false); setQuery(''); setNotice(''); setOpen(true); }} className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">All actions</button>
      </div></PopoverAnchor>
      <PopoverContent side={side} align="start" collisionPadding={16} aria-label={popupView === 'overflow' ? 'More pinned actions' : 'Action shelf'} onCloseAutoFocus={event => {
        event.preventDefault();
        // Restore composer focus after the popover's focus trap has unmounted.
        const text = pendingInsertion.current;
        pendingInsertion.current = null;
        if (text !== null && alive.current && !disabled) onInsert(text);
        else (popupView === 'overflow' && overflowPins.length ? overflowButton.current : allButton.current)?.focus();
      }} className="flex max-h-[min(34rem,var(--radix-popover-content-available-height))] w-[min(27rem,calc(100vw-2rem))] flex-col overflow-hidden p-0">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
          <div><h2 className="text-sm font-semibold">{creating ? 'Save an action' : selected?.title || (popupView === 'overflow' ? 'More pinned actions' : 'All actions')}</h2><p className="text-xs text-muted-foreground">{popupView === 'overflow' ? `${overflowPins.length} pinned actions outside the row` : projectId ? `Pins for ${projectName || 'this project'}` : `Default ${mode === 'chat' ? 'Chat' : 'Build'} pins`}</p></div>
          <button type="button" disabled={saving} aria-label="Close action shelf" onClick={() => setOpen(false)} className="flex items-center gap-1 rounded-md p-1.5 text-xs hover:bg-accent"><X className="h-4 w-4" />Close</button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-3" onKeyDown={event => { if (event.key === 'Enter') event.stopPropagation(); }}>
          {(selected || creating) && <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setSelected(null); setCreating(false); }}><ArrowLeft className="mr-1 h-3 w-3" />{popupView === 'overflow' ? 'More pinned actions' : 'All actions'}</Button>}
          {creating ? <div className="space-y-3">
            <label className="block text-sm">Action name<input className={fieldClass} value={title} maxLength={120} disabled={saving} onChange={event => setTitle(event.target.value)} /></label>
            <label className="block text-sm">Reusable prompt<textarea aria-label="Reusable prompt" className={fieldClass} rows={7} value={content} maxLength={100000} disabled={saving} onChange={event => setContent(event.target.value)} /></label>
            <p className="text-xs text-muted-foreground">Use {'{{Topic}}'} or {'{{Budget}}'} to add fill-in fields. Saved actions are available in your prompt library.</p>
            {incognito && <p className="text-xs text-muted-foreground">Saving keeps this prompt after the incognito conversation ends.</p>}
            <Button type="button" disabled={saving || !title.trim() || !content.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save action'}</Button>
          </div> : selected ? <div className="space-y-3">
            {fields.map(field => <label key={field} className="block text-sm">{field}<input className={fieldClass} value={values[field] || ''} onChange={event => setValues(current => ({ ...current, [field]: event.target.value }))} /></label>)}
            <div className="rounded-lg bg-muted/50 p-3"><h3 className="mb-1 text-xs font-medium">Prompt preview</h3><p className="whitespace-pre-wrap break-words text-sm">{fillAction(selected.content, values)}</p></div>
            <Button type="button" disabled={disabled || fields.some(field => !values[field]?.trim())} onClick={() => insert(fillAction(selected.content, values))}>Add to prompt</Button>
          </div> : popupView === 'overflow' ? <div className="space-y-1">
            {overflowPins.map(action => <button key={action.id} type="button" onClick={() => choose(action)} className="block w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground hover:bg-accent">{action.title}</button>)}
            {!overflowPins.length && <p className="text-sm text-muted-foreground">All pinned actions now fit in the row.</p>}
          </div> : <>
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="text-xs font-medium">{pinned.length} / {pinLimit} actions pinned</p>
              <div className="flex items-end gap-2">
                <label className="min-w-0 flex-1 text-xs">Pinning limit<input aria-label="Pinning limit" type="number" min={1} max={MAX_PIN_LIMIT} step={1} className={fieldClass} value={limitDraft} onChange={event => setLimitDraft(event.target.value)} /></label>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  const limit = Number(limitDraft);
                  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PIN_LIMIT) { setNotice(`Enter a whole number from 1 to ${MAX_PIN_LIMIT}.`); return; }
                  setPinLimit(scope, limit);
                  setNotice(`Pinning limit saved: ${limit}.`);
                }}>Save limit</Button>
              </div>
              <p className="text-xs text-muted-foreground">Choose 1–{MAX_PIN_LIMIT} for this {mode === 'chat' ? 'Chat' : 'Build'} shelf. Existing pins are kept when you lower the limit.</p>
              {pinned.length > pinLimit && <p className="text-xs text-foreground">Above the limit: unpin actions or raise the limit before adding more.</p>}
            </div>
            <input aria-label="Search actions" className={fieldClass} placeholder="Search actions and saved prompts…" value={query} onChange={event => setQuery(event.target.value)} />
            <div className="space-y-1">{filtered.slice(0, 60).map(action => <div key={action.id} className="flex items-center gap-1 rounded-lg border border-border p-1">
              <button type="button" onClick={() => choose(action)} className="min-w-0 flex-1 rounded-md p-2 text-left hover:bg-accent"><span className="block truncate text-sm font-medium">{action.title}</span><span className="block text-xs text-muted-foreground">{action.id.startsWith('saved:') ? 'Prompt library' : 'Starter action'}</span></button>
              <button type="button" aria-label={`${pinnedIds.includes(action.id) ? 'Unpin' : 'Pin'} ${action.title}`} aria-pressed={pinnedIds.includes(action.id)} onClick={() => togglePin(action.id)} className="rounded-md p-2 hover:bg-accent"><Pin className={`h-4 w-4 ${pinnedIds.includes(action.id) ? 'fill-primary/20 text-primary' : 'text-muted-foreground'}`} /></button>
            </div>)}</div>
            {!filtered.length && <p className="text-sm text-muted-foreground">No matching actions.</p>}
            {filtered.length > 60 && <p className="text-xs text-muted-foreground">Showing 60 matches. Refine your search to find more.</p>}
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setCreating(true); setTitle(''); setContent(getDraft()); setNotice(''); }}><Plus className="mr-1 h-3 w-3" />Save current prompt</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); onManage(); }}>Manage library</Button></div>
          </>}
          {notice && <p role="status" className="text-xs text-foreground">{notice}</p>}
        </div>
        <p className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">Adds to your draft. You choose when to send. Click outside or press Esc to close.</p>
      </PopoverContent>
    </Popover>
    {!open && notice.startsWith('Added') && <p role="status" className="sr-only">{notice}</p>}
  </div>;
}
