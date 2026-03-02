import fs from 'fs';

export type SessionLine = {
  role: 'user' | 'assistant';
  content: string;
  pinned?: boolean;
};

function parsePinned(content: string): { content: string; pinned: boolean } {
  const trimmed = content.trim();
  const prefix = 'PINNED:';
  if (trimmed.toUpperCase().startsWith(prefix)) {
    return { pinned: true, content: trimmed.slice(prefix.length).trim() };
  }
  return { pinned: false, content };
}

export function readSessionLines(sessionFilePath: string): SessionLine[] {
  try {
    if (!sessionFilePath || !fs.existsSync(sessionFilePath)) return [];
    const raw = fs.readFileSync(sessionFilePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const out: SessionLine[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          message?: { role?: string; content?: unknown; pinned?: unknown };
        };
        if (entry.type !== 'message' || !entry.message) continue;
        const role = entry.message.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const content = typeof entry.message.content === 'string' ? entry.message.content : '';
        if (!content.trim()) continue;
        if (content.trim().startsWith('/')) continue;
        const parsed = parsePinned(content);
        const pinned = Boolean(entry.message.pinned) || parsed.pinned;
        out.push({ role, content: parsed.content, pinned });
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function formatSessionLines(lines: SessionLine[]): string {
  return lines.map((l) => `${l.role}: ${l.content}`).join('\n');
}
