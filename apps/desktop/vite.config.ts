import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
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

export default defineConfig(() => ({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'src/main/index.ts',
        onstart({ startup }) {
          // Ensure Electron runs in app mode even if the parent shell sets ELECTRON_RUN_AS_NODE.
          const env = { ...process.env };
          delete env.ELECTRON_RUN_AS_NODE;
          startup(['.', '--no-sandbox'], { env });
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
