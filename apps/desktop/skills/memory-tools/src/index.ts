#!/usr/bin/env node
/**
 * Memory Tools MCP Server
 *
 * Exposes memory_get, memory_search, memory_write for workspace Markdown files.
 * Search is hybrid by default:
 * - lexical retrieval (FTS5/BM25 when available)
 * - semantic retrieval (local hashed embeddings + cosine similarity)
 * - fusion (RRF) with light recency/context handling
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';

const WORKSPACE_ROOT = process.env.MEMORY_WORKSPACE_ROOT || '';

const MEMORY_DIR = 'memory';
const LONG_TERM_FILE = 'MEMORY.md';
const MEMORY_DB_NAME = '.memory-index.sqlite';
const INDEX_SCHEMA_VERSION = 'hybrid-v1';
const EMBEDDING_DIM = 384;
const RRF_K = 60;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'how', 'i', 'if', 'in',
  'is', 'it', 'its', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'them', 'there', 'this',
  'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);

const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  retry: ['retries', 'backoff', '429', 'rate', 'limit', 'throttle'],
  retries: ['retry', 'backoff', '429', 'rate', 'limit', 'throttle'],
  auth: ['authentication', 'authorize', 'authorization', 'token', 'oauth'],
  oauth: ['auth', 'token', 'callback', 'refresh'],
  error: ['failure', 'failed', 'exception', 'issue', 'bug'],
  timeout: ['timed', 'deadline', 'latency', 'slow'],
  permission: ['permissions', 'allow', 'deny', 'approval'],
  connector: ['integration', 'bridge', 'webhook', 'runtime'],
};

type MemoryKind = 'long-term' | 'daily';
type SearchMode = 'hybrid' | 'keyword' | 'semantic';

interface MemoryGetInput {
  kind: MemoryKind;
  date?: string;
}

interface MemorySearchInput {
  query: string;
  limit?: number;
  mode?: SearchMode;
  contextLines?: number;
}

interface MemoryWriteInput {
  kind: MemoryKind;
  date?: string;
  content: string;
  mode?: 'append' | 'replace';
}

interface CandidateRow {
  rowid: number;
  file: string;
  start: number;
  end: number;
  text: string;
  keywordScore: number;
  semanticScore: number;
  recencyScore: number;
}

interface FusedCandidate extends CandidateRow {
  rrfScore: number;
  finalScore: number;
}

function ensureWorkspaceRoot(): string {
  if (!WORKSPACE_ROOT) {
    throw new Error('MEMORY_WORKSPACE_ROOT is not configured');
  }
  return WORKSPACE_ROOT;
}

function ensureMemoryDir(root: string): string {
  const memoryDir = path.join(root, MEMORY_DIR);
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  return memoryDir;
}

function resolveDailyPath(root: string, date: string): string {
  return path.join(root, MEMORY_DIR, `${date}.md`);
}

function readFileSafe(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function getLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function tokenize(text: string, options?: { removeStopwords?: boolean; minLen?: number }): string[] {
  const removeStopwords = options?.removeStopwords !== false;
  const minLen = options?.minLen ?? 2;
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9+#._-]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  const filtered = raw.filter((token) => token.length >= minLen);
  if (!removeStopwords) return filtered;
  const withoutStopwords = filtered.filter((token) => !STOPWORDS.has(token));
  return withoutStopwords.length > 0 ? withoutStopwords : filtered;
}

function normalizeQuery(query: string): string[] {
  return tokenize(query, { removeStopwords: true, minLen: 2 });
}

function expandSemanticTokens(tokens: string[]): string[] {
  const output = new Set<string>(tokens);
  for (const token of tokens) {
    const synonyms = SEMANTIC_SYNONYMS[token];
    if (!synonyms) continue;
    for (const synonym of synonyms) {
      if (synonym.length >= 2) output.add(synonym);
    }
  }
  return Array.from(output);
}

function chunkLines(lines: string[], startLine: number, maxChars = 1600, overlapLines = 3) {
  const chunks: Array<{ start: number; end: number; text: string }> = [];
  let idx = 0;
  while (idx < lines.length) {
    let end = idx;
    let chars = 0;
    while (end < lines.length && chars < maxChars) {
      chars += lines[end].length + 1;
      end += 1;
    }
    const text = lines.slice(idx, end).join('\n').trim();
    if (text) {
      chunks.push({ start: startLine + idx, end: startLine + end - 1, text });
    }
    if (end >= lines.length) break;
    idx = Math.max(0, end - overlapLines);
  }
  return chunks;
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hash32(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function addHashedFeature(vector: Float32Array, feature: string, weight: number): void {
  const idx = hash32(feature, 0x811c9dc5) % EMBEDDING_DIM;
  const sign = (hash32(feature, 0x9e3779b9) & 1) === 0 ? 1 : -1;
  vector[idx] += sign * weight;
}

function normalizeVector(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) {
    norm += vector[i] * vector[i];
  }
  if (norm <= 1e-12) return vector;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] *= inv;
  }
  return vector;
}

function buildEmbedding(text: string): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIM);
  const lower = text.toLowerCase();

  const baseTokens = tokenize(lower, { removeStopwords: false, minLen: 2 });
  const semanticTokens = expandSemanticTokens(baseTokens);
  for (const token of semanticTokens) {
    addHashedFeature(vector, `tok:${token}`, token.length >= 5 ? 1.5 : 1.1);
  }
  for (let i = 0; i + 1 < baseTokens.length; i += 1) {
    const bigram = `${baseTokens[i]}_${baseTokens[i + 1]}`;
    addHashedFeature(vector, `bi:${bigram}`, 0.8);
  }

  const compact = lower.replace(/\s+/g, ' ');
  const maxChars = Math.min(compact.length, 2200);
  for (let i = 0; i + 2 < maxChars; i += 1) {
    const tri = compact.slice(i, i + 3);
    if (!tri.trim()) continue;
    addHashedFeature(vector, `tri:${tri}`, 0.12);
  }

  return normalizeVector(vector);
}

function vectorToBuffer(vector: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i += 1) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer;
}

function bufferToVector(blob: unknown): Float32Array | null {
  if (!blob) return null;
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob as Uint8Array);
  if (buffer.length !== EMBEDDING_DIM * 4) return null;
  const vector = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    vector[i] = buffer.readFloatLE(i * 4);
  }
  return vector;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function getDbPath(root: string): string {
  return path.join(root, MEMORY_DIR, MEMORY_DB_NAME);
}

function openDb(root: string) {
  const dbPath = getDbPath(root);
  return new Database(dbPath);
}

function getMeta(db: any, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

function setMeta(db: any, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

function hasFtsTable(db: any): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();
  return Boolean(row);
}

function ensureSchema(db: any): void {
  db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  db.run(
    'CREATE TABLE IF NOT EXISTS chunks (' +
      'rowid INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'id TEXT UNIQUE, ' +
      'file TEXT, ' +
      'start INTEGER, ' +
      'end INTEGER, ' +
      'text TEXT' +
    ')',
  );
  db.run(
    'CREATE TABLE IF NOT EXISTS chunk_vectors (' +
      'rowid INTEGER PRIMARY KEY, ' +
      'vector BLOB NOT NULL, ' +
      'FOREIGN KEY(rowid) REFERENCES chunks(rowid) ON DELETE CASCADE' +
    ')',
  );

  let ftsEnabled = false;
  try {
    ftsEnabled = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') as enabled").get()?.enabled === 1;
    if (ftsEnabled) {
      db.run(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(" +
          "text, file, " +
          "content='chunks', content_rowid='rowid', " +
          "tokenize='porter'" +
        ")",
      );
    }
  } catch {
    ftsEnabled = false;
  }

  setMeta(db, 'fts_enabled', ftsEnabled ? '1' : '0');
}

function computeIndexFingerprint(files: Array<{ path: string; relative: string }>): string {
  const hash = crypto.createHash('sha256');
  hash.update(INDEX_SCHEMA_VERSION);
  files.forEach((file) => {
    try {
      const stat = fs.statSync(file.path);
      hash.update(file.relative);
      hash.update(String(stat.mtimeMs));
      hash.update(String(stat.size));
    } catch {
      hash.update(file.relative);
    }
  });
  return hash.digest('hex');
}

function listMemoryFiles(root: string): Array<{ path: string; label: string; relative: string }> {
  const memoryDir = ensureMemoryDir(root);
  const files: Array<{ path: string; label: string; relative: string }> = [];
  const longTermPath = path.join(root, LONG_TERM_FILE);
  files.push({ path: longTermPath, label: LONG_TERM_FILE, relative: LONG_TERM_FILE });
  const daily = fs
    .readdirSync(memoryDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .reverse();
  for (const name of daily) {
    files.push({
      path: path.join(memoryDir, name),
      label: `memory/${name}`,
      relative: path.join(MEMORY_DIR, name),
    });
  }
  return files;
}

function rebuildIndex(db: any, files: Array<{ path: string; relative: string }>): void {
  ensureSchema(db);
  const ftsReady = hasFtsTable(db);

  db.transaction(() => {
    db.prepare('DELETE FROM chunk_vectors').run();
    db.prepare('DELETE FROM chunks').run();
    if (ftsReady) {
      try {
        db.prepare('DELETE FROM chunks_fts').run();
      } catch {
        // ignore stale fts state
      }
    }

    const insertChunk = db.prepare('INSERT INTO chunks (id, file, start, end, text) VALUES (?, ?, ?, ?, ?)');
    const insertVector = db.prepare('INSERT INTO chunk_vectors (rowid, vector) VALUES (?, ?)');
    const insertFts = ftsReady
      ? db.prepare('INSERT INTO chunks_fts (rowid, text, file) VALUES (?, ?, ?)')
      : null;

    for (const file of files) {
      const content = readFileSafe(file.path);
      if (!content) continue;
      const lines = getLines(content);
      const chunks = chunkLines(lines, 1);
      for (const chunk of chunks) {
        const id = hashText(`${file.relative}:${chunk.start}:${chunk.end}:${chunk.text}`);
        const info = insertChunk.run(id, file.relative, chunk.start, chunk.end, chunk.text);
        const rowid = Number(info.lastInsertRowid);
        const vector = buildEmbedding(chunk.text);
        insertVector.run(rowid, vectorToBuffer(vector));
        if (insertFts) {
          try {
            insertFts.run(rowid, chunk.text, file.relative);
          } catch {
            // ignore single-row fts write failures
          }
        }
      }
    }
  })();

  setMeta(db, 'fingerprint', computeIndexFingerprint(files));
  setMeta(db, 'index_schema_version', INDEX_SCHEMA_VERSION);
}

function escapeFtsTerm(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

function buildFtsQuery(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const escaped = tokens.map(escapeFtsTerm);
  const important = tokens
    .filter((token) => token.length >= 4)
    .map(escapeFtsTerm);
  if (important.length >= 2) {
    return `(${important.join(' AND ')}) OR (${escaped.join(' OR ')})`;
  }
  return escaped.join(' OR ');
}

function parseDateFromMemoryFile(file: string): Date | null {
  const match = file.match(/memory[\\/](\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeRecencyScore(file: string): number {
  const date = parseDateFromMemoryFile(file);
  if (!date) {
    return file === LONG_TERM_FILE ? 0.65 : 0.5;
  }
  const nowMs = Date.now();
  const days = Math.max(0, (nowMs - date.getTime()) / (1000 * 60 * 60 * 24));
  return 1 / (1 + (days / 30));
}

function normalizeScores(rows: Array<{ value: number }>): number[] {
  const values = rows.map((entry) => entry.value).filter((n) => Number.isFinite(n));
  if (values.length === 0) return rows.map(() => 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const denom = Math.max(1e-9, max - min);
  return rows.map((entry) => {
    if (!Number.isFinite(entry.value)) return 0;
    return (entry.value - min) / denom;
  });
}

function getLexicalCandidates(db: any, queryTokens: string[], limit: number): CandidateRow[] {
  if (!hasFtsTable(db) || queryTokens.length === 0) return [];
  const query = buildFtsQuery(queryTokens);
  if (!query) return [];

  const rows = db.prepare(
    'SELECT c.rowid, c.file, c.start, c.end, c.text, bm25(chunks_fts) as rank ' +
      'FROM chunks_fts JOIN chunks c ON chunks_fts.rowid = c.rowid ' +
      'WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?'
  ).all(query, Math.max(limit * 8, 40));

  const normalized = normalizeScores(rows.map((row: any) => ({ value: -Number(row.rank ?? 0) })));
  return rows.map((row: any, idx: number) => ({
    rowid: Number(row.rowid),
    file: String(row.file),
    start: Number(row.start),
    end: Number(row.end),
    text: String(row.text || ''),
    keywordScore: normalized[idx] ?? 0,
    semanticScore: 0,
    recencyScore: computeRecencyScore(String(row.file)),
  }));
}

function getSemanticCandidates(db: any, rawQuery: string, limit: number): CandidateRow[] {
  const queryVector = buildEmbedding(rawQuery);
  const rows = db.prepare(
    'SELECT c.rowid, c.file, c.start, c.end, c.text, v.vector ' +
      'FROM chunk_vectors v JOIN chunks c ON c.rowid = v.rowid'
  ).all();

  const scored: CandidateRow[] = [];
  for (const row of rows) {
    const chunkVector = bufferToVector((row as any).vector);
    if (!chunkVector) continue;
    const cosine = cosineSimilarity(queryVector, chunkVector);
    if (!Number.isFinite(cosine) || cosine <= 0) continue;
    scored.push({
      rowid: Number((row as any).rowid),
      file: String((row as any).file),
      start: Number((row as any).start),
      end: Number((row as any).end),
      text: String((row as any).text || ''),
      keywordScore: 0,
      semanticScore: cosine,
      recencyScore: computeRecencyScore(String((row as any).file)),
    });
  }

  scored.sort((a, b) => b.semanticScore - a.semanticScore);
  const trimmed = scored.slice(0, Math.max(limit * 8, 40));
  const normalized = normalizeScores(trimmed.map((row) => ({ value: row.semanticScore })));
  return trimmed.map((row, idx) => ({
    ...row,
    semanticScore: normalized[idx] ?? 0,
  }));
}

function fuseCandidates(
  lexical: CandidateRow[],
  semantic: CandidateRow[],
  mode: SearchMode
): FusedCandidate[] {
  const merged = new Map<number, FusedCandidate>();

  const upsert = (row: CandidateRow): FusedCandidate => {
    const existing = merged.get(row.rowid);
    if (existing) return existing;
    const created: FusedCandidate = {
      ...row,
      rrfScore: 0,
      finalScore: 0,
    };
    merged.set(row.rowid, created);
    return created;
  };

  lexical.forEach((row, idx) => {
    const entry = upsert(row);
    entry.keywordScore = Math.max(entry.keywordScore, row.keywordScore);
    entry.recencyScore = Math.max(entry.recencyScore, row.recencyScore);
    entry.rrfScore += 1 / (RRF_K + idx + 1);
  });

  semantic.forEach((row, idx) => {
    const entry = upsert(row);
    entry.semanticScore = Math.max(entry.semanticScore, row.semanticScore);
    entry.recencyScore = Math.max(entry.recencyScore, row.recencyScore);
    entry.rrfScore += 1 / (RRF_K + idx + 1);
  });

  const rows = Array.from(merged.values());
  for (const row of rows) {
    if (mode === 'keyword') {
      row.finalScore = row.keywordScore;
    } else if (mode === 'semantic') {
      row.finalScore = row.semanticScore;
    } else {
      row.finalScore =
        row.rrfScore +
        0.12 * Math.max(row.keywordScore, row.semanticScore) +
        0.06 * row.recencyScore;
    }
  }

  rows.sort((a, b) => b.finalScore - a.finalScore);
  return rows;
}

function getContextSnippet(
  root: string,
  file: string,
  start: number,
  end: number,
  fallbackText: string,
  contextLines: number,
  fileCache: Map<string, string>
): { snippet: string; contextStart: number; contextEnd: number } {
  const clampedContext = Math.max(0, Math.min(20, contextLines));
  const absolute = path.join(root, file);
  const content = fileCache.has(absolute) ? fileCache.get(absolute)! : readFileSafe(absolute);
  if (!fileCache.has(absolute)) fileCache.set(absolute, content);
  if (!content) {
    return { snippet: fallbackText.slice(0, 700), contextStart: start, contextEnd: end };
  }
  const lines = getLines(content);
  const from = Math.max(1, start - clampedContext);
  const to = Math.min(lines.length, end + clampedContext);
  const snippet = lines.slice(from - 1, to).join('\n').trim().slice(0, 1400);
  return {
    snippet: snippet || fallbackText.slice(0, 700),
    contextStart: from,
    contextEnd: to,
  };
}

function dedupeAndLimit(
  rows: FusedCandidate[],
  limit: number,
  root: string,
  contextLines: number
): Array<Record<string, unknown>> {
  const takenBands = new Set<string>();
  const takenSnippetHashes = new Set<string>();
  const fileCache = new Map<string, string>();
  const output: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    if (output.length >= limit) break;
    const bandKey = `${row.file}:${Math.floor(row.start / 4)}:${Math.floor(row.end / 4)}`;
    if (takenBands.has(bandKey)) continue;

    const context = getContextSnippet(
      root,
      row.file,
      row.start,
      row.end,
      row.text,
      contextLines,
      fileCache
    );
    const snippetHash = hashText(context.snippet.slice(0, 240));
    if (takenSnippetHashes.has(snippetHash)) continue;

    takenBands.add(bandKey);
    takenSnippetHashes.add(snippetHash);
    output.push({
      file: row.file,
      lineRange: [row.start, row.end],
      contextLineRange: [context.contextStart, context.contextEnd],
      score: row.finalScore,
      fusedScore: row.rrfScore,
      keywordScore: row.keywordScore,
      semanticScore: row.semanticScore,
      recencyScore: row.recencyScore,
      snippet: context.snippet,
    });
  }

  return output;
}

const server = new Server(
  { name: 'memory-tools', version: '1.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_get',
      description: 'Read a memory file (MEMORY.md or memory/YYYY-MM-DD.md).',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['long-term', 'daily'] },
          date: { type: 'string', description: 'YYYY-MM-DD (required for daily if not today)' },
        },
        required: ['kind'],
      },
    },
    {
      name: 'memory_search',
      description: 'Search memory files with hybrid retrieval (FTS + semantic) and return ranked snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
          mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'] },
          contextLines: { type: 'number', description: 'Lines of context around each hit (0-20).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_write',
      description: 'Write memory updates to MEMORY.md or memory/YYYY-MM-DD.md.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['long-term', 'daily'] },
          date: { type: 'string', description: 'YYYY-MM-DD (required for daily if not today)' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['append', 'replace'] },
        },
        required: ['kind', 'content'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  try {
    const root = ensureWorkspaceRoot();

    if (request.params.name === 'memory_get') {
      const args = (request.params.arguments || {}) as MemoryGetInput;
      ensureMemoryDir(root);
      const filePath = args.kind === 'long-term'
        ? path.join(root, LONG_TERM_FILE)
        : resolveDailyPath(root, args.date || new Date().toISOString().slice(0, 10));
      const relative = path.relative(root, filePath);
      const content = readFileSafe(filePath);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ file: relative, path: filePath, content }, null, 2),
          },
        ],
      };
    }

    if (request.params.name === 'memory_write') {
      const args = (request.params.arguments || {}) as MemoryWriteInput;
      ensureMemoryDir(root);
      const filePath = args.kind === 'long-term'
        ? path.join(root, LONG_TERM_FILE)
        : resolveDailyPath(root, args.date || new Date().toISOString().slice(0, 10));
      const nextContent =
        args.mode === 'append' && fs.existsSync(filePath)
          ? `${readFileSafe(filePath).replace(/\s*$/, '')}\n\n${args.content}`
          : args.content;
      fs.writeFileSync(filePath, nextContent ?? '', 'utf-8');
      const relative = path.relative(root, filePath);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ file: relative, path: filePath, status: 'ok' }, null, 2),
          },
        ],
      };
    }

    if (request.params.name === 'memory_search') {
      const args = (request.params.arguments || {}) as MemorySearchInput;
      const rawQuery = String(args.query || '').trim();
      const queryTokens = normalizeQuery(rawQuery);
      const limit = Math.max(1, Math.min(20, args.limit ?? 6));
      const mode: SearchMode = args.mode === 'keyword' || args.mode === 'semantic' ? args.mode : 'hybrid';
      const contextLines = Math.max(0, Math.min(20, args.contextLines ?? 3));
      if (!rawQuery) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ query: args.query, mode, results: [] }, null, 2),
            },
          ],
        };
      }

      const db = openDb(root);
      try {
        ensureSchema(db);
        const memoryFiles = listMemoryFiles(root).map((f) => ({ path: f.path, relative: f.relative }));
        const fingerprint = computeIndexFingerprint(memoryFiles);
        const existingFingerprint = getMeta(db, 'fingerprint');
        const existingSchema = getMeta(db, 'index_schema_version');
        if (fingerprint !== existingFingerprint || existingSchema !== INDEX_SCHEMA_VERSION) {
          rebuildIndex(db, memoryFiles);
        }

        const lexicalCandidates = mode === 'semantic'
          ? []
          : getLexicalCandidates(db, queryTokens, limit);
        const semanticCandidates = mode === 'keyword'
          ? []
          : getSemanticCandidates(db, rawQuery, limit);

        const fused = fuseCandidates(lexicalCandidates, semanticCandidates, mode);
        const results = dedupeAndLimit(fused, limit, root, contextLines);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query: args.query,
                  mode,
                  retrieval: {
                    ftsEnabled: hasFtsTable(db),
                    lexicalCandidates: lexicalCandidates.length,
                    semanticCandidates: semanticCandidates.length,
                  },
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      } finally {
        db.close();
      }
    }

    return {
      content: [{ type: 'text', text: `Error: Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Memory Tools MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start memory server:', error);
  process.exit(1);
});
