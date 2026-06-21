# Settings: Model & API settings

Use this section to choose where inference runs and how provider credentials/models are configured.

## When To Use It

Use this section when tasks are using the wrong model, a provider key needs adding, a local model should be selected, or a custom provider/model needs to be configured.

## Key Settings

- **Cloud / Local tabs**
  - **Cloud** uses hosted providers (Anthropic, OpenAI, Google, xAI, custom).
  - **Local** uses Ollama.
- **Model selector**
  - Picks the active model used for new tasks.
- **Agent Speed Mode**
  - `Fast`: lower latency.
  - `Balanced`: middle ground.
  - `Deep`: higher quality, slower.
- **Ollama URL** (Local tab)
  - Usually `http://localhost:11434`.
- **Test Connection**
  - Checks Ollama reachability and loads available local models.
- **Save local model**
  - Persists the selected local model as default.
- **Local model capability level**
  - Controls whether Ollama models run as chat-only or receive broader tool access.
- **Model context limits Override (tokens)**
  - Overrides the app's context limit for a specific model when you know the model supports a different limit.
- **Provider**
  - Select which provider key you are managing.
- **API key input**
  - Stores key in secure storage.
- **Saved key status**
  - Shows whether a key exists for each provider.
- **Custom Providers**
  - `Provider ID` (machine ID, lowercase).
  - `Display Name`.
  - `Base URL`.
  - `Requires API key` toggle.
  - `Models` field (line format):
    - `id|name|context|max_output|vision(true/false)`
- **Provider model additions**
  - For built-in providers such as Google, add supported model IDs through the provider's model list instead of creating a duplicate custom provider.

## Quick Steps

1. Choose **Cloud** or **Local**.
2. Select model.
3. If Local, verify Ollama URL and click **Test connection**.
4. If Cloud, add/update provider API key(s).
5. Optionally add custom provider definitions and models.
6. Run a quick test task.

## Step-By-Step: Add A Custom Provider Model

1. Open **Settings > Model & API settings**.
2. Add a provider ID and display name.
3. Enter the provider base URL.
4. Choose whether the provider requires an API key.
5. Add one model per line using `id|name|context|max_output|vision`.
6. Save the provider.
7. Select the model from the model picker or an agent override.

## Model Line Example

```text
minimax-chat|MiniMax Chat|128000|8192|true
```

## Validation Rules

- Exactly 5 fields per model line.
- `context` and `max_output` must be numbers.
- `vision` must be `true` or `false`.
- At least one model line is required for custom providers.

## Local Ollama Models

Use local capability levels to keep small models from receiving a prompt that is too large or too tool-heavy.

Start with **Chat only**. Move up to broader capability levels only when the model can handle tool instructions and the context overhead.

Set a context override when the model supports more tokens than the app's default, or lower the value when a smaller model needs shorter prompts.

## Troubleshooting

- If a task fails immediately, check the API key and selected provider/model.
- If a custom model does not appear, confirm the model line has exactly 5 fields.
- If a reasoning model behaves like a normal model, confirm the provider and model support reasoning output.
- If local models do not load, check that Ollama is running and the URL is correct.
- If a local prompt is rejected as too large, lower the capability level, reduce attachments, or set an accurate context override.
- If the model badge still shows the old local model, save the local model setting and start a new task.

## Related Sections

- [Agents](./agents.md)
- [API usage estimate](./usage-estimate.md)
- [Local Models And Ollama](../local-models-and-ollama.md)
