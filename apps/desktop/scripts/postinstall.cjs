const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
  });

  if (result.error) {
    console.warn(`[postinstall] ${command} failed to start:`, result.error.message);
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result;
}

function runOrHandle(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    return result;
  }
  return result;
}

const isWin = process.platform === 'win32';
const rebuildBin = isWin ? 'electron-rebuild.cmd' : 'electron-rebuild';
const shouldSkipRebuild = process.env.SKIP_ELECTRON_REBUILD === '1';
const shouldSkipSkills =
  process.env.SKIP_SKILLS_INSTALL === '1' ||
  (isWin && process.env.SKIP_SKILLS_INSTALL !== '0');
const installTimeoutMs = Number(process.env.SKILLS_INSTALL_TIMEOUT_MS || 300000);
const appRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');

function isWindowsExecutable(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(2);
    fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);
    return header[0] === 0x4d && header[1] === 0x5a; // "MZ"
  } catch {
    return false;
  }
}

function resolveOptionalOpenCodeBinary(packageName, sourceBinary) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [appRoot, workspaceRoot],
    });
    const binaryPath = path.join(path.dirname(packageJsonPath), 'bin', sourceBinary);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {
    // pnpm may not expose optional dependency packages through normal resolution.
  }

  const pnpmRoots = [
    path.join(appRoot, 'node_modules', '.pnpm'),
    path.join(workspaceRoot, 'node_modules', '.pnpm'),
  ];
  for (const pnpmRoot of pnpmRoots) {
    if (!fs.existsSync(pnpmRoot)) continue;
    const entries = fs.readdirSync(pnpmRoot);
    for (const entry of entries) {
      if (!entry.startsWith(`${packageName}@`)) continue;
      const binaryPath = path.join(pnpmRoot, entry, 'node_modules', packageName, 'bin', sourceBinary);
      if (fs.existsSync(binaryPath)) {
        return binaryPath;
      }
    }
  }

  return null;
}

function repairOpenCodeBinary() {
  const opencodeRoot = path.join(appRoot, 'node_modules', 'opencode-ai');
  const sourceBinary = isWin ? 'opencode.exe' : 'opencode';
  const targetBinary = path.join(opencodeRoot, 'bin', 'opencode.exe');

  if (!fs.existsSync(opencodeRoot)) {
    return;
  }

  if (!isWin && fs.existsSync(targetBinary)) {
    return;
  }

  if (isWin && isWindowsExecutable(targetBinary)) {
    return;
  }

  const platform = isWin ? 'windows' : process.platform;
  const packageNames =
    isWin && process.arch === 'x64'
      ? [`opencode-${platform}-${process.arch}`, `opencode-${platform}-${process.arch}-baseline`]
      : [`opencode-${platform}-${process.arch}`];

  for (const packageName of packageNames) {
    const source = resolveOptionalOpenCodeBinary(packageName, sourceBinary);
    if (!source) continue;
    fs.mkdirSync(path.dirname(targetBinary), { recursive: true });
    fs.copyFileSync(source, targetBinary);
    fs.chmodSync(targetBinary, 0o755);
    console.log(`[postinstall] Repaired opencode-ai binary from ${packageName}.`);
    return;
  }

  console.warn('[postinstall] Could not repair opencode-ai binary; chat tasks may fail until opencode-ai postinstall succeeds.');
}

repairOpenCodeBinary();

// Rebuild native modules for Electron. The current CLI uses prebuilt binaries
// when available unless --build-from-source is supplied.
let rebuildResult = { status: 0, stdout: '', stderr: '' };
if (!shouldSkipRebuild) {
  rebuildResult = run(rebuildBin, [], {
    shell: isWin,
  });
}

if (rebuildResult.status !== 0) {
  const output = `${rebuildResult.stdout || ''}${rebuildResult.stderr || ''}`;
  const isSpectreError =
    isWin && /MSB8040|Spectre-mitigated|Spectre mitigated/i.test(output);

  if (isSpectreError) {
    console.warn(
      '[postinstall] electron-rebuild failed due to missing Spectre-mitigated libraries.'
    );
    console.warn(
      '[postinstall] Install "C++ Spectre-mitigated libs (v142)" in Visual Studio Build Tools.'
    );
    console.warn(
      '[postinstall] Then re-run: pnpm -F @accomplish/desktop exec electron-rebuild'
    );
  } else if (!isWin) {
    process.exit(rebuildResult.status || 1);
  } else {
    console.warn(
      '[postinstall] electron-rebuild failed on Windows; continuing install so dev can run.'
    );
  }
}

let devBrowserResult = { status: 0, error: null };
let filePermissionResult = { status: 0, error: null };
let canvasResult = { status: 0, error: null };
let memoryToolsResult = { status: 0, error: null };
let buildRuntimeToolsResult = { status: 0, error: null };
let toolDiscoveryResult = { status: 0, error: null };

if (!shouldSkipSkills) {
  console.log('[postinstall] Installing skills dependencies...');
  devBrowserResult = runOrHandle('npm', ['--prefix', 'skills/dev-browser', 'install', '--no-fund', '--no-audit'], {
    shell: isWin,
    timeout: installTimeoutMs,
  });

  filePermissionResult = runOrHandle('npm', ['--prefix', 'skills/file-permission', 'install', '--no-fund', '--no-audit'], {
    shell: isWin,
    timeout: installTimeoutMs,
  });

  canvasResult = runOrHandle('npm', ['--prefix', 'skills/canvas', 'install', '--no-fund', '--no-audit'], {
    shell: isWin,
    timeout: installTimeoutMs,
  });

  memoryToolsResult = runOrHandle('npm', ['--prefix', 'skills/memory-tools', 'install', '--no-fund', '--no-audit'], {
    shell: isWin,
    timeout: installTimeoutMs,
  });

  buildRuntimeToolsResult = runOrHandle('npm', ['--prefix', 'skills/build-runtime-tools', 'install', '--no-fund', '--no-audit'], {
    shell: isWin,
    timeout: installTimeoutMs,
  });

  toolDiscoveryResult = runOrHandle('npm', ['--prefix', 'skills/tool-discovery', 'install', '--no-fund', '--no-audit'], {
    shell: isWin,
    timeout: installTimeoutMs,
  });

  if (memoryToolsResult.status === 0) {
    const verifyResult = runOrHandle('node', ['skills/memory-tools/scripts/verify-fts5.cjs'], {
      shell: isWin,
      timeout: installTimeoutMs,
    });
    if (verifyResult.status !== 0) {
      console.warn('[postinstall] memory-tools FTS5 verification failed.');
      if (!isWin) process.exit(1);
    }
  }
} else {
  if (isWin) {
    console.warn('[postinstall] Skipping skills install on Windows. Set SKIP_SKILLS_INSTALL=0 to force.');
  }
}

if (!isWin) {
  if (
    devBrowserResult.status !== 0 ||
    filePermissionResult.status !== 0 ||
    canvasResult.status !== 0 ||
    memoryToolsResult.status !== 0 ||
    buildRuntimeToolsResult.status !== 0 ||
    toolDiscoveryResult.status !== 0
  ) {
    process.exit(1);
  }
} else {
  if (devBrowserResult.status !== 0) {
    if (devBrowserResult.error?.code === 'ETIMEDOUT') {
      console.warn('[postinstall] dev-browser install timed out; continuing.');
    }
    console.warn('[postinstall] dev-browser install failed on Windows; continuing.');
  }
  if (filePermissionResult.status !== 0) {
    if (filePermissionResult.error?.code === 'ETIMEDOUT') {
      console.warn('[postinstall] file-permission install timed out; continuing.');
    }
    console.warn('[postinstall] file-permission install failed on Windows; continuing.');
  }
  if (canvasResult.status !== 0) {
    if (canvasResult.error?.code === 'ETIMEDOUT') {
      console.warn('[postinstall] canvas install timed out; continuing.');
    }
    console.warn('[postinstall] canvas install failed on Windows; continuing.');
  }
  if (memoryToolsResult.status !== 0) {
    if (memoryToolsResult.error?.code === 'ETIMEDOUT') {
      console.warn('[postinstall] memory-tools install timed out; continuing.');
    }
    console.warn('[postinstall] memory-tools install failed on Windows; continuing.');
  }
  if (buildRuntimeToolsResult.status !== 0) {
    if (buildRuntimeToolsResult.error?.code === 'ETIMEDOUT') {
      console.warn('[postinstall] build-runtime-tools install timed out; continuing.');
    }
    console.warn('[postinstall] build-runtime-tools install failed on Windows; continuing.');
  }
  if (toolDiscoveryResult.status !== 0) {
    if (toolDiscoveryResult.error?.code === 'ETIMEDOUT') {
      console.warn('[postinstall] tool-discovery install timed out; continuing.');
    }
    console.warn('[postinstall] tool-discovery install failed on Windows; continuing.');
  }
  process.exit(0);
}
