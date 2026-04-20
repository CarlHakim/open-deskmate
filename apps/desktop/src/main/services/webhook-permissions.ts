import type { PermissionRequest, PermissionResponse } from '@accomplish/shared';
import { applyAllowAllForFileRequest, isFilePermissionRequest, resolvePermission } from '../permission-api';
import { hasActiveAgentEngineTask, sendAgentEngineTaskResponse } from '../runtime/agent-engine';

type PendingPermission = PermissionRequest & { createdAtMs: number };

const pendingPermissions = new Map<string, PendingPermission>();
const PERMISSION_TTL_MS = 5 * 60 * 1000;

export type QuickPermissionResolveResult = {
  handled: boolean;
  ok: boolean;
  message: string;
};

function sanitizeString(input: unknown, maxLength = 1024): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, request] of pendingPermissions.entries()) {
    if (!request.createdAtMs || now - request.createdAtMs > PERMISSION_TTL_MS) {
      pendingPermissions.delete(id);
    }
  }
}

export function enqueueWebPermissionRequest(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const request = raw as PermissionRequest;
  if (!request.id || !request.taskId) return;
  const createdAt = request.createdAt || new Date().toISOString();
  pendingPermissions.set(request.id, {
    ...request,
    createdAt,
    createdAtMs: Date.now(),
  });
}

export function listWebPermissionRequests(taskId?: string): PermissionRequest[] {
  pruneExpired();
  const all = Array.from(pendingPermissions.values());
  if (!taskId) return all;
  return all.filter((req) => req.taskId === taskId);
}

export async function resolveWebPermissionResponse(response: PermissionResponse): Promise<{ ok: boolean; error?: string }> {
  pruneExpired();
  const { requestId, taskId, decision } = response;
  if (!requestId || !taskId) {
    return { ok: false, error: 'requestId and taskId are required' };
  }

  pendingPermissions.delete(requestId);

  if (isFilePermissionRequest(requestId)) {
    if (decision === 'allow_all') {
      applyAllowAllForFileRequest(requestId);
    }
    const allowed = decision === 'allow' || decision === 'allow_all';
    const resolved = resolvePermission(requestId, allowed);
    return resolved ? { ok: true } : { ok: false, error: 'file permission request not found' };
  }

  if (!hasActiveAgentEngineTask(taskId)) {
    return { ok: false, error: 'task is not active' };
  }

  if (decision === 'allow') {
    const message =
      (response.selectedOptions && response.selectedOptions.length > 0)
        ? response.selectedOptions.join(', ')
        : sanitizeString(response.message) || 'yes';
    await sendAgentEngineTaskResponse(taskId, message);
  } else {
    await sendAgentEngineTaskResponse(taskId, 'no');
  }

  return { ok: true };
}

function parseQuickPermissionCommand(input: string): { decision: 'allow' | 'deny' | 'allow_all'; index: number } | null {
  const normalized = sanitizeString(input, 32).toLowerCase().replace(/\s+/g, '');
  const match = /^(aa|a|d)(\d{0,2})$/.exec(normalized);
  if (!match) return null;
  const token = match[1];
  const indexRaw = match[2] || '';
  const index = indexRaw ? Number.parseInt(indexRaw, 10) : 1;
  if (!Number.isFinite(index) || index < 1) return null;
  const decision: 'allow' | 'deny' | 'allow_all' =
    token === 'aa' ? 'allow_all' : token === 'a' ? 'allow' : 'deny';
  return { decision, index };
}

export async function resolveQuickPermissionReply(params: {
  text: string;
  taskIdHint?: string;
}): Promise<QuickPermissionResolveResult> {
  pruneExpired();
  const parsed = parseQuickPermissionCommand(params.text);
  if (!parsed) {
    return {
      handled: false,
      ok: false,
      message: '',
    };
  }

  const taskIdHint = sanitizeString(params.taskIdHint, 128);
  const candidates = Array.from(pendingPermissions.values())
    .filter((entry) => !taskIdHint || entry.taskId === taskIdHint)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  if (candidates.length === 0) {
    return {
      handled: true,
      ok: false,
      message: 'No pending permission request found.',
    };
  }

  const target = candidates[parsed.index - 1];
  if (!target) {
    return {
      handled: true,
      ok: false,
      message: `Only ${candidates.length} pending request(s) available.`,
    };
  }

  const decision =
    parsed.decision === 'allow_all' && target.type === 'file'
      ? 'allow_all'
      : parsed.decision === 'deny'
        ? 'deny'
        : 'allow';
  const resolved = await resolveWebPermissionResponse({
    requestId: target.id,
    taskId: target.taskId,
    decision,
  });

  if (!resolved.ok) {
    return {
      handled: true,
      ok: false,
      message: resolved.error || 'Failed to resolve permission request.',
    };
  }

  const actionLabel =
    decision === 'allow_all'
      ? 'Allowed all file permissions for this task.'
      : decision === 'allow'
        ? 'Permission allowed.'
        : 'Permission denied.';
  return {
    handled: true,
    ok: true,
    message: `${actionLabel} (${target.id})`,
  };
}
