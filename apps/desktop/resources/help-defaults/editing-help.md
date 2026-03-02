# Editing Help Content

Help docs are copied on first run into a writable user folder.

## Open the Help Folder

Use the **Open Help Folder** button in the Help view header, or open it from the app Help menu.

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
