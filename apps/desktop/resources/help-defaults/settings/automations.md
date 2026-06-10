# Settings: Automations

Configure scheduling, webhook access, and remote entry points.

## When To Use It

Use this section when you want the app to run scheduled work, receive webhook requests, or expose automation endpoints to another device or service.

## Quick Steps

1. Open **Settings > Automations**.
2. Choose the bind mode and Tailscale/public access mode.
3. Choose an auth mode before exposing non-local endpoints.
4. Create or edit a schedule.
5. Preview natural-language schedules before saving.
6. Enable the schedule or run it manually.

## Key Settings

- **Webhook URLs**
  - Localhost URL
  - LAN URLs
  - Public URL (if available, e.g., via Tailscale)
- **Bind mode**
  - `localhost` for local-only access.
  - `all` to listen on all interfaces.
- **Tailscale mode**
  - `Off`
  - `Serve` (tailnet-only)
  - `Funnel` (public internet)
- **Auth mode**
  - `None`
  - `Token`
  - `Password`
- **Schedules**
  - Create, enable/disable, run-now, delete scheduled tasks.
- **Natural-language schedule drafting**
  - Describe a schedule in plain language.
  - Review the generated schedule preview.
  - Confirm and save only after the preview looks right.
- **Existing schedule management**
  - Edit, enable, disable, run now, or delete saved schedules.

## Schedule Drafting

The draft flow converts plain text into a previewed schedule.

Examples:

- `Every weekday at 9am`
- `Every Friday at 4pm`
- `Every 2 hours`

Review the preview before saving. If the schedule is unclear, the app shows warnings so you can adjust the text before confirming.

## Step-By-Step: Create A Scheduled Task

1. Open **Schedules**.
2. Describe the schedule in plain language or use the schedule controls.
3. Review the preview.
4. Fix any warnings.
5. Confirm and save.
6. Use run-now once to confirm the task behaves as expected.

## Security Guidance

- Prefer auth-enabled modes for non-local access.
- Prefer HTTPS/public mode only when required.
- Keep localhost mode for single-machine use.
- Do not expose unauthenticated public automation endpoints unless you understand the risk.

## Troubleshooting

- If a schedule does not save, check the preview warnings.
- If a remote service cannot reach the app, check bind mode, public URL, firewall, and Tailscale mode.
- If webhook requests are rejected, confirm auth mode and token/password settings.
- If scheduled work should continue when the window is closed, check **Settings > Startup** background mode.

## Related Sections

- [Messaging Connector Extensions](./messaging-connectors.md)
- [App Connector Extensions](./app-connectors.md)
- [Startup](./startup.md)
