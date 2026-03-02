import { app, BrowserWindow } from 'electron';
import { getVoiceWakeConfig } from '../store/voiceWake';
import { getVoiceWakeAccessKey } from '../store/secureStorage';

/**
 * Fix asar paths to point to unpacked location.
 * Native modules can't read from inside asar archives, so we need to
 * redirect paths from app.asar to app.asar.unpacked.
 */
function fixAsarPath(filePath: string): string {
  if (app.isPackaged && filePath.includes('app.asar')) {
    return filePath.replace('app.asar', 'app.asar.unpacked');
  }
  return filePath;
}

type PorcupineInstance = {
  frameLength: number;
  sampleRate: number;
  process: (pcm: Int16Array) => number;
  release: () => void;
};

type PvRecorderInstance = {
  start: () => void;
  stop: () => void;
  read: () => Promise<Int16Array>;
  release: () => void;
};

let running = false;
let stopping = false;
let porcupine: PorcupineInstance | null = null;
let recorder: PvRecorderInstance | null = null;
let loopPromise: Promise<void> | null = null;
let keywordLabels: string[] = [];
let lastLevelSentAt = 0;

function broadcastWake(keyword: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('voicewake:detected', { keyword, at: new Date().toISOString() });
  }
}

function broadcastLevel(level: number) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('voicewake:level', { level, at: new Date().toISOString() });
  }
}

function broadcastError(error: string) {
  console.error('[VoiceWake] Error:', error);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('voicewake:error', { error, at: new Date().toISOString() });
  }
}

function computeLevel(frame: Int16Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const sample = frame[i];
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / frame.length) / 32768;
  return Math.min(1, rms * 2.2);
}

function resolveBuiltinKeywords(
  triggers: string[],
  builtin: Record<string, unknown>,
  getBuiltinKeywordPath: (keyword: unknown) => string
) {
  const resolved: Array<{ keyword: string; label: string }> = [];
  for (const trigger of triggers) {
    const key = trigger.trim().toLowerCase();
    const match = Object.keys(builtin).find((k) => k.toLowerCase() === key);
    if (match) {
      // Fix asar path for packaged app - native code can't read from inside asar
      const keywordPath = fixAsarPath(getBuiltinKeywordPath(builtin[match]));
      resolved.push({ keyword: keywordPath, label: match.toLowerCase() });
    }
  }
  if (resolved.length === 0 && 'COMPUTER' in builtin) {
    // Fix asar path for packaged app
    const keywordPath = fixAsarPath(getBuiltinKeywordPath(builtin.COMPUTER));
    resolved.push({ keyword: keywordPath, label: 'computer' });
  }
  return resolved;
}

export async function startVoiceWakeService(): Promise<void> {
  if (running || stopping) return;
  if (process.platform !== 'win32') return;

  const config = getVoiceWakeConfig();
  if (!config.enabled) return;

  const accessKey = (await getVoiceWakeAccessKey()) || process.env.PICOVOICE_ACCESS_KEY;
  if (!accessKey) {
    const msg = 'Access key missing. Set it in settings or PICOVOICE_ACCESS_KEY.';
    console.warn('[VoiceWake]', msg);
    broadcastError(msg);
    return;
  }

  try {
    console.log('[VoiceWake] Loading Picovoice modules...');
    const porcupineModule = await import('@picovoice/porcupine-node');
    console.log('[VoiceWake] Porcupine module loaded');
    const pvRecorderModule = await import('@picovoice/pvrecorder-node');
    console.log('[VoiceWake] PvRecorder module loaded');
    const Porcupine = porcupineModule.Porcupine ?? porcupineModule.default?.Porcupine;
    const BuiltinKeyword = porcupineModule.BuiltinKeyword ?? porcupineModule.default?.BuiltinKeyword;
    const getBuiltinKeywordPath =
      porcupineModule.getBuiltinKeywordPath ?? porcupineModule.default?.getBuiltinKeywordPath;
    const PvRecorder = pvRecorderModule.PvRecorder ?? pvRecorderModule.default?.PvRecorder;

    if (!Porcupine || !BuiltinKeyword || !getBuiltinKeywordPath || !PvRecorder) {
      const msg = 'Porcupine modules not available after import.';
      console.warn('[VoiceWake]', msg);
      broadcastError(msg);
      return;
    }
    console.log('[VoiceWake] All Picovoice exports resolved');

    console.log('[VoiceWake] Resolving keywords for triggers:', config.triggers);
    const resolved = resolveBuiltinKeywords(config.triggers, BuiltinKeyword, getBuiltinKeywordPath as (keyword: unknown) => string);
    keywordLabels = resolved.map((item) => item.label);
    const keywords = resolved.map((item) => item.keyword);
    const sensitivities = keywords.map(() => 0.5);
    console.log('[VoiceWake] Resolved keywords:', keywords);

    // Get model path, fixing asar path for packaged app
    // The native library can't read from inside asar archives
    let modelPath: string | undefined;
    if (app.isPackaged) {
      // In packaged mode, construct path to unpacked porcupine module
      const unpackedBase = process.resourcesPath + '/app.asar.unpacked/node_modules/@picovoice/porcupine-node';
      modelPath = `${unpackedBase}/lib/common/porcupine_params.pv`;
      console.log('[VoiceWake] Using fixed model path:', modelPath);
    }

    console.log('[VoiceWake] Creating Porcupine instance...');
    porcupine = new Porcupine(accessKey, keywords, sensitivities, modelPath);
    console.log('[VoiceWake] Porcupine created successfully');
    console.log('[VoiceWake] Creating PvRecorder with frameLength:', porcupine.frameLength);
    recorder = new PvRecorder(porcupine.frameLength);
    console.log('[VoiceWake] Starting recorder...');
    recorder.start();
    console.log('[VoiceWake] Voice wake service started successfully!');
    running = true;
    stopping = false;
    lastLevelSentAt = 0;

    loopPromise = (async () => {
      while (running && !stopping && porcupine && recorder) {
        const frame = await recorder.read();
        const level = computeLevel(frame);
        const now = Date.now();
        if (now - lastLevelSentAt > 120) {
          lastLevelSentAt = now;
          broadcastLevel(level);
        }
        const keywordIndex = porcupine.process(frame);
        if (keywordIndex >= 0 && keywordIndex < keywordLabels.length) {
          const keyword = keywordLabels[keywordIndex] ?? 'wake';
          console.log('[VoiceWake] Detected:', keyword);
          broadcastWake(keyword);
        }
      }
    })();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[VoiceWake] Failed to start:', err);
    broadcastError(`Failed to start: ${errMsg}`);
    await stopVoiceWakeService();
  }
}

export async function stopVoiceWakeService(): Promise<void> {
  if (stopping) return;
  stopping = true;
  running = false;

  try {
    if (recorder) {
      recorder.stop();
      recorder.release();
    }
  } catch {
    // ignore
  } finally {
    recorder = null;
  }

  try {
    porcupine?.release();
  } catch {
    // ignore
  } finally {
    porcupine = null;
  }

  try {
    await loopPromise;
  } catch {
    // ignore loop errors
  } finally {
    loopPromise = null;
    stopping = false;
    broadcastLevel(0);
  }
}

export async function restartVoiceWakeService(): Promise<void> {
  await stopVoiceWakeService();
  await startVoiceWakeService();
}
