# OpenDeskmate

An open-source desktop AI assistant for Windows. Run AI locally with your own API keys - no subscriptions, no cloud dependency.

---

## Features

- **Runs locally** - Your files stay on your machine
- **Bring your own AI** - Use OpenAI, Anthropic, Google, xAI, or Ollama (free/local)
- **Open source** - MIT licensed, fully transparent
- **Takes action** - File management, document creation, custom automations

---

## Installation (Windows)

### Option 1: Download Pre-built Release
(Coming soon) Until it is available, build from source, and it will be crfeated in the folder apps/desktop/release/win-unpacked/ 
1. Go to [Releases](../../releases)
2. Download `OpenDeskmate-x.x.x-win-x64.exe` (installer) or `OpenDeskmate-x.x.x-win-x64-portable.exe` (portable)
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
git clone https://github.com/YourUsername/open-deskmate.git
cd open-deskmate

# Install dependencies
pnpm install

# Build the Windows executable
pnpm -F @accomplish/desktop build:win
```

The built files will be in `apps/desktop/release/`:
- `OpenDeskmate-x.x.x-win-x64.exe` - NSIS installer
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
| `pnpm -F @accomplish/desktop build:win` | Build Windows installer |
| `pnpm -F @accomplish/desktop build:unpack` | Build unpacked (for testing) |
| `pnpm lint` | TypeScript checks |
| `pnpm -F @accomplish/desktop test:e2e` | Run E2E tests |

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


MIT License · Built by [Accomplish](https://www.accomplish.ai)

</div>
