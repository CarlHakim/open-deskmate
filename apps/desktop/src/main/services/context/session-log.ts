import fs from 'fs';

export function appendSessionLogMessage(params: {
  sessionFilePath: string;
  role: 'user' | 'assistant';
  content: string;
}): void {
  const content = params.content ?? '';
  if (!content.trim()) return;
  // Avoid polluting the session snapshot with slash-commands.
  if (content.trim().startsWith('/')) return;

  const payload = {
    type: 'message',
    message: {
      role: params.role,
      content,
    },
  };

  try {
    fs.appendFileSync(params.sessionFilePath, `${JSON.stringify(payload)}\n`, 'utf-8');
  } catch (error) {
    console.warn('[SessionLog] Failed to append session log:', error);
  }
}

