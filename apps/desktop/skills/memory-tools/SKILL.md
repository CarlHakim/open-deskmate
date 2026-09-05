---
name: memory-tools
description: Read, search, and write user memory files (USER.md, MEMORY.md, daily memory, and session snapshots).
---

# Memory tools (user context)

These tools expose the user's durable memory files stored in the workspace:

- Long-term: `MEMORY.md`
- User profile: `USER.md`
- Daily logs: `memory/YYYY-MM-DD.md`
- Session snapshots: `memory/YYYY-MM-DD-*.md`

Use them to:
- retrieve context (`memory_get`)
- search (`memory_search`)
- write updates (`memory_write`)

## Tools

### memory_get
Read a specific memory file. Use this when you need the full content.

Parameters:
- `kind`: `"user"`, `"long-term"`, `"daily"`, or `"snapshot"`
- `date`: optional `"YYYY-MM-DD"` (required for daily if not today)
- `fileName`: snapshot filename under `memory/` (required for snapshot)

### memory_search
Search across memory files and return relevant snippets with file + line ranges.

Parameters:
- `query`: search string
- `kind`: optional `"all"`, `"user"`, `"long-term"`, `"daily"`, or `"snapshot"` (default `"all"`)
- `limit`: optional (default 6)

### memory_write
Write memory updates.

Parameters:
- `kind`: `"user"`, `"long-term"`, `"daily"`, or `"snapshot"`
- `date`: optional `"YYYY-MM-DD"` for daily
- `fileName`: snapshot filename under `memory/` (required for snapshot)
- `content`: markdown content
- `mode`: `"replace"` (default) or `"append"`

## Guidance

- Use **user memory** for stable user profile details and durable preferences.
- Use **long-term memory** for durable project/workspace facts and decisions.
- Use **daily memory** for short-term context and running notes.
- Use **snapshot memory** for session summaries and task-linked handoff notes.
- If asked to "remember", store it in memory.
- `memory_search` uses a local SQLite index with keyword scoring (no paid embeddings).
