import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, ListTree } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

export interface PromptNavigatorEntry {
  id: string;
  messageIndex: number;
  preview: string;
  fullText?: string;
  timestamp?: string;
}

interface PromptNavigatorProps {
  entries: PromptNavigatorEntry[];
  activeEntryId?: string | null;
  onJump: (entry: PromptNavigatorEntry) => void;
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

export function createPromptPreview(content: string): string {
  const firstLine = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!firstLine) return 'Untitled prompt';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine;
}

function PromptNavigator({
  entries,
  activeEntryId,
  onJump,
  storageKey,
  label,
  className,
  tone = 'default',
  disabled = false,
}: PromptNavigatorProps) {
  const [visible, setVisible] = useState(() => readVisiblePreference(storageKey));
  const [open, setOpen] = useState(false);
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
    () => entries.filter((entry) => entry.preview.trim().length > 0),
    [entries]
  );

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
        {normalizedEntries.map((entry, index) => {
          const active = entry.id === activeEntryId;
          const top = normalizedEntries.length <= 1
            ? 50
            : (index / (normalizedEntries.length - 1)) * 100;
          return (
            <button
              key={entry.id}
              type="button"
              className="absolute right-0 flex h-3 w-8 -translate-y-1/2 items-center justify-end"
              style={{ top: `${top}%` }}
              title={entry.fullText || entry.preview}
              aria-label={`Jump to prompt: ${entry.preview}`}
              onClick={() => onJump(entry)}
            >
              <span
                className={cn(
                  'block h-[2px] rounded-full bg-foreground/35 transition-all',
                  active ? 'w-7 bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.45)]' : 'w-4 hover:w-6 hover:bg-foreground/70'
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
              <div className="text-[10px] text-muted-foreground">{normalizedEntries.length} prompts</div>
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
          <div className="max-h-[360px] overflow-y-auto p-1.5">
            {normalizedEntries.map((entry) => {
              const active = entry.id === activeEntryId;
              const time = formatPromptTime(entry.timestamp);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition',
                    active ? 'bg-primary/15 text-foreground' : 'text-popover-foreground hover:bg-muted',
                    buildLightTone && (active
                      ? 'bg-teal-200/70 text-teal-950'
                      : 'text-teal-950 hover:bg-teal-100/80'),
                    buildDarkTone && (active
                      ? 'bg-primary/20 text-card-foreground'
                      : 'text-card-foreground hover:bg-accent/40')
                  )}
                  title={entry.fullText || entry.preview}
                  onClick={() => onJump(entry)}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      active ? 'bg-primary' : 'bg-muted-foreground/45'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.preview}</span>
                  {time ? <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(PromptNavigator);
