# Settings: Workspace Defaults

Set the default folder used as a workspace root for tasks.

## When To Use It

Use this section when Chat tasks, Build tasks, skills, or agents should start from a predictable folder.

## Quick Steps

1. Open **Settings > Workspace Defaults**.
2. Choose the default workspace folder.
3. Save the setting.
4. Start a new task and confirm the working folder is correct.
5. Clear the setting if you want each task or agent to choose independently.

## Key Settings

- **Choose workspace folder**
  - Selects a folder as default working root.
- **Clear workspace folder**
  - Removes the default, allowing per-task/per-agent behavior.

## Why It Matters

- A stable workspace path helps with consistent file paths and skill behavior.
- Agent-scoped workspace rules and permission behavior rely on predictable roots.

## Troubleshooting

- If a task opens the wrong folder, check the active agent, selected preset, and workspace default.
- If Build Mode uses a preset folder, the preset can override the default.
- If file permissions behave unexpectedly, confirm the workspace root matches the folder you intend to allow.

## Related Sections

- [Agents](./agents.md)
- [Memory (User Context)](./memory-user-context.md)
