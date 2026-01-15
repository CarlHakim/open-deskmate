# E2E Test Plan: Agent-Testable Testing Infrastructure

## Executive Summary

This plan implements Playwright-based E2E testing for the Openwork Electron app that enables AI agents to:
- Launch the app programmatically
- Capture screenshots at key UI states
- Evaluate UI against expected designs via JSON manifests
- Run fast mocked tests (< 1s each) and slower integration tests

**Key approach:** Extend existing `E2E_SKIP_AUTH` pattern with `E2E_MOCK_TASK_EVENTS` for fast UI testing without real PTY/API calls.

---

## Infrastructure Setup

### Current State (from Infra Specialist)

**Build System:**
- Vite + Electron bundling
- Output: `dist/` (renderer), `dist-electron/` (main process)
- Dev: `pnpm dev`, Build: `pnpm build`

**Existing Test Infrastructure:**
- Vitest for unit/integration tests
- `__tests__/` directory with `main/`, `renderer/`, `integration/` folders
- E2E_SKIP_AUTH pattern already implemented

**CI/CD:**
- GitHub Actions at `.github/workflows/ci.yml`
- Jobs: `unit-tests`, `integration-tests`, `typecheck`, `coverage`
- Missing: E2E tests

### Required Changes

#### 1. Add Playwright Dependency

```bash
pnpm -F @accomplish/desktop add -D @playwright/test
pnpm -F @accomplish/desktop exec playwright install --with-deps
```

#### 2. Create Directory Structure

```
apps/desktop/
├── e2e/
│   ├── fixtures/
│   │   └── electron-app.ts      # App launch fixture
│   ├── pages/
│   │   ├── home.page.ts         # Page object model
│   │   └── execution.page.ts    # Page object model
│   ├── utils/
│   │   └── screenshots.ts       # AI-agent screenshot utilities
│   ├── specs/
│   │   ├── home.spec.ts
│   │   ├── execution.spec.ts
│   │   ├── settings.spec.ts
│   │   └── integration.spec.ts  # Real task tests (slow)
│   └── test-results/            # .gitignore
├── playwright.config.ts
└── src/main/test-utils/
    └── mock-task-flow.ts        # Mock IPC event emitter
```

#### 3. Playwright Configuration

**File:** `apps/desktop/playwright.config.ts`

```typescript
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
      testMatch: /.*\.(home|execution|settings)\.spec\.ts/,
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
```

#### 4. GitHub Actions Workflow

**File:** `.github/workflows/e2e.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
    paths:
      - 'apps/desktop/**'
      - 'packages/**'
      - '.github/workflows/e2e.yml'
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e-tests:
    runs-on: macos-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm -F @accomplish/desktop exec playwright install --with-deps
      - run: pnpm -F @accomplish/desktop build

      - name: Run E2E tests
        run: pnpm -F @accomplish/desktop test:e2e
        env:
          E2E_SKIP_AUTH: '1'
          CI: true

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-test-results
          path: apps/desktop/e2e/test-results/
          retention-days: 7
```

---

## UI Component Analysis (from UI Specialist)

### Component Hierarchy

```
App.tsx (Router)
├── Sidebar
│   ├── New Task button
│   ├── Task list (ConversationListItem)
│   └── Settings button
└── Routes
    ├── HomePage
    │   ├── Title: "What will you accomplish today?"
    │   ├── TaskInputBar (textarea + submit)
    │   └── Example cards grid (9 items, 3x3)
    ├── ExecutionPage
    │   ├── Header (back, title, status badge, cancel)
    │   ├── Messages area
    │   │   ├── MessageBubble (user/assistant/tool)
    │   │   └── Thinking indicator (spinning icon)
    │   ├── Permission modal (Allow/Deny)
    │   ├── Browser install modal (progress bar)
    │   └── Footer input (follow-up/stop)
    └── SettingsDialog
        ├── Model selector
        ├── API key management
        ├── Debug toggle
        └── Version info
```

### Recommended data-testid Attributes

```tsx
// Home page
<h1 data-testid="home-title">...</h1>
<textarea data-testid="task-input-textarea" />
<button data-testid="task-input-submit" />
<button data-testid="home-examples-toggle">Example prompts</button>
<button data-testid="home-example-0">...</button>

// Execution page
<span data-testid="execution-status-badge">{status}</span>
<button data-testid="execution-cancel-button" />
<div data-testid="execution-thinking-indicator" />
<div data-testid="execution-permission-modal" />
<button data-testid="permission-allow-button">Allow</button>
<button data-testid="permission-deny-button">Deny</button>
<input data-testid="execution-follow-up-input" />
<button data-testid="execution-stop-button" />

// Settings
<select data-testid="settings-model-select" />
<input data-testid="settings-api-key-input" type="password" />
<button data-testid="settings-api-key-save">Save API Key</button>
<button data-testid="settings-debug-toggle" role="switch" />

// Sidebar
<button data-testid="sidebar-new-task-button">New Task</button>
<button data-testid="sidebar-settings-button">Settings</button>
```

### Animation Patterns

- **Page transitions:** Framer Motion `fadeUp` variant
- **Stagger animations:** 0.05s delay between list items
- **Thinking indicator:** `animate-spin` on icon
- **Streaming text:** 120 chars/sec typewriter effect
- **Modal entry:** `springs.bouncy` scale animation

---

## Test Cases (from Testing Specialist)

### 1. Home Page Tests (`home.spec.ts`)

| Test | Scenario | Screenshot |
|------|----------|------------|
| Initial state | Title visible, input empty, examples visible | `home-initial.png` |
| Input focus | Ring effect visible | `home-input-focused.png` |
| Example selection | Click example → fills input | `home-example-selected.png` |
| Submit without API key | Opens settings dialog | `home-settings-dialog.png` |
| Submit with API key | Navigates to execution | N/A |

### 2. Execution Page Tests (`execution.spec.ts`)

| Test | Scenario | Screenshot |
|------|----------|------------|
| Running state | Spinning icon, "Thinking..." | `execution-running.png` |
| Tool usage | Tool name badge (e.g., "Reading files") | `execution-tool-read.png` |
| Permission modal | Shows file path, CREATE badge | `execution-permission-modal.png` |
| Completed state | Green badge, follow-up input visible | `execution-completed.png` |
| Failed state | Red badge, error message | `execution-failed.png` |
| Interrupted state | Amber badge, continue button | `execution-interrupted.png` |
| Browser installation | Progress bar at N% | `execution-browser-install.png` |

### 3. Settings Tests (`settings.spec.ts`)

| Test | Scenario | Screenshot |
|------|----------|------------|
| Model section | Dropdown with providers | `settings-model-section.png` |
| API key input | Provider selected, input visible | `settings-api-key-input.png` |
| Saved keys list | Keys with masked values | `settings-saved-keys.png` |
| Debug mode enabled | Toggle on, warning shown | `settings-debug-mode.png` |

---

## Implementation Code (from Coder Specialist)

### Mock Task Flow Utility

**File:** `apps/desktop/src/main/test-utils/mock-task-flow.ts`

```typescript
import { BrowserWindow } from 'electron';
import type { Task, TaskMessage, TaskResult, PermissionRequest } from '@accomplish/shared';

export interface MockTaskFlowConfig {
  taskId: string;
  prompt: string;
  scenario: 'success' | 'with-tool' | 'permission-required' | 'error' | 'interrupted';
  delayMs?: number;
}

export function isMockTaskEventsEnabled(): boolean {
  return (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS === true;
}

export function enableMockTaskEvents(): void {
  (global as Record<string, unknown>).E2E_MOCK_TASK_EVENTS = true;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeMockTaskFlow(
  window: BrowserWindow,
  config: MockTaskFlowConfig
): Promise<Task> {
  const { taskId, prompt, scenario, delayMs = 100 } = config;

  // Initial progress
  window.webContents.send('task:progress', { taskId, stage: 'init' });
  await sleep(delayMs);

  // Thinking message
  window.webContents.send('task:update', {
    taskId,
    type: 'message',
    message: {
      id: createMessageId(),
      type: 'assistant',
      content: `I'll help you with: ${prompt}`,
      timestamp: new Date().toISOString(),
    }
  });
  await sleep(delayMs);

  // Scenario-specific flow
  switch (scenario) {
    case 'success':
      window.webContents.send('task:update', {
        taskId,
        type: 'complete',
        result: { status: 'success', sessionId: `session_${taskId}` }
      });
      break;

    case 'with-tool':
      window.webContents.send('task:update:batch', {
        taskId,
        messages: [
          { id: createMessageId(), type: 'tool', content: 'Reading files', toolName: 'Read', timestamp: new Date().toISOString() },
          { id: createMessageId(), type: 'tool', content: 'Searching code', toolName: 'Grep', timestamp: new Date().toISOString() },
        ]
      });
      await sleep(delayMs);
      window.webContents.send('task:update', {
        taskId,
        type: 'complete',
        result: { status: 'success', sessionId: `session_${taskId}` }
      });
      break;

    case 'permission-required':
      window.webContents.send('permission:request', {
        id: `perm_${Date.now()}`,
        taskId,
        type: 'file',
        question: 'Allow file write?',
        toolName: 'Write',
        fileOperation: 'create',
        filePath: '/test/output.txt',
        timestamp: new Date().toISOString(),
      });
      break;

    case 'error':
      window.webContents.send('task:update', {
        taskId,
        type: 'error',
        error: 'Command execution failed: File not found'
      });
      break;

    case 'interrupted':
      window.webContents.send('task:update', {
        taskId,
        type: 'complete',
        result: { status: 'interrupted', sessionId: `session_${taskId}` }
      });
      break;
  }

  return {
    id: taskId,
    prompt,
    status: 'running',
    messages: [],
    createdAt: new Date().toISOString(),
  };
}

export function createMockTask(taskId: string, prompt: string): Task {
  return {
    id: taskId,
    prompt,
    status: 'running',
    messages: [{ id: createMessageId(), type: 'user', content: prompt, timestamp: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}
```

### IPC Handler Modification

**File:** `apps/desktop/src/main/ipc/handlers.ts` (add to task:start handler)

```typescript
import { isMockTaskEventsEnabled, createMockTask, executeMockTaskFlow } from '../test-utils/mock-task-flow';

// Inside task:start handler, add at the beginning:
if (isMockTaskEventsEnabled()) {
  const mockTask = createMockTask(taskId, validatedConfig.prompt);

  // Determine scenario from prompt keywords
  let scenario: 'success' | 'with-tool' | 'permission-required' | 'error' | 'interrupted' = 'success';
  const promptLower = validatedConfig.prompt.toLowerCase();
  if (promptLower.includes('tool') || promptLower.includes('search')) scenario = 'with-tool';
  else if (promptLower.includes('permission') || promptLower.includes('write')) scenario = 'permission-required';
  else if (promptLower.includes('error') || promptLower.includes('fail')) scenario = 'error';
  else if (promptLower.includes('interrupt') || promptLower.includes('stop')) scenario = 'interrupted';

  void executeMockTaskFlow(window, { taskId, prompt: validatedConfig.prompt, scenario, delayMs: 50 });
  return mockTask;
}
```

### Electron App Fixture

**File:** `apps/desktop/e2e/fixtures/electron-app.ts`

```typescript
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';

type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../dist-electron/main/index.js'), '--e2e-skip-auth'],
      env: {
        ...process.env,
        E2E_SKIP_AUTH: '1',
        E2E_MOCK_TASK_EVENTS: '1',
        NODE_ENV: 'test',
      },
    });

    await app.evaluate(async () => {
      (global as any).E2E_SKIP_AUTH = true;
      (global as any).E2E_MOCK_TASK_EVENTS = true;
    });

    await use(app);
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
```

### Screenshot Utility with AI Metadata

**File:** `apps/desktop/e2e/utils/screenshots.ts`

```typescript
import type { Page } from '@playwright/test';
import * as fs from 'fs/promises';
import path from 'path';

export interface ScreenshotMetadata {
  testName: string;
  stateName: string;
  viewport: { width: number; height: number };
  route: string;
  taskStatus?: string;
  evaluationCriteria: string[];
}

export interface AIEvaluationManifest {
  screenshots: Array<{
    path: string;
    expectedPath?: string;
    metadata: ScreenshotMetadata;
  }>;
  generatedAt: string;
}

export async function captureForAI(
  page: Page,
  testName: string,
  stateName: string,
  evaluationCriteria: string[]
): Promise<string> {
  const timestamp = Date.now();
  const filename = `${testName}-${stateName}-${timestamp}.png`;
  const screenshotPath = path.join(__dirname, '../test-results/screenshots', filename);

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
  });

  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const metadata: ScreenshotMetadata = {
    testName,
    stateName,
    viewport,
    route: page.url(),
    evaluationCriteria,
  };

  await fs.writeFile(
    screenshotPath.replace('.png', '.json'),
    JSON.stringify(metadata, null, 2)
  );

  return screenshotPath;
}

export async function generateManifest(
  screenshots: Array<{ path: string; metadata: ScreenshotMetadata }>
): Promise<void> {
  const manifest: AIEvaluationManifest = {
    screenshots: screenshots.map(s => ({
      path: s.path,
      expectedPath: s.path.replace('test-results', 'baseline'),
      metadata: s.metadata,
    })),
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(__dirname, '../test-results/ai-evaluation-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}
```

---

## Pre-Implementation Refactoring (from Code Reviewer)

### High Priority Issues

1. **Extract callback handlers** (`handlers.ts:286-370`)
   - Move `onComplete`, `onError`, `onMessage` to separate file
   - Enable unit testing of callback logic
   - Effort: Medium, Impact: High

2. **Extract message batching** (`handlers.ts:88-165`)
   - Create `TaskMessageBatcher` class with dependency injection
   - Test batching logic with fake timers
   - Effort: Medium, Impact: High

3. **Export utility functions** (`handlers.ts:1017-1060`)
   - Export `sanitizeToolOutput`, `extractScreenshots`
   - Add unit tests for regex patterns
   - Effort: Low, Impact: Medium

### Quick Wins

- Export `validateTaskConfig` and add unit tests
- Create test fixture factories in `__tests__/fixtures/`
- Add custom Vitest matchers for domain assertions

---

## Execution Order

### Phase 1: Infrastructure (1-2 hours)
- [ ] Install Playwright: `pnpm -F @accomplish/desktop add -D @playwright/test`
- [ ] Create `playwright.config.ts`
- [ ] Create directory structure
- [ ] Add npm scripts: `test:e2e`, `test:e2e:ui`, `test:e2e:debug`
- [ ] Add `.gitignore` entries for test artifacts

### Phase 2: Mock Task Flow (1-2 hours)
- [ ] Create `src/main/test-utils/mock-task-flow.ts`
- [ ] Add mock mode check to `task:start` handler
- [ ] Update main process to handle `E2E_MOCK_TASK_EVENTS` env var

### Phase 3: Data-testid Attributes (1 hour)
- [ ] Add testids to Home page components
- [ ] Add testids to Execution page components
- [ ] Add testids to Settings dialog
- [ ] Add testids to Sidebar

### Phase 4: Test Implementation (2-3 hours)
- [ ] Create Electron app fixture
- [ ] Create page objects (HomePage, ExecutionPage)
- [ ] Write `home.spec.ts` tests
- [ ] Write `execution.spec.ts` tests
- [ ] Write `settings.spec.ts` tests
- [ ] Create screenshot utility

### Phase 5: CI Integration (30 min)
- [ ] Create `.github/workflows/e2e.yml`
- [ ] Test workflow locally with `act`

### Phase 6: Verification
- [ ] `pnpm -F @accomplish/desktop test:e2e` passes
- [ ] Screenshots generated in `e2e/test-results/`
- [ ] AI evaluation manifest generated
- [ ] CI workflow succeeds on GitHub

---

## Key UI States to Screenshot

| Page | State | Evaluation Criteria |
|------|-------|---------------------|
| Home | Initial | Title "What will you accomplish today?" visible, input focused, 9 example cards in 3x3 grid |
| Home | Settings dialog | API key fields visible, Model section at top |
| Execution | Running | Spinning icon visible, "Thinking..." or tool name |
| Execution | Tool use | Tool badge (e.g., "Reading files") visible |
| Execution | Permission | Modal with Allow/Deny buttons, file path shown |
| Execution | Completed | Green "Completed" badge, follow-up input visible |
| Execution | Failed | Red "Failed" badge, error message visible |
| Execution | Interrupted | Amber "Stopped" badge, Continue button visible |

---

## Package.json Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:fast": "playwright test --project=electron-fast",
    "test:e2e:integration": "playwright test --project=electron-integration",
    "test:e2e:report": "playwright show-report e2e/html-report"
  }
}
```

---

## Future Enhancements (Not in Scope)

- Midscene.js integration for natural language UI assertions
- UI-TARS self-hosted model for semantic evaluation
- Cross-platform testing (Windows/Linux CI runners)
- Visual regression baseline management workflow
