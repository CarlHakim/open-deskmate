const { spawnSync } = require('child_process');

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

// Rebuild native modules for Electron. Use prebuilt binaries when available.
let rebuildResult = { status: 0, stdout: '', stderr: '' };
if (!shouldSkipRebuild) {
  rebuildResult = run(rebuildBin, ['--use-prebuilt'], {
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
} else {
  if (isWin) {
    console.warn('[postinstall] Skipping skills install on Windows. Set SKIP_SKILLS_INSTALL=0 to force.');
  }
}

if (!isWin) {
  if (devBrowserResult.status !== 0 || filePermissionResult.status !== 0) {
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
  process.exit(0);
}
