# Settings: Model & API settings

Use this section to choose where inference runs and how provider credentials/models are configured.

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

## Common Setup Flow

1. Choose **Cloud** or **Local**.
2. Select model.
3. If Local, verify Ollama URL and click **Test connection**.
4. If Cloud, add/update provider API key(s).
5. Optionally add custom provider definitions and models.
6. Run a quick test task.

## Model Line Example

```text
minimax-chat|MiniMax Chat|128000|8192|true
```

## Validation Rules

- Exactly 5 fields per model line.
- `context` and `max_output` must be numbers.
- `vision` must be `true` or `false`.
- At least one model line is required for custom providers.

## Related Sections

- [Agents](./agents.md)
- [API usage estimate](./usage-estimate.md)
