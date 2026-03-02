import type { ContextTokenEstimate, ContextWindowStats, ProviderType } from '@accomplish/shared';
import { computeContextStats } from './context-math';
import { estimateTokens } from './token-estimator';
import { formatSessionLines } from './session-history';
import { computeCompactionThresholds } from './compaction-thresholds';

function buildSummaryFromDropped(
  dropped: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxChars: number
): string {
  const userLines = dropped.filter((d) => d.role === 'user').map((d) => d.content);
  const assistantLines = dropped.filter((d) => d.role === 'assistant').map((d) => d.content);

  const oneLine = (s: string) => (s || '').trim().split('\n')[0]?.trim() ?? '';
  const truncate = (s: string, max = 180) => (s.length > max ? `${s.slice(0, max - 1).trim()}…` : s);

  const goals = userLines
    .map(oneLine)
    .filter((s) => /(^please\b|\bi want\b|\bneed\b|\btrying to\b|\bgoal\b|\bmake\b|\bimplement\b)/i.test(s))
    .slice(0, 4)
    .map((s) => `- ${truncate(s)}`);

  const constraints = [...userLines, ...assistantLines]
    .map(oneLine)
    .filter((s) => /\b(must|should|don't|do not|never|only|avoid|required|constraint|limit)\b/i.test(s))
    .slice(0, 5)
    .map((s) => `- ${truncate(s)}`);

  const openItems = [...userLines, ...assistantLines]
    .map(oneLine)
    .filter((s) => /\b(todo|next step|next steps|follow[- ]?up|fix|bug|investigate|verify|test)\b/i.test(s))
    .slice(0, 5)
    .map((s) => `- ${truncate(s)}`);

  const snippets = [
    ...userLines.map(oneLine).filter(Boolean).slice(0, 6).map((s) => `- User: ${truncate(s)}`),
    ...assistantLines.map(oneLine).filter(Boolean).slice(0, 4).map((s) => `- Assistant: ${truncate(s)}`),
  ].slice(0, 10);

  const sections: string[] = [];
  if (goals.length) sections.push('Goals:', ...goals);
  if (constraints.length) sections.push('Constraints / requirements:', ...constraints);
  if (openItems.length) sections.push('Open items:', ...openItems);
  if (!sections.length && snippets.length) sections.push('Key snippets:', ...snippets);

  if (!sections.length) return '';
  const summary = ['Session compaction summary (auto):', ...sections].join('\n');
  if (maxChars <= 0) return '';
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars - 1).trimEnd()}…`;
}

export function trimHistoryToFit(params: {
  provider: ProviderType;
  contextLimitTokens: number;
  maxOutputTokens: number;
  headroomSafetyTokens?: number;
  compactionMode?: 'preemptive' | 'unsafeOnly';
  // System prompt text WITHOUT the conversation excerpt; summary will be appended here.
  systemTextBase: string;
  retrievedText?: string;
  newMessageText: string;
  historyLines: Array<{ role: 'user' | 'assistant'; content: string; pinned?: boolean }>;
  summaryAfterDropped?: number;
}): {
  includedLines: Array<{ role: 'user' | 'assistant'; content: string; pinned?: boolean }>;
  droppedMessages: number;
  summaryInserted: boolean;
  summaryText: string;
  estimate: ContextTokenEstimate;
  context: ContextWindowStats;
} {
  const headroomSafetyTokens = params.headroomSafetyTokens ?? 1024;
  const retrievedText = params.retrievedText ?? '';
  const summaryAfterDropped = params.summaryAfterDropped ?? 6;
  const thresholds =
    params.compactionMode === 'unsafeOnly'
      ? { triggerTokens: 0, targetTokens: 0 }
      : computeCompactionThresholds({ contextLimitTokens: params.contextLimitTokens });

  const allLines = [...params.historyLines];
  let includedLines = [...allLines];
  let droppedMessages = 0;
  let summaryInserted = false;
  let summaryText = '';
  const dropped: Array<{ role: 'user' | 'assistant'; content: string; pinned?: boolean }> = [];

  const dropOldest = (): void => {
    if (includedLines.length === 0) return;
    const idx = includedLines.findIndex((l) => !l.pinned);
    const removed = idx >= 0 ? includedLines.splice(idx, 1)[0] : includedLines.shift();
    if (!removed) return;
    dropped.push(removed);
    droppedMessages += 1;
  };

  const compute = (summary: string): { estimate: ContextTokenEstimate; context: ContextWindowStats } => {
    const historyBlock = includedLines.length
      ? ['Recent conversation:', formatSessionLines(includedLines)].join('\n')
      : '';
    const systemText = summary ? `${params.systemTextBase}\n\n${summary}` : params.systemTextBase;
    const estimate = estimateTokens({
      provider: params.provider,
      systemText,
      toolsText: '',
      retrievedText,
      historyText: historyBlock,
      newMessageText: params.newMessageText,
    });
    const context = computeContextStats({
      contextLimitTokens: params.contextLimitTokens,
      promptTokens: estimate.promptTokensEst,
      maxOutputTokens: params.maxOutputTokens,
      headroomSafetyTokens,
    });
    return { estimate, context };
  };

  let { estimate, context } = compute(summaryText);
  while (includedLines.length > 0) {
    const threshold = droppedMessages === 0 ? thresholds.triggerTokens : thresholds.targetTokens;
    if (context.safeRemainingForReply >= threshold) break;
    dropOldest();
    if (droppedMessages > summaryAfterDropped) {
      // Only insert a summary if we can afford it while still hitting our cushion target.
      // Otherwise, skip summary to avoid turning compaction into a context-length failure.
      const base = compute('');
      const budgetForSummaryTokens =
        params.contextLimitTokens -
        params.maxOutputTokens -
        headroomSafetyTokens -
        thresholds.targetTokens -
        base.estimate.promptTokensEst;

      if (budgetForSummaryTokens >= 8) {
        const maxSummaryChars = Math.min(3200, Math.floor(budgetForSummaryTokens * 4));
        summaryText = buildSummaryFromDropped(dropped, maxSummaryChars);
      } else {
        summaryText = '';
      }
      summaryInserted = Boolean(summaryText);
    }
    ({ estimate, context } = compute(summaryText));
  }

  // If we're still unsafe even after dropping everything, callers should treat this as fatal.
  // This mirrors the main preparePayload behavior (hard-fail instead of sending an invalid payload).
  if (context.safeRemainingForReply < 0) {
    throw new Error('Unable to fit prompt within the model context window (even after trimming history).');
  }

  return { includedLines, droppedMessages, summaryInserted, summaryText, estimate, context };
}
