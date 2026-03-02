import { vi } from 'vitest';

type AnyRecord = Record<string, unknown>;

// Renderer integration tests mock the Electron preload API (window.accomplish).
// As Settings grows, tests shouldn't fail just because a new IPC method was added.
export function createMockAccomplish<T extends AnyRecord>(base: T): T {
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol') return (target as unknown as Record<symbol, unknown>)[prop];
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      // Default: best-effort stub based on naming conventions.
      // - `onXxx(...)` usually returns an unsubscribe function.
      // - everything else is treated as async and can be awaited.
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return vi.fn().mockReturnValue(() => undefined);
      }
      return vi.fn().mockResolvedValue(undefined);
    },
  }) as T;
}
