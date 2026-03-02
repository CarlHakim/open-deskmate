'use client';

import { useMemo } from 'react';
import type { UsageSummary } from '@accomplish/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { cn } from '../../lib/utils';

function formatInt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

export function UsageDetailsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: UsageSummary | null;
}) {
  const { open, onOpenChange, summary } = props;

  const rows = useMemo(() => summary?.providerBreakdown ?? [], [summary]);
  const unpriced = summary?.unpricedProviders ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Usage estimate</DialogTitle>
        </DialogHeader>

        <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
          {!summary ? (
            <div className="text-sm text-muted-foreground">No data yet.</div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Input</div>
                    <div className="text-sm font-medium">{formatInt(summary.inputTokens)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Output</div>
                    <div className="text-sm font-medium">{formatInt(summary.outputTokens)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="text-sm font-medium">{formatInt(summary.totalTokens)}</div>
                  </div>
                </div>

                {summary.cost != null && summary.currency && (
                  <div className="mt-3 text-sm">
                    <span className="text-muted-foreground">Estimated cost: </span>
                    <span className="font-medium">{formatMoney(summary.cost, summary.currency)}</span>
                  </div>
                )}

                {summary.cost == null && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    Add pricing in Settings to see estimated cost.
                  </div>
                )}

                {unpriced.length > 0 && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Partial cost: missing pricing for {unpriced.join(', ')}.
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-medium mb-2">By provider</div>
                <div className="space-y-2">
                  {rows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No events in this period.</div>
                  ) : (
                    rows.map((r) => {
                      const isUnpriced = r.cost == null && r.totalTokens > 0;
                      return (
                        <div
                          key={r.provider}
                          className={cn(
                            'flex items-center justify-between rounded-md border border-border px-3 py-2',
                            isUnpriced && 'opacity-80'
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{r.provider}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatInt(r.totalTokens)} tokens
                              {r.unpricedEvents > 0 ? ` • ${r.unpricedEvents} unpriced` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            {summary.currency && r.cost != null ? (
                              <div className="text-sm font-medium">{formatMoney(r.cost, summary.currency)}</div>
                            ) : (
                              <div className="text-sm text-muted-foreground">{isUnpriced ? 'Unpriced' : '—'}</div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Token usage is logged when a request completes. When providers don&apos;t report usage, estimates may be used.
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

