# Settings: Agents

Create and manage agent profiles, behavior, model overrides, automation controls, and subagent policy.

## Key Settings

- **Agent list**
  - Set active/default agent.
  - Edit or delete agents.
- **Identity**
  - Agent name
  - Role name
  - Avatar
  - Persona/system prompt
- **Model override**
  - Provider + model per agent (fallback to global if not overridden).
- **Active Automation Mode**
  - Enables autonomous loop behavior.
- **Heartbeat**
  - Scheduled check-ins (depends on Active Automation Mode).
- **Heartbeat schedule**
  - Interval, daily time, timezone, and optional time window.
- **Subagents**
  - Allow or block child-agent spawning for this agent.
  - Set max child count and max depth.
  - Restrict allowed target agents.
  - Control auto-relay of child completions.
  - Choose default subagent mode (`run` or `session`).
  - Optionally set a default subagent model override.
  - Control whether working directory, attached files, and privacy mode are inherited.
- **Settings Assistants**
  - Model override for settings helpers (for example Skill Assistant).

## Automation Rule

Heartbeat can only be enabled when **Active Automation Mode** is enabled.

## Subagent Rule

If **Allow subagents** is off, that agent cannot spawn child agents from Chat Mode or Build Mode.

## Related Sections

- [Model & API settings](./model-api-settings.md)
- [Automations](./automations.md)
- [Skills](./skills.md)
- [Runtime Hooks](./runtime-hooks.md)
- [Subagents](../subagents.md)
