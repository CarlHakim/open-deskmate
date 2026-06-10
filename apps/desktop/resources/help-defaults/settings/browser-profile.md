# Settings: Browser Profile

Configure which browser profile name the app should use for browser automation.

## When To Use It

Use this section when browser automation should keep a stable set of cookies, sessions, or account state.

## Quick Steps

1. Open **Settings > Browser Profile**.
2. Enter a profile name.
3. Save the profile.
4. Restart if the page says a restart is needed.
5. Run a browser task and confirm it uses the intended session.

## Key Settings

- **Profile name**
  - Example: `default`, `work`, `research`.
- **Save profile**
  - Persists profile name. Restart may be required for full effect.

## Notes

- Separate profiles can isolate cookies/sessions.
- Reuse the same profile name for continuity across tasks.

## Troubleshooting

- If a website is logged out, confirm you are using the same profile name as before.
- If a profile change does not apply, restart the app.
- If two workflows should not share cookies, use different profile names.

## Related Sections

- [Model & API settings](./model-api-settings.md)
- [Workspace Defaults](./workspace-defaults.md)
