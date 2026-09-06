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

## Live Team And Result Delivery

In Chat and Build, expand **Background work** to see the coordinator and helpers. Click a helper assignment for its transcript or an avatar for its character card. See [Live Agent Team](./live-agent-team.md).

Runs distinguish starting, queued, working, and finished. Queue time and work time are separate. A completed child can have results ready for review, received by the parent, or reviewed by the parent. Parent review completion means that review turn succeeded; it does not certify the findings or prove code was merged.

With automatic relays enabled, completed helper reports can be batched into a review turn when the parent is idle and completed. Active parents are not interrupted, and deliberately stopped parents are not resumed automatically. **Use results in parent** requests a review when the parent is available. Failed reviews remain available for manual retry.

## How The Main Agent Handles A Stuck Helper

1. The runtime records the helper's failure, blocker, lack of progress, or reached limit.
2. If automatic relays are enabled and the parent is eligible, the runtime sends a recovery alert to the parent.
3. The parent diagnoses the run and chooses whether to continue it, use partial results, or start a replacement.
4. Inspect the original and successor records to see what happened and whether the replacement actually ran.

Detection does not itself guarantee a replacement: the parent model makes that decision. Permissions and runtime/spending limits still apply. Missing information or unavailable access may need a new instruction from you.

Recovery alerts are bounded to prevent automatic loops. Each episode is recorded before dispatch, sibling alerts are batched, and at most six child alerts are generated per parent task across replacement chains. This bounds runtime wake-ups, not all tool calls made by the parent. Manual supervision remains available when automatic alerts are exhausted. Children stopped at an explicit limit are excluded from automatic recovery alerts.

## What A Replacement Knows

A replacement receives a bounded handoff containing:

- The original assignment and expected output.
- Partial findings and progress already recorded.
- Known blockers, failed tools or sources, and recorded alternatives.
- Recent errors, actions, recovery attempts, and reported gaps.
- Additional instructions supplied by the parent.
- Build diff information and the previous worktree location when applicable.

Large sections are marked as truncated and the parent/child can inspect the original run for more detail. Previous handoff prompts are not recursively copied into each successor. The handoff is limited to recorded evidence; missing facts are not invented, and replacements must verify whether expected outputs exist.

Concurrent replacement requests for one original are deduplicated. A later request against an already-replaced run returns its existing successor; further recovery should target that successor. If a response contains a replacement run ID alongside a spawn error, inspect that run before requesting another replacement.

## Runtime And Spending Limits

Open the run details to edit **Child spending limit (USD)**, **Runtime limit (seconds)**, and **At limit**, then click **Save limits**. Choose **Notify** or **Stop child**. Notification is the default limit action.

Runtime counting begins when execution starts, not while queued. Persistent sessions accumulate recorded costs across turns. Provider usage may arrive late or have incomplete pricing, so this is an operational limit rather than a guaranteed billing cap. It is separate from [Project Management budgets](./project-budgets-and-usage.md).

## Build File Assignments And Isolated Work

The parent can assign relative files or directories to helpers to reduce overlapping edits. These assignments coordinate work; they are not a filesystem permission boundary. Inspect warnings about changes outside an assignment.

For independent coding work, a helper can use a separate Git worktree. Creation requires a clean repository root. Its branch and folder are preserved for review; the app does not automatically merge or delete them. Ask the parent to inspect the diff and tests before integrating changes. In a shared workspace, a diff may include other workers' edits.

## Important Notes

- Subagents are controlled per agent from **Settings > Agents**.
- A parent agent can be blocked from spawning subagents entirely.
- Child sessions can inherit working directory, attached files, and privacy mode depending on agent settings.

## Troubleshooting

- If no subagents appear, check the active agent's subagent settings.
- If refresh is unavailable, the current task may not have tracked subagents.
- If a child session keeps reappearing, close the session rather than only archiving it.
- If a child has unexpected context, review inheritance rules in **Settings > Agents**.
- If a replacement also fails, inspect its actual error and handoff rather than repeatedly retrying the original run.
- If no automatic review occurs, check automatic relays, the parent's state, the recorded delivery/recovery result, and whether a deliberate stop or limit prevents resuming.
- If Build shows Stop instead of Run after a helper finishes, the parent may be reviewing its result. Keep your follow-up draft and wait for that turn to finish.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Settings: Agents](./settings/agents.md)
- [Live Agent Team](./live-agent-team.md)
- [Activity Timeline And Recovery](./activity-timeline-and-recovery.md)
- [Slash Commands](./slash-commands.md)
