# Plugins

OpenDeskmate plugins extend the app through a controlled manifest boundary. Plugins can contribute:

- slash and global command entries
- runtime hooks
- controlled tool aliases
- help pages

Plugins do **not** run arbitrary code directly through the app runtime. Commands, hooks, tools, and help docs are validated, registered, and exposed through app-owned boundaries.

## Where Plugins Live

- **Bundled plugins**
  - Shipped with the app and discovered automatically.
- **Managed plugins**
  - Stored in your writable user-data plugins folder.
  - Open this folder from **Settings -> Plugins -> Open managed root**.

Each live plugin must have its own folder containing `plugin.json`.

```text
plugins/
  my-plugin/
    plugin.json
    docs/
      getting-started.md
```

## Manifest Basics

Required manifest fields:

- `id`
  - Lowercase letters, numbers, `-`, and `_`.
- `name`
- `version`
  - Semantic-version shaped, for example `1.0.0`.

Common optional fields:

- `description`
- `author`
- `homepage`
- `defaultEnabled`
- `metadata.categories`
- `metadata.minimumAppVersion`
- `metadata.permissions`
- `contributes.commands`
- `contributes.hooks`
- `contributes.tools`
- `contributes.helpDocs`

## Supported Command Actions

Plugin commands can only dispatch supported app-owned actions:

- `navigate`
- `open_settings`
- `open_settings_section`
- `open_help_doc`
- `dispatch_app_command`

Current `dispatch_app_command` ids include:

- `task_stop`
- `task_save_skill`
- `subagents_refresh`
- `build_history_open`
- `build_history_new`
- `build_runtime_start`
- `build_runtime_stop`
- `build_runtime_restart`
- `build_runtime_build`
- `build_runtime_open_preview`

## Supported Tool Actions

Plugin tools are controlled aliases over existing app capabilities. Current tool action types are:

- `connector_send_message`
- `app_connector_execute`
- `subagent_spawn`

These are validated and executed by the app. Plugins do not inject arbitrary executable tool code.

## Sample `plugin.json`

```json
{
  "id": "example-docs-helper",
  "name": "Example Docs Helper",
  "version": "1.0.0",
  "description": "Example plugin showing commands, hooks, tools, and help docs.",
  "author": "Your Name",
  "defaultEnabled": true,
  "metadata": {
    "categories": ["docs", "workflow"],
    "minimumAppVersion": "1.0.0",
    "permissions": ["commands", "hooks", "tools", "help_docs", "app_command_dispatch", "subagent_spawn"]
  },
  "contributes": {
    "commands": [
      {
        "id": "open-example-guide",
        "command": "example-guide",
        "title": "Open Example Plugin Guide",
        "description": "Open this plugin's own help doc.",
        "group": "Plugins",
        "intent": "inspect",
        "visibility": ["home", "chat", "build", "global"],
        "action": {
          "type": "open_help_doc",
          "docId": "getting-started"
        }
      },
      {
        "id": "stop-current-task",
        "command": "example-stop",
        "title": "Stop Current Task",
        "description": "Trigger the built-in stop action through the controlled command boundary.",
        "group": "Plugins",
        "intent": "danger",
        "visibility": ["chat", "build", "global"],
        "action": {
          "type": "dispatch_app_command",
          "commandId": "task_stop"
        }
      }
    ],
    "hooks": [
      {
        "id": "example-build-note",
        "event": "before_task_dispatch",
        "match": {
          "sources": ["build"]
        },
        "action": "record_note",
        "noteText": "Example plugin hook ran before Build dispatch."
      }
    ],
    "tools": [
      {
        "id": "spawn-helper",
        "name": "spawn_helper",
        "description": "Spawn a tracked helper subagent through the app boundary.",
        "action": "subagent_spawn",
        "inputSchema": {
          "type": "object",
          "properties": {
            "targetAgentId": { "type": "string" },
            "task": { "type": "string" },
            "label": { "type": "string" }
          },
          "required": ["targetAgentId", "task"]
        },
        "defaults": {
          "label": "Plugin helper"
        }
      }
    ],
    "helpDocs": [
      {
        "id": "getting-started",
        "title": "Getting Started",
        "file": "docs/getting-started.md",
        "description": "Example plugin help page."
      }
    ]
  }
}
```

## Sample Help Doc

Create the file referenced by your manifest, for example `docs/getting-started.md`:

```md
# Example Plugin Guide

This help page was contributed by a plugin.

## What It Does

- Adds `/example-guide`
- Adds `/example-stop`
- Registers one example runtime hook
- Exposes one controlled `subagent_spawn` tool alias
```

## Install And Test

1. Create a folder under the managed plugins root.
2. Add `plugin.json`.
3. Add any referenced help docs, such as `docs/getting-started.md`.
4. Open **Settings -> Plugins**.
5. Click **Refresh**.
6. Confirm the plugin is valid and ready.
7. Use the preview controls and registration diagnostics before enabling it broadly.

## Diagnostics

The **Plugins** settings section shows:

- readiness state
- blocked reasons
- warnings
- contribution issues
- command/tool/help previews
- registration activity history

If a contribution is invalid, the plugin can still load in a warning state, but the invalid entry will be reported and ignored.

## Related Pages

- [Settings: Plugins](./settings/plugins.md)
- [Settings: Runtime Hooks](./settings/runtime-hooks.md)
- [Slash Commands](./slash-commands.md)
- [Subagents](./subagents.md)
