import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';

interface TopBarControlsState {
  actions: ReactNode | null;
  setActions: (actions: ReactNode | null) => void;
}

export const useTopBarControlsStore = create<TopBarControlsState>((set) => ({
  actions: null,
  setActions: (actions) => set({ actions }),
}));

export function useTopBarControls(actions: ReactNode | null) {
  const setActions = useTopBarControlsStore((state) => state.setActions);

  useEffect(() => {
    setActions(actions);
    return () => setActions(null);
  }, [actions, setActions]);
}
