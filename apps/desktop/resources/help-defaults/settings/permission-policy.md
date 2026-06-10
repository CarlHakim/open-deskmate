# Settings: Permission Policy

Use **Settings -> Permission Policy** to control how file operations, runtime permission prompts, and executor built-ins are handled.

## When To Use It

Use this section when you need stricter file safety, fewer permission prompts, per-agent policy differences, or a clear audit of allow/block decisions.

## Quick Steps

1. Open **Settings > Permission Policy**.
2. Review the global file and runtime defaults.
3. Add allow/block rules only when needed.
4. Configure agent overrides for agents that need different behavior.
5. Use executor preview to confirm effective rules.
6. Check the audit list after running a task.

## Step-By-Step: Add An Agent Override

1. Select the agent in the policy UI.
2. Enable an agent permission profile.
3. Set file policy behavior.
4. Set runtime permission defaults.
5. Add tool allow/block rules if needed.
6. Review executor preview.
7. Save and run a small test task.

## Main Areas

- **File policy**
  - Auto-allow workspace writes
  - Honor per-task `allow all`
  - Fallback file decision
- **Runtime permissions**
  - Default tool decision
  - Default question decision
  - Raw allow/block lists
  - Executor built-in selectors
- **Audit**
  - Retained entry count
  - Recent policy decisions
  - Search and filter

## Agent Overrides

Each agent can optionally enable its own permission profile. That profile can override:

- file policy behavior
- runtime defaults
- allowed or blocked tool names
- executor built-in decisions

## Executor Preview

The executor preview shows:

- global projected rules
- agent override rules
- effective rules
- rule sources such as:
  - global default
  - global built-in override
  - agent override
  - fixed app rule

## Conflict Handling

The Settings UI now highlights:

- global allow/block list conflicts
- agent override conflicts against global rules
- live effective outcomes for each built-in row

Each conflict block includes direct cleanup actions so you can align or reset rules without editing raw lists manually.

## Troubleshooting

- If a tool is unexpectedly blocked, check effective rules in executor preview.
- If a prompt appears too often, review default tool and question decisions.
- If global and agent rules conflict, use the conflict cleanup actions.
- If you are unsure which rule applied, search the audit log.

## Related Pages

- [Settings: Agents](./agents.md)
- [Settings: Runtime Hooks](./runtime-hooks.md)
- [Build Mode](../build-mode.md)
