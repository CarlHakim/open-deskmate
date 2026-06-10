# Chat Mode

Chat Mode is the main conversation workspace for task-oriented AI help.

## When To Use It

Use Chat Mode when you want an answer, report, analysis, research task, file-based task, or multi-step conversation that does not need a live app runtime.

## What You Can Do

- Start a new task from the Home prompt.
- Attach files before sending the first prompt.
- Choose a project budget for usage tracking.
- Continue an existing task with follow-up prompts.
- Stop a running task.
- Use saved prompts and recipes.
- Open project work linked to the current task.
- Save answers as project notes or RTF files.
- Save a completed workflow as a reusable skill.
- Switch to Build Mode when the task becomes workspace- or runtime-oriented.

## Quick Steps

1. Enter the task in the Home prompt.
2. Optionally attach files, choose a working folder, or choose a project budget first.
3. Send the prompt and review the response history.
4. Continue with follow-up prompts until the task is done.
5. Copy, pop out, save, or export useful answers.
6. Save the result as a skill if the workflow should be reusable.

## Step-By-Step: Save An Answer To Project Work

1. Open the task answer you want to keep.
2. Use the answer bubble action to save the answer as a project note or RTF file.
3. Choose the attached project, another existing project, or create a new project.
4. Choose an existing work item, or create a new work item.
5. Add a title if the note or file should be easier to find later.
6. Save the note or file and check the project work item if you need to confirm it was attached.

## Useful Features

- **Project budget selector**
  - Attach a task to a usage project so input hit, input miss, output tokens, and estimated cost are grouped with the right project.
  - Tasks inside a Chat project inherit that Chat project's attached budget unless you choose another project.
- **Project work popup**
  - Open the linked project's lists, notes, drawings, and documents without leaving Chat Mode.
- **Saved prompts and recipes**
  - Insert reusable prompts from the prompt picker.
  - Manage categories from Settings.
- **Prompt history**
  - Use the up and down arrow keys in the prompt input to move through previous prompts.
- **Activity and reasoning**
  - Activity events show tool calls, permissions, errors, retries, and recovery actions when needed.
  - Reasoning text is separated from final answers when the model provides it.
- **Images**
  - Image links can show inline images and thumbnails under answer bubbles.
  - Open an image preview to zoom, pan, and move through images from that answer only.
- **Saving and export**
  - Copy answers with rich formatting where supported.
  - Save answers as rich project notes.
  - Export answers as RTF files and optionally attach them to a project work item.
- **Slash commands**
  - Type `/` in the initial prompt or follow-up prompt.
  - See [Slash Commands](./slash-commands.md).
- **Subagents**
  - Child agents can be tracked from the current chat when enabled for the active agent.
  - See [Subagents](./subagents.md).
- **Save as skill**
  - Available for completed chats that can be turned into a reusable workflow.

## Troubleshooting

- If a task does not inherit the expected budget, check whether the task is inside a Chat project and whether that Chat project is attached to a budget project.
- If image previews do not load, open the original image externally to confirm the URL is reachable.
- If copying to Word loses formatting, use the answer copy button rather than manually selecting text.
- If follow-up prompts feel unrelated, confirm you are in the intended task history item before sending the prompt.

## Related Pages

- [Getting Started](./getting-started.md)
- [Build Mode](./build-mode.md)
- [Project Management](./project-management.md)
- [Project Budgets And Usage](./project-budgets-and-usage.md)
- [Saved Prompts And Recipes](./saved-prompts-and-recipes.md)
- [Saving Answers And Exports](./saving-answers-and-exports.md)
- [Activity Timeline And Recovery](./activity-timeline-and-recovery.md)
- [Images In Chat](./images-in-chat.md)
- [Slash Commands](./slash-commands.md)
- [Subagents](./subagents.md)
