'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CHAT_BACKGROUND_CHANGED_EVENT,
  CHAT_BACKGROUND_STORAGE_KEY,
  CHAT_BACKGROUNDS,
  DEFAULT_CHAT_BACKGROUND_ID,
  getChatBackground,
  normalizeChatBackgroundId,
  readChatBackgroundId,
  writeChatBackgroundId,
} from '@/lib/chat-backgrounds';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function useChatBackgroundSelection() {
  const [selectedId, setSelectedIdState] = useState(readChatBackgroundId);

  useEffect(() => {
    const handleBackgroundChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const nextId = typeof detail?.id === 'string' ? detail.id : readChatBackgroundId();
      setSelectedIdState(normalizeChatBackgroundId(nextId));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CHAT_BACKGROUND_STORAGE_KEY) {
        setSelectedIdState(normalizeChatBackgroundId(event.newValue));
      }
    };
    window.addEventListener(CHAT_BACKGROUND_CHANGED_EVENT, handleBackgroundChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CHAT_BACKGROUND_CHANGED_EVENT, handleBackgroundChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setSelectedId = useCallback((id: string) => {
    const normalized = normalizeChatBackgroundId(id);
    setSelectedIdState(normalized);
    writeChatBackgroundId(normalized);
  }, []);

  const selectedBackground = getChatBackground(selectedId);
  const backgroundStyle = useMemo<CSSProperties>(() => {
    if (!selectedBackground) return {};
    return {
      backgroundImage: `linear-gradient(135deg, hsl(var(--background) / 0.22), hsl(var(--background) / 0.38)), url("${selectedBackground.src}")`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
    };
  }, [selectedBackground]);

  return {
    selectedId,
    selectedBackground,
    backgroundStyle,
    setSelectedId,
  };
}

type ChatBackgroundSwitcherProps = {
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
};

export default function ChatBackgroundSwitcher({ selectedId, onSelect, className }: ChatBackgroundSwitcherProps) {
  const normalizedSelectedId = normalizeChatBackgroundId(selectedId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'absolute right-6 top-4 z-30 rounded-full border border-border/25 bg-background/24 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em]',
            'text-foreground/55 shadow-sm shadow-black/10 backdrop-blur-sm transition-all duration-200',
            'hover:border-border/45 hover:bg-background/42 hover:text-foreground/80',
            'focus:outline-none focus:ring-2 focus:ring-primary/30',
            '[text-shadow:0_1px_7px_rgb(0_0_0_/_0.34)]',
            className
          )}
          aria-label="Choose chat background"
          title="Choose chat background"
        >
          Background
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[360px] p-3">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">Chat background</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Changes only the Chat mode background, not the bubbles.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSelect(DEFAULT_CHAT_BACKGROUND_ID)}
            className={cn(
              'group relative overflow-hidden rounded-lg border p-2 text-left transition-colors',
              normalizedSelectedId === DEFAULT_CHAT_BACKGROUND_ID
                ? 'border-primary/60 bg-primary/10'
                : 'border-border bg-background hover:border-primary/40'
            )}
          >
            <div className="mb-2 h-20 rounded-md border border-border/70 bg-gradient-to-br from-background via-muted/40 to-background" />
            <div className="text-xs font-medium text-foreground">Default theme</div>
            <div className="text-[11px] text-muted-foreground">Dark or light theme background</div>
            {normalizedSelectedId === DEFAULT_CHAT_BACKGROUND_ID ? (
              <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            ) : null}
          </button>

          {CHAT_BACKGROUNDS.map((background) => {
            const selected = normalizedSelectedId === background.id;
            return (
              <button
                key={background.id}
                type="button"
                onClick={() => onSelect(background.id)}
                className={cn(
                  'group relative overflow-hidden rounded-lg border p-2 text-left transition-colors',
                  selected
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border bg-background hover:border-primary/40'
                )}
                title={background.label}
              >
                <img
                  src={background.src}
                  alt={background.label}
                  className="mb-2 h-20 w-full rounded-md border border-border/70 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  loading="lazy"
                />
                <div className="truncate text-xs font-medium text-foreground">{background.label}</div>
                {selected ? (
                  <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
