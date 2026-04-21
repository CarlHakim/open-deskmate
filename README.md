<p align="center">
  <img src="./open_deskmate_thumbnail-no_background.png" alt="OpenDeskmate logo" width="220" />
</p>

# OpenDeskmate

An open-source local-first AI agent platform for Windows forked from the Openwork for Mac project. It offers OpenClaw-style capabilities including multi-agent workflows, connector routing, automation loops, tool-driven execution, and tracked subagent orchestration, but with a full desktop settings UI instead of CLI-only setup. Run locally with your own provider keys, configure models, permissions, connectors, plugins, and automation from the app, and install directly on Windows (installer or portable executable) without a cloud dependency.

---

## What OpenDeskmate Is For

OpenDeskmate is built for people who want local agent workflows without giving up operational control. It is aimed at casual users, developers, technical operators, and power users who need more than a single chat window:

- Run agent tasks against local files and real project workspaces on Windows.
- Switch between quick chat interactions and longer-running build workflows.
- Route connectors, tools, and automation into the right agent with explicit settings.
- Monitor subagents, runtime permissions, usage, and task state from the desktop UI.
- Extend the app with skills, plugins, help docs, and connector-backed workflows.

---

## Why It Differs From Openwork / OpenClaw

OpenDeskmate keeps the local-first, agentic power of Openwork and OpenClaw, but makes it much easier to operate day to day on Windows. The main difference is usability: instead of relying on CLI-heavy setup, scattered config, and hidden runtime state, OpenDeskmate brings the working surface and the configuration surface into a straightforward desktop UI.

- Configure models, agents, subagents, permissions, connectors, plugins, schedules, voice features, and pricing from the app.
- Use Chat Mode for fast prompts or Build Mode for workspace-driven implementation without changing tools.
- Inspect task history, diffs, terminals, runtime logs, and child-agent runs in one place.
- Keep advanced capabilities available without making normal setup and operation feel like developer-only infrastructure.

---

## Features

- **Runs locally** - Your files and secrets stay on your machine by default.
- **Bring your own AI** - OpenAI, Anthropic, Google, xAI, Ollama, plus custom OpenAI-compatible providers/models.
- **Chat Mode + Build Mode** - Use fast task/chat flows or switch into a full workspace-oriented build surface with file tree, editor tabs, task history, diff review, runtime logs, and embedded terminal sessions.
- **Multi-agent workspaces** - Per-agent role name, avatar, workspace defaults, and model/provider override with global fallback.
- **Tracked subagents** - Per-agent subagent controls, global subagent monitoring, run/session modes, inherited context rules, and close/archive controls.
- **Active Automation Mode per agent** - Enable agentic loop behavior with configurable heartbeat schedules.
- **Permission policy controls** - Configure runtime permission defaults, recent audit history, and per-agent permission overrides for more autonomous or more locked-down agents.
- **Session-key gateway + dynamic routing** - Route traffic from connectors into the right agent/account binding at runtime.
- **Messaging Connector Extensions** - Multi-instance connector support (for example multiple Telegram/Discord bots), access policies, ID allowlists, and runtime health/testing.
- **App Connector Extensions** - Connectors for Notion, Trello, Obsidian, GitHub, Slack, Dropbox, Canva, OneDrive, Supabase, Google apps, Figma, Miro, Outlook, and more.
- **OAuth + local/public callback modes** - Supports desktop callback, loopback callback, and public HTTPS callback workflows.
- **User Skills + agent-generated skills** - Create/import/edit/configure skills, private-by-default sharing, versioning, rollback, and test flows.
- **Plugins** - Discover bundled and managed plugins with manifests, commands, hooks, tools, help docs, diagnostics, and enable/disable lifecycle controls.
- **Slash commands + launcher flows** - Built-in command surfaces for navigation, agent actions, Build Mode actions, and plugin-contributed commands.
- **Desktop + WebChat parity** - Saved prompts, add files, incognito mode, work-in-folder, voice wake/talk mode, model badge, context estimate badge/details, and message copy helpers.
- **Usage + pricing visibility** - Track token usage globally and add provider pricing to estimate cost inside the app shell.
- **In-app Help system** - Markdown-driven help pages with sidebar navigation, search, syntax highlighting, asset/link support, and live reload from a user-editable folder.
- **Open source** - MIT licensed and fully transparent.

---

## Build Mode

<table>
  <tr>
    <td valign="top">
      <p><strong>Build Mode</strong> is the desktop workspace for longer-running implementation tasks. It combines agent chat history with project-aware tooling so you can inspect files, review proposed diffs, monitor runtime logs, work across terminal sessions, and keep tracked subagents visible while the main agent is executing.</p>
      <p>It is designed for tasks that need persistent workspace context rather than a single chat reply.</p>
    </td>
    <td valign="top" width="420">
      <img src="./build-mode.png" alt="OpenDeskmate Build Mode screenshot" width="420" />
    </td>
  </tr>
</table>

---

## Chat Mode

<table>
  <tr>
    <td valign="top">
      <p><strong>Chat Mode</strong> is the faster task surface for direct prompting, follow-up questions, slash commands, saved prompts, file attachments, incognito sessions, and work-in-folder flows.</p>
      <p>It is optimized for focused agent interaction when you do not need the full Build Mode workspace around the conversation.</p>
    </td>
    <td valign="top" width="420">
      <img src="./chat-mode.png" alt="OpenDeskmate Chat Mode screenshot" width="420" />
    </td>
  </tr>
</table>

---

## Settings

<table>
  <tr>
    <td valign="top">
      <p><strong>Settings</strong> exposes the operational control surface for the app: model and provider setup, runtime permission policy, connector routing, OAuth configuration, plugin lifecycle, voice wake, automation schedules, usage pricing, and per-agent overrides.</p>
      <p>The goal is to keep advanced runtime configuration inside the desktop UI instead of pushing setup into external config files or a CLI-only workflow.</p>
    </td>
    <td valign="top" width="420">
      <img src="./settings.png" alt="OpenDeskmate Settings screenshot" width="420" />
    </td>
  </tr>
</table>

---

## Subagents

<table>
  <tr>
    <td valign="top">
      <p><strong>Subagents</strong> gives you a global control surface for tracked child agent runs across Chat Mode and Build Mode. You can inspect active, session, archived, and closed runs, review status, and jump back into the parent workflow with context intact.</p>
      <p>This makes delegated agent work visible and manageable instead of leaving subagent execution as a hidden background detail.</p>
    </td>
    <td valign="top" width="420">
      <img src="./subagents.png" alt="OpenDeskmate Subagents screenshot" width="420" />
    </td>
  </tr>
</table>

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

## Contact

Questions, collaborations, or support:
- Email: [opendeskmate@renewai.nl](mailto:opendeskmate@renewai.nl)
- Website: https://renewai.nl
- GitHub: https://github.com/CarlHakim

---

## License

MIT License - see [LICENSE](LICENSE) for details.
