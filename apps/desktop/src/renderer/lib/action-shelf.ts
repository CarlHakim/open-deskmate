export type ActionMode = 'chat' | 'build';
export type ShelfAction = { id: string; title: string; content: string; description?: string };

export const STARTER_ACTIONS: Record<ActionMode, ShelfAction[]> = {
  chat: [
    { id: 'starter:compare', title: 'Compare costs', content: 'Compare costs for {{Items or services}} in {{Currency}}. My budget is {{Budget}}. Show an itemised comparison, recurring charges, assumptions, and a recommendation. Distinguish estimates from verified prices. These amounts describe this task, not my AI spending limits.' },
    { id: 'starter:research', title: 'Research options', content: 'Research {{Topic}} for {{Requirements}}. Compare suitable options, explain tradeoffs, and cite sources for factual claims.' },
    { id: 'starter:summarise', title: 'Summarise', content: 'Summarise {{Material or topic}} for {{Audience}}. Highlight the key points, decisions, and next steps.' },
  ],
  build: [
    { id: 'starter:bug', title: 'Find a bug', content: 'Investigate this problem: {{Problem and reproduction steps}}. Trace the root cause, make a focused fix, preserve existing functionality, and run relevant checks.' },
    { id: 'starter:tests', title: 'Run tests', content: 'Run the relevant existing tests for this project. Report what passed, any failures, and what could not be tested. Do not change files without first explaining the failure and proposed fix.' },
    { id: 'starter:review', title: 'Review changes', content: 'Review the current project changes for bugs, regressions, and maintainability. Give concrete findings with file references and suggested fixes. Preserve files while reviewing.' },
  ],
};

// Deliberately limited syntax: ordinary braces in code and JSON stay untouched.
const fieldPattern = /\{\{([A-Za-z][A-Za-z0-9 _-]{0,59})\}\}/g;
export function actionFields(content: string): string[] {
  return [...new Set(Array.from(content.matchAll(fieldPattern), match => match[1]))];
}
export function fillAction(content: string, values: Record<string, string>): string {
  return content.replace(fieldPattern, (original, key: string) => values[key]?.trim() || original);
}
export function actionScope(mode: ActionMode, projectId?: string | null): string {
  return JSON.stringify([mode, projectId || null]);
}
