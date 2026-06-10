# Settings: Agents

Create and manage agent profiles, behavior, model overrides, automation controls, and subagent policy.

## When To Use It

Use this section when you want different agents for different roles, models, permissions, automation behavior, or subagent rules.

## Quick Steps

1. Open **Settings > Agents**.
2. Create or select an agent.
3. Set the name, role, avatar, and persona.
4. Choose whether the agent uses the global model or a model override.
5. Configure automation and subagent behavior if needed.
6. Save changes and select the agent in Chat Mode or Build Mode.

## Step-By-Step: Configure Subagents For An Agent

1. Select the agent.
2. Enable subagents.
3. Choose max child count and max depth.
4. Choose allowed target agents.
5. Pick run mode or session mode.
6. Decide whether child sessions inherit working directory, files, and privacy mode.
7. Save the agent.

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

## Troubleshooting

- If the wrong model answers, check the agent model override and the global model setting.
- If subagents never appear, confirm subagents are enabled for the active agent.
- If heartbeat controls are disabled, enable Active Automation Mode first.
- If an agent behaves unexpectedly, review its persona/system prompt and permission profile.

## Related Sections

- [Model & API settings](./model-api-settings.md)
- [Automations](./automations.md)
- [Skills](./skills.md)
- [Runtime Hooks](./runtime-hooks.md)
- [Subagents](../subagents.md)
