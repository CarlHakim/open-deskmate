import type { RuntimeHookDiagnosticEntry } from '@accomplish/shared';

const MAX_HOOK_DIAGNOSTICS = 200;
const hookDiagnostics: RuntimeHookDiagnosticEntry[] = [];

export function recordHookDiagnostic(entry: RuntimeHookDiagnosticEntry): void {
  hookDiagnostics.unshift(entry);
  if (hookDiagnostics.length > MAX_HOOK_DIAGNOSTICS) {
    hookDiagnostics.length = MAX_HOOK_DIAGNOSTICS;
  }
}

export function listHookDiagnostics(): RuntimeHookDiagnosticEntry[] {
  return [...hookDiagnostics];
}

export function clearHookDiagnostics(): void {
  hookDiagnostics.length = 0;
}
