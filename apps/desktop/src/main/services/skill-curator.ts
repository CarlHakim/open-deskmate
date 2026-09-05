import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  UserSkillCuratorAction,
  UserSkillCuratorFinding,
  UserSkillCuratorHistoryResponse,
  UserSkillCuratorRunRecord,
  UserSkillCuratorRunRequest,
  UserSkillEntry,
  UserSkillMetadata,
  UserSkillSource,
} from '@accomplish/shared';
import {
  getManagedSkillsDir,
  listUserSkills,
  setUserSkillLifecycle,
  writeUserSkillFile,
} from './user-skills';

const CURATOR_STORE_DIR = '.curator';
const CURATOR_HISTORY_FILE = 'history.json';
const MAX_CURATOR_HISTORY = 50;
const UNUSED_NEVER_USED_DAYS = 45;
const STALE_NEVER_USED_DAYS = 180;
const STALE_FAILED_ONLY_DAYS = 30;
const STALE_LAST_USED_DAYS = 240;

type SkillCuratorSnapshot = {
  entry: UserSkillEntry;
  raw: string;
  body: string;
  checksum: string;
  titleSignature: string;
};

function curatorHistoryPath(): string {
  return path.join(getManagedSkillsDir(), CURATOR_STORE_DIR, CURATOR_HISTORY_FILE);
}

function readCuratorHistory(): UserSkillCuratorRunRecord[] {
  const filePath = curatorHistoryPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { runs?: unknown };
    if (!Array.isArray(parsed.runs)) return [];
    return parsed.runs
      .filter((run): run is UserSkillCuratorRunRecord => Boolean(run && typeof run === 'object' && (run as UserSkillCuratorRunRecord).id))
      .slice(0, MAX_CURATOR_HISTORY);
  } catch {
    return [];
  }
}

function writeCuratorHistory(runs: UserSkillCuratorRunRecord[]): void {
  const filePath = curatorHistoryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ runs: runs.slice(0, MAX_CURATOR_HISTORY) }, null, 2),
    'utf8'
  );
}

function appendCuratorHistory(run: UserSkillCuratorRunRecord): void {
  writeCuratorHistory([run, ...readCuratorHistory().filter((entry) => entry.id !== run.id)]);
}

export function listUserSkillCuratorHistory(): UserSkillCuratorHistoryResponse {
  return {
    runs: readCuratorHistory(),
  };
}

function daysSince(iso: string | undefined, nowMs: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - ms) / 86_400_000);
}

function stripFrontMatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const lines = raw.split(/\r?\n/);
  const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIdx === -1) return raw;
  return lines.slice(endIdx + 1).join('\n');
}

function normalizeSignature(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !['the', 'and', 'for', 'with', 'from', 'this', 'that', 'skill', 'workflow'].includes(token))
    .join(' ')
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeSignature(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

function tokenSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function normalizedBodySignature(value: string): string {
  return normalizeSignature(
    String(value || '')
      .replace(/<[^>\n]{1,80}>/g, '<placeholder>')
      .replace(/`[^`\n]{1,120}`/g, '`value`')
      .replace(/\b\d+\b/g, '0')
  );
}

function skillEnvelope(metadata?: UserSkillMetadata): Record<string, unknown> {
  const env = metadata?.opendeskmate ?? metadata?.clawdbot;
  return env && typeof env === 'object' ? env as Record<string, unknown> : {};
}

function skillKeySignature(entry: UserSkillEntry): string {
  const env = skillEnvelope(entry.metadata);
  const raw = String(env.skillKey || '').trim();
  if (!raw) return '';
  return normalizeSignature(raw);
}

function isGeneratedSkill(entry: UserSkillEntry): boolean {
  const env = skillEnvelope(entry.metadata);
  const markers = [env.generatedBy, env.origin, env.createdBy]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  return markers.some((marker) =>
    marker.includes('task-save-skill')
    || marker.includes('hermes')
    || marker === 'agent-auto'
    || marker === 'agent_auto'
    || marker === 'agent-user-instruction'
  );
}

function findingId(type: UserSkillCuratorFinding['type'], entry: UserSkillEntry, suffix?: string): string {
  return [type, entry.source, entry.id, suffix].filter(Boolean).join(':');
}

function createSnapshot(entry: UserSkillEntry): SkillCuratorSnapshot | null {
  if (!fs.existsSync(entry.filePath)) return null;
  try {
    const raw = fs.readFileSync(entry.filePath, 'utf8');
    const body = stripFrontMatter(raw).trim();
    const checksum = entry.manifest?.checksum || '';
    const titleSignature = normalizeSignature(`${entry.name} ${entry.description || ''}`);
    return { entry, raw, body, checksum, titleSignature };
  } catch {
    return null;
  }
}

function hasWeakBody(snapshot: SkillCuratorSnapshot): boolean {
  const body = snapshot.body;
  if (body.length < 120) return true;
  const headingCount = (body.match(/^#{1,3}\s+\S.+$/gm) || []).length;
  if (headingCount < 1) return true;
  const hasWorkflowShape = /\b(when to use|inputs?|workflow|steps?|verification|fallbacks?|output format)\b/i.test(body);
  if (!hasWorkflowShape && body.length < 450) return true;
  const generated = isGeneratedSkill(snapshot.entry);
  if (generated && !/\b(inputs?|parameters?|placeholders?)\b/i.test(body) && !/<[^>\n]{2,80}>/.test(body)) {
    return true;
  }
  if (generated && !/\b(verify|verification|check|test|fallback)\b/i.test(body)) {
    return true;
  }
  return false;
}

function isClearlyUnused(entry: UserSkillEntry, nowMs: number): boolean {
  if (!entry.editable || entry.source !== 'managed') return false;
  if ((entry.manifest?.state ?? 'active') !== 'active') return false;
  if (!isGeneratedSkill(entry)) return false;
  const perf = entry.manifest?.performance;
  const updatedAge = daysSince(entry.manifest?.updatedAt ?? entry.manifest?.createdAt, nowMs);
  return (perf?.samples ?? 0) === 0 && updatedAge >= UNUSED_NEVER_USED_DAYS && updatedAge < STALE_NEVER_USED_DAYS;
}

function isClearlyStale(entry: UserSkillEntry, nowMs: number): boolean {
  if (!entry.editable || entry.source !== 'managed') return false;
  if ((entry.manifest?.state ?? 'active') !== 'active') return false;
  if (!isGeneratedSkill(entry)) return false;

  const perf = entry.manifest?.performance;
  const updatedAge = daysSince(entry.manifest?.updatedAt ?? entry.manifest?.createdAt, nowMs);
  const lastUsedAge = daysSince(perf?.lastUsedAt, nowMs);
  const samples = perf?.samples ?? 0;
  const successCount = perf?.successCount ?? 0;

  if (samples === 0 && updatedAge >= STALE_NEVER_USED_DAYS) return true;
  if (samples >= 3 && successCount === 0 && updatedAge >= STALE_FAILED_ONLY_DAYS) return true;
  if (samples > 0 && lastUsedAge >= STALE_LAST_USED_DAYS && updatedAge >= STALE_LAST_USED_DAYS) return true;
  return false;
}

export function analyzeSkillForCurator(
  snapshot: SkillCuratorSnapshot,
  nowMs = Date.now()
): UserSkillCuratorFinding[] {
  const { entry } = snapshot;
  const findings: UserSkillCuratorFinding[] = [];
  const validation = entry.manifest?.lastValidation;
  const lastTest = entry.manifest?.lastTest;
  const env = skillEnvelope(entry.metadata);

  if (!entry.metadata?.opendeskmate || !String(env.skillKey || '').trim()) {
    findings.push({
      id: findingId('metadata', entry),
      type: 'metadata',
      severity: 'info',
      skillId: entry.id,
      source: entry.source,
      message: 'Skill metadata can be normalized with an opendeskmate.skillKey.',
      evidence: [
        entry.metadata?.opendeskmate ? 'Missing opendeskmate.skillKey.' : 'Missing opendeskmate metadata envelope.',
      ],
    });
  }

  if (validation && !validation.ok) {
    findings.push({
      id: findingId('broken', entry, 'validation'),
      type: 'broken',
      severity: 'error',
      skillId: entry.id,
      source: entry.source,
      message: 'Skill manifest validation is failing.',
      evidence: validation.issues.slice(0, 5),
    });
  }

  if (lastTest && !lastTest.ok) {
    findings.push({
      id: findingId('broken', entry, 'test'),
      type: 'broken',
      severity: 'warning',
      skillId: entry.id,
      source: entry.source,
      message: 'Skill test is failing.',
      evidence: [lastTest.stderr || lastTest.stdout || 'Last test did not pass.'],
    });
  }

  if (hasWeakBody(snapshot)) {
    findings.push({
      id: findingId('weak', entry),
      type: 'weak',
      severity: 'warning',
      skillId: entry.id,
      source: entry.source,
      message: 'Skill body looks too thin or lacks reusable workflow structure.',
      evidence: [`Body length: ${snapshot.body.length} characters.`],
    });
  }

  if (isClearlyStale(entry, nowMs)) {
    const perf = entry.manifest?.performance;
    findings.push({
      id: findingId('stale', entry),
      type: 'stale',
      severity: 'warning',
      skillId: entry.id,
      source: entry.source,
      message: 'Generated skill appears stale and safe to archive.',
      evidence: [
        `Updated ${Math.round(daysSince(entry.manifest?.updatedAt ?? entry.manifest?.createdAt, nowMs))} days ago.`,
        `Samples: ${perf?.samples ?? 0}, successes: ${perf?.successCount ?? 0}.`,
      ],
    });
  } else if (isClearlyUnused(entry, nowMs)) {
    const updatedAge = daysSince(entry.manifest?.updatedAt ?? entry.manifest?.createdAt, nowMs);
    findings.push({
      id: findingId('unused', entry),
      type: 'unused',
      severity: 'info',
      skillId: entry.id,
      source: entry.source,
      message: 'Generated skill has not been used yet.',
      evidence: [
        `No recorded samples after ${Math.round(updatedAge)} days.`,
        'It is below the stale archive threshold, so it is only reported.',
      ],
    });
  }

  return findings;
}

function keepScore(snapshot: SkillCuratorSnapshot): number {
  const perf = snapshot.entry.manifest?.performance;
  return (
    (perf?.successCount ?? 0) * 10
    + (perf?.samples ?? 0)
    + (snapshot.entry.source === 'workspace' ? 4 : 0)
    + (snapshot.entry.source === 'bundled' ? 3 : 0)
    + (isGeneratedSkill(snapshot.entry) ? 0 : 5)
  );
}

export function detectDuplicateSkillFindings(snapshots: SkillCuratorSnapshot[]): UserSkillCuratorFinding[] {
  const findings: UserSkillCuratorFinding[] = [];
  const groups = new Map<string, SkillCuratorSnapshot[]>();
  for (const snapshot of snapshots) {
    const skillKey = skillKeySignature(snapshot.entry);
    const skillKeyKey = skillKey.length > 2 ? `skillKey:${skillKey}` : '';
    const checksumKey = snapshot.checksum ? `checksum:${snapshot.checksum}` : '';
    const titleKey = snapshot.titleSignature.length > 8 ? `title:${snapshot.titleSignature}` : '';
    const bodySignature = normalizedBodySignature(snapshot.body);
    const bodyKey = bodySignature.length > 80 ? `body:${bodySignature}` : '';
    for (const key of [skillKeyKey, checksumKey, bodyKey, titleKey].filter(Boolean)) {
      groups.set(key, [...(groups.get(key) || []), snapshot]);
    }
  }

  const seen = new Set<string>();
  const seenPairs = new Set<string>();
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => keepScore(b) - keepScore(a));
    const keeper = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      const id = findingId('duplicate', duplicate.entry, `${keeper.entry.source}:${keeper.entry.id}:${key}`);
      const pairKey = `${duplicate.entry.source}:${duplicate.entry.id}->${keeper.entry.source}:${keeper.entry.id}`;
      if (seenPairs.has(pairKey)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      seenPairs.add(pairKey);
      findings.push({
        id,
        type: 'duplicate',
        severity: key.startsWith('skillKey:') || key.startsWith('checksum:') ? 'warning' : 'info',
        skillId: duplicate.entry.id,
        source: duplicate.entry.source,
        duplicateOfSkillId: keeper.entry.id,
        message: key.startsWith('skillKey:')
          ? `Skill has the same workflow key as ${keeper.entry.id}.`
          : key.startsWith('checksum:') || key.startsWith('body:')
          ? `Skill is an exact duplicate of ${keeper.entry.id}.`
          : `Skill appears similar to ${keeper.entry.id}.`,
        evidence: [
          key.startsWith('skillKey:')
            ? 'Same opendeskmate.skillKey.'
            : key.startsWith('checksum:')
            ? 'Same manifest checksum.'
            : key.startsWith('body:')
              ? 'Same normalized skill body.'
              : 'Similar normalized name and description.',
          `Keeper source: ${keeper.entry.source}.`,
        ],
      });
    }
  }

  for (let leftIndex = 0; leftIndex < snapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshots.length; rightIndex += 1) {
      const left = snapshots[leftIndex];
      const right = snapshots[rightIndex];
      const titleScore = tokenSimilarity(left.titleSignature, right.titleSignature);
      const bodyScore = tokenSimilarity(normalizedBodySignature(left.body), normalizedBodySignature(right.body));
      if (titleScore < 0.75 || bodyScore < 0.65) continue;

      const [keeper, duplicate] = [left, right].sort((a, b) => keepScore(b) - keepScore(a));
      const id = findingId('duplicate', duplicate.entry, `${keeper.entry.source}:${keeper.entry.id}:similar:${leftIndex}:${rightIndex}`);
      const pairKey = `${duplicate.entry.source}:${duplicate.entry.id}->${keeper.entry.source}:${keeper.entry.id}`;
      if (seenPairs.has(pairKey)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      seenPairs.add(pairKey);
      findings.push({
        id,
        type: 'duplicate',
        severity: 'info',
        skillId: duplicate.entry.id,
        source: duplicate.entry.source,
        duplicateOfSkillId: keeper.entry.id,
        message: `Skill appears to overlap heavily with ${keeper.entry.id}.`,
        evidence: [
          `Title similarity: ${Math.round(titleScore * 100)}%.`,
          `Body similarity: ${Math.round(bodyScore * 100)}%.`,
          `Keeper source: ${keeper.entry.source}.`,
        ],
      });
    }
  }

  return findings;
}

function splitFrontMatter(raw: string): { frontMatterLines: string[]; body: string; hasFrontMatter: boolean } {
  const lines = String(raw || '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { frontMatterLines: [], body: raw, hasFrontMatter: false };
  const endIdx = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIdx === -1) return { frontMatterLines: [], body: raw, hasFrontMatter: false };
  return {
    frontMatterLines: lines.slice(1, endIdx),
    body: lines.slice(endIdx + 1).join('\n'),
    hasFrontMatter: true,
  };
}

function stripMetadataLines(frontMatterLines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < frontMatterLines.length; i += 1) {
    const line = frontMatterLines[i] ?? '';
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match || /^\s/.test(line)) {
      out.push(line);
      continue;
    }
    if (String(match[1] || '').trim().toLowerCase() !== 'metadata') {
      out.push(line);
      continue;
    }
    if (String(match[2] || '').trim() === '|' || String(match[2] || '').trim() === '>') {
      i += 1;
      while (i < frontMatterLines.length) {
        const next = frontMatterLines[i] ?? '';
        if (!next.trim() || /^\s/.test(next)) {
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

function upsertCuratorMetadata(raw: string, entry: UserSkillEntry, runId: string, nowIso: string, findingTypes: string[]): string {
  const split = splitFrontMatter(raw);
  const cleanFrontMatter = stripMetadataLines(split.frontMatterLines);
  const legacy = entry.metadata?.clawdbot ?? {};
  const current = entry.metadata?.opendeskmate ?? {};
  const nextMetadata: UserSkillMetadata = {
    ...entry.metadata,
    opendeskmate: {
      ...legacy,
      ...current,
      skillKey: current.skillKey || legacy.skillKey || entry.id,
      curator: {
        ...(current.curator ?? {}),
        lastRunId: runId,
        lastReviewedAt: nowIso,
        findingTypes,
      },
    },
  };
  const metadataLines = [
    'metadata: |',
    ...JSON.stringify(nextMetadata, null, 2).split('\n').map((line) => `  ${line}`),
  ];
  return [
    '---',
    ...cleanFrontMatter,
    ...metadataLines,
    '---',
    split.hasFrontMatter ? split.body.replace(/^\n+/, '') : raw,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function canArchiveFinding(snapshot: SkillCuratorSnapshot, finding: UserSkillCuratorFinding): boolean {
  if (!snapshot.entry.editable || snapshot.entry.source !== 'managed') return false;
  if ((snapshot.entry.manifest?.state ?? 'active') !== 'active') return false;
  if (!isGeneratedSkill(snapshot.entry)) return false;
  if (finding.type === 'stale') return true;
  if (finding.type === 'duplicate') {
    return finding.severity === 'warning' && finding.evidence.some((line) =>
      /same manifest checksum/i.test(line)
      || /same opendeskmate\.skillKey/i.test(line)
    );
  }
  return false;
}

function optionalConfidence(value: unknown): number | undefined {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return undefined;
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function automationMetadata(entry: UserSkillEntry): Record<string, unknown> {
  const env = skillEnvelope(entry.metadata);
  const automation = env.automation;
  return automation && typeof automation === 'object' && !Array.isArray(automation)
    ? automation as Record<string, unknown>
    : {};
}

function curatorActionLinks(entry: UserSkillEntry, runId?: string): Partial<UserSkillCuratorAction> {
  const automation = automationMetadata(entry);
  const versions = entry.manifest?.versions || [];
  const latestRollback = versions[versions.length - 1];
  const sourceTaskId =
    String(entry.manifest?.lastChange?.sourceTaskId || '').trim()
    || String(automation.sourceTaskId || '').trim()
    || undefined;
  const confidence =
    entry.manifest?.lastChange?.confidence !== undefined
      ? optionalConfidence(entry.manifest.lastChange.confidence)
      : optionalConfidence(automation.confidence);

  return {
    historyRunId: runId,
    sourceTaskId,
    confidence,
    currentVersion: entry.manifest?.version,
    rollbackVersion: latestRollback?.version,
    rollbackRelPath: latestRollback?.relPath,
  };
}

export async function runUserSkillCurator(req: UserSkillCuratorRunRequest = {}): Promise<UserSkillCuratorRunRecord> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const report = listUserSkills({ agentId: req.agentId });
  const snapshots = report.skills
    .map(createSnapshot)
    .filter((snapshot): snapshot is SkillCuratorSnapshot => Boolean(snapshot));

  const findings = [
    ...snapshots.flatMap((snapshot) => analyzeSkillForCurator(snapshot, Date.parse(startedAt))),
    ...detectDuplicateSkillFindings(snapshots),
  ];
  const actions: UserSkillCuratorAction[] = [];
  const snapshotsByKey = new Map(snapshots.map((snapshot) => [`${snapshot.entry.source}:${snapshot.entry.id}`, snapshot]));
  const acted = new Set<string>();

  for (const snapshot of snapshots) {
    const relatedFindings = findings.filter((finding) => finding.skillId === snapshot.entry.id && finding.source === snapshot.entry.source);
    const metadataFinding = relatedFindings.find((finding) => finding.type === 'metadata');
    if (metadataFinding && snapshot.entry.editable && snapshot.entry.source !== 'bundled') {
      const links = curatorActionLinks(snapshot.entry, runId);
      const action: UserSkillCuratorAction = {
        id: randomUUID(),
        type: 'metadata-updated',
        skillId: snapshot.entry.id,
        source: snapshot.entry.source,
        applied: false,
        message: `Normalized metadata for ${snapshot.entry.id}.`,
        findingIds: [metadataFinding.id],
        reason: metadataFinding.message,
        changeSource: 'skill-curator',
        ...links,
      };
      if (!req.dryRun) {
        try {
          const writeResult = await writeUserSkillFile({
            skillId: snapshot.entry.id,
            relPath: 'SKILL.md',
            content: upsertCuratorMetadata(
              snapshot.raw,
              snapshot.entry,
              runId,
              startedAt,
              relatedFindings.map((finding) => finding.type)
            ),
            source: snapshot.entry.source,
            agentId: req.agentId,
            changeReason: metadataFinding.message,
            sourceTaskId: links.sourceTaskId,
            confidence: links.confidence,
            changeSource: 'skill-curator',
          });
          Object.assign(action, curatorActionLinks({
            ...snapshot.entry,
            manifest: writeResult.manifest ?? snapshot.entry.manifest,
          }, runId));
          action.applied = true;
        } catch (error) {
          action.message = `Could not normalize metadata for ${snapshot.entry.id}: ${(error as Error)?.message || error}`;
        }
      }
      actions.push(action);
    }
  }

  for (const finding of findings) {
    if (finding.type !== 'stale' && finding.type !== 'duplicate') continue;
    const snapshot = snapshotsByKey.get(`${finding.source}:${finding.skillId}`);
    if (!snapshot || !canArchiveFinding(snapshot, finding)) continue;
    if (acted.has(`${finding.source}:${finding.skillId}`)) continue;
    acted.add(`${finding.source}:${finding.skillId}`);

    const links = curatorActionLinks(snapshot.entry, runId);
    const action: UserSkillCuratorAction = {
      id: randomUUID(),
      type: finding.type === 'stale' ? 'archived-stale' : 'archived-duplicate',
      skillId: finding.skillId,
      source: finding.source,
      applied: false,
      message: finding.type === 'stale'
        ? `Archived stale generated skill ${finding.skillId}.`
        : `Archived duplicate generated skill ${finding.skillId}.`,
      findingIds: [finding.id],
      reason: finding.message,
      duplicateOfSkillId: finding.duplicateOfSkillId,
      changeSource: 'skill-curator',
      ...links,
    };
    if (!req.dryRun) {
      try {
        const lifecycleResult = await setUserSkillLifecycle({
          skillId: finding.skillId,
          state: 'deprecated',
          reason: finding.type === 'stale'
            ? 'Archived by skill curator: stale generated skill.'
            : `Archived by skill curator: duplicate of ${finding.duplicateOfSkillId || 'another skill'}.`,
          source: finding.source as UserSkillSource,
          agentId: req.agentId,
          sourceTaskId: links.sourceTaskId,
          confidence: links.confidence,
          changeSource: 'skill-curator',
        });
        Object.assign(action, curatorActionLinks({
          ...snapshot.entry,
          manifest: lifecycleResult.manifest ?? snapshot.entry.manifest,
        }, runId));
        action.applied = true;
      } catch (error) {
        action.message = `Could not archive ${finding.skillId}: ${(error as Error)?.message || error}`;
      }
    }
    actions.push(action);
  }

  const nonAppliedFindings = findings.filter((finding) =>
    !actions.some((action) => action.findingIds.includes(finding.id))
  );
  for (const finding of nonAppliedFindings) {
    const snapshot = snapshotsByKey.get(`${finding.source}:${finding.skillId}`);
    actions.push({
      id: randomUUID(),
      type: 'reported',
      skillId: finding.skillId,
      source: finding.source,
      applied: false,
      message: finding.message,
      findingIds: [finding.id],
      reason: finding.evidence[0] || finding.message,
      duplicateOfSkillId: finding.duplicateOfSkillId,
      changeSource: 'skill-curator',
      ...(snapshot ? curatorActionLinks(snapshot.entry, runId) : { historyRunId: runId }),
    });
  }

  const record: UserSkillCuratorRunRecord = {
    id: runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    agentId: req.agentId,
    dryRun: req.dryRun === true,
    scanned: snapshots.length,
    findings,
    actions,
  };
  appendCuratorHistory(record);
  return record;
}

export const __curatorTest = {
  analyzeSkillForCurator,
  curatorActionLinks,
  detectDuplicateSkillFindings,
  isClearlyStale,
  isClearlyUnused,
  normalizedBodySignature,
  normalizeSignature,
};
