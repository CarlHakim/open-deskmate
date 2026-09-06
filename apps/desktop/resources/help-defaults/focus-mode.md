# Focus Mode

Use **Focus** at the right of the top bar in a Chat conversation or Build to give the main work more room.

## Enter And Leave Focus

1. Open an existing Chat task or Build.
2. Click **Focus**.
3. Continue reading, writing, or inspecting the task.
4. Click **Exit Focus** to restore the normal view. Escape also exits when an open dialog or menu is not handling it.

If a popup is open, close it first. Switching to another task or mode resets Focus. Focus is temporary and is not saved across app restarts.

## Chat Layout

The scene and background fill the available width, while the conversation, composer, activity, and team use a centred reading column up to 960 pixels wide. Long prompts and answers wrap within it; short bubbles stay compact.

## Build Layout

Focus hides secondary panels such as the workspace tree, terminals, logs, Git, and fingerprint details. The existing preview or editor stays beside the conversation. If the preview was already hidden, the operator fills the scene with the same centred reading width.

The task journey, team, prompt, Stop control, preview controls, and permission requests remain available. **Exit Focus** restores access to hidden tools. Their underlying state remains mounted, so opening Focus does not discard terminals or editor state.

## Focus Versus Sections

**Focus** is a temporary viewing choice. **Sections → AI Build Operator Only**, section visibility, and locks are saved Build layout preferences. Focus does not rewrite those preferences.

Entering or leaving Focus does not run, stop, restart, or resubmit a task. Draft text and attachments are kept.

## Troubleshooting

- Need Git, terminal, or workspace controls? Use **Exit Focus**.
- Escape did not exit? Close the active popup or dialog first.
- Focus did not remain after navigation? It resets when you switch task or mode.

## Related Pages

- [Build Mode Layout And Sections](./build-layout-and-sections.md)
- [Prompt Controls](./prompt-controls.md)
- [Interaction Appearance](./interaction-appearance.md)
