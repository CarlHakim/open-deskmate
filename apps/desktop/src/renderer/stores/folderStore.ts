import { create } from 'zustand';
import type { Folder, FolderConfig, FolderUpdateConfig } from '@accomplish/shared';

const FOLDERS_STORAGE_KEY = 'open-deskmate-folders';

interface FolderState {
  // Folders list
  folders: Folder[];

  // Actions
  loadFolders: () => void;
  createFolder: (config: FolderConfig) => Folder;
  updateFolder: (folderId: string, config: FolderUpdateConfig) => void;
  deleteFolder: (folderId: string) => void;
  toggleFolderExpanded: (folderId: string) => void;
  expandFolder: (folderId: string) => void;
  reorderFolders: (folderIds: string[]) => void;
  getFolderById: (folderId: string) => Folder | undefined;
}

function generateFolderId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function saveFoldersToStorage(folders: Folder[]): void {
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  } catch (err) {
    console.error('Failed to save folders to localStorage:', err);
  }
}

function loadFoldersFromStorage(): Folder[] {
  try {
    const stored = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as Folder[];
    }
  } catch (err) {
    console.error('Failed to load folders from localStorage:', err);
  }
  return [];
}

export const useFolderStore = create<FolderState>((set, get) => ({
  folders: [],

  loadFolders: () => {
    const folders = loadFoldersFromStorage();
    set({ folders });
  },

  createFolder: (config: FolderConfig) => {
    const { folders } = get();
    const now = new Date().toISOString();

    const newFolder: Folder = {
      id: generateFolderId(),
      name: config.name,
      icon: config.icon,
      color: config.color,
      isExpanded: true,
      order: folders.length,
      createdAt: now,
      updatedAt: now,
    };

    const updatedFolders = [...folders, newFolder];
    saveFoldersToStorage(updatedFolders);
    set({ folders: updatedFolders });

    return newFolder;
  },

  updateFolder: (folderId: string, config: FolderUpdateConfig) => {
    const { folders } = get();
    const now = new Date().toISOString();

    const updatedFolders = folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, ...config, updatedAt: now }
        : folder
    );

    saveFoldersToStorage(updatedFolders);
    set({ folders: updatedFolders });
  },

  deleteFolder: (folderId: string) => {
    const { folders } = get();
    const updatedFolders = folders.filter((f) => f.id !== folderId);

    // Re-order remaining folders
    const reorderedFolders = updatedFolders.map((folder, index) => ({
      ...folder,
      order: index,
    }));

    saveFoldersToStorage(reorderedFolders);
    set({ folders: reorderedFolders });
  },

  toggleFolderExpanded: (folderId: string) => {
    const { folders } = get();
    const now = new Date().toISOString();

    const updatedFolders = folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, isExpanded: !folder.isExpanded, updatedAt: now }
        : folder
    );

    saveFoldersToStorage(updatedFolders);
    set({ folders: updatedFolders });
  },

  expandFolder: (folderId: string) => {
    const { folders } = get();
    const now = new Date().toISOString();

    const updatedFolders = folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, isExpanded: true, updatedAt: now }
        : folder
    );

    saveFoldersToStorage(updatedFolders);
    set({ folders: updatedFolders });
  },

  reorderFolders: (folderIds: string[]) => {
    const { folders } = get();
    const now = new Date().toISOString();

    // Create a map for quick lookup
    const folderMap = new Map(folders.map((f) => [f.id, f]));

    // Reorder based on the provided order
    const reorderedFolders = folderIds
      .map((id, index) => {
        const folder = folderMap.get(id);
        return folder ? { ...folder, order: index, updatedAt: now } : null;
      })
      .filter((f): f is Folder => f !== null);

    // Add any folders not in the list at the end
    const remainingFolders = folders
      .filter((f) => !folderIds.includes(f.id))
      .map((f, index) => ({
        ...f,
        order: reorderedFolders.length + index,
        updatedAt: now,
      }));

    const allFolders = [...reorderedFolders, ...remainingFolders];
    saveFoldersToStorage(allFolders);
    set({ folders: allFolders });
  },

  getFolderById: (folderId: string) => {
    const { folders } = get();
    return folders.find((f) => f.id === folderId);
  },
}));

// Load folders on module initialization
if (typeof window !== 'undefined') {
  // Defer loading to next tick to ensure localStorage is available
  setTimeout(() => {
    useFolderStore.getState().loadFolders();
  }, 0);
}
