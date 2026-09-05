import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  activeAgentId: 'main',
  activeTaskIds: [] as string[],
  taskConfigs: new Map<string, { agentId?: string }>(),
  connectorConfigs: [] as any[],
  connectorStatuses: [] as any[],
  schedules: [] as any[],
  queueLength: 0,
  startGatewayConnectorRuntimes: vi.fn(async () => {}),
  stopGatewayConnectorRuntimes: vi.fn(async () => {}),
  restartGatewayConnectorRuntime: vi.fn(async () => {}),
  resyncSchedules: vi.fn(),
  startAgentHeartbeatService: vi.fn(),
  stopAgentHeartbeatService: vi.fn(),
}));

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

vi.mock('@main/runtime/agent-engine', () => ({
  getActiveAgentEngineTaskIds: vi.fn(() => runtimeMocks.activeTaskIds),
  getAgentEngineTaskConfig: vi.fn((taskId: string) => runtimeMocks.taskConfigs.get(taskId)),
}));

vi.mock('@main/opencode/task-manager', () => ({
  getTaskManager: vi.fn(() => ({
    getQueueLength: () => runtimeMocks.queueLength,
  })),
}));

vi.mock('@main/store/appSettings', () => ({
  getActiveAgentId: vi.fn(() => runtimeMocks.activeAgentId),
}));

vi.mock('@main/store/gatewayConnectorExtensions', () => ({
  getGatewayConnectorRuntimeKey: vi.fn((connectorId: string, instanceId?: string) =>
    instanceId && instanceId !== 'default' ? `${connectorId}::${instanceId}` : connectorId
  ),
  listGatewayConnectorExtensionConfigs: vi.fn(() => runtimeMocks.connectorConfigs),
}));

vi.mock('@main/store/schedules', () => ({
  listSchedules: vi.fn(() => runtimeMocks.schedules),
}));

vi.mock('@main/services/gateway-connector-runtimes', () => ({
  listGatewayConnectorRuntimeStatuses: vi.fn(() => runtimeMocks.connectorStatuses),
  startGatewayConnectorRuntimes: runtimeMocks.startGatewayConnectorRuntimes,
  stopGatewayConnectorRuntimes: runtimeMocks.stopGatewayConnectorRuntimes,
  restartGatewayConnectorRuntime: runtimeMocks.restartGatewayConnectorRuntime,
}));

vi.mock('@main/services/scheduler', () => ({
  resyncSchedules: runtimeMocks.resyncSchedules,
}));

vi.mock('@main/services/agent-heartbeat', () => ({
  startAgentHeartbeatService: runtimeMocks.startAgentHeartbeatService,
  stopAgentHeartbeatService: runtimeMocks.stopAgentHeartbeatService,
}));

function resetRuntimeMocks(): void {
  runtimeMocks.activeAgentId = 'main';
  runtimeMocks.activeTaskIds = [];
  runtimeMocks.taskConfigs = new Map();
  runtimeMocks.connectorConfigs = [];
  runtimeMocks.connectorStatuses = [];
  runtimeMocks.schedules = [];
  runtimeMocks.queueLength = 0;
  runtimeMocks.startGatewayConnectorRuntimes.mockReset();
  runtimeMocks.startGatewayConnectorRuntimes.mockResolvedValue(undefined);
  runtimeMocks.stopGatewayConnectorRuntimes.mockReset();
  runtimeMocks.stopGatewayConnectorRuntimes.mockResolvedValue(undefined);
  runtimeMocks.restartGatewayConnectorRuntime.mockReset();
  runtimeMocks.restartGatewayConnectorRuntime.mockResolvedValue(undefined);
  runtimeMocks.resyncSchedules.mockReset();
  runtimeMocks.startAgentHeartbeatService.mockReset();
  runtimeMocks.stopAgentHeartbeatService.mockReset();
}

describe('agent always-on store defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntimeMocks();
  });

  it('hydrates existing agents with always-on disabled by default', async () => {
    const { listAgents } = await import('@main/store/agents');

    const [agent] = listAgents();

    expect(agent.id).toBe('main');
    expect(agent.alwaysOnEnabled).toBe(false);
  });

  it('persists the always-on toggle on upsert', async () => {
    const { getAgent, upsertAgent } = await import('@main/store/agents');

    upsertAgent({ id: 'main', name: 'Main', alwaysOnEnabled: true });

    expect(getAgent('main')?.alwaysOnEnabled).toBe(true);
  });

  it('preserves existing agent settings when only toggling always-on', async () => {
    const { getAgent, upsertAgent } = await import('@main/store/agents');
    const { setAgentAlwaysOnEnabled } = await import('@main/services/always-on-status');

    upsertAgent({
      id: 'main',
      name: 'Main',
      roleName: 'Researcher',
      description: 'Keeps a custom profile',
      avatar: 'character:ai-wizard',
      avatarColor: '#8b5cf6',
      avatarImageDataUrl: 'data:image/png;base64,aGVsbG8=',
      appearance: {
        avatarFrame: 'badge',
        accentColor: '#14b8a6',
        answerStyle: 'playful',
        chatBackgroundId: 'cloud-automation-sky',
        showAvatarOnAnswers: true,
        presenceAnimation: 'standard',
      },
      workspaceRoot: 'C:\\agent-workspaces\\main',
      systemPromptAppend: 'Keep project context.',
      selectedModel: {
        provider: 'openai',
        model: 'gpt-5-mini',
      },
      deferredToolDiscoveryEnabled: true,
      skillAutomationMode: 'approval',
      memoryWriteMode: 'approval',
      memoryNotificationsEnabled: false,
      alwaysOnEnabled: true,
    });

    setAgentAlwaysOnEnabled('main', false);

    const agent = getAgent('main');
    expect(agent?.alwaysOnEnabled).toBe(false);
    expect(agent?.roleName).toBe('Researcher');
    expect(agent?.description).toBe('Keeps a custom profile');
    expect(agent?.avatar).toBe('character:ai-wizard');
    expect(agent?.avatarColor).toBe('#8b5cf6');
    expect(agent?.avatarImageDataUrl).toBe('data:image/png;base64,aGVsbG8=');
    expect(agent?.appearance).toMatchObject({
      avatarFrame: 'badge',
      accentColor: '#14b8a6',
      answerStyle: 'playful',
      chatBackgroundId: 'cloud-automation-sky',
      showAvatarOnAnswers: true,
      presenceAnimation: 'standard',
    });
    expect(agent?.workspaceRoot).toBe('C:\\agent-workspaces\\main');
    expect(agent?.systemPromptAppend).toBe('Keep project context.');
    expect(agent?.selectedModel).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
    });
    expect(agent?.deferredToolDiscoveryEnabled).toBe(true);
    expect(agent?.skillAutomationMode).toBe('approval');
    expect(agent?.memoryWriteMode).toBe('approval');
    expect(agent?.memoryNotificationsEnabled).toBe(false);
  });
});

describe('always-on runtime manager contract', () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntimeMocks();
  });

  it('starts enabled agent runtimes and exposes dashboard-ready service status', async () => {
    const { upsertAgent } = await import('@main/store/agents');
    const { startAlwaysOnRuntimeManager, getAlwaysOnStatusSnapshot } = await import('@main/services/always-on-status');

    upsertAgent({
      id: 'main',
      name: 'Main',
      alwaysOnEnabled: true,
      agenticLoopEnabled: true,
      heartbeatEnabled: true,
      memoryWriteMode: 'automatic',
      skillAutomationMode: 'automatic',
    });
    runtimeMocks.connectorConfigs = [{
      id: 'slack',
      instanceId: 'work',
      enabled: true,
      autoBindRouting: true,
      updatedAt: '2026-06-22T08:00:00.000Z',
      agentId: 'main',
    }];
    runtimeMocks.connectorStatuses = [{
      connectorId: 'slack',
      instanceId: 'work',
      runtimeKey: 'slack::work',
      configured: true,
      running: true,
      mode: 'first-party',
      lastStartAt: '2026-06-22T08:00:00.000Z',
    }];
    runtimeMocks.schedules = [{
      id: 'sched-1',
      agentId: 'main',
      name: 'Daily sweep',
      prompt: 'Check work',
      cron: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
      reuseSession: false,
      nextRunAt: '2026-06-23T09:00:00.000Z',
      createdAt: '2026-06-22T08:00:00.000Z',
      updatedAt: '2026-06-22T08:00:00.000Z',
    }];

    await startAlwaysOnRuntimeManager();
    const snapshot = getAlwaysOnStatusSnapshot();
    const agent = snapshot.agents.find((entry) => entry.agentId === 'main')!;

    expect(runtimeMocks.startGatewayConnectorRuntimes).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.resyncSchedules).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.startAgentHeartbeatService).toHaveBeenCalledTimes(1);
    expect(snapshot.runtime.state).toBe('running');
    expect(snapshot.runtime.restartControls.canRestartManager).toBe(true);
    expect(agent.status).toBe('ready');
    expect(agent.managerState).toBe('running');
    expect(agent.connectorRuntimeKeys).toEqual(['slack::work']);
    expect(agent.nextScheduleAt).toBe('2026-06-23T09:00:00.000Z');
    expect(agent.nextHeartbeatAt).toBeTruthy();
    expect(agent.foregroundNonBlocking).toBe(true);
  });

  it('keeps foreground Chat/Build tasks from making always-on look busy', async () => {
    const { upsertAgent } = await import('@main/store/agents');
    const { getAlwaysOnStatusSnapshot } = await import('@main/services/always-on-status');

    upsertAgent({ id: 'main', name: 'Main', alwaysOnEnabled: true });
    runtimeMocks.schedules = [{
      id: 'sched-1',
      agentId: 'main',
      name: 'Daily sweep',
      prompt: 'Check work',
      cron: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
      reuseSession: false,
      nextRunAt: '2026-06-23T09:00:00.000Z',
      createdAt: '2026-06-22T08:00:00.000Z',
      updatedAt: '2026-06-22T08:00:00.000Z',
    }];
    runtimeMocks.activeTaskIds = ['task_chat_1'];
    runtimeMocks.taskConfigs.set('task_chat_1', { agentId: 'main' });

    let agent = getAlwaysOnStatusSnapshot().agents.find((entry) => entry.agentId === 'main')!;
    expect(agent.foregroundActiveTaskCount).toBe(1);
    expect(agent.backgroundActiveTaskCount).toBe(0);
    expect(agent.status).toBe('ready');

    runtimeMocks.activeTaskIds = ['task_chat_1', 'gateway_slack_1'];
    runtimeMocks.taskConfigs.set('gateway_slack_1', { agentId: 'main' });
    agent = getAlwaysOnStatusSnapshot().agents.find((entry) => entry.agentId === 'main')!;
    expect(agent.foregroundActiveTaskCount).toBe(1);
    expect(agent.backgroundActiveTaskCount).toBe(1);
    expect(agent.status).toBe('busy');
  });

  it('tracks queued connector work and failure history', async () => {
    const { upsertAgent } = await import('@main/store/agents');
    const {
      finalizeAlwaysOnConnectorTask,
      getAlwaysOnStatusSnapshot,
      registerAlwaysOnQueuedConnectorTask,
      startAlwaysOnRuntimeManager,
    } = await import('@main/services/always-on-status');

    upsertAgent({ id: 'main', name: 'Main', alwaysOnEnabled: true });
    runtimeMocks.connectorConfigs = [{
      id: 'telegram',
      instanceId: 'default',
      enabled: true,
      autoBindRouting: true,
      updatedAt: '2026-06-22T08:00:00.000Z',
      agentId: 'main',
    }];
    runtimeMocks.startGatewayConnectorRuntimes.mockRejectedValueOnce(new Error('connector startup failed'));

    await startAlwaysOnRuntimeManager();
    registerAlwaysOnQueuedConnectorTask({
      taskId: 'telegram_msg_1',
      agentId: 'main',
      connectorId: 'telegram',
    });
    finalizeAlwaysOnConnectorTask('telegram_msg_1', {
      state: 'failed',
      error: new Error('delivery failed'),
    });

    const snapshot = getAlwaysOnStatusSnapshot();
    const agent = snapshot.agents.find((entry) => entry.agentId === 'main')!;

    expect(snapshot.runtime.state).toBe('degraded');
    expect(snapshot.runtime.failureHistory.map((failure) => failure.message)).toContain('connector startup failed');
    expect(snapshot.runtime.failureHistory.map((failure) => failure.message)).toContain('delivery failed');
    expect(agent.status).toBe('degraded');
    expect(agent.failureHistory.length).toBeGreaterThan(0);
  });

  it('exposes agent restart controls for enabled runtimes', async () => {
    const { upsertAgent } = await import('@main/store/agents');
    const { restartAgentAlwaysOnRuntime } = await import('@main/services/always-on-status');

    upsertAgent({ id: 'main', name: 'Main', alwaysOnEnabled: true });
    runtimeMocks.connectorConfigs = [{
      id: 'discord',
      instanceId: 'ops',
      enabled: true,
      autoBindRouting: true,
      updatedAt: '2026-06-22T08:00:00.000Z',
      agentId: 'main',
    }];

    const status = await restartAgentAlwaysOnRuntime('main');

    expect(runtimeMocks.restartGatewayConnectorRuntime).toHaveBeenCalledWith('discord', 'ops');
    expect(runtimeMocks.resyncSchedules).toHaveBeenCalledTimes(1);
    expect(status.restartAvailable).toBe(true);
    expect(status.managerState).toBe('running');
  });
});
