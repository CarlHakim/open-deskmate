import type { GatewayConnectorExtensionId, PermissionRequest } from '@accomplish/shared';
import { sendConnectorOutboundMessage } from '../services/connector-outbound';
import type { GatewayRouteContext } from './task-dispatch-runtime';

const SUPPORTED_GATEWAY_CONNECTOR_IDS = new Set<GatewayConnectorExtensionId>([
  'discord',
  'telegram',
  'slack',
  'matrix',
  'msteams',
  'mattermost',
  'googlechat',
  'signal',
  'whatsapp',
  'line',
  'bluebubbles',
  'imessage',
  'nextcloud-talk',
  'nostr',
  'tlon',
  'zalo',
  'zalouser',
]);

function asGatewayConnectorId(input: string | undefined): GatewayConnectorExtensionId | null {
  const normalized = (input ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return SUPPORTED_GATEWAY_CONNECTOR_IDS.has(normalized as GatewayConnectorExtensionId)
    ? (normalized as GatewayConnectorExtensionId)
    : null;
}

export function toPermissionRequest(input: unknown): PermissionRequest | null {
  if (!input || typeof input !== 'object') return null;
  const request = input as PermissionRequest;
  if (!request.id || !request.taskId) return null;
  return request;
}

function formatPermissionPromptForConnector(request: PermissionRequest): string {
  const headline = request.type === 'file'
    ? `Permission needed: ${String(request.fileOperation || 'file').toUpperCase()} ${request.filePath || ''}`.trim()
    : `Permission needed: ${request.question || `Allow ${request.toolName || 'this action'}?`}`;
  const targetLine = request.targetPath ? `Target: ${request.targetPath}` : '';
  const previewLine = request.contentPreview ? `Preview: ${request.contentPreview}` : '';
  return [
    headline,
    targetLine,
    previewLine,
    'Reply: a=allow, d=deny, aa=allow-all-task.',
    'If multiple pending, use index: a2 / d2 / aa2 (1 = latest).',
    'Example: reply `a` now.',
  ].filter(Boolean).join('\n');
}

export async function sendGatewayPermissionPrompt(params: {
  route?: GatewayRouteContext;
  request: PermissionRequest;
}): Promise<void> {
  const route = params.route;
  if (!route?.channel || !route.peerKind || !route.peerId) return;
  const connectorId = asGatewayConnectorId(route.channel);
  if (!connectorId) return;
  try {
    await sendConnectorOutboundMessage({
      connectorId,
      connectorInstanceId: route.connectorInstanceId,
      accountId: route.accountId,
      targetId: route.peerId,
      targetKind: route.peerKind,
      text: formatPermissionPromptForConnector(params.request),
    });
  } catch (error) {
    console.warn('[TaskDispatch] Failed to send connector permission prompt:', error);
  }
}
