# Settings: Build Mode Safety

Choose how aggressively Build Mode can apply AI-generated file changes.

## When To Use It

Use this section when you want to control whether Build Mode changes require review, stay as previews, or apply automatically.

## Quick Steps

1. Open **Settings > Build Mode Safety**.
2. Choose the mode that matches your risk tolerance.
3. Save the setting.
4. Run a small Build task.
5. Confirm the diff/apply behavior matches what you expected.

## Step-By-Step: Use The Safest Review Flow

1. Choose **Approval Mode**.
2. Run a Build task.
3. Review the proposed changes.
4. Approve only the changes you want.
5. Use Changes & Git to review repository status before committing.

## Modes

- **Approval Mode (Safe Mode)**
  - Requires review before applying changes.
  - Best default when you want the strongest guardrail.
- **Preview Only (No Approval Needed)**
  - Produces the diff preview without requiring explicit approval, but does not auto-apply changes.
- **Full Auto-Apply (No Approval Needed)**
  - Applies Build Mode changes automatically.
  - Highest automation, highest risk.

## Guidance

- Use **Approval Mode** if you want deliberate review before file changes land.
- Use **Preview Only** if you want fast iteration but still want the diff to stay separate from automatic apply.
- Use **Full Auto-Apply** only when you trust the current workflow and understand the consequences.

## Troubleshooting

- If files changed without a prompt, check whether **Full Auto-Apply** is enabled.
- If nothing is applied after a Build task, check whether **Preview Only** or approval mode is active.
- If you are unsure, switch back to **Approval Mode** before running more Build tasks.

## Related Pages

- [Build Mode](../build-mode.md)
- [Settings: Agents](./agents.md)
- [Settings: Workspace Defaults](./workspace-defaults.md)
