# Project Work Popup

The Project Work popup is a floating project workspace available from Chat Mode and Build Mode.

## When To Use It

Use it when you want to view or edit a project's lists, notes, drawings, and documents without leaving the current Chat or Build task.

## Opening The Popup

- In Build Mode, open **More options → Project work** under the AI Build Operator prompt.
- In Chat Mode, open **More options** under the first or follow-up prompt, then choose the project work control.
- If the current task or preset is linked to a project, that project opens automatically.
- If nothing is linked, choose a project from the popup.

## Layout

The popup floats above the page. You can:

- Drag it by the header.
- Resize it.
- Reset its position.
- Refresh project work.
- Change the selected project.
- Close it without leaving the page.

The popup uses a slightly tinted surface so it is easier to distinguish from the main Build or Chat page.

## State Filter

The **States** picker controls which work items are shown.

- **Show all** shows every state.
- Choosing one or more states filters the popup.
- The picker highlights when not all states are visible.
- Padlocks can keep chosen state filters persistent in the same style as Build Mode section locks.

Each work item header also includes a state dropdown so you can move that item to another state.

## Lists

Lists show checklist groups from all work items in the selected project.

You can:

- Create a new work item.
- Create, rename, collapse, expand, and delete lists.
- Add, edit, delete, and tick checklist items.
- Assign checklist items.
- Set due dates.
- Add list descriptions for future prompt generation.
- Generate prompts from a list.
- Export selected lists to CSV.

Collapsed list state is remembered.

## Notes

Notes show project work item notes grouped by work item.

You can:

- Create, edit, delete, and title notes.
- Use rich text formatting.
- Create tables.
- Pop notes out and use fullscreen.
- Generate a prompt from a note.
- Copy the note into the current prompt.
- Export selected notes to CSV.

## Drawings

Drawings show drawing cards grouped by work item.

You can:

- Create and edit drawings.
- Use shapes, lines, arrows, freehand drawing, text, fill and outline colors, transparency, stroke style, and thickness.
- Move, resize, duplicate, delete, undo, redo, and zoom.
- Pop drawings out for more room.
- Export drawings with timestamped filenames.
- Attach a drawing to the current prompt as a PNG.

## Documents

Documents show linked files, folders, and web documents grouped by work item.

You can:

- Add local files, local folders, web URLs, Google Docs links, or Microsoft 365 links.
- Edit a document label.
- Relink to the same document or another document.
- Open linked documents.
- Attach a document to the current prompt.

Local file links can break if the file is moved.

## Troubleshooting

- If no work appears, check the selected project and the state filter.
- If a linked task is not selected automatically, confirm the Chat project, direct task, or Build preset is attached to the expected budget project.
- If the popup opens partly off screen, use reset position.
- If another Build popup opens behind it, close or move the Project Work popup, then reopen the other popup.

## Scrapbook And Prompt Actions

For a visual collection of notes, files, links, and saved answers, use **Project Management → Scrapbook**. It uses the same Workboard material; see [Project Scrapbook](./project-scrapbook.md).

Text inserted from project work prepares the current draft and still requires Send/Run. Save reusable instructions to the prompt library and pin them through [All actions](./actions-and-pins.md).

## Related Pages

- [Workboard](./workboard.md)
- [Project Management](./project-management.md)
- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
