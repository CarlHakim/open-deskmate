# Saving Answers And Exports

Chat and Build answers can be copied, popped out, saved as notes, or exported.

## When To Use It

Use these actions when an answer is long, needs to be reused outside the app, should become a project note, or should be saved as a document file.

## Quick Steps

1. Find the answer bubble.
2. Use copy, popout, save as note, or save as RTF.
3. Choose a project and work item when saving to project work.
4. Add a title when the note or document should be searchable later.
5. Confirm the note, RTF file, or document link was created.

## Step-By-Step: Save An Answer As A Note

1. Open the answer bubble actions.
2. Choose the save-to-note action.
3. Choose the current attached project, another project, or create a new project.
4. Choose an existing work item or create a new one.
5. Enter a note title.
6. Save the note.
7. Open the work item Notes section if you want to review or edit it.

## Step-By-Step: Export An Answer As RTF

1. Open the answer bubble actions.
2. Choose RTF export.
3. Review the timestamped default filename.
4. Choose a folder and rename the file if needed.
5. Save the file.
6. Optionally attach the exported file as a document link to a project work item.

## Copying Answers

Use the copy button on an answer bubble or answer popout.

Rich copy preserves common formatting when the destination supports it:

- Headings.
- Bold and italic text.
- Bullet and numbered lists.
- Tables.
- Links.

Plain text destinations such as Notepad receive a compatible plain text version.

For word processors such as Microsoft Word, use the built-in copy action instead of manually selecting the text. The built-in copy includes both rich HTML and plain text where supported by the destination app.

## Answer Popout

Long answers can be opened in a larger reading popup.

The popout includes:

- Copy.
- Fullscreen.
- Close.

## Save As Project Note

You can save an answer as a rich note on a project work item.

If the current task is attached to a project, that project is selected by default. Otherwise you can:

- Choose an existing project.
- Create a new project.
- Choose an existing work item.
- Create a new work item.
- Add a note title.

Tables, headings, bullet lists, links, and other rich formatting are preserved in the note.

## Save As RTF

You can export an answer as a Rich Text Format file.

The save dialog uses a timestamped default filename such as:

```text
final-answer_2026-06-10_14-32-08.rtf
```

You can choose the location and rename the file before saving.

RTF output is designed for word processors such as Microsoft Word and preserves tables where possible.

RTF files use a standard timestamped filename by default so long answer text does not accidentally become an invalid filename. You can rename the file in the save dialog.

## Attach Exported Files To Work Items

When saving an RTF file, you can also attach it to a project work item as a document link.

The same save-to-note and save-to-RTF flows are available from Chat Mode answers and Build Mode final answers.

## Troubleshooting

- If the work item dropdown is empty, confirm the selected project actually has work items, or create a new work item.
- If a note is too large to save, export as RTF or split the answer into smaller notes.
- If Word does not preserve formatting, use the answer copy/export buttons rather than selecting text manually.
- If an RTF filename is rejected, use the default timestamped name or shorten the custom name.
- If a saved note loses table formatting, reopen the work item note editor and confirm the note was saved as rich text, not plain text.

## New Answer Actions And Scrapbook

[Answer Actions](./answer-actions.md) explains **Useful**, **Explain more**, **Try another direction**, and **Save this approach**. Useful is a local marker; Save this approach creates a reusable prompt template. Follow-up actions prepare a draft and require Send/Run.

Use **Save to scrapbook** for a project reference snapshot with an optional note and source-task link. Open it through **Project Management → Scrapbook** and edit it through Workboard. See [Project Scrapbook](./project-scrapbook.md).

Interactive widget adjustments are local display state. Existing copy/export flows retain the recorded answer rather than incorporating changed quantities or checkbox selections. Record important adjusted values explicitly before exporting; see [Interactive Answers And Choices](./interactive-answers-and-choices.md).

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Project Management](./project-management.md)
- [Workboard](./workboard.md)
