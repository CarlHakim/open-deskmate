import type { Task, TaskConfig } from '@accomplish/shared';
import { updateTaskSessionMemorySaved } from '../store/taskHistory';
import { saveSessionMemorySnapshot } from '../services/memory';
import { buildAttachmentsPrefix } from '../utils/file-attachments';
import { computeCompactionThresholds } from '../services/context/compaction-thresholds';
import { getActiveAgentEngineTaskId } from './agent-engine';

const WARM_SESSION_WINDOW_MS = Number(process.env.OPENDESKMATE_WARM_SESSION_WINDOW_MS || 5 * 60 * 1000);
const AGENTIC_LOOP_DEFAULT_MAX_ITERATIONS = 4;
const AGENTIC_LOOP_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const AGENTIC_LOOP_PROTOCOL_APPEND = [
  'Agentic loop protocol:',
  '- Work in cycles: think, plan, act, observe.',
  '- Continue until the task is complete or blocked by a real constraint.',
  '- Optional (helps orchestration): include LOOP_STATUS: CONTINUE or LOOP_STATUS: COMPLETE near the end.',
].join('\n');

export function joinPromptParts(...parts: Array<string | undefined>): string | undefined {
  const next = parts.map((part) => String(part || '').trim()).filter(Boolean);
  return next.length > 0 ? next.join('\n\n') : undefined;
}

export function sanitizeAttachedFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const next = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, 20);
  return next.length > 0 ? next : undefined;
}

export function applyTaskHookInputPatch(baseConfig: TaskConfig, patch?: Record<string, unknown>): TaskConfig {
  if (!patch) return baseConfig;
  const next: TaskConfig = { ...baseConfig };
  if (typeof patch.workingDirectory === 'string') {
    const workingDirectory = patch.workingDirectory.trim();
    next.workingDirectory = workingDirectory || undefined;
  }
  if (Array.isArray(patch.attachedFiles)) {
    next.attachedFiles = sanitizeAttachedFiles(patch.attachedFiles);
  }
  if (patch.requiresBrowser === true || patch.requiresBrowser === false) {
    next.requiresBrowser = patch.requiresBrowser;
  }
  if (patch.speedMode === 'fast' || patch.speedMode === 'balanced' || patch.speedMode === 'deep') {
    next.speedMode = patch.speedMode;
  }
  if (patch.privacyMode === 'normal' || patch.privacyMode === 'incognito') {
    next.privacyMode = patch.privacyMode;
  }
  return next;
}

export function shouldRunMemoryFlushFromContext(params: {
  memoryFlushCount?: number;
  contextLimitTokens: number;
  usedPct: number;
  safeRemainingForReply: number;
}): boolean {
  if ((params.memoryFlushCount ?? 0) >= 1) return false;
  const thresholds = computeCompactionThresholds({ contextLimitTokens: params.contextLimitTokens });
  return params.usedPct > 0.75 || params.safeRemainingForReply < thresholds.triggerTokens;
}

export async function buildRetrievedAttachmentText(attachedFiles?: string[]): Promise<string> {
  const filePaths = Array.isArray(attachedFiles)
    ? attachedFiles
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 20)
    : [];
  if (filePaths.length === 0) {
    return '';
  }
  const { prompt } = await buildAttachmentsPrefix(filePaths);
  return prompt;
}

type PersistedTaskSnapshot = Task & {
  completedAt?: string;
  createdAt?: string;
  sessionMemorySavedAt?: string;
};

export function maybeReuseWarmSession(params: {
  config: TaskConfig;
  taskId: string;
  previousTask?: PersistedTaskSnapshot | null;
  gatewaySessionKey?: string;
}): void {
  const { config, taskId, previousTask, gatewaySessionKey } = params;
  if (gatewaySessionKey || config.sessionId || !previousTask || previousTask.id === taskId || !previousTask.sessionId) {
    return;
  }
  const terminalStatuses = new Set(['completed', 'interrupted', 'failed', 'cancelled']);
  if (!terminalStatuses.has(previousTask.status)) {
    return;
  }
  const completedAtMs = Date.parse(previousTask.completedAt || previousTask.createdAt || '');
  if (!Number.isFinite(completedAtMs) || (Date.now() - completedAtMs) > WARM_SESSION_WINDOW_MS) {
    return;
  }
  config.sessionId = previousTask.sessionId;
  console.log('[TaskDispatch] Reusing warm session', {
    fromTaskId: previousTask.id,
    sessionId: previousTask.sessionId,
    ageMs: Date.now() - completedAtMs,
  });
}

export function schedulePreviousSessionMemorySnapshot(params: {
  previousTask?: PersistedTaskSnapshot | null;
  nextTaskId: string;
  agentId: string;
  source?: string;
}): void {
  const { previousTask, nextTaskId, agentId, source } = params;
  if (
    !previousTask
    || previousTask.id === nextTaskId
    || previousTask.sessionMemorySavedAt
    || !previousTask.messages?.length
  ) {
    return;
  }

  const runSnapshotWhenIdle = (attempt = 0) => {
    const activeTaskId = getActiveAgentEngineTaskId();
    if (activeTaskId) {
      if (attempt < 36) {
        setTimeout(() => runSnapshotWhenIdle(attempt + 1), 5000);
      } else {
        console.warn('[TaskDispatch] Skipping session memory snapshot (still busy after retries)');
      }
      return;
    }
    void (async () => {
      try {
        const memoryPath = await saveSessionMemorySnapshot(previousTask, agentId, source || 'manual');
        if (memoryPath) {
          updateTaskSessionMemorySaved(previousTask.id, new Date().toISOString());
        }
      } catch (error) {
        console.warn('[TaskDispatch] Failed to save session memory snapshot:', error);
      }
    })();
  };

  setTimeout(() => runSnapshotWhenIdle(), 0);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(typeof value === 'string' ? value : '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function resolveAgenticLoopConfig(
  agent: {
    agenticLoopEnabled?: boolean;
    agenticLoopMaxIterations?: number;
    agenticLoopTimeoutMs?: number;
  },
  options?: {
    internal?: {
      suppressAgenticLoop?: boolean;
    };
  }
): { enabled: boolean; maxIterations: number; timeoutMs: number } {
  if (options?.internal?.suppressAgenticLoop) {
    return {
      enabled: false,
      maxIterations: AGENTIC_LOOP_DEFAULT_MAX_ITERATIONS,
      timeoutMs: AGENTIC_LOOP_DEFAULT_TIMEOUT_MS,
    };
  }
  return {
    enabled: Boolean(agent.agenticLoopEnabled),
    maxIterations: clampInteger(agent.agenticLoopMaxIterations, AGENTIC_LOOP_DEFAULT_MAX_ITERATIONS, 1, 20),
    timeoutMs: clampInteger(agent.agenticLoopTimeoutMs, AGENTIC_LOOP_DEFAULT_TIMEOUT_MS, 15_000, 3_600_000),
  };
}

export function appendAgenticLoopProtocol(baseSystemPromptAppend: string, loopEnabled: boolean): string {
  if (!loopEnabled) return baseSystemPromptAppend;
  return [baseSystemPromptAppend, AGENTIC_LOOP_PROTOCOL_APPEND]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');
}
