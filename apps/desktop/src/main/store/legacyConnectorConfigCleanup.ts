import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const LEGACY_CONNECTOR_CONFIG_FILES = [
  'discord-config.json',
  'telegram-config.json',
] as const;

function tryDeleteFile(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) {
      fs.rmSync(filepath, { force: true });
    }
  } catch (error) {
    console.warn('[Connector Config Cleanup] Failed to delete file:', filepath, error);
  }
}

export function cleanupLegacyConnectorConfigStores(): void {
  const userDataPath = app.getPath('userData');
  for (const filename of LEGACY_CONNECTOR_CONFIG_FILES) {
    const primary = path.join(userDataPath, filename);
    tryDeleteFile(primary);
    tryDeleteFile(`${primary}.bak`);
  }
}

