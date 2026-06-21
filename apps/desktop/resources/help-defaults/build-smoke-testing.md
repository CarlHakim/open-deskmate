# Build Smoke Testing

Build smoke testing lets the Build Mode AI inspect and test a running preview without the user manually taking screenshots or pressing extra buttons.

## When To Use It

Use it when a Build task changes a visible app, UI, route, form, button, or page behavior and you want the AI to verify that the result actually works.

## What The AI Can Use

For Build Mode tasks, the app can expose Build runtime tools that are scoped to the active workspace and preset.

The tools can provide:

- Runtime status.
- Runtime start or restart.
- Runtime logs.
- Terminal snapshots.
- Runtime preview screenshots.
- Full-page preview screenshots.
- Page structure snapshots.
- Safe UI interaction tests.
- Quality checks.
- Git summary.

These tools are Build-only and do not allow arbitrary desktop screenshots or unrelated paths.

## Quick Steps

1. Open Build Mode.
2. Select the correct workspace and preset.
3. Start the runtime, or ask the AI to test the running app.
4. Include what you want verified in the Build prompt.
5. If code changes should be tested, enable **Ask AI to run tests**.
6. Review the AI's smoke-test summary, screenshots, logs, and checks.

## Suggested Prompt

```text
Smoke test the app after this change. Start or inspect the runtime, capture a full-page preview, test the main visible buttons and forms that are safe to use, read logs, run relevant checks, and report what passed or failed.
```

## Ask AI To Run Tests

The Build prompt area includes **Ask AI to run tests**.

When enabled, the app adds this instruction at task start:

```text
If this task changes code, add or update automated tests covering the behavior, run the relevant checks, and keep fixing issues until they pass. If the project has no test setup and tests are appropriate for this codebase, add a lightweight setup and package scripts first. For non-code tasks, do not create a test framework.
```

This does not change the visible prompt text. It only guides the AI for that run.

## How UI Testing Works

The AI should:

1. Check runtime status.
2. Start or restart the runtime if needed.
3. Capture a preview screenshot or full-page preview.
4. Read a page snapshot to identify visible controls.
5. Click or type into safe controls.
6. Verify the visible result.
7. Check logs for errors.
8. Run quality checks when relevant.
9. Summarize evidence and any caveats.

## Limits

- Destructive UI actions should be avoided unless the task clearly asks for them.
- Some controls need explicit selectors instead of short labels.
- Keyboard shortcuts may need indirect verification when synthetic key events are not supported.
- Smoke tests can show confidence, but they are not a full QA suite.

## Troubleshooting

- If the AI says the runtime is not available, start the preview and retry, or ask it to start the runtime.
- If UI interaction chooses the wrong button, ask the AI to use a more specific selector or visible context.
- If the AI repeats the same inspection step, the repeated tool-call guard should stop the loop and explain what happened.
- If screenshots fail, use the manual [Runtime Screenshots](./runtime-screenshots.md) workflow.

## Related Pages

- [Build Mode](./build-mode.md)
- [Runtime Screenshots](./runtime-screenshots.md)
- [Changes And Git](./changes-and-git.md)
- [Troubleshooting Agent Loops](./troubleshooting-agent-loops.md)
