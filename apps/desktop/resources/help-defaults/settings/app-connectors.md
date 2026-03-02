# Settings: App Connector Extensions

Configure integrations like Notion, GitHub, Google apps, Slack, and others.

## Key Settings

- **Create connector instance**
  - Multiple instances supported per connector type.
- **Enable/disable**
  - Activates that integration runtime.
- **OAuth settings**
  - Client ID / Client Secret
  - Scopes
  - Redirect mode:
    - `auto`
    - `loopback`
    - `public`
    - `desktop` (`accomplish://callback`)
- **Connect / Disconnect**
  - Starts OAuth flow and stores tokens securely.
- **Runtime test**
  - Validates connector runtime and credentials.

## Redirect URI Guidance

Depending on your deployment, providers may need one or more callback URIs:

- `accomplish://callback`
- `http://127.0.0.1:18888/api/opendeskmate/callback`
- `https://your-host/api/opendeskmate/callback`

Use HTTPS for public callbacks whenever possible.

## Related Sections

- [Automations](./automations.md)
- [Model & API settings](./model-api-settings.md)
