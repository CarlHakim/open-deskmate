# Settings: Startup

Control how the app behaves when launched and when closed.

## When To Use It

Use this section when automations, connectors, or background workflows should keep running after you close the main window or sign in to the computer.

## Quick Steps

1. Open **Settings > Startup**.
2. Turn on **Run in background** if scheduled work or connectors should continue after closing the window.
3. Turn on **Launch at login** if the app should start automatically.
4. Close and reopen the app to confirm the behavior.

## Key Settings

- **Run in background**
  - If enabled, closing the window keeps the app active in tray/background.
- **Launch at login**
  - Starts app automatically when you sign in.

## Notes

- Background mode is useful for connectors, schedules, and automations that should continue running.
- Disable both for fully manual/start-stop operation.

## Troubleshooting

- If scheduled work stops when you close the window, enable background mode.
- If the app starts unexpectedly after login, disable launch at login.
- If tray/background behavior is confusing, disable both settings for manual operation.

## Related Sections

- [Automations](./automations.md)
- [Messaging Connector Extensions](./messaging-connectors.md)
