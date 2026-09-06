import { Children, cloneElement, isValidElement, useId, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** Selection state belongs to the composer; opening this panel never changes layout. */
export default function ComposerOptions({ children, side = 'bottom', activeCount = 0 }: {
  children: ReactNode;
  side?: 'top' | 'bottom';
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          More options
          {activeCount > 0 && <span className="text-primary">· {activeCount} active</span>}
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} sideOffset={8} align="start" collisionPadding={16}
        aria-labelledby={titleId}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden p-0 shadow-xl motion-reduce:animate-none">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">Prompt options</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close prompt options"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X aria-hidden="true" className="h-3.5 w-3.5" /> Close
          </button>
        </div>
        <div className="flex min-h-0 flex-wrap items-center gap-2 overflow-y-auto p-4">
        {Children.map(children, child => {
          if (!isValidElement<{ children?: ReactNode; className?: string; title?: string; 'aria-label'?: string; 'data-option-label'?: string }>(child) || child.type !== 'button') return child;
          const label = child.props['data-option-label'] || child.props['aria-label'] || child.props.title;
          if (!label) return child;
          return cloneElement(child, {
            className: `${(child.props.className || '').replace(/\bw-8\b/g, 'w-auto')} gap-2 px-3`,
            children: <>{child.props.children}<span className="text-xs">{label}</span></>,
          });
        })}
        </div>
        <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">Click outside or press Esc to close. Selections are kept.</p>
      </PopoverContent>
    </Popover>
  );
}
