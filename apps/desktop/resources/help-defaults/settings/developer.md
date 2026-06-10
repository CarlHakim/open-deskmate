# Settings: Developer

Developer-focused toggles for troubleshooting.

## When To Use It

Use this section when normal troubleshooting is not enough and you need extra logs or diagnostic detail.

## Quick Steps

1. Open **Settings > Developer**.
2. Enable debug mode.
3. Reproduce the issue.
4. Open the relevant logs or diagnostics.
5. Disable debug mode when you are finished.

## Key Setting

- **Debug mode**
  - Enables more detailed logs and diagnostics in the UI.

## When To Use

- Troubleshooting connector runtime issues.
- Investigating task lifecycle behavior.
- Verifying model/provider request flows.

## Troubleshooting

- If debug logs are too noisy, reproduce only the smallest failing workflow.
- If the issue involves provider setup, also run **Doctor**.
- If the issue involves automation or connectors, include automation/connector settings when reporting it.

## Related Sections

- [Doctor](./doctor.md)
- [Automations](./automations.md)
