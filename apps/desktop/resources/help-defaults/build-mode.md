# Build Mode

Build Mode is the workspace-oriented development view. It combines project selection, runtime control, file editing, terminals, runtime logs, chat history, project work, screenshots, and Git review in one page.

## When To Use It

Use Build Mode when the task is tied to a workspace folder, source files, a running preview, terminal commands, Git changes, or a project preset.

## Main Areas

- **Project & Workspace**
  - Select the active workspace path.
  - Browse the workspace tree, including hidden files and directories.
  - Open files in the built-in editor.
  - Manage project presets.
  - Attach a project preset to a usage project.
- **Runtime Preview / File Editor**
  - View the running app preview or switch to the file editor.
  - Capture a selected area or the full Runtime Preview when the preview is active.
- **Terminals and Runtime Logs**
  - Open multiple terminals.
  - Review merged runtime output.
  - Export runtime logs.
- **AI Build Operator**
  - Send Build prompts.
  - Load build task history.
  - Track subagents for the current build task.
  - Open project work linked to the current preset.
  - Optionally enable **Ask AI to run tests** for code-changing tasks.
  - Navigate long Build chats with the Prompt Navigator.
  - Pop out, copy, save, or export final answers.
- **Changes & Git**
  - Review code changes produced during the Build workflow.
  - See Git repository state, branch, remote, ahead/behind status, and changed file counts.
  - Commit, push, add remotes, create branches, and resolve mismatches through guided flows.

## Quick Steps

1. Choose the workspace path.
2. Select a preset, or use **No preset** for the current workspace only.
3. Start the runtime if the project needs preview or logs.
4. Send a Build task to the AI Build Operator.
5. Review the preview, files, terminals, logs, and Changes & Git as the task runs.
6. Commit and push updates when the Git panel says it is safe.

## Step-By-Step: Run A Build Task Safely

1. Confirm the selected workspace and preset are correct.
2. Attach the preset to a project budget if usage should be tracked.
3. Start the runtime preview when the task affects a visible app.
4. Enable **Ask AI to run tests** if code changes should include automated tests and checks.
5. Enter the Build prompt and run the task.
6. Watch the answer stream, edited-files card, runtime logs, and Changes & Git.
7. Run checks or preview the app before committing.
8. Use Changes & Git to review, commit, and push when ready.

## Build Task Output

- Reasoning appears separately from final answers when the model provides reasoning text.
- Edited-files cards appear in the chat stream after runs that change files.
- Activity events show tool calls, permission requests, errors, retries, and recovery actions when needed.
- Final answers can be popped out, copied with formatting, saved as project notes, or exported as RTF files.

## Tests And Smoke Testing

Use **Ask AI to run tests** when the Build task changes code and you want the AI to add or update tests, run relevant checks, and fix failures. The instruction is added only when the task starts and does not change the visible prompt text.

For UI work, ask for a smoke test. Build Mode can expose runtime tools that let the AI inspect runtime status, start or restart the preview, capture screenshots, read page structure, test safe visible controls, inspect logs, run checks, and summarize evidence.

## Project Work

The project work button under the Build prompt opens a floating project work popup.

- If the current preset is attached to a usage project, that project opens automatically.
- If no project is attached, choose a project from the popup.
- Lists, notes, drawings, and documents are shown from the selected project's work items.

## Layout Controls

Use the **Sections** menu to show, hide, or lock Build Mode sections.

- AI Build Operator Only hides every other Build Mode section.
- Hidden sections can be locked so they stay hidden after switching modes or restarting.
- Project & Workspace, AI Build Operator, Terminal, Runtime Logs, and Changes & Git can be resized.

## Troubleshooting

- If the workspace tree starts in the wrong folder, refresh the Project & Workspace tree and confirm the selected preset path.
- If Changes & Git says there is no repository, initialize Git or choose a workspace that already has a `.git` folder.
- If a runtime screenshot button is disabled, start or refresh Runtime Preview first.
- If the AI Build Operator is hard to read, use **Sections > AI Build Operator Only** or resize the side panels.
- If a Git action is disabled, hover the disabled action or open Resolve mismatch to see what is missing.

## Related Settings

- [Settings: Build Mode Safety](./settings/build-mode-safety.md)
- [Settings: Workspace Defaults](./settings/workspace-defaults.md)
- [Settings: Agents](./settings/agents.md)
- [Settings: API usage estimate](./settings/usage-estimate.md)

## Related Pages

- [Build Mode Layout And Sections](./build-layout-and-sections.md)
- [Build Smoke Testing](./build-smoke-testing.md)
- [Changes And Git](./changes-and-git.md)
- [Runtime Screenshots](./runtime-screenshots.md)
- [Prompt Navigator](./prompt-navigator.md)
- [Project Work Popup](./project-work-popup.md)
- [Project Management](./project-management.md)
- [Workboard](./workboard.md)
- [Saving Answers And Exports](./saving-answers-and-exports.md)
- [Activity Timeline And Recovery](./activity-timeline-and-recovery.md)
- [Slash Commands](./slash-commands.md)
- [Subagents](./subagents.md)
- [Chat Mode](./chat-mode.md)
