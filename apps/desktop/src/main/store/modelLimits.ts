import Store from 'electron-store';
import os from 'os';
import path from 'path';

export type ModelLimitOverride = {
  contextWindowTokens?: number;
};

type ModelLimitsSchema = {
  overrides: Record<string, ModelLimitOverride>;
};

const modelLimitsStore = new Store<ModelLimitsSchema>({
  name: 'model-limits',
  cwd: (process.env.NODE_ENV === 'test' || process.env.VITEST)
    ? path.join(os.tmpdir(), 'open-deskmate-test-store')
    : undefined,
  defaults: { overrides: {} },
});

export function getModelLimitOverrides(): Record<string, ModelLimitOverride> {
  return modelLimitsStore.get('overrides') ?? {};
}

export function getModelContextLimitOverride(fullId: string): number | null {
  const overrides = getModelLimitOverrides();
  const entry = overrides[fullId];
  const value = entry?.contextWindowTokens;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function setModelContextLimitOverride(fullId: string, contextWindowTokens: number | null): ModelLimitOverride | null {
  const overrides = { ...getModelLimitOverrides() };
  if (contextWindowTokens == null) {
    if (overrides[fullId]) {
      delete overrides[fullId];
      modelLimitsStore.set('overrides', overrides);
    }
    return null;
  }
  overrides[fullId] = { ...(overrides[fullId] ?? {}), contextWindowTokens };
  modelLimitsStore.set('overrides', overrides);
  return overrides[fullId];
}
