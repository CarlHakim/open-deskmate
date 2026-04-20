import type { OpenCodeMessage } from '@accomplish/shared';
import { normalizeOpenCodeUsage } from '../services/context/usage-normalize';
import { updateTurnUsage } from '../store/tokenUsage';
import { recordUserSkillRunBatch } from '../services/user-skills';
import type { ActiveTurnRecord } from './task-execution-bootstrap';

export const activeTurnByTaskId = new Map<
  string,
  ActiveTurnRecord
>();

export const activeSkillRunByTaskId = new Map<
  string,
  {
    agentId?: string;
    skillIds: string[];
    startedAtMs: number;
  }
>();

export function createTaskId(prefix = 'task'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createTurnId(): string {
  // Separate from message IDs to avoid any UI key collisions.
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function trackTaskSkillRun(taskId: string, params: { agentId?: string; skillIds?: string[] }): void {
  const ids = Array.from(new Set((params.skillIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    activeSkillRunByTaskId.delete(taskId);
    return;
  }
  activeSkillRunByTaskId.set(taskId, {
    agentId: params.agentId,
    skillIds: ids,
    startedAtMs: Date.now(),
  });
}

export function finalizeTaskSkillRun(
  taskId: string,
  params: {
    success: boolean;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }
): void {
  const tracked = activeSkillRunByTaskId.get(taskId);
  if (!tracked) return;
  activeSkillRunByTaskId.delete(taskId);
  const latencyMs = Math.max(0, Date.now() - tracked.startedAtMs);
  void recordUserSkillRunBatch({
    agentId: tracked.agentId,
    skillIds: tracked.skillIds,
    success: params.success,
    latencyMs,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    error: params.error,
  });
}

export function reconcileUsageFromOpenCodeMessage(taskId: string, message: OpenCodeMessage): void {
  const active = activeTurnByTaskId.get(taskId);
  if (!active) return;

  const approxTokensForChars = (chars: number) => Math.max(0, Math.ceil(chars / 4));

  if (message.type === 'text') {
    const textMsg = message as import('@accomplish/shared').OpenCodeTextMessage;
    const messageId = textMsg.part.messageID || 'unknown';
    const nextLen = (textMsg.part.text || '').length;
    const prevLen = active.textLensByMessageId[messageId] ?? 0;
    // OpenCode may stream deltas or full-so-far text. Count only the delta.
    const deltaChars = nextLen >= prevLen ? (nextLen - prevLen) : nextLen;
    active.textLensByMessageId[messageId] = nextLen;
    active.outputTokensEst += approxTokensForChars(deltaChars);
    return;
  }

  if (message.type !== 'step_finish') return;
  const usage = normalizeOpenCodeUsage(message as import('@accomplish/shared').OpenCodeStepFinishMessage);
  if (!usage) return;

  active.acc.inputTokens += usage.inputTokens;
  active.acc.outputTokens += usage.outputTokens;
  if (typeof usage.cachedInputTokens === 'number') {
    active.acc.cachedInputTokens = (active.acc.cachedInputTokens ?? 0) + usage.cachedInputTokens;
  }

  updateTurnUsage(active.turnId, {
    inputTokens: active.acc.inputTokens,
    outputTokens: active.acc.outputTokens,
    totalTokens: active.acc.inputTokens + active.acc.outputTokens,
    cachedInputTokens: active.acc.cachedInputTokens,
    estimated: false,
  });

  const reason = (message as import('@accomplish/shared').OpenCodeStepFinishMessage).part.reason;
  if (reason === 'end_turn' || reason === 'stop' || reason === 'error') {
    console.log('[ContextIndicator] Reconciled usage', {
      taskId,
      turnId: active.turnId,
      inputTokens: active.acc.inputTokens,
      outputTokens: active.acc.outputTokens,
      cachedInputTokens: active.acc.cachedInputTokens ?? 0,
      reason,
    });
  }
}
