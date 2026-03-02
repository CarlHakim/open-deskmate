import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeskmate-skills-'));
const appPath = path.join(tmpRoot, 'app');

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => appPath,
  },
}));

import { uninstallSkill } from '@main/utils/skills';

function skillDir(skillId: string) {
  return path.join(appPath, 'skills', skillId);
}

beforeEach(() => {
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.mkdirSync(path.join(appPath, 'skills'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('uninstallSkill', () => {
  it('returns error when skill folder is missing', async () => {
    const res = await uninstallSkill('missing');
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/Skill folder not found/i);
  });

  it('no-ops when package.json does not exist', async () => {
    fs.mkdirSync(skillDir('no-package'), { recursive: true });
    const res = await uninstallSkill('no-package');
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/No dependencies/i);
  });

  it('reports already uninstalled when node_modules does not exist', async () => {
    fs.mkdirSync(skillDir('already'), { recursive: true });
    fs.writeFileSync(path.join(skillDir('already'), 'package.json'), '{"name":"already"}', 'utf8');
    const res = await uninstallSkill('already');
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/Already uninstalled/i);
  });

  it('removes node_modules when present', async () => {
    fs.mkdirSync(path.join(skillDir('remove-me'), 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(skillDir('remove-me'), 'package.json'), '{"name":"remove-me"}', 'utf8');
    fs.writeFileSync(path.join(skillDir('remove-me'), 'node_modules', 'dep', 'x.txt'), 'x', 'utf8');

    const res = await uninstallSkill('remove-me');
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/Uninstalled/i);
    expect(fs.existsSync(path.join(skillDir('remove-me'), 'node_modules'))).toBe(false);
  });
});

