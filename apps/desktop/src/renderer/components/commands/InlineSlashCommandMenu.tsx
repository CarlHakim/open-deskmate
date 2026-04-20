import type { ReactElement } from 'react';
import { getSlashCommandIntentLabel, type SlashCommandDefinition, type SlashCommandIntent } from '@/lib/slash-commands';
import { cn } from '@/lib/utils';

type InlineSlashCommandMenuProps = {
  commands: SlashCommandDefinition[];
  selectedIndex: number;
  onSelect: (command: SlashCommandDefinition, index: number) => void;
  placement?: 'top' | 'bottom';
  className?: string;
};

function getIntentBadgeClasses(intent?: SlashCommandIntent): string {
  switch (intent) {
    case 'navigate':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700';
    case 'inspect':
      return 'border-border/60 bg-muted text-muted-foreground';
    case 'mutate':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
    case 'danger':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-border/60 bg-muted text-muted-foreground';
  }
}

export default function InlineSlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
  placement = 'bottom',
  className,
}: InlineSlashCommandMenuProps): ReactElement | null {
  if (commands.length === 0) return null;

  return (
    <div
      className={cn(
        'absolute left-0 right-0 z-30 overflow-hidden rounded-lg border border-border bg-popover shadow-xl',
        placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        className
      )}
    >
      <div className="max-h-64 overflow-y-auto py-1">
        {commands.map((command, index) => {
          const active = index === selectedIndex;
          return (
            <button
              key={command.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(command, index)}
              className={cn(
                'flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="text-sm font-medium text-foreground">/{command.command}</div>
                  <span className={cn(
                    'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                    getIntentBadgeClasses(command.intent)
                  )}>
                    {getSlashCommandIntentLabel(command.intent)}
                  </span>
                </div>
                {command.aliases?.length ? (
                  <div className="text-[11px] text-muted-foreground">
                    {command.aliases.map((alias) => `/${alias}`).join(' · ')}
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">{command.description}</div>
                {active && command.previewText ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {command.previewText}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {command.title}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
