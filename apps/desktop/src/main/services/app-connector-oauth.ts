import { randomBytes, randomUUID, createHash } from 'crypto';
import { shell } from 'electron';
import type { AppConnectorExtensionId } from '@accomplish/shared';
import { listAppConnectorExtensionDefinitions, resolveAppConnectorExtensionConfig, getAppConnectorRuntimeKey } from '../store/appConnectorExtensions';
import { getGatewayConfig } from '../store/gatewayConfig';
import {
  deleteAppConnectorSecret,
  getAppConnectorOAuthClientSecret,
  getAppConnectorSecret,
  storeAppConnectorSecret,
} from '../store/secureStorage';
import { getTailnetHostname } from './tailscale';

type OAuthProvider = 'google' | 'microsoft' | 'slack' | 'notion' | 'dropbox' | 'miro' | 'canva' | 'generic';
type OAuthRedirectMode = 'auto' | 'desktop' | 'loopback' | 'public';

type OAuthFlowStatus = 'pending' | 'completed' | 'error';

interface OAuthFlowRecord {
  id: string;
  state: string;
  connectorId: AppConnectorExtensionId;
  instanceId: string;
  runtimeKey: string;
  provider: OAuthProvider;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  codeVerifier?: string;
  createdAt: number;
  expiresAt: number;
  status: OAuthFlowStatus;
  detail?: string;
  completedAt?: number;
}

export interface StartAppConnectorOAuthFlowInput {
  connectorId: AppConnectorExtensionId;
  instanceId?: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[] | string;
  redirectMode?: OAuthRedirectMode;
  redirectUri?: string;
}

export interface AppConnectorOAuthFlowStatus {
  flowId: string;
  connectorId: AppConnectorExtensionId;
  instanceId: string;
  runtimeKey: string;
  provider: OAuthProvider;
  status: OAuthFlowStatus;
  detail?: string;
  createdAt: string;
  completedAt?: string;
  expiresAt: string;
}

export interface StartAppConnectorOAuthFlowResult {
  flowId: string;
  authorizeUrl: string;
  provider: OAuthProvider;
  runtimeKey: string;
  createdAt: string;
  expiresAt: string;
}

export interface DisconnectAppConnectorOAuthResult {
  connectorId: AppConnectorExtensionId;
  instanceId: string;
  runtimeKey: string;
  provider?: OAuthProvider;
  revoked: boolean;
  localCleared: boolean;
  detail: string;
}

export interface DisconnectAppConnectorOAuthInput {
  connectorId: AppConnectorExtensionId;
  instanceId?: string;
  remoteRevoke?: boolean;
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const FLOW_HISTORY_TTL_MS = 60 * 60 * 1000;
const APP_PROTOCOL_REDIRECT_URI = 'accomplish://callback';
const OAUTH_HTTP_CALLBACK_PATH = '/api/opendeskmate/callback';
const LOOPBACK_REDIRECT_URI = `http://127.0.0.1:18888${OAUTH_HTTP_CALLBACK_PATH}`;

const GOOGLE_CONNECTOR_IDS = new Set<AppConnectorExtensionId>([
  'google-slides',
  'google-tasks',
  'google-sheets',
  'google-docs',
  'google-drive',
  'google-photos',
  'youtube',
  'gmail',
  'google-calendar',
]);

const MICROSOFT_CONNECTOR_IDS = new Set<AppConnectorExtensionId>([
  'onedrive',
  'microsoft-outlook',
]);

const DROPBOX_CONNECTOR_IDS = new Set<AppConnectorExtensionId>([
  'dropbox',
]);

const MIRO_CONNECTOR_IDS = new Set<AppConnectorExtensionId>([
  'miro',
]);

const CANVA_CONNECTOR_IDS = new Set<AppConnectorExtensionId>([
  'canva',
]);

const flowById = new Map<string, OAuthFlowRecord>();
const flowIdByState = new Map<string, string>();

interface StoredOAuthSecret {
  provider?: OAuthProvider;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

function nowMs(): number {
  return Date.now();
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function normalizeText(value: unknown, maxLength = 1024): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeScopes(input: string[] | string | undefined, fallback: string[]): string[] {
  if (Array.isArray(input)) {
    const values = input
      .map((entry) => normalizeText(entry, 256))
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  if (typeof input === 'string') {
    const values = input
      .split(/[,\s]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  return fallback;
}

function parseHintScopes(hint: string | undefined): string[] {
  return (hint ?? '')
    .split(/[,\s]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getDefaultScopes(connectorId: AppConnectorExtensionId): string[] {
  const definition = listAppConnectorExtensionDefinitions().find((entry) => entry.id === connectorId);
  const hinted = parseHintScopes(definition?.oauthScopesHint);
  if (GOOGLE_CONNECTOR_IDS.has(connectorId)) {
    const base = ['openid', 'email', 'profile'];
    return Array.from(new Set([...base, ...hinted]));
  }
  if (MICROSOFT_CONNECTOR_IDS.has(connectorId)) {
    if (connectorId === 'onedrive') {
      return ['openid', 'profile', 'offline_access', 'User.Read', 'Files.ReadWrite'];
    }
    return ['openid', 'profile', 'offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite'];
  }
  if (connectorId === 'slack') {
    return ['chat:write', 'channels:read', 'channels:history', 'groups:history', 'im:history'];
  }
  if (connectorId === 'notion') {
    return hinted;
  }
  if (DROPBOX_CONNECTOR_IDS.has(connectorId)) {
    const base = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'];
    return Array.from(new Set([...base, ...hinted]));
  }
  if (MIRO_CONNECTOR_IDS.has(connectorId)) {
    const base = ['boards:read', 'boards:write'];
    return Array.from(new Set([...base, ...hinted]));
  }
  if (CANVA_CONNECTOR_IDS.has(connectorId)) {
    const base = ['design:meta:read', 'design:content:read', 'design:content:write'];
    return Array.from(new Set([...base, ...hinted]));
  }
  return hinted;
}

function inferProvider(connectorId: AppConnectorExtensionId, metadata: Record<string, string> | undefined): OAuthProvider {
  const override = normalizeText(metadata?.oauth_provider, 64).toLowerCase();
  if (
    override === 'google'
    || override === 'microsoft'
    || override === 'slack'
    || override === 'notion'
    || override === 'dropbox'
    || override === 'miro'
    || override === 'canva'
    || override === 'generic'
  ) {
    return override;
  }
  const metadataAuthorize = normalizeText(metadata?.oauth_authorize_url, 2048);
  const metadataToken = normalizeText(metadata?.oauth_token_url, 2048);
  if (metadataAuthorize && metadataToken) return 'generic';
  if (GOOGLE_CONNECTOR_IDS.has(connectorId)) return 'google';
  if (MICROSOFT_CONNECTOR_IDS.has(connectorId)) return 'microsoft';
  if (DROPBOX_CONNECTOR_IDS.has(connectorId)) return 'dropbox';
  if (MIRO_CONNECTOR_IDS.has(connectorId)) return 'miro';
  if (CANVA_CONNECTOR_IDS.has(connectorId)) return 'canva';
  if (connectorId === 'slack') return 'slack';
  if (connectorId === 'notion') return 'notion';
  throw new Error(`OAuth flow not configured for connector "${connectorId}".`);
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function cleanupFlows(): void {
  const now = nowMs();
  for (const [id, flow] of flowById.entries()) {
    if (flow.status === 'pending' && now > flow.expiresAt) {
      flow.status = 'error';
      flow.detail = 'OAuth flow timed out waiting for callback.';
      flow.completedAt = now;
    }
    const finishedAt = flow.completedAt ?? flow.createdAt;
    if (now - finishedAt > FLOW_HISTORY_TTL_MS) {
      flowById.delete(id);
      flowIdByState.delete(flow.state);
    }
  }
}

function getFlowStatus(flow: OAuthFlowRecord): AppConnectorOAuthFlowStatus {
  return {
    flowId: flow.id,
    connectorId: flow.connectorId,
    instanceId: flow.instanceId,
    runtimeKey: flow.runtimeKey,
    provider: flow.provider,
    status: flow.status,
    detail: flow.detail,
    createdAt: toIso(flow.createdAt),
    completedAt: flow.completedAt ? toIso(flow.completedAt) : undefined,
    expiresAt: toIso(flow.expiresAt),
  };
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'accomplish:') {
      return parsed.hostname === 'callback' || normalizePathname(parsed.pathname) === '/callback';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return normalizePathname(parsed.pathname) === OAUTH_HTTP_CALLBACK_PATH;
  } catch {
    return false;
  }
}

function normalizeRedirectMode(value: unknown): OAuthRedirectMode {
  const normalized = normalizeText(value, 32).toLowerCase();
  if (normalized === 'desktop') return 'desktop';
  if (normalized === 'loopback') return 'loopback';
  if (normalized === 'public') return 'public';
  return 'auto';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildHttpCallbackRedirectUri(baseUrl: string): string {
  return `${trimTrailingSlash(baseUrl)}${OAUTH_HTTP_CALLBACK_PATH}`;
}

async function resolvePublicOAuthBaseUrl(metadata: Record<string, string> | undefined): Promise<string | null> {
  const metadataBaseUrl = normalizeText(metadata?.oauth_public_base_url, 2048);
  if (metadataBaseUrl) {
    return trimTrailingSlash(metadataBaseUrl);
  }
  const gatewayConfig = getGatewayConfig();
  if (gatewayConfig.tailscaleMode === 'off' || !gatewayConfig.allowTailscale) {
    return null;
  }
  const tailnet = await getTailnetHostname();
  if (!tailnet) return null;
  return `https://${tailnet.replace(/\.$/, '')}`;
}

async function resolveOAuthRedirectUri(
  metadata: Record<string, string> | undefined,
  redirectModeOverride?: OAuthRedirectMode,
  redirectUriOverride?: string
): Promise<string> {
  const payloadRedirectUri = normalizeText(redirectUriOverride, 2048);
  if (payloadRedirectUri) {
    if (!isCallbackUrl(payloadRedirectUri)) {
      throw new Error(
        'payload.redirectUri must be accomplish://callback or an HTTP(S) callback ending with /api/opendeskmate/callback.'
      );
    }
    return payloadRedirectUri;
  }

  const explicitRedirectUri = normalizeText(metadata?.oauth_redirect_uri, 2048);
  if (explicitRedirectUri) {
    if (!isCallbackUrl(explicitRedirectUri)) {
      throw new Error(
        'metadata.oauth_redirect_uri must be accomplish://callback or an HTTP(S) callback ending with /api/opendeskmate/callback.'
      );
    }
    return explicitRedirectUri;
  }

  const redirectMode = redirectModeOverride ?? normalizeRedirectMode(metadata?.oauth_redirect_mode);
  if (redirectMode === 'desktop') {
    return APP_PROTOCOL_REDIRECT_URI;
  }
  if (redirectMode === 'loopback') {
    return LOOPBACK_REDIRECT_URI;
  }

  const publicBaseUrl = await resolvePublicOAuthBaseUrl(metadata);
  if (redirectMode === 'public') {
    if (!publicBaseUrl) {
      throw new Error(
        'Public OAuth redirect is unavailable. Enable Tailscale/public URL, set metadata.oauth_public_base_url, or use loopback/desktop redirect mode.'
      );
    }
    return buildHttpCallbackRedirectUri(publicBaseUrl);
  }

  if (publicBaseUrl) {
    return buildHttpCallbackRedirectUri(publicBaseUrl);
  }
  return LOOPBACK_REDIRECT_URI;
}

function extractCallbackParam(parsedUrl: URL, key: string): string {
  const direct = parsedUrl.searchParams.get(key);
  if (direct) return direct;
  const hash = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash;
  if (!hash) return '';
  const hashParams = new URLSearchParams(hash);
  return hashParams.get(key) ?? '';
}

async function tokenRequest(
  tokenUrl: string,
  body: URLSearchParams | Record<string, unknown>,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const isForm = body instanceof URLSearchParams;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      ...(isForm ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: isForm ? body.toString() : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === 'object' && json
      ? JSON.stringify(json)
      : String(json || response.statusText);
    throw new Error(`OAuth token exchange failed (${response.status}): ${detail}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error('OAuth token exchange returned invalid response.');
  }
  return json as Record<string, unknown>;
}

function extractAccessToken(response: Record<string, unknown>): string {
  const direct = normalizeText(response.access_token, 2048);
  if (direct) return direct;
  const authedUser = response.authed_user;
  if (authedUser && typeof authedUser === 'object') {
    const nested = normalizeText((authedUser as Record<string, unknown>).access_token, 2048);
    if (nested) return nested;
  }
  throw new Error('OAuth token response did not include an access token.');
}

async function exchangeOAuthCode(flow: OAuthFlowRecord, code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
}> {
  if (flow.provider === 'notion') {
    if (!flow.clientSecret) {
      throw new Error('Notion OAuth requires a client secret.');
    }
    const basic = Buffer.from(`${flow.clientId}:${flow.clientSecret}`).toString('base64');
    const response = await tokenRequest(
      flow.tokenUrl,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUri,
      },
      {
        Authorization: `Basic ${basic}`,
      }
    );
    return {
      accessToken: extractAccessToken(response),
      refreshToken: normalizeText(response.refresh_token, 2048) || undefined,
      tokenType: normalizeText(response.token_type, 64) || undefined,
      expiresIn: Number.isFinite(Number(response.expires_in)) ? Number(response.expires_in) : undefined,
      scope: normalizeText(response.scope, 2000) || undefined,
    };
  }

  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', flow.redirectUri);
  params.set('client_id', flow.clientId);
  if (flow.clientSecret) {
    params.set('client_secret', flow.clientSecret);
  }
  if (flow.codeVerifier) {
    params.set('code_verifier', flow.codeVerifier);
  }

  const response = await tokenRequest(flow.tokenUrl, params, {});
  return {
    accessToken: extractAccessToken(response),
    refreshToken: normalizeText(response.refresh_token, 2048) || undefined,
    tokenType: normalizeText(response.token_type, 64) || undefined,
    expiresIn: Number.isFinite(Number(response.expires_in)) ? Number(response.expires_in) : undefined,
    scope: normalizeText(response.scope, 2000) || undefined,
  };
}

function buildAuthorizeUrl(flow: OAuthFlowRecord): string {
  const authorize = new URL(flow.authorizeUrl);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', flow.clientId);
  authorize.searchParams.set('redirect_uri', flow.redirectUri);
  authorize.searchParams.set('state', flow.state);
  if (flow.scopes.length > 0) {
    if (flow.provider === 'slack') {
      authorize.searchParams.set('scope', flow.scopes.join(','));
    } else {
      authorize.searchParams.set('scope', flow.scopes.join(' '));
    }
  }

  if (flow.codeVerifier) {
    const challenge = createHash('sha256').update(flow.codeVerifier).digest('base64url');
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('code_challenge', challenge);
  }

  if (flow.provider === 'google') {
    authorize.searchParams.set('access_type', 'offline');
    authorize.searchParams.set('include_granted_scopes', 'true');
    authorize.searchParams.set('prompt', 'consent');
  }
  if (flow.provider === 'dropbox') {
    // Request long-lived refresh token support.
    authorize.searchParams.set('token_access_type', 'offline');
  }
  if (flow.provider === 'notion') {
    authorize.searchParams.set('owner', 'user');
  }

  return authorize.toString();
}

function getProviderEndpoints(
  provider: OAuthProvider,
  metadata?: Record<string, string>
): { authorizeUrl: string; tokenUrl: string } {
  const overrideAuthorizeUrl = normalizeText(metadata?.oauth_authorize_url, 2048);
  const overrideTokenUrl = normalizeText(metadata?.oauth_token_url, 2048);
  if (overrideAuthorizeUrl && overrideTokenUrl) {
    return {
      authorizeUrl: overrideAuthorizeUrl,
      tokenUrl: overrideTokenUrl,
    };
  }
  if (provider === 'google') {
    return {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    };
  }
  if (provider === 'microsoft') {
    return {
      authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    };
  }
  if (provider === 'slack') {
    return {
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
    };
  }
  if (provider === 'dropbox') {
    return {
      authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropbox.com/oauth2/token',
    };
  }
  if (provider === 'miro') {
    return {
      authorizeUrl: 'https://miro.com/oauth/authorize',
      tokenUrl: 'https://api.miro.com/v1/oauth/token',
    };
  }
  if (provider === 'canva') {
    return {
      authorizeUrl: 'https://www.canva.com/api/oauth/authorize',
      tokenUrl: 'https://api.canva.com/rest/v1/oauth/token',
    };
  }
  if (provider === 'generic') {
    throw new Error('Generic OAuth provider requires metadata.oauth_authorize_url and metadata.oauth_token_url.');
  }
  return {
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
  };
}

function parseStoredOAuthSecret(raw: string | null): StoredOAuthSecret {
  const value = normalizeText(raw, 32_000);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const providerRaw = normalizeText(parsed.provider, 64).toLowerCase();
    const provider = (
      providerRaw === 'google'
      || providerRaw === 'microsoft'
      || providerRaw === 'slack'
      || providerRaw === 'notion'
      || providerRaw === 'dropbox'
      || providerRaw === 'miro'
      || providerRaw === 'canva'
      || providerRaw === 'generic'
    )
      ? providerRaw
      : undefined;
    return {
      provider,
      accessToken: normalizeText(parsed.accessToken, 4096) || undefined,
      refreshToken: normalizeText(parsed.refreshToken, 4096) || undefined,
      clientId: normalizeText(parsed.clientId, 512) || undefined,
      clientSecret: normalizeText(parsed.clientSecret, 2048) || undefined,
      tokenUrl: normalizeText(parsed.tokenUrl, 1024) || undefined,
    };
  } catch {
    return {
      accessToken: value,
    };
  }
}

async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetchWithTimeout(
    'https://oauth2.googleapis.com/revoke',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `token=${encodeURIComponent(token)}`,
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google revoke failed (${response.status})${body ? `: ${body}` : ''}`);
  }
}

async function revokeSlackToken(token: string): Promise<void> {
  const response = await fetchWithTimeout(
    'https://slack.com/api/auth.revoke',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `token=${encodeURIComponent(token)}`,
    }
  );
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || data.ok === false) {
    const detail = normalizeText(data.error, 512) || response.statusText;
    throw new Error(`Slack revoke failed (${response.status}): ${detail}`);
  }
}

async function revokeNotionToken(secret: StoredOAuthSecret): Promise<void> {
  if (!secret.clientId || !secret.clientSecret) {
    throw new Error('Notion revoke requires client ID and client secret.');
  }
  const token = secret.refreshToken || secret.accessToken;
  if (!token) {
    throw new Error('Notion token is missing.');
  }
  const basic = Buffer.from(`${secret.clientId}:${secret.clientSecret}`).toString('base64');
  const response = await fetchWithTimeout(
    'https://api.notion.com/v1/oauth/revoke',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2025-09-03',
      },
      body: JSON.stringify({ token }),
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Notion revoke failed (${response.status})${body ? `: ${body}` : ''}`);
  }
}

async function revokeMicrosoftSessions(accessToken: string): Promise<void> {
  const response = await fetchWithTimeout(
    'https://graph.microsoft.com/v1.0/me/revokeSignInSessions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Microsoft revokeSignInSessions failed (${response.status})${body ? `: ${body}` : ''}`);
  }
}

async function revokeDropboxToken(accessToken: string): Promise<void> {
  const response = await fetchWithTimeout(
    'https://api.dropboxapi.com/2/auth/token/revoke',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Dropbox token revoke failed (${response.status})${body ? `: ${body}` : ''}`);
  }
}

async function revokeCanvaToken(accessToken: string): Promise<void> {
  const response = await fetchWithTimeout(
    'https://api.canva.com/rest/v1/oauth/revoke',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Canva token revoke failed (${response.status})${body ? `: ${body}` : ''}`);
  }
}

export async function startAppConnectorOAuthFlow(
  input: StartAppConnectorOAuthFlowInput
): Promise<StartAppConnectorOAuthFlowResult> {
  cleanupFlows();
  const connectorId = input.connectorId;
  const config = resolveAppConnectorExtensionConfig({
    id: connectorId,
    instanceId: input.instanceId,
    enabledOnly: false,
  });
  const metadata = config.metadata || {};
  const runtimeKey = getAppConnectorRuntimeKey(connectorId, config.instanceId);
  const provider = inferProvider(connectorId, metadata);
  const clientId = normalizeText(input.clientId || metadata.oauth_client_id, 512);
  if (!clientId) {
    throw new Error('OAuth client ID is required.');
  }
  const storedClientSecret = normalizeText(await getAppConnectorOAuthClientSecret(runtimeKey), 1024) || undefined;
  const clientSecret = normalizeText(input.clientSecret || '', 1024) || storedClientSecret;
  if ((provider === 'notion' || provider === 'slack') && !clientSecret) {
    throw new Error(`${provider === 'slack' ? 'Slack' : 'Notion'} OAuth requires client secret.`);
  }
  const defaultScopes = getDefaultScopes(connectorId);
  const metadataScopes = normalizeText(metadata.oauth_scopes, 2000);
  const scopes = normalizeScopes(input.scopes ?? metadataScopes, defaultScopes);
  const redirectUri = await resolveOAuthRedirectUri(metadata, input.redirectMode, input.redirectUri);

  const { authorizeUrl, tokenUrl } = getProviderEndpoints(provider, metadata);
  const flow: OAuthFlowRecord = {
    id: randomUUID(),
    state: randomBytes(24).toString('base64url'),
    connectorId,
    instanceId: config.instanceId,
    runtimeKey,
    provider,
    clientId,
    clientSecret,
    scopes,
    authorizeUrl,
    tokenUrl,
    redirectUri,
    createdAt: nowMs(),
    expiresAt: nowMs() + FLOW_TTL_MS,
    status: 'pending',
  };
  if (provider !== 'notion') {
    flow.codeVerifier = createPkcePair().verifier;
  }
  const openUrl = buildAuthorizeUrl(flow);
  flowById.set(flow.id, flow);
  flowIdByState.set(flow.state, flow.id);
  void shell.openExternal(openUrl).catch((error: unknown) => {
    // Keep flow active; renderer can still open/copy the authorize URL manually.
    const message = error instanceof Error ? error.message : 'Failed to open system browser.';
    const current = flowById.get(flow.id);
    if (current && current.status === 'pending') {
      current.detail = `Browser did not open automatically: ${message}`;
    }
  });
  return {
    flowId: flow.id,
    authorizeUrl: openUrl,
    provider: flow.provider,
    runtimeKey: flow.runtimeKey,
    createdAt: toIso(flow.createdAt),
    expiresAt: toIso(flow.expiresAt),
  };
}

export function getAppConnectorOAuthFlowStatus(flowId: string): AppConnectorOAuthFlowStatus | null {
  cleanupFlows();
  const flow = flowById.get(flowId);
  if (!flow) return null;
  return getFlowStatus(flow);
}

export async function handleAppConnectorOAuthCallback(url: string): Promise<AppConnectorOAuthFlowStatus | null> {
  cleanupFlows();
  if (!isCallbackUrl(url)) return null;
  const parsed = new URL(url);
  const state = extractCallbackParam(parsed, 'state');
  const flowId = flowIdByState.get(state);
  if (!flowId) {
    return null;
  }
  const flow = flowById.get(flowId);
  if (!flow) return null;
  if (flow.status !== 'pending') {
    return getFlowStatus(flow);
  }

  const oauthError = extractCallbackParam(parsed, 'error');
  if (oauthError) {
    const description = extractCallbackParam(parsed, 'error_description');
    flow.status = 'error';
    flow.detail = description ? `${oauthError}: ${description}` : oauthError;
    flow.completedAt = nowMs();
    return getFlowStatus(flow);
  }

  const code = extractCallbackParam(parsed, 'code');
  if (!code) {
    flow.status = 'error';
    flow.detail = 'OAuth callback missing authorization code.';
    flow.completedAt = nowMs();
    return getFlowStatus(flow);
  }

  try {
    const token = await exchangeOAuthCode(flow, code);
    const expiresAt = token.expiresIn
      ? toIso(nowMs() + (Math.max(0, token.expiresIn) * 1000))
      : undefined;
    const payload = {
      kind: 'oauth2',
      provider: flow.provider,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      scope: token.scope,
      expiresAt,
      obtainedAt: toIso(nowMs()),
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      tokenUrl: flow.tokenUrl,
    };
    await storeAppConnectorSecret(flow.runtimeKey, JSON.stringify(payload));
    flow.status = 'completed';
    flow.detail = 'OAuth connect completed and token stored.';
    flow.completedAt = nowMs();
    return getFlowStatus(flow);
  } catch (error) {
    flow.status = 'error';
    flow.detail = error instanceof Error ? error.message : 'OAuth token exchange failed.';
    flow.completedAt = nowMs();
    return getFlowStatus(flow);
  }
}

export async function maybeHandleAppConnectorOAuthProtocolUrl(url: string): Promise<boolean> {
  if (!isCallbackUrl(url)) return false;
  await handleAppConnectorOAuthCallback(url);
  return true;
}

export async function disconnectAppConnectorOAuth(
  input: DisconnectAppConnectorOAuthInput
): Promise<DisconnectAppConnectorOAuthResult> {
  cleanupFlows();
  const connectorId = input.connectorId;
  const config = resolveAppConnectorExtensionConfig({
    id: connectorId,
    instanceId: input.instanceId,
    enabledOnly: false,
  });
  const runtimeKey = getAppConnectorRuntimeKey(connectorId, config.instanceId);
  const remoteRevoke = input.remoteRevoke !== false;
  const rawSecret = await getAppConnectorSecret(runtimeKey);
  const secret = parseStoredOAuthSecret(rawSecret);
  let provider = secret.provider;
  if (!provider) {
    try {
      provider = inferProvider(connectorId, config.metadata);
    } catch {
      provider = undefined;
    }
  }

  let revoked = false;
  let revokeError: string | null = null;
  let revokeSupported = false;
  if (remoteRevoke && provider) {
    try {
      if (provider === 'google') {
        revokeSupported = true;
        const token = secret.refreshToken || secret.accessToken;
        if (!token) {
          throw new Error('Google token not found.');
        }
        await revokeGoogleToken(token);
      } else if (provider === 'slack') {
        revokeSupported = true;
        if (!secret.accessToken) {
          throw new Error('Slack access token not found.');
        }
        await revokeSlackToken(secret.accessToken);
      } else if (provider === 'notion') {
        revokeSupported = true;
        await revokeNotionToken(secret);
      } else if (provider === 'microsoft') {
        revokeSupported = true;
        if (!secret.accessToken) {
          throw new Error('Microsoft access token not found.');
        }
        await revokeMicrosoftSessions(secret.accessToken);
      } else if (provider === 'dropbox') {
        revokeSupported = true;
        if (!secret.accessToken) {
          throw new Error('Dropbox access token not found.');
        }
        await revokeDropboxToken(secret.accessToken);
      } else if (provider === 'canva') {
        revokeSupported = true;
        if (!secret.accessToken) {
          throw new Error('Canva access token not found.');
        }
        await revokeCanvaToken(secret.accessToken);
      } else {
        revokeError = `Remote revoke is not implemented for provider "${provider}".`;
      }
      revoked = revokeSupported && !revokeError;
    } catch (error) {
      revokeError = error instanceof Error ? error.message : 'Remote revoke failed.';
    }
  }

  const localCleared = await deleteAppConnectorSecret(runtimeKey);
  let detail = 'Local OAuth token was already cleared.';
  if (localCleared) {
    detail = 'OAuth token cleared from local secure storage.';
  }
  if (remoteRevoke && provider) {
    detail = revokeError
      ? `Remote revoke failed (${provider}): ${revokeError} Local token ${localCleared ? 'cleared' : 'was already empty'}.`
      : `Remote revoke completed (${provider}). Local token ${localCleared ? 'cleared' : 'was already empty'}.`;
  } else if (remoteRevoke && !provider) {
    detail = `Provider could not be determined. Local token ${localCleared ? 'cleared' : 'was already empty'}.`;
  }

  return {
    connectorId,
    instanceId: config.instanceId,
    runtimeKey,
    provider,
    revoked,
    localCleared,
    detail,
  };
}
