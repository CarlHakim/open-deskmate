import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  listWorkspaceTree,
  resolveAgentWorkspaceRoot,
} from '../../../../../src/main/services/build-mode/file-service';

const createdRoots = new Set<string>();

async function createWorkspace(agentId: string): Promise<string> {
  const root = resolveAgentWorkspaceRoot(agentId);
  createdRoots.add(root);
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.mkdir(root, { recursive: true });
  return root;
}

function childNames(node: { children?: Array<{ name: string }> }): string[] {
  return (node.children ?? []).map((child) => child.name).sort();
}

describe('build mode file tree', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(Array.from(createdRoots).map((root) => (
      fs.promises.rm(root, { recursive: true, force: true })
    )));
    createdRoots.clear();
  });

  test('skips internal and generated directories even when hidden files are included', async () => {
    const agentId = `tree-skip-${Date.now()}`;
    const root = await createWorkspace(agentId);
    await fs.promises.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.promises.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.promises.mkdir(path.join(root, '.next'), { recursive: true });
    await fs.promises.writeFile(path.join(root, '.git', 'index'), 'git');
    await fs.promises.writeFile(path.join(root, 'package.json'), '{}');
    await fs.promises.writeFile(path.join(root, '.env.example'), 'KEY=value');

    const tree = await listWorkspaceTree(agentId, '.', { includeHidden: true, depth: 3 });

    expect(childNames(tree)).toEqual(['.env.example', 'package.json']);
  });

  test('ignores files that disappear between readdir and stat', async () => {
    const agentId = `tree-race-${Date.now()}`;
    const root = await createWorkspace(agentId);
    const stablePath = path.join(root, 'stable.txt');
    const vanishingPath = path.join(root, 'vanishing.txt');
    await fs.promises.writeFile(stablePath, 'stable');
    await fs.promises.writeFile(vanishingPath, 'vanishing');

    const originalStat = fs.promises.stat.bind(fs.promises);
    vi.spyOn(fs.promises, 'stat').mockImplementation((async (target: fs.PathLike) => {
      if (path.resolve(String(target)) === path.resolve(vanishingPath)) {
        const error = new Error('gone') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return originalStat(target);
    }) as typeof fs.promises.stat);

    const tree = await listWorkspaceTree(agentId, '.', { includeHidden: true, depth: 2 });

    expect(childNames(tree)).toEqual(['stable.txt']);
  });
});
