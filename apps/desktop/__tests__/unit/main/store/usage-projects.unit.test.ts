import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsagePricingSettings } from '@accomplish/shared';

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

async function importUsageProjectModules() {
  const store = await import('../../../../src/main/store/usageProjects');
  const pricing = await import('../../../../src/main/store/usagePricing');
  const tokenUsage = await import('../../../../src/main/store/tokenUsage');
  const taskHistory = await import('../../../../src/main/store/taskHistory');
  const buildTaskHistory = await import('../../../../src/main/store/buildTaskHistory');
  const folders = await import('../../../../src/main/store/folderStore');
  const buildPresets = await import('../../../../src/main/store/buildModePresets');
  const service = await import('../../../../src/main/services/usage-projects');
  const assignments = await import('../../../../src/main/services/usage-project-assignments');
  return { store, pricing, tokenUsage, taskHistory, buildTaskHistory, folders, buildPresets, service, assignments };
}

function pricingSettings(now: string): UsagePricingSettings {
  return {
    currency: 'USD',
    updatedAt: now,
    providers: [{
      provider: 'openai',
      model: null,
      inputCostPer1m: null,
      inputHitCostPer1m: 0.5,
      inputMissCostPer1m: 5,
      outputCostPer1m: 10,
      effectiveFrom: null,
      pricingSource: 'manual',
      pricingUpdatedAt: now,
      createdAt: now,
    }],
  };
}

describe('usage projects', () => {
  beforeEach(() => {
    vi.resetModules();
    mockStores.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports project CRUD, archive behavior, and budget window CRUD', async () => {
    const { store } = await importUsageProjectModules();

    const project = store.createUsageProject({ name: 'Client A', color: '#22c55e', trackingEnabled: false });
    expect(project.name).toBe('Client A');
    expect(project.trackingEnabled).toBe(false);
    expect(store.listUsageProjects()).toHaveLength(1);

    const updated = store.updateUsageProject(project.id, { name: 'Client A redesign' });
    expect(updated.name).toBe('Client A redesign');

    const window = store.createUsageProjectBudgetWindow({
      projectId: project.id,
      name: 'May budget',
      startsAt: '2026-05-01T00:00:00.000Z',
      endsAt: '2026-06-01T00:00:00.000Z',
      enabled: true,
      mode: 'warn',
      moneyLimit: 25,
      tokenLimit: 100_000,
      currency: 'USD',
    });
    expect(store.listUsageProjects()[0].trackingEnabled).toBe(true);
    expect(store.listUsageProjectBudgetWindows(project.id)).toHaveLength(1);

    const blockingWindow = store.updateUsageProjectBudgetWindow(window.id, { mode: 'block', tokenLimit: 50_000 });
    expect(blockingWindow.mode).toBe('block');
    expect(blockingWindow.tokenLimit).toBe(50_000);

    store.deleteUsageProjectBudgetWindow(window.id);
    expect(store.listUsageProjectBudgetWindows(project.id)).toHaveLength(0);

    store.archiveUsageProject(project.id);
    expect(store.listUsageProjects()).toHaveLength(0);
    expect(store.listUsageProjects({ includeArchived: true })[0].status).toBe('archived');
  });

  it('normalizes budget project metadata and preserves old projects without metadata', async () => {
    const now = '2026-05-29T10:00:00.000Z';
    const { store } = await importUsageProjectModules();

    const project = store.createUsageProject({
      name: ' Client metadata ',
      clientName: ' Acme Ltd ',
      projectCode: ' ACME-42 ',
      owner: ' Sam ',
      billingType: 'fixed_fee',
      billingReference: ' PO-123 ',
      priority: 'urgent',
      dueDate: now,
      notes: ' Notes for the account ',
      links: [
        { id: 'repo', label: ' Repo ', url: 'https://example.com/repo' },
        { id: 'bad', label: 'Bad', url: 'javascript:alert(1)' },
        { id: 'folder', label: ' Folder ', url: 'C:\\Projects\\Acme' },
      ],
      tags: ['Client', ' client ', 'Launch'],
      trackingEnabled: true,
    });

    expect(project.clientName).toBe('Acme Ltd');
    expect(project.projectCode).toBe('ACME-42');
    expect(project.owner).toBe('Sam');
    expect(project.billingType).toBe('fixed_fee');
    expect(project.billingReference).toBe('PO-123');
    expect(project.priority).toBe('urgent');
    expect(project.dueDate).toBe(now);
    expect(project.notes).toBe('Notes for the account');
    expect(project.noteEntries?.map((note) => note.text)).toEqual(['Notes for the account']);
    expect(project.links).toEqual([
      { id: 'repo', label: 'Repo', url: 'https://example.com/repo' },
      { id: 'folder', label: 'Folder', url: 'C:\\Projects\\Acme' },
    ]);
    expect(project.tags).toEqual(['Client', 'Launch']);

    const updated = store.updateUsageProject(project.id, {
      billingType: 'not-valid' as never,
      priority: 'not-valid' as never,
      noteEntries: [
        { id: 'note-1', text: 'First dated note', createdAt: now },
        { id: 'empty', text: '   ', createdAt: now },
      ],
      links: [{ id: 'rel', label: 'Relative', url: './docs' }],
      tags: ['Support'],
    });
    expect(updated.billingType).toBe('internal');
    expect(updated.priority).toBe('normal');
    expect(updated.noteEntries).toEqual([{ id: 'note-1', text: 'First dated note', createdAt: now, updatedAt: undefined }]);
    expect(updated.links).toEqual([{ id: 'rel', label: 'Relative', url: './docs' }]);
    expect(updated.tags).toEqual(['Support']);

    const deletedNotes = store.updateUsageProject(project.id, { noteEntries: [] });
    expect(deletedNotes.noteEntries).toEqual([]);

    const rawStore = mockStores.get('usage-projects');
    if (!rawStore) throw new Error('usage-projects store missing');
    rawStore.projects = [{
      id: 'old-project',
      name: 'Old project',
      status: 'active',
      trackingEnabled: true,
      createdAt: now,
      updatedAt: now,
    }];

    const oldProject = store.listUsageProjects({ includeArchived: true })[0];
    expect(oldProject.clientName).toBe('');
    expect(oldProject.projectCode).toBe('');
    expect(oldProject.billingType).toBe('internal');
    expect(oldProject.priority).toBe('normal');
    expect(oldProject.noteEntries).toEqual([]);
    expect(oldProject.links).toEqual([]);
    expect(oldProject.tags).toEqual([]);
  });

  it('summarizes project usage and marks warn/block budget windows independently', async () => {
    const now = '2026-05-29T10:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { store, pricing, tokenUsage, service } = await importUsageProjectModules();
    pricing.setUsagePricingSettings(pricingSettings(now));

    const project = store.createUsageProject({ name: 'Launch work', trackingEnabled: true });
    const warnWindow = store.createUsageProjectBudgetWindow({
      projectId: project.id,
      name: 'Money warning',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.999Z',
      enabled: true,
      mode: 'warn',
      moneyLimit: 0.01,
      tokenLimit: null,
      currency: 'USD',
    });
    const blockWindow = store.createUsageProjectBudgetWindow({
      projectId: project.id,
      name: 'Token block',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.999Z',
      enabled: true,
      mode: 'block',
      moneyLimit: null,
      tokenLimit: 5_000,
      currency: 'USD',
    });

    tokenUsage.addTurnLog({
      id: 'turn-1',
      taskId: 'task-1',
      createdAt: now,
      provider: 'openai',
      model: 'gpt-test',
      contextLimitTokens: 128000,
      maxOutputTokens: 4096,
      headroomSafetyTokens: 512,
      promptTokensEst: 6000,
      estimated: false,
      breakdown: { system: 0, tools: 0, retrieved: 0, history: 0, newMessage: 0 },
      trimmed: false,
      droppedMessages: 0,
      summaryInserted: false,
      shouldResetSession: false,
      usageProjectId: project.id,
      usage: {
        inputTokens: 6000,
        inputHitTokens: 1000,
        inputMissTokens: 5000,
        outputTokens: 1000,
        totalTokens: 7000,
        estimated: false,
      },
    });

    const summary = service.getUsageProjectSummary({ projectId: project.id, windowId: warnWindow.id });
    expect(summary.summary.inputHitTokens).toBe(1000);
    expect(summary.summary.inputMissTokens).toBe(5000);
    expect(summary.summary.outputTokens).toBe(1000);
    expect(summary.summary.cost).toBeCloseTo(0.0355, 10);

    const statuses = service.getUsageProjectBudgetStatus(project.id);
    const warnStatus = statuses.find((status) => status.windowId === warnWindow.id);
    const blockStatus = statuses.find((status) => status.windowId === blockWindow.id);
    expect(warnStatus?.exceededMoney).toBe(true);
    expect(warnStatus?.blocking).toBe(false);
    expect(blockStatus?.exceededTokens).toBe(true);
    expect(blockStatus?.blocking).toBe(true);
    expect(service.getBlockingUsageProjectBudgetStatus(project.id)?.windowId).toBe(blockWindow.id);
  });

  it('re-tags existing task history and token turns when assigning work to a project', async () => {
    const now = '2026-05-29T10:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { store, pricing, tokenUsage, taskHistory, service, assignments } = await importUsageProjectModules();
    pricing.setUsagePricingSettings(pricingSettings(now));
    const project = store.createUsageProject({ name: 'Retagged work', trackingEnabled: true });

    taskHistory.saveTask({
      id: 'task-retag',
      prompt: 'Do the work',
      status: 'completed',
      messages: [],
      createdAt: now,
      usageProjectId: null,
    });
    tokenUsage.addTurnLog({
      id: 'turn-retag',
      taskId: 'task-retag',
      createdAt: now,
      provider: 'openai',
      model: 'gpt-test',
      contextLimitTokens: 128000,
      maxOutputTokens: 4096,
      headroomSafetyTokens: 512,
      promptTokensEst: 1000,
      estimated: false,
      breakdown: { system: 0, tools: 0, retrieved: 0, history: 0, newMessage: 0 },
      trimmed: false,
      droppedMessages: 0,
      summaryInserted: false,
      shouldResetSession: false,
      usageProjectId: null,
      usage: {
        inputTokens: 1000,
        inputMissTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        estimated: false,
      },
    });

    const result = assignments.assignUsageProjectToTasks(['task-retag'], project.id);
    const task = taskHistory.getTask('task-retag');
    const summary = service.getUsageProjectSummary({ projectId: project.id });

    expect(result.taskCount).toBe(1);
    expect(result.turnCount).toBe(1);
    expect(task?.usageProjectId).toBe(project.id);
    expect(summary.summary.totalTokens).toBe(1500);
    expect(summary.summary.cost).toBeCloseTo(0.01, 10);
  });

  it('stores a budget project on Build presets', async () => {
    const { store, buildPresets } = await importUsageProjectModules();
    const project = store.createUsageProject({ name: 'Preset budget', trackingEnabled: true });

    const preset = buildPresets.upsertBuildModePreset({
      agentId: 'agent-1',
      name: 'Mobile app',
      workspaceRelativePath: 'mobile',
      usageProjectId: project.id,
      commands: { startCommand: 'pnpm dev' },
    });
    const listed = buildPresets.listBuildModePresets('agent-1').presets[0];

    expect(preset.usageProjectId).toBe(project.id);
    expect(listed.usageProjectId).toBe(project.id);
  });

  it('moves Build preset sessions, tasks, and token turns to another budget project', async () => {
    const now = '2026-05-29T10:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const {
      store,
      pricing,
      tokenUsage,
      taskHistory,
      buildTaskHistory,
      buildPresets,
      service,
      assignments,
    } = await importUsageProjectModules();
    pricing.setUsagePricingSettings(pricingSettings(now));
    const oldProject = store.createUsageProject({ name: 'Old build budget', trackingEnabled: true });
    const newProject = store.createUsageProject({ name: 'New build budget', trackingEnabled: true });

    const preset = buildPresets.upsertBuildModePreset({
      agentId: 'agent-1',
      name: 'Desktop app',
      workspaceRelativePath: 'apps/desktop',
      usageProjectId: oldProject.id,
      commands: { startCommand: 'pnpm dev' },
    });
    const session = buildTaskHistory.createBuildTaskSession({
      agentId: 'agent-1',
      titleSourcePrompt: 'Build the desktop app',
      goalPrompt: 'Build the desktop app',
      workspaceRelativePath: 'apps/desktop',
      selectedPresetId: preset.id,
      usageProjectId: oldProject.id,
    });
    buildTaskHistory.updateBuildTaskSession({
      sessionId: session.id,
      activeRun: {
        id: 'run-build-preset',
        taskId: 'task-build-preset',
        status: 'completed',
        startedAt: now,
        completedAt: now,
      },
    });
    taskHistory.saveTask({
      id: 'task-build-preset',
      prompt: 'Build the desktop app',
      status: 'completed',
      messages: [],
      createdAt: now,
      usageProjectId: oldProject.id,
    });
    tokenUsage.addTurnLog({
      id: 'turn-build-preset',
      taskId: 'task-build-preset',
      createdAt: now,
      provider: 'openai',
      model: 'gpt-test',
      contextLimitTokens: 128000,
      maxOutputTokens: 4096,
      headroomSafetyTokens: 512,
      promptTokensEst: 3000,
      estimated: false,
      breakdown: { system: 0, tools: 0, retrieved: 0, history: 0, newMessage: 0 },
      trimmed: false,
      droppedMessages: 0,
      summaryInserted: false,
      shouldResetSession: false,
      usageProjectId: oldProject.id,
      usage: {
        inputTokens: 3000,
        inputMissTokens: 3000,
        outputTokens: 1000,
        totalTokens: 4000,
        estimated: false,
      },
    });

    buildPresets.upsertBuildModePreset({
      id: preset.id,
      agentId: 'agent-1',
      name: preset.name,
      workspaceRelativePath: preset.workspaceRelativePath,
      usageProjectId: newProject.id,
      commands: preset.commands,
    });
    const result = assignments.assignUsageProjectToBuildPresetSessions('agent-1', preset.id, newProject.id);
    const updatedSession = buildTaskHistory.getBuildTaskSession(session.id);
    const oldSummary = service.getUsageProjectSummary({ projectId: oldProject.id });
    const newSummary = service.getUsageProjectSummary({ projectId: newProject.id });

    expect(result.totalSessions).toBe(1);
    expect(result.sessionCount).toBe(1);
    expect(result.turnCount).toBe(1);
    expect(buildPresets.listBuildModePresets('agent-1').presets[0].usageProjectId).toBe(newProject.id);
    expect(updatedSession?.execution.usageProjectId).toBe(newProject.id);
    expect(taskHistory.getTask('task-build-preset')?.usageProjectId).toBe(newProject.id);
    expect(oldSummary.summary.totalTokens).toBe(0);
    expect(newSummary.summary.totalTokens).toBe(4000);
  });

  it('re-tags tasks assigned to a Chat task project', async () => {
    const now = '2026-05-29T10:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const { store, pricing, tokenUsage, taskHistory, folders, service, assignments } = await importUsageProjectModules();
    pricing.setUsagePricingSettings(pricingSettings(now));
    const project = store.createUsageProject({ name: 'Chat project budget', trackingEnabled: true });
    const movedProject = store.createUsageProject({ name: 'Moved chat budget', trackingEnabled: true });
    const folder = folders.createFolder({ name: 'Client tasks', usageProjectId: project.id }, 'agent-1');
    folders.setTaskFolder('task-foldered', folder.id);

    taskHistory.saveTask({
      id: 'task-foldered',
      prompt: 'Project task',
      status: 'completed',
      messages: [],
      createdAt: now,
      usageProjectId: null,
    });
    tokenUsage.addTurnLog({
      id: 'turn-foldered',
      taskId: 'task-foldered',
      createdAt: now,
      provider: 'openai',
      model: 'gpt-test',
      contextLimitTokens: 128000,
      maxOutputTokens: 4096,
      headroomSafetyTokens: 512,
      promptTokensEst: 2000,
      estimated: false,
      breakdown: { system: 0, tools: 0, retrieved: 0, history: 0, newMessage: 0 },
      trimmed: false,
      droppedMessages: 0,
      summaryInserted: false,
      shouldResetSession: false,
      usageProjectId: null,
      usage: {
        inputTokens: 2000,
        inputMissTokens: 2000,
        outputTokens: 1000,
        totalTokens: 3000,
        estimated: false,
      },
    });

    const result = assignments.assignUsageProjectToFolderTasks(folder.id, project.id);
    const summary = service.getUsageProjectSummary({ projectId: project.id });

    expect(result.totalTaskIds).toBe(1);
    expect(result.turnCount).toBe(1);
    expect(taskHistory.getTask('task-foldered')?.usageProjectId).toBe(project.id);
    expect(summary.summary.totalTokens).toBe(3000);

    folders.updateFolder(folder.id, { usageProjectId: movedProject.id });
    const movedResult = assignments.assignUsageProjectToFolderTasks(folder.id, movedProject.id);
    const movedSummary = service.getUsageProjectSummary({ projectId: movedProject.id });
    const oldSummary = service.getUsageProjectSummary({ projectId: project.id });

    expect(movedResult.turnCount).toBe(1);
    expect(taskHistory.getTask('task-foldered')?.usageProjectId).toBe(movedProject.id);
    expect(oldSummary.summary.totalTokens).toBe(0);
    expect(movedSummary.summary.totalTokens).toBe(3000);
  });
});
