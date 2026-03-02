import http from 'http';
import { URL } from 'url';
import { randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { dialog } from 'electron';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GatewayAuthMode, GatewayRuntimeStatus, GatewayTailscaleMode, UsagePeriod } from '@accomplish/shared';
import { dispatchTask, resumeTaskSession } from './task-dispatch';
import { listWebPermissionRequests, resolveWebPermissionResponse } from './webhook-permissions';
import { getTask, getTasks, updateTaskSummary, updateTaskStatus } from '../store/taskHistory';
import { getTaskManager } from '../opencode/task-manager';
import {
  getFolder,
  getFoldersForAgent,
  createFolder,
  updateFolder,
  deleteFolder,
  getTaskFolderAssignments,
  setTaskFolder,
} from '../store/folderStore';
import { listAgents, getDefaultAgentId, getAgent } from '../store/agents';
import { composeAgentSystemPromptAppend, getAgentContext, resolveActiveAgentId } from './agent-context';
import { getGatewayConfig } from '../store/gatewayConfig';
import {
  getMobileNodesDisplayName,
  getMobileNodesEnabled,
  getWebhookBindMode,
  getSelectedModel,
  setActiveAgentId,
} from '../store/appSettings';
import { getGatewayPassword, getGatewayToken } from '../store/secureStorage';
import {
  cancelNodePairingByNodeId,
  getPairedNode,
  getPendingNodePairingByNodeId,
  requestNodePairing,
  updatePairedNodeLastSeen,
  verifyNodeToken,
} from '../store/nodePairing';
import { getVoiceWakeConfig, setVoiceWakeConfig } from '../store/voiceWake';
import { completeNodeCommandResult, takeNextNodeCommand } from './node-commands';
import { getNodeCameraActive, setNodeCameraActive } from './node-runtime';
import { updateNodeStreamChunk } from './node-streams';
import { markWebchatActivity } from './user-presence';
import {
  disableTailscaleFunnel,
  disableTailscaleServe,
  enableTailscaleFunnel,
  enableTailscaleServe,
  getTailnetHostname,
} from './tailscale';
import {
  resolveAgentIdFromSessionKey,
  resolveGatewayRoute,
  type GatewayRoutePeer,
} from './gateway-routing';
import {
  deleteGatewaySession,
  getGatewaySession,
  listGatewaySessions,
} from '../store/gatewaySessions';
import {
  listGatewayBindings,
  removeGatewayBinding,
  setGatewayBindings,
  upsertGatewayBinding,
  type GatewayPeerKind,
  type GatewayRouteBinding,
} from '../store/gatewayBindings';
import {
  listSavedPrompts,
  upsertSavedPrompt,
  deleteSavedPrompt,
} from '../store/savedPrompts';
import { preparePayloadForSend } from './context/prepare-payload';
import { buildAttachmentsPrefix } from '../utils/file-attachments';
import {
  isGatewayConnectorExtensionId,
  resolveGatewayConnectorExtensionConfig,
} from '../store/gatewayConnectorExtensions';
import { recordGatewayConnectorObservation } from '../store/gatewayConnectorDiscovery';
import { handleAppConnectorOAuthCallback } from './app-connector-oauth';
import { getUsageSummary } from './usage-summary';

export const WEBHOOK_PORT = 18888;

export function getWebhookBindHost(): string {
  return getWebhookBindMode() === 'all' ? '0.0.0.0' : '127.0.0.1';
}

export function getWebhookLocalUrl(): string {
  return `http://127.0.0.1:${WEBHOOK_PORT}`;
}

export function getWebhookLanUrls(): string[] {
  if (getWebhookBindMode() !== 'all') return [];
  const interfaces = os.networkInterfaces();
  const urls = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      urls.add(`http://${entry.address}:${WEBHOOK_PORT}`);
    }
  }
  return Array.from(urls);
}

const WEBCHAT_UPLOAD_DIR = path.join(os.tmpdir(), 'open-deskmate', 'webchat-uploads');
const MAX_WEBCHAT_UPLOAD_BYTES = 20 * 1024 * 1024;

function ensureWebchatUploadDir(): void {
  fs.mkdirSync(WEBCHAT_UPLOAD_DIR, { recursive: true });
}

function sanitizeUploadFileName(input: string): string {
  const raw = path.basename(String(input || '').trim()) || 'attachment.bin';
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(0, 128) || 'attachment.bin';
}

async function selectLocalFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Working Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return String(result.filePaths[0] || '').trim() || null;
}

type GatewayAuth = {
  mode: GatewayAuthMode;
  token?: string;
  password?: string;
  allowTailscale: boolean;
  tailscaleMode: GatewayTailscaleMode;
};

let gatewayAuth: GatewayAuth = {
  mode: 'none',
  allowTailscale: true,
  tailscaleMode: 'off',
};

let tailscaleCleanup: (() => Promise<void>) | null = null;
let tailscaleError: string | null = null;
let lastTailscaleMode: GatewayTailscaleMode = 'off';
let lastTailscaleResetOnExit = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpenDeskmate-Token, X-OpenDeskmate-Password',
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isLoopbackAddress(ip?: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1') return true;
  if (ip.startsWith('127.')) return true;
  if (ip === '::1') return true;
  if (ip.startsWith('::ffff:127.')) return true;
  return false;
}

function getHostName(hostHeader?: string): string {
  const host = (hostHeader ?? '').trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(1, end);
  }
  const [name] = host.split(':');
  return name ?? '';
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function firstCommaHeaderValue(value: string | undefined): string {
  if (!value) return '';
  const [head] = value.split(',');
  return (head ?? '').trim();
}

function normalizeForwardedProto(value: string | undefined): 'http' | 'https' {
  const normalized = firstCommaHeaderValue(value).toLowerCase();
  return normalized === 'https' ? 'https' : 'http';
}

function getRequestOrigin(req: http.IncomingMessage): string {
  const forwardedHost = firstCommaHeaderValue(headerValue(req.headers['x-forwarded-host']));
  const host = forwardedHost || firstCommaHeaderValue(headerValue(req.headers.host)) || `127.0.0.1:${WEBHOOK_PORT}`;
  const forwardedProto = headerValue(req.headers['x-forwarded-proto']);
  const proto = normalizeForwardedProto(forwardedProto);
  return `${proto}://${host}`;
}

function isLocalDirectRequest(req?: http.IncomingMessage): boolean {
  if (!req) return false;
  if (!isLoopbackAddress(req.socket?.remoteAddress ?? '')) return false;

  const host = getHostName(req.headers?.host);
  const hostIsLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!hostIsLocal) return false;

  const hasForwarded = Boolean(
    req.headers?.['x-forwarded-for'] ||
      req.headers?.['x-real-ip'] ||
      req.headers?.['x-forwarded-host']
  );

  return !hasForwarded;
}

function hasForwardedHeaders(req?: http.IncomingMessage): boolean {
  if (!req) return false;
  return Boolean(
    req.headers['x-forwarded-for'] &&
      req.headers['x-forwarded-proto'] &&
      req.headers['x-forwarded-host']
  );
}

function isTailscaleProxyRequest(req?: http.IncomingMessage): boolean {
  if (!req) return false;
  return isLoopbackAddress(req.socket?.remoteAddress ?? '') && hasForwardedHeaders(req);
}

function getTailscaleUserLogin(req?: http.IncomingMessage): string | null {
  if (!req) return null;
  const login = req.headers['tailscale-user-login'];
  if (typeof login !== 'string' || !login.trim()) return null;
  return login.trim();
}

function getAuthFromRequest(req: http.IncomingMessage): { token?: string; password?: string } {
  const tokenHeader = headerValue(req.headers['x-opendeskmate-token']);
  const passwordHeader = headerValue(req.headers['x-opendeskmate-password']);
  const authHeader = headerValue(req.headers.authorization);

  let token = typeof tokenHeader === 'string' && tokenHeader.trim() ? tokenHeader.trim() : undefined;
  let password =
    typeof passwordHeader === 'string' && passwordHeader.trim() ? passwordHeader.trim() : undefined;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) token = bearer;
  }

  if (authHeader && authHeader.toLowerCase().startsWith('basic ')) {
    const encoded = authHeader.slice(6).trim();
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const basicPassword = separator >= 0 ? decoded.slice(separator + 1) : decoded;
      if (basicPassword) {
        password = basicPassword;
      }
    } catch {
      // ignore invalid basic auth
    }
  }

  return { token, password };
}

function shouldMarkWebchatActivity(pathname: string): boolean {
  return pathname === '/'
    || pathname === '/auth/info'
    || pathname === '/tasks'
    || pathname.startsWith('/tasks/')
    || pathname === '/context/estimate'
    || pathname === '/folders'
    || pathname.startsWith('/folders/')
    || pathname === '/permissions'
    || pathname.startsWith('/permissions/')
    || pathname === '/agents'
    || pathname === '/agents/set-active';
}

function authorizeGatewayRequest(req: http.IncomingMessage): { ok: boolean; reason?: string } {
  const auth = gatewayAuth;
  const localDirect = isLocalDirectRequest(req);

  if (auth.allowTailscale && auth.tailscaleMode !== 'off' && !localDirect) {
    const tailscaleUser = getTailscaleUserLogin(req);
    const tailscaleProxy = isTailscaleProxyRequest(req);
    if (tailscaleUser && tailscaleProxy) {
      return { ok: true };
    }
    if (auth.mode === 'none') {
      if (!tailscaleUser) {
        return { ok: false, reason: 'tailscale_user_missing' };
      }
      if (!tailscaleProxy) {
        return { ok: false, reason: 'tailscale_proxy_missing' };
      }
    }
  }

  if (auth.mode === 'none') {
    return { ok: true };
  }

  const { token, password } = getAuthFromRequest(req);

  if (auth.mode === 'token') {
    if (!auth.token) {
      return { ok: false, reason: 'token_missing_config' };
    }
    if (!token) {
      return { ok: false, reason: 'token_missing' };
    }
    if (token !== auth.token) {
      return { ok: false, reason: 'token_mismatch' };
    }
    return { ok: true };
  }

  if (auth.mode === 'password') {
    if (!auth.password) {
      return { ok: false, reason: 'password_missing_config' };
    }
    if (!password) {
      return { ok: false, reason: 'password_missing' };
    }
    if (!safeEqual(password, auth.password)) {
      return { ok: false, reason: 'password_mismatch' };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'unauthorized' };
}

async function applyTailscaleExposure(): Promise<void> {
  const config = getGatewayConfig();
  const modeChanged = config.tailscaleMode !== lastTailscaleMode;
  const resetChanged = config.tailscaleResetOnExit !== lastTailscaleResetOnExit;

  if (!modeChanged && resetChanged) {
    if (!config.tailscaleResetOnExit) {
      tailscaleCleanup = null;
    } else {
      tailscaleCleanup = async () => {
        if (config.tailscaleMode === 'serve') {
          await disableTailscaleServe();
        } else if (config.tailscaleMode === 'funnel') {
          await disableTailscaleFunnel();
        }
      };
    }
    lastTailscaleResetOnExit = config.tailscaleResetOnExit;
    return;
  }

  if (!modeChanged) {
    return;
  }

  if (tailscaleCleanup) {
    try {
      await tailscaleCleanup();
    } catch {
      // Ignore cleanup failures
    }
    tailscaleCleanup = null;
  }
  tailscaleError = null;

  if (config.tailscaleMode === 'off') {
    // Always disable exposure when switching to Off (even if reset-on-exit was not enabled).
    // Otherwise Serve/Funnel can stay active and make it look like the setting did not save.
    try {
      if (lastTailscaleMode === 'serve') {
        await disableTailscaleServe();
      } else if (lastTailscaleMode === 'funnel') {
        await disableTailscaleFunnel();
      }
    } catch {
      // Ignore disable failures (e.g., Tailscale not installed).
    }
    lastTailscaleMode = config.tailscaleMode;
    lastTailscaleResetOnExit = config.tailscaleResetOnExit;
    return;
  }

  try {
    if (config.tailscaleMode === 'serve') {
      await enableTailscaleServe(WEBHOOK_PORT);
    } else {
      await enableTailscaleFunnel(WEBHOOK_PORT);
    }

    if (config.tailscaleResetOnExit) {
      tailscaleCleanup = async () => {
        if (config.tailscaleMode === 'serve') {
          await disableTailscaleServe();
        } else {
          await disableTailscaleFunnel();
        }
      };
    }
  } catch (err) {
    tailscaleError = err instanceof Error ? err.message : 'Tailscale exposure failed';
    console.warn('[Webhook] Tailscale exposure failed:', tailscaleError);
  }

  lastTailscaleMode = config.tailscaleMode;
  lastTailscaleResetOnExit = config.tailscaleResetOnExit;
}

export async function refreshGatewayRuntimeConfig(): Promise<void> {
  const config = getGatewayConfig();
  const [token, password] = await Promise.all([getGatewayToken(), getGatewayPassword()]);
  gatewayAuth = {
    mode: config.authMode,
    allowTailscale: config.allowTailscale,
    tailscaleMode: config.tailscaleMode,
    token: token ?? undefined,
    password: password ?? undefined,
  };
  await applyTailscaleExposure();
}

export async function getGatewayRuntimeStatus(): Promise<GatewayRuntimeStatus> {
  const config = getGatewayConfig();
  const [token, password, tailnet] = await Promise.all([
    getGatewayToken(),
    getGatewayPassword(),
    config.tailscaleMode !== 'off' ? getTailnetHostname() : Promise.resolve(null),
  ]);

  return {
    localUrl: getWebhookLocalUrl(),
    tailscaleUrl: tailnet ? `https://${tailnet}` : null,
    tailscaleMode: config.tailscaleMode,
    authMode: config.authMode,
    allowTailscale: config.allowTailscale,
    tokenSet: Boolean(token),
    passwordSet: Boolean(password),
    tailscaleError,
  };
}

export async function stopGatewayExposure(): Promise<void> {
  if (tailscaleCleanup) {
    try {
      await tailscaleCleanup();
    } finally {
      tailscaleCleanup = null;
    }
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(html);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function renderOAuthCallbackPage(status: 'success' | 'error', message: string): string {
  const title = status === 'success' ? 'OAuth Complete' : 'OAuth Error';
  const accent = status === 'success' ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;">
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
      <section style="max-width:560px;width:100%;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:24px;">
        <h1 style="margin:0 0 8px 0;font-size:20px;color:${accent};">${title}</h1>
        <p style="margin:0 0 16px 0;line-height:1.5;">${escapeHtml(message)}</p>
        <p style="margin:0;color:#475569;font-size:13px;">You can close this tab and return to OpenDeskmate.</p>
      </section>
    </main>
  </body>
</html>`;
}

function sendAuthError(res: http.ServerResponse, reason?: string): void {
  const status = reason && reason.endsWith('_config') ? 500 : 401;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  };
  if (status === 401 && gatewayAuth.mode === 'password') {
    headers['WWW-Authenticate'] = 'Basic realm="OpenDeskmate"';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify({ error: 'unauthorized', reason }));
}

function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readOptionalString(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function readOptionalStringArray(value: unknown, itemMaxLength = 1024, maxItems = 20): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => readOptionalString(item, itemMaxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, Math.max(1, maxItems));
  return items.length > 0 ? items : undefined;
}

function readOptionalPrivacyMode(value: unknown): 'normal' | 'incognito' | undefined {
  const mode = readOptionalString(value, 16)?.toLowerCase();
  if (mode === 'normal' || mode === 'incognito') return mode;
  return undefined;
}

function readGatewayPeerKind(value: unknown): GatewayPeerKind | undefined {
  const kind = readOptionalString(value, 16)?.toLowerCase();
  if (kind === 'dm' || kind === 'group' || kind === 'channel') return kind;
  return undefined;
}

function readGatewayPeer(value: unknown): GatewayRoutePeer | undefined {
  const record = asRecord(value);
  const idRaw = record.id;
  const id = typeof idRaw === 'number'
    ? String(idRaw)
    : readOptionalString(idRaw, 128);
  if (!id) return undefined;
  return {
    kind: readGatewayPeerKind(record.kind) ?? 'dm',
    id,
  };
}

function normalizeSessionKey(input: unknown): string | undefined {
  const raw = readOptionalString(input, 512);
  return raw ? raw.toLowerCase() : undefined;
}

function normalizeAccessToken(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeAccessList(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => normalizeAccessToken(value)).filter(Boolean));
}

class GatewayAccessPolicyError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = 'GatewayAccessPolicyError';
    this.status = status;
  }
}

function getGatewayErrorStatus(error: unknown, fallback = 500): number {
  if (
    error
    && typeof error === 'object'
    && 'status' in error
    && typeof (error as { status?: unknown }).status === 'number'
  ) {
    const status = Math.trunc((error as { status: number }).status);
    if (status >= 400 && status <= 599) return status;
  }
  if (error instanceof Error && error.message.includes('required')) {
    return 400;
  }
  return fallback;
}

function assertGatewayConnectorAccessPolicy(
  payload: Record<string, unknown>,
  route: {
    channel: string;
    accountId: string;
    peerKind?: GatewayPeerKind;
    peerId?: string;
  }
): void {
  const channel = normalizeAccessToken(route.channel);
  if (!isGatewayConnectorExtensionId(channel)) return;
  if (channel === 'discord' || channel === 'telegram') return;

  const config = resolveGatewayConnectorExtensionConfig({
    id: channel,
    accountId: route.accountId,
    enabledOnly: false,
  });
  if (!config.enabled) {
    throw new GatewayAccessPolicyError(`Connector channel "${channel}" is disabled.`);
  }

  const policyModeRaw = normalizeAccessToken(config.accessPolicyMode ?? 'open');
  const policyMode = policyModeRaw === 'allowlist' || policyModeRaw === 'disabled'
    ? policyModeRaw
    : 'open';
  const accountId = normalizeAccessToken(route.accountId);
  const peerKind = route.peerKind;
  const peerId =
    normalizeAccessToken(route.peerId)
    || normalizeAccessToken(readOptionalString(payload.peerId, 128))
    || normalizeAccessToken(readOptionalString(payload.userId, 128));
  const userId =
    normalizeAccessToken(readOptionalString(payload.userId, 128))
    || (peerKind === 'dm' ? peerId : '');
  const groupId =
    normalizeAccessToken(readOptionalString(payload.groupId, 128))
    || (peerKind === 'group' ? peerId : '');
  const channelId =
    normalizeAccessToken(readOptionalString(payload.channelId, 128))
    || (peerKind === 'channel' ? peerId : '');

  const allowedAccounts = normalizeAccessList(config.allowedAccountIds);
  if (allowedAccounts.size > 0 && !allowedAccounts.has(accountId)) {
    throw new GatewayAccessPolicyError(`Account "${route.accountId}" is not allowed for connector "${channel}".`);
  }

  const allowedUsers = normalizeAccessList(config.allowedUserIds);
  const allowedGroups = normalizeAccessList(config.allowedGroupIds);
  const allowedChannels = normalizeAccessList(config.allowedChannelIds);

  if (policyMode === 'disabled' && peerKind === 'dm') {
    throw new GatewayAccessPolicyError(`DM access is disabled for connector "${channel}".`);
  }

  if (policyMode === 'allowlist') {
    const hasAnyAllowlist =
      allowedAccounts.size > 0
      || allowedUsers.size > 0
      || allowedGroups.size > 0
      || allowedChannels.size > 0;
    if (!hasAnyAllowlist) {
      throw new GatewayAccessPolicyError(
        `Allowlist policy requires at least one allowed account, user, group, or channel for connector "${channel}".`
      );
    }
    const accountAllowed = allowedAccounts.size > 0 && allowedAccounts.has(accountId);
    const userAllowed = allowedUsers.size > 0 && Boolean(userId) && allowedUsers.has(userId);
    const groupAllowed = allowedGroups.size > 0 && Boolean(groupId) && allowedGroups.has(groupId);
    const channelAllowed = allowedChannels.size > 0 && Boolean(channelId) && allowedChannels.has(channelId);
    if (!accountAllowed && !userAllowed && !groupAllowed && !channelAllowed) {
      throw new GatewayAccessPolicyError(
        `No allowlist rule matched for connector "${channel}" (accountId="${route.accountId}", userId="${userId || 'n/a'}", groupId="${groupId || 'n/a'}", channelId="${channelId || 'n/a'}").`
      );
    }
    return;
  } else if (allowedUsers.size > 0 && userId && !allowedUsers.has(userId)) {
    throw new GatewayAccessPolicyError(`User "${userId}" is not allowed for connector "${channel}".`);
  }

  if (groupId && allowedGroups.size > 0 && !allowedGroups.has(groupId)) {
    throw new GatewayAccessPolicyError(`Group "${groupId}" is not allowed for connector "${channel}".`);
  }
  if (channelId && allowedChannels.size > 0 && !allowedChannels.has(channelId)) {
    throw new GatewayAccessPolicyError(`Channel "${channelId}" is not allowed for connector "${channel}".`);
  }
}

function recordGatewayConnectorDiscoveryFromPayload(
  payload: Record<string, unknown>,
  route: {
    channel: string;
    accountId: string;
    peerKind?: GatewayPeerKind;
    peerId?: string;
  }
): void {
  const channel = normalizeAccessToken(route.channel);
  if (!isGatewayConnectorExtensionId(channel)) return;
  const gatewayConfig = getGatewayConfig();
  if (gatewayConfig.recordConnectorDiscovery === false) return;
  const connectorConfig = resolveGatewayConnectorExtensionConfig({
    id: channel,
    accountId: route.accountId,
    enabledOnly: false,
  });
  if (connectorConfig.recordObservedIds === false) return;
  const userId =
    normalizeAccessToken(readOptionalString(payload.userId, 128))
    || (route.peerKind === 'dm' ? normalizeAccessToken(route.peerId) : '');
  const groupId =
    normalizeAccessToken(readOptionalString(payload.groupId, 128))
    || (route.peerKind === 'group' ? normalizeAccessToken(route.peerId) : '');
  const channelId =
    normalizeAccessToken(readOptionalString(payload.channelId, 128))
    || (route.peerKind === 'channel' ? normalizeAccessToken(route.peerId) : '');
  const accountId = normalizeAccessToken(route.accountId);

  recordGatewayConnectorObservation({
    connectorId: channel,
    instanceId: connectorConfig.instanceId,
    accountId: accountId && accountId !== 'default' ? accountId : undefined,
    userId,
    groupId,
    channelId,
  });
}

type GatewayRunStatus = 'accepted' | 'running' | 'done' | 'error';
type GatewayRunResultStatus = 'success' | 'error' | 'interrupted';

interface GatewayRunRecord {
  runId: string;
  taskId: string;
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  status: GatewayRunStatus;
  resultStatus?: GatewayRunResultStatus;
  error?: string;
  parentRunId?: string;
  spawnedBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const MAX_GATEWAY_RUNS = 2000;
const gatewayRunRegistry = new Map<string, GatewayRunRecord>();

function trimGatewayRuns(): void {
  if (gatewayRunRegistry.size <= MAX_GATEWAY_RUNS) return;
  const values = Array.from(gatewayRunRegistry.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_GATEWAY_RUNS);
  gatewayRunRegistry.clear();
  for (const value of values) {
    gatewayRunRegistry.set(value.runId, value);
  }
}

function upsertGatewayRun(
  runId: string,
  patch: Partial<Omit<GatewayRunRecord, 'runId' | 'createdAt' | 'updatedAt'>> & Pick<GatewayRunRecord, 'taskId' | 'agentId' | 'sessionKey' | 'matchedBy' | 'status'>
): GatewayRunRecord {
  const normalizedRunId = runId.trim() || `run_${randomUUID()}`;
  const now = new Date().toISOString();
  const existing = gatewayRunRegistry.get(normalizedRunId);
  const next: GatewayRunRecord = {
    runId: normalizedRunId,
    taskId: patch.taskId ?? existing?.taskId ?? '',
    agentId: patch.agentId ?? existing?.agentId ?? 'main',
    sessionKey: patch.sessionKey ?? existing?.sessionKey ?? 'agent:main:main',
    matchedBy: patch.matchedBy ?? existing?.matchedBy ?? 'default',
    status: patch.status ?? existing?.status ?? 'accepted',
    resultStatus: patch.resultStatus ?? existing?.resultStatus,
    error: patch.error ?? existing?.error,
    parentRunId: patch.parentRunId ?? existing?.parentRunId,
    spawnedBy: patch.spawnedBy ?? existing?.spawnedBy,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: patch.completedAt ?? existing?.completedAt,
  };
  gatewayRunRegistry.set(normalizedRunId, next);
  trimGatewayRuns();
  return next;
}

function getGatewayRun(runId: string | undefined): GatewayRunRecord | undefined {
  const key = (runId ?? '').trim();
  if (!key) return undefined;
  return gatewayRunRegistry.get(key);
}

function listGatewayRuns(agentId?: string): GatewayRunRecord[] {
  const runs = Array.from(gatewayRunRegistry.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agentId) return runs;
  const normalized = agentId.trim().toLowerCase();
  return runs.filter((run) => run.agentId.toLowerCase() === normalized);
}

export function listGatewayRunStatuses(agentId?: string): GatewayRunRecord[] {
  return listGatewayRuns(agentId);
}

export function getGatewayRunStatus(runId: string): GatewayRunRecord | undefined {
  return getGatewayRun(runId);
}

function isGatewayRunTerminal(run: GatewayRunRecord | undefined): boolean {
  if (!run) return true;
  return run.status === 'done' || run.status === 'error';
}

async function waitForGatewayRun(runId: string, timeoutMs = 60_000): Promise<GatewayRunRecord | undefined> {
  const startedAt = Date.now();
  const pollIntervalMs = 150;
  while ((Date.now() - startedAt) < timeoutMs) {
    const run = getGatewayRun(runId);
    if (!run) return undefined;
    if (isGatewayRunTerminal(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return getGatewayRun(runId);
}

function resolveGatewayDispatchContext(
  payload: Record<string, unknown>,
  fallbackChannel: string
): {
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  route: {
    channel: string;
    accountId: string;
    peerKind?: GatewayPeerKind;
    peerId?: string;
  };
} {
  const explicitSessionKey = normalizeSessionKey(payload.sessionKey);
  const requestedAgentIdRaw = readOptionalString(payload.agentId, 128);
  const sessionAgentId = explicitSessionKey ? resolveAgentIdFromSessionKey(explicitSessionKey) : undefined;
  if (requestedAgentIdRaw && sessionAgentId && requestedAgentIdRaw.trim().toLowerCase() !== sessionAgentId) {
    throw new Error(`agentId "${requestedAgentIdRaw}" does not match sessionKey agent "${sessionAgentId}"`);
  }
  const hasRoutingHints = Boolean(
    payload.channel
      || payload.accountId
      || payload.peer
      || payload.guildId
      || payload.teamId
      || explicitSessionKey
  );
  const explicitAgentId = requestedAgentIdRaw
    ?? sessionAgentId
    ?? (!hasRoutingHints ? resolveActiveAgentId() : undefined);
  const peer = readGatewayPeer(payload.peer);
  const dmScopeRaw = readOptionalString(payload.dmScope, 32)?.toLowerCase();
  const dmScope = dmScopeRaw === 'main' || dmScopeRaw === 'per-peer' || dmScopeRaw === 'per-channel-peer'
    ? dmScopeRaw
    : undefined;
  const resolved = resolveGatewayRoute({
    channel: readOptionalString(payload.channel, 64) ?? fallbackChannel,
    accountId: readOptionalString(payload.accountId, 128),
    peer,
    guildId: readOptionalString(payload.guildId, 128),
    teamId: readOptionalString(payload.teamId, 128),
    agentIdOverride: explicitAgentId,
    dmScope,
  });
  return {
    agentId: resolved.agentId,
    sessionKey: explicitSessionKey ?? resolved.sessionKey,
    matchedBy: resolved.matchedBy,
    route: {
      channel: resolved.channel,
      accountId: resolved.accountId,
      peerKind: peer?.kind,
      peerId: peer?.id,
    },
  };
}

function findTaskAcrossAgents(taskId: string, preferredAgentId?: string): ReturnType<typeof getTask> {
  if (preferredAgentId) {
    return getTask(taskId, preferredAgentId) ?? getTask(taskId);
  }
  const activeAgentId = resolveActiveAgentId();
  return getTask(taskId, activeAgentId) ?? getTask(taskId);
}

function isTaskTerminal(status: string | undefined): boolean {
  return status === 'completed' || status === 'interrupted' || status === 'failed' || status === 'cancelled';
}

async function interruptTaskById(taskId: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const taskManager = getTaskManager();

  if (taskManager.isTaskQueued(taskId)) {
    taskManager.cancelQueuedTask(taskId);
    updateTaskStatus(taskId, 'interrupted', new Date().toISOString());
    return { ok: true, status: 200 };
  }

  if (taskManager.hasActiveTask(taskId)) {
    await taskManager.interruptTask(taskId);
    updateTaskStatus(taskId, 'interrupted', new Date().toISOString());
    setTimeout(() => {
      if (!taskManager.hasActiveTask(taskId)) return;
      void taskManager.cancelTask(taskId).catch(() => {});
    }, 250);
    return { ok: true, status: 200 };
  }

  const existing = getTask(taskId);
  if (existing && existing.status === 'running') {
    updateTaskStatus(taskId, 'interrupted', new Date().toISOString());
    return { ok: true, status: 200 };
  }

  return { ok: false, status: 404, error: 'Task not found or not running' };
}

async function waitForTaskTerminal(
  taskId: string,
  agentId?: string,
  timeoutMs = 60_000
): Promise<ReturnType<typeof getTask>> {
  const startedAt = Date.now();
  const pollIntervalMs = 250;
  while ((Date.now() - startedAt) < timeoutMs) {
    const task = findTaskAcrossAgents(taskId, agentId);
    if (!task) return undefined;
    if (isTaskTerminal(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return findTaskAcrossAgents(taskId, agentId);
}

type GatewayTaskStartResult = {
  taskId: string;
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  completion: Promise<import('@accomplish/shared').TaskResult>;
};

type GatewayRunStartResult = {
  runId: string;
  taskId: string;
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  status: GatewayRunStatus;
  acceptedAt: string;
};

function resolvePromptFromPayload(payload: Record<string, unknown>): string | undefined {
  const prompt = readOptionalString(payload.prompt, 8000);
  if (prompt) return prompt;
  return readOptionalString(payload.message, 8000);
}

function readOptionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a number`);
  }
  const intVal = Math.floor(parsed);
  if (intVal < min || intVal > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return intVal;
}

function applyWebAgentContext(config: { agentId?: string; systemPromptAppend?: string }): {
  agentId: string;
  systemPromptAppend: string;
} {
  const context = getAgentContext(config.agentId);
  return {
    agentId: context.agentId,
    systemPromptAppend: composeAgentSystemPromptAppend({
      agent: context.agent,
      agentSystemPromptAppend: context.systemPromptAppend,
      requestSystemPromptAppend: config.systemPromptAppend,
    }),
  };
}

async function estimateWebchatContext(payload: Record<string, unknown>): Promise<{
  provider: string;
  model: string;
  estimate: unknown;
  context: unknown;
  droppedMessages: number;
  trimmed: boolean;
  summaryInserted: boolean;
  shouldResetSession: boolean;
}> {
  const promptInput = payload.prompt ?? payload.message ?? '';
  if (typeof promptInput !== 'string') {
    throw new Error('prompt must be a string');
  }
  if (promptInput.length > 8000) {
    throw new Error('prompt exceeds maximum length');
  }
  const prompt = promptInput;
  const taskId = readOptionalString(payload.taskId, 128);
  const agentId = readOptionalString(payload.agentId, 64);
  const systemPromptAppendInput = payload.systemPromptAppend;
  if (
    systemPromptAppendInput !== undefined
    && systemPromptAppendInput !== null
    && typeof systemPromptAppendInput !== 'string'
  ) {
    throw new Error('systemPromptAppend must be a string');
  }
  const systemPromptAppend = typeof systemPromptAppendInput === 'string' ? systemPromptAppendInput : undefined;
  if (systemPromptAppend && systemPromptAppend.length > 8000) {
    throw new Error('systemPromptAppend exceeds maximum length');
  }
  const maxOutputTokensOverride = readOptionalInteger(
    payload.maxOutputTokensOverride,
    'maxOutputTokensOverride',
    1,
    1_000_000
  );
  const headroomSafetyTokens = readOptionalInteger(
    payload.headroomSafetyTokens,
    'headroomSafetyTokens',
    0,
    1_000_000
  );

  const context = applyWebAgentContext({ agentId, systemPromptAppend });
  const task = taskId ? (getTask(taskId, context.agentId) ?? getTask(taskId)) : undefined;
  const sessionFilePath = task?.sessionFilePath;

  let retrievedText = '';
  const attachedFiles = readOptionalStringArray(payload.attachedFiles, 2048, 20);
  if (attachedFiles && attachedFiles.length > 0) {
    const { prompt: attachmentContent } = await buildAttachmentsPrefix(attachedFiles);
    retrievedText = attachmentContent;
  }

  const prepared = await preparePayloadForSend({
    agentId: context.agentId,
    taskId,
    sessionFilePath,
    userMessage: prompt,
    retrievedText,
    baseSystemPromptAppend: context.systemPromptAppend,
    maxOutputTokensOverride,
    headroomSafetyTokens,
    requireApiKey: false,
  });

  return {
    provider: prepared.provider,
    model: prepared.model,
    estimate: prepared.estimate,
    context: prepared.context,
    droppedMessages: prepared.droppedMessages,
    trimmed: prepared.trimmed,
    summaryInserted: prepared.summaryInserted,
    shouldResetSession: prepared.shouldResetSession,
  };
}

async function startGatewayTask(payload: Record<string, unknown>): Promise<GatewayTaskStartResult> {
  const prompt = resolvePromptFromPayload(payload);
  if (!prompt) {
    throw new Error('prompt or message is required');
  }
  const route = resolveGatewayDispatchContext(payload, 'webhook');
  recordGatewayConnectorDiscoveryFromPayload(payload, route.route);
  assertGatewayConnectorAccessPolicy(payload, route.route);
  const explicitSessionId = readOptionalString(payload.sessionId, 128);
  const existingSession = getGatewaySession(route.sessionKey);
  const sessionId = explicitSessionId ?? existingSession?.sessionId;

  const { taskId, completion } = await dispatchTask(
    {
      prompt,
      agentId: route.agentId,
      workingDirectory: readOptionalString(payload.workingDirectory, 1024),
      attachedFiles: readOptionalStringArray(payload.attachedFiles, 2048, 20),
      privacyMode: readOptionalPrivacyMode(payload.privacyMode),
      sessionId,
      systemPromptAppend: readOptionalString(payload.systemPromptAppend, 8000),
    },
    {
      source: 'gateway',
      sessionKey: route.sessionKey,
      route: route.route,
    }
  );

  return {
    taskId,
    agentId: route.agentId,
    sessionKey: route.sessionKey,
    matchedBy: route.matchedBy,
    completion,
  };
}

async function startGatewayRun(payload: Record<string, unknown>): Promise<GatewayRunStartResult> {
  const requestedRunId =
    readOptionalString(payload.runId, 128)
    ?? readOptionalString(payload.idempotencyKey, 128)
    ?? readOptionalString(payload.clientRunId, 128);
  const runId = requestedRunId || `run_${randomUUID()}`;

  const existingRun = getGatewayRun(runId);
  if (existingRun) {
    return {
      runId: existingRun.runId,
      taskId: existingRun.taskId,
      agentId: existingRun.agentId,
      sessionKey: existingRun.sessionKey,
      matchedBy: existingRun.matchedBy,
      status: existingRun.status,
      acceptedAt: existingRun.createdAt,
    };
  }

  const started = await startGatewayTask(payload);
  const parentRunId = readOptionalString(payload.parentRunId, 128);
  const spawnedBy = readOptionalString(payload.spawnedBy, 128);

  upsertGatewayRun(runId, {
    taskId: started.taskId,
    agentId: started.agentId,
    sessionKey: started.sessionKey,
    matchedBy: started.matchedBy,
    status: 'running',
    parentRunId,
    spawnedBy,
  });

  void started.completion
    .then((result) => {
      upsertGatewayRun(runId, {
        taskId: started.taskId,
        agentId: started.agentId,
        sessionKey: started.sessionKey,
        matchedBy: started.matchedBy,
        status: result.status === 'error' ? 'error' : 'done',
        resultStatus: result.status,
        completedAt: new Date().toISOString(),
      });
    })
    .catch((error) => {
      upsertGatewayRun(runId, {
        taskId: started.taskId,
        agentId: started.agentId,
        sessionKey: started.sessionKey,
        matchedBy: started.matchedBy,
        status: 'error',
        resultStatus: 'error',
        error: error instanceof Error ? error.message : 'Task failed',
        completedAt: new Date().toISOString(),
      });
    });

  const run = getGatewayRun(runId);
  return {
    runId,
    taskId: started.taskId,
    agentId: started.agentId,
    sessionKey: started.sessionKey,
    matchedBy: started.matchedBy,
    status: run?.status ?? 'running',
    acceptedAt: run?.createdAt ?? new Date().toISOString(),
  };
}

type GatewayRpcRequest = {
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

async function executeGatewayRpc(request: GatewayRpcRequest): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const method = readOptionalString(request.method, 128);
  const params = asRecord(request.params);
  if (!method) {
    return { error: { code: -32600, message: 'Invalid request: method is required' } };
  }

  try {
    if (method === 'connect' || method === 'health') {
      const runtime = await getGatewayRuntimeStatus();
      return {
        result: {
          ok: true,
          runtime,
          now: new Date().toISOString(),
        },
      };
    }

    if (method === 'agents.list') {
      return {
        result: {
          agents: listAgents(),
          defaultAgentId: getDefaultAgentId(),
          activeAgentId: resolveActiveAgentId(),
        },
      };
    }

    if (method === 'agents.set-active') {
      const agentId = readOptionalString(params.agentId, 128);
      if (!agentId) {
        return { error: { code: -32602, message: 'agentId is required' } };
      }
      const agent = getAgent(agentId);
      if (!agent) {
        return { error: { code: 404, message: 'Agent not found' } };
      }
      setActiveAgentId(agent.id);
      return { result: { ok: true, activeAgentId: agent.id } };
    }

    if (method === 'sessions.list') {
      const agentId = readOptionalString(params.agentId, 128);
      return { result: { sessions: listGatewaySessions(agentId) } };
    }

    if (method === 'sessions.resolve') {
      const sessionKey = normalizeSessionKey(params.sessionKey);
      if (!sessionKey) {
        return { error: { code: -32602, message: 'sessionKey is required' } };
      }
      return { result: { session: getGatewaySession(sessionKey) ?? null } };
    }

    if (method === 'chat.send' || method === 'agent' || method === 'agent.spawn') {
      const result = await startGatewayRun(params);
      return { result };
    }

    if (method === 'chat.history') {
      const sessionKey = normalizeSessionKey(params.sessionKey);
      if (!sessionKey) {
        return { error: { code: -32602, message: 'sessionKey is required' } };
      }
      const session = getGatewaySession(sessionKey);
      if (!session?.taskId) {
        return { result: { session, task: null } };
      }
      const task = findTaskAcrossAgents(session.taskId, session.agentId);
      return { result: { session, task: task ?? null } };
    }

    if (method === 'chat.abort') {
      const runId = readOptionalString(params.runId, 128);
      const run = runId ? getGatewayRun(runId) : undefined;
      const taskId = readOptionalString(params.taskId, 128) ?? run?.taskId;
      if (!taskId) {
        return { error: { code: -32602, message: 'taskId or runId is required' } };
      }
      const interrupted = await interruptTaskById(taskId);
      if (!interrupted.ok) {
        return { error: { code: interrupted.status, message: interrupted.error ?? 'Failed to interrupt task' } };
      }
      if (runId && run) {
        upsertGatewayRun(runId, {
          taskId: run.taskId,
          agentId: run.agentId,
          sessionKey: run.sessionKey,
          matchedBy: run.matchedBy,
          status: 'done',
          resultStatus: 'interrupted',
          completedAt: new Date().toISOString(),
        });
      }
      return { result: { ok: true, taskId, runId: runId ?? undefined } };
    }

    if (method === 'agent.wait') {
      const runId = readOptionalString(params.runId, 128);
      const timeoutMsRaw = Number(params.timeoutMs ?? 60_000);
      const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
        ? Math.min(300_000, Math.round(timeoutMsRaw))
        : 60_000;
      if (runId) {
        const run = await waitForGatewayRun(runId, timeoutMs);
        if (!run) {
          return { error: { code: 404, message: 'Run not found' } };
        }
        if (!isGatewayRunTerminal(run)) {
          return {
            result: {
              runId,
              taskId: run.taskId,
              status: 'timeout',
            },
          };
        }
        return {
          result: {
            runId: run.runId,
            taskId: run.taskId,
            agentId: run.agentId,
            sessionKey: run.sessionKey,
            status: run.status,
            resultStatus: run.resultStatus,
            error: run.error,
            completedAt: run.completedAt,
          },
        };
      }

      const taskId = readOptionalString(params.taskId, 128);
      if (!taskId) {
        return { error: { code: -32602, message: 'runId or taskId is required' } };
      }
      const agentId = readOptionalString(params.agentId, 128);
      const task = await waitForTaskTerminal(taskId, agentId, timeoutMs);
      if (!task) {
        return { error: { code: 404, message: 'Task not found' } };
      }
      return { result: { taskId, task } };
    }

    if (method === 'agent.runs') {
      const agentId = readOptionalString(params.agentId, 128);
      const sessionKey = normalizeSessionKey(params.sessionKey);
      const statusFilter = readOptionalString(params.status, 32)?.toLowerCase();
      const runs = listGatewayRuns(agentId).filter((run) => {
        if (sessionKey && run.sessionKey !== sessionKey) return false;
        if (statusFilter && run.status !== statusFilter) return false;
        return true;
      });
      return { result: { runs } };
    }

    if (method === 'agent.get') {
      const runId = readOptionalString(params.runId, 128);
      if (!runId) {
        return { error: { code: -32602, message: 'runId is required' } };
      }
      return { result: { run: getGatewayRun(runId) ?? null } };
    }

    return { error: { code: -32601, message: `Unknown method: ${method}` } };
  } catch (error) {
    return {
      error: {
        code: getGatewayErrorStatus(error, -32000),
        message: error instanceof Error ? error.message : 'Gateway RPC failed',
      },
    };
  }
}

let _logoPngBuffer: Buffer | null = null;
let _logoDataUri: string | null = null;
let _logoResolved = false;

function getFallbackFaviconSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1d4ed8"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#ffffff">OD</text></svg>';
}

function resolveLogoPngPath(): string | null {
  const appRoot = (process.env.APP_ROOT || '').trim();
  const cwd = process.cwd();
  const candidates = [
    appRoot ? path.join(appRoot, 'public', 'assets', 'open-deskmate-logo.png') : '',
    path.join(cwd, 'apps', 'desktop', 'public', 'assets', 'open-deskmate-logo.png'),
    path.join(cwd, 'public', 'assets', 'open-deskmate-logo.png'),
    path.join(cwd, 'open_deskmate_thumbnail-no_background.png'),
    path.join(cwd, 'open_deskmate_thumbnail-no_background.png'.toLowerCase()),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function getLogoPngBuffer(): Buffer | null {
  if (_logoResolved) return _logoPngBuffer;
  _logoResolved = true;
  try {
    const logoPath = resolveLogoPngPath();
    if (!logoPath) {
      _logoPngBuffer = null;
      return _logoPngBuffer;
    }
    _logoPngBuffer = fs.readFileSync(logoPath);
    return _logoPngBuffer;
  } catch {
    _logoPngBuffer = null;
    return _logoPngBuffer;
  }
}

function getLogoDataUri(): string {
  if (_logoDataUri) return _logoDataUri;
  const png = getLogoPngBuffer();
  if (png) {
    _logoDataUri = `data:image/png;base64,${png.toString('base64')}`;
    return _logoDataUri;
  }
  const fallbackSvg = getFallbackFaviconSvg();
  _logoDataUri = `data:image/svg+xml;base64,${Buffer.from(fallbackSvg, 'utf8').toString('base64')}`;
  return _logoDataUri;
}

function sendFavicon(res: http.ServerResponse): void {
  const png = getLogoPngBuffer();
  if (png) {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    });
    res.end(png);
    return;
  }
  const fallbackSvg = getFallbackFaviconSvg();
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    ...CORS_HEADERS,
  });
  res.end(fallbackSvg);
}

function renderWebchatPage(): string {
  const logoUri = getLogoDataUri();
  const faviconHref = '/favicon.ico?v=3';
  const appleTouchIconHref = '/apple-touch-icon.png?v=3';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <meta name="theme-color" content="#f8fafc" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f8fafc" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f1419" />
    <title>Open Deskmate WebChat</title>
    <link rel="icon" type="image/png" href="${faviconHref}" />
    <link rel="shortcut icon" href="${faviconHref}" />
    <link rel="apple-touch-icon" href="${appleTouchIconHref}" />
    <style>
      :root {
        --primary: #4db6ac;
        --primary-dark: #3d9991;
        --foreground: #1e3a5f;
        --background: #f8fafc;
        --card: #ffffff;
        --border: #e2e8f0;
        --muted: #f1f5f9;
        --muted-foreground: #64748b;
        --sidebar-width: 280px;
        --odm-mobile-top-offset: 0px;
        --odm-mobile-toolbar-height: 61px;
        --odm-mobile-header-gap: 18px;
        --odm-mobile-vh: 100dvh;
        --odm-mobile-keyboard-offset: 0px;
        --odm-mobile-initial-keyboard-shift: 0px;
      }
      body.theme-light { color-scheme: light; }
      body.theme-dark {
        --primary: #4ecdc4;
        --primary-dark: #36b9b0;
        --foreground: #f1f5f9;
        --background: #0f1419;
        --card: #161d26;
        --border: #2a3441;
        --muted: #1e2630;
        --muted-foreground: #8899aa;
        color-scheme: dark;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { width: 100%; height: 100%; overflow: hidden; background-color: var(--background); }
      body { font-family: 'DM Sans', system-ui, -apple-system, sans-serif; color: var(--foreground); background: linear-gradient(135deg, var(--background) 0%, var(--muted) 100%); min-height: 100vh; }
      body::after { content: ''; position: fixed; left: 0; right: 0; bottom: 0; height: env(safe-area-inset-bottom, 0px); background: var(--background); pointer-events: none; z-index: 4; }
      body.keyboard-open::after { height: 0; }
      body.theme-dark .sidebar { border-right-color: rgba(42, 52, 65, 0.75); }
      body.theme-dark .agent-switcher { background: rgba(22, 29, 38, 0.88); border-color: rgba(42, 52, 65, 0.8); }
      body.theme-dark .task-card { background: rgba(22, 29, 38, 0.88); border-color: rgba(42, 52, 65, 0.75); }
      body.theme-dark .chat-header { background: rgba(22, 29, 38, 0.75); border-bottom-color: rgba(42, 52, 65, 0.9); }
      body.theme-dark .usage-banner { background: rgba(22, 29, 38, 0.75); border-bottom-color: rgba(42, 52, 65, 0.9); }
      body.theme-dark .usage-banner:hover { background: rgba(30, 38, 48, 0.86); }
      body.theme-dark .chat-input-bar { background: rgba(22, 29, 38, 0.75); border-top-color: rgba(42, 52, 65, 0.9); }
      body.theme-dark .message.tool .message-bubble { background: rgba(30, 38, 48, 0.9); border-color: rgba(42, 52, 65, 0.9); }
      body.theme-dark .tool-output { color: #cbd5e1; }
      body.theme-dark .message-content pre { background: rgba(15, 23, 42, 0.45); }
      body.theme-dark .mobile-task-panel { box-shadow: 4px 0 24px rgba(0, 0, 0, 0.35); }
      body.theme-dark .mobile-agent-switcher { background: rgba(22, 29, 38, 0.92); border-color: rgba(42, 52, 65, 0.88); }
      body.theme-dark .mobile-agent-switcher:hover { background: rgba(30, 38, 48, 0.95); }

      /* ========== APP CONTAINER ========== */
      .app-container { display: flex; height: 100vh; height: 100dvh; overflow: hidden; }

      /* ========== SIDEBAR ========== */
      .sidebar { width: var(--sidebar-width); flex-shrink: 0; display: flex; flex-direction: column; background: var(--card); border-right: 1px solid rgba(226, 232, 240, 0.5); }
      .sidebar-header { padding: 16px 16px 8px; }
      .agent-switcher { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; border: 1px solid rgba(226, 232, 240, 0.6); background: rgba(255, 255, 255, 0.8); cursor: pointer; transition: background 0.15s ease; }
      .agent-switcher:hover { background: rgba(77, 182, 172, 0.06); }
      .agent-avatar { width: 38px; height: 38px; border-radius: 10px; background: rgba(77, 182, 172, 0.1); display: flex; align-items: center; justify-content: center; color: var(--primary); font-weight: 600; font-size: 13px; padding: 4px; flex-shrink: 0; }
      .agent-info { flex: 1; text-align: left; min-width: 0; }
      .agent-name { display: block; font-weight: 500; font-size: 14px; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .agent-id { display: block; font-size: 11px; color: var(--muted-foreground); }
      .chevron { font-size: 12px; color: var(--muted-foreground); }

      .sidebar-actions { padding: 12px 16px; display: flex; gap: 8px; align-items: center; }
      .btn-new-task { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 12px; background: var(--primary); color: white; font-weight: 600; font-size: 14px; border: none; cursor: pointer; box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 4px 16px -4px rgba(0, 0, 0, 0.1), 0 0 20px -5px rgba(77, 182, 172, 0.3); transition: all 0.2s ease; }
      .btn-new-task:hover { background: var(--primary-dark); box-shadow: 0 0 20px -5px rgba(77, 182, 172, 0.4), 0 4px 16px -4px rgba(0, 0, 0, 0.15); }
      .btn-new-task svg { width: 16px; height: 16px; }
      .btn-sidebar-icon { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); cursor: pointer; transition: all 0.15s ease; flex-shrink: 0; }
      .btn-sidebar-icon:hover { background: rgba(0,0,0,0.04); color: var(--foreground); }
      .btn-sidebar-icon svg { width: 16px; height: 16px; }
      .mobile-connected-agent-avatar { width: 40px; height: 40px; border-radius: 12px; background: rgba(77, 182, 172, 0.1); display: inline-flex; align-items: center; justify-content: center; color: var(--primary); font-weight: 600; font-size: 13px; padding: 5px; flex-shrink: 0; border: 1px solid rgba(77, 182, 172, 0.2); }

      .task-list { flex: 1; overflow-y: auto; padding: 8px 12px; }
      .task-list::-webkit-scrollbar { width: 6px; }
      .task-list::-webkit-scrollbar-track { background: transparent; }
      .task-list::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.15); border-radius: 999px; }

      .task-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; cursor: pointer; transition: all 0.15s ease; border: 1px solid transparent; position: relative; margin-bottom: 4px; }
      .task-item:hover { background: rgba(77, 182, 172, 0.06); border-color: rgba(226, 232, 240, 0.5); }
      .task-item.active { background: rgba(77, 182, 172, 0.1); border-color: rgba(77, 182, 172, 0.2); }
      .task-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--primary); border-radius: 0 3px 3px 0; transform: scaleY(0); transition: transform 0.15s ease; }
      .task-item:hover::before, .task-item.active::before { transform: scaleY(1); }
      .long-press-active { background: rgba(77, 182, 172, 0.12) !important; border-color: rgba(77, 182, 172, 0.3) !important; box-shadow: 0 0 0 2px rgba(77, 182, 172, 0.15); }
      .menu-target-active { background: rgba(77, 182, 172, 0.14) !important; border-color: rgba(77, 182, 172, 0.38) !important; box-shadow: 0 0 0 2px rgba(77, 182, 172, 0.22) !important; }
      .task-item.menu-target-active::before { transform: scaleY(1) !important; }
      .task-status-icon { width: 20px; height: 20px; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 10px; }
      .task-status-icon.s-running { background: rgba(77, 182, 172, 0.15); color: var(--primary); }
      .task-status-icon.s-completed { background: #dcfce7; color: #166534; }
      .task-status-icon.s-failed { background: #fee2e2; color: #991b1b; }
      .task-status-icon.s-pending, .task-status-icon.s-queued { background: #fef9c3; color: #854d0e; }
      .task-status-icon.s-interrupted { background: #fef9c3; color: #854d0e; }
      .task-status-icon.s-cancelled { background: #f1f5f9; color: #64748b; }
      .task-item-title { flex: 1; font-size: 13px; font-weight: 500; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .task-item-menu { width: 24px; height: 24px; border: none; background: transparent; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 6px; color: var(--muted-foreground); flex-shrink: 0; }
      .task-item:hover .task-item-menu { display: flex; }
      .task-item-menu:hover { background: rgba(0,0,0,0.05); color: var(--foreground); }
      .task-item-menu svg { width: 14px; height: 14px; }

      /* ========== PROJECT FOLDERS ========== */
      .folder-section { margin-bottom: 8px; }
      .folder-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
      .folder-header-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted-foreground); }
      .folder-header-btn { width: 20px; height: 20px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; color: var(--muted-foreground); }
      .folder-header-btn:hover { background: rgba(77, 182, 172, 0.1); color: var(--primary); }
      .folder-header-btn svg { width: 14px; height: 14px; }

      .folder-item { margin-bottom: 2px; }
      .folder-toggle { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: none; background: transparent; cursor: pointer; border-radius: 10px; transition: all 0.15s ease; text-align: left; }
      .folder-toggle:hover { background: rgba(77, 182, 172, 0.06); }
      .folder-toggle.expanded { background: rgba(77, 182, 172, 0.04); }
      .folder-toggle.menu-target-active { background: rgba(77, 182, 172, 0.14) !important; box-shadow: 0 0 0 2px rgba(77, 182, 172, 0.22) !important; }
      .folder-icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
      .folder-name { flex: 1; font-size: 13px; font-weight: 500; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .folder-count { font-size: 11px; color: var(--muted-foreground); padding: 2px 6px; background: var(--muted); border-radius: 10px; }
      .folder-chevron { width: 16px; height: 16px; color: var(--muted-foreground); transition: transform 0.2s ease; }
      .folder-toggle.expanded .folder-chevron { transform: rotate(90deg); }
      .folder-toggle .folder-more-btn { opacity: 0; width: 22px; height: 22px; border: none; background: transparent; cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); flex-shrink: 0; transition: all 0.15s ease; }
      .folder-toggle:hover .folder-more-btn { opacity: 1; }
      .folder-more-btn:hover { background: rgba(77, 182, 172, 0.12); color: var(--primary); }
      .folder-icon.clickable { cursor: pointer; transition: all 0.15s ease; }
      .folder-icon.clickable:hover { transform: scale(1.1); box-shadow: 0 0 0 2px rgba(77, 182, 172, 0.3); }
      .folder-tasks { overflow: hidden; max-height: 0; transition: max-height 0.2s ease; padding-left: 12px; }
      .folder-tasks.expanded { max-height: 500px; }

      .unfiled-section { border-top: 1px solid rgba(226, 232, 240, 0.5); margin-top: 8px; padding-top: 8px; }

      /* Task Context Menu */
      .context-menu { position: fixed; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 6px; min-width: 160px; z-index: 100; }
      .context-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 13px; color: var(--foreground); width: 100%; text-align: left; }
      .context-menu-item:hover { background: rgba(77, 182, 172, 0.08); }
      .context-menu-item svg { width: 14px; height: 14px; color: var(--muted-foreground); }
      .context-menu-item.danger { color: #dc2626; }
      .context-menu-item.danger svg { color: #dc2626; }
      .context-menu-separator { height: 1px; background: var(--border); margin: 4px 0; }
      .context-submenu { position: relative; }
      .context-submenu-content { position: absolute; left: 100%; top: 0; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); padding: 6px; min-width: 140px; display: none; }
      .context-submenu:hover .context-submenu-content { display: block; }

      /* Create Folder Modal */
      .folder-modal { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); align-items: center; justify-content: center; padding: 24px; z-index: 60; backdrop-filter: blur(6px); }
      .folder-modal.visible { display: flex; }
      .folder-modal-content { width: 100%; max-width: 360px; background: var(--card); border-radius: 16px; padding: 20px; border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(15, 23, 42, 0.2); }
      .folder-modal h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--foreground); }
      .folder-modal-input { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; font-size: 14px; color: var(--foreground); margin-bottom: 12px; }
      .folder-modal-input:focus { outline: none; border-color: var(--primary); }
      .folder-modal-colors { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
      .folder-color-btn { width: 28px; height: 28px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; transition: all 0.15s ease; }
      .folder-color-btn:hover { transform: scale(1.1); }
      .folder-color-btn.selected { border-color: var(--foreground); }
      /* Icon & Color Picker */
      .folder-modal-preview { display: flex; justify-content: center; margin-bottom: 12px; }
      .folder-modal-preview-icon { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 14px; border: 2px solid var(--border); transition: all 0.2s ease; }
      .folder-modal-tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 10px; }
      .folder-modal-tab { flex: 1; padding: 8px 0; font-size: 13px; font-weight: 500; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--muted-foreground); transition: all 0.15s ease; }
      .folder-modal-tab:hover { color: var(--foreground); }
      .folder-modal-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
      .folder-modal-icons { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; max-height: 160px; overflow-y: auto; margin-bottom: 16px; padding: 2px; }
      .folder-icon-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; cursor: pointer; transition: all 0.15s ease; }
      .folder-icon-btn:hover { background: var(--muted); transform: scale(1.1); }
      .folder-icon-btn.selected { background: rgba(77, 182, 172, 0.1); box-shadow: 0 0 0 2px rgba(77, 182, 172, 0.3); }
      .folder-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .folder-modal-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s ease; }
      .folder-modal-btn.cancel { background: var(--muted); color: var(--foreground); }
      .folder-modal-btn.cancel:hover { background: var(--border); }
      .folder-modal-btn.create { background: var(--primary); color: white; }
      .folder-modal-btn.create:hover { background: var(--primary-dark); }

      /* Search Modal */
      .search-modal { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); align-items: flex-start; justify-content: center; padding: 80px 24px 24px; z-index: 60; backdrop-filter: blur(6px); }
      .search-modal.visible { display: flex; }
      .search-modal-content { width: 100%; max-width: 480px; background: var(--card); border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25); overflow: hidden; }
      .search-modal-input-wrap { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
      .search-modal-input-wrap svg { width: 16px; height: 16px; color: var(--muted-foreground); flex-shrink: 0; }
      .search-modal-input { flex: 1; border: none; background: transparent; font-size: 15px; color: var(--foreground); outline: none; font-family: inherit; }
      .search-modal-input::placeholder { color: var(--muted-foreground); }
      .search-results { max-height: 320px; overflow-y: auto; }
      .search-results::-webkit-scrollbar { width: 5px; }
      .search-results::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.12); border-radius: 999px; }
      .search-result-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer; transition: background 0.1s ease; }
      .search-result-item:hover { background: rgba(77, 182, 172, 0.08); }
      .search-result-item .task-status-icon { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .search-result-title { flex: 1; font-size: 13px; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .search-result-time { font-size: 11px; color: var(--muted-foreground); flex-shrink: 0; }
      .search-empty { padding: 24px 16px; text-align: center; font-size: 13px; color: var(--muted-foreground); }

      .sidebar-footer { padding: 12px 16px; border-top: 1px solid rgba(226, 232, 240, 0.5); display: flex; align-items: center; justify-content: space-between; background: linear-gradient(to top, rgba(241, 245, 249, 0.3), transparent); }
      .sidebar-footer .logo { height: 36px; }
      .sidebar-footer .logo img { height: 100%; width: auto; }
      .sidebar-footer-controls { display: flex; align-items: center; gap: 8px; }
      .footer-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); flex-shrink: 0; cursor: default; }
      .connected-badge-icon.is-connected { color: var(--primary); background: rgba(77, 182, 172, 0.1); border-color: rgba(77, 182, 172, 0.22); }
      .connected-badge-icon.is-warning { color: #b45309; background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.34); }
      .connected-badge-icon.is-disconnected { color: #64748b; background: var(--muted); border-color: var(--border); }
      .footer-hover-pop { position: relative; }
      .footer-hover-pop::after {
        content: attr(data-status-label);
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        padding: 6px 8px;
        border-radius: 8px;
        background: var(--card);
        border: 1px solid var(--border);
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.18);
        color: var(--foreground);
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
        z-index: 120;
      }
      .footer-hover-pop:hover::after,
      .footer-hover-pop:focus-visible::after {
        opacity: 1;
        transform: translateY(0);
      }
      .theme-menu-wrap { position: relative; }
      .theme-menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        min-width: 132px;
        padding: 6px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--card);
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.2);
        display: none;
        z-index: 140;
      }
      .theme-menu.visible { display: block; }
      .theme-menu-item {
        width: 100%;
        border: none;
        background: transparent;
        border-radius: 8px;
        padding: 8px 10px;
        color: var(--foreground);
        font-size: 12px;
        font-weight: 600;
        text-align: left;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
      }
      .theme-menu-item:hover { background: rgba(77, 182, 172, 0.1); color: var(--primary); }
      .theme-menu-item .theme-check { opacity: 0; color: var(--primary); }
      .theme-menu-item.active .theme-check { opacity: 1; }
      .btn-settings { width: 36px; height: 36px; border-radius: 10px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); transition: all 0.15s ease; }
      .btn-settings:hover { background: rgba(77, 182, 172, 0.08); color: var(--foreground); }
      .btn-settings svg { width: 20px; height: 20px; }

      /* ========== MAIN CONTENT ========== */
      .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: linear-gradient(135deg, var(--background) 0%, var(--muted) 100%); }
      .usage-banner { flex-shrink: 0; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.75); backdrop-filter: blur(8px); cursor: pointer; }
      .usage-banner:hover { background: rgba(255,255,255,0.9); }
      .usage-banner-inner { padding: 8px 16px; display: flex; align-items: center; gap: 12px; }
      .usage-period-tabs { display: inline-flex; align-items: center; gap: 4px; padding: 4px; border-radius: 10px; background: var(--muted); flex-shrink: 0; }
      .usage-period-btn { border: none; background: transparent; color: var(--muted-foreground); font-size: 11px; font-weight: 600; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
      .usage-period-btn:hover { color: var(--foreground); }
      .usage-period-btn.active { background: var(--card); color: var(--foreground); box-shadow: 0 1px 3px rgba(15,23,42,0.12); }
      .usage-summary { min-width: 0; flex: 1; }
      .usage-summary-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      .usage-tokens { font-size: 13px; font-weight: 600; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .usage-cost { font-size: 12px; color: var(--muted-foreground); white-space: nowrap; }
      .usage-subtitle { margin-top: 1px; font-size: 11px; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .usage-details-link { font-size: 12px; color: var(--muted-foreground); flex-shrink: 0; }
      .usage-details-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .usage-details-label { font-size: 11px; color: var(--muted-foreground); }
      .usage-details-value { font-size: 13px; font-weight: 600; color: var(--foreground); margin-top: 2px; }
      .usage-provider-list { display: flex; flex-direction: column; gap: 8px; }
      .usage-provider-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
      .usage-provider-name { font-size: 13px; font-weight: 600; color: var(--foreground); }
      .usage-provider-meta { font-size: 11px; color: var(--muted-foreground); margin-top: 2px; }
      .usage-provider-cost { font-size: 12px; color: var(--foreground); font-weight: 600; text-align: right; }
      .usage-provider-cost.unpriced { color: var(--muted-foreground); font-weight: 500; }

      /* Initial State */
      .initial-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; gap: 24px; }
      .hero-title { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; color: var(--foreground); text-align: center; }
      .hero-title span { color: var(--primary); }
      .hero-subtitle { font-size: 16px; color: var(--muted-foreground); text-align: center; }

      .task-card { width: 100%; max-width: 820px; background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.3); padding: 20px; box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 4px 16px -4px rgba(0, 0, 0, 0.1); }
      .input-container { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 16px; border: 2px solid rgba(226, 232, 240, 0.6); background: var(--card); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
      .input-container:focus-within { border-color: rgba(77, 182, 172, 0.5); box-shadow: 0 0 0 4px rgba(77, 182, 172, 0.1); }
      .composer-bottom-row { width: min(100%, var(--composer-row-max-width, 100%)); margin: 10px auto 0; min-height: 0; display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
      .context-indicator-row { min-height: 0; display: flex; align-items: center; justify-content: flex-start; margin-left: 0; flex: 0 0 auto; }
      .context-indicator-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; border: 1px solid transparent; padding: 4px 10px; font-size: 11px; font-weight: 500; line-height: 1.25; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
      .context-indicator-badge.context-green { border-color: rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.1); color: #047857; }
      .context-indicator-badge.context-yellow { border-color: rgba(245, 158, 11, 0.25); background: rgba(245, 158, 11, 0.1); color: #92400e; }
      .context-indicator-badge.context-red { border-color: rgba(239, 68, 68, 0.28); background: rgba(239, 68, 68, 0.11); color: #b91c1c; }
      .context-indicator-sep { opacity: 0.65; }
      .context-indicator-detail { opacity: 0.9; }
      .context-indicator-info-btn { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; border-radius: 999px; background: transparent; color: currentColor; opacity: 0.72; padding: 0; margin-left: 2px; cursor: pointer; flex-shrink: 0; transition: opacity 0.15s ease, background 0.15s ease; }
      .context-indicator-info-btn:hover { opacity: 1; background: rgba(15, 23, 42, 0.08); }
      .context-indicator-info-btn:focus-visible { opacity: 1; outline: 2px solid rgba(77, 182, 172, 0.45); outline-offset: 1px; }
      .context-indicator-info-btn.active { opacity: 1; background: rgba(15, 23, 42, 0.1); }
      .context-indicator-info-btn svg { width: 12px; height: 12px; }
      body.theme-dark .context-indicator-info-btn:hover { background: rgba(148, 163, 184, 0.2); }
      body.theme-dark .context-indicator-info-btn.active { background: rgba(148, 163, 184, 0.24); }
      .context-info-popover { position: fixed; z-index: 165; display: none; width: min(320px, calc(100vw - 20px)); border: 1px solid var(--border); border-radius: 12px; background: var(--card); color: var(--foreground); box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22); padding: 10px 11px; }
      .context-info-popover.visible { display: block; }
      .context-info-popover-text { font-size: 12px; line-height: 1.45; color: var(--foreground); }
      .context-info-popover-trimmed { margin-top: 8px; font-size: 11px; line-height: 1.4; color: var(--muted-foreground); }
      .context-info-popover-breakdown { margin-top: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--muted); padding: 7px 8px; }
      .context-info-popover-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.4; }
      .context-info-popover-row + .context-info-popover-row { margin-top: 2px; }
      .context-info-popover-label { color: var(--muted-foreground); }
      .context-info-popover-value { color: var(--foreground); font-weight: 600; }
      .context-info-popover-source { margin-top: 7px; font-size: 10px; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.04em; }
      .input-field-wrap { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
      .input-container textarea { flex: 1; width: 100%; min-height: 40px; max-height: 200px; resize: none; border: none; background: transparent; font-size: 15px; color: var(--foreground); line-height: 1.5; font-family: inherit; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: rgba(100, 116, 139, 0.24) transparent; padding: 9px 0; box-sizing: border-box; }
      .input-field-wrap textarea { padding-left: 42px; padding-right: 42px; }
      .input-container textarea::-webkit-scrollbar { width: 4px; }
      .input-container textarea::-webkit-scrollbar-track { background: transparent; }
      .input-container textarea::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.24); border-radius: 999px; }
      .input-container textarea::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.34); }
      .input-container textarea::placeholder { color: rgba(100, 116, 139, 0.6); }
      .input-container textarea:focus { outline: none; }
      .btn-submit { width: 40px; height: 40px; border-radius: 12px; background: var(--primary); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.1); transition: all 0.2s ease; }
      .btn-submit:hover { background: var(--primary-dark); }
      .btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }
      .btn-submit svg { width: 18px; height: 18px; }

      /* ========== CHAT STATE ========== */
      .chat-state { position: relative; flex: 1; display: none; flex-direction: column; overflow: hidden; }
      .chat-state.active { display: flex; }
      .initial-state.hidden { display: none; }
      .initial-chat-header { flex-shrink: 0; justify-content: flex-end; }

      .chat-header { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
      .btn-back { width: 36px; height: 36px; border-radius: 10px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); transition: all 0.15s ease; }
      .btn-back:hover { background: var(--muted); color: var(--foreground); }
      .btn-back svg { width: 20px; height: 20px; }
      .chat-title { flex: 1; font-size: 15px; font-weight: 500; color: var(--foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; flex-shrink: 0; }
      .status-badge.s-running { background: rgba(77, 182, 172, 0.15); color: var(--primary); }
      .status-badge.s-completed { background: #dcfce7; color: #166534; }
      .status-badge.s-failed { background: #fee2e2; color: #991b1b; }
      .status-badge.s-pending, .status-badge.s-queued { background: #fef9c3; color: #854d0e; }
      .status-badge.s-interrupted { background: #fef9c3; color: #854d0e; }
      .status-badge.s-cancelled { background: #f1f5f9; color: #64748b; }
      .model-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; background: #eef2ff; color: #4338ca; flex-shrink: 0; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mobile-model-btn { display: none; align-items: center; justify-content: center; height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); font-size: 11px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
      .mobile-model-btn:hover { background: rgba(77, 182, 172, 0.08); color: var(--primary); border-color: rgba(77, 182, 172, 0.35); }
      .agent-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; background: var(--muted); color: var(--muted-foreground); flex-shrink: 0; }
      .fullscreen-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); cursor: pointer; flex-shrink: 0; transition: all 0.15s ease; }
      .fullscreen-btn:hover { background: rgba(77, 182, 172, 0.08); color: var(--primary); border-color: rgba(77, 182, 172, 0.35); }
      .fullscreen-btn svg { width: 14px; height: 14px; }

      /* Messages Area */
      .messages-area { flex: 1; overflow-y: auto; padding: 20px; }
      .messages-area::-webkit-scrollbar { width: 6px; }
      .messages-area::-webkit-scrollbar-track { background: transparent; }
      .messages-area::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.15); border-radius: 999px; }
      .messages-list { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
      .scroll-bottom-btn { position: absolute; left: 50%; bottom: 200px; transform: translateX(-50%); width: 34px; height: 34px; border-radius: 999px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease, color 0.15s ease; z-index: 8; }
      .scroll-bottom-btn svg { width: 16px; height: 16px; }
      .scroll-bottom-btn.visible { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
      .scroll-bottom-btn:hover { background: rgba(77, 182, 172, 0.08); color: var(--primary); border-color: rgba(77, 182, 172, 0.35); }

      .message { display: flex; }
      .message.user { justify-content: flex-end; }
      .message.assistant { justify-content: flex-start; }
      .message-bubble { max-width: 85%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; }
      .message.user .message-bubble { background: var(--primary); color: white; border-bottom-right-radius: 4px; }
      .message.assistant .message-bubble { background: var(--card); border: 1px solid var(--border); color: var(--foreground); border-bottom-left-radius: 4px; }
      .message-content p { margin: 0 0 8px; } .message-content p:last-child { margin-bottom: 0; }
      .message-content pre { background: rgba(0,0,0,0.05); border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; font-size: 12px; }
      .message.user .message-content pre { background: rgba(255,255,255,0.15); }
      .message-content code { background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; font-family: 'SFMono-Regular', Consolas, monospace; }
      .message.user .message-content code { background: rgba(255,255,255,0.2); }
      .message-content pre code { background: none; padding: 0; }
      .message-content ul, .message-content ol { margin: 6px 0; padding-left: 20px; }
      .message-content a { color: inherit; text-decoration: underline; }
      .message-user-actions { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .message-expandable { position: relative; }
      .message-expandable.is-collapsed { max-height: 220px; overflow: hidden; }
      .message-expandable.is-collapsed::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 56px; background: linear-gradient(to top, var(--card), transparent); pointer-events: none; }
      .message.user .message-expandable.is-collapsed::after { background: linear-gradient(to top, var(--primary), rgba(77, 182, 172, 0)); }
      .message-expand-toggle { margin-top: 8px; border: none; background: transparent; color: var(--primary); font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }
      .message-expand-toggle:hover { text-decoration: underline; }
      .message-time { font-size: 10px; margin-top: 6px; opacity: 0.7; }
      .message.user .message-time { text-align: right; }
      .message-footer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; min-height: 24px; }
      .message-footer-row .message-time { margin-top: 0; }
      .message-actions { display: flex; justify-content: flex-end; margin-bottom: 0; }
      .message-copy-btn { width: 24px; height: 24px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: all 0.15s ease; }
      .message-copy-btn svg { width: 13px; height: 13px; }
      .message-copy-btn:hover { opacity: 1; color: var(--primary); border-color: rgba(77, 182, 172, 0.35); background: rgba(77, 182, 172, 0.08); }
      .message-copy-btn.copied { opacity: 1; color: #047857; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.12); }
      .message-save-btn { width: 24px; height: 24px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: all 0.15s ease; }
      .message-save-btn svg { width: 13px; height: 13px; }
      .message-save-btn:hover { opacity: 1; color: var(--primary); border-color: rgba(77, 182, 172, 0.35); background: rgba(77, 182, 172, 0.08); }
      .message-save-btn.saved { opacity: 1; color: #047857; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.12); }
      .message.user .message-copy-btn { border-color: rgba(255,255,255,0.38); background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.92); }
      .message.user .message-copy-btn:hover { background: rgba(255,255,255,0.22); color: #ffffff; border-color: rgba(255,255,255,0.55); }
      .message.user .message-save-btn { border-color: rgba(255,255,255,0.38); background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.92); }
      .message.user .message-save-btn:hover { background: rgba(255,255,255,0.22); color: #ffffff; border-color: rgba(255,255,255,0.55); }
      .message.user .message-save-btn.saved { color: #ffffff; border-color: rgba(255,255,255,0.8); background: rgba(16, 185, 129, 0.35); }
      .message-bubble:hover .message-copy-btn,
      .message-bubble:focus-within .message-copy-btn,
      .message-bubble:hover .message-save-btn,
      .message-bubble:focus-within .message-save-btn { opacity: 1; pointer-events: auto; }

      /* Tool Messages */
      .message.tool { justify-content: flex-start; }
      .message.tool .message-bubble { max-width: 90%; padding: 8px 14px; border-radius: 12px; background: rgba(241, 245, 249, 0.8); border: 1px solid rgba(226, 232, 240, 0.6); font-size: 13px; color: var(--muted-foreground); }
      .tool-label { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; font-size: 12px; color: var(--primary); }
      .tool-label svg { width: 14px; height: 14px; }
      .tool-output { margin-top: 4px; font-size: 12px; color: #475569; white-space: pre-wrap; font-family: 'SFMono-Regular', Consolas, monospace; }
      .tool-output.message-expandable.is-collapsed { max-height: 140px; }
      .message.tool .message-expandable.is-collapsed::after { background: linear-gradient(to top, rgba(241, 245, 249, 0.98), rgba(241, 245, 249, 0)); }
      .tool-output.error { color: #dc2626; }

      /* Error Message */
      .message.error { justify-content: flex-start; }
      .message.error .message-bubble { max-width: 85%; padding: 12px 16px; border-radius: 16px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-bottom-left-radius: 4px; }

      /* Thinking Indicator */
      .thinking-indicator { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; color: var(--muted-foreground); }
      .typing-dots { display: inline-flex; align-items: center; gap: 3px; }
      .typing-dots span { width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: typing-dots 1.2s infinite ease-in-out; }
      .typing-dots span:nth-child(2) { animation-delay: 0.15s; }
      .typing-dots span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes typing-dots { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-3px); opacity: 1; } }

      /* Chat Input Bar */
      .chat-input-bar { --composer-row-max-width: 960px; flex-shrink: 0; display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 14px 20px; background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(8px); border-top: 1px solid var(--border); }
      .chat-input-main { display: flex; align-items: flex-end; justify-content: flex-start; gap: 12px; width: min(100%, var(--composer-row-max-width)); margin: 0 auto; }
      .chat-input-field-wrap { position: relative; flex: 1; min-width: 0; display: flex; align-items: flex-end; }
      .chat-input-main textarea { flex: 1; min-width: 0; min-height: 40px; max-height: 120px; resize: none; padding: 8px 42px; border-radius: 12px; border: 1px solid var(--border); font-size: 14px; line-height: 1.5; background: var(--card); color: var(--foreground); font-family: inherit; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: rgba(100, 116, 139, 0.24) transparent; transition: border-color 0.15s ease; }
      .chat-input-main textarea::-webkit-scrollbar { width: 4px; }
      .chat-input-main textarea::-webkit-scrollbar-track { background: transparent; }
      .chat-input-main textarea::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.24); border-radius: 999px; }
      .chat-input-main textarea::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.34); }
      .chat-input-main textarea:focus { outline: none; border-color: rgba(77, 182, 172, 0.5); }
      .chat-input-main textarea::placeholder { color: var(--muted-foreground); }
      .mobile-composer-inline-btn { display: inline-flex; width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }
      .mobile-composer-inline-btn svg { width: 15px; height: 15px; }
      .mobile-composer-inline-btn:hover { background: rgba(77, 182, 172, 0.08); color: var(--primary); border-color: rgba(77, 182, 172, 0.35); }
      .mobile-composer-inline-btn.active-voice { background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.4); color: #047857; }
      .mobile-composer-inline-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .input-field-wrap .mobile-composer-inline-btn.add { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); z-index: 2; }
      .input-field-wrap .mobile-composer-inline-btn.voice { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); z-index: 2; }
      .chat-input-field-wrap .mobile-composer-inline-btn.add { position: absolute; left: 6px; bottom: 5px; top: auto; transform: none; z-index: 2; }
      .chat-input-field-wrap .mobile-composer-inline-btn.voice { position: absolute; right: 6px; bottom: 5px; top: auto; transform: none; z-index: 2; }
      .mobile-composer-compact { display: none; width: min(100%, var(--composer-row-max-width, 100%)); margin: 0 auto; }
      .mobile-composer-more-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; background: var(--card); color: var(--muted-foreground); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
      .mobile-composer-more-btn svg { width: 13px; height: 13px; }
      .mobile-composer-more-btn:hover { background: rgba(77, 182, 172, 0.08); border-color: rgba(77, 182, 172, 0.35); color: var(--primary); }
      .mobile-composer-more-btn.active-incognito { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.38); color: #92400e; }
      .mobile-composer-option-entry { width: 100%; border: 1px solid var(--border); border-radius: 10px; background: var(--card); color: var(--foreground); font-size: 13px; font-weight: 600; text-align: left; padding: 10px 12px; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 8px; }
      .mobile-composer-option-entry svg { width: 14px; height: 14px; flex-shrink: 0; }
      .mobile-composer-option-entry:hover { background: rgba(77, 182, 172, 0.08); border-color: rgba(77, 182, 172, 0.35); color: var(--primary); }
      .mobile-composer-option-count { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 5px; border-radius: 999px; font-size: 10px; font-weight: 700; background: rgba(77, 182, 172, 0.14); color: var(--primary); line-height: 1; }
      .btn-action { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 12px 20px; border-radius: 12px; border: none; background: var(--primary); color: white; font-weight: 600; font-size: 14px; cursor: pointer; transition: all 0.2s ease; font-family: inherit; }
      .btn-action:hover { background: var(--primary-dark); }
      .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-action svg { width: 16px; height: 16px; }
      .btn-action.stopping { padding: 10px; border-radius: 10px; background: transparent; border: 1px solid var(--border); color: var(--muted-foreground); }
      .btn-action.stopping:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: #ef4444; }
      .btn-action.stopping svg { width: 14px; height: 14px; }
      .composer-options { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: auto; min-width: 0; margin: 0; justify-content: flex-start; flex: 0 1 auto; }
      .composer-option-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; background: var(--card); color: var(--muted-foreground); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
      .composer-option-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
      .composer-option-btn:hover { background: rgba(77, 182, 172, 0.08); border-color: rgba(77, 182, 172, 0.35); color: var(--primary); }
      .composer-option-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .composer-option-btn.active-incognito { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.38); color: #92400e; }
      .composer-option-btn.active-voice { background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.4); color: #047857; }
      #initialAddFilesBtn,
      #followAddFilesBtn,
      #initialVoiceWakeBtn,
      #followVoiceWakeBtn { display: none !important; }
      .composer-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; border-radius: 999px; padding: 0 6px; font-size: 10px; background: rgba(77, 182, 172, 0.14); color: var(--primary); }
      .composer-meta { display: flex; flex-wrap: wrap; gap: 6px; min-height: 0; width: min(100%, var(--composer-row-max-width, 100%)); margin: 0 auto; }
      .composer-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 999px; padding: 5px 10px; background: var(--muted); color: var(--foreground); font-size: 11px; }
      .composer-chip.file { border-radius: 10px; }
      .composer-chip button { width: 16px; height: 16px; border: none; border-radius: 6px; background: transparent; color: var(--muted-foreground); cursor: pointer; padding: 0; line-height: 16px; }
      .composer-chip button:hover { color: #ef4444; background: rgba(239, 68, 68, 0.08); }
      .saved-prompt-list { max-height: 280px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; padding: 6px; background: var(--background); }
      .saved-prompt-item { width: 100%; border: none; border-radius: 10px; background: transparent; text-align: left; padding: 10px; cursor: pointer; color: var(--foreground); transition: background 0.12s ease; }
      .saved-prompt-item:hover { background: rgba(77, 182, 172, 0.08); }
      .saved-prompt-item.active { background: rgba(77, 182, 172, 0.12); }
      .saved-prompt-select-search {
        display: flex;
        align-items: center;
        gap: 2px;
        margin-bottom: 10px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--card);
        padding: 0 6px;
      }
      .saved-prompt-select-search:focus-within { border-color: rgba(77, 182, 172, 0.5); }
      .saved-prompt-select-search svg {
        width: 14px;
        height: 14px;
        color: var(--muted-foreground);
        pointer-events: none;
        flex-shrink: 0;
        display: block;
      }
      .saved-prompt-select-search input {
        width: 100%;
        border: none !important;
        outline: none;
        background: transparent;
        min-height: 40px;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box;
        font-size: 14px;
      }
      .saved-prompt-select-hint { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--muted-foreground); margin-top: 8px; }
      .saved-prompt-select-hint kbd { font-family: 'SFMono-Regular', Consolas, monospace; background: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 1px 5px; font-size: 10px; color: var(--foreground); }
      .saved-prompt-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
      .saved-prompt-content { font-size: 12px; color: var(--muted-foreground); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
      .saved-prompt-empty { font-size: 12px; color: var(--muted-foreground); padding: 10px; text-align: center; }
      .saved-prompt-manage-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
      .saved-prompt-manage-layout > * { min-width: 0; }
      .saved-prompt-editor { min-width: 0; }
      .saved-prompt-editor textarea { width: 100%; max-width: 100%; min-height: 140px; resize: vertical; border-radius: 10px; border: 1px solid var(--border); padding: 10px; font-size: 13px; font-family: inherit; color: var(--foreground); background: var(--card); box-sizing: border-box; }
      .saved-prompt-editor textarea:focus { outline: none; border-color: rgba(77, 182, 172, 0.5); }
      .saved-prompt-editor input { width: 100%; max-width: 100%; margin-bottom: 8px; box-sizing: border-box; }
      .saved-prompt-editor .modal-actions { justify-content: flex-start; flex-wrap: wrap; }
      .saved-prompt-editor .modal-actions button { max-width: 100%; box-sizing: border-box; }
      .save-prompt-preview { width: 100%; max-height: 180px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--muted); color: var(--foreground); padding: 10px; font-size: 12px; white-space: pre-wrap; word-break: break-word; margin-top: 8px; box-sizing: border-box; }
      .save-prompt-error { color: #dc2626; font-size: 12px; margin-top: 8px; display: none; }
      .save-prompt-error.visible { display: block; }

      /* ========== AUTH MODAL ========== */
      .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); align-items: center; justify-content: center; padding: 24px; z-index: 50; backdrop-filter: blur(6px); }
      .modal-overlay.visible { display: flex; }
      .modal { width: 100%; max-width: 420px; background: var(--card); border-radius: 18px; padding: 24px; border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(15, 23, 42, 0.2); }
      .modal h2 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
      .modal p { font-size: 14px; color: var(--muted-foreground); margin-bottom: 16px; }
      .modal input { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); font-size: 14px; margin-bottom: 12px; font-family: inherit; }
      .modal select { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); font-size: 14px; margin-bottom: 12px; font-family: inherit; color: var(--foreground); background: var(--card); }
      .modal input:focus { outline: none; border-color: rgba(77, 182, 172, 0.5); }
      .modal select:focus { outline: none; border-color: rgba(77, 182, 172, 0.5); }
      .theme-setting-mobile { display: none; margin-bottom: 6px; }
      .theme-setting-mobile label { display: block; font-size: 12px; font-weight: 600; color: var(--muted-foreground); margin-bottom: 6px; }
      .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
      .modal-actions button { padding: 10px 16px; border-radius: 12px; font-weight: 600; font-size: 14px; cursor: pointer; border: none; font-family: inherit; }
      .modal-actions .btn-primary { background: var(--primary); color: white; }
      .modal-actions .btn-secondary { background: var(--muted); color: var(--foreground); }
      .auth-error { color: #dc2626; font-size: 12px; margin-top: -8px; margin-bottom: 12px; display: none; }
      .auth-error.visible { display: block; }
      .auth-status { font-size: 12px; color: var(--muted-foreground); margin-bottom: 12px; }
      .auth-status .ok { color: #16a34a; font-weight: 600; }
      .auth-status .bad { color: #dc2626; font-weight: 600; }

      /* ========== PERMISSION MODAL ========== */
      .perm-icon { width: 40px; height: 40px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .perm-icon.file { background: rgba(245, 158, 11, 0.15); color: #b45309; }
      .perm-icon.tool { background: rgba(250, 204, 21, 0.18); color: #92400e; }
      .perm-box { background: var(--muted); border: 1px solid var(--border); border-radius: 12px; padding: 12px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: var(--foreground); word-break: break-all; margin-top: 12px; }
      .perm-preview { background: var(--muted); border: 1px solid var(--border); border-radius: 12px; padding: 10px; font-size: 12px; max-height: 160px; overflow: auto; white-space: pre-wrap; margin-top: 10px; }
      .perm-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }

      /* ========== MOBILE RESPONSIVE ========== */
      @media (max-width: 768px) {
        .app-container { flex-direction: column; }
        .sidebar { width: 100%; height: auto; border-right: none; border-bottom: 1px solid var(--border); flex-shrink: 0; overflow: visible; position: fixed; top: var(--odm-mobile-top-offset, 0px); left: 0; right: 0; z-index: 40; background: var(--card); padding-top: env(safe-area-inset-top, 0px); }
        .sidebar-header { display: none; }
        .sidebar-actions { display: flex !important; padding: 10px 12px; gap: 8px; align-items: center; }
        .sidebar-footer { display: none; }
        .btn-desktop-only { display: none; }
        .btn-mobile-tasks { display: flex; }
        .btn-new-task { flex: 6; }
        .task-list { display: none; }
        .main-content { flex: 1; min-height: 0; margin-top: calc(var(--odm-mobile-toolbar-height, 61px) + var(--odm-mobile-top-offset, 0px) + var(--odm-mobile-header-gap, 18px)); height: calc(var(--odm-mobile-vh, 100dvh) - var(--odm-mobile-toolbar-height, 61px) - var(--odm-mobile-header-gap, 18px)); }
        .initial-state { padding: 14px 10px; gap: 12px; }
        body.keyboard-open .initial-state { justify-content: flex-end; gap: 4px; padding: 6px 8px 0; }
        body.keyboard-open .initial-state > div:first-child { display: none; }
        body.keyboard-open .initial-state .task-card { padding: 8px; margin-bottom: calc(-1 * var(--odm-mobile-initial-keyboard-shift, 0px)); }
        body.keyboard-open .initial-state .mobile-composer-compact { display: flex !important; margin-top: 2px !important; }
        body.keyboard-open .initial-state #initialComposerBottomRow { display: none; margin-top: 0; }
        body.keyboard-open .initial-state #initialComposerMeta { margin-top: 0; }
        .hero-title { font-size: 24px; }
        .hero-subtitle { font-size: 14px; }
        .task-card { max-width: 100%; padding: 10px; }
        .usage-banner-inner { padding: 8px 12px; gap: 8px; }
        .usage-period-tabs { padding: 3px; gap: 3px; }
        .usage-period-btn { padding: 5px 8px; font-size: 10px; }
        .usage-cost { display: none; }
        .usage-details-link { font-size: 11px; }
        .usage-details-grid { gap: 8px; }
        .chat-header { padding: 6px 12px 4px; gap: 8px; }
        .btn-back { width: 32px; height: 32px; border-radius: 9px; }
        .btn-back svg { width: 18px; height: 18px; }
        .status-badge { padding: 2px 8px; font-size: 10px; }
        .agent-badge { padding: 2px 8px; font-size: 10px; }
        .model-badge { display: none !important; }
        .mobile-model-btn { display: inline-flex; height: 24px; padding: 0 8px; font-size: 10px; }
        .messages-area { padding: 4px 12px 12px; }
        .messages-list { max-width: none; width: 100%; gap: 12px; }
        .scroll-bottom-btn { bottom: 196px; }
        .message-bubble { max-width: 96%; width: fit-content; }
        .message.tool .message-bubble { max-width: 96%; }
        .message.error .message-bubble { max-width: 96%; }
        .message-copy-btn { opacity: 1; pointer-events: auto; }
        .message-save-btn { opacity: 1; pointer-events: auto; }
        .message-content, .tool-output, .message-content p, .message-content li { overflow-wrap: anywhere; word-break: break-word; }
        .message-content pre { max-width: 100%; overflow-x: auto; }
        .chat-input-bar { padding: 8px 12px; }
        #chatInputBar { padding: 6px 12px calc(6px + env(safe-area-inset-bottom, 0px)); gap: 2px; }
        .chat-input-main { gap: 8px; }
        .chat-input-main .action-label { display: none !important; }
        .composer-bottom-row { margin-top: 6px; gap: 6px; }
        .context-indicator-row { margin-left: 0; }
        .context-indicator-badge { font-size: 10px; padding: 3px 8px; }
        .context-indicator-sep, .context-indicator-detail { display: none; }
        .context-info-popover { width: min(300px, calc(100vw - 16px)); padding: 9px 10px; }
        .context-info-popover-text { font-size: 11px; }
        .context-info-popover-trimmed { font-size: 10px; }
        .context-info-popover-row { font-size: 10px; }
        .composer-options { display: none; }
        .mobile-composer-compact { display: flex; align-items: center; gap: 8px; }
        .mobile-composer-compact .context-indicator-row { margin-left: 4px; }
        #chatInputBar .composer-bottom-row { display: none; margin-top: 0; }
        #chatInputBar .mobile-composer-compact { margin-top: 0; margin-bottom: 2px; }
        #chatInputBar .composer-meta { margin-top: 0; }
        .mobile-composer-inline-btn { display: inline-flex; }
        .input-container { gap: 8px; padding: 6px 8px; }
        .input-field-wrap .mobile-composer-inline-btn.add { position: absolute; left: 2px; z-index: 2; }
        .input-field-wrap .mobile-composer-inline-btn.voice { position: absolute; right: 2px; z-index: 2; }
        .input-field-wrap.has-text .mobile-composer-inline-btn.voice { display: none !important; }
        .input-container textarea { padding-left: 36px; padding-right: 36px; padding-top: 9px; padding-bottom: 9px; line-height: 1.5; min-height: 40px; height: 40px; box-sizing: border-box; }
        .input-field-wrap.has-text textarea { padding-right: 8px; }
        .chat-input-field-wrap .mobile-composer-inline-btn.add { position: absolute; left: 6px; bottom: 5px; top: auto; transform: none; z-index: 2; }
        .chat-input-field-wrap .mobile-composer-inline-btn.voice { position: absolute; right: 6px; bottom: 5px; top: auto; transform: none; z-index: 2; }
        .chat-input-main textarea { min-height: 40px; max-height: 120px; padding-left: 42px; padding-right: 42px; }
        .chat-input-field-wrap.has-text .mobile-composer-inline-btn.voice { display: none !important; }
        .chat-input-field-wrap.has-text textarea { padding-right: 14px; }
        .initial-state .mobile-composer-compact { margin-top: 6px !important; }
        .mobile-composer-more-btn { padding: 6px 8px; font-size: 11px; }
        .composer-option-btn { padding: 6px 8px; font-size: 11px; }
        .saved-prompt-manage-layout { grid-template-columns: 1fr; }
        #savedPromptManageModal { padding: 12px; }
        #savedPromptManageModal .modal { max-width: 100%; padding: 14px; }
        #savedPromptManageModal .saved-prompt-list { max-height: 220px; }
        #savedPromptManageModal .modal-actions { gap: 8px; }
        #savedPromptManageModal .modal-actions button { flex: 1 1 calc(50% - 8px); min-width: 120px; }
      }
      /* Mobile task panel overlay */
      .mobile-task-overlay { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); z-index: 50; backdrop-filter: blur(4px); opacity: 0; transition: opacity 0.25s ease; }
      .mobile-task-overlay.visible { display: block; opacity: 1; }
      .mobile-task-panel { position: fixed; top: 0; left: 0; bottom: 0; width: 85%; max-width: 320px; background: var(--card); z-index: 51; transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15); touch-action: pan-y; will-change: transform; }
      .mobile-task-panel.visible { transform: translateX(0); }
      .mobile-task-panel.dragging { transition: none !important; }
      .mobile-task-panel-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
      .mobile-task-panel-header h3 { font-size: 16px; font-weight: 600; color: var(--foreground); margin: 0; white-space: nowrap; }
      .mobile-agent-switcher { flex: 1; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.8); cursor: pointer; min-width: 0; transition: background 0.15s ease; }
      .mobile-agent-switcher:hover { background: rgba(77, 182, 172, 0.06); }
      .mobile-agent-switcher .agent-avatar { width: 34px; height: 34px; border-radius: 9px; font-size: 12px; flex-shrink: 0; padding: 3px; }
      .mobile-agent-switcher .agent-info { flex: 1; min-width: 0; }
      .mobile-agent-switcher .agent-name { font-size: 13px; }
      .mobile-agent-switcher .agent-id { font-size: 10px; }
      .mobile-task-panel-close { width: 32px; height: 32px; border: none; background: transparent; cursor: pointer; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); flex-shrink: 0; }
      .mobile-task-panel-close:hover { background: var(--muted); color: var(--foreground); }
      .mobile-task-panel-actions { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
      .mobile-task-panel-actions button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--muted-foreground); cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.15s ease; }
      .mobile-task-panel-actions button svg { width: 14px; height: 14px; }
      .mobile-task-panel-actions button:hover { background: rgba(77, 182, 172, 0.08); color: var(--primary); border-color: var(--primary); }
      .mobile-task-panel-list { flex: 1; overflow-y: auto; padding: 8px 12px; }
      .mobile-task-panel-footer { padding: 12px 16px; border-top: 1px solid var(--border); }
      .mobile-agent-popup { position: fixed; z-index: 120; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 600; color: var(--foreground); box-shadow: 0 10px 26px rgba(15, 23, 42, 0.18); opacity: 0; transform: translateY(4px); pointer-events: none; transition: opacity 0.15s ease, transform 0.15s ease; white-space: nowrap; }
      .mobile-agent-popup.visible { opacity: 1; transform: translateY(0); }
      .mobile-connected-badge { align-items: center; justify-content: center; gap: 4px; font-size: 10px; font-weight: 600; color: var(--primary); cursor: pointer; background: rgba(77,182,172,0.1); height: 40px; min-width: 40px; padding: 0 8px; border-radius: 12px; border: 1px solid rgba(77,182,172,0.2); white-space: nowrap; user-select: none; }
      @media (min-width: 769px) {
        .sidebar-toggle { display: none; }
        .btn-mobile-tasks { display: none; }
        .mobile-only { display: none !important; }
        .mobile-task-overlay, .mobile-task-panel { display: none !important; }
      }
      @media (max-width: 768px) {
        .theme-setting-mobile { display: block; }
      }
    </style>
  </head>
  <body>
    <!-- Permission Modal -->
    <div class="modal-overlay" id="permissionModal">
      <div class="modal" style="max-width:560px;">
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <div id="permissionIcon" class="perm-icon tool">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 8v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/><path d="M12 3.5l9 16a1.5 1.5 0 0 1-1.3 2.25H4.3A1.5 1.5 0 0 1 3 19.5l9-16z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <h2 id="permissionTitle" style="margin-bottom:6px;">Permission Required</h2>
            <p id="permissionSubtitle" style="margin-bottom:8px;">The assistant needs approval.</p>
            <div id="permissionBadge" class="perm-badge" style="display:none;"></div>
          </div>
        </div>
        <p id="permissionPrompt" style="margin-top:10px;"></p>
        <div id="permissionPath" class="perm-box" style="display:none;"></div>
        <div id="permissionTarget" class="perm-box" style="display:none;"></div>
        <div id="permissionPreview" class="perm-preview" style="display:none;"></div>
        <div id="permissionDetails" class="perm-box" style="display:none;"></div>
        <div id="permissionOptions" style="margin-top:12px;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button id="permissionDeny" class="btn-secondary">Deny</button>
          <button id="permissionAllowAll" class="btn-secondary" style="display:none;">Allow all (this task)</button>
          <button id="permissionAllow" class="btn-primary">Allow</button>
        </div>
      </div>
    </div>

    <!-- Auth Modal -->
    <div class="modal-overlay" id="authModal">
      <div class="modal">
        <h2>Access Required</h2>
        <p id="authHint">Enter your access token to continue.</p>
        <div id="authStatus" class="auth-status"></div>
        <div class="theme-setting-mobile">
          <label for="themeSelect">Theme</label>
          <select id="themeSelect" aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <input id="authInput" type="password" placeholder="Access token" />
        <div id="authError" class="auth-error"></div>
        <div class="modal-actions">
          <button id="authClear" class="btn-secondary">Clear</button>
          <button id="authSave" class="btn-primary">Save & Connect</button>
        </div>
      </div>
    </div>

    <!-- Usage Details Modal -->
    <div class="modal-overlay" id="usageDetailsModal">
      <div class="modal" style="max-width:640px;max-height:80vh;display:flex;flex-direction:column;">
        <h2 style="margin-bottom:10px;">Usage estimate</h2>
        <div id="usageDetailsBody" style="overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;gap:12px;"></div>
        <div class="modal-actions" style="margin-top:14px;">
          <button id="usageDetailsClose" class="btn-secondary">Close</button>
        </div>
      </div>
    </div>

    <!-- Mobile Task Panel -->
    <div class="mobile-task-overlay" id="mobileTaskOverlay"></div>
    <div class="mobile-task-panel" id="mobileTaskPanel">
      <div class="mobile-task-panel-header">
        <h3>Tasks</h3>
        <div class="mobile-agent-switcher" id="mobileAgentSwitcher">
          <div class="agent-avatar" id="mobileAgentAvatar">A</div>
          <div class="agent-info">
            <span class="agent-name" id="mobileAgentName">Agent</span>
            <span class="agent-id" id="mobileAgentId">main</span>
          </div>
          <span class="chevron">▾</span>
        </div>
        <button class="mobile-task-panel-close" id="mobileTaskPanelClose">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="mobile-task-panel-actions">
        <button id="mobilePanelNewProject">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          New Project
        </button>
        <button id="mobilePanelSearch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          Search
        </button>
      </div>
      <div class="mobile-task-panel-list" id="mobileTaskList"></div>
      <div class="mobile-task-panel-footer">
        <div class="logo">${logoUri ? '<img src="' + logoUri + '" alt="Open Deskmate" style="height:30px;" />' : '<span style="font-weight:700;font-size:13px;color:var(--primary);">Open Deskmate</span>'}</div>
      </div>
    </div>

    <!-- Main App -->
    <div class="app-container">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <button class="agent-switcher" id="agentSwitcher">
            <div class="agent-avatar" id="agentAvatar">A</div>
            <div class="agent-info">
              <span class="agent-name" id="agentName">Agent</span>
              <span class="agent-id" id="agentIdDisplay">main</span>
            </div>
            <span class="chevron">▾</span>
          </button>
          <button class="sidebar-toggle" id="sidebarToggle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
        <div class="sidebar-actions">
          <button class="btn-sidebar-icon btn-mobile-tasks" id="mobileTasksBtn" title="Tasks">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
          </button>
          <button class="btn-new-task" id="newTaskBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>
            New Task
          </button>
          <button class="btn-sidebar-icon btn-desktop-only" id="newProjectBtn" title="New Project">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="btn-sidebar-icon btn-desktop-only" id="searchTasksBtn" title="Search Tasks">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
          <span class="mobile-only" style="flex:0;"></span>
          <span class="mobile-only mobile-connected-agent-avatar" id="mobileConnectedAgentAvatar" title="Current agent">A</span>
          <span class="mobile-only mobile-connected-badge" id="mobileConnectedBadge" title="Token stored and validated, you are connected" style="display:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:10px;height:10px;flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <button class="btn-sidebar-icon mobile-only" id="mobileSettingsBtn" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
        <div class="task-list" id="taskList">
          <div class="folder-section" id="projectsSection">
            <div class="folder-header">
              <span class="folder-header-title">Projects</span>
              <button class="folder-header-btn" id="addFolderBtn" title="New Project">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
            <div id="folderList"></div>
          </div>
          <div class="unfiled-section" id="unfiledSection">
            <div class="folder-header">
              <span class="folder-header-title">Unfiled</span>
            </div>
            <div id="unfiledTasks"></div>
          </div>
        </div>
        <div class="sidebar-footer">
          <div class="logo">${logoUri ? '<img src="' + logoUri + '" alt="Open Deskmate" />' : '<span style="font-weight:700;font-size:14px;color:var(--primary);">Open Deskmate</span>'}</div>
          <div class="sidebar-footer-controls">
            <span
              id="connectedBadge"
              class="footer-icon-btn connected-badge-icon footer-hover-pop"
              title="Status: Connected"
              data-status-label="Status: Connected"
              style="display:none;"
              aria-label="Connection status"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <div class="theme-menu-wrap btn-desktop-only" id="themeMenuWrap">
              <button class="btn-sidebar-icon footer-hover-pop" id="themeBtn" title="Theme: System" data-status-label="Theme: System" aria-label="Theme" aria-haspopup="menu" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 18v2"/></svg>
              </button>
              <div class="theme-menu" id="themeMenu" role="menu">
                <button type="button" class="theme-menu-item" data-theme-option="light" role="menuitemradio" aria-checked="false">
                  <span>Light</span>
                  <span class="theme-check">✓</span>
                </button>
                <button type="button" class="theme-menu-item" data-theme-option="dark" role="menuitemradio" aria-checked="false">
                  <span>Dark</span>
                  <span class="theme-check">✓</span>
                </button>
                <button type="button" class="theme-menu-item" data-theme-option="system" role="menuitemradio" aria-checked="true">
                  <span>System</span>
                  <span class="theme-check">✓</span>
                </button>
              </div>
            </div>
            <button class="btn-settings" id="settingsBtn" title="Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <section class="usage-banner" id="usageBanner" role="button" tabindex="0" aria-label="Open usage estimate details">
          <div class="usage-banner-inner">
            <div class="usage-period-tabs" id="usagePeriodTabs">
              <button type="button" class="usage-period-btn active" data-usage-period="day">Day</button>
              <button type="button" class="usage-period-btn" data-usage-period="week">Week</button>
              <button type="button" class="usage-period-btn" data-usage-period="month">Month</button>
            </div>
            <div class="usage-summary">
              <div class="usage-summary-main">
                <span class="usage-tokens" id="usageTokensText">Tokens: 0</span>
                <span class="usage-cost" id="usageCostText"></span>
              </div>
              <div class="usage-subtitle" id="usageSubtitleText">Add pricing to see cost</div>
            </div>
            <div class="usage-details-link">Details</div>
          </div>
        </section>
        <header class="chat-header initial-chat-header" id="initialChatHeader">
          <span class="status-badge s-pending" id="initialStatusBadge">Ready</span>
          <span class="model-badge" id="initialModelBadge" style="display:none;">Model: --</span>
          <button class="mobile-model-btn mobile-only" id="initialMobileModelBtn" type="button">Model</button>
          <span class="agent-badge" id="initialAgentBadge">Agent: main</span>
          <button class="fullscreen-btn btn-desktop-only" id="initialFullscreenBtn" type="button" title="Enter full screen" aria-label="Enter full screen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
        </header>
        <!-- Initial State -->
        <div class="initial-state" id="initialState">
          <div>
            <h1 class="hero-title">What will you <span>accomplish</span> today?</h1>
            <p class="hero-subtitle">Describe a task and let AI handle the rest</p>
          </div>
          <div class="task-card">
            <form id="taskForm" autocomplete="off" novalidate onsubmit="return false;">
              <div class="input-container">
                <div class="input-field-wrap" id="initialInputFieldWrap">
                  <button type="button" class="mobile-composer-inline-btn add" id="initialInlineAddFilesBtn" title="Add files" aria-label="Add files">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                  <textarea
                    id="prompt"
                    name="chat_prompt"
                    placeholder="Type your task here..."
                    rows="1"
                    autocomplete="off"
                    autocapitalize="sentences"
                    autocorrect="off"
                    spellcheck="true"
                    enterkeyhint="send"
                    data-lpignore="true"
                  ></textarea>
                  <button type="button" class="mobile-composer-inline-btn voice" id="initialInlineVoiceWakeBtn" title="Voice wake" aria-label="Voice wake">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg>
                  </button>
                </div>
                <button type="button" class="btn-submit" id="submitBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </button>
              </div>
              <select id="agentSelect" style="display:none;"></select>
              <div class="mobile-composer-compact" id="initialMobileCompactActions" style="margin-top:8px;">
                <button type="button" class="mobile-composer-more-btn" id="initialMobileMoreBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 14H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  Options
                </button>
              </div>
              <div class="composer-bottom-row" id="initialComposerBottomRow">
                <div class="composer-options" id="initialComposerOptions">
                  <button type="button" class="composer-option-btn" id="initialAddFilesBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                    Add files
                  </button>
                  <button type="button" class="composer-option-btn" id="initialIncognitoBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    <span class="composer-label">Incognito</span>
                  </button>
                  <button type="button" class="composer-option-btn" id="initialFolderBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    Work in folder
                  </button>
                  <button type="button" class="composer-option-btn" id="initialUsePromptBtn" title="Use saved prompt" aria-label="Use saved prompt">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
                    <span class="composer-badge" id="initialSavedPromptCount">0</span>
                  </button>
                  <button type="button" class="composer-option-btn" id="initialManagePromptBtn" title="Manage saved prompts" aria-label="Manage saved prompts">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 14H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  </button>
                  <button type="button" class="composer-option-btn" id="initialVoiceWakeBtn" title="Click to turn on voice wake">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg>
                    <span class="composer-label">Voice wake: Off</span>
                  </button>
                </div>
                <div class="context-indicator-row">
                  <div class="context-indicator-badge context-green" id="initialContextIndicator" style="display:none;"></div>
                </div>
              </div>
              <div class="composer-meta" id="initialComposerMeta"></div>
            </form>
            <input
              type="file"
              id="composerFileInput"
              multiple
              accept="*/*,.txt,.md,.json,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.mp3,.wav"
              style="display:none;"
            />
          </div>
        </div>

        <!-- Chat State -->
        <div class="chat-state" id="chatState">
          <header class="chat-header">
            <button class="btn-back" id="backBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <h2 class="chat-title" id="chatTitle">Task</h2>
            <span class="status-badge s-running" id="statusBadge">Running</span>
            <span class="model-badge" id="modelBadge" style="display:none;">Model: --</span>
            <button class="mobile-model-btn mobile-only" id="mobileModelBtn" type="button">Model</button>
            <span class="agent-badge" id="agentBadge">Agent: main</span>
            <button class="fullscreen-btn btn-desktop-only" id="fullscreenBtn" type="button" title="Enter full screen" aria-label="Enter full screen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            </button>
          </header>
          <div class="messages-area" id="messagesArea">
            <div class="messages-list" id="messagesList"></div>
          </div>
          <button class="scroll-bottom-btn" id="scrollBottomBtn" type="button" title="Scroll to bottom" aria-label="Scroll to bottom">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="chat-input-bar" id="chatInputBar">
            <div class="chat-input-main">
              <div class="chat-input-field-wrap" id="followInputFieldWrap">
                <button type="button" class="mobile-composer-inline-btn add" id="followInlineAddFilesBtn" title="Add files" aria-label="Add files">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                </button>
                <textarea
                  id="followUpInput"
                  name="chat_follow_up"
                  placeholder="Give new instructions..."
                  rows="1"
                  autocomplete="off"
                  autocapitalize="sentences"
                  autocorrect="off"
                  spellcheck="true"
                  enterkeyhint="send"
                  data-lpignore="true"
                ></textarea>
                <button type="button" class="mobile-composer-inline-btn voice" id="followInlineVoiceWakeBtn" title="Voice wake" aria-label="Voice wake">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg>
                </button>
              </div>
              <button class="btn-action" id="actionBtn">
                <svg class="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                <svg class="icon-stop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
                <span class="action-label">Send</span>
              </button>
            </div>
            <div class="mobile-composer-compact" id="followMobileCompactActions">
              <button type="button" class="mobile-composer-more-btn" id="followMobileMoreBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 14H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Options
              </button>
            </div>
            <div class="composer-bottom-row" id="followComposerBottomRow">
              <div class="composer-options" id="followComposerOptions">
                <button type="button" class="composer-option-btn" id="followAddFilesBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  Add files
                </button>
                <button type="button" class="composer-option-btn" id="followIncognitoBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span class="composer-label">Incognito</span>
                </button>
                <button type="button" class="composer-option-btn" id="followFolderBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  Work in folder
                </button>
                <button type="button" class="composer-option-btn" id="followUsePromptBtn" title="Use saved prompt" aria-label="Use saved prompt">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
                  <span class="composer-badge" id="followSavedPromptCount">0</span>
                </button>
                <button type="button" class="composer-option-btn" id="followManagePromptBtn" title="Manage saved prompts" aria-label="Manage saved prompts">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 14H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <button type="button" class="composer-option-btn" id="followVoiceWakeBtn" title="Click to turn on voice wake">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg>
                  <span class="composer-label">Voice wake: Off</span>
                </button>
              </div>
              <div class="context-indicator-row">
                <div class="context-indicator-badge context-green" id="followContextIndicator" style="display:none;"></div>
              </div>
            </div>
            <div class="composer-meta" id="followComposerMeta"></div>
          </div>
        </div>
      </main>
    </div>

    <!-- Create Folder Modal -->
    <div class="folder-modal" id="folderModal">
      <div class="folder-modal-content">
        <h3 id="folderModalTitle">New Project</h3>
        <input type="text" class="folder-modal-input" id="folderNameInput" placeholder="Project name..." maxlength="50" />
        <div class="folder-modal-preview"><div class="folder-modal-preview-icon" id="folderIconPreview"></div></div>
        <div class="folder-modal-tabs">
          <button class="folder-modal-tab active" id="folderTabIcon" type="button">Icon</button>
          <button class="folder-modal-tab" id="folderTabColor" type="button">Color</button>
        </div>
        <div class="folder-modal-icons" id="folderIcons"></div>
        <div class="folder-modal-colors" id="folderColors" style="display:none;"></div>
        <div class="folder-modal-actions">
          <button class="folder-modal-btn cancel" id="folderCancelBtn">Cancel</button>
          <button class="folder-modal-btn create" id="folderSaveBtn">Create</button>
        </div>
      </div>
    </div>

    <!-- Rename Task Modal -->
    <div class="folder-modal" id="renameModal">
      <div class="folder-modal-content">
        <h3>Rename Chat</h3>
        <input type="text" class="folder-modal-input" id="renameInput" placeholder="Chat name..." maxlength="100" />
        <div class="folder-modal-actions">
          <button class="folder-modal-btn cancel" id="renameCancelBtn">Cancel</button>
          <button class="folder-modal-btn create" id="renameSaveBtn">Save</button>
        </div>
      </div>
    </div>

    <!-- Search Tasks Modal -->
    <div class="search-modal" id="searchModal">
      <div class="search-modal-content">
        <div class="search-modal-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" class="search-modal-input" id="searchInput" placeholder="Search tasks..." autofocus />
        </div>
        <div class="search-results" id="searchResults"></div>
      </div>
    </div>

    <!-- Saved Prompt Select Modal -->
    <div class="modal-overlay" id="savedPromptSelectModal">
      <div class="modal" style="max-width:560px;">
        <h2>Use a saved prompt</h2>
        <p>Select a saved prompt to insert into the input.</p>
        <div class="saved-prompt-select-search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"></circle>
            <path d="m21 21-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          </svg>
          <input id="savedPromptSelectSearchInput" type="text" placeholder="Search saved prompts..." autocomplete="off" />
        </div>
        <div class="saved-prompt-list" id="savedPromptSelectList"></div>
        <div class="saved-prompt-select-hint">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
        <div class="modal-actions" style="margin-top:12px;">
          <button class="btn-secondary" id="savedPromptSelectClose">Close</button>
        </div>
      </div>
    </div>

    <!-- Saved Prompt Manage Modal -->
    <div class="modal-overlay" id="savedPromptManageModal">
      <div class="modal" style="max-width:900px;">
        <h2>Manage saved prompts</h2>
        <p>Create, edit, and delete reusable prompts.</p>
        <div class="saved-prompt-manage-layout">
          <div class="saved-prompt-list" id="savedPromptManageList"></div>
          <div class="saved-prompt-editor">
            <input id="savedPromptTitleInput" type="text" placeholder="Prompt title" maxlength="120" />
            <textarea id="savedPromptContentInput" placeholder="Prompt content"></textarea>
            <div class="modal-actions" style="margin-top:10px;justify-content:flex-start;">
              <button class="btn-secondary" id="savedPromptNewBtn">New</button>
              <button class="btn-primary" id="savedPromptSaveBtn">Save</button>
              <button class="btn-secondary" id="savedPromptDeleteBtn">Delete</button>
              <button class="btn-secondary" id="savedPromptManageClose">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Save Prompt Modal -->
    <div class="modal-overlay" id="savePromptModal">
      <div class="modal" style="max-width:560px;">
        <h2>Save Prompt</h2>
        <p>Give this prompt a title to save it for reuse.</p>
        <input id="savePromptTitleInput" type="text" placeholder="Enter a title for this prompt..." maxlength="120" />
        <div id="savePromptPreview" class="save-prompt-preview"></div>
        <div id="savePromptError" class="save-prompt-error"></div>
        <div class="modal-actions" style="margin-top:12px;">
          <button class="btn-secondary" id="savePromptCancelBtn">Cancel</button>
          <button class="btn-primary" id="savePromptConfirmBtn">Save</button>
        </div>
      </div>
    </div>

    <!-- Mobile Composer Options Modal -->
    <div class="modal-overlay" id="mobileComposerOptionsModal">
      <div class="modal" style="max-width:420px;">
        <h2 id="mobileComposerOptionsTitle">Composer options</h2>
        <p>Manage incognito mode, working folder, and saved prompts.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="mobile-composer-option-entry" id="mobileComposerIncognitoBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span id="mobileComposerIncognitoLabel">Incognito</span>
          </button>
          <button class="mobile-composer-option-entry" id="mobileComposerFolderBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>Work in folder</span>
          </button>
          <button class="mobile-composer-option-entry" id="mobileComposerUsePromptBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
            <span>Use saved prompt</span>
            <span class="mobile-composer-option-count" id="mobileComposerUsePromptCount">0</span>
          </button>
          <button class="mobile-composer-option-entry" id="mobileComposerManagePromptBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 14H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Manage saved prompts</span>
          </button>
        </div>
        <div class="modal-actions" style="margin-top:12px;">
          <button class="btn-secondary" id="mobileComposerOptionsClose">Close</button>
        </div>
      </div>
    </div>

    <!-- Context Menu (injected via JS) -->
    <div class="context-menu" id="contextMenu" style="display:none;"></div>

    <script>
      // ========== DOM ELEMENTS ==========
      const authModal = document.getElementById('authModal');
      const authHint = document.getElementById('authHint');
      const authInput = document.getElementById('authInput');
      const themeSelect = document.getElementById('themeSelect');
      const themeColorMetas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
      const authSave = document.getElementById('authSave');
      const authClear = document.getElementById('authClear');
      const authError = document.getElementById('authError');
      const authStatus = document.getElementById('authStatus');
      const usageBanner = document.getElementById('usageBanner');
      const usagePeriodTabs = document.getElementById('usagePeriodTabs');
      const usageTokensText = document.getElementById('usageTokensText');
      const usageCostText = document.getElementById('usageCostText');
      const usageSubtitleText = document.getElementById('usageSubtitleText');
      const usageDetailsModal = document.getElementById('usageDetailsModal');
      const usageDetailsBody = document.getElementById('usageDetailsBody');
      const usageDetailsClose = document.getElementById('usageDetailsClose');

      const permissionModal = document.getElementById('permissionModal');
      const permissionTitle = document.getElementById('permissionTitle');
      const permissionSubtitle = document.getElementById('permissionSubtitle');
      const permissionPrompt = document.getElementById('permissionPrompt');
      const permissionDetails = document.getElementById('permissionDetails');
      const permissionIcon = document.getElementById('permissionIcon');
      const permissionBadge = document.getElementById('permissionBadge');
      const permissionPath = document.getElementById('permissionPath');
      const permissionTarget = document.getElementById('permissionTarget');
      const permissionPreview = document.getElementById('permissionPreview');
      const permissionOptions = document.getElementById('permissionOptions');
      const permissionAllow = document.getElementById('permissionAllow');
      const permissionAllowAll = document.getElementById('permissionAllowAll');
      const permissionDeny = document.getElementById('permissionDeny');

      const taskList = document.getElementById('taskList');
      const initialState = document.getElementById('initialState');
      const chatState = document.getElementById('chatState');
      const form = document.getElementById('taskForm');
      const promptEl = document.getElementById('prompt');
      const agentSelect = document.getElementById('agentSelect');
      const submitBtn = document.getElementById('submitBtn');
      const newTaskBtn = document.getElementById('newTaskBtn');
      const newProjectBtn = document.getElementById('newProjectBtn');
      const searchTasksBtn = document.getElementById('searchTasksBtn');
      const settingsBtn = document.getElementById('settingsBtn');
      const connectedBadge = document.getElementById('connectedBadge');
      const themeBtn = document.getElementById('themeBtn');
      const themeMenu = document.getElementById('themeMenu');
      const themeMenuWrap = document.getElementById('themeMenuWrap');
      const sidebarToggle = document.getElementById('sidebarToggle');
      const mobileTasksBtn = document.getElementById('mobileTasksBtn');
      const mobileTaskOverlay = document.getElementById('mobileTaskOverlay');
      const mobileTaskPanel = document.getElementById('mobileTaskPanel');
      const mobileTaskPanelClose = document.getElementById('mobileTaskPanelClose');
      const mobileTaskList = document.getElementById('mobileTaskList');
      const mobilePanelNewProject = document.getElementById('mobilePanelNewProject');
      const mobilePanelSearch = document.getElementById('mobilePanelSearch');
      const sidebar = document.querySelector('.sidebar');
      const mobileAgentSwitcher = document.getElementById('mobileAgentSwitcher');
      const mobileAgentAvatar = document.getElementById('mobileAgentAvatar');
      const mobileConnectedAgentAvatar = document.getElementById('mobileConnectedAgentAvatar');
      const mobileAgentName = document.getElementById('mobileAgentName');
      const mobileAgentId = document.getElementById('mobileAgentId');
      const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
      const mobileConnectedBadge = document.getElementById('mobileConnectedBadge');

      const chatTitle = document.getElementById('chatTitle');
      const statusBadge = document.getElementById('statusBadge');
      const modelBadge = document.getElementById('modelBadge');
      const initialChatHeader = document.getElementById('initialChatHeader');
      const initialStatusBadge = document.getElementById('initialStatusBadge');
      const initialModelBadge = document.getElementById('initialModelBadge');
      const initialAgentBadge = document.getElementById('initialAgentBadge');
      const initialFullscreenBtn = document.getElementById('initialFullscreenBtn');
      const initialMobileModelBtn = document.getElementById('initialMobileModelBtn');
      const mobileModelBtn = document.getElementById('mobileModelBtn');
      const fullscreenBtn = document.getElementById('fullscreenBtn');
      const agentBadge = document.getElementById('agentBadge');
      const messagesArea = document.getElementById('messagesArea');
      const scrollBottomBtn = document.getElementById('scrollBottomBtn');
      const messagesList = document.getElementById('messagesList');
      const followUpInput = document.getElementById('followUpInput');
      const initialInputFieldWrap = document.getElementById('initialInputFieldWrap');
      const followInputFieldWrap = document.getElementById('followInputFieldWrap');
      const actionBtn = document.getElementById('actionBtn');
      const backBtn = document.getElementById('backBtn');
      var actionMode = 'send'; // 'send' or 'stop'
      const agentName = document.getElementById('agentName');
      const agentIdDisplay = document.getElementById('agentIdDisplay');
      const agentAvatar = document.getElementById('agentAvatar');

      // Folder DOM elements
      const folderList = document.getElementById('folderList');
      const unfiledTasks = document.getElementById('unfiledTasks');
      const addFolderBtn = document.getElementById('addFolderBtn');
      const folderModal = document.getElementById('folderModal');
      const folderModalTitle = document.getElementById('folderModalTitle');
      const folderNameInput = document.getElementById('folderNameInput');
      const folderColors = document.getElementById('folderColors');
      const folderIcons = document.getElementById('folderIcons');
      const folderIconPreview = document.getElementById('folderIconPreview');
      const folderTabIcon = document.getElementById('folderTabIcon');
      const folderTabColor = document.getElementById('folderTabColor');
      const folderCancelBtn = document.getElementById('folderCancelBtn');
      const folderSaveBtn = document.getElementById('folderSaveBtn');
      const contextMenu = document.getElementById('contextMenu');
      const renameModal = document.getElementById('renameModal');
      const renameInput = document.getElementById('renameInput');
      const renameCancelBtn = document.getElementById('renameCancelBtn');
      const renameSaveBtn = document.getElementById('renameSaveBtn');
      const searchModal = document.getElementById('searchModal');
      const searchInput = document.getElementById('searchInput');
      const searchResults = document.getElementById('searchResults');
      const composerFileInput = document.getElementById('composerFileInput');
      const initialAddFilesBtn = document.getElementById('initialAddFilesBtn');
      const followAddFilesBtn = document.getElementById('followAddFilesBtn');
      const initialInlineAddFilesBtn = document.getElementById('initialInlineAddFilesBtn');
      const followInlineAddFilesBtn = document.getElementById('followInlineAddFilesBtn');
      const initialIncognitoBtn = document.getElementById('initialIncognitoBtn');
      const followIncognitoBtn = document.getElementById('followIncognitoBtn');
      const initialFolderBtn = document.getElementById('initialFolderBtn');
      const followFolderBtn = document.getElementById('followFolderBtn');
      const initialUsePromptBtn = document.getElementById('initialUsePromptBtn');
      const followUsePromptBtn = document.getElementById('followUsePromptBtn');
      const initialManagePromptBtn = document.getElementById('initialManagePromptBtn');
      const followManagePromptBtn = document.getElementById('followManagePromptBtn');
      const initialVoiceWakeBtn = document.getElementById('initialVoiceWakeBtn');
      const followVoiceWakeBtn = document.getElementById('followVoiceWakeBtn');
      const initialInlineVoiceWakeBtn = document.getElementById('initialInlineVoiceWakeBtn');
      const followInlineVoiceWakeBtn = document.getElementById('followInlineVoiceWakeBtn');
      const initialMobileMoreBtn = document.getElementById('initialMobileMoreBtn');
      const followMobileMoreBtn = document.getElementById('followMobileMoreBtn');
      const initialComposerBottomRow = document.getElementById('initialComposerBottomRow');
      const followComposerBottomRow = document.getElementById('followComposerBottomRow');
      const initialComposerMeta = document.getElementById('initialComposerMeta');
      const followComposerMeta = document.getElementById('followComposerMeta');
      const initialContextIndicator = document.getElementById('initialContextIndicator');
      const followContextIndicator = document.getElementById('followContextIndicator');
      const initialSavedPromptCount = document.getElementById('initialSavedPromptCount');
      const followSavedPromptCount = document.getElementById('followSavedPromptCount');
      const savedPromptSelectModal = document.getElementById('savedPromptSelectModal');
      const savedPromptSelectSearchInput = document.getElementById('savedPromptSelectSearchInput');
      const savedPromptSelectList = document.getElementById('savedPromptSelectList');
      const savedPromptSelectClose = document.getElementById('savedPromptSelectClose');
      const savedPromptManageModal = document.getElementById('savedPromptManageModal');
      const savedPromptManageList = document.getElementById('savedPromptManageList');
      const savedPromptTitleInput = document.getElementById('savedPromptTitleInput');
      const savedPromptContentInput = document.getElementById('savedPromptContentInput');
      const savedPromptNewBtn = document.getElementById('savedPromptNewBtn');
      const savedPromptSaveBtn = document.getElementById('savedPromptSaveBtn');
      const savedPromptDeleteBtn = document.getElementById('savedPromptDeleteBtn');
      const savedPromptManageClose = document.getElementById('savedPromptManageClose');
      const savePromptModal = document.getElementById('savePromptModal');
      const savePromptTitleInput = document.getElementById('savePromptTitleInput');
      const savePromptPreview = document.getElementById('savePromptPreview');
      const savePromptError = document.getElementById('savePromptError');
      const savePromptCancelBtn = document.getElementById('savePromptCancelBtn');
      const savePromptConfirmBtn = document.getElementById('savePromptConfirmBtn');
      const mobileComposerOptionsModal = document.getElementById('mobileComposerOptionsModal');
      const mobileComposerOptionsTitle = document.getElementById('mobileComposerOptionsTitle');
      const mobileComposerIncognitoBtn = document.getElementById('mobileComposerIncognitoBtn');
      const mobileComposerIncognitoLabel = document.getElementById('mobileComposerIncognitoLabel');
      const mobileComposerFolderBtn = document.getElementById('mobileComposerFolderBtn');
      const mobileComposerUsePromptBtn = document.getElementById('mobileComposerUsePromptBtn');
      const mobileComposerUsePromptCount = document.getElementById('mobileComposerUsePromptCount');
      const mobileComposerManagePromptBtn = document.getElementById('mobileComposerManagePromptBtn');
      const mobileComposerOptionsClose = document.getElementById('mobileComposerOptionsClose');
      const themeMenuOptions = themeMenu ? Array.from(themeMenu.querySelectorAll('[data-theme-option]')) : [];

      // ========== STATE ==========
      let authMode = 'none';
      let authStorageKey = 'odm_gateway_token';
      let authValue = '';
      let authValidated = false;
      let authModalUserOpened = false;
      let activePermission = null;
      let selectedTaskId = null;
      let selectedSessionId = null;
      let allTasks = [];
      let expandedToolMessagesByTask = {};
      const LAST_CHAT_STATE_KEY = 'odm_webchat_last_chat_state';
      const LAST_CHAT_STATE_MAX_AGE_MS = 60 * 1000;
      let allFolders = [];
      let taskFolderAssignments = {};
      let editingFolderId = null;
      let renameTaskId = null;
      const FOLDER_COLORS = [
        { name: 'Teal', color: '#4db6ac' },
        { name: 'Blue', color: '#5c9eff' },
        { name: 'Purple', color: '#a78bfa' },
        { name: 'Pink', color: '#f472b6' },
        { name: 'Orange', color: '#fb923c' },
        { name: 'Yellow', color: '#fbbf24' },
        { name: 'Green', color: '#4ade80' },
        { name: 'Red', color: '#f87171' }
      ];
      let selectedFolderColor = FOLDER_COLORS[0].color;
      let selectedFolderIcon = 'Folder';
      let folderModalTab = 'icon'; // 'icon' or 'color'
      let mobileContextSelectedEl = null;
      let ignoreContextMenuDismissUntil = 0;
      let mobileAgentPopupTimer = null;
      let mobilePanelSwipeTracking = false;
      let mobilePanelSwipeDragging = false;
      let mobilePanelSwipeStartX = 0;
      let mobilePanelSwipeStartY = 0;
      let mobilePanelSwipeDeltaX = 0;
      var cachedAgents = [];
      var cachedDefaultAgentId = '';
      var cachedGlobalSelectedModel = null;
      var currentModelLabel = '';
      let usagePeriod = 'day';
      let usageSummary = null;
      let usageSummaryLoading = false;
      const SAVED_PROMPTS_STORAGE_KEY = 'odm_webchat_saved_prompts_v1';
      const WEBCHAT_THEME_STORAGE_KEY = 'open-deskmate-webchat-theme';
      const MAX_COMPOSER_ATTACHMENTS = 20;
      let currentThemePreference = 'system';
      let systemThemeMediaQuery = null;
      let pendingComposerFileTarget = null; // 'initial' | 'follow'
      let activeSavedPromptTarget = 'initial'; // 'initial' | 'follow'
      let savedPromptSelectQuery = '';
      let savedPromptSelectIndex = 0;
      let activeSavedPromptId = null;
      let mobileComposerOptionsTarget = 'initial'; // 'initial' | 'follow'
      let savedPrompts = [];
      let pendingMessagePromptToSave = '';
      let pendingSavePromptButton = null;
      let voiceWakeEnabled = false;
      let voiceWakeBusy = false;
      let browserVoiceSupported = false;
      let browserVoiceActive = false;
      let browserVoiceRecognition = null;
      let browserVoiceInterim = '';
      let browserVoiceRestartTimer = null;
      let browserVoiceCommittedResultKeys = {};
      let browserVoiceRecentFinals = [];
      let messagesAreaNearBottom = true;
      let initialComposerState = {
        privacyMode: 'normal',
        workingDirectory: '',
        attachedFiles: [],
      };
      let followComposerState = {
        privacyMode: 'normal',
        workingDirectory: '',
        attachedFiles: [],
      };
      let contextEstimateTimers = {
        initial: null,
        follow: null,
      };
      let contextEstimateSeq = {
        initial: 0,
        follow: 0,
      };
      let contextEstimateLastKey = {
        initial: '',
        follow: '',
      };
      let contextEstimateLastStats = {
        initial: null,
        follow: null,
      };
      let contextEstimateEnabled = false;
      let contextInfoPopover = null;
      let contextInfoAnchor = null;
      let contextInfoTarget = '';
      var AVATAR_BUILDER_PREFIX = 'builder:v1:';
      function safeAvatarColor(color, fallback) {
        var value = String(color || '').trim();
        if (!value) return fallback || 'var(--primary)';
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
        if (/^rgba?\([0-9.,%\s-]+\)$/.test(value)) return value;
        if (/^hsla?\([0-9.,%\s-]+\)$/.test(value)) return value;
        if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(value)) return value;
        if (value === 'currentColor') return value;
        return fallback || 'var(--primary)';
      }
      function normalizeAvatarConfig(cfg) {
        var next = cfg || {};
        var hair = ['none','short','long','buzz'].indexOf(next.hair) >= 0 ? next.hair : 'short';
        var facial = ['none','mustache','beard','goatee'].indexOf(next.facial) >= 0 ? next.facial : 'none';
        var hat = ['none','cap','fedora','beanie','hardhat','chef','helmet','wizard','crown'].indexOf(next.hat) >= 0 ? next.hat : 'none';
        var outfit = ['none','tie','labcoat','hoodie','armor'].indexOf(next.outfit) >= 0 ? next.outfit : 'none';
        var accessory = ['none','glasses','goggles','headset'].indexOf(next.accessory) >= 0 ? next.accessory : 'none';
        return { hair: hair, facial: facial, hat: hat, outfit: outfit, accessory: accessory };
      }
      function parseAvatarBuilder(name) {
        if (!name || String(name).indexOf(AVATAR_BUILDER_PREFIX) !== 0) return null;
        var parts = String(name).slice(AVATAR_BUILDER_PREFIX.length).split(':');
        if (parts.length !== 5) return null;
        return normalizeAvatarConfig({
          hair: parts[0],
          facial: parts[1],
          hat: parts[2],
          outfit: parts[3],
          accessory: parts[4]
        });
      }
      var AVATAR_PRESET_CONFIGS = {
        Person: { hair: 'short', facial: 'none', hat: 'none', outfit: 'none', accessory: 'none' },
        Worker: { hair: 'short', facial: 'none', hat: 'hardhat', outfit: 'none', accessory: 'none' },
        Business: { hair: 'short', facial: 'none', hat: 'none', outfit: 'tie', accessory: 'none' },
        Doctor: { hair: 'short', facial: 'none', hat: 'none', outfit: 'labcoat', accessory: 'none' },
        Scientist: { hair: 'short', facial: 'none', hat: 'none', outfit: 'labcoat', accessory: 'goggles' },
        Chef: { hair: 'none', facial: 'none', hat: 'chef', outfit: 'none', accessory: 'none' },
        Detective: { hair: 'short', facial: 'mustache', hat: 'fedora', outfit: 'tie', accessory: 'glasses' },
        Support: { hair: 'short', facial: 'none', hat: 'none', outfit: 'none', accessory: 'headset' },
        Astronaut: { hair: 'none', facial: 'none', hat: 'helmet', outfit: 'armor', accessory: 'none' },
        Wizard: { hair: 'long', facial: 'goatee', hat: 'wizard', outfit: 'none', accessory: 'none' },
        Royal: { hair: 'short', facial: 'none', hat: 'crown', outfit: 'tie', accessory: 'none' }
      };
      function faceBase(c) {
        return '<path d=\"M5.4 22v-1.4a6.6 6.6 0 0 1 13.2 0V22\" fill=\"'+c+'\" opacity=\"0.14\" stroke=\"'+c+'\" stroke-width=\"1.35\" stroke-linecap=\"round\"/>'+
          '<path d=\"M9.1 16.2 12 19.5l2.9-3.3\" stroke=\"'+c+'\" opacity=\"0.38\" stroke-width=\"0.95\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>'+
          '<circle cx=\"12\" cy=\"9\" r=\"4.6\" fill=\"'+c+'\" opacity=\"0.22\" stroke=\"'+c+'\" stroke-width=\"1.35\"/>'+
          '<ellipse cx=\"12\" cy=\"9.8\" rx=\"3.75\" ry=\"3.2\" fill=\"'+c+'\" opacity=\"0.08\"/>'+
          '<circle cx=\"7.35\" cy=\"9.1\" r=\"0.68\" fill=\"'+c+'\" opacity=\"0.18\"/>'+
          '<circle cx=\"16.65\" cy=\"9.1\" r=\"0.68\" fill=\"'+c+'\" opacity=\"0.18\"/>'+
          '<path d=\"M9.55 7.85h1.45\" stroke=\"'+c+'\" stroke-width=\"0.8\" stroke-linecap=\"round\" opacity=\"0.55\"/>'+
          '<path d=\"M13 7.85h1.45\" stroke=\"'+c+'\" stroke-width=\"0.8\" stroke-linecap=\"round\" opacity=\"0.55\"/>'+
          '<circle cx=\"10.2\" cy=\"8.9\" r=\"0.62\" fill=\"'+c+'\" opacity=\"0.82\"/>'+
          '<circle cx=\"13.8\" cy=\"8.9\" r=\"0.62\" fill=\"'+c+'\" opacity=\"0.82\"/>'+
          '<path d=\"M12 9.6v1.25\" stroke=\"'+c+'\" stroke-width=\"0.75\" stroke-linecap=\"round\" opacity=\"0.48\"/>'+
          '<circle cx=\"12\" cy=\"10.95\" r=\"0.32\" fill=\"'+c+'\" opacity=\"0.55\"/>'+
          '<path d=\"M10.35 11.6c.48.5 1.05.78 1.65.78s1.17-.28 1.65-.78\" stroke=\"'+c+'\" stroke-width=\"0.95\" stroke-linecap=\"round\" fill=\"none\"/>';
      }
      function avatarAmbient(c) {
        return '<circle cx=\"12\" cy=\"12\" r=\"10.2\" fill=\"'+c+'\" opacity=\"0.04\"/>'+
          '<ellipse cx=\"12\" cy=\"21.25\" rx=\"5.6\" ry=\"1.2\" fill=\"'+c+'\" opacity=\"0.08\"/>';
      }
      function renderSpecialAvatar(name, c) {
        if (name === 'Robot') return '<line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"4.3\" stroke=\"'+c+'\" stroke-width=\"1.35\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"1.65\" r=\"0.95\" fill=\"'+c+'\" opacity=\"0.58\"/><rect x=\"6.2\" y=\"4.35\" width=\"11.6\" height=\"9.2\" rx=\"2.5\" fill=\"'+c+'\" opacity=\"0.2\" stroke=\"'+c+'\" stroke-width=\"1.35\"/><rect x=\"7.5\" y=\"5.6\" width=\"9\" height=\"1.1\" rx=\"0.55\" fill=\"'+c+'\" opacity=\"0.22\"/><rect x=\"8.25\" y=\"7.5\" width=\"2.75\" height=\"2.1\" rx=\"0.55\" fill=\"'+c+'\" opacity=\"0.72\"/><rect x=\"13\" y=\"7.5\" width=\"2.75\" height=\"2.1\" rx=\"0.55\" fill=\"'+c+'\" opacity=\"0.72\"/><circle cx=\"7.3\" cy=\"8.95\" r=\"0.34\" fill=\"'+c+'\" opacity=\"0.5\"/><circle cx=\"16.7\" cy=\"8.95\" r=\"0.34\" fill=\"'+c+'\" opacity=\"0.5\"/><path d=\"M9.35 11.55h5.3\" stroke=\"'+c+'\" stroke-width=\"1.05\" stroke-linecap=\"round\"/><rect x=\"7.45\" y=\"14.45\" width=\"9.1\" height=\"6.1\" rx=\"2\" fill=\"'+c+'\" opacity=\"0.13\" stroke=\"'+c+'\" stroke-width=\"1.2\"/><path d=\"M10 16.9h4\" stroke=\"'+c+'\" stroke-width=\"0.9\" stroke-linecap=\"round\" opacity=\"0.52\"/>';
        if (name === 'Android') return '<line x1=\"7.05\" y1=\"3\" x2=\"9.2\" y2=\"5.35\" stroke=\"'+c+'\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><line x1=\"16.95\" y1=\"3\" x2=\"14.8\" y2=\"5.35\" stroke=\"'+c+'\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><rect x=\"6.25\" y=\"4.75\" width=\"11.5\" height=\"8.6\" rx=\"3.1\" fill=\"'+c+'\" opacity=\"0.2\" stroke=\"'+c+'\" stroke-width=\"1.3\"/><path d=\"M7.6 6.6h8.8\" stroke=\"'+c+'\" stroke-width=\"0.8\" opacity=\"0.28\"/><circle cx=\"9.45\" cy=\"8.8\" r=\"1.08\" fill=\"'+c+'\" opacity=\"0.72\"/><circle cx=\"14.55\" cy=\"8.8\" r=\"1.08\" fill=\"'+c+'\" opacity=\"0.72\"/><path d=\"M10 11.35c.5.43 1.16.68 2 .68s1.5-.25 2-.68\" stroke=\"'+c+'\" stroke-width=\"0.95\" stroke-linecap=\"round\" fill=\"none\"/><rect x=\"7.9\" y=\"13.95\" width=\"8.2\" height=\"6.25\" rx=\"2.05\" fill=\"'+c+'\" opacity=\"0.13\" stroke=\"'+c+'\" stroke-width=\"1.15\"/><path d=\"M9.9 16.75h4.2\" stroke=\"'+c+'\" stroke-width=\"0.85\" stroke-linecap=\"round\" opacity=\"0.5\"/>';
        return '<circle cx=\"12\" cy=\"9\" r=\"5.05\" fill=\"'+c+'\" opacity=\"0.2\" stroke=\"'+c+'\" stroke-width=\"1.35\"/><path d=\"M12 3.95v10.1\" stroke=\"'+c+'\" stroke-width=\"0.68\" opacity=\"0.48\"/><path d=\"M9.55 6.8c.35-.5.95-.9 1.55-.9\" stroke=\"'+c+'\" stroke-width=\"0.72\" opacity=\"0.58\" stroke-linecap=\"round\"/><circle cx=\"10\" cy=\"8.6\" r=\"0.68\" fill=\"'+c+'\" opacity=\"0.74\"/><rect x=\"12.9\" y=\"7.05\" width=\"2.65\" height=\"2.1\" rx=\"0.4\" fill=\"'+c+'\" opacity=\"0.6\"/><path d=\"M14.05 10.45h2.1\" stroke=\"'+c+'\" stroke-width=\"0.86\" opacity=\"0.56\" stroke-linecap=\"round\"/><path d=\"M14.05 11.6h1.7\" stroke=\"'+c+'\" stroke-width=\"0.86\" opacity=\"0.56\" stroke-linecap=\"round\"/><path d=\"M5.2 22v-1.3a6.8 6.8 0 0 1 13.6 0V22\" fill=\"'+c+'\" opacity=\"0.13\" stroke=\"'+c+'\" stroke-width=\"1.35\" stroke-linecap=\"round\"/>';
      }
      function renderHumanAvatar(cfg, c) {
        var paths = faceBase(c);
        if (cfg.hair === 'buzz') paths += '<path d=\"M8.3 5.4h7.4\" stroke=\"'+c+'\" stroke-width=\"1.4\" stroke-linecap=\"round\" opacity=\"0.7\"/>';
        else if (cfg.hair === 'short') paths += '<path d=\"M7.5 8.1c.25-2.95 2.3-4.9 4.5-4.9 2.6 0 4.65 1.9 4.95 4.9\" stroke=\"'+c+'\" stroke-width=\"1.45\" stroke-linecap=\"round\" fill=\"none\"/>';
        else if (cfg.hair === 'long') paths += '<path d=\"M7.2 8.2c.3-3.15 2.3-5.15 4.8-5.15 2.7 0 4.7 2.05 5 5.15\" stroke=\"'+c+'\" stroke-width=\"1.35\" stroke-linecap=\"round\" fill=\"none\"/><path d=\"M8.4 8.4v4\" stroke=\"'+c+'\" stroke-width=\"1.05\" stroke-linecap=\"round\" opacity=\"0.7\"/><path d=\"M15.6 8.4v4\" stroke=\"'+c+'\" stroke-width=\"1.05\" stroke-linecap=\"round\" opacity=\"0.7\"/>';
        if (cfg.hat === 'cap') paths += '<path d=\"M7.2 8c0-2.45 2-4.2 4.8-4.2s4.8 1.75 4.8 4.2\" fill=\"'+c+'\" opacity=\"0.28\" stroke=\"'+c+'\" stroke-width=\"1.2\"/><path d=\"M7 8.2h10.6\" stroke=\"'+c+'\" stroke-width=\"1.25\" stroke-linecap=\"round\"/>';
        else if (cfg.hat === 'fedora') paths += '<path d=\"M8.2 7.8h7.6l-.8-2.5c-.25-.8-.95-1.3-2-1.3h-2c-1.05 0-1.75.5-2 1.3z\" fill=\"'+c+'\" opacity=\"0.3\" stroke=\"'+c+'\" stroke-width=\"1.05\"/><path d=\"M6 8h12\" stroke=\"'+c+'\" stroke-width=\"1.35\" stroke-linecap=\"round\"/>';
        else if (cfg.hat === 'beanie') paths += '<path d=\"M7.5 8.1c0-3.05 1.8-5 4.5-5s4.5 1.95 4.5 5\" fill=\"'+c+'\" opacity=\"0.22\" stroke=\"'+c+'\" stroke-width=\"1.1\"/><rect x=\"7\" y=\"7.7\" width=\"10\" height=\"1.9\" rx=\"0.95\" fill=\"'+c+'\" opacity=\"0.35\"/>';
        else if (cfg.hat === 'hardhat') paths += '<path d=\"M6.6 8.1c0-3 2.3-5.1 5.4-5.1s5.4 2.1 5.4 5.1\" fill=\"'+c+'\" opacity=\"0.3\" stroke=\"'+c+'\" stroke-width=\"1.2\"/><path d=\"M6.1 8.2h11.8\" stroke=\"'+c+'\" stroke-width=\"1.45\" stroke-linecap=\"round\"/>';
        else if (cfg.hat === 'chef') paths += '<path d=\"M8.1 8.1C8.1 4 9.2 2.1 12 2.1s3.9 1.9 3.9 6\" fill=\"'+c+'\" opacity=\"0.2\" stroke=\"'+c+'\" stroke-width=\"1.15\"/><ellipse cx=\"12\" cy=\"2.6\" rx=\"3.15\" ry=\"1.85\" fill=\"'+c+'\" opacity=\"0.26\" stroke=\"'+c+'\" stroke-width=\"0.9\"/><path d=\"M7.5 8.1h9\" stroke=\"'+c+'\" stroke-width=\"1.3\" stroke-linecap=\"round\"/>';
        else if (cfg.hat === 'helmet') paths += '<path d=\"M6.9 8.2c0-3.2 2-5.35 5.1-5.35s5.1 2.15 5.1 5.35\" fill=\"'+c+'\" opacity=\"0.22\" stroke=\"'+c+'\" stroke-width=\"1.2\"/><path d=\"M6.4 8.3h11.2\" stroke=\"'+c+'\" stroke-width=\"1.45\" stroke-linecap=\"round\"/>';
        else if (cfg.hat === 'wizard') paths += '<path d=\"M12 1 7 8.3h10L12 1z\" fill=\"'+c+'\" opacity=\"0.28\" stroke=\"'+c+'\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><path d=\"M6.5 8.3h11\" stroke=\"'+c+'\" stroke-width=\"1.3\" stroke-linecap=\"round\"/>';
        else if (cfg.hat === 'crown') paths += '<path d=\"M7 7.7l1-3.9 2.1 2.5L12 3.1l1.9 3.2L16 3.8l1 3.9H7z\" fill=\"'+c+'\" opacity=\"0.3\" stroke=\"'+c+'\" stroke-width=\"1\" stroke-linejoin=\"round\"/><path d=\"M7 7.8h10\" stroke=\"'+c+'\" stroke-width=\"1.2\" stroke-linecap=\"round\"/>';
        if (cfg.facial === 'mustache') paths += '<path d=\"M9.6 10.6c.3.45.9.8 1.5.8.4 0 .7-.1.9-.35.2.25.5.35.9.35.6 0 1.2-.35 1.5-.8\" stroke=\"'+c+'\" stroke-width=\"1\" stroke-linecap=\"round\" fill=\"none\"/>';
        else if (cfg.facial === 'goatee') paths += '<path d=\"M11.25 12.2c.2.7.45 1.35.75 1.85.3-.5.55-1.15.75-1.85\" stroke=\"'+c+'\" stroke-width=\"1\" stroke-linecap=\"round\" fill=\"none\"/>';
        else if (cfg.facial === 'beard') paths += '<path d=\"M9.1 11.9c.2 1.55 1.35 2.7 2.9 2.7s2.7-1.15 2.9-2.7\" stroke=\"'+c+'\" stroke-width=\"1.1\" stroke-linecap=\"round\" fill=\"none\"/>';
        if (cfg.outfit === 'tie') paths += '<path d=\"M9.6 14.4 12 15.7l2.4-1.3\" stroke=\"'+c+'\" stroke-width=\"1.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M12 15.6 10.8 18l1.2 3.2 1.2-3.2z\" fill=\"'+c+'\" opacity=\"0.45\" stroke=\"'+c+'\" stroke-width=\"0.9\"/>';
        else if (cfg.outfit === 'labcoat') paths += '<path d=\"M7.2 22v-3.1c0-1.7 1.3-3 3-3h3.6c1.7 0 3 1.3 3 3V22\" fill=\"'+c+'\" opacity=\"0.08\" stroke=\"'+c+'\" stroke-width=\"1.15\"/><path d=\"M9.8 16.1 12 18.2l2.2-2.1\" stroke=\"'+c+'\" stroke-width=\"1\" stroke-linejoin=\"round\"/>';
        else if (cfg.outfit === 'hoodie') paths += '<path d=\"M8.2 15.8c.4-1.3 1.8-2.1 3.8-2.1s3.4.8 3.8 2.1\" stroke=\"'+c+'\" stroke-width=\"1.2\" stroke-linecap=\"round\" fill=\"none\"/>';
        else if (cfg.outfit === 'armor') paths += '<path d=\"M8 22v-3c0-2.1 1.6-3.8 4-3.8s4 1.7 4 3.8v3\" fill=\"'+c+'\" opacity=\"0.12\" stroke=\"'+c+'\" stroke-width=\"1.25\"/><path d=\"M9.2 17.6h5.6\" stroke=\"'+c+'\" stroke-width=\"1.05\" stroke-linecap=\"round\"/>';
        if (cfg.accessory === 'glasses') paths += '<rect x=\"7.5\" y=\"7.7\" width=\"3.8\" height=\"2.6\" rx=\"1.1\" fill=\"'+c+'\" opacity=\"0.12\" stroke=\"'+c+'\" stroke-width=\"0.95\"/><rect x=\"12.7\" y=\"7.7\" width=\"3.8\" height=\"2.6\" rx=\"1.1\" fill=\"'+c+'\" opacity=\"0.12\" stroke=\"'+c+'\" stroke-width=\"0.95\"/><path d=\"M11.3 9h1.4\" stroke=\"'+c+'\" stroke-width=\"0.85\" stroke-linecap=\"round\"/>';
        else if (cfg.accessory === 'goggles') paths += '<rect x=\"7\" y=\"7.4\" width=\"4.4\" height=\"3\" rx=\"1.2\" fill=\"'+c+'\" opacity=\"0.16\" stroke=\"'+c+'\" stroke-width=\"1.05\"/><rect x=\"12.6\" y=\"7.4\" width=\"4.4\" height=\"3\" rx=\"1.2\" fill=\"'+c+'\" opacity=\"0.16\" stroke=\"'+c+'\" stroke-width=\"1.05\"/>';
        else if (cfg.accessory === 'headset') paths += '<path d=\"M6.4 9.2a5.6 5.6 0 0 1 11.2 0\" stroke=\"'+c+'\" stroke-width=\"1.2\" stroke-linecap=\"round\" fill=\"none\"/><rect x=\"4.2\" y=\"8.2\" width=\"2.1\" height=\"3.8\" rx=\"0.85\" fill=\"'+c+'\" opacity=\"0.34\"/><rect x=\"17.7\" y=\"8.2\" width=\"2.1\" height=\"3.8\" rx=\"0.85\" fill=\"'+c+'\" opacity=\"0.34\"/>';
        return paths;
      }
      function presetEnhancements(name, c) {
        if (!name) return '';
        if (name === 'Worker') return '<rect x=\"8.9\" y=\"4.35\" width=\"6.2\" height=\"1.25\" rx=\"0.55\" fill=\"#f8fafc\" opacity=\"0.65\"/><path d=\"M9.15 16.9h5.7\" stroke=\"#f8fafc\" stroke-width=\"1.05\" stroke-linecap=\"round\" opacity=\"0.62\"/>';
        if (name === 'Business') return '<path d=\"M9.1 14.55h5.8\" stroke=\"#f8fafc\" stroke-width=\"0.95\" stroke-linecap=\"round\" opacity=\"0.7\"/><path d=\"M10.2 15.3 12 16.35l1.8-1.05\" stroke=\"'+c+'\" stroke-width=\"0.8\" opacity=\"0.65\" stroke-linecap=\"round\"/>';
        if (name === 'Doctor') return '<circle cx=\"12\" cy=\"18.55\" r=\"0.95\" fill=\"#f8fafc\" stroke=\"'+c+'\" stroke-width=\"0.75\"/><path d=\"M9.25 17.05c.1.95 1.2 1.8 2.75 1.8s2.65-.85 2.75-1.8\" stroke=\"#f8fafc\" stroke-width=\"0.95\" stroke-linecap=\"round\" fill=\"none\"/>';
        if (name === 'Scientist') return '<path d=\"M7.95 8.1h3.1\" stroke=\"#f8fafc\" stroke-width=\"0.7\" opacity=\"0.85\"/><path d=\"M13 8.1h3.1\" stroke=\"#f8fafc\" stroke-width=\"0.7\" opacity=\"0.85\"/><path d=\"M11.45 16.65h1.1l.45 1.2h-2z\" fill=\"#f8fafc\" opacity=\"0.58\"/>';
        if (name === 'Chef') return '<path d=\"M8.7 4.1c.6-.8 1.5-1.2 2.4-1.2\" stroke=\"#f8fafc\" stroke-width=\"0.75\" opacity=\"0.8\" stroke-linecap=\"round\"/><path d=\"M13.1 2.95c.95.15 1.7.6 2.2 1.45\" stroke=\"#f8fafc\" stroke-width=\"0.75\" opacity=\"0.8\" stroke-linecap=\"round\"/>';
        if (name === 'Detective') return '<circle cx=\"9.9\" cy=\"9.1\" r=\"1.55\" fill=\"none\" stroke=\"#f8fafc\" stroke-width=\"0.8\" opacity=\"0.7\"/><path d=\"M11.45 9.1h1.2\" stroke=\"#f8fafc\" stroke-width=\"0.7\" opacity=\"0.7\"/>';
        if (name === 'Support') return '<path d=\"M9.1 15.75h5.8\" stroke=\"#f8fafc\" stroke-width=\"0.8\" opacity=\"0.68\" stroke-linecap=\"round\"/><path d=\"M9.1 16.8h4.2\" stroke=\"#f8fafc\" stroke-width=\"0.8\" opacity=\"0.55\" stroke-linecap=\"round\"/>';
        if (name === 'Astronaut') return '<path d=\"M9.05 8.25c.45-.65 1.05-1.15 1.8-1.45\" stroke=\"#f8fafc\" stroke-width=\"0.75\" opacity=\"0.72\" stroke-linecap=\"round\"/><circle cx=\"16.85\" cy=\"17.05\" r=\"0.72\" fill=\"#f8fafc\" opacity=\"0.65\"/>';
        if (name === 'Wizard') return '<circle cx=\"11.25\" cy=\"4.6\" r=\"0.42\" fill=\"#fef9c3\" opacity=\"0.9\"/><circle cx=\"13.95\" cy=\"5.4\" r=\"0.32\" fill=\"#fef9c3\" opacity=\"0.78\"/>';
        if (name === 'Royal') return '<circle cx=\"10.5\" cy=\"6.15\" r=\"0.38\" fill=\"#fef08a\" opacity=\"0.88\"/><circle cx=\"12\" cy=\"5.65\" r=\"0.38\" fill=\"#fef08a\" opacity=\"0.88\"/><circle cx=\"13.5\" cy=\"6.15\" r=\"0.38\" fill=\"#fef08a\" opacity=\"0.88\"/>';
        if (name === 'Person') return '<path d=\"M9.55 15.65h4.9\" stroke=\"'+c+'\" stroke-width=\"0.72\" opacity=\"0.42\" stroke-linecap=\"round\"/>';
        return '';
      }
      function getAgentAvatarSvg(avatarName, color) {
        var c = safeAvatarColor(color, 'var(--primary)');
        var builderConfig = parseAvatarBuilder(avatarName);
        var presetConfig = AVATAR_PRESET_CONFIGS[avatarName] || AVATAR_PRESET_CONFIGS.Person;
        var paths = '';
        if (avatarName === 'Robot' || avatarName === 'Android' || avatarName === 'Cyborg') {
          paths = renderSpecialAvatar(avatarName, c);
        } else {
          var presetName = builderConfig ? null : (AVATAR_PRESET_CONFIGS[avatarName] ? avatarName : 'Person');
          paths = renderHumanAvatar(builderConfig || presetConfig, c) + presetEnhancements(presetName, c);
        }
        return '<svg viewBox=\"0 0 24 24\" fill=\"none\" style=\"width:100%;height:100%;\">' + avatarAmbient(c) + paths + '</svg>';
      }
      const IS_MOBILE = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

      function syncMobileViewportLayout() {
        if (!IS_MOBILE) return;
        var root = document.documentElement;
        var vv = window.visualViewport;
        var topOffset = vv ? Math.max(0, Math.round(vv.offsetTop || 0)) : 0;
        var viewportHeight = vv ? Math.max(0, Math.round(vv.height || window.innerHeight)) : window.innerHeight;
        var layoutViewportHeight = Math.max(
          window.innerHeight || 0,
          document.documentElement ? (document.documentElement.clientHeight || 0) : 0
        );
        var keyboardOffset = vv
          ? Math.max(0, Math.round(layoutViewportHeight - ((vv.height || 0) + (vv.offsetTop || 0))))
          : 0;
        if (keyboardOffset < 24) keyboardOffset = 0;
        var active = document.activeElement;
        var hasComposerFocus = active === promptEl || active === followUpInput;
        var toolbarHeight = 61;
        if (sidebar && sidebar.getBoundingClientRect) {
          var sidebarRect = sidebar.getBoundingClientRect();
          if (sidebarRect && Number.isFinite(sidebarRect.height) && sidebarRect.height > 0) {
            toolbarHeight = Math.max(48, Math.round(sidebarRect.height));
          }
        }
        root.style.setProperty('--odm-mobile-top-offset', topOffset + 'px');
        root.style.setProperty('--odm-mobile-toolbar-height', toolbarHeight + 'px');
        root.style.setProperty('--odm-mobile-vh', viewportHeight + 'px');
        root.style.setProperty('--odm-mobile-keyboard-offset', keyboardOffset + 'px');
        document.body.classList.toggle('keyboard-open', keyboardOffset > 0 || hasComposerFocus);

        var keyboardOpen = keyboardOffset > 0 || hasComposerFocus;
        var initialCardShift = 0;
        if (keyboardOpen && initialState && !initialState.classList.contains('hidden') && active === promptEl) {
          var initialTaskCard = initialState.querySelector('.task-card');
          if (initialTaskCard && initialTaskCard.getBoundingClientRect) {
            var cardRect = initialTaskCard.getBoundingClientRect();
            var visibleBottom = vv ? Number(vv.height || window.innerHeight) : window.innerHeight;
            if (Number.isFinite(cardRect.bottom) && Number.isFinite(visibleBottom)) {
              var desiredGapPx = 2;
              var measuredGapPx = Math.round(visibleBottom - cardRect.bottom);
              if (measuredGapPx > desiredGapPx) {
                initialCardShift = Math.min(72, Math.max(0, measuredGapPx - desiredGapPx));
              }
            }
          }
        }
        root.style.setProperty('--odm-mobile-initial-keyboard-shift', initialCardShift + 'px');
      }

      function ensureFocusedMobileInputVisible() {
        if (!IS_MOBILE) return;
        var active = document.activeElement;
        if (!active) return;
        if (active !== promptEl && active !== followUpInput) return;
        setTimeout(function() {
          try {
            if (active === followUpInput && messagesArea) {
              messagesArea.scrollTop = messagesArea.scrollHeight;
              active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
            }
          } catch {
            // no-op
          }
        }, 70);
      }

      function resetMobileTaskPanelDragState() {
        mobilePanelSwipeTracking = false;
        mobilePanelSwipeDragging = false;
        mobilePanelSwipeStartX = 0;
        mobilePanelSwipeStartY = 0;
        mobilePanelSwipeDeltaX = 0;
        if (mobileTaskPanel) {
          mobileTaskPanel.classList.remove('dragging');
          mobileTaskPanel.style.transform = '';
          mobileTaskPanel.style.transition = '';
        }
        if (mobileTaskOverlay) {
          mobileTaskOverlay.style.opacity = '';
          mobileTaskOverlay.style.transition = '';
        }
      }

      function getMobileTaskPanelWidth() {
        if (!mobileTaskPanel || !mobileTaskPanel.getBoundingClientRect) return 0;
        var rect = mobileTaskPanel.getBoundingClientRect();
        var width = Number(rect.width || 0);
        if (!Number.isFinite(width) || width <= 0) {
          return 0;
        }
        return Math.round(width);
      }

      function setMobileTaskPanelSwipeOffset(offsetPx) {
        if (!mobileTaskPanel) return;
        var panelWidth = getMobileTaskPanelWidth();
        var width = panelWidth > 0 ? panelWidth : 320;
        var clamped = Math.max(0, Math.min(width, Math.round(offsetPx || 0)));
        mobileTaskPanel.style.transform = 'translateX(' + (-clamped) + 'px)';
        if (mobileTaskOverlay) {
          var opacity = Math.max(0, Math.min(1, 1 - (clamped / width)));
          mobileTaskOverlay.style.opacity = String(opacity);
        }
      }

      function handleMobileTaskPanelTouchStart(e) {
        if (!IS_MOBILE || !mobileTaskPanel || !mobileTaskPanel.classList.contains('visible')) return;
        if (!e.touches || e.touches.length !== 1) return;
        var touch = e.touches[0];
        mobilePanelSwipeTracking = true;
        mobilePanelSwipeDragging = false;
        mobilePanelSwipeStartX = touch.clientX;
        mobilePanelSwipeStartY = touch.clientY;
        mobilePanelSwipeDeltaX = 0;
      }

      function handleMobileTaskPanelTouchMove(e) {
        if (!mobilePanelSwipeTracking || !mobileTaskPanel || !mobileTaskPanel.classList.contains('visible')) return;
        if (!e.touches || e.touches.length !== 1) return;
        var touch = e.touches[0];
        var deltaX = touch.clientX - mobilePanelSwipeStartX;
        var deltaY = touch.clientY - mobilePanelSwipeStartY;
        if (!mobilePanelSwipeDragging) {
          if (Math.abs(deltaY) > 10 && Math.abs(deltaY) > Math.abs(deltaX)) {
            mobilePanelSwipeTracking = false;
            return;
          }
          if (deltaX < -10 && Math.abs(deltaX) > (Math.abs(deltaY) + 4)) {
            mobilePanelSwipeDragging = true;
            mobileTaskPanel.classList.add('dragging');
          } else if (deltaX > 12) {
            mobilePanelSwipeTracking = false;
            return;
          } else {
            return;
          }
        }
        mobilePanelSwipeDeltaX = Math.max(0, -deltaX);
        setMobileTaskPanelSwipeOffset(mobilePanelSwipeDeltaX);
        e.preventDefault();
      }

      function handleMobileTaskPanelTouchEnd() {
        if (!mobilePanelSwipeTracking && !mobilePanelSwipeDragging) {
          resetMobileTaskPanelDragState();
          return;
        }
        var panelWidth = getMobileTaskPanelWidth();
        var threshold = Math.max(56, Math.round((panelWidth || 320) * 0.22));
        var shouldClose = mobilePanelSwipeDragging && mobilePanelSwipeDeltaX >= threshold;
        if (shouldClose) {
          resetMobileTaskPanelDragState();
          hideMobileTaskPanel();
          return;
        }
        if (mobilePanelSwipeDragging && mobileTaskPanel) {
          mobileTaskPanel.classList.remove('dragging');
          mobileTaskPanel.style.transition = 'transform 0.2s ease';
          mobileTaskPanel.style.transform = 'translateX(0px)';
          if (mobileTaskOverlay) {
            mobileTaskOverlay.style.transition = 'opacity 0.2s ease';
            mobileTaskOverlay.style.opacity = '1';
          }
          setTimeout(function() {
            resetMobileTaskPanelDragState();
          }, 220);
          return;
        }
        resetMobileTaskPanelDragState();
      }

      function showMobileTaskPanel() {
        resetMobileTaskPanelDragState();
        if (mobileTaskOverlay) mobileTaskOverlay.classList.add('visible');
        if (mobileTaskPanel) mobileTaskPanel.classList.add('visible');
        renderMobileTaskList();
      }

      function hideMobileTaskPanel() {
        resetMobileTaskPanelDragState();
        if (mobileTaskPanel) mobileTaskPanel.classList.remove('visible');
        if (mobileTaskOverlay) mobileTaskOverlay.classList.remove('visible');
        hideContextMenu();
      }

      function showMobileAgentPopup(text, anchorEl) {
        if (!text || !anchorEl) return;
        var popup = document.getElementById('mobileAgentPopup');
        if (!popup) {
          popup = document.createElement('div');
          popup.id = 'mobileAgentPopup';
          popup.className = 'mobile-agent-popup';
          document.body.appendChild(popup);
        }
        popup.textContent = text;
        popup.classList.remove('visible');
        popup.style.left = '-9999px';
        popup.style.top = '-9999px';
        requestAnimationFrame(function() {
          var rect = anchorEl.getBoundingClientRect();
          var popupRect = popup.getBoundingClientRect();
          var left = rect.left + (rect.width / 2) - (popupRect.width / 2);
          left = Math.max(8, Math.min(left, window.innerWidth - popupRect.width - 8));
          var top = rect.bottom + 8;
          if (top + popupRect.height > window.innerHeight - 8) {
            top = rect.top - popupRect.height - 8;
          }
          popup.style.left = left + 'px';
          popup.style.top = top + 'px';
          popup.classList.add('visible');
        });
        if (mobileAgentPopupTimer) {
          clearTimeout(mobileAgentPopupTimer);
          mobileAgentPopupTimer = null;
        }
        mobileAgentPopupTimer = setTimeout(function() {
          popup.classList.remove('visible');
        }, 1600);
      }

      function clearMobileContextSelection() {
        if (mobileContextSelectedEl) {
          mobileContextSelectedEl.classList.remove('menu-target-active');
          mobileContextSelectedEl.classList.remove('long-press-active');
          mobileContextSelectedEl = null;
        }
      }

      function setMobileContextSelection(el) {
        clearMobileContextSelection();
        if (!el) return;
        mobileContextSelectedEl = el;
        mobileContextSelectedEl.classList.add('menu-target-active');
      }

      // ========== FOLDER ICON SVGs (Lucide icon paths) ==========
      var FOLDER_ICON_SVGS = {
        Folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        Briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
        Code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
        FileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
        Image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
        Music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        Video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
        Database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
        Globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
        Mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
        MessageSquare: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        Phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
        Calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
        Clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        Star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
        Heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
        Bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
        Tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
        Flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
        Zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
        Rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
        Target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
        Trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
        Gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
        ShoppingCart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
        CreditCard: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
        DollarSign: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        PieChart: '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
        BarChart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
        TrendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
        Users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        User: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        Home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        Building: '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
        Car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
        Plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
        Map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
        Compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
        Sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
        Moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        Cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
        Umbrella: '<path d="M22 12a10.06 10.06 1 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
        Coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
        Pizza: '<path d="m12 14-1 1"/><path d="m13.75 18.25-1.25 1.42"/><path d="M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12"/><path d="M18.8 9.3a1 1 0 0 0 2.1 7.7"/><path d="M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z"/>',
        Apple: '<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/>',
        Leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
        Flower2: '<path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"/><circle cx="12" cy="8" r="2"/><path d="M12 10v12"/><path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"/><path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"/>',
        Bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
        Gamepad2: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
        Headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
        Camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
        Tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
        Monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
        Smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
        Tablet: '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/>',
        Watch: '<circle cx="12" cy="12" r="6"/><polyline points="12 10 12 12 13 13"/><path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05"/><path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05"/>',
        Cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
        HardDrive: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
        Wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
        Bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
        Battery: '<rect width="16" height="10" x="2" y="7" rx="2" ry="2"/><line x1="22" x2="22" y1="11" y2="13"/>',
        Lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
        Wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
        Hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
        Scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
        Paintbrush: '<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>',
        Pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
        Pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
        Eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
        Ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
        Calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
        Book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
        GraduationCap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
        School: '<path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M18 5v17"/><path d="m4 6 8-4 8 4"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/>',
        Library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
        Microscope: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
        FlaskConical: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
        Atom: '<circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/>',
        Dna: '<path d="m10 16 1.5 1.5"/><path d="m14 8-1.5-1.5"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="m16.5 10.5 1 1"/><path d="m17 6-2.891-2.891"/><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="m20 9 .891.891"/><path d="M3.109 14.109 4 15"/><path d="m6.5 12.5 1 1"/><path d="m7 18 2.891 2.891"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/>',
        Activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
        Stethoscope: '<path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
        Pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
        Syringe: '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
      };

      function getFolderIconSvg(iconName, color) {
        var paths = FOLDER_ICON_SVGS[iconName] || FOLDER_ICON_SVGS['Folder'];
        var c = color || 'currentColor';
        return '<svg viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">' + paths + '</svg>';
      }

      function normalizeThemePreference(value) {
        var next = String(value || '').trim().toLowerCase();
        if (next === 'light' || next === 'dark' || next === 'system') return next;
        return 'system';
      }

      function getSystemTheme() {
        try {
          return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } catch {
          return 'light';
        }
      }

      function resolveThemePreference(value) {
        var normalized = normalizeThemePreference(value);
        return normalized === 'system' ? getSystemTheme() : normalized;
      }

      function bindSystemThemeListener() {
        if (systemThemeMediaQuery) {
          try {
            if (typeof systemThemeMediaQuery.removeEventListener === 'function') {
              systemThemeMediaQuery.removeEventListener('change', handleSystemThemeChange);
            } else if (typeof systemThemeMediaQuery.removeListener === 'function') {
              systemThemeMediaQuery.removeListener(handleSystemThemeChange);
            }
          } catch {}
        }
        systemThemeMediaQuery = null;
        if (currentThemePreference !== 'system' || !window.matchMedia) return;
        systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        try {
          if (typeof systemThemeMediaQuery.addEventListener === 'function') {
            systemThemeMediaQuery.addEventListener('change', handleSystemThemeChange);
          } else if (typeof systemThemeMediaQuery.addListener === 'function') {
            systemThemeMediaQuery.addListener(handleSystemThemeChange);
          }
        } catch {}
      }

      function setResolvedThemeOnBody(resolved) {
        var next = resolved === 'dark' ? 'dark' : 'light';
        document.body.classList.toggle('theme-dark', next === 'dark');
        document.body.classList.toggle('theme-light', next === 'light');
        var nextThemeColor = next === 'dark' ? '#0f1419' : '#f8fafc';
        themeColorMetas.forEach(function(meta) {
          meta.setAttribute('content', nextThemeColor);
        });
      }

      function getThemeIconSvg(themePreference) {
        var preference = normalizeThemePreference(themePreference);
        if (preference === 'light') {
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
        }
        if (preference === 'dark') {
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 18v2"/></svg>';
      }

      function setThemeMenuOpen(open) {
        var expanded = Boolean(open);
        if (themeMenu) themeMenu.classList.toggle('visible', expanded);
        if (themeBtn) themeBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }

      function updateThemeControlUi() {
        if (themeBtn) {
          themeBtn.innerHTML = getThemeIconSvg(currentThemePreference);
          var title = 'Theme: ' + (currentThemePreference.charAt(0).toUpperCase() + currentThemePreference.slice(1));
          themeBtn.setAttribute('title', title);
          themeBtn.setAttribute('data-status-label', title);
        }
        if (themeSelect) {
          themeSelect.value = currentThemePreference;
        }
        themeMenuOptions.forEach(function(node) {
          var value = String(node.getAttribute('data-theme-option') || '');
          var active = value === currentThemePreference;
          node.classList.toggle('active', active);
          node.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      }

      function applyThemePreference(value, persist) {
        currentThemePreference = normalizeThemePreference(value);
        setResolvedThemeOnBody(resolveThemePreference(currentThemePreference));
        bindSystemThemeListener();
        updateThemeControlUi();
        if (persist !== false) {
          try {
            localStorage.setItem(WEBCHAT_THEME_STORAGE_KEY, currentThemePreference);
          } catch {}
        }
      }

      function handleSystemThemeChange() {
        if (currentThemePreference !== 'system') return;
        setResolvedThemeOnBody(resolveThemePreference('system'));
      }

      function initializeThemePreference() {
        var stored = 'system';
        try {
          stored = localStorage.getItem(WEBCHAT_THEME_STORAGE_KEY) || 'system';
        } catch {}
        applyThemePreference(stored, false);
      }

      // ========== AUTH FUNCTIONS ==========
      function setAuthError(message) {
        if (!authError) return;
        if (!message) {
          authError.classList.remove('visible');
          authError.textContent = '';
          return;
        }
        authError.textContent = message;
        authError.classList.add('visible');
      }

      function getAuthHeaders() {
        const stored = authValue || localStorage.getItem(authStorageKey) || '';
        if (!stored) return {};
        if (authMode === 'password') {
          const encoded = btoa('opendeskmate:' + stored);
          return { Authorization: 'Basic ' + encoded };
        }
        return { Authorization: 'Bearer ' + stored };
      }

      function showAuthModal(userInitiated) {
        if (authModal) authModal.classList.add('visible');
        if (userInitiated) authModalUserOpened = true;
      }

      function hideAuthModal(force) {
        if (authModalUserOpened && !force) return;
        if (authModal) authModal.classList.remove('visible');
        authModalUserOpened = false;
      }

      function updateAuthStatus() {
        if (!authStatus) return;
        var hasRequiredAuth = authMode !== 'none';
        var isConnected = !hasRequiredAuth || Boolean(authValidated && authValue);
        var isWarning = hasRequiredAuth && !isConnected && Boolean(authValue);
        var statusLabel = isConnected
          ? 'Status: Connected'
          : (isWarning ? 'Status: Token stored, not validated' : 'Status: Not connected');

        if (authValidated && authValue) {
          authStatus.innerHTML = 'Token stored • Validated <span class="ok">✓</span>';
        } else if (authValue) {
          authStatus.innerHTML = 'Token stored • Not validated <span class="bad">✕</span>';
        } else {
          authStatus.innerHTML = '';
        }
        if (connectedBadge) {
          connectedBadge.style.display = 'inline-flex';
          connectedBadge.setAttribute('title', statusLabel);
          connectedBadge.setAttribute('data-status-label', statusLabel);
          connectedBadge.classList.toggle('is-connected', isConnected);
          connectedBadge.classList.toggle('is-warning', isWarning);
          connectedBadge.classList.toggle('is-disconnected', !isConnected && !isWarning);
          connectedBadge.innerHTML = isConnected
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>'
            : (isWarning
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:13px;height:13px;flex-shrink:0;"><path d="M12 9v4"/><circle cx="12" cy="16.2" r="0.7" fill="currentColor"/><path d="M12 3.5l8.6 15.2a1 1 0 0 1-.87 1.5H4.27a1 1 0 0 1-.87-1.5L12 3.5z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:13px;height:13px;flex-shrink:0;"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7"/><path d="m15.5 8.5-7 7"/></svg>');
        }
        var showMobileBadge = isConnected ? 'flex' : 'none';
        if (mobileConnectedBadge) {
          mobileConnectedBadge.style.display = showMobileBadge;
        }
      }

      async function requestJson(path, options = {}) {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}, getAuthHeaders());
        const res = await fetch(path, Object.assign({}, options, { headers }));
        if (res.status === 401) {
          setAuthError('Unauthorized. Check your access token or password.');
          showAuthModal();
          authValidated = false;
          updateAuthStatus();
          throw new Error('unauthorized');
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Request failed');
        }
        authValidated = true;
        hideAuthModal();
        updateAuthStatus();
        return res.json();
      }

      async function loadAuthInfo() {
        try {
          const res = await fetch('/auth/info');
          const info = await res.json();
          authMode = info.mode || 'none';
        } catch {
          authMode = 'none';
        }

        authStorageKey = authMode === 'password' ? 'odm_gateway_password' : 'odm_gateway_token';
        authValue = localStorage.getItem(authStorageKey) || '';
        if (authInput) authInput.value = authValue;

        if (authMode === 'none') {
          hideAuthModal();
          authValidated = true;
          updateAuthStatus();
          return;
        }

        if (authHint) {
          authHint.textContent = authMode === 'password'
            ? 'Enter your access password to continue.'
            : 'Enter your access token to continue.';
        }
        updateAuthStatus();
      }

      // ========== FOLDER MANAGEMENT (API-BASED) ==========
      // Sync folders with the desktop app via API endpoints

      async function loadFolders() {
        try {
          const data = await requestJson('/folders', { method: 'GET' });
          allFolders = data.folders || [];
          taskFolderAssignments = data.assignments || {};
        } catch (err) {
          if (String(err && err.message) !== 'unauthorized') {
            console.warn('Failed to load folders', err);
          }
          allFolders = [];
          taskFolderAssignments = {};
        }
      }

      async function createFolderApi(name, color, icon) {
        try {
          const folder = await requestJson('/folders', {
            method: 'POST',
            body: JSON.stringify({ name: name, color: color || FOLDER_COLORS[0].color, icon: icon || 'Folder' })
          });
          allFolders.push(folder);
          return folder;
        } catch (err) {
          console.warn('Failed to create folder', err);
          return null;
        }
      }

      async function updateFolderApi(folderId, updates) {
        try {
          const folder = await requestJson('/folders/' + folderId, {
            method: 'PUT',
            body: JSON.stringify(updates)
          });
          const idx = allFolders.findIndex(f => f.id === folderId);
          if (idx !== -1) {
            allFolders[idx] = folder;
          }
          return folder;
        } catch (err) {
          console.warn('Failed to update folder', err);
          return null;
        }
      }

      async function deleteFolderApi(folderId) {
        try {
          await requestJson('/folders/' + folderId, { method: 'DELETE' });
          allFolders = allFolders.filter(f => f.id !== folderId);
          // Remove local task assignments for this folder
          Object.keys(taskFolderAssignments).forEach(taskId => {
            if (taskFolderAssignments[taskId] === folderId) {
              delete taskFolderAssignments[taskId];
            }
          });
          return true;
        } catch (err) {
          console.warn('Failed to delete folder', err);
          return false;
        }
      }

      async function setTaskFolderApi(taskId, folderId) {
        try {
          await requestJson('/folders/assign', {
            method: 'POST',
            body: JSON.stringify({ taskId: taskId, folderId: folderId })
          });
          if (folderId) {
            taskFolderAssignments[taskId] = folderId;
          } else {
            delete taskFolderAssignments[taskId];
          }
          return true;
        } catch (err) {
          console.warn('Failed to assign task to folder', err);
          return false;
        }
      }

      function getTaskFolder(taskId) {
        return taskFolderAssignments[taskId] || null;
      }

      async function toggleFolderExpanded(folderId) {
        const folder = allFolders.find(f => f.id === folderId);
        if (folder) {
          folder.isExpanded = !folder.isExpanded;
          await updateFolderApi(folderId, { isExpanded: folder.isExpanded });
        }
      }

      function showFolderModal(editFolder) {
        editingFolderId = editFolder ? editFolder.id : null;
        folderModalTitle.textContent = editFolder ? 'Edit Project' : 'New Project';
        folderNameInput.value = editFolder ? editFolder.name : '';
        selectedFolderColor = editFolder ? editFolder.color : FOLDER_COLORS[0].color;
        selectedFolderIcon = (editFolder && editFolder.icon) ? editFolder.icon : 'Folder';
        folderSaveBtn.textContent = editFolder ? 'Save' : 'Create';
        setFolderModalTab('icon');
        renderFolderIconPreview();
        renderFolderIcons();
        renderFolderColors();
        folderModal.classList.add('visible');
        folderNameInput.focus();
      }

      function hideFolderModal() {
        folderModal.classList.remove('visible');
        editingFolderId = null;
        folderNameInput.value = '';
        selectedFolderIcon = 'Folder';
      }

      function showRenameModal(taskId) {
        renameTaskId = taskId;
        var task = allTasks.find(function(t) { return t.id === taskId; });
        if (!task) return;
        renameInput.value = task.summary || task.prompt || '';
        renameModal.classList.add('visible');
        renameInput.focus();
        renameInput.select();
      }

      function hideRenameModal() {
        renameModal.classList.remove('visible');
        renameTaskId = null;
        renameInput.value = '';
      }

      async function handleRenameTask() {
        var newName = renameInput.value.trim();
        if (!newName || !renameTaskId) return;
        try {
          await requestJson('/tasks/' + encodeURIComponent(renameTaskId) + '/summary', {
            method: 'PATCH',
            body: JSON.stringify({ summary: newName }),
          });
          hideRenameModal();
          await loadTasks();
          if (selectedTaskId === renameTaskId && chatTitle) {
            chatTitle.textContent = newName;
          }
        } catch (err) {
          console.warn('Failed to rename task', err);
        }
      }

      function showSearchModal() {
        if (!searchModal) return;
        searchModal.classList.add('visible');
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        renderSearchResults('');
      }

      function hideSearchModal() {
        if (!searchModal) return;
        searchModal.classList.remove('visible');
      }

      function renderSearchResults(query) {
        if (!searchResults) return;
        var q = (query || '').toLowerCase().trim();
        var filtered = allTasks;
        if (q) {
          filtered = allTasks.filter(function(t) {
            var title = (t.summary || t.prompt || '').toLowerCase();
            return title.indexOf(q) >= 0;
          });
        }
        if (filtered.length === 0) {
          searchResults.innerHTML = '<div class="search-empty">' + (q ? 'No tasks found' : 'No tasks yet') + '</div>';
          return;
        }
        searchResults.innerHTML = filtered.slice(0, 20).map(function(task) {
          var title = task.summary || (task.prompt || '').slice(0, 60) || 'Untitled';
          var statusColors = { running: '#4db6ac', completed: '#4ade80', failed: '#f87171', interrupted: '#fbbf24', queued: '#a78bfa', pending: '#94a3b8' };
          var statusColor = statusColors[task.status] || '#94a3b8';
          var time = task.createdAt ? new Date(task.createdAt).toLocaleDateString() : '';
          return '<div class="search-result-item" data-task-id="' + escapeHtml(task.id) + '">' +
            '<span class="task-status-icon" style="background:' + statusColor + ';"></span>' +
            '<span class="search-result-title">' + escapeHtml(title) + '</span>' +
            '<span class="search-result-time">' + escapeHtml(time) + '</span>' +
            '</div>';
        }).join('');

        searchResults.querySelectorAll('.search-result-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var taskId = item.getAttribute('data-task-id');
            hideSearchModal();
            if (taskId) showChatState(taskId);
          });
        });
      }

      function renderFolderColors() {
        if (!folderColors) return;
        folderColors.innerHTML = FOLDER_COLORS.map(c =>
          '<button class="folder-color-btn' + (c.color === selectedFolderColor ? ' selected' : '') +
          '" data-color="' + c.color + '" style="background:' + c.color + ';" title="' + c.name + '"></button>'
        ).join('');
        folderColors.querySelectorAll('.folder-color-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            selectedFolderColor = btn.getAttribute('data-color');
            renderFolderColors();
            renderFolderIconPreview();
            renderFolderIcons();
          });
        });
      }

      function renderFolderIconPreview() {
        if (!folderIconPreview) return;
        var color = selectedFolderColor || '#94a3b8';
        var paths = FOLDER_ICON_SVGS[selectedFolderIcon] || FOLDER_ICON_SVGS['Folder'];
        folderIconPreview.style.backgroundColor = color + '20';
        folderIconPreview.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="' + color +
          '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;">' + paths + '</svg>';
      }

      function renderFolderIcons() {
        if (!folderIcons) return;
        var iconNames = Object.keys(FOLDER_ICON_SVGS);
        var color = selectedFolderColor || '#94a3b8';
        folderIcons.innerHTML = iconNames.map(function(name) {
          var paths = FOLDER_ICON_SVGS[name];
          return '<button class="folder-icon-btn' + (name === selectedFolderIcon ? ' selected' : '') +
            '" data-icon="' + name + '" title="' + name + '" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="' + color +
            '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">' + paths + '</svg></button>';
        }).join('');
        folderIcons.querySelectorAll('.folder-icon-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            selectedFolderIcon = btn.getAttribute('data-icon');
            renderFolderIcons();
            renderFolderIconPreview();
          });
        });
      }

      function setFolderModalTab(tab) {
        folderModalTab = tab;
        if (folderTabIcon && folderTabColor && folderIcons && folderColors) {
          folderTabIcon.classList.toggle('active', tab === 'icon');
          folderTabColor.classList.toggle('active', tab === 'color');
          folderIcons.style.display = tab === 'icon' ? 'grid' : 'none';
          folderColors.style.display = tab === 'color' ? 'flex' : 'none';
        }
      }

      function showContextMenu(x, y, taskId) {
        const task = allTasks.find(t => t.id === taskId);
        if (!task) return;
        const currentFolderId = getTaskFolder(taskId);

        let menuHtml = '<button class="context-menu-item" data-action="rename-task">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>' +
          'Rename</button>' +
          '<div class="context-menu-separator"></div>' +
          '<div class="context-submenu">' +
          '<button class="context-menu-item">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
          'Move to project <span style="margin-left:auto;">▸</span></button>' +
          '<div class="context-submenu-content">' +
          '<button class="context-menu-item" data-action="new-folder">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' +
          'New project</button>' +
          '<div class="context-menu-separator"></div>';

        allFolders.forEach(folder => {
          const isCurrent = currentFolderId === folder.id;
          menuHtml += '<button class="context-menu-item" data-action="move-to-folder" data-folder-id="' + folder.id + '">' +
            '<span class="folder-icon" style="background:' + folder.color + '20;color:' + folder.color + ';width:18px;height:18px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;">' + getFolderIconSvg(folder.icon || 'Folder', folder.color) + '</span>' +
            escapeHtml(folder.name) + (isCurrent ? ' <span style="color:var(--muted-foreground);margin-left:auto;">(current)</span>' : '') + '</button>';
        });

        if (currentFolderId) {
          menuHtml += '<div class="context-menu-separator"></div>' +
            '<button class="context-menu-item" data-action="remove-from-folder">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
            'Remove from project</button>';
        }

        menuHtml += '</div></div>' +
          '<div class="context-menu-separator"></div>' +
          '<button class="context-menu-item danger" data-action="delete-task">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          'Delete task</button>';

        contextMenu.innerHTML = menuHtml;
        contextMenu.style.display = 'block';
        contextMenu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
        contextMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
        contextMenu.setAttribute('data-task-id', taskId);

        // Event handlers for menu items
        contextMenu.querySelectorAll('[data-action]').forEach(item => {
          item.addEventListener('click', function(e) {
            e.stopPropagation();
            const action = item.getAttribute('data-action');
            const menuTaskId = contextMenu.getAttribute('data-task-id');

            if (action === 'rename-task') {
              hideContextMenu();
              showRenameModal(menuTaskId);
            } else if (action === 'new-folder') {
              hideContextMenu();
              showFolderModal();
            } else if (action === 'move-to-folder') {
              const folderId = item.getAttribute('data-folder-id');
              setTaskFolderApi(menuTaskId, folderId).then(function() { renderTaskList(); });
              hideContextMenu();
            } else if (action === 'remove-from-folder') {
              setTaskFolderApi(menuTaskId, null).then(function() { renderTaskList(); });
              hideContextMenu();
            } else if (action === 'delete-task') {
              if (confirm('Delete this task?')) {
                deleteTask(menuTaskId);
              }
              hideContextMenu();
            }
          });
        });
      }

      function hideContextMenu() {
        contextMenu.style.display = 'none';
        clearMobileContextSelection();
      }

      function showFolderContextMenu(x, y, folderId) {
        var folder = allFolders.find(function(f) { return f.id === folderId; });
        if (!folder) return;
        var folderTasks = allTasks.filter(function(t) { return getTaskFolder(t.id) === folderId; });

        var menuHtml =
          '<button class="context-menu-item" data-action="edit-folder">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>' +
          'Edit</button>' +
          '<div class="context-menu-separator"></div>' +
          '<button class="context-menu-item danger" data-action="delete-folder">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          'Delete</button>';

        contextMenu.innerHTML = menuHtml;
        contextMenu.setAttribute('data-folder-id', folderId);
        contextMenu.removeAttribute('data-task-id');
        contextMenu.style.display = 'block';

        var rect = contextMenu.getBoundingClientRect();
        var menuX = Math.min(x, window.innerWidth - rect.width - 8);
        var menuY = Math.min(y, window.innerHeight - rect.height - 8);
        contextMenu.style.left = menuX + 'px';
        contextMenu.style.top = menuY + 'px';

        contextMenu.querySelectorAll('[data-action]').forEach(function(item) {
          item.addEventListener('click', function(e) {
            e.stopPropagation();
            var action = item.getAttribute('data-action');
            if (action === 'edit-folder') {
              hideContextMenu();
              showFolderModal(folder);
            } else if (action === 'delete-folder') {
              hideContextMenu();
              var taskCount = folderTasks.length;
              var msg = 'Delete "' + folder.name + '"?';
              if (taskCount > 0) {
                msg += '\\n\\nThe ' + taskCount + ' task' + (taskCount > 1 ? 's' : '') + ' in this project will be moved to the main list.';
              }
              if (confirm(msg)) {
                deleteFolderApi(folderId).then(function() {
                  renderTaskList();
                });
              }
            }
          });
        });
      }

      function updateAgentAvatarEl(el, agent) {
        if (!el) return;
        if (agent && agent.avatar) {
          var color = agent.avatarColor || 'var(--primary)';
          el.innerHTML = getAgentAvatarSvg(agent.avatar, color);
          el.style.background = agent.avatarColor ? (agent.avatarColor + '20') : 'rgba(77,182,172,0.1)';
          el.style.color = '';
          el.style.fontSize = '';
        } else {
          var name = agent ? (agent.name || agent.id) : 'A';
          el.textContent = name.charAt(0).toUpperCase();
          el.style.background = 'rgba(77,182,172,0.1)';
        }
      }

      function showAgentDropdown(anchorEl) {
        if (!agentSelect || cachedAgents.length === 0) return;
        var currentVal = agentSelect.value;
        var menuHtml = '<div style="padding:4px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted-foreground);">Agents</div>';
        cachedAgents.forEach(function(agent) {
          var isActive = agent.id === currentVal;
          var isDefault = agent.id === cachedDefaultAgentId;
          var name = agent.name || agent.id;
          var roleLabel = agent.roleName || agent.id;
          var avatarColor = agent.avatarColor || 'var(--muted-foreground)';
          var avatarBg = agent.avatarColor ? (agent.avatarColor + '20') : 'hsl(220 14.3% 95.9%)';
          var avatarHtml = agent.avatar
            ? '<div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + avatarBg + ';padding:4px;">' + getAgentAvatarSvg(agent.avatar, avatarColor) + '</div>'
            : '<div style="width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:' + avatarBg + ';font-size:12px;font-weight:600;color:' + avatarColor + ';">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>';
          menuHtml += '<button class="context-menu-item" data-agent-id="' + escapeHtml(agent.id) + '" style="' + (isActive ? 'color:var(--primary);' : '') + '">' +
            (isActive ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>' : '<span style="width:14px;flex-shrink:0;display:inline-block;"></span>') +
            avatarHtml +
            '<div style="flex:1;min-width:0;"><div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(name) + '</div>' +
            '<div style="font-size:10px;color:var(--muted-foreground);">' + escapeHtml(roleLabel) + '</div></div>' +
            (isDefault ? '<span style="font-size:9px;font-weight:600;padding:2px 6px;border-radius:10px;background:rgba(77,182,172,0.1);color:var(--primary);white-space:nowrap;">Default</span>' : '') +
            '</button>';
        });
        contextMenu.innerHTML = menuHtml;
        contextMenu.removeAttribute('data-task-id');
        contextMenu.removeAttribute('data-folder-id');
        contextMenu.style.display = 'block';
        var rect = anchorEl.getBoundingClientRect();
        var menuRect = contextMenu.getBoundingClientRect();
        var menuX = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
        var menuY = Math.min(rect.bottom + 4, window.innerHeight - menuRect.height - 8);
        contextMenu.style.left = menuX + 'px';
        contextMenu.style.top = menuY + 'px';
        contextMenu.querySelectorAll('[data-agent-id]').forEach(function(btn) {
          btn.addEventListener('click', async function() {
            var agentId = btn.getAttribute('data-agent-id');
            if (agentId === agentSelect.value) {
              hideContextMenu();
              return;
            }
            // Call backend to persist the active agent change
            try {
              await requestJson('/agents/set-active', {
                method: 'POST',
                body: JSON.stringify({ agentId: agentId })
              });
            } catch (err) {
              console.warn('Failed to set active agent', err);
            }
            // Update local state
            agentSelect.value = agentId;
            var agent = cachedAgents.find(function(a) { return a.id === agentId; });
            var name = agent ? (agent.name || agent.id) : agentId;
            var roleLabel = agent ? (agent.roleName || agent.id) : agentId;
            if (agentName) agentName.textContent = name;
            if (agentIdDisplay) agentIdDisplay.textContent = roleLabel;
            updateAgentAvatarEl(agentAvatar, agent);
            if (mobileAgentName) mobileAgentName.textContent = name;
            if (mobileAgentId) mobileAgentId.textContent = roleLabel;
            updateAgentAvatarEl(mobileAgentAvatar, agent);
            updateAgentAvatarEl(mobileConnectedAgentAvatar, agent);
            updateInitialHeaderBadges();
            hideContextMenu();
            // Reset chat view and reload folders + tasks for the new agent
            showInitialState();
            await loadFolders();
            await loadTasks();
          });
        });
      }

      async function deleteTask(taskId) {
        try {
          await requestJson('/tasks/' + taskId, { method: 'DELETE' });
          if (selectedTaskId === taskId) {
            showInitialState();
          }
          await loadTasks();
        } catch (err) {
          console.warn('Failed to delete task', err);
        }
      }

      // ========== UTILITY FUNCTIONS ==========
      function escapeHtml(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function renderCopyButton(copyId) {
        var id = String(copyId || '').trim();
        if (!id) return '';
        return '<div class="message-actions">' +
          '<button type="button" class="message-copy-btn" data-copy-message-id="' + escapeHtml(id) + '" title="Copy message text" aria-label="Copy message text">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
              '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
            '</svg>' +
          '</button>' +
        '</div>';
      }

      function renderSavePromptButton(saveId) {
        var id = String(saveId || '').trim();
        if (!id) return '';
        return '<button type="button" class="message-save-btn" data-save-prompt-id="' + escapeHtml(id) + '" title="Save this prompt" aria-label="Save this prompt">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>' +
          '</svg>' +
        '</button>';
      }

      function renderInlineCopyButton(copyId) {
        var id = String(copyId || '').trim();
        if (!id) return '';
        return '<button type="button" class="message-copy-btn" data-copy-message-id="' + escapeHtml(id) + '" title="Copy message text" aria-label="Copy message text">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
          '</svg>' +
        '</button>';
      }

      async function copyTextToClipboard(text) {
        var value = String(text || '');
        if (!value) return false;
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return true;
          }
        } catch {
          // Fallback below.
        }
        try {
          var area = document.createElement('textarea');
          area.value = value;
          area.setAttribute('readonly', 'readonly');
          area.style.position = 'fixed';
          area.style.top = '-9999px';
          area.style.left = '-9999px';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.focus();
          area.select();
          if (typeof area.setSelectionRange === 'function') {
            area.setSelectionRange(0, area.value.length);
          }
          var success = document.execCommand('copy');
          document.body.removeChild(area);
          return Boolean(success);
        } catch {
          return false;
        }
      }

      function renderMarkdown(text) {
        if (!text) return '';
        let s = escapeHtml(text);
        s = s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, inner) {
          let lines = inner.split('\\n');
          if (lines[0] && !/\\S/.test(lines[0].replace(/^\\w+$/, ''))) lines.shift();
          if (lines.length && !lines[0].trim()) lines.shift();
          if (lines.length && !lines[lines.length - 1].trim()) lines.pop();
          return '<pre><code>' + lines.join('\\n') + '</code></pre>';
        });
        s = s.replace(/\`([^\`]+?)\`/g, '<code>$1</code>');
        s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        s = s.replace(/^---$/gm, '<hr>');
        s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        s = s.replace(/(^|\\n)([-*] .+(?:\\n[-*] .+)*)/g, function(_, pre, block) {
          const items = block.split('\\n').map(function(l) { return '<li>' + l.replace(/^[-*] /, '') + '</li>'; }).join('');
          return pre + '<ul>' + items + '</ul>';
        });
        s = s.replace(/(^|\\n)(\\d+\\. .+(?:\\n\\d+\\. .+)*)/g, function(_, pre, block) {
          const items = block.split('\\n').map(function(l) { return '<li>' + l.replace(/^\\d+\\.\\s*/, '') + '</li>'; }).join('');
          return pre + '<ol>' + items + '</ol>';
        });
        s = s.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        s = s.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        const parts = s.split(/\\n{2,}/);
        s = parts.map(function(part) {
          const trimmed = part.trim();
          if (!trimmed) return '';
          if (/^<(h[1-3]|ul|ol|pre|blockquote|hr)/.test(trimmed)) return trimmed;
          return '<p>' + trimmed.replace(/\\n/g, '<br>') + '</p>';
        }).join('');
        return s;
      }

      function formatTime(ts) {
        if (!ts) return '';
        try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
      }

      function getTaskTitle(task) {
        const customTitle = localStorage.getItem('odm_webchat_title_' + task.id);
        if (customTitle) return customTitle;
        return task.summary || (task.prompt || '').slice(0, 60) || 'Untitled task';
      }

      function getProviderLabel(providerId) {
        var id = String(providerId || '').toLowerCase();
        var labels = {
          anthropic: 'Anthropic',
          openai: 'OpenAI',
          google: 'Google AI',
          xai: 'xAI',
          ollama: 'Ollama',
        };
        return labels[id] || String(providerId || '');
      }

      function usageFormatInt(value) {
        var numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) numeric = 0;
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(numeric);
      }

      function usageFormatMoney(amount, currency) {
        var numeric = Number(amount || 0);
        if (!Number.isFinite(numeric)) numeric = 0;
        var curr = String(currency || '').trim() || 'USD';
        try {
          return new Intl.NumberFormat(undefined, { style: 'currency', currency: curr }).format(numeric);
        } catch {
          return curr + ' ' + numeric.toFixed(2);
        }
      }

      function getUsageSubtitle(summary) {
        if (!summary) return 'Add pricing to see cost';
        var hasPricing = Boolean(summary.currency) && summary.cost != null;
        if (!hasPricing) return 'Add pricing to see cost';
        var missing = Array.isArray(summary.unpricedProviders) ? summary.unpricedProviders : [];
        if (missing.length > 0) return 'Partial cost (missing: ' + missing.join(', ') + ')';
        return 'Estimated cost';
      }

      function renderUsageBanner() {
        if (!usageTokensText || !usageCostText || !usageSubtitleText) return;
        if (usageSummaryLoading && !usageSummary) {
          usageTokensText.textContent = 'Usage';
          usageCostText.textContent = '';
          usageSubtitleText.textContent = 'Loading…';
        } else {
          usageTokensText.textContent = 'Tokens: ' + usageFormatInt(usageSummary && usageSummary.totalTokens);
          if (usageSummary && usageSummary.cost != null && usageSummary.currency) {
            usageCostText.textContent = usageFormatMoney(usageSummary.cost, usageSummary.currency);
            usageCostText.style.display = 'inline';
          } else {
            usageCostText.textContent = '';
            usageCostText.style.display = 'none';
          }
          usageSubtitleText.textContent = getUsageSubtitle(usageSummary);
        }

        if (usagePeriodTabs) {
          usagePeriodTabs.querySelectorAll('[data-usage-period]').forEach(function(btn) {
            var value = String(btn.getAttribute('data-usage-period') || '').trim();
            btn.classList.toggle('active', value === usagePeriod);
          });
        }
      }

      function renderUsageDetails() {
        if (!usageDetailsBody) return;
        if (!usageSummary) {
          usageDetailsBody.innerHTML = '<div style="font-size:13px;color:var(--muted-foreground);">No data yet.</div>';
          return;
        }

        var summary = usageSummary;
        var overview = ''
          + '<div class="rounded-lg border border-border bg-card p-4">'
          + '<div class="usage-details-grid">'
          + '<div><div class="usage-details-label">Input</div><div class="usage-details-value">' + usageFormatInt(summary.inputTokens) + '</div></div>'
          + '<div><div class="usage-details-label">Output</div><div class="usage-details-value">' + usageFormatInt(summary.outputTokens) + '</div></div>'
          + '<div><div class="usage-details-label">Total</div><div class="usage-details-value">' + usageFormatInt(summary.totalTokens) + '</div></div>'
          + '</div>'
          + (
            summary.cost != null && summary.currency
              ? '<div style="margin-top:10px;font-size:13px;"><span style="color:var(--muted-foreground);">Estimated cost: </span><span style="font-weight:600;color:var(--foreground);">'
                + usageFormatMoney(summary.cost, summary.currency)
                + '</span></div>'
              : '<div style="margin-top:10px;font-size:13px;color:var(--muted-foreground);">Add pricing in Settings to see estimated cost.</div>'
          )
          + (
            Array.isArray(summary.unpricedProviders) && summary.unpricedProviders.length > 0
              ? '<div style="margin-top:10px;font-size:11px;color:var(--muted-foreground);">Partial cost: missing pricing for '
                + escapeHtml(summary.unpricedProviders.join(', '))
                + '.</div>'
              : ''
          )
          + '</div>';

        var rows = Array.isArray(summary.providerBreakdown) ? summary.providerBreakdown : [];
        var providerHtml = '';
        if (rows.length === 0) {
          providerHtml = '<div style="font-size:13px;color:var(--muted-foreground);">No events in this period.</div>';
        } else {
          providerHtml = rows.map(function(row) {
            var totalTokens = usageFormatInt(row.totalTokens);
            var meta = totalTokens + ' tokens' + (row.unpricedEvents > 0 ? (' • ' + usageFormatInt(row.unpricedEvents) + ' unpriced') : '');
            var costHtml = (summary.currency && row.cost != null)
              ? '<div class="usage-provider-cost">' + usageFormatMoney(row.cost, summary.currency) + '</div>'
              : '<div class="usage-provider-cost unpriced">' + (row.totalTokens > 0 ? 'Unpriced' : '—') + '</div>';
            return ''
              + '<div class="usage-provider-row">'
              + '<div style="min-width:0;">'
              + '<div class="usage-provider-name">' + escapeHtml(getProviderLabel(row.provider)) + '</div>'
              + '<div class="usage-provider-meta">' + escapeHtml(meta) + '</div>'
              + '</div>'
              + costHtml
              + '</div>';
          }).join('');
        }

        usageDetailsBody.innerHTML = ''
          + overview
          + '<div class="rounded-lg border border-border bg-card p-4">'
          + '<div style="font-size:13px;font-weight:600;color:var(--foreground);margin-bottom:8px;">By provider</div>'
          + '<div class="usage-provider-list">' + providerHtml + '</div>'
          + '</div>'
          + '<div style="font-size:11px;color:var(--muted-foreground);">Token usage is logged when a request completes. When providers do not report usage, estimates may be used.</div>';
      }

      function openUsageDetailsModal() {
        if (!usageDetailsModal) return;
        renderUsageDetails();
        usageDetailsModal.classList.add('visible');
      }

      function closeUsageDetailsModal() {
        if (!usageDetailsModal) return;
        usageDetailsModal.classList.remove('visible');
      }

      async function loadUsageSummary() {
        usageSummaryLoading = true;
        renderUsageBanner();
        try {
          var result = await requestJson('/usage/summary?period=' + encodeURIComponent(usagePeriod), { method: 'GET' });
          usageSummary = result && typeof result === 'object' ? result : null;
        } catch {
          usageSummary = null;
        } finally {
          usageSummaryLoading = false;
          renderUsageBanner();
          if (usageDetailsModal && usageDetailsModal.classList.contains('visible')) {
            renderUsageDetails();
          }
        }
      }

      function isFullscreenActive() {
        return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      }

      function getFullscreenEnterIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
      }

      function getFullscreenExitIcon() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 9H5V5"/><path d="M15 9h4V5"/><path d="M9 15H5v4"/><path d="M15 15h4v4"/></svg>';
      }

      function updateFullscreenButtons() {
        var active = isFullscreenActive();
        var title = active ? 'Exit full screen' : 'Enter full screen';
        var icon = active ? getFullscreenExitIcon() : getFullscreenEnterIcon();
        [fullscreenBtn, initialFullscreenBtn].forEach(function(btn) {
          if (!btn) return;
          btn.title = title;
          btn.setAttribute('aria-label', title);
          btn.innerHTML = icon;
        });
      }

      async function toggleFullscreenMode() {
        try {
          var docEl = document.documentElement;
          if (!isFullscreenActive()) {
            if (docEl.requestFullscreen) {
              await docEl.requestFullscreen();
            } else if (docEl.webkitRequestFullscreen) {
              docEl.webkitRequestFullscreen();
            }
          } else if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        } catch (error) {
          console.warn('Failed to toggle full screen mode', error);
        } finally {
          updateFullscreenButtons();
        }
      }

      function formatSelectedModelLabel(selectedModel) {
        if (!selectedModel || typeof selectedModel !== 'object') return '';
        var provider = typeof selectedModel.provider === 'string' ? selectedModel.provider : '';
        var modelFullId =
          typeof selectedModel.model === 'string'
            ? selectedModel.model.trim()
            : typeof selectedModel.id === 'string'
              ? selectedModel.id.trim()
              : '';
        if (!modelFullId) return '';
        var modelName = modelFullId;
        var providerPrefix = provider ? (provider + '/').toLowerCase() : '';
        if (providerPrefix && modelFullId.toLowerCase().indexOf(providerPrefix) === 0) {
          modelName = modelFullId.slice(provider.length + 1);
        } else if (modelFullId.indexOf('/') >= 0) {
          modelName = modelFullId.slice(modelFullId.indexOf('/') + 1);
        }
        var providerLabel = getProviderLabel(provider);
        return providerLabel ? (providerLabel + ': ' + modelName) : modelName;
      }

      function resolveTaskSelectedModel(task) {
        var resolvedAgentId = task && task.agentId
          ? task.agentId
          : (agentSelect && agentSelect.value ? agentSelect.value : null);
        var agent = resolvedAgentId
          ? cachedAgents.find(function(a) { return a.id === resolvedAgentId; })
          : null;
        return (agent && agent.selectedModel) ? agent.selectedModel : cachedGlobalSelectedModel;
      }

      function resolveSelectedAgentForInitialHeader() {
        var selectedAgentId = agentSelect && agentSelect.value ? String(agentSelect.value || '').trim() : '';
        if (selectedAgentId) {
          var selectedAgent = cachedAgents.find(function(a) {
            return String((a && a.id) || '').trim() === selectedAgentId;
          });
          if (selectedAgent) return selectedAgent;
        }
        if (cachedDefaultAgentId) {
          var defaultAgent = cachedAgents.find(function(a) {
            return String((a && a.id) || '').trim() === String(cachedDefaultAgentId || '').trim();
          });
          if (defaultAgent) return defaultAgent;
        }
        return cachedAgents.length > 0 ? cachedAgents[0] : null;
      }

      function updateInitialHeaderBadges() {
        if (initialStatusBadge) {
          initialStatusBadge.textContent = 'Ready';
          initialStatusBadge.className = 'status-badge s-pending';
        }

        var selectedAgent = resolveSelectedAgentForInitialHeader();
        var selectedModel = selectedAgent && selectedAgent.selectedModel
          ? selectedAgent.selectedModel
          : cachedGlobalSelectedModel;
        var modelLabel = formatSelectedModelLabel(selectedModel);
        currentModelLabel = modelLabel || '';
        if (initialModelBadge) {
          if (modelLabel) {
            initialModelBadge.textContent = 'Model: ' + modelLabel;
            initialModelBadge.title = modelLabel;
            initialModelBadge.style.display = 'inline-flex';
          } else {
            initialModelBadge.style.display = 'none';
            initialModelBadge.removeAttribute('title');
          }
        }

        if (initialAgentBadge) {
          var agentDisplay = selectedAgent
            ? String(selectedAgent.name || selectedAgent.id || 'main')
            : 'main';
          initialAgentBadge.textContent = 'Agent: ' + agentDisplay;
          initialAgentBadge.style.display = 'inline-flex';
        }
      }

      function updateTaskHeaderBadges(task) {
        if (statusBadge) {
          statusBadge.textContent = task.status || 'pending';
          statusBadge.className = 'status-badge s-' + (task.status || 'pending');
        }
        if (modelBadge) {
          var selectedModel = resolveTaskSelectedModel(task);
          var modelLabel = formatSelectedModelLabel(selectedModel);
          currentModelLabel = modelLabel || '';
          if (modelLabel) {
            modelBadge.textContent = 'Model: ' + modelLabel;
            modelBadge.title = modelLabel;
            modelBadge.style.display = 'inline-flex';
          } else {
            modelBadge.style.display = 'none';
            modelBadge.removeAttribute('title');
          }
        }
        if (agentBadge) {
          if (task.agentId) {
            var taskAgentId = String(task.agentId || '').trim();
            var resolvedAgent = cachedAgents.find(function(a) {
              var id = String((a && a.id) || '').trim();
              var name = String((a && a.name) || '').trim();
              var role = String((a && a.roleName) || '').trim();
              return taskAgentId === id || taskAgentId === name || taskAgentId === role;
            });
            var agentDisplay = resolvedAgent
              ? String(resolvedAgent.name || resolvedAgent.id || taskAgentId)
              : taskAgentId;
            agentBadge.textContent = 'Agent: ' + agentDisplay;
            agentBadge.style.display = 'inline-flex';
          } else {
            agentBadge.style.display = 'none';
          }
        }
      }

      function persistLastChatState(taskId) {
        try {
          if (!taskId) {
            localStorage.removeItem(LAST_CHAT_STATE_KEY);
            return;
          }
          localStorage.setItem(LAST_CHAT_STATE_KEY, JSON.stringify({
            taskId: String(taskId),
            timestamp: Date.now(),
          }));
        } catch {}
      }

      function getRestorableTaskId() {
        try {
          const raw = localStorage.getItem(LAST_CHAT_STATE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || !parsed.taskId || !parsed.timestamp) return null;
          const age = Date.now() - Number(parsed.timestamp);
          if (!Number.isFinite(age) || age > LAST_CHAT_STATE_MAX_AGE_MS) return null;
          return String(parsed.taskId);
        } catch {
          return null;
        }
      }

      // ========== VIEW SWITCHING ==========
      function showInitialState() {
        initialState.classList.remove('hidden');
        chatState.classList.remove('active');
        if (initialChatHeader) initialChatHeader.style.display = 'flex';
        hideContextInfoPopover();
        selectedTaskId = null;
        selectedSessionId = null;
        followComposerState.attachedFiles = [];
        followComposerState.workingDirectory = '';
        renderComposerMeta('follow');
        renderComposerButtons();
        hideMobileComposerOptions();
        persistLastChatState(null);
        renderTaskList();
        if (scrollBottomBtn) scrollBottomBtn.classList.remove('visible');
        renderContextIndicator('follow', null);
        scheduleContextEstimate('initial', true);
        updateInitialHeaderBadges();
      }

      function showChatState(taskId) {
        initialState.classList.add('hidden');
        chatState.classList.add('active');
        if (initialChatHeader) initialChatHeader.style.display = 'none';
        hideContextInfoPopover();
        selectedTaskId = taskId;
        var selectedTask = allTasks.find(function(task) { return task.id === taskId; });
        if (selectedTask) {
          syncFollowComposerFromTask(selectedTask);
        }
        followComposerState.attachedFiles = [];
        followComposerState.workingDirectory = '';
        renderComposerMeta('follow');
        hideMobileComposerOptions();
        persistLastChatState(taskId);
        renderTaskList();
        loadTaskMessages(taskId);
        setTimeout(updateScrollBottomButtonVisibility, 0);
        scheduleContextEstimate('follow', true);
      }

      // ========== TASK LIST RENDERING ==========
      function getStatusIcon(status) {
        const icons = {
          running: '●',
          completed: '✓',
          failed: '✕',
          interrupted: '⊘',
          cancelled: '—',
          pending: '○',
          queued: '○'
        };
        return icons[status] || '○';
      }

      function renderTaskItem(task) {
        const isActive = selectedTaskId === task.id;
        const title = getTaskTitle(task);
        const statusClass = 's-' + (task.status || 'pending');
        return '<div class="task-item' + (isActive ? ' active' : '') + '" data-task-id="' + escapeHtml(task.id) + '">' +
          '<div class="task-status-icon ' + escapeHtml(statusClass) + '">' + getStatusIcon(task.status) + '</div>' +
          '<span class="task-item-title">' + escapeHtml(title) + '</span>' +
          '<button class="task-item-menu" data-task-id="' + escapeHtml(task.id) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>' +
          '</button></div>';
      }

      function renderTaskList() {
        if (!folderList || !unfiledTasks) return;

        // Group tasks by folder
        const tasksByFolder = {};
        const unfiledTaskList = [];

        allTasks.forEach(function(task) {
          const folderId = getTaskFolder(task.id);
          if (folderId && allFolders.find(f => f.id === folderId)) {
            if (!tasksByFolder[folderId]) tasksByFolder[folderId] = [];
            tasksByFolder[folderId].push(task);
          } else {
            unfiledTaskList.push(task);
          }
        });

        // Render folders (already filtered by agent from server)
        folderList.innerHTML = allFolders.map(function(folder) {
          const folderTasks = tasksByFolder[folder.id] || [];
          const isExpanded = folder.isExpanded !== false;
          return '<div class="folder-item" data-folder-id="' + escapeHtml(folder.id) + '">' +
            '<div class="folder-toggle' + (isExpanded ? ' expanded' : '') + '" data-folder-id="' + escapeHtml(folder.id) + '">' +
            '<span class="folder-icon clickable" data-folder-id="' + escapeHtml(folder.id) + '" style="background:' + folder.color + '20;color:' + folder.color + ';" title="Edit icon & color">' + getFolderIconSvg(folder.icon || 'Folder', folder.color) + '</span>' +
            '<span class="folder-name">' + escapeHtml(folder.name) + '</span>' +
            '<span class="folder-count">' + folderTasks.length + '</span>' +
            '<button class="folder-more-btn" data-folder-id="' + escapeHtml(folder.id) + '" title="More options">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>' +
            '</button>' +
            '<svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>' +
            '<div class="folder-tasks' + (isExpanded ? ' expanded' : '') + '">' +
            folderTasks.map(renderTaskItem).join('') +
            '</div></div>';
        }).join('');

        // Render unfiled tasks
        unfiledTasks.innerHTML = unfiledTaskList.map(renderTaskItem).join('');

        // Add click handlers for tasks
        document.querySelectorAll('.task-item').forEach(function(item) {
          item.addEventListener('click', function(e) {
            if (e.target.closest('.task-item-menu')) return;
            const taskId = item.getAttribute('data-task-id');
            if (taskId) showChatState(taskId);
          });
        });

        // Add context menu handlers
        document.querySelectorAll('.task-item-menu').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const taskId = btn.getAttribute('data-task-id');
            const rect = btn.getBoundingClientRect();
            showContextMenu(rect.right, rect.top, taskId);
          });
        });

        // Add folder toggle handlers
        document.querySelectorAll('.folder-toggle').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            if (e.target.closest('.folder-more-btn') || e.target.closest('.folder-icon.clickable')) return;
            const folderId = btn.getAttribute('data-folder-id');
            toggleFolderExpanded(folderId);
            renderTaskList();
          });
        });

        // Add folder more-button handlers
        document.querySelectorAll('.folder-more-btn').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var folderId = btn.getAttribute('data-folder-id');
            var rect = btn.getBoundingClientRect();
            showFolderContextMenu(rect.right, rect.top, folderId);
          });
        });

        // Add folder icon click handlers (edit icon & color)
        document.querySelectorAll('.folder-icon.clickable').forEach(function(icon) {
          icon.addEventListener('click', function(e) {
            e.stopPropagation();
            var folderId = icon.getAttribute('data-folder-id');
            var folder = allFolders.find(function(f) { return f.id === folderId; });
            if (folder) showFolderModal(folder);
          });
        });
      }

      // ========== MOBILE TASK PANEL RENDERING ==========
      function renderMobileTaskList() {
        if (!mobileTaskList) return;

        var tasksByFolder = {};
        allFolders.forEach(function(f) { tasksByFolder[f.id] = []; });
        var unfiledTaskList = [];
        var sortedTasks = allTasks.slice().sort(function(a, b) {
          return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
        });
        sortedTasks.forEach(function(task) {
          var folderId = getTaskFolder(task.id);
          if (folderId && tasksByFolder[folderId]) {
            tasksByFolder[folderId].push(task);
          } else {
            unfiledTaskList.push(task);
          }
        });

        var html = '';

        // Folders (already filtered by agent from server)
        allFolders.forEach(function(folder) {
          var folderTasks = tasksByFolder[folder.id] || [];
          var isExpanded = folder.isExpanded !== false;
          html += '<div class="folder-item" data-folder-id="' + escapeHtml(folder.id) + '">' +
            '<div class="folder-toggle' + (isExpanded ? ' expanded' : '') + '" data-folder-id="' + escapeHtml(folder.id) + '">' +
            '<span class="folder-icon" style="background:' + folder.color + '20;color:' + folder.color + ';">' + getFolderIconSvg(folder.icon || 'Folder', folder.color) + '</span>' +
            '<span class="folder-name">' + escapeHtml(folder.name) + '</span>' +
            '<span class="folder-count">' + folderTasks.length + '</span>' +
            '<svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>' +
            '<div class="folder-tasks' + (isExpanded ? ' expanded' : '') + '">' +
            folderTasks.map(renderTaskItem).join('') +
            '</div></div>';
        });

        // Unfiled
        if (unfiledTaskList.length > 0) {
          html += '<div class="unfiled-section"><div class="folder-header"><span class="folder-header-title">Unfiled</span></div>';
          html += unfiledTaskList.map(renderTaskItem).join('');
          html += '</div>';
        }

        mobileTaskList.innerHTML = html;

        // Task click and long-press handlers
        mobileTaskList.querySelectorAll('.task-item').forEach(function(item) {
          var longPressTimer = null;
          var didLongPress = false;

          item.addEventListener('touchstart', function(e) {
            didLongPress = false;
            longPressTimer = setTimeout(function() {
              didLongPress = true;
              ignoreContextMenuDismissUntil = Date.now() + 900;
              setMobileContextSelection(item);
              item.classList.add('long-press-active');
              var taskId = item.getAttribute('data-task-id');
              if (taskId) {
                var rect = item.getBoundingClientRect();
                showContextMenu(-9999, -9999, taskId);
                requestAnimationFrame(function() {
                  var menuEl = document.getElementById('contextMenu');
                  if (!menuEl) return;
                  var menuRect = menuEl.getBoundingClientRect();
                  var topPos = rect.top - menuRect.height - 4;
                  if (topPos < 8) topPos = rect.bottom + 4;
                  var leftPos = Math.min(rect.left + 8, window.innerWidth - menuRect.width - 8);
                  if (leftPos < 8) leftPos = 8;
                  menuEl.style.top = topPos + 'px';
                  menuEl.style.left = leftPos + 'px';
                });
              }
            }, 500);
          }, { passive: true });

          item.addEventListener('touchmove', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
          }, { passive: true });

          item.addEventListener('touchend', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (!didLongPress) {
              item.classList.remove('long-press-active');
            }
          });

          item.addEventListener('touchcancel', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            item.classList.remove('long-press-active');
          });

          item.addEventListener('click', function(e) {
            if (didLongPress) {
              e.preventDefault();
              e.stopPropagation();
              didLongPress = false;
              return;
            }
            if (e.target.closest('.task-item-menu')) return;
            var taskId = item.getAttribute('data-task-id');
            if (taskId) {
              hideMobileTaskPanel();
              showChatState(taskId);
            }
          });
        });

        // Folder toggle + long-press handlers
        mobileTaskList.querySelectorAll('.folder-toggle').forEach(function(btn) {
          var longPressTimer = null;
          var didLongPress = false;

          btn.addEventListener('touchstart', function(e) {
            didLongPress = false;
            longPressTimer = setTimeout(function() {
              didLongPress = true;
              ignoreContextMenuDismissUntil = Date.now() + 900;
              setMobileContextSelection(btn);
              btn.classList.add('long-press-active');
              var folderId = btn.getAttribute('data-folder-id');
              if (folderId) {
                var rect = btn.getBoundingClientRect();
                showFolderContextMenu(-9999, -9999, folderId);
                requestAnimationFrame(function() {
                  var menuEl = document.getElementById('contextMenu');
                  if (!menuEl) return;
                  var menuRect = menuEl.getBoundingClientRect();
                  var topPos = rect.top - menuRect.height - 4;
                  if (topPos < 8) topPos = rect.bottom + 4;
                  var leftPos = Math.min(rect.left + 8, window.innerWidth - menuRect.width - 8);
                  if (leftPos < 8) leftPos = 8;
                  menuEl.style.top = topPos + 'px';
                  menuEl.style.left = leftPos + 'px';
                });
              }
            }, 500);
          }, { passive: true });

          btn.addEventListener('touchmove', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
          }, { passive: true });

          btn.addEventListener('touchend', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (!didLongPress) {
              btn.classList.remove('long-press-active');
            }
          });

          btn.addEventListener('touchcancel', function() {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            btn.classList.remove('long-press-active');
          });

          btn.addEventListener('click', function() {
            if (didLongPress) {
              didLongPress = false;
              return;
            }
            var folderId = btn.getAttribute('data-folder-id');
            toggleFolderExpanded(folderId);
            renderMobileTaskList();
          });
        });
      }

      // ========== ACTION BUTTON TOGGLE ==========
      function setActionMode(mode) {
        if (!actionBtn) return;
        actionMode = mode;
        var iconSend = actionBtn.querySelector('.icon-send');
        var iconStop = actionBtn.querySelector('.icon-stop');
        var label = actionBtn.querySelector('.action-label');
        if (mode === 'stop') {
          if (iconSend) iconSend.style.display = 'none';
          if (iconStop) iconStop.style.display = 'block';
          if (label) label.style.display = 'none';
          actionBtn.classList.add('stopping');
          actionBtn.title = 'Stop agent';
          if (followUpInput) {
            followUpInput.disabled = true;
            followUpInput.placeholder = 'Agent is working...';
          }
        } else {
          if (iconSend) iconSend.style.display = 'block';
          if (iconStop) iconStop.style.display = 'none';
          if (label) { label.style.display = 'inline'; label.textContent = 'Send'; }
          actionBtn.classList.remove('stopping');
          actionBtn.title = '';
          if (followUpInput) {
            followUpInput.disabled = false;
            followUpInput.placeholder = 'Give new instructions...';
          }
        }
      }

      function updateScrollBottomButtonVisibility() {
        if (!messagesArea || !scrollBottomBtn) return;
        var distanceFromBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight;
        messagesAreaNearBottom = distanceFromBottom <= 120;
        if (messagesAreaNearBottom) {
          scrollBottomBtn.classList.remove('visible');
        } else {
          scrollBottomBtn.classList.add('visible');
        }
      }

      function scrollMessagesToBottom(behavior) {
        if (!messagesArea) return;
        var shouldSmooth = behavior === 'smooth' && typeof messagesArea.scrollTo === 'function';
        if (shouldSmooth) {
          messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' });
        } else {
          messagesArea.scrollTop = messagesArea.scrollHeight;
        }
        messagesAreaNearBottom = true;
        updateScrollBottomButtonVisibility();
      }

      // ========== MESSAGE RENDERING ==========
      function renderMessages(task) {
        if (!messagesList) return;
        var taskIdKey = String(task.id || 'unknown');
        var expandedMap = expandedToolMessagesByTask[taskIdKey] || (expandedToolMessagesByTask[taskIdKey] = {});
        var copyPayloadById = {};
        var savePayloadById = {};
        var wasNearBottom = messagesAreaNearBottom;
        var taskChanged = false;
        if (messagesArea) {
          var distanceFromBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight;
          wasNearBottom = distanceFromBottom <= 120;
          messagesAreaNearBottom = wasNearBottom;
          taskChanged = messagesArea.getAttribute('data-rendered-task-id') !== String(task.id || '');
        }
        var msgs = (task.messages || []).filter(function(m) {
          if (!m || !m.content) return false;
          // Filter out tool_call status messages ("Using tool: X") - the thinking indicator covers this
          if (m.type === 'tool' && m.toolName && m.toolName !== 'tool_result' && m.content.indexOf('Using tool:') === 0) return false;
          return true;
        });

        var html = msgs.map(function(msg, idx) {
          var time = formatTime(msg.timestamp);
          var expandableId = 'expand_' + (msg.id || ((msg.timestamp || idx) + '_' + (msg.toolName || 'tool')));
          var copyId = 'copy_' + String(msg.id || msg.timestamp || idx) + '_' + String(idx);
          var saveId = 'save_' + String(msg.id || msg.timestamp || idx) + '_' + String(idx);
          copyPayloadById[copyId] = String(msg.content || '');
          savePayloadById[saveId] = String(msg.content || '');
          if (msg.type === 'user') {
            return '<div class="message user">' +
              '<div class="message-bubble">' +
              '<div class="message-content">' + renderMarkdown(msg.content) + '</div>' +
              '<div class="message-footer-row">' +
              '<div class="message-user-actions">' +
              renderSavePromptButton(saveId) +
              renderInlineCopyButton(copyId) +
              '</div>' +
              (time ? '<div class="message-time">' + escapeHtml(time) + '</div>' : '') +
              '</div>' +
              '</div></div>';
          }
          if (msg.type === 'assistant') {
            return '<div class="message assistant">' +
              '<div class="message-bubble">' +
              '<div class="message-content">' + renderMarkdown(msg.content) + '</div>' +
              '<div class="message-footer-row">' +
              renderCopyButton(copyId) +
              (time ? '<div class="message-time">' + escapeHtml(time) + '</div>' : '') +
              '</div>' +
              '</div></div>';
          }
          if (msg.type === 'tool') {
            var toolIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
            var toolName = msg.toolName || 'tool';
            var isError = msg.content && msg.content.toLowerCase().indexOf('error') >= 0;
            var output = escapeHtml(msg.content || '');
            var toolNeedsExpand = (msg.content || '').length > 260;
            var toolExpanded = !!expandedMap[expandableId];
            return '<div class="message tool">' +
              '<div class="message-bubble">' +
              renderCopyButton(copyId) +
              '<div class="tool-label">' + toolIcon + ' ' + escapeHtml(toolName) + '</div>' +
              '<div class="tool-output' + (isError ? ' error' : '') + (toolNeedsExpand ? (' message-expandable' + (toolExpanded ? '' : ' is-collapsed')) : '') + '"' + (toolNeedsExpand ? ' data-expandable-id="' + escapeHtml(expandableId) + '"' : '') + '>' + output + '</div>' +
              (toolNeedsExpand ? '<button class="message-expand-toggle" data-toggle-expand="' + escapeHtml(expandableId) + '" data-label-more="Show full message" data-label-less="Show less">' + (toolExpanded ? 'Show less' : 'Show full message') + '</button>' : '') +
              '</div></div>';
          }
          return '';
        }).join('');

        // Append thinking indicator inline when task is running
        var isRunning = task.status === 'running' || task.status === 'queued';
        if (isRunning) {
          var lastToolMsg = null;
          var allMsgs = task.messages || [];
          for (var i = allMsgs.length - 1; i >= 0; i--) {
            if (allMsgs[i].type === 'tool' && allMsgs[i].toolName && allMsgs[i].toolName !== 'tool_result') {
              lastToolMsg = allMsgs[i];
              break;
            }
          }
          var thinkingText = lastToolMsg ? 'Using ' + escapeHtml(lastToolMsg.toolName) + '...' : 'Thinking...';
          html += '<div class="thinking-indicator visible">' +
            '<span class="typing-dots"><span></span><span></span><span></span></span>' +
            '<span>' + thinkingText + '</span></div>';
        }

        messagesList.innerHTML = html;

        messagesList.querySelectorAll('[data-toggle-expand]').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var targetId = btn.getAttribute('data-toggle-expand');
            if (!targetId) return;
            var expandable = null;
            messagesList.querySelectorAll('[data-expandable-id]').forEach(function(el) {
              if (!expandable && el.getAttribute('data-expandable-id') === targetId) {
                expandable = el;
              }
            });
            if (!expandable) return;
            var isCollapsed = expandable.classList.contains('is-collapsed');
            if (isCollapsed) {
              expandable.classList.remove('is-collapsed');
              btn.textContent = btn.getAttribute('data-label-less') || 'Show less';
              expandedMap[targetId] = true;
            } else {
              expandable.classList.add('is-collapsed');
              btn.textContent = btn.getAttribute('data-label-more') || 'Show full message';
              delete expandedMap[targetId];
            }
            expandedToolMessagesByTask[taskIdKey] = expandedMap;
          });
        });

        messagesList.querySelectorAll('[data-copy-message-id]').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var copyId = String(btn.getAttribute('data-copy-message-id') || '').trim();
            var payload = copyPayloadById[copyId];
            if (typeof payload !== 'string') return;
            copyTextToClipboard(payload).then(function(success) {
              if (!success) return;
              var checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
                '<polyline points="20 6 9 17 4 12"></polyline>' +
              '</svg>';
              var originalTitle = btn.getAttribute('title') || 'Copy message text';
              var originalIcon = btn.getAttribute('data-original-icon') || btn.innerHTML;
              btn.setAttribute('data-original-icon', originalIcon);
              btn.classList.add('copied');
              btn.setAttribute('title', 'Copied');
              btn.innerHTML = checkIcon;
              setTimeout(function() {
                btn.classList.remove('copied');
                btn.setAttribute('title', originalTitle);
                btn.innerHTML = originalIcon;
              }, 1200);
            });
          });
        });

        messagesList.querySelectorAll('[data-save-prompt-id]').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var saveId = String(btn.getAttribute('data-save-prompt-id') || '').trim();
            var payload = savePayloadById[saveId];
            if (typeof payload !== 'string' || !payload.trim()) return;
            showSavePromptModal(payload, btn);
          });
        });

        if (messagesArea && (taskChanged || wasNearBottom)) {
          scrollMessagesToBottom(taskChanged ? 'auto' : 'smooth');
        }
        if (messagesArea) {
          messagesArea.setAttribute('data-rendered-task-id', String(task.id || ''));
        }
        updateScrollBottomButtonVisibility();
      }

      async function loadTaskMessages(taskId) {
        const task = allTasks.find(function(t) { return t.id === taskId; });
        if (!task) return;

        if (chatTitle) chatTitle.textContent = getTaskTitle(task);
        updateTaskHeaderBadges(task);

        selectedSessionId = task.sessionId || null;
        renderMessages(task);

        // Toggle action button between send/stop based on task status
        var isRunning = task.status === 'running' || task.status === 'queued';
        setActionMode(isRunning ? 'stop' : 'send');

        // Show error/status message for terminal states
        if (task.status === 'failed') {
          var hasAssistantMsg = (task.messages || []).some(function(m) { return m.type === 'assistant' && m.content; });
          if (!hasAssistantMsg && messagesList) {
            messagesList.innerHTML += '<div class="message error"><div class="message-bubble">Task failed. The AI may have encountered an error. Check your API key and try again.</div></div>';
          }
        }
        if (task.status === 'interrupted') {
          if (messagesList) {
            messagesList.innerHTML += '<div class="message error"><div class="message-bubble" style="background:#fefce8;border-color:#fde68a;color:#854d0e;">Task was interrupted.</div></div>';
          }
        }
        updateScrollBottomButtonVisibility();
      }

      // ========== TASK LOADING ==========
      async function loadTasks() {
        try {
          const tasks = await requestJson('/tasks', { method: 'GET' });
          allTasks = tasks;
          renderTaskList();
          renderMobileTaskList();

          if (selectedTaskId) {
            const task = allTasks.find(function(t) { return t.id === selectedTaskId; });
            if (task) {
              selectedSessionId = task.sessionId || null;
              loadTaskMessages(selectedTaskId);
            }
          }
        } catch (err) {
          if (String(err && err.message) === 'unauthorized') return;
          console.warn('Failed to load tasks', err);
        }
      }

      async function loadAgents() {
        try {
          const res = await requestJson('/agents', { method: 'GET' });
          const agents = Array.isArray(res?.agents) ? res.agents : [];
          const defaultId = res?.defaultAgentId || '';
          var activeId = res?.activeAgentId || defaultId;
          cachedAgents = agents;
          cachedDefaultAgentId = defaultId;
          cachedGlobalSelectedModel = res?.selectedModel || null;
          if (agentSelect) {
            agentSelect.innerHTML = agents.map(agent => (
              '<option value="' + agent.id + '">' + (agent.name || agent.id) + '</option>'
            )).join('');
            if (activeId) agentSelect.value = activeId;
          }
          if (agents.length > 0) {
            var activeAgent = agents.find(a => a.id === activeId) || agents.find(a => a.id === defaultId) || agents[0];
            var displayName = activeAgent.name || activeAgent.id;
            var roleLabel = activeAgent.roleName || activeAgent.id;
            if (agentName) agentName.textContent = displayName;
            if (agentIdDisplay) agentIdDisplay.textContent = roleLabel;
            updateAgentAvatarEl(agentAvatar, activeAgent);
            // Sync mobile agent switcher
            if (mobileAgentName) mobileAgentName.textContent = displayName;
            if (mobileAgentId) mobileAgentId.textContent = roleLabel;
            updateAgentAvatarEl(mobileAgentAvatar, activeAgent);
            updateAgentAvatarEl(mobileConnectedAgentAvatar, activeAgent);
          }
          updateInitialHeaderBadges();
          if (selectedTaskId) {
            var selectedTask = allTasks.find(function(t) { return t.id === selectedTaskId; });
            if (selectedTask) {
              updateTaskHeaderBadges(selectedTask);
            }
          }
          scheduleContextEstimate('initial', true);
          if (selectedTaskId) {
            scheduleContextEstimate('follow', true);
          }
        } catch (err) {
          if (String(err && err.message) === 'unauthorized') return;
          console.warn('Failed to load agents', err);
        }
      }

      function getComposerState(target) {
        return target === 'follow' ? followComposerState : initialComposerState;
      }

      function getComposerInput(target) {
        return target === 'follow' ? followUpInput : promptEl;
      }

      function applyInitialPromptPlaceholderForViewport() {
        if (!promptEl) return;
        var isMobileViewport = Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
        promptEl.placeholder = isMobileViewport ? 'Type your task....' : 'Type your task here...';
      }

      function getComposerInputWrap(target) {
        return target === 'follow' ? followInputFieldWrap : initialInputFieldWrap;
      }

      function updateInlineVoiceVisibility(target) {
        var input = getComposerInput(target);
        var wrap = getComposerInputWrap(target);
        if (!input || !wrap) return;
        var hasText = String(input.value || '').length > 0;
        wrap.classList.toggle('has-text', hasText);
      }

      function syncContextIndicatorPlacement() {
        var isMobileViewport = Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
        var initialIndicatorRow = initialContextIndicator && initialContextIndicator.parentElement
          ? initialContextIndicator.parentElement
          : null;
        var followIndicatorRow = followContextIndicator && followContextIndicator.parentElement
          ? followContextIndicator.parentElement
          : null;
        if (initialIndicatorRow && initialMobileCompactActions && initialComposerBottomRow) {
          var initialTarget = isMobileViewport ? initialMobileCompactActions : initialComposerBottomRow;
          if (initialIndicatorRow.parentElement !== initialTarget) {
            initialTarget.appendChild(initialIndicatorRow);
          }
        }
        if (followIndicatorRow && followMobileCompactActions && followComposerBottomRow) {
          var followTarget = isMobileViewport ? followMobileCompactActions : followComposerBottomRow;
          if (followIndicatorRow.parentElement !== followTarget) {
            followTarget.appendChild(followIndicatorRow);
          }
        }
      }

      function getComposerMetaEl(target) {
        return target === 'follow' ? followComposerMeta : initialComposerMeta;
      }

      function getContextIndicatorEl(target) {
        return target === 'follow' ? followContextIndicator : initialContextIndicator;
      }

      function formatContextCountValue(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '0';
        var rounded = Math.max(0, Math.round(n));
        return rounded.toLocaleString();
      }

      function classifyContextIndicatorClass(usedPct) {
        var pct = Number(usedPct) * 100;
        if (pct >= 85) return 'context-red';
        if (pct >= 70) return 'context-yellow';
        return 'context-green';
      }

      function getContextStatsForTarget(target) {
        var kind = target === 'follow' ? 'follow' : 'initial';
        var indicatorEl = getContextIndicatorEl(kind);
        if (indicatorEl && indicatorEl._contextStats && typeof indicatorEl._contextStats === 'object') {
          return indicatorEl._contextStats;
        }
        return contextEstimateLastStats[kind] || null;
      }

      function ensureContextInfoPopover() {
        if (contextInfoPopover && document.body && document.body.contains(contextInfoPopover)) {
          return contextInfoPopover;
        }
        var popover = document.createElement('div');
        popover.id = 'contextInfoPopover';
        popover.className = 'context-info-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Context window details');
        popover.style.display = 'none';
        popover.addEventListener('click', function(e) {
          e.stopPropagation();
        });
        document.body.appendChild(popover);
        contextInfoPopover = popover;
        return popover;
      }

      function hideContextInfoPopover() {
        if (contextInfoAnchor && contextInfoAnchor.classList) {
          contextInfoAnchor.classList.remove('active');
        }
        contextInfoAnchor = null;
        contextInfoTarget = '';
        if (!contextInfoPopover) return;
        contextInfoPopover.classList.remove('visible');
        contextInfoPopover.style.display = 'none';
      }

      function getContextInfoPopoverHtml(stats) {
        var estimate = (stats && stats.estimate) || {};
        var breakdown = estimate.breakdown || {};
        var html =
          '<div class="context-info-popover-text">Includes system prompt, tools, retrieved docs, and message history included in this request.</div>';
        if (stats && stats.trimmed) {
          html +=
            '<div class="context-info-popover-trimmed">Trimmed ' + formatContextCountValue(stats.droppedMessages || 0) +
            ' older message(s)' + (stats.summaryInserted ? ' and inserted a summary.' : '.') + '</div>';
        }
        html += '<div class="context-info-popover-breakdown">' +
          '<div class="context-info-popover-row"><span class="context-info-popover-label">system</span><span class="context-info-popover-value">' + formatContextCountValue(breakdown.system) + '</span></div>' +
          '<div class="context-info-popover-row"><span class="context-info-popover-label">tools</span><span class="context-info-popover-value">' + formatContextCountValue(breakdown.tools) + '</span></div>' +
          '<div class="context-info-popover-row"><span class="context-info-popover-label">retrieved</span><span class="context-info-popover-value">' + formatContextCountValue(breakdown.retrieved) + '</span></div>' +
          '<div class="context-info-popover-row"><span class="context-info-popover-label">history</span><span class="context-info-popover-value">' + formatContextCountValue(breakdown.history) + '</span></div>' +
          '<div class="context-info-popover-row"><span class="context-info-popover-label">new message</span><span class="context-info-popover-value">' + formatContextCountValue(breakdown.newMessage) + '</span></div>' +
        '</div>' +
        '<div class="context-info-popover-source">' + (estimate.estimated ? 'Estimated counts' : 'Exact counts') + '</div>';
        return html;
      }

      function positionContextInfoPopover(anchorEl, popoverEl) {
        if (!anchorEl || !popoverEl) return;
        var anchorRect = anchorEl.getBoundingClientRect();
        var popRect = popoverEl.getBoundingClientRect();
        var gap = 8;
        var left = anchorRect.left + (anchorRect.width / 2) - (popRect.width / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
        var top = anchorRect.bottom + gap;
        if (top + popRect.height > window.innerHeight - 8) {
          top = anchorRect.top - popRect.height - gap;
        }
        if (top < 8) {
          top = Math.max(8, window.innerHeight - popRect.height - 8);
        }
        popoverEl.style.left = left + 'px';
        popoverEl.style.top = top + 'px';
      }

      function toggleContextInfoPopover(anchorEl, target) {
        var kind = target === 'follow' ? 'follow' : 'initial';
        var stats = getContextStatsForTarget(kind);
        if (!stats || typeof stats !== 'object' || !stats.estimate || !stats.context) {
          hideContextInfoPopover();
          return;
        }
        var popoverEl = ensureContextInfoPopover();
        if (contextInfoPopover && contextInfoPopover.classList.contains('visible') && contextInfoAnchor === anchorEl) {
          hideContextInfoPopover();
          return;
        }
        if (contextInfoAnchor && contextInfoAnchor.classList) {
          contextInfoAnchor.classList.remove('active');
        }
        contextInfoAnchor = anchorEl;
        contextInfoTarget = kind;
        contextInfoAnchor.classList.add('active');
        popoverEl.innerHTML = getContextInfoPopoverHtml(stats);
        popoverEl.style.display = 'block';
        popoverEl.classList.add('visible');
        positionContextInfoPopover(anchorEl, popoverEl);
      }

      function renderContextIndicator(target, stats) {
        var kind = target === 'follow' ? 'follow' : 'initial';
        var el = getContextIndicatorEl(kind);
        if (!el) return;
        if (!stats || typeof stats !== 'object' || !stats.estimate || !stats.context) {
          el._contextStats = null;
          if (contextInfoTarget === kind) {
            hideContextInfoPopover();
          }
          el.style.display = 'none';
          el.textContent = '';
          el.removeAttribute('title');
          el.classList.remove('context-green', 'context-yellow', 'context-red');
          return;
        }
        el._contextStats = stats;
        var estimate = stats.estimate || {};
        var context = stats.context || {};
        var usedPct = Number(context.usedPct);
        if (!Number.isFinite(usedPct)) usedPct = 0;
        var safeRemaining = Math.max(0, Math.floor(Number(context.safeRemainingForReply) || 0));
        var pctValue = Math.max(0, Math.round(usedPct * 100));
        var colorClass = classifyContextIndicatorClass(usedPct);
        el.classList.remove('context-green', 'context-yellow', 'context-red');
        el.classList.add(colorClass);
        el.innerHTML =
          '<span>Context: ' + formatContextCountValue(estimate.promptTokensEst) + ' / ' + formatContextCountValue(context.contextLimitTokens) + ' (' + pctValue + '%)</span>' +
          '<span class="context-indicator-sep">•</span>' +
          '<span class="context-indicator-detail">Room for reply: ~' + formatContextCountValue(safeRemaining) + ' tokens</span>' +
          '<button type="button" class="context-indicator-info-btn" data-context-info-target="' + kind + '" aria-label="Context window details" title="Context window details">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><circle cx="12" cy="7" r="1"></circle></svg>' +
          '</button>';
        var detail = 'Includes system prompt, tools, retrieved docs, and message history included in this request.';
        if (stats.trimmed) {
          detail += ' Trimmed ' + formatContextCountValue(stats.droppedMessages || 0) + ' older message(s)';
          detail += stats.summaryInserted ? ' and inserted a summary.' : '.';
        }
        el.title = detail;
        el.style.display = 'inline-flex';
        if (contextInfoTarget === kind && contextInfoAnchor && document.body.contains(contextInfoAnchor)) {
          var refreshedPopover = ensureContextInfoPopover();
          refreshedPopover.innerHTML = getContextInfoPopoverHtml(stats);
          refreshedPopover.style.display = 'block';
          refreshedPopover.classList.add('visible');
          positionContextInfoPopover(contextInfoAnchor, refreshedPopover);
        } else if (contextInfoTarget === kind) {
          hideContextInfoPopover();
        }
      }

      function getComposerContextEstimatePayload(target) {
        var kind = target === 'follow' ? 'follow' : 'initial';
        var input = getComposerInput(kind);
        var state = getComposerState(kind);
        var prompt = input ? String(input.value || '') : '';
        if (prompt.length > 8000) {
          prompt = prompt.slice(0, 8000);
        }
        var payload = { prompt: prompt };
        if (kind === 'follow' && selectedTaskId) {
          payload.taskId = selectedTaskId;
        }
        var resolvedAgentId = '';
        if (kind === 'follow' && selectedTaskId) {
          var selectedTask = allTasks.find(function(task) { return task.id === selectedTaskId; });
          if (selectedTask && selectedTask.agentId) {
            resolvedAgentId = String(selectedTask.agentId || '').trim();
          }
        }
        if (!resolvedAgentId && agentSelect && agentSelect.value) {
          resolvedAgentId = String(agentSelect.value || '').trim();
        }
        if (resolvedAgentId) {
          payload.agentId = resolvedAgentId;
        }
        var attachedFiles = (state.attachedFiles || [])
          .map(function(file) { return String((file && file.path) || '').trim(); })
          .filter(Boolean);
        if (attachedFiles.length > 0) {
          payload.attachedFiles = attachedFiles;
        }
        return payload;
      }

      function getComposerContextEstimateKey(payload) {
        var taskId = String(payload.taskId || '');
        var agentId = String(payload.agentId || '');
        var prompt = String(payload.prompt || '');
        var attachedFiles = Array.isArray(payload.attachedFiles) ? payload.attachedFiles.join('|') : '';
        return taskId + '::' + agentId + '::' + prompt + '::' + attachedFiles;
      }

      async function refreshContextEstimate(target) {
        var kind = target === 'follow' ? 'follow' : 'initial';
        var payload = getComposerContextEstimatePayload(kind);
        var cacheKey = getComposerContextEstimateKey(payload);
        var cachedStats = contextEstimateLastStats[kind];
        if (cacheKey === contextEstimateLastKey[kind] && cachedStats) {
          renderContextIndicator(kind, cachedStats);
          return;
        }
        var seq = (contextEstimateSeq[kind] || 0) + 1;
        contextEstimateSeq[kind] = seq;
        try {
          var response = await requestJson('/context/estimate', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          if (contextEstimateSeq[kind] !== seq) return;
          var stats = response && response.stats ? response.stats : response;
          contextEstimateLastKey[kind] = cacheKey;
          contextEstimateLastStats[kind] = stats || null;
          renderContextIndicator(kind, stats || null);
        } catch (err) {
          if (contextEstimateSeq[kind] !== seq) return;
          if (String(err && err.message) === 'unauthorized') return;
          contextEstimateLastKey[kind] = '';
          contextEstimateLastStats[kind] = null;
          renderContextIndicator(kind, null);
        }
      }

      function scheduleContextEstimate(target, immediate) {
        if (!contextEstimateEnabled) return;
        var kind = target === 'follow' ? 'follow' : 'initial';
        var timer = contextEstimateTimers[kind];
        if (timer) {
          clearTimeout(timer);
          contextEstimateTimers[kind] = null;
        }
        var delay = immediate ? 0 : 250;
        contextEstimateTimers[kind] = setTimeout(function() {
          contextEstimateTimers[kind] = null;
          void refreshContextEstimate(kind);
        }, delay);
      }

      function getSavedPromptCountEl(target) {
        return target === 'follow' ? followSavedPromptCount : initialSavedPromptCount;
      }

      function sanitizeSavedPrompts(input) {
        if (!Array.isArray(input)) return [];
        var records = input
          .map(function(item) {
            var record = item && typeof item === 'object' ? item : {};
            var id = String(record.id || '').trim();
            var title = String(record.title || '').trim();
            var content = String(record.content || '').trim();
            if (!content) return null;
            var createdAtRaw = String(record.createdAt || '').trim();
            var updatedAtRaw = String(record.updatedAt || '').trim();
            var nowIso = new Date().toISOString();
            return {
              id: id || ('sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
              title: title || content.slice(0, 64),
              content: content,
              createdAt: createdAtRaw || nowIso,
              updatedAt: updatedAtRaw || nowIso,
            };
          })
          .filter(function(item) { return Boolean(item); });
        records.sort(function(a, b) {
          var aTime = new Date(a.updatedAt).getTime();
          var bTime = new Date(b.updatedAt).getTime();
          var safeA = Number.isFinite(aTime) ? aTime : 0;
          var safeB = Number.isFinite(bTime) ? bTime : 0;
          return safeB - safeA;
        });
        return records.slice(0, 200);
      }

      async function syncSavedPromptsFromServer() {
        var response = await requestJson('/saved-prompts', { method: 'GET' });
        var records = Array.isArray(response && response.prompts) ? response.prompts : [];
        savedPrompts = sanitizeSavedPrompts(records);
      }

      function loadSavedPrompts() {
        try {
          var raw = localStorage.getItem(SAVED_PROMPTS_STORAGE_KEY);
          savedPrompts = raw ? sanitizeSavedPrompts(JSON.parse(raw)) : [];
        } catch {
          savedPrompts = [];
        }
        void (async function() {
          try {
            await syncSavedPromptsFromServer();
            saveSavedPrompts();
            renderAllSavedPromptCounts();
            if (savedPromptSelectModal && savedPromptSelectModal.classList.contains('visible')) {
              renderSavedPromptSelectList();
            }
            if (savedPromptManageModal && savedPromptManageModal.classList.contains('visible')) {
              renderSavedPromptManageList();
            }
          } catch {
            // Fallback to local cache if shared store is temporarily unavailable.
          }
        })();
      }

      function saveSavedPrompts() {
        try {
          localStorage.setItem(SAVED_PROMPTS_STORAGE_KEY, JSON.stringify(savedPrompts));
        } catch {}
      }

      function renderSavedPromptCount(target) {
        var el = getSavedPromptCountEl(target);
        if (!el) return;
        el.textContent = String(savedPrompts.length);
      }

      function renderAllSavedPromptCounts() {
        renderSavedPromptCount('initial');
        renderSavedPromptCount('follow');
        if (mobileComposerUsePromptCount) {
          mobileComposerUsePromptCount.textContent = String(savedPrompts.length);
        }
      }

      async function upsertSavedPromptOnServer(prompt) {
        if (!prompt || typeof prompt !== 'object') return null;
        var payload = {
          id: String(prompt.id || '').trim() || undefined,
          title: String(prompt.title || '').trim(),
          content: String(prompt.content || '').trim(),
          createdAt: String(prompt.createdAt || '').trim() || undefined,
          updatedAt: String(prompt.updatedAt || '').trim() || undefined,
        };
        if (!payload.title || !payload.content) return null;
        var response = await requestJson('/saved-prompts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        var record = response && response.prompt ? response.prompt : null;
        if (!record) return null;
        return sanitizeSavedPrompts([record])[0] || null;
      }

      async function deleteSavedPromptOnServer(promptId) {
        var id = String(promptId || '').trim();
        if (!id) return;
        var response = await requestJson('/saved-prompts/' + encodeURIComponent(id), { method: 'DELETE' });
        var ok = Boolean(response && response.ok);
        if (!ok) {
          throw new Error('Saved prompt delete was not acknowledged by shared store');
        }
      }

      function setSavePromptError(message) {
        if (!savePromptError) return;
        var text = String(message || '').trim();
        if (!text) {
          savePromptError.textContent = '';
          savePromptError.classList.remove('visible');
          return;
        }
        savePromptError.textContent = text;
        savePromptError.classList.add('visible');
      }

      function showSavePromptModal(content, sourceButton) {
        pendingMessagePromptToSave = String(content || '');
        pendingSavePromptButton = sourceButton || null;
        setSavePromptError('');
        if (savePromptTitleInput) savePromptTitleInput.value = '';
        if (savePromptPreview) savePromptPreview.textContent = pendingMessagePromptToSave;
        if (savePromptModal) savePromptModal.classList.add('visible');
        if (savePromptTitleInput) {
          setTimeout(function() {
            try { savePromptTitleInput.focus(); } catch {}
          }, 40);
        }
      }

      function hideSavePromptModal() {
        if (savePromptModal) savePromptModal.classList.remove('visible');
        pendingMessagePromptToSave = '';
        pendingSavePromptButton = null;
        setSavePromptError('');
      }

      async function confirmSavePromptFromMessage() {
        var content = String(pendingMessagePromptToSave || '').trim();
        var title = savePromptTitleInput ? String(savePromptTitleInput.value || '').trim() : '';
        if (!content) {
          setSavePromptError('Prompt content is empty.');
          return;
        }
        if (!title) {
          setSavePromptError('Enter a title for this prompt.');
          return;
        }
        setSavePromptError('');
        var nowIso = new Date().toISOString();
        var pendingRecord = {
          id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          title: title,
          content: content,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        var nextRecord = pendingRecord;
        try {
          var persisted = await upsertSavedPromptOnServer(pendingRecord);
          if (persisted) nextRecord = persisted;
        } catch {
          // Keep local fallback when shared store temporarily fails.
        }
        var replaced = false;
        savedPrompts = savedPrompts.map(function(prompt) {
          if (prompt.id === nextRecord.id) {
            replaced = true;
            return nextRecord;
          }
          return prompt;
        });
        if (!replaced) {
          savedPrompts.push(nextRecord);
        }
        savedPrompts = sanitizeSavedPrompts(savedPrompts);
        saveSavedPrompts();
        renderAllSavedPromptCounts();
        if (savedPromptSelectModal && savedPromptSelectModal.classList.contains('visible')) {
          renderSavedPromptSelectList();
        }
        if (savedPromptManageModal && savedPromptManageModal.classList.contains('visible')) {
          renderSavedPromptManageList();
        }
        if (pendingSavePromptButton) {
          var btn = pendingSavePromptButton;
          btn.classList.add('saved');
          btn.setAttribute('title', 'Saved!');
          setTimeout(function() {
            btn.classList.remove('saved');
            btn.setAttribute('title', 'Save this prompt');
          }, 1400);
        }
        hideSavePromptModal();
      }

      function renderComposerMeta(target) {
        var el = getComposerMetaEl(target);
        if (!el) return;
        var state = getComposerState(target);
        var html = '';
        if (state.workingDirectory) {
          html += '<span class="composer-chip"><strong>Folder:</strong> ' + escapeHtml(state.workingDirectory) +
            ' <button type="button" data-clear-folder="' + target + '" title="Clear working folder">×</button></span>';
        }
        (state.attachedFiles || []).forEach(function(file, index) {
          var name = String((file && file.name) || '').trim() || pathBasename((file && file.path) || ('file-' + (index + 1)));
          html += '<span class="composer-chip file">' + escapeHtml(name) +
            ' <button type="button" data-remove-file="' + target + ':' + index + '" title="Remove file">×</button></span>';
        });
        el.innerHTML = html;
        el.querySelectorAll('button[data-clear-folder]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var t = btn.getAttribute('data-clear-folder') === 'follow' ? 'follow' : 'initial';
            getComposerState(t).workingDirectory = '';
            renderComposerMeta(t);
          });
        });
        el.querySelectorAll('button[data-remove-file]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var value = String(btn.getAttribute('data-remove-file') || '');
            var parts = value.split(':');
            var t = parts[0] === 'follow' ? 'follow' : 'initial';
            var idx = Number(parts[1]);
            if (!Number.isFinite(idx)) return;
            var state = getComposerState(t);
            state.attachedFiles = state.attachedFiles.filter(function(_, i) { return i !== idx; });
            renderComposerMeta(t);
          });
        });
        scheduleContextEstimate(target);
      }

      function renderComposerButtons() {
        function setButtonLabel(button, text) {
          if (!button) return;
          var labelEl = button.querySelector('.composer-label');
          if (labelEl) {
            labelEl.textContent = text;
            return;
          }
          button.textContent = text;
        }

        if (initialIncognitoBtn) {
          initialIncognitoBtn.classList.toggle('active-incognito', initialComposerState.privacyMode === 'incognito');
          setButtonLabel(initialIncognitoBtn, initialComposerState.privacyMode === 'incognito' ? 'Incognito on' : 'Incognito');
        }
        if (followIncognitoBtn) {
          followIncognitoBtn.classList.toggle('active-incognito', followComposerState.privacyMode === 'incognito');
          setButtonLabel(followIncognitoBtn, followComposerState.privacyMode === 'incognito' ? 'Incognito on' : 'Incognito');
        }
        if (initialVoiceWakeBtn) {
          initialVoiceWakeBtn.classList.toggle('active-voice', voiceWakeEnabled || browserVoiceActive);
          if (!browserVoiceSupported) {
            setButtonLabel(initialVoiceWakeBtn, 'Voice wake: N/A');
            initialVoiceWakeBtn.title = 'Speech recognition is not supported in this browser.';
            initialVoiceWakeBtn.disabled = true;
          } else {
            setButtonLabel(initialVoiceWakeBtn, voiceWakeBusy
              ? 'Voice wake: ...'
              : browserVoiceActive
                ? 'Voice wake: Listening'
                : ('Voice wake: ' + (voiceWakeEnabled ? 'On' : 'Off')));
            initialVoiceWakeBtn.title = browserVoiceInterim
              ? ('Hearing: "' + browserVoiceInterim + '"')
              : (voiceWakeEnabled ? 'Click to turn off voice wake' : 'Click to turn on voice wake');
            initialVoiceWakeBtn.disabled = voiceWakeBusy;
          }
        }
        if (initialInlineVoiceWakeBtn) {
          initialInlineVoiceWakeBtn.classList.toggle('active-voice', voiceWakeEnabled || browserVoiceActive);
          if (!browserVoiceSupported) {
            initialInlineVoiceWakeBtn.title = 'Voice wake unavailable on this browser';
            initialInlineVoiceWakeBtn.disabled = true;
          } else {
            initialInlineVoiceWakeBtn.title = browserVoiceInterim
              ? ('Hearing: "' + browserVoiceInterim + '"')
              : (browserVoiceActive ? 'Voice wake listening' : 'Toggle voice wake');
            initialInlineVoiceWakeBtn.disabled = voiceWakeBusy;
          }
        }
        if (followVoiceWakeBtn) {
          followVoiceWakeBtn.classList.toggle('active-voice', voiceWakeEnabled || browserVoiceActive);
          if (!browserVoiceSupported) {
            setButtonLabel(followVoiceWakeBtn, 'Voice wake: N/A');
            followVoiceWakeBtn.title = 'Speech recognition is not supported in this browser.';
            followVoiceWakeBtn.disabled = true;
          } else {
            setButtonLabel(followVoiceWakeBtn, voiceWakeBusy
              ? 'Voice wake: ...'
              : browserVoiceActive
                ? 'Voice wake: Listening'
                : ('Voice wake: ' + (voiceWakeEnabled ? 'On' : 'Off')));
            followVoiceWakeBtn.title = browserVoiceInterim
              ? ('Hearing: "' + browserVoiceInterim + '"')
              : (voiceWakeEnabled ? 'Click to turn off voice wake' : 'Click to turn on voice wake');
            followVoiceWakeBtn.disabled = voiceWakeBusy;
          }
        }
        if (followInlineVoiceWakeBtn) {
          followInlineVoiceWakeBtn.classList.toggle('active-voice', voiceWakeEnabled || browserVoiceActive);
          if (!browserVoiceSupported) {
            followInlineVoiceWakeBtn.title = 'Voice wake unavailable on this browser';
            followInlineVoiceWakeBtn.disabled = true;
          } else {
            followInlineVoiceWakeBtn.title = browserVoiceInterim
              ? ('Hearing: "' + browserVoiceInterim + '"')
              : (browserVoiceActive ? 'Voice wake listening' : 'Toggle voice wake');
            followInlineVoiceWakeBtn.disabled = voiceWakeBusy;
          }
        }
        if (initialMobileMoreBtn) {
          initialMobileMoreBtn.classList.toggle('active-incognito', initialComposerState.privacyMode === 'incognito');
        }
        if (followMobileMoreBtn) {
          followMobileMoreBtn.classList.toggle('active-incognito', followComposerState.privacyMode === 'incognito');
        }
        renderAllSavedPromptCounts();
      }

      function showMobileComposerOptions(target) {
        mobileComposerOptionsTarget = target === 'follow' ? 'follow' : 'initial';
        if (mobileComposerOptionsTitle) {
          mobileComposerOptionsTitle.textContent = mobileComposerOptionsTarget === 'follow'
            ? 'Follow-up options'
            : 'New task options';
        }
        if (mobileComposerIncognitoLabel) {
          var state = getComposerState(mobileComposerOptionsTarget);
          mobileComposerIncognitoLabel.textContent = state.privacyMode === 'incognito' ? 'Incognito: On' : 'Incognito: Off';
        }
        if (mobileComposerOptionsModal) mobileComposerOptionsModal.classList.add('visible');
      }

      function hideMobileComposerOptions() {
        if (mobileComposerOptionsModal) mobileComposerOptionsModal.classList.remove('visible');
      }

      function renderComposerUi(target) {
        renderComposerMeta(target);
        renderComposerButtons();
      }

      function renderAllComposerUi() {
        renderComposerMeta('initial');
        renderComposerMeta('follow');
        renderComposerButtons();
        updateInlineVoiceVisibility('initial');
        updateInlineVoiceVisibility('follow');
      }

      function pathBasename(filePath) {
        var normalized = String(filePath || '').replace(/\\\\/g, '/');
        var parts = normalized.split('/');
        return parts[parts.length - 1] || normalized || 'file';
      }

      function setComposerPromptValue(target, value) {
        var input = getComposerInput(target);
        if (!input) return;
        input.value = value;
        updateInlineVoiceVisibility(target);
        autoResizeTextarea(input, target);
        scheduleContextEstimate(target, true);
        input.focus();
      }

      function getFilteredSavedPromptSelection() {
        var query = String(savedPromptSelectQuery || '').trim().toLowerCase();
        if (!query) return savedPrompts.slice();
        return savedPrompts.filter(function(prompt) {
          return String(prompt.title || '').toLowerCase().includes(query) ||
            String(prompt.content || '').toLowerCase().includes(query);
        });
      }

      function clampSavedPromptSelectIndex(length) {
        if (length <= 0) {
          savedPromptSelectIndex = 0;
          return;
        }
        if (savedPromptSelectIndex < 0) savedPromptSelectIndex = 0;
        if (savedPromptSelectIndex >= length) savedPromptSelectIndex = length - 1;
      }

      function selectSavedPromptByIndex(index) {
        var filtered = getFilteredSavedPromptSelection();
        var safeIndex = Number(index);
        if (!Number.isFinite(safeIndex)) return;
        if (safeIndex < 0 || safeIndex >= filtered.length) return;
        var selected = filtered[safeIndex];
        if (!selected) return;
        setComposerPromptValue(activeSavedPromptTarget, selected.content);
        hideSavedPromptSelect();
      }

      function renderSavedPromptSelectList() {
        if (!savedPromptSelectList) return;
        var filtered = getFilteredSavedPromptSelection();
        clampSavedPromptSelectIndex(filtered.length);
        if (!filtered.length) {
          var hasQuery = String(savedPromptSelectQuery || '').trim().length > 0;
          savedPromptSelectList.innerHTML = '<div class="saved-prompt-empty">' +
            (hasQuery ? 'No prompts found.' : 'No saved prompts yet.') +
          '</div>';
          return;
        }
        savedPromptSelectList.innerHTML = filtered.map(function(prompt, index) {
          var activeClass = index === savedPromptSelectIndex ? ' active' : '';
          return '<button type="button" class="saved-prompt-item' + activeClass + '" data-index="' + index + '" data-id="' + escapeHtml(prompt.id) + '">' +
            '<div class="saved-prompt-title">' + escapeHtml(prompt.title) + '</div>' +
            '<div class="saved-prompt-content">' + escapeHtml(prompt.content) + '</div>' +
          '</button>';
        }).join('');
        savedPromptSelectList.querySelectorAll('.saved-prompt-item').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var index = Number(btn.getAttribute('data-index'));
            if (!Number.isFinite(index)) return;
            selectSavedPromptByIndex(index);
          });
        });
      }

      function handleSavedPromptSelectKeydown(e) {
        if (!savedPromptSelectModal || !savedPromptSelectModal.classList.contains('visible')) return;
        if (!e) return;
        var filtered = getFilteredSavedPromptSelection();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (filtered.length <= 0) return;
          savedPromptSelectIndex = Math.min(savedPromptSelectIndex + 1, filtered.length - 1);
          renderSavedPromptSelectList();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (filtered.length <= 0) return;
          savedPromptSelectIndex = Math.max(savedPromptSelectIndex - 1, 0);
          renderSavedPromptSelectList();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (filtered.length <= 0) return;
          selectSavedPromptByIndex(savedPromptSelectIndex);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hideSavedPromptSelect();
        }
      }

      function showSavedPromptSelect(target) {
        activeSavedPromptTarget = target === 'follow' ? 'follow' : 'initial';
        savedPromptSelectQuery = '';
        savedPromptSelectIndex = 0;
        if (savedPromptSelectSearchInput) {
          savedPromptSelectSearchInput.value = '';
        }
        renderSavedPromptSelectList();
        if (savedPromptSelectModal) savedPromptSelectModal.classList.add('visible');
        if (savedPromptSelectSearchInput && !IS_MOBILE) {
          setTimeout(function() {
            try {
              savedPromptSelectSearchInput.focus();
            } catch {}
          }, 50);
        }
      }

      function hideSavedPromptSelect() {
        if (savedPromptSelectModal) savedPromptSelectModal.classList.remove('visible');
      }

      function renderSavedPromptManageList() {
        if (!savedPromptManageList) return;
        if (!savedPrompts.length) {
          savedPromptManageList.innerHTML = '<div class="saved-prompt-empty">No saved prompts yet.</div>';
          return;
        }
        savedPromptManageList.innerHTML = savedPrompts.map(function(prompt) {
          var activeClass = prompt.id === activeSavedPromptId ? ' active' : '';
          return '<button type="button" class="saved-prompt-item' + activeClass + '" data-id="' + escapeHtml(prompt.id) + '">' +
            '<div class="saved-prompt-title">' + escapeHtml(prompt.title) + '</div>' +
            '<div class="saved-prompt-content">' + escapeHtml(prompt.content) + '</div>' +
          '</button>';
        }).join('');
        savedPromptManageList.querySelectorAll('.saved-prompt-item').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-id');
            var selected = savedPrompts.find(function(prompt) { return prompt.id === id; });
            if (!selected) return;
            activeSavedPromptId = selected.id;
            if (savedPromptTitleInput) savedPromptTitleInput.value = selected.title;
            if (savedPromptContentInput) savedPromptContentInput.value = selected.content;
            renderSavedPromptManageList();
          });
        });
      }

      function showSavedPromptManage(target) {
        activeSavedPromptTarget = target === 'follow' ? 'follow' : 'initial';
        activeSavedPromptId = null;
        if (savedPromptTitleInput) savedPromptTitleInput.value = '';
        if (savedPromptContentInput) {
          var currentInput = getComposerInput(activeSavedPromptTarget);
          var nextValue = currentInput ? String(currentInput.value || '').trim() : '';
          savedPromptContentInput.value = nextValue;
        }
        renderSavedPromptManageList();
        if (savedPromptManageModal) savedPromptManageModal.classList.add('visible');
      }

      function hideSavedPromptManage() {
        if (savedPromptManageModal) savedPromptManageModal.classList.remove('visible');
      }

      async function upsertSavedPromptFromEditor() {
        var title = savedPromptTitleInput ? String(savedPromptTitleInput.value || '').trim() : '';
        var content = savedPromptContentInput ? String(savedPromptContentInput.value || '').trim() : '';
        if (!content) return;
        var nowIso = new Date().toISOString();
        var pendingRecord = null;
        if (activeSavedPromptId) {
          savedPrompts = savedPrompts.map(function(prompt) {
            if (prompt.id !== activeSavedPromptId) return prompt;
            var updated = {
              id: prompt.id,
              title: title || content.slice(0, 64),
              content: content,
              createdAt: prompt.createdAt || nowIso,
              updatedAt: nowIso,
            };
            pendingRecord = updated;
            return updated;
          });
        } else {
          pendingRecord = {
            id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            title: title || content.slice(0, 64),
            content: content,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          savedPrompts.push(pendingRecord);
        }
        saveSavedPrompts();
        renderSavedPromptManageList();
        renderAllSavedPromptCounts();
        try {
          var persisted = await upsertSavedPromptOnServer(pendingRecord);
          if (!persisted) return;
          savedPrompts = savedPrompts.map(function(prompt) {
            if (prompt.id === pendingRecord.id) return persisted;
            return prompt;
          });
          if (activeSavedPromptId === pendingRecord.id) {
            activeSavedPromptId = persisted.id;
          }
          saveSavedPrompts();
          renderSavedPromptManageList();
          renderAllSavedPromptCounts();
        } catch {
          // Keep local cached edit if remote sync fails.
        }
      }

      async function deleteSavedPromptFromEditor() {
        if (!activeSavedPromptId) return;
        var deletingId = activeSavedPromptId;
        savedPrompts = savedPrompts.filter(function(prompt) { return prompt.id !== deletingId; });
        activeSavedPromptId = null;
        if (savedPromptTitleInput) savedPromptTitleInput.value = '';
        if (savedPromptContentInput) savedPromptContentInput.value = '';
        saveSavedPrompts();
        renderSavedPromptManageList();
        renderAllSavedPromptCounts();
        try {
          await deleteSavedPromptOnServer(deletingId);
        } catch {
          // If shared delete fails, resync from shared store to avoid stale divergence.
          try {
            await syncSavedPromptsFromServer();
            saveSavedPrompts();
            renderSavedPromptManageList();
            renderAllSavedPromptCounts();
          } catch {
            // keep optimistic local state if shared store is unavailable
          }
        }
      }

      function fileToBase64(file) {
        return new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() {
            var result = typeof reader.result === 'string' ? reader.result : '';
            var commaIndex = result.indexOf(',');
            resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
          };
          reader.onerror = function() {
            reject(reader.error || new Error('Unable to read file'));
          };
          reader.readAsDataURL(file);
        });
      }

      async function addFilesToComposer(target, fileList) {
        var state = getComposerState(target);
        var room = Math.max(0, MAX_COMPOSER_ATTACHMENTS - state.attachedFiles.length);
        if (!room) return;
        var files = Array.from(fileList || []).slice(0, room);
        for (var i = 0; i < files.length; i += 1) {
          var file = files[i];
          try {
            var dataBase64 = await fileToBase64(file);
            var uploaded = await requestJson('/webchat/uploads', {
              method: 'POST',
              body: JSON.stringify({
                filename: file.name,
                dataBase64: dataBase64,
              }),
            });
            var uploadedFile = uploaded && uploaded.file ? uploaded.file : null;
            if (!uploadedFile || !uploadedFile.path) continue;
            state.attachedFiles.push({
              path: String(uploadedFile.path),
              name: String(uploadedFile.name || file.name || pathBasename(uploadedFile.path)),
              size: Number(uploadedFile.size) || file.size || 0,
            });
          } catch (error) {
            console.warn('Failed to upload webchat attachment:', error);
          }
        }
        renderComposerMeta(target);
      }

      function openComposerFilePicker(target) {
        pendingComposerFileTarget = target === 'follow' ? 'follow' : 'initial';
        if (!composerFileInput) return;
        // Force generic file chooser intent on mobile browsers (not media-only).
        composerFileInput.multiple = true;
        composerFileInput.setAttribute(
          'accept',
          '*/*,.txt,.md,.json,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.mp3,.wav'
        );
        composerFileInput.removeAttribute('capture');
        composerFileInput.value = '';
        composerFileInput.click();
      }

      async function chooseComposerWorkingDirectory(target) {
        var state = getComposerState(target);
        try {
          var result = await requestJson('/webchat/select-folder', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          if (result && Object.prototype.hasOwnProperty.call(result, 'folder')) {
            var selectedFolder = result.folder ? String(result.folder).trim() : '';
            if (selectedFolder || result.folder === null) {
              state.workingDirectory = selectedFolder;
              renderComposerMeta(target);
              return;
            }
          }
        } catch (error) {
          // Fallback below for remote webchat or environments without desktop picker support.
        }
        var next = window.prompt(
          'Enter a working folder path on the desktop host. Leave empty to clear it.',
          state.workingDirectory || ''
        );
        if (next === null) return;
        state.workingDirectory = String(next || '').trim();
        renderComposerMeta(target);
      }

      function toggleComposerPrivacy(target) {
        var state = getComposerState(target);
        state.privacyMode = state.privacyMode === 'incognito' ? 'normal' : 'incognito';
        renderComposerButtons();
      }

      function composerPayload(target) {
        var state = getComposerState(target);
        var payload = {
          privacyMode: state.privacyMode === 'incognito' ? 'incognito' : 'normal',
        };
        if (state.workingDirectory) {
          payload.workingDirectory = state.workingDirectory;
        }
        if (state.attachedFiles.length > 0) {
          payload.attachedFiles = state.attachedFiles.map(function(file) { return String(file.path || '').trim(); }).filter(Boolean);
        }
        return payload;
      }

      function clearComposerAfterSend(target, clearWorkingDirectory) {
        var state = getComposerState(target);
        state.attachedFiles = [];
        if (clearWorkingDirectory) {
          state.workingDirectory = '';
        }
        renderComposerMeta(target);
      }

      function getActiveComposerTarget() {
        var chatVisible = chatState && chatState.classList.contains('active');
        return chatVisible ? 'follow' : 'initial';
      }

      function appendTranscriptToComposer(text) {
        var cleaned = String(text || '').trim();
        if (!cleaned) return;
        var target = getActiveComposerTarget();
        var input = getComposerInput(target);
        if (!input) return;
        var existing = String(input.value || '');
        var delta = computeTranscriptDelta(existing, cleaned);
        if (!delta) return;
        var separator = existing && !/[\\s]$/.test(existing) ? ' ' : '';
        input.value = existing + separator + delta;
        updateInlineVoiceVisibility(target);
        autoResizeTextarea(input, target);
        input.focus();
      }

      function normalizeVoiceTranscript(text) {
        return String(text || '')
          .toLowerCase()
          .replace(/[\u2018\u2019']/g, '')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      function splitVoiceWords(text) {
        var normalized = normalizeVoiceTranscript(text);
        if (!normalized) return [];
        return normalized.split(' ').filter(Boolean);
      }

      function computeTranscriptDelta(existingText, incomingText) {
        var incomingWords = splitVoiceWords(incomingText);
        if (!incomingWords.length) return '';
        var existingWords = splitVoiceWords(existingText);
        if (!existingWords.length) return incomingWords.join(' ');

        var maxLen = Math.min(existingWords.length, incomingWords.length);
        var overlap = 0;
        for (var len = maxLen; len > 0; len -= 1) {
          var existingTail = existingWords.slice(existingWords.length - len).join(' ');
          var incomingHead = incomingWords.slice(0, len).join(' ');
          if (existingTail === incomingHead) {
            overlap = len;
            break;
          }
        }
        var deltaWords = incomingWords.slice(overlap);
        return deltaWords.join(' ');
      }

      function pruneRecentVoiceFinals(nowMs) {
        browserVoiceRecentFinals = (browserVoiceRecentFinals || []).filter(function(item) {
          return item && typeof item.text === 'string' && (nowMs - Number(item.at || 0)) <= 4000;
        });
      }

      function shouldAcceptVoiceFinal(key, transcript) {
        var normalized = normalizeVoiceTranscript(transcript);
        if (!normalized) return false;
        if (browserVoiceCommittedResultKeys && browserVoiceCommittedResultKeys[key]) return false;
        var nowMs = Date.now();
        pruneRecentVoiceFinals(nowMs);
        var duplicateRecent = browserVoiceRecentFinals.some(function(item) {
          return item.text === normalized && (nowMs - Number(item.at || 0)) <= 2200;
        });
        if (duplicateRecent) return false;
        browserVoiceCommittedResultKeys[key] = true;
        browserVoiceRecentFinals.push({ text: normalized, at: nowMs });
        return true;
      }

      function stopBrowserVoiceWake() {
        voiceWakeEnabled = false;
        browserVoiceInterim = '';
        browserVoiceCommittedResultKeys = {};
        browserVoiceRecentFinals = [];
        if (browserVoiceRestartTimer) {
          clearTimeout(browserVoiceRestartTimer);
          browserVoiceRestartTimer = null;
        }
        if (browserVoiceRecognition) {
          try {
            browserVoiceRecognition.stop();
          } catch {
            // ignore
          }
        }
        browserVoiceActive = false;
        renderComposerButtons();
      }

      function startBrowserVoiceWake() {
        if (!browserVoiceSupported || !browserVoiceRecognition) return;
        if (browserVoiceActive) return;
        try {
          browserVoiceRecognition.start();
        } catch (error) {
          console.warn('Failed to start browser voice recognition:', error);
        }
      }

      function initBrowserVoiceWake() {
        var SpeechRecognitionCtor =
          (window && (window.SpeechRecognition || window.webkitSpeechRecognition))
          ? (window.SpeechRecognition || window.webkitSpeechRecognition)
          : null;
        if (!SpeechRecognitionCtor) {
          browserVoiceSupported = false;
          voiceWakeEnabled = false;
          renderComposerButtons();
          return;
        }
        browserVoiceSupported = true;
        browserVoiceRecognition = new SpeechRecognitionCtor();
        browserVoiceRecognition.continuous = true;
        browserVoiceRecognition.interimResults = true;
        browserVoiceRecognition.lang = (navigator && navigator.language) ? navigator.language : 'en-US';
        browserVoiceRecognition.onstart = function() {
          browserVoiceCommittedResultKeys = {};
          pruneRecentVoiceFinals(Date.now());
          browserVoiceActive = true;
          renderComposerButtons();
        };
        browserVoiceRecognition.onresult = function(event) {
          var finalSegments = [];
          var interimText = '';
          for (var i = event.resultIndex; i < event.results.length; i += 1) {
            var result = event.results[i];
            var transcript = result && result[0] && result[0].transcript ? String(result[0].transcript) : '';
            if (!transcript) continue;
            if (result.isFinal) {
              var finalKey = String(i) + ':' + normalizeVoiceTranscript(transcript);
              if (shouldAcceptVoiceFinal(finalKey, transcript)) {
                finalSegments.push(transcript.trim());
              }
            } else {
              interimText += transcript + ' ';
            }
          }
          var finalText = finalSegments.join(' ').trim();
          browserVoiceInterim = interimText.trim();
          if (finalText) {
            appendTranscriptToComposer(finalText);
          }
          renderComposerButtons();
        };
        browserVoiceRecognition.onerror = function(event) {
          var code = event && event.error ? String(event.error) : 'unknown';
          console.warn('Browser voice recognition error:', code);
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            voiceWakeEnabled = false;
            browserVoiceActive = false;
            renderComposerButtons();
            window.alert('Microphone permission was denied. Enable microphone access in your browser and try again.');
          }
        };
        browserVoiceRecognition.onend = function() {
          browserVoiceActive = false;
          browserVoiceInterim = '';
          renderComposerButtons();
          if (!voiceWakeEnabled) return;
          if (browserVoiceRestartTimer) clearTimeout(browserVoiceRestartTimer);
          browserVoiceRestartTimer = setTimeout(function() {
            startBrowserVoiceWake();
          }, 250);
        };
        renderComposerButtons();
      }

      async function toggleVoiceWakeState() {
        if (!browserVoiceSupported) {
          window.alert('Speech recognition is not supported in this browser.');
          return;
        }
        if (voiceWakeBusy) return;
        voiceWakeBusy = true;
        renderComposerButtons();
        try {
          if (voiceWakeEnabled) {
            stopBrowserVoiceWake();
          } else {
            voiceWakeEnabled = true;
            browserVoiceInterim = '';
            renderComposerButtons();
            startBrowserVoiceWake();
          }
        } finally {
          voiceWakeBusy = false;
          renderComposerButtons();
        }
      }

      function syncFollowComposerFromTask(task) {
        if (!task || typeof task !== 'object') return;
        var mode = task.privacyMode === 'incognito' ? 'incognito' : 'normal';
        followComposerState.privacyMode = mode;
        renderComposerButtons();
      }

      // ========== PERMISSION HANDLING ==========
      function renderPermissionOptions(permission) {
        if (!permissionOptions) return;
        permissionOptions.innerHTML = '';
        if (!permission || !permission.options || permission.options.length === 0) return;
        const multi = !!permission.multiSelect;
        permission.options.forEach(function(opt, idx) {
          const id = 'perm_option_' + idx;
          const wrapper = document.createElement('label');
          wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:#0f172a;margin-bottom:6px;';
          const input = document.createElement('input');
          input.type = multi ? 'checkbox' : 'radio';
          input.name = 'permissionOption';
          input.value = opt.label;
          input.id = id;
          const text = document.createElement('span');
          text.textContent = opt.label + (opt.description ? ' — ' + opt.description : '');
          wrapper.appendChild(input);
          wrapper.appendChild(text);
          permissionOptions.appendChild(wrapper);
        });
      }

      function getSelectedPermissionOptions() {
        const selected = [];
        if (permissionOptions) {
          permissionOptions.querySelectorAll('input[name="permissionOption"]:checked').forEach(function(node) {
            selected.push(node.value);
          });
        }
        return selected;
      }

      function showPermissionModal(permission) {
        activePermission = permission;
        if (!permissionModal) return;
        const isFile = permission.type === 'file';

        if (permissionTitle) permissionTitle.textContent = isFile ? 'File Permission Required' : 'Permission Required';
        if (permissionSubtitle) permissionSubtitle.textContent = isFile ? 'Approve or deny this file operation.' : 'The assistant is requesting approval.';

        if (permissionIcon) {
          permissionIcon.className = 'perm-icon ' + (isFile ? 'file' : 'tool');
          permissionIcon.innerHTML = isFile
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 8v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/><path d="M12 3.5l9 16a1.5 1.5 0 0 1-1.3 2.25H4.3A1.5 1.5 0 0 1 3 19.5l9-16z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        }

        if (permissionBadge) {
          const op = (permission.fileOperation || '').toLowerCase();
          if (isFile && op) {
            permissionBadge.style.display = 'inline-flex';
            permissionBadge.textContent = op.toUpperCase();
            const opStyles = { read: { bg: '#ecfccb', color: '#3f6212' }, write: { bg: '#fee2e2', color: '#991b1b' }, move: { bg: '#e0e7ff', color: '#3730a3' }, copy: { bg: '#dbeafe', color: '#1d4ed8' }, delete: { bg: '#fee2e2', color: '#991b1b' } };
            const style = opStyles[op] || { bg: '#e2e8f0', color: '#334155' };
            permissionBadge.style.background = style.bg;
            permissionBadge.style.color = style.color;
          } else {
            permissionBadge.style.display = 'none';
          }
        }

        if (permissionPrompt) permissionPrompt.textContent = permission.question || (isFile ? 'Allow this file operation?' : 'Allow this request?');
        if (permissionPath) { permissionPath.style.display = (isFile && permission.filePath) ? 'block' : 'none'; permissionPath.textContent = permission.filePath || ''; }
        if (permissionTarget) { permissionTarget.style.display = (isFile && permission.targetPath) ? 'block' : 'none'; permissionTarget.textContent = permission.targetPath ? '→ ' + permission.targetPath : ''; }
        if (permissionPreview) { permissionPreview.style.display = (isFile && permission.contentPreview) ? 'block' : 'none'; permissionPreview.textContent = permission.contentPreview || ''; }
        if (permissionAllowAll) { permissionAllowAll.style.display = isFile ? 'inline-flex' : 'none'; }
        if (permissionDetails) {
          let details = '';
          if (!isFile && permission.toolName) {
            details = 'Tool: ' + permission.toolName;
            if (permission.toolInput) { try { details += '\\nInput: ' + JSON.stringify(permission.toolInput, null, 2); } catch {} }
          }
          permissionDetails.style.display = details ? 'block' : 'none';
          permissionDetails.textContent = details;
        }

        renderPermissionOptions(permission);
        permissionModal.classList.add('visible');
      }

      function hidePermissionModal() {
        if (!permissionModal) return;
        permissionModal.classList.remove('visible');
        if (permissionOptions) permissionOptions.innerHTML = '';
        activePermission = null;
      }

      async function loadPermissions() {
        try {
          const query = selectedTaskId ? ('?taskId=' + encodeURIComponent(selectedTaskId)) : '';
          const pending = await requestJson('/permissions' + query, { method: 'GET' });
          if (Array.isArray(pending) && pending.length > 0) {
            showPermissionModal(pending[0]);
          } else {
            hidePermissionModal();
          }
        } catch (err) {
          if (String(err && err.message) === 'unauthorized') return;
        }
      }

      // ========== EVENT HANDLERS ==========
      function autoResizeTextarea(textarea, target) {
        if (!textarea) return;
        var kind = target === 'follow' ? 'follow' : 'initial';
        var maxHeight = kind === 'follow' ? 120 : 200;
        var minHeight = 40;
        textarea.style.height = 'auto';
        textarea.style.lineHeight = '';
        const contentHeight = textarea.scrollHeight;
        const nextHeight = Math.min(contentHeight, maxHeight);
        textarea.style.height = Math.max(nextHeight, minHeight) + 'px';
        if (kind === 'initial' && contentHeight <= 48) {
          textarea.style.height = '42px';
        }
        textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
      }

      async function handleCreateTaskSend() {
        const prompt = promptEl ? promptEl.value.trim() : '';
        if (!prompt) return;
        if (!submitBtn) return;
        submitBtn.disabled = true;
        try {
          const options = composerPayload('initial');
          const result = await requestJson('/tasks', {
            method: 'POST',
            body: JSON.stringify({
              prompt,
              agentId: agentSelect?.value || undefined,
              workingDirectory: options.workingDirectory,
              privacyMode: options.privacyMode,
              attachedFiles: options.attachedFiles,
            }),
          });
          if (result && result.taskId) {
            if (promptEl) {
              promptEl.value = '';
              updateInlineVoiceVisibility('initial');
              autoResizeTextarea(promptEl, 'initial');
            }
            clearComposerAfterSend('initial', false);
            await loadTasks();
            showChatState(result.taskId);
          }
        } catch (err) {
          if (String(err && err.message) !== 'unauthorized') {
            console.warn('Failed to submit task', err);
          }
        } finally {
          submitBtn.disabled = false;
        }
      }

      if (promptEl) {
        promptEl.addEventListener('input', function() {
          updateInlineVoiceVisibility('initial');
          autoResizeTextarea(promptEl, 'initial');
          scheduleContextEstimate('initial');
        });
        promptEl.addEventListener('focus', function() {
          if (IS_MOBILE) ensureFocusedMobileInputVisible();
        });
        promptEl.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleCreateTaskSend();
          }
        });
        updateInlineVoiceVisibility('initial');
        autoResizeTextarea(promptEl, 'initial');
      }

      if (composerFileInput) {
        composerFileInput.addEventListener('change', async function(e) {
          var target = pendingComposerFileTarget === 'follow' ? 'follow' : 'initial';
          var files = e && e.target && e.target.files ? e.target.files : null;
          if (!files || files.length === 0) return;
          await addFilesToComposer(target, files);
          composerFileInput.value = '';
          pendingComposerFileTarget = null;
        });
      }

      if (initialAddFilesBtn) {
        initialAddFilesBtn.addEventListener('click', function() {
          openComposerFilePicker('initial');
        });
      }
      if (initialInlineAddFilesBtn) {
        initialInlineAddFilesBtn.addEventListener('click', function() {
          openComposerFilePicker('initial');
        });
      }
      if (followAddFilesBtn) {
        followAddFilesBtn.addEventListener('click', function() {
          openComposerFilePicker('follow');
        });
      }
      if (followInlineAddFilesBtn) {
        followInlineAddFilesBtn.addEventListener('click', function() {
          openComposerFilePicker('follow');
        });
      }
      if (initialIncognitoBtn) initialIncognitoBtn.addEventListener('click', function() { toggleComposerPrivacy('initial'); });
      if (followIncognitoBtn) followIncognitoBtn.addEventListener('click', function() { toggleComposerPrivacy('follow'); });
      if (initialFolderBtn) initialFolderBtn.addEventListener('click', function() { chooseComposerWorkingDirectory('initial'); });
      if (followFolderBtn) followFolderBtn.addEventListener('click', function() { chooseComposerWorkingDirectory('follow'); });
      if (initialUsePromptBtn) initialUsePromptBtn.addEventListener('click', function() { showSavedPromptSelect('initial'); });
      if (followUsePromptBtn) followUsePromptBtn.addEventListener('click', function() { showSavedPromptSelect('follow'); });
      if (initialManagePromptBtn) initialManagePromptBtn.addEventListener('click', function() { showSavedPromptManage('initial'); });
      if (followManagePromptBtn) followManagePromptBtn.addEventListener('click', function() { showSavedPromptManage('follow'); });
      if (savedPromptSelectClose) savedPromptSelectClose.addEventListener('click', hideSavedPromptSelect);
      if (savedPromptSelectSearchInput) {
        savedPromptSelectSearchInput.addEventListener('input', function() {
          savedPromptSelectQuery = String(savedPromptSelectSearchInput.value || '');
          savedPromptSelectIndex = 0;
          renderSavedPromptSelectList();
        });
      }
      if (savedPromptSelectModal) {
        savedPromptSelectModal.addEventListener('keydown', handleSavedPromptSelectKeydown);
        savedPromptSelectModal.addEventListener('click', function(e) {
          if (e.target === savedPromptSelectModal) hideSavedPromptSelect();
        });
      }
      if (savedPromptManageClose) savedPromptManageClose.addEventListener('click', hideSavedPromptManage);
      if (savedPromptManageModal) {
        savedPromptManageModal.addEventListener('click', function(e) {
          if (e.target === savedPromptManageModal) hideSavedPromptManage();
        });
      }
      if (savedPromptNewBtn) {
        savedPromptNewBtn.addEventListener('click', function() {
          activeSavedPromptId = null;
          if (savedPromptTitleInput) savedPromptTitleInput.value = '';
          if (savedPromptContentInput) savedPromptContentInput.value = '';
          renderSavedPromptManageList();
        });
      }
      if (savedPromptSaveBtn) savedPromptSaveBtn.addEventListener('click', upsertSavedPromptFromEditor);
      if (savedPromptDeleteBtn) savedPromptDeleteBtn.addEventListener('click', deleteSavedPromptFromEditor);
      if (savePromptCancelBtn) savePromptCancelBtn.addEventListener('click', hideSavePromptModal);
      if (savePromptConfirmBtn) savePromptConfirmBtn.addEventListener('click', function() { void confirmSavePromptFromMessage(); });
      if (savePromptTitleInput) {
        savePromptTitleInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            void confirmSavePromptFromMessage();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            hideSavePromptModal();
          }
        });
      }
      if (savePromptModal) {
        savePromptModal.addEventListener('click', function(e) {
          if (e.target === savePromptModal) hideSavePromptModal();
        });
      }
      if (initialVoiceWakeBtn) initialVoiceWakeBtn.addEventListener('click', function() { void toggleVoiceWakeState(); });
      if (followVoiceWakeBtn) followVoiceWakeBtn.addEventListener('click', function() { void toggleVoiceWakeState(); });
      if (initialInlineVoiceWakeBtn) initialInlineVoiceWakeBtn.addEventListener('click', function() { void toggleVoiceWakeState(); });
      if (followInlineVoiceWakeBtn) followInlineVoiceWakeBtn.addEventListener('click', function() { void toggleVoiceWakeState(); });
      if (initialMobileMoreBtn) initialMobileMoreBtn.addEventListener('click', function() { showMobileComposerOptions('initial'); });
      if (followMobileMoreBtn) followMobileMoreBtn.addEventListener('click', function() { showMobileComposerOptions('follow'); });
      if (mobileComposerOptionsClose) mobileComposerOptionsClose.addEventListener('click', hideMobileComposerOptions);
      if (mobileComposerOptionsModal) {
        mobileComposerOptionsModal.addEventListener('click', function(e) {
          if (e.target === mobileComposerOptionsModal) hideMobileComposerOptions();
        });
      }
      if (mobileComposerIncognitoBtn) {
        mobileComposerIncognitoBtn.addEventListener('click', function() {
          toggleComposerPrivacy(mobileComposerOptionsTarget);
          showMobileComposerOptions(mobileComposerOptionsTarget);
        });
      }
      if (mobileComposerFolderBtn) {
        mobileComposerFolderBtn.addEventListener('click', function() {
          hideMobileComposerOptions();
          void chooseComposerWorkingDirectory(mobileComposerOptionsTarget);
        });
      }
      if (mobileComposerUsePromptBtn) {
        mobileComposerUsePromptBtn.addEventListener('click', function() {
          hideMobileComposerOptions();
          showSavedPromptSelect(mobileComposerOptionsTarget);
        });
      }
      if (mobileComposerManagePromptBtn) {
        mobileComposerManagePromptBtn.addEventListener('click', function() {
          hideMobileComposerOptions();
          showSavedPromptManage(mobileComposerOptionsTarget);
        });
      }
      if (messagesArea) {
        messagesArea.addEventListener('scroll', function() {
          updateScrollBottomButtonVisibility();
          if (contextInfoPopover && contextInfoPopover.classList.contains('visible')) {
            hideContextInfoPopover();
          }
        });
      }
      if (scrollBottomBtn) {
        scrollBottomBtn.addEventListener('click', function() {
          scrollMessagesToBottom('smooth');
        });
      }

      if (form) {
        form.addEventListener('submit', function(e) {
          e.preventDefault();
          void handleCreateTaskSend();
        });
      }
      if (submitBtn) {
        submitBtn.addEventListener('click', function(e) {
          e.preventDefault();
          void handleCreateTaskSend();
        });
      }

      if (actionBtn && followUpInput) {
        async function handleFollowUpSend() {
          const message = followUpInput.value.trim();
          if (!message || !selectedTaskId) return;
          actionBtn.disabled = true;
          try {
            const options = composerPayload('follow');
            const selectedTask = allTasks.find(function(task) { return task.id === selectedTaskId; });
            await requestJson('/tasks/' + encodeURIComponent(selectedTaskId) + '/turns', {
              method: 'POST',
              body: JSON.stringify({
                prompt: message,
                sessionId: selectedSessionId,
                agentId: selectedTask && selectedTask.agentId ? selectedTask.agentId : undefined,
                workingDirectory: options.workingDirectory,
                privacyMode: options.privacyMode,
                attachedFiles: options.attachedFiles,
              }),
            });
            followUpInput.value = '';
            updateInlineVoiceVisibility('follow');
            autoResizeTextarea(followUpInput, 'follow');
            clearComposerAfterSend('follow', true);
            await loadTasks();
          } catch (err) {
            if (String(err && err.message) !== 'unauthorized') {
              console.warn('Failed to send follow-up', err);
            }
          } finally {
            actionBtn.disabled = false;
          }
        }

        async function handleStopTask() {
          if (!selectedTaskId) return;
          actionBtn.disabled = true;
          try {
            await requestJson('/tasks/' + encodeURIComponent(selectedTaskId) + '/interrupt', {
              method: 'POST',
              body: JSON.stringify({}),
            });
            await loadTasks();
            if (selectedTaskId) loadTaskMessages(selectedTaskId);
          } catch (err) {
            console.warn('Failed to stop task', err);
          } finally {
            actionBtn.disabled = false;
          }
        }

        actionBtn.addEventListener('click', function() {
          if (actionMode === 'stop') {
            handleStopTask();
          } else {
            handleFollowUpSend();
          }
        });
        followUpInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFollowUpSend(); }
        });
        followUpInput.addEventListener('input', function() {
          updateInlineVoiceVisibility('follow');
          autoResizeTextarea(followUpInput, 'follow');
          scheduleContextEstimate('follow');
        });
        followUpInput.addEventListener('focus', function() {
          if (IS_MOBILE) ensureFocusedMobileInputVisible();
        });
        updateInlineVoiceVisibility('follow');
        autoResizeTextarea(followUpInput, 'follow');
      }

      if (backBtn) {
        backBtn.addEventListener('click', showInitialState);
      }

      if (newTaskBtn) {
        newTaskBtn.addEventListener('click', function() {
          showInitialState();
          if (promptEl) promptEl.focus();
        });
      }

      if (newProjectBtn) {
        newProjectBtn.addEventListener('click', function() {
          showFolderModal();
        });
      }

      if (searchTasksBtn) {
        searchTasksBtn.addEventListener('click', function() {
          showSearchModal();
        });
      }

      if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
          showAuthModal(true);
        });
      }
      if (mobileSettingsBtn) {
        mobileSettingsBtn.addEventListener('click', function() {
          showAuthModal(true);
        });
      }
      if (mobileTasksBtn) {
        mobileTasksBtn.addEventListener('click', function() {
          showMobileTaskPanel();
        });
      }
      if (mobileTaskPanelClose) {
        mobileTaskPanelClose.addEventListener('click', function() {
          hideMobileTaskPanel();
        });
      }
      if (mobileTaskPanel) {
        mobileTaskPanel.addEventListener('touchstart', handleMobileTaskPanelTouchStart, { passive: true });
        mobileTaskPanel.addEventListener('touchmove', handleMobileTaskPanelTouchMove, { passive: false });
        mobileTaskPanel.addEventListener('touchend', handleMobileTaskPanelTouchEnd, { passive: true });
        mobileTaskPanel.addEventListener('touchcancel', handleMobileTaskPanelTouchEnd, { passive: true });
      }
      if (mobileTaskOverlay) {
        mobileTaskOverlay.addEventListener('click', function() {
          hideMobileTaskPanel();
        });
      }
      if (mobilePanelNewProject) {
        mobilePanelNewProject.addEventListener('click', function() {
          hideMobileTaskPanel();
          showFolderModal();
        });
      }
      if (mobilePanelSearch) {
        mobilePanelSearch.addEventListener('click', function() {
          hideMobileTaskPanel();
          showSearchModal();
        });
      }

      if (mobileAgentSwitcher) {
        mobileAgentSwitcher.addEventListener('click', function(e) {
          e.stopPropagation();
          showAgentDropdown(mobileAgentSwitcher);
        });
      }

      if (mobileConnectedAgentAvatar) {
        mobileConnectedAgentAvatar.addEventListener('click', function(e) {
          e.stopPropagation();
          var currentAgentName = '';
          if (mobileAgentName && mobileAgentName.textContent) {
            currentAgentName = mobileAgentName.textContent.trim();
          } else if (agentName && agentName.textContent) {
            currentAgentName = agentName.textContent.trim();
          } else if (agentSelect && agentSelect.value) {
            currentAgentName = agentSelect.value;
          } else {
            currentAgentName = 'Unknown';
          }
          showMobileAgentPopup('Agent: ' + currentAgentName, mobileConnectedAgentAvatar);
        });
      }

      if (mobileConnectedBadge) {
        mobileConnectedBadge.addEventListener('click', function(e) {
          e.stopPropagation();
          if (mobileConnectedBadge.style.display === 'none') return;
          showMobileAgentPopup('Status: Connected', mobileConnectedBadge);
        });
      }

      function handleMobileModelClick(anchorEl) {
        if (!anchorEl) return;
        anchorEl.addEventListener('click', function(e) {
          e.stopPropagation();
          var modelText = currentModelLabel || 'Model unavailable';
          showMobileAgentPopup('Model: ' + modelText, anchorEl);
        });
      }
      handleMobileModelClick(mobileModelBtn);
      handleMobileModelClick(initialMobileModelBtn);

      function bindFullscreenToggle(btn) {
        if (!btn) return;
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          void toggleFullscreenMode();
        });
      }
      bindFullscreenToggle(fullscreenBtn);
      bindFullscreenToggle(initialFullscreenBtn);
      document.addEventListener('fullscreenchange', updateFullscreenButtons);
      document.addEventListener('webkitfullscreenchange', updateFullscreenButtons);
      updateFullscreenButtons();

      var agentSwitcherEl = document.getElementById('agentSwitcher');
      if (agentSwitcherEl) {
        agentSwitcherEl.addEventListener('click', function(e) {
          e.stopPropagation();
          showAgentDropdown(agentSwitcherEl);
        });
      }

      if (authSave) {
        authSave.addEventListener('click', async function() {
          authValue = authInput.value.trim();
          if (!authValue) { setAuthError('Enter a value first.'); return; }
          localStorage.setItem(authStorageKey, authValue);
          setAuthError('');
          authValidated = false;
          updateAuthStatus();
          try {
            await requestJson('/tasks', { method: 'GET' });
            hideAuthModal(true);
            await loadTasks();
            await loadAgents();
          } catch (err) {
            if (String(err && err.message) !== 'unauthorized') console.warn('Auth failed', err);
          }
        });
      }

      if (authClear) {
        authClear.addEventListener('click', function() {
          localStorage.removeItem(authStorageKey);
          authValue = '';
          if (authInput) authInput.value = '';
          setAuthError('');
          authValidated = false;
          updateAuthStatus();
        });
      }

      if (themeBtn) {
        themeBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var nextOpen = !(themeMenu && themeMenu.classList.contains('visible'));
          setThemeMenuOpen(nextOpen);
        });
      }

      if (themeMenu) {
        themeMenu.addEventListener('click', function(e) {
          e.stopPropagation();
        });
      }

      if (themeMenuOptions.length > 0) {
        themeMenuOptions.forEach(function(node) {
          node.addEventListener('click', function(e) {
            e.stopPropagation();
            var value = String(node.getAttribute('data-theme-option') || '');
            applyThemePreference(value, true);
            setThemeMenuOpen(false);
          });
        });
      }

      if (themeSelect) {
        themeSelect.addEventListener('change', function() {
          applyThemePreference(themeSelect.value, true);
        });
      }

      // Close auth modal when clicking overlay background
      if (authModal) {
        authModal.addEventListener('click', function(e) {
          if (e.target === authModal) {
            hideAuthModal(true);
          }
        });
      }

      if (permissionAllow) {
        permissionAllow.addEventListener('click', async function() {
          if (!activePermission) return;
          permissionAllow.disabled = true;
          if (permissionAllowAll) permissionAllowAll.disabled = true;
          permissionDeny.disabled = true;
          try {
            await requestJson('/permissions/' + encodeURIComponent(activePermission.id), {
              method: 'POST',
              body: JSON.stringify({ taskId: activePermission.taskId, decision: 'allow', selectedOptions: getSelectedPermissionOptions() }),
            });
            hidePermissionModal();
          } catch (err) {
            if (String(err && err.message) !== 'unauthorized') console.warn('Failed to resolve permission', err);
          } finally {
            permissionAllow.disabled = false;
            if (permissionAllowAll) permissionAllowAll.disabled = false;
            permissionDeny.disabled = false;
          }
        });
      }

      if (permissionAllowAll) {
        permissionAllowAll.addEventListener('click', async function() {
          if (!activePermission) return;
          permissionAllow.disabled = true;
          permissionAllowAll.disabled = true;
          permissionDeny.disabled = true;
          try {
            await requestJson('/permissions/' + encodeURIComponent(activePermission.id), {
              method: 'POST',
              body: JSON.stringify({ taskId: activePermission.taskId, decision: 'allow_all', selectedOptions: getSelectedPermissionOptions() }),
            });
            hidePermissionModal();
          } catch (err) {
            if (String(err && err.message) !== 'unauthorized') console.warn('Failed to resolve permission', err);
          } finally {
            permissionAllow.disabled = false;
            permissionAllowAll.disabled = false;
            permissionDeny.disabled = false;
          }
        });
      }

      if (permissionDeny) {
        permissionDeny.addEventListener('click', async function() {
          if (!activePermission) return;
          permissionAllow.disabled = true;
          if (permissionAllowAll) permissionAllowAll.disabled = true;
          permissionDeny.disabled = true;
          try {
            await requestJson('/permissions/' + encodeURIComponent(activePermission.id), {
              method: 'POST',
              body: JSON.stringify({ taskId: activePermission.taskId, decision: 'deny' }),
            });
            hidePermissionModal();
          } catch (err) {
            if (String(err && err.message) !== 'unauthorized') console.warn('Failed to resolve permission', err);
          } finally {
            permissionAllow.disabled = false;
            if (permissionAllowAll) permissionAllowAll.disabled = false;
            permissionDeny.disabled = false;
          }
        });
      }

      // ========== FOLDER EVENT HANDLERS ==========
      if (addFolderBtn) {
        addFolderBtn.addEventListener('click', function() {
          showFolderModal();
        });
      }

      if (folderCancelBtn) {
        folderCancelBtn.addEventListener('click', hideFolderModal);
      }

      if (folderTabIcon) {
        folderTabIcon.addEventListener('click', function() { setFolderModalTab('icon'); });
      }
      if (folderTabColor) {
        folderTabColor.addEventListener('click', function() { setFolderModalTab('color'); });
      }

      if (folderSaveBtn) {
        folderSaveBtn.addEventListener('click', function() {
          const name = folderNameInput.value.trim();
          if (!name) {
            folderNameInput.focus();
            return;
          }
          folderSaveBtn.disabled = true;
          const promise = editingFolderId
            ? updateFolderApi(editingFolderId, { name: name, color: selectedFolderColor, icon: selectedFolderIcon })
            : createFolderApi(name, selectedFolderColor, selectedFolderIcon);
          promise.then(function() {
            hideFolderModal();
            renderTaskList();
          }).finally(function() {
            folderSaveBtn.disabled = false;
          });
        });
      }

      if (folderNameInput) {
        folderNameInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            folderSaveBtn.click();
          } else if (e.key === 'Escape') {
            hideFolderModal();
          }
        });
      }

      // Rename modal handlers
      if (renameCancelBtn) {
        renameCancelBtn.addEventListener('click', hideRenameModal);
      }
      if (renameSaveBtn) {
        renameSaveBtn.addEventListener('click', handleRenameTask);
      }
      if (renameInput) {
        renameInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); handleRenameTask(); }
          else if (e.key === 'Escape') { hideRenameModal(); }
        });
      }

      // Search modal handlers
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          renderSearchResults(searchInput.value);
        });
        searchInput.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') hideSearchModal();
        });
      }
      if (searchModal) {
        searchModal.addEventListener('click', function(e) {
          if (e.target === searchModal) hideSearchModal();
        });
      }

      if (usageBanner) {
        usageBanner.addEventListener('click', function() {
          openUsageDetailsModal();
        });
        usageBanner.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openUsageDetailsModal();
          }
        });
      }
      if (usagePeriodTabs) {
        usagePeriodTabs.querySelectorAll('[data-usage-period]').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var next = String(btn.getAttribute('data-usage-period') || '').trim();
            if (!next || next === usagePeriod) return;
            usagePeriod = next;
            void loadUsageSummary();
          });
        });
      }
      if (usageDetailsClose) {
        usageDetailsClose.addEventListener('click', closeUsageDetailsModal);
      }
      if (usageDetailsModal) {
        usageDetailsModal.addEventListener('click', function(e) {
          if (e.target === usageDetailsModal) closeUsageDetailsModal();
        });
      }

      // Close context menu on click outside
      document.addEventListener('click', function(e) {
        var infoBtn = e.target && e.target.closest ? e.target.closest('[data-context-info-target]') : null;
        if (infoBtn) {
          e.preventDefault();
          e.stopPropagation();
          var infoTarget = String(infoBtn.getAttribute('data-context-info-target') || 'initial');
          toggleContextInfoPopover(infoBtn, infoTarget);
          return;
        }
        if (contextInfoPopover && contextInfoPopover.classList.contains('visible')) {
          if (!contextInfoPopover.contains(e.target)) {
            hideContextInfoPopover();
          }
        }
        if (themeMenu && themeMenu.classList.contains('visible')) {
          if (!themeMenuWrap || !themeMenuWrap.contains(e.target)) {
            setThemeMenuOpen(false);
          }
        }
        if (Date.now() < ignoreContextMenuDismissUntil) return;
        if (!e.target.closest('.context-menu') && !e.target.closest('.task-item-menu')) {
          hideContextMenu();
        }
      });

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && contextInfoPopover && contextInfoPopover.classList.contains('visible')) {
          hideContextInfoPopover();
        }
        if (e.key === 'Escape' && usageDetailsModal && usageDetailsModal.classList.contains('visible')) {
          closeUsageDetailsModal();
        }
      });

      window.addEventListener('resize', hideContextInfoPopover);

      // Close folder modal on click outside
      if (folderModal) {
        folderModal.addEventListener('click', function(e) {
          if (e.target === folderModal) {
            hideFolderModal();
          }
        });
      }

      // ========== INITIALIZATION ==========
      initializeThemePreference();
      renderFolderColors();
      applyInitialPromptPlaceholderForViewport();
      syncContextIndicatorPlacement();
      window.addEventListener('resize', applyInitialPromptPlaceholderForViewport);
      window.addEventListener('resize', syncContextIndicatorPlacement);
      if (IS_MOBILE) {
        syncMobileViewportLayout();
        window.addEventListener('resize', syncMobileViewportLayout);
        window.addEventListener('orientationchange', syncMobileViewportLayout);
        window.addEventListener('orientationchange', syncContextIndicatorPlacement);
        window.addEventListener('focusin', function() {
          setTimeout(syncMobileViewportLayout, 80);
          ensureFocusedMobileInputVisible();
        });
        window.addEventListener('focusout', function() { setTimeout(syncMobileViewportLayout, 140); });
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', syncMobileViewportLayout);
          window.visualViewport.addEventListener('scroll', syncMobileViewportLayout);
          window.visualViewport.addEventListener('resize', ensureFocusedMobileInputVisible);
        }
      }
      loadSavedPrompts();
      renderAllComposerUi();
      renderUsageBanner();
      initBrowserVoiceWake();
      loadAuthInfo()
        .then(function() { return Promise.all([loadFolders(), loadAgents(), loadUsageSummary()]); })
        .then(function() { return loadTasks(); })
        .then(function() {
          const restorableTaskId = getRestorableTaskId();
          contextEstimateEnabled = true;
          if (restorableTaskId && allTasks.some(function(t) { return t.id === restorableTaskId; })) {
            showChatState(restorableTaskId);
            return;
          }
          showInitialState();
        });

      window.addEventListener('beforeunload', function() {
        if (selectedTaskId) {
          persistLastChatState(selectedTaskId);
        } else {
          persistLastChatState(null);
        }
      });

      // Adaptive polling: faster when a task is running, slower when idle
      var taskPollTimer = null;
      function scheduleTaskPoll() {
        if (taskPollTimer) clearTimeout(taskPollTimer);
        var hasRunningTask = selectedTaskId && allTasks.some(function(t) {
          return t.id === selectedTaskId && (t.status === 'running' || t.status === 'queued');
        });
        var interval = hasRunningTask ? 2000 : 5000;
        taskPollTimer = setTimeout(function() {
          loadFolders().then(function() { return loadTasks(); }).then(function() { scheduleTaskPoll(); });
        }, interval);
      }
      scheduleTaskPoll();
      setInterval(loadPermissions, 2500);
      setInterval(loadUsageSummary, 15000);
    </script>
  </body>
</html>`;
}

function renderNodeCompanionPage(): string {
  const companionBadge = getMobileNodesDisplayName();
  const fallbackLogoDataUrl = getLogoDataUri();
  const logoDataUrl = (() => {
    try {
      const candidatePaths = [
        path.join(process.cwd(), 'open_deskmate_thumbnail-no_background.png'),
        path.join(process.cwd(), 'open_deskmate_thumbnail-no_background.png'.toLowerCase()),
      ];
      const logoPath = candidatePaths.find((p) => fs.existsSync(p));
      if (!logoPath) return fallbackLogoDataUrl || null;
      const buffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return fallbackLogoDataUrl || null;
    }
  })();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Open Deskmate Companion (Camera, Microphone, Screen Sharing)</title>
    <link rel="icon" type="image/png" href="/favicon.ico?v=3" />
    <link rel="shortcut icon" href="/favicon.ico?v=3" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3" />
    <style>
      :root { font-family: 'DM Sans', system-ui, sans-serif; color: #0f172a; background: #eef2ff; }
      body { margin: 0; padding: 24px; background: radial-gradient(circle at top, #eef2ff 0%, #f8fafc 45%, #f1f5f9 100%); }
      * { box-sizing: border-box; }
      .container { max-width: 940px; margin: 0 auto; display: grid; gap: 16px; }
      .card { background: rgba(255,255,255,0.9); border-radius: 18px; padding: 18px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0; backdrop-filter: blur(6px); }
      .hero { display: flex; align-items: center; gap: 14px; }
      .badge { margin-top: 12px; display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 999px; background: linear-gradient(135deg, #7c3aed, #ec4899); color: #fff; font-size: 12px; font-weight: 600; letter-spacing: 0.3px; box-shadow: 0 6px 16px rgba(124, 58, 237, 0.35); }
      .logo { width: 44px; height: 44px; min-width: 44px; min-height: 44px; aspect-ratio: 1 / 1; flex: 0 0 44px; flex-shrink: 0; overflow: hidden; border-radius: 12px; background: linear-gradient(135deg, #1d4ed8, #38bdf8); display: inline-flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 16px; box-shadow: 0 8px 18px rgba(29, 78, 216, 0.35); }
      .logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
      h1 { margin: 0 0 4px; font-size: 24px; }
      h2 { margin: 0 0 6px; font-size: 16px; }
      .section-title { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 16px; }
      .section-title svg { width: 18px; height: 18px; color: #2563eb; }
      p { margin: 0; color: #475569; }
      label { font-size: 12px; color: #64748b; }
      input, select { width: 100%; min-width: 0; padding: 10px 12px; border-radius: 12px; border: 1px solid #e2e8f0; font-size: 14px; background: white; }
      button { background: #1e40af; color: white; border: none; padding: 10px 16px; border-radius: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 16px rgba(30, 64, 175, 0.2); }
      button.secondary { background: #eef2ff; color: #1e293b; box-shadow: none; border: 1px solid #e2e8f0; }
      button.danger { background: #ef4444; color: #fff; box-shadow: 0 6px 16px rgba(239, 68, 68, 0.35); border: none; }
      button:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
      .row { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      @media (max-width: 640px) {
        .row { grid-template-columns: 1fr; }
      }
      .form-field { display: flex; flex-direction: column; gap: 6px; }
      .form-field button { width: 100%; }
      .form-field .toggle-switch { width: 28px; height: 16px; flex: 0 0 auto; }
      .info-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-left: 6px; border-radius: 999px; border: 1px solid #cbd5e1; color: #64748b; font-size: 11px; font-weight: 700; cursor: help; }
      .info-icon:hover { background: #e2e8f0; color: #1e293b; }
      .status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
      .status-ok { background: #dcfce7; color: #166534; }
      .status-pending { background: #fef9c3; color: #854d0e; }
      .status-unknown { background: #e2e8f0; color: #475569; }
      .error { margin-top: 8px; color: #b91c1c; font-size: 12px; }
      .auth-card { position: relative; }
      .auth-header { display: flex; align-items: center; gap: 12px; padding-right: 44px; }
      .auth-header h2 { margin: 0; }
      .auth-summary-status { display: inline-flex; align-items: center; font-size: 12px; }
      .auth-toggle { position: absolute; top: 50%; right: 18px; transform: translateY(-50%); width: 30px; height: 30px; border-radius: 999px; border: 1px solid #e2e8f0; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1; color: #475569; background: white; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); transition: transform 0.2s ease, background 0.2s ease; }
      .auth-toggle[aria-expanded="true"] { transform: translateY(-50%) rotate(180deg); }
      .auth-toggle:hover { background: #eef2ff; }
      .auth-body { margin-top: 12px; }
      #authSummaryStatus { font-size: 12px; }
      .auth-card .status-ok { background: none; color: #16a34a; font-weight: 600; margin-left: 6px; padding: 0; border-radius: 0; }
      .auth-card .status-bad { background: none; color: #dc2626; font-weight: 600; margin-left: 6px; padding: 0; border-radius: 0; }
      .warn-banner { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; font-size: 12px; }
      .hidden { display: none; }
      video { width: 100%; max-height: 320px; border-radius: 12px; background: #0f172a; }
      .muted { color: #94a3b8; font-size: 12px; }
      .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); display: none; align-items: center; justify-content: center; padding: 24px; z-index: 50; backdrop-filter: blur(6px); }
      .modal { width: 100%; max-width: 560px; background: #fff; border-radius: 18px; padding: 24px; border: 1px solid #e2e8f0; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.2); }
      .modal h3 { margin: 0 0 8px; font-size: 18px; }
      .modal p { font-size: 14px; color: #475569; }
      .modal-actions { margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
      .perm-header { display: flex; align-items: flex-start; gap: 14px; }
      .perm-icon { width: 40px; height: 40px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex: 0 0 auto; }
      .perm-icon.file { background: rgba(245, 158, 11, 0.15); color: #b45309; }
      .perm-icon.tool { background: rgba(250, 204, 21, 0.18); color: #92400e; }
      .perm-title { font-size: 18px; font-weight: 600; margin: 0 0 6px; color: #0f172a; }
      .perm-subtitle { font-size: 14px; color: #64748b; margin: 0 0 12px; }
      .perm-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(59, 130, 246, 0.1); color: #2563eb; }
      .perm-badge.delete { background: rgba(239, 68, 68, 0.1); color: #b91c1c; }
      .perm-badge.modify { background: rgba(234, 179, 8, 0.15); color: #a16207; }
      .perm-badge.overwrite { background: rgba(251, 146, 60, 0.15); color: #c2410c; }
      .perm-badge.create { background: rgba(16, 185, 129, 0.12); color: #047857; }
      .perm-badge.rename, .perm-badge.move { background: rgba(59, 130, 246, 0.12); color: #1d4ed8; }
      .perm-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: #0f172a; word-break: break-all; }
      .perm-preview { margin-top: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; font-size: 12px; max-height: 160px; overflow: auto; white-space: pre-wrap; }
      .toggle-control { display: flex; align-items: center; gap: 10px; }
      .toggle-switch { width: 28px; height: 16px; border-radius: 999px; border: 1px solid #cbd5e1; background: #e2e8f0; padding: 0; display: inline-flex; align-items: center; transition: background 0.2s ease, border 0.2s ease; }
      .toggle-switch .toggle-dot { width: 12px; height: 12px; border-radius: 999px; background: #fff; transform: translateX(2px); transition: transform 0.2s ease; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2); }
      .toggle-switch.on { background: #2563eb; border-color: #2563eb; }
      .toggle-switch.on .toggle-dot { transform: translateX(14px); }
    </style>
  </head>
  <body>
    <div class="modal-overlay" id="screenShareModal">
      <div class="modal">
        <h3>Screen share request</h3>
        <p id="screenShareModalText"></p>
        <div class="modal-actions">
          <button id="screenShareModalStart" type="button">Start screen share</button>
          <button id="screenShareModalClose" type="button" class="secondary">Not now</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="micShareModal">
      <div class="modal">
        <h3>Microphone request</h3>
        <p id="micShareModalText"></p>
        <div class="modal-actions">
          <button id="micShareModalStart" type="button">Start microphone</button>
          <button id="micShareModalClose" type="button" class="secondary">Not now</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="livePreviewModal">
      <div class="modal">
        <h3>Camera preview request</h3>
        <p id="livePreviewModalText"></p>
        <div class="modal-actions">
          <button id="livePreviewModalStart" type="button">Start camera</button>
          <button id="livePreviewModalClose" type="button" class="secondary">Not now</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="aiCameraModal">
      <div class="modal">
        <h3>AI camera request</h3>
        <p id="aiCameraModalText"></p>
        <div class="modal-actions">
          <button id="aiCameraModalStart" type="button">Start camera</button>
          <button id="aiCameraModalClose" type="button" class="secondary">Not now</button>
        </div>
      </div>
    </div>

    <div class="container">
      <div class="card">
        <div class="hero">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Open Deskmate" />` : 'OD'}
          </div>
          <div>
            <h1>Open Deskmate Companion</h1>
            <p>Use this page on a phone to pair and provide camera snapshots.</p>
          </div>
        </div>
        ${companionBadge ? `<div class="badge" id="companionBadge">${companionBadge}</div>` : '<div class="badge hidden" id="companionBadge"></div>'}
      </div>

      <div class="card auth-card" id="authCard" style="display:none;">
        <button id="authToggleIcon" class="auth-toggle" type="button" title="Collapse">&#9662;</button>
        <div class="auth-header">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a7 7 0 0 0-7 7v3H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V9a7 7 0 0 0-7-7Z"></path>
            <path d="M8 12V9a4 4 0 0 1 8 0v3"></path>
          </svg>
          Access required
        </h2>
          <span id="authSummaryStatus" class="muted auth-summary-status" style="margin-left:12px;"></span>
        </div>
        <div class="auth-body" id="authBody" style="display:block;">
          <p id="authHint">Enter your access token to continue.</p>
          <p class="muted" id="authStatus" style="margin-top:6px;"></p>
          <div class="row" style="margin-top: 12px;">
        <input
          id="authInput"
          type="text"
          placeholder="Access token"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          data-lpignore="true"
        />
          </div>
          <div class="row" style="margin-top: 12px;">
            <button id="authSave" type="button">Save</button>
            <button id="authValidate" type="button" class="secondary">Validate token</button>
            <button id="authClear" type="button" style="background:#e2e8f0;color:#0f172a;">Clear</button>
          </div>
          <p id="authError" class="error" style="display:none;"></p>
        </div>
      </div>

      <div class="card">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 11a4 4 0 1 0-8 0"></path>
            <path d="M3 21a9 9 0 0 1 18 0"></path>
          </svg>
          Pairing
        </h2>
        <div class="row">
          <div>
            <label for="nodeName">Device name</label>
            <input id="nodeName" placeholder="My phone" />
          </div>
          <div>
            <label for="nodeId">Node id</label>
            <input id="nodeId" />
          </div>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button id="pairBtn" type="button">Request pairing</button>
          <button id="checkBtn" type="button" class="secondary">Check status</button>
          <button id="cancelBtn" type="button" class="secondary">Cancel pairing</button>
        </div>
        <div style="margin-top: 10px;">
          <span id="pairStatus" class="status-pill status-unknown">Unknown</span>
          <span class="muted" id="pairDetails"></span>
        </div>
        <p id="pairError" class="error" style="display:none;"></p>
      </div>

      <div class="card">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h4l2-2h4l2 2h4v12H4z"></path>
            <circle cx="12" cy="13" r="3.5"></circle>
          </svg>
          Camera preview
        </h2>
        <div id="httpsWarning" class="warn-banner hidden">
          Camera, mic, or screen access may be blocked on insecure origins. Use HTTPS or localhost.
        </div>
        <div class="row">
          <div class="form-field">
            <label for="cameraFacing">Camera</label>
            <select id="cameraFacing">
              <option value="environment">Rear (environment)</option>
              <option value="user">Front (selfie)</option>
            </select>
          </div>
          <div class="form-field">
            <label for="cameraToggle">Capture</label>
            <button id="cameraToggle" type="button" class="secondary">Start camera</button>
          </div>
        </div>
        <div class="row" style="margin-top: 12px;">
          <div class="form-field">
            <label>AI control <span class="info-icon" title="When enabled, the AI can auto-start the camera for its snapshot requests. When off, you must approve each AI camera request.">i</span></label>
            <div class="toggle-control">
              <button id="aiCameraToggle" type="button" class="toggle-switch" aria-pressed="false">
                <span class="toggle-dot"></span>
              </button>
              <span id="aiCameraStatus" class="muted">Off</span>
            </div>
          </div>
          <div class="form-field">
            <label>Settings auto-start <span class="info-icon" title="When enabled, the desktop Settings Start Live button will auto-start the camera. When off, you must approve the live preview request.">i</span></label>
            <div class="toggle-control">
              <button id="settingsCameraToggle" type="button" class="toggle-switch" aria-pressed="false">
                <span class="toggle-dot"></span>
              </button>
              <span id="settingsCameraStatus" class="muted">Off</span>
            </div>
          </div>
        </div>
        <div style="margin-top: 12px;">
          <video id="preview" playsinline muted></video>
        </div>
        <p class="muted" id="cameraHint">Camera will only be used when you accept a snapshot request unless AI control or Settings auto-start is enabled.</p>
        <p id="cameraError" class="error" style="display:none;"></p>
      </div>

      <div class="card" id="micCard">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"></path>
            <path d="M19 11a7 7 0 0 1-14 0"></path>
            <path d="M12 21v-3"></path>
          </svg>
          Microphone
        </h2>
        <p class="muted">Stream audio from this device's microphone.</p>
        <div class="row">
          <div class="form-field">
            <label for="micToggle">Microphone</label>
            <button id="micToggle" type="button" class="secondary">Start microphone</button>
          </div>
          <div class="form-field">
            <label>Status</label>
            <div id="micStatus" class="muted">Idle</div>
          </div>
        </div>
      </div>

      <div class="card" id="screenShareCard">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2"></rect>
            <path d="M8 20h8"></path>
            <path d="M12 16v4"></path>
          </svg>
          Screen share
        </h2>
        <p class="muted">Some browsers require a click to start screen sharing.</p>
        <div class="row">
          <div class="form-field">
            <label for="screenShareToggle">Screen</label>
            <button id="screenShareToggle" type="button" class="secondary">Start screen share</button>
          </div>
          <div class="form-field">
            <label>Status</label>
            <div id="screenShareStatus" class="muted">Idle</div>
          </div>
        </div>
        <p class="muted" id="screenShareHint" style="margin-top:8px; display:none;">Click "Start screen share" to allow capture.</p>
      </div>

      <div class="card">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12h6l2-3 3 6 2-3h5"></path>
          </svg>
          Command status
        </h2>
        <p class="muted">This device will poll for snapshot requests every few seconds once paired.</p>
        <p id="commandStatus" class="muted" style="margin-top:6px;">Waiting for pairing approval…</p>
      </div>
    </div>

    <script>
      const authCard = document.getElementById('authCard');
      const authHint = document.getElementById('authHint');
      const authInput = document.getElementById('authInput');
      const authSave = document.getElementById('authSave');
      const authValidate = document.getElementById('authValidate');
      const authClear = document.getElementById('authClear');
      const authError = document.getElementById('authError');
      const authStatus = document.getElementById('authStatus');
      const authSummaryStatus = document.getElementById('authSummaryStatus');
      const authBody = document.getElementById('authBody');
      const authToggleIcon = document.getElementById('authToggleIcon');
      let authValidated = false;

      const nodeNameInput = document.getElementById('nodeName');
      const nodeIdInput = document.getElementById('nodeId');
      const pairBtn = document.getElementById('pairBtn');
      const checkBtn = document.getElementById('checkBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      const pairStatus = document.getElementById('pairStatus');
      const pairDetails = document.getElementById('pairDetails');
      const pairError = document.getElementById('pairError');

      const cameraFacing = document.getElementById('cameraFacing');
      const cameraToggle = document.getElementById('cameraToggle');
      const preview = document.getElementById('preview');
      const cameraError = document.getElementById('cameraError');
      const aiCameraToggle = document.getElementById('aiCameraToggle');
      const aiCameraStatus = document.getElementById('aiCameraStatus');
      const settingsCameraToggle = document.getElementById('settingsCameraToggle');
      const settingsCameraStatus = document.getElementById('settingsCameraStatus');
      const commandStatus = document.getElementById('commandStatus');
      const screenShareToggle = document.getElementById('screenShareToggle');
      const screenShareStatus = document.getElementById('screenShareStatus');
      const screenShareHint = document.getElementById('screenShareHint');
      const screenShareModal = document.getElementById('screenShareModal');
      const screenShareModalText = document.getElementById('screenShareModalText');
      const screenShareModalStart = document.getElementById('screenShareModalStart');
      const screenShareModalClose = document.getElementById('screenShareModalClose');
      const micShareModal = document.getElementById('micShareModal');
      const micShareModalText = document.getElementById('micShareModalText');
      const micShareModalStart = document.getElementById('micShareModalStart');
      const micShareModalClose = document.getElementById('micShareModalClose');
      const micToggle = document.getElementById('micToggle');
      const micStatusEl = document.getElementById('micStatus');
      const livePreviewModal = document.getElementById('livePreviewModal');
      const livePreviewModalText = document.getElementById('livePreviewModalText');
      const livePreviewModalStart = document.getElementById('livePreviewModalStart');
      const livePreviewModalClose = document.getElementById('livePreviewModalClose');
      const aiCameraModal = document.getElementById('aiCameraModal');
      const aiCameraModalText = document.getElementById('aiCameraModalText');
      const aiCameraModalStart = document.getElementById('aiCameraModalStart');
      const aiCameraModalClose = document.getElementById('aiCameraModalClose');
      const companionBadgeEl = document.getElementById('companionBadge');
      let companionBadgeName = ${JSON.stringify(companionBadge || '')};

      let authMode = 'none';
      let authStorageKey = 'odm_gateway_token';
      let authValue = '';
      let nodeToken = localStorage.getItem('odm_node_token') || '';
      let aiCameraAutoStart = localStorage.getItem('odm_ai_camera_autostart') === 'true';
      let settingsCameraAutoStart = localStorage.getItem('odm_settings_camera_autostart') === 'true';
      let pollTimer = null;
      let statusPollTimer = null;
      let videoStream = null;

      function setError(el, message) {
        if (!message) {
          el.style.display = 'none';
          el.textContent = '';
          return;
        }
        el.textContent = message;
        el.style.display = 'block';
      }

      function setStatus(label, state) {
        pairStatus.textContent = label;
        pairStatus.className = 'status-pill ' + (state || 'status-unknown');
      }

      function getAuthHeaders() {
        if (!authValue) return {};
        if (authMode === 'password') {
          const encoded = btoa('opendeskmate:' + authValue);
          return { Authorization: 'Basic ' + encoded };
        }
        return { Authorization: 'Bearer ' + authValue };
      }

      function setAuthSummaryStatus(textHtml) {
        if (!authSummaryStatus) return;
        authSummaryStatus.innerHTML = textHtml || '';
      }

      async function requestJson(path, options = {}) {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}, getAuthHeaders());
        const res = await fetch(path, Object.assign({}, options, { headers }));
        if (res.status === 401) {
          setError(authError, 'Unauthorized. Check your access token or password.');
          authCard.style.display = 'block';
          authValidated = false;
          if (authStatus) {
            authStatus.innerHTML = authValue
              ? 'Token stored &bull; Not validated <span class="status-bad">&#10005;</span>'
              : '';
          }
          setAuthSummaryStatus(authValue
            ? 'Token stored &bull; Not validated <span class="status-bad">&#10005;</span>'
            : 'Enter your access token to continue');
          throw new Error('unauthorized');
        }
        if (res.status === 204) return null;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Request failed');
        }
        authValidated = true;
        if (authStatus && authValue) {
          authStatus.innerHTML = 'Token stored &bull; Validated <span class="status-ok">&#10003;</span>';
        }
        if (authValue) {
          setAuthSummaryStatus('Token stored &bull; Validated <span class="status-ok">&#10003;</span>');
        }
        return res.json();
      }

      async function loadAuthInfo() {
        try {
          const res = await fetch('/auth/info');
          const info = await res.json();
          authMode = info.mode || 'none';
        } catch {
          authMode = 'none';
        }

        authStorageKey = authMode === 'password' ? 'odm_gateway_password' : 'odm_gateway_token';
        authValue = localStorage.getItem(authStorageKey) || '';
        authInput.value = authValue;

        if (authMode === 'none') {
          authCard.style.display = 'none';
          return;
        }

        authHint.textContent = authMode === 'password'
          ? 'Enter your access password to continue.'
          : 'Enter your access token to continue.';
        authCard.style.display = 'block';
        if (authStatus) {
          authStatus.innerHTML = authValue
            ? 'Token stored &bull; Not validated <span class="status-bad">&#10005;</span>'
            : '';
        }
        setAuthSummaryStatus(authValue
          ? 'Token stored &bull; Not validated <span class="status-bad">&#10005;</span>'
          : 'Enter your access token to continue');
      }

      function getDeviceInfo() {
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || 'web';
        return {
          nodeId: nodeIdInput.value.trim(),
          displayName: nodeNameInput.value.trim() || 'Mobile companion',
          platform: 'web',
          version: 'v1',
          deviceFamily: /iphone|ipad|android/i.test(ua) ? 'mobile' : 'browser',
          modelIdentifier: platform || ua.slice(0, 80),
          caps: ['camera.snapshot', 'mic.stream', 'screen.stream'],
          commands: ['camera.snapshot', 'mic.stream.start', 'mic.stream.stop', 'screen.stream.start', 'screen.stream.stop'],
          permissions: { camera: true, mic: true, screen: true },
        };
      }

      function ensureNodeId() {
        let nodeId = localStorage.getItem('odm_node_id');
        if (!nodeId) {
          nodeId = 'node_' + Math.random().toString(36).slice(2, 10);
          localStorage.setItem('odm_node_id', nodeId);
        }
        nodeIdInput.value = nodeId;
      }

      function updateNodeName() {
        const stored = localStorage.getItem('odm_node_name') || '';
        if (stored) nodeNameInput.value = stored;
      }

      function updateHttpsWarning() {
        const warn = document.getElementById('httpsWarning');
        if (!warn) return;
        const isSecure =
          location.protocol === 'https:' ||
          location.hostname === 'localhost' ||
          location.hostname === '127.0.0.1';
        if (isSecure) {
          warn.classList.add('hidden');
        } else {
          warn.classList.remove('hidden');
        }
      }

      async function requestPairing() {
        setError(pairError, '');
        const info = getDeviceInfo();
        if (!info.nodeId) {
          setError(pairError, 'Node id is required.');
          return;
        }
        localStorage.setItem('odm_node_id', info.nodeId);
        localStorage.setItem('odm_node_name', info.displayName);
        const res = await requestJson('/nodes/pair', { method: 'POST', body: JSON.stringify(info) });
        setStatus('Pending', 'status-pending');
        pairDetails.textContent = res?.request?.requestId ? ('Request ' + res.request.requestId) : '';
        return res;
      }

      async function checkPairStatus() {
        setError(pairError, '');
        const nodeId = nodeIdInput.value.trim();
        if (!nodeId) {
          setError(pairError, 'Node id is required.');
          return;
        }
        const res = await requestJson('/nodes/pair/status?nodeId=' + encodeURIComponent(nodeId), { method: 'GET' });
        if (res?.status === 'approved') {
          setStatus('Approved', 'status-ok');
          pairDetails.textContent = res?.node?.token ? 'Token stored' : '';
          nodeToken = res?.node?.token || '';
          if (nodeToken) {
            localStorage.setItem('odm_node_token', nodeToken);
          }
          stopStatusPolling();
          startPolling();
          commandStatus.textContent = 'Paired. Waiting for snapshot requests…';
        } else if (res?.status === 'pending') {
          setStatus('Pending', 'status-pending');
          pairDetails.textContent = 'Waiting for approval';
          startStatusPolling();
        } else {
          setStatus('Unknown', 'status-unknown');
          pairDetails.textContent = '';
          stopStatusPolling();
        }
        return res;
      }

      async function cancelPairing() {
        setError(pairError, '');
        const nodeId = nodeIdInput.value.trim();
        if (!nodeId) {
          setError(pairError, 'Node id is required.');
          return;
        }
        await requestJson('/nodes/pair/cancel', {
          method: 'POST',
          body: JSON.stringify({ nodeId }),
        });
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        stopStatusPolling();
        nodeToken = '';
        localStorage.removeItem('odm_node_token');
        setStatus('Unknown', 'status-unknown');
        pairDetails.textContent = '';
        commandStatus.textContent = 'Waiting for pairing approval…';
      }

      async function startCamera() {
        setError(cameraError, '');
        if (videoStream) return;
        try {
          if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            setError(cameraError, 'Camera access is not available in this browser. Try HTTPS or a newer browser.');
            return;
          }
          const facing = cameraFacing.value || 'environment';
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing },
            audio: false,
          });
          videoStream = stream;
          preview.srcObject = stream;
          await preview.play();
          await reportCameraState(true);
          cameraToggle.textContent = 'Stop camera';
          cameraToggle.classList.remove('secondary');
          cameraToggle.classList.add('danger');
        } catch (err) {
          setError(cameraError, err && err.message ? err.message : 'Unable to access camera.');
        }
      }

      function stopCamera() {
        if (!videoStream) return;
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
        preview.srcObject = null;
        cameraToggle.textContent = 'Start camera';
        cameraToggle.classList.remove('danger');
        cameraToggle.classList.add('secondary');
        liveConsentUntil = 0;
        reportCameraState(false);
      }

      async function reportCameraState(active) {
        if (!nodeToken) return;
        try {
          await requestJson('/nodes/runtime/camera', {
            method: 'POST',
            body: JSON.stringify({
              nodeId: nodeIdInput.value.trim(),
              token: nodeToken,
              active: Boolean(active),
            }),
          });
        } catch (err) {
          console.warn('Failed to report camera state', err);
        }
      }

      async function captureSnapshot() {
        if (!videoStream) {
          await startCamera();
        }
        if (!videoStream) throw new Error('Camera not available.');
        const video = preview;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Unable to capture camera frame.');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        return dataUrl;
      }

      function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result || '';
            const base64 = typeof result === 'string' ? result.split(',')[1] || '' : '';
            resolve(base64);
          };
          reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
          reader.readAsDataURL(blob);
        });
      }

      async function postStreamChunk(kind, streamId, blob) {
        const base64 = await blobToBase64(blob);
        await requestJson('/nodes/stream/chunk', {
          method: 'POST',
          body: JSON.stringify({
            nodeId: nodeIdInput.value.trim(),
            token: nodeToken,
            streamId,
            kind,
            mime: blob.type || (kind === 'mic' ? 'audio/webm' : 'video/webm'),
            dataBase64: base64,
          }),
        });
      }

      let micStream = null;
      let micRecorder = null;
      let micStreamId = null;

      let pendingScreenCommand = null;
      let pendingScreenStreamId = null;
      let pendingScreenChunkMs = null;
      let pendingMicCommand = null;
      let pendingMicStreamId = null;
      let pendingMicChunkMs = null;
      let pendingLiveCommand = null;
      let pendingAiCommand = null;
      let liveConsentUntil = 0;
      let liveDeclineUntil = 0;
      let aiConsentUntil = 0;
      let aiDeclineUntil = 0;

      function updateToggleUI(toggleEl, statusEl, enabled) {
        if (toggleEl) {
          toggleEl.classList.toggle('on', enabled);
          toggleEl.setAttribute('aria-pressed', enabled ? 'true' : 'false');
          const dot = toggleEl.querySelector('.toggle-dot');
          if (dot) {
            dot.style.transform = enabled ? 'translateX(14px)' : 'translateX(2px)';
          }
        }
        if (statusEl) {
          statusEl.textContent = enabled ? 'On' : 'Off';
        }
      }

      async function startMicStream(streamId, chunkMs) {
        if (micRecorder) return;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          throw new Error('Mic access is not available in this browser.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStream = stream;
        const options = {};
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options.mimeType = 'audio/webm;codecs=opus';
        }
        const recorder = new MediaRecorder(stream, options);
        micRecorder = recorder;
        micStreamId = streamId;
        recorder.ondataavailable = async (event) => {
          if (!event.data || event.data.size === 0) return;
          try {
            await postStreamChunk('mic', streamId, event.data);
          } catch (err) {
            console.warn('Failed to send mic chunk', err);
          }
        };
        recorder.start(Math.max(500, Number(chunkMs) || 1500));
        updateMicToggleUI();
      }

      function stopMicStream() {
        if (micRecorder) {
          micRecorder.stop();
          micRecorder = null;
        }
        if (micStream) {
          micStream.getTracks().forEach(track => track.stop());
          micStream = null;
        }
        micStreamId = null;
        updateMicToggleUI();
      }

      function updateMicToggleUI() {
        if (micToggle) micToggle.textContent = micRecorder ? 'Stop microphone' : 'Start microphone';
        if (micStatusEl) micStatusEl.textContent = micRecorder ? 'Streaming' : 'Idle';
      }

      let screenStream = null;
      let screenRecorder = null;
      let screenStreamId = null;

      function showScreenShareModal() {
        if (!screenShareModal || !screenShareModalText) return;
        const badgeName = companionBadgeName || ${JSON.stringify(companionBadge || 'Open Deskmate')};
        screenShareModalText.textContent =
          '"' + badgeName + '" has asked to share your screen. Push Start screen share and pick a screen to share to start sharing.';
        screenShareModal.style.display = 'flex';
      }

      function hideScreenShareModal() {
        if (!screenShareModal) return;
        screenShareModal.style.display = 'none';
      }

      function showMicShareModal() {
        if (!micShareModal || !micShareModalText) return;
        const badgeName = companionBadgeName || ${JSON.stringify(companionBadge || 'Open Deskmate')};
        micShareModalText.textContent =
          '"' + badgeName + '" has asked to access your microphone. Push Start microphone to begin streaming audio.';
        micShareModal.style.display = 'flex';
      }

      function hideMicShareModal() {
        if (!micShareModal) return;
        micShareModal.style.display = 'none';
      }

      function showLivePreviewModal() {
        if (!livePreviewModal || !livePreviewModalText) return;
        const badgeName = companionBadgeName || ${JSON.stringify(companionBadge || 'Open Deskmate')};
        livePreviewModalText.textContent =
          'Camera preview request "' + badgeName + '" has asked to view your camera preview. Push start camera to allow camera preview.';
        livePreviewModal.style.display = 'flex';
      }

      function showAiCameraModal() {
        if (!aiCameraModal || !aiCameraModalText) return;
        const badgeName = companionBadgeName || ${JSON.stringify(companionBadge || 'Open Deskmate')};
        aiCameraModalText.textContent =
          '"' + badgeName + '" AI has requested a camera snapshot. Push Start camera to allow access.';
        aiCameraModal.style.display = 'flex';
      }

      async function refreshCompanionBadge() {
        try {
          const info = await requestJson('/nodes/companion/info', { method: 'GET' });
          if (info && typeof info.badgeName === 'string') {
            companionBadgeName = info.badgeName.trim();
            if (companionBadgeEl) {
              if (companionBadgeName) {
                companionBadgeEl.textContent = companionBadgeName;
                companionBadgeEl.classList.remove('hidden');
              } else {
                companionBadgeEl.textContent = '';
                companionBadgeEl.classList.add('hidden');
              }
            }
          }
        } catch {
          // ignore badge refresh failures
        }
      }

      function hideLivePreviewModal() {
        if (!livePreviewModal) return;
        livePreviewModal.style.display = 'none';
      }

      function hideAiCameraModal() {
        if (!aiCameraModal) return;
        aiCameraModal.style.display = 'none';
      }

      async function startScreenStream(streamId, chunkMs) {
        if (screenRecorder) return;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
          throw new Error('Screen capture is not available in this browser.');
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 15, max: 30 },
          },
          audio: false,
        });
        screenStream = stream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          track.onended = () => {
            stopScreenStream();
            screenShareStatus.textContent = 'Screen share ended';
            hideScreenShareModal();
          };
        }
        const options = {
          videoBitsPerSecond: 3_500_000,
        };
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
          options.mimeType = 'video/webm;codecs=vp8';
        }
        const recorder = new MediaRecorder(stream, options);
        screenRecorder = recorder;
        screenStreamId = streamId;
        recorder.ondataavailable = async (event) => {
          if (!event.data || event.data.size === 0) return;
          try {
            await postStreamChunk('screen', streamId, event.data);
          } catch (err) {
            console.warn('Failed to send screen chunk', err);
          }
        };
        recorder.onstart = () => {
          screenShareToggle.textContent = 'Stop screen share';
          screenShareToggle.classList.remove('secondary');
          screenShareToggle.classList.add('danger');
          screenShareStatus.textContent = 'Sharing…';
          screenShareHint.style.display = 'none';
        };
        recorder.onstop = () => {
          screenShareToggle.textContent = 'Start screen share';
          screenShareToggle.classList.remove('danger');
          screenShareToggle.classList.add('secondary');
          if (screenShareStatus.textContent === 'Sharing…') {
            screenShareStatus.textContent = 'Stopped';
          }
          hideScreenShareModal();
        };
        recorder.start(Math.max(700, Number(chunkMs) || 1500));
      }

      function stopScreenStream() {
        if (screenRecorder) {
          screenRecorder.stop();
          screenRecorder = null;
        }
        if (screenStream) {
          screenStream.getTracks().forEach(track => track.stop());
          screenStream = null;
        }
        screenStreamId = null;
      }

      async function resolveScreenShareCommand(command, streamId, chunkMs) {
        try {
          await startScreenStream(streamId, chunkMs);
          await requestJson('/nodes/commands/result', {
            method: 'POST',
            body: JSON.stringify({
              nodeId: nodeIdInput.value.trim(),
              token: nodeToken,
              id: command.id,
              ok: true,
              payload: { streamId },
            }),
          });
          commandStatus.textContent = 'Screen streaming.';
          pendingScreenCommand = null;
          pendingScreenStreamId = null;
          pendingScreenChunkMs = null;
        } catch (err) {
          await requestJson('/nodes/commands/result', {
            method: 'POST',
            body: JSON.stringify({
              nodeId: nodeIdInput.value.trim(),
              token: nodeToken,
              id: command.id,
              ok: false,
              error: err && err.message ? err.message : 'Screen stream failed',
            }),
          });
          commandStatus.textContent = 'Screen stream failed.';
          screenShareStatus.textContent = 'Failed';
          pendingScreenCommand = null;
          pendingScreenStreamId = null;
          pendingScreenChunkMs = null;
        }
      }

      async function handleCommand(command) {
        if (!command || !command.id) return;
        if (command.command === 'camera.snapshot') {
          commandStatus.textContent = 'Capturing snapshot…';
          try {
            if (command.params?.target === 'live' && Date.now() > liveConsentUntil && !settingsCameraAutoStart) {
              if (Date.now() < liveDeclineUntil) {
                await requestJson('/nodes/commands/result', {
                  method: 'POST',
                  body: JSON.stringify({
                    nodeId: nodeIdInput.value.trim(),
                    token: nodeToken,
                    id: command.id,
                    ok: false,
                    error: 'Live preview consent declined',
                  }),
                });
                return;
              }
              pendingLiveCommand = command;
              showLivePreviewModal();
              commandStatus.textContent = 'Awaiting live preview consent…';
              return;
            }
            if (command.params?.target !== 'live' && Date.now() > aiConsentUntil && !aiCameraAutoStart) {
              if (Date.now() < aiDeclineUntil) {
                await requestJson('/nodes/commands/result', {
                  method: 'POST',
                  body: JSON.stringify({
                    nodeId: nodeIdInput.value.trim(),
                    token: nodeToken,
                    id: command.id,
                    ok: false,
                    error: 'AI camera consent declined',
                  }),
                });
                return;
              }
              pendingAiCommand = command;
              showAiCameraModal();
              commandStatus.textContent = 'Awaiting AI camera consent…';
              return;
            }
            const dataUrl = await captureSnapshot();
            const base64 = dataUrl.split(',')[1] || '';
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: command.id,
                ok: true,
                payload: { mime: 'image/jpeg', dataBase64: base64 },
              }),
            });
            commandStatus.textContent = 'Snapshot delivered.';
            if (command.params?.target === 'live' && settingsCameraAutoStart) {
              liveConsentUntil = Date.now() + 5 * 60 * 1000;
            }
            if (command.params?.target !== 'live' && aiCameraAutoStart) {
              aiConsentUntil = Date.now() + 5 * 60 * 1000;
            }
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: command.id,
                ok: false,
                error: err && err.message ? err.message : 'Snapshot failed',
              }),
            });
            commandStatus.textContent = 'Snapshot failed.';
          }
          return;
        }
        if (command.command === 'mic.stream.start') {
          commandStatus.textContent = 'Starting mic stream…';
          try {
            const streamId = command.params?.streamId || command.params?.streamID || command.params?.id || command.id;
            pendingMicCommand = command;
            pendingMicStreamId = streamId;
            pendingMicChunkMs = command.params?.chunkMs;
            showMicShareModal();
            commandStatus.textContent = 'Awaiting microphone consent…';
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: command.id,
                ok: false,
                error: err && err.message ? err.message : 'Mic stream failed',
              }),
            });
            commandStatus.textContent = 'Mic stream failed.';
          }
          return;
        }
        if (command.command === 'mic.stream.stop') {
          stopMicStream();
          await requestJson('/nodes/commands/result', {
            method: 'POST',
            body: JSON.stringify({
              nodeId: nodeIdInput.value.trim(),
              token: nodeToken,
              id: command.id,
              ok: true,
              payload: { streamId: micStreamId },
            }),
          });
          commandStatus.textContent = 'Mic stream stopped.';
          return;
        }
        if (command.command === 'screen.stream.start') {
          commandStatus.textContent = 'Starting screen stream…';
          try {
            const streamId = command.params?.streamId || command.params?.streamID || command.params?.id || command.id;
            if (screenRecorder) {
              await requestJson('/nodes/commands/result', {
                method: 'POST',
                body: JSON.stringify({
                  nodeId: nodeIdInput.value.trim(),
                  token: nodeToken,
                  id: command.id,
                  ok: true,
                  payload: { streamId: screenStreamId || streamId },
                }),
              });
              commandStatus.textContent = 'Screen streaming.';
              return;
            }
            pendingScreenCommand = command;
            pendingScreenStreamId = streamId;
            pendingScreenChunkMs = command.params?.chunkMs;
            screenShareStatus.textContent = 'Awaiting consent';
            screenShareHint.style.display = 'block';
            screenShareToggle.focus();
            showScreenShareModal();
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: command.id,
                ok: false,
                error: err && err.message ? err.message : 'Screen stream failed',
              }),
            });
            commandStatus.textContent = 'Screen stream failed.';
          }
          return;
        }
        if (command.command === 'screen.stream.stop') {
          stopScreenStream();
          await requestJson('/nodes/commands/result', {
            method: 'POST',
            body: JSON.stringify({
              nodeId: nodeIdInput.value.trim(),
              token: nodeToken,
              id: command.id,
              ok: true,
              payload: { streamId: screenStreamId },
            }),
          });
          commandStatus.textContent = 'Screen stream stopped.';
          return;
        }
        await requestJson('/nodes/commands/result', {
          method: 'POST',
          body: JSON.stringify({
            nodeId: nodeIdInput.value.trim(),
            token: nodeToken,
            id: command.id,
            ok: false,
            error: 'Unsupported command',
          }),
        });
      }

      async function pollCommands() {
        if (!nodeToken) return;
        try {
          const res = await requestJson('/nodes/commands?nodeId=' + encodeURIComponent(nodeIdInput.value.trim()) + '&token=' + encodeURIComponent(nodeToken), { method: 'GET' });
          if (res) {
            await handleCommand(res);
          }
        } catch (err) {
          if (String(err && err.message) === 'unauthorized') return;
          console.warn('Command poll failed', err);
        }
      }

      function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(pollCommands, 3000);
      }

      function startStatusPolling() {
        if (statusPollTimer) return;
        statusPollTimer = setInterval(() => {
          checkPairStatus().catch(err => {
            if (String(err && err.message) === 'unauthorized') return;
            console.warn('Status poll failed', err);
          });
        }, 2500);
      }

      function stopStatusPolling() {
        if (!statusPollTimer) return;
        clearInterval(statusPollTimer);
        statusPollTimer = null;
      }

      authSave.addEventListener('click', async () => {
        authValue = authInput.value.trim();
        if (!authValue) {
          setError(authError, 'Enter a value first.');
          return;
        }
        localStorage.setItem(authStorageKey, authValue);
        setError(authError, '');
        authValidated = false;
        if (authStatus) authStatus.innerHTML = 'Token stored &bull; Not validated <span class="status-bad">&#10005;</span>';
        setAuthSummaryStatus('Token stored &bull; Not validated <span class="status-bad">&#10005;</span>');
      });

      authValidate.addEventListener('click', async () => {
        authValue = authInput.value.trim();
        if (!authValue) {
          setError(authError, 'Enter a value first.');
          return;
        }
        localStorage.setItem(authStorageKey, authValue);
        setError(authError, '');
        authValidated = false;
        if (authStatus) authStatus.innerHTML = 'Token stored &bull; Not validated <span class="status-bad">&#10005;</span>';
        setAuthSummaryStatus('Token stored &bull; Not validated <span class="status-bad">&#10005;</span>');
        try {
          await requestJson('/nodes/pair/status?nodeId=' + encodeURIComponent(nodeIdInput.value.trim()), { method: 'GET' });
        } catch (err) {
          if (String(err && err.message) !== 'unauthorized') {
            console.warn('Token validation failed', err);
          }
        }
      });

      authClear.addEventListener('click', () => {
        localStorage.removeItem(authStorageKey);
        authValue = '';
        authInput.value = '';
        setError(authError, '');
        authValidated = false;
        if (authStatus) authStatus.innerHTML = '';
        setAuthSummaryStatus('Enter your access token to continue');
      });

      pairBtn.addEventListener('click', () => requestPairing().then(() => {
        startStatusPolling();
        return checkPairStatus();
      }).catch(err => {
        if (String(err && err.message) === 'unauthorized') return;
        setError(pairError, err.message || 'Pairing failed');
      }));

      checkBtn.addEventListener('click', () => checkPairStatus().catch(err => {
        if (String(err && err.message) === 'unauthorized') return;
        setError(pairError, err.message || 'Status check failed');
      }));

      cancelBtn.addEventListener('click', () => cancelPairing().catch(err => {
        if (String(err && err.message) === 'unauthorized') return;
        setError(pairError, err.message || 'Cancel failed');
      }));

      nodeNameInput.addEventListener('change', () => {
        localStorage.setItem('odm_node_name', nodeNameInput.value.trim());
      });

      cameraToggle.addEventListener('click', () => {
        if (videoStream) {
          stopCamera();
        } else {
          startCamera();
        }
      });

      screenShareToggle.addEventListener('click', async () => {
        if (!nodeToken) {
          screenShareStatus.textContent = 'Pair first';
          return;
        }
        if (screenRecorder) {
          stopScreenStream();
          screenShareStatus.textContent = 'Stopped';
          return;
        }
        if (pendingScreenCommand && pendingScreenStreamId) {
          await resolveScreenShareCommand(pendingScreenCommand, pendingScreenStreamId, pendingScreenChunkMs);
          hideScreenShareModal();
          return;
        }
        try {
          await startScreenStream('manual-' + Date.now(), 1500);
        } catch (err) {
          screenShareStatus.textContent = err && err.message ? err.message : 'Unable to start screen share';
        }
      });

      micToggle.addEventListener('click', async () => {
        if (!nodeToken) {
          if (micStatusEl) micStatusEl.textContent = 'Pair first';
          return;
        }
        if (micRecorder) {
          stopMicStream();
          if (micStatusEl) micStatusEl.textContent = 'Stopped';
          return;
        }
        if (pendingMicCommand && pendingMicStreamId) {
          try {
            await startMicStream(pendingMicStreamId, pendingMicChunkMs);
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingMicCommand.id,
                ok: true,
                payload: { streamId: pendingMicStreamId },
              }),
            });
            commandStatus.textContent = 'Mic streaming.';
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingMicCommand.id,
                ok: false,
                error: err && err.message ? err.message : 'Mic stream failed',
              }),
            });
            if (micStatusEl) micStatusEl.textContent = 'Failed';
            commandStatus.textContent = 'Mic stream failed.';
          }
          pendingMicCommand = null;
          pendingMicStreamId = null;
          pendingMicChunkMs = null;
          hideMicShareModal();
          return;
        }
        try {
          await startMicStream('manual-' + Date.now(), 1500);
          if (micStatusEl) micStatusEl.textContent = 'Streaming';
        } catch (err) {
          if (micStatusEl) micStatusEl.textContent = err && err.message ? err.message : 'Unable to start microphone';
        }
      });

      screenShareModalStart.addEventListener('click', async () => {
        if (pendingScreenCommand && pendingScreenStreamId) {
          await resolveScreenShareCommand(pendingScreenCommand, pendingScreenStreamId, pendingScreenChunkMs);
        }
        hideScreenShareModal();
      });

      screenShareModalClose.addEventListener('click', () => {
        hideScreenShareModal();
      });

      micShareModalStart.addEventListener('click', async () => {
        if (pendingMicCommand && pendingMicStreamId) {
          try {
            await startMicStream(pendingMicStreamId, pendingMicChunkMs);
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingMicCommand.id,
                ok: true,
                payload: { streamId: pendingMicStreamId },
              }),
            });
            commandStatus.textContent = 'Mic streaming.';
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingMicCommand.id,
                ok: false,
                error: err && err.message ? err.message : 'Mic stream failed',
              }),
            });
            commandStatus.textContent = 'Mic stream failed.';
          }
        }
        pendingMicCommand = null;
        pendingMicStreamId = null;
        pendingMicChunkMs = null;
        hideMicShareModal();
      });

      micShareModalClose.addEventListener('click', () => {
        hideMicShareModal();
      });

      livePreviewModalStart.addEventListener('click', async () => {
        if (pendingLiveCommand) {
          try {
            await startCamera();
            const dataUrl = await captureSnapshot();
            const base64 = dataUrl.split(',')[1] || '';
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingLiveCommand.id,
                ok: true,
                payload: { mime: 'image/jpeg', dataBase64: base64 },
              }),
            });
            commandStatus.textContent = 'Snapshot delivered.';
            liveConsentUntil = Date.now() + 5 * 60 * 1000;
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingLiveCommand.id,
                ok: false,
                error: err && err.message ? err.message : 'Snapshot failed',
              }),
            });
            commandStatus.textContent = 'Snapshot failed.';
          }
        }
        pendingLiveCommand = null;
        hideLivePreviewModal();
      });

      livePreviewModalClose.addEventListener('click', () => {
        liveDeclineUntil = Date.now() + 60 * 1000;
        hideLivePreviewModal();
      });

      aiCameraModalStart.addEventListener('click', async () => {
        if (pendingAiCommand) {
          try {
            await startCamera();
            const dataUrl = await captureSnapshot();
            const base64 = dataUrl.split(',')[1] || '';
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingAiCommand.id,
                ok: true,
                payload: { mime: 'image/jpeg', dataBase64: base64 },
              }),
            });
            commandStatus.textContent = 'Snapshot delivered.';
            aiConsentUntil = Date.now() + 5 * 60 * 1000;
          } catch (err) {
            await requestJson('/nodes/commands/result', {
              method: 'POST',
              body: JSON.stringify({
                nodeId: nodeIdInput.value.trim(),
                token: nodeToken,
                id: pendingAiCommand.id,
                ok: false,
                error: err && err.message ? err.message : 'Snapshot failed',
              }),
            });
            commandStatus.textContent = 'Snapshot failed.';
          }
        }
        pendingAiCommand = null;
        hideAiCameraModal();
      });

      aiCameraModalClose.addEventListener('click', () => {
        aiDeclineUntil = Date.now() + 60 * 1000;
        hideAiCameraModal();
      });

      function updateAuthCollapse(collapsed) {
        if (!authToggleIcon || !authBody || !authSummaryStatus) return;
        authBody.style.display = collapsed ? 'none' : 'block';
        authSummaryStatus.style.display = collapsed ? 'inline' : 'none';
        authToggleIcon.title = collapsed ? 'Expand' : 'Collapse';
        authToggleIcon.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }

      if (authToggleIcon) {
        authToggleIcon.addEventListener('click', (event) => {
          event.preventDefault();
          const isCollapsed = authBody.style.display === 'none';
          updateAuthCollapse(!isCollapsed);
        });
      }

      ensureNodeId();
      updateNodeName();
      updateHttpsWarning();
      refreshCompanionBadge();

      updateToggleUI(aiCameraToggle, aiCameraStatus, aiCameraAutoStart);
      updateToggleUI(settingsCameraToggle, settingsCameraStatus, settingsCameraAutoStart);

      if (aiCameraToggle) {
        aiCameraToggle.addEventListener('click', () => {
          aiCameraAutoStart = !aiCameraAutoStart;
          localStorage.setItem('odm_ai_camera_autostart', String(aiCameraAutoStart));
          updateToggleUI(aiCameraToggle, aiCameraStatus, aiCameraAutoStart);
        });
      }

      if (settingsCameraToggle) {
        settingsCameraToggle.addEventListener('click', () => {
          settingsCameraAutoStart = !settingsCameraAutoStart;
          localStorage.setItem('odm_settings_camera_autostart', String(settingsCameraAutoStart));
          updateToggleUI(settingsCameraToggle, settingsCameraStatus, settingsCameraAutoStart);
        });
      }
      if (nodeToken) {
        startPolling();
        commandStatus.textContent = 'Paired. Waiting for snapshot requests…';
        setStatus('Approved', 'status-ok');
        pairDetails.textContent = 'Token stored';
      }
      loadAuthInfo()
        .then(() => checkPairStatus().catch(err => {
          if (String(err && err.message) === 'unauthorized') return;
          console.warn('Initial status check failed', err);
        }))
        .then(() => { updateAuthCollapse(Boolean(authValidated && authValue)); });
    </script>
  </body>
</html>`;
}

export function startWebhookServer(): http.Server {
  const gatewayWss = new WebSocketServer({ noServer: true });

  gatewayWss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (raw) => {
      let request: GatewayRpcRequest;
      try {
        request = JSON.parse(raw.toString()) as GatewayRpcRequest;
      } catch {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Invalid JSON' },
        }));
        return;
      }

      const result = await executeGatewayRpc(request);
      const response = result.error
        ? { jsonrpc: '2.0', id: request.id ?? null, error: result.error }
        : { jsonrpc: '2.0', id: request.id ?? null, result: result.result ?? null };
      ws.send(JSON.stringify(response));
    });
  });

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: 'Invalid request' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url, getWebhookLocalUrl());
    if (shouldMarkWebchatActivity(url.pathname)) {
      markWebchatActivity();
    }

    if (
      req.method === 'GET'
      && (
        url.pathname === '/favicon.ico'
        || url.pathname === '/favicon.png'
        || url.pathname === '/apple-touch-icon.png'
      )
    ) {
      sendFavicon(res);
      return;
    }

    const isNodePairEndpoint =
      url.pathname === '/nodes/pair' || url.pathname === '/nodes/pair/status';
    const isNodeEndpoint = url.pathname.startsWith('/nodes/');
    if (isNodeEndpoint && !getMobileNodesEnabled()) {
      sendJson(res, 403, { error: 'mobile_nodes_disabled' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      sendHtml(res, renderWebchatPage());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/nodes/companion') {
      sendHtml(res, renderNodeCompanionPage());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/nodes/companion/info') {
      sendJson(res, 200, { badgeName: getMobileNodesDisplayName() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/info') {
      sendJson(res, 200, {
        mode: gatewayAuth.mode,
        allowTailscale: gatewayAuth.allowTailscale,
        tailscaleMode: gatewayAuth.tailscaleMode,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/opendeskmate/callback') {
      const callbackUrl = new URL(req.url, getRequestOrigin(req)).toString();
      const status = await handleAppConnectorOAuthCallback(callbackUrl);
      if (status?.status === 'completed') {
        sendHtml(res, renderOAuthCallbackPage('success', 'OAuth connection completed and token stored.'));
        return;
      }
      const errorDetail = status?.detail || 'OAuth callback failed or the flow expired. Start the OAuth flow again from Settings.';
      sendHtml(res, renderOAuthCallbackPage('error', errorDetail));
      return;
    }

    const isPublic =
      req.method === 'GET' &&
      (url.pathname === '/' ||
        url.pathname === '/auth/info' ||
        url.pathname === '/health' ||
        url.pathname === '/nodes/companion/info');
    const allowLocalPairing = isNodePairEndpoint && isLocalDirectRequest(req);
    if (!isPublic && !allowLocalPairing) {
      const authResult = authorizeGatewayRequest(req);
      if (!authResult.ok) {
        sendAuthError(res, authResult.reason);
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/usage/summary') {
      const rawPeriod = String(url.searchParams.get('period') || 'day').trim().toLowerCase();
      const period: UsagePeriod =
        rawPeriod === 'week' || rawPeriod === 'month'
          ? rawPeriod
          : 'day';
      sendJson(res, 200, getUsageSummary(period));
      return;
    }

    // ========== FOLDER API ENDPOINTS ==========
    if (req.method === 'GET' && url.pathname === '/folders') {
      sendJson(res, 200, { folders: getFoldersForAgent(resolveActiveAgentId()), assignments: getTaskFolderAssignments() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/folders') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as { name?: string; color?: string; icon?: string };
        if (!payload.name) {
          sendJson(res, 400, { error: 'name is required' });
          return;
        }
        const folder = createFolder({ name: payload.name, color: payload.color, icon: payload.icon }, resolveActiveAgentId());
        sendJson(res, 201, folder);
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      return;
    }

    if (req.method === 'PUT' && /^\/folders\/[^/]+$/.test(url.pathname)) {
      try {
        const folderId = url.pathname.split('/')[2];
        const body = await parseJsonBody(req);
        const payload = body as { name?: string; color?: string; icon?: string; isExpanded?: boolean };
        const folder = updateFolder(folderId, payload);
        if (!folder) {
          sendJson(res, 404, { error: 'Folder not found' });
          return;
        }
        sendJson(res, 200, folder);
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      return;
    }

    if (req.method === 'DELETE' && /^\/folders\/[^/]+$/.test(url.pathname)) {
      const folderId = url.pathname.split('/')[2];
      const folder = getFolder(folderId);
      if (!folder) {
        sendJson(res, 404, { error: 'Folder not found' });
        return;
      }
      deleteFolder(folderId);
      sendJson(res, 200, { success: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/folders/assign') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as { taskId?: string; folderId?: string | null };
        if (!payload.taskId) {
          sendJson(res, 400, { error: 'taskId is required' });
          return;
        }
        setTaskFolder(payload.taskId, payload.folderId || null);
        sendJson(res, 200, { success: true });
      } catch (err) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      return;
    }

    // ========== TASK API ENDPOINTS ==========
    if (req.method === 'GET' && url.pathname === '/tasks') {
      sendJson(res, 200, getTasks(resolveActiveAgentId()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/context/estimate') {
      try {
        const body = asRecord(await parseJsonBody(req));
        const stats = await estimateWebchatContext(body);
        sendJson(res, 200, { stats });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid context estimate payload' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/permissions') {
      const taskId = url.searchParams.get('taskId') || undefined;
      sendJson(res, 200, listWebPermissionRequests(taskId));
      return;
    }

    if (req.method === 'POST' && /^\/permissions\/[^/]+$/.test(url.pathname)) {
      try {
        const requestId = url.pathname.split('/')[2];
        const body = await parseJsonBody(req);
        const payload = body as { taskId?: string; decision?: 'allow' | 'allow_all' | 'deny'; message?: string; selectedOptions?: string[] };
        if (!payload.taskId || !payload.decision) {
          sendJson(res, 400, { error: 'taskId and decision are required' });
          return;
        }
        const result = await resolveWebPermissionResponse({
          requestId,
          taskId: payload.taskId,
          decision: payload.decision,
          message: payload.message,
          selectedOptions: payload.selectedOptions,
        });
        if (!result.ok) {
          sendJson(res, 400, { error: result.error || 'Failed to resolve permission' });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to resolve permission' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/agents') {
      sendJson(res, 200, {
        agents: listAgents(),
        defaultAgentId: getDefaultAgentId(),
        activeAgentId: resolveActiveAgentId(),
        selectedModel: getSelectedModel(),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/agents/set-active') {
      try {
        const parsed = await parseJsonBody(req) as { agentId?: string };
        const agentId = typeof parsed.agentId === 'string' ? parsed.agentId.trim() : '';
        if (!agentId) {
          sendJson(res, 400, { error: 'agentId is required' });
          return;
        }
        const agent = getAgent(agentId);
        if (!agent) {
          sendJson(res, 404, { error: 'Agent not found' });
          return;
        }
        setActiveAgentId(agent.id);
        sendJson(res, 200, { ok: true, activeAgentId: agent.id });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to set active agent' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/saved-prompts') {
      sendJson(res, 200, { prompts: listSavedPrompts() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/saved-prompts') {
      try {
        const body = asRecord(await parseJsonBody(req));
        const id = String(body.id ?? '').trim();
        const title = String(body.title ?? '').trim();
        const content = String(body.content ?? '').trim();
        const createdAt = String(body.createdAt ?? '').trim();
        const updatedAt = String(body.updatedAt ?? '').trim();
        if (!title || !content) {
          sendJson(res, 400, { error: 'title and content are required' });
          return;
        }
        const prompt = upsertSavedPrompt({
          id: id || undefined,
          title,
          content,
          createdAt: createdAt || undefined,
          updatedAt: updatedAt || undefined,
        });
        sendJson(res, 200, { prompt });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
      }
      return;
    }

    if (req.method === 'DELETE' && /^\/saved-prompts\/[^/]+$/.test(url.pathname)) {
      const promptId = decodeURIComponent(url.pathname.split('/')[2] ?? '').trim();
      if (!promptId) {
        sendJson(res, 400, { error: 'id is required' });
        return;
      }
      sendJson(res, 200, { ok: deleteSavedPrompt(promptId) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/gateway/bindings') {
      sendJson(res, 200, { bindings: listGatewayBindings() });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/gateway/bindings') {
      try {
        const body = asRecord(await parseJsonBody(req));
        const bindings = Array.isArray(body.bindings) ? body.bindings as GatewayRouteBinding[] : [];
        const next = setGatewayBindings(bindings);
        sendJson(res, 200, { bindings: next });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid gateway bindings payload' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/gateway/bindings') {
      try {
        const body = await parseJsonBody(req);
        const binding = upsertGatewayBinding(body as GatewayRouteBinding);
        sendJson(res, 200, { binding });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid gateway binding payload' });
      }
      return;
    }

    if (req.method === 'DELETE' && /^\/gateway\/bindings\/[^/]+$/.test(url.pathname)) {
      const bindingId = decodeURIComponent(url.pathname.split('/')[3] ?? '');
      const removed = removeGatewayBinding(bindingId);
      if (!removed) {
        sendJson(res, 404, { error: 'Binding not found' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/gateway/sessions') {
      const agentId = readOptionalString(url.searchParams.get('agentId') ?? undefined, 128);
      sendJson(res, 200, { sessions: listGatewaySessions(agentId) });
      return;
    }

    if (req.method === 'GET' && /^\/gateway\/sessions\/[^/]+$/.test(url.pathname)) {
      const sessionKey = normalizeSessionKey(decodeURIComponent(url.pathname.split('/')[3] ?? ''));
      if (!sessionKey) {
        sendJson(res, 400, { error: 'sessionKey is required' });
        return;
      }
      sendJson(res, 200, { session: getGatewaySession(sessionKey) ?? null });
      return;
    }

    if (req.method === 'DELETE' && /^\/gateway\/sessions\/[^/]+$/.test(url.pathname)) {
      const sessionKey = normalizeSessionKey(decodeURIComponent(url.pathname.split('/')[3] ?? ''));
      if (!sessionKey) {
        sendJson(res, 400, { error: 'sessionKey is required' });
        return;
      }
      const removed = deleteGatewaySession(sessionKey);
      if (!removed) {
        sendJson(res, 404, { error: 'Session not found' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/gateway/runs') {
      const agentId = readOptionalString(url.searchParams.get('agentId') ?? undefined, 128);
      const sessionKey = normalizeSessionKey(url.searchParams.get('sessionKey') ?? undefined);
      const status = readOptionalString(url.searchParams.get('status') ?? undefined, 32)?.toLowerCase();
      const runs = listGatewayRuns(agentId).filter((run) => {
        if (sessionKey && run.sessionKey !== sessionKey) return false;
        if (status && run.status !== status) return false;
        return true;
      });
      sendJson(res, 200, { runs });
      return;
    }

    if (req.method === 'GET' && /^\/gateway\/runs\/[^/]+$/.test(url.pathname)) {
      const runId = decodeURIComponent(url.pathname.split('/')[3] ?? '');
      const run = getGatewayRun(runId);
      if (!run) {
        sendJson(res, 404, { error: 'Run not found' });
        return;
      }
      sendJson(res, 200, { run });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/gateway/rpc') {
      try {
        const body = asRecord(await parseJsonBody(req)) as GatewayRpcRequest;
        const rpcResult = await executeGatewayRpc(body);
        if (rpcResult.error) {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: body.id ?? null,
            error: rpcResult.error,
          });
          return;
        }
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: body.id ?? null,
          result: rpcResult.result ?? null,
        });
      } catch (error) {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: error instanceof Error ? error.message : 'Invalid JSON body',
          },
        });
      }
      return;
    }

    if (req.method === 'POST' && /^\/tasks\/[^/]+\/interrupt$/.test(url.pathname)) {
      try {
        const taskId = url.pathname.split('/')[2];
        const interrupted = await interruptTaskById(taskId);
        if (!interrupted.ok) {
          sendJson(res, interrupted.status, { error: interrupted.error ?? 'Failed to interrupt task' });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to interrupt task' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/tasks/')) {
      const taskId = url.pathname.replace('/tasks/', '');
      const agentId = readOptionalString(url.searchParams.get('agentId') ?? undefined, 128);
      const task = findTaskAcrossAgents(taskId, agentId);
      if (!task) {
        sendJson(res, 404, { error: 'Task not found' });
        return;
      }
      sendJson(res, 200, task);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/tasks') {
      try {
        const payload = asRecord(await parseJsonBody(req));
        const result = await startGatewayTask(payload);
        sendJson(res, 200, {
          ok: true,
          taskId: result.taskId,
          agentId: result.agentId,
          sessionKey: result.sessionKey,
          matchedBy: result.matchedBy,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start task';
        const status = getGatewayErrorStatus(error, 500);
        sendJson(res, status, { error: message });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/webchat/uploads') {
      try {
        const payload = asRecord(await parseJsonBody(req));
        const fileName = sanitizeUploadFileName(
          readOptionalString(payload.filename, 256)
          ?? readOptionalString(payload.name, 256)
          ?? 'attachment.bin'
        );
        const dataBase64 = readOptionalString(payload.dataBase64, 40_000_000);
        if (!dataBase64) {
          sendJson(res, 400, { error: 'dataBase64 is required' });
          return;
        }
        const binary = Buffer.from(dataBase64, 'base64');
        if (!binary.length) {
          sendJson(res, 400, { error: 'Attachment content is empty' });
          return;
        }
        if (binary.length > MAX_WEBCHAT_UPLOAD_BYTES) {
          sendJson(res, 413, { error: `Attachment exceeds ${Math.floor(MAX_WEBCHAT_UPLOAD_BYTES / (1024 * 1024))}MB limit` });
          return;
        }
        ensureWebchatUploadDir();
        const saveName = `${Date.now()}_${randomUUID().slice(0, 8)}_${fileName}`;
        const savePath = path.join(WEBCHAT_UPLOAD_DIR, saveName);
        fs.writeFileSync(savePath, binary);
        sendJson(res, 200, {
          ok: true,
          file: {
            path: savePath,
            name: fileName,
            size: binary.length,
          },
        });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to upload attachment' });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/webchat/select-folder') {
      try {
        if (!isLocalDirectRequest(req)) {
          sendJson(res, 403, { error: 'This action is available only from local webchat on this desktop host.' });
          return;
        }
        const folder = await selectLocalFolder();
        sendJson(res, 200, { ok: true, folder });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to select folder' });
        return;
      }
    }

    // POST /tasks/:taskId/turns — append a follow-up turn to an existing task
    if (req.method === 'POST' && /^\/tasks\/[^/]+\/turns$/.test(url.pathname)) {
      try {
        const taskId = url.pathname.split('/')[2];
        const payload = asRecord(await parseJsonBody(req));
        const prompt = readOptionalString(payload.prompt, 8000);
        if (!prompt) {
          sendJson(res, 400, { error: 'prompt is required' });
          return;
        }
        const route = resolveGatewayDispatchContext(payload, 'webhook');
        recordGatewayConnectorDiscoveryFromPayload(payload, route.route);
        assertGatewayConnectorAccessPolicy(payload, route.route);
        const existing = findTaskAcrossAgents(taskId, route.agentId);
        if (!existing) {
          sendJson(res, 404, { error: 'Task not found' });
          return;
        }
        const sessionRecord = getGatewaySession(route.sessionKey);
        const sessionId =
          readOptionalString(payload.sessionId, 128)
          ?? existing.sessionId
          ?? sessionRecord?.sessionId;
        if (!sessionId) {
          sendJson(res, 400, { error: 'sessionId or sessionKey with known session is required' });
          return;
        }
        const result = await resumeTaskSession(
          sessionId,
          prompt,
          taskId,
          route.agentId,
          {
            source: 'gateway',
            sessionKey: route.sessionKey,
            route: route.route,
            resume: {
              workingDirectory: readOptionalString(payload.workingDirectory, 1024),
              attachedFiles: readOptionalStringArray(payload.attachedFiles, 2048, 20),
              privacyMode: readOptionalPrivacyMode(payload.privacyMode),
            },
          }
        );
        sendJson(res, 200, {
          ok: true,
          taskId: result.taskId,
          agentId: route.agentId,
          sessionKey: route.sessionKey,
          matchedBy: route.matchedBy,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to append turn';
        const status = getGatewayErrorStatus(error, 500);
        sendJson(res, status, { error: message });
        return;
      }
    }

    // PATCH /tasks/:taskId/summary — rename a task
    if (req.method === 'PATCH' && /^\/tasks\/[^/]+\/summary$/.test(url.pathname)) {
      try {
        const taskId = url.pathname.split('/')[2];
        const body = await parseJsonBody(req);
        const payload = body as { summary?: string };
        if (!payload.summary || typeof payload.summary !== 'string') {
          sendJson(res, 400, { error: 'summary is required' });
          return;
        }
        const existing = findTaskAcrossAgents(taskId);
        if (!existing) {
          sendJson(res, 404, { error: 'Task not found' });
          return;
        }
        updateTaskSummary(taskId, payload.summary.trim());
        sendJson(res, 200, { ok: true });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to update summary' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/voicewake') {
      sendJson(res, 200, getVoiceWakeConfig());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/voicewake') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as { enabled?: boolean; triggers?: string[] };
        const current = getVoiceWakeConfig();
        const next = setVoiceWakeConfig({
          enabled: typeof payload.enabled === 'boolean' ? payload.enabled : current.enabled,
          triggers: Array.isArray(payload.triggers) ? payload.triggers : current.triggers,
          updatedAtMs: current.updatedAtMs,
        });
        sendJson(res, 200, next);
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to update voice wake config' });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/nodes/pair') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as {
          nodeId?: string;
          displayName?: string;
          platform?: string;
          version?: string;
          deviceFamily?: string;
          modelIdentifier?: string;
          caps?: string[];
          commands?: string[];
          permissions?: Record<string, boolean>;
        };
        if (!payload.nodeId || typeof payload.nodeId !== 'string') {
          sendJson(res, 400, { error: 'nodeId is required' });
          return;
        }
        const result = requestNodePairing({
          nodeId: payload.nodeId,
          displayName: payload.displayName,
          platform: payload.platform,
          version: payload.version,
          deviceFamily: payload.deviceFamily,
          modelIdentifier: payload.modelIdentifier,
          caps: payload.caps,
          commands: payload.commands,
          permissions: payload.permissions,
          remoteIp: req.socket?.remoteAddress ?? undefined,
        });
        sendJson(res, 200, result);
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to create pairing request' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/nodes/pair/status') {
      const nodeId = url.searchParams.get('nodeId')?.trim();
      if (!nodeId) {
        sendJson(res, 400, { error: 'nodeId is required' });
        return;
      }

      const paired = getPairedNode(nodeId);
      if (paired) {
        updatePairedNodeLastSeen(nodeId);
        sendJson(res, 200, { status: 'approved', node: paired });
        return;
      }

      const pending = getPendingNodePairingByNodeId(nodeId);
      if (pending) {
        sendJson(res, 200, { status: 'pending', request: pending });
        return;
      }

      sendJson(res, 200, { status: 'unknown' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/nodes/pair/cancel') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as { nodeId?: string };
        const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : '';
        if (!nodeId) {
          sendJson(res, 400, { error: 'nodeId is required' });
          return;
        }
        const result = cancelNodePairingByNodeId(nodeId);
        sendJson(res, 200, { ok: Boolean(result), result });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to cancel pairing request' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/nodes/commands') {
      const nodeId = url.searchParams.get('nodeId')?.trim() ?? '';
      const token = url.searchParams.get('token')?.trim() ?? '';
      if (!nodeId || !token) {
        sendJson(res, 400, { error: 'nodeId and token are required' });
        return;
      }
      const verified = verifyNodeToken(nodeId, token);
      if (!verified.ok) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      updatePairedNodeLastSeen(nodeId);
      const command = takeNextNodeCommand(nodeId);
      if (!command) {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      sendJson(res, 200, command);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/nodes/commands/result') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as {
          nodeId?: string;
          token?: string;
          id?: string;
          ok?: boolean;
          payload?: unknown;
          error?: string | null;
        };
        const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : '';
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        const id = typeof payload.id === 'string' ? payload.id.trim() : '';
        if (!nodeId || !token || !id) {
          sendJson(res, 400, { error: 'nodeId, token, and id are required' });
          return;
        }
        const verified = verifyNodeToken(nodeId, token);
        if (!verified.ok) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        updatePairedNodeLastSeen(nodeId);
        const ok = Boolean(payload.ok);
        const completed = completeNodeCommandResult({
          nodeId,
          id,
          ok,
          payload: payload.payload,
          error: payload.error ?? null,
        });
        sendJson(res, 200, { ok: completed });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to accept node result' });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/nodes/runtime/camera') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as { nodeId?: string; token?: string; active?: boolean };
        const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : '';
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        if (!nodeId || !token) {
          sendJson(res, 400, { error: 'nodeId and token are required' });
          return;
        }
        const verified = verifyNodeToken(nodeId, token);
        if (!verified.ok) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        setNodeCameraActive(nodeId, Boolean(payload.active));
        sendJson(res, 200, { ok: true });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to update camera status' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/nodes/runtime/camera') {
      const nodeId = url.searchParams.get('nodeId')?.trim() ?? '';
      const token = url.searchParams.get('token')?.trim() ?? '';
      if (!nodeId || !token) {
        sendJson(res, 400, { error: 'nodeId and token are required' });
        return;
      }
      const verified = verifyNodeToken(nodeId, token);
      if (!verified.ok) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const state = getNodeCameraActive(nodeId);
      sendJson(res, 200, { active: state?.cameraActive ?? false, updatedAtMs: state?.updatedAtMs ?? null });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/nodes/stream/chunk') {
      try {
        const body = await parseJsonBody(req);
        const payload = body as {
          nodeId?: string;
          token?: string;
          streamId?: string;
          kind?: 'mic' | 'screen';
          mime?: string;
          dataBase64?: string;
        };
        const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : '';
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        const streamId = typeof payload.streamId === 'string' ? payload.streamId.trim() : '';
        const kind = payload.kind === 'mic' || payload.kind === 'screen' ? payload.kind : null;
        const mime = typeof payload.mime === 'string' ? payload.mime.trim() : '';
        const dataBase64 = typeof payload.dataBase64 === 'string' ? payload.dataBase64 : '';
        if (!nodeId || !token || !streamId || !kind || !mime || !dataBase64) {
          sendJson(res, 400, { error: 'nodeId, token, streamId, kind, mime, dataBase64 are required' });
          return;
        }
        const verified = verifyNodeToken(nodeId, token);
        if (!verified.ok) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        updatePairedNodeLastSeen(nodeId);
        updateNodeStreamChunk({ nodeId, streamId, kind, mime, dataBase64 });
        sendJson(res, 200, { ok: true });
        return;
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'Failed to accept stream chunk' });
        return;
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  const host = getWebhookBindHost();

  server.on('upgrade', (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, getWebhookLocalUrl());
    if (url.pathname !== '/gateway/ws') {
      socket.destroy();
      return;
    }

    const authResult = authorizeGatewayRequest(req);
    if (!authResult.ok) {
      const statusLine = 'HTTP/1.1 401 Unauthorized\r\n';
      const headers = `Content-Type: application/json\r\nConnection: close\r\n\r\n${JSON.stringify({ error: 'unauthorized', reason: authResult.reason })}`;
      socket.write(statusLine + headers);
      socket.destroy();
      return;
    }

    gatewayWss.handleUpgrade(req, socket, head, (ws) => {
      gatewayWss.emit('connection', ws, req);
    });
  });

  server.listen(WEBHOOK_PORT, host, () => {
    console.log(`[Webhook] Server listening on http://${host}:${WEBHOOK_PORT}`);
  });

  server.on('error', (error) => {
    console.error('[Webhook] Server error:', error);
  });

  server.on('close', () => {
    gatewayWss.close();
    void stopGatewayExposure();
  });

  void refreshGatewayRuntimeConfig();

  return server;
}
