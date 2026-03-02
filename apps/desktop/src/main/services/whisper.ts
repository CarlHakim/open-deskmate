import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getVoiceWakeConfig } from '../store/voiceWake';

function parseWhisperOutput(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const textLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('whisper_') || line.startsWith('loading') || line.startsWith('system_info')) {
      continue;
    }
    if (line.startsWith('main:') || line.startsWith('ggml')) {
      continue;
    }
    if (line.startsWith('[') && line.includes('-->')) {
      const cleaned = line.replace(/^\[[0-9:.\s]+-->\s*[0-9:.\s]+\]\s*/g, '');
      if (cleaned) {
        textLines.push(cleaned);
      }
      continue;
    }
    if (!line.startsWith('[')) {
      textLines.push(line);
    }
  }

  return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

export async function transcribeWithWhisper(audioWav: Buffer): Promise<string> {
  const config = getVoiceWakeConfig();
  let binPath = config.whisperBinPath?.trim();
  const modelPath = config.whisperModelPath?.trim();

  if (!binPath || !modelPath) {
    throw new Error('Whisper is not configured. Set binary and model paths in Settings.');
  }

  if (!fs.existsSync(binPath)) {
    throw new Error(`Whisper binary not found at ${binPath}`);
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found at ${modelPath}`);
  }

  const normalizedBin = binPath.toLowerCase();
  if (normalizedBin.endsWith('main.exe') || normalizedBin.endsWith(`${path.sep}main`)) {
    const candidate = path.join(path.dirname(binPath), 'whisper-cli.exe');
    if (fs.existsSync(candidate)) {
      binPath = candidate;
    }
  }

  const language = config.whisperLanguage?.trim() || 'en';
  const tempRoot = path.join(app.getPath('temp'), 'opendeskmate-voice');
  fs.mkdirSync(tempRoot, { recursive: true });
  const wavPath = path.join(tempRoot, `capture-${Date.now()}.wav`);

  await fs.promises.writeFile(wavPath, audioWav);

  const args: string[] = ['-m', modelPath, '-f', wavPath];
  if (language) {
    args.push('-l', language);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', async (code) => {
      try {
        await fs.promises.unlink(wavPath);
      } catch {
        // ignore cleanup errors
      }

      if (code !== 0) {
        const message = stderr || stdout || `Whisper exited with code ${code}`;
        reject(new Error(message.trim()));
        return;
      }

      const transcript = parseWhisperOutput(stdout);
      resolve(transcript);
    });
  });
}
