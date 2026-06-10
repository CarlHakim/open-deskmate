import type { OpenCodeMessage } from '@accomplish/shared';

type UnknownRecord = Record<string, unknown>;

const REASONING_FIELD_NAMES = [
  'reasoning',
  'reasoningText',
  'reasoning_text',
  'reasoningContent',
  'reasoning_content',
  'thinking',
  'thinkingText',
  'thinking_text',
  'thinkingContent',
  'thinking_content',
  'thought',
  'thoughts',
  'chainOfThought',
  'chain_of_thought',
];

const REASONING_EVENT_TYPES = new Set([
  'reasoning',
  'reasoning_delta',
  'reasoning-delta',
  'thinking',
  'thinking_delta',
  'thinking-delta',
  'thought',
  'thought_delta',
  'thought-delta',
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringFromUnknown(entry))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  const record = asRecord(value);
  if (!record) return '';

  for (const key of ['text', 'content', 'summary', 'value']) {
    const nested = stringFromUnknown(record[key]);
    if (nested) return nested;
  }

  return '';
}

function extractReasoningFromRecord(record: UnknownRecord | null): string {
  if (!record) return '';

  const directParts: string[] = [];
  for (const fieldName of REASONING_FIELD_NAMES) {
    const direct = stringFromUnknown(record[fieldName]);
    if (direct) {
      directParts.push(direct);
    }
  }

  const delta = asRecord(record.delta);
  if (delta) {
    for (const fieldName of REASONING_FIELD_NAMES) {
      const direct = stringFromUnknown(delta[fieldName]);
      if (direct) {
        directParts.push(direct);
      }
    }
  }

  return Array.from(new Set(directParts)).join('\n\n').trim();
}

function isReasoningEventType(value: unknown): boolean {
  return typeof value === 'string' && REASONING_EVENT_TYPES.has(value.trim().toLowerCase());
}

function messageLooksReasoningOnly(message: OpenCodeMessage): boolean {
  const record = message as unknown as UnknownRecord;
  const part = asRecord(record.part);
  return isReasoningEventType(record.type) || isReasoningEventType(part?.type);
}

function escapeReasoningTagText(value: string): string {
  return value.replace(/<\/reasoning>/gi, '<\\/reasoning>');
}

function hasReasoningTag(value: string): boolean {
  return /<(think|thinking|reasoning)>/i.test(value);
}

export function buildAssistantContentWithReasoning(
  message: OpenCodeMessage,
  answerText?: string | null
): string {
  const record = message as unknown as UnknownRecord;
  const part = asRecord(record.part);
  const reasoningOnly = messageLooksReasoningOnly(message);
  const fallbackText = stringFromUnknown(part?.text ?? part?.content ?? record.text ?? record.content);
  const metadataReasoning = [
    extractReasoningFromRecord(record),
    extractReasoningFromRecord(part),
  ].filter(Boolean).join('\n\n').trim();

  const rawAnswer = reasoningOnly ? '' : String(answerText ?? fallbackText ?? '').trim();
  const rawReasoning = metadataReasoning || (reasoningOnly ? String(answerText ?? fallbackText ?? '').trim() : '');

  if (!rawReasoning || hasReasoningTag(rawAnswer)) {
    return rawAnswer;
  }

  const reasoningBlock = `<reasoning>\n${escapeReasoningTagText(rawReasoning)}\n</reasoning>`;
  return rawAnswer ? `${reasoningBlock}\n\n${rawAnswer}` : reasoningBlock;
}
