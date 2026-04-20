# Settings: Build Mode Safety

Choose how aggressively Build Mode can apply AI-generated file changes.

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

## Related Pages

- [Build Mode](../build-mode.md)
- [Settings: Agents](./agents.md)
- [Settings: Workspace Defaults](./workspace-defaults.md)
