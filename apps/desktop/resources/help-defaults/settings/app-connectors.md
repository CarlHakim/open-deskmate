# Settings: App Connector Extensions

Configure integrations like Notion, GitHub, Google apps, Slack, and others.

## When To Use It

Use this section when you want the app to connect to external apps through OAuth or app-specific credentials.

## Quick Steps

1. Open **Settings > App Connector Extensions**.
2. Create a connector instance.
3. Enter OAuth settings, scopes, and redirect mode.
4. Connect the account.
5. Run the connector test.
6. Enable the connector when the test passes.

## Step-By-Step: Connect An OAuth App

1. Create the connector instance.
2. Copy the required redirect URI into the provider's developer console.
3. Enter the client ID and client secret.
4. Choose the scopes the connector needs.
5. Click **Connect**.
6. Complete the provider authorization flow.
7. Return to Settings and run the runtime test.

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

## Troubleshooting

- If OAuth fails, confirm the redirect URI exactly matches the provider configuration.
- If runtime test fails, disconnect and reconnect the account.
- If a connector works locally but not remotely, check whether the public callback URL is required.
- If scopes are missing, update scopes and reconnect so the provider grants them.

## Related Sections

- [Automations](./automations.md)
- [Model & API settings](./model-api-settings.md)
