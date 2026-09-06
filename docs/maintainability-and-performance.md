# Desktop maintainability and performance changes

## Feature boundaries

- `renderer/pages/WorkboardItem.tsx` owns the Workboard detail route previously embedded in `App.tsx`.
- `renderer/components/build/BuildTerminalPane.tsx`, `BuildFileTree.tsx`, and `BuildPromptComposer.tsx` own terminal rendering, workspace tree interactions, and prompt composition. Their component logic and props were preserved during extraction.
- `renderer/lib/subagent-presentation.ts` shares 29 identical declarations formerly duplicated in Chat and Build. The two screens retain their distinct run-signature logic where their fields differ.
- `renderer/lib/workspace-paths.ts` supplies common path presentation helpers without importing terminal code.
- `main/ipc/model-provider-handlers.ts` and `tool-discovery-handlers.ts` register their respective features. They share error normalization through `register-handler.ts` and input sanitizers through `sanitizers.ts`; existing IPC names and preload contracts are unchanged.
- `main/runtime/warm-session.ts` shares recent-session eligibility and historical-image reset policy between desktop execution and dispatched tasks. The callers retain their gateway, existing-session, prompt fallback and logging behavior.

Build and Execution still contain substantial coordination logic. These extractions establish feature boundaries without attempting a wholesale task-runtime rewrite.

## Performance behavior

Heavy routes load with React lazy imports and a loading state. Navigation mounts the target immediately instead of waiting for the outgoing route's spring animation. Chat, the sidebar, and global permission handling remain available in the shell.

Closed feature dialogs do not initialize during startup. Settings code and closed component state are prepared during idle time after a 1.5-second delay, avoiding most of the first-open penalty; its open-gated data requests still wait for opening. Dialog state is retained after initialization. Search audit and project management load on first use.

Build terminal creation waits until the workspace has painted and is skipped while the terminal section is hidden. Runtime polling uses a shared hook that pauses in hidden documents, skips hidden log/terminal panels, and waits for one request to finish before scheduling another. This avoids overlapping slow IPC requests.

## Measurements on this Windows machine

Measured from local Vite production output through Playwright Electron, with separate user/session data and mocked task execution. These are warm-machine process launches, not cold-cache or installer benchmarks. The UI opened the default empty Build workspace; no application build command or real AI request was run.

| Measurement | Before | After |
| --- | --- | --- |
| Launch to visible Chat input | 2.63–2.81 s | 2.05–2.13 s |
| First Build entry | 1.085–1.118 s | 0.618–0.639 s |
| Return to Build | 0.693–0.701 s | 0.155–0.187 s |
| Return to Chat | 0.605–0.674 s | 0.111–0.296 s |
| Subagents entry | 0.580–0.713 s | 0.216–0.224 s |
| Settings opening after idle preparation | 0.459–0.541 s | 0.568–0.594 s |
| Main renderer JS bundle, uncompressed | 4.46 MB | 1.01 MB |

Before ranges use four comparable baseline runs. After ranges use three final-configuration runs; one encountered an ambiguous text locator later in its extended smoke check, after the timings above had completed. Navigation includes automation overhead, waits for target content, and then waits two animation frames. It does not measure full workspace or terminal readiness. Main bundle size excludes other shared chunks and deferred feature chunks.

Startup and navigation improved. Settings remains modestly slower on first opening and can cost more if opened before idle preparation completes. No improvement is claimed for real provider latency, sustained streaming, large repositories or long-duration memory behavior. Some deferred chunks still exceed Vite's size-warning threshold.

## Validation

- Desktop TypeScript check.
- Production Vite build, including Electron main and preload bundles.
- 101 targeted tests: existing IPC coverage, shared warm-session policy, polling cancellation/visibility/non-overlap, and deferred-dialog state retention.
- Electron smoke check: Chat/Build/Subagents navigation, Settings opening, provider/toolset/project IPC reads, live task event display, Help route, unavailable Workboard item handling, and mounted xterm terminal. Build screenshot visually inspected.
- No provider keys or paid requests were used for verification.

Local profiling scripts, raw measurements and CPU captures are in the ignored `.tmp-profile` directory. Baseline run IDs are `1788604003606`, `1788604033000`, `1788604080895`, and `1788604133394`; final-configuration run IDs are `1788605553478`, `1788605595305`, and `1788605625895`. The complete extended smoke run is `1788605595305`.

## Usability follow-up

The subsequent layout changes retain the existing actions and settings:

- Chat secondary actions live in a labeled **More options** disclosure. Their handlers, disabled states, and mounted state are preserved. Active incognito and voice status remain visible. Compact context information opens the original detailed popover.
- Settings defaults to one category at a time, with **All sections**, Basic/Advanced modes, the setup checklist, and search retained. Search includes advanced categories even in Basic mode.
- Build starts with terminal, logs, and changes panels closed when no saved layout exists. **Show tools** and the existing Sections menu restore them. Existing layout preferences remain respected. Project settings and presets are expandable.
- **Start preview**, **Build project**, and **Run task** distinguish runtime, build-command, and agent actions. Build explains its separate workspace and can open that folder in Chat without changing the agent's default workspace.
- Subagents provides configuration/task actions when empty and a filter reset when no results match. Light-theme primary and secondary text contrast is stronger, with simpler shared button styling.

Validation includes 102 targeted unit tests, TypeScript, production bundles, and isolated Electron checks for category navigation, advanced search, secondary actions, panel restoration, presets, folder handoff, and subagent empty states. Screenshots were reviewed at large and smaller desktop sizes. The performance measurements above predate this usability follow-up; no additional speed claim is made for these layout changes.
