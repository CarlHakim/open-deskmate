import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStores = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>;

    constructor(options?: { name?: string; defaults?: T }) {
      const name = options?.name || 'default';
      if (!mockStores.has(name)) {
        mockStores.set(name, { ...(options?.defaults || {}) });
      }
      this.data = mockStores.get(name) as Record<string, unknown>;
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

async function importModules() {
  const usageProjects = await import('@main/store/usageProjects');
  const workboard = await import('@main/services/workboard-agent-tools');
  const audit = await import('@main/services/audit');
  return { usageProjects, workboard, audit };
}

describe('workboard agent tools', () => {
  beforeEach(() => {
    vi.resetModules();
    mockStores.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mutates usage project work items and records contextual audit entries', async () => {
    const { usageProjects, workboard, audit } = await importModules();
    const project = usageProjects.createUsageProject({ name: 'Hermes board', trackingEnabled: true });

    const created = workboard.executeWorkboardAgentTool('create', {
      projectId: project.id,
      title: 'Ship Workboard agent tools',
      description: 'Expose Kanban actions to agents.',
      statusName: 'Ready',
      tags: ['agent-tools'],
      parentTaskId: 'task-123',
      parentAgentId: 'agent-main',
    });
    const itemId = (created.item as { id: string }).id;

    workboard.executeWorkboardAgentTool('comment', {
      itemId,
      title: 'Implementation note',
      text: 'Created through the node-tools bridge.',
      parentTaskId: 'task-123',
      parentAgentId: 'agent-main',
    });
    workboard.executeWorkboardAgentTool('block', {
      itemId,
      reason: 'Waiting on review.',
      parentTaskId: 'task-123',
      parentAgentId: 'agent-main',
    });
    workboard.executeWorkboardAgentTool('unblock', {
      itemId,
      text: 'Review completed.',
      parentTaskId: 'task-123',
      parentAgentId: 'agent-main',
    });
    workboard.executeWorkboardAgentTool('link', {
      itemId,
      url: 'https://example.com/spec',
      title: 'Spec',
      parentTaskId: 'task-123',
      parentAgentId: 'agent-main',
    });
    const completed = workboard.executeWorkboardAgentTool('complete', {
      itemId,
      text: 'Ready to hand off.',
      parentTaskId: 'task-123',
      parentAgentId: 'agent-main',
    });

    const stored = usageProjects.listUsageProjectWorkItems(project.id, { includeArchived: true })[0];
    expect(stored.id).toBe(itemId);
    expect(stored.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored.blocked).toBe(false);
    expect(stored.sources?.[0]).toMatchObject({ title: 'Spec', url: 'https://example.com/spec' });
    expect(stored.notes.map((note) => note.title)).toEqual(expect.arrayContaining([
      'Implementation note',
      'Unblocked',
      'Completed',
    ]));
    expect((completed.item as { completedAt?: string }).completedAt).toBe(stored.completedAt);

    const events = audit.listAuditEvents({ includeDerived: false, limit: 20 }).events;
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining([
      'workboard.create',
      'workboard.comment',
      'workboard.block',
      'workboard.unblock',
      'workboard.link',
      'workboard.complete',
    ]));
    const createEvent = events.find((event) => event.action === 'workboard.create');
    expect(createEvent).toMatchObject({
      agentId: 'agent-main',
      taskId: 'task-123',
      projectId: project.id,
      targetType: 'workboard_item',
      targetId: itemId,
      source: 'workboard-agent-tools',
    });
    expect(events.find((event) => event.action === 'workboard.block')?.status).toBe('warning');
  }, 10_000);

  it('lists and shows boards without mutating item content', async () => {
    const { usageProjects, workboard, audit } = await importModules();
    const project = usageProjects.createUsageProject({ name: 'Read board', trackingEnabled: true });
    const created = workboard.executeWorkboardAgentTool('create', {
      projectId: project.id,
      title: 'Readable item',
      parentTaskId: 'task-read',
      parentAgentId: 'agent-main',
    });
    const itemId = (created.item as { id: string }).id;

    const listed = workboard.executeWorkboardAgentTool('list', {
      projectName: 'Read board',
      query: 'readable',
      parentTaskId: 'task-read',
      parentAgentId: 'agent-main',
    });
    const shown = workboard.executeWorkboardAgentTool('show', {
      itemId,
      parentTaskId: 'task-read',
      parentAgentId: 'agent-main',
    });

    expect(((listed.projects as Array<{ items: unknown[] }>)[0]?.items || [])).toHaveLength(1);
    expect((shown.item as { title?: string }).title).toBe('Readable item');
    expect(audit.listAuditEvents({ includeDerived: false, limit: 10 }).events.map((event) => event.action))
      .toEqual(expect.arrayContaining(['workboard.list', 'workboard.show']));
  });
});
