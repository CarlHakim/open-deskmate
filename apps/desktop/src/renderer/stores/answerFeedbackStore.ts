import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type FeedbackState = {
  useful: Record<string, true>;
  sessionUseful: Record<string, true>;
  toggle: (key: string, incognito: boolean) => void;
};

// Store identifiers only. Incognito marks never leave this app session.
export const useAnswerFeedbackStore = create<FeedbackState>()(persist(set => ({
  useful: {}, sessionUseful: {},
  toggle: (key, incognito) => set(state => {
    const field = incognito ? 'sessionUseful' : 'useful';
    const values = { ...state[field] };
    if (values[key]) delete values[key]; else values[key] = true;
    for (const old of Object.keys(values).slice(0, -10000)) delete values[old];
    return { [field]: values };
  }),
}), { name: 'deskmate-answer-feedback-v1', partialize: state => ({ useful: state.useful }) }));
