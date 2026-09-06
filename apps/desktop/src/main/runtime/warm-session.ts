import type { Task } from '@accomplish/shared';
import { resolveSelectedModelForAgent } from '../services/agent-context';
import { getMiniMaxHistoricalImageSessionResetReason } from '../services/context/image-history-policy';

const WARM_SESSION_WINDOW_MS = Number(process.env.OPENDESKMATE_WARM_SESSION_WINDOW_MS || 5 * 60 * 1000);
const TERMINAL_STATUSES = new Set(['completed', 'interrupted', 'failed', 'cancelled']);

/** Shared eligibility and model policy for desktop and dispatched task reuse. */
export function findReusableWarmSession(params: {
  taskId: string;
  previousTask?: (Task & { sessionFilePath?: string }) | null;
  agentId?: string;
  prompt: string;
  attachedFiles?: string[];
  logPrefix: string;
}): { sessionId: string; ageMs: number } | undefined {
  const previous = params.previousTask;
  if (!previous || previous.id === params.taskId || !previous.sessionId || !TERMINAL_STATUSES.has(previous.status)) return;
  const completedAtMs = Date.parse(previous.completedAt || previous.createdAt || '');
  const ageMs = Date.now() - completedAtMs;
  if (!Number.isFinite(completedAtMs) || ageMs > WARM_SESSION_WINDOW_MS) return;
  const resetReason = getMiniMaxHistoricalImageSessionResetReason({
    selectedModel: resolveSelectedModelForAgent(params.agentId || previous.agentId),
    prompt: params.prompt,
    currentAttachedFiles: params.attachedFiles,
    sessionId: previous.sessionId,
    sessionFilePath: previous.sessionFilePath,
    task: previous,
  });
  if (resetReason) {
    console.log(`${params.logPrefix} Skipping warm MiniMax session reuse:`, {
      fromTaskId: previous.id,
      sessionId: previous.sessionId,
      reason: resetReason,
    });
    return;
  }
  return { sessionId: previous.sessionId, ageMs };
}
