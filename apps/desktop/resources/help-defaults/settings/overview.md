# Settings Overview

This reference covers every section in the **Settings** dialog.

## Core App Guides

- [Getting Started](../getting-started.md)
- [Chat Mode](../chat-mode.md)
- [Build Mode](../build-mode.md)
- [Slash Commands](../slash-commands.md)
- [Subagents](../subagents.md)
- [Plugins](../plugins.md)

## Settings Sections

1. [Model & API settings](./model-api-settings.md)
2. [API usage estimate](./usage-estimate.md)
3. [Skills](./skills.md)
4. [Automations](./automations.md)
5. [Messaging Connector Extensions](./messaging-connectors.md)
6. [App Connector Extensions](./app-connectors.md)
7. [Voice Wake + Talk Mode](./voice-wake-talk-mode.md)
8. [Mobile Node Companions (pilot)](./mobile-node-companions.md)
9. [Agents](./agents.md)
10. [Startup](./startup.md)
11. [Build Mode Safety](./build-mode-safety.md)
12. [Workspace Defaults](./workspace-defaults.md)
13. [Memory (User Context)](./memory-user-context.md)
14. [Browser Profile](./browser-profile.md)
15. [Permission Policy](./permission-policy.md)
16. [Runtime Hooks](./runtime-hooks.md)
17. [Plugins](./plugins.md)
18. [Developer](./developer.md)
19. [Doctor](./doctor.md)
20. [About](./about.md)

## Notable Current Capabilities

- **Agents** now includes subagent controls such as enablement, depth and child limits, inheritance rules, default subagent mode, and optional default subagent model override.
- **Permission Policy** now covers global file/runtime policy, per-agent overrides, executor built-ins, audit, previews, conflicts, and live effective rule sources.
- **Build Mode Safety** controls how aggressively the AI can apply code changes in Build Mode.
- **Plugins** now covers managed plugin install/uninstall, validation, readiness diagnostics, contribution previews, help-doc contributions, and registration activity history.
- **Runtime Hooks** exposes the JSON-backed hook registry and diagnostics for task/tool policy and prompt mutation.
- **Slash commands** are now available from the Home prompt, Chat follow-up prompt, Build prompt, and the global `Cmd+K` launcher.

## Notes

- Section expand/collapse state is remembered per user.
- Section search and jump controls are available at the top of Settings.
- Most configuration changes save immediately; some actions include explicit save buttons.
