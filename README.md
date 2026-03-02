<p align="center">
  <img src="./open_deskmate_thumbnail-no_background.png" alt="OpenDeskmate logo" width="220" />
</p>

# OpenDeskmate

An open-source local-first AI agent platform for Windows forked from the Openwork for Mac project. It offers OpenClaw-style capabilities including multi-agent workflows, connector routing, automation loops, and tool-driven execution, but with a full settings UI instead of CLI-only setup. Run locally with your own provider keys, configure everything from the desktop/web settings panels, and install directly on Windows (installer or portable executable) without a cloud dependency.

---

## Features

- **Runs locally** - Your files and secrets stay on your machine by default.
- **Bring your own AI** - OpenAI, Anthropic, Google, xAI, Ollama, plus custom OpenAI-compatible providers/models.
- **Multi-agent workspaces** - Per-agent role name, avatar, workspace defaults, and model/provider override with global fallback.
- **Active Automation Mode per agent** - Enable agentic loop behavior with configurable heartbeat schedules.
- **Session-key gateway + dynamic routing** - Route traffic from connectors into the right agent/account binding at runtime.
- **Messaging Connector Extensions** - Multi-instance connector support (for example multiple Telegram/Discord bots), access policies, ID allowlists, and runtime health/testing.
- **App Connector Extensions** - Connectors for Notion, Trello, Obsidian, GitHub, Slack, Dropbox, Canva, OneDrive, Supabase, Google apps, Figma, Miro, Outlook, and more.
- **OAuth + local/public callback modes** - Supports desktop callback, loopback callback, and public HTTPS callback workflows.
- **User Skills + agent-generated skills** - Create/import/edit/configure skills, private-by-default sharing, versioning, rollback, and test flows.
- **Desktop + WebChat parity** - Saved prompts, add files, incognito mode, work-in-folder, voice wake/talk mode, model badge, context estimate badge/details, and message copy helpers.
- **In-app Help system** - Markdown-driven help pages with sidebar navigation, search, syntax highlighting, asset/link support, and live reload from a user-editable folder.
- **Open source** - MIT licensed and fully transparent.

---

## Installation (Windows)

### Option 1: Download Pre-built Release

1. Go to [Releases](../../releases)
2. Download `OpenDeskmate-x.x.x-win-x64-installer.exe` (installer) or `OpenDeskmate-x.x.x-win-x64-portable.exe` (portable)
3. Run the installer or portable executable
4. Enter your API key (OpenAI, Anthropic, Google, or xAI) on first launch

### Option 2: Build from Source

#### Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **pnpm 9+** - Install with `npm install -g pnpm`
- **Visual Studio Build Tools 2022** with:
  - Desktop development with C++
  - MSVC v142 toolset
  - C++ Spectre-mitigated libs (v142)

#### Build Steps

```powershell
# Clone the repository
git clone https://github.com/CarlHakim/open-deskmate.git
cd open-deskmate

# Install dependencies
pnpm install

# Build the Windows installer + portable executables
pnpm -F @accomplish/desktop build:win
```

The built files will be in `apps/desktop/release/`:
- `OpenDeskmate-x.x.x-win-x64-installer.exe` - NSIS installer
- `OpenDeskmate-x.x.x-win-x64-portable.exe` - Portable executable

#### Alternative Build Commands

```powershell
# Build unpacked version (for testing/development)
pnpm -F @accomplish/desktop build:unpack
# Output: apps/desktop/release/win-unpacked/OpenDeskmate.exe

# Build portable only
pnpm -F @accomplish/desktop build:win:portable
```

---

## Development

```powershell
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Run with clean start (clears stored data)
pnpm dev:clean
```

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run app in development mode |
| `pnpm dev:clean` | Dev mode with clean start |
| `pnpm build` | Build all workspaces |
| `pnpm -F @accomplish/desktop build:win` | Build Windows installer + portable |
| `pnpm -F @accomplish/desktop build:unpack` | Build unpacked (for testing) |
| `pnpm lint` | TypeScript checks |
| `pnpm -F @accomplish/desktop test:e2e` | Run E2E tests |

---

## Integrations

### Messaging Connector Extensions

Current catalog includes:

- Discord
- Telegram
- BlueBubbles
- Google Chat
- iMessage
- LINE
- Matrix
- Mattermost
- Microsoft Teams
- Nextcloud Talk
- Nostr
- Signal
- Slack
- Tlon
- WhatsApp
- Zalo OA
- Zalo User

Notes:

- You can create multiple connector instances per connector type.
- Some connectors require bridge/public webhook setup; runtime labels and badges in Settings explain requirements.

### App Connector Extensions

Current catalog includes:

- Notion
- Trello
- Obsidian
- GitHub
- Slack
- Dropbox
- Canva
- OneDrive
- Supabase
- Google Slides
- Google Tasks
- Google Sheets
- Google Docs
- Google Drive
- Google Photos
- Google Maps
- YouTube
- Figma
- Miro
- Gmail
- Email Triggers
- Google Calendar
- Microsoft Outlook

Notes:

- OAuth credentials/tokens are stored securely.
- Connector instances can be routed per agent.

---

## Troubleshooting (Windows)

### node-pty rebuild fails (MSB8040 error)

Install **C++ Spectre-mitigated libs (v142)** in Visual Studio Installer, then:

```powershell
pnpm -F @accomplish/desktop exec electron-rebuild
```

### keytar fails to load

Run electron-rebuild after installing Build Tools:

```powershell
pnpm -F @accomplish/desktop exec electron-rebuild
```

### Postinstall hangs

Skip skills install and do it manually:

```powershell
$env:SKIP_SKILLS_INSTALL="1"
pnpm install
# Then manually:
npm --prefix apps/desktop/skills/dev-browser install
npm --prefix apps/desktop/skills/file-permission install
```

---

## Project Structure

```
apps/
  desktop/          # Electron app (main + preload + renderer)
    release/        # Built executables
    src/
      main/         # Electron main process
      preload/      # Context bridge
      renderer/     # React UI
packages/
  shared/           # Shared TypeScript types
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.
