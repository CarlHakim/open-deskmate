import { create } from 'zustand';
import { getAccomplish } from '../lib/accomplish';
import {
  DEFAULT_PROMPT_CATEGORY,
  mergePromptCategories,
  normalizePromptCategory,
  type PromptCategory,
} from '../lib/prompt-categories';

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  category: PromptCategory;
  createdAt: string;
  updatedAt: string;
}

interface SavedPromptsState {
  prompts: SavedPrompt[];
  categories: PromptCategory[];
  loadPrompts: () => void;
  savePrompt: (title: string, content: string, category?: PromptCategory) => SavedPrompt;
  updatePrompt: (id: string, title: string, content: string, category?: PromptCategory) => void;
  deletePrompt: (id: string) => void;
  createCategory: (name: string) => void;
  renameCategory: (from: string, to: string) => void;
  deleteCategory: (name: string, replacement?: string) => void;
}

const STORAGE_KEY = 'open-deskmate-saved-prompts';
const CATEGORY_STORAGE_KEY = 'open-deskmate-saved-prompt-categories';
const MIGRATION_FLAG_KEY = 'open-deskmate-saved-prompts-remote-migrated-v1';

function generateId(): string {
  return `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadFromStorage(): SavedPrompt[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizePrompt)
          .filter((item): item is SavedPrompt => Boolean(item));
      }
    }
  } catch (e) {
    console.error('Failed to load saved prompts:', e);
  }
  return [];
}

function saveToStorage(prompts: SavedPrompt[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  } catch (e) {
    console.error('Failed to save prompts:', e);
  }
}

function loadCategoriesFromStorage(prompts: SavedPrompt[] = []): PromptCategory[] {
  try {
    const stored = localStorage.getItem(CATEGORY_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return mergePromptCategories(
      Array.isArray(parsed) ? parsed : [],
      prompts.map((prompt) => prompt.category)
    );
  } catch (e) {
    console.error('Failed to load saved prompt categories:', e);
  }
  return mergePromptCategories(prompts.map((prompt) => prompt.category));
}

function saveCategoriesToStorage(categories: PromptCategory[]): void {
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(mergePromptCategories(categories)));
  } catch (e) {
    console.error('Failed to save prompt categories:', e);
  }
}

function normalizePrompt(input: unknown): SavedPrompt | null {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
  if (!record) return null;
  const id = String(record.id ?? '').trim();
  const title = String(record.title ?? '').trim();
  const content = String(record.content ?? '').trim();
  const category = normalizePromptCategory(record.category);
  const createdAt = String(record.createdAt ?? '').trim();
  const updatedAt = String(record.updatedAt ?? '').trim();
  if (!id || !title || !content) return null;
  const nowIso = new Date().toISOString();
  return {
    id,
    title,
    content,
    category,
    createdAt: createdAt || nowIso,
    updatedAt: updatedAt || nowIso,
  };
}

function sortPrompts(prompts: SavedPrompt[]): SavedPrompt[] {
  return prompts.slice().sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

function isRemoteMigrationDone(): boolean {
  try {
    return localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function setRemoteMigrationDone(): void {
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, '1');
  } catch {
    // ignore storage failures
  }
}

function getAccomplishSafe(): ReturnType<typeof getAccomplish> | null {
  try {
    return getAccomplish();
  } catch {
    return null;
  }
}

let loadRequestCounter = 0;

export const useSavedPromptsStore = create<SavedPromptsState>((set, get) => ({
  prompts: [],
  categories: mergePromptCategories(),

  loadPrompts: () => {
    const currentLoadId = ++loadRequestCounter;
    const localPrompts = sortPrompts(loadFromStorage());
    const localCategories = loadCategoriesFromStorage(localPrompts);
    set({ prompts: localPrompts, categories: localCategories });

    const api = getAccomplishSafe();
    if (!api || typeof api.listSavedPrompts !== 'function') {
      return;
    }

    void (async () => {
      try {
        const [remoteRaw, remoteCategoriesRaw] = await Promise.all([
          api.listSavedPrompts(),
          typeof api.listSavedPromptCategories === 'function'
            ? api.listSavedPromptCategories()
            : Promise.resolve([]),
        ]);
        const remotePrompts = sortPrompts(Array.isArray(remoteRaw)
          ? remoteRaw.map(normalizePrompt).filter((item): item is SavedPrompt => Boolean(item))
          : []);
        const remoteCategories = mergePromptCategories(
          Array.isArray(remoteCategoriesRaw) ? remoteCategoriesRaw : [],
          remotePrompts.map((prompt) => prompt.category),
          localCategories
        );

        let nextPrompts = remotePrompts;
        const migrationDone = isRemoteMigrationDone();

        // One-time migration path: if shared store is empty, seed from local cache once.
        if (!migrationDone && remotePrompts.length === 0 && localPrompts.length > 0) {
          const persisted: SavedPrompt[] = [];
          for (const prompt of localPrompts) {
            try {
              const record = await api.upsertSavedPrompt(prompt);
              const normalized = normalizePrompt(record);
              persisted.push(normalized ?? prompt);
            } catch {
              persisted.push(prompt);
            }
          }
          nextPrompts = sortPrompts(persisted);
          setRemoteMigrationDone();
        } else {
          // Shared store is authoritative after migration to prevent deleted prompts from reappearing.
          if (remotePrompts.length > 0 || migrationDone) {
            setRemoteMigrationDone();
          }
        }

        if (currentLoadId !== loadRequestCounter) return;
        const nextCategories = mergePromptCategories(remoteCategories, nextPrompts.map((prompt) => prompt.category));
        saveToStorage(nextPrompts);
        saveCategoriesToStorage(nextCategories);
        set({ prompts: nextPrompts, categories: nextCategories });
      } catch (error) {
        console.warn('Failed to sync saved prompts with shared store:', error);
      }
    })();
  },

  savePrompt: (title: string, content: string, category: PromptCategory = DEFAULT_PROMPT_CATEGORY) => {
    const newPrompt: SavedPrompt = {
      id: generateId(),
      title: title.trim(),
      content: content.trim(),
      category: normalizePromptCategory(category),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prompts = sortPrompts([...get().prompts, newPrompt]);
    const categories = mergePromptCategories(get().categories, [newPrompt.category]);
    saveToStorage(prompts);
    saveCategoriesToStorage(categories);
    set({ prompts, categories });

    const api = getAccomplishSafe();
    if (api && typeof api.upsertSavedPrompt === 'function') {
      void api.upsertSavedPrompt(newPrompt).then((persisted) => {
        const normalized = normalizePrompt(persisted);
        if (!normalized) return;
        const next = sortPrompts(
          get().prompts.map((prompt) => (prompt.id === newPrompt.id ? normalized : prompt))
        );
        saveToStorage(next);
        set({ prompts: next });
      }).catch((error) => {
        console.warn('Failed to persist saved prompt to shared store:', error);
      });
    }

    return newPrompt;
  },

  updatePrompt: (id: string, title: string, content: string, category?: PromptCategory) => {
    const prompts = sortPrompts(get().prompts.map((p) =>
      p.id === id
        ? {
          ...p,
          title: title.trim(),
          content: content.trim(),
          category: normalizePromptCategory(category, p.category),
          updatedAt: new Date().toISOString(),
        }
        : p
    ));
    const categories = mergePromptCategories(get().categories, prompts.map((prompt) => prompt.category));
    saveToStorage(prompts);
    saveCategoriesToStorage(categories);
    set({ prompts, categories });

    const updated = prompts.find((prompt) => prompt.id === id);
    const api = getAccomplishSafe();
    if (updated && api && typeof api.upsertSavedPrompt === 'function') {
      void api.upsertSavedPrompt(updated).catch((error) => {
        console.warn('Failed to update saved prompt in shared store:', error);
      });
    }
  },

  deletePrompt: (id: string) => {
    const prompts = get().prompts.filter((p) => p.id !== id);
    saveToStorage(prompts);
    set({ prompts });

    const api = getAccomplishSafe();
    if (api && typeof api.deleteSavedPrompt === 'function') {
      void api.deleteSavedPrompt(id).catch((error) => {
        console.warn('Failed to delete saved prompt from shared store:', error);
      });
    }
  },

  createCategory: (name: string) => {
    const categories = mergePromptCategories(get().categories, [name]);
    saveCategoriesToStorage(categories);
    set({ categories });

    const api = getAccomplishSafe();
    if (api && typeof api.createSavedPromptCategory === 'function') {
      void api.createSavedPromptCategory(name).then((remoteCategories) => {
        const next = mergePromptCategories(remoteCategories, get().prompts.map((prompt) => prompt.category));
        saveCategoriesToStorage(next);
        set({ categories: next });
      }).catch((error) => {
        console.warn('Failed to create saved prompt category in shared store:', error);
      });
    }
  },

  renameCategory: (from: string, to: string) => {
    const fromKey = normalizePromptCategory(from).toLowerCase();
    const nextCategory = normalizePromptCategory(to);
    const prompts = sortPrompts(get().prompts.map((prompt) => (
      prompt.category.toLowerCase() === fromKey
        ? { ...prompt, category: nextCategory, updatedAt: new Date().toISOString() }
        : prompt
    )));
    const categories = mergePromptCategories(
      get().categories.map((category) => (category.toLowerCase() === fromKey ? nextCategory : category)),
      prompts.map((prompt) => prompt.category)
    );
    saveToStorage(prompts);
    saveCategoriesToStorage(categories);
    set({ prompts, categories });

    const api = getAccomplishSafe();
    if (api && typeof api.renameSavedPromptCategory === 'function') {
      void api.renameSavedPromptCategory({ from, to }).then((result) => {
        const remotePrompts = sortPrompts(Array.isArray(result.prompts)
          ? result.prompts.map(normalizePrompt).filter((item): item is SavedPrompt => Boolean(item))
          : get().prompts);
        const remoteCategories = mergePromptCategories(result.categories, remotePrompts.map((prompt) => prompt.category));
        saveToStorage(remotePrompts);
        saveCategoriesToStorage(remoteCategories);
        set({ prompts: remotePrompts, categories: remoteCategories });
      }).catch((error) => {
        console.warn('Failed to rename saved prompt category in shared store:', error);
      });
    }
  },

  deleteCategory: (name: string, replacement: string = DEFAULT_PROMPT_CATEGORY) => {
    const categoryKey = normalizePromptCategory(name).toLowerCase();
    const replacementCategory = normalizePromptCategory(replacement);
    const prompts = sortPrompts(get().prompts.map((prompt) => (
      prompt.category.toLowerCase() === categoryKey
        ? { ...prompt, category: replacementCategory, updatedAt: new Date().toISOString() }
        : prompt
    )));
    const categories = mergePromptCategories(
      get().categories.filter((category) => category.toLowerCase() !== categoryKey),
      prompts.map((prompt) => prompt.category)
    );
    saveToStorage(prompts);
    saveCategoriesToStorage(categories);
    set({ prompts, categories });

    const api = getAccomplishSafe();
    if (api && typeof api.deleteSavedPromptCategory === 'function') {
      void api.deleteSavedPromptCategory({ name, replacement }).then((result) => {
        const remotePrompts = sortPrompts(Array.isArray(result.prompts)
          ? result.prompts.map(normalizePrompt).filter((item): item is SavedPrompt => Boolean(item))
          : get().prompts);
        const remoteCategories = mergePromptCategories(result.categories, remotePrompts.map((prompt) => prompt.category));
        saveToStorage(remotePrompts);
        saveCategoriesToStorage(remoteCategories);
        set({ prompts: remotePrompts, categories: remoteCategories });
      }).catch((error) => {
        console.warn('Failed to delete saved prompt category in shared store:', error);
      });
    }
  },
}));
