# Settings: Plugins

Use **Settings -> Plugins** to manage bundled and user-installed plugins.

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
