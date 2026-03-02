import type { NormalizedUsage, OpenCodeStepFinishMessage, ProviderType } from '@accomplish/shared';

export function normalizeOpenCodeUsage(message: OpenCodeStepFinishMessage): NormalizedUsage | null {
  const tokens = message.part.tokens;
  if (!tokens) return null;
  const total = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0);
  const cached = tokens.cache?.read;

  // Some providers/models don't report usage via OpenCode and emit tokens as zeros.
  // Treat that as "not reported" so we don't overwrite estimated usage with 0.
  if (total === 0 && typeof cached !== 'number') {
    return null;
  }
  return {
    inputTokens: tokens.input ?? 0,
    outputTokens: tokens.output ?? 0,
    totalTokens: total,
    cachedInputTokens: typeof cached === 'number' ? cached : undefined,
    estimated: false,
  };
}

export function normalizeProviderUsage(
  provider: ProviderType,
  raw: unknown
): NormalizedUsage | null {
  // Currently, OpenDeskmate gets usage through OpenCode step_finish tokens.
  // This adapter is a placeholder for future direct-provider calls.
  if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'step_finish') {
    return normalizeOpenCodeUsage(raw as OpenCodeStepFinishMessage);
  }
  void provider;
  return null;
}
