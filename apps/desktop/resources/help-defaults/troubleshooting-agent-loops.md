# Troubleshooting Agent Loops

An agent loop is when a task keeps repeating the same tool call, inspection, or preamble instead of moving toward an answer.

## When To Use It

Use this page when an agent appears stuck, keeps reading the same file, repeats the same runtime tool, or spends a long time making no visible progress.

## What The App Does

Open Deskmate has safeguards for repeated successful tool calls.

The app can stop a run when it detects:

- The same successful tool call repeated several times in a row.
- The same successful tool call repeated too many times in one run.
- Excessive total tool-call activity.

When this happens, the app should report that it stopped the task to prevent a loop.

## Why Loops Happen

Loops often happen when:

- The model mixes explanation and execution in one turn.
- A preamble sounds like a command to use a tool.
- The same successful tool result does not provide an error signal.
- The task prompt is too broad.
- The model is using more tools than its capability level can handle.

## Quick Steps

1. Stop the task if it is still running.
2. Read the latest answer or activity details.
3. Start a new prompt with a narrow instruction.
4. Tell the AI whether you want explanation only or execution.
5. If using a local model, lower its capability level or reduce context.

## Prompt Patterns

For explanation only:

```text
Explain what happened. Do not inspect files, run tools, or make changes.
```

For execution:

```text
Make the fix. If you already inspected a file and the result is unchanged, do not inspect the same file again unless you explain why.
```

For Build smoke testing:

```text
Run one smoke-test pass. Do not repeat an identical successful runtime tool call. Summarize what was tested and what remains uncertain.
```

## Build Runtime Tools

Build runtime tools also include duplicate-call guidance. If the same tool request repeats, the tool can return a message telling the AI to summarize current findings instead of calling the tool again.

## Troubleshooting

- If a cloud model loops, narrow the prompt and ask for one next action.
- If a local model loops, lower the capability level or switch to a larger model.
- If a task stops early because of loop protection, continue with a prompt that says what to do next from the current findings.
- If loop protection stops useful work too aggressively, include the task details and raw log in a bug report.

## Blocked Helpers And Replacement Loops

A blocked helper is different from a main agent repeatedly calling a tool. Open [Subagents](./subagents.md) or [Live agent team](./live-agent-team.md) and inspect its actual error, partial report, and replacement lineage.

The main agent can diagnose and replace a helper when automatic supervision is enabled. Replacements receive a bounded handoff, including original work and recent failures. If a replacement fails, inspect the recorded successor run before retrying; repeated calls for the same original reuse its existing replacement. Do not keep appending the full history to every retry.

If the blocker is missing input, permission, or unavailable access, supply the missing information or use a permitted fallback. A new agent alone cannot supply information that was never provided.

## Related Pages

- [Activity Timeline And Recovery](./activity-timeline-and-recovery.md)
- [Build Smoke Testing](./build-smoke-testing.md)
- [Local Models And Ollama](./local-models-and-ollama.md)
