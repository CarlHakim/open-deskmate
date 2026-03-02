# Help System

This app supports an in-app Help viewer backed by editable markdown files.

## What You Can Do

- Keep docs in a writable local folder.
- Edit `.md` files in any editor.
- Control page ordering and titles from `index.json`.
- Search across all help pages from inside the app.
- Render headings, lists, code blocks, tables, links, and images.

## Quick Links

- [Editing Help Content](./editing-help.md)
- [Help Architecture](./help-architecture.md)
- [Settings Overview](./settings/overview.md)

## Example Image

![Help Diagram](./assets/help-diagram.svg)

## Example Code

```ts
const docs = await window.accomplish?.listHelpDocs();
console.log(docs?.docs.map((doc) => doc.title));
```
