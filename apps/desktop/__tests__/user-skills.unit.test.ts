import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('user-skills', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates a managed skill and lists it', async () => {
    const userData = tmpDir('opendeskmate-userdata-');
    const appPath = tmpDir('opendeskmate-apppath-');

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: (key: string) => {
          if (key === 'userData') return userData;
          throw new Error('unexpected getPath key: ' + key);
        },
        getAppPath: () => appPath,
      },
    }));

    vi.doMock('../src/main/services/agent-context', () => ({
      getAgentContext: () => ({ workspaceRoot: '' }),
    }));

    const mod = await import('../src/main/services/user-skills');
    const created = mod.createUserSkill({ skillId: 'test-skill', name: 'Test Skill', description: 'Hello' });
    expect(created.skillId).toBe('test-skill');

    const report = mod.listUserSkills({});
    expect(report.skills.some((s) => s.id === 'test-skill')).toBe(true);
    const entry = report.skills.find((s) => s.id === 'test-skill')!;
    expect(entry.name).toBe('Test Skill');
    expect(entry.description).toBe('Hello');
    expect(fs.existsSync(path.join(created.baseDir, 'SKILL.md'))).toBe(true);
  });

  it('workspace skills override managed skills by id', async () => {
    const userData = tmpDir('opendeskmate-userdata-');
    const appPath = tmpDir('opendeskmate-apppath-');
    const workspace = tmpDir('opendeskmate-workspace-');
    fs.mkdirSync(path.join(workspace, 'skills', 'dup'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, 'skills', 'dup', 'SKILL.md'),
      ['---', 'name: Workspace', 'description: From workspace', '---', '', '# Workspace', ''].join('\n'),
      'utf8',
    );

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: (key: string) => {
          if (key === 'userData') return userData;
          throw new Error('unexpected getPath key: ' + key);
        },
        getAppPath: () => appPath,
      },
    }));

    vi.doMock('../src/main/services/agent-context', () => ({
      getAgentContext: () => ({ workspaceRoot: workspace }),
    }));

    const mod = await import('../src/main/services/user-skills');
    mod.createUserSkill({ skillId: 'dup', name: 'Managed', description: 'From managed' });

    const report = mod.listUserSkills({ agentId: 'main' });
    const entry = report.skills.find((s) => s.id === 'dup')!;
    expect(entry.source).toBe('workspace');
    expect(entry.name).toBe('Workspace');
  });

  it('buildUserSkillsPrompt includes SKILL.md body', async () => {
    const userData = tmpDir('opendeskmate-userdata-');
    const appPath = tmpDir('opendeskmate-apppath-');

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: (key: string) => {
          if (key === 'userData') return userData;
          throw new Error('unexpected getPath key: ' + key);
        },
        getAppPath: () => appPath,
      },
    }));

    vi.doMock('../src/main/services/agent-context', () => ({
      getAgentContext: () => ({ workspaceRoot: '' }),
    }));

    const mod = await import('../src/main/services/user-skills');
    mod.createUserSkill({ skillId: 'demo', name: 'Demo', description: 'Desc' });
    const prompt = mod.buildUserSkillsPrompt({});
    expect(prompt).toContain('<skills>');
    expect(prompt).toContain('## Demo');
    expect(prompt).toContain('</skills>');
  });

  it('zip scanning finds SKILL.md folders and sanitizes ids', async () => {
    const userData = tmpDir('opendeskmate-userdata-');
    const appPath = tmpDir('opendeskmate-apppath-');

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: (key: string) => {
          if (key === 'userData') return userData;
          throw new Error('unexpected getPath key: ' + key);
        },
        getAppPath: () => appPath,
      },
    }));

    vi.doMock('../src/main/services/agent-context', () => ({
      getAgentContext: () => ({ workspaceRoot: '' }),
    }));

    const extracted = tmpDir('opendeskmate-skillzip-');
    fs.mkdirSync(path.join(extracted, 'Some Skill'), { recursive: true });
    fs.writeFileSync(
      path.join(extracted, 'Some Skill', 'SKILL.md'),
      ['---', 'name: My Skill', 'description: Hello', '---', '', '# Body', ''].join('\n'),
      'utf8',
    );
    fs.mkdirSync(path.join(extracted, 'nested', 'inner-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(extracted, 'nested', 'inner-skill', 'SKILL.md'),
      ['---', 'name: Inner', '---', '', '# Inner', ''].join('\n'),
      'utf8',
    );

    const mod = await import('../src/main/services/user-skills');
    const candidates = mod.__test.scanSkillCandidates(extracted);
    expect(candidates.length).toBe(2);
    const first = candidates[0];
    expect(first.name).toBeDefined();
    expect(first.skillId).toBe('some-skill');

    expect(mod.__test.sanitizeSkillId('  Weird@Name!! ')).toBe('weird-name');
    expect(mod.__test.resolveGithubZipUrl('https://github.com/a/b')).toContain('/archive/HEAD.zip');
  });

  it('hasBinary detects Windows browser installs in standard locations (when running on win32)', async () => {
    if (process.platform !== 'win32') {
      expect(true).toBe(true);
      return;
    }

    const userData = tmpDir('opendeskmate-userdata-');
    const appPath = tmpDir('opendeskmate-apppath-');

    const fakeProgramFiles = tmpDir('opendeskmate-programfiles-');
    process.env.ProgramFiles = fakeProgramFiles;

    // Create a fake Chrome install path.
    const chromePath = path.join(fakeProgramFiles, 'Google', 'Chrome', 'Application');
    fs.mkdirSync(chromePath, { recursive: true });
    fs.writeFileSync(path.join(chromePath, 'chrome.exe'), 'x');

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: (key: string) => {
          if (key === 'userData') return userData;
          throw new Error('unexpected getPath key: ' + key);
        },
        getAppPath: () => appPath,
      },
    }));

    vi.doMock('../src/main/services/agent-context', () => ({
      getAgentContext: () => ({ workspaceRoot: '' }),
    }));

    const mod = await import('../src/main/services/user-skills');
    expect(mod.__test.hasBinary('chrome')).toBe(true);
  });

  it('defaults agent-created skills to private visibility and supports sharing updates', async () => {
    const userData = tmpDir('opendeskmate-userdata-');
    const appPath = tmpDir('opendeskmate-apppath-');

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: (key: string) => {
          if (key === 'userData') return userData;
          throw new Error('unexpected getPath key: ' + key);
        },
        getAppPath: () => appPath,
      },
    }));

    vi.doMock('../src/main/services/agent-context', () => ({
      getAgentContext: (agentId?: string) => ({
        agentId: agentId || 'main',
        workspaceRoot: '',
        agent: { id: agentId || 'main', name: agentId || 'main' },
      }),
    }));

    const mod = await import('../src/main/services/user-skills');
    const created = mod.createUserSkill({ skillId: 'private-skill', name: 'Private Skill', description: 'Agent made this' });
    const nextRaw = [
      '---',
      'name: Private Skill',
      'description: Agent made this',
      'metadata: |',
      '  {',
      '    "opendeskmate": {',
      '      "generatedBy": "agent-user-instruction",',
      '      "generatedByAgentName": "main",',
      '      "generatedByAgentId": "main"',
      '    }',
      '  }',
      '---',
      '',
      '# Private Skill',
      '',
      '- Test',
      '',
    ].join('\n');
    await mod.writeUserSkillFile({
      skillId: created.skillId,
      relPath: 'SKILL.md',
      content: nextRaw,
      source: 'managed',
      agentId: 'main',
    });

    const ownerView = mod.listUserSkills({ agentId: 'main' });
    expect(ownerView.skills.some((skill) => skill.id === created.skillId)).toBe(true);

    const otherView = mod.listUserSkills({ agentId: 'other' });
    expect(otherView.skills.some((skill) => skill.id === created.skillId)).toBe(false);

    const res = await mod.setUserSkillSharing({
      skillId: created.skillId,
      scope: 'selected',
      sharedWithAgentIds: ['other'],
      source: 'managed',
      agentId: 'main',
    });
    expect(res.ok).toBe(true);

    const otherViewAfterShare = mod.listUserSkills({ agentId: 'other' });
    expect(otherViewAfterShare.skills.some((skill) => skill.id === created.skillId)).toBe(true);
  });
});
