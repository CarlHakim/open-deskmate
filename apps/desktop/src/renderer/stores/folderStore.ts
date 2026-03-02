import { create } from 'zustand';
import type { Folder, FolderConfig, FolderUpdateConfig } from '@accomplish/shared';

interface FolderState {
  // Folders list
  folders: Folder[];
  // Loading state
  isLoading: boolean;

  // Actions
  loadFolders: () => Promise<void>;
  createFolder: (config: FolderConfig) => Promise<Folder | null>;
  updateFolder: (folderId: string, config: FolderUpdateConfig) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolderExpanded: (folderId: string) => Promise<void>;
  expandFolder: (folderId: string) => Promise<void>;
  reorderFolders: (folderIds: string[]) => Promise<void>;
  getFolderById: (folderId: string) => Folder | undefined;
}

export const useFolderStore = create<FolderState>((set, get) => ({
  folders: [],
  isLoading: false,

  loadFolders: async () => {
    if (!window.accomplish) return;
    set({ isLoading: true });
    try {
      const folders = await window.accomplish.listFolders() as Folder[];
      set({ folders: folders || [] });
    } catch (err) {
      console.error('Failed to load folders:', err);
      set({ folders: [] });
    } finally {
      set({ isLoading: false });
    }
  },

  createFolder: async (config: FolderConfig) => {
    if (!window.accomplish) return null;
    try {
      const newFolder = await window.accomplish.createFolder(config) as Folder;
      if (newFolder) {
        set((state) => ({ folders: [...state.folders, newFolder] }));
        return newFolder;
      }
      return null;
    } catch (err) {
      console.error('Failed to create folder:', err);
      return null;
    }
  },

  updateFolder: async (folderId: string, config: FolderUpdateConfig) => {
    if (!window.accomplish) return;
    try {
      const updatedFolder = await window.accomplish.updateFolder(folderId, config) as Folder;
      if (updatedFolder) {
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === folderId ? updatedFolder : f
          ),
        }));
      }
    } catch (err) {
      console.error('Failed to update folder:', err);
    }
  },

  deleteFolder: async (folderId: string) => {
    if (!window.accomplish) return;
    try {
      await window.accomplish.deleteFolder(folderId);
      set((state) => {
        const updatedFolders = state.folders.filter((f) => f.id !== folderId);
        // Re-order remaining folders
        return {
          folders: updatedFolders.map((folder, index) => ({
            ...folder,
            order: index,
          })),
        };
      });
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  },

  toggleFolderExpanded: async (folderId: string) => {
    const { folders } = get();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    const newExpanded = !folder.isExpanded;
    // Optimistically update UI
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, isExpanded: newExpanded } : f
      ),
    }));

    if (!window.accomplish) return;
    try {
      await window.accomplish.updateFolder(folderId, { isExpanded: newExpanded });
    } catch (err) {
      console.error('Failed to toggle folder expanded:', err);
      // Revert on error
      set((state) => ({
        folders: state.folders.map((f) =>
          f.id === folderId ? { ...f, isExpanded: !newExpanded } : f
        ),
      }));
    }
  },

  expandFolder: async (folderId: string) => {
    // Optimistically update UI
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, isExpanded: true } : f
      ),
    }));

    if (!window.accomplish) return;
    try {
      await window.accomplish.updateFolder(folderId, { isExpanded: true });
    } catch (err) {
      console.error('Failed to expand folder:', err);
    }
  },

  reorderFolders: async (folderIds: string[]) => {
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
    set({ folders: allFolders });

    if (!window.accomplish) return;
    // Update each folder's order via IPC
    try {
      for (const folder of allFolders) {
        await window.accomplish.updateFolder(folder.id, { order: folder.order });
      }
    } catch (err) {
      console.error('Failed to reorder folders:', err);
    }
  },

  getFolderById: (folderId: string) => {
    const { folders } = get();
    return folders.find((f) => f.id === folderId);
  },
}));

// Load folders on module initialization
if (typeof window !== 'undefined' && window.accomplish) {
  // Defer loading to next tick to ensure API is available
  setTimeout(() => {
    useFolderStore.getState().loadFolders();
  }, 0);
}
