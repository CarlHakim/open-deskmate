import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createSubagentWorktree } from '@main/services/subagents/subagent-worktree';

it('creates an isolated branch without changing the source and rejects dirty sources', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'deskmate-subagent-worktree-'));
  const source = path.join(root, 'source'); mkdirSync(source);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, windowsHide: true, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  writeFileSync(path.join(source, 'example.txt'), 'original');
  git('add', 'example.txt');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture', '--quiet');
  const branch = git('branch', '--show-current');
  const result = await createSubagentWorktree(source, path.join(root, 'agent'), 'subrun_test');
  writeFileSync(path.join(result.path, 'example.txt'), 'child edit');
  expect(readFileSync(path.join(source, 'example.txt'), 'utf8')).toBe('original');
  expect(git('branch', '--show-current')).toBe(branch);
  expect(git('status', '--porcelain')).toBe('');
  const nested = await createSubagentWorktree(source, source, 'subrun_nested');
  const sibling = await createSubagentWorktree(source, source, 'subrun_sibling');
  expect(nested.path).not.toBe(sibling.path);
  writeFileSync(path.join(source, 'example.txt'), 'parent edit');
  await expect(createSubagentWorktree(source, path.join(root, 'agent'), 'subrun_second')).rejects.toThrow('uncommitted');
});
