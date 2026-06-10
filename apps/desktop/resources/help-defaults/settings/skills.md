# Settings: Skills

Manage bundled and user skill capabilities used by agents.

## When To Use It

Use this section when a bundled skill is missing, a user skill needs editing, or a skill should be tested before agents use it.

## Quick Steps

1. Open **Settings > Skills**.
2. Install any missing required skills.
3. Open or create a user skill if needed.
4. Edit skill content and configuration.
5. Test the skill.
6. Keep experimental skills private until they are stable.

## Key Settings

- **Install all missing skills**
  - Installs required bundled skills in one action.
- **Per-skill install**
  - Installs one missing skill.
- **Per-skill uninstall**
  - Removes that skill's dependencies (typically `node_modules` for the skill runtime).

## User Skills Area

You can also configure user-created skills and imported skills.

- Create skill
- Edit skill content
- Configure skill JSON
- Set sharing/private scope
- Run tests or rollback versions

## Recommended Practice

1. Keep required skills installed.
2. Test skill changes in a safe workspace.
3. Use private scope first for newly generated/experimental skills.

## Troubleshooting

- If an agent cannot use a skill, confirm the skill is installed.
- If a skill test fails, review the skill files and configuration.
- If a new skill behaves unpredictably, keep it private and narrow its instructions.
- If uninstalling a skill breaks a workflow, reinstall it from this section.

## Related Sections

- [Agents](./agents.md)
- [Automations](./automations.md)
