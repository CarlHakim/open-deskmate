# Local Models And Ollama

Open Deskmate can run local models through Ollama.

## When To Use It

Use local models when you want private local inference, offline-friendly drafting, or experimentation with models that are installed on your machine.

Local models vary a lot. Smaller models may be useful for simple chat, but may struggle with large context, tools, coding tasks, or long instructions.

## Quick Steps

1. Install and start Ollama.
2. Pull the model you want to use in Ollama.
3. Open **Settings > Model & API settings**.
4. Choose **Local**.
5. Confirm the Ollama URL, usually `http://localhost:11434`.
6. Click **Test connection**.
7. Select the local model.
8. Choose the model capability level.
9. Set a context limit override if the app does not know the model's true context size.
10. Save, then start a new task.

## Capability Levels

Local model capability controls how much of the desktop/tool stack is exposed to the model.

- **Chat only**
  - Best for simple conversation.
  - Uses the smallest tool/system overhead.
- **Basic tools**
  - Enables limited safe helpers such as internet or file context when available.
- **Workspace tools**
  - Allows more project-aware work for larger local models.
- **Full desktop/tool/MCP stack**
  - For larger models that can follow complex tool instructions and handle bigger prompts.

Keep lower levels for small models. Increase the level only when the model can reliably follow tool instructions.

## Context Limits

The context limit is the maximum prompt size the app should send to a model.

Use **Model context limits Override (tokens)** when:

- The local model has a larger context than the default.
- The app blocks a prompt as too large even though the model can handle it.
- You want to reduce context to keep a small model responsive.

If the prompt is too large, reduce attachments, lower the capability level, use a smaller task, or raise the override only when the model supports it.

## New Tasks After Model Changes

After changing the selected Ollama model, start a new task so the Chat Mode and Build Mode badges, context sizing, and provider configuration all use the new model.

Switching agents in Chat Mode also opens a fresh task so responses use the selected agent and model cleanly.

## Tools And Local Models

Ollama models can use tools only when the selected capability level exposes them and the model can follow the tool protocol.

For small models:

- Prefer Chat only.
- Avoid large attachments.
- Avoid long Build Mode tasks.
- Ask for concise answers.

For larger local models:

- Enable broader capabilities gradually.
- Test with a short task before relying on the model for build work.
- Watch for repeated tool calls or unfinished answers.

## Troubleshooting

- If there is no reply, check the Ollama URL, selected model name, and whether Ollama is running.
- If the model badge shows an older model, save the local model setting and start a new task.
- If typing into context-limit fields is slow, close heavy tasks and reopen Settings.
- If the prompt is rejected as too large, check capability level and context override.
- If a tool-heavy local task loops, lower the capability level and retry with a shorter prompt.

## Related Pages

- [Settings: Model & API settings](./settings/model-api-settings.md)
- [Settings: Agents](./settings/agents.md)
- [Build Smoke Testing](./build-smoke-testing.md)
