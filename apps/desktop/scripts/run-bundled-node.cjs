/**
 * Run a script using the bundled Node.js binary (downloaded by download-nodejs.cjs).
 *
 * This is important for native modules that must match the bundled runtime (e.g. MCP servers).
 *
 * Usage:
 *   node scripts/run-bundled-node.cjs <scriptPath> [...args]
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_VERSION = '20.18.1';

function resolveBundledNodeBin() {
  const platform = process.platform;
  const arch = process.arch;

  // Mirrors apps/desktop/scripts/download-nodejs.cjs directory layout.
  const root = path.join(__dirname, '..', 'resources', 'nodejs', `${platform}-${arch}`);
  if (!fs.existsSync(root)) return null;

  if (platform === 'win32') {
    const exe = path.join(root, `node-v${NODE_VERSION}-win-${arch === 'x64' ? 'x64' : arch}`, 'node.exe');
    return fs.existsSync(exe) ? exe : null;
  }

  if (platform === 'darwin') {
    const bin = path.join(root, `node-v${NODE_VERSION}-darwin-${arch}`, 'bin', 'node');
    return fs.existsSync(bin) ? bin : null;
  }

  // Not currently bundled.
  return null;
}

const bundledNode = resolveBundledNodeBin();
if (!bundledNode) {
  console.error('[run-bundled-node] Bundled Node binary not found. Did you run download:nodejs?');
  process.exit(1);
}

const [, , scriptPath, ...scriptArgs] = process.argv;
if (!scriptPath) {
  console.error('Usage: node scripts/run-bundled-node.cjs <scriptPath> [...args]');
  process.exit(1);
}

const resolvedScript = path.isAbsolute(scriptPath) ? scriptPath : path.join(process.cwd(), scriptPath);

const result = spawnSync(bundledNode, [resolvedScript, ...scriptArgs], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.error) {
  console.error('[run-bundled-node] Failed:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

