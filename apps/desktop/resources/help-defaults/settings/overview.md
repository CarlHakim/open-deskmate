# Settings Overview

This reference covers every section in the **Settings** dialog.

## When To Use It

Use this page when you know you need to configure the app but are not sure which Settings section controls the feature.

## Quick Steps

1. Open **Settings**.
2. Use **Basic** mode for common setup sections.
3. Use **Advanced** mode when you need connectors, policies, runtime hooks, plugins, or diagnostics.
4. Search or jump to the section that matches the task.
5. Change the setting.
6. Run a small test task after changing model, permissions, connector, or automation behavior.

## Step-By-Step: Find The Right Settings Section

1. Decide what you are trying to change.
2. Use **Model & API settings** for providers, keys, and models.
3. Use **Model & API settings** for local Ollama capability levels and context limit overrides.
4. Use **Agents** for personas, image or character avatars, model overrides, automation behavior, and subagents.
5. Use **API usage estimate** for pricing rows and cost estimates.
6. Use **Automations** for schedules and webhook endpoints.
7. Use **Project Management** for project budgets, Workboard, assignees, notes, and usage reports.
8. Use **Doctor** and **Developer** when something is not working.

## Core App Guides

- [Getting Started](../getting-started.md)
- [Chat Mode](../chat-mode.md)
- [Build Mode](../build-mode.md)
- [Build Smoke Testing](../build-smoke-testing.md)
- [Project Management](../project-management.md)
- [Project Work Popup](../project-work-popup.md)
- [Project Budgets And Usage](../project-budgets-and-usage.md)
- [Prompt Navigator](../prompt-navigator.md)
- [Workboard](../workboard.md)
- [Changes And Git](../changes-and-git.md)
- [Local Models And Ollama](../local-models-and-ollama.md)
- [Saved Prompts And Recipes](../saved-prompts-and-recipes.md)
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

- **Basic / Advanced Settings** lets users keep the Settings page focused or reveal every advanced section.
- **Saved Prompts & Recipes** manages reusable prompts and categories for Chat Mode and Build Mode.
- **API usage estimate** now supports input hit, input miss, and output pricing rows.
- **Local models** support Ollama capability levels and per-model context limit overrides.
- **Project Management** is opened from the briefcase icon near Settings, not from inside Settings.
- **Project budgets** support tracking-only projects, budget windows, per-project usage reporting, and warn/block behavior.
- **Project Work popup** opens project lists, notes, drawings, and documents beside Chat Mode or Build Mode.
- **Workboard** adds Table, Kanban, Timeline, Calendar, rich notes, drawings, documents, and checklist tracking for project work.
- **Assignees** are managed from Project Management and represent people doing the work. The budget owner remains the responsible contact.
- **Agents** includes image upload/crop avatars, character gallery avatars, and subagent controls such as enablement, depth and child limits, inheritance rules, default subagent mode, and optional default subagent model override.
- **Permission Policy** now covers global file/runtime policy, per-agent overrides, executor built-ins, audit, previews, conflicts, and live effective rule sources.
- **Build Mode Safety** controls how aggressively the AI can apply code changes in Build Mode.
- **Changes & Git** in Build Mode covers file changes, Git status, commit, push, remotes, branches, mismatch recovery, and conflict help.
- **Runtime Screenshots** can capture selected or full preview areas, annotate them, export them, attach them to prompts, or save them to project work items.
- **Build smoke testing** lets Build Mode agents inspect runtime status, screenshots, page snapshots, safe UI interactions, logs, checks, and Git summary.
- **Plugins** now covers managed plugin install/uninstall, validation, readiness diagnostics, contribution previews, help-doc contributions, and registration activity history.
- **Runtime Hooks** exposes the JSON-backed hook registry and diagnostics for task/tool policy and prompt mutation.
- **Slash commands** are now available from the Home prompt, Chat follow-up prompt, Build prompt, and the global `Cmd+K` launcher.

## Notes

- Section expand/collapse state is remembered per user.
- Section search and jump controls are available at the top of Settings.
- Most configuration changes save immediately; some actions include explicit save buttons.
- Project Management has its own tabs and persistence separate from Settings.

## Troubleshooting

- If you cannot find a section, switch from Basic to Advanced mode.
- If a setting does not seem to apply, check whether there is an agent, preset, or project-level override.
- If a Settings button needs a second click, check whether focus was inside an input or dropdown.
- If a configuration issue is unclear, run **Doctor** before changing more settings.
