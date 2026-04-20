# Getting Started

OpenDeskmate has two main working modes: **Chat Mode** for task conversations and **Build Mode** for workspace-oriented coding workflows.

## Core Areas

- [Chat Mode](./chat-mode.md)
  - Start a new task, attach files, work in a folder, use memory hints, and continue an existing conversation.
- [Build Mode](./build-mode.md)
  - Pick a workspace, run the project runtime, inspect terminals and logs, review diffs, and work with the AI Build Operator.
- [Slash Commands](./slash-commands.md)
  - Type `/` inside supported prompts, or open the global `Cmd+K` launcher and type `/` there.
- [Subagents](./subagents.md)
  - Track helper child agents in Chat Mode, Build Mode, or the global Subagents page.
- [Plugins](./plugins.md)
  - Author, install, validate, and inspect controlled plugin contributions.
- [Settings Overview](./settings/overview.md)
  - Review every Settings section, including permission policy, plugins, agents, Build Mode safety, runtime hooks, and diagnostics.

## Common First Steps

1. Open **Settings** and configure your default model and API keys.
2. Start a task in **Chat Mode** if you want a conversation-first workflow.
3. Switch to **Build Mode** if you need runtime preview, terminals, runtime logs, or workspace-level editing.
4. Use **slash commands** for fast navigation and task control.
5. Use **Plugins** if you want manifest-driven commands, hooks, tools, or help docs.
6. Open **Help** whenever you need a page-specific reference.

## Help System

The Help viewer itself is editable.

- Help pages live in a writable local folder.
- You can edit `.md` files in your own editor.
- Page ordering and titles come from `index.json`.
- Search runs across the loaded help pages inside the app.

## Related Pages

- [Editing Help Content](./editing-help.md)
- [Help Architecture](./help-architecture.md)

![Help Diagram](./assets/help-diagram.svg)
