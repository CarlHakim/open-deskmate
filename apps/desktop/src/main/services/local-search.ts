import { createHash } from 'crypto';
import type {
  AuditEventRecord,
  BuildGitSummary,
  BuildTaskSession,
  LocalSearchSource,
  SearchIndexRebuildRequest,
  SearchIndexRebuildResult,
  SearchItemDetail,
  SearchItemGetRequest,
  SearchItemReference,
  SearchQueryRequest,
  SearchQueryResult,
  SearchResultItem,
  TaskMessage,
} from '@accomplish/shared';
import { listAgents } from '../store/agents';
import { getTasks } from '../store/taskHistory';
import { getBuildTaskSession, listBuildTaskSessions } from '../store/buildTaskHistory';
import { listConnectorDeliveries } from '../store/connectorDeliveries';
import { listUsageProjectWorkItems, listUsageProjects } from '../store/usageProjects';
import { readBuildGitSummary } from './build-mode/git-service';
import { getMemoryState, listMemoryChangeHistory, readMemoryFile, type MemoryFileKind } from './memory';
import { listUserSkills } from './user-skills';
import { listAuditEvents, recordSystemAuditEvent } from './audit';

interface IndexedSearchEntry {
  item: SearchResultItem;
  content: string;
  data?: unknown;
  normalizedText: string;
  normalizedTitle: string;
}

interface SearchIndexState {
  indexedAt: string;
  entries: IndexedSearchEntry[];
  sourceCounts: Partial<Record<LocalSearchSource, number>>;
  warnings: string[];
}

const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_LIMIT = 200;
const MAX_INDEX_TEXT_CHARS = 120_000;

let currentIndex: SearchIndexState | null = null;
let rebuildInFlight: Promise<SearchIndexState> | null = null;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForSearch(value: string): string {
  return compactWhitespace(value).toLowerCase();
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    normalizeForSearch(value)
      .split(/[^a-z0-9_@./:-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  ));
}

function stableSearchId(source: LocalSearchSource, parts: Array<string | undefined | null>): string {
  const hash = createHash('sha1')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 20);
  return `${source}:${hash}`;
}

function trimContent(content: string): string {
  return content.length > MAX_INDEX_TEXT_CHARS
    ? `${content.slice(0, MAX_INDEX_TEXT_CHARS)}\n\n[Indexed text truncated]`
    : content;
}

function makeExcerpt(content: string, query = ''): string {
  const source = compactWhitespace(content);
  if (!source) return '';
  const normalized = source.toLowerCase();
  const normalizedQuery = normalizeForSearch(query);
  const firstToken = tokenize(query)[0] || '';
  const index = normalizedQuery
    ? normalized.indexOf(normalizedQuery)
    : firstToken
      ? normalized.indexOf(firstToken)
      : -1;
  if (index < 0) return source.slice(0, 260);
  const start = Math.max(0, index - 100);
  const end = Math.min(source.length, index + Math.max(normalizedQuery.length, firstToken.length) + 160);
  return `${start > 0 ? '...' : ''}${source.slice(start, end)}${end < source.length ? '...' : ''}`;
}

function createEntry(input: {
  source: LocalSearchSource;
  title: string;
  subtitle?: string;
  content: string;
  updatedAt?: string;
  agentId?: string;
  tags?: string[];
  ref: SearchItemReference;
  data?: unknown;
}): IndexedSearchEntry {
  const content = trimContent(normalizeText(input.content));
  const title = compactWhitespace(input.title) || input.source;
  const id = stableSearchId(input.source, [
    input.ref.id,
    input.ref.agentId,
    input.ref.taskId,
    input.ref.path,
    input.updatedAt,
  ]);
  const item: SearchResultItem = {
    id,
    source: input.source,
    title,
    subtitle: input.subtitle,
    excerpt: makeExcerpt(content),
    score: 0,
    updatedAt: input.updatedAt,
    agentId: input.agentId,
    tags: input.tags?.filter(Boolean).slice(0, 12),
    ref: input.ref,
  };

  return {
    item,
    content,
    data: input.data,
    normalizedText: normalizeForSearch(`${title}\n${input.subtitle || ''}\n${content}\n${input.tags?.join(' ') || ''}`),
    normalizedTitle: normalizeForSearch(title),
  };
}

function countSources(entries: IndexedSearchEntry[]): Partial<Record<LocalSearchSource, number>> {
  const counts: Partial<Record<LocalSearchSource, number>> = {};
  for (const entry of entries) {
    counts[entry.item.source] = (counts[entry.item.source] || 0) + 1;
  }
  return counts;
}

function messageText(messages: TaskMessage[] | undefined): string {
  return (messages || [])
    .map((message) => [
      message.type,
      message.toolName,
      typeof message.toolInput === 'undefined' ? '' : JSON.stringify(message.toolInput),
      message.content,
    ].filter(Boolean).join(' '))
    .join('\n\n');
}

function toolMessageContent(message: TaskMessage): string {
  return [
    message.content,
    typeof message.toolInput === 'undefined' ? '' : JSON.stringify(message.toolInput),
  ].filter(Boolean).join('\n\n');
}

function indexToolMessages(entries: IndexedSearchEntry[], input: {
  messages: TaskMessage[] | undefined;
  agentId?: string;
  taskId?: string;
  projectId?: string | null;
  buildSessionId?: string;
  buildWorkspaceRelativePath?: string;
}): void {
  for (const message of input.messages || []) {
    if (message.type !== 'tool' && !message.toolName) continue;
    const sourceContext = input.buildSessionId ? 'Build tool call' : 'Chat tool call';
    entries.push(createEntry({
      source: 'tool_call',
      title: `${message.toolName || 'Tool'} call`,
      subtitle: [sourceContext, input.buildWorkspaceRelativePath].filter(Boolean).join(' - '),
      content: toolMessageContent(message),
      updatedAt: message.timestamp,
      agentId: input.agentId,
      tags: ['tool', message.toolName || '', input.buildSessionId ? 'build' : 'chat'].filter(Boolean),
      ref: {
        source: 'tool_call',
        id: message.id,
        agentId: input.agentId,
        taskId: input.taskId,
        sessionId: input.buildSessionId,
        messageId: message.id,
        projectId: input.projectId || undefined,
        status: /(?:\berror\b|\bfailed\b|exception)/i.test(message.content) ? 'error' : 'success',
        jump: input.buildSessionId
          ? {
              kind: 'build',
              agentId: input.agentId,
              sessionId: input.buildSessionId,
              taskId: input.taskId,
              messageId: message.id,
            }
          : {
              kind: 'chat',
              agentId: input.agentId,
              taskId: input.taskId,
              messageId: message.id,
            },
      },
      data: {
        message,
        buildSessionId: input.buildSessionId,
        taskId: input.taskId,
        projectId: input.projectId,
      },
    }));
  }
}

function indexChatTasks(entries: IndexedSearchEntry[], agentId?: string): void {
  for (const task of getTasks(agentId)) {
    if (task.privacyMode === 'incognito') continue;
    const activityText = (task.activity || [])
      .map((activity) => [activity.kind, activity.title, activity.detail, activity.toolName].filter(Boolean).join(' '))
      .join('\n');
    entries.push(createEntry({
      source: 'chat_task',
      title: task.summary || task.prompt.slice(0, 120) || 'Chat task',
      subtitle: [task.status, task.workingDirectory].filter(Boolean).join(' - '),
      content: [
        task.prompt,
        task.summary,
        messageText(task.messages),
        activityText,
        task.attachedFiles?.join('\n'),
      ].filter(Boolean).join('\n\n'),
      updatedAt: task.completedAt || task.startedAt || task.createdAt,
      agentId: task.agentId,
      tags: ['task', task.status, task.usageProjectId || ''].filter(Boolean),
      ref: {
        source: 'chat_task',
        id: task.id,
        taskId: task.id,
        agentId: task.agentId,
        projectId: task.usageProjectId || undefined,
        status: task.status,
        jump: {
          kind: 'chat',
          agentId: task.agentId,
          taskId: task.id,
        },
      },
      data: task,
    }));
    indexToolMessages(entries, {
      messages: task.messages,
      agentId: task.agentId,
      taskId: task.id,
      projectId: task.usageProjectId,
    });
  }
}

function indexBuildTasks(entries: IndexedSearchEntry[], agentId?: string): void {
  const agents = agentId ? [{ id: agentId }] : listAgents();
  for (const agent of agents) {
    const sessions = listBuildTaskSessions({
      agentId: agent.id,
      includeArchived: true,
      limit: 500,
    }).sessions;
    for (const item of sessions) {
      const session = getBuildTaskSession(item.id);
      if (!session) continue;
      const latestRun = session.runs[session.runs.length - 1];
      entries.push(createEntry({
        source: 'build_task',
        title: session.title || 'Build task',
        subtitle: [
          session.lifecycleStatus,
          session.execution.workspaceRelativePath,
          latestRun?.status,
        ].filter(Boolean).join(' - '),
        content: [
          session.titleSourcePrompt,
          session.execution.goalPrompt,
          messageText(session.messages),
          session.execution.runtimeLogs?.map((log) => `${log.stream} ${log.line}`).join('\n'),
          session.execution.latestDiff?.summary,
          session.execution.latestQualityCheckRun?.checks
            .map((check) => `${check.kind} ${check.status} ${check.summary || ''}`)
            .join('\n'),
        ].filter(Boolean).join('\n\n'),
        updatedAt: session.lastActivityAt || session.updatedAt,
        agentId: session.agentId,
        tags: ['build', session.lifecycleStatus, session.execution.selectedPresetId || ''].filter(Boolean),
        ref: {
          source: 'build_task',
          id: session.id,
          sessionId: session.id,
          agentId: session.agentId,
          taskId: latestRun?.taskId,
          projectId: session.execution.usageProjectId || undefined,
          status: session.lifecycleStatus,
          jump: {
            kind: 'build',
            agentId: session.agentId,
            sessionId: session.id,
            taskId: latestRun?.taskId,
          },
        },
        data: session,
      }));
      indexToolMessages(entries, {
        messages: session.messages,
        agentId: session.agentId,
        taskId: latestRun?.taskId,
        projectId: session.execution.usageProjectId,
        buildSessionId: session.id,
        buildWorkspaceRelativePath: session.execution.workspaceRelativePath,
      });

      const snapshot = session.execution.latestSnapshot;
      const qualityRun = session.execution.latestQualityCheckRun;
      const runtimeContent = [
        snapshot ? JSON.stringify({
          detection: snapshot.detection,
          runtime: snapshot.runtime,
        }) : '',
        qualityRun?.checks.map((check) => [
          check.kind,
          check.label,
          check.status,
          check.command,
          check.summary,
          check.output,
        ].filter(Boolean).join(' ')).join('\n'),
        session.execution.runtimeLogs?.map((log) => `${log.stream} ${log.line}`).join('\n'),
      ].filter(Boolean).join('\n\n');
      if (runtimeContent.trim()) {
        entries.push(createEntry({
          source: 'build_runtime',
          title: `${session.title || 'Build'} runtime`,
          subtitle: [
            snapshot?.runtime.status,
            session.execution.workspaceRelativePath,
            snapshot?.runtime.previewUrl,
          ].filter(Boolean).join(' - '),
          content: runtimeContent,
          updatedAt: snapshot?.runtime.lastHealthCheckAt || snapshot?.runtime.startedAt || qualityRun?.completedAt || session.updatedAt,
          agentId: session.agentId,
          tags: ['build-runtime', snapshot?.runtime.status || '', qualityRun?.status || ''].filter(Boolean),
          ref: {
            source: 'build_runtime',
            id: session.id,
            sessionId: session.id,
            agentId: session.agentId,
            taskId: latestRun?.taskId,
            projectId: session.execution.usageProjectId || undefined,
            status: snapshot?.runtime.status || qualityRun?.status,
            jump: {
              kind: 'build',
              agentId: session.agentId,
              sessionId: session.id,
              taskId: latestRun?.taskId,
            },
          },
          data: {
            sessionId: session.id,
            latestSnapshot: snapshot,
            latestQualityCheckRun: qualityRun,
            runtimeLogs: session.execution.runtimeLogs,
          },
        }));
      }
    }
  }
}

function indexWorkboardItems(entries: IndexedSearchEntry[]): void {
  const projects = listUsageProjects({ includeArchived: true });
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  for (const project of projects) {
    entries.push(createEntry({
      source: 'project',
      title: project.name || 'Project',
      subtitle: [project.status, project.clientName, project.projectCode].filter(Boolean).join(' - '),
      content: [
        project.notes,
        project.noteEntries?.map((note) => note.text).join('\n\n'),
        project.links?.map((link) => [link.label, link.url].filter(Boolean).join(' ')).join('\n'),
        project.owner,
        project.billingReference,
        project.tags?.join(' '),
      ].filter(Boolean).join('\n\n'),
      updatedAt: project.updatedAt,
      tags: ['project', project.status, project.priority || '', ...(project.tags || [])].filter(Boolean),
      ref: {
        source: 'project',
        id: project.id,
        projectId: project.id,
        status: project.status,
        jump: {
          kind: 'project_management',
          projectId: project.id,
        },
      },
      data: project,
    }));

    for (const note of project.noteEntries || []) {
      entries.push(createEntry({
        source: 'workboard_note',
        title: `${project.name} note`,
        subtitle: project.name,
        content: note.text,
        updatedAt: note.updatedAt || note.createdAt,
        tags: ['project-note', project.status],
        ref: {
          source: 'workboard_note',
          id: note.id,
          projectId: project.id,
          noteId: note.id,
          status: project.status,
          jump: {
            kind: 'project_management',
            projectId: project.id,
            noteId: note.id,
          },
        },
        data: { project, note },
      }));
    }

    for (const item of listUsageProjectWorkItems(project.id, { includeArchived: true })) {
      const checklistText = [
        ...(item.checklist || []).map((check) => check.text),
        ...(item.checklistLists || []).flatMap((list) => [
          list.name,
          list.context,
          ...list.items.map((check) => check.text),
        ]),
      ].filter(Boolean).join('\n');
      const notesText = (item.notes || []).map((note) => [note.title, note.text].filter(Boolean).join('\n')).join('\n\n');
      entries.push(createEntry({
        source: 'workboard_item',
        title: item.title || 'Workboard item',
        subtitle: [projectNames.get(item.usageProjectId), item.priority, item.archived ? 'archived' : 'active'].filter(Boolean).join(' - '),
        content: [
          item.description,
          item.blockedReason,
          item.tags.join(' '),
          checklistText,
          notesText,
          item.documents?.map((doc) => [doc.label, doc.path, doc.url].filter(Boolean).join(' ')).join('\n'),
          item.drawings?.map((drawing) => drawing.title).join('\n'),
        ].filter(Boolean).join('\n\n'),
        updatedAt: item.updatedAt,
        tags: ['workboard', item.priority, ...item.tags].filter(Boolean),
        ref: {
          source: 'workboard_item',
          id: item.id,
          projectId: item.usageProjectId,
          workItemId: item.id,
          status: item.archived ? 'archived' : item.completedAt ? 'completed' : item.blocked ? 'blocked' : 'active',
          jump: {
            kind: 'project_management',
            projectId: item.usageProjectId,
            workItemId: item.id,
          },
        },
        data: item,
      }));

      for (const note of item.notes || []) {
        entries.push(createEntry({
          source: 'workboard_note',
          title: note.title || `${item.title} note`,
          subtitle: [projectNames.get(item.usageProjectId), item.title].filter(Boolean).join(' - '),
          content: [
            note.title,
            note.text,
            note.html,
          ].filter(Boolean).join('\n\n'),
          updatedAt: note.updatedAt || note.createdAt,
          tags: ['workboard-note', item.priority, ...item.tags].filter(Boolean),
          ref: {
            source: 'workboard_note',
            id: note.id,
            projectId: item.usageProjectId,
            workItemId: item.id,
            noteId: note.id,
            status: item.archived ? 'archived' : item.completedAt ? 'completed' : item.blocked ? 'blocked' : 'active',
            jump: {
              kind: 'project_management',
              projectId: item.usageProjectId,
              workItemId: item.id,
              noteId: note.id,
            },
          },
          data: { item, note },
        }));
      }

      for (const documentLink of item.documents || []) {
        entries.push(createEntry({
          source: 'linked_document',
          title: documentLink.label || 'Linked document',
          subtitle: [projectNames.get(item.usageProjectId), item.title, documentLink.kind].filter(Boolean).join(' - '),
          content: [
            documentLink.label,
            documentLink.kind,
            documentLink.path,
            documentLink.url,
            documentLink.outlineColor,
          ].filter(Boolean).join('\n'),
          updatedAt: documentLink.createdAt,
          tags: ['linked-document', documentLink.kind, item.priority, ...item.tags].filter(Boolean),
          ref: {
            source: 'linked_document',
            id: documentLink.id,
            projectId: item.usageProjectId,
            workItemId: item.id,
            documentId: documentLink.id,
            path: documentLink.path || documentLink.url,
            status: item.archived ? 'archived' : item.completedAt ? 'completed' : item.blocked ? 'blocked' : 'active',
            jump: {
              kind: 'project_management',
              projectId: item.usageProjectId,
              workItemId: item.id,
              documentId: documentLink.id,
              path: documentLink.path || documentLink.url,
            },
          },
          data: { item, document: documentLink },
        }));
      }
    }
  }
}

function readMemoryEntryContent(entry: {
  kind: MemoryFileKind;
  date?: string;
  fileName?: string;
}, agentId?: string): string {
  try {
    return readMemoryFile(entry.kind, entry.date, agentId, entry.fileName).content || '';
  } catch {
    return '';
  }
}

function indexMemoryFiles(entries: IndexedSearchEntry[], warnings: string[], agentId?: string): void {
  const agents = agentId ? [{ id: agentId }] : listAgents();
  const seen = new Set<string>();
  for (const agent of agents) {
    try {
      const state = getMemoryState(agent.id);
      for (const entry of state.entries || []) {
        const key = `${entry.path}:${agent.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const content = readMemoryEntryContent({
          kind: entry.kind,
          date: entry.date,
          fileName: entry.fileName,
        }, agent.id);
        if (!content.trim()) continue;
        entries.push(createEntry({
          source: 'memory_file',
          title: entry.label,
          subtitle: entry.relativePath,
          content,
          updatedAt: entry.updatedAt,
          agentId: agent.id,
          tags: ['memory', entry.kind, entry.date || ''].filter(Boolean),
          ref: {
            source: 'memory_file',
            id: entry.path,
            path: entry.path,
            agentId: agent.id,
            memoryKind: entry.kind,
            taskId: entry.taskId,
            status: entry.exists ? 'active' : 'missing',
            jump: {
              kind: 'memory',
              agentId: agent.id,
              memoryKind: entry.kind,
              taskId: entry.taskId,
              path: entry.path,
            },
          },
          data: entry,
        }));
      }
    } catch (error) {
      warnings.push(`Memory index skipped for ${agent.id}: ${(error as Error)?.message || 'unknown error'}`);
    }
  }
}

function indexMemoryChanges(entries: IndexedSearchEntry[]): void {
  for (const change of listMemoryChangeHistory(500)) {
    entries.push(createEntry({
      source: 'memory_change',
      title: `${change.kind} memory ${change.mode}`,
      subtitle: `${change.status} - ${change.relativePath || change.filePath}`,
      content: [
        change.reason,
        change.preview.beforeExcerpt,
        change.preview.afterExcerpt,
        change.filePath,
        change.relativePath,
      ].filter(Boolean).join('\n\n'),
      updatedAt: change.appliedAt || change.revertedAt || change.createdAt,
      agentId: change.agentId,
      tags: ['memory-change', change.kind, change.mode, change.status],
      ref: {
        source: 'memory_change',
        id: change.id,
        agentId: change.agentId,
        taskId: change.taskId,
        path: change.filePath,
        memoryKind: change.kind,
        status: change.status,
        jump: {
          kind: 'memory',
          agentId: change.agentId,
          taskId: change.taskId,
          memoryKind: change.kind,
          path: change.filePath,
        },
      },
      data: change,
    }));
  }
}

function indexSkills(entries: IndexedSearchEntry[], agentId?: string): void {
  const agents = agentId ? [{ id: agentId }] : listAgents();
  const agentIds = agents.length > 0 ? agents.map((agent) => agent.id) : [undefined];
  const seen = new Set<string>();
  for (const id of agentIds) {
    try {
      for (const skill of listUserSkills({ agentId: id }).skills) {
        const key = `${skill.source}:${skill.id}:${skill.baseDir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(createEntry({
          source: 'skill',
          title: skill.name || skill.id,
          subtitle: [skill.source, skill.manifest?.state, skill.manifest?.version].filter(Boolean).join(' - '),
          content: [
            skill.description,
            skill.bodyPreview,
            skill.originLabel,
            skill.generatedByAgentName,
            skill.metadata ? JSON.stringify(skill.metadata) : '',
            skill.manifest ? JSON.stringify(skill.manifest) : '',
          ].filter(Boolean).join('\n\n'),
          updatedAt: skill.manifest?.updatedAt || skill.manifest?.createdAt,
          agentId: skill.visibilityOwnerAgentId,
          tags: ['skill', skill.source, skill.manifest?.state || ''].filter(Boolean),
          ref: {
            source: 'skill',
            id: skill.id,
            agentId: skill.visibilityOwnerAgentId,
            path: skill.filePath,
            skillId: skill.id,
            status: skill.manifest?.state,
            jump: {
              kind: 'skill',
              agentId: skill.visibilityOwnerAgentId,
              skillId: skill.id,
              path: skill.filePath,
            },
          },
          data: skill,
        }));
      }
    } catch {
      // Missing workspace skill directories should not break global search.
    }
  }
}

function gitSummaryContent(summary: BuildGitSummary): string {
  return [
    summary.workspaceRoot,
    summary.workspaceRelativePath,
    summary.branch,
    summary.commit,
    summary.remoteUrl,
    summary.repositoryWebUrl,
    summary.syncStatus,
    summary.syncDetail,
    summary.authStatus,
    summary.authDetail,
    summary.nextAction?.label,
    summary.nextAction?.detail,
    summary.files.map((file) => `${file.relativePath} ${file.status} +${file.addedLines} -${file.deletedLines}`).join('\n'),
    summary.branches.map((branch) => branch.name).join('\n'),
  ].filter(Boolean).join('\n');
}

async function indexGitSummaries(entries: IndexedSearchEntry[], warnings: string[], agentId?: string): Promise<void> {
  const agents = agentId ? [{ id: agentId }] : listAgents();
  for (const agent of agents) {
    try {
      const summary = await readBuildGitSummary(agent.id, '.', { lightweight: true });
      if (!summary.available || !summary.isRepository) continue;
      entries.push(createEntry({
        source: 'git_summary',
        title: `${summary.repositoryName || summary.workspaceRelativePath || 'Git'} ${summary.branch || ''}`.trim(),
        subtitle: [summary.syncStatus, summary.dirty ? `${summary.changedFileCount} changed` : 'clean'].filter(Boolean).join(' - '),
        content: gitSummaryContent(summary),
        updatedAt: summary.generatedAt,
        agentId: agent.id,
        tags: ['git', summary.syncStatus, summary.remoteProvider || ''].filter(Boolean),
        ref: {
          source: 'git_summary',
          id: `${agent.id}:${summary.workspaceRelativePath}`,
          agentId: agent.id,
          path: summary.workspaceRoot,
          status: summary.syncStatus,
          jump: {
            kind: 'build',
            agentId: agent.id,
            path: summary.workspaceRoot,
          },
        },
        data: summary,
      }));
    } catch (error) {
      warnings.push(`Git summary skipped for ${agent.id}: ${(error as Error)?.message || 'unknown error'}`);
    }
  }
}

function indexConnectorMessages(entries: IndexedSearchEntry[], agentId?: string): void {
  for (const delivery of listConnectorDeliveries(500)) {
    if (agentId && delivery.metadata?.agentId && delivery.metadata.agentId !== agentId) continue;
    entries.push(createEntry({
      source: 'connector_message',
      title: `${delivery.connectorId} ${delivery.direction} message`,
      subtitle: [
        delivery.status,
        delivery.connectorInstanceId,
        delivery.targetKind,
        delivery.targetId,
      ].filter(Boolean).join(' - '),
      content: [
        delivery.textPreview,
        delivery.lastError,
        delivery.filterReason,
        delivery.accountId,
        delivery.targetId,
        delivery.threadId,
        delivery.metadata ? JSON.stringify(delivery.metadata) : '',
        delivery.attempts.map((attempt) => `${attempt.status} ${attempt.error || ''}`).join('\n'),
      ].filter(Boolean).join('\n\n'),
      updatedAt: delivery.completedAt || delivery.updatedAt || delivery.createdAt,
      agentId: delivery.metadata?.agentId,
      tags: ['connector', delivery.connectorId, delivery.status, delivery.direction].filter(Boolean),
      ref: {
        source: 'connector_message',
        id: delivery.id,
        taskId: delivery.taskId,
        connectorId: delivery.connectorId,
        connectorInstanceId: delivery.connectorInstanceId,
        deliveryId: delivery.id,
        status: delivery.status,
        jump: {
          kind: 'connector',
          connectorId: delivery.connectorId,
          connectorInstanceId: delivery.connectorInstanceId,
          deliveryId: delivery.id,
          taskId: delivery.taskId,
        },
      },
      data: delivery,
    }));
  }
}

function indexAuditEvents(entries: IndexedSearchEntry[]): void {
  const audit = listAuditEvents({ limit: 500 });
  for (const event of audit.events) {
    entries.push(createEntry({
      source: 'audit_event',
      title: event.title,
      subtitle: [event.category, event.action, event.status].filter(Boolean).join(' - '),
      content: [
        event.summary,
        event.targetType,
        event.targetId,
        event.source,
        event.metadata ? JSON.stringify(event.metadata) : '',
      ].filter(Boolean).join('\n\n'),
      updatedAt: event.timestamp,
      agentId: event.agentId,
      tags: ['audit', event.category, event.status],
      ref: {
        source: 'audit_event',
        id: event.id,
        agentId: event.agentId,
        taskId: event.taskId,
        projectId: event.projectId,
        connectorId: event.connectorId,
        connectorInstanceId: event.connectorInstanceId,
        skillId: event.skillId,
        memoryKind: event.memoryKind,
        category: event.category,
        status: event.status,
        jump: event.jump || {
          kind: 'audit',
          auditEventId: event.id,
          agentId: event.agentId,
          taskId: event.taskId,
        },
      },
      data: event,
    }));
  }
}

async function buildIndex(request: SearchIndexRebuildRequest = {}): Promise<SearchIndexState> {
  const entries: IndexedSearchEntry[] = [];
  const warnings: string[] = [];
  const agentId = typeof request.agentId === 'string' && request.agentId.trim()
    ? request.agentId.trim()
    : undefined;

  indexChatTasks(entries, agentId);
  indexBuildTasks(entries, agentId);
  indexWorkboardItems(entries);
  indexMemoryFiles(entries, warnings, agentId);
  indexMemoryChanges(entries);
  indexSkills(entries, agentId);
  indexConnectorMessages(entries, agentId);
  indexAuditEvents(entries);
  if (request.includeGit !== false) {
    await indexGitSummaries(entries, warnings, agentId);
  }

  return {
    indexedAt: new Date().toISOString(),
    entries,
    sourceCounts: countSources(entries),
    warnings,
  };
}

function toRebuildResult(index: SearchIndexState): SearchIndexRebuildResult {
  return {
    ok: true,
    indexedAt: index.indexedAt,
    totalItems: index.entries.length,
    sourceCounts: index.sourceCounts,
    warnings: index.warnings,
  };
}

async function ensureIndex(): Promise<SearchIndexState> {
  if (currentIndex) return currentIndex;
  await rebuildLocalSearchIndex({ includeGit: false });
  return currentIndex!;
}

function scoreEntry(entry: IndexedSearchEntry, query: string): number {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return 1;
  const tokens = tokenize(query);
  let score = 0;
  if (entry.normalizedTitle.includes(normalizedQuery)) score += 80;
  if (entry.normalizedText.includes(normalizedQuery)) score += 50;
  for (const token of tokens) {
    if (entry.normalizedTitle.includes(token)) score += 20;
    if (entry.normalizedText.includes(token)) score += 6;
  }
  return score;
}

function normalizeSources(sources: unknown): Set<LocalSearchSource> | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  return new Set(sources.filter((source): source is LocalSearchSource => typeof source === 'string') as LocalSearchSource[]);
}

function normalizeFilter(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesRefFilter(entry: IndexedSearchEntry, key: keyof SearchItemReference, expected: unknown): boolean {
  const normalizedExpected = normalizeFilter(expected);
  if (!normalizedExpected) return true;
  const value = entry.item.ref[key];
  return typeof value === 'string' && value.toLowerCase() === normalizedExpected;
}

function matchesSearchFilters(entry: IndexedSearchEntry, request: SearchQueryRequest): boolean {
  if (!matchesRefFilter(entry, 'taskId', request.taskId)) return false;
  if (!matchesRefFilter(entry, 'projectId', request.projectId)) return false;
  if (!matchesRefFilter(entry, 'connectorId', request.connectorId)) return false;
  if (!matchesRefFilter(entry, 'connectorInstanceId', request.connectorInstanceId)) return false;
  if (!matchesRefFilter(entry, 'skillId', request.skillId)) return false;
  if (!matchesRefFilter(entry, 'memoryKind', request.memoryKind)) return false;
  if (!matchesRefFilter(entry, 'status', request.status)) return false;
  if (request.category && entry.item.ref.category !== request.category) return false;
  if (request.since && (entry.item.updatedAt || '') < request.since) return false;
  if (request.until && (entry.item.updatedAt || '') > request.until) return false;
  return true;
}

export async function rebuildLocalSearchIndex(request: SearchIndexRebuildRequest = {}): Promise<SearchIndexRebuildResult> {
  if (!rebuildInFlight) {
    rebuildInFlight = buildIndex(request).finally(() => {
      rebuildInFlight = null;
    });
  }
  currentIndex = await rebuildInFlight;
  recordSystemAuditEvent({
    category: 'search',
    action: 'index_rebuild',
    title: 'Search index rebuilt',
    summary: `${currentIndex.entries.length} local items indexed.`,
    status: currentIndex.warnings.length > 0 ? 'warning' : 'success',
    targetType: 'search_index',
    targetId: currentIndex.indexedAt,
    metadata: {
      sourceCounts: currentIndex.sourceCounts,
      warnings: currentIndex.warnings,
    },
  });
  return toRebuildResult(currentIndex);
}

export async function queryLocalSearch(request: SearchQueryRequest): Promise<SearchQueryResult> {
  const index = await ensureIndex();
  const query = normalizeText(request?.query || '');
  const limit = typeof request?.limit === 'number' && Number.isFinite(request.limit)
    ? Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(request.limit)))
    : DEFAULT_SEARCH_LIMIT;
  const sources = normalizeSources(request?.sources);
  const agentId = typeof request?.agentId === 'string' && request.agentId.trim()
    ? request.agentId.trim()
    : undefined;

  const scored = index.entries
    .filter((entry) => !sources || sources.has(entry.item.source))
    .filter((entry) => !agentId || !entry.item.agentId || entry.item.agentId === agentId)
    .filter((entry) => matchesSearchFilters(entry, request))
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, query),
    }))
    .filter((result) => !query || result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.entry.item.updatedAt || '').localeCompare(a.entry.item.updatedAt || '');
    })
    .slice(0, limit)
    .map(({ entry, score }) => ({
      ...entry.item,
      score,
      excerpt: makeExcerpt(entry.content, query),
    }));

  return {
    query,
    indexedAt: index.indexedAt,
    totalItems: index.entries.length,
    results: scored,
    sourceCounts: index.sourceCounts,
    warnings: index.warnings,
  };
}

export async function getLocalSearchItem(request: SearchItemGetRequest): Promise<SearchItemDetail | null> {
  const index = await ensureIndex();
  const id = String(request?.id || '').trim();
  if (!id) return null;
  const entry = index.entries.find((candidate) => candidate.item.id === id);
  if (!entry) return null;
  return {
    item: {
      ...entry.item,
      score: 0,
      excerpt: makeExcerpt(entry.content),
    },
    content: entry.content,
    data: entry.data,
  };
}

export const __localSearchTest = {
  createEntry,
  makeExcerpt,
  queryEntries(entries: IndexedSearchEntry[], request: SearchQueryRequest): SearchResultItem[] {
    const temp: SearchIndexState = {
      indexedAt: new Date(0).toISOString(),
      entries,
      sourceCounts: countSources(entries),
      warnings: [],
    };
    currentIndex = temp;
    return entries
      .filter((entry) => matchesSearchFilters(entry, request))
      .map((entry) => ({ entry, score: scoreEntry(entry, request.query) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ entry, score }) => ({ ...entry.item, score, excerpt: makeExcerpt(entry.content, request.query) }));
  },
};
