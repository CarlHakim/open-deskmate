import { create } from 'zustand';

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

function generateId(): string {
  return `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadFromStorage(): SavedPrompt[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
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

export const useSavedPromptsStore = create<SavedPromptsState>((set, get) => ({
  prompts: [],

  loadPrompts: () => {
    const prompts = loadFromStorage();
    set({ prompts });
  },

  savePrompt: (title: string, content: string) => {
    const newPrompt: SavedPrompt = {
      id: generateId(),
      title: title.trim(),
      content: content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prompts = [...get().prompts, newPrompt];
    saveToStorage(prompts);
    set({ prompts });
    return newPrompt;
  },

  updatePrompt: (id: string, title: string, content: string) => {
    const prompts = get().prompts.map((p) =>
      p.id === id
        ? { ...p, title: title.trim(), content: content.trim(), updatedAt: new Date().toISOString() }
        : p
    );
    saveToStorage(prompts);
    set({ prompts });
  },

  deletePrompt: (id: string) => {
    const prompts = get().prompts.filter((p) => p.id !== id);
    saveToStorage(prompts);
    set({ prompts });
  },
}));
