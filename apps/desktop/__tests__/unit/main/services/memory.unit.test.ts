import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectedModel } from '@accomplish/shared';
import type { StoredTask } from '@main/store/taskHistory';

const testState = vi.hoisted(() => ({
  workspaceRoot: '',
  stores: new Map<string, Record<string, unknown>>(),
  memoryWriteMode: 'automatic' as 'automatic' | 'approval' | 'off',
  selectedModel: { provider: 'openai', model: 'openai/gpt-test' } as SelectedModel | null,
  apiKey: 'test-api-key',
}));

vi.mock('@main/services/agent-context', () => ({
  getAgentContext: () => ({
    agentId: 'main',
    agent: {
      id: 'main',
      name: 'Main',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      memoryWriteMode: testState.memoryWriteMode,
      memoryNotificationsEnabled: true,
    },
    workspaceRoot: testState.workspaceRoot,
  }),
  resolveSelectedModelForAgent: () => testState.selectedModel,
}));

vi.mock('@main/services/summarizer', () => ({
  generateTaskSummary: vi.fn(async () => 'summary'),
}));

vi.mock('@main/store/secureStorage', () => ({
  getApiKey: vi.fn(async () => testState.apiKey),
}));

vi.mock('@main/services/model-providers', () => ({
  getModelProvider: () => ({
    id: 'openai',
    name: 'OpenAI',
    models: [],
    requiresApiKey: true,
  }),
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

    clear() {
      for (const key of Object.keys(this.data)) {
        delete this.data[key];
      }
    }
  }

  return { default: MockStore };
});

import {
  applyStagedMemoryFileWrite,
  buildMemoryPrompt,
  deleteMemoryFile,
  getMemoryState,
  readMemoryFile,
  rollbackMemoryFileChange,
  runAutomaticMemoryLearning,
  saveAutomaticMemoryFileWrite,
  saveMemoryFile,
  saveSessionMemorySnapshot,
  searchMemory,
  stageMemoryFileWrite,
} from '@main/services/memory';
import {
  clearMemoryChangeHistory,
  getMemoryChange,
  getMemoryChangeHistory,
  listMemoryChangeHistory,
} from '@main/store/memoryChangeHistory';
import { __postTaskLearningTest } from '@main/runtime/post-task-learning';

const originalFetch = globalThis.fetch;

function createTask(overrides: Partial<StoredTask> = {}): StoredTask {
  const now = new Date(0).toISOString();
  return {
    id: 'task_memory_1',
    prompt: 'Remember that this workspace uses memory tests.',
    agentId: 'main',
    status: 'completed',
    messages: [
      {
        id: 'msg_user',
        type: 'user',
        content: 'Please remember my durable preference.',
        timestamp: now,
      },
      {
        id: 'msg_assistant',
        type: 'assistant',
        content: 'Done. The project preference is ready for future work.',
        timestamp: now,
      },
    ],
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
}

function mockMemoryModelResponse(payload: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('memory service', () => {
  beforeEach(() => {
    testState.workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeskmate-memory-'));
    testState.memoryWriteMode = 'automatic';
    testState.selectedModel = { provider: 'openai', model: 'openai/gpt-test' };
    testState.apiKey = 'test-api-key';
    clearMemoryChangeHistory();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (testState.workspaceRoot) {
      fs.rmSync(testState.workspaceRoot, { recursive: true, force: true });
    }
  });

  it('supports USER.md alongside long-term and daily memory helpers', () => {
    const userResult = saveMemoryFile('user', 'User prefers concise implementation notes.');
    saveMemoryFile('long-term', 'Project uses Electron.');
    saveMemoryFile('daily', 'Today we touched memory.', '2026-06-22');

    expect(userResult.path).toBe(path.join(testState.workspaceRoot, 'USER.md'));
    expect(readMemoryFile('user').content).toBe('User prefers concise implementation notes.');
    expect(readMemoryFile('long-term').content).toBe('Project uses Electron.');
    expect(readMemoryFile('daily', '2026-06-22').content).toBe('Today we touched memory.');

    const state = getMemoryState(undefined, '2026-06-22');
    expect(state.user.content).toBe('User prefers concise implementation notes.');
    expect(state.longTerm.content).toBe('Project uses Electron.');
    expect(state.daily.content).toBe('Today we touched memory.');
    expect(state.dailyFiles).toEqual(['2026-06-22']);
  });

  it('records automatic writes and rolls them back', () => {
    const userPath = path.join(testState.workspaceRoot, 'USER.md');
    fs.writeFileSync(userPath, 'before', 'utf-8');

    const result = saveAutomaticMemoryFileWrite({
      kind: 'user',
      content: 'after',
      reason: 'learned preference',
    });

    expect(fs.readFileSync(userPath, 'utf-8')).toBe('after');

    const [change] = getMemoryChangeHistory();
    expect(change.id).toBe(result.changeId);
    expect(change.status).toBe('automatic');
    expect(change.before.content).toBe('before');
    expect(change.after.content).toBe('after');
    expect(change.preview.beforeExcerpt).toBe('before');
    expect(change.preview.afterExcerpt).toBe('after');

    rollbackMemoryFileChange(result.changeId);

    expect(fs.readFileSync(userPath, 'utf-8')).toBe('before');
    expect(getMemoryChange(result.changeId)?.status).toBe('reverted');
  });

  it('stages writes without touching disk until applied', () => {
    const result = stageMemoryFileWrite({
      kind: 'daily',
      date: '2026-06-22',
      content: 'staged note',
    });
    const dailyPath = path.join(testState.workspaceRoot, 'memory', '2026-06-22.md');

    expect(fs.existsSync(dailyPath)).toBe(false);
    expect(getMemoryChange(result.changeId)?.status).toBe('staged');

    applyStagedMemoryFileWrite(result.changeId);

    expect(fs.readFileSync(dailyPath, 'utf-8')).toBe('staged note');
    expect(getMemoryChange(result.changeId)?.status).toBe('applied');
  });

  it('includes USER.md in the runtime memory prompt', () => {
    saveMemoryFile('user', 'User likes terse final responses.');

    const prompt = buildMemoryPrompt();

    expect(prompt).toContain('USER.md\nUser likes terse final responses.');
  });

  it('manages session snapshots through state, search, delete, and rollback', () => {
    const fileName = '2026-06-22-launch-plan.md';
    const snapshotContent = [
      '# Session: 2026-06-22 10:00:00 UTC',
      '',
      '- **Task ID**: task_123',
      '- **Session ID**: sess_456',
      '- **Source**: test',
      '',
      'Launch plan keeps memory manager searchable.',
    ].join('\n');

    saveMemoryFile('snapshot', snapshotContent, undefined, undefined, fileName);

    const state = getMemoryState();
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0].fileName).toBe(fileName);
    expect(state.snapshots[0].taskId).toBe('task_123');
    expect(readMemoryFile('snapshot', undefined, undefined, fileName).content).toContain('Launch plan');

    const results = searchMemory({ query: 'searchable' }).results;
    expect(results.some((result) => result.kind === 'snapshot' && result.fileName === fileName)).toBe(true);

    const deleted = deleteMemoryFile({ kind: 'snapshot', fileName });
    expect(fs.existsSync(path.join(testState.workspaceRoot, 'memory', fileName))).toBe(false);

    rollbackMemoryFileChange(deleted.changeId);
    expect(readMemoryFile('snapshot', undefined, undefined, fileName).content).toContain('Launch plan');
  });

  it('filters secrets and raw payloads from automatic memory writes', () => {
    saveAutomaticMemoryFileWrite({
      kind: 'daily',
      date: '2026-06-22',
      source: 'task_completion',
      content: [
        '- Store useful project preference.',
        '- password=super-secret',
        '- token: sk-test_1234567890abcdef',
        'Plain API key sk-live_1234567890abcdef',
        'DEBUG raw diagnostic line',
        '2026-06-22T12:00:00Z INFO raw provider request body',
        '{"level":"debug","message":"raw payload"}',
        'payload: {"full":"transcript"}',
        `blob ${'a'.repeat(260)}`,
      ].join('\n'),
    });

    const content = readMemoryFile('daily', '2026-06-22').content;
    expect(content).toContain('Store useful project preference.');
    expect(content).toContain('[redacted]');
    expect(content).toContain('[api key redacted]');
    expect(content).not.toContain('super-secret');
    expect(content).not.toContain('DEBUG raw diagnostic line');
    expect(content).not.toContain('raw provider request body');
    expect(content).not.toContain('raw payload');
    expect(content).not.toContain('full');
    expect(content).toContain('[base64 data removed]');
  });

  it('filters memory change history by kind, status, source, and task link', () => {
    saveMemoryFile('user', 'manual user note');
    const taskChange = saveAutomaticMemoryFileWrite({
      kind: 'daily',
      date: '2026-06-22',
      content: 'task-linked note',
      source: 'task_completion',
      taskId: 'task_filter_1',
    });
    stageMemoryFileWrite({
      kind: 'long-term',
      content: 'staged project fact',
      source: 'task_completion',
      taskId: 'task_filter_2',
    });
    rollbackMemoryFileChange(taskChange.changeId);

    expect(listMemoryChangeHistory({ kind: 'daily', taskId: 'task_filter_1' })).toHaveLength(1);
    expect(listMemoryChangeHistory({ status: 'staged', source: 'task_completion' })).toHaveLength(1);
    expect(listMemoryChangeHistory({ includeReverted: false }).some((change) => change.id === taskChange.changeId))
      .toBe(false);
    expect(listMemoryChangeHistory({ limit: 1 })).toHaveLength(1);
  });

  it('records session snapshots with source-task links and sanitized content', async () => {
    const task = createTask({
      id: 'task_snapshot_1',
      sessionId: 'sess_snapshot_1',
      prompt: 'Snapshot this session. password=snapshot-secret',
      messages: [
        {
          id: 'msg_user_snapshot',
          type: 'user',
          content: 'Use short notes. token: sk-snapshot_1234567890abcdef',
          timestamp: new Date(0).toISOString(),
        },
        {
          id: 'msg_assistant_snapshot',
          type: 'assistant',
          content: `DEBUG raw line\nThe durable decision is to keep snapshots searchable.\n${'b'.repeat(260)}`,
          timestamp: new Date(0).toISOString(),
        },
      ],
    });

    const snapshotPath = await saveSessionMemorySnapshot(task, undefined, 'desktop');

    expect(snapshotPath).toBeTruthy();
    const content = fs.readFileSync(snapshotPath!, 'utf-8');
    expect(content).toContain('- **Task ID**: task_snapshot_1');
    expect(content).toContain('- **Session ID**: sess_snapshot_1');
    expect(content).toContain('- **Source**: desktop');
    expect(content).toContain('keep snapshots searchable');
    expect(content).not.toContain('snapshot-secret');
    expect(content).not.toContain('sk-snapshot');
    expect(content).not.toContain('DEBUG raw line');
    expect(content).toContain('[base64 data removed]');

    const [change] = getMemoryChangeHistory();
    expect(change.kind).toBe('snapshot');
    expect(change.status).toBe('automatic');
    expect(change.taskId).toBe('task_snapshot_1');
    expect(change.source).toBe('desktop');
    expect(searchMemory({ query: 'searchable' }).results.some((result) => result.kind === 'snapshot')).toBe(true);
  });

  it('applies automatic post-task memory learning immediately', async () => {
    const fetchMock = mockMemoryModelResponse({
      user: ['User prefers short implementation notes.'],
      longTerm: ['Workspace memory service owns USER.md and MEMORY.md.'],
      daily: ['Today memory learning mode was verified.'],
    });

    const result = await runAutomaticMemoryLearning({
      task: createTask({ id: 'task_learning_auto' }),
      agentId: 'main',
      source: 'task_completion',
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('automatic');
    expect(result.changes).toHaveLength(3);
    expect(result.changes.every((change) => change.status === 'automatic')).toBe(true);
    expect(readMemoryFile('user').content).toContain('User prefers short implementation notes.');
    expect(readMemoryFile('long-term').content).toContain('Workspace memory service owns USER.md and MEMORY.md.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stages post-task memory learning in approval mode', async () => {
    testState.memoryWriteMode = 'approval';
    mockMemoryModelResponse({
      user: [],
      longTerm: [],
      daily: ['Approval mode stages this note for review.'],
    });

    const result = await runAutomaticMemoryLearning({
      task: createTask({ id: 'task_learning_approval' }),
      agentId: 'main',
      source: 'task_completion',
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('approval');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].status).toBe('staged');
    expect(readMemoryFile('daily').content).toBe('');

    applyStagedMemoryFileWrite(result.changes[0].changeId);
    expect(readMemoryFile('daily').content).toContain('Approval mode stages this note for review.');
  });

  it('skips post-task memory learning when mode is off', async () => {
    testState.memoryWriteMode = 'off';
    const fetchMock = mockMemoryModelResponse({
      user: ['Should not be called.'],
      longTerm: [],
      daily: [],
    });

    const result = await runAutomaticMemoryLearning({
      task: createTask({ id: 'task_learning_off' }),
      agentId: 'main',
      source: 'task_completion',
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('off');
    expect(result.changes).toEqual([]);
    expect(result.skippedReason).toBe('Memory learning is off.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps learning notifications desktop-only and suppressible', () => {
    expect(__postTaskLearningTest.shouldEmitLearningNotifications({ source: 'desktop', enabled: true })).toBe(true);
    expect(__postTaskLearningTest.shouldEmitLearningNotifications({ source: 'chat', enabled: true })).toBe(true);
    expect(__postTaskLearningTest.shouldEmitLearningNotifications({ source: 'gateway', enabled: true })).toBe(false);
    expect(__postTaskLearningTest.shouldEmitLearningNotifications({ source: 'telegram-connector', enabled: true })).toBe(false);
    expect(__postTaskLearningTest.shouldEmitLearningNotifications({ source: 'desktop', enabled: false })).toBe(false);
  });
});
