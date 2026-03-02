import Store from 'electron-store';
import type { VoiceWakeConfig } from '@accomplish/shared';

interface VoiceWakeSchema {
  config: VoiceWakeConfig;
}

const DEFAULT_TRIGGERS = ['clawd', 'claude', 'computer'];
const DEFAULT_STOP_PHRASES = ['stop listening', 'cancel', 'never mind', "that's all"];
const DEFAULT_SILENCE_TIMEOUT_MS = 900;
const DEFAULT_WHISPER_LANGUAGE = 'en';

const DEFAULT_CONFIG: VoiceWakeConfig = {
  enabled: false,
  autoStart: false,
  triggers: [...DEFAULT_TRIGGERS],
  updatedAtMs: 0,
  talkModeEnabled: true,
  autoSubmit: false,
  insertMode: 'append',
  stopPhrases: [...DEFAULT_STOP_PHRASES],
  silenceTimeoutMs: DEFAULT_SILENCE_TIMEOUT_MS,
  earconEnabled: true,
  sttEngine: 'whisper',
  whisperBinPath: '',
  whisperModelPath: '',
  whisperLanguage: DEFAULT_WHISPER_LANGUAGE,
};

const voiceWakeStore = new Store<VoiceWakeSchema>({
  name: 'voicewake-config',
  defaults: {
    config: DEFAULT_CONFIG,
  },
});

function sanitizeTriggers(triggers: string[] | undefined | null): string[] {
  const cleaned = (triggers ?? [])
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_TRIGGERS];
}

function sanitizeStopPhrases(phrases: string[] | undefined | null): string[] {
  const cleaned = (phrases ?? [])
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_STOP_PHRASES];
}

function normalizeConfig(config: VoiceWakeConfig | undefined): VoiceWakeConfig {
  const enabled = Boolean(config?.enabled);
  const autoStart = Boolean(config?.autoStart);
  const triggers = sanitizeTriggers(config?.triggers);
  const updatedAtMs = typeof config?.updatedAtMs === 'number' ? config.updatedAtMs : 0;
  const talkModeEnabled = config?.talkModeEnabled !== false;
  const autoSubmit = Boolean(config?.autoSubmit);
  const insertMode = config?.insertMode === 'replace' ? 'replace' : 'append';
  const stopPhrases = sanitizeStopPhrases(config?.stopPhrases);
  const silenceTimeoutMs =
    typeof config?.silenceTimeoutMs === 'number' && Number.isFinite(config.silenceTimeoutMs)
      ? Math.min(Math.max(config.silenceTimeoutMs, 400), 5000)
      : DEFAULT_SILENCE_TIMEOUT_MS;
  const earconEnabled = config?.earconEnabled !== false;
  const sttEngine = config?.sttEngine === 'web-speech' ? 'web-speech' : 'whisper';
  const whisperBinPath = typeof config?.whisperBinPath === 'string' ? config.whisperBinPath.trim() : '';
  const whisperModelPath = typeof config?.whisperModelPath === 'string' ? config.whisperModelPath.trim() : '';
  const whisperLanguage =
    typeof config?.whisperLanguage === 'string' && config.whisperLanguage.trim()
      ? config.whisperLanguage.trim()
      : DEFAULT_WHISPER_LANGUAGE;

  return {
    enabled,
    autoStart,
    triggers,
    updatedAtMs,
    talkModeEnabled,
    autoSubmit,
    insertMode,
    stopPhrases,
    silenceTimeoutMs,
    earconEnabled,
    sttEngine,
    whisperBinPath,
    whisperModelPath,
    whisperLanguage,
  };
}

export function getDefaultVoiceWakeTriggers(): string[] {
  return [...DEFAULT_TRIGGERS];
}

export function getVoiceWakeConfig(): VoiceWakeConfig {
  const stored = voiceWakeStore.get('config');
  const normalized = normalizeConfig(stored);
  voiceWakeStore.set('config', normalized);
  return normalized;
}

export function setVoiceWakeConfig(config: VoiceWakeConfig): VoiceWakeConfig {
  const current = getVoiceWakeConfig();
  const next = normalizeConfig({
    ...current,
    ...config,
    updatedAtMs: Date.now(),
  });
  voiceWakeStore.set('config', next);
  return next;
}

export function applyVoiceWakeAutoStart(): VoiceWakeConfig {
  const config = getVoiceWakeConfig();
  const nextEnabled = Boolean(config.autoStart);
  if (config.enabled === nextEnabled) {
    return config;
  }
  return setVoiceWakeConfig({ ...config, enabled: nextEnabled });
}

export function setVoiceWakeEnabled(enabled: boolean): VoiceWakeConfig {
  return setVoiceWakeConfig({ ...getVoiceWakeConfig(), enabled });
}

export function setVoiceWakeTriggers(triggers: string[]): VoiceWakeConfig {
  return setVoiceWakeConfig({ ...getVoiceWakeConfig(), triggers });
}
