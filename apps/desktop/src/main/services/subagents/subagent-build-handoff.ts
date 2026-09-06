import type {
  BuildGitSummary,
  BuildWorkspaceDiff,
  SubagentBuildHandoffBundle,
  SubagentBuildHandoffChangedFile,
  SubagentRunRecord,
} from '@accomplish/shared';
import { captureWorkspaceBaseline, readWorkspaceGitDiff } from '../build-mode/file-service';
import { readBuildGitSummary } from '../build-mode/git-service';
import { pathsOverlap } from './subagent-ownership';

const HANDOFF_DIFF_MAX_CHARS = 160_000;
const HANDOFF_PROMPT_PATCH_MAX_CHARS = 40_000;
const HANDOFF_STORE_PATCH_MAX_CHARS = 80_000;
const HANDOFF_MAX_FILES = 80;

function normalizeWorkspaceRelativePath(value: string | undefined): string {
  const trimmed = String(value || '').trim();
  return trimmed || '.';
}

function truncateText(value: string | undefined, limit: number): { text?: string; truncated: boolean } {
  const normalized = String(value || '').trim();
  if (!normalized) return { text: undefined, truncated: false };
  if (normalized.length <= limit) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, limit).trimEnd()}\n\n... [handoff excerpt truncated]`, truncated: true };
}

function mapGitSummary(summary?: BuildGitSummary): SubagentBuildHandoffBundle['gitSummary'] {
  if (!summary) return undefined;
  return {
    isRepository: summary.isRepository,
    branch: summary.branch,
    remoteName: summary.remoteName,
    remoteUrl: summary.remoteUrl,
    upstream: summary.upstream,
    dirty: summary.dirty,
    syncStatus: summary.syncStatus,
    ahead: summary.ahead,
    behind: summary.behind,
    changedFileCount: summary.changedFileCount,
    stagedCount: summary.stagedCount,
    unstagedCount: summary.unstagedCount,
    untrackedCount: summary.untrackedCount,
    totalAddedLines: summary.totalAddedLines,
    totalDeletedLines: summary.totalDeletedLines,
  };
}

function parsePatchFiles(patch: string): SubagentBuildHandoffChangedFile[] {
  const files = new Map<string, SubagentBuildHandoffChangedFile>();
  let currentPath = '';
  for (const line of patch.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      currentPath = diffMatch[2] || diffMatch[1] || '';
      if (currentPath && !files.has(currentPath)) {
        files.set(currentPath, { relativePath: currentPath, changeType: 'modified', addedLines: 0, deletedLines: 0 });
      }
      continue;
    }
    if (!currentPath) continue;
    const entry = files.get(currentPath);
    if (!entry) continue;
    if (line.startsWith('new file mode')) entry.changeType = 'added';
    if (line.startsWith('deleted file mode')) entry.changeType = 'deleted';
    if (line.startsWith('+') && !line.startsWith('+++')) entry.addedLines = (entry.addedLines || 0) + 1;
    if (line.startsWith('-') && !line.startsWith('---')) entry.deletedLines = (entry.deletedLines || 0) + 1;
  }
  return Array.from(files.values());
}

function mergeChangedFiles(params: {
  diff?: BuildWorkspaceDiff;
  gitSummary?: BuildGitSummary;
}): SubagentBuildHandoffChangedFile[] {
  const files = new Map<string, SubagentBuildHandoffChangedFile>();

  for (const file of params.diff?.files || []) {
    files.set(file.relativePath, {
      relativePath: file.relativePath,
      changeType: file.changeType,
      beforeTruncated: file.beforeTruncated,
      afterTruncated: file.afterTruncated,
    });
  }

  for (const file of parsePatchFiles(params.diff?.patch || '')) {
    files.set(file.relativePath, {
      ...(files.get(file.relativePath) || {}),
      ...file,
    });
  }

  for (const file of params.gitSummary?.files || []) {
    const existing = files.get(file.relativePath);
    files.set(file.relativePath, {
      ...(existing || {}),
      relativePath: file.relativePath,
      changeType: file.status,
      addedLines: file.addedLines,
      deletedLines: file.deletedLines,
      beforeTruncated: existing?.beforeTruncated,
      afterTruncated: existing?.afterTruncated,
    });
  }

  return Array.from(files.values())
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .slice(0, HANDOFF_MAX_FILES);
}

function summarizeFiles(files: SubagentBuildHandoffChangedFile[]): string {
  if (files.length === 0) return 'No changed files detected.';
  const added = files.reduce((sum, file) => sum + (file.addedLines || 0), 0);
  const deleted = files.reduce((sum, file) => sum + (file.deletedLines || 0), 0);
  const lineSummary = added || deleted ? `, +${added} -${deleted}` : '';
  return `${files.length} changed file${files.length === 1 ? '' : 's'}${lineSummary}.`;
}

function formatFileLine(file: SubagentBuildHandoffChangedFile): string {
  const stats = typeof file.addedLines === 'number' || typeof file.deletedLines === 'number'
    ? ` (+${file.addedLines || 0} -${file.deletedLines || 0})`
    : '';
  const truncated = file.beforeTruncated || file.afterTruncated ? ' [content preview truncated]' : '';
  return `- ${file.relativePath} (${file.changeType})${stats}${truncated}`;
}

export async function captureSubagentBuildHandoffBaseline(params: {
  workspaceAgentId: string;
  workspaceRelativePath?: string;
  reason?: string;
}): Promise<SubagentBuildHandoffBundle | undefined> {
  const workspaceAgentId = String(params.workspaceAgentId || '').trim();
  if (!workspaceAgentId) return undefined;
  const workspaceRelativePath = normalizeWorkspaceRelativePath(params.workspaceRelativePath);
  try {
    const baseline = await captureWorkspaceBaseline(workspaceAgentId, workspaceRelativePath);
    return {
      workspaceAgentId,
      workspaceRelativePath,
      baselineId: baseline.baselineId,
      baselineCapturedAt: baseline.capturedAt,
      baselineFileCount: baseline.fileCount,
      baselineTotalBytes: baseline.totalBytes,
      baselineAvailable: true,
      reason: params.reason,
    };
  } catch (error) {
    return {
      workspaceAgentId,
      workspaceRelativePath,
      baselineAvailable: false,
      baselineUnavailableReason: error instanceof Error ? error.message : 'Unable to capture Build workspace baseline.',
      reason: params.reason,
    };
  }
}

export async function generateSubagentBuildHandoffBundle(
  run: Pick<SubagentRunRecord, 'buildHandoff' | 'parentAgentId' | 'ownedPaths'>,
  reason?: string
): Promise<SubagentBuildHandoffBundle | undefined> {
  const existing = run.buildHandoff;
  if (!existing?.workspaceAgentId) return undefined;
  const workspaceAgentId = existing.workspaceAgentId;
  const workspaceRelativePath = normalizeWorkspaceRelativePath(existing.workspaceRelativePath);
  let diff: BuildWorkspaceDiff | undefined;
  let baselineUnavailableReason = existing.baselineUnavailableReason;

  try {
    diff = await readWorkspaceGitDiff(workspaceAgentId, workspaceRelativePath, {
      baselineId: existing.baselineId,
      maxChars: HANDOFF_DIFF_MAX_CHARS,
    });
  } catch (error) {
    baselineUnavailableReason = error instanceof Error ? error.message : 'Unable to read Build workspace diff.';
  }

  if (!diff && existing.baselineId) {
    try {
      diff = await readWorkspaceGitDiff(workspaceAgentId, workspaceRelativePath, {
        maxChars: HANDOFF_DIFF_MAX_CHARS,
      });
    } catch (error) {
      baselineUnavailableReason = error instanceof Error ? error.message : baselineUnavailableReason;
    }
  }

  let gitSummary: BuildGitSummary | undefined;
  try {
    gitSummary = await readBuildGitSummary(workspaceAgentId, workspaceRelativePath, { lightweight: true });
  } catch {
    gitSummary = undefined;
  }

  const changedFiles = mergeChangedFiles({ diff, gitSummary });
  const unassignedChangedPaths = run.ownedPaths?.length
    ? changedFiles.filter(file => !run.ownedPaths!.some(owned => pathsOverlap(owned, file.relativePath))).map(file => file.relativePath)
    : [];
  const patch = truncateText(diff?.patch, HANDOFF_STORE_PATCH_MAX_CHARS);
  const generatedAt = new Date().toISOString();

  return {
    ...existing,
    workspaceAgentId,
    workspaceRelativePath,
    baselineAvailable: existing.baselineAvailable !== false && Boolean(existing.baselineId),
    baselineUnavailableReason,
    diffMode: diff?.mode,
    diffAvailable: diff?.available,
    diffSummary: diff?.summary || summarizeFiles(changedFiles),
    changedFiles,
    unassignedChangedPaths,
    patchExcerpt: patch.text,
    patchTruncated: Boolean(diff?.truncated || patch.truncated),
    gitSummary: mapGitSummary(gitSummary),
    generatedAt,
    reason: reason || existing.reason,
  };
}

export function formatBuildHandoffForPrompt(bundle?: SubagentBuildHandoffBundle): string {
  if (!bundle?.workspaceAgentId) return '';
  const files = bundle.changedFiles || [];
  const fileLines = files.slice(0, 40).map(formatFileLine);
  const omitted = files.length > 40 ? `\n- ... ${files.length - 40} more changed files omitted from this prompt. Inspect the workspace diff before editing.` : '';
  const git = bundle.gitSummary;
  const gitLines = git
    ? [
      `Git: ${git.isRepository ? 'repository detected' : 'no repository'}; branch ${git.branch || 'unknown'}; ${git.dirty ? 'dirty' : 'clean'}; ${git.syncStatus}; ahead ${git.ahead}, behind ${git.behind}.`,
      `Git changes: ${git.changedFileCount} files, staged ${git.stagedCount}, unstaged ${git.unstagedCount}, untracked ${git.untrackedCount}, +${git.totalAddedLines} -${git.totalDeletedLines}.`,
    ]
    : [];
  const patch = truncateText(bundle.patchExcerpt, HANDOFF_PROMPT_PATCH_MAX_CHARS);
  return [
    'Build handoff from previous child run:',
    'This diff covers the shared workspace and may include changes by the parent or other children. Verify authorship and tests before incorporating it.',
    ...(bundle.unassignedChangedPaths?.length ? [`Changes outside this child assignment: ${bundle.unassignedChangedPaths.join(', ')}`] : []),
    `Workspace agent: ${bundle.workspaceAgentId}`,
    `Workspace relative path: ${bundle.workspaceRelativePath || '.'}`,
    bundle.baselineId
      ? `Baseline captured before previous child started: ${bundle.baselineId}${bundle.baselineCapturedAt ? ` at ${bundle.baselineCapturedAt}` : ''}`
      : 'No pre-child baseline is available; inspect Git/workspace state before editing.',
    bundle.baselineUnavailableReason ? `Baseline/diff note: ${bundle.baselineUnavailableReason}` : '',
    bundle.diffSummary ? `Diff summary: ${bundle.diffSummary}` : '',
    ...gitLines,
    fileLines.length > 0 ? ['Changed files to inspect first:', ...fileLines].join('\n') + omitted : 'No changed files were detected in the handoff.',
    patch.text ? `Patch excerpt:\n${patch.text}` : '',
    patch.truncated || bundle.patchTruncated
      ? 'The patch excerpt is truncated. Use file/diff tools to inspect the full inherited edits before making more changes.'
      : '',
    '',
    'Replacement instruction: inspect the inherited edits first, keep any useful completed code, finish incomplete work, and avoid overwriting prior child changes unless they are wrong.',
  ].filter(Boolean).join('\n');
}
