import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/store/agents', () => ({
  listAgents: () => [],
}));

vi.mock('@main/store/taskHistory', () => ({
  getTasks: () => [],
}));

vi.mock('@main/store/buildTaskHistory', () => ({
  getBuildTaskSession: () => null,
  listBuildTaskSessions: () => ({ sessions: [] }),
}));

vi.mock('@main/store/connectorDeliveries', () => ({
  listConnectorDeliveries: () => [],
}));

vi.mock('@main/store/usageProjects', () => ({
  listUsageProjects: () => [],
  listUsageProjectWorkItems: () => [],
}));

vi.mock('@main/services/build-mode/git-service', () => ({
  readBuildGitSummary: vi.fn(),
}));

vi.mock('@main/services/memory', () => ({
  getMemoryState: () => ({ entries: [] }),
  listMemoryChangeHistory: () => [],
  readMemoryFile: () => ({ content: '' }),
}));

vi.mock('@main/services/user-skills', () => ({
  listUserSkills: () => ({ skills: [] }),
}));

vi.mock('@main/services/audit', () => ({
  listAuditEvents: () => ({ events: [], total: 0 }),
  recordSystemAuditEvent: vi.fn(),
}));

import { __localSearchTest } from '@main/services/local-search';

describe('local search indexing helpers', () => {
  it('scores title and content matches above unrelated entries', () => {
    const entries = [
      __localSearchTest.createEntry({
        source: 'chat_task',
        title: 'Fix OAuth redirect',
        content: 'The callback URL fails after login in the desktop app.',
        updatedAt: '2026-01-02T00:00:00.000Z',
        ref: { source: 'chat_task', id: 'task-1' },
      }),
      __localSearchTest.createEntry({
        source: 'memory_file',
        title: 'Release notes',
        content: 'Packaging checklist and installer reminders.',
        updatedAt: '2026-01-03T00:00:00.000Z',
        ref: { source: 'memory_file', id: 'memory-1' },
      }),
    ];

    const results = __localSearchTest.queryEntries(entries, { query: 'oauth callback' });

    expect(results[0].title).toBe('Fix OAuth redirect');
    expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);
    expect(results[0].excerpt.toLowerCase()).toContain('callback');
  });

  it('creates useful excerpts around matching text', () => {
    const excerpt = __localSearchTest.makeExcerpt(
      'One two three. This section explains project workboard audit history and local search indexing.',
      'audit history'
    );

    expect(excerpt).toContain('audit history');
    expect(excerpt.length).toBeLessThan(260);
  });

  it('filters results by project metadata and preserves jump targets', () => {
    const entries = [
      __localSearchTest.createEntry({
        source: 'workboard_note',
        title: 'Launch checklist note',
        content: 'Coordinate launch documents and handoff notes.',
        updatedAt: '2026-01-02T00:00:00.000Z',
        ref: {
          source: 'workboard_note',
          id: 'note-1',
          projectId: 'project-1',
          workItemId: 'item-1',
          noteId: 'note-1',
          jump: {
            kind: 'project_management',
            projectId: 'project-1',
            workItemId: 'item-1',
            noteId: 'note-1',
          },
        },
      }),
      __localSearchTest.createEntry({
        source: 'workboard_note',
        title: 'Billing note',
        content: 'Invoice follow-up and budget status.',
        updatedAt: '2026-01-03T00:00:00.000Z',
        ref: {
          source: 'workboard_note',
          id: 'note-2',
          projectId: 'project-2',
          workItemId: 'item-2',
          noteId: 'note-2',
        },
      }),
    ];

    const results = __localSearchTest.queryEntries(entries, {
      query: 'note',
      projectId: 'project-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].ref.projectId).toBe('project-1');
    expect(results[0].ref.jump?.kind).toBe('project_management');
  });
});
