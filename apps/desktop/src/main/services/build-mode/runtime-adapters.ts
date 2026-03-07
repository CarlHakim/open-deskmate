import fs from 'fs';
import path from 'path';
import type {
  BuildProjectDetection,
  BuildProjectCategory,
  BuildPreviewStrategy,
  BuildRuntimeCommands,
} from '@accomplish/shared';

interface ProjectInspection {
  workspaceRoot: string;
  packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  packageManager: 'pnpm' | 'npm' | 'yarn';
  files: Set<string>;
  scripts: Record<string, string>;
  dependencyNames: Set<string>;
}

export interface RuntimeStructuredDiagnostic {
  type: 'typescript_error' | 'build_error' | 'runtime_error' | 'port_in_use';
  source: 'tsc' | 'esbuild' | 'webpack' | 'node' | 'unknown';
  severity: 'error' | 'warning';
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  raw: string;
  at: string;
}

interface RuntimeAdapter {
  id: string;
  projectType: string;
  category: BuildProjectCategory;
  previewStrategy: BuildPreviewStrategy;
  requiresPort: boolean;
  defaultPort?: number;
  healthCheckPath?: string;
  detect: (inspection: ProjectInspection) => number;
  buildEvidence: (inspection: ProjectInspection) => string[];
  resolveCommands: (inspection: ProjectInspection) => BuildRuntimeCommands;
  parseErrors: (rawLine: string, workspaceRoot: string) => RuntimeStructuredDiagnostic | null;
}

const ADAPTERS: RuntimeAdapter[] = [
  {
    id: 'nextjs-runtime',
    projectType: 'nextjs',
    category: 'web',
    previewStrategy: 'iframe',
    requiresPort: true,
    defaultPort: 3000,
    healthCheckPath: '/',
    detect: (i) => {
      let score = 0;
      if (i.dependencyNames.has('next')) score += 0.75;
      if (containsScript(i, 'dev', 'next')) score += 0.2;
      if (containsFile(i, 'next.config.js') || containsFile(i, 'next.config.mjs') || containsFile(i, 'next.config.ts')) score += 0.1;
      return Math.min(score, 1);
    },
    buildEvidence: (i) => collectEvidence(i, ['next'], ['next.config.js', 'next.config.mjs', 'next.config.ts'], [['dev', 'next']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', `${i.packageManager} exec next dev`),
      buildCommand: scriptOr(i, 'build', `${i.packageManager} exec next build`),
      runCommand: scriptOr(i, 'start', `${i.packageManager} exec next start`),
    }),
    parseErrors: parseNextjsRuntimeDiagnosticLine,
  },
  {
    id: 'vite-runtime',
    projectType: 'vite-web',
    category: 'web',
    previewStrategy: 'iframe',
    requiresPort: true,
    defaultPort: 5173,
    healthCheckPath: '/',
    detect: (i) => {
      let score = 0;
      if (i.dependencyNames.has('vite')) score += 0.65;
      if (containsScript(i, 'dev', 'vite')) score += 0.2;
      if (containsFile(i, 'vite.config.ts') || containsFile(i, 'vite.config.js') || containsFile(i, 'vite.config.mjs')) score += 0.15;
      return Math.min(score, 1);
    },
    buildEvidence: (i) => collectEvidence(i, ['vite'], ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'], [['dev', 'vite']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', `${i.packageManager} exec vite`),
      buildCommand: scriptOr(i, 'build', `${i.packageManager} exec vite build`),
      runCommand: scriptOr(i, 'preview', `${i.packageManager} exec vite preview`),
    }),
    parseErrors: parseViteRuntimeDiagnosticLine,
  },
  {
    id: 'react-runtime',
    projectType: 'react-app',
    category: 'web',
    previewStrategy: 'iframe',
    requiresPort: true,
    defaultPort: 3000,
    healthCheckPath: '/',
    detect: (i) => {
      let score = 0;
      if (i.dependencyNames.has('react')) score += 0.35;
      if (i.dependencyNames.has('react-dom')) score += 0.2;
      if (i.dependencyNames.has('react-scripts')) score += 0.25;
      if (containsScript(i, 'start', 'react-scripts')) score += 0.15;
      return Math.min(score, 0.95);
    },
    buildEvidence: (i) => collectEvidence(i, ['react', 'react-dom', 'react-scripts'], [], [['start', 'react-scripts']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', scriptOr(i, 'start', `${i.packageManager} start`)),
      buildCommand: scriptOr(i, 'build', null),
      runCommand: scriptOr(i, 'start', null),
    }),
    parseErrors: parseReactRuntimeDiagnosticLine,
  },
  {
    id: 'express-runtime',
    projectType: 'express-service',
    category: 'backend',
    previewStrategy: 'logs-only',
    requiresPort: true,
    defaultPort: 3001,
    healthCheckPath: '/health',
    detect: (i) => {
      let score = 0;
      if (i.dependencyNames.has('express')) score += 0.7;
      if (containsScript(i, 'dev', 'nodemon') || containsScript(i, 'dev', 'tsx') || containsScript(i, 'start', 'node')) score += 0.2;
      return Math.min(score, 0.95);
    },
    buildEvidence: (i) => collectEvidence(i, ['express'], [], [['dev', 'nodemon'], ['dev', 'tsx'], ['start', 'node']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', scriptOr(i, 'start', fallbackNodeEntry(i))),
      buildCommand: scriptOr(i, 'build', null),
      runCommand: scriptOr(i, 'start', fallbackNodeEntry(i)),
    }),
    parseErrors: parseExpressRuntimeDiagnosticLine,
  },
  {
    id: 'fastify-runtime',
    projectType: 'fastify-service',
    category: 'backend',
    previewStrategy: 'logs-only',
    requiresPort: true,
    defaultPort: 3002,
    healthCheckPath: '/health',
    detect: (i) => {
      let score = 0;
      if (i.dependencyNames.has('fastify')) score += 0.75;
      if (containsScript(i, 'dev', 'fastify')) score += 0.15;
      return Math.min(score, 0.95);
    },
    buildEvidence: (i) => collectEvidence(i, ['fastify'], [], [['dev', 'fastify']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', scriptOr(i, 'start', fallbackNodeEntry(i))),
      buildCommand: scriptOr(i, 'build', null),
      runCommand: scriptOr(i, 'start', fallbackNodeEntry(i)),
    }),
    parseErrors: parseFastifyRuntimeDiagnosticLine,
  },
  {
    id: 'electron-runtime',
    projectType: 'electron-desktop',
    category: 'desktop',
    previewStrategy: 'external-window',
    requiresPort: false,
    detect: (i) => {
      let score = 0;
      if (i.dependencyNames.has('electron')) score += 0.7;
      if (containsScript(i, 'dev', 'electron') || containsScript(i, 'start', 'electron')) score += 0.2;
      if (containsFile(i, 'electron-builder.json') || containsFile(i, 'electron.vite.config.ts')) score += 0.1;
      return Math.min(score, 1);
    },
    buildEvidence: (i) => collectEvidence(i, ['electron'], ['electron-builder.json', 'electron.vite.config.ts'], [['dev', 'electron'], ['start', 'electron']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', scriptOr(i, 'start', null)),
      buildCommand: scriptOr(i, 'build', null),
      runCommand: scriptOr(i, 'start', null),
    }),
    parseErrors: parseElectronRuntimeDiagnosticLine,
  },
  {
    id: 'generic-node-runtime',
    projectType: 'generic-node',
    category: 'node',
    previewStrategy: 'logs-only',
    requiresPort: false,
    detect: (i) => {
      let score = 0;
      if (i.packageJson) score += 0.2;
      if (i.scripts.dev || i.scripts.start || i.scripts.build) score += 0.25;
      if (containsFile(i, 'index.js') || containsFile(i, 'server.js')) score += 0.2;
      return Math.min(score, 0.6);
    },
    buildEvidence: (i) => collectEvidence(i, [], ['index.js', 'server.js'], [['dev', ''], ['start', ''], ['build', '']]),
    resolveCommands: (i) => ({
      startCommand: scriptOr(i, 'dev', scriptOr(i, 'start', fallbackNodeEntry(i))),
      buildCommand: scriptOr(i, 'build', null),
      runCommand: scriptOr(i, 'start', fallbackNodeEntry(i)),
    }),
    parseErrors: parseGenericNodeRuntimeDiagnosticLine,
  },
];

export function inspectProjectWorkspace(workspaceRoot: string): ProjectInspection {
  const resolvedRoot = path.resolve(workspaceRoot);
  const packageJsonPath = path.join(resolvedRoot, 'package.json');
  const packageJson = readPackageJson(packageJsonPath);
  const scripts = packageJson?.scripts ?? {};
  const dependencyNames = new Set<string>([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);

  const files = new Set<string>();
  for (const name of [
    'package.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'electron-builder.json',
    'electron.vite.config.ts',
    'index.js',
    'server.js',
  ]) {
    if (fs.existsSync(path.join(resolvedRoot, name))) {
      files.add(name);
    }
  }

  return {
    workspaceRoot: resolvedRoot,
    packageJson,
    packageManager: detectPackageManager(resolvedRoot),
    files,
    scripts,
    dependencyNames,
  };
}

export function detectProjectRuntime(workspaceRoot: string): BuildProjectDetection {
  const inspection = inspectProjectWorkspace(workspaceRoot);
  const scored = ADAPTERS.map((adapter) => ({ adapter, score: adapter.detect(inspection) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const adapter = best?.adapter ?? ADAPTERS[ADAPTERS.length - 1];
  const confidence = Number.isFinite(best?.score) ? Math.max(0, Math.min(1, best.score)) : 0;
  const commands = adapter.resolveCommands(inspection);

  return {
    runtimeAdapterId: adapter.id,
    projectType: adapter.projectType,
    category: adapter.category,
    previewStrategy: adapter.previewStrategy,
    confidence,
    evidence: adapter.buildEvidence(inspection),
    packageManager: inspection.packageManager,
    commands,
    requiresPort: adapter.requiresPort,
    defaultPort: adapter.defaultPort,
    healthCheckPath: adapter.healthCheckPath,
  };
}

export function parseRuntimeDiagnosticLine(
  runtimeAdapterId: string,
  rawLine: string,
  workspaceRoot: string,
): RuntimeStructuredDiagnostic | null {
  const adapter = ADAPTERS.find((entry) => entry.id === runtimeAdapterId);
  if (adapter?.parseErrors) {
    const parsed = adapter.parseErrors(rawLine, workspaceRoot);
    if (parsed) return parsed;
  }
  return parseGenericNodeRuntimeDiagnosticLine(rawLine, workspaceRoot);
}

function detectPackageManager(workspaceRoot: string): 'pnpm' | 'npm' | 'yarn' {
  if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function readPackageJson(packageJsonPath: string): ProjectInspection['packageJson'] {
  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as ProjectInspection['packageJson'];
    return parsed ?? null;
  } catch {
    return null;
  }
}

function containsFile(inspection: ProjectInspection, fileName: string): boolean {
  return inspection.files.has(fileName);
}

function containsScript(inspection: ProjectInspection, scriptName: string, token: string): boolean {
  const script = inspection.scripts[scriptName];
  if (!script) return false;
  return token ? script.toLowerCase().includes(token.toLowerCase()) : true;
}

function scriptOr(inspection: ProjectInspection, scriptName: string, fallback: string | null): string | null {
  const script = inspection.scripts[scriptName];
  if (typeof script === 'string' && script.trim()) {
    return `${inspection.packageManager} run ${scriptName}`;
  }
  return fallback;
}

function fallbackNodeEntry(inspection: ProjectInspection): string | null {
  if (containsFile(inspection, 'server.js')) return 'node server.js';
  if (containsFile(inspection, 'index.js')) return 'node index.js';
  return null;
}

function collectEvidence(
  inspection: ProjectInspection,
  dependencyHints: string[],
  fileHints: string[],
  scriptHints: Array<[scriptName: string, token: string]>
): string[] {
  const evidence: string[] = [];
  for (const dep of dependencyHints) {
    if (inspection.dependencyNames.has(dep)) evidence.push(`dependency:${dep}`);
  }
  for (const file of fileHints) {
    if (containsFile(inspection, file)) evidence.push(`file:${file}`);
  }
  for (const [name, token] of scriptHints) {
    if (containsScript(inspection, name, token)) evidence.push(`script:${name}`);
  }
  if (evidence.length === 0 && inspection.packageJson) {
    evidence.push('package.json:present');
  }
  return evidence;
}

function parseNextjsRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseTypeScriptDiagnostic(rawLine, workspaceRoot)
    || parseWebpackDiagnostic(rawLine, workspaceRoot)
    || parseEsbuildDiagnostic(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseViteRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseEsbuildDiagnostic(rawLine, workspaceRoot)
    || parseTypeScriptDiagnostic(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseReactRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseWebpackDiagnostic(rawLine, workspaceRoot)
    || parseTypeScriptDiagnostic(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseExpressRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseNodePathError(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseFastifyRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseNodePathError(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseElectronRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseNodePathError(rawLine, workspaceRoot)
    || parseWebpackDiagnostic(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseGenericNodeRuntimeDiagnosticLine(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  return (
    parseTypeScriptDiagnostic(rawLine, workspaceRoot)
    || parseEsbuildDiagnostic(rawLine, workspaceRoot)
    || parseNodePathError(rawLine, workspaceRoot)
    || parsePortBindDiagnostic(rawLine)
    || parseGenericRuntimeError(rawLine)
  );
}

function parseTypeScriptDiagnostic(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return null;

  const tsParen = clean.match(/^(.+)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+)\s*:\s*(.+)$/i);
  if (tsParen) {
    return {
      type: 'typescript_error',
      source: 'tsc',
      severity: tsParen[4].toLowerCase() === 'warning' ? 'warning' : 'error',
      file: normalizeDiagnosticFile(tsParen[1], workspaceRoot),
      line: toPositiveInt(tsParen[2]),
      column: toPositiveInt(tsParen[3]),
      code: tsParen[5],
      message: tsParen[6].trim(),
      raw: clean,
      at: new Date().toISOString(),
    };
  }

  const tsDash = clean.match(/^(.+):(\d+):(\d+)\s*-\s*(error|warning)\s*(TS\d+)\s*:\s*(.+)$/i);
  if (tsDash) {
    return {
      type: 'typescript_error',
      source: 'tsc',
      severity: tsDash[4].toLowerCase() === 'warning' ? 'warning' : 'error',
      file: normalizeDiagnosticFile(tsDash[1], workspaceRoot),
      line: toPositiveInt(tsDash[2]),
      column: toPositiveInt(tsDash[3]),
      code: tsDash[5],
      message: tsDash[6].trim(),
      raw: clean,
      at: new Date().toISOString(),
    };
  }

  return null;
}

function parseEsbuildDiagnostic(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return null;
  const esbuild = clean.match(/^(.+):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i);
  if (!esbuild) return null;
  return {
    type: 'build_error',
    source: 'esbuild',
    severity: esbuild[4].toLowerCase() === 'warning' ? 'warning' : 'error',
    file: normalizeDiagnosticFile(esbuild[1], workspaceRoot),
    line: toPositiveInt(esbuild[2]),
    column: toPositiveInt(esbuild[3]),
    message: esbuild[5].trim(),
    raw: clean,
    at: new Date().toISOString(),
  };
}

function parseWebpackDiagnostic(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return null;
  const prefixed = clean.match(/^ERROR in (.+)$/i);
  if (prefixed) {
    return {
      type: 'build_error',
      source: 'webpack',
      severity: 'error',
      file: normalizeDiagnosticFile(prefixed[1], workspaceRoot),
      message: prefixed[1].trim(),
      raw: clean,
      at: new Date().toISOString(),
    };
  }
  return null;
}

function parseNodePathError(rawLine: string, workspaceRoot: string): RuntimeStructuredDiagnostic | null {
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return null;
  const nodePath = clean.match(/^at .*\((.+):(\d+):(\d+)\)$/i);
  if (!nodePath) return null;
  return {
    type: 'runtime_error',
    source: 'node',
    severity: 'error',
    file: normalizeDiagnosticFile(nodePath[1], workspaceRoot),
    line: toPositiveInt(nodePath[2]),
    column: toPositiveInt(nodePath[3]),
    message: 'Runtime stack frame',
    raw: clean,
    at: new Date().toISOString(),
  };
}

function parsePortBindDiagnostic(rawLine: string): RuntimeStructuredDiagnostic | null {
  const clean = stripAnsi(rawLine).trim();
  if (!clean || !/\bEADDRINUSE\b/i.test(clean)) return null;
  const portMatch = clean.match(/:(\d{2,5})\b/);
  const portSuffix = portMatch ? ` (port ${portMatch[1]})` : '';
  return {
    type: 'port_in_use',
    source: 'node',
    severity: 'error',
    code: 'EADDRINUSE',
    message: `Address already in use${portSuffix}.`,
    raw: clean,
    at: new Date().toISOString(),
  };
}

function parseGenericRuntimeError(rawLine: string): RuntimeStructuredDiagnostic | null {
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return null;
  if (!/^error:/i.test(clean) && !/^uncaught/i.test(clean)) return null;
  return {
    type: 'runtime_error',
    source: 'unknown',
    severity: 'error',
    message: clean.replace(/^error:\s*/i, '').trim(),
    raw: clean,
    at: new Date().toISOString(),
  };
}

function normalizeDiagnosticFile(filePath: string, workspaceRoot: string): string | undefined {
  const trimmed = stripAnsi(filePath).trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return undefined;
  const normalizedSlashes = trimmed.replace(/\\/g, '/');

  try {
    if (path.isAbsolute(trimmed)) {
      const absolute = path.resolve(trimmed);
      if (isPathInsideRoot(workspaceRoot, absolute)) {
        return path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
      }
      return normalizedSlashes;
    }

    const resolved = path.resolve(workspaceRoot, trimmed);
    if (isPathInsideRoot(workspaceRoot, resolved)) {
      return path.relative(workspaceRoot, resolved).replace(/\\/g, '/');
    }
  } catch {
    // Keep original fallback below.
  }

  return normalizedSlashes;
}

function isPathInsideRoot(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const rootCmp = process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot;
  const targetCmp = process.platform === 'win32' ? normalizedTarget.toLowerCase() : normalizedTarget;
  if (targetCmp === rootCmp) return true;
  const prefix = rootCmp.endsWith(path.sep) ? rootCmp : `${rootCmp}${path.sep}`;
  return targetCmp.startsWith(prefix);
}

function toPositiveInt(input: string): number | undefined {
  const parsed = Number.parseInt(String(input || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function stripAnsi(value: string): string {
  return String(value || '').replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-ntqry=><~])/g,
    '',
  );
}
