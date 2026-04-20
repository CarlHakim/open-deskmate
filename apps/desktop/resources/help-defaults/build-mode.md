# Build Mode

Build Mode is the workspace-oriented development view. It combines project selection, runtime control, file editing, terminals, runtime logs, chat history, and diff review in one page.

## Main Areas

- **Project & Workspace**
  - Select the active workspace path.
  - Browse the workspace tree, including hidden files and directories.
  - Open files in the built-in editor.
  - Manage project presets.
- **Runtime Preview / File Editor**
  - View the running app preview or switch to the file editor.
- **Terminals and Runtime Logs**
  - Open multiple terminals.
  - Review merged runtime output.
  - Export runtime logs.
- **AI Build Operator**
  - Send Build prompts.
  - Load build task history.
  - Track subagents for the current build task.
- **Proposed Changes / Diff**
  - Review code changes produced during the Build workflow.

## Typical Workflow

1. Choose the workspace path.
2. Select a preset, or use **No preset** for the current workspace only.
3. Start the runtime if the project needs preview or logs.
4. Send a Build task to the AI Build Operator.
5. Review the preview, files, terminals, logs, and diff as the task runs.

## Related Settings

- [Settings: Build Mode Safety](./settings/build-mode-safety.md)
- [Settings: Workspace Defaults](./settings/workspace-defaults.md)
- [Settings: Agents](./settings/agents.md)

## Related Pages

- [Slash Commands](./slash-commands.md)
- [Subagents](./subagents.md)
- [Chat Mode](./chat-mode.md)
