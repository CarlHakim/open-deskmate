import { memo, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  EyeOff,
  ExternalLink,
  FileText,
  Globe2,
  Image,
  ListTree,
  MessageSquare,
  Pin,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

export type ConversationMapEntryKind =
  | 'prompt'
  | 'answer'
  | 'file'
  | 'source'
  | 'image'
  | 'document'
  | 'note'
  | 'decision'
  | 'event'
  | 'postcard';

export interface PromptNavigatorEntry {
  id: string;
  messageIndex: number;
  preview: string;
  fullText?: string;
  timestamp?: string;
  kind?: ConversationMapEntryKind;
  detail?: string;
  assetLabel?: string;
  assetUrl?: string;
  actionLabel?: string;
  pinned?: boolean;
}

export interface PromptNavigatorProps {
  entries: PromptNavigatorEntry[];
  activeEntryId?: string | null;
  onJump: (entry: PromptNavigatorEntry) => void;
  onOpenAsset?: (entry: PromptNavigatorEntry) => void;
  storageKey: string;
  label: string;
  className?: string;
  tone?: 'default' | 'build';
  disabled?: boolean;
}

function readVisiblePreference(storageKey: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(storageKey) !== 'off';
  } catch {
    return true;
  }
}

function writeVisiblePreference(storageKey: string, visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, visible ? 'on' : 'off');
  } catch {
    // Ignore localStorage failures.
  }
}

function formatPromptTime(timestamp?: string): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

type ConversationMapFilter = {
  id: 'prompt' | 'answer' | 'file' | 'source' | 'note' | 'decision' | 'event';
  label: string;
  kinds: ConversationMapEntryKind[];
};

const CONVERSATION_MAP_FILTERS: ConversationMapFilter[] = [
  { id: 'prompt', label: 'Prompts', kinds: ['prompt'] },
  { id: 'answer', label: 'Answers', kinds: ['answer'] },
  { id: 'file', label: 'Files', kinds: ['file', 'document', 'image', 'postcard'] },
  { id: 'source', label: 'Sources', kinds: ['source'] },
  { id: 'note', label: 'Notes', kinds: ['note'] },
  { id: 'decision', label: 'Decisions', kinds: ['decision'] },
  { id: 'event', label: 'Events', kinds: ['event'] },
];

const CONVERSATION_MAP_KIND_META: Record<ConversationMapEntryKind, { label: string; icon: LucideIcon; className: string }> = {
  prompt: { label: 'Prompt', icon: MessageSquare, className: 'text-cyan-500' },
  answer: { label: 'Answer', icon: Bot, className: 'text-primary' },
  file: { label: 'File', icon: FileText, className: 'text-amber-500' },
  source: { label: 'Source', icon: Globe2, className: 'text-emerald-500' },
  image: { label: 'Image', icon: Image, className: 'text-violet-500' },
  document: { label: 'Document', icon: FileText, className: 'text-amber-500' },
  note: { label: 'Note', icon: StickyNote, className: 'text-sky-500' },
  decision: { label: 'Decision', icon: Pin, className: 'text-rose-500' },
  event: { label: 'Event', icon: Activity, className: 'text-muted-foreground' },
  postcard: { label: 'Postcard', icon: CheckCircle2, className: 'text-fuchsia-500' },
};

const CONVERSATION_MAP_OPENABLE_KINDS = new Set<ConversationMapEntryKind>([
  'document',
  'source',
  'image',
  'file',
  'postcard',
  'note',
]);

export function createPromptPreview(content: string): string {
  const source = String(content || '');
  const firstBreak = source.search(/\r?\n/);
  const previewSource = (firstBreak >= 0 ? source.slice(0, firstBreak) : source.slice(0, 360))
    .slice(0, 360);
  const firstLine = previewSource
    .replace(/\s+/g, ' ')
    .trim();
  if (!firstLine) return 'Untitled prompt';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine;
}

function PromptNavigator({
  entries,
  activeEntryId,
  onJump,
  onOpenAsset,
  storageKey,
  label,
  className,
  tone = 'default',
  disabled = false,
}: PromptNavigatorProps) {
  const [visible, setVisible] = useState(() => readVisiblePreference(storageKey));
  const [open, setOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<ConversationMapFilter['id']>>(
    () => new Set(CONVERSATION_MAP_FILTERS.map((filter) => filter.id))
  );
  const { resolvedTheme } = useTheme();
  const closeTimerRef = useRef<number | null>(null);
  const buildTone = tone === 'build';
  const buildDarkTone = buildTone && resolvedTheme === 'dark';
  const buildLightTone = buildTone && resolvedTheme === 'light';

  useEffect(() => {
    setVisible(readVisiblePreference(storageKey));
    setOpen(false);
  }, [storageKey]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const normalizedEntries = useMemo(
    () => entries
      .filter((entry) => entry.preview.trim().length > 0)
      .map((entry) => ({ ...entry, kind: entry.kind ?? 'prompt' })),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const enabledKinds = new Set<ConversationMapEntryKind>();
    for (const filter of CONVERSATION_MAP_FILTERS) {
      if (activeFilters.has(filter.id)) {
        filter.kinds.forEach((kind) => enabledKinds.add(kind));
      }
    }
    return normalizedEntries.filter((entry) => enabledKinds.has(entry.kind ?? 'prompt'));
  }, [activeFilters, normalizedEntries]);

  const countsByFilter = useMemo(() => {
    const result = new Map<ConversationMapFilter['id'], number>();
    for (const filter of CONVERSATION_MAP_FILTERS) {
      result.set(filter.id, normalizedEntries.filter((entry) => filter.kinds.includes(entry.kind ?? 'prompt')).length);
    }
    return result;
  }, [normalizedEntries]);

  if (disabled || normalizedEntries.length < 1) return null;

  const setNavigatorVisible = (nextVisible: boolean) => {
    setVisible(nextVisible);
    setOpen(false);
    writeVisiblePreference(storageKey, nextVisible);
  };

  const openNavigator = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const closeNavigatorSoon = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 180);
  };

  const toggleFilter = (filterId: ConversationMapFilter['id']) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(filterId)) {
        next.delete(filterId);
      } else {
        next.add(filterId);
      }
      if (next.size === 0) {
        return new Set(CONVERSATION_MAP_FILTERS.map((filter) => filter.id));
      }
      return next;
    });
  };

  const resetFilters = () => {
    setActiveFilters(new Set(CONVERSATION_MAP_FILTERS.map((filter) => filter.id)));
  };

  const handleEntryKeyDown = (event: KeyboardEvent<HTMLDivElement>, entry: PromptNavigatorEntry) => {
    if (event.currentTarget !== event.target) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onJump(entry);
  };

  const railEntries = filteredEntries.length > 0 ? filteredEntries : normalizedEntries;

  if (!visible) {
    return (
      <button
        type="button"
        className={cn(
          'absolute right-0 top-1/2 z-30 flex h-16 w-3 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-border/70 bg-background/90 text-muted-foreground shadow-md backdrop-blur-sm transition hover:w-6 hover:text-foreground',
          className
        )}
        title={`Show ${label}`}
        aria-label={`Show ${label}`}
        onClick={() => setNavigatorVisible(true)}
      >
        <ListTree className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div
      className={cn('absolute right-2 top-1/2 z-30 -translate-y-1/2', className)}
      onMouseEnter={openNavigator}
      onMouseLeave={closeNavigatorSoon}
    >
      <div
        className={cn(
          'relative h-[58vh] min-h-[160px] max-h-[420px] w-8'
        )}
      >
        {open ? <div className="absolute right-7 top-0 h-full w-3" aria-hidden="true" /> : null}
        {railEntries.map((entry, index) => {
          const active = entry.id === activeEntryId;
          const pinnedDecision = entry.kind === 'decision' && entry.pinned === true;
          const top = railEntries.length <= 1
            ? 50
            : (index / (railEntries.length - 1)) * 100;
          const meta = CONVERSATION_MAP_KIND_META[entry.kind ?? 'prompt'];
          return (
            <button
              key={entry.id}
              type="button"
              className="absolute right-0 flex h-3 w-8 -translate-y-1/2 items-center justify-end"
              style={{ top: `${top}%` }}
              title={entry.fullText || entry.preview}
              aria-label={`Jump to ${meta.label.toLowerCase()}: ${entry.preview}`}
              onClick={() => onJump(entry)}
            >
              <span
                className={cn(
                  'block h-[2px] rounded-full bg-foreground/35 transition-all',
                  active
                    ? 'w-7 bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.45)]'
                    : pinnedDecision
                      ? 'w-5 bg-rose-500/85 shadow-[0_0_8px_rgba(244,63,94,0.35)] hover:w-7 hover:bg-rose-500'
                      : 'w-4 hover:w-6 hover:bg-foreground/70',
                  entry.kind !== 'prompt' && !active && !pinnedDecision && 'bg-primary/45'
                )}
              />
            </button>
          );
        })}
      </div>

      {open ? (
        <div
          className={cn(
            'absolute right-9 top-1/2 w-72 -translate-y-1/2 overflow-hidden rounded-2xl border border-border/70 bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-md',
            buildLightTone && 'border-teal-300/80 bg-teal-50/95 text-teal-950 shadow-teal-700/15',
            buildDarkTone && 'border-primary/50 bg-[#0f2428]/95 text-card-foreground shadow-primary/20'
          )}
          onMouseEnter={openNavigator}
          onMouseLeave={closeNavigatorSoon}
        >
          <div
            className={cn(
              'flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2',
              buildLightTone && 'border-teal-200 bg-teal-100/80',
              buildDarkTone && 'border-primary/30 bg-[#123039]'
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">{label}</div>
              <div className="text-[10px] text-muted-foreground">
                {normalizedEntries.length} mapped item{normalizedEntries.length === 1 ? '' : 's'}
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title={`Hide ${label}`}
              aria-label={`Hide ${label}`}
              onClick={() => setNavigatorVisible(false)}
            >
              <EyeOff className="h-3.5 w-3.5" />
              Hide
            </button>
          </div>
          <div className="border-b border-border/50 px-2 py-2">
            <div className="flex flex-wrap gap-1">
              {CONVERSATION_MAP_FILTERS.map((filter) => {
                const count = countsByFilter.get(filter.id) ?? 0;
                if (count === 0) return null;
                const selected = activeFilters.has(filter.id);
                return (
                  <button
                    key={filter.id}
                    type="button"
                    className={cn(
                      'rounded-full border px-2 py-1 text-[10px] font-semibold transition',
                      selected
                        ? 'border-primary/35 bg-primary/10 text-foreground'
                        : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => toggleFilter(filter.id)}
                  >
                    {filter.label} {count}
                  </button>
                );
              })}
              {activeFilters.size < CONVERSATION_MAP_FILTERS.length ? (
                <button
                  type="button"
                  className="rounded-full px-2 py-1 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  onClick={resetFilters}
                >
                  All
                </button>
              ) : null}
            </div>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-1.5">
            {filteredEntries.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No items match those filters.
              </div>
            ) : null}
            {filteredEntries.map((entry) => {
              const active = entry.id === activeEntryId;
              const time = formatPromptTime(entry.timestamp);
              const meta = CONVERSATION_MAP_KIND_META[entry.kind ?? 'prompt'];
              const EntryIcon = meta.icon;
              const pinnedDecision = entry.kind === 'decision' && entry.pinned === true;
              const canOpenAsset = Boolean(
                onOpenAsset
                  && entry.assetUrl
                  && CONVERSATION_MAP_OPENABLE_KINDS.has(entry.kind ?? 'prompt')
              );
              const actionLabel = entry.actionLabel?.trim() || 'Open';
              return (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45',
                    active ? 'bg-primary/15 text-foreground' : 'text-popover-foreground hover:bg-muted',
                    pinnedDecision && 'ring-1 ring-rose-400/45',
                    pinnedDecision && !active && 'bg-rose-500/10 text-foreground hover:bg-rose-500/15',
                    buildLightTone && (active
                      ? 'bg-teal-200/70 text-teal-950'
                      : 'text-teal-950 hover:bg-teal-100/80'),
                    buildDarkTone && (active
                      ? 'bg-primary/20 text-card-foreground'
                      : 'text-card-foreground hover:bg-accent/40'),
                    buildLightTone && pinnedDecision && !active && 'bg-rose-100/80 text-rose-950 hover:bg-rose-100',
                    buildDarkTone && pinnedDecision && !active && 'bg-rose-500/15 text-card-foreground hover:bg-rose-500/20'
                  )}
                  title={entry.fullText || entry.preview}
                  onClick={() => onJump(entry)}
                  onKeyDown={(event) => handleEntryKeyDown(event, entry)}
                >
                  <EntryIcon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{entry.preview}</span>
                    {entry.detail ? (
                      <span className="block truncate text-[10px] text-muted-foreground">{entry.detail}</span>
                    ) : (
                      <span className="block truncate text-[10px] text-muted-foreground">{meta.label}</span>
                    )}
                  </span>
                  <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                    {pinnedDecision ? (
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-400/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600',
                          buildLightTone && 'text-rose-700',
                          buildDarkTone && 'text-rose-300'
                        )}
                      >
                        <Pin className="h-3 w-3" />
                        Pinned
                      </span>
                    ) : null}
                    {time ? <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span> : null}
                    {canOpenAsset ? (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-6 max-w-[5.75rem] items-center gap-1 rounded-md border border-border/70 bg-background/70 px-1.5 text-[10px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-foreground',
                          buildLightTone && 'border-teal-300/70 bg-teal-50/80 text-teal-800 hover:bg-teal-100 hover:text-teal-950',
                          buildDarkTone && 'border-primary/35 bg-[#123039]/90 text-card-foreground hover:bg-primary/15'
                        )}
                        title={`${actionLabel} ${entry.assetLabel || meta.label}`}
                        aria-label={`${actionLabel} ${entry.assetLabel || entry.preview}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenAsset?.(entry);
                        }}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{actionLabel}</span>
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(PromptNavigator);
