import Store from 'electron-store';
import type { SelectedModel, OllamaConfig } from '@accomplish/shared';

/**
 * App settings schema
 */
interface AppSettingsSchema {
  /** Enable debug mode to show backend logs in UI */
  debugMode: boolean;
  /** Whether the user has completed the onboarding wizard */
  onboardingComplete: boolean;
  /** Whether the app stays running in the tray after closing the window */
  runInBackground: boolean;
  /** Whether the app launches automatically on system login */
  launchAtLogin: boolean;
  /** Active browser profile name for dev-browser */
  browserProfile: string;
  /** Default workspace root for tasks */
  workspaceRoot: string | null;
  /** Active agent identifier */
  activeAgentId: string;
  /** Selected AI model (provider/model format) */
  selectedModel: SelectedModel | null;
  /** Ollama server configuration */
  ollamaConfig: OllamaConfig | null;
  /** Enable mobile node companions */
  mobileNodesEnabled: boolean;
  /** Max simultaneous live previews for mobile nodes */
  mobileNodesMaxLivePreviews: number;
  /** Optional display name for mobile node companions */
  mobileNodesDisplayName: string;
  /** Webhook bind mode (localhost only or all interfaces) */
  webhookBindMode: 'localhost' | 'all';
  /** Runtime speed mode for model routing */
  agentSpeedMode: 'fast' | 'balanced' | 'deep';
  /** Optional model override for Skill Assistant (falls back to global selectedModel) */
  userSkillAssistantModel: SelectedModel | null;
}

const appSettingsStore = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: {
    debugMode: false,
    onboardingComplete: false,
    runInBackground: false,
    launchAtLogin: false,
    browserProfile: 'default',
    workspaceRoot: null,
    activeAgentId: 'main',
    selectedModel: {
      provider: 'anthropic',
      model: 'anthropic/claude-opus-4-5',
    },
    ollamaConfig: null,
    mobileNodesEnabled: true,
    mobileNodesMaxLivePreviews: 3,
    mobileNodesDisplayName: '',
    webhookBindMode: 'localhost',
    agentSpeedMode: 'fast',
    userSkillAssistantModel: null,
  },
});

/**
 * Get debug mode setting
 */
export function getDebugMode(): boolean {
  return appSettingsStore.get('debugMode');
}

/**
 * Set debug mode setting
 */
export function setDebugMode(enabled: boolean): void {
  appSettingsStore.set('debugMode', enabled);
}

/**
 * Get onboarding complete setting
 */
export function getOnboardingComplete(): boolean {
  return appSettingsStore.get('onboardingComplete');
}

/**
 * Set onboarding complete setting
 */
export function setOnboardingComplete(complete: boolean): void {
  appSettingsStore.set('onboardingComplete', complete);
}

/**
 * Get run-in-background setting
 */
export function getRunInBackground(): boolean {
  return appSettingsStore.get('runInBackground');
}

/**
 * Set run-in-background setting
 */
export function setRunInBackground(enabled: boolean): void {
  appSettingsStore.set('runInBackground', enabled);
}

/**
 * Get launch-at-login setting
 */
export function getLaunchAtLogin(): boolean {
  return appSettingsStore.get('launchAtLogin');
}

/**
 * Set launch-at-login setting
 */
export function setLaunchAtLogin(enabled: boolean): void {
  appSettingsStore.set('launchAtLogin', enabled);
}

/**
 * Get browser profile name
 */
export function getBrowserProfile(): string {
  return appSettingsStore.get('browserProfile');
}

/**
 * Set browser profile name
 */
export function setBrowserProfile(profile: string): void {
  appSettingsStore.set('browserProfile', profile);
}

/**
 * Get default workspace root
 */
export function getWorkspaceRoot(): string | null {
  return appSettingsStore.get('workspaceRoot') ?? null;
}

/**
 * Set default workspace root
 */
export function setWorkspaceRoot(root: string | null): void {
  appSettingsStore.set('workspaceRoot', root);
}

/**
 * Get active agent id
 */
export function getActiveAgentId(): string {
  return appSettingsStore.get('activeAgentId') || 'main';
}

/**
 * Set active agent id
 */
export function setActiveAgentId(agentId: string): void {
  appSettingsStore.set('activeAgentId', agentId);
}

/**
 * Get selected model
 */
export function getSelectedModel(): SelectedModel | null {
  const value = appSettingsStore.get('selectedModel');
  // electron-store should apply defaults, but some flows (e.g. clear) can leave undefined.
  // Keep behavior stable: always return a valid default unless explicitly set to null.
  if (value && typeof value === 'object') return value;
  return {
    provider: 'anthropic',
    model: 'anthropic/claude-opus-4-5',
  };
}

/**
 * Set selected model
 */
export function setSelectedModel(model: SelectedModel): void {
  appSettingsStore.set('selectedModel', model);
}

/**
 * Get Ollama configuration
 */
export function getOllamaConfig(): OllamaConfig | null {
  return appSettingsStore.get('ollamaConfig') ?? null;
}

/**
 * Set Ollama configuration
 */
export function setOllamaConfig(config: OllamaConfig | null): void {
  appSettingsStore.set('ollamaConfig', config);
}

/**
 * Get mobile nodes enabled setting
 */
export function getMobileNodesEnabled(): boolean {
  return appSettingsStore.get('mobileNodesEnabled');
}

/**
 * Set mobile nodes enabled setting
 */
export function setMobileNodesEnabled(enabled: boolean): void {
  appSettingsStore.set('mobileNodesEnabled', enabled);
}

/**
 * Get max simultaneous live previews for mobile nodes
 */
export function getMobileNodesMaxLivePreviews(): number {
  const value = appSettingsStore.get('mobileNodesMaxLivePreviews');
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 3;
}

/**
 * Set max simultaneous live previews for mobile nodes
 */
export function setMobileNodesMaxLivePreviews(count: number): number {
  const normalized = Math.max(1, Math.min(10, Math.floor(count)));
  appSettingsStore.set('mobileNodesMaxLivePreviews', normalized);
  return normalized;
}

/**
 * Get mobile nodes display name
 */
export function getMobileNodesDisplayName(): string {
  return appSettingsStore.get('mobileNodesDisplayName') || '';
}

/**
 * Set mobile nodes display name
 */
export function setMobileNodesDisplayName(name: string): string {
  const trimmed = name.trim().slice(0, 64);
  appSettingsStore.set('mobileNodesDisplayName', trimmed);
  return trimmed;
}

/**
 * Get webhook bind mode
 */
export function getWebhookBindMode(): 'localhost' | 'all' {
  const value = appSettingsStore.get('webhookBindMode');
  return value === 'all' ? 'all' : 'localhost';
}

/**
 * Set webhook bind mode
 */
export function setWebhookBindMode(mode: 'localhost' | 'all'): 'localhost' | 'all' {
  const normalized = mode === 'all' ? 'all' : 'localhost';
  appSettingsStore.set('webhookBindMode', normalized);
  return normalized;
}

/**
 * Get runtime speed mode
 */
export function getAgentSpeedMode(): 'fast' | 'balanced' | 'deep' {
  const value = appSettingsStore.get('agentSpeedMode');
  if (value === 'fast' || value === 'balanced' || value === 'deep') return value;
  return 'fast';
}

/**
 * Set runtime speed mode
 */
export function setAgentSpeedMode(mode: 'fast' | 'balanced' | 'deep'): 'fast' | 'balanced' | 'deep' {
  const normalized = mode === 'deep' ? 'deep' : mode === 'balanced' ? 'balanced' : 'fast';
  appSettingsStore.set('agentSpeedMode', normalized);
  return normalized;
}

export function getUserSkillAssistantModel(): SelectedModel | null {
  const value = appSettingsStore.get('userSkillAssistantModel');
  if (!value || typeof value !== 'object') return null;
  return value as SelectedModel;
}

export function setUserSkillAssistantModel(model: SelectedModel | null): SelectedModel | null {
  if (!model) {
    appSettingsStore.set('userSkillAssistantModel', null);
    return null;
  }
  appSettingsStore.set('userSkillAssistantModel', model);
  return model;
}

/**
 * Get all app settings
 */
export function getAppSettings(): AppSettingsSchema {
  return {
    debugMode: getDebugMode(),
    onboardingComplete: getOnboardingComplete(),
    runInBackground: getRunInBackground(),
    launchAtLogin: getLaunchAtLogin(),
    browserProfile: getBrowserProfile(),
    workspaceRoot: getWorkspaceRoot(),
    activeAgentId: getActiveAgentId(),
    selectedModel: getSelectedModel(),
    ollamaConfig: getOllamaConfig(),
    mobileNodesEnabled: getMobileNodesEnabled(),
    mobileNodesMaxLivePreviews: getMobileNodesMaxLivePreviews(),
    mobileNodesDisplayName: getMobileNodesDisplayName(),
    webhookBindMode: getWebhookBindMode(),
    agentSpeedMode: getAgentSpeedMode(),
    userSkillAssistantModel: getUserSkillAssistantModel(),
  };
}

/**
 * Clear all app settings (reset to defaults)
 * Used during fresh install cleanup
 */
export function clearAppSettings(): void {
  appSettingsStore.clear();
}
