# Windows Port Changes

This document describes the modifications made to convert Open-Deskmate from a Mac-only application to a Windows application. The Windows build can be found in `apps/desktop/release/win-unpacked`.

---

## Table of Contents

1. [Build System & Packaging](#1-build-system--packaging)
2. [Node.js Bundling](#2-nodejs-bundling)
3. [OpenCode CLI Integration](#3-opencode-cli-integration)
4. [Secure Storage](#4-secure-storage)
5. [New Files Added](#5-new-files-added)
6. [Test Infrastructure](#6-test-infrastructure)
7. [Provider Simplification](#7-provider-simplification)
8. [Key Technical Decisions](#key-technical-decisions)

---

## 1. Build System & Packaging

### package.json

**Location:** `apps/desktop/package.json`

- Added Windows build scripts:
  - `build:win` - Full Windows build with NSIS installer
  - `build:win:portable` - Portable Windows build
  - `build:unpack` - Unpacked build for development/testing
- Added Windows target configuration (`nsis`, `portable`) in electron-builder config
- Added Windows icon support (`resources/icon.ico`)
- Replaced Unix commands (`rm -rf`) with cross-platform `rimraf`
- Added `keytar` dependency for OS keychain integration on Windows
- Added `png-to-ico` dev dependency for generating Windows icons
- Added `opencode-windows-*` to `asarUnpack` for Windows OpenCode CLI binaries

### package.cjs

**Location:** `apps/desktop/scripts/package.cjs`

- Added `ensureWindowsIcon()` function to auto-generate `.ico` from `.png`
- Modified symlink handling for Windows (copies workspace package instead of symlinks due to Windows symlink permission restrictions)

### postinstall.cjs (New)

**Location:** `apps/desktop/scripts/postinstall.cjs`

- Cross-platform postinstall script replacing Unix-only shell commands
- Handles electron-rebuild with Windows-specific error handling (Spectre-mitigated libraries)
- Skills installation with Windows timeout handling
- Graceful degradation on Windows build failures

---

## 2. Node.js Bundling

### download-nodejs.cjs

**Location:** `apps/desktop/scripts/download-nodejs.cjs`

- Added `win32-x64` platform support
- Added dynamic SHA256 checksum fetching for Windows (fetches from Node.js SHASUMS256.txt)
- Platform-specific downloads (only downloads for current platform unless `ALL_PLATFORMS=1`)

### bundled-node.ts

**Location:** `apps/desktop/src/main/utils/bundled-node.ts`

- Added Windows path resolution for bundled Node.js
- Handles versioned directory structure (`node-v20.18.1-win-x64`)
- Falls back to scanning for version directories if exact path not found
- Platform-aware binary extensions (`.exe` on Windows)

---

## 3. OpenCode CLI Integration

### cli-path.ts

**Location:** `apps/desktop/src/main/opencode/cli-path.ts`

- Added `findBundledWindowsOpenCodeExe()` function to locate Windows OpenCode executable
- Windows uses `opencode.exe` from `opencode-windows-*` packages
- Falls back to running OpenCode via bundled Node.js if no native exe found
- Handles both `app.asar.unpacked` and `app.asar` paths for version detection

### adapter.ts

**Location:** `apps/desktop/src/main/opencode/adapter.ts`

- Dynamic `node-pty` import (lazy loading for better error handling)
- Added `NodePtyUnavailableError` class for PTY failures
- Added Windows-specific PATH extensions (`C:\Windows\System32`, `C:\Windows\System32\WindowsPowerShell\v1.0`)
- PowerShell command escaping with `& ` prefix for proper execution
- Enhanced ANSI escape code stripping for Windows terminal output:
  - Strips OSC sequences (`\x1B]...\x07`)
  - Removes carriage returns (`\r`)
  - Filters control characters that break JSON parsing
- Added `hasPtyOutput` tracking for better exit diagnostics
- Removed AWS Bedrock and additional provider support (simplified for Windows port)

### stream-parser.ts

**Location:** `apps/desktop/src/main/opencode/stream-parser.ts`

- Added `flush()` method to handle incomplete JSON on process shutdown
- Added `sanitizeLine()` method for Windows terminal control character removal
- Enhanced handling of partial JSON across line boundaries
- Better detection of terminal decoration vs actual JSON content

---

## 4. Secure Storage

### secureStorage.ts

**Location:** `apps/desktop/src/main/store/secureStorage.ts`

- Added `keytar` integration for native OS keychain:
  - Windows: Windows Credential Vault
  - macOS: Keychain (existing)
  - Linux: Secret Service
- Falls back to AES-256-GCM encrypted electron-store if keytar unavailable
- Auto-migration from encrypted store to keychain when keytar becomes available
- All storage methods converted to async (`storeApiKey`, `getApiKey`, etc.)
- Uses service name `ai.accomplish.desktop` for keychain entries

---

## 5. New Files Added

| File | Purpose |
|------|---------|
| `apps/desktop/resources/icon.ico` | Windows application icon |
| `apps/desktop/scripts/postinstall.cjs` | Cross-platform postinstall script |
| `apps/desktop/scripts/opencode-smoke.cjs` | Smoke test script for OpenCode CLI |
| `kill-processes.ps1` | PowerShell script to kill Openwork processes during development |
| `CONTEXT.md` | Project context documentation |
| `TESTING.md` | Testing documentation |
| `docs/plans/2026-01-15-task-launcher-design.md` | Task launcher design document |

---

## 6. Test Infrastructure

### E2E Tests

- Removed Docker-based test commands (not needed/compatible on Windows)
- Simplified to native Playwright commands:
  - `test:e2e` - Run E2E tests
  - `test:e2e:ui` - Run with Playwright UI
  - `test:e2e:debug` - Run in debug mode
  - `test:e2e:fast` - Fast test project
  - `test:e2e:integration` - Integration test project
- Various test file updates for Windows compatibility

### Modified Test Files

- `apps/desktop/e2e/playwright.config.ts`
- `apps/desktop/e2e/fixtures/electron-app.ts`
- `apps/desktop/e2e/pages/*.ts`
- `apps/desktop/e2e/specs/*.spec.ts`
- Multiple unit and integration test files

---

## 7. Provider Simplification

The Windows port simplified the provider support:

### Removed

- AWS Bedrock integration (`@aws-sdk/client-bedrock`, `@aws-sdk/credential-providers`)
- DeepSeek API key handling
- Z.AI API key handling
- OpenRouter API key handling
- LiteLLM API key handling

### Retained

- Anthropic
- OpenAI
- Google (Gemini)
- xAI (Grok)
- Ollama (local)

---

## Key Technical Decisions

### 1. Shell Execution

Uses PowerShell on Windows with proper command escaping. Commands are prefixed with `& ` for PowerShell execution.

### 2. Native Modules

`node-pty` and `keytar` are rebuilt via electron-rebuild with prebuilt binaries when available. Handles Spectre-mitigated library requirements on Windows.

### 3. Path Handling

Platform-aware path delimiters:
- Windows: `;`
- Unix: `:`

Directory structures handle both flat and versioned layouts.

### 4. Symlinks

Replaced with file copies on Windows due to symlink permission issues (requires admin or developer mode).

### 5. Icons

Auto-generates `.ico` from `.png` during packaging using `png-to-ico`.

### 6. Async Storage

All secure storage operations are now async to support keytar's Promise-based API.

---

## Build Commands

```bash
# Development
pnpm dev                    # Run in dev mode

# Windows Builds
pnpm build:win              # NSIS installer
pnpm build:win:portable     # Portable executable
pnpm build:unpack           # Unpacked (for testing)

# Testing
pnpm test:e2e               # Run E2E tests
pnpm opencode:smoke         # Smoke test OpenCode CLI
```

---

## Output Location

Windows builds are output to:
- `apps/desktop/release/win-unpacked/` - Unpacked application
- `apps/desktop/release/*.exe` - Installer/portable executables
