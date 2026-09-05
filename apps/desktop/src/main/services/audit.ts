import { createHash } from 'crypto';
import type {
  AuditEventCategory,
  AuditEventRecord,
  AuditEventStatus,
  AuditExportRequest,
  AuditExportResult,
  AuditGetRequest,
  AuditListRequest,
  AuditListResult,
  BuildTaskSession,
  TaskMessage,
} from '@accomplish/shared';
import { listAgents } from '../store/agents';
import { getBuildTaskSession, listBuildTaskSessions } from '../store/buildTaskHistory';
import { listConnectorDeliveries } from '../store/connectorDeliveries';
import { listExecutionProfiles } from '../store/executionProfiles';
import { listGatewayConnectorDiscovery } from '../store/gatewayConnectorDiscovery';
import { listSchedules } from '../store/schedules';
import { getTasks } from '../store/taskHistory';
import {
  getStoredAuditEvent,
  listStoredAuditEvents,
  recordAuditEvent,
  type AuditEventInput,
} from '../store/auditEvents';
import { listMemoryChangeHistory } from './memory';
import { listUserSkills } from './user-skills';
import { getPluginDiagnosticsState } from '../plugins/plugin-diagnostics-store';
import { getAlwaysOnStatusSnapshot } from './always-on-status';

const DEFAULT_AUDIT_LIMIT = 100;
const MAX_AUDIT_LIMIT = 1000;

function stableAuditId(prefix: string, parts: Array<string | undefined | null>): string {
  const hash = createHash('sha1')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 20);
  return `${prefix}_${hash}`;
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_AUDIT_LIMIT;
  return Math.max(1, Math.min(MAX_AUDIT_LIMIT, Math.floor(limit)));
}

function normalizeQuery(query: unknown): string {
  return typeof query === 'string' ? query.trim().toLowerCase() : '';
}

function normalizeFilter(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function eventField(event: AuditEventRecord, field: keyof AuditEventRecord): string {
  const value = event[field];
  return typeof value === 'string' ? value : '';
}

function matchesFilter(event: AuditEventRecord, field: keyof AuditEventRecord, expected: unknown): boolean {
  const normalizedExpected = normalizeFilter(expected);
  if (!normalizedExpected) return true;
  return eventField(event, field).toLowerCase() === normalizedExpected;
}

function statusFromActivity(value: unknown): AuditEventStatus {
  return value === 'error'
    ? 'error'
    : value === 'warning'
      ? 'warning'
      : value === 'success'
        ? 'success'
        : 'info';
}

function statusFromDelivery(value: string): AuditEventStatus {
  if (value === 'failed') return 'error';
  if (value === 'sent') return 'success';
  if (value === 'silenced' || value === 'filtered') return 'warning';
  return 'info';
}

function statusFromTask(value: string): AuditEventStatus {
  if (value === 'failed') return 'error';
  if (value === 'cancelled' || value === 'interrupted') return 'warning';
  if (value === 'completed') return 'success';
  return 'info';
}

function searchableText(event: AuditEventRecord): string {
  return [
    event.category,
    event.action,
    event.title,
    event.summary,
    event.agentId,
    event.taskId,
    event.projectId,
    event.connectorId,
    event.connectorInstanceId,
    event.skillId,
    event.memoryKind,
    event.targetType,
    event.targetId,
    event.source,
    event.jump ? JSON.stringify(event.jump) : '',
    event.metadata ? JSON.stringify(event.metadata) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesRequest(event: AuditEventRecord, request: AuditListRequest): boolean {
  if (request.category && event.category !== request.category) return false;
  if (request.status && event.status !== request.status) return false;
  if (!matchesFilter(event, 'agentId', request.agentId)) return false;
  if (!matchesFilter(event, 'taskId', request.taskId)) return false;
  if (!matchesFilter(event, 'projectId', request.projectId)) return false;
  if (!matchesFilter(event, 'connectorId', request.connectorId)) return false;
  if (!matchesFilter(event, 'connectorInstanceId', request.connectorInstanceId)) return false;
  if (!matchesFilter(event, 'skillId', request.skillId)) return false;
  if (!matchesFilter(event, 'memoryKind', request.memoryKind)) return false;
  if (!matchesFilter(event, 'targetType', request.targetType)) return false;
  if (!matchesFilter(event, 'targetId', request.targetId)) return false;
  if (request.includeDerived === false && event.derived) return false;
  if (request.since && event.timestamp < request.since) return false;
  if (request.until && event.timestamp > request.until) return false;
  const query = normalizeQuery(request.query);
  if (query && !searchableText(event).includes(query)) return false;
  return true;
}

function summarizeToolMessage(message: TaskMessage): string {
  return [
    message.content,
    typeof message.toolInput === 'undefined' ? '' : JSON.stringify(message.toolInput),
  ].filter(Boolean).join('\n\n').slice(0, 2000);
}

function toolUseEventsFromMessages(params: {
  messages: TaskMessage[];
  agentId?: string;
  taskId?: string;
  projectId?: string | null;
  buildSessionId?: string;
  source: string;
}): AuditEventRecord[] {
  return params.messages
    .filter((message) => message.type === 'tool' || Boolean(message.toolName))
    .map((message) => ({
      id: stableAuditId('tool_message', [
        params.source,
        params.taskId,
        params.buildSessionId,
        message.id,
        message.timestamp,
      ]),
      category: 'tool_use' as AuditEventCategory,
      action: 'tool_message',
      title: `${message.toolName || 'Tool'} call`,
      summary: summarizeToolMessage(message),
      status: /(?:\berror\b|\bfailed\b|exception)/i.test(message.content) ? 'error' : 'success',
      timestamp: message.timestamp,
      agentId: params.agentId,
      taskId: params.taskId,
      projectId: params.projectId || undefined,
      targetType: 'tool',
      targetId: message.toolName || message.id,
      source: params.source,
      derived: true,
      jump: params.buildSessionId
        ? {
            kind: 'build',
            sessionId: params.buildSessionId,
            taskId: params.taskId,
            agentId: params.agentId,
            messageId: message.id,
          }
        : {
            kind: 'chat',
            taskId: params.taskId,
            agentId: params.agentId,
            messageId: message.id,
          },
      metadata: {
        messageId: message.id,
        messageType: message.type,
        toolName: message.toolName,
        toolInput: message.toolInput,
        buildSessionId: params.buildSessionId,
      },
    }));
}

function toTaskAuditEvents(): AuditEventRecord[] {
  const events: AuditEventRecord[] = [];
  for (const task of getTasks()) {
    if (task.privacyMode === 'incognito') continue;
    events.push({
      id: stableAuditId('task', [task.id, 'created', task.createdAt]),
      category: 'task',
      action: 'created',
      title: task.summary || task.prompt.slice(0, 120) || 'Task created',
      summary: task.prompt,
      status: statusFromTask(task.status),
      timestamp: task.createdAt,
      agentId: task.agentId,
      taskId: task.id,
      projectId: task.usageProjectId || undefined,
      targetType: 'task',
      targetId: task.id,
      source: 'task-history',
      derived: true,
      jump: {
        kind: 'chat',
        agentId: task.agentId,
        taskId: task.id,
      },
      metadata: {
        status: task.status,
        sessionId: task.sessionId,
        workingDirectory: task.workingDirectory,
        usageProjectId: task.usageProjectId,
      },
    });

    for (const activity of task.activity || []) {
      const category: AuditEventCategory = activity.toolName || activity.kind === 'tool_started' || activity.kind === 'tool_finished'
        ? 'tool_use'
        : 'task';
      events.push({
        id: stableAuditId('task_activity', [task.id, activity.id, activity.timestamp]),
        category,
        action: activity.kind,
        title: activity.title,
        summary: activity.detail,
        status: statusFromActivity(activity.status),
        timestamp: activity.timestamp,
        agentId: activity.agentId || task.agentId,
        taskId: task.id,
        projectId: task.usageProjectId || undefined,
        targetType: activity.toolName ? 'tool' : 'task',
        targetId: activity.toolName || task.id,
        source: 'task-activity',
        derived: true,
        jump: {
          kind: 'chat',
          agentId: activity.agentId || task.agentId,
          taskId: task.id,
          messageId: activity.messageId,
        },
        metadata: {
          kind: activity.kind,
          toolName: activity.toolName,
          messageId: activity.messageId,
          recoverable: activity.recoverable,
          subagentRunId: activity.subagentRunId,
          subagentTaskId: activity.subagentTaskId,
          parentTaskId: activity.parentTaskId,
          recoveryId: activity.recoveryId,
          usageProjectId: task.usageProjectId,
          activityMetadata: activity.metadata,
        },
      });
    }

    events.push(...toolUseEventsFromMessages({
      messages: task.messages || [],
      agentId: task.agentId,
      taskId: task.id,
      projectId: task.usageProjectId,
      source: 'task-messages',
    }));
  }
  return events;
}

function listBuildSessionsForAudit(): BuildTaskSession[] {
  const sessions: BuildTaskSession[] = [];
  for (const agent of listAgents()) {
    for (const item of listBuildTaskSessions({ agentId: agent.id, includeArchived: true, limit: 500 }).sessions) {
      const session = getBuildTaskSession(item.id);
      if (session) sessions.push(session);
    }
  }
  return sessions;
}

function toBuildAuditEvents(): AuditEventRecord[] {
  const events: AuditEventRecord[] = [];
  for (const session of listBuildSessionsForAudit()) {
    const latestRun = session.runs[session.runs.length - 1];
    events.push({
      id: stableAuditId('build_session', [session.id, session.lifecycleStatus, session.updatedAt]),
      category: 'task',
      action: `build_${session.lifecycleStatus}`,
      title: session.title || 'Build session',
      summary: session.execution.goalPrompt || session.titleSourcePrompt,
      status: session.lifecycleStatus === 'failed'
        ? 'error'
        : session.lifecycleStatus === 'completed'
          ? 'success'
          : session.lifecycleStatus === 'interrupted' || session.lifecycleStatus === 'archived'
            ? 'warning'
            : 'info',
      timestamp: session.lastActivityAt || session.updatedAt,
      agentId: session.agentId,
      taskId: latestRun?.taskId,
      projectId: session.execution.usageProjectId || undefined,
      targetType: 'build_session',
      targetId: session.id,
      source: 'build-task-history',
      derived: true,
      jump: {
        kind: 'build',
        agentId: session.agentId,
        sessionId: session.id,
        taskId: latestRun?.taskId,
      },
      metadata: {
        lifecycleStatus: session.lifecycleStatus,
        workspaceRelativePath: session.execution.workspaceRelativePath,
        selectedPresetId: session.execution.selectedPresetId,
        usageProjectId: session.execution.usageProjectId,
        latestRunStatus: latestRun?.status,
      },
    });

    events.push(...toolUseEventsFromMessages({
      messages: session.messages || [],
      agentId: session.agentId,
      taskId: latestRun?.taskId,
      projectId: session.execution.usageProjectId,
      buildSessionId: session.id,
      source: 'build-messages',
    }));
  }
  return events;
}

function toBuildRuntimeAuditEvents(): AuditEventRecord[] {
  const events: AuditEventRecord[] = [];
  for (const session of listBuildSessionsForAudit()) {
    const snapshot = session.execution.latestSnapshot;
    const latestRun = session.runs[session.runs.length - 1];
    if (snapshot) {
      events.push({
        id: stableAuditId('build_runtime', [session.id, snapshot.runtime.status, snapshot.runtime.startedAt, snapshot.runtime.stoppedAt, session.updatedAt]),
        category: 'build_runtime',
        action: snapshot.runtime.status,
        title: `${session.title || 'Build'} runtime ${snapshot.runtime.status}`,
        summary: [
          snapshot.runtime.activeCommand,
          snapshot.runtime.previewUrl,
          snapshot.runtime.healthMessage,
          snapshot.runtime.lastError,
        ].filter(Boolean).join(' - '),
        status: snapshot.runtime.status === 'error'
          ? 'error'
          : snapshot.runtime.status === 'running'
            ? 'success'
            : 'info',
        timestamp: snapshot.runtime.lastHealthCheckAt || snapshot.runtime.startedAt || session.updatedAt,
        agentId: session.agentId,
        taskId: latestRun?.taskId,
        projectId: session.execution.usageProjectId || undefined,
        targetType: 'build_runtime',
        targetId: session.id,
        source: 'build-runtime-snapshot',
        derived: true,
        jump: {
          kind: 'build',
          agentId: session.agentId,
          sessionId: session.id,
          taskId: latestRun?.taskId,
        },
        metadata: {
          workspaceRelativePath: snapshot.workspaceRelativePath,
          runtimeAdapterId: snapshot.detection.runtimeAdapterId,
          projectType: snapshot.detection.projectType,
          mode: snapshot.runtime.mode,
          port: snapshot.runtime.port,
          previewUrl: snapshot.runtime.previewUrl,
          restartCount: snapshot.runtime.restartCount,
          crashCount: snapshot.runtime.crashCount,
          healthy: snapshot.runtime.healthy,
        },
      });
    }

    const qualityRun = session.execution.latestQualityCheckRun;
    if (qualityRun) {
      for (const check of qualityRun.checks) {
        events.push({
          id: stableAuditId('build_quality', [session.id, qualityRun.id, check.kind, check.startedAt, check.completedAt]),
          category: 'build_runtime',
          action: `quality_${check.kind}`,
          title: check.label || `${check.kind} quality check`,
          summary: check.summary || check.output,
          status: check.status === 'failed'
            ? 'error'
            : check.status === 'success'
              ? 'success'
              : check.status === 'skipped'
                ? 'warning'
                : 'info',
          timestamp: check.completedAt || check.startedAt || qualityRun.completedAt || qualityRun.startedAt,
          agentId: session.agentId,
          taskId: latestRun?.taskId,
          projectId: session.execution.usageProjectId || undefined,
          targetType: 'build_quality_check',
          targetId: `${qualityRun.id}:${check.kind}`,
          source: 'build-quality-checks',
          derived: true,
          jump: {
            kind: 'build',
            agentId: session.agentId,
            sessionId: session.id,
            taskId: latestRun?.taskId,
          },
          metadata: {
            runId: qualityRun.id,
            kind: check.kind,
            command: check.command,
            exitCode: check.exitCode,
            durationMs: check.durationMs,
            workspaceRelativePath: qualityRun.workspaceRelativePath,
          },
        });
      }
    }
  }
  return events;
}

function toGitAuditEvents(): AuditEventRecord[] {
  const events: AuditEventRecord[] = [];
  for (const session of listBuildSessionsForAudit()) {
    const fingerprint = session.execution.latestFingerprint;
    const git = fingerprint?.git;
    if (!fingerprint || !git?.available) continue;
    const latestRun = session.runs[session.runs.length - 1];
    events.push({
      id: stableAuditId('git', [session.id, fingerprint.generatedAt, git.branch, git.commit, String(git.dirty)]),
      category: 'git',
      action: git.dirty ? 'dirty' : 'snapshot',
      title: `${session.title || 'Build'} Git ${git.branch || 'repository'}`,
      summary: [
        git.branch,
        git.shortCommit || git.commit,
        git.dirty ? 'dirty' : 'clean',
        fingerprint.workspaceRelativePath,
      ].filter(Boolean).join(' - '),
      status: git.dirty ? 'warning' : 'success',
      timestamp: fingerprint.generatedAt,
      agentId: session.agentId,
      taskId: latestRun?.taskId,
      projectId: session.execution.usageProjectId || undefined,
      targetType: 'git_repository',
      targetId: fingerprint.workspaceRelativePath || session.id,
      source: 'build-workspace-fingerprint',
      derived: true,
      jump: {
        kind: 'build',
        agentId: session.agentId,
        sessionId: session.id,
        taskId: latestRun?.taskId,
        path: fingerprint.workspaceRoot,
      },
      metadata: {
        workspaceRoot: fingerprint.workspaceRoot,
        workspaceRelativePath: fingerprint.workspaceRelativePath,
        branch: git.branch,
        commit: git.commit,
        shortCommit: git.shortCommit,
        dirty: git.dirty,
      },
    });
  }
  return events;
}

function toMemoryAuditEvents(): AuditEventRecord[] {
  return listMemoryChangeHistory(500).map((change) => ({
    id: stableAuditId('memory', [change.id, change.createdAt]),
    category: 'memory',
    action: change.status,
    title: `${change.kind} memory ${change.mode}`,
    summary: change.reason || change.preview.afterExcerpt || change.relativePath || change.filePath,
    status: change.status === 'reverted' ? 'warning' : 'success',
    timestamp: change.appliedAt || change.createdAt,
    agentId: change.agentId,
    taskId: change.taskId,
    memoryKind: change.kind,
    targetType: 'memory_file',
    targetId: change.relativePath || change.filePath,
    source: 'memory-change-history',
    derived: true,
    jump: {
      kind: 'memory',
      agentId: change.agentId,
      taskId: change.taskId,
      memoryKind: change.kind,
      path: change.filePath,
    },
    metadata: {
      changeId: change.id,
      kind: change.kind,
      mode: change.mode,
      filePath: change.filePath,
      relativePath: change.relativePath,
      beforeBytes: change.preview.beforeBytes,
      afterBytes: change.preview.afterBytes,
    },
  }));
}

function toSkillAuditEvents(): AuditEventRecord[] {
  const agents = listAgents();
  const seen = new Set<string>();
  const events: AuditEventRecord[] = [];
  const agentIds = agents.length > 0 ? agents.map((agent) => agent.id) : [undefined];

  for (const agentId of agentIds) {
    try {
      for (const skill of listUserSkills({ agentId }).skills) {
        const key = `${skill.source}:${skill.id}:${skill.baseDir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const manifest = skill.manifest;
        events.push({
          id: stableAuditId('skill', [key, manifest?.updatedAt || manifest?.createdAt || skill.filePath]),
          category: 'skill',
          action: manifest?.state || 'discovered',
          title: skill.name,
          summary: skill.description || skill.bodyPreview,
          status: manifest?.state === 'disabled' || manifest?.state === 'deprecated' ? 'warning' : 'info',
          timestamp: manifest?.updatedAt || manifest?.createdAt || new Date(0).toISOString(),
          agentId: skill.visibilityOwnerAgentId,
          skillId: skill.id,
          targetType: 'skill',
          targetId: skill.id,
          source: 'user-skills',
          derived: true,
          jump: {
            kind: 'skill',
            agentId: skill.visibilityOwnerAgentId,
            skillId: skill.id,
            path: skill.filePath,
          },
          metadata: {
            source: skill.source,
            version: manifest?.version,
            editable: skill.editable,
            generatedByAgentName: skill.generatedByAgentName,
            originLabel: skill.originLabel,
            visibilityScope: skill.visibilityScope,
          },
        });
      }
    } catch {
      // Skill roots can be missing during early app startup; audit listing should remain available.
    }
  }

  return events;
}

function toToolDiscoveryAuditEvents(): AuditEventRecord[] {
  try {
    return (getPluginDiagnosticsState().history || []).map((entry) => ({
      id: stableAuditId('tool_discovery', [entry.id, entry.recordedAt]),
      category: 'discovery',
      action: entry.reason,
      title: `Plugin ${entry.pluginId}`,
      summary: [
        entry.registrationState,
        entry.ready ? 'ready' : 'not ready',
        entry.compatible ? 'compatible' : 'incompatible',
        ...entry.blockedReasons,
        ...entry.warnings,
      ].filter(Boolean).join(' - '),
      status: entry.ready && entry.compatible
        ? 'success'
        : entry.blockedReasons.length > 0
          ? 'error'
          : 'warning',
      timestamp: entry.recordedAt,
      targetType: 'plugin',
      targetId: entry.pluginId,
      source: 'plugin-diagnostics',
      derived: true,
      jump: {
        kind: 'audit',
        auditEventId: stableAuditId('tool_discovery', [entry.id, entry.recordedAt]),
      },
      metadata: {
        registrationState: entry.registrationState,
        blockedReasons: entry.blockedReasons,
        warnings: entry.warnings,
        issues: entry.issues,
      },
    }));
  } catch {
    return [];
  }
}

function toConnectorAuditEvents(): AuditEventRecord[] {
  const events: AuditEventRecord[] = [];

  for (const delivery of listConnectorDeliveries(500)) {
    events.push({
      id: stableAuditId('connector_delivery', [delivery.id, delivery.updatedAt, delivery.status]),
      category: 'connector',
      action: `delivery_${delivery.status}`,
      title: `${delivery.connectorId} ${delivery.direction} message`,
      summary: delivery.textPreview || delivery.lastError || delivery.filterReason,
      status: statusFromDelivery(delivery.status),
      timestamp: delivery.completedAt || delivery.updatedAt || delivery.createdAt,
      taskId: delivery.taskId,
      connectorId: delivery.connectorId,
      connectorInstanceId: delivery.connectorInstanceId,
      targetType: 'connector_message',
      targetId: delivery.id,
      source: 'connector-deliveries',
      derived: true,
      jump: {
        kind: 'connector',
        connectorId: delivery.connectorId,
        connectorInstanceId: delivery.connectorInstanceId,
        deliveryId: delivery.id,
        taskId: delivery.taskId,
      },
      metadata: {
        accountId: delivery.accountId,
        targetId: delivery.targetId,
        targetKind: delivery.targetKind,
        direction: delivery.direction,
        status: delivery.status,
        chunkCount: delivery.chunkCount,
        retryCount: delivery.retryCount,
        maxRetries: delivery.maxRetries,
        nextRetryAt: delivery.nextRetryAt,
        lastError: delivery.lastError,
        filterReason: delivery.filterReason,
        threadId: delivery.threadId,
        attempts: delivery.attempts,
        chunks: delivery.chunks,
        metadata: delivery.metadata,
      },
    });
  }

  try {
    for (const discovery of listGatewayConnectorDiscovery()) {
      const observedCount = discovery.accountIds.length
        + discovery.userIds.length
        + discovery.groupIds.length
        + discovery.channelIds.length;
      events.push({
        id: stableAuditId('connector_discovery', [discovery.runtimeKey || discovery.connectorId, discovery.lastSeenAt, String(observedCount)]),
        category: 'discovery',
        action: 'connector_observed',
        title: `${discovery.connectorId} observed connector targets`,
        summary: `${observedCount} observed account, user, group, or channel identifiers.`,
        status: observedCount > 0 ? 'success' : 'info',
        timestamp: discovery.lastSeenAt || new Date(0).toISOString(),
        connectorId: discovery.connectorId,
        connectorInstanceId: discovery.instanceId,
        targetType: 'connector_discovery',
        targetId: discovery.runtimeKey || discovery.connectorId,
        source: 'gateway-connector-discovery',
        derived: true,
        jump: {
          kind: 'connector',
          connectorId: discovery.connectorId,
          connectorInstanceId: discovery.instanceId,
        },
        metadata: {
          runtimeKey: discovery.runtimeKey,
          accountIds: discovery.accountIds,
          userIds: discovery.userIds,
          groupIds: discovery.groupIds,
          channelIds: discovery.channelIds,
        },
      });
    }
  } catch {
    // Connector discovery can be unavailable before connector stores initialize.
  }

  return events;
}

function toScheduleAuditEvents(): AuditEventRecord[] {
  try {
    return listSchedules().map((schedule) => ({
      id: stableAuditId('scheduled', [schedule.id, schedule.updatedAt, schedule.lastRunAt, schedule.nextRunAt]),
      category: 'scheduled' as AuditEventCategory,
      action: schedule.enabled ? 'enabled' : 'disabled',
      title: schedule.name || 'Scheduled task',
      summary: schedule.prompt,
      status: schedule.enabled ? 'success' : 'warning',
      timestamp: schedule.updatedAt || schedule.createdAt,
      agentId: schedule.agentId,
      taskId: schedule.sessionId,
      targetType: 'schedule',
      targetId: schedule.id,
      source: 'schedules',
      derived: true,
      jump: {
        kind: 'audit',
        auditEventId: stableAuditId('scheduled', [schedule.id, schedule.updatedAt, schedule.lastRunAt, schedule.nextRunAt]),
      },
      metadata: {
        cron: schedule.cron,
        timezone: schedule.timezone,
        workingDirectory: schedule.workingDirectory,
        sessionId: schedule.sessionId,
        reuseSession: schedule.reuseSession,
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
      },
    }));
  } catch {
    return [];
  }
}

function toAlwaysOnAuditEvents(): AuditEventRecord[] {
  try {
    const snapshot = getAlwaysOnStatusSnapshot();
    return snapshot.agents.map((agent) => ({
      id: stableAuditId('always_on', [agent.agentId, snapshot.generatedAt, agent.status, String(agent.enabled)]),
      category: 'always_on' as AuditEventCategory,
      action: agent.enabled ? agent.status : 'disabled',
      title: `${agent.agentName} always-on ${agent.status}`,
      summary: agent.detail,
      status: agent.status === 'degraded'
        ? 'warning'
        : agent.status === 'ready' || agent.status === 'busy'
          ? 'success'
          : 'info',
      timestamp: snapshot.generatedAt,
      agentId: agent.agentId,
      targetType: 'always_on_agent',
      targetId: agent.agentId,
      source: 'always-on-status',
      derived: true,
      jump: {
        kind: 'audit',
        agentId: agent.agentId,
        auditEventId: stableAuditId('always_on', [agent.agentId, snapshot.generatedAt, agent.status, String(agent.enabled)]),
      },
      metadata: {
        enabled: agent.enabled,
        activeTaskCount: agent.activeTaskCount,
        connectorCount: agent.connectorCount,
        runningConnectorCount: agent.runningConnectorCount,
        enabledScheduleCount: agent.enabledScheduleCount,
        heartbeatEnabled: agent.heartbeatEnabled,
        agenticLoopEnabled: agent.agenticLoopEnabled,
        activeTaskIds: snapshot.activeTaskIds,
        schedules: snapshot.schedules,
      },
    }));
  } catch {
    return [];
  }
}

function toExecutionProfileAuditEvents(): AuditEventRecord[] {
  try {
    return listExecutionProfiles({ includeArchived: true }).profiles.map((profile) => ({
      id: stableAuditId('execution_profile', [profile.id, profile.updatedAt, profile.health.status, String(profile.archived)]),
      category: 'execution_profile' as AuditEventCategory,
      action: profile.archived ? 'archived' : profile.health.status,
      title: profile.name,
      summary: profile.health.message,
      status: profile.health.status === 'error'
        ? 'error'
        : profile.health.status === 'warning'
          ? 'warning'
          : profile.archived
            ? 'warning'
            : profile.health.status === 'ready'
              ? 'success'
              : 'info',
      timestamp: profile.updatedAt || profile.createdAt,
      targetType: 'execution_profile',
      targetId: profile.id,
      source: 'execution-profiles',
      derived: true,
      jump: {
        kind: 'audit',
        auditEventId: stableAuditId('execution_profile', [profile.id, profile.updatedAt, profile.health.status, String(profile.archived)]),
      },
      metadata: {
        kind: profile.kind,
        isDefault: profile.isDefault,
        archived: profile.archived,
        settings: profile.settings,
        health: profile.health,
      },
    }));
  } catch {
    return [];
  }
}

export function recordSystemAuditEvent(input: AuditEventInput): AuditEventRecord {
  return recordAuditEvent(input);
}

export function collectDerivedAuditEvents(): AuditEventRecord[] {
  return [
    ...toTaskAuditEvents(),
    ...toBuildAuditEvents(),
    ...toBuildRuntimeAuditEvents(),
    ...toGitAuditEvents(),
    ...toMemoryAuditEvents(),
    ...toSkillAuditEvents(),
    ...toToolDiscoveryAuditEvents(),
    ...toConnectorAuditEvents(),
    ...toScheduleAuditEvents(),
    ...toAlwaysOnAuditEvents(),
    ...toExecutionProfileAuditEvents(),
  ];
}

export function listAuditEvents(request: AuditListRequest = {}): AuditListResult {
  const limit = normalizeLimit(request.limit);
  const events = [
    ...listStoredAuditEvents(),
    ...(request.includeDerived === false ? [] : collectDerivedAuditEvents()),
  ]
    .filter((event) => matchesRequest(event, request))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    events: events.slice(0, limit),
    total: events.length,
  };
}

export function getAuditEvent(request: AuditGetRequest): AuditEventRecord | null {
  const id = String(request?.id || '').trim();
  if (!id) return null;
  return getStoredAuditEvent(id)
    || collectDerivedAuditEvents().find((event) => event.id === id)
    || null;
}

function csvCell(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : value === undefined || value === null
      ? ''
      : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function auditEventsToCsv(events: AuditEventRecord[]): string {
  const columns: Array<keyof AuditEventRecord | 'metadataJson' | 'jumpJson'> = [
    'id',
    'timestamp',
    'category',
    'action',
    'status',
    'title',
    'summary',
    'agentId',
    'taskId',
    'projectId',
    'connectorId',
    'connectorInstanceId',
    'skillId',
    'memoryKind',
    'targetType',
    'targetId',
    'source',
    'derived',
    'jumpJson',
    'metadataJson',
  ];
  const rows = [
    columns.map(csvCell).join(','),
    ...events.map((event) => columns.map((column) => {
      if (column === 'metadataJson') return csvCell(event.metadata);
      if (column === 'jumpJson') return csvCell(event.jump);
      return csvCell(event[column]);
    }).join(',')),
  ];
  return rows.join('\n');
}

export function exportAuditEvents(request: AuditExportRequest = {}): AuditExportResult {
  const format = request.format === 'jsonl' || request.format === 'csv' ? request.format : 'json';
  const { events } = listAuditEvents({ ...request, limit: MAX_AUDIT_LIMIT });
  const content = format === 'jsonl'
    ? events.map((event) => JSON.stringify(event)).join('\n')
    : format === 'csv'
      ? auditEventsToCsv(events)
      : JSON.stringify({ exportedAt: new Date().toISOString(), events }, null, 2);
  return {
    filename: `opendeskmate-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`,
    mimeType: format === 'jsonl'
      ? 'application/x-ndjson'
      : format === 'csv'
        ? 'text/csv'
        : 'application/json',
    content,
    count: events.length,
  };
}

export const __auditTest = {
  stableAuditId,
  matchesRequest,
  auditEventsToCsv,
};
