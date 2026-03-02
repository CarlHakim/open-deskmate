import type { ContextWindowStats } from '@accomplish/shared';

export function computeContextStats(params: {
  contextLimitTokens: number;
  promptTokens: number;
  maxOutputTokens: number;
  headroomSafetyTokens?: number;
}): ContextWindowStats {
  const contextLimitTokens = Math.max(1, Math.floor(params.contextLimitTokens));
  const promptTokens = Math.max(0, Math.floor(params.promptTokens));
  const maxOutputTokens = Math.max(0, Math.floor(params.maxOutputTokens));
  // Default headroom is intentionally conservative to reduce provider "context length exceeded"
  // surprises when estimates are slightly low (especially with tools/JSON).
  const headroomSafetyTokens = Math.max(0, Math.floor(params.headroomSafetyTokens ?? 1024));

  const usedPct = promptTokens / contextLimitTokens;
  const remainingInput = contextLimitTokens - promptTokens;
  const safeRemainingForReply = contextLimitTokens - promptTokens - maxOutputTokens - headroomSafetyTokens;

  return {
    contextLimitTokens,
    maxOutputTokens,
    headroomSafetyTokens,
    promptTokens,
    usedPct,
    remainingInput,
    safeRemainingForReply,
  };
}
