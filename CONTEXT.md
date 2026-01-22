# Open-deskmate / CarlHakim/desktop — Windows Context

## Project Purpose
The goal of this work is to make the Open Deskmate desktop application build, package, and run reliably on Windows 10/11 (x64). The app must support workspace-based file access, OpenCode agent execution, browser automation via dev-browser, permission prompts, and a usable UI in both dev and packaged `.exe` builds.

## Architecture
- pnpm monorepo
- Desktop package: @accomplish/desktop
- Electron app with:
  - Main process (task management, PTY, OpenCode adapter)
  - Renderer (React UI)
- OpenCode CLI executed via node-pty
- Skills system including:
  - dev-browser
  - file-permission MCP
- Packaged artifacts:
  - `apps/desktop/release/win-unpacked/Open Deskmate.exe`
- Bundled Node is required for packaged runtime

## Key Technical Decisions & Fixes
### UI / UX
- Identified that packaged builds were executing tasks but not navigating to the Execution page.
- Fixed by auto-routing to `/execution/:id` on task creation.
- Added fallback “Open task” button if navigation fails.
- Fixed nested `<button>` issue in Debug panel header that caused React hydration warnings and broken rendering.

### Windows Compatibility
- Replaced macOS/Linux shell assumptions:
  - Removed `bash` usage on Windows.
  - Updated dev-browser startup to use `npx tsx` and Windows-safe commands.
- Updated PTY invocation:
  - PowerShell requires `&` when executing `.cmd` or quoted commands.
  - Added detection when PTY exits without producing stdout/stderr.
- Ensured `build:unpack` does the same preparation as Windows builds:
  - Download bundled Node
  - Install dev-browser and permission skill dependencies

### Workspace Handling
- There is currently no workspace picker in the UI.
- Workspace must be specified in the prompt (e.g. “Work in C:\path\to\folder”).
- File access is restricted to the declared workspace.

## Constraints & Invariants
- Windows-first behavior; no mac-only assumptions.
- PowerShell is the primary shell.
- Workspace sandboxing must be preserved.
- Stable LLM models are required; preview models may hang silently.

## Current State
- `pnpm dev` works on Windows.
- Packaged `Open Deskmate.exe` launches and accepts prompts.
- Tasks are created, saved, and visible in the sidebar.
- Execution page opens automatically.
- File operations (list/create/edit) work.
- Browser automation was failing due to missing server startup; Windows fixes were added and are under verification.

## Open Questions / Next Steps
- Validate dev-browser behavior in a clean Windows environment.
- Confirm bundled Node and skill installs are reliable without dev tooling.
- Decide whether to implement a proper workspace picker UI.
- Improve surfaced error messages for PTY failures.
- Finalize installer/portable `.exe` output and document build artifacts.
