import { randomUUID } from 'crypto';

type NodeCommand = {
  id: string;
  nodeId: string;
  command: string;
  params?: unknown;
  createdAtMs: number;
  timeoutMs: number;
};

type PendingResult = {
  resolve: (value: NodeCommandResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  nodeId: string;
};

export type NodeCommandResult = {
  ok: boolean;
  payload?: unknown;
  error?: string | null;
};

const DEFAULT_TIMEOUT_MS = 20_000;

const queueByNodeId = new Map<string, NodeCommand[]>();
const inFlightById = new Map<string, PendingResult>();

function enqueueCommand(nodeId: string, command: string, params?: unknown, timeoutMs?: number): NodeCommand {
  const commandItem: NodeCommand = {
    id: randomUUID(),
    nodeId,
    command,
    params,
    createdAtMs: Date.now(),
    timeoutMs: typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };

  const queue = queueByNodeId.get(nodeId) ?? [];
  queue.push(commandItem);
  queueByNodeId.set(nodeId, queue);
  return commandItem;
}

function dequeueCommand(nodeId: string): NodeCommand | null {
  const queue = queueByNodeId.get(nodeId);
  if (!queue || queue.length === 0) return null;
  const next = queue.shift() ?? null;
  if (queue.length === 0) {
    queueByNodeId.delete(nodeId);
  } else {
    queueByNodeId.set(nodeId, queue);
  }
  return next;
}

export function takeNextNodeCommand(nodeId: string): NodeCommand | null {
  return dequeueCommand(nodeId);
}

export async function invokeNodeCommand(params: {
  nodeId: string;
  command: string;
  payload?: unknown;
  timeoutMs?: number;
}): Promise<NodeCommandResult> {
  const commandItem = enqueueCommand(params.nodeId, params.command, params.payload, params.timeoutMs);

  return await new Promise<NodeCommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      inFlightById.delete(commandItem.id);
      reject(new Error('Node command timed out.'));
    }, commandItem.timeoutMs);

    inFlightById.set(commandItem.id, {
      resolve,
      reject,
      timer,
      nodeId: params.nodeId,
    });
  });
}

export function completeNodeCommandResult(params: {
  nodeId: string;
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string | null;
}): boolean {
  const pending = inFlightById.get(params.id);
  if (!pending) return false;
  if (pending.nodeId !== params.nodeId) return false;
  clearTimeout(pending.timer);
  inFlightById.delete(params.id);
  pending.resolve({
    ok: params.ok,
    payload: params.payload,
    error: params.error ?? null,
  });
  return true;
}

export function listQueuedNodeCommands(nodeId: string): NodeCommand[] {
  return queueByNodeId.get(nodeId) ?? [];
}
