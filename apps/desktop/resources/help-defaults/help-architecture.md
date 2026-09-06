# Help Architecture

This page explains how the in-app Help system loads, renders, updates, and protects editable Help content.

## When To Use It

Use this page when you are changing the Help system itself, debugging Help rendering, or deciding whether docs should stay runtime-rendered or move to a precompiled site.

## Quick Steps

1. Add or update markdown files in the help defaults or user Help folder.
2. Register pages in `index.json`.
3. Keep links and assets relative.
4. Open Help and confirm the page renders.
5. Check live reload if you are editing user Help content.
6. Use the embedded static docs option only when a separate hosted docs site is needed.

## Step-By-Step: Verify Help Rendering

1. Open the Help page.
2. Select the updated document.
3. Check headings, lists, tables, links, and images.
4. Click internal links to confirm routing.
5. Click external links to confirm they open outside the Help renderer.
6. Edit the markdown file and confirm live reload updates the page.

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

## Troubleshooting

- If a page renders blank, validate the markdown file path from `index.json`.
- If the Help menu is stale, check live reload or restart the app.
- If an asset is blocked, confirm it is under the help root and not using path traversal.
- If an embedded docs site does not load, confirm `embeddedSiteUrl` is an `http` or `https` URL and the site allows iframe embedding.

## Stock Guide Synchronisation

Startup synchronisation records installed stock content hashes in the user Help folder's **.stock-state.json**. A bundled **.stock-history.json** recognises earlier shipped content when a user upgrades from a version that did not record hashes. Historical entries are derived from stock files in Git, not from arbitrary user content. Markdown, JSON, and SVG hashes normalise CRLF to LF.

The synchroniser copies missing files and replaces only recognised unchanged stock. Unknown or edited files stay untouched. A customised index retains its existing entries and order while new default entries are appended; stock indexes can refresh normally. Linked destination files/directories are not overwritten. Repeated startup with unchanged content avoids file rewrites.

When changing bundled guides, retain historical stock hashes for migrations. The normal stock-state record handles future upgrades. Test both fresh installs and upgrades with edited pages and custom indexes, then verify internal links, asset loading, and Help search.
