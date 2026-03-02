# Settings: Automations

Configure scheduling, webhook access, and remote entry points.

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

## Security Guidance

- Prefer auth-enabled modes for non-local access.
- Prefer HTTPS/public mode only when required.
- Keep localhost mode for single-machine use.

## Related Sections

- [Messaging Connector Extensions](./messaging-connectors.md)
- [App Connector Extensions](./app-connectors.md)
- [Startup](./startup.md)
