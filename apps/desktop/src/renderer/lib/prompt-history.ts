export const CHAT_PROMPT_HISTORY_STORAGE_KEY = 'open-deskmate.prompt-history.chat.v1';
export const BUILD_PROMPT_HISTORY_STORAGE_KEY = 'open-deskmate.prompt-history.build.v1';

const MAX_PROMPT_HISTORY_ITEMS = 80;
const MAX_PROMPT_HISTORY_CHARS = 20_000;

type TextareaArrowEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  currentTarget: HTMLTextAreaElement;
};

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function normalizePromptHistoryEntry(value: string): string {
  return String(value || '').trim().slice(0, MAX_PROMPT_HISTORY_CHARS);
}

export function readPromptHistory(storageKey: string): string[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map(normalizePromptHistoryEntry)
      .filter(Boolean)
      .slice(-MAX_PROMPT_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function writePromptHistory(storageKey: string, entries: string[]): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(entries.map(normalizePromptHistoryEntry).filter(Boolean).slice(-MAX_PROMPT_HISTORY_ITEMS))
    );
  } catch {
    // History is a convenience feature; ignore storage failures.
  }
}

export function addPromptHistoryEntry(
  storageKey: string,
  value: string,
  existingEntries?: string[]
): string[] {
  const normalized = normalizePromptHistoryEntry(value);
  if (!normalized) return existingEntries ?? readPromptHistory(storageKey);

  const base = existingEntries ?? readPromptHistory(storageKey);
  const next = base.filter((entry) => entry !== normalized);
  next.push(normalized);
  const trimmed = next.slice(-MAX_PROMPT_HISTORY_ITEMS);
  writePromptHistory(storageKey, trimmed);
  return trimmed;
}

export function shouldHandlePromptHistoryRecall(
  event: TextareaArrowEvent,
  direction: 'older' | 'newer',
  historyActive: boolean
): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) {
    return false;
  }

  if (direction === 'newer') {
    return historyActive;
  }

  if (historyActive) return true;
  const target = event.currentTarget;
  if (!target.value.includes('\n')) return true;
  return target.selectionStart === 0 && target.selectionEnd === 0;
}
