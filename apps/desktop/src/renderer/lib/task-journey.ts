import type { TaskActivityEvent, TaskMessage, TaskStatus } from '@accomplish/shared';
import { parseInteractiveAnswer } from '@accomplish/shared';

export type JourneyStage = 'Planning' | 'Researching' | 'Creating' | 'Checking' | 'Ready' | 'Working';
export type JourneyEntry = { id: string; stage: JourneyStage; title: string; detail: string; timestamp: string; messageId?: string };
export const journeyStages: JourneyStage[] = ['Planning', 'Researching', 'Creating', 'Checking', 'Ready'];
export function hasGuidanceChoices(content: string): boolean {
  return [...content.matchAll(/```deskmate\s*\n([\s\S]*?)```/g)].some(match => parseInteractiveAnswer(match[1])?.type === 'choices');
}

function toolStage(name: string, input: unknown): JourneyStage {
  const tool = name.toLowerCase();
  const command = input && typeof input === 'object' && 'command' in input ? String(input.command) : '';
  if (/todo|plan/.test(tool)) return 'Planning';
  if (/test|check|lint|typecheck/.test(tool) || /\b(test|lint|typecheck|tsc|vitest|pytest|playwright)\b/.test(command)) return 'Checking';
  if (/search|fetch|read|grep|glob|browse/.test(tool)) return 'Researching';
  if (/write|edit|patch|create|save/.test(tool)) return 'Creating';
  return 'Working';
}

export function buildTaskJourney(messages: TaskMessage[], activity: TaskActivityEvent[], status?: TaskStatus) {
  // Persisted Build history can reorder equal-time messages by ID. Use the
  // prompt's timestamp so an answer isn't lost merely because it sorts first.
  const boundary = messages.reduce((latest, message) => message.type === 'user' && message.timestamp > latest ? message.timestamp : latest, '');
  const turn = messages.filter(message => !boundary || message.timestamp >= boundary);
  const entries: JourneyEntry[] = [];
  for (const message of turn.slice(-300)) {
    if (message.type !== 'tool' && message.type !== 'assistant') continue;
    entries.push({ id: message.id, messageId: message.id, timestamp: message.timestamp,
      stage: message.type === 'tool' ? toolStage(message.toolName || '', message.toolInput) : 'Creating',
      title: message.type === 'tool' ? message.toolName || 'Tool activity' : 'Answer',
      detail: message.content.slice(0, 1200) });
  }
  for (const event of activity.slice(-300)) {
    if (boundary && event.timestamp < boundary) continue;
    if (event.messageId && entries.some(entry => entry.messageId === event.messageId)) continue;
    if (event.kind === 'task_finished' || event.kind === 'assistant_message') continue;
    entries.push({ id: event.id, messageId: event.messageId, timestamp: event.timestamp,
      stage: event.toolName ? toolStage(event.toolName, event.metadata) : 'Working',
      title: event.title, detail: (event.detail || '').slice(0, 1200) });
  }
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const lastAnswer = [...turn].reverse().find(message => message.type === 'assistant');
  const needsGuidance = status === 'completed' && Boolean(lastAnswer && hasGuidanceChoices(lastAnswer.content));
  if (status === 'completed' && !needsGuidance) entries.push({ id: 'ready', stage: 'Ready', title: 'Turn finished', detail: 'The agent finished this turn. Recorded checks and results are available in the history.', timestamp: '', messageId: lastAnswer?.id });
  const latestEvent = activity[activity.length - 1];
  const attention = status === 'running' && latestEvent && (!boundary || latestEvent.timestamp >= boundary)
    && ['stall_detected', 'subagent_stuck', 'subagent_stale', 'subagent_failed'].includes(latestEvent.kind);
  const label = status === 'failed' ? 'Needs attention' : status === 'cancelled' || status === 'interrupted' ? 'Stopped'
    : status === 'waiting_permission' ? 'Waiting for permission' : status === 'queued' ? 'Queued'
      : attention ? 'Needs attention' : needsGuidance ? 'Waiting for your choice' : status === 'completed' ? 'Ready' : status === 'pending' ? 'Starting' : 'Working';
  return { entries, label, needsGuidance };
}
