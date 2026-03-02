import type { ContextTokenEstimate, ProviderType } from '@accomplish/shared';

function approxTokensFromText(text: string): number {
  if (!text) return 0;
  // Conservative-ish English-ish heuristic.
  return Math.ceil(text.length / 4);
}

export function estimateTokens(params: {
  provider: ProviderType;
  systemText: string;
  toolsText?: string;
  retrievedText?: string;
  historyText?: string;
  newMessageText: string;
}): ContextTokenEstimate {
  // Provider-specific tokenizers can be added here without changing callers.
  // For now, we use a fast heuristic and mark as estimated.
  void params.provider;
  const system = approxTokensFromText(params.systemText);
  const tools = approxTokensFromText(params.toolsText || '');
  const retrieved = approxTokensFromText(params.retrievedText || '');
  const history = approxTokensFromText(params.historyText || '');
  const newMessage = approxTokensFromText(params.newMessageText);
  const promptTokensEst = system + tools + retrieved + history + newMessage;
  return {
    promptTokensEst,
    estimated: true,
    breakdown: { system, tools, retrieved, history, newMessage },
  };
}
