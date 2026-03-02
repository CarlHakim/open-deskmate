import { randomUUID } from 'crypto';
import Store from 'electron-store';

export interface SavedPromptRecord {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedPromptsStoreSchema {
  prompts: SavedPromptRecord[];
}

const savedPromptsStore = new Store<SavedPromptsStoreSchema>({
  name: 'saved-prompts',
  defaults: {
    prompts: [],
  },
});

function normalizePromptRecord(input: SavedPromptRecord): SavedPromptRecord | null {
  const id = String(input.id || '').trim();
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  const createdAt = String(input.createdAt || '').trim();
  const updatedAt = String(input.updatedAt || '').trim();
  if (!id || !title || !content || !createdAt || !updatedAt) return null;
  return { id, title, content, createdAt, updatedAt };
}

function sortPrompts(prompts: SavedPromptRecord[]): SavedPromptRecord[] {
  return prompts.slice().sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

export function listSavedPrompts(): SavedPromptRecord[] {
  const raw = savedPromptsStore.get('prompts') ?? [];
  const normalized = raw
    .map((item) => normalizePromptRecord(item))
    .filter((item): item is SavedPromptRecord => Boolean(item));
  const sorted = sortPrompts(normalized);
  if (sorted.length !== raw.length) {
    savedPromptsStore.set('prompts', sorted);
  }
  return sorted;
}

export function upsertSavedPrompt(input: {
  id?: string;
  title: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
}): SavedPromptRecord {
  const id = String(input.id || '').trim() || randomUUID();
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  if (!title || !content) {
    throw new Error('title and content are required');
  }
  const now = new Date().toISOString();
  const createdAt = String(input.createdAt || '').trim() || now;
  const updatedAt = String(input.updatedAt || '').trim() || now;

  const prompts = listSavedPrompts();
  const existingIndex = prompts.findIndex((prompt) => prompt.id === id);
  const nextPrompt: SavedPromptRecord = {
    id,
    title,
    content,
    createdAt: existingIndex >= 0 ? prompts[existingIndex].createdAt : createdAt,
    updatedAt,
  };
  const next = prompts.slice();
  if (existingIndex >= 0) {
    next[existingIndex] = nextPrompt;
  } else {
    next.push(nextPrompt);
  }
  const sorted = sortPrompts(next);
  savedPromptsStore.set('prompts', sorted);
  return sorted.find((prompt) => prompt.id === id) as SavedPromptRecord;
}

export function deleteSavedPrompt(id: string): boolean {
  const targetId = String(id || '').trim();
  if (!targetId) return false;
  const prompts = listSavedPrompts();
  const next = prompts.filter((prompt) => prompt.id !== targetId);
  if (next.length === prompts.length) return false;
  savedPromptsStore.set('prompts', next);
  return true;
}
