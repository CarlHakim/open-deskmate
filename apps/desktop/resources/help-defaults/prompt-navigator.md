# Prompt Navigator

The Prompt Navigator helps you move around long Chat Mode and Build Mode conversations.

## When To Use It

Use it when a task has several prompts and you want to jump back to the part of the conversation where a specific prompt was sent.

## What It Shows

- One thin tick mark for each user prompt.
- A highlighted tick for the prompt closest to the current scroll position.
- A preview popup with shortened prompt text.
- A scrollbar when there are too many prompts to show at once.

## Quick Steps

1. Open a Chat task or Build task with at least two prompts.
2. Move the pointer over the right-side prompt navigator rail.
3. Review the prompt previews in the popup.
4. Click a tick or preview row to jump to that prompt.
5. Use **Hide prompt navigator** if you do not want it visible.

## Chat Mode

In Chat Mode, the navigator appears on the right edge of the message area.

It uses the user prompts from the current task. The active prompt changes as you scroll through the chat history.

If the navigator is hidden, a small right-edge tab remains so you can show it again.

## Build Mode

In Build Mode, the navigator appears on the right edge of the AI Build Operator chat stream.

It shows the prompts you actually entered, not the internal Build Mode wrapper text that may be sent to the model with workspace instructions.

Build task history can also use the navigator when the loaded task contains multiple user prompts.

## Hide And Show

Each mode has its own saved preference:

- Hiding the Chat Mode navigator does not hide the Build Mode navigator.
- Hiding the Build Mode navigator does not hide the Chat Mode navigator.
- Hidden state persists after changing tasks and restarting the app.

## Troubleshooting

- If the navigator is not visible, the current conversation may have fewer than two prompts.
- If the preview popup closes too quickly, move through the rail and popup area without leaving the navigator surface.
- If clicking a prompt does not move the chat, wait for the conversation to finish loading and try again.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Activity Timeline And Recovery](./activity-timeline-and-recovery.md)
