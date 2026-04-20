# Subagents

Subagents are tracked child agents that can be spawned from Chat Mode or Build Mode when the active agent allows them.

## Where You See Them

- **Chat Mode**
  - Subagents related to the current task appear in the task view.
- **Build Mode**
  - Subagents related to the current build task appear in the Build page.
- **Global Subagents page**
  - Central place to inspect active, session-mode, archived, and closed subagent runs across the app.

## Run Mode vs Session Mode

- **Run mode**
  - A one-shot child task.
- **Session mode**
  - A persistent child session that can be reused across follow-up prompts.

## Common Actions

- **Open**
  - View transcript, inherited context, execution policy, and send follow-up prompts.
- **Stop**
  - Interrupt the currently running child task.
- **Close session**
  - Close the tracked child session so it is no longer reused.
- **Archive**
  - Remove the child from normal active views without deleting its record.

## Important Notes

- Subagents are controlled per agent from **Settings > Agents**.
- A parent agent can be blocked from spawning subagents entirely.
- Child sessions can inherit working directory, attached files, and privacy mode depending on agent settings.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Settings: Agents](./settings/agents.md)
- [Slash Commands](./slash-commands.md)
