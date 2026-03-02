# Help Architecture

## Safety Model

- Markdown is rendered with HTML sanitization.
- Relative file paths are validated to prevent path traversal.
- Assets are resolved only from the help root and current page context.
- External URLs open via explicit shell handoff.

## Live Reload

The main process watches the help folder and:

- refreshes the Help menu entries
- broadcasts update events to open renderer windows

## Precompile vs Runtime Rendering

This implementation uses **runtime rendering**.

- Pros:
  - docs are instantly editable without rebuilding
  - ideal for user-managed markdown
- Cons:
  - rendering cost occurs at runtime
  - parsing happens per page load

Precompile mode is still possible for static content-heavy deployments by generating HTML ahead of time.

## Embedded Static Docs Site Option

If you set `embeddedSiteUrl` in `index.json` to an `http(s)` URL, the Help viewer shows a **Docs Site** toggle and can embed that site in an iframe.
