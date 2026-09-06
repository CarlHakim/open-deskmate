import path from 'node:path';
import type { SubagentRunRecord } from '@accomplish/shared';

export function normalizeOwnedPaths(paths: string[] = []): string[] {
  return [...new Set(paths.map(value => {
    const normalized = path.posix.normalize(String(value).replace(/\\/g, '/').trim()).replace(/\/$/, '');
    if (!normalized || normalized === '.' || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
      || normalized === '..' || normalized.startsWith('../') || /[*?\0]/.test(normalized)) {
      throw new Error('File assignments must be relative file or directory paths without wildcards.');
    }
    return normalized;
  }))];
}

export function pathsOverlap(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function findOwnershipConflicts(paths: string[], runs: SubagentRunRecord[], workspace?: string, excludeRunId?: string): string[] {
  if (!workspace || !paths.length) return [];
  return runs.filter(run => run.runId !== excludeRunId && !run.closedAt
    && (run.status === 'accepted' || run.status === 'running')
    && path.resolve(run.inheritedContext?.workingDirectory || '').toLowerCase() === path.resolve(workspace).toLowerCase())
    .flatMap(run => (run.ownedPaths || []).filter(owned => paths.some(candidate => pathsOverlap(candidate, owned)))
      .map(owned => `${owned} is assigned to ${run.label || run.childAgentId} (${run.runId})`));
}

export function ownershipPrompt(paths: string[]): string {
  return paths.length ? `\nFile assignment: ${paths.join(', ')}. Make edits only within these paths. Coordinate with the parent before changing other files; do not overwrite another worker's changes. Report changed files and tests in your final answer.\n` : '';
}
