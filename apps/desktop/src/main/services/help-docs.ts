import { app, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import type {
  HelpDocPageResponse,
  HelpDocsIndexFile,
  HelpDocSummary,
  HelpDocsListResponse,
  HelpDocsSearchResponse,
  HelpDocsSearchResult,
  HelpDocsUpdatedEvent,
} from '@accomplish/shared';

const HELP_DIR_NAME = 'help';
const HELP_DEFAULTS_DIR_NAME = 'help-defaults';
const HELP_INDEX_FILE = 'index.json';
const HELP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HELP_MAX_ASSET_BYTES = 8 * 1024 * 1024;

let helpWatcher: fs.FSWatcher | null = null;
let pendingEmitTimer: NodeJS.Timeout | null = null;
const helpChangeListeners = new Set<(event: HelpDocsUpdatedEvent) => void>();

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function fromPosixPath(value: string): string {
  return value.split('/').join(path.sep);
}

function toHelpIdFromFile(filePath: string): string {
  const base = path.posix.basename(filePath, path.posix.extname(filePath));
  const normalized = base.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'help';
}

function dedupeDocIds(docs: Array<Omit<HelpDocSummary, 'order'>>): HelpDocSummary[] {
  const used = new Set<string>();
  return docs.map((doc, index) => {
    let id = doc.id;
    if (!HELP_ID_RE.test(id)) {
      id = toHelpIdFromFile(doc.file);
    }
    let candidate = id;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${id}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return { ...doc, id: candidate, order: index };
  });
}

function isSubPath(rootDir: string, resolvedPath: string): boolean {
  const relative = path.relative(rootDir, resolvedPath);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative) || resolvedPath === rootDir;
}

function resolveInsideHelpRoot(helpRoot: string, relativePath: string): string {
  const sanitized = toPosixPath(relativePath).trim();
  if (!sanitized) {
    throw new Error('Path is required');
  }
  if (path.isAbsolute(sanitized)) {
    throw new Error('Absolute paths are not allowed');
  }
  const resolved = path.resolve(helpRoot, fromPosixPath(sanitized));
  if (!isSubPath(helpRoot, resolved)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function getDefaultsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, HELP_DEFAULTS_DIR_NAME);
  }
  return path.join(app.getAppPath(), 'resources', HELP_DEFAULTS_DIR_NAME);
}

export function getHelpDocsRootDir(): string {
  return path.join(app.getPath('userData'), HELP_DIR_NAME);
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFilesRecursively(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const output: string[] = [];
  const walk = (dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.isFile()) {
        output.push(abs);
      }
    }
  };
  walk(rootDir);
  return output;
}

function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeIndexDocs(value: unknown): HelpDocsIndexFile['docs'] {
  if (!value || typeof value !== 'object') return [];
  const docs = (value as HelpDocsIndexFile).docs;
  if (!Array.isArray(docs)) return [];
  return docs
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id.trim() : '',
      title: typeof entry.title === 'string' ? entry.title.trim() : '',
      file: typeof entry.file === 'string' ? toPosixPath(entry.file.trim()) : '',
      description: typeof entry.description === 'string' ? entry.description.trim() : undefined,
    }))
    .filter((entry) => entry.title && entry.file);
}

function mergeDefaultIndexIntoUserIndex(helpRoot: string, defaultsDir: string): void {
  const sourceIndexPath = path.join(defaultsDir, HELP_INDEX_FILE);
  const destIndexPath = path.join(helpRoot, HELP_INDEX_FILE);
  if (!fs.existsSync(sourceIndexPath) || !fs.existsSync(destIndexPath)) {
    return;
  }

  const sourceParsed = readJsonFile(sourceIndexPath);
  const destParsed = readJsonFile(destIndexPath);
  if (!sourceParsed || !destParsed || typeof sourceParsed !== 'object' || typeof destParsed !== 'object') {
    return;
  }

  const sourceDocs = normalizeIndexDocs(sourceParsed);
  const destDocs = normalizeIndexDocs(destParsed);
  if (sourceDocs.length === 0 || destDocs.length === 0) {
    return;
  }

  const existingById = new Set(destDocs.map((doc) => doc.id.toLowerCase()));
  const existingByFile = new Set(destDocs.map((doc) => doc.file.toLowerCase()));
  const additional = sourceDocs.filter((doc) => {
    const id = doc.id.toLowerCase();
    const file = doc.file.toLowerCase();
    return !existingById.has(id) && !existingByFile.has(file);
  });

  if (additional.length === 0) {
    return;
  }

  const merged = {
    ...(destParsed as Record<string, unknown>),
    docs: [...destDocs, ...additional],
  } as HelpDocsIndexFile;

  if (!sanitizeEmbeddedSiteUrl((merged as HelpDocsIndexFile).embeddedSiteUrl)) {
    const sourceUrl = sanitizeEmbeddedSiteUrl((sourceParsed as HelpDocsIndexFile).embeddedSiteUrl);
    if (sourceUrl) {
      merged.embeddedSiteUrl = sourceUrl;
    }
  }

  try {
    fs.writeFileSync(destIndexPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  } catch (error) {
    console.warn('[HelpDocs] Failed to merge default index entries:', error);
  }
}

function copyDefaultHelpFilesIfMissing(helpRoot: string): void {
  const defaultsDir = getDefaultsDir();
  if (!fs.existsSync(defaultsDir)) {
    return;
  }

  ensureDirectory(helpRoot);
  const sourceFiles = listFilesRecursively(defaultsDir);
  for (const sourceFile of sourceFiles) {
    const relative = path.relative(defaultsDir, sourceFile);
    const destination = path.join(helpRoot, relative);
    if (fs.existsSync(destination)) {
      continue;
    }
    ensureDirectory(path.dirname(destination));
    fs.copyFileSync(sourceFile, destination);
  }

  // Keep user-owned index edits, but append newly introduced default pages.
  mergeDefaultIndexIntoUserIndex(helpRoot, defaultsDir);
}

function scanMarkdownFiles(helpRoot: string): HelpDocSummary[] {
  const markdownFiles = listFilesRecursively(helpRoot)
    .filter((filePath) => filePath.toLowerCase().endsWith('.md'))
    .map((filePath) => toPosixPath(path.relative(helpRoot, filePath)))
    .sort((a, b) => a.localeCompare(b));

  const docs = markdownFiles.map((filePath, index) => {
    const title = path.posix.basename(filePath, '.md').replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    return {
      id: toHelpIdFromFile(filePath),
      title,
      file: filePath,
      description: `Help page: ${title}`,
      order: index,
    };
  });
  return dedupeDocIds(docs);
}

function readIndexFile(helpRoot: string): HelpDocsIndexFile | null {
  const indexPath = path.join(helpRoot, HELP_INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const parsed = JSON.parse(raw) as HelpDocsIndexFile;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.docs)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeIndexDocs(helpRoot: string, index: HelpDocsIndexFile): HelpDocSummary[] {
  const docs = index.docs
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      const file = typeof entry.file === 'string' ? toPosixPath(entry.file.trim()) : '';
      const description = typeof entry.description === 'string' ? entry.description.trim() : undefined;
      return { id, title, file, description };
    })
    .filter((entry) => entry.title && entry.file)
    .filter((entry) => !path.isAbsolute(entry.file))
    .filter((entry) => !entry.file.startsWith('../') && !entry.file.includes('/../'));

  const existingDocs = docs.filter((entry) => {
    try {
      const abs = resolveInsideHelpRoot(helpRoot, entry.file);
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  });

  return dedupeDocIds(existingDocs);
}

function sanitizeEmbeddedSiteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function findDocById(docs: HelpDocSummary[], docId: string): HelpDocSummary | null {
  const targetId = docId.trim().toLowerCase();
  return docs.find((doc) => doc.id === targetId) ?? null;
}

function resolveDocPath(helpRoot: string, doc: HelpDocSummary): string {
  return resolveInsideHelpRoot(helpRoot, doc.file);
}

function scoreDocSearch(queryTokens: string[], title: string, content: string): number {
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lowerTitle.includes(token)) score += 5;
    if (lowerContent.includes(token)) score += 1;
  }
  return score;
}

function createSearchExcerpt(content: string, queryTokens: string[]): string {
  const lowerContent = content.toLowerCase();
  let hitIndex = -1;
  for (const token of queryTokens) {
    const idx = lowerContent.indexOf(token);
    if (idx >= 0 && (hitIndex < 0 || idx < hitIndex)) {
      hitIndex = idx;
    }
  }
  if (hitIndex < 0) {
    return content.slice(0, 180).replace(/\s+/g, ' ').trim();
  }
  const start = Math.max(0, hitIndex - 90);
  const end = Math.min(content.length, hitIndex + 120);
  const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return start > 0 ? `...${snippet}` : snippet;
}

function toDataUrlForFile(filePath: string, buffer: Buffer): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif'
          : ext === '.svg' ? 'image/svg+xml'
            : ext === '.webp' ? 'image/webp'
              : ext === '.bmp' ? 'image/bmp'
                : ext === '.txt' || ext === '.md' ? 'text/plain'
                  : 'application/octet-stream';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function emitHelpDocsChanged(): void {
  const event: HelpDocsUpdatedEvent = { changedAt: new Date().toISOString() };
  for (const listener of helpChangeListeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[HelpDocs] change listener failed:', error);
    }
  }
}

function scheduleHelpDocsChangedEmit(): void {
  if (pendingEmitTimer) {
    clearTimeout(pendingEmitTimer);
  }
  pendingEmitTimer = setTimeout(() => {
    pendingEmitTimer = null;
    emitHelpDocsChanged();
  }, 150);
}

export function onHelpDocsChanged(listener: (event: HelpDocsUpdatedEvent) => void): () => void {
  helpChangeListeners.add(listener);
  return () => helpChangeListeners.delete(listener);
}

/**
 * Ensure the writable help docs folder exists and has starter content.
 * Defaults are copied once and never overwrite user edits.
 */
export async function initializeHelpDocs(): Promise<HelpDocsListResponse> {
  const helpRoot = getHelpDocsRootDir();
  ensureDirectory(helpRoot);
  copyDefaultHelpFilesIfMissing(helpRoot);
  return listHelpDocs();
}

export function startHelpDocsWatcher(): void {
  if (helpWatcher) return;
  const helpRoot = getHelpDocsRootDir();
  ensureDirectory(helpRoot);

  try {
    helpWatcher = fs.watch(helpRoot, { recursive: true }, () => {
      scheduleHelpDocsChangedEmit();
    });
  } catch (error) {
    console.warn('[HelpDocs] Failed to start recursive help watcher:', error);
  }
}

export function stopHelpDocsWatcher(): void {
  if (pendingEmitTimer) {
    clearTimeout(pendingEmitTimer);
    pendingEmitTimer = null;
  }
  if (helpWatcher) {
    try {
      helpWatcher.close();
    } catch {
      // Ignore
    }
    helpWatcher = null;
  }
}

export async function listHelpDocs(): Promise<HelpDocsListResponse> {
  const helpRoot = getHelpDocsRootDir();
  ensureDirectory(helpRoot);
  const index = readIndexFile(helpRoot);
  const docs = index ? sanitizeIndexDocs(helpRoot, index) : scanMarkdownFiles(helpRoot);
  const fallbackDocs = docs.length > 0 ? docs : scanMarkdownFiles(helpRoot);

  return {
    docs: fallbackDocs,
    rootDir: helpRoot,
    embeddedSiteUrl: sanitizeEmbeddedSiteUrl(index?.embeddedSiteUrl),
  };
}

export async function readHelpDoc(docId: string): Promise<HelpDocPageResponse> {
  const list = await listHelpDocs();
  const doc = findDocById(list.docs, docId);
  if (!doc) {
    throw new Error('Help document not found');
  }
  const absolutePath = resolveDocPath(list.rootDir, doc);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const stat = fs.statSync(absolutePath);
  return {
    doc,
    content,
    absolutePath,
    lastModifiedMs: stat.mtimeMs,
  };
}

export async function searchHelpDocs(query: string): Promise<HelpDocsSearchResponse> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { query: '', results: [] };
  }

  const tokens = Array.from(new Set(normalizedQuery.split(/\s+/).filter((token) => token.length >= 2)));
  if (tokens.length === 0) {
    return { query: normalizedQuery, results: [] };
  }

  const list = await listHelpDocs();
  const results: HelpDocsSearchResult[] = [];
  for (const doc of list.docs) {
    try {
      const absolutePath = resolveDocPath(list.rootDir, doc);
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const score = scoreDocSearch(tokens, doc.title, content);
      if (score <= 0) continue;
      results.push({
        docId: doc.id,
        title: doc.title,
        file: doc.file,
        score,
        excerpt: createSearchExcerpt(content, tokens),
      });
    } catch {
      // Ignore unreadable docs
    }
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { query: normalizedQuery, results: results.slice(0, 50) };
}

export async function getHelpAssetDataUrl(docId: string, relativeAssetPath: string): Promise<{ dataUrl: string }> {
  const page = await readHelpDoc(docId);
  const docDir = path.posix.dirname(page.doc.file);
  const joined = path.posix.normalize(path.posix.join(docDir, toPosixPath(relativeAssetPath)));
  if (joined.startsWith('../')) {
    throw new Error('Asset path escapes help directory');
  }
  const absAssetPath = resolveInsideHelpRoot(getHelpDocsRootDir(), joined);
  const stat = fs.statSync(absAssetPath);
  if (!stat.isFile()) {
    throw new Error('Help asset is not a file');
  }
  if (stat.size > HELP_MAX_ASSET_BYTES) {
    throw new Error('Help asset is too large');
  }
  const buffer = fs.readFileSync(absAssetPath);
  return { dataUrl: toDataUrlForFile(absAssetPath, buffer) };
}

export async function openHelpDocInEditor(docId: string): Promise<{ ok: boolean; path: string }> {
  const page = await readHelpDoc(docId);
  const result = await shell.openPath(page.absolutePath);
  if (result) {
    throw new Error(result);
  }
  return { ok: true, path: page.absolutePath };
}

export async function openHelpDocsFolder(): Promise<{ ok: boolean; path: string }> {
  const helpRoot = getHelpDocsRootDir();
  ensureDirectory(helpRoot);
  const result = await shell.openPath(helpRoot);
  if (result) {
    throw new Error(result);
  }
  return { ok: true, path: helpRoot };
}

export async function openHelpAssetExternally(docId: string, relativeAssetPath: string): Promise<{ ok: boolean; path: string }> {
  const page = await readHelpDoc(docId);
  const docDir = path.posix.dirname(page.doc.file);
  const joined = path.posix.normalize(path.posix.join(docDir, toPosixPath(relativeAssetPath)));
  if (joined.startsWith('../')) {
    throw new Error('Asset path escapes help directory');
  }
  const absAssetPath = resolveInsideHelpRoot(getHelpDocsRootDir(), joined);
  const result = await shell.openPath(absAssetPath);
  if (result) {
    throw new Error(result);
  }
  return { ok: true, path: absAssetPath };
}
