# Subagents in Chat and Build

Both modes now use the same subagent tree and action controls. Existing transcript, inspect, stop, archive, recovery, replacement, session, and follow-up features remain available.

## Lifecycle and supervision

Runs distinguish starting, queued, working, and finished. Queue duration and work duration are displayed separately. Runtime limits begin when execution starts, not when the request enters the queue. An independent five-second main-process supervisor updates progress, detects limits, and retains partial reports even when the UI is closed. The default limit action is notification; users can choose to stop a child and edit its runtime and recorded USD spending thresholds in the shared panel.

Recorded costs can be incomplete or arrive after work has happened. The spending threshold is an operational limit, not a guaranteed billing cap. Persistent sessions accumulate recorded cost across their turns.

## Automatic recovery supervision

The five-second supervisor now wakes an idle, completed parent when a child needs recovery, replacement, or partial-result review. The parent receives diagnostic run IDs and instructions to use `subagent_diagnose`, `subagent_recover`, and `subagent_replace`. It keeps the original Chat/Build workspace and privacy context. The model still decides and executes the appropriate recovery; detection alone does not directly spawn a replacement.

Sibling alerts are batched and share the result-delivery lock, so an active or queued parent is never interrupted. Interrupted parents, closed/archived/replaced children, and children stopped at an explicit limit are excluded. The existing automatic-relay setting also controls these wake-ups. Recovery instructions explicitly preserve permissions and spending/runtime limits.

Each child recovery episode is recorded before dispatch, preventing duplicate wake-ups across ticks and app restarts. A new child resume or recovery escalation can trigger another alert. There are at most six child alerts per parent task, including archived and replaced children; this bounds automatic wake-ups across replacement chains. Failed dispatches are recorded without an automatic retry for that episode. Manual supervision remains available after the budget is exhausted. This budget bounds runtime-generated wake-ups, not tool calls made within a parent turn.

## Result delivery behavior

Completion still appears in the parent transcript. Results also have persisted delivery states: ready, received by parent, and parent review completed. With automatic relays enabled, the runtime batches sibling reports into one parent review turn once the children finish and the parent is idle and completed. It never interrupts an active parent or automatically resumes an interrupted parent. The parent review retains Chat/Build workspace and privacy context.

The node tools acknowledge results returned through list/get/wait operations so an explicit parent read does not trigger another automatic review. Failed review attempts remain available for manual retry rather than retrying indefinitely. Reviews interrupted by an app restart are marked for manual retry. “Use results in parent” requests a review when the parent is idle. Review completion means the parent turn succeeded; it does not independently certify factual correctness, tests, or merged changes.

## Build coordination and isolation

Replacement prompts always retain the generated handoff; custom parent instructions are appended rather than replacing it. The handoff includes the original assignment, partial findings, known blocked tools/sources and fallbacks, plus up to six recent failures, six recent actions, four recovery attempts, twenty expected outputs, and eight reported gaps. Recorded error excerpts are bounded and visibly marked when truncated. Missing failure evidence is stated explicitly, and output completion must be verified. For isolated runs, the previous worktree path and branch are included so the replacement can inspect preserved work rather than assuming it exists in its new workspace. The existing Build diff handoff remains attached.

The complete replacement prompt fits the runtime's 8,000-character limit, including appended file assignments. Each nonempty handoff section receives space, with unused space redistributed; oversized sections are marked truncated and point to `subagent_get` for details. Recent evidence is ordered newest first. Replacement ancestry is traced to the root assignment with cycle protection, preventing recursive inclusion of previous handoff prompts. Oversized assignments that leave insufficient handoff space fail before stopping the old child or registering a replacement.

Concurrent replacement calls for the same run share one operation. Requests against an already-replaced original return its existing replacement; further recovery should target that child. Both replace and recover-with-replace responses retain the replacement run ID and spawn error even when dispatch fails after registration. Rejected operations return HTTP 422 with `ok: false`; accepted dispatches return HTTP 200. The node tool preserves the error response body and tells the parent to inspect any created run before retrying.

`subagent_spawn` accepts `ownedPaths`, a list of relative files or directories without wildcards. Active assignments in the same workspace are checked for overlap, including a second check after asynchronous startup preparation. The assignment is included in the child's prompt. These assignments coordinate edits; they are not a filesystem security boundary. Existing unassigned runs continue to work.

For independent coding work, `isolation: "worktree"` creates a separate Git branch and working directory. It requires a clean repository root so uncommitted parent work is not silently omitted. Existing managed worktrees do not prevent creating another. The branch and folder are preserved for review; the app does not automatically merge or delete them. The parent receives the worktree path, branch, and base commit when reviewing results.

Build completion refreshes the workspace diff and flags changed paths outside the assignment. Shared-workspace diffs explicitly warn that other workers' changes may be included. Inspect diffs and tests before integration.

## Updates and checks

Chat and Build use coalesced IPC change events, with a 30-second reconciliation and refresh on visibility restoration. Hidden panels skip refreshes, concurrent refreshes are coalesced, and stale responses for previously selected runs are discarded.

Validation covers queue timing, runtime limits, result batching and failure handling, file overlaps, actual local Git worktree isolation, shared UI controls, hidden-page refresh behavior, existing IPC and agent runtime tests, TypeScript, and production bundles. An isolated Electron smoke check exercises the shared controls in Chat and Build and verifies policy-save events. No live model requests or external messages are used in these checks.
