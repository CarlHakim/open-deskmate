export interface VoiceWakeConfig {
  enabled: boolean;
  autoStart?: boolean;
  triggers: string[];
  updatedAtMs: number;
  talkModeEnabled?: boolean;
  autoSubmit?: boolean;
  insertMode?: 'append' | 'replace';
  stopPhrases?: string[];
  silenceTimeoutMs?: number;
  earconEnabled?: boolean;
  sttEngine?: 'web-speech' | 'whisper';
  whisperBinPath?: string;
  whisperModelPath?: string;
  whisperLanguage?: string;
}
