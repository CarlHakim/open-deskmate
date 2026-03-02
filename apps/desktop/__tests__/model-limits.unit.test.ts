import { describe, expect, it } from 'vitest';
import { setModelContextLimitOverride } from '@main/store/modelLimits';
import { getModelEntry } from '@main/services/context/model-registry';

describe('model limits overrides', () => {
  it('applies a context window override in getModelEntry', () => {
    const fullId = 'openai/gpt-5-codex';
    setModelContextLimitOverride(fullId, 1_000_000);

    const entry = getModelEntry({ provider: 'openai', model: fullId });
    expect(entry).not.toBeNull();
    expect(entry?.contextLimitTokens).toBe(1_000_000);

    // cleanup
    setModelContextLimitOverride(fullId, null);
  });
});

