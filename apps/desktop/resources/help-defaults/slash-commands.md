# Slash Commands

OpenDeskmate uses one shared command registry across supported prompt inputs and the global `Cmd+K` launcher.

## Where Slash Commands Work

- **Home prompt**
  - The initial Chat Mode prompt on the New Task page.
- **Chat follow-up prompt**
  - The prompt at the bottom of an open chat task.
- **Build prompt**
  - The AI Build Operator prompt in Build Mode.
- **Global command palette**
  - Open `Cmd+K`, then type `/` to switch it into command mode.

## Basic Controls

- Type `/` to open command suggestions.
- Use `ArrowUp` and `ArrowDown` to change selection.
- Use `Enter` or `Tab` to run the selected command.
- Use `Escape` to close the slash menu or leave command mode.

## Availability Notes

- **Yes** means the command is available in that surface.
- **Conditional** means the command only appears when the current page state supports it.
- **Build route** or **Chat route** means the global palette only shows that command on that route.

## Navigation Commands

| Command | Aliases | Home | Chat follow-up | Build prompt | `Cmd+K` palette | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/build` | `b` | Yes | Yes | No | Non-Build route | Switch to Build Mode. |
| `/chat` | `c` | No | No | Yes | Build route | Switch to Chat Mode. |
| `/new` | `home` | Yes | Yes | Yes | Yes | Go to the new task page. |
| `/help` | `docs` | Yes | Yes | Yes | Yes | Open the Help page. |

## Settings Commands

| Command | Aliases | Home | Chat follow-up | Build prompt | `Cmd+K` palette | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/settings` | `prefs` | Yes | Yes | Yes | Yes | Open the full Settings dialog. |
| `/settings-models` | `models` | Yes | Yes | Yes | Yes | Open Settings filtered to model and provider sections. |
| `/settings-agents` | `agents` | Yes | Yes | Yes | Yes | Open Settings filtered to agent-related sections. |
| `/settings-skills` | `skills` | Yes | Yes | Yes | Yes | Open Settings filtered to skills. |
| `/settings-hooks` | `hooks` | Yes | Yes | Yes | Yes | Open Settings filtered to Runtime Hooks. |

## Subagent Commands

| Command | Aliases | Home | Chat follow-up | Build prompt | `Cmd+K` palette | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/subagents` | `subs` | Yes | Yes | Yes | Yes | Open the global Subagents page. |
| `/subagents-active` | `subs-active` | Yes | Yes | Yes | Yes | Open Subagents filtered to active runs. |
| `/subagents-session` | `subs-session` | Yes | Yes | Yes | Yes | Open Subagents filtered to session-mode runs. |
| `/subagents-archived` | `subs-archived` | Yes | Yes | Yes | Yes | Open Subagents filtered to archived runs. |
| `/subagents-closed` | `subs-closed` | Yes | Yes | Yes | Yes | Open Subagents filtered to closed sessions. |
| `/subagents-refresh` | `subs-refresh` | No | Conditional | Conditional | Chat or Build route | Refresh the current task's subagent list. |

## Task Commands

| Command | Aliases | Home | Chat follow-up | Build prompt | `Cmd+K` palette | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/stop` | `cancel` | No | Conditional | Conditional | Chat or Build route | Stops the current AI task. |
| `/save-skill` | `skill` | No | Conditional | No | Completed Chat route | Save the current completed chat as a reusable skill. |

## Build Commands

| Command | Aliases | Home | Chat follow-up | Build prompt | `Cmd+K` palette | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/history` | `hist` | No | No | Yes | Build route | Open Build task history. |
| `/history-new` | `newb` | No | No | Yes | Build route | Start a new Build history session. |
| `/runtime-start` | `start`, `rs` | No | No | Conditional | Build route | Start the Build runtime. |
| `/runtime-stop` | `rstop` | No | No | Conditional | Build route | Stop the Build runtime. |
| `/runtime-restart` | `restart`, `rr` | No | No | Conditional | Build route | Restart the Build runtime. |
| `/runtime-build` | `rb` | No | No | Conditional | Build route | Run the project build command once. |
| `/runtime-open` | `preview` | No | No | Conditional | Build route | Open the current runtime preview in the browser. |

## Conditional Cases

- `/stop` only appears when the current task is running.
- `/save-skill` only appears for completed chat tasks that can be saved as a skill.
- `/subagents-refresh` only appears when the current Chat or Build task has tracked subagents.
- Build runtime commands only appear when the relevant Build action is available.

## Related Pages

- [Chat Mode](./chat-mode.md)
- [Build Mode](./build-mode.md)
- [Subagents](./subagents.md)
- [Settings Overview](./settings/overview.md)
