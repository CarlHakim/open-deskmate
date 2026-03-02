const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
}

// better-sqlite3 is a native addon. It must match the ABI of the runtime that loads it.
// In dev, we run this script with the developer's Node. In packaged apps, this runs
// during packaging and should match Electron's embedded Node ABI (usually the same
// as the developer Node used for builds, but we avoid hard-coding).
const TARGET_NODE_VERSION = process.env.OPENDESKMATE_NODE_TARGET || process.versions.node;

const skillRoot = path.join(__dirname, '..');
const betterSqliteRoot = path.join(skillRoot, 'node_modules', 'better-sqlite3');
const prebuildInstallBin = path.join(skillRoot, 'node_modules', 'prebuild-install', 'bin.js');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        headers: {
          'User-Agent': 'open-deskmate',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
            return;
          }
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        headers: {
          'User-Agent': 'open-deskmate',
          Accept: '*/*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function getNodeAbi(targetVersion) {
  // Prefer node-abi if present; fall back to known Node ABI majors.
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const nodeAbi = require('node-abi');
    return nodeAbi.getAbi(targetVersion, 'node');
  } catch {
    const major = Number(String(targetVersion).split('.')[0] || 0);
    const map = {
      18: '108',
      20: '115',
      22: '127',
    };
    const abi = map[major];
    if (!abi) throw new Error(`Unknown Node ABI for target=${targetVersion}.`);
    return abi;
  }
}

async function downloadPinnedPrebuildFromGithub() {
  if (!fs.existsSync(betterSqliteRoot)) {
    throw new Error('[memory-tools] better-sqlite3 is missing. Did install run? ' + betterSqliteRoot);
  }
  const pkgJson = JSON.parse(fs.readFileSync(path.join(betterSqliteRoot, 'package.json'), 'utf8'));
  const version = pkgJson.version;
  const abi = getNodeAbi(TARGET_NODE_VERSION);
  const assetName = `better-sqlite3-v${version}-node-v${abi}-${process.platform}-${process.arch}.tar.gz`;

  const release = await fetchJson(
    `https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v${version}`,
  );
  const asset = Array.isArray(release.assets) ? release.assets.find((a) => a && a.name === assetName) : null;
  if (!asset || !asset.browser_download_url) {
    const names = Array.isArray(release.assets) ? release.assets.map((a) => a.name).slice(0, 20) : [];
    throw new Error(
      `[memory-tools] Could not find GitHub release asset ${assetName}. Found: ${names.join(', ')}`,
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeskmate-better-sqlite3-'));
  const archivePath = path.join(tmpDir, assetName);
  await downloadFile(asset.browser_download_url, archivePath);

  // Extract into better-sqlite3 package root (archive contains build/Release/better_sqlite3.node).
  run('tar', ['-xzf', archivePath], { cwd: betterSqliteRoot });
}

if (!fs.existsSync(prebuildInstallBin)) {
  throw new Error(
    '[memory-tools] prebuild-install is missing. Did you run `npm --prefix skills/memory-tools install` first?\n' +
      `Expected: ${prebuildInstallBin}`,
  );
}

const env = {
  ...process.env,
  // prebuild-install reads npm_config_* vars; on Windows env var keys are case-insensitive,
  // so we set both lower + upper forms to avoid surprises from parent processes.
  npm_config_runtime: 'node',
  NPM_CONFIG_RUNTIME: 'node',
  npm_config_target: TARGET_NODE_VERSION,
  NPM_CONFIG_TARGET: TARGET_NODE_VERSION,
  npm_config_arch: process.arch,
  NPM_CONFIG_ARCH: process.arch,
  npm_config_platform: process.platform,
  NPM_CONFIG_PLATFORM: process.platform,
  npm_config_build_from_source: 'false',
  NPM_CONFIG_BUILD_FROM_SOURCE: 'false',
  npm_config_fallback_to_build: 'false',
  NPM_CONFIG_FALLBACK_TO_BUILD: 'false',
};

async function main() {
  try {
    run(
      process.execPath,
      [
        prebuildInstallBin,
        '--runtime',
        'node',
        '--target',
        TARGET_NODE_VERSION,
        '--arch',
        process.arch,
        '--platform',
        process.platform,
        '--fallback-to-build',
        'false',
      ],
      {
        cwd: betterSqliteRoot,
        env,
      },
    );
  } catch (err) {
    // prebuild-install can get confused when invoked inside Electron packaging where npm_config_* is set
    // for Electron. If that happens (or if a download fails), fall back to a direct GitHub release fetch.
    console.warn('[memory-tools] prebuild-install failed, attempting GitHub release pin:', err?.message || err);
    await downloadPinnedPrebuildFromGithub();
  }

  const binaryPath = path.join(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(binaryPath)) {
    throw new Error('Pinned prebuild not found at expected path: ' + binaryPath);
  }

  console.log('[memory-tools] Pinned prebuilt better-sqlite3 binary:', binaryPath);
}

main().catch((err) => {
  console.error('[memory-tools] Failed to pin better-sqlite3 prebuild:', err?.stack || err?.message || err);
  process.exitCode = 1;
});
