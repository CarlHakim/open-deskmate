type NodeRuntimeState = {
  cameraActive: boolean;
  updatedAtMs: number;
};

const runtimeByNodeId = new Map<string, NodeRuntimeState>();

export function setNodeCameraActive(nodeId: string, active: boolean): void {
  if (!nodeId) return;
  runtimeByNodeId.set(nodeId, { cameraActive: active, updatedAtMs: Date.now() });
}

export function getNodeCameraActive(nodeId: string): NodeRuntimeState | null {
  if (!nodeId) return null;
  return runtimeByNodeId.get(nodeId) ?? null;
}
