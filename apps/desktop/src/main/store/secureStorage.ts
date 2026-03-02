import Store from 'electron-store';
import { app } from 'electron';
import * as crypto from 'crypto';
import * as os from 'os';

const KEYCHAIN_SERVICE = 'ai.accomplish.desktop';

/**
 * Secure storage using OS keychain when available (keytar),
 * falling back to electron-store with custom AES-256-GCM encryption.
 *
 * This implementation derives an encryption key from machine-specific values
 * (hostname, platform, user home directory, app path) to avoid macOS Keychain
 * prompts while still providing reasonable security for API keys.
 *
 * Security considerations:
 * - Keys are encrypted at rest using AES-256-GCM
 * - Encryption key is derived from machine-specific data (not stored)
 * - Less secure than Keychain (key derivation could be reverse-engineered)
 * - Suitable for API keys that can be rotated if compromised
 */

// Use different store names for dev vs production to avoid conflicts
const getStoreName = () => (app.isPackaged ? 'secure-storage' : 'secure-storage-dev');

interface SecureStorageSchema {
  /** Encrypted values stored as base64 strings (format: iv:authTag:ciphertext) */
  values: Record<string, string>;
  /** Salt for key derivation (generated once per installation) */
  salt?: string;
}

// Lazy initialization to ensure app is ready
let _secureStore: Store<SecureStorageSchema> | null = null;
let _derivedKey: Buffer | null = null;
let _keytarModule: typeof import('keytar') | null | undefined = undefined;

async function getKeytar(): Promise<typeof import('keytar') | null> {
  if (_keytarModule !== undefined) {
    return _keytarModule;
  }

  // Unit/integration tests should never touch the real OS keychain.
  // Force the encrypted file-store fallback for determinism.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    _keytarModule = null;
    return null;
  }

  try {
    const module = await import('keytar');
    const resolved = (module as unknown as { default?: typeof import('keytar') }).default || module;
    _keytarModule = resolved;
    return resolved;
  } catch {
    _keytarModule = null;
    return null;
  }
}

function getSecureStore(): Store<SecureStorageSchema> {
  if (!_secureStore) {
    _secureStore = new Store<SecureStorageSchema>({
      name: getStoreName(),
      defaults: { values: {} },
    });
  }
  return _secureStore;
}

/**
 * Get or create a salt for key derivation.
 * The salt is stored in the config file and generated once per installation.
 */
function getSalt(): Buffer {
  const store = getSecureStore();
  let saltBase64 = store.get('salt');

  if (!saltBase64) {
    // Generate a new random salt
    const salt = crypto.randomBytes(32);
    saltBase64 = salt.toString('base64');
    store.set('salt', saltBase64);
  }

  return Buffer.from(saltBase64, 'base64');
}

/**
 * Derive an encryption key from machine-specific data.
 * This is deterministic for the same machine/installation.
 *
 * Note: We avoid hostname as it can be changed by users (renaming laptop).
 */
function getDerivedKey(): Buffer {
  if (_derivedKey) {
    return _derivedKey;
  }

  // Combine machine-specific values to create a unique identifier
  const machineData = [
    os.platform(),
    os.homedir(),
    os.userInfo().username,
    app.getPath('userData'),
    'ai.accomplish.desktop', // App identifier
  ].join(':');

  const salt = getSalt();

  // Use PBKDF2 to derive a 256-bit key
  _derivedKey = crypto.pbkdf2Sync(
    machineData,
    salt,
    100000, // iterations
    32, // key length (256 bits)
    'sha256'
  );

  return _derivedKey;
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns format: iv:authTag:ciphertext (all base64)
 */
function encryptValue(value: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12); // GCM recommended IV size

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(value, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a value encrypted with encryptValue.
 */
function decryptValue(encryptedData: string): string | null {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      // Invalid format
      return null;
    }

    const [ivBase64, authTagBase64, ciphertext] = parts;
    const key = getDerivedKey();
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch {
    // Decryption failed (wrong key, corrupted data, etc.)
    // Don't log error details to avoid leaking sensitive context
    return null;
  }
}

/**
 * Store an API key securely
 */
export async function storeApiKey(provider: string, apiKey: string): Promise<void> {
  if (apiKey === '') {
    await deleteApiKey(provider);
    return;
  }
  const keytar = await getKeytar();
  const account = `apiKey:${provider}`;
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, account, apiKey);
    // Remove any legacy stored value to avoid duplication
    const store = getSecureStore();
    const values = store.get('values');
    if (values[account]) {
      delete values[account];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(apiKey);
  const values = store.get('values');
  values[account] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve an API key
 */
export async function getApiKey(provider: string): Promise<string | null> {
  const keytar = await getKeytar();
  const account = `apiKey:${provider}`;
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, account);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[account];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, account, decrypted);
      delete values[account];
      store.set('values', values);
    } catch {
      // Ignore migration failures and keep fallback data
    }
  }
  return decrypted;
}

/**
 * Delete an API key
 */
export async function deleteApiKey(provider: string): Promise<boolean> {
  const keytar = await getKeytar();
  const account = `apiKey:${provider}`;
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, account);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (account in values) {
    delete values[account];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

const DISCORD_TOKEN_ACCOUNT = 'discord:botToken';
const TELEGRAM_TOKEN_ACCOUNT = 'telegram:botToken';
const VOICEWAKE_ACCESS_KEY_ACCOUNT = 'voicewake:accessKey';
const GATEWAY_TOKEN_ACCOUNT = 'gateway:token';
const GATEWAY_PASSWORD_ACCOUNT = 'gateway:password';
const GATEWAY_CONNECTOR_SECRET_ACCOUNT_PREFIX = 'gateway-connector';
const APP_CONNECTOR_SECRET_ACCOUNT_PREFIX = 'app-connector';
const APP_CONNECTOR_OAUTH_CLIENT_SECRET_ACCOUNT_PREFIX = 'app-connector-oauth-client';

/**
 * Store Discord bot token securely.
 */
export async function storeDiscordToken(token: string): Promise<void> {
  if (token === '') {
    await deleteDiscordToken();
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, DISCORD_TOKEN_ACCOUNT, token);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[DISCORD_TOKEN_ACCOUNT]) {
      delete values[DISCORD_TOKEN_ACCOUNT];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(token);
  const values = store.get('values');
  values[DISCORD_TOKEN_ACCOUNT] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve Discord bot token.
 */
export async function getDiscordToken(): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, DISCORD_TOKEN_ACCOUNT);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[DISCORD_TOKEN_ACCOUNT];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, DISCORD_TOKEN_ACCOUNT, decrypted);
      delete values[DISCORD_TOKEN_ACCOUNT];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete Discord bot token.
 */
export async function deleteDiscordToken(): Promise<boolean> {
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, DISCORD_TOKEN_ACCOUNT);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (DISCORD_TOKEN_ACCOUNT in values) {
    delete values[DISCORD_TOKEN_ACCOUNT];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Store Telegram bot token securely.
 */
export async function storeTelegramToken(token: string): Promise<void> {
  if (token === '') {
    await deleteTelegramToken();
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, TELEGRAM_TOKEN_ACCOUNT, token);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[TELEGRAM_TOKEN_ACCOUNT]) {
      delete values[TELEGRAM_TOKEN_ACCOUNT];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(token);
  const values = store.get('values');
  values[TELEGRAM_TOKEN_ACCOUNT] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve Telegram bot token.
 */
export async function getTelegramToken(): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, TELEGRAM_TOKEN_ACCOUNT);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[TELEGRAM_TOKEN_ACCOUNT];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, TELEGRAM_TOKEN_ACCOUNT, decrypted);
      delete values[TELEGRAM_TOKEN_ACCOUNT];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete Telegram bot token.
 */
export async function deleteTelegramToken(): Promise<boolean> {
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, TELEGRAM_TOKEN_ACCOUNT);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (TELEGRAM_TOKEN_ACCOUNT in values) {
    delete values[TELEGRAM_TOKEN_ACCOUNT];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Store voice wake access key securely.
 */
export async function storeVoiceWakeAccessKey(accessKey: string): Promise<void> {
  if (accessKey === '') {
    await deleteVoiceWakeAccessKey();
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, VOICEWAKE_ACCESS_KEY_ACCOUNT, accessKey);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[VOICEWAKE_ACCESS_KEY_ACCOUNT]) {
      delete values[VOICEWAKE_ACCESS_KEY_ACCOUNT];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(accessKey);
  const values = store.get('values');
  values[VOICEWAKE_ACCESS_KEY_ACCOUNT] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve voice wake access key.
 */
export async function getVoiceWakeAccessKey(): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, VOICEWAKE_ACCESS_KEY_ACCOUNT);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[VOICEWAKE_ACCESS_KEY_ACCOUNT];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, VOICEWAKE_ACCESS_KEY_ACCOUNT, decrypted);
      delete values[VOICEWAKE_ACCESS_KEY_ACCOUNT];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete voice wake access key.
 */
export async function deleteVoiceWakeAccessKey(): Promise<boolean> {
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, VOICEWAKE_ACCESS_KEY_ACCOUNT);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (VOICEWAKE_ACCESS_KEY_ACCOUNT in values) {
    delete values[VOICEWAKE_ACCESS_KEY_ACCOUNT];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Store gateway access token securely.
 */
export async function storeGatewayToken(token: string): Promise<void> {
  if (token === '') {
    await deleteGatewayToken();
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT, token);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[GATEWAY_TOKEN_ACCOUNT]) {
      delete values[GATEWAY_TOKEN_ACCOUNT];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(token);
  const values = store.get('values');
  values[GATEWAY_TOKEN_ACCOUNT] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve gateway access token.
 */
export async function getGatewayToken(): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[GATEWAY_TOKEN_ACCOUNT];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT, decrypted);
      delete values[GATEWAY_TOKEN_ACCOUNT];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete gateway access token.
 */
export async function deleteGatewayToken(): Promise<boolean> {
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (GATEWAY_TOKEN_ACCOUNT in values) {
    delete values[GATEWAY_TOKEN_ACCOUNT];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Store gateway password securely.
 */
export async function storeGatewayPassword(password: string): Promise<void> {
  if (password === '') {
    await deleteGatewayPassword();
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, GATEWAY_PASSWORD_ACCOUNT, password);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[GATEWAY_PASSWORD_ACCOUNT]) {
      delete values[GATEWAY_PASSWORD_ACCOUNT];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(password);
  const values = store.get('values');
  values[GATEWAY_PASSWORD_ACCOUNT] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve gateway password.
 */
export async function getGatewayPassword(): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, GATEWAY_PASSWORD_ACCOUNT);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[GATEWAY_PASSWORD_ACCOUNT];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, GATEWAY_PASSWORD_ACCOUNT, decrypted);
      delete values[GATEWAY_PASSWORD_ACCOUNT];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete gateway password.
 */
export async function deleteGatewayPassword(): Promise<boolean> {
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, GATEWAY_PASSWORD_ACCOUNT);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (GATEWAY_PASSWORD_ACCOUNT in values) {
    delete values[GATEWAY_PASSWORD_ACCOUNT];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

function getGatewayConnectorSecretAccount(connectorId: string): string {
  return `${GATEWAY_CONNECTOR_SECRET_ACCOUNT_PREFIX}:${connectorId}:secret`;
}

/**
 * Store gateway connector shared secret securely.
 */
export async function storeGatewayConnectorSecret(connectorId: string, secret: string): Promise<void> {
  const account = getGatewayConnectorSecretAccount(connectorId);
  if (secret === '') {
    await deleteGatewayConnectorSecret(connectorId);
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, account, secret);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[account]) {
      delete values[account];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(secret);
  const values = store.get('values');
  values[account] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve gateway connector shared secret.
 */
export async function getGatewayConnectorSecret(connectorId: string): Promise<string | null> {
  const account = getGatewayConnectorSecretAccount(connectorId);
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, account);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[account];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, account, decrypted);
      delete values[account];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete gateway connector shared secret.
 */
export async function deleteGatewayConnectorSecret(connectorId: string): Promise<boolean> {
  const account = getGatewayConnectorSecretAccount(connectorId);
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, account);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (account in values) {
    delete values[account];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Check whether a gateway connector secret exists.
 */
export async function hasGatewayConnectorSecret(connectorId: string): Promise<boolean> {
  const value = await getGatewayConnectorSecret(connectorId);
  return Boolean(value && value.trim().length > 0);
}

function getAppConnectorSecretAccount(connectorId: string): string {
  return `${APP_CONNECTOR_SECRET_ACCOUNT_PREFIX}:${connectorId}:secret`;
}

/**
 * Store app connector secret securely.
 */
export async function storeAppConnectorSecret(connectorId: string, secret: string): Promise<void> {
  const account = getAppConnectorSecretAccount(connectorId);
  if (secret === '') {
    await deleteAppConnectorSecret(connectorId);
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, account, secret);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[account]) {
      delete values[account];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(secret);
  const values = store.get('values');
  values[account] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve app connector secret.
 */
export async function getAppConnectorSecret(connectorId: string): Promise<string | null> {
  const account = getAppConnectorSecretAccount(connectorId);
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, account);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[account];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, account, decrypted);
      delete values[account];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete app connector secret.
 */
export async function deleteAppConnectorSecret(connectorId: string): Promise<boolean> {
  const account = getAppConnectorSecretAccount(connectorId);
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, account);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (account in values) {
    delete values[account];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Check whether an app connector secret exists.
 */
export async function hasAppConnectorSecret(connectorId: string): Promise<boolean> {
  const value = await getAppConnectorSecret(connectorId);
  return Boolean(value && value.trim().length > 0);
}

function getAppConnectorOAuthClientSecretAccount(connectorId: string): string {
  return `${APP_CONNECTOR_OAUTH_CLIENT_SECRET_ACCOUNT_PREFIX}:${connectorId}:client-secret`;
}

/**
 * Store app connector OAuth client secret securely.
 */
export async function storeAppConnectorOAuthClientSecret(connectorId: string, clientSecret: string): Promise<void> {
  const account = getAppConnectorOAuthClientSecretAccount(connectorId);
  if (clientSecret === '') {
    await deleteAppConnectorOAuthClientSecret(connectorId);
    return;
  }
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, account, clientSecret);
    const store = getSecureStore();
    const values = store.get('values');
    if (values[account]) {
      delete values[account];
      store.set('values', values);
    }
    return;
  }

  const store = getSecureStore();
  const encrypted = encryptValue(clientSecret);
  const values = store.get('values');
  values[account] = encrypted;
  store.set('values', values);
}

/**
 * Retrieve app connector OAuth client secret.
 */
export async function getAppConnectorOAuthClientSecret(connectorId: string): Promise<string | null> {
  const account = getAppConnectorOAuthClientSecretAccount(connectorId);
  const keytar = await getKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, account);
    if (stored) {
      return stored;
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const encrypted = values[account];
  if (!encrypted) {
    return null;
  }
  const decrypted = decryptValue(encrypted);
  if (decrypted && keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, account, decrypted);
      delete values[account];
      store.set('values', values);
    } catch {
      // Ignore migration failures
    }
  }
  return decrypted;
}

/**
 * Delete app connector OAuth client secret.
 */
export async function deleteAppConnectorOAuthClientSecret(connectorId: string): Promise<boolean> {
  const account = getAppConnectorOAuthClientSecretAccount(connectorId);
  const keytar = await getKeytar();
  let removed = false;

  if (keytar) {
    removed = await keytar.deletePassword(KEYCHAIN_SERVICE, account);
  }

  const store = getSecureStore();
  const values = store.get('values');
  if (account in values) {
    delete values[account];
    store.set('values', values);
    removed = true;
  }

  return removed;
}

/**
 * Check whether an app connector OAuth client secret exists.
 */
export async function hasAppConnectorOAuthClientSecret(connectorId: string): Promise<boolean> {
  const value = await getAppConnectorOAuthClientSecret(connectorId);
  return Boolean(value && value.trim().length > 0);
}

/**
 * Supported API key providers
 */
export type ApiKeyProvider = 'anthropic' | 'openai' | 'google' | 'xai' | 'custom';

/**
 * Get all API keys for all providers
 */
export async function getAllApiKeys(): Promise<Record<ApiKeyProvider, string | null>> {
  const [anthropic, openai, google, xai, custom] = await Promise.all([
    getApiKey('anthropic'),
    getApiKey('openai'),
    getApiKey('google'),
    getApiKey('xai'),
    getApiKey('custom'),
  ]);

  return { anthropic, openai, google, xai, custom };
}

/**
 * Check if any API key is stored
 */
export async function hasAnyApiKey(): Promise<boolean> {
  const credentials = await listStoredCredentials();
  return credentials.some((credential) => {
    if (!credential.account.startsWith('apiKey:')) return false;
    const key = credential.password || '';
    return key.trim().length > 0;
  });
}

/**
 * List all stored credentials for this service
 * Returns key names with their (decrypted) values
 */
export async function listStoredCredentials(): Promise<Array<{ account: string; password: string }>> {
  const keytar = await getKeytar();
  if (keytar) {
    const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
    if (creds.length > 0) {
      return creds.map((cred) => ({
        account: cred.account,
        password: cred.password,
      }));
    }
  }

  const store = getSecureStore();
  const values = store.get('values');
  const credentials: Array<{ account: string; password: string }> = [];

  for (const key of Object.keys(values)) {
    const decrypted = decryptValue(values[key]);
    if (decrypted) {
      credentials.push({
        account: key,
        password: decrypted,
      });
    }
  }

  return credentials;
}

/**
 * Clear all secure storage (used during fresh install cleanup)
 */
export async function clearSecureStorage(): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
    await Promise.all(
      creds.map((cred) => keytar.deletePassword(KEYCHAIN_SERVICE, cred.account))
    );
  }

  const store = getSecureStore();
  store.clear();
  _derivedKey = null; // Clear cached key
}
