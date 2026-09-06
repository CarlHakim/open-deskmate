# Build Mode Layout And Sections

Build Mode panels can be shown, hidden, resized, and locked.

## When To Use It

Use these controls when Build Mode feels crowded, you want to focus only on the AI Build Operator, or you want Runtime Preview, Terminal, Runtime Logs, and Changes & Git to share space differently.

## Quick Steps

1. Open **Build Mode**.
2. Open the **Sections** dropdown.
3. Check or uncheck sections to show or hide them.
4. Use locks if a hidden section should stay hidden after switching modes or restarting.
5. Drag panel edges to resize visible sections.

## Step-By-Step: Focus On AI Build Operator Only

1. Open the **Sections** dropdown.
2. Choose **AI Build Operator Only**.
3. Confirm every other section is hidden.
4. Lock the option if you want this layout to persist.
5. Uncheck **AI Build Operator Only** to restore the standard sections.

## Main Sections

- Project & Workspace.
- Runtime Preview / File Editor.
- Terminal.
- Runtime Logs.
- Changes & Git.
- AI Build Operator.

## Sections Dropdown

Use the **Sections** dropdown at the top of Build Mode to choose visible sections.

When sections are hidden, remaining panels expand into the available space.

## Locking Sections

Each hidden section can be locked.

When locked, it stays hidden when you:

- Switch to Chat Mode and back.
- Restart the app.
- Reopen Build Mode.

## AI Build Operator Only

Use **AI Build Operator Only** to hide all other sections and focus on the Build chat.

When this mode is active, the AI Build Operator expands. Its content stays centered and readable instead of stretching edge to edge.

The working directory and Changes & Git popup control are available under **More options** when the layout needs them.

## Resizing

You can resize:

- Project & Workspace width.
- AI Build Operator width.
- Terminal, Runtime Logs, and Changes & Git widths.

The Prompt Navigator stays attached to the AI Build Operator message area, so hiding or resizing other sections does not remove prompt navigation from long Build chats.

## Troubleshooting

- If a section keeps returning, open **Sections** and lock it hidden.
- If a section disappeared, reopen **Sections** and check it again.
- If panels overlap, reset the affected section size or reopen Build Mode.
- If Changes & Git is hidden but needed, use the review popup button when available or show the section again.

## Temporary Focus And Compact Controls

**Focus** at the top right temporarily hides secondary panels while retaining their state. **Exit Focus** restores them. This differs from saved Sections visibility and locks. Chat and Build use a centred readable content width in Focus; see [Focus Mode](./focus-mode.md).

Build's prompt now grows from two lines, has an expand button, and keeps Run/Stop beside the input. More options floats over the page; actions and their separate overflow dropdown stay on one toolbar. See [Prompt Controls](./prompt-controls.md).

On a fresh layout, terminal, log, and changes panels may start closed. Use **Show tools** or **Sections** to reveal them. Existing saved layouts are respected.

## Related Pages

- [Build Mode](./build-mode.md)
- [Changes And Git](./changes-and-git.md)
- [Runtime Screenshots](./runtime-screenshots.md)
- [Prompt Navigator](./prompt-navigator.md)
- [Project Work Popup](./project-work-popup.md)
