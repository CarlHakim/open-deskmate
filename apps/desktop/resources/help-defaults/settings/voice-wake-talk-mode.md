# Settings: Voice Wake + Talk Mode

Configure hotword detection and speech processing.

## When To Use It

Use this section when you want hands-free wake words, speech input, or local Whisper transcription.

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

## Quick Steps

1. Save Picovoice key.
2. Configure wake words.
3. Choose transcription provider.
4. If using Whisper, verify binary/model paths are valid.
5. Test wake and transcription flow.

## Step-By-Step: Use Local Whisper

1. Choose **Local Whisper** as the speech provider.
2. Set the `whisper-cli` binary path.
3. Set the Whisper model `.bin` path.
4. Choose the language code.
5. Save settings.
6. Test a short spoken phrase.

## Troubleshooting

- If wake words do not trigger, check the Picovoice key and microphone access.
- If local transcription fails, confirm both Whisper paths point to existing files.
- If transcription language is wrong, set a specific language code.
- If browser speech works but local Whisper does not, test the Whisper binary outside the app.

## Related Sections

- [Agents](./agents.md)
- [Automations](./automations.md)
