import { create } from 'zustand';

interface AttachmentState {
  files: string[];
  addFiles: (files: string[]) => void;
  removeFile: (filePath: string) => void;
  clearFiles: () => void;
}

export const useAttachmentStore = create<AttachmentState>((set) => ({
  files: [],
  addFiles: (files: string[]) => {
    const unique = Array.from(new Set(files.filter((f) => typeof f === 'string' && f.trim().length > 0)));
    set((state) => ({
      files: Array.from(new Set([...state.files, ...unique])),
    }));
  },
  removeFile: (filePath: string) => {
    set((state) => ({
      files: state.files.filter((f) => f !== filePath),
    }));
  },
  clearFiles: () => {
    set({ files: [] });
  },
}));
