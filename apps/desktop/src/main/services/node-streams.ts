type StreamKind = 'mic' | 'screen';

type StreamChunk = {
  nodeId: string;
  streamId: string;
  kind: StreamKind;
  mime: string;
  dataBase64: string;
  receivedAtMs: number;
};

const latestByNodeId = new Map<string, Record<StreamKind, StreamChunk | undefined>>();

export function updateNodeStreamChunk(chunk: Omit<StreamChunk, 'receivedAtMs'>): void {
  const entry = latestByNodeId.get(chunk.nodeId) ?? { mic: undefined, screen: undefined };
  entry[chunk.kind] = {
    ...chunk,
    receivedAtMs: Date.now(),
  };
  latestByNodeId.set(chunk.nodeId, entry);
}

export function getLatestNodeStreamChunk(nodeId: string, kind: StreamKind): StreamChunk | null {
  const entry = latestByNodeId.get(nodeId);
  return entry?.[kind] ?? null;
}

export function clearLatestNodeStreamChunk(nodeId: string, kind: StreamKind): void {
  const entry = latestByNodeId.get(nodeId);
  if (!entry) return;
  delete entry[kind];
  latestByNodeId.set(nodeId, entry);
}
