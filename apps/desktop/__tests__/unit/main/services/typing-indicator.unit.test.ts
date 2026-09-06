import { afterEach, expect, it, vi } from 'vitest';
import { startTypingIndicator } from '../../../../src/main/services/typing-indicator';

afterEach(() => vi.useRealTimers());

it('returns immediately while presence is pending, skips overlapping calls, and stops', async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const send = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const stop = startTypingIndicator(send);
  expect(send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(12000);
  expect(send).toHaveBeenCalledOnce();
  resolve();
  await vi.advanceTimersByTimeAsync(4000);
  expect(send).toHaveBeenCalledTimes(2);
  stop();
  resolve();
  await vi.advanceTimersByTimeAsync(12000);
  expect(send).toHaveBeenCalledTimes(2);
});

it('contains presence failures and allows later attempts', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockRejectedValue(new Error('Network unavailable'));
  const stop = startTypingIndicator(send);
  await vi.advanceTimersByTimeAsync(4000);
  expect(send).toHaveBeenCalledTimes(2);
  stop();
});
