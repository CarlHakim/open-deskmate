# Settings: Runtime Hooks

Manage the JSON-backed runtime hook registry and inspect recent hook activity.

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

## Related Pages

- [Settings: Developer](./developer.md)
- [Settings: Agents](./agents.md)
- [Settings Overview](./overview.md)
