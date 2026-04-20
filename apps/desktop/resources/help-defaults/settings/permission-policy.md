# Settings: Permission Policy

Use **Settings -> Permission Policy** to control how file operations, runtime permission prompts, and executor built-ins are handled.

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

## Related Pages

- [Settings: Agents](./agents.md)
- [Settings: Runtime Hooks](./runtime-hooks.md)
- [Build Mode](../build-mode.md)
