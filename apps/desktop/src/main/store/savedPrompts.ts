import { randomUUID } from 'crypto';
import Store from 'electron-store';

const BUILT_IN_SAVED_PROMPT_CATEGORIES = [
  'Build',
  'Research',
  'Automation',
  'Files',
  'Connectors',
  'Troubleshooting',
] as const satisfies readonly string[];

export type SavedPromptCategory = string;

const DEFAULT_SAVED_PROMPT_CATEGORY = 'Build';

export interface SavedPromptRecord {
  id: string;
  title: string;
  content: string;
  category: SavedPromptCategory;
  createdAt: string;
  updatedAt: string;
}

interface SavedPromptsStoreSchema {
  prompts: SavedPromptRecord[];
  categories: SavedPromptCategory[];
}

const savedPromptsStore = new Store<SavedPromptsStoreSchema>({
  name: 'saved-prompts',
  defaults: {
    prompts: [],
    categories: [...BUILT_IN_SAVED_PROMPT_CATEGORIES],
  },
});

function normalizeCategoryName(input: unknown): SavedPromptCategory {
  return String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function normalizeSavedPromptCategory(
  input: unknown,
  fallback: SavedPromptCategory = DEFAULT_SAVED_PROMPT_CATEGORY
): SavedPromptCategory {
  return normalizeCategoryName(input) || normalizeCategoryName(fallback) || DEFAULT_SAVED_PROMPT_CATEGORY;
}

function normalizePromptRecord(input: SavedPromptRecord): SavedPromptRecord | null {
  const id = String(input.id || '').trim();
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  const category = normalizeSavedPromptCategory(input.category);
  const createdAt = String(input.createdAt || '').trim();
  const updatedAt = String(input.updatedAt || '').trim();
  if (!id || !title || !content || !createdAt || !updatedAt) return null;
  return { id, title, content, category, createdAt, updatedAt };
}

function sortPrompts(prompts: SavedPromptRecord[]): SavedPromptRecord[] {
  return prompts.slice().sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

function normalizeCategories(values: unknown[], promptCategories: string[] = []): SavedPromptCategory[] {
  const seen = new Set<string>();
  const result: SavedPromptCategory[] = [];
  const add = (value: unknown) => {
    const normalized = normalizeCategoryName(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  };

  BUILT_IN_SAVED_PROMPT_CATEGORIES.forEach(add);
  values.forEach(add);
  promptCategories.forEach(add);
  return result;
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

export function listSavedPromptCategories(): SavedPromptCategory[] {
  const prompts = listSavedPrompts();
  const raw = savedPromptsStore.get('categories') ?? [];
  const categories = normalizeCategories(raw, prompts.map((prompt) => prompt.category));
  if (JSON.stringify(categories) !== JSON.stringify(raw)) {
    savedPromptsStore.set('categories', categories);
  }
  return categories;
}

export function createSavedPromptCategory(input: string): SavedPromptCategory[] {
  const category = normalizeCategoryName(input);
  if (!category) throw new Error('category is required');
  const categories = normalizeCategories([...listSavedPromptCategories(), category]);
  savedPromptsStore.set('categories', categories);
  return categories;
}

export function renameSavedPromptCategory(from: string, to: string): { categories: SavedPromptCategory[]; prompts: SavedPromptRecord[] } {
  const oldName = normalizeCategoryName(from);
  const nextName = normalizeCategoryName(to);
  if (!oldName || !nextName) throw new Error('from and to categories are required');
  const oldKey = oldName.toLowerCase();
  const prompts = listSavedPrompts().map((prompt) => (
    prompt.category.toLowerCase() === oldKey
      ? { ...prompt, category: nextName, updatedAt: new Date().toISOString() }
      : prompt
  ));
  const categories = normalizeCategories(
    listSavedPromptCategories().map((category) => (category.toLowerCase() === oldKey ? nextName : category)),
    prompts.map((prompt) => prompt.category)
  );
  savedPromptsStore.set('prompts', sortPrompts(prompts));
  savedPromptsStore.set('categories', categories);
  return { categories, prompts: listSavedPrompts() };
}

export function deleteSavedPromptCategory(input: string, replacementInput?: string): { categories: SavedPromptCategory[]; prompts: SavedPromptRecord[] } {
  const category = normalizeCategoryName(input);
  if (!category) throw new Error('category is required');
  const categoryKey = category.toLowerCase();
  const fallback = normalizeSavedPromptCategory(replacementInput, DEFAULT_SAVED_PROMPT_CATEGORY);
  const replacement = fallback.toLowerCase() === categoryKey ? DEFAULT_SAVED_PROMPT_CATEGORY : fallback;
  const prompts = listSavedPrompts().map((prompt) => (
    prompt.category.toLowerCase() === categoryKey
      ? { ...prompt, category: replacement, updatedAt: new Date().toISOString() }
      : prompt
  ));
  const categories = normalizeCategories(
    listSavedPromptCategories().filter((entry) => entry.toLowerCase() !== categoryKey),
    prompts.map((prompt) => prompt.category)
  );
  savedPromptsStore.set('prompts', sortPrompts(prompts));
  savedPromptsStore.set('categories', categories);
  return { categories, prompts: listSavedPrompts() };
}

export function upsertSavedPrompt(input: {
  id?: string;
  title: string;
  content: string;
  category?: string;
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
  const existing = existingIndex >= 0 ? prompts[existingIndex] : null;
  const nextPrompt: SavedPromptRecord = {
    id,
    title,
    content,
    category: normalizeSavedPromptCategory(input.category, existing?.category || DEFAULT_SAVED_PROMPT_CATEGORY),
    createdAt: existing ? existing.createdAt : createdAt,
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
  createSavedPromptCategory(nextPrompt.category);
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
