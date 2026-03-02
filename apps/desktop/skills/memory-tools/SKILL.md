---
name: memory-tools
description: Read, search, and write user memory files (MEMORY.md and memory/YYYY-MM-DD.md).
---

# Memory tools (user context)

These tools expose the user's durable memory files stored in the workspace:

- Long-term: `MEMORY.md`
- Daily logs: `memory/YYYY-MM-DD.md`

Use them to:
- retrieve context (`memory_get`)
- search (`memory_search`)
- write updates (`memory_write`)

## Tools

### memory_get
Read a specific memory file. Use this when you need the full content.

Parameters:
- `kind`: `"long-term"` or `"daily"`
- `date`: optional `"YYYY-MM-DD"` (required for daily if not today)

### memory_search
Search across memory files and return relevant snippets with file + line ranges.

Parameters:
- `query`: search string
- `limit`: optional (default 6)

### memory_write
Write memory updates.

Parameters:
- `kind`: `"long-term"` or `"daily"`
- `date`: optional `"YYYY-MM-DD"` for daily
- `content`: markdown content
- `mode`: `"replace"` (default) or `"append"`

## Guidance

- Use **long-term memory** for stable preferences, facts, and decisions.
- Use **daily memory** for short-term context and running notes.
- If asked to "remember", store it in memory.
- `memory_search` uses a local SQLite index with keyword scoring (no paid embeddings).
