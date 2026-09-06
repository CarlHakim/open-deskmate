import { expect, it } from 'vitest';
import type { SubagentRunRecord } from '@accomplish/shared';
import { normalizeOwnedPaths, findOwnershipConflicts, pathsOverlap } from '@main/services/subagents/subagent-ownership';
it('normalizes assignments and rejects escaping paths', () => {
  expect(normalizeOwnedPaths(['src\\app.ts', 'src/app.ts'])).toEqual(['src/app.ts']);
  for (const value of ['../outside', '/outside', 'C:\\outside', '*', '.']) expect(() => normalizeOwnedPaths([value])).toThrow();
  expect(pathsOverlap('src', 'src/app.ts')).toBe(true);
  expect(pathsOverlap('src/a', 'src/abc')).toBe(false);
});
it('detects active overlaps but permits distinct workspaces and finished runs', () => {
  const run = { runId: 'one', status: 'running', ownedPaths: ['src'], inheritedContext: { workingDirectory: 'C:/workspace' } } as SubagentRunRecord;
  expect(findOwnershipConflicts(['src/app.ts'], [run], 'C:/workspace')).toHaveLength(1);
  expect(findOwnershipConflicts(['src/app.ts'], [run], 'C:/isolated')).toHaveLength(0);
  expect(findOwnershipConflicts(['src/app.ts'], [{ ...run, status: 'done' }], 'C:/workspace')).toHaveLength(0);
});
