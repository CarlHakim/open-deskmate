import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'path';

// Desktop app with local React UI
// No longer uses remote UI from Vercel

const sharedAliases = {
  '@accomplish/shared': path.resolve(__dirname, '../../packages/shared/src'),
  '@': path.resolve(__dirname, 'src/renderer'),
  '@main': path.resolve(__dirname, 'src/main'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
  '@shared': path.resolve(__dirname, '../../packages/shared/src'),
};

const require = createRequire(import.meta.url);
const electronBinaryPath: string = require('electron');
let electronChild: ChildProcess | null = null;
let electronShutdownHooksAttached = false;

function killProcessTree(pid?: number): void {
  if (!pid || !Number.isFinite(pid)) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
      return;
    }
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

function stopElectronChild(): void {
  if (!electronChild) return;
  const pid = electronChild.pid;
  electronChild.removeAllListeners();
  electronChild = null;
  killProcessTree(pid);
}

function ensureElectronShutdownHooks(): void {
  if (electronShutdownHooksAttached) return;
  electronShutdownHooksAttached = true;

  const shutdown = () => {
    stopElectronChild();
  };

  process.once('exit', shutdown);
  process.once('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
  process.once('SIGHUP', () => {
    shutdown();
    process.exit(0);
  });
}

function startElectronChild(): void {
  ensureElectronShutdownHooks();
  stopElectronChild();

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  electronChild = spawn(electronBinaryPath, ['.', '--no-sandbox'], {
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  electronChild.once('exit', () => {
    electronChild = null;
  });
}

export default defineConfig(() => ({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'src/main/index.ts',
        onstart() {
          // Explicitly manage Electron child lifecycle to avoid dev shutdown hangs on Windows.
          startElectronChild();
        },
        vite: {
          resolve: {
            alias: sharedAliases,
          },
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              // Keep native/optional deps external for the Node runtime.
              external: [
                'electron',
                'electron-store',
                'keytar',
                'node-pty',
                'discord.js',
                'grammy',
                '@picovoice/porcupine-node',
                '@picovoice/pvrecorder-node',
                'ws',
                'zlib-sync',
                'bufferutil',
                'utf-8-validate',
              ],
            },
          },
        },
      },
      {
        // Preload script for local renderer
        entry: 'src/preload/index.ts',
        onstart({ reload }) {
          reload();
        },
        vite: {
          resolve: {
            alias: sharedAliases,
          },
          build: {
            outDir: 'dist-electron/preload',
            lib: {
              formats: ['cjs'],
              fileName: (format, entryName) =>
                format === 'cjs' ? `${entryName}.cjs` : `${entryName}.mjs`,
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: sharedAliases,
  },
  // Build the React renderer
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
