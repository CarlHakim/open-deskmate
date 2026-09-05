import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
}));

vi.mock('electron-store', () => {
  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value ?? {}));
  }

  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>;

    constructor(options?: { name?: string; defaults?: T }) {
      const name = options?.name || 'default';
      if (!testState.stores.has(name)) {
        testState.stores.set(name, clone(options?.defaults || {}) as Record<string, unknown>);
      }
      this.data = testState.stores.get(name)!;
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
  clearAuditEvents,
  getStoredAuditEvent,
  listStoredAuditEvents,
  recordAuditEvent,
} from '@main/store/auditEvents';

describe('audit event store', () => {
  beforeEach(() => {
    clearAuditEvents();
  });

  it('records newest events first and supports lookup by id', () => {
    const first = recordAuditEvent({
      category: 'task',
      action: 'created',
      title: 'Task created',
      timestamp: '2026-01-01T00:00:00.000Z',
      taskId: 'task-1',
    });
    const second = recordAuditEvent({
      category: 'memory',
      action: 'applied',
      title: 'Memory applied',
      timestamp: '2026-01-02T00:00:00.000Z',
      agentId: 'agent-1',
      projectId: 'project-1',
      memoryKind: 'long-term',
      targetType: 'memory_file',
      targetId: 'MEMORY.md',
      jump: {
        kind: 'memory',
        agentId: 'agent-1',
        memoryKind: 'long-term',
        path: 'MEMORY.md',
      },
    });

    const events = listStoredAuditEvents();

    expect(events.map((event) => event.id)).toEqual([second.id, first.id]);
    expect(getStoredAuditEvent(first.id)?.taskId).toBe('task-1');
    expect(getStoredAuditEvent(second.id)?.targetId).toBe('MEMORY.md');
    expect(getStoredAuditEvent(second.id)?.projectId).toBe('project-1');
    expect(getStoredAuditEvent(second.id)?.memoryKind).toBe('long-term');
    expect(getStoredAuditEvent(second.id)?.jump?.kind).toBe('memory');
  });

  it('normalizes missing optional fields', () => {
    const event = recordAuditEvent({
      category: 'search',
      action: '',
      title: '',
    });

    expect(event.action).toBe('event');
    expect(event.title).toBe('Audit event');
    expect(event.status).toBe('info');
    expect(event.source).toBe('audit-store');
  });
});
