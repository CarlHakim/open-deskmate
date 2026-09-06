import Store from 'electron-store';
import type { ContextTokenBreakdown, NormalizedUsage, ProviderType } from '@accomplish/shared';
import { computeCostUsd, getPricingForModel } from '../services/context/model-registry';

export type TokenTurnLog = {
  id: string;
  taskId: string;
  createdAt: string;
  provider: ProviderType;
  model: string;
  contextLimitTokens: number;
  maxOutputTokens: number;
  headroomSafetyTokens: number;
  promptTokensEst: number;
  estimated: boolean;
  breakdown: ContextTokenBreakdown;
  trimmed: boolean;
  droppedMessages: number;
  summaryInserted: boolean;
  shouldResetSession: boolean;
  usageProjectId?: string | null;
  usage?: NormalizedUsage;
  costUsd?: number;
};

type TokenUsageSchema = {
  turns: TokenTurnLog[];
};

const tokenUsageStore = new Store<TokenUsageSchema>({
  name: 'token-usage',
  defaults: { turns: [] },
});

const MAX_TURNS = 2000;
export function getTaskCost(taskId: string): { costUsd: number; costIncomplete: boolean } {
  const turns = (tokenUsageStore.get('turns') ?? []).filter(turn => turn.taskId === taskId);
  return {
    costUsd: turns.reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0),
    costIncomplete: turns.length === 0 || turns.some(turn => turn.costUsd === undefined),
  };
}

export function addTurnLog(entry: TokenTurnLog): void {
  const turns = tokenUsageStore.get('turns') ?? [];
  turns.unshift(entry);
  if (turns.length > MAX_TURNS) {
    turns.splice(MAX_TURNS);
  }
  tokenUsageStore.set('turns', turns);
}

export function updateTurnUsage(turnId: string, usage: NormalizedUsage): void {
  const turns = tokenUsageStore.get('turns') ?? [];
  const idx = turns.findIndex((t) => t.id === turnId);
  if (idx === -1) return;
  const pricing = getPricingForModel(turns[idx].model);
  const cachedInputTokens = usage.inputHitTokens ?? usage.cachedInputTokens;
  const billableInputTokens = (usage.inputHitTokens ?? 0) + (usage.inputMissTokens ?? Math.max(0, usage.inputTokens - (cachedInputTokens ?? 0)));
  const costUsd = computeCostUsd({
    usageInputTokens: billableInputTokens || usage.inputTokens,
    usageOutputTokens: usage.outputTokens,
    cachedInputTokens,
    pricing,
  });
  turns[idx] = { ...turns[idx], usage, costUsd: usage.costUsd ?? costUsd ?? turns[idx].costUsd };
  tokenUsageStore.set('turns', turns);
}

export function updateTaskTurnUsageProject(taskIds: string[], usageProjectId: string | null): number {
  const ids = new Set(taskIds.map((taskId) => String(taskId || '').trim()).filter(Boolean));
  if (ids.size === 0) return 0;

  const turns = tokenUsageStore.get('turns') ?? [];
  let changed = 0;
  const next = turns.map((turn) => {
    if (!ids.has(turn.taskId)) return turn;
    if ((turn.usageProjectId ?? null) === usageProjectId) return turn;
    changed += 1;
    return { ...turn, usageProjectId };
  });

  if (changed > 0) {
    tokenUsageStore.set('turns', next);
  }
  return changed;
}
