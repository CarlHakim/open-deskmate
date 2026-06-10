import Store from 'electron-store';
import type { UsageBudgetSettings, UsageBudgetStatus } from '@accomplish/shared';
import { getUsageSummary } from '../services/usage-summary';

type UsageBudgetSchema = UsageBudgetSettings;

const store = new Store<UsageBudgetSchema>({
  name: 'usage-budgets',
  defaults: {
    limits: [],
    updatedAt: new Date(0).toISOString(),
  },
});

function normalizeLimit(input: UsageBudgetSettings['limits'][number]): UsageBudgetSettings['limits'][number] {
  return {
    id: String(input.id || `budget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    agentId: input.agentId ? String(input.agentId) : null,
    period: input.period === 'day' || input.period === 'week' || input.period === 'month' ? input.period : 'month',
    amount: typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount >= 0 ? input.amount : null,
    currency: input.currency,
    enabled: input.enabled !== false,
    mode: input.mode === 'block' ? 'block' : 'warn',
  };
}

export function getUsageBudgetSettings(): UsageBudgetSettings {
  return {
    limits: (store.get('limits') || []).map(normalizeLimit),
    updatedAt: store.get('updatedAt') || new Date(0).toISOString(),
  };
}

export function setUsageBudgetSettings(settings: UsageBudgetSettings): UsageBudgetSettings {
  const next: UsageBudgetSettings = {
    limits: Array.isArray(settings.limits) ? settings.limits.map(normalizeLimit) : [],
    updatedAt: new Date().toISOString(),
  };
  store.set('limits', next.limits);
  store.set('updatedAt', next.updatedAt);
  return next;
}

export function getUsageBudgetStatus(agentId?: string | null): UsageBudgetStatus[] {
  const settings = getUsageBudgetSettings();
  return settings.limits
    .filter((limit) => limit.enabled)
    .filter((limit) => !limit.agentId || !agentId || limit.agentId === agentId)
    .map((limit) => {
      const summary = getUsageSummary(limit.period);
      const spent = summary.cost;
      const exceeded = spent != null && limit.amount != null && spent >= limit.amount;
      return {
        id: limit.id,
        agentId: limit.agentId,
        period: limit.period,
        spent,
        limit: limit.amount,
        currency: limit.currency || summary.currency,
        percent: spent != null && limit.amount && limit.amount > 0 ? Math.min(999, (spent / limit.amount) * 100) : null,
        exceeded,
        blocking: exceeded && limit.mode === 'block',
        mode: limit.mode,
      };
    });
}
