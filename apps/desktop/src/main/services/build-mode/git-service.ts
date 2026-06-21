import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type {
  BuildGitActionErrorKind,
  BuildGitActionResult,
  BuildGitAuthMethod,
  BuildGitAuthStatus,
  BuildGitBackupBranch,
  BuildGitBranch,
  BuildGitChangedFile,
  BuildGitChangedFileStatus,
  BuildGitConflictFile,
  BuildGitConflictHunk,
  BuildGitInProgressOperation,
  BuildGitMismatchCommit,
  BuildGitMismatchSummary,
  BuildGitNextAction,
  BuildGitPullRequestCreateInput,
  BuildGitPullRequestCreateResult,
  BuildGitReflogEntry,
  BuildGitRemoteInput,
  BuildGitRemoteRepositoryCreateInput,
  BuildGitRemoteRepositoryCreateResult,
  BuildGitResolveMismatchInput,
  BuildGitStageInput,
  BuildGitStashEntry,
  BuildGitSummary,
  BuildGitSyncStatus,
  BuildGitToolStatus,
} from '@accomplish/shared';
import { resolvePathInWorkspace } from './file-service';

const GIT_COMMAND_TIMEOUT_MS = 20_000;

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function runCommand(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: `${command} timed out.`,
      });
    }, options?.timeoutMs ?? GIT_COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

function runGit(workspace: string, args: string[]): Promise<CommandResult> {
  return runCommand('git', ['-C', workspace, ...args], { cwd: workspace });
}

function normalizeWorkspaceRelativePath(input?: string): string {
  const trimmed = String(input || '.').trim();
  return trimmed || '.';
}

function normalizeRemoteName(input: string): string {
  const remoteName = String(input || '').trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(remoteName)) {
    throw new Error('Remote name can only contain letters, numbers, dots, underscores, and dashes.');
  }
  return remoteName;
}

function normalizeRemoteUrl(input: string): string {
  const remoteUrl = String(input || '').trim();
  const allowed = /^(https?:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[A-Za-z0-9._-]+:[^\s]+)$/i.test(remoteUrl);
  if (!allowed) {
    throw new Error('Remote URL must be an HTTPS or SSH Git URL.');
  }
  return remoteUrl;
}

function normalizeGhRepositoryName(input: string | undefined, fallbackName: string | undefined): string {
  const raw = String(input || fallbackName || '').trim();
  const normalized = raw
    .replace(/\\/g, '/')
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  if (!normalized || normalized.length > 200 || normalized.includes('..')) {
    throw new Error('Repository name must be a valid GitHub repository name, such as owner/repo or repo.');
  }
  return normalized;
}

function buildProviderManualRemoteGuide(provider: BuildGitRemoteInput['provider'] | undefined, repositoryName: string, remoteName: string): string[] {
  const label = getGitProviderLabel(provider);
  if (provider === 'gitlab') {
    return [
      'Create a new project in GitLab.',
      `Copy the GitLab HTTPS or SSH clone URL for "${repositoryName}".`,
      `Use Add remote in this panel and set remote name "${remoteName}" to that URL.`,
      'Commit locally, then use Push updates.',
    ];
  }
  if (provider === 'bitbucket') {
    return [
      'Create a new repository in Bitbucket.',
      `Copy the Bitbucket HTTPS or SSH clone URL for "${repositoryName}".`,
      `Use Add remote in this panel and set remote name "${remoteName}" to that URL.`,
      'Commit locally, then use Push updates.',
    ];
  }
  if (provider === 'github') {
    return [
      'Install and sign in to GitHub CLI with: gh auth login',
      `Then create the repository manually on GitHub or run: gh repo create ${repositoryName} --private --source . --remote ${remoteName}`,
      'Return here, refresh Git status, then push updates.',
    ];
  }
  return [
    `Create a repository on ${label}.`,
    `Copy the repository HTTPS or SSH clone URL for "${repositoryName}".`,
    `Use Add remote in this panel and set remote name "${remoteName}" to that URL.`,
  ];
}

function buildProviderManualPrGuide(provider: BuildGitRemoteInput['provider'] | undefined, repositoryName: string): string[] {
  const label = getGitProviderLabel(provider);
  if (provider === 'gitlab') {
    return [
      `Open the GitLab project "${repositoryName}".`,
      'Choose Merge requests, then New merge request.',
      'Select this branch as the source branch and the target branch you want to merge into.',
    ];
  }
  if (provider === 'bitbucket') {
    return [
      `Open the Bitbucket repository "${repositoryName}".`,
      'Choose Pull requests, then Create pull request.',
      'Select this branch as the source branch and the target branch you want to merge into.',
    ];
  }
  if (provider === 'github') {
    return [
      'Install and sign in to GitHub CLI with: gh auth login',
      'Push this branch, then create a pull request from the GitHub repository page.',
    ];
  }
  return [
    `Open the repository on ${label}.`,
    'Use its pull request or merge request flow for the current branch.',
  ];
}

function inferRemoteProvider(host: string): BuildGitRemoteInput['provider'] {
  const normalizedHost = host.toLowerCase();
  if (normalizedHost.includes('github')) return 'github';
  if (normalizedHost.includes('gitlab')) return 'gitlab';
  if (normalizedHost.includes('bitbucket')) return 'bitbucket';
  return 'custom';
}

function parseRemoteRepositoryMetadata(remoteUrl: string | undefined): Pick<
  BuildGitSummary,
  'remoteProvider' | 'repositoryHost' | 'repositoryOwner' | 'repositoryName' | 'repositoryWebUrl'
> {
  const url = String(remoteUrl || '').trim();
  if (!url) return {};

  let host = '';
  let repositoryPath = '';

  if (/^https?:\/\//i.test(url) || /^ssh:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      repositoryPath = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return {};
    }
  } else {
    const sshMatch = /^git@([^:]+):(.+)$/i.exec(url);
    if (sshMatch) {
      host = sshMatch[1] || '';
      repositoryPath = sshMatch[2] || '';
    }
  }

  const cleanPath = repositoryPath
    .replace(/\/+$/g, '')
    .replace(/\.git$/i, '');
  const segments = cleanPath.split('/').filter(Boolean);
  if (!host || segments.length < 2) {
    return {
      repositoryHost: host || undefined,
      remoteProvider: host ? inferRemoteProvider(host) : undefined,
    };
  }

  const repositoryName = segments[segments.length - 1];
  const repositoryOwner = segments.slice(0, -1).join('/');
  return {
    remoteProvider: inferRemoteProvider(host),
    repositoryHost: host,
    repositoryOwner,
    repositoryName,
    repositoryWebUrl: `https://${host}/${segments.join('/')}`,
  };
}

function getRemoteProtocol(remoteUrl: string | undefined): 'https' | 'ssh' | 'other' | undefined {
  const url = String(remoteUrl || '').trim();
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return 'https';
  if (/^(ssh:\/\/|git@)/i.test(url)) return 'ssh';
  return 'other';
}

function getGitProviderLabel(provider: BuildGitRemoteInput['provider'] | undefined): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'gitlab') return 'GitLab';
  if (provider === 'bitbucket') return 'Bitbucket';
  return 'your Git host';
}

function getAuthSetupHints(provider: BuildGitRemoteInput['provider'] | undefined, protocol?: 'https' | 'ssh' | 'other'): string[] {
  if (protocol === 'ssh') {
    const host = provider === 'github'
      ? 'git@github.com'
      : provider === 'gitlab'
        ? 'git@gitlab.com'
        : provider === 'bitbucket'
          ? 'git@bitbucket.org'
          : 'git@your-host';
    return [
      `Make sure an SSH key for ${getGitProviderLabel(provider)} is added to your account.`,
      `If push fails, test SSH outside the app with: ssh -T ${host}`,
    ];
  }

  if (provider === 'github') {
    return [
      'Sign in with GitHub CLI: gh auth login, then run gh auth setup-git.',
      'Or use Git Credential Manager with a GitHub personal access token.',
      'Or switch the remote URL to SSH after adding an SSH key to GitHub.',
    ];
  }
  if (provider === 'gitlab') {
    return [
      'Use Git Credential Manager with a GitLab personal access token for HTTPS pushes.',
      'Or switch the remote URL to SSH after adding an SSH key to GitLab.',
    ];
  }
  if (provider === 'bitbucket') {
    return [
      'Use Git Credential Manager with a Bitbucket app password for HTTPS pushes.',
      'Or switch the remote URL to SSH after adding an SSH key to Bitbucket.',
    ];
  }
  return [
    'Configure credentials in your system Git client or Git Credential Manager.',
    'Or switch the remote URL to SSH after adding an SSH key to your Git host.',
  ];
}

function normalizeBranchName(input: string | undefined, fallback: string | undefined): string {
  const branchName = String(input || fallback || '').trim();
  if (!branchName || branchName === 'detached HEAD') {
    throw new Error('A branch name is required before pushing.');
  }
  if (
    branchName.includes('..')
    || branchName.startsWith('/')
    || branchName.endsWith('/')
    || branchName.endsWith('.')
    || /[\s~^:?*[\]\\]/.test(branchName)
    || !/^[A-Za-z0-9._/-]{1,200}$/.test(branchName)
  ) {
    throw new Error('Branch name contains characters Git cannot use.');
  }
  return branchName;
}

function normalizeGitRelativePath(input: string): string {
  const relativePath = String(input || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    !relativePath
    || relativePath === '.'
    || relativePath.startsWith('/')
    || /^[A-Za-z]:\//.test(relativePath)
    || relativePath.split('/').some((part) => part === '..')
    || relativePath.length > 500
  ) {
    throw new Error('Selected Git path is not valid for this workspace.');
  }
  return relativePath;
}

function normalizeBackupBranchName(input: string | undefined, currentBranch: string | undefined): string {
  const branchStem = String(currentBranch || 'branch')
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
    || 'branch';
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  return normalizeBranchName(input, `backup/${branchStem}-${timestamp}`);
}

async function resolveWorkspaceDirectory(agentId: string, relativePath?: string): Promise<{ workspace: string; workspaceRelativePath: string }> {
  const workspaceRelativePath = normalizeWorkspaceRelativePath(relativePath);
  const workspace = resolvePathInWorkspace(agentId, workspaceRelativePath);
  const stat = await fs.promises.stat(workspace);
  if (!stat.isDirectory()) {
    throw new Error(`Build Git actions require a workspace directory: ${workspaceRelativePath}`);
  }
  return { workspace, workspaceRelativePath };
}

async function getGitToolStatus(): Promise<BuildGitToolStatus> {
  const result = await runCommand('git', ['--version']);
  if (result.error || result.exitCode !== 0) {
    return {
      available: false,
      error: result.error || result.stderr.trim() || 'Git is not available on PATH.',
    };
  }
  return {
    available: true,
    version: result.stdout.trim(),
  };
}

async function getGitHubCliStatus(workspace: string): Promise<BuildGitToolStatus> {
  const version = await runCommand('gh', ['--version'], { cwd: workspace, timeoutMs: 8_000 });
  if (version.error || version.exitCode !== 0) {
    return {
      available: false,
      error: version.error || version.stderr.trim() || 'GitHub CLI is not available on PATH.',
    };
  }

  const auth = await runCommand('gh', ['auth', 'status'], { cwd: workspace, timeoutMs: 8_000 });
  const detail = (auth.stderr || auth.stdout).trim();
  return {
    available: true,
    version: version.stdout.split(/\r?\n/)[0]?.trim() || 'gh',
    authenticated: auth.exitCode === 0,
    detail: detail || (auth.exitCode === 0 ? 'GitHub CLI is authenticated.' : 'GitHub CLI is installed but not authenticated.'),
    error: auth.exitCode === 0 ? undefined : detail || 'GitHub CLI is not authenticated.',
  };
}

async function getGitCredentialHelpers(workspace: string): Promise<string[]> {
  const result = await runGit(workspace, ['config', '--get-all', 'credential.helper']);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasGitAuthEnvironment(): boolean {
  return Boolean(
    process.env.GITHUB_TOKEN
    || process.env.GH_TOKEN
    || process.env.GIT_ASKPASS
    || process.env.SSH_AUTH_SOCK
  );
}

async function readGitAuthStatus(
  workspace: string,
  remote: {
    remoteName?: string;
    remoteUrl?: string;
    remoteProvider?: BuildGitRemoteInput['provider'];
    repositoryHost?: string;
  },
  githubCli: BuildGitToolStatus
): Promise<Pick<BuildGitSummary, 'authStatus' | 'authMethod' | 'authDetail' | 'authSetupHints'>> {
  if (!remote.remoteName || !remote.remoteUrl) {
    return {
      authStatus: 'not-required',
      authMethod: 'none',
      authDetail: 'No remote is configured, so push credentials are not needed yet.',
      authSetupHints: [],
    };
  }

  const protocol = getRemoteProtocol(remote.remoteUrl);
  const providerLabel = getGitProviderLabel(remote.remoteProvider);
  const hints = getAuthSetupHints(remote.remoteProvider, protocol);

  if (protocol === 'ssh') {
    return {
      authStatus: 'unknown',
      authMethod: 'ssh',
      authDetail: `Remote "${remote.remoteName}" uses SSH. Git will use your SSH key or agent when pushing; the app cannot verify that key without attempting network authentication.`,
      authSetupHints: hints,
    };
  }

  if (hasGitAuthEnvironment()) {
    return {
      authStatus: 'configured',
      authMethod: 'environment',
      authDetail: 'A Git authentication environment variable or SSH agent is available to the app process.',
      authSetupHints: hints,
    };
  }

  if (remote.remoteProvider === 'github' && githubCli.available && githubCli.authenticated) {
    return {
      authStatus: 'configured',
      authMethod: 'github-cli',
      authDetail: 'GitHub CLI is signed in. If Git still asks for credentials, run gh auth setup-git once outside the app.',
      authSetupHints: hints,
    };
  }

  const helpers = await getGitCredentialHelpers(workspace);
  if (helpers.length > 0) {
    return {
      authStatus: 'configured',
      authMethod: 'credential-helper',
      authDetail: `Git credential helper configured: ${helpers.join(', ')}. Push will use your system Git credentials.`,
      authSetupHints: hints,
    };
  }

  if (protocol === 'https') {
    return {
      authStatus: 'missing',
      authMethod: 'none',
      authDetail: `${providerLabel} remote uses HTTPS, but no Git credential helper or authenticated GitHub CLI was detected. Push may fail until credentials are configured.`,
      authSetupHints: hints,
    };
  }

  return {
    authStatus: 'unknown',
    authMethod: 'unknown',
    authDetail: `The app could not determine how Git will authenticate with ${providerLabel}.`,
    authSetupHints: hints,
  };
}

function cleanGitPath(input: string): string {
  let value = input.trim();
  if (value.includes(' -> ')) {
    value = value.split(' -> ').pop() || value;
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\t/g, '\t')
      .replace(/\\n/g, '\n');
  }
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function mapStatus(indexStatus: string, workingTreeStatus: string): BuildGitChangedFileStatus {
  const combined = `${indexStatus}${workingTreeStatus}`;
  if (indexStatus === '?' && workingTreeStatus === '?') return 'untracked';
  if (combined.includes('U') || ['AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(combined)) return 'conflicted';
  if (indexStatus === 'R' || workingTreeStatus === 'R') return 'renamed';
  if (indexStatus === 'C' || workingTreeStatus === 'C') return 'copied';
  if (indexStatus === 'A' || workingTreeStatus === 'A') return 'added';
  if (indexStatus === 'D' || workingTreeStatus === 'D') return 'deleted';
  if (indexStatus === 'M' || workingTreeStatus === 'M') return 'modified';
  return 'unknown';
}

function parseBranchLine(line: string | undefined): { branch?: string; ahead: number; behind: number } {
  if (!line?.startsWith('## ')) return { ahead: 0, behind: 0 };
  const body = line.slice(3).trim();
  const ahead = Number.parseInt(/ahead (\d+)/.exec(body)?.[1] || '0', 10);
  const behind = Number.parseInt(/behind (\d+)/.exec(body)?.[1] || '0', 10);
  let branch = body.split('...')[0]?.trim() || undefined;
  if (branch) {
    branch = branch.replace(/\s+\[.*$/, '').trim();
    const noCommitsPrefix = 'No commits yet on ';
    if (branch.startsWith(noCommitsPrefix)) {
      branch = branch.slice(noCommitsPrefix.length).trim();
    }
    if (branch === 'HEAD (no branch)') {
      branch = 'detached HEAD';
    }
  }
  return { branch, ahead, behind };
}

function parseStatus(output: string): { branch?: string; ahead: number; behind: number; files: BuildGitChangedFile[] } {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const branchInfo = parseBranchLine(lines.find((line) => line.startsWith('## ')));
  const files = lines
    .filter((line) => !line.startsWith('## '))
    .map((line): BuildGitChangedFile | null => {
      if (line.length < 4) return null;
      const indexStatus = line[0] || ' ';
      const workingTreeStatus = line[1] || ' ';
      const relativePath = cleanGitPath(line.slice(3));
      if (!relativePath) return null;
      const untracked = indexStatus === '?' && workingTreeStatus === '?';
      return {
        relativePath,
        status: mapStatus(indexStatus, workingTreeStatus),
        indexStatus,
        workingTreeStatus,
        staged: !untracked && indexStatus !== ' ',
        unstaged: !untracked && workingTreeStatus !== ' ',
        untracked,
        addedLines: 0,
        deletedLines: 0,
      };
    })
    .filter((file): file is BuildGitChangedFile => Boolean(file));
  return { ...branchInfo, files };
}

function parseNumstat(output: string): Map<string, { addedLines: number; deletedLines: number }> {
  const stats = new Map<string, { addedLines: number; deletedLines: number }>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const relativePath = cleanGitPath(parts.slice(2).join('\t'));
    if (!relativePath) continue;
    const added = Number.parseInt(parts[0] || '0', 10);
    const deleted = Number.parseInt(parts[1] || '0', 10);
    const existing = stats.get(relativePath) || { addedLines: 0, deletedLines: 0 };
    existing.addedLines += Number.isFinite(added) ? added : 0;
    existing.deletedLines += Number.isFinite(deleted) ? deleted : 0;
    stats.set(relativePath, existing);
  }
  return stats;
}

function mergeLineStats(
  files: BuildGitChangedFile[],
  unstagedStats: Map<string, { addedLines: number; deletedLines: number }>,
  stagedStats: Map<string, { addedLines: number; deletedLines: number }>
): BuildGitChangedFile[] {
  return files.map((file) => {
    const unstaged = unstagedStats.get(file.relativePath);
    const staged = stagedStats.get(file.relativePath);
    return {
      ...file,
      addedLines: (unstaged?.addedLines || 0) + (staged?.addedLines || 0),
      deletedLines: (unstaged?.deletedLines || 0) + (staged?.deletedLines || 0),
    };
  });
}

function getAuthWarnings(summary: Omit<BuildGitSummary, 'nextAction'>): string[] {
  if (!summary.remoteName || summary.authStatus === 'not-required' || summary.authStatus === 'configured') return [];
  if (summary.authStatus === 'missing') {
    return ['Git credentials are not configured for this remote. Push may fail until you sign in or configure credentials.'];
  }
  if (summary.authStatus === 'unknown') {
    return ['Git credentials could not be verified. Push will use your system Git, SSH, or credential-manager setup.'];
  }
  if (summary.authStatus === 'failed') {
    return ['Git authentication failed last time. Fix credentials before pushing again.'];
  }
  return [];
}

function makeNextAction(summary: Omit<BuildGitSummary, 'nextAction'>): BuildGitNextAction {
  if (!summary.git.available) {
    return {
      kind: 'install-git',
      label: 'Install Git',
      detail: 'Git is not available, so this panel can only show the existing diff preview.',
      disabled: true,
    };
  }
  if (!summary.isRepository) {
    return {
      kind: 'init',
      label: 'Initialize Git',
      detail: 'Create a local Git repository for this workspace before committing changes.',
    };
  }
  if (summary.conflictedCount > 0) {
    return {
      kind: 'review',
      label: 'Resolve conflicts',
      detail: `${summary.conflictedCount} conflicted file${summary.conflictedCount === 1 ? '' : 's'} need attention before committing, pulling, or pushing.`,
      disabled: true,
      warnings: ['Resolve the conflicted files in the editor, or discard selected conflicted changes if you want to return to the last committed version.'],
    };
  }
  if (summary.hasChanges) {
    const warnings = [
      summary.untrackedCount > 0
        ? `${summary.untrackedCount} untracked file${summary.untrackedCount === 1 ? '' : 's'} will be included if you commit.`
        : '',
      !summary.remoteName
        ? 'No remote is configured. This commit will stay local on this computer until you add a GitHub or other Git remote.'
        : '',
      summary.remoteName && !summary.upstream
        ? 'This branch has no upstream branch. The commit will stay local until an upstream is configured.'
        : '',
    ].filter(Boolean);
    return {
      kind: 'commit',
      label: 'Commit locally',
      detail: !summary.remoteName
        ? 'Create a local commit. This workspace has no remote, so nothing will be uploaded to GitHub.'
        : 'Review the changed files, then create a local commit for this workspace.',
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
  if (summary.ahead > 0) {
    if (summary.behind > 0) {
      return {
        kind: 'review',
        label: 'Branches diverged',
        detail: `This branch has ${summary.ahead} local commit${summary.ahead === 1 ? '' : 's'} and is ${summary.behind} remote commit${summary.behind === 1 ? '' : 's'} behind. Fetch and review before merging.`,
        disabled: true,
        warnings: ['The app will not auto-merge diverged branches. Commit or save local work, fetch latest status, then resolve the branch mismatch deliberately.'],
      };
    }
    if (summary.upstream) {
      return {
        kind: 'push',
        label: 'Push branch',
        detail: `${summary.ahead} local commit${summary.ahead === 1 ? '' : 's'} can be pushed to ${summary.upstream}.`,
        warnings: getAuthWarnings(summary),
      };
    }
    return {
      kind: 'set-upstream',
      label: 'Set upstream',
      detail: 'This branch has local commits but no upstream branch. Set an upstream in Git before pushing from this panel.',
      disabled: true,
    };
  }
  if (!summary.remoteName) {
    return {
      kind: 'add-remote',
      label: 'Add remote to publish',
      detail: 'This is a local Git repository with no GitHub or other remote configured. Commits are saved locally only until you add a remote.',
    };
  }
  if (summary.behind > 0 && summary.upstream) {
    return {
      kind: 'pull',
      label: 'Pull remote changes',
      detail: `${summary.behind} remote commit${summary.behind === 1 ? '' : 's'} can be pulled with a fast-forward update.`,
    };
  }
  if (summary.syncStatus === 'remote-changed') {
    return {
      kind: 'fetch',
      label: 'Fetch latest status',
      detail: 'The remote branch changed since the local remote reference was last updated. Fetch before deciding the next action.',
    };
  }
  if (!summary.upstream && summary.branch && summary.branch !== 'detached HEAD' && summary.commit) {
    return {
      kind: 'push',
      label: 'Push and set upstream',
      detail: `Push the current branch to ${summary.remoteName} and set it as the upstream branch.`,
      warnings: getAuthWarnings(summary),
    };
  }
  if (!summary.upstream) {
    return {
      kind: 'set-upstream',
      label: 'Set upstream',
      detail: 'A remote exists, but this branch has no upstream branch. Set an upstream before pushing from this panel.',
      disabled: true,
    };
  }
  return {
    kind: 'none',
    label: 'No Git action needed',
    detail: 'There are no local changes or unpushed commits in this workspace.',
    disabled: true,
  };
}

async function readRemoteDetails(workspace: string, branch?: string): Promise<{
  remoteName?: string;
  remoteUrl?: string;
  remoteProvider?: BuildGitRemoteInput['provider'];
  repositoryHost?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryWebUrl?: string;
  upstream?: string;
}> {
  const [remoteResult, upstreamResult, remoteListResult] = await Promise.all([
    branch && branch !== 'detached HEAD'
      ? runGit(workspace, ['config', '--get', `branch.${branch}.remote`])
      : Promise.resolve({ exitCode: 1, stdout: '', stderr: '' } satisfies CommandResult),
    branch && branch !== 'detached HEAD'
      ? runGit(workspace, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      : Promise.resolve({ exitCode: 1, stdout: '', stderr: '' } satisfies CommandResult),
    runGit(workspace, ['remote']),
  ]);
  const configuredRemoteName = remoteResult.exitCode === 0 ? remoteResult.stdout.trim() || undefined : undefined;
  const firstRemoteName = remoteListResult.exitCode === 0
    ? remoteListResult.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    : undefined;
  const remoteName = configuredRemoteName || firstRemoteName;
  const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() || undefined : undefined;
  const remoteUrlResult = remoteName ? await runGit(workspace, ['remote', 'get-url', remoteName]) : null;
  const remoteUrl = remoteUrlResult?.exitCode === 0 ? remoteUrlResult.stdout.trim() || undefined : undefined;
  return {
    remoteName,
    remoteUrl,
    ...parseRemoteRepositoryMetadata(remoteUrl),
    upstream,
  };
}

async function readSyncStatus(
  workspace: string,
  remote: { remoteName?: string; upstream?: string },
  ahead: number,
  behind: number
): Promise<{ syncStatus: BuildGitSyncStatus; syncDetail: string }> {
  if (!remote.remoteName) {
    return {
      syncStatus: 'not-configured',
      syncDetail: 'No remote is configured. This repository is local only.',
    };
  }
  if (!remote.upstream) {
    return {
      syncStatus: 'not-configured',
      syncDetail: `Remote "${remote.remoteName}" exists, but this branch has no upstream branch yet.`,
    };
  }
  if (ahead > 0 && behind > 0) {
    return {
      syncStatus: 'diverged',
      syncDetail: `This branch is ${ahead} commit${ahead === 1 ? '' : 's'} ahead and ${behind} behind ${remote.upstream}.`,
    };
  }
  if (behind > 0) {
    return {
      syncStatus: 'behind',
      syncDetail: `This branch is ${behind} commit${behind === 1 ? '' : 's'} behind ${remote.upstream}. Pull or review remote changes before pushing.`,
    };
  }
  if (ahead > 0) {
    return {
      syncStatus: 'ahead',
      syncDetail: `This branch has ${ahead} local commit${ahead === 1 ? '' : 's'} waiting to push to ${remote.upstream}.`,
    };
  }

  const remoteBranch = remote.upstream.startsWith(`${remote.remoteName}/`)
    ? remote.upstream.slice(remote.remoteName.length + 1)
    : '';
  if (remoteBranch) {
    const [localUpstream, remoteHead] = await Promise.all([
      runGit(workspace, ['rev-parse', remote.upstream]),
      runGit(workspace, ['ls-remote', remote.remoteName, `refs/heads/${remoteBranch}`]),
    ]);
    const localHash = localUpstream.exitCode === 0 ? localUpstream.stdout.trim() : '';
    const remoteHash = remoteHead.exitCode === 0 ? remoteHead.stdout.trim().split(/\s+/)[0] || '' : '';
    if (localHash && remoteHash && localHash !== remoteHash) {
      return {
        syncStatus: 'remote-changed',
        syncDetail: `The remote branch ${remote.upstream} has changed since the local remote reference was last updated.`,
      };
    }
  }

  return {
    syncStatus: 'up-to-date',
    syncDetail: `This branch is up to date with ${remote.upstream}.`,
  };
}

async function readBranches(workspace: string): Promise<BuildGitBranch[]> {
  const [localResult, remoteResult] = await Promise.all([
    runGit(workspace, ['branch', '--format=%(refname:short)\t%(upstream:short)\t%(HEAD)']),
    runGit(workspace, ['branch', '--remotes', '--format=%(refname:short)']),
  ]);
  const branches: BuildGitBranch[] = [];
  if (localResult.exitCode === 0) {
    for (const line of localResult.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [name = '', upstream = '', head = ''] = line.split('\t');
      const branchName = name.trim();
      if (!branchName) continue;
      branches.push({
        name: branchName,
        current: head.trim() === '*',
        upstream: upstream.trim() || undefined,
      });
    }
  }
  if (remoteResult.exitCode === 0) {
    const existing = new Set(branches.map((branch) => branch.name));
    for (const line of remoteResult.stdout.split(/\r?\n/)) {
      const branchName = line.trim();
      if (!branchName || branchName.endsWith('/HEAD') || existing.has(branchName)) continue;
      branches.push({
        name: branchName,
        current: false,
        remote: true,
      });
    }
  }
  return branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (Boolean(left.remote) !== Boolean(right.remote)) return left.remote ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}

async function gitPathExists(workspace: string, gitPath: string): Promise<boolean> {
  const result = await runGit(workspace, ['rev-parse', '--git-path', gitPath]);
  if (result.exitCode !== 0) return false;
  const resolved = result.stdout.trim();
  if (!resolved) return false;
  const absolutePath = fs.existsSync(resolved) || /^[A-Za-z]:[\\/]/.test(resolved)
    ? resolved
    : `${workspace}/${resolved}`;
  return fs.existsSync(absolutePath);
}

async function readInProgressOperation(workspace: string): Promise<BuildGitInProgressOperation> {
  if (await gitPathExists(workspace, 'rebase-merge') || await gitPathExists(workspace, 'rebase-apply')) {
    return 'rebase';
  }
  if (await gitPathExists(workspace, 'MERGE_HEAD')) {
    return 'merge';
  }
  return 'none';
}

function parseGitLogCommits(output: string): BuildGitMismatchCommit[] {
  return output
    .split(/\r?\n/)
    .map((line): BuildGitMismatchCommit | null => {
      if (!line.trim()) return null;
      const [hash = '', shortHash = '', author = '', date = '', ...subjectParts] = line.split('\t');
      const subject = subjectParts.join('\t').trim();
      if (!hash.trim()) return null;
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim() || hash.trim().slice(0, 7),
        author: author.trim() || undefined,
        date: date.trim() || undefined,
        subject: subject || '(no commit message)',
      };
    })
    .filter((commit): commit is BuildGitMismatchCommit => Boolean(commit));
}

async function readCommitRange(workspace: string, range: string, maxCount = 20): Promise<BuildGitMismatchCommit[]> {
  const result = await runGit(workspace, [
    'log',
    `--max-count=${maxCount}`,
    '--date=iso-strict',
    '--format=%H%x09%h%x09%an%x09%ad%x09%s',
    range,
  ]);
  if (result.exitCode !== 0) return [];
  return parseGitLogCommits(result.stdout);
}

async function createBackupBranch(workspace: string, currentBranch: string | undefined, backupBranchName?: string): Promise<{ ok: boolean; name: string; result: CommandResult }> {
  const name = normalizeBackupBranchName(backupBranchName, currentBranch);
  const result = await runGit(workspace, ['branch', name, 'HEAD']);
  return { ok: result.exitCode === 0, name, result };
}

function resolveGitFilePath(workspace: string, relativePath: string): string {
  const normalized = normalizeGitRelativePath(relativePath);
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Selected Git path is outside this workspace.');
  }
  return resolved;
}

function parseConflictHunks(content: string): BuildGitConflictHunk[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const hunks: BuildGitConflictHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const marker = lines[index] || '';
    if (!marker.startsWith('<<<<<<<')) {
      index += 1;
      continue;
    }
    const startLine = index + 1;
    const localLabel = marker.replace(/^<<<<<<<\s*/, '').trim() || 'local';
    const localLines: string[] = [];
    const remoteLines: string[] = [];
    index += 1;
    while (index < lines.length && !(lines[index] || '').startsWith('=======')) {
      localLines.push(lines[index] || '');
      index += 1;
    }
    if (index >= lines.length) break;
    index += 1;
    while (index < lines.length && !(lines[index] || '').startsWith('>>>>>>>')) {
      remoteLines.push(lines[index] || '');
      index += 1;
    }
    if (index >= lines.length) break;
    const remoteLabel = (lines[index] || '').replace(/^>>>>>>>\s*/, '').trim() || 'remote';
    const endLine = index + 1;
    hunks.push({
      id: `hunk-${hunks.length + 1}-${startLine}`,
      startLine,
      endLine,
      localLabel,
      remoteLabel,
      localContent: localLines.join('\n'),
      remoteContent: remoteLines.join('\n'),
    });
    index += 1;
  }
  return hunks;
}

async function readConflictFiles(workspace: string, summary: BuildGitSummary): Promise<BuildGitConflictFile[]> {
  if (!summary.isRepository || summary.conflictedCount === 0) return [];
  const conflictFiles = summary.files.filter((file) => file.status === 'conflicted');
  const result: BuildGitConflictFile[] = [];
  for (const file of conflictFiles) {
    let content = '';
    try {
      content = await fs.promises.readFile(resolveGitFilePath(workspace, file.relativePath), 'utf8');
    } catch {
      content = '';
    }
    result.push({
      relativePath: file.relativePath,
      status: file.status,
      hunks: parseConflictHunks(content),
      contentPreview: content.slice(0, 40_000),
    });
  }
  return result;
}

async function readMergeBase(workspace: string, upstream?: string): Promise<{ mergeBase?: string; mergeBaseShort?: string }> {
  if (!upstream) return {};
  const result = await runGit(workspace, ['merge-base', 'HEAD', upstream]);
  const mergeBase = result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
  return {
    mergeBase,
    mergeBaseShort: mergeBase ? mergeBase.slice(0, 7) : undefined,
  };
}

async function readBackupBranches(workspace: string): Promise<BuildGitBackupBranch[]> {
  const result = await runGit(workspace, [
    'branch',
    '--list',
    'backup/*',
    '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso-strict)%09%(contents:subject)',
  ]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line): BuildGitBackupBranch | null => {
      if (!line.trim()) return null;
      const [name = '', shortCommit = '', createdAt = '', ...subjectParts] = line.split('\t');
      const branchName = name.trim();
      if (!branchName) return null;
      return {
        name: branchName,
        shortCommit: shortCommit.trim() || undefined,
        createdAt: createdAt.trim() || undefined,
        subject: subjectParts.join('\t').trim() || undefined,
      };
    })
    .filter((entry): entry is BuildGitBackupBranch => Boolean(entry));
}

async function readReflogEntries(workspace: string, maxCount = 20): Promise<BuildGitReflogEntry[]> {
  const result = await runGit(workspace, [
    'reflog',
    `--max-count=${maxCount}`,
    '--date=iso-strict',
    '--format=%H%x09%h%x09%gd%x09%an%x09%ad%x09%gs',
  ]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line): BuildGitReflogEntry | null => {
      if (!line.trim()) return null;
      const [hash = '', shortHash = '', selector = '', author = '', date = '', ...messageParts] = line.split('\t');
      if (!hash.trim()) return null;
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim() || hash.trim().slice(0, 7),
        selector: selector.trim() || undefined,
        author: author.trim() || undefined,
        date: date.trim() || undefined,
        message: messageParts.join('\t').trim() || '(no reflog message)',
      };
    })
    .filter((entry): entry is BuildGitReflogEntry => Boolean(entry));
}

function normalizeStashRef(input: string): string {
  const stashRef = String(input || '').trim();
  if (!/^stash@\{\d+\}$/.test(stashRef)) {
    throw new Error('Choose a valid saved-aside entry.');
  }
  return stashRef;
}

function parseStashList(output: string): BuildGitStashEntry[] {
  return output
    .split(/\r?\n/)
    .map((line): BuildGitStashEntry | null => {
      if (!line.trim()) return null;
      const [ref = '', hash = '', date = '', ...messageParts] = line.split('\t');
      const stashRef = ref.trim();
      if (!stashRef) return null;
      return {
        ref: stashRef,
        hash: hash.trim() || undefined,
        date: date.trim() || undefined,
        message: messageParts.join('\t').trim() || 'Saved changes',
      };
    })
    .filter((entry): entry is BuildGitStashEntry => Boolean(entry));
}

function getSkippedGitHubCliStatus(): BuildGitToolStatus {
  return {
    available: false,
    detail: 'GitHub CLI status is skipped during live file-change updates.',
  };
}

function getLocalSyncStatus(ahead: number, behind: number): { syncStatus: BuildGitSyncStatus; syncDetail: string } {
  if (ahead > 0 && behind > 0) {
    return {
      syncStatus: 'diverged',
      syncDetail: `Local status reports ${ahead} local commit${ahead === 1 ? '' : 's'} and ${behind} remote commit${behind === 1 ? '' : 's'} pending.`,
    };
  }
  if (behind > 0) {
    return {
      syncStatus: 'behind',
      syncDetail: `Local status reports ${behind} remote commit${behind === 1 ? '' : 's'} to pull.`,
    };
  }
  if (ahead > 0) {
    return {
      syncStatus: 'ahead',
      syncDetail: `Local status reports ${ahead} local commit${ahead === 1 ? '' : 's'} ready to push.`,
    };
  }
  return {
    syncStatus: 'unknown',
    syncDetail: 'Live status checks only local changes. Fetch status after the task finishes to confirm remote sync.',
  };
}

export async function readBuildGitSummary(agentId: string, relativePath = '.', options?: { lightweight?: boolean }): Promise<BuildGitSummary> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const generatedAt = new Date().toISOString();
  const lightweight = options?.lightweight === true;
  const git = await getGitToolStatus();
  const githubCliPromise = lightweight ? null : getGitHubCliStatus(workspace);

  if (!git.available) {
    const githubCli = githubCliPromise ? await githubCliPromise : getSkippedGitHubCliStatus();
    const summaryBase: Omit<BuildGitSummary, 'nextAction'> = {
      generatedAt,
      workspaceRoot: workspace,
      workspaceRelativePath,
      available: false,
      isRepository: false,
      git,
      githubCli,
      ahead: 0,
      behind: 0,
      syncStatus: 'unknown',
      syncDetail: 'Git is not available, so sync status cannot be checked.',
      authStatus: 'not-required',
      authMethod: 'none',
      authDetail: 'Git is not available, so push credentials cannot be checked.',
      authSetupHints: [],
      branches: [],
      conflictedCount: 0,
      dirty: false,
      hasChanges: false,
      changedFileCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      totalAddedLines: 0,
      totalDeletedLines: 0,
      files: [],
    };
    return { ...summaryBase, nextAction: makeNextAction(summaryBase) };
  }

  const repoCheck = await runGit(workspace, ['rev-parse', '--is-inside-work-tree']);
  if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== 'true') {
    const githubCli = githubCliPromise ? await githubCliPromise : getSkippedGitHubCliStatus();
    const summaryBase: Omit<BuildGitSummary, 'nextAction'> = {
      generatedAt,
      workspaceRoot: workspace,
      workspaceRelativePath,
      available: true,
      isRepository: false,
      git,
      githubCli,
      ahead: 0,
      behind: 0,
      syncStatus: 'not-configured',
      syncDetail: 'This workspace is not a Git repository yet.',
      authStatus: 'not-required',
      authMethod: 'none',
      authDetail: 'This workspace is not connected to a remote, so push credentials are not needed yet.',
      authSetupHints: [],
      branches: [],
      conflictedCount: 0,
      dirty: false,
      hasChanges: false,
      changedFileCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      totalAddedLines: 0,
      totalDeletedLines: 0,
      files: [],
    };
    return { ...summaryBase, nextAction: makeNextAction(summaryBase) };
  }

  const [statusResult, unstagedNumstatResult, stagedNumstatResult, branchResult, commitResult] = await Promise.all([
    runGit(workspace, ['status', '--porcelain=v1', '--branch', '--', '.']),
    runGit(workspace, ['diff', '--numstat', '--', '.']),
    runGit(workspace, ['diff', '--numstat', '--staged', '--', '.']),
    runGit(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(workspace, ['rev-parse', 'HEAD']),
  ]);

  const parsedStatus = parseStatus(statusResult.stdout);
  const branchFromRevParse = branchResult.exitCode === 0 && branchResult.stdout.trim() && branchResult.stdout.trim() !== 'HEAD'
    ? branchResult.stdout.trim()
    : undefined;
  const branch = parsedStatus.branch || branchFromRevParse;
  const files = mergeLineStats(
    parsedStatus.files,
    parseNumstat(unstagedNumstatResult.stdout),
    parseNumstat(stagedNumstatResult.stdout)
  );
  const stagedCount = files.filter((file) => file.staged).length;
  const unstagedCount = files.filter((file) => file.unstaged).length;
  const untrackedCount = files.filter((file) => file.untracked).length;
  const conflictedCount = files.filter((file) => file.status === 'conflicted').length;
  if (lightweight) {
    const remote = await readRemoteDetails(workspace, branch);
    const githubCli = getSkippedGitHubCliStatus();
    const sync = getLocalSyncStatus(parsedStatus.ahead, parsedStatus.behind);
    const summaryBase: Omit<BuildGitSummary, 'nextAction'> = {
      generatedAt,
      workspaceRoot: workspace,
      workspaceRelativePath,
      available: true,
      isRepository: true,
      git,
      githubCli,
      branch,
      commit: commitResult.exitCode === 0 ? commitResult.stdout.trim() || undefined : undefined,
      shortCommit: commitResult.exitCode === 0 ? commitResult.stdout.trim().slice(0, 7) || undefined : undefined,
      ...remote,
      ahead: parsedStatus.ahead,
      behind: parsedStatus.behind,
      ...sync,
      authStatus: 'unknown',
      authMethod: 'unknown',
      authDetail: 'Authentication is not checked during live file-change updates.',
      authSetupHints: [],
      branches: [],
      conflictedCount,
      dirty: files.length > 0,
      hasChanges: files.length > 0,
      changedFileCount: files.length,
      stagedCount,
      unstagedCount,
      untrackedCount,
      totalAddedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
      totalDeletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
      files,
    };

    return { ...summaryBase, nextAction: makeNextAction(summaryBase) };
  }

  const remote = await readRemoteDetails(workspace, branch);
  const sync = await readSyncStatus(workspace, remote, parsedStatus.ahead, parsedStatus.behind);
  const branches = await readBranches(workspace);
  const githubCli = await githubCliPromise!;
  const auth = await readGitAuthStatus(workspace, remote, githubCli);
  const summaryBase: Omit<BuildGitSummary, 'nextAction'> = {
    generatedAt,
    workspaceRoot: workspace,
    workspaceRelativePath,
    available: true,
    isRepository: true,
    git,
    githubCli,
    branch,
    commit: commitResult.exitCode === 0 ? commitResult.stdout.trim() || undefined : undefined,
    shortCommit: commitResult.exitCode === 0 ? commitResult.stdout.trim().slice(0, 7) || undefined : undefined,
    ...remote,
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    ...sync,
    ...auth,
    branches,
    conflictedCount,
    dirty: files.length > 0,
    hasChanges: files.length > 0,
    changedFileCount: files.length,
    stagedCount,
    unstagedCount,
    untrackedCount,
    totalAddedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
    files,
  };

  return { ...summaryBase, nextAction: makeNextAction(summaryBase) };
}

export function classifyBuildGitActionFailure(
  rawOutput: string,
  summary?: Pick<BuildGitSummary, 'remoteProvider' | 'remoteName' | 'remoteUrl' | 'authSetupHints'>
): { errorKind: BuildGitActionErrorKind; message: string; hints: string[] } {
  const output = String(rawOutput || '').trim();
  const lower = output.toLowerCase();
  const providerLabel = getGitProviderLabel(summary?.remoteProvider);
  const baseHints = summary?.authSetupHints?.length ? summary.authSetupHints : getAuthSetupHints(summary?.remoteProvider, getRemoteProtocol(summary?.remoteUrl));

  if (
    /authentication failed|could not read username|invalid username|invalid password|authentication required|auth required|credential|access denied|permission denied \(publickey\)|publickey/i.test(output)
  ) {
    return {
      errorKind: 'auth',
      message: `Git could not authenticate with ${providerLabel}. The branch was not pushed.`,
      hints: baseHints,
    };
  }

  if (/repository not found|not appear to be a git repository|repository does not exist|could not read from remote repository/i.test(output)) {
    return {
      errorKind: 'remote',
      message: `Git could not access the remote repository. Check that the remote URL is correct and that your account has access to this ${providerLabel} repository.`,
      hints: [
        `Verify the remote URL${summary?.remoteName ? ` for "${summary.remoteName}"` : ''}.`,
        ...baseHints.slice(0, 2),
      ],
    };
  }

  if (/could not resolve host|failed to connect|timed out|network is unreachable|connection refused|connection reset/i.test(output)) {
    return {
      errorKind: 'network',
      message: `Git could not reach ${providerLabel}. Check your internet connection, VPN, proxy, or Git host status, then try again.`,
      hints: ['Retry after the network issue is fixed. No files were changed by the failed push.'],
    };
  }

  if (/non-fast-forward|not possible to fast-forward|fetch first|rejected|failed to push some refs|src refspec|does not match any|need to specify how to reconcile/i.test(lower)) {
    return {
      errorKind: 'branch',
      message: 'Git rejected the push because the branch state needs attention before uploading.',
      hints: [
        'Review the sync status in this panel.',
        'If the remote has newer commits, pull or merge them before pushing.',
      ],
    };
  }

  return {
    errorKind: 'unknown',
    message: output || 'Git push failed. No files were changed by the failed push.',
    hints: baseHints,
  };
}

export async function readBuildGitMismatchSummary(agentId: string, relativePath = '.'): Promise<BuildGitMismatchSummary> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const inProgressOperation = summary.isRepository ? await readInProgressOperation(workspace) : 'none';
  const localCommits = summary.upstream ? await readCommitRange(workspace, `${summary.upstream}..HEAD`) : [];
  const remoteCommits = summary.upstream ? await readCommitRange(workspace, `HEAD..${summary.upstream}`) : [];
  const mergeBase = summary.upstream ? await readMergeBase(workspace, summary.upstream) : {};
  const [conflictFiles, backupBranches, reflog] = summary.isRepository
    ? await Promise.all([
      readConflictFiles(workspace, summary),
      readBackupBranches(workspace),
      readReflogEntries(workspace),
    ])
    : [
      [] as BuildGitConflictFile[],
      [] as BuildGitBackupBranch[],
      [] as BuildGitReflogEntry[],
    ];
  const backupBranchName = summary.branch && summary.branch !== 'detached HEAD'
    ? normalizeBackupBranchName(undefined, summary.branch)
    : undefined;
  const hasWorkingBlocker = summary.hasChanges || summary.conflictedCount > 0 || inProgressOperation !== 'none';
  const guidance = [
    !summary.isRepository ? 'Initialize Git before resolving branch mismatches.' : '',
    summary.hasChanges ? 'Commit or discard local file changes before merge, rebase, or reset actions.' : '',
    summary.conflictedCount > 0 ? 'Resolve conflicted files, then continue or abort the active Git operation.' : '',
    inProgressOperation === 'merge' ? 'A merge is in progress. Finish the merge commit after resolving conflicts, or abort the merge.' : '',
    inProgressOperation === 'rebase' ? 'A rebase is in progress. Resolve conflicts, then continue or abort the rebase.' : '',
    summary.ahead > 0 && summary.behind > 0 ? 'This branch has diverged: local and remote both have commits the other side does not have.' : '',
    summary.behind > 0 && summary.ahead === 0 ? 'The remote branch has commits that are not local yet. A fast-forward pull is usually safest.' : '',
    summary.ahead > 0 && summary.behind === 0 ? 'Local commits are ready to push.' : '',
  ].filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: summary.workspaceRoot,
    workspaceRelativePath,
    available: summary.git.available,
    isRepository: summary.isRepository,
    branch: summary.branch,
    upstream: summary.upstream,
    ahead: summary.ahead,
    behind: summary.behind,
    syncStatus: summary.syncStatus,
    syncDetail: summary.syncDetail,
    hasLocalChanges: summary.hasChanges,
    conflictedCount: summary.conflictedCount,
    inProgressOperation,
    localCommits,
    remoteCommits,
    ...mergeBase,
    conflictFiles,
    backupBranches,
    reflog,
    backupBranchName,
    canMerge: Boolean(summary.upstream && summary.behind > 0 && !hasWorkingBlocker),
    canRebase: Boolean(summary.upstream && summary.ahead > 0 && summary.behind > 0 && !hasWorkingBlocker),
    canResetToRemote: Boolean(summary.upstream && summary.behind > 0 && !hasWorkingBlocker),
    canForcePush: Boolean(summary.remoteName && summary.ahead > 0 && !summary.hasChanges && summary.conflictedCount === 0 && inProgressOperation === 'none'),
    guidance,
    summary,
  };
}

export async function resolveBuildGitMismatch(
  agentId: string,
  relativePath = '.',
  input: BuildGitResolveMismatchInput
): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const action = input.action;
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  const inProgressOperation = before.isRepository ? await readInProgressOperation(workspace) : 'none';

  if (!before.git.available || !before.isRepository) {
    return {
      ok: false,
      action: 'resolve-mismatch',
      message: before.isRepository ? 'Git is not available.' : 'Initialize Git before resolving branch mismatches.',
      summary: before,
    };
  }

  if (action === 'abort-merge') {
    const result = await runGit(workspace, ['merge', '--abort']);
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    return {
      ok: result.exitCode === 0,
      action: 'resolve-mismatch',
      message: result.exitCode === 0 ? 'Merge aborted. The branch returned to its pre-merge state.' : (result.stderr.trim() || result.error || 'Failed to abort merge.'),
      stdout: result.stdout,
      stderr: result.stderr || result.error,
      summary,
    };
  }

  if (action === 'abort-rebase') {
    const result = await runGit(workspace, ['rebase', '--abort']);
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    return {
      ok: result.exitCode === 0,
      action: 'resolve-mismatch',
      message: result.exitCode === 0 ? 'Rebase aborted. The branch returned to its pre-rebase state.' : (result.stderr.trim() || result.error || 'Failed to abort rebase.'),
      stdout: result.stdout,
      stderr: result.stderr || result.error,
      summary,
    };
  }

  if (action === 'continue-rebase') {
    const result = await runGit(workspace, ['rebase', '--continue']);
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    return {
      ok: result.exitCode === 0,
      action: 'resolve-mismatch',
      message: result.exitCode === 0
        ? 'Rebase continued.'
        : (result.stderr.trim() || result.error || 'Rebase could not continue. Resolve remaining conflicts and try again.'),
      stdout: result.stdout,
      stderr: result.stderr || result.error,
      errorKind: result.exitCode === 0 ? undefined : 'branch',
      hints: result.exitCode === 0 ? undefined : ['Open conflicted files, resolve conflict markers, stage the files, then continue the rebase.'],
      summary,
    };
  }

  if (inProgressOperation !== 'none') {
    return {
      ok: false,
      action: 'resolve-mismatch',
      message: `A ${inProgressOperation} is already in progress. Continue or abort it before starting another mismatch action.`,
      summary: before,
    };
  }

  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'resolve-mismatch',
      message: 'Commit or discard local file changes before resolving branch mismatches.',
      hints: ['This prevents merge, rebase, or reset actions from overwriting uncommitted work.'],
      summary: before,
    };
  }

  if (!before.upstream && action !== 'backup') {
    return {
      ok: false,
      action: 'resolve-mismatch',
      message: 'This branch has no upstream branch to compare with.',
      summary: before,
    };
  }

  let backupName: string | undefined;
  if (input.createBackup || action === 'backup' || action === 'reset-to-remote') {
    const backup = await createBackupBranch(workspace, before.branch, input.backupBranchName);
    if (!backup.ok) {
      const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
      return {
        ok: false,
        action: 'resolve-mismatch',
        message: backup.result.stderr.trim() || backup.result.error || `Failed to create backup branch "${backup.name}".`,
        stdout: backup.result.stdout,
        stderr: backup.result.stderr || backup.result.error,
        summary,
      };
    }
    backupName = backup.name;
    if (action === 'backup') {
      const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
      return {
        ok: true,
        action: 'resolve-mismatch',
        message: `Backup branch "${backupName}" created at the current commit.`,
        stdout: backup.result.stdout,
        stderr: backup.result.stderr || backup.result.error,
        summary,
      };
    }
  }

  let result: CommandResult;
  let successMessage = '';
  if (action === 'merge') {
    result = await runGit(workspace, ['merge', '--no-ff', before.upstream || '']);
    successMessage = `Merged ${before.upstream} into ${before.branch || 'the current branch'}${backupName ? ` after creating backup "${backupName}"` : ''}.`;
  } else if (action === 'rebase') {
    result = await runGit(workspace, ['rebase', before.upstream || '']);
    successMessage = `Rebased local commits on top of ${before.upstream}${backupName ? ` after creating backup "${backupName}"` : ''}.`;
  } else if (action === 'reset-to-remote') {
    result = await runGit(workspace, ['reset', '--hard', before.upstream || '']);
    successMessage = `Reset local branch to ${before.upstream}. Backup branch "${backupName}" keeps the previous local commits.`;
  } else if (action === 'force-push') {
    result = await runGit(workspace, ['push', '--force-with-lease']);
    successMessage = 'Force pushed with lease. The remote branch now matches the local branch.';
  } else {
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    return {
      ok: false,
      action: 'resolve-mismatch',
      message: `Unsupported mismatch action: ${action}.`,
      summary,
    };
  }

  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const failure = result.exitCode === 0
    ? null
    : classifyBuildGitActionFailure(result.stderr || result.stdout || result.error || '', summary);
  const operationAfter = await readInProgressOperation(workspace);
  const conflictMessage = operationAfter !== 'none' || summary.conflictedCount > 0
    ? `${action === 'rebase' ? 'Rebase' : 'Merge'} stopped because conflicts need to be resolved. Open the conflicted files, fix them, stage them, then continue or abort.`
    : undefined;

  return {
    ok: result.exitCode === 0,
    action: 'resolve-mismatch',
    message: result.exitCode === 0
      ? successMessage
      : (conflictMessage || failure?.message || result.stderr.trim() || result.error || 'Failed to resolve branch mismatch.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    errorKind: result.exitCode === 0 ? undefined : (conflictMessage ? 'branch' : failure?.errorKind),
    hints: result.exitCode === 0
      ? undefined
      : (conflictMessage
        ? ['Resolve conflicts in the listed files.', action === 'rebase' ? 'Use Continue rebase after staging resolved files.' : 'Commit the merge after staging resolved files.', `Use Abort ${action === 'rebase' ? 'rebase' : 'merge'} if you want to return to the previous state.`]
        : failure?.hints),
    summary,
  };
}

export async function initBuildGitRepository(agentId: string, relativePath = '.'): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available) {
    return { ok: false, action: 'init', message: before.git.error || 'Git is not available.', summary: before };
  }
  if (before.isRepository) {
    return { ok: true, action: 'init', message: 'This workspace is already a Git repository.', summary: before };
  }
  const result = await runCommand('git', ['init'], { cwd: workspace });
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'init',
    message: result.exitCode === 0 ? 'Git repository initialized.' : (result.stderr.trim() || result.error || 'Failed to initialize Git repository.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function commitBuildGitChanges(agentId: string, relativePath = '.', message = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const commitMessage = String(message || '').trim();
  if (!commitMessage) {
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    return { ok: false, action: 'commit', message: 'Commit message is required.', summary };
  }
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'commit', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before committing.', summary: before };
  }
  if (!before.hasChanges) {
    return { ok: false, action: 'commit', message: 'There are no changes to commit.', summary: before };
  }

  const addResult = await runGit(workspace, ['add', '--all', '--', '.']);
  if (addResult.exitCode !== 0) {
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    return {
      ok: false,
      action: 'commit',
      message: addResult.stderr.trim() || addResult.error || 'Failed to stage workspace changes.',
      stdout: addResult.stdout,
      stderr: addResult.stderr || addResult.error,
      summary,
    };
  }

  const commitResult = await runGit(workspace, ['commit', '-m', commitMessage, '--', '.']);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const commitSuccessMessage = !before.remoteName
    ? 'Changes committed locally. No remote is configured, so nothing was uploaded to GitHub.'
    : !before.upstream
      ? 'Changes committed locally. This branch has no upstream branch, so nothing was pushed.'
      : 'Changes committed locally. Push separately when you are ready.';
  return {
    ok: commitResult.exitCode === 0,
    action: 'commit',
    message: commitResult.exitCode === 0
      ? commitSuccessMessage
      : (commitResult.stderr.trim() || commitResult.error || 'Failed to commit changes.'),
    stdout: commitResult.stdout,
    stderr: commitResult.stderr || commitResult.error,
    summary,
  };
}

export async function addBuildGitRemote(agentId: string, relativePath = '.', input: BuildGitRemoteInput): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'add-remote', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before adding a remote.', summary: before };
  }

  const remoteName = normalizeRemoteName(input.remoteName);
  const remoteUrl = normalizeRemoteUrl(input.remoteUrl);
  const existingRemotes = await runGit(workspace, ['remote']);
  const remoteExists = existingRemotes.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((name) => name === remoteName);
  if (remoteExists) {
    return {
      ok: false,
      action: 'add-remote',
      message: `Remote "${remoteName}" already exists. Remove or rename it before adding another remote with that name.`,
      summary: before,
    };
  }

  const result = await runGit(workspace, ['remote', 'add', remoteName, remoteUrl]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'add-remote',
    message: result.exitCode === 0
      ? `Remote "${remoteName}" added. You can now push this branch when you are ready.`
      : (result.stderr.trim() || result.error || 'Failed to add Git remote.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function updateBuildGitRemote(agentId: string, relativePath = '.', input: BuildGitRemoteInput): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'update-remote', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before editing a remote.', summary: before };
  }
  const remoteName = normalizeRemoteName(input.remoteName);
  const remoteUrl = normalizeRemoteUrl(input.remoteUrl);
  const existingRemotes = await runGit(workspace, ['remote']);
  const remoteExists = existingRemotes.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((name) => name === remoteName);
  if (!remoteExists) {
    return {
      ok: false,
      action: 'update-remote',
      message: `Remote "${remoteName}" was not found. Add it before editing its URL.`,
      summary: before,
    };
  }

  const result = await runGit(workspace, ['remote', 'set-url', remoteName, remoteUrl]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'update-remote',
    message: result.exitCode === 0
      ? `Remote "${remoteName}" URL updated.`
      : (result.stderr.trim() || result.error || 'Failed to update Git remote.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function fetchBuildGitRemote(agentId: string, relativePath = '.'): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'fetch', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before fetching remote status.', summary: before };
  }
  if (!before.remoteName) {
    return { ok: false, action: 'fetch', message: 'Add a remote before fetching remote status.', summary: before };
  }

  const result = await runGit(workspace, ['fetch', '--prune', before.remoteName]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const failure = result.exitCode === 0
    ? null
    : classifyBuildGitActionFailure(result.stderr || result.stdout || result.error || '', summary);
  return {
    ok: result.exitCode === 0,
    action: 'fetch',
    message: result.exitCode === 0
      ? `Fetched latest status from ${before.remoteName}.`
      : (failure?.message || result.stderr.trim() || result.error || 'Failed to fetch remote status.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    errorKind: failure?.errorKind,
    hints: failure?.hints,
    summary,
  };
}

export async function pullBuildGitBranch(agentId: string, relativePath = '.'): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'pull', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before pulling remote changes.', summary: before };
  }
  if (before.conflictedCount > 0) {
    return { ok: false, action: 'pull', message: 'Resolve existing Git conflicts before pulling remote changes.', summary: before };
  }
  if (before.hasChanges) {
    return {
      ok: false,
      action: 'pull',
      message: 'Commit or discard local changes before pulling. This prevents remote updates from overwriting local work.',
      summary: before,
      hints: ['Commit the current changes, or discard selected files you do not want to keep, then pull again.'],
    };
  }
  if (!before.upstream) {
    return { ok: false, action: 'pull', message: 'This branch has no upstream branch to pull from.', summary: before };
  }

  const result = await runGit(workspace, ['pull', '--ff-only']);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const failure = result.exitCode === 0
    ? null
    : classifyBuildGitActionFailure(result.stderr || result.stdout || result.error || '', summary);
  return {
    ok: result.exitCode === 0,
    action: 'pull',
    message: result.exitCode === 0
      ? 'Pulled remote changes with a fast-forward update.'
      : (failure?.message || result.stderr.trim() || result.error || 'Failed to pull remote changes.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    errorKind: failure?.errorKind,
    hints: failure?.hints,
    summary,
  };
}

export async function switchBuildGitBranch(agentId: string, relativePath = '.', branchName = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const targetBranch = normalizeBranchName(branchName, undefined);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'switch-branch', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before switching branches.', summary: before };
  }
  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'switch-branch',
      message: 'Commit or discard local changes before switching branches.',
      summary: before,
      hints: ['This prevents branch switching from carrying or overwriting uncommitted work.'],
    };
  }
  const localBranchExists = before.branches.some((branch) => branch.name === targetBranch && !branch.remote);
  if (!localBranchExists) {
    return {
      ok: false,
      action: 'switch-branch',
      message: `Local branch "${targetBranch}" was not found. Create it first or choose an existing local branch.`,
      summary: before,
    };
  }

  const result = await runGit(workspace, ['switch', targetBranch]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'switch-branch',
    message: result.exitCode === 0
      ? `Switched to branch "${targetBranch}".`
      : (result.stderr.trim() || result.error || `Failed to switch to branch "${targetBranch}".`),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function createBuildGitBranch(agentId: string, relativePath = '.', branchName = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const targetBranch = normalizeBranchName(branchName, undefined);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'create-branch', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before creating branches.', summary: before };
  }
  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'create-branch',
      message: 'Commit or discard local changes before creating and switching to a new branch.',
      summary: before,
      hints: ['This keeps the new branch starting point clear for beginners.'],
    };
  }
  if (before.branches.some((branch) => branch.name === targetBranch && !branch.remote)) {
    return {
      ok: false,
      action: 'create-branch',
      message: `Local branch "${targetBranch}" already exists. Switch to it instead.`,
      summary: before,
    };
  }

  const result = await runGit(workspace, ['switch', '-c', targetBranch]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'create-branch',
    message: result.exitCode === 0
      ? `Created and switched to branch "${targetBranch}".`
      : (result.stderr.trim() || result.error || `Failed to create branch "${targetBranch}".`),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function discardBuildGitChanges(agentId: string, relativePath = '.', paths: string[] = []): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const selectedPaths = Array.from(new Set(paths.map(normalizeGitRelativePath)));
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'discard', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before discarding changes.', summary: before };
  }
  if (selectedPaths.length === 0) {
    return { ok: false, action: 'discard', message: 'Choose at least one changed file to discard.', summary: before };
  }

  const changedFilesByPath = new Map(before.files.map((file) => [file.relativePath, file]));
  const unknownPath = selectedPaths.find((filePath) => !changedFilesByPath.has(filePath));
  if (unknownPath) {
    return {
      ok: false,
      action: 'discard',
      message: `"${unknownPath}" is not currently listed as a changed Git file.`,
      summary: before,
    };
  }

  const untrackedPaths = selectedPaths.filter((filePath) => changedFilesByPath.get(filePath)?.untracked);
  const trackedPaths = selectedPaths.filter((filePath) => !changedFilesByPath.get(filePath)?.untracked);
  let stdout = '';
  let stderr = '';
  let failed: CommandResult | null = null;

  if (trackedPaths.length > 0) {
    const restoreResult = await runGit(workspace, ['restore', '--staged', '--worktree', '--', ...trackedPaths]);
    stdout += restoreResult.stdout;
    stderr += restoreResult.stderr || restoreResult.error || '';
    if (restoreResult.exitCode !== 0) failed = restoreResult;
  }
  if (!failed && untrackedPaths.length > 0) {
    const cleanResult = await runGit(workspace, ['clean', '-f', '--', ...untrackedPaths]);
    stdout += cleanResult.stdout;
    stderr += cleanResult.stderr || cleanResult.error || '';
    if (cleanResult.exitCode !== 0) failed = cleanResult;
  }

  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const count = selectedPaths.length;
  return {
    ok: !failed,
    action: 'discard',
    message: failed
      ? (stderr.trim() || failed.error || 'Failed to discard selected Git changes.')
      : `Discarded changes in ${count} file${count === 1 ? '' : 's'}.`,
    stdout,
    stderr: stderr || undefined,
    summary,
  };
}

export async function pushBuildGitBranch(agentId: string, relativePath = '.', branchName?: string): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'push', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before pushing.', summary: before };
  }
  const targetBranch = (() => {
    try {
      return normalizeBranchName(branchName, before.branch);
    } catch {
      return '';
    }
  })();
  if (!before.upstream) {
    if (!before.remoteName || !targetBranch) {
      return {
        ok: false,
        action: 'push',
        message: 'Add a remote and choose a valid branch name before pushing from this panel.',
        summary: before,
      };
    }
    if (!before.commit) {
      return {
        ok: false,
        action: 'push',
        message: 'Create a commit before pushing this branch.',
        summary: before,
      };
    }
    const firstPush = await runGit(workspace, ['push', '-u', before.remoteName, `HEAD:${targetBranch}`]);
    const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
    const failure = firstPush.exitCode === 0
      ? null
      : classifyBuildGitActionFailure(firstPush.stderr || firstPush.stdout || firstPush.error || '', summary);
    return {
      ok: firstPush.exitCode === 0,
      action: 'push',
      message: firstPush.exitCode === 0
        ? `Branch pushed and upstream set to ${before.remoteName}/${targetBranch}.`
        : (failure?.message || firstPush.stderr.trim() || firstPush.error || 'Failed to push branch and set upstream.'),
      stdout: firstPush.stdout,
      stderr: firstPush.stderr || firstPush.error,
      errorKind: failure?.errorKind,
      hints: failure?.hints,
      summary,
    };
  }
  const pushArgs = branchName && targetBranch && before.remoteName
    ? ['push', '-u', before.remoteName, `HEAD:${targetBranch}`]
    : ['push'];
  const result = await runGit(workspace, pushArgs);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  const failure = result.exitCode === 0
    ? null
    : classifyBuildGitActionFailure(result.stderr || result.stdout || result.error || '', summary);
  return {
    ok: result.exitCode === 0,
    action: 'push',
    message: result.exitCode === 0
      ? (branchName && targetBranch && before.remoteName ? `Branch pushed to ${before.remoteName}/${targetBranch}.` : 'Branch pushed.')
      : (failure?.message || result.stderr.trim() || result.error || 'Failed to push branch.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    errorKind: failure?.errorKind,
    hints: failure?.hints,
    summary,
  };
}

export async function readBuildGitConflicts(agentId: string, relativePath = '.'): Promise<{ files: BuildGitConflictFile[]; summary: BuildGitSummary }> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    files: await readConflictFiles(workspace, summary),
    summary,
  };
}

export async function stageBuildGitFiles(agentId: string, relativePath = '.', input: BuildGitStageInput): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const paths = Array.from(new Set((input.paths || []).map(normalizeGitRelativePath)));
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'stage-files', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before staging files.', summary: before };
  }
  if (paths.length === 0) {
    return { ok: false, action: 'stage-files', message: 'Choose at least one file to mark resolved.', summary: before };
  }
  const changedPaths = new Set(before.files.map((file) => file.relativePath));
  const unknownPath = paths.find((filePath) => !changedPaths.has(filePath));
  if (unknownPath) {
    return { ok: false, action: 'stage-files', message: `"${unknownPath}" is not currently listed as a changed Git file.`, summary: before };
  }

  const result = await runGit(workspace, ['add', '--', ...paths]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'stage-files',
    message: result.exitCode === 0
      ? `Marked ${paths.length} file${paths.length === 1 ? '' : 's'} as resolved.`
      : (result.stderr.trim() || result.error || 'Failed to stage selected files.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function finishBuildGitMerge(agentId: string, relativePath = '.', message = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  const inProgressOperation = before.isRepository ? await readInProgressOperation(workspace) : 'none';
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'finish-merge', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before finishing a merge.', summary: before };
  }
  if (inProgressOperation !== 'merge') {
    return { ok: false, action: 'finish-merge', message: 'No merge is currently in progress.', summary: before };
  }
  if (before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'finish-merge',
      message: 'Resolve and mark all conflicted files before finishing the merge commit.',
      summary: before,
    };
  }

  const commitMessage = String(message || '').trim() || 'Merge remote changes';
  const result = await runGit(workspace, ['commit', '-m', commitMessage]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'finish-merge',
    message: result.exitCode === 0
      ? 'Merge commit created.'
      : (result.stderr.trim() || result.error || 'Failed to finish the merge commit.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function createBuildGitStash(agentId: string, relativePath = '.', message = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'stash-create', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before saving changes aside.', summary: before };
  }
  if (before.conflictedCount > 0) {
    return { ok: false, action: 'stash-create', message: 'Resolve conflicts before saving changes aside.', summary: before };
  }
  if (!before.hasChanges) {
    return { ok: false, action: 'stash-create', message: 'There are no local changes to save aside.', summary: before };
  }
  const stashMessage = String(message || '').trim() || `OpenDeskmate saved changes ${new Date().toISOString()}`;
  const result = await runGit(workspace, ['stash', 'push', '-u', '-m', stashMessage, '--', '.']);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'stash-create',
    message: result.exitCode === 0
      ? 'Changes saved aside. You can apply them again later from More Git actions.'
      : (result.stderr.trim() || result.error || 'Failed to save changes aside.'),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function listBuildGitStashes(agentId: string, relativePath = '.'): Promise<{ stashes: BuildGitStashEntry[]; summary: BuildGitSummary }> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!summary.git.available || !summary.isRepository) {
    return { stashes: [], summary };
  }
  const result = await runGit(workspace, ['stash', 'list', '--format=%gd%x09%H%x09%ci%x09%gs']);
  return {
    stashes: result.exitCode === 0 ? parseStashList(result.stdout) : [],
    summary,
  };
}

export async function applyBuildGitStash(agentId: string, relativePath = '.', stashRef = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const ref = normalizeStashRef(stashRef);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'stash-apply', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before applying saved-aside changes.', summary: before };
  }
  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'stash-apply',
      message: 'Commit, discard, or save current changes aside before applying saved-aside changes.',
      summary: before,
    };
  }
  const result = await runGit(workspace, ['stash', 'apply', ref]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'stash-apply',
    message: result.exitCode === 0
      ? `Applied saved-aside changes from ${ref}.`
      : (result.stderr.trim() || result.error || `Failed to apply ${ref}.`),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function dropBuildGitStash(agentId: string, relativePath = '.', stashRef = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const ref = normalizeStashRef(stashRef);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'stash-drop', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before deleting saved-aside changes.', summary: before };
  }
  const result = await runGit(workspace, ['stash', 'drop', ref]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'stash-drop',
    message: result.exitCode === 0
      ? `Deleted saved-aside changes ${ref}.`
      : (result.stderr.trim() || result.error || `Failed to delete ${ref}.`),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function checkoutBuildGitRemoteBranch(
  agentId: string,
  relativePath = '.',
  remoteBranchName = '',
  localBranchName?: string
): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const remoteBranch = normalizeBranchName(remoteBranchName, undefined);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'checkout-remote', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before checking out remote branches.', summary: before };
  }
  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'checkout-remote',
      message: 'Commit, save aside, or discard local changes before creating a local branch from a remote branch.',
      hints: ['This prevents local edits from being overwritten by a branch switch.'],
      summary: before,
    };
  }
  if (!before.branches.some((branch) => branch.remote && branch.name === remoteBranch)) {
    return { ok: false, action: 'checkout-remote', message: `Remote branch "${remoteBranch}" was not found. Fetch latest status and try again.`, summary: before };
  }
  const defaultLocal = remoteBranch.includes('/') ? remoteBranch.split('/').slice(1).join('/') : remoteBranch;
  const localBranch = normalizeBranchName(localBranchName, defaultLocal);
  if (before.branches.some((branch) => !branch.remote && branch.name === localBranch)) {
    return { ok: false, action: 'checkout-remote', message: `Local branch "${localBranch}" already exists. Switch to it instead.`, summary: before };
  }
  const result = await runGit(workspace, ['switch', '--track', '-c', localBranch, remoteBranch]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'checkout-remote',
    message: result.exitCode === 0
      ? `Created local branch "${localBranch}" from ${remoteBranch}.`
      : (result.stderr.trim() || result.error || `Failed to create local branch from ${remoteBranch}.`),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function createBuildGitRemoteRepository(
  agentId: string,
  relativePath = '.',
  input: BuildGitRemoteRepositoryCreateInput
): Promise<BuildGitRemoteRepositoryCreateResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  const provider = input.provider || 'github';
  const remoteName = normalizeRemoteName(input.remoteName || 'origin');
  const repositoryName = normalizeGhRepositoryName(input.repositoryName, before.repositoryName || path.basename(workspace));
  if (!before.git.available || !before.isRepository) {
    return {
      ok: false,
      provider,
      message: before.isRepository ? 'Git is not available.' : 'Initialize Git before creating a remote repository.',
      summary: before,
    };
  }
  if (before.remoteName) {
    return {
      ok: false,
      provider,
      message: `Remote "${before.remoteName}" is already configured. Edit it or push to it instead of creating another remote from this action.`,
      summary: before,
    };
  }
  if (provider !== 'github') {
    return {
      ok: false,
      provider,
      message: `${getGitProviderLabel(provider)} remote creation is guided manually in this version.`,
      manualSteps: buildProviderManualRemoteGuide(provider, repositoryName, remoteName),
      summary: before,
    };
  }
  if (!before.githubCli.available || !before.githubCli.authenticated) {
    return {
      ok: false,
      provider,
      message: 'GitHub CLI is required and must be signed in before the app can create a GitHub repository.',
      manualSteps: buildProviderManualRemoteGuide(provider, repositoryName, remoteName),
      summary: before,
    };
  }
  const visibility = input.visibility === 'public' ? '--public' : '--private';
  const result = await runCommand('gh', ['repo', 'create', repositoryName, visibility, '--source', '.', '--remote', remoteName], {
    cwd: workspace,
    timeoutMs: 120_000,
  });
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    provider,
    message: result.exitCode === 0
      ? `GitHub repository "${repositoryName}" created and remote "${remoteName}" added. Push separately when you are ready.`
      : (result.stderr.trim() || result.error || 'Failed to create GitHub repository.'),
    remoteUrl: summary.remoteUrl,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function createBuildGitPullRequest(
  agentId: string,
  relativePath = '.',
  input: BuildGitPullRequestCreateInput
): Promise<BuildGitPullRequestCreateResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  const provider = input.provider || before.remoteProvider || 'custom';
  const repositoryName = before.repositoryOwner && before.repositoryName
    ? `${before.repositoryOwner}/${before.repositoryName}`
    : before.repositoryName || path.basename(workspace);
  if (!before.git.available || !before.isRepository) {
    return {
      ok: false,
      provider,
      message: before.isRepository ? 'Git is not available.' : 'Initialize Git before creating a pull request.',
    };
  }
  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      provider,
      message: 'Commit local changes and resolve conflicts before creating a pull request.',
    };
  }
  if (!before.upstream || before.ahead > 0) {
    return {
      ok: false,
      provider,
      message: 'Push this branch first. A pull request needs a pushed branch on the remote.',
      manualSteps: ['Use Push updates, then return here and create the pull request.'],
    };
  }
  if (provider !== 'github' || !before.githubCli.available || !before.githubCli.authenticated) {
    return {
      ok: false,
      provider,
      message: provider === 'github'
        ? 'GitHub CLI is required and must be signed in before the app can create a pull request automatically.'
        : `${getGitProviderLabel(provider)} pull request creation is guided manually in this version.`,
      manualSteps: buildProviderManualPrGuide(provider, repositoryName),
    };
  }
  const title = String(input.title || '').trim();
  if (!title) {
    return { ok: false, provider, message: 'Pull request title is required.' };
  }
  const body = String(input.body || '').trim();
  const args = ['pr', 'create', input.draft === false ? '' : '--draft', '--title', title, '--body', body || 'Created from OpenDeskmate.']
    .filter(Boolean);
  const baseBranch = input.baseBranch ? normalizeBranchName(input.baseBranch, undefined) : undefined;
  const headBranch = input.headBranch || before.branch ? normalizeBranchName(input.headBranch, before.branch) : undefined;
  if (baseBranch) args.push('--base', baseBranch);
  if (headBranch) args.push('--head', headBranch);
  const result = await runCommand('gh', args, { cwd: workspace, timeoutMs: 120_000 });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const url = /https?:\/\/\S+/i.exec(output)?.[0];
  return {
    ok: result.exitCode === 0,
    provider,
    message: result.exitCode === 0
      ? 'Draft pull request created.'
      : (result.stderr.trim() || result.error || 'Failed to create draft pull request.'),
    url,
    stdout: result.stdout,
    stderr: result.stderr || result.error,
  };
}

export async function listBuildGitBackupBranches(agentId: string, relativePath = '.'): Promise<{ branches: BuildGitBackupBranch[]; summary: BuildGitSummary }> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    branches: summary.isRepository ? await readBackupBranches(workspace) : [],
    summary,
  };
}

export async function restoreBuildGitBackupBranch(agentId: string, relativePath = '.', branchName = ''): Promise<BuildGitActionResult> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const backupBranch = normalizeBranchName(branchName, undefined);
  const before = await readBuildGitSummary(agentId, workspaceRelativePath);
  if (!before.git.available || !before.isRepository) {
    return { ok: false, action: 'restore-backup', message: before.isRepository ? 'Git is not available.' : 'Initialize Git before restoring a backup branch.', summary: before };
  }
  if (!backupBranch.startsWith('backup/')) {
    return { ok: false, action: 'restore-backup', message: 'Only app-created backup branches can be restored from this button.', summary: before };
  }
  if (before.hasChanges || before.conflictedCount > 0) {
    return {
      ok: false,
      action: 'restore-backup',
      message: 'Commit, save aside, or discard local changes before restoring a backup branch.',
      summary: before,
    };
  }
  const backupBranches = await readBackupBranches(workspace);
  if (!backupBranches.some((branch) => branch.name === backupBranch)) {
    return { ok: false, action: 'restore-backup', message: `Backup branch "${backupBranch}" was not found.`, summary: before };
  }
  const safety = await createBackupBranch(workspace, before.branch, undefined);
  if (!safety.ok) {
    return {
      ok: false,
      action: 'restore-backup',
      message: safety.result.stderr.trim() || safety.result.error || 'Failed to create a safety backup before restore.',
      stdout: safety.result.stdout,
      stderr: safety.result.stderr || safety.result.error,
      summary: before,
    };
  }
  const result = await runGit(workspace, ['reset', '--hard', backupBranch]);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    ok: result.exitCode === 0,
    action: 'restore-backup',
    message: result.exitCode === 0
      ? `Restored current branch to "${backupBranch}". Safety backup "${safety.name}" was created first.`
      : (result.stderr.trim() || result.error || `Failed to restore "${backupBranch}".`),
    stdout: result.stdout,
    stderr: result.stderr || result.error,
    summary,
  };
}

export async function listBuildGitReflog(agentId: string, relativePath = '.'): Promise<{ entries: BuildGitReflogEntry[]; summary: BuildGitSummary }> {
  const { workspace, workspaceRelativePath } = await resolveWorkspaceDirectory(agentId, relativePath);
  const summary = await readBuildGitSummary(agentId, workspaceRelativePath);
  return {
    entries: summary.isRepository ? await readReflogEntries(workspace) : [],
    summary,
  };
}
