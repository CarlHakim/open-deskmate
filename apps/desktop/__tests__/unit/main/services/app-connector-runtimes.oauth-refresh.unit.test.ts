import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const state = vi.hoisted(() => ({
  runtimeKey: 'google-drive',
  config: {
    id: 'google-drive',
    instanceId: 'default',
    enabled: true,
    autoBindTools: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  secretValue: null as string | null,
}));

vi.mock('@main/store/appConnectorExtensions', () => ({
  listAppConnectorExtensionConfigs: vi.fn(() => [state.config]),
  resolveAppConnectorExtensionConfig: vi.fn(() => state.config),
  getAppConnectorRuntimeKey: vi.fn(() => state.runtimeKey),
  listAppConnectorExtensionDefinitions: vi.fn(() => [
    {
      id: 'google-drive',
      name: 'Google Drive',
      description: 'Google Drive API',
      authMethod: 'oauth2',
      docsUrl: 'https://developers.google.com/drive/api/guides/api-specific-auth',
      defaultBaseUrl: 'https://www.googleapis.com/drive/v3',
    },
  ]),
}));

vi.mock('@main/store/secureStorage', () => ({
  getAppConnectorSecret: vi.fn(async () => state.secretValue),
  storeAppConnectorSecret: vi.fn(async (_runtimeKey: string, value: string) => {
    state.secretValue = value;
  }),
}));

import { testAppConnectorRuntime } from '@main/services/app-connector-runtimes';
import { storeAppConnectorSecret } from '@main/store/secureStorage';

function makeJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'ERROR',
    headers: {
      get: (_key: string) => 'application/json',
      forEach: () => undefined,
    } as unknown as Headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function setOAuthSecret(overrides: Record<string, unknown> = {}): void {
  const payload = {
    kind: 'oauth2',
    provider: 'google',
    accessToken: 'old_access_token',
    refreshToken: 'refresh_token_value',
    tokenType: 'Bearer',
    scope: 'https://www.googleapis.com/auth/drive',
    expiresAt: '2025-01-01T00:00:00.000Z',
    obtainedAt: '2025-01-01T00:00:00.000Z',
    clientId: 'client_123',
    clientSecret: 'client_secret_123',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    ...overrides,
  };
  state.secretValue = JSON.stringify(payload);
}

describe('app-connector-runtimes OAuth refresh behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    state.secretValue = null;
  });

  it('fails when access token is expired and refresh token is missing', async () => {
    setOAuthSecret({
      refreshToken: undefined,
      expiresAt: '2025-01-01T00:00:00.000Z',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await testAppConnectorRuntime('google-drive', 'default');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('expired');
    expect(result.detail).toContain('Reconnect OAuth');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when refresh token is revoked/invalid', async () => {
    setOAuthSecret({
      refreshToken: 'revoked_refresh_token',
      expiresAt: '2025-01-01T00:00:00.000Z',
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testAppConnectorRuntime('google-drive', 'default');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('OAuth refresh failed');
    expect(result.detail).toContain('invalid_grant');
    expect(storeAppConnectorSecret).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes token, persists it, and continues connector test', async () => {
    setOAuthSecret({
      accessToken: 'stale_token',
      refreshToken: 'refresh_token_ok',
      expiresAt: '2025-01-01T00:00:00.000Z',
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse(200, {
        access_token: 'fresh_access_token',
        refresh_token: 'fresh_refresh_token',
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/drive',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(makeJsonResponse(200, {
        email: 'tester@example.com',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testAppConnectorRuntime('google-drive', 'default');

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Connected to Google OAuth APIs');
    expect(storeAppConnectorSecret).toHaveBeenCalledTimes(1);
    const storeCalls = (storeAppConnectorSecret as Mock).mock.calls;
    expect(storeCalls[0][0]).toBe('google-drive');
    const storedPayload = JSON.parse(storeCalls[0][1] as string) as Record<string, unknown>;
    expect(storedPayload.accessToken).toBe('fresh_access_token');
    expect(storedPayload.refreshToken).toBe('fresh_refresh_token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = (secondCallInit.headers || {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fresh_access_token');
  });
});
