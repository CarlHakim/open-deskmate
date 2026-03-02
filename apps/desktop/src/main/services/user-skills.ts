import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import type {
  UserSkillCreateRequest,
  UserSkillEntry,
  UserSkillDependencyStatusEntry,
  UserSkillDependencyStatusReport,
  UserSkillLifecycleState,
  UserSkillLifecycleUpdateRequest,
  UserSkillManifest,
  UserSkillManifestPerformance,
  UserSkillManifestResult,
  UserSkillManifestTestResult,
  UserSkillManifestValidation,
  UserSkillPerformanceRecordRequest,
  UserSkillRollbackRequest,
  UserSkillInstallOption,
  UserSkillInstallRequest,
  UserSkillInstallResult,
  UserSkillMetadata,
  UserSkillReadFileRequest,
  UserSkillReadFileResponse,
  UserSkillSource,
  UserSkillStatusReport,
  UserSkillStatusConfigCheck,
  UserSkillConfig,
  UserSkillsConfigStore,
  UserSkillSharingScope,
  UserSkillSharingUpdateRequest,
  UserSkillWriteFileRequest,
  UserSkillZipCandidate,
  UserSkillZipCleanupRequest,
  UserSkillZipInspectRequest,
  UserSkillZipInspectResponse,
  UserSkillZipInstallRequest,
  UserSkillZipInstallResult,
  UserSkillTestRequest,
} from '@accomplish/shared';
import { getAgentContext } from './agent-context';
import { getAllApiKeys } from '../store/secureStorage';
import { deleteUserSkillConfig, getUserSkillConfig, getUserSkillsConfigStore } from '../store/userSkillsConfig';
import { getNpmPath } from '../utils/bundled-node';

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.tmp', '.cache']);
const SKILL_MD_FILE = 'SKILL.md';
const SKILL_MANIFEST_FILE = 'skill.json';
const SKILL_VERSIONS_DIR = 'versions';
const SKILL_MAX_SIZE_BYTES = 350 * 1024;
const SKILL_BODY_PREVIEW_LINES = 6;
const SKILL_PROMPT_MAX_CHARS = 7000;
const DEFAULT_SKILL_VERSION = '1.0.0';
const DEFAULT_SKILL_TEST_TIMEOUT_MS = 12_000;

let skillsVersion = 0;
let watcher: fs.FSWatcher | null = null;
const extraWatchers: fs.FSWatcher[] = [];
let watcherTimer: NodeJS.Timeout | null = null;
const zipSessions = new Map<string, { dir: string; createdAtMs: number }>();
let reconcileInFlight = false;
let reconcilePending = false;
const skillMarkdownSnapshots = new Map<string, { checksum: string; content: string }>();

function bumpVersion(): number {
  const now = Date.now();
  skillsVersion = now <= skillsVersion ? skillsVersion + 1 : now;
  return skillsVersion;
}

export function getUserSkillsVersion(): number {
  return skillsVersion;
}

export function getManagedSkillsDir(): string {
  // Unit tests may mock Electron's app partially.
  if (typeof (app as unknown as { getPath?: unknown }).getPath !== 'function') {
    return path.join(process.cwd(), 'user-skills');
  }
  return path.join(app.getPath('userData'), 'skills');
}

export function getWorkspaceSkillsDir(agentId?: string): string | null {
  const ctx = getAgentContext(agentId);
  const root = (ctx.workspaceRoot || '').trim();
  if (!root) return null;
  return path.join(root, 'skills');
}

export function getBundledSkillsDir(): string | null {
  // Optional: ship a small starter library under resources/skills-library.
  if (typeof (app as unknown as { getAppPath?: unknown }).getAppPath !== 'function') {
    return null;
  }
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'skills-library')
    : path.join(app.getAppPath(), 'skills-library');
  return fs.existsSync(dir) ? dir : null;
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function checksumText(value: string): string {
  return createHash('sha256').update(value || '', 'utf8').digest('hex');
}

function isValidSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(String(value || '').trim());
}

function bumpPatchVersion(value: string): string {
  const normalized = String(value || '').trim();
  if (!isValidSemver(normalized)) return '1.0.1';
  const [major, minor, patch] = normalized.split('.').map((part) => Number(part));
  return `${major}.${minor}.${patch + 1}`;
}

function normalizeSkillVersion(value: string | undefined): string {
  const normalized = String(value || '').trim();
  return isValidSemver(normalized) ? normalized : DEFAULT_SKILL_VERSION;
}

function getSkillManifestPath(baseDir: string): string {
  return path.join(baseDir, SKILL_MANIFEST_FILE);
}

function getSkillMarkdownPath(baseDir: string): string {
  return path.join(baseDir, SKILL_MD_FILE);
}

function parseFrontMatterMap(contents: string): Record<string, string> {
  if (!contents.startsWith('---')) return {};
  const lines = contents.split(/\r?\n/);
  const meta: Record<string, string> = {};

  // Find end of frontmatter.
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return {};

  const isKeyLine = (line: string) => /^[A-Za-z0-9_-]+\s*:\s*.*$/.test(line) && !/^\s/.test(line);

  for (let i = 1; i < endIdx; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const raw = match[2] ?? '';

    if (!key) continue;

    // YAML-ish block scalar: metadata: |
    if (raw.trim() === '|' || raw.trim() === '>') {
      const block: string[] = [];
      let j = i + 1;
      // Determine indentation from the first non-empty line.
      let indent = '';
      for (; j < endIdx; j += 1) {
        const l = lines[j];
        if (!l.trim()) {
          block.push('');
          continue;
        }
        const m = l.match(/^(\s+)/);
        indent = m ? m[1] : '';
        break;
      }
      for (; j < endIdx; j += 1) {
        const l = lines[j];
        if (isKeyLine(l)) break;
        if (indent && l.startsWith(indent)) {
          block.push(l.slice(indent.length));
        } else if (/^\s+/.test(l)) {
          block.push(l.trimStart());
        } else {
          block.push(l);
        }
      }
      meta[key] = block.join('\n').trim();
      i = j - 1;
      continue;
    }

    meta[key] = raw.trim();
  }

  return meta;
}

function json5ishToJson(text: string): string {
  // Goal: support common OpenDeskmate-style metadata snippets like:
  // { opendeskmate: { requires: { bins: ["git"] } } }
  // (and legacy envelopes from older playbooks)
  // without executing code. This is a best-effort transformer.
  let s = text.trim();
  // Strip JS comments.
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Remove trailing commas.
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Convert single-quoted strings to double-quoted strings via a small scanner.
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== '\'') {
      out += ch;
      continue;
    }
    // parse single-quoted string
    let j = i + 1;
    let str = '';
    while (j < s.length) {
      const c = s[j];
      if (c === '\\' && j + 1 < s.length) {
        const n = s[j + 1];
        str += n;
        j += 2;
        continue;
      }
      if (c === '\'') break;
      str += c;
      j += 1;
    }
    out += `"${str.replace(/"/g, '\\"')}"`;
    i = j; // loop will i++
  }
  s = out;

  // Quote unquoted keys (simple subset).
  s = s.replace(/([,{]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g, '$1"$2"$3');
  return s;
}

function parseSkillMetadata(raw: string | undefined): UserSkillMetadata | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    return JSON.parse(trimmed) as UserSkillMetadata;
  } catch {
    // fall back to JSON5-ish transformer
    try {
      return JSON.parse(json5ishToJson(trimmed)) as UserSkillMetadata;
    } catch {
      return undefined;
    }
  }
}

function parseFrontMatter(contents: string): { name?: string; description?: string; metadataRaw?: string; metadata?: UserSkillMetadata } {
  const meta = parseFrontMatterMap(contents);
  return {
    name: meta['name'],
    description: meta['description'],
    metadataRaw: meta['metadata'],
    metadata: parseSkillMetadata(meta['metadata']),
  };
}

function resolveSkillProvenance(metadata: UserSkillMetadata | undefined): {
  generatedByUserInstruction: boolean;
  generatedByAgentName?: string;
  generatedByAgentId?: string;
  originLabel?: string;
} {
  const env = getSkillEnvelope(metadata);
  const markers = collectGenerationMarkers(env);
  const generatedByUserInstruction = isUserInstructionGeneratedFromMarkers(markers);
  const generatedByAgent = isAgentGeneratedFromMarkers(markers);
  const generatedByAgentName = String(env?.generatedByAgentName || '').trim() || undefined;
  const generatedByAgentId = normalizeAgentIdToken(env?.generatedByAgentId);
  return {
    generatedByUserInstruction,
    generatedByAgentName,
    generatedByAgentId,
    originLabel: generatedByUserInstruction
      ? 'Generated by user instruction to agent'
      : (generatedByAgent ? 'Auto-created by agent' : undefined),
  };
}

function stripFrontMatter(contents: string): string {
  if (!contents.startsWith('---')) return contents;
  const idx = contents.indexOf('\n---');
  if (idx === -1) return contents;
  const after = contents.indexOf('\n', idx + 4);
  if (after === -1) return '';
  return contents.slice(after + 1);
}

function validateSkillMarkdown(params: { skillId: string; raw: string }): UserSkillManifestValidation {
  const issues: string[] = [];
  const raw = params.raw || '';
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength > SKILL_MAX_SIZE_BYTES) {
    issues.push(`SKILL.md exceeds ${SKILL_MAX_SIZE_BYTES} bytes.`);
  }
  const body = stripFrontMatter(raw).trim();
  if (!body) {
    issues.push('SKILL.md body is empty.');
  }

  const fm = parseFrontMatter(raw);
  if (fm.metadataRaw && !fm.metadata) {
    issues.push('Front matter metadata is not valid JSON/JSON5-like object.');
  }
  if (fm.name && fm.name.trim().length > 128) {
    issues.push('Front matter name should be <= 128 characters.');
  }
  if (fm.description && fm.description.trim().length > 300) {
    issues.push('Front matter description should be <= 300 characters.');
  }
  return {
    ok: issues.length === 0,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

function createDefaultSkillManifest(params: {
  skillId: string;
  name: string;
  description?: string;
  checksum: string;
  nowIso?: string;
}): UserSkillManifest {
  const nowIso = params.nowIso || new Date().toISOString();
  return {
    schemaVersion: 1,
    skillId: params.skillId,
    name: params.name,
    description: params.description,
    version: DEFAULT_SKILL_VERSION,
    state: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
    checksum: params.checksum,
    versions: [],
  };
}

function normalizeSkillManifest(input: unknown, fallback: UserSkillManifest): UserSkillManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const raw = input as Partial<UserSkillManifest>;
  const stateRaw = String(raw.state || '').trim().toLowerCase();
  const state: UserSkillLifecycleState =
    stateRaw === 'deprecated'
      ? 'deprecated'
      : stateRaw === 'disabled'
        ? 'disabled'
        : 'active';

  const versions = Array.isArray(raw.versions)
    ? raw.versions
      .filter((entry): entry is NonNullable<UserSkillManifest['versions']>[number] =>
        Boolean(entry && typeof entry === 'object')
      )
      .map((entry) => ({
        version: normalizeSkillVersion(entry.version),
        archivedAt: String(entry.archivedAt || fallback.updatedAt),
        checksum: String(entry.checksum || ''),
        relPath: String(entry.relPath || ''),
      }))
      .filter((entry) => Boolean(entry.relPath))
    : [];

  const testCommand = Array.isArray(raw.test?.command)
    ? raw.test?.command
      .map((segment) => String(segment || '').trim())
      .filter(Boolean)
      .slice(0, 32)
    : undefined;

  const timeoutRaw = Number(raw.test?.timeoutMs);
  const testTimeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(1000, Math.min(120_000, Math.round(timeoutRaw)))
    : undefined;

  const performance: UserSkillManifestPerformance | undefined =
    raw.performance && typeof raw.performance === 'object'
      ? {
        samples: Math.max(0, Number(raw.performance.samples || 0)),
        successCount: Math.max(0, Number(raw.performance.successCount || 0)),
        failureCount: Math.max(0, Number(raw.performance.failureCount || 0)),
        avgLatencyMs: Number.isFinite(Number(raw.performance.avgLatencyMs)) ? Number(raw.performance.avgLatencyMs) : undefined,
        avgInputTokens: Number.isFinite(Number(raw.performance.avgInputTokens)) ? Number(raw.performance.avgInputTokens) : undefined,
        avgOutputTokens: Number.isFinite(Number(raw.performance.avgOutputTokens)) ? Number(raw.performance.avgOutputTokens) : undefined,
        lastUsedAt: raw.performance.lastUsedAt ? String(raw.performance.lastUsedAt) : undefined,
        lastError: raw.performance.lastError ? String(raw.performance.lastError) : undefined,
        lastEvaluationAt: raw.performance.lastEvaluationAt ? String(raw.performance.lastEvaluationAt) : undefined,
      }
      : undefined;

  return {
    schemaVersion: 1,
    skillId: String(raw.skillId || fallback.skillId).trim() || fallback.skillId,
    name: String(raw.name || fallback.name).trim() || fallback.name,
    description: raw.description ? String(raw.description).trim() : fallback.description,
    version: normalizeSkillVersion(raw.version || fallback.version),
    state,
    createdAt: String(raw.createdAt || fallback.createdAt),
    updatedAt: String(raw.updatedAt || fallback.updatedAt),
    checksum: String(raw.checksum || fallback.checksum),
    deprecationReason: raw.deprecationReason ? String(raw.deprecationReason).trim() : undefined,
    test: testCommand || testTimeoutMs
      ? {
        command: testCommand,
        timeoutMs: testTimeoutMs,
      }
      : undefined,
    versions,
    lastValidation: raw.lastValidation && typeof raw.lastValidation === 'object'
      ? {
        ok: Boolean(raw.lastValidation.ok),
        issues: Array.isArray(raw.lastValidation.issues)
          ? raw.lastValidation.issues.map((issue) => String(issue)).filter(Boolean).slice(0, 100)
          : [],
        checkedAt: String(raw.lastValidation.checkedAt || fallback.updatedAt),
      }
      : fallback.lastValidation,
    lastTest: raw.lastTest && typeof raw.lastTest === 'object'
      ? {
        ok: Boolean(raw.lastTest.ok),
        command: Array.isArray(raw.lastTest.command)
          ? raw.lastTest.command.map((segment) => String(segment)).filter(Boolean).slice(0, 32)
          : undefined,
        durationMs: Math.max(0, Number(raw.lastTest.durationMs || 0)),
        stdout: raw.lastTest.stdout ? String(raw.lastTest.stdout) : undefined,
        stderr: raw.lastTest.stderr ? String(raw.lastTest.stderr) : undefined,
        code: raw.lastTest.code === null ? null : (Number.isFinite(Number(raw.lastTest.code)) ? Number(raw.lastTest.code) : null),
        runAt: String(raw.lastTest.runAt || fallback.updatedAt),
      }
      : fallback.lastTest,
    performance,
  };
}

function loadSkillManifest(baseDir: string, fallback: UserSkillManifest): UserSkillManifest {
  const manifestPath = getSkillManifestPath(baseDir);
  if (!fs.existsSync(manifestPath)) return fallback;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeSkillManifest(parsed, fallback);
  } catch {
    return fallback;
  }
}

function saveSkillManifest(baseDir: string, manifest: UserSkillManifest): string {
  const manifestPath = getSkillManifestPath(baseDir);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

function resolveSnapshotKey(filePath: string): string {
  return path.resolve(filePath);
}

function setSkillSnapshot(filePath: string, content: string): void {
  skillMarkdownSnapshots.set(resolveSnapshotKey(filePath), {
    checksum: checksumText(content),
    content,
  });
}

function clearSkillSnapshot(filePath: string): void {
  skillMarkdownSnapshots.delete(resolveSnapshotKey(filePath));
}

function shouldIgnoreWatchPath(rawPath: string): boolean {
  const normalized = String(rawPath || '').replace(/\\/g, '/').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('/node_modules/')) return true;
  if (normalized.includes('/.git/')) return true;
  if (normalized.includes('/dist/')) return true;
  if (normalized.includes('/build/')) return true;
  if (normalized.endsWith(`/${SKILL_MANIFEST_FILE.toLowerCase()}`) || normalized === SKILL_MANIFEST_FILE.toLowerCase()) return true;
  if (normalized.includes(`/${SKILL_VERSIONS_DIR.toLowerCase()}/`)) return true;
  return false;
}

function primeSkillSnapshots(params?: { agentId?: string }): void {
  const report = listUserSkills({ agentId: params?.agentId });
  const live = new Set<string>();
  for (const entry of report.skills) {
    if (!entry.editable) continue;
    const key = resolveSnapshotKey(entry.filePath);
    live.add(key);
    if (skillMarkdownSnapshots.has(key)) continue;
    try {
      if (!fs.existsSync(entry.filePath)) continue;
      const raw = fs.readFileSync(entry.filePath, 'utf8');
      setSkillSnapshot(entry.filePath, raw);
    } catch {
      // ignore
    }
  }
  for (const key of Array.from(skillMarkdownSnapshots.keys())) {
    if (!live.has(key)) {
      skillMarkdownSnapshots.delete(key);
    }
  }
}

async function reconcileUserSkillManifests(params?: { agentId?: string }): Promise<void> {
  if (reconcileInFlight) {
    reconcilePending = true;
    return;
  }

  reconcileInFlight = true;
  try {
    do {
      reconcilePending = false;
      let changed = false;
      const report = listUserSkills({ agentId: params?.agentId });

      for (const entry of report.skills) {
        if (!entry.editable) continue;
        if (!fs.existsSync(entry.filePath)) {
          clearSkillSnapshot(entry.filePath);
          continue;
        }

        let raw = '';
        try {
          raw = fs.readFileSync(entry.filePath, 'utf8');
        } catch {
          continue;
        }
        const checksum = checksumText(raw);
        const snapshot = skillMarkdownSnapshots.get(resolveSnapshotKey(entry.filePath));
        const parsed = parseFrontMatter(raw);
        const fallbackManifest = createDefaultSkillManifest({
          skillId: entry.id,
          name: (parsed.name && parsed.name.trim()) ? parsed.name.trim() : entry.name,
          description: parsed.description && parsed.description.trim() ? parsed.description.trim() : entry.description,
          checksum,
        });
        const manifestPath = getSkillManifestPath(entry.baseDir);
        const manifestExists = fs.existsSync(manifestPath);
        const manifest = loadSkillManifest(entry.baseDir, fallbackManifest);

        const hasChecksumDrift = manifest.checksum !== checksum;
        const hasSnapshotDrift = !snapshot || snapshot.checksum !== checksum;
        const shouldValidate = !manifestExists || hasChecksumDrift || hasSnapshotDrift || !manifest.lastValidation;
        if (!shouldValidate) {
          continue;
        }

        const validation = validateSkillMarkdown({ skillId: entry.id, raw });
        let nextManifest: UserSkillManifest = {
          ...manifest,
          skillId: entry.id,
          name: (parsed.name && parsed.name.trim()) ? parsed.name.trim() : manifest.name,
          description: parsed.description && parsed.description.trim()
            ? parsed.description.trim()
            : manifest.description,
          checksum,
          updatedAt: new Date().toISOString(),
          lastValidation: validation,
        };

        if (snapshot && snapshot.checksum !== checksum) {
          const archived = archiveSkillVersion(entry.baseDir, manifest.version, snapshot.content, snapshot.checksum);
          nextManifest = {
            ...nextManifest,
            version: bumpPatchVersion(manifest.version),
            versions: [
              ...manifest.versions,
              {
                version: manifest.version,
                archivedAt: archived.archivedAt,
                checksum: snapshot.checksum,
                relPath: archived.relPath,
              },
            ].slice(-100),
          };
        } else if (hasChecksumDrift) {
          // Fallback when there is drift but no prior snapshot to archive.
          nextManifest = {
            ...nextManifest,
            version: bumpPatchVersion(manifest.version),
          };
        }

        try {
          const lastTest = await runSkillTests({
            baseDir: entry.baseDir,
            manifest: nextManifest,
            validation,
          });
          nextManifest.lastTest = lastTest;
        } catch (error) {
          nextManifest.lastTest = {
            ok: false,
            durationMs: 0,
            code: null,
            stdout: '',
            stderr: (error as Error)?.message || 'Failed to run tests.',
            runAt: new Date().toISOString(),
          };
        }

        saveSkillManifest(entry.baseDir, nextManifest);
        setSkillSnapshot(entry.filePath, raw);
        changed = true;
      }

      if (changed) {
        bumpVersion();
      }
    } while (reconcilePending);
  } finally {
    reconcileInFlight = false;
  }
}

async function runSkillTests(params: {
  baseDir: string;
  manifest: UserSkillManifest;
  validation: UserSkillManifestValidation;
}): Promise<UserSkillManifestTestResult> {
  const started = Date.now();
  if (!params.validation.ok) {
    return {
      ok: false,
      command: undefined,
      durationMs: Date.now() - started,
      stdout: '',
      stderr: params.validation.issues.join('\n') || 'Validation failed.',
      code: null,
      runAt: new Date().toISOString(),
    };
  }

  const command = params.manifest.test?.command;
  if (!command || command.length === 0) {
    return {
      ok: true,
      durationMs: Date.now() - started,
      code: 0,
      stdout: 'Validation passed (no test command configured).',
      stderr: '',
      runAt: new Date().toISOString(),
    };
  }

  const timeoutMs = Math.max(1000, Math.min(120_000, Math.round(params.manifest.test?.timeoutMs || DEFAULT_SKILL_TEST_TIMEOUT_MS)));
  const result = await runCommandWithTimeout(command, {
    cwd: params.baseDir,
    timeoutMs,
  });
  return {
    ok: result.code === 0,
    command,
    durationMs: Date.now() - started,
    stdout: (result.stdout || '').slice(0, 16_000),
    stderr: (result.stderr || '').slice(0, 16_000),
    code: result.code,
    runAt: new Date().toISOString(),
  };
}

function listSkillFolders(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .filter((name) => !DEFAULT_IGNORED_DIRS.has(name));
  } catch {
    return [];
  }
}

function readSkillEntry(params: {
  id: string;
  dir: string;
  source: UserSkillSource;
  editable: boolean;
}): UserSkillEntry | null {
  const baseDir = path.join(params.dir, params.id);
  const filePath = getSkillMarkdownPath(baseDir);
  if (!fs.existsSync(filePath)) return null;
  let contents = '';
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const fm = parseFrontMatter(contents);
  const body = stripFrontMatter(contents).trim();
  const preview = body.split(/\r?\n/).slice(0, SKILL_BODY_PREVIEW_LINES).join('\n').trim();
  const checksum = checksumText(contents);
  const fallbackManifest = createDefaultSkillManifest({
    skillId: params.id,
    name: (fm.name && fm.name.trim()) ? fm.name.trim() : titleCase(params.id),
    description: fm.description && fm.description.trim() ? fm.description.trim() : undefined,
    checksum,
  });
  const manifest = loadSkillManifest(baseDir, fallbackManifest);
  const manifestPath = getSkillManifestPath(baseDir);
  const provenance = resolveSkillProvenance(fm.metadata);
  const visibility = resolveSkillVisibility(fm.metadata, provenance.generatedByAgentId);

  return {
    id: params.id,
    name: (fm.name && fm.name.trim()) ? fm.name.trim() : titleCase(params.id),
    description: fm.description && fm.description.trim() ? fm.description.trim() : undefined,
    source: params.source,
    baseDir,
    filePath,
    manifestPath,
    manifest,
    metadata: fm.metadata,
    generatedByUserInstruction: provenance.generatedByUserInstruction,
    generatedByAgentName: provenance.generatedByAgentName,
    originLabel: provenance.originLabel,
    visibilityScope: visibility.scope,
    visibilityOwnerAgentId: visibility.ownerAgentId,
    visibilitySharedWithAgentIds: visibility.sharedWithAgentIds,
    bodyPreview: preview || undefined,
    editable: params.editable,
  };
}

export function listUserSkills(params?: { agentId?: string }): UserSkillStatusReport {
  const agentContext = params?.agentId ? getAgentContext(params.agentId) : undefined;
  const activeAgentId = agentContext?.agentId;
  const managedSkillsDir = getManagedSkillsDir();
  const workspaceSkillsDir = getWorkspaceSkillsDir(params?.agentId);
  const bundledSkillsDir = getBundledSkillsDir();

  // Ensure managed dir exists.
  if (!fs.existsSync(managedSkillsDir)) {
    try {
      fs.mkdirSync(managedSkillsDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  // Precedence: bundled < managed < workspace
  const merged = new Map<string, UserSkillEntry>();
  const addFrom = (dir: string | null, source: UserSkillSource, editable: boolean) => {
    if (!dir) return;
    for (const id of listSkillFolders(dir)) {
      const entry = readSkillEntry({ id, dir, source, editable });
      if (entry) merged.set(id, entry);
    }
  };

  addFrom(bundledSkillsDir, 'bundled', false);
  addFrom(managedSkillsDir, 'managed', true);
  addFrom(workspaceSkillsDir, 'workspace', true);

  const visibleSkills = Array.from(merged.values())
    .filter((entry) =>
      isSkillVisibleToAgent(
        {
          scope: entry.visibilityScope ?? 'all',
          ownerAgentId: entry.visibilityOwnerAgentId,
          sharedWithAgentIds: entry.visibilitySharedWithAgentIds ?? [],
        },
        activeAgentId
      )
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    managedSkillsDir,
    workspaceSkillsDir,
    bundledSkillsDir,
    version: skillsVersion,
    skills: visibleSkills,
  };
}

function safeRemoveDir(dirPath: string): void {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) return;
  // fs.rmSync is available in modern Node; force handles locked files best-effort.
  fs.rmSync(resolved, { recursive: true, force: true });
}

export function deleteUserSkill(req: { skillId: string; source?: UserSkillSource; agentId?: string }): { ok: boolean; message: string } {
  const skillId = String(req.skillId || '').trim();
  if (!skillId) return { ok: false, message: 'skillId is required' };

  const report = listUserSkills({ agentId: req.agentId });
  const entry = report.skills.find((s) => s.id === skillId && (!req.source || s.source === req.source));
  if (!entry) return { ok: false, message: 'Skill not found' };
  const requesterAgentId = normalizeAgentIdToken(req.agentId)
    || normalizeAgentIdToken(getAgentContext(req.agentId).agentId);
  if (
    entry.visibilityOwnerAgentId
    && requesterAgentId
    && requesterAgentId !== entry.visibilityOwnerAgentId
  ) {
    return { ok: false, message: 'Only the owner agent can delete this skill.' };
  }
  if (!entry.editable) return { ok: false, message: 'This skill cannot be deleted' };
  if (entry.source === 'bundled') return { ok: false, message: 'Bundled skills cannot be deleted' };

  // Only allow deleting from known roots.
  const allowedRoots: Array<{ source: UserSkillSource; dir: string | null | undefined }> = [
    { source: 'managed', dir: report.managedSkillsDir },
    { source: 'workspace', dir: report.workspaceSkillsDir },
  ];
  const root = allowedRoots.find((r) => r.source === entry.source)?.dir;
  if (!root) return { ok: false, message: 'Skill source directory is not available' };

  const baseDir = path.resolve(root, entry.id);
  if (!baseDir.startsWith(path.resolve(root) + path.sep)) {
    return { ok: false, message: 'Refusing to delete outside skills directory' };
  }

  try {
    safeRemoveDir(baseDir);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to delete skill' };
  }
  clearSkillSnapshot(entry.filePath);

  // Best-effort cleanup: remove stored config for this skill key.
  try {
    deleteUserSkillConfig(resolveSkillKey(entry));
  } catch {
    // ignore
  }

  bumpVersion();
  return { ok: true, message: `Deleted skill ${entry.name}` };
}

function resolveSkillKey(entry: UserSkillEntry): string {
  const raw = entry.metadata?.opendeskmate?.skillKey ?? entry.metadata?.clawdbot?.skillKey;
  return raw && raw.trim() ? raw.trim() : entry.id;
}

type SkillMetadataEnvelope = NonNullable<NonNullable<UserSkillMetadata['opendeskmate']>>;

type SkillVisibility = {
  scope: UserSkillSharingScope;
  ownerAgentId?: string;
  sharedWithAgentIds: string[];
};

function getSkillEnvelope(metadata?: UserSkillMetadata): SkillMetadataEnvelope | undefined {
  // Prefer new envelope name, but accept legacy for backward compatibility.
  return (metadata?.opendeskmate ?? metadata?.clawdbot) as SkillMetadataEnvelope | undefined;
}

function normalizeAgentIdToken(value: unknown): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  const normalized = raw
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || undefined;
}

function normalizeAgentIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeAgentIdToken(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  );
}

function normalizeSkillSharingScope(value: unknown): UserSkillSharingScope | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'private' || raw === 'selected' || raw === 'all') return raw;
  return undefined;
}

function collectGenerationMarkers(env: SkillMetadataEnvelope | undefined): string[] {
  return [env?.generatedBy, env?.origin, env?.createdBy]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function isAgentGeneratedFromMarkers(markers: string[]): boolean {
  return markers.some((value) =>
    value === 'agent-user-instruction'
    || value === 'user-instruction-to-agent'
    || value === 'generated-by-user-instruction'
    || value === 'agent_instruction'
    || value === 'agent-auto'
    || value === 'agent_auto'
  );
}

function isUserInstructionGeneratedFromMarkers(markers: string[]): boolean {
  return markers.some((value) =>
    value === 'agent-user-instruction'
    || value === 'user-instruction-to-agent'
    || value === 'generated-by-user-instruction'
    || value === 'agent_instruction'
  );
}

function resolveSkillVisibility(
  metadata: UserSkillMetadata | undefined,
  fallbackOwnerAgentId?: string
): SkillVisibility {
  const env = getSkillEnvelope(metadata);
  const markers = collectGenerationMarkers(env);
  const generatedByAgent = isAgentGeneratedFromMarkers(markers);
  const visibilityScope = normalizeSkillSharingScope(env?.visibility?.scope);
  const ownerAgentId = normalizeAgentIdToken(env?.visibility?.ownerAgentId)
    || normalizeAgentIdToken(env?.generatedByAgentId)
    || normalizeAgentIdToken(fallbackOwnerAgentId);
  const sharedWithAgentIds = normalizeAgentIdList(env?.visibility?.sharedWithAgentIds)
    .filter((agentId) => agentId !== ownerAgentId);

  const scope: UserSkillSharingScope = visibilityScope
    ?? (generatedByAgent && ownerAgentId ? 'private' : 'all');

  return {
    scope,
    ownerAgentId,
    sharedWithAgentIds: scope === 'selected' ? sharedWithAgentIds : [],
  };
}

function isSkillVisibleToAgent(skill: SkillVisibility, agentId?: string): boolean {
  const activeAgentId = normalizeAgentIdToken(agentId);
  if (!activeAgentId) return true;
  if (skill.scope === 'all') return true;
  if (!skill.ownerAgentId) return true;
  if (skill.ownerAgentId === activeAgentId) return true;
  if (skill.scope === 'selected' && skill.sharedWithAgentIds.includes(activeAgentId)) return true;
  return false;
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return Boolean(value);
}

function parseConfigPath(pathStr: string): string[] {
  const s = String(pathStr || '').trim();
  if (!s) return [];
  const parts: string[] = [];
  let buf = '';
  let inQuote = false;
  let quoteChar: '"' | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < s.length) {
        buf += s[i + 1];
        i += 1;
        continue;
      }
      if (quoteChar && ch === quoteChar) {
        inQuote = false;
        quoteChar = null;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      quoteChar = '"';
      continue;
    }
    if (ch === '.') {
      const seg = buf.trim();
      if (seg) parts.push(seg);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return parts;
}

function resolveConfigPathValue(obj: unknown, pathStr: string): unknown {
  const parts = parseConfigPath(pathStr);
  if (parts.length === 0) return undefined;
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    const rec = cur as Record<string, unknown>;
    cur = rec[part];
  }
  return cur;
}

function resolveRequiredConfigValue(
  configStore: UserSkillsConfigStore,
  skillKey: string,
  skillConfig: UserSkillConfig,
  pathStr: string
): unknown {
  const trimmedPath = String(pathStr || '').trim();
  if (!trimmedPath) return undefined;

  // Canonical absolute paths can still target the full store.
  if (trimmedPath.startsWith('skills.')) {
    return resolveConfigPathValue(configStore, trimmedPath);
  }

  // User-friendly default: path is relative to this skill's config object.
  const localValue = resolveConfigPathValue(skillConfig, trimmedPath);
  if (localValue !== undefined) return localValue;

  // Backward compatibility: some older skills used root-level paths.
  const legacyRootValue = resolveConfigPathValue(configStore, trimmedPath);
  if (legacyRootValue !== undefined) return legacyRootValue;

  // Also accept explicit skill-key-prefixed path.
  const skillScopedValue = resolveConfigPathValue(configStore, `skills.${skillKey}.${trimmedPath}`);
  if (skillScopedValue !== undefined) return skillScopedValue;

  return undefined;
}

function hasBinary(bin: string): boolean {
  const name = String(bin || '').trim();
  if (!name) return false;

  const lower = name.toLowerCase();
  const exists = (p: string) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };

  // Special-case common browser binaries on Windows/macOS because they are typically
  // not on PATH, but users still have them installed.
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LocalAppData || '';
    const candidates =
      lower === 'chrome'
        ? [
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
          ]
        : lower === 'msedge' || lower === 'edge'
          ? [
              path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
              path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
              localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
            ]
          : lower === 'firefox'
            ? [
                path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
                path.join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
                localAppData ? path.join(localAppData, 'Mozilla Firefox', 'firefox.exe') : '',
              ]
            : [];
    if (candidates.some((p) => p && exists(p))) return true;
  } else if (process.platform === 'darwin') {
    const candidates =
      lower === 'chrome'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : lower === 'msedge' || lower === 'edge'
          ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
          : lower === 'firefox'
            ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
            : [];
    if (candidates.some((p) => p && exists(p))) return true;
  }

  const pathEnv = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(sep).filter(Boolean);

  const candidates = process.platform === 'win32'
    ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
    : [name];

  for (const d of dirs) {
    for (const c of candidates) {
      const full = path.join(d, c);
      if (exists(full)) return true;
    }
  }
  return false;
}

function resolveInstallId(spec: NonNullable<NonNullable<SkillMetadataEnvelope['install']>[number]>, index: number): string {
  const raw = (spec.id ?? `${spec.kind}-${index}`).trim();
  return raw || `${spec.kind}-${index}`;
}

function selectPreferredInstallSpec(
  install: NonNullable<NonNullable<SkillMetadataEnvelope['install']>>,
  prefs: { preferBrew: boolean; nodeManager: 'npm' },
): { spec: NonNullable<NonNullable<SkillMetadataEnvelope['install']>[number]>; index: number } | undefined {
  if (!install || install.length === 0) return undefined;
  const indexed = install.map((spec, index) => ({ spec, index }));
  const findKind = (kind: string) => indexed.find((item) => item.spec.kind === kind);
  const brewSpec = findKind('brew');
  const nodeSpec = findKind('node');
  const goSpec = findKind('go');
  const uvSpec = findKind('uv');

  if (prefs.preferBrew && hasBinary('brew') && brewSpec) return brewSpec;
  if (uvSpec) return uvSpec;
  if (nodeSpec) return nodeSpec;
  if (brewSpec) return brewSpec;
  if (goSpec) return goSpec;
  return indexed[0];
}

function normalizeInstallOptions(entry: UserSkillEntry): UserSkillInstallOption[] {
  const install = getSkillEnvelope(entry.metadata)?.install ?? [];
  if (!install.length) return [];

  const platform = process.platform;
  const filtered = install.filter((spec) => {
    const osList = spec.os ?? [];
    return osList.length === 0 || osList.includes(platform);
  });
  if (!filtered.length) return [];

  const prefs = { preferBrew: true, nodeManager: 'npm' as const };

  const toOption = (spec: (typeof filtered)[number], index: number): UserSkillInstallOption => {
    const id = resolveInstallId(spec, index);
    const bins = spec.bins ?? [];
    let label = String(spec.label ?? '').trim();
    if (spec.kind === 'node' && spec.package) {
      label = `Install ${spec.package} (${prefs.nodeManager})`;
    }
    if (!label) {
      if (spec.kind === 'brew' && spec.formula) label = `Install ${spec.formula} (brew)`;
      else if (spec.kind === 'node' && spec.package) label = `Install ${spec.package} (${prefs.nodeManager})`;
      else if (spec.kind === 'go' && spec.module) label = `Install ${spec.module} (go)`;
      else if (spec.kind === 'uv' && spec.package) label = `Install ${spec.package} (uv)`;
      else if (spec.kind === 'download' && spec.url) {
        const url = String(spec.url || '').trim();
        const last = url.split('/').pop();
        label = `Download ${last && last.length > 0 ? last : url}`;
      } else label = 'Run installer';
    }
    return { id, kind: spec.kind, label, bins };
  };

  const allDownloads = filtered.every((spec) => spec.kind === 'download');
  if (allDownloads) return filtered.map((spec, index) => toOption(spec, index));

  const preferred = selectPreferredInstallSpec(filtered as NonNullable<NonNullable<SkillMetadataEnvelope['install']>>, prefs);
  if (!preferred) return [];
  return [toOption(preferred.spec as (typeof filtered)[number], preferred.index)];
}

export async function buildUserSkillDependencyStatusReport(params?: { agentId?: string }): Promise<UserSkillDependencyStatusReport> {
  const base = listUserSkills({ agentId: params?.agentId });
  const apiKeys = await getAllApiKeys();
  const configStore = getUserSkillsConfigStore();

  const skills: UserSkillDependencyStatusEntry[] = base.skills.map((entry) => {
    const skillKey = resolveSkillKey(entry);
    const cfg = getUserSkillConfig(skillKey);
    const disabled = cfg.enabled === false;
    const env = getSkillEnvelope(entry.metadata);
    const always = env?.always === true;

    const requiredBins = env?.requires?.bins ?? [];
    const requiredAnyBins = env?.requires?.anyBins ?? [];
    const requiredEnv = env?.requires?.env ?? [];
    const requiredConfig = env?.requires?.config ?? [];
    const requiredOs = env?.os ?? [];

    const missingBins = requiredBins.filter((bin) => !hasBinary(bin));
    const missingAnyBins =
      requiredAnyBins.length > 0 && !requiredAnyBins.some((bin) => hasBinary(bin))
        ? requiredAnyBins
        : [];
    const missingOs = requiredOs.length > 0 && !requiredOs.includes(process.platform) ? requiredOs : [];

    const knownEnvSatisfied = (envName: string): boolean => {
      const k = envName.trim();
      if (!k) return false;
      if (k === 'OPENAI_API_KEY' && Boolean(apiKeys.openai)) return true;
      if (k === 'ANTHROPIC_API_KEY' && Boolean(apiKeys.anthropic)) return true;
      if (k === 'GOOGLE_GENERATIVE_AI_API_KEY' && Boolean(apiKeys.google)) return true;
      if (k === 'XAI_API_KEY' && Boolean(apiKeys.xai)) return true;
      return false;
    };

    const missingEnv: string[] = [];
    for (const envName of requiredEnv) {
      if (process.env[envName]) continue;
      if (cfg.env && typeof cfg.env === 'object' && typeof (cfg.env as Record<string, unknown>)[envName] === 'string') continue;
      if (cfg.apiKey && env?.primaryEnv === envName) continue;
      if (knownEnvSatisfied(envName)) continue;
      missingEnv.push(envName);
    }

    const configChecks: UserSkillStatusConfigCheck[] = requiredConfig.map((pathStr) => {
      const value = resolveRequiredConfigValue(configStore, skillKey, cfg, pathStr);
      const satisfied = isTruthy(value);
      return { path: pathStr, value, satisfied };
    });
    const missingConfig = configChecks.filter((c) => !c.satisfied).map((c) => c.path);

    const missing = always
      ? { bins: [], anyBins: [], env: [], config: [], os: [] }
      : { bins: missingBins, anyBins: missingAnyBins, env: missingEnv, config: missingConfig, os: missingOs };

    const eligible =
      !disabled &&
      (always ||
        (missing.bins.length === 0 &&
          missing.anyBins.length === 0 &&
          missing.env.length === 0 &&
          missing.config.length === 0 &&
          missing.os.length === 0));

    return {
      ...entry,
      skillKey,
      always,
      disabled,
      eligible,
      requirements: { bins: requiredBins, anyBins: requiredAnyBins, env: requiredEnv, config: requiredConfig, os: requiredOs },
      missing,
      configChecks,
      install: normalizeInstallOptions(entry),
    };
  });

  return {
    managedSkillsDir: base.managedSkillsDir,
    workspaceSkillsDir: base.workspaceSkillsDir,
    bundledSkillsDir: base.bundledSkillsDir,
    version: base.version,
    skills,
  };
}

function runCommandWithTimeout(argv: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
    }, Math.max(1000, opts.timeoutMs));
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : null, stdout, stderr });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || 'spawn error' });
    });
  });
}

function downloadToFile(url: string, destPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { 'User-Agent': 'open-deskmate', Accept: '*/*' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadToFile(res.headers.location, destPath, timeoutMs).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function resolveArchiveType(spec: { archive?: string }, filename: string): string | undefined {
  const explicit = String(spec.archive || '').trim().toLowerCase();
  if (explicit) return explicit;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tar.bz2';
  if (lower.endsWith('.zip')) return 'zip';
  return undefined;
}

async function extractArchive(params: { archivePath: string; archiveType: string; targetDir: string; stripComponents?: number; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  fs.mkdirSync(params.targetDir, { recursive: true });

  if (params.archiveType === 'zip') {
    if (process.platform === 'win32') {
      const script = `Expand-Archive -Force -Path "${params.archivePath}" -DestinationPath "${params.targetDir}"`;
      return await runCommandWithTimeout(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: params.timeoutMs });
    }
    if (hasBinary('unzip')) {
      return await runCommandWithTimeout(['unzip', '-o', params.archivePath, '-d', params.targetDir], { timeoutMs: params.timeoutMs });
    }
    return { code: null, stdout: '', stderr: 'zip extraction requires powershell (Windows) or unzip (macOS/Linux)' };
  }

  if (!hasBinary('tar')) {
    return { code: null, stdout: '', stderr: 'tar not found on PATH (required for tar.* extraction)' };
  }

  const strip = typeof params.stripComponents === 'number' && params.stripComponents > 0
    ? ['--strip-components', String(params.stripComponents)]
    : [];

  if (params.archiveType === 'tar.gz') {
    return await runCommandWithTimeout(['tar', '-xzf', params.archivePath, '-C', params.targetDir, ...strip], { timeoutMs: params.timeoutMs });
  }
  if (params.archiveType === 'tar.bz2') {
    return await runCommandWithTimeout(['tar', '-xjf', params.archivePath, '-C', params.targetDir, ...strip], { timeoutMs: params.timeoutMs });
  }
  return await runCommandWithTimeout(['tar', '-xf', params.archivePath, '-C', params.targetDir, ...strip], { timeoutMs: params.timeoutMs });
}

function defaultToolsDir(): string {
  if (typeof (app as unknown as { getPath?: unknown }).getPath !== 'function') {
    return path.join(process.cwd(), 'tools');
  }
  return path.join(app.getPath('userData'), 'tools');
}

function sanitizeSkillId(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'skill';
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return cleaned || 'skill';
}

function cleanupZipSessions(maxAgeMs: number = 30 * 60_000): void {
  const now = Date.now();
  for (const [id, sess] of zipSessions.entries()) {
    if (now - sess.createdAtMs < maxAgeMs) continue;
    try {
      fs.rmSync(sess.dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    zipSessions.delete(id);
  }
}

function scanSkillCandidates(extractedRoot: string): UserSkillZipCandidate[] {
  const results: UserSkillZipCandidate[] = [];
  const maxDirs = 5000;
  const maxDepth = 16;

  const stack: Array<{ dir: string; depth: number }> = [{ dir: extractedRoot, depth: 0 }];
  let visited = 0;

  while (stack.length > 0 && visited < maxDirs) {
    const next = stack.pop();
    if (!next) break;
    visited += 1;

    const base = path.basename(next.dir);
    if (DEFAULT_IGNORED_DIRS.has(base) || base.startsWith('.')) {
      continue;
    }

    const skillMd = path.join(next.dir, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      try {
        const contents = fs.readFileSync(skillMd, 'utf8');
        const fm = parseFrontMatter(contents);
        const relPath = path.relative(extractedRoot, next.dir) || '.';
        const suggested = sanitizeSkillId(path.basename(next.dir));
        results.push({
          skillId: suggested,
          name: (fm.name && fm.name.trim()) ? fm.name.trim() : titleCase(suggested),
          description: fm.description && fm.description.trim() ? fm.description.trim() : undefined,
          relPath,
        });
      } catch {
        // ignore read errors
      }
      // Don't descend further if a skill folder is found.
      continue;
    }

    if (next.depth >= maxDepth) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const child = path.join(next.dir, e.name);
      stack.push({ dir: child, depth: next.depth + 1 });
    }
  }

  // Stable sort: prefer shorter relPath then name.
  return results.sort((a, b) => {
    const al = a.relPath.split(/[\\/]/).length;
    const bl = b.relPath.split(/[\\/]/).length;
    if (al !== bl) return al - bl;
    return a.name.localeCompare(b.name);
  });
}

function resolveGithubZipUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === 'github.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && !u.pathname.includes('/archive/')) {
      // Default-branch ZIP without needing API calls.
      return `https://github.com/${parts[0]}/${parts[1]}/archive/HEAD.zip`;
    }
  }
  return url;
}

function copyDirRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = path.join(srcDir, e.name);
    const dest = path.join(destDir, e.name);
    if (e.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(e.name)) continue;
      copyDirRecursive(src, dest);
      continue;
    }
    if (e.isSymbolicLink()) {
      // Avoid copying symlinks from untrusted ZIP sources.
      continue;
    }
    if (e.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

export async function inspectUserSkillZip(req: UserSkillZipInspectRequest): Promise<UserSkillZipInspectResponse> {
  cleanupZipSessions();

  const sessionId = randomUUID();
  const sessionDir = path.join(os.tmpdir(), 'open-deskmate-skillzip', sessionId);
  const extractDir = path.join(sessionDir, 'extract');
  const archivePath = path.join(sessionDir, 'archive.zip');

  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    if (req.source === 'local') {
      if (!fs.existsSync(req.filePath)) {
        throw new Error(`File not found: ${req.filePath}`);
      }
      fs.copyFileSync(req.filePath, archivePath);
    } else {
      const zipUrl = req.source === 'github' ? resolveGithubZipUrl(req.url) : req.url;
      const parsed = new URL(zipUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http/https URLs are supported.');
      }
      await downloadToFile(zipUrl, archivePath, 45_000);
    }

    const extracted = await extractArchive({
      archivePath,
      archiveType: 'zip',
      targetDir: extractDir,
      timeoutMs: 90_000,
    });
    if (extracted.code !== 0 && extracted.code !== null) {
      throw new Error(extracted.stderr || extracted.stdout || 'Failed to extract ZIP.');
    }
    if (extracted.code === null && extracted.stderr) {
      throw new Error(extracted.stderr);
    }

    const candidates = scanSkillCandidates(extractDir);
    zipSessions.set(sessionId, { dir: sessionDir, createdAtMs: Date.now() });

    return {
      sessionId,
      candidates,
      message: candidates.length === 0 ? 'No SKILL.md files found in this ZIP.' : undefined,
    };
  } catch (error) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw error;
  }
}

export async function installUserSkillFromZip(req: UserSkillZipInstallRequest): Promise<UserSkillZipInstallResult> {
  cleanupZipSessions();

  const sess = zipSessions.get(req.sessionId);
  if (!sess) {
    return { ok: false, message: 'ZIP session expired. Please re-open the ZIP.' };
  }

  const extractDir = path.join(sess.dir, 'extract');
  const rel = String(req.relPath || '').trim();
  if (!rel) {
    return { ok: false, message: 'Missing relPath.' };
  }

  const srcDir = path.resolve(extractDir, rel);
  const root = path.resolve(extractDir);
  const rootPrefix = root.endsWith(path.sep) ? root : (root + path.sep);
  if (!(srcDir === root || srcDir.startsWith(rootPrefix))) {
    return { ok: false, message: 'Invalid relPath.' };
  }
  if (!fs.existsSync(path.join(srcDir, 'SKILL.md'))) {
    return { ok: false, message: 'Selected folder does not contain SKILL.md.' };
  }

  const destSkillId = sanitizeSkillId(req.destSkillId);
  const managedDir = getManagedSkillsDir();
  const destDir = path.join(managedDir, destSkillId);

  try {
    fs.mkdirSync(managedDir, { recursive: true });
  } catch {
    // ignore
  }

  if (fs.existsSync(destDir)) {
    if (!req.overwrite) {
      return { ok: false, message: `Skill already exists: ${destSkillId}. Enable overwrite to replace it.` };
    }
    try {
      fs.rmSync(destDir, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, message: `Failed to remove existing skill folder: ${(error as Error).message}` };
    }
  }

  try {
    copyDirRecursive(srcDir, destDir);
    const skillMdPath = getSkillMarkdownPath(destDir);
    const raw = fs.readFileSync(skillMdPath, 'utf8');
    const fm = parseFrontMatter(raw);
    const validation = validateSkillMarkdown({ skillId: destSkillId, raw });
    const manifest = createDefaultSkillManifest({
      skillId: destSkillId,
      name: (fm.name && fm.name.trim()) ? fm.name.trim() : titleCase(destSkillId),
      description: fm.description && fm.description.trim() ? fm.description.trim() : undefined,
      checksum: checksumText(raw),
    });
    manifest.lastValidation = validation;
    manifest.lastTest = await runSkillTests({
      baseDir: destDir,
      manifest,
      validation,
    });
    saveSkillManifest(destDir, manifest);
    setSkillSnapshot(skillMdPath, raw);
    bumpVersion();
    return { ok: true, message: `Installed skill: ${destSkillId}`, installedSkillId: destSkillId, destDir };
  } catch (error) {
    return { ok: false, message: `Install failed: ${(error as Error).message}` };
  }
}

export async function cleanupUserSkillZipSession(req: UserSkillZipCleanupRequest): Promise<{ ok: boolean }> {
  const sess = zipSessions.get(req.sessionId);
  if (!sess) return { ok: true };
  try {
    fs.rmSync(sess.dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  zipSessions.delete(req.sessionId);
  return { ok: true };
}

export async function installUserSkillDependency(req: UserSkillInstallRequest): Promise<UserSkillInstallResult> {
  const report = listUserSkills({ agentId: req.agentId });
  const entry = report.skills.find((s) => s.id === req.skillId && (!req.source || s.source === req.source));
  if (!entry) {
    return { ok: false, message: `Skill not found: ${req.skillId}`, stdout: '', stderr: '', code: null };
  }
  const install = getSkillEnvelope(entry.metadata)?.install ?? [];
  if (!install.length) {
    return { ok: false, message: 'No installers defined in SKILL.md metadata.', stdout: '', stderr: '', code: null };
  }

  const platform = process.platform;
  const filtered = install
    .map((spec, index) => ({ spec, index }))
    .filter(({ spec }) => {
      const osList = spec.os ?? [];
      return osList.length === 0 || osList.includes(platform);
    });

  const hit = filtered.find(({ spec, index }) => resolveInstallId(spec, index) === req.installId);
  if (!hit) {
    return { ok: false, message: `Installer not found: ${req.installId}`, stdout: '', stderr: '', code: null };
  }

  const spec = hit.spec as any;
  const timeoutMs = 10 * 60_000;

  if (spec.kind === 'brew') {
    if (!spec.formula) return { ok: false, message: 'missing brew formula', stdout: '', stderr: '', code: null };
    const result = await runCommandWithTimeout(['brew', 'install', spec.formula], { timeoutMs });
    return { ok: result.code === 0, message: result.code === 0 ? `Installed ${spec.formula}` : 'Install failed', stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.code };
  }

  if (spec.kind === 'node') {
    if (!spec.package) return { ok: false, message: 'missing node package', stdout: '', stderr: '', code: null };
    const npm = getNpmPath();
    const result = await runCommandWithTimeout([npm, 'install', '-g', spec.package], { timeoutMs });
    const ok = result.code === 0;
    return { ok, message: ok ? `Installed ${spec.package}` : 'Install failed', stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.code };
  }

  if (spec.kind === 'go') {
    if (!spec.module) return { ok: false, message: 'missing go module', stdout: '', stderr: '', code: null };
    const result = await runCommandWithTimeout(['go', 'install', spec.module], { timeoutMs });
    const ok = result.code === 0;
    return { ok, message: ok ? `Installed ${spec.module}` : 'Install failed', stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.code };
  }

  if (spec.kind === 'uv') {
    if (!spec.package) return { ok: false, message: 'missing uv package', stdout: '', stderr: '', code: null };
    const result = await runCommandWithTimeout(['uv', 'tool', 'install', spec.package], { timeoutMs });
    const ok = result.code === 0;
    return { ok, message: ok ? `Installed ${spec.package}` : 'Install failed', stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.code };
  }

  if (spec.kind === 'download') {
    if (!spec.url) return { ok: false, message: 'missing download url', stdout: '', stderr: '', code: null };
    const url = String(spec.url).trim();
    const filename = (url.split('/').pop() || 'download').trim();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeskmate-skill-download-'));
    const archivePath = path.join(tmpDir, filename);

    try {
      await downloadToFile(url, archivePath, Math.min(timeoutMs, 120_000));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Download failed: ${msg}`, stdout: '', stderr: msg, code: null };
    }

    const archiveType = resolveArchiveType(spec, filename);
    const shouldExtract = spec.extract ?? Boolean(archiveType);

    if (!shouldExtract) {
      return { ok: true, message: `Downloaded to ${archivePath}`, stdout: archivePath, stderr: '', code: 0 };
    }

    if (!archiveType) {
      return { ok: false, message: 'extract requested but archive type could not be detected', stdout: '', stderr: '', code: null };
    }

    const skillKey = resolveSkillKey(entry);
    const targetDir = spec.targetDir ? path.resolve(String(spec.targetDir)) : path.join(defaultToolsDir(), skillKey);

    const extractResult = await extractArchive({
      archivePath,
      archiveType,
      targetDir,
      stripComponents: spec.stripComponents,
      timeoutMs,
    });
    const ok = extractResult.code === 0;
    return {
      ok,
      message: ok ? `Downloaded and extracted to ${targetDir}` : 'Extract failed',
      stdout: extractResult.stdout.trim(),
      stderr: extractResult.stderr.trim(),
      code: extractResult.code,
    };
  }

  return { ok: false, message: `Unsupported installer kind: ${String(spec.kind)}`, stdout: '', stderr: '', code: null };
}

function resolveSkillBaseDir(skillId: string, source?: UserSkillSource, agentId?: string): { baseDir: string; source: UserSkillSource; editable: boolean } {
  const report = listUserSkills({ agentId });
  const hit = report.skills.find((s) => s.id === skillId && (!source || s.source === source));
  if (hit) return { baseDir: hit.baseDir, source: hit.source, editable: hit.editable };
  // Default to managed.
  return { baseDir: path.join(report.managedSkillsDir, skillId), source: 'managed', editable: true };
}

function safeRelPath(relPath: string): string {
  const cleaned = relPath.replace(/^[\\/]+/, '').trim();
  if (!cleaned) throw new Error('Invalid relPath');
  if (cleaned.includes('..')) throw new Error('Invalid relPath');
  return cleaned;
}

function archiveSkillVersion(baseDir: string, version: string, content: string, checksum: string): { relPath: string; archivedAt: string } {
  const archivedAt = new Date().toISOString();
  const safeVersion = normalizeSkillVersion(version).replace(/[^0-9.]/g, '');
  const stamp = archivedAt.replace(/[:.]/g, '-');
  const fileName = `${safeVersion}-${stamp}.md`;
  const relPath = path.join(SKILL_VERSIONS_DIR, fileName);
  const fullPath = path.join(baseDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return { relPath: relPath.replace(/\\/g, '/'), archivedAt };
}

export function readUserSkillFile(req: UserSkillReadFileRequest & { agentId?: string }): UserSkillReadFileResponse {
  const rel = safeRelPath(req.relPath);
  const resolved = resolveSkillBaseDir(req.skillId, req.source, req.agentId);
  const full = path.join(resolved.baseDir, rel);
  if (!fs.existsSync(full)) throw new Error('File not found: ' + full);
  const content = fs.readFileSync(full, 'utf8');
  return { path: full, content };
}

export async function writeUserSkillFile(req: UserSkillWriteFileRequest & { agentId?: string }): Promise<{ path: string; manifest?: UserSkillManifest }> {
  const rel = safeRelPath(req.relPath);
  const resolved = resolveSkillBaseDir(req.skillId, req.source, req.agentId);
  if (!resolved.editable) throw new Error('Skill is not editable');
  const full = path.join(resolved.baseDir, rel);
  const isSkillMarkdown = rel.toLowerCase() === SKILL_MD_FILE.toLowerCase();

  if (isSkillMarkdown) {
    const nextContent = String(req.content ?? '');
    const validation = validateSkillMarkdown({ skillId: req.skillId, raw: nextContent });
    if (!validation.ok) {
      throw new Error(`Skill validation failed: ${validation.issues.join(' ')}`);
    }

    const existingContent = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
    const existingChecksum = checksumText(existingContent);
    const nextChecksum = checksumText(nextContent);

    const parsedNext = parseFrontMatter(nextContent);
    const fallbackManifest = createDefaultSkillManifest({
      skillId: req.skillId,
      name: (parsedNext.name && parsedNext.name.trim()) ? parsedNext.name.trim() : titleCase(req.skillId),
      description: parsedNext.description && parsedNext.description.trim() ? parsedNext.description.trim() : undefined,
      checksum: existingChecksum || nextChecksum,
    });
    const currentManifest = loadSkillManifest(resolved.baseDir, fallbackManifest);

    let nextManifest: UserSkillManifest = {
      ...currentManifest,
      skillId: req.skillId,
      name: (parsedNext.name && parsedNext.name.trim()) ? parsedNext.name.trim() : currentManifest.name,
      description: parsedNext.description && parsedNext.description.trim()
        ? parsedNext.description.trim()
        : currentManifest.description,
      updatedAt: new Date().toISOString(),
      checksum: nextChecksum,
      lastValidation: validation,
    };

    if (existingContent && existingChecksum !== nextChecksum) {
      const archived = archiveSkillVersion(resolved.baseDir, currentManifest.version, existingContent, existingChecksum);
      nextManifest.versions = [
        ...currentManifest.versions,
        {
          version: currentManifest.version,
          archivedAt: archived.archivedAt,
          checksum: existingChecksum,
          relPath: archived.relPath,
        },
      ].slice(-100);
      nextManifest.version = bumpPatchVersion(currentManifest.version);
    } else if (!existingContent) {
      nextManifest.version = normalizeSkillVersion(currentManifest.version || DEFAULT_SKILL_VERSION);
    }

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, nextContent, 'utf8');
    const lastTest = await runSkillTests({
      baseDir: resolved.baseDir,
      manifest: nextManifest,
      validation,
    });
    const savedManifest: UserSkillManifest = {
      ...nextManifest,
      lastTest,
    };
    saveSkillManifest(resolved.baseDir, savedManifest);
    setSkillSnapshot(full, nextContent);
    bumpVersion();
    return { path: full, manifest: savedManifest };
  }

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, req.content ?? '', 'utf8');
  bumpVersion();
  return { path: full };
}

export function createUserSkill(req: UserSkillCreateRequest): { baseDir: string; skillId: string; manifest: UserSkillManifest } {
  const requested = (req.skillId || '').trim();
  const makeBase = (input: string): string => {
    const raw = String(input || '').trim().toLowerCase();
    const replaced = raw.replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const prefixed = /^[a-z0-9]/.test(replaced) ? replaced : `skill-${replaced}`;
    return (prefixed || 'skill').slice(0, 64);
  };
  const baseCandidate = makeBase(requested || req.name || req.description || 'skill');
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(baseCandidate)) {
    throw new Error('skillId must be 1-64 chars: letters, digits, dash, underscore');
  }
  const managedDir = getManagedSkillsDir();
  let skillId = baseCandidate;
  let baseDir = path.join(managedDir, skillId);
  if (fs.existsSync(baseDir)) {
    let next = 2;
    while (next < 10_000) {
      const suffix = `-${next}`;
      const candidate = `${baseCandidate.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
      const candidateDir = path.join(managedDir, candidate);
      if (!fs.existsSync(candidateDir)) {
        skillId = candidate;
        baseDir = candidateDir;
        break;
      }
      next += 1;
    }
  }
  fs.mkdirSync(baseDir, { recursive: true });
  const name = (req.name && req.name.trim()) ? req.name.trim() : titleCase(skillId);
  const description = (req.description && req.description.trim()) ? req.description.trim() : 'Describe what this skill helps with.';
  const skillMd = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
    'What this skill does:',
    '- ...',
    '',
    'How to use:',
    '- ...',
    '',
  ].join('\n');
  const skillPath = getSkillMarkdownPath(baseDir);
  fs.writeFileSync(skillPath, skillMd, 'utf8');
  const validation = validateSkillMarkdown({ skillId, raw: skillMd });
  const manifest = createDefaultSkillManifest({
    skillId,
    name,
    description,
    checksum: checksumText(skillMd),
  });
  manifest.lastValidation = validation;
  manifest.lastTest = {
    ok: validation.ok,
    durationMs: 0,
    code: validation.ok ? 0 : null,
    stdout: validation.ok ? 'Validation passed.' : '',
    stderr: validation.ok ? '' : validation.issues.join('\n'),
    runAt: new Date().toISOString(),
  };
  saveSkillManifest(baseDir, manifest);
  setSkillSnapshot(skillPath, skillMd);
  bumpVersion();
  return { baseDir, skillId, manifest };
}

function resolveSkillEntryForMutation(req: { skillId: string; source?: UserSkillSource; agentId?: string }): UserSkillEntry {
  const report = listUserSkills({ agentId: req.agentId });
  const entry = report.skills.find((skill) => skill.id === req.skillId && (!req.source || skill.source === req.source));
  if (!entry) {
    throw new Error(`Skill not found: ${req.skillId}`);
  }
  const requesterAgentId = normalizeAgentIdToken(req.agentId)
    || normalizeAgentIdToken(getAgentContext(req.agentId).agentId);
  if (
    entry.visibilityOwnerAgentId
    && requesterAgentId
    && requesterAgentId !== entry.visibilityOwnerAgentId
  ) {
    throw new Error('Only the owner agent can modify this skill');
  }
  if (!entry.editable) {
    throw new Error('Skill is not editable');
  }
  return entry;
}

export async function runUserSkillTests(req: UserSkillTestRequest): Promise<UserSkillManifestResult> {
  const entry = resolveSkillEntryForMutation(req);
  const raw = fs.readFileSync(entry.filePath, 'utf8');
  const validation = validateSkillMarkdown({ skillId: entry.id, raw });
  const manifest = loadSkillManifest(
    entry.baseDir,
    createDefaultSkillManifest({
      skillId: entry.id,
      name: entry.name,
      description: entry.description,
      checksum: checksumText(raw),
    })
  );
  const lastTest = await runSkillTests({
    baseDir: entry.baseDir,
    manifest,
    validation,
  });
  const saved: UserSkillManifest = {
    ...manifest,
    checksum: checksumText(raw),
    updatedAt: new Date().toISOString(),
    lastValidation: validation,
    lastTest,
  };
  saveSkillManifest(entry.baseDir, saved);
  bumpVersion();
  return {
    ok: lastTest.ok,
    message: lastTest.ok ? 'Skill tests passed.' : 'Skill tests failed.',
    manifest: saved,
  };
}

function splitFrontMatter(raw: string): { frontMatterLines: string[]; body: string; hasFrontMatter: boolean } {
  const lines = String(raw || '').split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== '---') {
    return {
      frontMatterLines: [],
      body: String(raw || ''),
      hasFrontMatter: false,
    };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    return {
      frontMatterLines: [],
      body: String(raw || ''),
      hasFrontMatter: false,
    };
  }
  return {
    frontMatterLines: lines.slice(1, endIdx),
    body: lines.slice(endIdx + 1).join('\n'),
    hasFrontMatter: true,
  };
}

function stripMetadataFromFrontMatterLines(frontMatterLines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < frontMatterLines.length; i += 1) {
    const line = frontMatterLines[i] ?? '';
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match || /^\s/.test(line)) {
      out.push(line);
      continue;
    }

    const key = String(match[1] || '').trim().toLowerCase();
    const rawValue = String(match[2] || '').trim();
    if (key !== 'metadata') {
      out.push(line);
      continue;
    }

    // metadata: | (block scalar) => skip following indented lines
    if (rawValue === '|' || rawValue === '>') {
      i += 1;
      while (i < frontMatterLines.length) {
        const next = frontMatterLines[i] ?? '';
        if (!next.trim()) {
          i += 1;
          continue;
        }
        if (/^\s/.test(next)) {
          i += 1;
          continue;
        }
        i -= 1;
        break;
      }
    }
  }
  return out;
}

function renderMetadataBlock(metadata: UserSkillMetadata): string[] {
  const json = JSON.stringify(metadata, null, 2);
  return [
    'metadata: |',
    ...json.split('\n').map((line) => `  ${line}`),
  ];
}

function upsertSkillMetadataInMarkdown(raw: string, metadata: UserSkillMetadata): string {
  const split = splitFrontMatter(raw);
  const cleanFrontMatter = stripMetadataFromFrontMatterLines(split.frontMatterLines)
    .filter((line, index, arr) => {
      // Trim trailing blank lines in front matter for stable output.
      if (line.trim()) return true;
      for (let i = index + 1; i < arr.length; i += 1) {
        if ((arr[i] || '').trim()) return true;
      }
      return false;
    });
  const nextFrontMatter = [
    ...cleanFrontMatter,
    ...renderMetadataBlock(metadata),
  ];

  const body = split.hasFrontMatter ? split.body : String(raw || '');
  const normalizedBody = String(body || '').replace(/^\n+/, '');
  return [
    '---',
    ...nextFrontMatter,
    '---',
    normalizedBody,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export async function setUserSkillLifecycle(req: UserSkillLifecycleUpdateRequest): Promise<UserSkillManifestResult> {
  const entry = resolveSkillEntryForMutation(req);
  const raw = fs.readFileSync(entry.filePath, 'utf8');
  const manifest = loadSkillManifest(
    entry.baseDir,
    createDefaultSkillManifest({
      skillId: entry.id,
      name: entry.name,
      description: entry.description,
      checksum: checksumText(raw),
    })
  );
  const saved: UserSkillManifest = {
    ...manifest,
    state: req.state,
    deprecationReason: req.state === 'deprecated' ? String(req.reason || '').trim() || manifest.deprecationReason : undefined,
    updatedAt: new Date().toISOString(),
  };
  saveSkillManifest(entry.baseDir, saved);
  bumpVersion();
  return {
    ok: true,
    message: `Skill ${entry.id} set to ${req.state}.`,
    manifest: saved,
  };
}

export async function setUserSkillSharing(req: UserSkillSharingUpdateRequest): Promise<UserSkillManifestResult> {
  const entry = resolveSkillEntryForMutation(req);
  const raw = fs.readFileSync(entry.filePath, 'utf8');
  const fm = parseFrontMatter(raw);
  const metadata = fm.metadata ?? {};
  const currentVisibility = resolveSkillVisibility(metadata);
  const requesterAgentId = normalizeAgentIdToken(req.agentId)
    || normalizeAgentIdToken(getAgentContext(req.agentId).agentId);
  if (
    currentVisibility.ownerAgentId
    && requesterAgentId
    && requesterAgentId !== currentVisibility.ownerAgentId
  ) {
    return {
      ok: false,
      message: 'Only the owner agent can change sharing for this skill.',
    };
  }
  const env = getSkillEnvelope(metadata) ?? {};
  const scope = normalizeSkillSharingScope(req.scope) ?? 'private';
  const ownerAgentId = normalizeAgentIdToken(env.visibility?.ownerAgentId)
    || normalizeAgentIdToken(env.generatedByAgentId)
    || requesterAgentId;
  const sharedWithAgentIds = normalizeAgentIdList(req.sharedWithAgentIds)
    .filter((agentId) => agentId !== ownerAgentId);

  const nextEnv: SkillMetadataEnvelope = {
    ...env,
    generatedByAgentId: env.generatedByAgentId || ownerAgentId,
    visibility: {
      scope,
      ownerAgentId,
      sharedWithAgentIds: scope === 'selected' ? sharedWithAgentIds : [],
    },
  };
  const nextMetadata: UserSkillMetadata = {
    ...metadata,
    opendeskmate: nextEnv,
  };
  const nextRaw = upsertSkillMetadataInMarkdown(raw, nextMetadata);
  const writeResult = await writeUserSkillFile({
    skillId: req.skillId,
    relPath: SKILL_MD_FILE,
    content: nextRaw,
    source: req.source,
    agentId: req.agentId,
  });
  return {
    ok: true,
    message:
      scope === 'all'
        ? `Skill ${entry.id} is now shared with all agents.`
        : scope === 'selected'
          ? `Skill ${entry.id} is shared with selected agents.`
          : `Skill ${entry.id} is now private to its owner agent.`,
    manifest: writeResult.manifest,
  };
}

function weightedAverage(previousAvg: number | undefined, previousSamples: number, incoming: number): number {
  if (!Number.isFinite(incoming)) return previousAvg ?? 0;
  const prev = Number.isFinite(previousAvg as number) ? Number(previousAvg) : 0;
  const samples = Math.max(0, previousSamples);
  return ((prev * samples) + incoming) / (samples + 1);
}

export async function recordUserSkillPerformance(req: UserSkillPerformanceRecordRequest): Promise<UserSkillManifestResult> {
  const entry = resolveSkillEntryForMutation(req);
  const raw = fs.readFileSync(entry.filePath, 'utf8');
  const manifest = loadSkillManifest(
    entry.baseDir,
    createDefaultSkillManifest({
      skillId: entry.id,
      name: entry.name,
      description: entry.description,
      checksum: checksumText(raw),
    })
  );
  const current = manifest.performance ?? {
    samples: 0,
    successCount: 0,
    failureCount: 0,
  };
  const nextSamples = Math.max(0, current.samples) + 1;
  const next: UserSkillManifestPerformance = {
    samples: nextSamples,
    successCount: (current.successCount || 0) + (req.success ? 1 : 0),
    failureCount: (current.failureCount || 0) + (req.success ? 0 : 1),
    avgLatencyMs: Number.isFinite(Number(req.latencyMs))
      ? weightedAverage(current.avgLatencyMs, current.samples || 0, Number(req.latencyMs))
      : current.avgLatencyMs,
    avgInputTokens: Number.isFinite(Number(req.inputTokens))
      ? weightedAverage(current.avgInputTokens, current.samples || 0, Number(req.inputTokens))
      : current.avgInputTokens,
    avgOutputTokens: Number.isFinite(Number(req.outputTokens))
      ? weightedAverage(current.avgOutputTokens, current.samples || 0, Number(req.outputTokens))
      : current.avgOutputTokens,
    lastUsedAt: new Date().toISOString(),
    lastError: req.success ? undefined : String(req.error || '').trim() || current.lastError,
    lastEvaluationAt: new Date().toISOString(),
  };

  const saved: UserSkillManifest = {
    ...manifest,
    performance: next,
    updatedAt: new Date().toISOString(),
  };
  saveSkillManifest(entry.baseDir, saved);
  bumpVersion();
  return {
    ok: true,
    message: 'Skill performance metrics updated.',
    manifest: saved,
  };
}

export async function rollbackUserSkill(req: UserSkillRollbackRequest): Promise<UserSkillManifestResult> {
  const entry = resolveSkillEntryForMutation(req);
  const currentRaw = fs.readFileSync(entry.filePath, 'utf8');
  const currentChecksum = checksumText(currentRaw);
  const manifest = loadSkillManifest(
    entry.baseDir,
    createDefaultSkillManifest({
      skillId: entry.id,
      name: entry.name,
      description: entry.description,
      checksum: currentChecksum,
    })
  );
  if (!manifest.versions.length) {
    return { ok: false, message: 'No previous versions available to roll back.' };
  }

  const target = req.targetVersion
    ? manifest.versions.find((version) => version.version === req.targetVersion)
    : manifest.versions[manifest.versions.length - 1];
  if (!target) {
    return { ok: false, message: `Target version not found: ${req.targetVersion}` };
  }

  const targetPath = path.join(entry.baseDir, target.relPath);
  if (!fs.existsSync(targetPath)) {
    return { ok: false, message: `Archived version file is missing: ${target.relPath}` };
  }
  const rolledBackContent = fs.readFileSync(targetPath, 'utf8');
  const validation = validateSkillMarkdown({ skillId: entry.id, raw: rolledBackContent });
  if (!validation.ok) {
    return { ok: false, message: `Rollback target failed validation: ${validation.issues.join(' ')}` };
  }

  const archivedCurrent = archiveSkillVersion(entry.baseDir, manifest.version, currentRaw, currentChecksum);
  fs.writeFileSync(entry.filePath, rolledBackContent, 'utf8');
  setSkillSnapshot(entry.filePath, rolledBackContent);
  const rolledBackChecksum = checksumText(rolledBackContent);

  const versionsWithoutTarget = manifest.versions.filter((version) => version.relPath !== target.relPath);
  const nextManifest: UserSkillManifest = {
    ...manifest,
    version: target.version,
    checksum: rolledBackChecksum,
    updatedAt: new Date().toISOString(),
    versions: [
      ...versionsWithoutTarget,
      {
        version: manifest.version,
        archivedAt: archivedCurrent.archivedAt,
        checksum: currentChecksum,
        relPath: archivedCurrent.relPath,
      },
    ].slice(-100),
    lastValidation: validation,
  };
  const lastTest = await runSkillTests({
    baseDir: entry.baseDir,
    manifest: nextManifest,
    validation,
  });
  nextManifest.lastTest = lastTest;
  saveSkillManifest(entry.baseDir, nextManifest);
  bumpVersion();
  return {
    ok: true,
    message: `Rolled back ${entry.id} to version ${target.version}.`,
    manifest: nextManifest,
  };
}

function tokenizeForSkillSearch(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  );
}

function selectRelevantSkills(
  skills: UserSkillEntry[],
  userMessage: string | undefined,
  maxSkills: number
): UserSkillEntry[] {
  const activeSkills = skills.filter((skill) => {
    const state = skill.manifest?.state ?? 'active';
    return state === 'active';
  });

  if (!userMessage || !userMessage.trim()) return activeSkills;
  if (process.env.OPENDESKMATE_SKILL_FILTER === '0') return skills;

  const query = userMessage.toLowerCase();
  const tokens = tokenizeForSkillSearch(userMessage);
  if (!tokens.length) return [];

  const scored = activeSkills.map((skill) => {
    let score = 0;
    const title = `${skill.id} ${skill.name} ${skill.description ?? ''}`.toLowerCase();
    if (query.includes(skill.id.toLowerCase()) || query.includes(skill.name.toLowerCase())) {
      score += 12;
    }
    for (const token of tokens) {
      if (title.includes(token)) score += 4;
    }
    return { skill, score };
  });

  const matches = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxSkills))
    .map((entry) => entry.skill);

  return matches;
}

export type UserSkillsPromptBundle = {
  prompt: string;
  selectedSkillIds: string[];
};

export function buildUserSkillsPromptBundle(params?: { agentId?: string; userMessage?: string; maxSkills?: number }): UserSkillsPromptBundle {
  const report = listUserSkills({ agentId: params?.agentId });
  const ctx = getAgentContext(params?.agentId) as {
    agent?: {
      id?: string;
      name?: string;
      autoSkillEnabled?: boolean;
      autoSkillAutoPromoteLowRisk?: boolean;
    };
  } | undefined;
  const creatorAgentId = String(ctx?.agent?.id || params?.agentId || '').trim() || 'main';
  const creatorAgentName = String(ctx?.agent?.name || '').trim() || 'Agent';
  const autoSkillEnabled = Boolean(ctx?.agent?.autoSkillEnabled);
  const autoSkillAutoPromoteLowRisk = Boolean(ctx?.agent?.autoSkillAutoPromoteLowRisk);
  const maxSkills = Number.isFinite(params?.maxSkills as number) ? Math.max(1, Math.floor(params?.maxSkills as number)) : 2;
  const skills = selectRelevantSkills(report.skills, params?.userMessage, maxSkills);

  const managedDir = getManagedSkillsDir();
  const workspaceDir = getWorkspaceSkillsDir(params?.agentId);

  const blocks: string[] = [];
  blocks.push('<skills>');
  blocks.push('Skills are simple markdown playbooks stored on disk and injected into your context.');
  blocks.push('Use installed skills when relevant.');
  blocks.push('If the user asks you to save/create a new skill, do it yourself by creating a new folder containing SKILL.md.');
  if (autoSkillEnabled) {
    blocks.push('Auto skill creation is ENABLED for this agent. You may proactively create a skill when a workflow is clearly reusable.');
    if (autoSkillAutoPromoteLowRisk) {
      blocks.push('Low-risk auto-promotion is ENABLED: when a drafted skill is validated and low risk, you may promote it automatically.');
    } else {
      blocks.push('Low-risk auto-promotion is DISABLED: draft skills but require explicit user confirmation before promotion.');
    }
  } else {
    blocks.push('Auto skill creation is DISABLED for this agent. Do not create new skills unless the user explicitly asks.');
  }
  blocks.push('When no skill ID is provided, generate one automatically in kebab-case, ensure it is unique, and tell the user the final ID you created.');
  blocks.push(`If a skill is created by this agent, set front matter metadata.opendeskmate.generatedByAgentName to ${JSON.stringify(creatorAgentName)} and metadata.opendeskmate.generatedByAgentId to ${JSON.stringify(creatorAgentId)}.`);
  blocks.push('Default agent-created skills to private scope by setting metadata.opendeskmate.visibility.scope="private" and metadata.opendeskmate.visibility.ownerAgentId to the same agent id.');
  blocks.push('Only set metadata.opendeskmate.visibility.scope to "all" or "selected" when the user explicitly asks to share the skill.');
  blocks.push(`If a skill is created from a user instruction, set metadata.opendeskmate.generatedBy to "agent-user-instruction".`);
  blocks.push('Prefer creating new skills under the Managed (app) directory unless the user explicitly asks for workspace-specific skills.');
  blocks.push('Only active skills should be used by default. Deprecated/disabled skills are excluded unless user explicitly asks.');
  blocks.push('');
  blocks.push('Skill directories (create a folder with SKILL.md inside):');
  blocks.push(`- Managed (app): ${managedDir}`);
  if (workspaceDir) blocks.push(`- Workspace: ${workspaceDir}`);
  blocks.push('');
  if (!skills.length) {
    blocks.push(params?.userMessage ? '(No relevant skills selected for this task.)' : '(No skills installed yet.)');
    blocks.push('</skills>');
    return {
      prompt: blocks.join('\n'),
      selectedSkillIds: [],
    };
  }

  blocks.push('');

  for (const skill of skills) {
    try {
      const raw = fs.readFileSync(skill.filePath, 'utf8');
      const body = stripFrontMatter(raw).trim();
      const bodyLimited = body.length > SKILL_PROMPT_MAX_CHARS
        ? `${body.slice(0, SKILL_PROMPT_MAX_CHARS - 1).trim()}…`
        : body;
      const header = `## ${skill.name}${skill.description ? ` — ${skill.description}` : ''}`;
      blocks.push(header);
      if (skill.manifest) {
        blocks.push(`Version: ${skill.manifest.version} | State: ${skill.manifest.state}`);
      }
      blocks.push(bodyLimited);
      blocks.push('');
    } catch {
      continue;
    }
  }

  blocks.push('</skills>');
  return {
    prompt: blocks.join('\n'),
    selectedSkillIds: skills.map((skill) => skill.id),
  };
}

export function buildUserSkillsPrompt(params?: { agentId?: string; userMessage?: string; maxSkills?: number }): string {
  return buildUserSkillsPromptBundle(params).prompt;
}

export async function recordUserSkillRunBatch(params: {
  agentId?: string;
  skillIds: string[];
  success: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}): Promise<void> {
  const ids = Array.from(new Set((params.skillIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return;

  await Promise.all(
    ids.map(async (skillId) => {
      try {
        await recordUserSkillPerformance({
          skillId,
          success: params.success,
          latencyMs: params.latencyMs,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          error: params.error,
          agentId: params.agentId,
        });
      } catch (error) {
        console.warn(`[user-skills] Failed to record performance for ${skillId}:`, (error as Error)?.message || error);
      }
    })
  );
}

export function ensureUserSkillsWatcher(params?: { agentId?: string }): void {
  if (watcher) return;
  const managed = getManagedSkillsDir();
  const workspace = getWorkspaceSkillsDir(params?.agentId);
  const bundled = getBundledSkillsDir();
  const watchTargets = [managed, workspace, bundled].filter((d): d is string => Boolean(d && fs.existsSync(d)));
  if (watchTargets.length === 0) return;

  primeSkillSnapshots({ agentId: params?.agentId });

  const scheduleReconcile = () => {
    if (watcherTimer) clearTimeout(watcherTimer);
    watcherTimer = setTimeout(() => {
      watcherTimer = null;
      void reconcileUserSkillManifests({ agentId: params?.agentId });
      bumpVersion();
    }, 350);
  };

  const createWatchHandler = (root: string) => (_eventType: string, filename: string | Buffer | null) => {
    const relName = typeof filename === 'string' ? filename : (Buffer.isBuffer(filename) ? filename.toString('utf8') : '');
    const fullPath = relName ? path.join(root, relName) : root;
    if (shouldIgnoreWatchPath(fullPath)) return;
    scheduleReconcile();
  };

  // Note: fs.watch({recursive:true}) is supported on Windows and macOS.
  // For Linux this is best-effort; skills still refresh on next read.
  watcher = fs.watch(watchTargets[0], { recursive: true, encoding: 'utf8' }, createWatchHandler(watchTargets[0]));
  watcher.on('error', () => {});

  // If we have multiple targets, add additional watchers (non-recursive fallback).
  for (const extra of watchTargets.slice(1)) {
    try {
      const w = fs.watch(extra, { recursive: true, encoding: 'utf8' }, createWatchHandler(extra));
      w.on('error', () => {});
      extraWatchers.push(w);
    } catch {
      // ignore
    }
  }

  void reconcileUserSkillManifests({ agentId: params?.agentId });
  bumpVersion();
}

export function disposeUserSkillsWatcher(): void {
  if (watcherTimer) {
    clearTimeout(watcherTimer);
    watcherTimer = null;
  }
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
  }
  for (const extra of extraWatchers.splice(0)) {
    try {
      extra.close();
    } catch {
      // ignore
    }
  }
  reconcilePending = false;
  reconcileInFlight = false;
}

// Expose a small surface for unit tests without making these helpers part of the public app API.
export const __test = {
  sanitizeSkillId,
  scanSkillCandidates,
  resolveGithubZipUrl,
  hasBinary,
};
