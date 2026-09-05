/**
 * Run npm using the bundled Node.js distribution (downloaded by download-nodejs.cjs).
 *
 * This keeps native modules ABI-compatible with the bundled runtime.
 *
 * Usage:
 *   node scripts/run-bundled-npm.cjs <npm args...>
 * Example:
 *   node scripts/run-bundled-npm.cjs --prefix skills/memory-tools install --omit=dev
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_VERSION = '22.23.2';

function resolveBundledNodeRoot() {
  const platform = process.platform;
  const arch = process.arch;
  const root = path.join(__dirname, '..', 'resources', 'nodejs', `${platform}-${arch}`);
  if (!fs.existsSync(root)) return null;

  if (platform === 'win32') {
    const dir = path.join(root, `node-v${NODE_VERSION}-win-${arch === 'x64' ? 'x64' : arch}`);
    return fs.existsSync(dir) ? dir : null;
  }

  if (platform === 'darwin') {
    const dir = path.join(root, `node-v${NODE_VERSION}-darwin-${arch}`);
    return fs.existsSync(dir) ? dir : null;
  }

  return null;
}

function resolveBundledNpmBin(nodeRoot) {
  const nodeBin = process.platform === 'win32'
    ? path.join(nodeRoot, 'node.exe')
    : path.join(nodeRoot, 'bin', 'node');
  const npmCli = path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(nodeBin) && fs.existsSync(npmCli)) {
    return { node: nodeBin, cli: npmCli };
  }

  if (process.platform !== 'win32') {
    const npmBin = path.join(nodeRoot, 'bin', 'npm');
    if (fs.existsSync(npmBin)) return npmBin;
  }

  return null;
}

const bundledNodeRoot = resolveBundledNodeRoot();
if (!bundledNodeRoot) {
  console.error('[run-bundled-npm] Bundled Node distribution not found. Did you run download:nodejs?');
  process.exit(1);
}

const npmBin = resolveBundledNpmBin(bundledNodeRoot);
if (!npmBin) {
  console.error('[run-bundled-npm] Bundled npm not found in Node distribution.');
  process.exit(1);
}

const npmArgs = process.argv.slice(2);
if (npmArgs.length === 0) {
  console.error('Usage: node scripts/run-bundled-npm.cjs <npm args...>');
  process.exit(1);
}

const pathDelimiter = process.platform === 'win32' ? ';' : ':';
const bundledNodeBinDir = process.platform === 'win32'
  ? bundledNodeRoot
  : path.join(bundledNodeRoot, 'bin');
const childEnv = {
  ...process.env,
  PATH: `${bundledNodeBinDir}${pathDelimiter}${process.env.PATH || ''}`,
  npm_config_node: process.platform === 'win32'
    ? path.join(bundledNodeRoot, 'node.exe')
    : path.join(bundledNodeRoot, 'bin', 'node'),
};

let result;
if (typeof npmBin !== 'string') {
  result = spawnSync(npmBin.node, [npmBin.cli, ...npmArgs], {
    stdio: 'inherit',
    env: childEnv,
    shell: false,
  });
} else {
  result = spawnSync(npmBin, npmArgs, {
    stdio: 'inherit',
    env: childEnv,
    shell: false,
  });
}

if (result.error) {
  console.error('[run-bundled-npm] Failed:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
