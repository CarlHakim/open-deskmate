<p align="center">
  <img src="docs/banner.svg" alt="Openwork - The open source AI coworker that lives on your desktop" width="100%" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/accomplish-ai/openwork/stargazers"><img src="https://img.shields.io/github/stars/accomplish-ai/openwork?style=flat-square&color=22c55e" alt="GitHub Stars" /></a>
  <a href="https://downloads.accomplish.ai/downloads/0.2.1/macos/Openwork-0.2.1-mac-arm64.dmg"><img src="https://img.shields.io/badge/Download-macOS-0ea5e9?style=flat-square" alt="Download" /></a>
</p>

<p align="center">
  <a href="https://downloads.accomplish.ai/downloads/0.2.1/macos/Openwork-0.2.1-mac-arm64.dmg"><strong>Download for Mac (Apple Silicon)</strong></a>
</p>

<br />

---

<br />

## What makes it different

<table>
<tr>
<td width="50%" valign="top" align="center">

### 🖥️  It runs locally

<div align="left">

- Your files stay on your machine
- You decide which folders it can touch
- Nothing gets sent to Openwork (or anyone else)

</div>

</td>
<td width="50%" valign="top" align="center">

### 🔑  You bring your own AI

<div align="left">

- Use your own API key (OpenAI, Anthropic, etc.)
- Or run with [Ollama](https://ollama.com) (no API key needed)
- No subscription, no upsell
- It's a tool—not a service

</div>

</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">

### 📖  It's open source

<div align="left">

- Every line of code is on GitHub
- MIT licensed
- Change it, fork it, break it, fix it

</div>

</td>
<td width="50%" valign="top" align="center">

### ⚡  It acts, not just chats

<div align="left">

- File management
- Document creation
- Custom automations
- Skill learning

</div>

</td>
</tr>
</table>

<br />

---

<br />

## What it actually does

| | | |
|:--|:--|:--|
| **📁 File Management** | **✍️ Document Writing** | **🔗 Tool Connections** |
| Sort, rename, and move files based on content or rules you give it | Prompt it to write, summarize, or rewrite documents | Works with Notion, Google Drive, Dropbox, and more (through local APIs) |
| | | |
| **⚙️ Custom Skills** | **🛡️ Full Control** | |
| Define repeatable workflows, save them as skills | You approve every action. You can see logs. You can stop it anytime. | |

<br />

---

<br />

## How to use it

> **Takes 2 minutes to set up.**

| Step | Action | Details |
|:----:|--------|---------|
| **1** | **Install the App** |  the DMG and drag it into Applications |
| **2** | **Connect Your AI** | Use your own OpenAI or Anthropic API key, or Ollama. No subscriptions. |
| **3** | **Give It Access** | Choose which folders it can see. You stay in control. |
| **4** | **Start Working** | Ask it to summarize a doc, clean a folder, or create a report. You approve everything. |

<br />

<div align="center">

[**Download for Mac (Apple Silicon)**](https://downloads.accomplish.ai/downloads/0.2.1/macos/Openwork-0.2.1-mac-arm64.dmg)

</div>

<br />

---

<br />

## See it in Action

<p align="center">
  <a href="https://youtu.be/UJ0FIufMOlc?si=iFcu3VTG4B4q9VCB">
    <img src="docs/video-thumbnail.png" alt="Watch Demo" width="600" />
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/UJ0FIufMOlc?si=iFcu3VTG4B4q9VCB">Watch the demo →</a>
</p>

<br />

---

<br />

## Development

```bash
pnpm install
pnpm dev
```

That's it.

<details>
<summary><strong>Prerequisites</strong></summary>

- Node.js 20+
- pnpm 9+
- Windows (dev/build): Visual Studio Build Tools with
  - Desktop development with C++
  - MSVC v142 toolset
  - C++ Spectre-mitigated libs (v142)
- Windows (optional): Python 3.x for node-gyp fallback

</details>

<details>
<summary><strong>All Commands</strong></summary>

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run desktop app in dev mode |
| `pnpm dev:clean` | Dev mode with clean start |
| `pnpm build` | Build all workspaces |
| `pnpm build:desktop` | Build desktop app (Windows: NSIS + portable in `apps/desktop/release/`) |
| `pnpm lint` | TypeScript checks |
| `pnpm typecheck` | Type validation |
| `pnpm -F @accomplish/desktop test:e2e` | Playwright E2E tests |

</details>

<details>
<summary><strong>Environment Variables</strong></summary>

| Variable | Description |
|----------|-------------|
| `CLEAN_START=1` | Clear all stored data on app start |
| `E2E_SKIP_AUTH=1` | Skip onboarding flow (for testing) |

</details>

<details>
<summary><strong>Architecture</strong></summary>

```
apps/
  desktop/        # Electron app (main + preload + renderer)
packages/
  shared/         # Shared TypeScript types
```

The desktop app uses Electron with a React UI bundled via Vite. The main process spawns [OpenCode](https://github.com/sst/opencode) CLI using `node-pty` to execute tasks. API keys are stored securely in the OS keychain.

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

</details>

<details>
<summary><strong>Windows Troubleshooting</strong></summary>

- `node-pty` rebuild fails with MSB8040: install **C++ Spectre-mitigated libs (v142)** and re-run `pnpm -C apps/desktop exec -- electron-rebuild`
- `keytar` fails to load: run `pnpm -C apps/desktop exec -- electron-rebuild` after installing Build Tools
- Postinstall hangs: set `SKIP_SKILLS_INSTALL=1` and install skills manually from `apps/desktop/skills/*`
- Smoke-test OpenCode on Windows:
  - PowerShell:
    - `$env:OPENCODE_MODEL="google/gemini-3-flash-preview"`
    - `$env:GOOGLE_GENERATIVE_AI_API_KEY="AIza..."`
    - `pnpm -C apps/desktop run opencode:smoke`

</details>

<br />

---

<br />

## Contributing

Contributions welcome! Feel free to open a PR.

```bash
# Fork → Clone → Branch → Commit → Push → PR
git checkout -b feature/amazing-feature
git commit -m 'Add amazing feature'
git push origin feature/amazing-feature
```

<br />

---

<br />

<div align="center">

**[Website](https://www.accomplish.ai/openwork/)** · **[GitHub](https://github.com/accomplish-ai/openwork)** · **[Issues](https://github.com/accomplish-ai/openwork/issues)**

<br />

MIT License · Built by [Accomplish](https://www.accomplish.ai)

</div>
