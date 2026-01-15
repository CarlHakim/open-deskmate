import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/test-results',

  // Serial execution (Electron single-instance)
  workers: 1,
  fullyParallel: false,

  // Timeouts
  timeout: 60000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: { maxDiffPixels: 100, threshold: 0.2 }
  },

  // Retry on CI
  retries: process.env.CI ? 2 : 0,

  // Reporters
  reporter: [
    ['html', { outputFolder: './e2e/html-report' }],
    ['json', { outputFile: './e2e/test-results.json' }],
    ['list']
  ],

  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'electron-fast',
      testMatch: /.*(home|execution|settings)\.spec\.ts/,
      timeout: 30000,
    },
    {
      name: 'electron-integration',
      testMatch: /.*integration\.spec\.ts/,
      timeout: 120000,
      retries: 0,
    }
  ],
});
