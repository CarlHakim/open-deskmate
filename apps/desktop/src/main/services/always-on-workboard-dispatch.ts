import type {
  AgentProfile,
  TaskResult,
  UsageProject,
  UsageProjectKanbanColumn,
  UsageProjectWorkItem,
  UsageProjectWorkItemNote,
} from '@accomplish/shared';
import { getActiveAgentEngineTaskIds, getAgentEngineTaskConfig, startAgentEngineTask } from '../runtime/agent-engine';
import { listAgents } from '../store/agents';
import {
  getUsageProject,
  listUsageProjectKanbanColumns,
  listUsageProjects,
  listUsageProjectWorkItems,
  updateUsageProjectWorkItem,
} from '../store/usageProjects';
import { recordAuditEvent } from '../store/auditEvents';

export type AlwaysOnWorkboardDispatchState = 'queued' | 'active' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface AlwaysOnWorkboardDispatchRecord {
  taskId: string;
  agentId: string;
  state: AlwaysOnWorkboardDispatchState;
  source: 'workboard';
  usageProjectId: string;
  workItemId: string;
  workItemTitle: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
  error?: string;
}

type ReadyWorkItemMatch = {
  project: UsageProject;
  item: UsageProjectWorkItem;
  columns: UsageProjectKanbanColumn[];
};

const WORKBOARD_DISPATCH_TICK_MS = 15_000;
const WORKBOARD_DISPATCH_HEARTBEAT_AUDIT_MS = 5 * 60_000;
const BACKGROUND_TASK_PREFIXES = [
  'gateway_',
  'heartbeat_',
  'schedule_',
  'webhook_',
  'manual_',
  'workboard_',
  'discord_',
  'telegram_',
  'slack_',
  'matrix_',
  'msteams_',
  'mattermost_',
  'googlechat_',
  'signal_',
  'whatsapp_',
  'line_',
  'bluebubbles_',
  'imessage_',
  'nextcloud-talk_',
  'nostr_',
  'tlon_',
  'zalo_',
  'zalouser_',
];

let dispatchTimer: NodeJS.Timeout | null = null;
let lastHeartbeatAuditAt = 0;

const dispatchRecords = new Map<string, AlwaysOnWorkboardDispatchRecord>();
const inFlightWorkItemIds = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function isBackgroundTaskId(taskId: string): boolean {
  return BACKGROUND_TASK_PREFIXES.some((prefix) => taskId.startsWith(prefix));
}

function createWorkboardTaskId(): string {
  return `workboard_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function priorityRank(priority: UsageProjectWorkItem['priority']): number {
  switch (priority) {
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    case 'normal':
      return 2;
    case 'low':
      return 3;
    default:
      return 4;
  }
}

function sortReadyItems(a: UsageProjectWorkItem, b: UsageProjectWorkItem): number {
  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;
  const aDue = a.dueDate || '9999-12-31T23:59:59.999Z';
  const bDue = b.dueDate || '9999-12-31T23:59:59.999Z';
  const due = aDue.localeCompare(bDue);
  if (due !== 0) return due;
  return a.createdAt.localeCompare(b.createdAt);
}

function isReadyColumn(column: UsageProjectKanbanColumn): boolean {
  return column.name.trim().toLowerCase() === 'ready';
}

function getColumnByName(columns: UsageProjectKanbanColumn[], names: string[]): UsageProjectKanbanColumn | undefined {
  const lowered = names.map((name) => name.toLowerCase());
  return columns.find((column) => lowered.includes(column.name.trim().toLowerCase()));
}

function getInProgressColumnId(columns: UsageProjectKanbanColumn[]): string | undefined {
  return getColumnByName(columns, ['in progress', 'doing', 'active'])?.id;
}

function getDoneColumnId(columns: UsageProjectKanbanColumn[]): string | undefined {
  return columns.find((column) => column.doneState)?.id || getColumnByName(columns, ['done', 'complete', 'completed'])?.id;
}

function getBlockedColumnId(columns: UsageProjectKanbanColumn[]): string | undefined {
  return getColumnByName(columns, ['waiting', 'blocked', 'on hold'])?.id;
}

function makeNote(title: string, text: string): UsageProjectWorkItemNote {
  return {
    id: `workboard_note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    title,
    text: text.slice(0, 100_000),
    createdAt: nowIso(),
  };
}

function appendWorkItemNote(item: UsageProjectWorkItem, title: string, text: string): UsageProjectWorkItemNote[] {
  return [makeNote(title, text), ...(item.notes || [])];
}

function isAgentForegroundBusy(agentId: string): boolean {
  const normalizedAgentId = normalizeAgentId(agentId);
  return getActiveAgentEngineTaskIds().some((taskId) => {
    if (isBackgroundTaskId(taskId)) return false;
    const config = getAgentEngineTaskConfig(taskId) as { agentId?: string } | undefined;
    return normalizeAgentId(config?.agentId) === normalizedAgentId;
  });
}

function hasActiveWorkboardDispatch(agentId: string): boolean {
  const normalizedAgentId = normalizeAgentId(agentId);
  return Array.from(dispatchRecords.values()).some((record) =>
    normalizeAgentId(record.agentId) === normalizedAgentId
    && (record.state === 'queued' || record.state === 'active')
  );
}

function getConfiguredActiveProjectIds(agent: AgentProfile): string[] {
  const activeProjectIds = new Set(listUsageProjects().map((project) => project.id));
  return (agent.alwaysOnWorkboardProjectIds || [])
    .map((projectId) => projectId.trim())
    .filter((projectId, index, all) => projectId && all.indexOf(projectId) === index && activeProjectIds.has(projectId));
}

function findReadyWorkItemForAgent(agent: AgentProfile): ReadyWorkItemMatch | null {
  for (const projectId of getConfiguredActiveProjectIds(agent)) {
    const project = getUsageProject(projectId);
    if (!project || project.status !== 'active') continue;
    const columns = listUsageProjectKanbanColumns(project.id);
    const readyStatusIds = new Set(columns.filter(isReadyColumn).map((column) => column.id));
    if (readyStatusIds.size === 0) continue;

    const item = listUsageProjectWorkItems(project.id)
      .filter((entry) =>
        readyStatusIds.has(entry.statusId)
        && !entry.archived
        && !entry.completedAt
        && !entry.blocked
        && entry.assigneeIds.includes(agent.id)
        && !inFlightWorkItemIds.has(entry.id)
      )
      .sort(sortReadyItems)[0];

    if (item) {
      return { project, item, columns };
    }
  }
  return null;
}

function recordDispatchAudit(input: {
  action: string;
  title: string;
  status?: 'info' | 'success' | 'warning' | 'error';
  summary?: string;
  agentId?: string;
  taskId?: string;
  projectId?: string;
  workItemId?: string;
  metadata?: Record<string, unknown>;
}): void {
  try {
    recordAuditEvent({
      category: 'always_on',
      action: input.action,
      title: input.title,
      summary: input.summary,
      status: input.status || 'info',
      agentId: input.agentId,
      taskId: input.taskId,
      projectId: input.projectId,
      targetType: input.workItemId ? 'workboard_item' : 'workboard_dispatcher',
      targetId: input.workItemId || input.projectId || 'workboard-dispatch',
      source: 'always-on-workboard-dispatch',
      jump: input.projectId
        ? {
            kind: 'project_management',
            projectId: input.projectId,
            workItemId: input.workItemId,
          }
        : { kind: 'audit' },
      metadata: input.metadata,
    });
  } catch {
    // Audit must not break background dispatch.
  }
}

function recordHeartbeatAudit(enabledAgentCount: number): void {
  const now = Date.now();
  if (now - lastHeartbeatAuditAt < WORKBOARD_DISPATCH_HEARTBEAT_AUDIT_MS) return;
  lastHeartbeatAuditAt = now;
  recordDispatchAudit({
    action: 'workboard_dispatch.heartbeat',
    title: 'Workboard dispatch heartbeat',
    summary: `${enabledAgentCount} agent(s) configured for Workboard dispatch.`,
    metadata: {
      enabledAgentCount,
      activeTaskIds: listActiveWorkboardTaskIds(),
      queuedTaskIds: listQueuedWorkboardTaskIds(),
    },
  });
}

function buildDispatchPrompt(params: {
  agent: AgentProfile;
  project: UsageProject;
  item: UsageProjectWorkItem;
  columns: UsageProjectKanbanColumn[];
}): string {
  const { project, item, columns } = params;
  const statusName = columns.find((column) => column.id === item.statusId)?.name || item.statusId;
  const checklist = [
    ...(item.checklist || []).map((entry) => `- [${entry.completed ? 'x' : ' '}] ${entry.text}`),
    ...(item.checklistLists || []).flatMap((list) => [
      `\n${list.name}:`,
      ...list.items.map((entry) => `- [${entry.completed ? 'x' : ' '}] ${entry.text}`),
    ]),
  ].filter(Boolean).join('\n');
  const sources = [
    ...(item.sources || []).map((source) => `- ${source.title}: ${source.url}`),
    ...(item.documents || []).map((document) => `- ${document.label}: ${document.url || document.path || ''}`),
  ].filter(Boolean).join('\n');
  const notes = (item.notes || [])
    .slice(0, 5)
    .map((note) => `## ${note.title || 'Note'}\n${note.text}`)
    .join('\n\n');

  return [
    'Always-On Workboard dispatch:',
    `Project: ${project.name} (${project.id})`,
    `Work item: ${item.title} (${item.id})`,
    `Status: ${statusName}`,
    `Priority: ${item.priority}`,
    item.dueDate ? `Due: ${item.dueDate}` : '',
    '',
    item.description ? `Description:\n${item.description}` : '',
    checklist ? `Checklist:\n${checklist}` : '',
    sources ? `Sources and documents:\n${sources}` : '',
    notes ? `Recent notes:\n${notes}` : '',
    '',
    'Work on this item now. Use the available project, filesystem, browser, and Workboard tools as needed.',
    'When the work is complete, provide a concise completion summary. If blocked, explain the blocker and what is needed next.',
  ].filter(Boolean).join('\n');
}

function markItemStarted(params: {
  item: UsageProjectWorkItem;
  columns: UsageProjectKanbanColumn[];
  taskId: string;
  agentId: string;
}): void {
  const statusId = getInProgressColumnId(params.columns);
  updateUsageProjectWorkItem(params.item.id, {
    statusId,
    notes: appendWorkItemNote(
      params.item,
      'Always-On dispatch started',
      `Agent ${params.agentId} started this Workboard item in task ${params.taskId}.`
    ),
  });
}

function findLatestWorkItem(projectId: string, itemId: string): UsageProjectWorkItem | null {
  return listUsageProjectWorkItems(projectId, { includeArchived: true }).find((item) => item.id === itemId) || null;
}

function markItemCompleted(record: AlwaysOnWorkboardDispatchRecord, result: TaskResult): void {
  const item = findLatestWorkItem(record.usageProjectId, record.workItemId);
  if (!item) return;
  const columns = listUsageProjectKanbanColumns(record.usageProjectId);
  updateUsageProjectWorkItem(item.id, {
    statusId: getDoneColumnId(columns),
    completedAt: nowIso(),
    blocked: false,
    blockedReason: '',
    notes: appendWorkItemNote(
      item,
      'Always-On dispatch completed',
      `Task ${record.taskId} completed successfully.${result.sessionId ? ` Session: ${result.sessionId}.` : ''}`
    ),
  });
}

function markItemBlocked(record: AlwaysOnWorkboardDispatchRecord, reason: string): void {
  const item = findLatestWorkItem(record.usageProjectId, record.workItemId);
  if (!item) return;
  const columns = listUsageProjectKanbanColumns(record.usageProjectId);
  updateUsageProjectWorkItem(item.id, {
    statusId: getBlockedColumnId(columns),
    blocked: true,
    blockedReason: reason.slice(0, 300) || 'Always-On dispatch blocked.',
    notes: appendWorkItemNote(item, 'Always-On dispatch blocked', reason),
  });
}

async function runDispatch(agent: AgentProfile, match: ReadyWorkItemMatch): Promise<void> {
  const taskId = createWorkboardTaskId();
  const record: AlwaysOnWorkboardDispatchRecord = {
    taskId,
    agentId: agent.id,
    state: 'queued',
    source: 'workboard',
    usageProjectId: match.project.id,
    workItemId: match.item.id,
    workItemTitle: match.item.title,
    queuedAt: nowIso(),
    detail: 'Queued Workboard item dispatch.',
  };
  dispatchRecords.set(taskId, record);
  inFlightWorkItemIds.add(match.item.id);
  recordDispatchAudit({
    action: 'workboard_dispatch.queued',
    title: `Queued Workboard item ${match.item.title}`,
    agentId: agent.id,
    taskId,
    projectId: match.project.id,
    workItemId: match.item.id,
    metadata: { priority: match.item.priority, statusId: match.item.statusId },
  });

  try {
    markItemStarted({ item: match.item, columns: match.columns, taskId, agentId: agent.id });
    record.state = 'active';
    record.startedAt = nowIso();
    record.detail = 'Running Workboard item dispatch.';
    recordDispatchAudit({
      action: 'workboard_dispatch.started',
      title: `Started Workboard item ${match.item.title}`,
      status: 'success',
      agentId: agent.id,
      taskId,
      projectId: match.project.id,
      workItemId: match.item.id,
    });

    const { completion } = await startAgentEngineTask(
      {
        prompt: buildDispatchPrompt({ agent, project: match.project, item: match.item, columns: match.columns }),
        taskId,
        agentId: agent.id,
        usageProjectId: match.project.id,
      },
      {
        source: 'workboard',
        internal: {
          suppressAgenticLoop: false,
        },
      }
    );
    const result = await completion;
    record.finishedAt = nowIso();

    if (result.status === 'success') {
      record.state = 'completed';
      record.detail = 'Workboard item completed.';
      markItemCompleted(record, result);
      recordDispatchAudit({
        action: 'workboard_dispatch.completed',
        title: `Completed Workboard item ${match.item.title}`,
        status: 'success',
        agentId: agent.id,
        taskId,
        projectId: match.project.id,
        workItemId: match.item.id,
        metadata: { resultStatus: result.status, sessionId: result.sessionId, durationMs: result.durationMs },
      });
      return;
    }

    const reason = result.error || (result.status === 'interrupted' ? 'Task interrupted.' : 'Task failed.');
    record.state = 'blocked';
    record.error = reason;
    record.detail = 'Workboard item blocked by task result.';
    markItemBlocked(record, reason);
    recordDispatchAudit({
      action: 'workboard_dispatch.blocked',
      title: `Blocked Workboard item ${match.item.title}`,
      summary: reason,
      status: 'warning',
      agentId: agent.id,
      taskId,
      projectId: match.project.id,
      workItemId: match.item.id,
      metadata: { resultStatus: result.status, sessionId: result.sessionId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Workboard dispatch failed.');
    record.state = record.startedAt ? 'blocked' : 'failed';
    record.finishedAt = nowIso();
    record.error = message;
    record.detail = record.startedAt ? 'Workboard item blocked by dispatch failure.' : 'Failed before task execution.';
    if (record.startedAt) {
      markItemBlocked(record, message);
    }
    recordDispatchAudit({
      action: 'workboard_dispatch.failed',
      title: `Workboard dispatch failed for ${match.item.title}`,
      summary: message,
      status: 'error',
      agentId: agent.id,
      taskId,
      projectId: match.project.id,
      workItemId: match.item.id,
      metadata: { started: Boolean(record.startedAt) },
    });
  } finally {
    inFlightWorkItemIds.delete(match.item.id);
  }
}

async function tickWorkboardDispatch(): Promise<void> {
  const agents = listAgents().filter((agent) =>
    agent.alwaysOnEnabled === true
    && agent.alwaysOnWorkboardDispatchEnabled === true
    && getConfiguredActiveProjectIds(agent).length > 0
  );
  recordHeartbeatAudit(agents.length);

  for (const agent of agents) {
    if (isAgentForegroundBusy(agent.id)) {
      continue;
    }
    if (hasActiveWorkboardDispatch(agent.id)) {
      continue;
    }
    let match: ReadyWorkItemMatch | null = null;
    try {
      match = findReadyWorkItemForAgent(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Workboard scan failed.');
      recordDispatchAudit({
        action: 'workboard_dispatch.failed',
        title: 'Workboard dispatch scan failed',
        summary: message,
        status: 'error',
        agentId: agent.id,
      });
      continue;
    }
    if (!match) {
      continue;
    }
    void runDispatch(agent, match);
  }
}

export function startAlwaysOnWorkboardDispatchService(): void {
  if (dispatchTimer) return;
  recordDispatchAudit({
    action: 'workboard_dispatch.started',
    title: 'Workboard dispatch service started',
    status: 'success',
  });
  dispatchTimer = setInterval(() => {
    void tickWorkboardDispatch();
  }, WORKBOARD_DISPATCH_TICK_MS);
  void tickWorkboardDispatch();
}

export function stopAlwaysOnWorkboardDispatchService(): void {
  if (!dispatchTimer) return;
  clearInterval(dispatchTimer);
  dispatchTimer = null;
  for (const record of dispatchRecords.values()) {
    if (record.state === 'queued') {
      record.state = 'cancelled';
      record.finishedAt = nowIso();
      record.detail = 'Workboard dispatch service stopped.';
    }
  }
  recordDispatchAudit({
    action: 'workboard_dispatch.stopped',
    title: 'Workboard dispatch service stopped',
  });
}

export function listAlwaysOnWorkboardDispatchRecords(): AlwaysOnWorkboardDispatchRecord[] {
  return Array.from(dispatchRecords.values());
}

export function listQueuedWorkboardTaskIds(): string[] {
  return listAlwaysOnWorkboardDispatchRecords()
    .filter((record) => record.state === 'queued')
    .map((record) => record.taskId);
}

export function listActiveWorkboardTaskIds(): string[] {
  return listAlwaysOnWorkboardDispatchRecords()
    .filter((record) => record.state === 'active')
    .map((record) => record.taskId);
}

export const __alwaysOnWorkboardDispatchTest = {
  findReadyWorkItemForAgent,
  isReadyColumn,
  sortReadyItems,
  buildDispatchPrompt,
};
