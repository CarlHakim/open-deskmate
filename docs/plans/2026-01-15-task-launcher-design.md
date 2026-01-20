# Task Launcher Design

Spotlight-style modal for quick task search and creation.

## Triggers

- `Cmd+K` (app-focused only)
- Search icon button in header toolbar

## Modal Structure

```
┌─────────────────────────────────┐
│ 🔍 Search tasks...            ✕ │
├─────────────────────────────────┤
│ ⬛ New task                      │
├─────────────────────────────────┤
│ Last 7 days                     │
│ ⬛ Task title...          Friday │
│ ⬛ Another task...      Thursday │
└─────────────────────────────────┘
```

## Behavior

**Search:**
- Filters by task title only
- Debounce 150-200ms
- Shows full history (not just 7 days) when searching

**Keyboard:**
- `↑`/`↓` navigate list
- `Enter` select item
- `Escape` close modal

**Selecting "New task":**
1. Search text becomes task prompt
2. Modal closes
3. Task execution begins immediately

**Selecting past task:**
- Navigates to `/execution/:taskId`
- Modal closes

## Implementation

**New components:**
```
src/renderer/components/TaskLauncher/
  TaskLauncher.tsx      # Modal + search input
  TaskLauncherItem.tsx  # Task row
```

**State (Zustand):**
- `isLauncherOpen: boolean`
- `openLauncher()` / `closeLauncher()`

**Data:** Existing `window.accomplish.getTaskHistory()` - no new IPC.

**Header:** Add search icon button, register `Cmd+K` listener.

## Edge Cases

- No history → show only "New task"
- No search matches → "No tasks found"
- Long titles → truncate with ellipsis
- Limit visible results to ~10, scroll for more

## Accessibility

- Focus trap in modal
- `role="dialog"`, `aria-modal="true"`
- Announce result count on search
