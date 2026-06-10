import type { NormalizedUsage, OpenCodeStepFinishMessage, ProviderType } from '@accomplish/shared';

type UsageRecord = Record<string, unknown>;

function asRecord(value: unknown): UsageRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UsageRecord
    : null;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readPath(record: UsageRecord, path: string[]): number | undefined {
  let current: unknown = record;
  for (const segment of path) {
    const currentRecord = asRecord(current);
    if (!currentRecord || !(segment in currentRecord)) return undefined;
    current = currentRecord[segment];
  }
  return toFiniteNumber(current);
}

function firstNumber(record: UsageRecord, paths: string[][]): number | undefined {
  for (const path of paths) {
    const value = readPath(record, path);
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function tokenCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function costValue(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  return typeof parsed === 'number' && parsed >= 0 ? parsed : undefined;
}

function extractUsageRecord(raw: unknown): UsageRecord | null {
  const record = asRecord(raw);
  if (!record) return null;
  return asRecord(record.usage)
    ?? asRecord(record.usageMetadata)
    ?? asRecord(record.usage_metadata)
    ?? record;
}

function extractCachedInputTokens(record: UsageRecord): number | undefined {
  return firstNumber(record, [
    ['cache', 'read'],
    ['cache', 'hit'],
    ['cache', 'readTokens'],
    ['cache', 'read_tokens'],
    ['cache', 'readInputTokens'],
    ['cache', 'read_input_tokens'],
    ['cacheRead'],
    ['cache_read'],
    ['cacheReadTokens'],
    ['cache_read_tokens'],
    ['cacheReadInputTokens'],
    ['cache_read_input_tokens'],
    ['cachedInput'],
    ['cached_input'],
    ['cachedInputTokens'],
    ['cached_input_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['promptTokensDetails', 'cachedTokens'],
    ['input_tokens_details', 'cached_tokens'],
    ['inputTokensDetails', 'cachedTokens'],
    ['cached_content_token_count'],
    ['cachedContentTokenCount'],
  ]);
}

function extractCacheCreationInputTokens(record: UsageRecord): number | undefined {
  return firstNumber(record, [
    ['cache', 'write'],
    ['cache', 'miss'],
    ['cache', 'writeTokens'],
    ['cache', 'write_tokens'],
    ['cache', 'creation'],
    ['cache', 'creationTokens'],
    ['cache', 'creation_tokens'],
    ['cacheWrite'],
    ['cache_write'],
    ['cacheWriteTokens'],
    ['cache_write_tokens'],
    ['cacheCreation'],
    ['cache_creation'],
    ['cacheCreationInputTokens'],
    ['cache_creation_input_tokens'],
  ]);
}

function normalizeUsageRecord(record: UsageRecord, provider?: ProviderType, directProviderPayload = false): NormalizedUsage | null {
  const inputRaw = firstNumber(record, [
    ['input'],
    ['inputTokens'],
    ['input_tokens'],
    ['promptTokens'],
    ['prompt_tokens'],
    ['promptTokenCount'],
    ['prompt_token_count'],
  ]);
  const outputRaw = firstNumber(record, [
    ['output'],
    ['outputTokens'],
    ['output_tokens'],
    ['completionTokens'],
    ['completion_tokens'],
    ['completionTokenCount'],
    ['completion_token_count'],
    ['candidatesTokenCount'],
    ['candidates_token_count'],
  ]);
  const reasoningRaw = firstNumber(record, [
    ['reasoning'],
    ['reasoningTokens'],
    ['reasoning_tokens'],
    ['completion_tokens_details', 'reasoning_tokens'],
    ['completionTokensDetails', 'reasoningTokens'],
  ]);
  const cachedInputRaw = extractCachedInputTokens(record);
  const cacheCreationRaw = extractCacheCreationInputTokens(record);

  const hasAnyUsageValue = [inputRaw, outputRaw, reasoningRaw, cachedInputRaw, cacheCreationRaw]
    .some((value) => typeof value === 'number');
  if (!hasAnyUsageValue) return null;

  const baseInputTokens = tokenCount(inputRaw);
  const cachedInputTokens = tokenCount(cachedInputRaw);
  const cacheCreationInputTokens = tokenCount(cacheCreationRaw);
  let inputTokens = baseInputTokens;

  // Anthropic direct responses split uncached input, cache creation, and cache read tokens.
  // OpenCode step_finish tokens are already normalized, so only expand direct provider payloads.
  if (directProviderPayload && provider === 'anthropic') {
    inputTokens += cacheCreationInputTokens + cachedInputTokens;
  }

  const reasoningTokens = tokenCount(reasoningRaw);
  // Providers bill reasoning/thinking tokens as output tokens.
  const outputTokens = tokenCount(outputRaw) + reasoningTokens;
  const inputHitTokens = typeof cachedInputRaw === 'number' ? cachedInputTokens : undefined;
  const inputMissTokens = directProviderPayload
    ? provider === 'anthropic'
      ? baseInputTokens + cacheCreationInputTokens
      : Math.max(0, inputTokens - (inputHitTokens ?? 0))
    : (typeof cachedInputRaw === 'number' || typeof cacheCreationRaw === 'number')
      ? baseInputTokens + cacheCreationInputTokens
      : inputTokens;
  const billableInputTokens = (inputHitTokens ?? 0) + inputMissTokens;

  // Some providers/models don't report usage via OpenCode and emit tokens as zeros.
  // Treat that as "not reported" so we don't overwrite estimated usage with 0.
  if (billableInputTokens + outputTokens === 0 && typeof cachedInputRaw !== 'number' && typeof cacheCreationRaw !== 'number') {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: billableInputTokens + outputTokens,
    cachedInputTokens: inputHitTokens,
    inputHitTokens,
    inputMissTokens,
    estimated: false,
  };
}

export function normalizeOpenCodeUsage(message: OpenCodeStepFinishMessage): NormalizedUsage | null {
  const tokens = extractUsageRecord(message.part.tokens);
  const usage = tokens ? normalizeUsageRecord(tokens) : null;
  if (!usage) return null;
  const reportedCost = costValue(message.part.cost);
  return reportedCost == null ? usage : { ...usage, costUsd: reportedCost };
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
  const usage = extractUsageRecord(raw);
  return usage ? normalizeUsageRecord(usage, provider, true) : null;
}
