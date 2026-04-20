import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface OpenCodeSessionIntegrityResult {
  healthy: boolean;
  issues: string[];
}

function getOpenCodeStorageRoot(): string {
  return path.join(app.getPath('home'), '.local', 'share', 'opencode', 'storage');
}

function listJsonFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

function validateJsonFile(filePath: string, label: string, issues: string[]): void {
  if (issues.length >= 12) return;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) {
      issues.push(`${label} is empty`);
      return;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      issues.push(`${label} has no JSON content`);
      return;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push(`${label} is not a JSON object`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid JSON';
    issues.push(`${label} failed to parse: ${message}`);
  }
}

function inspectMessageParts(storageRoot: string, messageId: string, issues: string[]): void {
  const partDir = path.join(storageRoot, 'part', messageId);
  for (const filePath of listJsonFiles(partDir)) {
    validateJsonFile(filePath, `part/${messageId}/${path.basename(filePath)}`, issues);
    if (issues.length >= 12) return;
  }
}

function inspectSessionMetadata(storageRoot: string, sessionId: string, issues: string[]): void {
  const sessionRoot = path.join(storageRoot, 'session');
  if (!fs.existsSync(sessionRoot)) return;

  try {
    const projectDirs = fs.readdirSync(sessionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());

    for (const entry of projectDirs) {
      const filePath = path.join(sessionRoot, entry.name, `${sessionId}.json`);
      if (!fs.existsSync(filePath)) continue;
      validateJsonFile(filePath, `session/${entry.name}/${sessionId}.json`, issues);
      if (issues.length >= 12) return;
    }
  } catch {
    // Ignore directory scan failures; the goal is to detect obvious corruption.
  }
}

export function inspectOpenCodeSessionIntegrity(sessionId: string): OpenCodeSessionIntegrityResult {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return { healthy: true, issues: [] };
  }

  const storageRoot = getOpenCodeStorageRoot();
  const issues: string[] = [];
  const messageDir = path.join(storageRoot, 'message', normalizedSessionId);
  const messageFiles = listJsonFiles(messageDir);

  for (const filePath of messageFiles) {
    const fileName = path.basename(filePath);
    validateJsonFile(filePath, `message/${normalizedSessionId}/${fileName}`, issues);
    if (issues.length >= 12) break;
  }

  for (const filePath of messageFiles) {
    if (issues.length >= 12) break;
    const messageId = path.basename(filePath, '.json');
    inspectMessageParts(storageRoot, messageId, issues);
  }

  inspectSessionMetadata(storageRoot, normalizedSessionId, issues);

  return {
    healthy: issues.length === 0,
    issues,
  };
}

export function buildOpenCodeSessionResetMessage(issues: string[]): string {
  const firstIssue = issues[0] || 'corrupt OpenCode session data';
  return `Recovered from a corrupt OpenCode session by starting a fresh agent session. Cause: ${firstIssue}.`;
}
