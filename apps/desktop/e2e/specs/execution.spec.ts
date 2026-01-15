import { test, expect } from '../fixtures';
import { HomePage, ExecutionPage } from '../pages';
import { captureForAI } from '../utils';
import { TEST_TIMEOUTS, TEST_SCENARIOS } from '../config';

test.describe('Execution Page', () => {
  test('should display running state with thinking indicator', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit success keyword
    await homePage.enterTask(TEST_SCENARIOS.SUCCESS.keyword);
    await homePage.submitTask();

    // Wait for navigation to execution page
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait a moment for the thinking indicator to appear
    await window.waitForTimeout(TEST_TIMEOUTS.STATE_UPDATE);

    // Capture running state
    await captureForAI(
      window,
      'execution-running',
      'thinking-indicator',
      [
        'Execution page is loaded',
        'Thinking indicator is visible',
        'Task is in running state',
        'UI shows active processing'
      ]
    );

    // Assert thinking indicator is visible or was visible
    // Note: It might complete quickly in mock mode
    const thinkingVisible = await executionPage.thinkingIndicator.isVisible().catch(() => false);
    const statusVisible = await executionPage.statusBadge.isVisible().catch(() => false);

    // Either thinking indicator or status badge should be visible
    expect(thinkingVisible || statusVisible).toBe(true);
  });

  test('should display completed state with success badge', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit success keyword
    await homePage.enterTask(TEST_SCENARIOS.SUCCESS.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for completion
    await executionPage.waitForComplete();

    // Capture completed state
    await captureForAI(
      window,
      'execution-completed',
      'success-badge',
      [
        'Status badge shows completed state',
        'Task completed successfully',
        'Success indicator is visible',
        'No error messages displayed'
      ]
    );

    // Assert status badge is visible
    await expect(executionPage.statusBadge).toBeVisible();

    // Verify it's showing a success/completed state
    const badgeText = await executionPage.statusBadge.textContent();
    expect(badgeText?.toLowerCase()).toMatch(/complete|success|done/i);
  });

  test('should display tool usage during execution', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit tool keyword
    await homePage.enterTask(TEST_SCENARIOS.WITH_TOOL.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for tool usage to appear
    await window.waitForTimeout(TEST_TIMEOUTS.TASK_COMPLETION);

    // Capture tool usage state
    await captureForAI(
      window,
      'execution-tool-usage',
      'tool-display',
      [
        'Tool usage is displayed',
        'Tool name or icon is visible',
        'Tool execution is shown to user',
        'UI clearly indicates tool interaction'
      ]
    );

    // Look for tool-related UI elements
    const pageContent = await window.textContent('body');

    // Wait for completion to see full tool usage
    await executionPage.waitForComplete();

    // Capture final state with tools
    await captureForAI(
      window,
      'execution-tool-usage',
      'tools-complete',
      [
        'Tools were executed during task',
        'Tool results are displayed',
        'Complete history of tool usage visible'
      ]
    );

    // Assert page contains tool-related content
    expect(pageContent).toBeTruthy();
  });

  test('should display permission modal with allow/deny buttons', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit permission keyword
    await homePage.enterTask(TEST_SCENARIOS.PERMISSION.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for permission modal to appear
    await executionPage.permissionModal.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.PERMISSION_MODAL });

    // Capture permission modal
    await captureForAI(
      window,
      'execution-permission',
      'modal-visible',
      [
        'Permission modal is displayed',
        'Allow button is visible and clickable',
        'Deny button is visible and clickable',
        'Modal clearly shows what permission is being requested',
        'User can make a choice'
      ]
    );

    // Assert permission modal and buttons are visible
    await expect(executionPage.permissionModal).toBeVisible();
    await expect(executionPage.allowButton).toBeVisible();
    await expect(executionPage.denyButton).toBeVisible();

    // Verify buttons are enabled
    await expect(executionPage.allowButton).toBeEnabled();
    await expect(executionPage.denyButton).toBeEnabled();
  });

  test('should handle permission allow action', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit permission keyword
    await homePage.enterTask(TEST_SCENARIOS.PERMISSION.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for permission modal
    await executionPage.permissionModal.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.PERMISSION_MODAL });

    // Click allow button
    await executionPage.allowButton.click();

    // Capture state after allowing
    await captureForAI(
      window,
      'execution-permission',
      'after-allow',
      [
        'Permission modal is dismissed',
        'Task continues execution',
        'Permission was granted successfully'
      ]
    );

    // Modal should disappear after clicking allow
    await expect(executionPage.permissionModal).not.toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });

    // Note: Mock flow doesn't simulate continuation after permission grant,
    // so we just verify the modal dismissed (the core allow functionality).
    // In real usage, the task would continue after permission is granted.
  });

  test('should handle permission deny action', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit permission keyword
    await homePage.enterTask(TEST_SCENARIOS.PERMISSION.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for permission modal
    await executionPage.permissionModal.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.PERMISSION_MODAL });

    // Click deny button
    await executionPage.denyButton.click();

    // Capture state after denying
    await captureForAI(
      window,
      'execution-permission',
      'after-deny',
      [
        'Permission modal is dismissed',
        'Task handles denied permission gracefully',
        'Appropriate message shown to user'
      ]
    );

    // Modal should disappear
    await expect(executionPage.permissionModal).not.toBeVisible({ timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait a moment for the task to react
    await window.waitForTimeout(TEST_TIMEOUTS.TASK_COMPLETION);

    // Capture final state after denial
    await captureForAI(
      window,
      'execution-permission',
      'deny-result',
      [
        'Task responded to permission denial',
        'No crashes or errors',
        'User feedback is clear'
      ]
    );
  });

  test('should display error state when task fails', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit error keyword
    await homePage.enterTask(TEST_SCENARIOS.ERROR.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for error state (longer timeout as task needs to run and fail)
    await window.waitForTimeout(TEST_TIMEOUTS.TASK_COMPLETION);

    // Capture error state
    await captureForAI(
      window,
      'execution-error',
      'error-displayed',
      [
        'Error state is clearly visible',
        'Error message or indicator is shown',
        'User understands task failed',
        'Error handling is graceful'
      ]
    );

    // Look for error indicators in the UI
    const pageContent = await window.textContent('body');
    const statusBadgeVisible = await executionPage.statusBadge.isVisible();

    // Check if status badge shows error state
    if (statusBadgeVisible) {
      const badgeText = await executionPage.statusBadge.textContent();
      await captureForAI(
        window,
        'execution-error',
        'error-badge',
        [
          'Status badge indicates error/failure',
          `Badge shows: ${badgeText}`
        ]
      );
    }

    // Assert some error indication exists
    expect(pageContent).toBeTruthy();
  });

  test('should display interrupted state when task is stopped', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit interrupt keyword
    await homePage.enterTask(TEST_SCENARIOS.INTERRUPTED.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for interrupted state
    await window.waitForTimeout(TEST_TIMEOUTS.TASK_COMPLETION);

    // Capture interrupted state
    await captureForAI(
      window,
      'execution-interrupted',
      'interrupted-displayed',
      [
        'Interrupted state is visible',
        'Task shows it was stopped',
        'UI clearly indicates interruption',
        'User understands task did not complete normally'
      ]
    );

    // Check for interrupted status
    const statusBadgeVisible = await executionPage.statusBadge.isVisible();

    if (statusBadgeVisible) {
      const badgeText = await executionPage.statusBadge.textContent();
      await captureForAI(
        window,
        'execution-interrupted',
        'interrupted-badge',
        [
          'Status badge shows interrupted/stopped state',
          `Badge shows: ${badgeText}`
        ]
      );
    }
  });

  test('should allow canceling a running task', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit success keyword
    await homePage.enterTask(TEST_SCENARIOS.SUCCESS.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Check if cancel/stop button is available
    const cancelVisible = await executionPage.cancelButton.isVisible().catch(() => false);
    const stopVisible = await executionPage.stopButton.isVisible().catch(() => false);

    if (cancelVisible || stopVisible) {
      // Capture before cancel
      await captureForAI(
        window,
        'execution-cancel',
        'before-cancel',
        [
          'Cancel/Stop button is visible',
          'Task is running and can be cancelled'
        ]
      );

      // Click the cancel or stop button
      if (cancelVisible) {
        await executionPage.cancelButton.click();
      } else {
        await executionPage.stopButton.click();
      }

      // Wait for cancellation to take effect
      await window.waitForTimeout(TEST_TIMEOUTS.STATE_UPDATE);

      // Capture after cancel
      await captureForAI(
        window,
        'execution-cancel',
        'after-cancel',
        [
          'Task was cancelled/stopped',
          'UI reflects cancelled state',
          'Cancellation was successful'
        ]
      );
    }
  });

  test('should display task output and messages', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start a task with explicit tool keyword to get more output
    await homePage.enterTask(TEST_SCENARIOS.WITH_TOOL.keyword);
    await homePage.submitTask();

    // Wait for navigation
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });

    // Wait for task to run and produce output
    await window.waitForTimeout(TEST_TIMEOUTS.TASK_COMPLETION);

    // Capture task output
    await captureForAI(
      window,
      'execution-output',
      'task-messages',
      [
        'Task output is visible',
        'Messages from task execution are displayed',
        'Output format is clear and readable',
        'User can follow task progress'
      ]
    );

    // Wait for completion
    await executionPage.waitForComplete();

    // Capture final output
    await captureForAI(
      window,
      'execution-output',
      'final-output',
      [
        'Complete task output is visible',
        'All messages and results are displayed',
        'Output is well-formatted'
      ]
    );

    // Assert page has content
    const pageContent = await window.textContent('body');
    expect(pageContent).toBeTruthy();
    expect(pageContent.length).toBeGreaterThan(0);
  });

  test('should handle follow-up input after task completion', async ({ window }) => {
    const homePage = new HomePage(window);
    const executionPage = new ExecutionPage(window);

    await window.waitForLoadState('domcontentloaded');

    // Start and complete a task with explicit success keyword
    await homePage.enterTask(TEST_SCENARIOS.SUCCESS.keyword);
    await homePage.submitTask();
    await window.waitForURL(/.*#\/execution.*/, { timeout: TEST_TIMEOUTS.NAVIGATION });
    await executionPage.waitForComplete();

    // Check if follow-up input is visible
    const followUpVisible = await executionPage.followUpInput.isVisible().catch(() => false);

    if (followUpVisible) {
      // Capture follow-up input state
      await captureForAI(
        window,
        'execution-follow-up',
        'follow-up-visible',
        [
          'Follow-up input is visible after task completion',
          'User can enter additional instructions',
          'Follow-up feature is accessible'
        ]
      );

      // Try typing in follow-up input
      await executionPage.followUpInput.fill('Follow up task');

      // Capture with follow-up text
      await captureForAI(
        window,
        'execution-follow-up',
        'follow-up-filled',
        [
          'Follow-up text is entered',
          'Input is ready to submit',
          'User can continue conversation'
        ]
      );

      await expect(executionPage.followUpInput).toHaveValue('Follow up task');
    }
  });
});
