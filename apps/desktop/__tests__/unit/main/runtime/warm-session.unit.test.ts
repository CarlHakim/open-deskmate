import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@accomplish/shared';
import { findReusableWarmSession } from '../../../../src/main/runtime/warm-session';
import { getMiniMaxHistoricalImageSessionResetReason } from '../../../../src/main/services/context/image-history-policy';

vi.mock('../../../../src/main/services/agent-context', () => ({
  resolveSelectedModelForAgent: vi.fn(() => ({ provider: 'anthropic', model: 'test' })),
}));
vi.mock('../../../../src/main/services/context/image-history-policy', () => ({
  getMiniMaxHistoricalImageSessionResetReason: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('shared warm session policy', () => {
  const previous = (patch: Partial<Task> = {}): Task => ({
    id: 'previous', prompt: 'Earlier request', status: 'completed', messages: [],
    sessionId: 'session', createdAt: new Date().toISOString(), ...patch,
  });
  const find = (task: Task) => findReusableWarmSession({
    taskId: 'next', previousTask: task, prompt: 'Follow up', logPrefix: '[Test]',
  });

  it('reuses a recent completed session', () => {
    expect(find(previous())?.sessionId).toBe('session');
  });

  it.each([
    { status: 'running' },
    { id: 'next' },
    { sessionId: undefined },
    { completedAt: new Date(Date.now() - 600_000).toISOString() },
    { completedAt: 'invalid' },
  ] as Partial<Task>[])('rejects ineligible history %j', patch => {
    expect(find(previous(patch))).toBeUndefined();
    expect(getMiniMaxHistoricalImageSessionResetReason).not.toHaveBeenCalled();
  });

  it('respects the historical-image reset policy', () => {
    vi.mocked(getMiniMaxHistoricalImageSessionResetReason).mockReturnValueOnce('historical-image' as ReturnType<typeof getMiniMaxHistoricalImageSessionResetReason>);
    expect(find(previous())).toBeUndefined();
  });
});
