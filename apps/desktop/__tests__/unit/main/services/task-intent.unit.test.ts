import { describe, expect, it } from 'vitest';
import { detectTaskNeedsBrowser } from '@main/services/task-intent';

describe('detectTaskNeedsBrowser', () => {
  it('starts browser automation for image gallery searches', () => {
    expect(detectTaskNeedsBrowser({ prompt: 'find me images of Calpe Spain' })).toBe(true);
    expect(detectTaskNeedsBrowser({ prompt: 'show photos for Alcochete town centre' })).toBe(true);
  });

  it('starts browser automation when a selected skill explicitly requires dev-browser', () => {
    expect(detectTaskNeedsBrowser({
      prompt: 'make a gallery for this place',
      systemPromptAppend: [
        '<skills>',
        '## Find Images',
        'Use dev-browser to navigate Wikimedia Commons and collect image URLs.',
        '</skills>',
      ].join('\n'),
    })).toBe(true);
  });

  it('does not start browser automation for ordinary local tasks', () => {
    expect(detectTaskNeedsBrowser({ prompt: 'summarize the attached text file' })).toBe(false);
    expect(detectTaskNeedsBrowser({
      prompt: 'tell me about this project',
      systemPromptAppend: 'Agent identity (runtime):\n- Agent name: Peter',
    })).toBe(false);
  });
});
