import fs from 'fs';
import path from 'path';
import type {
  AppConnectorAuthMethod,
  AppConnectorExtensionConfig,
  AppConnectorExtensionId,
  AppConnectorRuntimeStatus,
  AppConnectorRuntimeTestResult,
} from '@accomplish/shared';
import {
  listAppConnectorExtensionConfigs,
  resolveAppConnectorExtensionConfig,
  getAppConnectorRuntimeKey,
  listAppConnectorExtensionDefinitions,
} from '../store/appConnectorExtensions';
import { getAppConnectorSecret, storeAppConnectorSecret } from '../store/secureStorage';

const DEFAULT_TIMEOUT_MS = 20_000;
const OAUTH_REFRESH_SKEW_MS = 60_000;
const OAUTH_REFRESH_INTERVAL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.OPENDESKMATE_APP_CONNECTOR_OAUTH_REFRESH_INTERVAL_MS || '', 10) || (5 * 60 * 1000)
);

let oauthRefreshTimer: NodeJS.Timeout | null = null;
let oauthRefreshInFlight = false;

export interface AppConnectorExecuteInput {
  connectorId: AppConnectorExtensionId;
  connectorInstanceId?: string;
  action: string;
  args?: Record<string, unknown>;
}

export interface AppConnectorExecuteResult {
  connectorId: AppConnectorExtensionId;
  connectorInstanceId: string;
  runtimeKey: string;
  action: string;
  detail: string;
  data?: unknown;
}

type RequestResult = {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  url: string;
};

interface ParsedConnectorSecret {
  raw: string | null;
  token: string | null;
  provider?: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  obtainedAt?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  oauth: boolean;
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeLower(value: unknown, maxLength: number): string {
  return normalizeText(value, maxLength).toLowerCase();
}

function getConnectorDefinition(id: AppConnectorExtensionId) {
  return listAppConnectorExtensionDefinitions().find((entry) => entry.id === id);
}

function getMetadataValue(config: AppConnectorExtensionConfig, key: string): string | undefined {
  const metadata = config.metadata;
  if (!metadata) return undefined;
  const target = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(metadata)) {
    if (entryKey.toLowerCase() === target) {
      return entryValue;
    }
  }
  return undefined;
}

function requiresSecret(authMethod: AppConnectorAuthMethod): boolean {
  return authMethod !== 'local' && authMethod !== 'webhook';
}

function getRuntimeMode(authMethod: AppConnectorAuthMethod): AppConnectorRuntimeStatus['mode'] {
  if (authMethod === 'local') return 'local';
  if (authMethod === 'webhook') return 'webhook';
  if (authMethod === 'oauth2') return 'oauth2';
  return 'token';
}

function parseTrelloSecret(secret: string): { key: string; token: string } {
  const trimmed = secret.trim();
  const [key, token] = trimmed.split(':').map((entry) => entry.trim());
  if (!key || !token) {
    throw new Error('Trello requires secret format "apiKey:token".');
  }
  return { key, token };
}

function parseConnectorSecret(secret: string | null): ParsedConnectorSecret {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  if (!trimmed) {
    return { raw: null, token: null, oauth: false };
  }
  if (!trimmed.startsWith('{')) {
    return { raw: trimmed, token: trimmed, oauth: false };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const accessToken = normalizeText(parsed.accessToken, 4096);
    const token = normalizeText(parsed.token, 4096);
    const apiKey = normalizeText(parsed.apiKey, 4096);
    const effectiveToken = accessToken || token || apiKey || trimmed;
    return {
      raw: trimmed,
      token: effectiveToken || null,
      provider: normalizeText(parsed.provider, 128) || undefined,
      refreshToken: normalizeText(parsed.refreshToken, 4096) || undefined,
      expiresAt: normalizeText(parsed.expiresAt, 128) || undefined,
      tokenType: normalizeText(parsed.tokenType, 128) || undefined,
      scope: normalizeText(parsed.scope, 2048) || undefined,
      obtainedAt: normalizeText(parsed.obtainedAt, 128) || undefined,
      clientId: normalizeText(parsed.clientId, 512) || undefined,
      clientSecret: normalizeText(parsed.clientSecret, 2048) || undefined,
      tokenUrl: normalizeText(parsed.tokenUrl, 1024) || undefined,
      oauth: normalizeLower(parsed.kind, 16) === 'oauth2' || Boolean(accessToken),
    };
  } catch {
    return { raw: trimmed, token: trimmed, oauth: false };
  }
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function isOAuthProvider(
  value: string | undefined
): value is 'google' | 'microsoft' | 'slack' | 'notion' | 'dropbox' | 'miro' | 'canva' | 'generic' {
  return value === 'google'
    || value === 'microsoft'
    || value === 'slack'
    || value === 'notion'
    || value === 'dropbox'
    || value === 'miro'
    || value === 'canva'
    || value === 'generic';
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function isSecretNearExpiry(secret: ParsedConnectorSecret): boolean {
  const expiresAtMs = parseIsoTimestamp(secret.expiresAt);
  if (!expiresAtMs) return false;
  return expiresAtMs <= (Date.now() + OAUTH_REFRESH_SKEW_MS);
}

function defaultTokenUrlForProvider(
  provider: 'google' | 'microsoft' | 'slack' | 'notion' | 'dropbox' | 'miro' | 'canva' | 'generic'
): string {
  if (provider === 'google') return 'https://oauth2.googleapis.com/token';
  if (provider === 'microsoft') return 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  if (provider === 'slack') return 'https://slack.com/api/oauth.v2.access';
  if (provider === 'dropbox') return 'https://api.dropbox.com/oauth2/token';
  if (provider === 'miro') return 'https://api.miro.com/v1/oauth/token';
  if (provider === 'canva') return 'https://api.canva.com/rest/v1/oauth/token';
  if (provider === 'generic') {
    throw new Error('OAuth token URL is missing. Set metadata.oauth_token_url and reconnect OAuth.');
  }
  return 'https://api.notion.com/v1/oauth/token';
}

async function oauthTokenRequest(
  tokenUrl: string,
  body: URLSearchParams | Record<string, unknown>,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const isForm = body instanceof URLSearchParams;
  const response = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: {
      ...(isForm ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: isForm ? body.toString() : JSON.stringify(body),
  });
  const json = await parseResponse(response);
  if (!response.ok) {
    const detail = typeof json === 'object' && json
      ? JSON.stringify(json)
      : String(json || response.statusText);
    throw new Error(`OAuth refresh failed (${response.status}): ${detail}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error('OAuth refresh response was invalid.');
  }
  return json as Record<string, unknown>;
}

function extractRefreshedAccessToken(response: Record<string, unknown>): string {
  const direct = normalizeText(response.access_token, 4096);
  if (direct) return direct;
  const authedUser = response.authed_user;
  if (authedUser && typeof authedUser === 'object') {
    const nested = normalizeText((authedUser as Record<string, unknown>).access_token, 4096);
    if (nested) return nested;
  }
  throw new Error('OAuth refresh did not return access token.');
}

async function refreshOAuthSecret(secret: ParsedConnectorSecret): Promise<ParsedConnectorSecret> {
  if (!secret.refreshToken) {
    throw new Error('OAuth token expired and no refresh token is available. Reconnect OAuth.');
  }
  const provider = isOAuthProvider(secret.provider) ? secret.provider : null;
  if (!provider) {
    throw new Error('OAuth token provider is missing. Reconnect OAuth.');
  }
  const tokenUrl = secret.tokenUrl || defaultTokenUrlForProvider(provider);
  const now = Date.now();

  if (provider === 'notion') {
    if (!secret.clientId || !secret.clientSecret) {
      throw new Error('Notion OAuth refresh requires client ID and client secret.');
    }
    const basic = Buffer.from(`${secret.clientId}:${secret.clientSecret}`).toString('base64');
    const response = await oauthTokenRequest(
      tokenUrl,
      {
        grant_type: 'refresh_token',
        refresh_token: secret.refreshToken,
      },
      {
        Authorization: `Basic ${basic}`,
      }
    );
    const expiresIn = Number(response.expires_in);
    return {
      ...secret,
      token: extractRefreshedAccessToken(response),
      refreshToken: normalizeText(response.refresh_token, 4096) || secret.refreshToken,
      tokenType: normalizeText(response.token_type, 128) || secret.tokenType,
      scope: normalizeText(response.scope, 2048) || secret.scope,
      obtainedAt: toIso(now),
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
        ? toIso(now + (Math.floor(expiresIn) * 1000))
        : secret.expiresAt,
    };
  }

  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', secret.refreshToken);
  if (secret.clientId) {
    params.set('client_id', secret.clientId);
  }
  if (secret.clientSecret) {
    params.set('client_secret', secret.clientSecret);
  }
  const response = await oauthTokenRequest(tokenUrl, params, {});
  if (provider === 'slack' && response.ok === false) {
    const detail = normalizeText(response.error, 512) || 'unknown_error';
    throw new Error(`Slack OAuth refresh failed: ${detail}`);
  }
  const expiresIn = Number(response.expires_in);
  return {
    ...secret,
    token: extractRefreshedAccessToken(response),
    refreshToken: normalizeText(response.refresh_token, 4096) || secret.refreshToken,
    tokenType: normalizeText(response.token_type, 128) || secret.tokenType,
    scope: normalizeText(response.scope, 2048) || secret.scope,
    obtainedAt: toIso(now),
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? toIso(now + (Math.floor(expiresIn) * 1000))
      : secret.expiresAt,
  };
}

function serializeOAuthSecret(secret: ParsedConnectorSecret): string {
  return JSON.stringify({
    kind: 'oauth2',
    provider: secret.provider,
    accessToken: secret.token,
    refreshToken: secret.refreshToken,
    tokenType: secret.tokenType,
    scope: secret.scope,
    expiresAt: secret.expiresAt,
    obtainedAt: secret.obtainedAt,
    clientId: secret.clientId,
    clientSecret: secret.clientSecret,
    tokenUrl: secret.tokenUrl,
  });
}

async function resolveSecretForRuntime(input: {
  runtimeKey: string;
  authMethod: AppConnectorAuthMethod;
}): Promise<ParsedConnectorSecret> {
  const secret = parseConnectorSecret(await getAppConnectorSecret(input.runtimeKey));
  if (!requiresSecret(input.authMethod)) {
    return secret;
  }
  if (!secret.token) {
    throw new Error('Connector secret/token is not set.');
  }
  if (input.authMethod !== 'oauth2') {
    return secret;
  }

  if (secret.expiresAt && !secret.refreshToken && isSecretNearExpiry(secret)) {
    throw new Error('OAuth access token expired and no refresh token is available. Reconnect OAuth.');
  }

  if (!secret.refreshToken || !isSecretNearExpiry(secret)) {
    return secret;
  }

  const refreshed = await refreshOAuthSecret(secret);
  await storeAppConnectorSecret(input.runtimeKey, serializeOAuthSecret(refreshed));
  return refreshed;
}

async function refreshOAuthConnectorsPass(): Promise<void> {
  if (oauthRefreshInFlight) return;
  oauthRefreshInFlight = true;
  try {
    const configs = listAppConnectorExtensionConfigs()
      .filter((config) => config.enabled);
    for (const config of configs) {
      const definition = getConnectorDefinition(config.id);
      const authMethod = definition?.authMethod ?? 'token';
      if (authMethod !== 'oauth2') continue;
      const runtimeKey = getAppConnectorRuntimeKey(config.id, config.instanceId);
      try {
        await resolveSecretForRuntime({
          runtimeKey,
          authMethod: 'oauth2',
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[App Connectors] OAuth refresh check failed for ${runtimeKey}: ${detail}`);
      }
    }
  } finally {
    oauthRefreshInFlight = false;
  }
}

export function startAppConnectorOAuthRefreshService(): void {
  if (oauthRefreshTimer) return;
  oauthRefreshTimer = setInterval(() => {
    void refreshOAuthConnectorsPass();
  }, OAUTH_REFRESH_INTERVAL_MS);
  oauthRefreshTimer.unref?.();
  void refreshOAuthConnectorsPass();
}

export function stopAppConnectorOAuthRefreshService(): void {
  if (!oauthRefreshTimer) return;
  clearInterval(oauthRefreshTimer);
  oauthRefreshTimer = null;
}

function sanitizeRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const next: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeText(rawKey, 128);
    if (!key) continue;
    if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      next[key] = String(rawValue);
    }
  }
  return next;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms at ${url}`);
    }
    const cause = (error as { cause?: unknown })?.cause;
    let causeDetail = '';
    if (typeof cause === 'string') {
      causeDetail = ` (${cause})`;
    } else if (cause && typeof cause === 'object') {
      try {
        causeDetail = ` (${JSON.stringify(cause)})`;
      } catch {
        causeDetail = ` (${String(cause)})`;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Network request failed at ${url}: ${message}${causeDetail}`);
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => '');
}

async function delayMs(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

function normalizeStringList(input: unknown, maxLength = 512): string[] {
  if (Array.isArray(input)) {
    return input
      .map((entry) => normalizeText(entry, maxLength))
      .filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[,\n]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.slice(0, maxLength));
  }
  return [];
}

function toOutlookRecipients(input: unknown): Array<{ emailAddress: { address: string } }> {
  const addresses = normalizeStringList(input, 320);
  return addresses.map((address) => ({
    emailAddress: {
      address,
    },
  }));
}

function buildGmailRawMessage(args: Record<string, unknown>): string {
  const to = normalizeStringList(args.to, 320);
  if (to.length === 0) {
    throw new Error('args.to is required.');
  }
  const cc = normalizeStringList(args.cc, 320);
  const bcc = normalizeStringList(args.bcc, 320);
  const subject = normalizeText(args.subject, 998);
  if (!subject) {
    throw new Error('args.subject is required.');
  }
  const html = typeof args.html === 'string' ? args.html : '';
  const text = typeof args.text === 'string' ? args.text : '';
  const content = html || text;
  if (!content) {
    throw new Error('args.text or args.html is required.');
  }
  const contentType = html ? 'text/html' : 'text/plain';
  const lines = [
    `To: ${to.join(', ')}`,
    ...(cc.length > 0 ? [`Cc: ${cc.join(', ')}`] : []),
    ...(bcc.length > 0 ? [`Bcc: ${bcc.join(', ')}`] : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}; charset="UTF-8"`,
    '',
    content,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf-8').toString('base64url');
}

function pickBaseUrl(config: AppConnectorExtensionConfig): string {
  const override = normalizeConnectorBaseUrl(config.id, normalizeText(config.baseUrl, 1024));
  if (override) return override;
  const definition = getConnectorDefinition(config.id);
  const fallback = normalizeConnectorBaseUrl(config.id, normalizeText(definition?.defaultBaseUrl, 1024));
  if (fallback) return fallback;
  throw new Error('No API base URL configured.');
}

function normalizeConnectorBaseUrl(
  connectorId: AppConnectorExtensionId,
  rawBaseUrl: string | undefined
): string | undefined {
  const normalized = normalizeText(rawBaseUrl, 1024);
  if (!normalized) return undefined;

  const definition = getConnectorDefinition(connectorId);
  const fallback = normalizeText(definition?.defaultBaseUrl, 1024);

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (connectorId === 'notion') {
      const looksOAuthUrl =
        pathname.includes('/oauth/')
        || pathname.includes('/install-integration')
        || host === 'www.notion.so';
      if (looksOAuthUrl) {
        return fallback || 'https://api.notion.com/v1';
      }

      if (host === 'api.notion.com' && !pathname.startsWith('/v1')) {
        return fallback || 'https://api.notion.com/v1';
      }
    }
  } catch {
    // Keep original value for non-URL strings; fetch will surface connectivity errors.
  }

  return normalized;
}

function buildConnectorRequest(
  config: AppConnectorExtensionConfig,
  secret: string | null,
  input: {
    method?: string;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, unknown>;
  }
): { url: string; init: RequestInit } {
  const definition = getConnectorDefinition(config.id);
  const authMethod = definition?.authMethod ?? 'token';
  const method = normalizeUpperMethod(input.method || 'GET');
  const baseUrl = pickBaseUrl(config);
  const path = normalizePath(input.path);
  const url = resolveConnectorUrl(baseUrl, path);
  const query = input.query || {};
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) continue;
    url.searchParams.set(key, String(rawValue));
  }

  const headers: Record<string, string> = {
    ...sanitizeRecord(input.headers),
  };

  if (config.id === 'notion') {
    headers['Notion-Version'] = getMetadataValue(config, 'notion_version') || '2022-06-28';
  }

  if (config.id === 'supabase') {
    if (!secret) {
      throw new Error('Supabase connector secret is missing.');
    }
    headers.apikey = secret;
    headers.Authorization = `Bearer ${secret}`;
  } else if (config.id === 'figma') {
    if (!secret) {
      throw new Error('Figma personal access token is missing.');
    }
    headers['X-Figma-Token'] = secret;
  } else if (config.id === 'trello') {
    if (!secret) {
      throw new Error('Trello secret is missing.');
    }
    const parsed = parseTrelloSecret(secret);
    url.searchParams.set('key', parsed.key);
    url.searchParams.set('token', parsed.token);
  } else if (authMethod === 'api-key') {
    if (!secret) {
      throw new Error('API key is missing.');
    }
    const location = normalizeLower(getMetadataValue(config, 'api_key_location') || '', 32) || 'header';
    const keyName = normalizeText(getMetadataValue(config, 'api_key_name'), 64) || 'x-api-key';
    if (location === 'query') {
      url.searchParams.set(keyName, secret);
    } else {
      headers[keyName] = secret;
    }
    if (config.id === 'google-maps' && !url.searchParams.get('key')) {
      url.searchParams.set('key', secret);
    }
  } else if (requiresSecret(authMethod)) {
    if (!secret) {
      throw new Error('Connector secret/token is missing.');
    }
    headers.Authorization = `Bearer ${secret}`;
  }

  let body: string | undefined;
  if (input.body !== undefined) {
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  return {
    url: url.toString(),
    init: {
      method,
      headers,
      body,
    },
  };
}

function resolveConnectorUrl(baseUrl: string, pathValue: string): URL {
  if (pathValue.startsWith('http://') || pathValue.startsWith('https://')) {
    return new URL(pathValue);
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const base = new URL(normalizedBase);
  const basePath = base.pathname.replace(/\/+$/g, '');
  const relativePath = pathValue.replace(/^\/+/g, '');
  const mergedPath = !relativePath
    ? (basePath || '/')
    : basePath && basePath !== '/'
      ? `${basePath}/${relativePath}`
      : `/${relativePath}`;
  base.pathname = mergedPath;
  return base;
}

function normalizeUpperMethod(method: string): string {
  const normalized = normalizeText(method, 16).toUpperCase();
  if (!normalized) return 'GET';
  return normalized;
}

function normalizePath(pathValue: string): string {
  const trimmed = normalizeText(pathValue, 1024);
  if (!trimmed) return '/';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return `/${trimmed}`;
}

async function connectorRequest(
  config: AppConnectorExtensionConfig,
  secret: string | null,
  input: {
    method?: string;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, unknown>;
  }
): Promise<RequestResult> {
  const request = buildConnectorRequest(config, secret, input);
  const response = await fetchWithTimeout(request.url, request.init);
  const data = await parseResponse(response);
  if (!response.ok) {
    const detail =
      typeof data === 'object' && data
        ? JSON.stringify(data)
        : String(data || response.statusText);
    throw new Error(`Request failed (${response.status}) at ${request.url}: ${detail}`);
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    status: response.status,
    headers,
    data,
    url: request.url,
  };
}

async function testAppConnector(
  connectorId: AppConnectorExtensionId,
  config: AppConnectorExtensionConfig,
  secret: string | null
): Promise<{ detail: string; metadata?: Record<string, string> }> {
  if (connectorId === 'obsidian') {
    const vaultPath = normalizeText(config.baseUrl || getMetadataValue(config, 'vault_path'), 1024);
    if (!vaultPath) {
      throw new Error('Set base URL or metadata.vault_path to your Obsidian vault path.');
    }
    if (!fs.existsSync(vaultPath)) {
      throw new Error(`Vault path does not exist: ${vaultPath}`);
    }
    return {
      detail: 'Obsidian vault path is reachable.',
      metadata: { vaultPath },
    };
  }

  if (connectorId === 'email-triggers') {
    const webhookUrl = normalizeText(getMetadataValue(config, 'webhook_url'), 1024);
    if (!webhookUrl) {
      throw new Error('Set metadata.webhook_url for email triggers.');
    }
    return {
      detail: 'Email trigger webhook is configured.',
      metadata: { webhookUrl },
    };
  }

  if (connectorId === 'canva') {
    if (!secret) {
      throw new Error('Set a Canva access token first.');
    }
    return {
      detail: 'Canva connector token is set. Use action=request with Canva API endpoints.',
    };
  }

  if (
    connectorId === 'google-slides'
    || connectorId === 'google-tasks'
    || connectorId === 'google-sheets'
    || connectorId === 'google-docs'
    || connectorId === 'google-drive'
    || connectorId === 'google-photos'
    || connectorId === 'youtube'
    || connectorId === 'gmail'
    || connectorId === 'google-calendar'
  ) {
    const response = await fetchWithTimeout('https://www.googleapis.com/oauth2/v3/userinfo', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret || ''}`,
      },
    });
    const data = await parseResponse(response);
    if (!response.ok) {
      throw new Error(`Google auth test failed (${response.status}).`);
    }
    const json = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
    return {
      detail: 'Connected to Google OAuth APIs.',
      metadata: {
        user: String(json.email ?? json.sub ?? ''),
      },
    };
  }

  if (connectorId === 'microsoft-outlook' || connectorId === 'onedrive') {
    const res = await connectorRequest(config, secret, {
      method: 'GET',
      path: '/me',
    });
    const data = (res.data && typeof res.data === 'object') ? (res.data as Record<string, unknown>) : {};
    return {
      detail: 'Connected to Microsoft Graph.',
      metadata: {
        user: String(data.userPrincipalName ?? data.mail ?? data.id ?? ''),
      },
    };
  }

  if (connectorId === 'dropbox') {
    await connectorRequest(config, secret, {
      method: 'POST',
      path: '/users/get_current_account',
      body: {},
    });
    return { detail: 'Connected to Dropbox API.' };
  }

  if (connectorId === 'notion') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/users/me',
    });
    return { detail: 'Connected to Notion API.' };
  }

  if (connectorId === 'github') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/user',
    });
    return { detail: 'Connected to GitHub API.' };
  }

  if (connectorId === 'slack') {
    const result = await connectorRequest(config, secret, {
      method: 'GET',
      path: '/auth.test',
    });
    const data = (result.data && typeof result.data === 'object')
      ? (result.data as Record<string, unknown>)
      : {};
    if (data.ok === false) {
      throw new Error(`Slack auth.test failed: ${String(data.error ?? 'unknown_error')}`);
    }
    return {
      detail: 'Connected to Slack API.',
      metadata: {
        teamId: String(data.team_id ?? ''),
        userId: String(data.user_id ?? ''),
      },
    };
  }

  if (connectorId === 'trello') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/members/me',
    });
    return { detail: 'Connected to Trello API.' };
  }

  if (connectorId === 'supabase') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/rest/v1/',
      query: { limit: 1 },
    });
    return { detail: 'Connected to Supabase REST API.' };
  }

  if (connectorId === 'figma') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/me',
    });
    return { detail: 'Connected to Figma API.' };
  }

  if (connectorId === 'miro') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/users/me',
    });
    return { detail: 'Connected to Miro API.' };
  }

  if (connectorId === 'google-maps') {
    await connectorRequest(config, secret, {
      method: 'GET',
      path: '/geocode/json',
      query: { address: 'London' },
    });
    return { detail: 'Connected to Google Maps API.' };
  }

  return { detail: 'Connector configured.' };
}

export async function listAppConnectorRuntimeStatuses(): Promise<AppConnectorRuntimeStatus[]> {
  const configs = listAppConnectorExtensionConfigs();
  const statuses = await Promise.all(
    configs.map(async (config) => {
      const runtimeKey = getAppConnectorRuntimeKey(config.id, config.instanceId);
      const definition = getConnectorDefinition(config.id);
      const authMethod = definition?.authMethod ?? 'token';
      const secretValue = parseConnectorSecret(await getAppConnectorSecret(runtimeKey));
      const secretSet = Boolean(secretValue.token && secretValue.token.trim().length > 0);
      const oauthExpiredWithoutRefresh = authMethod === 'oauth2'
        && isSecretNearExpiry(secretValue)
        && !secretValue.refreshToken;
      const configured = authMethod === 'local'
        ? Boolean(normalizeText(config.baseUrl || getMetadataValue(config, 'vault_path'), 1024))
        : authMethod === 'webhook'
          ? Boolean(getMetadataValue(config, 'webhook_url'))
          : (secretSet && !oauthExpiredWithoutRefresh);
      const detail = !config.enabled
        ? 'Connector disabled.'
        : !configured
          ? (oauthExpiredWithoutRefresh
            ? 'OAuth token expired and cannot auto-refresh. Reconnect OAuth.'
            : 'Connector credentials/config are missing.')
          : (
            authMethod === 'oauth2'
              ? (secretValue.refreshToken
                ? 'Connector configured (OAuth auto-refresh enabled).'
                : 'Connector configured (OAuth access token).')
              : 'Connector configured.'
          );
      return {
        connectorId: config.id,
        instanceId: config.instanceId,
        runtimeKey,
        instanceName: config.name,
        configured,
        running: Boolean(config.enabled && configured),
        mode: getRuntimeMode(authMethod),
        detail,
      } satisfies AppConnectorRuntimeStatus;
    })
  );
  statuses.sort((a, b) => {
    if (a.connectorId !== b.connectorId) return a.connectorId.localeCompare(b.connectorId);
    return (a.instanceId ?? 'default').localeCompare(b.instanceId ?? 'default');
  });
  return statuses;
}

export async function testAppConnectorRuntime(
  connectorId: AppConnectorExtensionId,
  instanceId?: string
): Promise<AppConnectorRuntimeTestResult> {
  const config = resolveAppConnectorExtensionConfig({
    id: connectorId,
    instanceId,
    enabledOnly: false,
  });
  const runtimeKey = getAppConnectorRuntimeKey(connectorId, config.instanceId);
  if (!config.enabled) {
    return {
      connectorId,
      instanceId: config.instanceId,
      runtimeKey,
      ok: false,
      detail: 'Connector is disabled.',
    };
  }

  const definition = getConnectorDefinition(connectorId);
  const authMethod = definition?.authMethod ?? 'token';
  try {
    const secret = await resolveSecretForRuntime({
      runtimeKey,
      authMethod,
    });
    const tested = await testAppConnector(connectorId, config, secret.token);
    return {
      connectorId,
      instanceId: config.instanceId,
      runtimeKey,
      ok: true,
      detail: tested.detail,
      metadata: tested.metadata,
    };
  } catch (error) {
    return {
      connectorId,
      instanceId: config.instanceId,
      runtimeKey,
      ok: false,
      detail: error instanceof Error ? error.message : 'Connection test failed.',
    };
  }
}

function resolveObsidianVaultPath(config: AppConnectorExtensionConfig): string {
  const vaultPath = normalizeText(config.baseUrl || getMetadataValue(config, 'vault_path'), 1024);
  if (!vaultPath) {
    throw new Error('Set base URL or metadata.vault_path to your Obsidian vault path.');
  }
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }
  return vaultPath;
}

function ensureSafeObsidianRelativePath(pathInput: unknown): string {
  const relPath = normalizeText(pathInput, 512);
  if (!relPath) {
    throw new Error('args.path is required.');
  }
  if (relPath.includes('..') || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error('args.path must be a safe vault-relative path.');
  }
  return relPath;
}

export async function executeAppConnectorAction(
  input: AppConnectorExecuteInput
): Promise<AppConnectorExecuteResult> {
  const connectorId = input.connectorId;
  const action = normalizeLower(input.action, 96);
  if (!action) {
    throw new Error('action is required.');
  }

  const config = resolveAppConnectorExtensionConfig({
    id: connectorId,
    instanceId: input.connectorInstanceId,
    enabledOnly: false,
  });
  if (!config.enabled) {
    throw new Error(`App connector "${connectorId}" is disabled.`);
  }
  const runtimeKey = getAppConnectorRuntimeKey(connectorId, config.instanceId);
  const definition = getConnectorDefinition(connectorId);
  const authMethod = definition?.authMethod ?? 'token';
  const secretValue = await resolveSecretForRuntime({
    runtimeKey,
    authMethod,
  });

  const args = (input.args && typeof input.args === 'object' && !Array.isArray(input.args))
    ? input.args as Record<string, unknown>
    : {};

  if (connectorId === 'obsidian' && action === 'read_note') {
    const vaultPath = resolveObsidianVaultPath(config);
    const relativePath = ensureSafeObsidianRelativePath(args.path);
    const absolutePath = path.join(vaultPath, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Read note ${relativePath}.`,
      data: { path: relativePath, content },
    };
  }

  if (connectorId === 'obsidian' && action === 'write_note') {
    const vaultPath = resolveObsidianVaultPath(config);
    const relativePath = ensureSafeObsidianRelativePath(args.path);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!content.trim()) {
      throw new Error('args.content is required.');
    }
    const absolutePath = path.join(vaultPath, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf-8');
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Wrote note ${relativePath}.`,
      data: { path: relativePath },
    };
  }

  if (connectorId === 'slack' && action === 'send_message') {
    const channel = normalizeText(args.channel, 128);
    const text = normalizeText(args.text, 6000);
    if (!channel || !text) {
      throw new Error('args.channel and args.text are required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/chat.postMessage',
      body: {
        channel,
        text,
        thread_ts: normalizeText(args.thread_ts, 128) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Sent Slack message to ${channel}.`,
      data: result.data,
    };
  }

  if (connectorId === 'github' && action === 'create_issue') {
    const owner = normalizeText(args.owner, 128);
    const repo = normalizeText(args.repo, 128);
    const title = normalizeText(args.title, 256);
    const body = typeof args.body === 'string' ? args.body : '';
    if (!owner || !repo || !title) {
      throw new Error('args.owner, args.repo, and args.title are required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/repos/${owner}/${repo}/issues`,
      body: {
        title,
        body: body || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created issue in ${owner}/${repo}.`,
      data: result.data,
    };
  }

  if (connectorId === 'notion' && action === 'search') {
    const query = normalizeText(args.query, 512);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/search',
      body: query ? { query } : {},
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Executed Notion search.',
      data: result.data,
    };
  }

  if (connectorId === 'trello' && action === 'list_boards') {
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/members/me/boards',
      query: {
        fields: normalizeText(args.fields, 1024) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Trello boards.',
      data: result.data,
    };
  }

  if (connectorId === 'trello' && action === 'list_cards') {
    const boardId = normalizeText(args.boardId, 256);
    if (!boardId) {
      throw new Error('args.boardId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/boards/${encodeURIComponent(boardId)}/cards`,
      query: {
        fields: normalizeText(args.fields, 1024) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed Trello cards for board ${boardId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'trello' && action === 'create_card') {
    const idList = normalizeText(args.idList, 256);
    const name = normalizeText(args.name, 512);
    if (!idList || !name) {
      throw new Error('args.idList and args.name are required.');
    }
    const memberIds = normalizeStringList(args.idMembers, 256);
    const labelIds = normalizeStringList(args.idLabels, 256);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/cards',
      query: {
        idList,
        name,
        desc: normalizeText(args.desc, 8000) || undefined,
        pos: normalizeText(args.pos, 32) || undefined,
        due: normalizeText(args.due, 128) || undefined,
        idMembers: memberIds.length > 0 ? memberIds.join(',') : undefined,
        idLabels: labelIds.length > 0 ? labelIds.join(',') : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Trello card "${name}".`,
      data: result.data,
    };
  }

  if (connectorId === 'onedrive' && action === 'list_root_children') {
    const topRaw = Number(args.top);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/me/drive/root/children',
      query: {
        '$top': Number.isFinite(topRaw) && topRaw > 0 ? Math.min(200, Math.floor(topRaw)) : undefined,
        '$select': normalizeText(args.select, 2000) || undefined,
        '$orderby': normalizeText(args.orderBy, 256) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed OneDrive root items.',
      data: result.data,
    };
  }

  if (connectorId === 'onedrive' && action === 'list_children') {
    const itemId = normalizeText(args.itemId, 256);
    if (!itemId) {
      throw new Error('args.itemId is required.');
    }
    const topRaw = Number(args.top);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/me/drive/items/${encodeURIComponent(itemId)}/children`,
      query: {
        '$top': Number.isFinite(topRaw) && topRaw > 0 ? Math.min(200, Math.floor(topRaw)) : undefined,
        '$select': normalizeText(args.select, 2000) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed OneDrive children for ${itemId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'onedrive' && action === 'create_folder') {
    const name = normalizeText(args.name, 256);
    if (!name) {
      throw new Error('args.name is required.');
    }
    const parentId = normalizeText(args.parentId, 256);
    const conflictBehavior = normalizeText(args.conflictBehavior, 32) || 'rename';
    const pathValue = parentId
      ? `/me/drive/items/${encodeURIComponent(parentId)}/children`
      : '/me/drive/root/children';
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: pathValue,
      body: {
        name,
        folder: {},
        '@microsoft.graph.conflictBehavior': conflictBehavior,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created OneDrive folder "${name}".`,
      data: result.data,
    };
  }

  if (connectorId === 'supabase' && action === 'select_rows') {
    const table = normalizeText(args.table, 256);
    if (!table) {
      throw new Error('args.table is required.');
    }
    const query: Record<string, unknown> = {};
    if (args.query && typeof args.query === 'object' && !Array.isArray(args.query)) {
      Object.assign(query, args.query as Record<string, unknown>);
    }
    if (!query.select) {
      query.select = normalizeText(args.select, 2000) || '*';
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/rest/v1/${encodeURIComponent(table)}`,
      query,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Selected rows from Supabase table ${table}.`,
      data: result.data,
    };
  }

  if (connectorId === 'supabase' && action === 'insert_rows') {
    const table = normalizeText(args.table, 256);
    if (!table) {
      throw new Error('args.table is required.');
    }
    const rows = Array.isArray(args.rows)
      ? args.rows
      : (args.row && typeof args.row === 'object' ? [args.row] : []);
    if (rows.length === 0) {
      throw new Error('args.row (object) or args.rows (array) is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/rest/v1/${encodeURIComponent(table)}`,
      query: {
        returning: normalizeText(args.returning, 32) || 'representation',
      },
      body: rows,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Inserted ${rows.length} row(s) into Supabase table ${table}.`,
      data: result.data,
    };
  }

  if (connectorId === 'supabase' && action === 'update_rows') {
    const table = normalizeText(args.table, 256);
    if (!table) {
      throw new Error('args.table is required.');
    }
    const changes = (args.changes && typeof args.changes === 'object' && !Array.isArray(args.changes))
      ? (args.changes as Record<string, unknown>)
      : null;
    if (!changes) {
      throw new Error('args.changes is required.');
    }
    const query: Record<string, unknown> = {};
    if (args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)) {
      Object.assign(query, args.filters as Record<string, unknown>);
    }
    if (args.query && typeof args.query === 'object' && !Array.isArray(args.query)) {
      Object.assign(query, args.query as Record<string, unknown>);
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'PATCH',
      path: `/rest/v1/${encodeURIComponent(table)}`,
      query,
      body: changes,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Updated rows in Supabase table ${table}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-slides' && action === 'get_presentation') {
    const presentationId = normalizeText(args.presentationId, 256);
    if (!presentationId) {
      throw new Error('args.presentationId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/presentations/${encodeURIComponent(presentationId)}`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Google Slides presentation ${presentationId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-slides' && action === 'create_presentation') {
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/presentations',
      body: {
        title: normalizeText(args.title, 512) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Created Google Slides presentation.',
      data: result.data,
    };
  }

  if (connectorId === 'google-slides' && action === 'batch_update') {
    const presentationId = normalizeText(args.presentationId, 256);
    if (!presentationId) {
      throw new Error('args.presentationId is required.');
    }
    const requests = Array.isArray(args.requests) ? args.requests : [];
    if (requests.length === 0) {
      throw new Error('args.requests is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
      body: {
        requests,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Updated Google Slides presentation ${presentationId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-tasks' && action === 'list_tasklists') {
    const maxResultsRaw = Number(args.maxResults);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/users/@me/lists',
      query: {
        maxResults: Number.isFinite(maxResultsRaw) && maxResultsRaw > 0 ? Math.min(100, Math.floor(maxResultsRaw)) : undefined,
        pageToken: normalizeText(args.pageToken, 512) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Google Tasks tasklists.',
      data: result.data,
    };
  }

  if (connectorId === 'google-tasks' && action === 'list_tasks') {
    const tasklistId = normalizeText(args.tasklistId, 256);
    if (!tasklistId) {
      throw new Error('args.tasklistId is required.');
    }
    const maxResultsRaw = Number(args.maxResults);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/lists/${encodeURIComponent(tasklistId)}/tasks`,
      query: {
        maxResults: Number.isFinite(maxResultsRaw) && maxResultsRaw > 0 ? Math.min(100, Math.floor(maxResultsRaw)) : undefined,
        pageToken: normalizeText(args.pageToken, 512) || undefined,
        showCompleted: args.showCompleted === undefined ? undefined : Boolean(args.showCompleted),
        showHidden: args.showHidden === undefined ? undefined : Boolean(args.showHidden),
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed Google Tasks tasks from list ${tasklistId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-tasks' && action === 'create_task') {
    const tasklistId = normalizeText(args.tasklistId, 256);
    if (!tasklistId) {
      throw new Error('args.tasklistId is required.');
    }
    const taskBody = (args.task && typeof args.task === 'object' && !Array.isArray(args.task))
      ? (args.task as Record<string, unknown>)
      : {
        title: normalizeText(args.title, 512) || undefined,
        notes: normalizeText(args.notes, 8000) || undefined,
        due: normalizeText(args.due, 128) || undefined,
      };
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/lists/${encodeURIComponent(tasklistId)}/tasks`,
      body: taskBody,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Google Task in list ${tasklistId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-sheets' && action === 'get_values') {
    const spreadsheetId = normalizeText(args.spreadsheetId, 256);
    const range = normalizeText(args.range, 1024);
    if (!spreadsheetId || !range) {
      throw new Error('args.spreadsheetId and args.range are required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      query: {
        majorDimension: normalizeText(args.majorDimension, 32) || undefined,
        valueRenderOption: normalizeText(args.valueRenderOption, 64) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Google Sheets range ${range}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-sheets' && action === 'update_values') {
    const spreadsheetId = normalizeText(args.spreadsheetId, 256);
    const range = normalizeText(args.range, 1024);
    if (!spreadsheetId || !range) {
      throw new Error('args.spreadsheetId and args.range are required.');
    }
    const values = Array.isArray(args.values) ? args.values : null;
    if (!values) {
      throw new Error('args.values is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'PUT',
      path: `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      query: {
        valueInputOption: normalizeText(args.valueInputOption, 32) || 'RAW',
      },
      body: {
        range,
        majorDimension: normalizeText(args.majorDimension, 32) || 'ROWS',
        values,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Updated Google Sheets range ${range}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-sheets' && action === 'append_values') {
    const spreadsheetId = normalizeText(args.spreadsheetId, 256);
    const range = normalizeText(args.range, 1024);
    if (!spreadsheetId || !range) {
      throw new Error('args.spreadsheetId and args.range are required.');
    }
    const values = Array.isArray(args.values) ? args.values : null;
    if (!values) {
      throw new Error('args.values is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
      query: {
        valueInputOption: normalizeText(args.valueInputOption, 32) || 'RAW',
        insertDataOption: normalizeText(args.insertDataOption, 32) || 'INSERT_ROWS',
      },
      body: {
        majorDimension: normalizeText(args.majorDimension, 32) || 'ROWS',
        values,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Appended values to Google Sheets range ${range}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-docs' && action === 'get_document') {
    const documentId = normalizeText(args.documentId, 256);
    if (!documentId) {
      throw new Error('args.documentId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/documents/${encodeURIComponent(documentId)}`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Google Doc ${documentId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-docs' && action === 'create_document') {
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/documents',
      body: {
        title: normalizeText(args.title, 512) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Created Google Doc.',
      data: result.data,
    };
  }

  if (connectorId === 'google-docs' && action === 'batch_update') {
    const documentId = normalizeText(args.documentId, 256);
    if (!documentId) {
      throw new Error('args.documentId is required.');
    }
    const requests = Array.isArray(args.requests) ? args.requests : [];
    if (requests.length === 0) {
      throw new Error('args.requests is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      body: {
        requests,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Updated Google Doc ${documentId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-photos' && action === 'list_media_items') {
    const pageSizeRaw = Number(args.pageSize);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/mediaItems',
      query: {
        pageSize: Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(100, Math.floor(pageSizeRaw)) : undefined,
        pageToken: normalizeText(args.pageToken, 512) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Google Photos media items.',
      data: result.data,
    };
  }

  if (connectorId === 'google-photos' && action === 'search_media_items') {
    const pageSizeRaw = Number(args.pageSize);
    const body: Record<string, unknown> = {};
    if (Number.isFinite(pageSizeRaw) && pageSizeRaw > 0) {
      body.pageSize = Math.min(100, Math.floor(pageSizeRaw));
    }
    const pageToken = normalizeText(args.pageToken, 512);
    if (pageToken) body.pageToken = pageToken;
    const albumId = normalizeText(args.albumId, 256);
    if (albumId) body.albumId = albumId;
    if (args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)) {
      body.filters = args.filters;
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/mediaItems:search',
      body,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Searched Google Photos media items.',
      data: result.data,
    };
  }

  if (connectorId === 'google-photos' && action === 'create_album') {
    const title = normalizeText(args.title, 512);
    if (!title) {
      throw new Error('args.title is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/albums',
      body: {
        album: { title },
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Google Photos album "${title}".`,
      data: result.data,
    };
  }

  if (connectorId === 'google-maps' && action === 'geocode') {
    const address = normalizeText(args.address, 1024);
    if (!address) {
      throw new Error('args.address is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/geocode/json',
      query: {
        address,
        language: normalizeText(args.language, 32) || undefined,
        region: normalizeText(args.region, 8) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Geocoded address "${address}".`,
      data: result.data,
    };
  }

  if (connectorId === 'google-maps' && action === 'reverse_geocode') {
    const latlng = normalizeText(args.latlng, 128)
      || (
        Number.isFinite(Number(args.lat)) && Number.isFinite(Number(args.lng))
          ? `${Number(args.lat)},${Number(args.lng)}`
          : ''
      );
    if (!latlng) {
      throw new Error('args.latlng or args.lat + args.lng is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/geocode/json',
      query: {
        latlng,
        language: normalizeText(args.language, 32) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Reverse geocoded coordinates ${latlng}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-maps' && action === 'place_text_search') {
    const queryText = normalizeText(args.queryText, 1024) || normalizeText(args.query, 1024);
    if (!queryText) {
      throw new Error('args.queryText or args.query is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/place/textsearch/json',
      query: {
        query: queryText,
        language: normalizeText(args.language, 32) || undefined,
        region: normalizeText(args.region, 8) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Executed Google Maps text search "${queryText}".`,
      data: result.data,
    };
  }

  if (connectorId === 'youtube' && action === 'search_videos') {
    const q = normalizeText(args.q, 1024) || normalizeText(args.query, 1024);
    if (!q) {
      throw new Error('args.q or args.query is required.');
    }
    const maxResultsRaw = Number(args.maxResults);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/search',
      query: {
        part: normalizeText(args.part, 256) || 'snippet',
        q,
        type: normalizeText(args.type, 64) || 'video',
        order: normalizeText(args.order, 64) || undefined,
        pageToken: normalizeText(args.pageToken, 512) || undefined,
        maxResults: Number.isFinite(maxResultsRaw) && maxResultsRaw > 0 ? Math.min(50, Math.floor(maxResultsRaw)) : 25,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Searched YouTube for "${q}".`,
      data: result.data,
    };
  }

  if (connectorId === 'youtube' && action === 'list_videos') {
    const videoIds = normalizeStringList(args.ids, 128);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/videos',
      query: {
        part: normalizeText(args.part, 256) || 'snippet,contentDetails,statistics',
        id: videoIds.length > 0 ? videoIds.join(',') : undefined,
        chart: normalizeText(args.chart, 64) || undefined,
        regionCode: normalizeText(args.regionCode, 8) || undefined,
        maxResults: Number.isFinite(Number(args.maxResults)) && Number(args.maxResults) > 0
          ? Math.min(50, Math.floor(Number(args.maxResults)))
          : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed YouTube videos.',
      data: result.data,
    };
  }

  if (connectorId === 'youtube' && action === 'list_channels') {
    const channelIds = normalizeStringList(args.ids, 128);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/channels',
      query: {
        part: normalizeText(args.part, 256) || 'snippet,contentDetails,statistics',
        id: channelIds.length > 0 ? channelIds.join(',') : undefined,
        mine: args.mine === true ? 'true' : undefined,
        forHandle: normalizeText(args.forHandle, 256) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed YouTube channels.',
      data: result.data,
    };
  }

  if (connectorId === 'figma' && action === 'get_file') {
    const fileKey = normalizeText(args.fileKey, 256);
    if (!fileKey) {
      throw new Error('args.fileKey is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/files/${encodeURIComponent(fileKey)}`,
      query: {
        depth: Number.isFinite(Number(args.depth)) && Number(args.depth) > 0
          ? Math.floor(Number(args.depth))
          : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Figma file ${fileKey}.`,
      data: result.data,
    };
  }

  if (connectorId === 'figma' && action === 'get_file_nodes') {
    const fileKey = normalizeText(args.fileKey, 256);
    const nodeIds = normalizeStringList(args.nodeIds, 256);
    if (!fileKey || nodeIds.length === 0) {
      throw new Error('args.fileKey and args.nodeIds are required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/files/${encodeURIComponent(fileKey)}/nodes`,
      query: {
        ids: nodeIds.join(','),
        depth: Number.isFinite(Number(args.depth)) && Number(args.depth) > 0
          ? Math.floor(Number(args.depth))
          : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded ${nodeIds.length} node(s) from Figma file ${fileKey}.`,
      data: result.data,
    };
  }

  if (connectorId === 'figma' && action === 'list_team_projects') {
    const teamId = normalizeText(args.teamId, 256);
    if (!teamId) {
      throw new Error('args.teamId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/projects`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed Figma projects for team ${teamId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'email-triggers' && action === 'get_config') {
    const webhookUrl = normalizeText(getMetadataValue(config, 'webhook_url'), 2048);
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: webhookUrl ? 'Email trigger webhook is configured.' : 'Email trigger webhook is not configured.',
      data: {
        webhookUrl: webhookUrl || null,
        metadata: config.metadata || {},
      },
    };
  }

  if (connectorId === 'email-triggers' && action === 'send_test_event') {
    const webhookUrl = normalizeText(
      args.webhookUrl || getMetadataValue(config, 'webhook_url'),
      2048
    );
    if (!webhookUrl) {
      throw new Error('Set metadata.webhook_url or provide args.webhookUrl.');
    }
    const payload = (args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload))
      ? args.payload
      : {
        type: 'email.trigger.test',
        at: new Date().toISOString(),
        subject: normalizeText(args.subject, 512) || 'Test email trigger',
      };
    const response = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sanitizeRecord(args.headers),
      },
      body: JSON.stringify(payload),
    });
    const responseData = await parseResponse(response);
    if (!response.ok) {
      const detail = typeof responseData === 'object' && responseData
        ? JSON.stringify(responseData)
        : String(responseData || response.statusText);
      throw new Error(`Webhook request failed (${response.status}): ${detail}`);
    }
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Sent test event to ${webhookUrl}.`,
      data: responseData,
    };
  }

  if (connectorId === 'google-calendar' && action === 'list_events') {
    const calendarId = normalizeText(args.calendarId, 256) || 'primary';
    const maxResultsRaw = Number(args.maxResults);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      query: {
        timeMin: normalizeText(args.timeMin, 128) || undefined,
        timeMax: normalizeText(args.timeMax, 128) || undefined,
        q: normalizeText(args.q, 1024) || undefined,
        orderBy: normalizeText(args.orderBy, 64) || undefined,
        singleEvents: args.singleEvents === undefined ? undefined : Boolean(args.singleEvents),
        pageToken: normalizeText(args.pageToken, 512) || undefined,
        maxResults: Number.isFinite(maxResultsRaw) && maxResultsRaw > 0 ? Math.min(2500, Math.floor(maxResultsRaw)) : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed Google Calendar events for ${calendarId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-calendar' && action === 'create_event') {
    const calendarId = normalizeText(args.calendarId, 256) || 'primary';
    const event = (args.event && typeof args.event === 'object' && !Array.isArray(args.event))
      ? (args.event as Record<string, unknown>)
      : null;
    const eventBody = event ?? (() => {
      const summary = normalizeText(args.summary, 512);
      const startDateTime = normalizeText(args.startDateTime, 128);
      const endDateTime = normalizeText(args.endDateTime, 128);
      if (!summary || !startDateTime || !endDateTime) {
        throw new Error('args.summary, args.startDateTime, and args.endDateTime are required when args.event is not provided.');
      }
      const timeZone = normalizeText(args.timeZone, 64) || 'UTC';
      return {
        summary,
        description: normalizeText(args.description, 8000) || undefined,
        location: normalizeText(args.location, 512) || undefined,
        start: {
          dateTime: startDateTime,
          timeZone,
        },
        end: {
          dateTime: endDateTime,
          timeZone,
        },
      };
    })();
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      body: eventBody,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Google Calendar event in ${calendarId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-calendar' && action === 'delete_event') {
    const calendarId = normalizeText(args.calendarId, 256) || 'primary';
    const eventId = normalizeText(args.eventId, 256);
    if (!eventId) {
      throw new Error('args.eventId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'DELETE',
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Deleted Google Calendar event ${eventId} from ${calendarId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-drive' && action === 'list_files') {
    const query: Record<string, unknown> = {};
    if (args.query && typeof args.query === 'object' && !Array.isArray(args.query)) {
      Object.assign(query, args.query as Record<string, unknown>);
    }
    const q = normalizeText(args.q, 2000);
    const pageToken = normalizeText(args.pageToken, 512);
    const orderBy = normalizeText(args.orderBy, 256);
    const fields = normalizeText(args.fields, 2000) || 'files(id,name,mimeType,modifiedTime),nextPageToken';
    const spaces = normalizeText(args.spaces, 128);
    const pageSizeRaw = Number(args.pageSize);
    if (q) query.q = q;
    if (pageToken) query.pageToken = pageToken;
    if (orderBy) query.orderBy = orderBy;
    if (fields) query.fields = fields;
    if (spaces) query.spaces = spaces;
    if (Number.isFinite(pageSizeRaw) && pageSizeRaw > 0) {
      query.pageSize = Math.min(1000, Math.floor(pageSizeRaw));
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/files',
      query,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Google Drive files.',
      data: result.data,
    };
  }

  if (connectorId === 'google-drive' && action === 'get_file') {
    const fileId = normalizeText(args.fileId, 512);
    if (!fileId) {
      throw new Error('args.fileId is required.');
    }
    const fields = normalizeText(args.fields, 2000) || 'id,name,mimeType,modifiedTime,size,parents,webViewLink';
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/files/${encodeURIComponent(fileId)}`,
      query: {
        fields,
        supportsAllDrives: args.supportsAllDrives === undefined ? undefined : Boolean(args.supportsAllDrives),
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Google Drive file ${fileId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'google-drive' && action === 'create_folder') {
    const name = normalizeText(args.name, 256);
    if (!name) {
      throw new Error('args.name is required.');
    }
    const parents = normalizeStringList(args.parents, 256);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/files',
      query: {
        fields: normalizeText(args.fields, 2000) || 'id,name,mimeType,parents,webViewLink',
        supportsAllDrives: args.supportsAllDrives === undefined ? undefined : Boolean(args.supportsAllDrives),
      },
      body: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parents.length > 0 ? parents : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Google Drive folder "${name}".`,
      data: result.data,
    };
  }

  if (connectorId === 'google-drive' && action === 'delete_file') {
    const fileId = normalizeText(args.fileId, 512);
    if (!fileId) {
      throw new Error('args.fileId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'DELETE',
      path: `/files/${encodeURIComponent(fileId)}`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Deleted Google Drive file ${fileId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'gmail' && action === 'list_messages') {
    const userId = normalizeText(args.userId, 128) || 'me';
    const q = normalizeText(args.q, 2000);
    const pageToken = normalizeText(args.pageToken, 512);
    const includeSpamTrash = args.includeSpamTrash === undefined ? undefined : Boolean(args.includeSpamTrash);
    const maxResultsRaw = Number(args.maxResults);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/users/${encodeURIComponent(userId)}/messages`,
      query: {
        q: q || undefined,
        pageToken: pageToken || undefined,
        includeSpamTrash,
        maxResults: Number.isFinite(maxResultsRaw) && maxResultsRaw > 0
          ? Math.min(500, Math.floor(maxResultsRaw))
          : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed Gmail messages for ${userId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'gmail' && action === 'get_message') {
    const userId = normalizeText(args.userId, 128) || 'me';
    const messageId = normalizeText(args.messageId, 512);
    if (!messageId) {
      throw new Error('args.messageId is required.');
    }
    const format = normalizeText(args.format, 32) || 'full';
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
      query: {
        format,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Gmail message ${messageId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'gmail' && action === 'send_message') {
    const userId = normalizeText(args.userId, 128) || 'me';
    const raw = normalizeText(args.raw, 200000) || buildGmailRawMessage(args);
    const threadId = normalizeText(args.threadId, 256) || undefined;
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: `/users/${encodeURIComponent(userId)}/messages/send`,
      body: {
        raw,
        threadId,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Sent Gmail message as ${userId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'microsoft-outlook' && action === 'list_messages') {
    const topRaw = Number(args.top);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/me/messages',
      query: {
        '$top': Number.isFinite(topRaw) && topRaw > 0 ? Math.min(200, Math.floor(topRaw)) : undefined,
        '$filter': normalizeText(args.filter, 2000) || undefined,
        '$orderby': normalizeText(args.orderBy, 256) || undefined,
        '$select': normalizeText(args.select, 2000) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Outlook messages.',
      data: result.data,
    };
  }

  if (connectorId === 'microsoft-outlook' && action === 'send_message') {
    const toRecipients = toOutlookRecipients(args.to);
    if (toRecipients.length === 0) {
      throw new Error('args.to is required.');
    }
    const subject = normalizeText(args.subject, 512);
    if (!subject) {
      throw new Error('args.subject is required.');
    }
    const bodyContent = normalizeText(args.body, 40000) || normalizeText(args.text, 40000);
    if (!bodyContent) {
      throw new Error('args.body or args.text is required.');
    }
    const isHtml = Boolean(args.html === true);
    const ccRecipients = toOutlookRecipients(args.cc);
    const bccRecipients = toOutlookRecipients(args.bcc);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/me/sendMail',
      body: {
        message: {
          subject,
          body: {
            contentType: isHtml ? 'HTML' : 'Text',
            content: bodyContent,
          },
          toRecipients,
          ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
          bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
        },
        saveToSentItems: args.saveToSentItems === undefined ? true : Boolean(args.saveToSentItems),
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Sent Outlook message.',
      data: result.data,
    };
  }

  if (connectorId === 'microsoft-outlook' && action === 'list_events') {
    const topRaw = Number(args.top);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/me/events',
      query: {
        '$top': Number.isFinite(topRaw) && topRaw > 0 ? Math.min(200, Math.floor(topRaw)) : undefined,
        '$filter': normalizeText(args.filter, 2000) || undefined,
        '$orderby': normalizeText(args.orderBy, 256) || undefined,
        '$select': normalizeText(args.select, 2000) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Outlook events.',
      data: result.data,
    };
  }

  if (connectorId === 'microsoft-outlook' && action === 'create_event') {
    const eventPayload = (args.event && typeof args.event === 'object' && !Array.isArray(args.event))
      ? (args.event as Record<string, unknown>)
      : null;
    const body = eventPayload ?? (() => {
      const subject = normalizeText(args.subject, 512);
      const startDateTime = normalizeText(args.startDateTime, 128);
      const endDateTime = normalizeText(args.endDateTime, 128);
      if (!subject || !startDateTime || !endDateTime) {
        throw new Error('args.subject, args.startDateTime, and args.endDateTime are required when args.event is not provided.');
      }
      const timeZone = normalizeText(args.timeZone, 64) || 'UTC';
      return {
        subject,
        body: {
          contentType: args.html ? 'HTML' : 'Text',
          content: normalizeText(args.body, 40000) || '',
        },
        start: {
          dateTime: startDateTime,
          timeZone,
        },
        end: {
          dateTime: endDateTime,
          timeZone,
        },
        location: normalizeText(args.location, 512)
          ? { displayName: normalizeText(args.location, 512) }
          : undefined,
        attendees: toOutlookRecipients(args.attendees).map((recipient) => ({
          ...recipient,
          type: 'required',
        })),
      };
    })();
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/me/events',
      body,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Created Outlook event.',
      data: result.data,
    };
  }

  if (connectorId === 'dropbox' && action === 'list_folder') {
    const dropboxPath = normalizeText(args.path, 1024);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/files/list_folder',
      body: {
        path: dropboxPath || '',
        recursive: Boolean(args.recursive),
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Listed Dropbox folder ${dropboxPath || '/'}.`,
      data: result.data,
    };
  }

  if (connectorId === 'dropbox' && action === 'create_folder') {
    const dropboxPath = normalizeText(args.path, 1024);
    if (!dropboxPath) {
      throw new Error('args.path is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/files/create_folder_v2',
      body: {
        path: dropboxPath,
        autorename: Boolean(args.autorename),
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Dropbox folder ${dropboxPath}.`,
      data: result.data,
    };
  }

  if (connectorId === 'dropbox' && action === 'delete_path') {
    const dropboxPath = normalizeText(args.path, 1024);
    if (!dropboxPath) {
      throw new Error('args.path is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/files/delete_v2',
      body: {
        path: dropboxPath,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Deleted Dropbox path ${dropboxPath}.`,
      data: result.data,
    };
  }

  if (connectorId === 'dropbox' && action === 'upload_text') {
    const dropboxPath = normalizeText(args.path, 1024);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!dropboxPath || !content) {
      throw new Error('args.path and args.content are required.');
    }
    const mode = normalizeText(args.mode, 32) || 'add';
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/files/upload',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode,
          autorename: Boolean(args.autorename),
          mute: Boolean(args.mute),
          strict_conflict: Boolean(args.strict_conflict),
        }),
      },
      body: content,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Uploaded text to Dropbox path ${dropboxPath}.`,
      data: result.data,
    };
  }

  if (connectorId === 'miro' && action === 'list_boards') {
    const limit = Number(args.limit);
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/boards',
      query: {
        cursor: normalizeText(args.cursor, 256) || undefined,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(50, Math.floor(limit)) : undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Miro boards.',
      data: result.data,
    };
  }

  if (connectorId === 'miro' && action === 'create_board') {
    const name = normalizeText(args.name, 256);
    if (!name) {
      throw new Error('args.name is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/boards',
      body: {
        name,
        description: normalizeText(args.description, 1000) || undefined,
      },
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Miro board "${name}".`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'list_designs') {
    const query: Record<string, unknown> = {};
    if (args.query && typeof args.query === 'object' && !Array.isArray(args.query)) {
      Object.assign(query, args.query as Record<string, unknown>);
    }
    const cursor = normalizeText(args.cursor, 256);
    const ownership = normalizeText(args.ownership, 64);
    const search = normalizeText(args.search, 512);
    const sortBy = normalizeText(args.sort_by, 128);
    const limitRaw = Number(args.limit);
    if (cursor) query.cursor = cursor;
    if (ownership) query.ownership = ownership;
    if (search) query.query = search;
    if (sortBy) query.sort_by = sortBy;
    if (Number.isFinite(limitRaw) && limitRaw > 0) {
      query.limit = Math.min(100, Math.floor(limitRaw));
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: '/designs',
      query,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: 'Listed Canva designs.',
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'get_design') {
    const designId = normalizeText(args.designId, 256);
    if (!designId) {
      throw new Error('args.designId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/designs/${encodeURIComponent(designId)}`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Canva design ${designId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'get_design_pages') {
    const designId = normalizeText(args.designId, 256);
    if (!designId) {
      throw new Error('args.designId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/designs/${encodeURIComponent(designId)}/pages`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded pages for Canva design ${designId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'get_export_formats') {
    const designId = normalizeText(args.designId, 256);
    if (!designId) {
      throw new Error('args.designId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/designs/${encodeURIComponent(designId)}/export-formats`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded export formats for Canva design ${designId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'create_design') {
    const title = normalizeText(args.title, 256) || undefined;
    const assetId = normalizeText(args.assetId, 256) || undefined;
    let designType: Record<string, unknown> | undefined;
    if (args.designType && typeof args.designType === 'object' && !Array.isArray(args.designType)) {
      designType = args.designType as Record<string, unknown>;
    } else {
      const presetName = normalizeText(args.presetName, 128);
      const width = Number(args.width);
      const height = Number(args.height);
      if (presetName) {
        designType = {
          type: 'preset',
          name: presetName,
        };
      } else if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        designType = {
          type: 'custom',
          width: Math.floor(width),
          height: Math.floor(height),
        };
      }
    }
    const body: Record<string, unknown> = {};
    if (title) body.title = title;
    if (assetId) body.asset_id = assetId;
    if (designType) body.design_type = designType;
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/designs',
      body,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Canva design${title ? ` "${title}"` : ''}.`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'create_export_job') {
    const designId = normalizeText(args.designId, 256);
    if (!designId) {
      throw new Error('args.designId is required.');
    }
    let format: Record<string, unknown>;
    if (args.format && typeof args.format === 'object' && !Array.isArray(args.format)) {
      format = args.format as Record<string, unknown>;
    } else {
      const formatType = normalizeText(args.formatType, 64);
      if (!formatType) {
        throw new Error('args.format (object) or args.formatType (string) is required.');
      }
      format = { type: formatType };
    }
    const body: Record<string, unknown> = {
      design_id: designId,
      format,
    };
    if (Array.isArray(args.pages)) {
      body.pages = args.pages;
    }
    if (args.exportQuality !== undefined) {
      body.export_quality = args.exportQuality;
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'POST',
      path: '/exports',
      body,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Created Canva export job for design ${designId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'get_export_job') {
    const exportId = normalizeText(args.exportId, 256);
    if (!exportId) {
      throw new Error('args.exportId is required.');
    }
    const result = await connectorRequest(config, secretValue.token, {
      method: 'GET',
      path: `/exports/${encodeURIComponent(exportId)}`,
    });
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Loaded Canva export job ${exportId}.`,
      data: result.data,
    };
  }

  if (connectorId === 'canva' && action === 'poll_export_job') {
    const exportId = normalizeText(args.exportId, 256);
    if (!exportId) {
      throw new Error('args.exportId is required.');
    }
    const intervalMsRaw = Number(args.intervalMs);
    const timeoutMsRaw = Number(args.timeoutMs);
    const intervalMs = Number.isFinite(intervalMsRaw) && intervalMsRaw > 0
      ? Math.max(500, Math.floor(intervalMsRaw))
      : 1500;
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.max(intervalMs, Math.floor(timeoutMsRaw))
      : 60_000;
    const deadline = Date.now() + timeoutMs;
    let latest: unknown = null;
    while (Date.now() <= deadline) {
      const result = await connectorRequest(config, secretValue.token, {
        method: 'GET',
        path: `/exports/${encodeURIComponent(exportId)}`,
      });
      latest = result.data;
      const body = (latest && typeof latest === 'object')
        ? (latest as Record<string, unknown>)
        : {};
      const status = normalizeLower(body.status, 64);
      if (status === 'success' || status === 'failed') {
        return {
          connectorId,
          connectorInstanceId: config.instanceId,
          runtimeKey,
          action,
          detail: `Canva export job ${exportId} ${status}.`,
          data: latest,
        };
      }
      await delayMs(intervalMs);
    }
    return {
      connectorId,
      connectorInstanceId: config.instanceId,
      runtimeKey,
      action,
      detail: `Timed out waiting for Canva export job ${exportId}.`,
      data: latest,
    };
  }

  if (action !== 'request') {
    throw new Error(
      `Unsupported action "${action}". Supported actions: request` +
      `${connectorId === 'obsidian' ? ', read_note, write_note' : ''}` +
      `${connectorId === 'slack' ? ', send_message' : ''}` +
      `${connectorId === 'github' ? ', create_issue' : ''}` +
      `${connectorId === 'notion' ? ', search' : ''}` +
      `${connectorId === 'trello' ? ', list_boards, list_cards, create_card' : ''}` +
      `${connectorId === 'onedrive' ? ', list_root_children, list_children, create_folder' : ''}` +
      `${connectorId === 'supabase' ? ', select_rows, insert_rows, update_rows' : ''}` +
      `${connectorId === 'google-slides' ? ', get_presentation, create_presentation, batch_update' : ''}` +
      `${connectorId === 'google-tasks' ? ', list_tasklists, list_tasks, create_task' : ''}` +
      `${connectorId === 'google-sheets' ? ', get_values, update_values, append_values' : ''}` +
      `${connectorId === 'google-docs' ? ', get_document, create_document, batch_update' : ''}` +
      `${connectorId === 'google-photos' ? ', list_media_items, search_media_items, create_album' : ''}` +
      `${connectorId === 'google-maps' ? ', geocode, reverse_geocode, place_text_search' : ''}` +
      `${connectorId === 'youtube' ? ', search_videos, list_videos, list_channels' : ''}` +
      `${connectorId === 'figma' ? ', get_file, get_file_nodes, list_team_projects' : ''}` +
      `${connectorId === 'email-triggers' ? ', get_config, send_test_event' : ''}` +
      `${connectorId === 'google-calendar' ? ', list_events, create_event, delete_event' : ''}` +
      `${connectorId === 'google-drive' ? ', list_files, get_file, create_folder, delete_file' : ''}` +
      `${connectorId === 'gmail' ? ', list_messages, get_message, send_message' : ''}` +
      `${connectorId === 'microsoft-outlook' ? ', list_messages, send_message, list_events, create_event' : ''}` +
      `${connectorId === 'dropbox' ? ', list_folder, create_folder, delete_path, upload_text' : ''}` +
      `${connectorId === 'miro' ? ', list_boards, create_board' : ''}` +
      `${connectorId === 'canva'
        ? ', list_designs, get_design, get_design_pages, get_export_formats, create_design, create_export_job, get_export_job, poll_export_job'
        : ''}`
    );
  }

  const method = normalizeUpperMethod(String(args.method ?? 'GET'));
  const requestPath = normalizeText(args.path, 1024);
  if (!requestPath) {
    throw new Error('args.path is required for action=request.');
  }
  const result = await connectorRequest(config, secretValue.token, {
    method,
    path: requestPath,
    query: (args.query && typeof args.query === 'object' && !Array.isArray(args.query))
      ? (args.query as Record<string, unknown>)
      : undefined,
    body: args.body,
    headers: (args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers))
      ? (args.headers as Record<string, unknown>)
      : undefined,
  });
  return {
    connectorId,
    connectorInstanceId: config.instanceId,
    runtimeKey,
    action,
    detail: `${method} ${requestPath} completed (${result.status}).`,
    data: {
      status: result.status,
      headers: result.headers,
      url: result.url,
      body: result.data,
    },
  };
}
