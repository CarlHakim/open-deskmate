import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type {
  BuildWorkspaceBaselineCaptureResult,
  BuildWorkspaceBaselineDecision,
  BuildWorkspaceBaselineResolveResult,
  BuildWorkspaceDiffFile,
  BuildFileTreeNode,
  BuildWorkspaceFingerprint,
  BuildWorkspaceDiff,
  BuildWorkspaceFileContent,
} from '@accomplish/shared';

const DEFAULT_AGENT_WORKSPACES_ROOT = process.platform === 'win32'
  ? 'C:/agent-workspaces'
  : path.join(os.homedir(), 'agent-workspaces');

const SKIP_BASELINE_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
]);

const MAX_FILE_READ_BYTES = 2 * 1024 * 1024;
const MAX_BASELINE_FILES = 1200;
const MAX_BASELINE_FILE_BYTES = 512 * 1024;
const MAX_BASELINE_TOTAL_BYTES = 40 * 1024 * 1024;
const DIFF_PREVIEW_MAX_CHARS = 12_000;
const baselineSnapshots = new Map<string, WorkspaceBaselineSnapshot>();

interface WorkspaceBaselineSnapshot {
  id: string;
  agentId: string;
  workspaceRoot: string;
  workspaceRelativePath: string;
  createdAt: string;
  files: Map<string, BaselineFileRecord>;
  totalBytes: number;
}

interface BaselineFileRecord {
  content: string;
  truncated: boolean;
}

export function resolveAgentWorkspaceRoot(agentId: string): string {
  const normalizedAgentId = normalizeAgentId(agentId);
  const resolvedRoot = path.resolve(DEFAULT_AGENT_WORKSPACES_ROOT, normalizedAgentId);

  fs.mkdirSync(resolvedRoot, { recursive: true });
  return resolvedRoot;
}

export function resolvePathInWorkspace(agentId: string, relativePath = '.'): string {
  const root = resolveAgentWorkspaceRoot(agentId);
  return resolveInsideRoot(root, relativePath);
}

export async function listWorkspaceTree(
  agentId: string,
  relativePath = '.',
  options?: { depth?: number; includeHidden?: boolean; maxEntries?: number }
): Promise<BuildFileTreeNode> {
  const root = resolveAgentWorkspaceRoot(agentId);
  const absolute = resolveInsideRoot(root, relativePath);
  const stat = await fs.promises.stat(absolute);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${relativePath}`);
  }

  const depth = Math.max(1, Math.min(8, options?.depth ?? 4));
  const maxEntries = Math.max(100, Math.min(10_000, options?.maxEntries ?? 2_000));
  const includeHidden = options?.includeHidden !== false;
  const limiter = { count: 0, maxEntries };

  const node = await walkDirectory(root, absolute, depth, includeHidden, limiter);
  node.name = relativePath === '.' ? path.basename(root) || root : path.basename(absolute);
  node.relativePath = normalizePath(path.relative(root, absolute) || '.');
  return node;
}

export async function readWorkspaceFile(agentId: string, relativePath: string, workspaceRelativePath = '.'): Promise<BuildWorkspaceFileContent> {
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const scopedRelativePath = normalizeWorkspaceScopedRelativePath(relativePath, workspaceRelativePath);
  const absolute = resolveInsideRoot(workspaceRoot, scopedRelativePath);
  const stat = await fs.promises.stat(absolute);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${relativePath}`);
  }
  if (stat.size > MAX_FILE_READ_BYTES) {
    throw new Error(`File too large to open in editor (${Math.round(stat.size / 1024)} KB)`);
  }
  const content = await fs.promises.readFile(absolute, 'utf8');
  return {
    relativePath: normalizePath(relativePath),
    content,
    encoding: 'utf8',
    size: Buffer.byteLength(content, 'utf8'),
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function writeWorkspaceFile(agentId: string, relativePath: string, content: string, workspaceRelativePath = '.'): Promise<{ relativePath: string; size: number; modifiedAt: string }> {
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const scopedRelativePath = normalizeWorkspaceScopedRelativePath(relativePath, workspaceRelativePath);
  const absolute = resolveInsideRoot(workspaceRoot, scopedRelativePath);
  const parent = path.dirname(absolute);
  ensurePathInsideRoot(workspaceRoot, parent);

  await fs.promises.mkdir(parent, { recursive: true });
  await fs.promises.writeFile(absolute, content, 'utf8');
  const stat = await fs.promises.stat(absolute);

  return {
    relativePath: normalizePath(relativePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function createWorkspaceDirectory(agentId: string, relativePath: string, workspaceRelativePath = '.'): Promise<{ relativePath: string; createdAt: string }> {
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const scopedRelativePath = normalizeWorkspaceScopedRelativePath(relativePath, workspaceRelativePath);
  const absolute = resolveInsideRoot(workspaceRoot, scopedRelativePath);
  const root = resolveInsideRoot(workspaceRoot, '.');
  ensurePathInsideRoot(root, absolute);

  if (fs.existsSync(absolute)) {
    throw new Error(`Path already exists: ${relativePath}`);
  }

  await fs.promises.mkdir(absolute, { recursive: true });
  const stat = await fs.promises.stat(absolute);
  return {
    relativePath: normalizePath(relativePath),
    createdAt: stat.mtime.toISOString(),
  };
}

export async function createWorkspaceFile(agentId: string, relativePath: string, workspaceRelativePath = '.'): Promise<{ relativePath: string; size: number; modifiedAt: string }> {
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const scopedRelativePath = normalizeWorkspaceScopedRelativePath(relativePath, workspaceRelativePath);
  const absolute = resolveInsideRoot(workspaceRoot, scopedRelativePath);
  const parent = path.dirname(absolute);
  ensurePathInsideRoot(workspaceRoot, parent);

  if (fs.existsSync(absolute)) {
    throw new Error(`Path already exists: ${relativePath}`);
  }

  await fs.promises.mkdir(parent, { recursive: true });
  await fs.promises.writeFile(absolute, '', { encoding: 'utf8', flag: 'wx' });
  const stat = await fs.promises.stat(absolute);
  return {
    relativePath: normalizePath(relativePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function renameWorkspaceEntry(agentId: string, relativePath: string, nextName: string, workspaceRelativePath = '.'): Promise<{ relativePath: string; renamedPath: string }> {
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const scopedRelativePath = normalizeWorkspaceScopedRelativePath(relativePath, workspaceRelativePath);
  if (scopedRelativePath === '.') {
    throw new Error('The current workspace root cannot be renamed.');
  }
  const absolute = resolveInsideRoot(workspaceRoot, scopedRelativePath);
  const parent = path.dirname(absolute);
  const sanitizedNextName = path.basename(String(nextName || '').trim());

  if (!sanitizedNextName || sanitizedNextName === '.' || sanitizedNextName === '..') {
    throw new Error('Invalid name.');
  }

  const targetAbsolute = path.join(parent, sanitizedNextName);
  ensurePathInsideRoot(workspaceRoot, targetAbsolute);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Path not found: ${relativePath}`);
  }
  if (fs.existsSync(targetAbsolute)) {
    throw new Error(`Path already exists: ${sanitizedNextName}`);
  }

  await fs.promises.rename(absolute, targetAbsolute);
  const renamedScopedRelativePath = normalizePath(path.relative(workspaceRoot, targetAbsolute) || '.');
  const normalizedWorkspacePath = canonicalizeRelativePath(workspaceRelativePath || '.');
  const renamedPath = normalizedWorkspacePath === '.'
    ? renamedScopedRelativePath
    : normalizePath(`${normalizedWorkspacePath}/${renamedScopedRelativePath}`);

  return {
    relativePath: normalizePath(relativePath),
    renamedPath,
  };
}

export async function deleteWorkspaceEntry(agentId: string, relativePath: string, workspaceRelativePath = '.'): Promise<{ relativePath: string; ok: boolean }> {
  const workspaceRoot = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const scopedRelativePath = normalizeWorkspaceScopedRelativePath(relativePath, workspaceRelativePath);
  if (scopedRelativePath === '.') {
    throw new Error('The current workspace root cannot be deleted.');
  }
  const absolute = resolveInsideRoot(workspaceRoot, scopedRelativePath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Path not found: ${relativePath}`);
  }

  await fs.promises.rm(absolute, { recursive: true, force: false });
  return {
    relativePath: normalizePath(relativePath),
    ok: true,
  };
}

export async function pasteWorkspaceEntry(
  agentId: string,
  sourceRelativePath: string,
  destinationDirectoryRelativePath: string,
  mode: 'cut' | 'copy',
  sourceWorkspaceRelativePath = '.',
  destinationWorkspaceRelativePath = '.',
): Promise<{ sourceRelativePath: string; pastedPath: string; mode: 'cut' | 'copy' }> {
  const sourceWorkspaceRoot = resolvePathInWorkspace(agentId, sourceWorkspaceRelativePath);
  const destinationWorkspaceRoot = resolvePathInWorkspace(agentId, destinationWorkspaceRelativePath);
  const scopedSourceRelativePath = normalizeWorkspaceScopedRelativePath(sourceRelativePath, sourceWorkspaceRelativePath);
  const scopedDestinationDirectoryRelativePath = normalizeWorkspaceScopedRelativePath(destinationDirectoryRelativePath, destinationWorkspaceRelativePath);

  if (scopedSourceRelativePath === '.') {
    throw new Error('The current workspace root cannot be pasted.');
  }

  const sourceAbsolute = resolveInsideRoot(sourceWorkspaceRoot, scopedSourceRelativePath);
  const destinationDirectoryAbsolute = resolveInsideRoot(destinationWorkspaceRoot, scopedDestinationDirectoryRelativePath || '.');
  const sourceStat = await fs.promises.stat(sourceAbsolute);
  const destinationStat = await fs.promises.stat(destinationDirectoryAbsolute);

  if (!destinationStat.isDirectory()) {
    throw new Error('Paste target must be a folder.');
  }

  const sourceBaseName = path.basename(sourceAbsolute);
  const targetAbsolute = mode === 'copy'
    ? await resolveUniquePasteTargetAbsolutePath(destinationDirectoryAbsolute, sourceBaseName)
    : path.join(destinationDirectoryAbsolute, sourceBaseName);
  ensurePathInsideRoot(destinationWorkspaceRoot, targetAbsolute);

  if (mode !== 'copy' && fs.existsSync(targetAbsolute)) {
    throw new Error(`Path already exists: ${sourceBaseName}`);
  }

  const sourceRealPath = await fs.promises.realpath(sourceAbsolute);
  const targetParentRealPath = await fs.promises.realpath(destinationDirectoryAbsolute);
  const normalizedSourceRealPath = normalizePath(sourceRealPath);
  const normalizedTargetParentRealPath = normalizePath(targetParentRealPath);
  if (
    sourceStat.isDirectory()
    && (
      normalizedTargetParentRealPath === normalizedSourceRealPath
      || normalizedTargetParentRealPath.startsWith(`${normalizedSourceRealPath}/`)
    )
  ) {
    throw new Error('Cannot paste a folder into itself.');
  }

  if (mode === 'copy') {
    await fs.promises.cp(sourceAbsolute, targetAbsolute, { recursive: true, errorOnExist: true });
  } else {
    await fs.promises.rename(sourceAbsolute, targetAbsolute);
  }

  const pastedScopedRelativePath = normalizePath(path.relative(destinationWorkspaceRoot, targetAbsolute) || '.');
  const normalizedDestinationWorkspacePath = canonicalizeRelativePath(destinationWorkspaceRelativePath || '.');
  const pastedPath = normalizedDestinationWorkspacePath === '.'
    ? pastedScopedRelativePath
    : normalizePath(`${normalizedDestinationWorkspacePath}/${pastedScopedRelativePath}`);

  return {
    sourceRelativePath: normalizePath(sourceRelativePath),
    pastedPath,
    mode,
  };
}

async function resolveUniquePasteTargetAbsolutePath(destinationDirectoryAbsolute: string, sourceBaseName: string): Promise<string> {
  let candidateName = sourceBaseName;
  let candidateAbsolute = path.join(destinationDirectoryAbsolute, candidateName);
  if (!fs.existsSync(candidateAbsolute)) {
    return candidateAbsolute;
  }

  const parsed = path.parse(sourceBaseName);
  const baseName = parsed.ext ? parsed.name : sourceBaseName;
  const extension = parsed.ext || '';

  for (let index = 1; index < 10_000; index += 1) {
    candidateName = `${baseName} (${index})${extension}`;
    candidateAbsolute = path.join(destinationDirectoryAbsolute, candidateName);
    if (!fs.existsSync(candidateAbsolute)) {
      return candidateAbsolute;
    }
  }

  throw new Error(`Unable to find a duplicate name for: ${sourceBaseName}`);
}

function normalizeWorkspaceScopedRelativePath(relativePath: string, workspaceRelativePath: string): string {
  const normalizedRelativePath = canonicalizeRelativePath(relativePath || '.');
  const normalizedWorkspacePath = canonicalizeRelativePath(workspaceRelativePath || '.');

  if (
    normalizedWorkspacePath !== '.'
    && normalizedRelativePath !== normalizedWorkspacePath
    && normalizedRelativePath.startsWith(`${normalizedWorkspacePath}/`)
  ) {
    return normalizedRelativePath.slice(normalizedWorkspacePath.length + 1) || '.';
  }

  return normalizedRelativePath;
}

function canonicalizeRelativePath(input: string): string {
  const normalized = normalizePath(input || '.');
  const withoutLeadingDots = normalized.replace(/^\.\/+/, '');
  const collapsed = withoutLeadingDots.replace(/\/+/g, '/').replace(/\/$/, '');
  return collapsed || '.';
}

export async function exportWorkspaceZipToFile(
  window: BrowserWindow,
  agentId: string,
  relativePath = '.',
  suggestedName?: string
): Promise<{ ok: boolean; filePath?: string; cancelled?: boolean }> {
  const root = resolveAgentWorkspaceRoot(agentId);
  const sourceDir = resolveInsideRoot(root, relativePath);
  const sourceStat = await fs.promises.stat(sourceDir);
  if (!sourceStat.isDirectory()) {
    throw new Error('Can only export directories as zip archives.');
  }

  const defaultName = sanitizeFileName(suggestedName || `${normalizeAgentId(agentId)}-workspace.zip`);
  const saveResult = await dialog.showSaveDialog(window, {
    title: 'Export workspace as zip',
    defaultPath: path.join(os.homedir(), 'Downloads', defaultName),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, cancelled: true };
  }

  await createZipArchive(sourceDir, saveResult.filePath);
  return { ok: true, filePath: saveResult.filePath };
}

export async function readWorkspaceGitDiff(
  agentId: string,
  relativePath = '.',
  options?: { maxChars?: number; baselineId?: string }
): Promise<BuildWorkspaceDiff> {
  const root = resolveAgentWorkspaceRoot(agentId);
  const workspace = resolveInsideRoot(root, relativePath);
  const maxChars = Math.max(1_000, Math.min(500_000, options?.maxChars ?? 120_000));
  const requestedBaselineId = typeof options?.baselineId === 'string' ? options.baselineId.trim() : '';

  if (requestedBaselineId) {
    const synthetic = await readWorkspaceSyntheticDiff(agentId, workspace, relativePath, requestedBaselineId, maxChars);
    if (synthetic) return synthetic;
  }

  if (!fs.existsSync(path.join(workspace, '.git'))) {
    return {
      available: false,
      summary: 'No Git repository detected in this workspace.',
      patch: '',
      truncated: false,
      mode: 'none',
    };
  }

  const [statusResult, unstagedResult, stagedResult] = await Promise.all([
    runCommand('git', ['-C', workspace, 'status', '--short']),
    runCommand('git', ['-C', workspace, 'diff', '--no-color', '--']),
    runCommand('git', ['-C', workspace, 'diff', '--no-color', '--staged', '--']),
  ]);

  const summary = statusResult.stdout.trim() || 'No local changes.';
  const patchBody = [
    unstagedResult.stdout.trim(),
    stagedResult.stdout.trim(),
  ].filter(Boolean).join('\n\n');

  if (!patchBody) {
    return {
      available: true,
      summary,
      patch: '',
      truncated: false,
      mode: 'git',
    };
  }

  const truncated = patchBody.length > maxChars;
  return {
    available: true,
    summary,
    patch: truncated ? `${patchBody.slice(0, maxChars)}\n\n... [truncated]` : patchBody,
    truncated,
    mode: 'git',
  };
}

export async function captureWorkspaceBaseline(
  agentId: string,
  relativePath = '.'
): Promise<BuildWorkspaceBaselineCaptureResult> {
  pruneBaselineSnapshots();
  const root = resolveAgentWorkspaceRoot(agentId);
  const workspace = resolveInsideRoot(root, relativePath);
  const files = await collectTextFileSnapshot(workspace);
  const baselineId = randomUUID();
  const createdAt = new Date().toISOString();
  const snapshot: WorkspaceBaselineSnapshot = {
    id: baselineId,
    agentId: normalizeAgentId(agentId),
    workspaceRoot: workspace,
    workspaceRelativePath: normalizePath(relativePath),
    createdAt,
    files: files.entries,
    totalBytes: files.totalBytes,
  };
  baselineSnapshots.set(baselineId, snapshot);

  return {
    baselineId,
    capturedAt: createdAt,
    fileCount: snapshot.files.size,
    totalBytes: snapshot.totalBytes,
  };
}

export async function resolveWorkspaceBaseline(
  agentId: string,
  baselineId: string,
  decision: BuildWorkspaceBaselineDecision
): Promise<BuildWorkspaceBaselineResolveResult> {
  const normalizedAgentId = normalizeAgentId(agentId);
  const id = String(baselineId || '').trim();
  if (!id) {
    throw new Error('Invalid baseline id.');
  }
  const snapshot = baselineSnapshots.get(id);
  if (!snapshot) {
    throw new Error('Baseline snapshot not found.');
  }
  if (snapshot.agentId !== normalizedAgentId) {
    throw new Error('Baseline snapshot does not belong to this agent.');
  }

  if (decision === 'approve') {
    baselineSnapshots.delete(id);
    return {
      ok: true,
      baselineId: id,
      decision,
      message: 'Changes approved.',
    };
  }

  const current = await collectTextFileSnapshot(snapshot.workspaceRoot);
  let restoredFiles = 0;
  let deletedFiles = 0;

  const allPaths = new Set<string>([
    ...Array.from(snapshot.files.keys()),
    ...Array.from(current.entries.keys()),
  ]);

  for (const relative of allPaths) {
    const before = snapshot.files.get(relative);
    const after = current.entries.get(relative);
    const absolute = resolveInsideRoot(snapshot.workspaceRoot, relative);
    const parent = path.dirname(absolute);
    ensurePathInsideRoot(snapshot.workspaceRoot, parent);

    if (!before && after) {
      if (fs.existsSync(absolute)) {
        await fs.promises.rm(absolute, { force: true });
        deletedFiles += 1;
      }
      continue;
    }

    if (before && !after) {
      await fs.promises.mkdir(parent, { recursive: true });
      await fs.promises.writeFile(absolute, before.content, 'utf8');
      restoredFiles += 1;
      continue;
    }

    if (before && after && before.content !== after.content) {
      await fs.promises.mkdir(parent, { recursive: true });
      await fs.promises.writeFile(absolute, before.content, 'utf8');
      restoredFiles += 1;
    }
  }

  baselineSnapshots.delete(id);
  return {
    ok: true,
    baselineId: id,
    decision,
    restoredFiles,
    deletedFiles,
    message: 'Changes reverted to baseline.',
  };
}

export async function readWorkspaceFingerprint(
  agentId: string,
  relativePath = '.'
): Promise<BuildWorkspaceFingerprint> {
  const workspaceRoot = resolveAgentWorkspaceRoot(agentId);
  const absolute = resolveInsideRoot(workspaceRoot, relativePath);
  const stat = await fs.promises.stat(absolute);
  const projectRoot = stat.isDirectory() ? absolute : path.dirname(absolute);
  const normalizedRelativePath = normalizePath(path.relative(workspaceRoot, projectRoot) || '.');

  const packageJsonPath = path.join(projectRoot, 'package.json');
  let packageName: string | undefined;
  let packageVersion: string | undefined;
  let packageJsonDependencies: Record<string, unknown> | null = null;

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageRaw = await fs.promises.readFile(packageJsonPath, 'utf8');
      const parsed = JSON.parse(packageRaw) as {
        name?: unknown;
        version?: unknown;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      packageName = typeof parsed.name === 'string' ? parsed.name : undefined;
      packageVersion = typeof parsed.version === 'string' ? parsed.version : undefined;
      packageJsonDependencies = {
        ...(parsed.dependencies || {}),
        ...(parsed.devDependencies || {}),
      };
    } catch {
      packageName = undefined;
      packageVersion = undefined;
      packageJsonDependencies = null;
    }
  }

  const buildIdPath = path.join(projectRoot, '.next', 'BUILD_ID');
  const buildDirExists = fs.existsSync(path.join(projectRoot, '.next'));
  const buildId = fs.existsSync(buildIdPath)
    ? (await fs.promises.readFile(buildIdPath, 'utf8')).trim() || undefined
    : undefined;

  const isNextProject = [
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'next.config.cjs',
  ].some((fileName) => fs.existsSync(path.join(projectRoot, fileName)))
    || Boolean(packageJsonDependencies && Object.prototype.hasOwnProperty.call(packageJsonDependencies, 'next'));

  let gitAvailable = false;
  let gitBranch: string | undefined;
  let gitCommit: string | undefined;
  let gitShortCommit: string | undefined;
  let gitDirty: boolean | undefined;

  try {
    const probe = await runCommand('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree']);
    if (probe.exitCode === 0) {
      gitAvailable = true;
      const [branchResult, commitResult, shortCommitResult, statusResult] = await Promise.all([
        runCommand('git', ['-C', projectRoot, 'branch', '--show-current']),
        runCommand('git', ['-C', projectRoot, 'rev-parse', 'HEAD']),
        runCommand('git', ['-C', projectRoot, 'rev-parse', '--short', 'HEAD']),
        runCommand('git', ['-C', projectRoot, 'status', '--porcelain']),
      ]);

      gitBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined;
      gitCommit = commitResult.exitCode === 0 ? commitResult.stdout.trim() || undefined : undefined;
      gitShortCommit = shortCommitResult.exitCode === 0 ? shortCommitResult.stdout.trim() || undefined : undefined;
      gitDirty = statusResult.exitCode === 0 ? statusResult.stdout.trim().length > 0 : undefined;
    }
  } catch {
    gitAvailable = false;
  }

  return {
    workspaceRoot: projectRoot,
    workspaceRelativePath: normalizedRelativePath,
    generatedAt: new Date().toISOString(),
    packageName,
    packageVersion,
    git: {
      available: gitAvailable,
      branch: gitBranch,
      commit: gitCommit,
      shortCommit: gitShortCommit,
      dirty: gitDirty,
    },
    next: {
      isNextProject,
      buildDirExists,
      buildId,
    },
  };
}

function resolveInsideRoot(root: string, relativePath: string): string {
  const sanitizedRelativePath = normalizePath(relativePath || '.');
  if (sanitizedRelativePath.includes('\0')) {
    throw new Error('Invalid path.');
  }
  const target = path.resolve(root, sanitizedRelativePath);
  ensurePathInsideRoot(root, target);
  return target;
}

function ensurePathInsideRoot(root: string, target: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget === normalizedRoot) return;
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  if (!normalizedTarget.startsWith(prefix)) {
    throw new Error('Path traversal blocked: target is outside agent workspace.');
  }
}

async function walkDirectory(
  root: string,
  absoluteDir: string,
  depth: number,
  includeHidden: boolean,
  limiter: { count: number; maxEntries: number }
): Promise<BuildFileTreeNode> {
  const relativePath = normalizePath(path.relative(root, absoluteDir) || '.');
  const directoryNode: BuildFileTreeNode = {
    name: path.basename(absoluteDir),
    relativePath,
    type: 'directory',
    children: [],
  };

  if (depth <= 0 || limiter.count >= limiter.maxEntries) {
    return directoryNode;
  }

  const entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
  const filtered = entries
    .filter((entry) => {
      if (!includeHidden && entry.name.startsWith('.')) {
        return entry.name === '.env.example';
      }
      return true;
    })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  const directoryEntries: Array<{ entry: fs.Dirent; absoluteEntry: string; rel: string }> = [];

  for (const entry of filtered) {
    if (limiter.count >= limiter.maxEntries) break;
    const absoluteEntry = path.join(absoluteDir, entry.name);
    const rel = normalizePath(path.relative(root, absoluteEntry));

    if (entry.isDirectory()) {
      limiter.count += 1;
      directoryNode.children?.push({
        name: entry.name,
        relativePath: rel,
        type: 'directory',
        children: [],
      });
      directoryEntries.push({ entry, absoluteEntry, rel });
      continue;
    }

    const stat = await fs.promises.stat(absoluteEntry);
    limiter.count += 1;
    directoryNode.children?.push({
      name: entry.name,
      relativePath: rel,
      type: 'file',
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  for (const directoryEntry of directoryEntries) {
    if (limiter.count >= limiter.maxEntries) break;
    const child = await walkDirectory(root, directoryEntry.absoluteEntry, depth - 1, includeHidden, limiter);
    child.relativePath = directoryEntry.rel;
    const existingIndex = directoryNode.children?.findIndex((node) => (
      node.type === 'directory' && node.relativePath === directoryEntry.rel
    )) ?? -1;
    if (existingIndex >= 0 && directoryNode.children) {
      directoryNode.children[existingIndex] = child;
    } else {
      directoryNode.children?.push(child);
    }
  }

  return directoryNode;
}

function normalizeAgentId(agentId: string): string {
  const normalized = String(agentId || 'main')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'main';
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').trim() || '.';
}

function sanitizeFileName(input: string): string {
  const cleaned = input.replace(/[<>:"/\\|?*]+/g, '-').trim();
  if (cleaned.toLowerCase().endsWith('.zip')) return cleaned;
  return `${cleaned || 'workspace'}.zip`;
}

async function readWorkspaceSyntheticDiff(
  agentId: string,
  workspace: string,
  relativePath: string,
  baselineId: string,
  maxChars: number
): Promise<BuildWorkspaceDiff | null> {
  const snapshot = baselineSnapshots.get(baselineId);
  if (!snapshot) {
    return {
      available: false,
      summary: 'Pending baseline not found. Start a new AI run to capture a new baseline.',
      patch: '',
      truncated: false,
      mode: 'none',
      baselineId,
      needsApproval: false,
    };
  }

  if (snapshot.agentId !== normalizeAgentId(agentId)) {
    throw new Error('Baseline snapshot does not belong to this agent.');
  }

  if (snapshot.workspaceRoot !== workspace || snapshot.workspaceRelativePath !== normalizePath(relativePath)) {
    return {
      available: false,
      summary: 'Baseline does not match current workspace path. Start a new AI run for this folder.',
      patch: '',
      truncated: false,
      mode: 'none',
      baselineId,
      needsApproval: false,
    };
  }

  const current = await collectTextFileSnapshot(workspace);
  const diffFiles = buildSyntheticFileDiff(snapshot.files, current.entries);
  const hasChanges = diffFiles.length > 0;
  const summary = hasChanges ? summarizeSyntheticDiff(diffFiles) : 'No changes detected since baseline capture.';

  if (!hasChanges) {
    return {
      available: true,
      summary,
      patch: '',
      truncated: false,
      mode: 'synthetic',
      baselineId,
      files: [],
      needsApproval: false,
    };
  }

  const patch = renderSyntheticPatch(diffFiles, maxChars);
  return {
    available: true,
    summary,
    patch: patch.text,
    truncated: patch.truncated,
    mode: 'synthetic',
    baselineId,
    files: diffFiles,
    needsApproval: true,
  };
}

function buildSyntheticFileDiff(
  before: Map<string, BaselineFileRecord>,
  after: Map<string, BaselineFileRecord>
): BuildWorkspaceDiffFile[] {
  const allPaths = new Set<string>([...Array.from(before.keys()), ...Array.from(after.keys())]);
  const files: BuildWorkspaceDiffFile[] = [];

  for (const relativePath of Array.from(allPaths).sort((a, b) => a.localeCompare(b))) {
    const beforeEntry = before.get(relativePath);
    const afterEntry = after.get(relativePath);
    if (!beforeEntry && !afterEntry) continue;
    if (beforeEntry && afterEntry && beforeEntry.content === afterEntry.content) continue;

    const changeType: BuildWorkspaceDiffFile['changeType'] = !beforeEntry
      ? 'added'
      : !afterEntry
        ? 'deleted'
        : 'modified';

    files.push({
      relativePath,
      changeType,
      beforeContent: beforeEntry ? truncatePreview(beforeEntry.content) : undefined,
      afterContent: afterEntry ? truncatePreview(afterEntry.content) : undefined,
      beforeTruncated: beforeEntry ? beforeEntry.content.length > DIFF_PREVIEW_MAX_CHARS : false,
      afterTruncated: afterEntry ? afterEntry.content.length > DIFF_PREVIEW_MAX_CHARS : false,
    });
  }

  return files;
}

function summarizeSyntheticDiff(files: BuildWorkspaceDiffFile[]): string {
  const added = files.filter((entry) => entry.changeType === 'added').length;
  const modified = files.filter((entry) => entry.changeType === 'modified').length;
  const deleted = files.filter((entry) => entry.changeType === 'deleted').length;
  return `Synthetic diff: ${files.length} changed file${files.length === 1 ? '' : 's'} (${added} added, ${modified} modified, ${deleted} deleted).`;
}

function renderSyntheticPatch(
  files: BuildWorkspaceDiffFile[],
  maxChars: number
): { text: string; truncated: boolean } {
  const sections = files.map((entry) => {
    const before = truncatePreview(entry.beforeContent);
    const after = truncatePreview(entry.afterContent);
    const header = [
      `diff --synthetic a/${entry.relativePath} b/${entry.relativePath}`,
      `--- ${entry.changeType === 'added' ? '/dev/null' : `a/${entry.relativePath}`}`,
      `+++ ${entry.changeType === 'deleted' ? '/dev/null' : `b/${entry.relativePath}`}`,
      '@@ synthetic-preview @@',
    ];
    if (before) {
      header.push(`- ${before.replace(/\r?\n/g, '\n- ')}`);
    }
    if (after) {
      header.push(`+ ${after.replace(/\r?\n/g, '\n+ ')}`);
    }
    return header.join('\n');
  });

  const full = sections.join('\n\n');
  if (full.length <= maxChars) {
    return { text: full, truncated: false };
  }
  return {
    text: `${full.slice(0, maxChars)}\n\n... [truncated]`,
    truncated: true,
  };
}

async function collectTextFileSnapshot(
  workspaceRoot: string
): Promise<{ entries: Map<string, BaselineFileRecord>; totalBytes: number }> {
  const entries = new Map<string, BaselineFileRecord>();
  let totalBytes = 0;
  const queue: string[] = [workspaceRoot];

  while (queue.length > 0) {
    if (entries.size >= MAX_BASELINE_FILES || totalBytes >= MAX_BASELINE_TOTAL_BYTES) {
      break;
    }
    const currentDir = queue.shift();
    if (!currentDir) continue;
    const children = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const child of children) {
      if (entries.size >= MAX_BASELINE_FILES || totalBytes >= MAX_BASELINE_TOTAL_BYTES) {
        break;
      }
      if (child.name === '.env.example') {
        // allow
      } else if (child.name.startsWith('.')) {
        continue;
      }

      const absolute = path.join(currentDir, child.name);
      if (child.isDirectory()) {
        if (SKIP_BASELINE_DIRS.has(child.name)) continue;
        queue.push(absolute);
        continue;
      }
      if (!child.isFile()) continue;

      const relative = normalizePath(path.relative(workspaceRoot, absolute));
      if (!relative || relative === '.') continue;

      const stat = await fs.promises.stat(absolute);
      if (stat.size > MAX_BASELINE_FILE_BYTES) continue;

      const raw = await fs.promises.readFile(absolute);
      if (raw.includes(0)) continue;
      const text = raw.toString('utf8');
      entries.set(relative, {
        content: text,
        truncated: false,
      });
      totalBytes += Buffer.byteLength(text, 'utf8');
    }
  }

  return { entries, totalBytes };
}

function truncatePreview(content?: string): string {
  if (!content) return '';
  const normalized = content.replace(/\r\n/g, '\n');
  if (normalized.length <= DIFF_PREVIEW_MAX_CHARS) return normalized;
  return `${normalized.slice(0, DIFF_PREVIEW_MAX_CHARS)}\n... [preview truncated]`;
}

function pruneBaselineSnapshots(): void {
  const maxEntries = 24;
  if (baselineSnapshots.size <= maxEntries) return;
  const ordered = Array.from(baselineSnapshots.values())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const removeCount = Math.max(0, ordered.length - maxEntries);
  for (let i = 0; i < removeCount; i += 1) {
    baselineSnapshots.delete(ordered[i].id);
  }
}

async function createZipArchive(sourceDir: string, destinationPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const script = [
      `$src = '${escapePowerShell(sourceDir)}'`,
      `$dst = '${escapePowerShell(destinationPath)}'`,
      'if (Test-Path $dst) { Remove-Item $dst -Force }',
      'Compress-Archive -Path (Join-Path $src "*") -DestinationPath $dst -Force',
    ].join('; ');

    const result = await runCommand('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to create zip archive.');
    }
    return;
  }

  const result = await runCommand('zip', ['-r', '-q', destinationPath, '.'], { cwd: sourceDir });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to create zip archive.');
  }
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}
