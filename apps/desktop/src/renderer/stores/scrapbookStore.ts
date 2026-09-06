import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Card identifiers only; project content remains in the shared Workboard store.
export const useScrapbookStore = create<{
  favorites: Record<string, true>; toggleFavorite: (id: string) => void;
}>()(persist(set => ({
  favorites: {},
  toggleFavorite: id => set(state => {
    const favorites = { ...state.favorites };
    if (favorites[id]) delete favorites[id]; else favorites[id] = true;
    for (const oldest of Object.keys(favorites).slice(0, -10000)) delete favorites[oldest];
    return { favorites };
  }),
}), { name: 'deskmate-scrapbook-v1' }));
