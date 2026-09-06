# Before And After

Build's **Before / after** control compares real screenshots of the Runtime Preview before and after your changes. It is beside **Screenshot** in the preview toolbar.

## Compare A UI Change

1. Start the project preview and navigate to the page you want to compare.
2. Open **Before / after** and click **Capture before**.
3. Close the comparison and make the requested changes.
4. Let the preview refresh, return to the matching page/state, and reopen **Before / after**.
5. Click **Capture after**.
6. Use the reveal slider or **Side by side** to inspect the two captures.

Use the same page, viewport, and scroll state where possible. Changes to those can affect the comparison even when the code is unchanged. Captures that are clipped or have different dimensions are labelled.

## What Is Saved?

Captures remain while the workspace view is mounted, including when the comparison dialog is closed. Changing workspace or leaving the view resets them. No before image is invented if capture fails.

Use the existing [Runtime Screenshots](./runtime-screenshots.md) workflow when you need to export, annotate, attach, or save a screenshot as project material. Do not rely on the comparison panel as a permanent image archive.

## Comparison Or Git Diff?

- **Before / after** compares the visible preview using actual captures.
- **Changes & Git** compares source-file changes.
- An [interactive answer](./interactive-answers-and-choices.md) can compare before/after writing supplied by the model.

These are different views of a change. A screenshot comparison is not proof that tests passed or that every affected page works.

## Troubleshooting

- Capture unavailable? Start or refresh Runtime Preview first.
- Blank or failed capture? Check that the intended page loaded before capturing again.
- Different image sizes? Use a consistent viewport and inspect the dimensions warning.
- Lost baseline after changing workspace? Captures belong to the mounted workspace view; capture a fresh baseline.

## Related Pages

- [Runtime Screenshots](./runtime-screenshots.md)
- [Build Smoke Testing](./build-smoke-testing.md)
- [Changes And Git](./changes-and-git.md)
