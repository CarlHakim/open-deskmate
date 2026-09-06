import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { SubagentRunRecord } from '@accomplish/shared';
const execFileAsync = promisify(execFile);

export async function createSubagentWorktree(sourcePath: string, agentRoot: string, runId: string): Promise<NonNullable<SubagentRunRecord['worktree']>> {
  const git = async (args: string[]) => (await execFileAsync('git', args, { cwd: sourcePath, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const sourceRoot = await git(['rev-parse', '--show-toplevel']);
  if (path.resolve(sourceRoot).toLowerCase() !== path.resolve(sourcePath).toLowerCase()) throw new Error('Isolated subagents require the repository root as the working folder.');
  const registeredWorktrees = (await git(['worktree', 'list', '--porcelain'])).split(/\r?\n/)
    .filter(line => line.startsWith('worktree ')).map(line => path.resolve(line.slice(9)).toLowerCase());
  const dirty = (await git(['status', '--porcelain', '--untracked-files=all'])).split(/\r?\n/).filter(Boolean)
    .some(line => !(line.startsWith('?? ') && registeredWorktrees.includes(path.resolve(sourcePath, line.slice(3)).toLowerCase())));
  if (dirty) throw new Error('The repository has uncommitted changes. Use shared file assignments, or commit changes before creating an isolated subagent.');
  const baseCommit = await git(['rev-parse', 'HEAD']);
  if (!/^subrun_[a-z0-9-]+$/i.test(runId)) throw new Error('Invalid subagent worktree id');
  const worktreePath = path.resolve(agentRoot, '.subagent-worktrees', runId);
  const branch = `codex/subagent-${runId}`;
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(['worktree', 'add', '-b', branch, worktreePath, baseCommit]);
  // Keep the worktree for review. No automatic deletion, checkout, or merge.
  return { path: worktreePath, branch, sourcePath: sourceRoot, baseCommit };
}
