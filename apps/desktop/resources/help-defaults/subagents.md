# Subagents

Subagents are tracked child agents that can be spawned from Chat Mode or Build Mode when the active agent allows them.

## When To Use It

Use subagents when a main agent delegates work to helper agents, or when you need to inspect, stop, archive, or continue child sessions.

## Quick Steps

1. Enable subagents for the relevant agent in **Settings > Agents**.
2. Run a Chat or Build task that can spawn helpers.
3. Open the subagent section in the task view or the global Subagents page.
4. Inspect active, session-mode, archived, or closed subagents.
5. Open, stop, close, archive, or refresh subagents as needed.

## Step-By-Step: Inspect A Child Session

1. Open the task that created the subagent.
2. Expand the subagents section.
3. Select the child session.
4. Review the transcript, inherited context, execution policy, and status.
5. Send a follow-up if the session is reusable and still open.
6. Close or archive the session when it is no longer needed.

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

## Troubleshooting

- If no subagents appear, check the active agent's subagent settings.
- If refresh is unavailable, the current task may not have tracked subagents.
- If a child session keeps reappearing, close the session rather than only archiving it.
- If a child has unexpected context, review inheritance rules in **Settings > Agents**.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Settings: Agents](./settings/agents.md)
- [Slash Commands](./slash-commands.md)
