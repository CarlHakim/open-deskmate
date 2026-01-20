# Testing

## Preconditions
- Windows 10/11 x64
- Node 20+
- pnpm 9+
- Visual Studio Build Tools with "MSVC v142 - VS 2019 C++ x64/x86 Spectre-mitigated libs (Latest)"

## Quick Definitions
- Workspace folder: The directory where the agent should read/write files. Always use an absolute path (example: `C:\Users\HP\Desktop\test-folder`).

## Dev Smoke (Windows)
1. `pnpm install`
2. `pnpm dev`
3. App: add an API key (Google/OpenAI) in Settings.
4. Prompt: `work in C:\Users\HP\Desktop\test-folder and list the files`
5. Verify the task appears in the sidebar and output renders in the task view.

## File Operations
- Create: `create a new file at C:\Users\HP\Desktop\test-folder\created.txt with "hello"`
- Edit: `append "more text" to C:\Users\HP\Desktop\test-folder\created.txt`
- Read: `read C:\Users\HP\Desktop\test-folder\created.txt`
- Delete: `delete C:\Users\HP\Desktop\test-folder\created.txt` (confirm the permission prompt)

## Browser Automation
- Prompt: `open https://example.com and report the page title`
- Expect a Chrome window to open and navigate (about:blank is expected briefly before navigation).
- No `--no-sandbox` warning on Windows.

## Packaged Build (Windows)
1. `pnpm -F @accomplish/desktop build:unpack`
2. Run `apps/desktop/release/win-unpacked/Openwork.exe`
3. Repeat API key + file + browser tests above.

## Regression Checks
- App restarts and retains stored API key.
- Tasks remain visible in sidebar after completion.
- Agent output renders in the task view every time.
