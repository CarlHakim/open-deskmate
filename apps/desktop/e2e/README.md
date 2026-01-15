# E2E Test Infrastructure

This directory contains the E2E test infrastructure for the Openwork desktop app using Playwright.

## Structure

```
e2e/
├── fixtures/          # Test fixtures (Electron app launch)
├── pages/             # Page object models
├── specs/             # Test specifications
├── utils/             # Test utilities (screenshots, helpers)
└── test-results/      # Test output (screenshots, videos, traces)
```

## Fixtures

### electron-app.ts

Provides Electron app launch fixture with E2E configuration:

- **electronApp**: Launches the Electron app with E2E flags
- **window**: Returns the first window (main app window)

Environment variables automatically set:
- `E2E_SKIP_AUTH=1` - Skip onboarding flow
- `E2E_MOCK_TASK_EVENTS=1` - Mock task execution events

## Page Objects

### HomePage

Methods for interacting with the home page:
- `title` - Home page title
- `taskInput` - Task input textarea
- `submitButton` - Submit button
- `getExampleCard(index)` - Get example card by index
- `enterTask(text)` - Enter task text
- `submitTask()` - Submit task

### ExecutionPage

Methods for interacting with the task execution page:
- `statusBadge` - Status badge
- `cancelButton` - Cancel button
- `thinkingIndicator` - Thinking indicator
- `followUpInput` - Follow-up input
- `stopButton` - Stop button
- `permissionModal` - Permission modal
- `allowButton` - Allow button (in permission modal)
- `denyButton` - Deny button (in permission modal)
- `waitForComplete()` - Wait for task completion

### SettingsPage

Methods for interacting with the settings page:
- `title` - Settings page title
- `debugModeToggle` - Debug mode toggle
- `modelSection` - Model section
- `modelSelect` - Model select dropdown
- `apiKeyInput` - API key input
- `addApiKeyButton` - Add API key button
- `navigateToSettings()` - Navigate to settings page
- `toggleDebugMode()` - Toggle debug mode
- `selectModel(modelName)` - Select a model
- `addApiKey(provider, key)` - Add API key

## Utilities

### screenshots.ts

Provides AI-friendly screenshot capture with metadata:

```typescript
import { captureForAI } from '../utils';

await captureForAI(
  page,
  'task-execution',
  'running',
  [
    'Task is actively running',
    'Status badge shows "Running"',
    'Cancel button is visible'
  ]
);
```

The utility creates:
- `{testName}-{stateName}-{timestamp}.png` - Screenshot
- `{testName}-{stateName}-{timestamp}.json` - Metadata (viewport, route, criteria)

## Usage Example

```typescript
import { test, expect } from '../fixtures';
import { HomePage, ExecutionPage } from '../pages';
import { captureForAI } from '../utils';

test('should submit a task and navigate to execution', async ({ window }) => {
  const homePage = new HomePage(window);
  const executionPage = new ExecutionPage(window);

  // Enter task
  await homePage.enterTask('Create a new file called hello.txt');
  await homePage.submitTask();

  // Wait for navigation to execution page
  await executionPage.statusBadge.waitFor({ state: 'visible' });

  // Capture screenshot for AI evaluation
  await captureForAI(
    window,
    'task-submission',
    'execution-started',
    ['Task execution page loaded', 'Status badge visible']
  );

  // Assert
  await expect(executionPage.statusBadge).toBeVisible();
});
```

## Running Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run fast tests only (home, execution, settings)
pnpm test:e2e:fast

# Run integration tests only
pnpm test:e2e:integration

# Run with Playwright UI
pnpm test:e2e:ui

# Run in debug mode
pnpm test:e2e:debug

# View HTML report
pnpm test:e2e:report
```

## Writing Tests

1. Import fixtures and page objects:
   ```typescript
   import { test, expect } from '../fixtures';
   import { HomePage } from '../pages';
   ```

2. Use page objects instead of direct selectors:
   ```typescript
   // Good
   await homePage.submitTask();

   // Bad
   await window.getByTestId('task-input-submit').click();
   ```

3. Add test IDs to new UI elements in renderer:
   ```tsx
   <button data-testid="my-button">Click me</button>
   ```

4. Use `captureForAI` for screenshots with evaluation criteria:
   ```typescript
   await captureForAI(
     window,
     'my-test',
     'some-state',
     ['Criterion 1', 'Criterion 2']
   );
   ```

## Best Practices

- Use page objects for all UI interactions
- Add descriptive test IDs (`data-testid`) to UI elements
- Use `captureForAI` for important states to enable AI-based evaluation
- Keep tests focused and independent
- Use serial execution (configured in playwright.config.ts)
- Mock task events for fast tests, use real execution for integration tests
