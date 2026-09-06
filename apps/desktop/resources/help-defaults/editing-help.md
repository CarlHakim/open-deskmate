# Editing Help Content

Help docs live in a writable user folder. Stock guides refresh with app updates when their contents are unchanged; your own edits are preserved.

## When To Use It

Use this page when you want to edit local Help content, add a new Help page, add images, or change the Help menu order.

## Quick Steps

1. Open the Help view.
2. Click **Folder** in the Help header (or **Open Help Folder** in the app menu).
3. Edit or add markdown files.
4. Update `index.json` with any new page.
5. Save the files.
6. Return to Help and click **Reload**, or wait for live reload.

## Step-By-Step: Add A Help Page

1. Create a markdown file in the help folder.
2. Start it with a clear `# Page Title`.
3. Add sections such as **When To Use It**, **Quick Steps**, **Troubleshooting**, and **Related Pages**.
4. Add an entry to `index.json`.
5. Use a stable unique `id`.
6. Set `file` to the markdown path relative to the help folder.
7. Save and confirm the page appears in Help.

## Open the Help Folder

Use **Folder** in the Help view header, or **Open Help Folder** in the app Help menu. **Edit This Page** opens the selected guide in your editor.

## Folder Structure

```text
help/
  index.json
  getting-started.md
  editing-help.md
  help-architecture.md
  assets/
```

## `index.json` Rules

Each entry needs:

- `id`: stable unique ID.
- `title`: page title shown in menu/sidebar.
- `file`: markdown file path relative to the help folder.
- `description` (optional): short page summary.

The order in `index.json` controls menu/sidebar ordering.

## Internal Links and Images

- Relative markdown links: `[Architecture](./help-architecture.md)`
- Relative images: `![Diagram](./assets/help-diagram.svg)`

The app rewrites those links safely based on the current file location.

## Troubleshooting

- If a page does not appear, check that `index.json` is valid JSON and includes the page.
- If a link fails, confirm the target path is relative to the current help file.
- If an image does not render, put it under the help folder or `assets` folder and use a relative path.
- If edits do not appear, close and reopen Help or restart the app.

## How Updates Preserve Your Edits

At startup, the app compares each stock file with its last installed version and recognised earlier stock versions. Text comparisons ignore Windows/Unix line endings, but other changes count as edits. Missing guides are copied, unchanged stock guides are updated, and edited or unrecognised files are left alone.

Custom Help pages, menu labels, ordering, and embedded-site settings remain. Newly introduced guides are appended to a customised index. An unchanged stock index can take the new default order. Local tracking is stored in **.stock-state.json**; leave that file to the app.

If you edited a guide and want the latest stock copy, first back up your edits outside the Help folder, remove that guide from the Help folder, and restart the app. The missing file will be restored from the bundled guides. You can then reapply your notes. **Reload** reloads files; it does not discard your edits or force a stock replacement.

If an older file cannot be confidently recognised as stock, it is preserved too. New feature guides remain available separately in Help.
