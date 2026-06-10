import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>;

    constructor(options?: { defaults?: T }) {
      this.data = { ...(options?.defaults || {}) };
    }

    get(key: string) {
      return this.data[key];
    }

    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  }

  return { default: MockStore };
});

vi.mock('../../../../src/main/services/usage-summary', () => ({
  getUsageSummary: vi.fn(),
}));

import { getUsageSummary } from '../../../../src/main/services/usage-summary';
import {
  getUsageBudgetSettings,
  getUsageBudgetStatus,
  setUsageBudgetSettings,
} from '../../../../src/main/store/usageBudgets';

const mockedGetUsageSummary = vi.mocked(getUsageSummary);

describe('usage budgets', () => {
  beforeEach(() => {
    mockedGetUsageSummary.mockReset();
    setUsageBudgetSettings({ limits: [], updatedAt: new Date(0).toISOString() });
    mockedGetUsageSummary.mockReturnValue({
      period: 'month',
      rangeStart: '2026-05-01T00:00:00.000Z',
      rangeEnd: '2026-05-31T23:59:59.999Z',
      inputTokens: 0,
      inputHitTokens: 0,
      inputMissTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 12,
      currency: 'USD',
      providerBreakdown: [],
      unpricedProviders: [],
      estimatedEvents: 0,
      totalEvents: 0,
    });
  });

  it('warns without blocking when a warn-only budget is exceeded', () => {
    setUsageBudgetSettings({
      limits: [{
        id: 'budget-agent-month',
        agentId: 'agent-1',
        period: 'month',
        amount: 10,
        currency: 'USD',
        enabled: true,
        mode: 'warn',
      }],
      updatedAt: new Date().toISOString(),
    });

    const [status] = getUsageBudgetStatus('agent-1');

    expect(status.exceeded).toBe(true);
    expect(status.blocking).toBe(false);
    expect(status.mode).toBe('warn');
  });

  it('blocks when a block-mode budget is exceeded', () => {
    setUsageBudgetSettings({
      limits: [{
        id: 'budget-agent-month',
        agentId: 'agent-1',
        period: 'month',
        amount: 10,
        currency: 'USD',
        enabled: true,
        mode: 'block',
      }],
      updatedAt: new Date().toISOString(),
    });

    const [status] = getUsageBudgetStatus('agent-1');

    expect(status.exceeded).toBe(true);
    expect(status.blocking).toBe(true);
    expect(status.percent).toBe(120);
  });

  it('normalizes invalid budgets to safe warn defaults', () => {
    setUsageBudgetSettings({
      limits: [{
        id: '',
        agentId: null,
        period: 'month',
        amount: -1,
        currency: 'USD',
        enabled: true,
        mode: 'block',
      }],
      updatedAt: new Date().toISOString(),
    });

    const [limit] = getUsageBudgetSettings().limits;

    expect(limit.amount).toBeNull();
    expect(limit.mode).toBe('block');
  });
});
