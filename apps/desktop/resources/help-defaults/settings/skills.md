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
- **Build Runtime Tools**
  - Enables Build Mode agents to inspect runtime status, screenshots, logs, page snapshots, UI interactions, quality checks, and Git summary when the Build task needs validation.

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

## Webfetch vs Dev-Browser

Agents can look up information in two broad ways:

- **Webfetch**
  - Best for reading a web page, documentation page, article, API response, or static source.
  - Lower overhead and usually more reliable for direct text retrieval.
- **Dev-browser**
  - Best when the task needs a rendered page, JavaScript execution, login/session state, screenshots, DOM inspection, image search pages, or UI interaction.
  - In Chat Mode, the dev-browser server must be available through the app; agents should not start it manually.

Skills should explain which path is preferred and what fallback to use.

## Troubleshooting

- If an agent cannot use a skill, confirm the skill is installed.
- If a skill test fails, review the skill files and configuration.
- If a new skill behaves unpredictably, keep it private and narrow its instructions.
- If uninstalling a skill breaks a workflow, reinstall it from this section.
- If a Build smoke test cannot use runtime tools, confirm the Build Runtime Tools skill is installed.

## Related Sections

- [Agents](./agents.md)
- [Automations](./automations.md)
- [Build Smoke Testing](../build-smoke-testing.md)
