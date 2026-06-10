# Settings: Plugins

Use **Settings -> Plugins** to manage bundled and user-installed plugins.

## When To Use It

Use this section when you want to enable, disable, inspect, install, uninstall, or troubleshoot plugins.

## Quick Steps

1. Open **Settings > Plugins**.
2. Review plugin state badges.
3. Open previews or diagnostics for any plugin you do not recognize.
4. Enable or disable plugins as needed.
5. Use **Open managed root** to add user-installed plugins.
6. Refresh after adding or changing plugin files.

## Step-By-Step: Install A Managed Plugin

1. Open the managed root folder.
2. Copy or create the plugin folder inside it.
3. Confirm the folder contains `plugin.json`.
4. Return to **Settings > Plugins**.
5. Click refresh.
6. Review validation, previews, and diagnostics.
7. Enable the plugin.

## What You Can Do Here

- view discovered plugins from bundled and managed roots
- inspect manifest validity and runtime readiness
- enable or disable plugins
- install a managed plugin from a folder
- uninstall managed plugins
- inspect contributed commands, tools, and help docs
- review registration activity over time

## Plugin States

Plugins can appear as:

- `Active`
- `Disabled`
- `Warning`
- `Incompatible`
- `Invalid`

These states are based on manifest validation, compatibility checks, registration diagnostics, and contribution issues.

## Managed Root

The managed root is your writable plugin folder. Open it from the `Open managed root` action.

That folder now includes authoring guidance files:

- `README.md`
- `plugin.example.json`
- `help-doc.example.md`

These are sample authoring files only. They are not treated as live plugins.

## Preview And Diagnostics

Each plugin card can show:

- blocked reasons
- warnings
- contribution issues
- preview of contributed commands
- tool schema preview
- help doc preview

The **Registration activity** panel keeps recent lifecycle events such as:

- startup registration
- enable
- disable
- install
- uninstall

## Authoring Guide

For plugin manifest structure and sample files, see:

- [Plugins](../plugins.md)

## Troubleshooting

- If a plugin is invalid, open diagnostics and fix the manifest errors.
- If a plugin is incompatible, check its minimum app version.
- If a command or help page is missing, inspect contribution previews.
- If uninstall is unavailable, confirm the plugin is managed rather than bundled.
