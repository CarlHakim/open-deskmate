import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import { detectProjectRuntime } from '@main/services/build-mode/runtime-adapters';

const tempDirs: string[] = [];

function makeProject(packageJson: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeskmate-runtime-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('build runtime command inference', () => {
  test('infers quality commands from common package scripts', () => {
    const workspaceRoot = makeProject({
      scripts: {
        dev: 'vite',
        build: 'vite build',
        'type-check': 'tsc --noEmit',
        eslint: 'eslint .',
        'test:unit': 'vitest run',
      },
      dependencies: {
        vite: '^6.0.0',
      },
    });

    const detection = detectProjectRuntime(workspaceRoot);

    expect(detection.commands.buildCommand).toBe('npm run build');
    expect(detection.commands.typecheckCommand).toBe('npm run type-check');
    expect(detection.commands.lintCommand).toBe('npm run eslint');
    expect(detection.commands.testCommand).toBe('npm run test:unit');
  });

  test('uses the detected package manager for inferred quality commands', () => {
    const workspaceRoot = makeProject(
      {
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'eslint .',
          test: 'vitest run',
        },
      },
      { 'pnpm-lock.yaml': '' }
    );

    const detection = detectProjectRuntime(workspaceRoot);

    expect(detection.packageManager).toBe('pnpm');
    expect(detection.commands.typecheckCommand).toBe('pnpm run typecheck');
    expect(detection.commands.lintCommand).toBe('pnpm run lint');
    expect(detection.commands.testCommand).toBe('pnpm run test');
  });
});
