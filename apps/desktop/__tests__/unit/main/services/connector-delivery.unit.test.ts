import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>;

    constructor(options?: { defaults?: T }) {
      this.data = { ...(options?.defaults || {}) };
    }

    get(key: string) {
      return this.data[key];
    }

    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  }

  return { default: MockStore };
});

import {
  createConnectorDelivery,
  filterConnectorDeliveryText,
  formatTelegramConnectorMarkdown,
  prepareConnectorDeliveryAttachments,
  resetConnectorDeliveryRuntimeStateForTests,
  sendConnectorDeliveryChunks,
  splitConnectorMessage,
  updateConnectorDeliveryMetadata,
} from '@main/services/connector-delivery';
import {
  clearConnectorDeliveries,
  listConnectorDeliveries,
  summarizeConnectorDeliveryHealth,
} from '@main/store/connectorDeliveries';

describe('connector delivery reliability', () => {
  beforeEach(() => {
    clearConnectorDeliveries();
    resetConnectorDeliveryRuntimeStateForTests();
  });

  it('strips thinking blocks before external delivery', () => {
    const filtered = filterConnectorDeliveryText('<think>private chain of thought</think>\n\nPublic reply');

    expect(filtered.silenced).toBe(false);
    expect(filtered.internalFiltered).toBe(true);
    expect(filtered.text).toBe('Public reply');
  });

  it('silences internal learning updates', () => {
    const filtered = filterConnectorDeliveryText('Memory update: saved a durable note for later.');

    expect(filtered.silenced).toBe(true);
    expect(filtered.internalFiltered).toBe(true);
    expect(filtered.reason).toBe('internal-status');
  });

  it('strips leading internal status while preserving public text', () => {
    const filtered = filterConnectorDeliveryText('Thinking: checking private state.\n\nPublic reply.');

    expect(filtered.silenced).toBe(false);
    expect(filtered.internalFiltered).toBe(true);
    expect(filtered.text).toBe('Public reply.');
  });

  it('strips inline image data from text deliveries', () => {
    const filtered = filterConnectorDeliveryText('Result: data:image/png;base64,AAAA done');

    expect(filtered.silenced).toBe(false);
    expect(filtered.internalFiltered).toBe(true);
    expect(filtered.text).toContain('[image data omitted]');
    expect(filtered.text).not.toContain('data:image');
  });

  it('splits long messages within connector limits', () => {
    const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const chunks = splitConnectorMessage(text, 200);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks.join(' ')).toContain('word0 word1 word2');
  });

  it('formats common Markdown as Telegram MarkdownV2', () => {
    const formatted = formatTelegramConnectorMarkdown(
      '# Status\n\n**Done** _now_ [docs](https://example.com/a?x=1). `file_name.ts`',
      { maxLength: 1000 }
    );

    expect(formatted.formattingMode).toBe('telegram-markdown-v2');
    expect(formatted.parseMode).toBe('MarkdownV2');
    expect(formatted.text).toBe(
      '*Status*\n\n*Done* _now_ [docs](https://example.com/a?x=1)\\. `file_name.ts`'
    );
  });

  it('falls back to plain Telegram text when MarkdownV2 would exceed the chunk limit', () => {
    const text = `**${'a'.repeat(20)}**`;
    const formatted = formatTelegramConnectorMarkdown(text, { maxLength: 5 });

    expect(formatted.formattingMode).toBe('telegram-markdown-v2-fallback');
    expect(formatted.parseMode).toBe('none');
    expect(formatted.text).toBe(text);
    expect(formatted.fallbackReason).toBe('telegram-markdownv2-too-long');
  });

  it('records chunk delivery status and retry metadata', async () => {
    const delivery = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: 'default',
      targetId: '123',
      targetKind: 'dm',
      text: `${'a'.repeat(180)} ${'b'.repeat(180)}`,
      splitLimit: 200,
      maxRetries: 0,
    });

    await sendConnectorDeliveryChunks(delivery.record.id, delivery.chunks, async () => undefined, { maxRetries: 0 });

    const [record] = listConnectorDeliveries();
    expect(record.id).toBe(delivery.record.id);
    expect(record.status).toBe('sent');
    expect(record.chunkCount).toBe(2);
    expect(record.metadata?.chunkCount).toBe('2');
    expect(record.chunks.map((chunk) => chunk.status)).toEqual(['sent', 'sent']);
    expect(record.retryCount).toBe(0);
    expect(record.maxRetries).toBe(0);
  });

  it('merges connector delivery metadata without dropping existing keys', () => {
    const delivery = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: 'default',
      targetId: '123',
      targetKind: 'dm',
      text: 'Metadata me',
      splitLimit: 200,
      metadata: {
        runtimeKey: 'telegram::default',
      },
    });

    updateConnectorDeliveryMetadata(delivery.record.id, {
      formattingMode: 'telegram-markdown-v2',
      parseMode: 'MarkdownV2',
      mediaOutcome: 'none',
    });

    const [record] = listConnectorDeliveries();
    expect(record.metadata).toMatchObject({
      runtimeKey: 'telegram::default',
      chunkCount: '1',
      formattingMode: 'telegram-markdown-v2',
      parseMode: 'MarkdownV2',
      mediaOutcome: 'none',
    });
  });

  it('retries retryable chunk failures with status metadata', async () => {
    const delivery = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: 'default',
      targetId: '123',
      targetKind: 'dm',
      threadId: 'thread-a',
      text: 'Retry me',
      splitLimit: 200,
      maxRetries: 1,
    });
    let attempts = 0;

    await sendConnectorDeliveryChunks(delivery.record.id, delivery.chunks, async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('503 temporary outage');
      }
    }, { maxRetries: 1, retryBaseDelayMs: 0 });

    const [record] = listConnectorDeliveries();
    expect(record.status).toBe('sent');
    expect(record.retryCount).toBe(1);
    expect(record.attempts.map((attempt) => attempt.status)).toEqual(['retrying', 'sent']);
  });

  it('serializes sends for the same connector thread', async () => {
    const first = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: 'default',
      targetId: '123',
      targetKind: 'dm',
      threadId: 'thread-a',
      text: 'First',
      splitLimit: 200,
    });
    const second = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: 'default',
      targetId: '123',
      targetKind: 'dm',
      threadId: 'thread-a',
      text: 'Second',
      splitLimit: 200,
    });
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstSend = sendConnectorDeliveryChunks(first.record.id, first.chunks, async () => {
      order.push('first-start');
      await firstBlocked;
      order.push('first-end');
    }, { retryBaseDelayMs: 0 });
    await Promise.resolve();

    const secondSend = sendConnectorDeliveryChunks(second.record.id, second.chunks, async () => {
      order.push('second');
    }, { retryBaseDelayMs: 0 });
    await Promise.resolve();
    await Promise.resolve();

    const queuedSecond = listConnectorDeliveries().find((record) => record.id === second.record.id);
    expect(queuedSecond?.status).toBe('queued');
    expect(order).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([firstSend, secondSend]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('records permanent failure reason and degraded health', async () => {
    const delivery = createConnectorDelivery({
      connectorId: 'telegram',
      connectorInstanceId: 'default',
      targetId: '123',
      targetKind: 'dm',
      text: 'Fail me',
      splitLimit: 200,
      maxRetries: 0,
    });

    await expect(sendConnectorDeliveryChunks(delivery.record.id, delivery.chunks, async () => {
      throw new Error('permission denied');
    }, { maxRetries: 0, retryBaseDelayMs: 0 })).rejects.toThrow('permission denied');

    const [record] = listConnectorDeliveries();
    expect(record.status).toBe('failed');
    expect(record.failureReason).toBe('permission denied');

    const health = summarizeConnectorDeliveryHealth({ connectorId: 'telegram', connectorInstanceId: 'default' });
    expect(health.status).toBe('degraded');
    expect(health.failedCount).toBe(1);
    expect(health.lastFailureReason).toBe('permission denied');
  });

  it('prevents old image resend unless explicitly referenced', () => {
    const skipped = prepareConnectorDeliveryAttachments([
      {
        kind: 'image',
        dataUrl: 'data:image/png;base64,AAAA',
        historical: true,
      },
    ], {
      text: 'Here is the update.',
      connectorId: 'telegram',
      targetId: '123',
      targetKind: 'dm',
      threadId: 'thread-a',
    });

    expect(skipped[0]?.status).toBe('skipped');
    expect(skipped[0]?.error).toBe('historical-image-not-referenced');

    const allowed = prepareConnectorDeliveryAttachments([
      {
        kind: 'image',
        dataUrl: 'data:image/png;base64,AAAA',
        historical: true,
      },
    ], {
      text: 'Please resend that previous image.',
      connectorId: 'telegram',
      targetId: '123',
      targetKind: 'dm',
      threadId: 'thread-a',
    });

    expect(allowed[0]?.status).toBe('pending');
    expect(allowed[0]?.explicitReference).toBe(true);
  });

  it('falls back attachments into text for connectors without native uploads', () => {
    const delivery = createConnectorDelivery({
      connectorId: 'slack',
      connectorInstanceId: 'default',
      targetId: 'C123',
      targetKind: 'channel',
      text: 'See attached.',
      splitLimit: 4000,
      attachmentMode: 'fallback',
      attachments: [
        {
          kind: 'file',
          url: 'https://example.test/report.pdf',
          name: 'report.pdf',
        },
      ],
    });

    expect(delivery.attachments[0]?.status).toBe('fallback');
    expect(delivery.chunks.join('\n')).toContain('File "report.pdf": https://example.test/report.pdf');
  });
});
