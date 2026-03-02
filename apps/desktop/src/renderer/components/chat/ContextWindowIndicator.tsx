import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ContextWindowEstimateResponse } from '@accomplish/shared';

function pct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function classifyColor(usedPct: number): 'green' | 'yellow' | 'red' {
  const p = usedPct * 100;
  if (p >= 85) return 'red';
  if (p >= 70) return 'yellow';
  return 'green';
}

function badgeClasses(kind: 'green' | 'yellow' | 'red'): string {
  switch (kind) {
    case 'red':
      return 'border-red-500/25 bg-red-500/10 text-red-700';
    case 'yellow':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-800';
    default:
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700';
  }
}

export default function ContextWindowIndicator(props: {
  stats: ContextWindowEstimateResponse | null;
  className?: string;
  compact?: boolean;
}) {
  const s = props.stats;
  if (!s) return null;

  const usedPct = s.context.usedPct;
  const color = classifyColor(usedPct);
  const safeRemaining = Math.floor(s.context.safeRemainingForReply);

  return (
    <div className={props.className ?? ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={[
              'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
              badgeClasses(color),
            ].join(' ')}
          >
          <span>
            Context: {s.estimate.promptTokensEst} / {s.context.contextLimitTokens} ({pct(usedPct)}%)
          </span>
          <span className="opacity-70">•</span>
          <span>Room for reply: ~{safeRemaining} tokens</span>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="ml-1 inline-flex items-center justify-center rounded-full p-0.5 opacity-70 hover:opacity-100"
                aria-label="Context window details"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-w-xs text-xs leading-relaxed text-foreground" align="start">
              Includes system prompt, tools, retrieved docs, and message history included in this request.
              {s.trimmed ? (
                <div className="mt-2 text-muted-foreground">
                  Trimmed {s.droppedMessages} older message(s){s.summaryInserted ? ' and inserted a summary' : ''} to
                  fit.
                </div>
              ) : null}
              {import.meta.env.DEV ? (
                <div className="mt-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px]">
                  <div>system: {s.estimate.breakdown.system}</div>
                  <div>tools: {s.estimate.breakdown.tools}</div>
                  <div>retrieved: {s.estimate.breakdown.retrieved}</div>
                  <div>history: {s.estimate.breakdown.history}</div>
                  <div>newMessage: {s.estimate.breakdown.newMessage}</div>
                  <div className="mt-1 opacity-70">{s.estimate.estimated ? 'estimated' : 'exact'}</div>
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
          </div>

          {s.trimmed ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              Context compacted: dropped {s.droppedMessages} older message(s)
              {s.summaryInserted ? ', summary inserted' : ''}.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
