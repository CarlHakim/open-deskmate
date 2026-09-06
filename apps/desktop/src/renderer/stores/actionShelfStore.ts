import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_PIN_LIMIT = 10;
export const MAX_PIN_LIMIT = 50;
export function normalizePinLimit(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= MAX_PIN_LIMIT ? value : DEFAULT_PIN_LIMIT;
}

export const useActionShelfStore = create<{
  pins: Record<string, string[]>;
  limits: Record<string, number>;
  setPinLimit: (scope: string, limit: number) => void;
  setPins: (scope: string, ids: string[]) => void;
}>()(persist((set) => ({
  pins: {},
  limits: {},
  // Lowering a limit preserves existing pins; additions wait until there is room.
  setPinLimit: (scope, limit) => set(state => ({ limits: { ...state.limits, [scope]: normalizePinLimit(limit) } })),
  setPins: (scope, ids) => set(state => ({ pins: { ...state.pins, [scope]: [...new Set(ids)].slice(0, Math.max(normalizePinLimit(state.limits[scope]), state.pins[scope]?.length ?? 3)) } })),
}), { name: 'deskmate-action-shelf-v1' }));
