import type { TaskMessage } from '@accomplish/shared';

/** IPC may replay a message or deliver its updated snapshot in a later batch. */
export function mergeTaskMessages(existing: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  const messages: TaskMessage[] = [];
  const positions = new Map<string, number>();
  for (const message of [...existing, ...incoming]) {
    const index = positions.get(message.id);
    if (index === undefined) {
      positions.set(message.id, messages.length);
      messages.push(message);
    } else {
      messages[index] = { ...messages[index], ...message };
    }
  }
  return messages;
}
