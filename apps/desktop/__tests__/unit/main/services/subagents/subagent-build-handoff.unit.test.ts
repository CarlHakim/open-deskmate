import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureSubagentBuildHandoffBaseline,
  formatBuildHandoffForPrompt,
  generateSubagentBuildHandoffBundle,
} from '@main/services/subagents/subagent-build-handoff';
import { captureWorkspaceBaseline, readWorkspaceGitDiff } from '@main/services/build-mode/file-service';
import { readBuildGitSummary } from '@main/services/build-mode/git-service';

vi.mock('@main/services/build-mode/file-service', () => ({
  captureWorkspaceBaseline: vi.fn(),
  readWorkspaceGitDiff: vi.fn(),
}));

vi.mock('@main/services/build-mode/git-service', () => ({
  readBuildGitSummary: vi.fn(),
}));

describe('subagent build handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('captures a baseline before a Build subagent starts', async () => {
    vi.mocked(captureWorkspaceBaseline).mockResolvedValue({
      baselineId: 'baseline-1',
      capturedAt: '2026-06-26T10:00:00.000Z',
      fileCount: 12,
      totalBytes: 3456,
    });

    const result = await captureSubagentBuildHandoffBaseline({
      workspaceAgentId: 'john',
      workspaceRelativePath: 'calculator',
    });

    expect(captureWorkspaceBaseline).toHaveBeenCalledWith('john', 'calculator');
    expect(result).toMatchObject({
      workspaceAgentId: 'john',
      workspaceRelativePath: 'calculator',
      baselineId: 'baseline-1',
      baselineAvailable: true,
      baselineFileCount: 12,
    });
  });

  it('generates a replacement handoff with diff, git summary, and prompt guidance', async () => {
    vi.mocked(readWorkspaceGitDiff).mockResolvedValue({
      available: true,
      summary: 'M src/app.ts',
      patch: [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '-old',
        '+new',
      ].join('\n'),
      truncated: false,
      mode: 'synthetic',
      baselineId: 'baseline-1',
    });
    vi.mocked(readBuildGitSummary).mockResolvedValue({
      available: true,
      isRepository: true,
      branch: 'main',
      dirty: true,
      syncStatus: 'ahead',
      ahead: 1,
      behind: 0,
      changedFileCount: 1,
      stagedCount: 0,
      unstagedCount: 1,
      untrackedCount: 0,
      totalAddedLines: 1,
      totalDeletedLines: 1,
      files: [{
        relativePath: 'src/app.ts',
        status: 'modified',
        indexStatus: ' ',
        workingTreeStatus: 'M',
        staged: false,
        unstaged: true,
        untracked: false,
        addedLines: 1,
        deletedLines: 1,
      }],
    } as any);

    const bundle = await generateSubagentBuildHandoffBundle({
      parentAgentId: 'john',
      buildHandoff: {
        workspaceAgentId: 'john',
        workspaceRelativePath: 'calculator',
        baselineId: 'baseline-1',
        baselineAvailable: true,
      },
    });

    expect(readWorkspaceGitDiff).toHaveBeenCalledWith('john', 'calculator', {
      baselineId: 'baseline-1',
      maxChars: 160000,
    });
    expect(bundle?.changedFiles?.[0]).toMatchObject({
      relativePath: 'src/app.ts',
      changeType: 'modified',
      addedLines: 1,
      deletedLines: 1,
    });
    expect(bundle?.gitSummary).toMatchObject({
      branch: 'main',
      dirty: true,
      changedFileCount: 1,
    });

    const prompt = formatBuildHandoffForPrompt(bundle);
    expect(prompt).toContain('Build handoff from previous child run');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('inspect the inherited edits first');
  });
});

