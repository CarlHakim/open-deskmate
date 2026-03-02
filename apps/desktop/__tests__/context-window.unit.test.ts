import { describe, expect, it } from 'vitest';
import { computeContextStats } from '@main/services/context/context-math';
import { computeCompactionThresholds } from '@main/services/context/compaction-thresholds';
import { trimHistoryToFit } from '@main/services/context/trim-history';
import { normalizeOpenCodeUsage } from '@main/services/context/usage-normalize';
import type { OpenCodeStepFinishMessage } from '@accomplish/shared';

describe('computeContextStats', () => {
  it('computes pct + remaining + safeRemainingForReply', () => {
    const stats = computeContextStats({
      contextLimitTokens: 1000,
      promptTokens: 500,
      maxOutputTokens: 200,
      headroomSafetyTokens: 100,
    });

    expect(stats.contextLimitTokens).toBe(1000);
    expect(stats.promptTokens).toBe(500);
    expect(stats.usedPct).toBeCloseTo(0.5);
    expect(stats.remainingInput).toBe(500);
    expect(stats.safeRemainingForReply).toBe(200);
  });
});

describe('trimHistoryToFit', () => {
  it('compacts oldest messages until safeRemainingForReply reaches the cushion target', () => {
    const systemTextBase = 'x'.repeat(800); // ~200 tokens
    const newMessageText = 'y'.repeat(400); // ~100 tokens
    const historyLines = Array.from({ length: 8 }).map((_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'h'.repeat(300), // ~75 tokens per line (+ formatting)
    }));

    const contextLimitTokens = 510;
    const thresholds = computeCompactionThresholds({ contextLimitTokens });
    const result = trimHistoryToFit({
      provider: 'openai',
      contextLimitTokens,
      maxOutputTokens: 100,
      headroomSafetyTokens: 50,
      systemTextBase,
      newMessageText,
      historyLines,
      summaryAfterDropped: 6,
    });

    expect(result.droppedMessages).toBeGreaterThan(0);
    // Token estimation is heuristic, so allow a 1-token rounding wiggle.
    expect(result.context.safeRemainingForReply).toBeGreaterThanOrEqual(thresholds.targetTokens - 1);
  });

  it('inserts a summary when more than N messages are dropped', () => {
    const systemTextBase = 'x'.repeat(800); // ~200 tokens
    const newMessageText = 'y'.repeat(400); // ~100 tokens
    const historyLines = Array.from({ length: 20 }).map((_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `line-${i} ` + 'h'.repeat(260),
    }));

    const result = trimHistoryToFit({
      provider: 'openai',
      contextLimitTokens: 700,
      maxOutputTokens: 100,
      headroomSafetyTokens: 50,
      systemTextBase,
      newMessageText,
      historyLines,
      summaryAfterDropped: 6,
    });

    expect(result.droppedMessages).toBeGreaterThan(6);
    expect(result.summaryInserted).toBe(true);
    expect(result.summaryText).toMatch(/Session compaction summary \(auto\):/);
  });
});

describe('normalizeOpenCodeUsage', () => {
  it('maps OpenCode step_finish tokens into NormalizedUsage', () => {
    const msg: OpenCodeStepFinishMessage = {
      type: 'step_finish',
      part: {
        id: 'prt_1',
        sessionID: 'ses_1',
        messageID: 'msg_1',
        type: 'step-finish',
        reason: 'end_turn',
        tokens: {
          input: 10,
          output: 5,
          reasoning: 2,
          cache: { read: 3, write: 0 },
        },
      },
    };

    const usage = normalizeOpenCodeUsage(msg);
    expect(usage).not.toBeNull();
    expect(usage?.inputTokens).toBe(10);
    expect(usage?.outputTokens).toBe(5);
    expect(usage?.totalTokens).toBe(17);
    expect(usage?.cachedInputTokens).toBe(3);
    expect(usage?.estimated).toBe(false);
  });
});
