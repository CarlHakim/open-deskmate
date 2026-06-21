# Activity Timeline And Recovery

Activity timelines explain what an agent did while running a Chat or Build task.

## When To Use It

Use the activity timeline when a task runs tools, requests permission, fails, appears to stop, or you need to understand what happened before an answer appeared.

The activity list is meant to stay out of the way during normal work. It should be expanded only when there is something useful to inspect or recover.

## Quick Steps

1. Open the task in Chat Mode or Build Mode.
2. Expand the activity timeline only when you need details.
3. Look for tool calls, permission events, errors, retries, and final answer events.
4. Use **Continue** or **Retry** only when the app reports a recoverable problem.
5. Open raw logs when the visible timeline does not explain the issue.

## Step-By-Step: Recover A Missing Answer

1. Confirm the model has actually stopped and is not still trying another tool or approach.
2. Read the recovery banner reason.
3. Open the activity details if you need to see the last tool result.
4. Click **Continue** to ask the model to answer from existing results.
5. Click **Retry** only if you want the task to try again.
6. Hide the activity panel if the task is complete and you no longer need the details.

## What The Timeline Shows

Activity events can include:

- Task started.
- Assistant message.
- Tool started.
- Tool finished.
- Permission requested.
- Permission resolved.
- Model result.
- Stall detected.
- Recovery started.
- Task finished.
- Errors.

## Compact And Expanded Views

The activity list is compact by default. Expand it when you need details.

You can hide the activity panel when everything is working. It can reappear when a recoverable problem is detected.

## Missing Final Answer

The app tries to detect cases where a tool result arrived but the model did not produce a useful final answer.

Recovery actions can include:

- Continue.
- Retry.
- View raw log.

Recovery should not run automatically. You choose when to continue.

The missing-answer recovery UI should not appear while the AI is still actively trying another approach. If the task produced a useful answer, you can leave the activity details hidden.

## Repeated Tool-Call Guard

The app can stop a task when it repeats the same successful tool call too many times.

This protects the app from cases where the model keeps inspecting the same file, runtime state, or page snapshot without making progress.

When this happens, start a narrower follow-up prompt and tell the AI whether you want explanation only or execution.

## Reasoning Bubbles

When a model sends visible thinking text, the app separates it from the final answer where possible.

This makes the answer easier to read and keeps reasoning output distinct from user-facing text.

## When To Use Raw Logs

Open raw logs when:

- A tool result is hidden or truncated.
- The final answer is missing.
- A provider returned malformed output.
- You need to report a bug.

## Troubleshooting

- If the missing-answer banner appears while the AI is still working, wait for the current tool/model attempt to finish.
- If activity takes too much space, keep it collapsed or hide it by default.
- If a reasoning tag such as `</think>` appears in the final text, report the model/provider output because it should be moved into the reasoning bubble when detected.
- If recovery buttons do not appear after a true failure, open raw logs and include them in a bug report.
- If the app stops a repeated tool loop, continue with a focused prompt instead of asking the model to repeat the same inspection.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Changes And Git](./changes-and-git.md)
- [Troubleshooting Agent Loops](./troubleshooting-agent-loops.md)
