'use client';

import { useEffect, useMemo, useState } from 'react';
import type { UsagePeriod, UsageSummary } from '@accomplish/shared';
import { getAccomplish } from '../../lib/accomplish';
import { cn } from '../../lib/utils';
import { useTopBarControlsStore } from '../../stores/topBarControlsStore';
import { UsageDetailsDialog } from './UsageDetailsDialog';
import { FocusSceneButton } from '../chat/FocusScene';

function formatInt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

const PERIODS: Array<{ id: UsagePeriod; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export function GlobalUsageBanner() {
  const [period, setPeriod] = useState<UsagePeriod>('day');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const topBarActions = useTopBarControlsStore((state) => state.actions);

  const hasPricing = Boolean(summary?.currency) && summary?.cost != null;

  const subtitle = useMemo(() => {
    if (!summary) return '';
    if (!hasPricing) return 'Add pricing to see cost';
    const unpriced = summary.unpricedProviders ?? [];
    if (unpriced.length > 0) return `Partial cost (missing: ${unpriced.join(', ')})`;
    return 'Estimated cost';
  }, [summary, hasPricing]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = (await getAccomplish().getUsageSummary(period)) as UsageSummary;
        if (!cancelled) setSummary(res);
      } catch (err) {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15_000); // keep it fresh while app is open
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [period]);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpenDetails(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpenDetails(true);
          }
        }}
        className={cn(
          'w-full border-b border-border bg-background/75 backdrop-blur',
          'hover:bg-muted/40 transition-colors',
          'text-left'
        )}
        aria-label="Open usage estimate details"
      >
        <div className="flex min-h-[48px] items-center gap-3 px-4 py-1.5">
          <div data-focus-secondary="usage-periods" className="flex shrink-0 items-center gap-1 rounded-lg bg-muted p-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPeriod(p.id);
                }}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                  period === p.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="focus-usage-summary flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <div className="text-sm font-medium text-foreground truncate">
                {loading && !summary ? 'Usage' : `Tokens: ${formatInt(summary?.totalTokens ?? 0)}`}
              </div>
              {hasPricing && summary?.currency && (
                <div className="text-sm text-muted-foreground">
                  {formatMoney(summary.cost ?? 0, summary.currency)}
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
          </div>

          {!topBarActions ? (
            <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">Details</div>
          ) : null}
          {topBarActions ? (
            <div
              className="flex min-w-0 shrink items-center justify-end"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {topBarActions}
            </div>
          ) : null}
          <FocusSceneButton />
        </div>
      </div>

      <UsageDetailsDialog open={openDetails} onOpenChange={setOpenDetails} summary={summary} />
    </>
  );
}
