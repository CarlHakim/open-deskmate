# Settings: Doctor

Run built-in diagnostics checks.

## When To Use It

Use Doctor when the app behaves unexpectedly after changing model, provider, connector, automation, runtime, or workspace settings.

## Quick Steps

1. Open **Settings > Doctor**.
2. Run the diagnostics.
3. Review checks marked **Warning** or **Error**.
4. Follow the suggested fix for each failing check.
5. Re-run Doctor after changing settings.

## What It Checks

- Local runtime reachability
- Provider key/model readiness
- Service configuration health

## Output

Doctor results typically classify checks as:

- **OK**
- **Warning**
- **Error**

Use this section first when behavior is unclear after configuration changes.

## Troubleshooting

- If Doctor reports a provider error, check **Model & API settings**.
- If connector checks fail, check connector credentials, endpoints, and auth settings.
- If a warning remains after a fix, restart the app and run Doctor again.
- If you need more detail, enable debug mode in **Settings > Developer**.

## Related Sections

- [Developer](./developer.md)
- [Model & API settings](./model-api-settings.md)
- [Messaging Connector Extensions](./messaging-connectors.md)
