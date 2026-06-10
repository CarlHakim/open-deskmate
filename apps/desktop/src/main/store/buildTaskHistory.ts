import Store from 'electron-store';
import { randomUUID } from 'crypto';
import type {
  BuildTaskHistoryListInput,
  BuildTaskHistoryStoreSchema,
  BuildTaskSession,
  BuildTaskSessionPinInput,
  BuildTaskSessionArchiveInput,
  BuildTaskSessionCreateInput,
  BuildTaskSessionDeleteInput,
  BuildTaskSessionListItem,
  BuildTaskSessionListResult,
  BuildTaskSessionRenameInput,
  BuildTaskSessionUpdateInput,
} from '@accomplish/shared';

const DEFAULT_MAX_SESSIONS_PER_AGENT = 200;
const DEFAULT_MAX_LOGS_PER_SESSION = 1_000;
const DEFAULT_MAX_MESSAGES_PER_SESSION = 400;

const store = new Store<BuildTaskHistoryStoreSchema>({
  name: 'build-task-history',
  defaults: {
    version: 1,
    sessionsById: {},
    recentSessionIdsByAgent: {},
    archivedSessionIdsByAgent: {},
    settings: {
      maxSessionsPerAgent: DEFAULT_MAX_SESSIONS_PER_AGENT,
      maxLogsPerSession: DEFAULT_MAX_LOGS_PER_SESSION,
      maxMessagesPerSession: DEFAULT_MAX_MESSAGES_PER_SESSION,
    },
  },
});

function normalizeAgentId(input: string): string {
  return String(input || 'main')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'main';
}

function normalizeText(input: unknown, fallback = ''): string {
  if (typeof input !== 'string') return fallback;
  return input.trim();
}

function deriveTitleFromPrompt(prompt: string): string {
  const normalized = normalizeText(prompt).replace(/\s+/g, ' ');
  if (!normalized) return 'Build task';
  const sentence = normalized.split(/[.!?]/, 1)[0]?.trim() || normalized;
  return sentence.slice(0, 90);
}

function buildSearchText(title: string, titleSourcePrompt: string): string {
  return `${title} ${titleSourcePrompt}`.toLowerCase();
}

function statusRank(status: BuildTaskSession['lifecycleStatus']): number {
  switch (status) {
    case 'active': return 0;
    case 'failed': return 1;
    case 'interrupted': return 2;
    case 'completed': return 3;
    case 'archived': return 4;
    default: return 5;
  }
}

function toListItem(session: BuildTaskSession): BuildTaskSessionListItem {
  const runs = session.runs || [];
  const latestRun = runs[runs.length - 1];
  const tokenTotal = runs.reduce((sum, run) => {
    const usage = run.tokenUsage;
    if (!usage) return sum;
    if (typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)) {
      return sum + Math.max(0, Math.floor(usage.totalTokens));
    }
    const prompt = typeof usage.promptTokens === 'number' && Number.isFinite(usage.promptTokens) ? usage.promptTokens : 0;
    const completion = typeof usage.completionTokens === 'number' && Number.isFinite(usage.completionTokens) ? usage.completionTokens : 0;
    return sum + Math.max(0, Math.floor(prompt + completion));
  }, 0);
  return {
    id: session.id,
    agentId: session.agentId,
    title: session.title,
    titleSourcePrompt: session.titleSourcePrompt,
    lifecycleStatus: session.lifecycleStatus,
    pinned: session.pinned === true,
    tokenTotal: tokenTotal > 0 ? tokenTotal : undefined,
    workspaceRelativePath: session.execution.workspaceRelativePath,
    selectedPresetId: session.execution.selectedPresetId ?? null,
    usageProjectId: session.execution.usageProjectId ?? null,
    runCount: runs.length,
    latestRunStatus: latestRun?.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
  };
}

function getSettings() {
  const settings = store.get('settings');
  return {
    maxSessionsPerAgent: Math.max(10, settings?.maxSessionsPerAgent ?? DEFAULT_MAX_SESSIONS_PER_AGENT),
    maxLogsPerSession: Math.max(50, settings?.maxLogsPerSession ?? DEFAULT_MAX_LOGS_PER_SESSION),
    maxMessagesPerSession: Math.max(20, settings?.maxMessagesPerSession ?? DEFAULT_MAX_MESSAGES_PER_SESSION),
  };
}

function getRecentIds(agentId: string): string[] {
  const map = store.get('recentSessionIdsByAgent') ?? {};
  return Array.isArray(map[agentId]) ? map[agentId] : [];
}

function getArchivedIds(agentId: string): string[] {
  const map = store.get('archivedSessionIdsByAgent') ?? {};
  return Array.isArray(map[agentId]) ? map[agentId] : [];
}

function setRecentIds(agentId: string, ids: string[]): void {
  const map = { ...(store.get('recentSessionIdsByAgent') ?? {}) };
  map[agentId] = ids;
  store.set('recentSessionIdsByAgent', map);
}

function setArchivedIds(agentId: string, ids: string[]): void {
  const map = { ...(store.get('archivedSessionIdsByAgent') ?? {}) };
  map[agentId] = ids;
  store.set('archivedSessionIdsByAgent', map);
}

function withSessions(mutator: (sessions: Record<string, BuildTaskSession>) => void): void {
  const sessions = { ...(store.get('sessionsById') ?? {}) };
  mutator(sessions);
  store.set('sessionsById', sessions);
}

function getSessionMap(): Record<string, BuildTaskSession> {
  return store.get('sessionsById') ?? {};
}

function touchRecent(agentId: string, sessionId: string): void {
  const settings = getSettings();
  const recent = getRecentIds(agentId).filter((id) => id !== sessionId);
  recent.unshift(sessionId);
  setRecentIds(agentId, recent.slice(0, settings.maxSessionsPerAgent));
}

function removeFromIndexes(agentId: string, sessionId: string): void {
  setRecentIds(agentId, getRecentIds(agentId).filter((id) => id !== sessionId));
  setArchivedIds(agentId, getArchivedIds(agentId).filter((id) => id !== sessionId));
}

export function listBuildTaskSessions(input: BuildTaskHistoryListInput): BuildTaskSessionListResult {
  const agentId = normalizeAgentId(input.agentId);
  const query = normalizeText(input.query).toLowerCase();
  const includeArchived = input.includeArchived === true;
  const requestedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.floor(input.limit) : 50;
  const limit = Math.max(1, Math.min(500, requestedLimit));

  const sessionsById = getSessionMap();
  const ids = [
    ...getRecentIds(agentId),
    ...(includeArchived ? getArchivedIds(agentId) : []),
  ];

  const uniqueIds = Array.from(new Set(ids));
  const sessions = uniqueIds
    .map((id) => sessionsById[id])
    .filter((session): session is BuildTaskSession => Boolean(session && session.agentId === agentId))
    .filter((session) => {
      if (!query) return true;
      return (session.searchText || '').includes(query);
    })
    .sort((a, b) => {
      if ((a.pinned === true) !== (b.pinned === true)) {
        return a.pinned === true ? -1 : 1;
      }
      const byActivity = new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      if (byActivity !== 0) return byActivity;
      return statusRank(a.lifecycleStatus) - statusRank(b.lifecycleStatus);
    })
    .slice(0, limit)
    .map(toListItem);

  return { sessions };
}

export function getBuildTaskSession(sessionId: string): BuildTaskSession | null {
  const id = normalizeText(sessionId);
  if (!id) return null;
  const session = getSessionMap()[id];
  return session || null;
}

export function createBuildTaskSession(input: BuildTaskSessionCreateInput): BuildTaskSession {
  const agentId = normalizeAgentId(input.agentId);
  const now = new Date().toISOString();
  const titleSourcePrompt = normalizeText(input.titleSourcePrompt);
  const goalPrompt = normalizeText(input.goalPrompt);
  const title = normalizeText(input.title) || deriveTitleFromPrompt(titleSourcePrompt || goalPrompt);
  const sessionId = randomUUID();
  const settings = getSettings();

  const created: BuildTaskSession = {
    id: sessionId,
    agentId,
    title,
    titleSourcePrompt,
    searchText: buildSearchText(title, titleSourcePrompt),
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    messages: [],
    runs: [],
    execution: {
      goalPrompt,
      workspaceRelativePath: normalizeText(input.workspaceRelativePath, '.') || '.',
      selectedPresetId: input.selectedPresetId ?? null,
      usageProjectId: input.usageProjectId ?? null,
      runtimeLogs: [],
    },
    renamedByUser: false,
    pinned: false,
  };

  withSessions((sessions) => {
    sessions[sessionId] = created;
  });

  touchRecent(agentId, sessionId);

  const recent = getRecentIds(agentId);
  if (recent.length > settings.maxSessionsPerAgent) {
    const overflow = recent.slice(settings.maxSessionsPerAgent);
    for (const id of overflow) {
      removeFromIndexes(agentId, id);
      withSessions((sessions) => {
        delete sessions[id];
      });
    }
  }

  return created;
}

export function updateBuildTaskSession(input: BuildTaskSessionUpdateInput): BuildTaskSession {
  const id = normalizeText(input.sessionId);
  if (!id) throw new Error('sessionId is required.');
  const sessions = getSessionMap();
  const existing = sessions[id];
  if (!existing) {
    throw new Error('Build task session not found.');
  }

  const now = new Date().toISOString();
  const settings = getSettings();
  const incomingMessages = Array.isArray(input.messages)
    ? input.messages.slice(-settings.maxMessagesPerSession)
    : undefined;
  const shouldPreserveExistingMessages = Boolean(
    incomingMessages
    && incomingMessages.length === 0
    && (existing.messages?.length || 0) > 0
  );
  const updated: BuildTaskSession = {
    ...existing,
    lifecycleStatus: input.lifecycleStatus ?? existing.lifecycleStatus,
    updatedAt: now,
    lastActivityAt: now,
    messages: incomingMessages
      ? (shouldPreserveExistingMessages ? existing.messages : incomingMessages)
      : existing.messages,
    execution: {
      ...existing.execution,
      goalPrompt: input.goalPrompt ?? existing.execution.goalPrompt,
      workspaceRelativePath: input.workspaceRelativePath ?? existing.execution.workspaceRelativePath,
      selectedPresetId: input.selectedPresetId !== undefined ? input.selectedPresetId : existing.execution.selectedPresetId,
      usageProjectId: input.usageProjectId !== undefined ? input.usageProjectId : existing.execution.usageProjectId,
      latestSnapshot: input.latestSnapshot ?? existing.execution.latestSnapshot,
      latestDiff: input.latestDiff !== undefined ? input.latestDiff : existing.execution.latestDiff,
      latestFingerprint: input.latestFingerprint !== undefined ? input.latestFingerprint : existing.execution.latestFingerprint,
      latestQualityCheckRun: input.latestQualityCheckRun !== undefined ? input.latestQualityCheckRun : existing.execution.latestQualityCheckRun,
      runtimeLogs: input.runtimeLogs
        ? input.runtimeLogs.slice(-settings.maxLogsPerSession)
        : existing.execution.runtimeLogs,
    },
  };

  if (input.activeRun) {
    const nextRuns = existing.runs.filter((run) => run.id !== input.activeRun?.id);
    nextRuns.push(input.activeRun);
    updated.runs = nextRuns.slice(-50);
    updated.activeRunId = input.activeRun.id;
  }

  if (!updated.renamedByUser) {
    updated.title = deriveTitleFromPrompt(updated.titleSourcePrompt || updated.execution.goalPrompt);
    updated.searchText = buildSearchText(updated.title, updated.titleSourcePrompt);
  }

  withSessions((sessionMap) => {
    sessionMap[id] = updated;
  });

  if (updated.lifecycleStatus === 'archived') {
    setRecentIds(updated.agentId, getRecentIds(updated.agentId).filter((sessionId) => sessionId !== id));
    const archivedIds = getArchivedIds(updated.agentId).filter((sessionId) => sessionId !== id);
    archivedIds.unshift(id);
    setArchivedIds(updated.agentId, archivedIds);
  } else {
    setArchivedIds(updated.agentId, getArchivedIds(updated.agentId).filter((sessionId) => sessionId !== id));
    touchRecent(updated.agentId, updated.id);
  }

  return updated;
}

export function renameBuildTaskSession(input: BuildTaskSessionRenameInput): BuildTaskSession {
  const id = normalizeText(input.sessionId);
  const title = normalizeText(input.title);
  if (!id || !title) throw new Error('sessionId and title are required.');
  const existing = getBuildTaskSession(id);
  if (!existing) throw new Error('Build task session not found.');

  const now = new Date().toISOString();
  const updated: BuildTaskSession = {
    ...existing,
    title: title.slice(0, 120),
    searchText: buildSearchText(title.slice(0, 120), existing.titleSourcePrompt),
    renamedByUser: true,
    updatedAt: now,
    lastActivityAt: now,
  };

  withSessions((sessions) => {
    sessions[id] = updated;
  });
  touchRecent(updated.agentId, id);
  return updated;
}

export function archiveBuildTaskSession(input: BuildTaskSessionArchiveInput): BuildTaskSession {
  const id = normalizeText(input.sessionId);
  if (!id) throw new Error('sessionId is required.');
  const existing = getBuildTaskSession(id);
  if (!existing) throw new Error('Build task session not found.');

  const now = new Date().toISOString();
  const archived = input.archived === true;
  const updated: BuildTaskSession = {
    ...existing,
    lifecycleStatus: archived ? 'archived' : 'active',
    archivedAt: archived ? now : undefined,
    updatedAt: now,
    lastActivityAt: now,
  };

  withSessions((sessions) => {
    sessions[id] = updated;
  });

  if (archived) {
    setRecentIds(updated.agentId, getRecentIds(updated.agentId).filter((sessionId) => sessionId !== id));
    const archivedIds = getArchivedIds(updated.agentId).filter((sessionId) => sessionId !== id);
    archivedIds.unshift(id);
    setArchivedIds(updated.agentId, archivedIds);
  } else {
    setArchivedIds(updated.agentId, getArchivedIds(updated.agentId).filter((sessionId) => sessionId !== id));
    touchRecent(updated.agentId, id);
  }

  return updated;
}

export function setPinnedBuildTaskSession(input: BuildTaskSessionPinInput): BuildTaskSession {
  const id = normalizeText(input.sessionId);
  if (!id) throw new Error('sessionId is required.');
  const existing = getBuildTaskSession(id);
  if (!existing) throw new Error('Build task session not found.');
  const now = new Date().toISOString();
  const pinned = input.pinned === true;
  const updated: BuildTaskSession = {
    ...existing,
    pinned,
    pinnedAt: pinned ? now : undefined,
    updatedAt: now,
    lastActivityAt: now,
  };
  withSessions((sessions) => {
    sessions[id] = updated;
  });
  if (updated.lifecycleStatus !== 'archived') {
    touchRecent(updated.agentId, updated.id);
  }
  return updated;
}

export function deleteBuildTaskSession(input: BuildTaskSessionDeleteInput): { ok: boolean } {
  const id = normalizeText(input.sessionId);
  if (!id) return { ok: false };
  const existing = getBuildTaskSession(id);
  if (!existing) return { ok: false };

  removeFromIndexes(existing.agentId, id);
  withSessions((sessions) => {
    delete sessions[id];
  });
  return { ok: true };
}
