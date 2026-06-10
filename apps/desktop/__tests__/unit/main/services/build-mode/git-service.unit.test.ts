import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, test } from 'vitest';
import {
  addBuildGitRemote,
  applyBuildGitStash,
  checkoutBuildGitRemoteBranch,
  classifyBuildGitActionFailure,
  commitBuildGitChanges,
  createBuildGitBranch,
  createBuildGitStash,
  discardBuildGitChanges,
  dropBuildGitStash,
  fetchBuildGitRemote,
  finishBuildGitMerge,
  listBuildGitStashes,
  pullBuildGitBranch,
  readBuildGitConflicts,
  readBuildGitMismatchSummary,
  readBuildGitSummary,
  resolveBuildGitMismatch,
  restoreBuildGitBackupBranch,
  stageBuildGitFiles,
  switchBuildGitBranch,
  updateBuildGitRemote,
} from '@main/services/build-mode/git-service';

const DEFAULT_AGENT_WORKSPACES_ROOT = process.platform === 'win32'
  ? 'C:/agent-workspaces'
  : path.join(os.homedir(), 'agent-workspaces');

const tempAgentRoots: string[] = [];

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function createAgentWorkspace(): { agentId: string; root: string } {
  const agentId = `git-test-${randomUUID()}`;
  const root = path.join(DEFAULT_AGENT_WORKSPACES_ROOT, agentId);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  tempAgentRoots.push(root);
  return { agentId, root };
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function initCommittedRepo(root: string): void {
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'OpenDeskmate Test']);
  fs.writeFileSync(path.join(root, 'README.md'), 'Initial file\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'Initial commit']);
}

function createBareRemote(): string {
  const remoteRoot = path.join(DEFAULT_AGENT_WORKSPACES_ROOT, `git-remote-${randomUUID()}.git`);
  fs.rmSync(remoteRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(remoteRoot), { recursive: true });
  execFileSync('git', ['init', '--bare', remoteRoot], { stdio: 'ignore' });
  tempAgentRoots.push(remoteRoot);
  return remoteRoot;
}

afterEach(() => {
  while (tempAgentRoots.length > 0) {
    const root = tempAgentRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('build Git summary service', () => {
  test.skipIf(!hasGit())('reports a non-repository workspace without failing', async () => {
    const { agentId } = createAgentWorkspace();

    const summary = await readBuildGitSummary(agentId, '.');

    expect(summary.git.available).toBe(true);
    expect(summary.isRepository).toBe(false);
    expect(summary.nextAction.kind).toBe('init');
    expect(summary.changedFileCount).toBe(0);
  });

  test.skipIf(!hasGit())('reports a clean local repository without remote as local-only', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);

    const summary = await readBuildGitSummary(agentId, '.');

    expect(summary.isRepository).toBe(true);
    expect(summary.dirty).toBe(false);
    expect(summary.changedFileCount).toBe(0);
    expect(summary.branch).toBeTruthy();
    expect(summary.remoteName).toBeUndefined();
    expect(summary.authStatus).toBe('not-required');
    expect(summary.nextAction.kind).toBe('add-remote');
    expect(summary.nextAction.detail).toMatch(/local Git repository/i);
  });

  test.skipIf(!hasGit())('reports modified and untracked files with line counts', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    fs.appendFileSync(path.join(root, 'README.md'), 'Changed line\n');
    fs.writeFileSync(path.join(root, 'new-file.txt'), 'New file\n');

    const summary = await readBuildGitSummary(agentId, '.');

    expect(summary.isRepository).toBe(true);
    expect(summary.hasChanges).toBe(true);
    expect(summary.changedFileCount).toBe(2);
    expect(summary.files.map((file) => file.relativePath).sort()).toEqual(['README.md', 'new-file.txt']);
    expect(summary.untrackedCount).toBe(1);
    expect(summary.totalAddedLines).toBeGreaterThanOrEqual(1);
    expect(summary.nextAction.kind).toBe('commit');
    expect(summary.nextAction.detail).toMatch(/nothing will be uploaded/i);
  });

  test.skipIf(!hasGit())('commits changed files locally and reports that nothing was uploaded without a remote', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    fs.appendFileSync(path.join(root, 'README.md'), 'Changed line\n');

    const result = await commitBuildGitChanges(agentId, '.', 'Update README locally');

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/committed locally/i);
    expect(result.message).toMatch(/nothing was uploaded/i);
    expect(result.summary?.hasChanges).toBe(false);
    expect(result.summary?.nextAction.kind).toBe('add-remote');
  });

  test.skipIf(!hasGit())('reports branch and configured remote details', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    git(root, ['remote', 'add', 'origin', 'https://github.com/example/example.git']);

    const summary = await readBuildGitSummary(agentId, '.');

    expect(summary.branch).toBeTruthy();
    expect(summary.remoteName).toBe('origin');
    expect(summary.remoteUrl).toBe('https://github.com/example/example.git');
    expect(summary.remoteProvider).toBe('github');
    expect(summary.repositoryHost).toBe('github.com');
    expect(summary.repositoryOwner).toBe('example');
    expect(summary.repositoryName).toBe('example');
    expect(summary.repositoryWebUrl).toBe('https://github.com/example/example');
    expect(typeof summary.githubCli.available).toBe('boolean');
    expect(['configured', 'missing', 'unknown']).toContain(summary.authStatus);
    expect(summary.authDetail).toBeTruthy();
  });

  test.skipIf(!hasGit())('parses GitLab and Bitbucket repository metadata from existing remotes', async () => {
    const gitlab = createAgentWorkspace();
    initCommittedRepo(gitlab.root);
    git(gitlab.root, ['remote', 'add', 'origin', 'git@gitlab.com:group/subgroup/project.git']);

    const gitlabSummary = await readBuildGitSummary(gitlab.agentId, '.');
    expect(gitlabSummary.remoteProvider).toBe('gitlab');
    expect(gitlabSummary.repositoryOwner).toBe('group/subgroup');
    expect(gitlabSummary.repositoryName).toBe('project');
    expect(gitlabSummary.repositoryWebUrl).toBe('https://gitlab.com/group/subgroup/project');

    const bitbucket = createAgentWorkspace();
    initCommittedRepo(bitbucket.root);
    git(bitbucket.root, ['remote', 'add', 'origin', 'https://bitbucket.org/workspace/repo.git']);

    const bitbucketSummary = await readBuildGitSummary(bitbucket.agentId, '.');
    expect(bitbucketSummary.remoteProvider).toBe('bitbucket');
    expect(bitbucketSummary.repositoryHost).toBe('bitbucket.org');
    expect(bitbucketSummary.repositoryOwner).toBe('workspace');
    expect(bitbucketSummary.repositoryName).toBe('repo');
  });

  test.skipIf(!hasGit())('adds a remote and offers first push with upstream', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);

    const result = await addBuildGitRemote(agentId, '.', {
      provider: 'github',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/example.git',
    });

    expect(result.ok).toBe(true);
    expect(result.summary?.remoteName).toBe('origin');
    expect(result.summary?.remoteUrl).toBe('https://github.com/example/example.git');
    expect(result.summary?.syncStatus).toBe('not-configured');
    expect(result.summary?.nextAction.kind).toBe('push');
    expect(result.summary?.nextAction.label).toMatch(/push and set upstream/i);
  });

  test.skipIf(!hasGit())('updates an existing remote URL', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    git(root, ['remote', 'add', 'origin', 'https://github.com/example/old.git']);

    const result = await updateBuildGitRemote(agentId, '.', {
      provider: 'gitlab',
      remoteName: 'origin',
      remoteUrl: 'https://gitlab.com/example/new.git',
    });

    expect(result.ok).toBe(true);
    expect(result.summary?.remoteUrl).toBe('https://gitlab.com/example/new.git');
    expect(result.summary?.remoteProvider).toBe('gitlab');
  });

  test.skipIf(!hasGit())('creates and switches branches only when the workspace is clean', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    const originalBranch = git(root, ['branch', '--show-current']).trim();

    const createResult = await createBuildGitBranch(agentId, '.', 'feature/test-branch');
    expect(createResult.ok).toBe(true);
    expect(createResult.summary?.branch).toBe('feature/test-branch');

    fs.appendFileSync(path.join(root, 'README.md'), 'Dirty work\n');
    const blockedSwitch = await switchBuildGitBranch(agentId, '.', originalBranch);
    expect(blockedSwitch.ok).toBe(false);
    expect(blockedSwitch.message).toMatch(/commit or discard/i);

    const discardResult = await discardBuildGitChanges(agentId, '.', ['README.md']);
    expect(discardResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n')).toBe('Initial file\n');

    const switchResult = await switchBuildGitBranch(agentId, '.', originalBranch);
    expect(switchResult.ok).toBe(true);
    expect(switchResult.summary?.branch).toBe(originalBranch);
  }, 30_000);

  test.skipIf(!hasGit())('saves changes aside, lists, applies, and drops the saved entry', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    fs.appendFileSync(path.join(root, 'README.md'), 'Work in progress\n');
    fs.writeFileSync(path.join(root, 'draft.txt'), 'Draft file\n');

    const stashResult = await createBuildGitStash(agentId, '.', 'Save test changes');
    expect(stashResult.ok).toBe(true);
    expect(stashResult.summary?.hasChanges).toBe(false);

    const stashes = await listBuildGitStashes(agentId, '.');
    expect(stashes.stashes[0]?.ref).toBe('stash@{0}');
    expect(stashes.stashes[0]?.message).toContain('Save test changes');

    const applyResult = await applyBuildGitStash(agentId, '.', 'stash@{0}');
    expect(applyResult.ok).toBe(true);
    expect(applyResult.summary?.hasChanges).toBe(true);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('Work in progress');
    expect(fs.existsSync(path.join(root, 'draft.txt'))).toBe(true);

    const dropResult = await dropBuildGitStash(agentId, '.', 'stash@{0}');
    expect(dropResult.ok).toBe(true);
    const afterDrop = await listBuildGitStashes(agentId, '.');
    expect(afterDrop.stashes).toHaveLength(0);
  }, 30_000);

  test.skipIf(!hasGit())('checks out a remote branch into a local tracking branch', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    const remoteRoot = createBareRemote();
    const branch = git(root, ['branch', '--show-current']).trim();
    git(root, ['remote', 'add', 'origin', remoteRoot]);
    git(root, ['push', '-u', 'origin', `HEAD:${branch}`]);
    execFileSync('git', ['-C', remoteRoot, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { stdio: 'ignore' });

    const cloneRoot = path.join(DEFAULT_AGENT_WORKSPACES_ROOT, `git-clone-${randomUUID()}`);
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    tempAgentRoots.push(cloneRoot);
    execFileSync('git', ['clone', remoteRoot, cloneRoot], { stdio: 'ignore' });
    git(cloneRoot, ['config', 'user.email', 'test@example.com']);
    git(cloneRoot, ['config', 'user.name', 'OpenDeskmate Test']);
    git(cloneRoot, ['switch', '-c', 'feature/remote-work']);
    fs.writeFileSync(path.join(cloneRoot, 'remote-work.txt'), 'Remote branch work\n');
    git(cloneRoot, ['add', 'remote-work.txt']);
    git(cloneRoot, ['commit', '-m', 'Remote branch work']);
    git(cloneRoot, ['push', '-u', 'origin', 'feature/remote-work']);

    const fetchResult = await fetchBuildGitRemote(agentId, '.');
    expect(fetchResult.ok).toBe(true);
    expect(fetchResult.summary?.branches.some((entry) => entry.remote && entry.name === 'origin/feature/remote-work')).toBe(true);

    const checkoutResult = await checkoutBuildGitRemoteBranch(agentId, '.', 'origin/feature/remote-work');
    expect(checkoutResult.ok).toBe(true);
    expect(checkoutResult.summary?.branch).toBe('feature/remote-work');
    expect(fs.existsSync(path.join(root, 'remote-work.txt'))).toBe(true);
  }, 30_000);

  test.skipIf(!hasGit())('fetches and pulls remote changes with a fast-forward update', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    const remoteRoot = createBareRemote();
    const branch = git(root, ['branch', '--show-current']).trim();
    git(root, ['remote', 'add', 'origin', remoteRoot]);
    git(root, ['push', '-u', 'origin', `HEAD:${branch}`]);
    execFileSync('git', ['-C', remoteRoot, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { stdio: 'ignore' });

    const cloneRoot = path.join(DEFAULT_AGENT_WORKSPACES_ROOT, `git-clone-${randomUUID()}`);
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    tempAgentRoots.push(cloneRoot);
    execFileSync('git', ['clone', remoteRoot, cloneRoot], { stdio: 'ignore' });
    git(cloneRoot, ['config', 'user.email', 'test@example.com']);
    git(cloneRoot, ['config', 'user.name', 'OpenDeskmate Test']);
    fs.appendFileSync(path.join(cloneRoot, 'README.md'), 'Remote line\n');
    git(cloneRoot, ['add', 'README.md']);
    git(cloneRoot, ['commit', '-m', 'Remote update']);
    git(cloneRoot, ['push']);

    const fetchResult = await fetchBuildGitRemote(agentId, '.');
    expect(fetchResult.ok).toBe(true);
    expect(fetchResult.summary?.behind).toBeGreaterThan(0);

    const pullResult = await pullBuildGitBranch(agentId, '.');
    expect(pullResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('Remote line');
    expect(pullResult.summary?.behind).toBe(0);
  }, 30_000);

  test.skipIf(!hasGit())('detects merge conflicts, stages resolved files, and finishes the merge commit', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    const remoteRoot = createBareRemote();
    const branch = git(root, ['branch', '--show-current']).trim();
    git(root, ['remote', 'add', 'origin', remoteRoot]);
    git(root, ['push', '-u', 'origin', `HEAD:${branch}`]);
    execFileSync('git', ['-C', remoteRoot, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { stdio: 'ignore' });

    const cloneRoot = path.join(DEFAULT_AGENT_WORKSPACES_ROOT, `git-clone-${randomUUID()}`);
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    tempAgentRoots.push(cloneRoot);
    execFileSync('git', ['clone', remoteRoot, cloneRoot], { stdio: 'ignore' });
    git(cloneRoot, ['config', 'user.email', 'test@example.com']);
    git(cloneRoot, ['config', 'user.name', 'OpenDeskmate Test']);
    fs.writeFileSync(path.join(cloneRoot, 'README.md'), 'Remote version\n');
    git(cloneRoot, ['add', 'README.md']);
    git(cloneRoot, ['commit', '-m', 'Remote conflicting update']);
    git(cloneRoot, ['push']);

    fs.writeFileSync(path.join(root, 'README.md'), 'Local version\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-m', 'Local conflicting update']);

    const fetchResult = await fetchBuildGitRemote(agentId, '.');
    expect(fetchResult.ok).toBe(true);
    const mergeResult = await resolveBuildGitMismatch(agentId, '.', { action: 'merge' });
    expect(mergeResult.ok).toBe(false);
    expect(mergeResult.summary?.conflictedCount).toBe(1);

    const conflicts = await readBuildGitConflicts(agentId, '.');
    expect(conflicts.files[0]?.relativePath).toBe('README.md');
    expect(conflicts.files[0]?.hunks[0]?.localContent).toContain('Local version');
    expect(conflicts.files[0]?.hunks[0]?.remoteContent).toContain('Remote version');

    fs.writeFileSync(path.join(root, 'README.md'), 'Local version\nRemote version\n');
    const stageResult = await stageBuildGitFiles(agentId, '.', { paths: ['README.md'] });
    expect(stageResult.ok).toBe(true);
    expect(stageResult.summary?.conflictedCount).toBe(0);

    const finishResult = await finishBuildGitMerge(agentId, '.', 'Merge remote conflicting update');
    expect(finishResult.ok).toBe(true);
    expect(finishResult.summary?.conflictedCount).toBe(0);
    expect(finishResult.summary?.ahead).toBeGreaterThan(0);
  }, 30_000);

  test.skipIf(!hasGit())('summarizes diverged branches and resets to remote with a backup branch', async () => {
    const { agentId, root } = createAgentWorkspace();
    initCommittedRepo(root);
    const remoteRoot = createBareRemote();
    const branch = git(root, ['branch', '--show-current']).trim();
    git(root, ['remote', 'add', 'origin', remoteRoot]);
    git(root, ['push', '-u', 'origin', `HEAD:${branch}`]);
    execFileSync('git', ['-C', remoteRoot, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { stdio: 'ignore' });

    const cloneRoot = path.join(DEFAULT_AGENT_WORKSPACES_ROOT, `git-clone-${randomUUID()}`);
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    tempAgentRoots.push(cloneRoot);
    execFileSync('git', ['clone', remoteRoot, cloneRoot], { stdio: 'ignore' });
    git(cloneRoot, ['config', 'user.email', 'test@example.com']);
    git(cloneRoot, ['config', 'user.name', 'OpenDeskmate Test']);
    fs.writeFileSync(path.join(cloneRoot, 'remote-only.txt'), 'Remote only\n');
    git(cloneRoot, ['add', 'remote-only.txt']);
    git(cloneRoot, ['commit', '-m', 'Remote only change']);
    git(cloneRoot, ['push']);

    fs.writeFileSync(path.join(root, 'local-only.txt'), 'Local only\n');
    git(root, ['add', 'local-only.txt']);
    git(root, ['commit', '-m', 'Local only change']);

    const fetchResult = await fetchBuildGitRemote(agentId, '.');
    expect(fetchResult.ok).toBe(true);

    const mismatch = await readBuildGitMismatchSummary(agentId, '.');
    expect(mismatch.ahead).toBe(1);
    expect(mismatch.behind).toBe(1);
    expect(mismatch.localCommits[0]?.subject).toBe('Local only change');
    expect(mismatch.remoteCommits[0]?.subject).toBe('Remote only change');
    expect(mismatch.canResetToRemote).toBe(true);

    const resetResult = await resolveBuildGitMismatch(agentId, '.', {
      action: 'reset-to-remote',
      backupBranchName: 'backup/test-reset',
    });
    expect(resetResult.ok).toBe(true);
    expect(resetResult.message).toMatch(/Backup branch "backup\/test-reset"/);
    expect(fs.existsSync(path.join(root, 'remote-only.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'local-only.txt'))).toBe(false);
    expect(git(root, ['branch', '--list', 'backup/test-reset'])).toContain('backup/test-reset');
    expect(resetResult.summary?.ahead).toBe(0);
    expect(resetResult.summary?.behind).toBe(0);

    const restored = await restoreBuildGitBackupBranch(agentId, '.', 'backup/test-reset');
    expect(restored.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'local-only.txt'))).toBe(true);
    expect(git(root, ['branch', '--list', 'backup/*'])).toContain('backup/test-reset');
  }, 30_000);

  test('classifies HTTPS credential failures as authentication problems', () => {
    const failure = classifyBuildGitActionFailure(
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      {
        remoteProvider: 'github',
        remoteName: 'origin',
        remoteUrl: 'https://github.com/example/example.git',
        authSetupHints: [],
      }
    );

    expect(failure.errorKind).toBe('auth');
    expect(failure.message).toMatch(/could not authenticate/i);
    expect(failure.hints.join(' ')).toMatch(/gh auth login|credential manager/i);
  });

  test('classifies SSH public key failures as authentication problems', () => {
    const failure = classifyBuildGitActionFailure(
      'git@github.com: Permission denied (publickey). fatal: Could not read from remote repository.',
      {
        remoteProvider: 'github',
        remoteName: 'origin',
        remoteUrl: 'git@github.com:example/example.git',
        authSetupHints: [],
      }
    );

    expect(failure.errorKind).toBe('auth');
    expect(failure.message).toMatch(/could not authenticate/i);
    expect(failure.hints.join(' ')).toMatch(/SSH key/i);
  });
});
