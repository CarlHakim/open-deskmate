import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccomplish } from '../lib/accomplish';
import type { VoiceWakeConfig } from '@accomplish/shared';

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
};

type SpeechRecognitionEventLike = {
  results: SpeechRecognitionResultLike[];
  resultIndex: number;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const DEFAULT_STOP_PHRASES = ['stop listening', 'cancel', 'never mind', "that's all"];
const DEFAULT_SILENCE_TIMEOUT_MS = 900;
const SPEECH_RMS_THRESHOLD = 0.004;
const MIN_SPEECH_RMS = 0.002;

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const typedWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return typedWindow.SpeechRecognition ?? typedWindow.webkitSpeechRecognition ?? null;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripStopPhrases = (text: string, phrases: string[]): string => {
  if (!text) return '';
  let cleaned = text;
  for (const phrase of phrases) {
    if (!phrase) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
};

const encodeWav = (chunks: Float32Array[], sampleRate: number): Uint8Array => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + totalLength * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalLength * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, totalLength * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
};

const arrayBufferToBase64 = (data: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const sub = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
};

const workletModuleUrl = new URL('../worklets/rms-capture-processor.js', import.meta.url);

interface UseVoiceWakeTalkModeOptions {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  focusRef?: React.RefObject<HTMLElement | null>;
  disabled?: boolean;
}

export function useVoiceWakeTalkMode(options: UseVoiceWakeTalkModeOptions) {
  const { value, onChange, onSubmit, focusRef, disabled } = options;
  const accomplish = getAccomplish();
  const isActionDisabled = Boolean(disabled);

  // Refs for frequently-changing values so callbacks stay stable across renders.
  // Without these, every keystroke recreates commitTranscript → finalizeTalkMode
  // → startTalkMode → wake-detect effect — a massive cascade for zero benefit.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceMeterActive, setVoiceMeterActive] = useState(false);
  const voiceMeterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceAccessKeySet, setVoiceAccessKeySet] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceWakeConfig>({
    enabled: false,
    autoStart: false,
    triggers: [],
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
    whisperLanguage: 'en',
  });
  const [voiceToggleBusy, setVoiceToggleBusy] = useState(false);
  const [talkModeActive, setTalkModeActive] = useState(false);
  const [talkModeError, setTalkModeError] = useState<string | null>(null);
  const [talkModeInterim, setTalkModeInterim] = useState('');
  const [talkModeLevel, setTalkModeLevel] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const talkActiveRef = useRef(false);
  const talkFinalRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whisperCaptureRef = useRef<{
    stream: MediaStream;
    audioContext: AudioContext;
    processor?: ScriptProcessorNode;
    workletNode?: AudioWorkletNode;
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    chunks: Float32Array[];
    lastSoundAt: number;
    sampleRate: number;
    maxRms: number;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    const refreshVoiceStatus = async () => {
      try {
        const [config, keyStatus, platform] = await Promise.all([
          accomplish.getVoiceWakeConfig(),
          accomplish.getVoiceWakeAccessKeyStatus(),
          accomplish.getPlatform(),
        ]);
        if (!mounted) return;
        const accessKeySet = Boolean(keyStatus?.accessKeySet);
        const configEnabled = Boolean(config?.enabled);
        setVoiceAccessKeySet(accessKeySet);
        setVoiceConfig({
          enabled: configEnabled,
          autoStart: Boolean(config?.autoStart),
          triggers: Array.isArray(config?.triggers) ? config.triggers : [],
          updatedAtMs: typeof config?.updatedAtMs === 'number' ? config.updatedAtMs : 0,
          talkModeEnabled: config?.talkModeEnabled !== false,
          autoSubmit: Boolean(config?.autoSubmit),
          insertMode: config?.insertMode === 'replace' ? 'replace' : 'append',
          stopPhrases: Array.isArray(config?.stopPhrases) ? config.stopPhrases : [...DEFAULT_STOP_PHRASES],
          silenceTimeoutMs:
            typeof config?.silenceTimeoutMs === 'number' && Number.isFinite(config.silenceTimeoutMs)
              ? config.silenceTimeoutMs
              : DEFAULT_SILENCE_TIMEOUT_MS,
          earconEnabled: config?.earconEnabled !== false,
          sttEngine: config?.sttEngine === 'web-speech' ? 'web-speech' : 'whisper',
          whisperBinPath: typeof config?.whisperBinPath === 'string' ? config.whisperBinPath : '',
          whisperModelPath: typeof config?.whisperModelPath === 'string' ? config.whisperModelPath : '',
          whisperLanguage: typeof config?.whisperLanguage === 'string' ? config.whisperLanguage : 'en',
        });
        const isEnabled = platform === 'win32' && accessKeySet && configEnabled;
        setVoiceEnabled(isEnabled);
      } catch {
        if (!mounted) return;
        setVoiceEnabled(false);
        setVoiceAccessKeySet(false);
        setVoiceConfig({
          enabled: false,
          autoStart: false,
          triggers: [],
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
          whisperLanguage: 'en',
        });
      }
    };

    void refreshVoiceStatus();
    const refreshTimer = setInterval(refreshVoiceStatus, 5000);
    const unsubscribe = accomplish.onVoiceWakeLevel?.((data) => {
      if (!mounted) return;
      setVoiceLevel(Math.max(0, Math.min(1, data.level)));
      // Mark meter as active; auto-deactivate after 1.2s of silence.
      // This replaces the old 250ms polling interval that caused 4 re-renders/sec.
      setVoiceMeterActive(true);
      if (voiceMeterTimerRef.current) clearTimeout(voiceMeterTimerRef.current);
      voiceMeterTimerRef.current = setTimeout(() => setVoiceMeterActive(false), 1200);
    });

    return () => {
      mounted = false;
      clearInterval(refreshTimer);
      unsubscribe?.();
      if (voiceMeterTimerRef.current) clearTimeout(voiceMeterTimerRef.current);
    };
  }, [accomplish]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopWhisperCapture = useCallback(async () => {
    const state = whisperCaptureRef.current;
    if (!state) return null;
    whisperCaptureRef.current = null;
    try {
      state.processor?.disconnect();
      state.workletNode?.disconnect();
      state.source.disconnect();
      state.gain.disconnect();
    } catch {
      // ignore disconnect errors
    }
    try {
      state.stream.getTracks().forEach((track) => track.stop());
    } catch {
      // ignore track errors
    }
    try {
      await state.audioContext.close();
    } catch {
      // ignore close errors
    }
    return state;
  }, []);

  const playEarcon = () => {
    try {
      const AudioContextCtor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 740;
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.2);
      oscillator.onended = () => {
        ctx.close().catch(() => undefined);
      };
    } catch {
      // ignore audio errors
    }
  };

  const commitTranscript = useCallback(
    (rawText: string) => {
      const stopPhrases = voiceConfig.stopPhrases?.length
        ? voiceConfig.stopPhrases
        : DEFAULT_STOP_PHRASES;
      const cleaned = stripStopPhrases(rawText, stopPhrases);
      if (!cleaned) return;
      const insertMode = voiceConfig.insertMode === 'replace' ? 'replace' : 'append';
      const nextValue =
        insertMode === 'replace'
          ? cleaned
          : [valueRef.current.trim(), cleaned].filter(Boolean).join(' ');
      onChangeRef.current(nextValue);
      focusRef?.current?.focus?.();
      if (voiceConfig.autoSubmit && !isActionDisabled && onSubmitRef.current) {
        const submit = onSubmitRef.current;
        setTimeout(() => submit(), 0);
      }
    },
    [focusRef, isActionDisabled, voiceConfig]
  );

  const finalizeTalkMode = useCallback(
    (finalText: string, reason: 'silence' | 'stop' | 'end' | 'error') => {
      if (!talkActiveRef.current) return;
      talkActiveRef.current = false;
      clearSilenceTimer();
      setTalkModeActive(false);
      setTalkModeInterim('');
      setTalkModeLevel(0);
      if (reason !== 'error') {
        setTalkModeError(null);
      }
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try {
        recognition?.stop();
      } catch {
        // ignore stop errors
      }
      const text = finalText.trim();
      if (text) {
        commitTranscript(text);
      }
      talkFinalRef.current = '';
    },
    [commitTranscript]
  );

  const startTalkMode = useCallback(
    (source: 'wake') => {
      if (talkActiveRef.current || isActionDisabled) return;
      if (voiceConfig.talkModeEnabled === false) return;
      const sttEngine = voiceConfig.sttEngine === 'web-speech' ? 'web-speech' : 'whisper';
      if (sttEngine === 'whisper') {
        const binPath = voiceConfig.whisperBinPath?.trim();
        const modelPath = voiceConfig.whisperModelPath?.trim();
        if (!binPath || !modelPath) {
          setTalkModeError('Configure Whisper binary and model paths in Settings.');
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setTalkModeError('Microphone access is not available in this build.');
          return;
        }
        const AudioContextCtor =
          (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
            .AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) {
          setTalkModeError('AudioContext is not available in this build.');
          return;
        }

        const silenceTimeoutMs =
          typeof voiceConfig.silenceTimeoutMs === 'number' && Number.isFinite(voiceConfig.silenceTimeoutMs)
            ? Math.min(Math.max(voiceConfig.silenceTimeoutMs, 400), 5000)
            : DEFAULT_SILENCE_TIMEOUT_MS;

        const capture = async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioContext = new AudioContextCtor({ sampleRate: 16000 });
            try {
              await audioContext.resume();
            } catch {
              // ignore resume errors
            }
            const sourceNode = audioContext.createMediaStreamSource(stream);
            const gain = audioContext.createGain();
            gain.gain.value = 0;
            const chunks: Float32Array[] = [];
            let lastSoundAt = Date.now();
            let maxRms = 0;
            let processor: ScriptProcessorNode | undefined;
            let workletNode: AudioWorkletNode | undefined;

            const updateRms = (rms: number) => {
              if (!Number.isFinite(rms)) return;
              if (rms > maxRms) {
                maxRms = rms;
              }
              setTalkModeLevel(Math.min(1, rms * 6));
              if (rms > SPEECH_RMS_THRESHOLD) {
                lastSoundAt = Date.now();
                if (whisperCaptureRef.current) {
                  whisperCaptureRef.current.lastSoundAt = lastSoundAt;
                  whisperCaptureRef.current.maxRms = maxRms;
                }
              }
            };

            const attachScriptProcessor = () => {
              processor = audioContext.createScriptProcessor(4096, 1, 1);
              processor.onaudioprocess = (event) => {
                const input = event.inputBuffer.getChannelData(0);
                chunks.push(new Float32Array(input));
                let sum = 0;
                for (let i = 0; i < input.length; i += 1) {
                  sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);
                updateRms(rms);
              };
              sourceNode.connect(processor);
              processor.connect(gain);
              gain.connect(audioContext.destination);
            };

            if (audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
              try {
                await audioContext.audioWorklet.addModule(workletModuleUrl);
                workletNode = new AudioWorkletNode(audioContext, 'rms-capture-processor', {
                  numberOfInputs: 1,
                  numberOfOutputs: 1,
                  outputChannelCount: [1],
                });
                workletNode.port.onmessage = (event) => {
                  const payload = event.data as {
                    rms?: number;
                    buffer?: ArrayBuffer;
                    length?: number;
                  };
                  if (payload?.buffer && typeof payload.length === 'number') {
                    const samples = new Float32Array(payload.buffer, 0, payload.length);
                    chunks.push(samples);
                  }
                  if (typeof payload?.rms === 'number') {
                    updateRms(payload.rms);
                  }
                };
                sourceNode.connect(workletNode);
                workletNode.connect(gain);
                gain.connect(audioContext.destination);
              } catch {
                attachScriptProcessor();
              }
            } else {
              attachScriptProcessor();
            }

            whisperCaptureRef.current = {
              stream,
              audioContext,
              processor,
              workletNode,
              source: sourceNode,
              gain,
              chunks,
              lastSoundAt,
              sampleRate: audioContext.sampleRate,
              maxRms,
            };

            talkActiveRef.current = true;
            setTalkModeActive(true);
            setTalkModeError(null);
            setTalkModeInterim('');
            setTalkModeLevel(0);

            if (voiceConfig.earconEnabled !== false && source === 'wake') {
              playEarcon();
            }

            clearSilenceTimer();
            silenceTimerRef.current = setInterval(() => {
              const state = whisperCaptureRef.current;
              if (!state) return;
              if (Date.now() - state.lastSoundAt >= silenceTimeoutMs) {
                clearSilenceTimer();
                void finalizeWhisper(state);
              }
            }, 200);
          } catch (err) {
            setTalkModeError(err instanceof Error ? err.message : 'Microphone capture failed.');
            await stopWhisperCapture();
            talkActiveRef.current = false;
            setTalkModeActive(false);
          }
        };

        const finalizeWhisper = async (state: {
          chunks: Float32Array[];
          sampleRate: number;
          maxRms: number;
        }) => {
          clearSilenceTimer();
          await stopWhisperCapture();
          talkActiveRef.current = false;
          setTalkModeActive(false);
          setTalkModeInterim('');
          setTalkModeLevel(0);
          if (!state.chunks.length || state.maxRms < MIN_SPEECH_RMS) {
            setTalkModeError('No speech detected. Try speaking louder or closer to the mic.');
            return;
          }
          try {
            const wavData = encodeWav(state.chunks, state.sampleRate);
            const audioBase64 = arrayBufferToBase64(wavData);
            const result = await accomplish.transcribeWhisper(audioBase64);
            if (result?.text) {
              const text = result.text.trim();
              if (!text || text === '[BLANK_AUDIO]') {
                setTalkModeError('No speech detected. Try again.');
                return;
              }
              commitTranscript(text);
            }
          } catch (err) {
            setTalkModeError(err instanceof Error ? err.message : 'Whisper transcription failed.');
          }
        };

        void capture();
        return;
      }

      const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
      if (!SpeechRecognitionCtor) {
        setTalkModeError('Speech recognition is not available in this build.');
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
      talkActiveRef.current = true;
      talkFinalRef.current = '';
      setTalkModeActive(true);
      setTalkModeError(null);
      setTalkModeInterim('');
      setTalkModeLevel(0);

      if (voiceConfig.earconEnabled !== false && source === 'wake') {
        playEarcon();
      }

      const silenceTimeoutMs =
        typeof voiceConfig.silenceTimeoutMs === 'number' && Number.isFinite(voiceConfig.silenceTimeoutMs)
          ? Math.min(Math.max(voiceConfig.silenceTimeoutMs, 400), 5000)
          : DEFAULT_SILENCE_TIMEOUT_MS;

      const stopPhrases = voiceConfig.stopPhrases?.length ? voiceConfig.stopPhrases : DEFAULT_STOP_PHRASES;

      const scheduleSilenceStop = () => {
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          const finalText = talkFinalRef.current.trim();
          finalizeTalkMode(finalText, 'silence');
        }, silenceTimeoutMs);
      };

      recognition.onresult = (event) => {
        let appendedFinal = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript ?? '';
          if (result.isFinal) {
            appendedFinal += ` ${transcript}`;
          } else {
            interim += transcript;
          }
        }

        if (appendedFinal.trim()) {
          talkFinalRef.current = `${talkFinalRef.current} ${appendedFinal}`.trim();
        }
        setTalkModeInterim(interim.trim());

        const finalLower = talkFinalRef.current.toLowerCase();
        const stopDetected = stopPhrases.some((phrase) =>
          phrase ? finalLower.includes(phrase.toLowerCase()) : false
        );
        if (stopDetected) {
          const cleaned = stripStopPhrases(talkFinalRef.current, stopPhrases);
          finalizeTalkMode(cleaned, 'stop');
          return;
        }

        scheduleSilenceStop();
      };

      recognition.onerror = (event) => {
        const message = event?.error || event?.message || 'Speech recognition failed.';
        setTalkModeError(message);
        finalizeTalkMode(talkFinalRef.current, 'error');
      };

      recognition.onend = () => {
        if (!talkActiveRef.current) return;
        finalizeTalkMode(talkFinalRef.current, 'end');
      };

      try {
        recognition.start();
        scheduleSilenceStop();
      } catch (err) {
        setTalkModeError(err instanceof Error ? err.message : 'Failed to start speech recognition.');
        finalizeTalkMode(talkFinalRef.current, 'error');
      }
    },
    [accomplish, commitTranscript, finalizeTalkMode, isActionDisabled, stopWhisperCapture, voiceConfig]
  );

  useEffect(() => {
    const unsubscribe = accomplish.onVoiceWakeDetected?.(() => {
      if (!voiceEnabled || !voiceAccessKeySet) return;
      if (voiceConfig.talkModeEnabled === false) return;
      startTalkMode('wake');
    });
    return () => {
      unsubscribe?.();
    };
  }, [accomplish, voiceAccessKeySet, voiceConfig.talkModeEnabled, voiceEnabled, startTalkMode]);

  const toggleVoiceWake = useCallback(async () => {
    if (voiceToggleBusy || isActionDisabled) return;
    if (!voiceAccessKeySet) return;
    try {
      setVoiceToggleBusy(true);
      const nextEnabled = !voiceConfig.enabled;
      const updated = await accomplish.setVoiceWakeConfig({
        ...voiceConfig,
        enabled: nextEnabled,
      });
      setVoiceConfig({
        enabled: Boolean(updated?.enabled),
        autoStart: Boolean(updated?.autoStart),
        triggers: Array.isArray(updated?.triggers) ? updated.triggers : voiceConfig.triggers,
        updatedAtMs: typeof updated?.updatedAtMs === 'number' ? updated.updatedAtMs : voiceConfig.updatedAtMs,
        talkModeEnabled: updated?.talkModeEnabled !== false,
        autoSubmit: Boolean(updated?.autoSubmit),
        insertMode: updated?.insertMode === 'replace' ? 'replace' : 'append',
        stopPhrases: Array.isArray(updated?.stopPhrases) ? updated.stopPhrases : voiceConfig.stopPhrases,
        silenceTimeoutMs:
          typeof updated?.silenceTimeoutMs === 'number' && Number.isFinite(updated.silenceTimeoutMs)
            ? updated.silenceTimeoutMs
            : voiceConfig.silenceTimeoutMs,
        earconEnabled: updated?.earconEnabled !== false,
        sttEngine: updated?.sttEngine === 'web-speech' ? 'web-speech' : 'whisper',
        whisperBinPath: typeof updated?.whisperBinPath === 'string' ? updated.whisperBinPath : voiceConfig.whisperBinPath,
        whisperModelPath:
          typeof updated?.whisperModelPath === 'string' ? updated.whisperModelPath : voiceConfig.whisperModelPath,
        whisperLanguage:
          typeof updated?.whisperLanguage === 'string' ? updated.whisperLanguage : voiceConfig.whisperLanguage,
      });
      const platform = await accomplish.getPlatform();
      setVoiceEnabled(platform === 'win32' && voiceAccessKeySet && Boolean(updated?.enabled));
    } catch {
      // keep previous state
    } finally {
      setVoiceToggleBusy(false);
    }
  }, [accomplish, isActionDisabled, voiceAccessKeySet, voiceConfig, voiceToggleBusy]);

  const voiceMeterLevel = voiceEnabled && voiceMeterActive ? voiceLevel : 0;

  return {
    voiceEnabled,
    voiceAccessKeySet,
    voiceToggleBusy,
    toggleVoiceWake,
    talkModeActive,
    talkModeInterim,
    talkModeError,
    talkModeLevel,
    voiceMeterLevel,
  };
}
