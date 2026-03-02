import Store from 'electron-store';
import type { ProviderType } from '@accomplish/shared';
import type { TokenTurnLog } from '../store/tokenUsage';

type TokenUsageSchema = { turns: TokenTurnLog[] };
const tokenUsageStore = new Store<TokenUsageSchema>({ name: 'token-usage', defaults: { turns: [] } });

export function listModelsUsed(limitPerProvider = 50): Record<string, string[]> {
  const turns = tokenUsageStore.get('turns') ?? [];
  const byProvider = new Map<ProviderType, Set<string>>();

  for (const t of turns) {
    if (!t?.provider || !t?.model) continue;
    const set = byProvider.get(t.provider) ?? new Set<string>();
    if (set.size >= limitPerProvider) continue;
    set.add(t.model);
    byProvider.set(t.provider, set);
  }

  const out: Record<string, string[]> = {};
  for (const [provider, set] of byProvider.entries()) {
    out[provider] = Array.from(set.values()).sort();
  }
  return out;
}

