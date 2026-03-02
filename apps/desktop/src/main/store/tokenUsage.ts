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
  const costUsd = computeCostUsd({
    usageInputTokens: usage.inputTokens,
    usageOutputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    pricing,
  });
  turns[idx] = { ...turns[idx], usage, costUsd: costUsd ?? turns[idx].costUsd };
  tokenUsageStore.set('turns', turns);
}
