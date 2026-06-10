import { describe, expect, test } from 'vitest';
import type { OpenCodeMessage } from '@accomplish/shared';
import { buildAssistantContentWithReasoning } from '../../../../src/main/runtime/task-message-reasoning';

function textMessage(part: Record<string, unknown>): OpenCodeMessage {
  return {
    type: 'text',
    timestamp: 1,
    part: {
      id: 'part-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'text',
      text: 'Final answer.',
      ...part,
    },
  } as OpenCodeMessage;
}

describe('task message reasoning normalization', () => {
  test('wraps reasoning metadata before the final answer', () => {
    const content = buildAssistantContentWithReasoning(
      textMessage({ reasoning_content: 'I checked the files.' }),
      'Final answer.'
    );

    expect(content).toBe('<reasoning>\nI checked the files.\n</reasoning>\n\nFinal answer.');
  });

  test('supports camelCase reasoning metadata', () => {
    const content = buildAssistantContentWithReasoning(
      textMessage({ reasoningContent: 'Provider reasoning.' }),
      'Done.'
    );

    expect(content).toContain('<reasoning>\nProvider reasoning.\n</reasoning>');
    expect(content).toContain('Done.');
  });

  test('treats reasoning-only events as reasoning bubbles', () => {
    const content = buildAssistantContentWithReasoning({
      type: 'reasoning',
      timestamp: 1,
      part: {
        id: 'part-1',
        sessionID: 'session-1',
        messageID: 'message-1',
        type: 'reasoning',
        text: 'Intermediate thought.',
      },
    } as OpenCodeMessage);

    expect(content).toBe('<reasoning>\nIntermediate thought.\n</reasoning>');
  });

  test('does not double wrap content that already has reasoning tags', () => {
    const existing = '<thinking>\nAlready tagged.\n</thinking>\n\nAnswer.';
    const content = buildAssistantContentWithReasoning(
      textMessage({ reasoning: 'Duplicate metadata.' }),
      existing
    );

    expect(content).toBe(existing);
  });
});
