export type CompactionThresholds = {
  // Start compacting when safeRemainingForReply drops below this.
  triggerTokens: number;
  // Stop compacting when safeRemainingForReply is at/above this.
  targetTokens: number;
};

export function computeCompactionThresholds(params: {
  contextLimitTokens: number;
  triggerAbsTokens?: number; // cap for large-context models
  triggerPct?: number; // fallback for small-context models / tests
  targetAbsTokens?: number;
  targetPct?: number;
}): CompactionThresholds {
  const limit = Math.max(1, Math.floor(params.contextLimitTokens));
  const triggerAbsTokens = Math.max(0, Math.floor(params.triggerAbsTokens ?? 4000));
  const targetAbsTokens = Math.max(0, Math.floor(params.targetAbsTokens ?? 10000));
  const triggerPct = Number.isFinite(params.triggerPct) ? (params.triggerPct as number) : 0.03;
  const targetPct = Number.isFinite(params.targetPct) ? (params.targetPct as number) : 0.07;

  // Percent-based thresholds keep behavior sane for small contexts (e.g. unit tests)
  // while still matching our intended 2k-12k cushion for large contexts.
  const trigger = Math.min(triggerAbsTokens, Math.max(0, Math.floor(limit * triggerPct)));
  const target = Math.min(targetAbsTokens, Math.max(0, Math.floor(limit * targetPct)));

  // Ensure target is always >= trigger (otherwise we'd compact forever).
  const targetTokens = Math.max(target, trigger);
  return { triggerTokens: trigger, targetTokens };
}

