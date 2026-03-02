import { describe, expect, test } from 'vitest';
import type { UsagePricingSettings } from '@accomplish/shared';
import { computeUsageSummaryForPeriod, getPeriodRange } from '../src/main/services/usage-summary';

function turn(opts: {
  id: string;
  createdAt: string;
  provider: 'openai' | 'anthropic' | 'google' | 'xai';
  model?: string;
  input: number;
  output: number;
  estimated?: boolean;
}) {
  const total = opts.input + opts.output;
  return {
    id: opts.id,
    taskId: 'task1',
    createdAt: opts.createdAt,
    provider: opts.provider,
    model: opts.model ?? 'test-model',
    contextLimitTokens: 128000,
    maxOutputTokens: 1024,
    headroomSafetyTokens: 512,
    promptTokensEst: opts.input,
    estimated: true,
    breakdown: { system: 0, tools: 0, retrieved: 0, history: 0, newMessage: 0 },
    trimmed: false,
    droppedMessages: 0,
    summaryInserted: false,
    shouldResetSession: false,
    usage: {
      inputTokens: opts.input,
      outputTokens: opts.output,
      totalTokens: total,
      estimated: opts.estimated ?? false,
    },
  };
}

describe('usage-summary', () => {
  test('getPeriodRange week starts on Monday', () => {
    // Use a local-time date so the test doesn't depend on timezone conversions.
    // Feb 4, 2026 is Wednesday.
    const now = new Date(2026, 1, 4, 12, 0, 0);
    const { start } = getPeriodRange('week', now);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  test('computeUsageSummaryForPeriod aggregates tokens and cost with effectiveFrom selection', () => {
    const now = new Date('2026-02-04T10:00:00.000Z');
    const pricing: UsagePricingSettings = {
      currency: 'USD',
      updatedAt: now.toISOString(),
      providers: [
        {
          provider: 'openai',
          model: null,
          inputCostPer1m: 2,
          outputCostPer1m: 4,
          effectiveFrom: '2026-01-01',
          pricingSource: 'manual',
          pricingUpdatedAt: now.toISOString(),
          createdAt: now.toISOString(),
        },
        {
          provider: 'openai',
          model: null,
          inputCostPer1m: 3,
          outputCostPer1m: 6,
          effectiveFrom: '2026-02-03',
          pricingSource: 'manual',
          pricingUpdatedAt: now.toISOString(),
          createdAt: now.toISOString(),
        },
      ],
    };

    const turns = [
      turn({ id: 't1', createdAt: '2026-02-02T10:00:00.000Z', provider: 'openai', model: 'gpt-test', input: 1000, output: 500 }),
      turn({ id: 't2', createdAt: '2026-02-04T09:00:00.000Z', provider: 'openai', model: 'gpt-test', input: 2000, output: 1000 }),
      turn({ id: 't3', createdAt: '2026-02-04T09:00:00.000Z', provider: 'anthropic', input: 300, output: 100 }),
    ];

    const summary = computeUsageSummaryForPeriod({
      period: 'month',
      turns,
      pricing,
      now,
    });

    expect(summary.totalTokens).toBe(4900);
    expect(summary.unpricedProviders).toContain('anthropic');
    expect(summary.cost).not.toBeNull();

    // openai costs:
    // t1 uses 2/4 pricing -> (1000/1e6)*2 + (500/1e6)*4 = 0.002 + 0.002 = 0.004
    // t2 uses 3/6 pricing -> (2000/1e6)*3 + (1000/1e6)*6 = 0.006 + 0.006 = 0.012
    // total = 0.016
    expect(summary.cost).toBeCloseTo(0.016, 10);
  });

  test('model-specific pricing overrides provider default', () => {
    const now = new Date('2026-02-04T10:00:00.000Z');
    const pricing: UsagePricingSettings = {
      currency: 'USD',
      updatedAt: now.toISOString(),
      providers: [
        {
          provider: 'openai',
          model: null,
          inputCostPer1m: 1,
          outputCostPer1m: 1,
          effectiveFrom: null,
          pricingSource: 'manual',
          pricingUpdatedAt: now.toISOString(),
          createdAt: now.toISOString(),
        },
        {
          provider: 'openai',
          model: 'gpt-special',
          inputCostPer1m: 10,
          outputCostPer1m: 20,
          effectiveFrom: null,
          pricingSource: 'manual',
          pricingUpdatedAt: now.toISOString(),
          createdAt: now.toISOString(),
        },
      ],
    };

    const turns = [
      turn({ id: 't1', createdAt: '2026-02-04T09:00:00.000Z', provider: 'openai', model: 'gpt-special', input: 1000, output: 1000 }),
    ];

    const summary = computeUsageSummaryForPeriod({ period: 'month', turns, pricing, now });
    // (1000/1e6)*10 + (1000/1e6)*20 = 0.03
    expect(summary.cost).toBeCloseTo(0.03, 10);
  });
});
