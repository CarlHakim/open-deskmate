export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Provider-reported cached input/prompt tokens. These are cache hits/read tokens. */
  cachedInputTokens?: number;
  /** Cached input/prompt tokens charged at the input cache-hit/read price. */
  inputHitTokens?: number;
  /** Uncached input/prompt tokens charged at the input cache-miss/new-token price. */
  inputMissTokens?: number;
  /** Provider/OpenCode reported cost in USD when available. */
  costUsd?: number;
  /** Optional manual usage project for per-project cost/token tracking. */
  usageProjectId?: string | null;
  estimated: boolean;
}
