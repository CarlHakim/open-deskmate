# Settings: Voice Wake + Talk Mode

Configure hotword detection and speech processing.

## Key Settings

- **Picovoice access key**
  - Required for wake-word engine.
- **Wake words**
  - Comma/space-separated list.
- **Speech provider**
  - `Local Whisper (whisper.cpp)`
  - `Web Speech`
- **Whisper binary path**
  - Path to `whisper-cli` executable.
- **Whisper model path**
  - Path to `.bin` model file.
- **Language**
  - Language code used by transcription.

## Recommended Setup

1. Save Picovoice key.
2. Configure wake words.
3. Choose transcription provider.
4. If using Whisper, verify binary/model paths are valid.
5. Test wake and transcription flow.

## Related Sections

- [Agents](./agents.md)
- [Automations](./automations.md)
