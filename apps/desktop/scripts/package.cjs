#!/usr/bin/env node

/**
 * Custom packaging script for Electron app with pnpm workspaces.
 * Temporarily removes workspace symlinks that cause electron-builder issues.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const resourcesDir = path.join(__dirname, '..', 'resources');
const iconPngPath = path.join(resourcesDir, 'icon.png');
const iconIcoPath = path.join(resourcesDir, 'icon.ico');
const memoryToolsDir = path.join(__dirname, '..', 'skills', 'memory-tools');
const skillsDir = path.join(__dirname, '..', 'skills');
const appDir = path.join(__dirname, '..');
const builderCliPath = path.join(appDir, 'node_modules', 'electron-builder', 'cli.js');

function createPackageEnv() {
  const env = { ...process.env };

  if (process.platform === 'win32') {
    const nodeOptions = env.NODE_OPTIONS || '';
    if (!nodeOptions.split(/\s+/).includes('--use-system-ca')) {
      env.NODE_OPTIONS = `${nodeOptions} --use-system-ca`.trim();
    }
  }

  return env;
}

function cleanStaleWindowsOutput(args) {
  if (process.platform !== 'win32' || !args.some((arg) => arg === '--win' || arg === '-w' || arg === 'win')) {
    return;
  }

  const winUnpackedDir = path.join(appDir, 'release', 'win-unpacked');
  fs.rmSync(winUnpackedDir, { recursive: true, force: true });
}

async function ensureWindowsIcon() {
  if (process.platform !== 'win32') {
    return;
  }
  if (!fs.existsSync(iconPngPath)) {
    console.warn('[package] icon.png not found, skipping .ico generation');
    return;
  }
  if (fs.existsSync(iconIcoPath)) {
    const pngStat = fs.statSync(iconPngPath);
    const icoStat = fs.statSync(iconIcoPath);
    if (icoStat.mtimeMs >= pngStat.mtimeMs) {
      return;
    }
  }
  let pngToIco = null;
  try {
    pngToIco = require('png-to-ico');
  } catch (err) {
    console.warn('[package] png-to-ico not available, skipping .ico generation');
    return;
  }
  const icoBuffer = await pngToIco(iconPngPath);
  fs.writeFileSync(iconIcoPath, icoBuffer);
  console.log('[package] Generated icon.ico for Windows packaging');
}

function pinMemoryToolsBinary() {
  try {
    const script = path.join(memoryToolsDir, 'scripts', 'pin-prebuild.cjs');
    if (!fs.existsSync(script)) {
      console.warn('[package] memory-tools pin-prebuild script not found, skipping.');
      return;
    }
    console.log('[package] Pinning better-sqlite3 prebuild for memory-tools...');
    execSync(`node "${script}"`, { stdio: 'inherit', cwd: memoryToolsDir });
  } catch (err) {
    console.error('[package] Failed to pin memory-tools prebuild:', err?.message || err);
    process.exit(1);
  }
}

function pruneSkillWorkspaceLinks() {
  if (!fs.existsSync(skillsDir)) {
    return;
  }

  const removed = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      let stats;
      try {
        stats = fs.lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isSymbolicLink()) {
        const normalized = fullPath.split(path.sep).join('/').toLowerCase();
        if (
          normalized.includes('/skills/')
          && normalized.includes('/node_modules/')
          && (
            normalized.endsWith('/node_modules/accomplish')
            || normalized.endsWith('/node_modules/opendeskmate')
            || normalized.includes('/node_modules/@accomplish/')
            || normalized.endsWith('/node_modules/@accomplish')
          )
        ) {
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            removed.push(fullPath);
          } catch (err) {
            console.warn('[package] Failed to prune skill workspace link:', fullPath, err?.message || err);
          }
          continue;
        }
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  walk(skillsDir);

  if (removed.length > 0) {
    console.log(`[package] Pruned ${removed.length} skill workspace link(s) before packaging.`);
    for (const item of removed) {
      console.log(`  - ${item}`);
    }
  }
}

const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
const accomplishPath = path.join(nodeModulesPath, '@accomplish');

// Save symlink target for restoration
let symlinkTarget = null;
const sharedPath = path.join(accomplishPath, 'shared');
const shouldManageSymlink = true;
let replacedWithCopy = false;

(async () => {
  try {
  // Check if @accomplish/shared symlink exists
  if (shouldManageSymlink && fs.existsSync(sharedPath)) {
    const stats = fs.lstatSync(sharedPath);
    if (stats.isSymbolicLink()) {
      symlinkTarget = fs.readlinkSync(sharedPath);
      const targetPath = path.resolve(path.dirname(sharedPath), symlinkTarget);
      console.log('Temporarily removing workspace symlink:', sharedPath);
      fs.unlinkSync(sharedPath);

      if (process.platform === 'win32') {
        // Copy the workspace package into node_modules to keep all files under appDir.
        fs.cpSync(targetPath, sharedPath, { recursive: true });
        replacedWithCopy = true;
      } else {
        // Remove empty @accomplish directory if it exists
        try {
          fs.rmdirSync(accomplishPath);
        } catch {
          // Directory not empty or doesn't exist, ignore
        }
      }
    }
  }

  // Get command line args (everything after 'node scripts/package.js')
  const args = process.argv.slice(2);

    await ensureWindowsIcon();
    pinMemoryToolsBinary();
    pruneSkillWorkspaceLinks();
    cleanStaleWindowsOutput(args);
    console.log('Running:', `node ${path.relative(appDir, builderCliPath)} ${args.join(' ')}`.trim());
    execFileSync(process.execPath, [builderCliPath, ...args], {
      stdio: 'inherit',
      cwd: appDir,
      env: createPackageEnv(),
    });
  } finally {
  // Restore the symlink
  if (symlinkTarget && shouldManageSymlink) {
    console.log('Restoring workspace symlink');

    // Recreate @accomplish directory if needed
    if (!fs.existsSync(accomplishPath)) {
      fs.mkdirSync(accomplishPath, { recursive: true });
    }

    if (replacedWithCopy) {
      try {
        fs.rmSync(sharedPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      fs.symlinkSync(symlinkTarget, sharedPath, 'junction');
    } catch (err) {
      console.warn('[package] Failed to restore workspace symlink:', err.message || err);
    }
  }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
