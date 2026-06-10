# Settings: Runtime Hooks

Manage the JSON-backed runtime hook registry and inspect recent hook activity.

## When To Use It

Use runtime hooks when you need advanced task/tool policy, prompt mutation, diagnostics, or custom guardrails that run before or after task events.

## Quick Steps

1. Open **Settings > Runtime Hooks**.
2. Review the hook registry path.
3. Edit the hook JSON.
4. Save the registry.
5. Run a small task that should trigger the hook.
6. Check diagnostics to confirm whether the hook matched.

## Step-By-Step: Diagnose A Hook

1. Clear old diagnostics.
2. Run the smallest task that should trigger the hook.
3. Return to **Runtime Hooks**.
4. Review matched and blocked hook entries.
5. Check input/output previews.
6. Narrow or fix the hook rule.
7. Re-run the task.

## What This Section Does

- Shows the current runtime hook registry path.
- Lets you edit the hook registry JSON in-app.
- Saves the registry back to disk.
- Displays recent diagnostics for matched and blocked hooks.
- Lets you clear diagnostics after review.

## Typical Uses

- Block a tool call under local policy.
- Append hidden system guidance before a task starts.
- Patch task or tool inputs before execution.
- Record notes after task or tool completion.

## Diagnostics

The diagnostics area helps you review:

- whether a hook matched
- whether execution was blocked
- which hook ids fired
- input and output previews for recent events

## Caution

- Runtime hooks can change task behavior before the user-visible transcript updates.
- Keep hook rules narrow and intentional.
- Use the diagnostics list to confirm a hook is doing what you expect.

## Troubleshooting

- If a hook does not run, confirm the event name and match conditions.
- If a hook blocks too much, narrow its match rules.
- If task behavior changes unexpectedly, temporarily disable recent hooks.
- If JSON fails to save, validate syntax and remove trailing commas.

## Related Pages

- [Settings: Developer](./developer.md)
- [Settings: Agents](./agents.md)
- [Settings Overview](./overview.md)
