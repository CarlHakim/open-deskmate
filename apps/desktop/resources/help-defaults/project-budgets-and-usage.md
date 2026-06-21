# Project Budgets And Usage

Project budgets let you track token usage and estimated costs for specific bodies of work.

## When To Use It

Use project budgets when you want to separate usage by client, job, internal project, Chat project, Build preset, or a group of sessions and tasks.

## Quick Steps

1. Open **Project Management**.
2. Create or select a usage project.
3. Turn on **Track** if you want costs recorded for that project.
4. Attach Chat projects, direct Chat tasks, Build presets, or Build sessions.
5. Add a budget window if you want a money or token limit.
6. Review totals in **Usage** or trends in **Analytics**.

## Step-By-Step: Create A Budget Window

1. Select a project in **Project Management**.
2. Open the **Budgets** tab.
3. Choose **New budget window**.
4. Add a name, start date, and optional end date.
5. Enter a money limit, token limit, or both.
6. Choose **Warn** if users should be alerted only.
7. Choose **Block** if new runs for that project should stop after the limit is exceeded.
8. Save the window.

## What Gets Tracked

A tracked project can report:

- Input hit tokens.
- Input miss tokens.
- Output tokens.
- Input hit cost.
- Input miss cost.
- Output cost.
- Total tokens.
- Total estimated cost.
- Attached Chat projects and direct Chat tasks.
- Attached Build presets and direct Build sessions.

Input hit tokens are reused/cached input tokens when the provider reports them. Input miss tokens are new billable input tokens. Output tokens are model response tokens.

Chat tasks inside a Chat Mode sidebar project inherit that Chat project's budget unless you select another project directly on the task. Build sessions inherit the budget from the selected Build preset unless you choose a different project for that run.

## Tracking Only

If **Track** is on and there are no budget windows, the project is tracking-only.

Tracking-only projects collect usage totals but do not warn or block new tasks.

## Budget Windows

A budget window is a dated budget period for a project.

Each window can have:

- Start date.
- Optional end date.
- Optional money limit.
- Optional total token limit.
- Mode: `Warn` or `Block`.

If a window has both money and token limits, crossing either limit can trigger the window status.

Use multiple windows when the same project has monthly limits, milestone limits, or a one-off client cap alongside a wider internal budget.

## Warn And Block

- **Warn**
  - Shows warnings in selectors, context inspectors, and Project Management.
  - Does not stop the user from running tasks.
- **Block**
  - Blocks new Chat or Build runs for that selected project when the active window is exceeded.
  - Does not block unrelated projects.

## Why Estimates May Differ From Provider Billing

Usage estimates depend on the provider reporting token details and on the pricing rows saved in Settings.

Differences can happen when:

- A provider reports cached tokens differently.
- A model price changed and the effective-from date is wrong.
- The provider dashboard groups usage by UTC day while the app view uses a selected local period.
- Some usage rows are unpriced.
- Provider-side fees or rounding are not represented in the app.

## Pricing Setup

Open **Settings > Usage estimate** and enter:

- Input hit price.
- Input miss price.
- Output price.
- Effective-from date when needed.

The Project Management Usage and Analytics tabs use these pricing rows.

## Troubleshooting

- If a project shows **Unpriced**, add pricing rows for the active provider/model and date range.
- If provider billing and the app estimate differ, compare date ranges, time zones, cached token reporting, and effective-from dates.
- If a blocked project should run again, increase the limit, disable the window, change the mode to Warn, or choose another project.
- If usage does not appear under a project, confirm the task, Chat project, Build preset, or Build session is attached to that budget.
- If a task is not inside a Chat project, check whether it is directly assigned to the budget from the task project dropdown.

## Related Pages

- [Project Management](./project-management.md)
- [Settings: API usage estimate](./settings/usage-estimate.md)
- [Assignees](./assignees.md)
- [Local Models And Ollama](./local-models-and-ollama.md)
