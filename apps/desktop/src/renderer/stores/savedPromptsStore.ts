import { create } from 'zustand';
import { getAccomplish } from '../lib/accomplish';

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedPromptsState {
  prompts: SavedPrompt[];
  loadPrompts: () => void;
  savePrompt: (title: string, content: string) => SavedPrompt;
  updatePrompt: (id: string, title: string, content: string) => void;
  deletePrompt: (id: string) => void;
}

const STORAGE_KEY = 'open-deskmate-saved-prompts';
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

function normalizePrompt(input: unknown): SavedPrompt | null {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
  if (!record) return null;
  const id = String(record.id ?? '').trim();
  const title = String(record.title ?? '').trim();
  const content = String(record.content ?? '').trim();
  const createdAt = String(record.createdAt ?? '').trim();
  const updatedAt = String(record.updatedAt ?? '').trim();
  if (!id || !title || !content) return null;
  const nowIso = new Date().toISOString();
  return {
    id,
    title,
    content,
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

  loadPrompts: () => {
    const currentLoadId = ++loadRequestCounter;
    const localPrompts = sortPrompts(loadFromStorage());
    set({ prompts: localPrompts });

    const api = getAccomplishSafe();
    if (!api || typeof api.listSavedPrompts !== 'function') {
      return;
    }

    void (async () => {
      try {
        const remoteRaw = await api.listSavedPrompts();
        const remotePrompts = sortPrompts(Array.isArray(remoteRaw)
          ? remoteRaw.map(normalizePrompt).filter((item): item is SavedPrompt => Boolean(item))
          : []);

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
        saveToStorage(nextPrompts);
        set({ prompts: nextPrompts });
      } catch (error) {
        console.warn('Failed to sync saved prompts with shared store:', error);
      }
    })();
  },

  savePrompt: (title: string, content: string) => {
    const newPrompt: SavedPrompt = {
      id: generateId(),
      title: title.trim(),
      content: content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prompts = sortPrompts([...get().prompts, newPrompt]);
    saveToStorage(prompts);
    set({ prompts });

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

  updatePrompt: (id: string, title: string, content: string) => {
    const prompts = sortPrompts(get().prompts.map((p) =>
      p.id === id
        ? { ...p, title: title.trim(), content: content.trim(), updatedAt: new Date().toISOString() }
        : p
    ));
    saveToStorage(prompts);
    set({ prompts });

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
}));
