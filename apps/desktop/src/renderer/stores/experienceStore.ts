import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ExperienceMode = 'calm' | 'balanced' | 'playful';
type ExperienceState = {
  mode: ExperienceMode;
  celebrations: boolean;
  sound: boolean;
  setMode: (mode: ExperienceMode) => void;
  setCelebrations: (enabled: boolean) => void;
  setSound: (enabled: boolean) => void;
};

// Presentation preferences are local to this desktop profile, shared by both modes.
export const useExperienceStore = create<ExperienceState>()(persist(set => ({
  mode: 'balanced', celebrations: true, sound: false,
  setMode: mode => set({ mode }),
  setCelebrations: celebrations => set({ celebrations }),
  setSound: sound => set({ sound }),
}), {
  name: 'deskmate-experience-v1',
  partialize: ({ mode, celebrations, sound }) => ({ mode, celebrations, sound }),
}));
