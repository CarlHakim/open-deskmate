import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

export interface SkillStatus {
  id: string;
  name: string;
  description?: string;
  path: string;
  hasPackageJson: boolean;
  installed: boolean;
  installable: boolean;
}

export interface SkillInstallResult {
  skillId: string;
  success: boolean;
  output: string;
}

async function rmWithRetries(targetPath: string, attempts = 4): Promise<void> {
  // On Windows, removing node_modules can fail transiently due to file locks.
  // Retry a few times to make uninstall reliable.
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
    }
  }
  throw lastError;
}

function getSkillsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'skills');
  }
  return path.join(app.getAppPath(), 'skills');
}

function toTitleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseSkillFrontMatter(contents: string): { name?: string; description?: string } {
  if (!contents.startsWith('---')) {
    return {};
  }
  const lines = contents.split(/\r?\n/);
  const meta: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') {
      break;
    }
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    meta[key.trim()] = rest.join(':').trim();
  }
  return {
    name: meta.name,
    description: meta.description,
  };
}

function readSkillMetadata(skillPath: string, skillId: string): { name: string; description?: string } {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    try {
      const contents = fs.readFileSync(skillMdPath, 'utf8');
      const frontMatter = parseSkillFrontMatter(contents);
      return {
        name: frontMatter.name || toTitleCase(skillId),
        description: frontMatter.description,
      };
    } catch (error) {
      console.warn('[Skills] Failed to read SKILL.md for', skillId, error);
    }
  }
  return { name: toTitleCase(skillId) };
}

function hasNodeModules(skillPath: string): boolean {
  const nodeModulesPath = path.join(skillPath, 'node_modules');
  return fs.existsSync(nodeModulesPath);
}

export function listSkillsStatus(): SkillStatus[] {
  const skillsRoot = getSkillsRoot();
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }

  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'));

  return entries.map((skillId) => {
    const skillPath = path.join(skillsRoot, skillId);
    const packageJsonPath = path.join(skillPath, 'package.json');
    const hasPackageJson = fs.existsSync(packageJsonPath);
    const installed = hasPackageJson ? hasNodeModules(skillPath) : true;
    const metadata = readSkillMetadata(skillPath, skillId);

    return {
      id: skillId,
      name: metadata.name,
      description: metadata.description,
      path: skillPath,
      hasPackageJson,
      installed,
      installable: hasPackageJson,
    };
  });
}

export function installSkill(skillId: string): Promise<SkillInstallResult> {
  const skillsRoot = getSkillsRoot();
  const skillPath = path.join(skillsRoot, skillId);
  const packageJsonPath = path.join(skillPath, 'package.json');

  if (!fs.existsSync(skillPath)) {
    return Promise.resolve({ skillId, success: false, output: 'Skill folder not found.' });
  }

  if (!fs.existsSync(packageJsonPath)) {
    return Promise.resolve({ skillId, success: true, output: 'No dependencies to install.' });
  }

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const npmCommand = 'npm';
    const args = ['--prefix', skillPath, 'install', '--no-fund', '--no-audit'];
    const child = spawn(npmCommand, args, {
      shell: isWin,
      env: { ...process.env },
    });

    let output = '';
    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (error) => {
      resolve({ skillId, success: false, output: `Failed to start npm: ${error.message}` });
    });

    child.on('close', (code) => {
      resolve({
        skillId,
        success: code === 0,
        output: output || (code === 0 ? 'Install complete.' : `Install failed with code ${code}`),
      });
    });
  });
}

export async function uninstallSkill(skillId: string): Promise<SkillInstallResult> {
  const skillsRoot = getSkillsRoot();
  const skillPath = path.join(skillsRoot, skillId);
  const packageJsonPath = path.join(skillPath, 'package.json');

  if (!fs.existsSync(skillPath)) {
    return { skillId, success: false, output: 'Skill folder not found.' };
  }

  if (!fs.existsSync(packageJsonPath)) {
    // Non-installable/bundled skills without dependencies are treated as always available.
    return { skillId, success: true, output: 'No dependencies to uninstall.' };
  }

  const nodeModulesPath = path.join(skillPath, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    return { skillId, success: true, output: 'Already uninstalled.' };
  }

  try {
    await rmWithRetries(nodeModulesPath);
    return { skillId, success: true, output: 'Uninstalled (removed node_modules).' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { skillId, success: false, output: `Failed to uninstall: ${message}` };
  }
}

export async function installAllSkills(): Promise<SkillInstallResult[]> {
  const statuses = listSkillsStatus();
  const installTargets = statuses.filter((skill) => skill.installable);
  const results: SkillInstallResult[] = [];

  for (const skill of installTargets) {
    // Install sequentially to avoid npm lock contention
    // eslint-disable-next-line no-await-in-loop
    const result = await installSkill(skill.id);
    results.push(result);
  }

  return results;
}
