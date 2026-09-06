// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StreamingText } from '../../../../src/renderer/components/ui/streaming-text';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('reveals a received long answer within 250ms and continues with appended text', () => {
  let nextFrame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { nextFrame = undefined; });
  const complete = vi.fn();
  const answer = 'A'.repeat(6000);
  const view = (text: string) => <StreamingText text={text} speed={120} onComplete={complete}>{value => <p data-testid="answer">{value}</p>}</StreamingText>;
  const { rerender } = render(view(answer));
  const frame = (time: number) => act(() => { const callback = nextFrame; nextFrame = undefined; callback?.(time); });
  frame(0);
  frame(125);
  expect(screen.getByTestId('answer').textContent!.length).toBeGreaterThan(0);
  expect(screen.getByTestId('answer').textContent!.length).toBeLessThan(answer.length);
  frame(250);
  expect(screen.getByTestId('answer')).toHaveTextContent(answer);
  expect(complete).toHaveBeenCalledOnce();
  rerender(view(answer + ' More text'));
  frame(300);
  frame(550);
  expect(screen.getByTestId('answer')).toHaveTextContent(answer + ' More text');
  expect(complete).toHaveBeenCalledTimes(2);
});
