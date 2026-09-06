import { create } from 'zustand';

// A temporary view, deliberately separate from saved panel sizes and visibility.
export const useFocusSceneStore = create<{
  active: boolean;
  toggle: () => void;
  exit: () => void;
}>(set => ({
  active: false,
  toggle: () => set(state => ({ active: !state.active })),
  exit: () => set({ active: false }),
}));
