# Task Journey

The Task journey above Chat and Build history helps you see which activities were recorded for the current prompt.

## Open A Stage

1. Find **Planning**, **Researching**, **Creating**, **Checking**, **Ready**, or **Working** above the history.
2. Click a stage to open its recorded evidence.
3. Use **Show in history** to jump to the source message or activity.
4. Close the popup with its close control, Escape, or a click outside.

The stages are activity categories, not a required sequence or percentage meter. Some tasks never need research or checks. Unvisited stages have no evidence. Activities that do not match a named stage appear under **Working**.

## Understand The Status

The journey distinguishes active work, queued work, permission requests, guidance choices, completion, stopping, and errors. **Ready** means the recorded turn finished; it does not certify factual correctness, passing tests, or merged code. Open **Checking** and read the actual evidence for verification.

Evidence comes from existing messages and activity, with bounded excerpts. Opening a stage does not run the agent or request more research. A new prompt starts a new journey view rather than treating all earlier work as evidence for the current request.

## Journey Or Prompt Navigator?

| Control | Use it to… |
| --- | --- |
| Task journey | Inspect activity categories and their evidence for the current prompt. |
| Prompt Navigator on the right edge | Jump between user prompts in a long conversation. |
| Background work | Inspect the coordinator and its helper runs. |

Click the journey's agent avatar for its character card. The sliders button opens [Interaction appearance](./interaction-appearance.md).

## Troubleshooting

- An empty stage is not an error; there may be no recorded activity in that category.
- If the main agent resumes to review helper results, its status can return to working. Wait for that review before submitting the next prompt.
- Use the history's jump-to-latest control to return to recent messages after inspecting earlier evidence.
- For missing final answers or failures, see [Activity Timeline And Recovery](./activity-timeline-and-recovery.md).

## Related Pages

- [Prompt Navigator](./prompt-navigator.md)
- [Live Agent Team](./live-agent-team.md)
- [Interactive Answers And Choices](./interactive-answers-and-choices.md)
