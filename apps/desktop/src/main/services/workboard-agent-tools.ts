import { randomUUID } from 'crypto';
import type {
  AuditEventStatus,
  UsageProject,
  UsageProjectKanbanColumn,
  UsageProjectPriority,
  UsageProjectWorkItem,
  UsageProjectWorkItemChecklistItem,
  UsageProjectWorkItemDocumentLink,
  UsageProjectWorkItemInput,
  UsageProjectWorkItemNote,
  UsageProjectWorkItemSourceLink,
  UsageProjectWorkItemUpdate,
} from '@accomplish/shared';
import {
  createUsageProjectWorkItem,
  getUsageProject,
  listUsageProjectKanbanColumns,
  listUsageProjects,
  listUsageProjectWorkItems,
  updateUsageProjectWorkItem,
} from '../store/usageProjects';
import { recordSystemAuditEvent } from './audit';

export type WorkboardAgentToolAction =
  | 'list'
  | 'show'
  | 'create'
  | 'update'
  | 'comment'
  | 'complete'
  | 'block'
  | 'unblock'
  | 'link'
  | 'heartbeat';

export type WorkboardAgentToolResult = {
  ok: true;
  action: WorkboardAgentToolAction;
  [key: string]: unknown;
};

type WorkboardAgentContext = {
  taskId?: string;
  agentId?: string;
};

type WorkboardActionOutcome = {
  result: WorkboardAgentToolResult;
  audit: {
    title: string;
    summary?: string;
    status?: AuditEventStatus;
    projectId?: string;
    itemId?: string;
    noteId?: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  };
};

const PRIORITIES: UsageProjectPriority[] = ['low', 'normal', 'high', 'urgent'];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown, maxLength: number): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeLongText(value: unknown, maxLength: number): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function normalizeStringArray(value: unknown, maxItems = 80, maxLength = 128): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split(',')
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const text = normalizeText(entry, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizePriority(value: unknown): UsageProjectPriority | undefined {
  const raw = normalizeText(value, 24).toLowerCase() as UsageProjectPriority;
  return PRIORITIES.includes(raw) ? raw : undefined;
}

function normalizeLimit(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(num)));
}

function getContext(data: Record<string, unknown>): WorkboardAgentContext {
  return {
    taskId: normalizeText(data.parentTaskId ?? data.taskId, 128) || undefined,
    agentId: normalizeText(data.parentAgentId ?? data.agentId, 128).toLowerCase() || undefined,
  };
}

function getProjectLabel(project: UsageProject): string {
  return project.name || project.projectCode || project.id;
}

function resolveProject(data: Record<string, unknown>): UsageProject {
  const projectId = normalizeText(data.projectId ?? data.usageProjectId, 128);
  if (projectId) {
    const project = getUsageProject(projectId);
    if (!project) throw new Error('Usage project not found.');
    return project;
  }

  const projectName = normalizeText(data.projectName, 160).toLowerCase();
  if (projectName) {
    const projects = listUsageProjects({ includeArchived: true });
    const exact = projects.find((project) => project.name.toLowerCase() === projectName);
    if (exact) return exact;
    const matches = projects.filter((project) => project.name.toLowerCase().includes(projectName));
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length > 1) throw new Error('Multiple usage projects match projectName; provide projectId.');
  }

  const activeProjects = listUsageProjects();
  if (activeProjects.length === 1 && activeProjects[0]) return activeProjects[0];
  throw new Error('projectId is required when there is not exactly one active usage project.');
}

function getColumns(projectId: string): UsageProjectKanbanColumn[] {
  return listUsageProjectKanbanColumns(projectId);
}

function resolveColumnId(projectId: string, data: Record<string, unknown>): string | undefined {
  const statusId = normalizeText(data.statusId ?? data.columnId, 128);
  const columns = getColumns(projectId);
  if (statusId && columns.some((column) => column.id === statusId)) return statusId;

  const requestedName = normalizeText(data.statusName ?? data.columnName ?? data.status, 80).toLowerCase();
  if (!requestedName) return undefined;

  if (['done', 'complete', 'completed'].includes(requestedName)) {
    return columns.find((column) => column.doneState)?.id;
  }
  if (['archived', 'archive'].includes(requestedName)) {
    return columns.find((column) => column.archivedState)?.id;
  }

  const exact = columns.find((column) => column.name.toLowerCase() === requestedName);
  if (exact) return exact.id;
  const partial = columns.filter((column) => column.name.toLowerCase().includes(requestedName));
  return partial.length === 1 ? partial[0]?.id : undefined;
}

function getDoneColumnId(projectId: string): string | undefined {
  return getColumns(projectId).find((column) => column.doneState)?.id;
}

function getWaitingColumnId(projectId: string): string | undefined {
  const columns = getColumns(projectId);
  return columns.find((column) => column.name.toLowerCase() === 'waiting')?.id
    || columns.find((column) => /\b(waiting|blocked|hold)\b/i.test(column.name))?.id;
}

function findWorkItem(itemId: string): {
  item: UsageProjectWorkItem;
  project: UsageProject;
  columns: UsageProjectKanbanColumn[];
} {
  const id = normalizeText(itemId, 128);
  if (!id) throw new Error('itemId is required.');
  for (const project of listUsageProjects({ includeArchived: true })) {
    const item = listUsageProjectWorkItems(project.id, { includeArchived: true }).find((entry) => entry.id === id);
    if (item) {
      return { item, project, columns: getColumns(project.id) };
    }
  }
  throw new Error('Work item not found.');
}

function columnForItem(item: UsageProjectWorkItem, columns: UsageProjectKanbanColumn[]): UsageProjectKanbanColumn | undefined {
  return columns.find((column) => column.id === item.statusId);
}

function summarizeWorkItem(item: UsageProjectWorkItem, columns: UsageProjectKanbanColumn[]): Record<string, unknown> {
  const column = columnForItem(item, columns);
  return {
    id: item.id,
    usageProjectId: item.usageProjectId,
    title: item.title,
    description: item.description || undefined,
    statusId: item.statusId,
    statusName: column?.name,
    state: item.archived ? 'archived' : item.completedAt ? 'completed' : item.blocked ? 'blocked' : 'active',
    priority: item.priority,
    assigneeIds: item.assigneeIds,
    startDate: item.startDate,
    dueDate: item.dueDate,
    completedAt: item.completedAt,
    blocked: item.blocked,
    blockedReason: item.blockedReason || undefined,
    tags: item.tags,
    noteCount: item.notes?.length ?? 0,
    sourceLinkCount: item.sources?.length ?? 0,
    documentCount: item.documents?.length ?? 0,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    archived: item.archived,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function summarizeProject(project: UsageProject, includeArchived: boolean): Record<string, unknown> {
  const columns = getColumns(project.id);
  const items = listUsageProjectWorkItems(project.id, { includeArchived });
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    projectCode: project.projectCode,
    clientName: project.clientName,
    owner: project.owner,
    priority: project.priority,
    dueDate: project.dueDate,
    tags: project.tags,
    columns,
    itemCount: items.length,
    blockedCount: items.filter((item) => item.blocked && !item.archived).length,
    completedCount: items.filter((item) => Boolean(item.completedAt)).length,
  };
}

function normalizeChecklist(input: unknown): UsageProjectWorkItemChecklistItem[] {
  if (!Array.isArray(input)) return [];
  const timestamp = nowIso();
  return input.slice(0, 80).flatMap((entry): UsageProjectWorkItemChecklistItem[] => {
    if (typeof entry === 'string') {
      const text = normalizeText(entry, 300);
      return text ? [{ id: randomUUID(), text, completed: false, createdAt: timestamp }] : [];
    }
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const text = normalizeText(source.text, 300);
    if (!text) return [];
    return [{
      id: normalizeText(source.id, 80) || randomUUID(),
      text,
      completed: normalizeBoolean(source.completed),
      assigneeIds: normalizeStringArray(source.assigneeIds),
      dueDate: normalizeText(source.dueDate, 64) || null,
      createdAt: normalizeText(source.createdAt, 64) || timestamp,
      updatedAt: normalizeText(source.updatedAt, 64) || undefined,
    }];
  });
}

function makeNote(data: Record<string, unknown>, fallbackTitle: string): UsageProjectWorkItemNote {
  const text = normalizeLongText(data.text ?? data.comment ?? data.message ?? data.note, 100_000);
  if (!text) throw new Error('text is required.');
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    title: normalizeText(data.title ?? data.noteTitle, 160) || fallbackTitle,
    text,
    createdAt: timestamp,
  };
}

function maybeAppendNote(
  item: UsageProjectWorkItem,
  update: UsageProjectWorkItemUpdate,
  noteInput: Record<string, unknown>,
  fallbackTitle: string
): UsageProjectWorkItemUpdate {
  const text = normalizeLongText(noteInput.text ?? noteInput.comment ?? noteInput.message ?? noteInput.note, 100_000);
  if (!text) return update;
  const note = makeNote({ ...noteInput, text }, fallbackTitle);
  return {
    ...update,
    notes: [note, ...(item.notes || [])],
  };
}

function makeSourceLink(data: Record<string, unknown>): UsageProjectWorkItemSourceLink {
  const url = normalizeLongText(data.url ?? data.link ?? data.sourceUrl, 2048);
  if (!/^https?:\/\//i.test(url)) throw new Error('url must be an http(s) URL.');
  let fallbackTitle = 'Source';
  try {
    fallbackTitle = new URL(url).hostname.replace(/^www\./i, '') || fallbackTitle;
  } catch {
    fallbackTitle = 'Source';
  }
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    title: normalizeText(data.title ?? data.label, 180) || fallbackTitle,
    url,
    description: normalizeLongText(data.description, 1000) || undefined,
    createdAt: timestamp,
  };
}

function makeDocumentLink(data: Record<string, unknown>): UsageProjectWorkItemDocumentLink {
  const url = normalizeLongText(data.url ?? data.link ?? data.documentUrl, 2048);
  const filePath = normalizeLongText(data.path ?? data.filePath ?? data.documentPath, 1024);
  const kind = filePath ? 'local' : 'url';
  if (kind === 'url' && !/^https?:\/\//i.test(url)) throw new Error('document url must be an http(s) URL.');
  if (kind === 'local' && !filePath) throw new Error('document path is required.');
  const target = kind === 'local' ? filePath : url;
  const fallbackLabel = target.split(/[\\/]/).filter(Boolean).pop() || target.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || 'Document link';
  return {
    id: randomUUID(),
    label: normalizeText(data.label ?? data.title, 160) || fallbackLabel,
    kind,
    path: kind === 'local' ? filePath : undefined,
    url: kind === 'url' ? url : undefined,
    createdAt: nowIso(),
  };
}

function itemSearchText(item: UsageProjectWorkItem): string {
  return [
    item.title,
    item.description,
    item.blockedReason,
    item.tags.join(' '),
    item.notes.map((note) => `${note.title || ''} ${note.text}`).join(' '),
  ].join(' ').toLowerCase();
}

function runList(data: Record<string, unknown>): WorkboardActionOutcome {
  const includeArchived = normalizeBoolean(data.includeArchived);
  const limit = normalizeLimit(data.limit, 80);
  const query = normalizeText(data.query, 256).toLowerCase();
  const projectId = normalizeText(data.projectId ?? data.usageProjectId, 128);
  const projectName = normalizeText(data.projectName, 160);
  const projects = projectId || projectName ? [resolveProject(data)] : listUsageProjects({ includeArchived });

  const boards = projects.map((project) => {
    const columns = getColumns(project.id);
    const items = listUsageProjectWorkItems(project.id, { includeArchived })
      .filter((item) => !query || itemSearchText(item).includes(query))
      .slice(0, limit)
      .map((item) => summarizeWorkItem(item, columns));
    return {
      ...summarizeProject(project, includeArchived),
      items,
      truncated: listUsageProjectWorkItems(project.id, { includeArchived }).length > items.length,
    };
  });

  return {
    result: { ok: true, action: 'list', projects: boards },
    audit: {
      title: projectId || projectName ? `Listed Workboard for ${projects[0] ? getProjectLabel(projects[0]) : projectId || projectName}` : 'Listed Workboards',
      summary: query ? `Query: ${query}` : undefined,
      projectId: projects.length === 1 ? projects[0]?.id : undefined,
      targetType: projectId || projectName ? 'workboard_project' : 'workboard',
      targetId: projects.length === 1 ? projects[0]?.id : 'all',
      metadata: { includeArchived, limit, query: query || undefined, projectCount: boards.length },
    },
  };
}

function runShow(data: Record<string, unknown>): WorkboardActionOutcome {
  const itemId = normalizeText(data.itemId ?? data.workItemId, 128);
  if (itemId) {
    const { item, project, columns } = findWorkItem(itemId);
    const column = columnForItem(item, columns);
    return {
      result: { ok: true, action: 'show', project, column, item },
      audit: {
        title: `Showed Workboard item ${item.title}`,
        projectId: project.id,
        itemId: item.id,
        targetType: 'workboard_item',
        targetId: item.id,
        metadata: { statusId: item.statusId, statusName: column?.name },
      },
    };
  }

  const project = resolveProject(data);
  const columns = getColumns(project.id);
  const includeArchived = normalizeBoolean(data.includeArchived);
  const items = listUsageProjectWorkItems(project.id, { includeArchived }).map((item) => summarizeWorkItem(item, columns));
  return {
    result: { ok: true, action: 'show', project, columns, items },
    audit: {
      title: `Showed Workboard for ${getProjectLabel(project)}`,
      projectId: project.id,
      targetType: 'workboard_project',
      targetId: project.id,
      metadata: { includeArchived, itemCount: items.length },
    },
  };
}

function buildCreateInput(project: UsageProject, data: Record<string, unknown>): UsageProjectWorkItemInput {
  const title = normalizeText(data.title, 180);
  if (!title) throw new Error('title is required.');
  const statusId = resolveColumnId(project.id, data);
  const priority = normalizePriority(data.priority);
  const sourceUrl = normalizeText(data.sourceUrl ?? data.url, 2048);
  const sources = /^https?:\/\//i.test(sourceUrl)
    ? [makeSourceLink({ ...data, url: sourceUrl })]
    : [];
  const commentText = normalizeLongText(data.comment ?? data.note ?? data.message, 100_000);
  const notes = commentText
    ? [makeNote({ ...data, text: commentText, title: data.noteTitle ?? 'Initial note' }, 'Initial note')]
    : [];
  return {
    usageProjectId: project.id,
    title,
    description: normalizeLongText(data.description, 5000) || undefined,
    statusId,
    priority,
    assigneeIds: normalizeStringArray(data.assigneeIds),
    startDate: normalizeText(data.startDate, 64) || null,
    dueDate: normalizeText(data.dueDate, 64) || null,
    blocked: normalizeBoolean(data.blocked),
    blockedReason: normalizeText(data.blockedReason, 300),
    tags: normalizeStringArray(data.tags, 20, 40),
    checklist: normalizeChecklist(data.checklist),
    notes,
    sources,
    sourceType: 'manual',
  };
}

function runCreate(data: Record<string, unknown>): WorkboardActionOutcome {
  const project = resolveProject(data);
  const item = createUsageProjectWorkItem(buildCreateInput(project, data));
  const columns = getColumns(project.id);
  return {
    result: { ok: true, action: 'create', project, item, column: columnForItem(item, columns) },
    audit: {
      title: `Created Workboard item ${item.title}`,
      summary: item.description,
      status: 'success',
      projectId: project.id,
      itemId: item.id,
      targetType: 'workboard_item',
      targetId: item.id,
      metadata: { statusId: item.statusId, priority: item.priority, tags: item.tags },
    },
  };
}

function buildUpdate(data: Record<string, unknown>, current: UsageProjectWorkItem): UsageProjectWorkItemUpdate {
  const update: UsageProjectWorkItemUpdate = {};
  if (hasOwn(data, 'projectId') || hasOwn(data, 'usageProjectId')) {
    update.usageProjectId = resolveProject(data).id;
  }
  const targetProjectId = update.usageProjectId || current.usageProjectId;
  const statusId = resolveColumnId(targetProjectId, data);
  if (statusId) update.statusId = statusId;
  if (hasOwn(data, 'title')) {
    const title = normalizeText(data.title, 180);
    if (!title) throw new Error('title cannot be empty.');
    update.title = title;
  }
  if (hasOwn(data, 'description')) update.description = normalizeLongText(data.description, 5000);
  if (hasOwn(data, 'priority')) update.priority = normalizePriority(data.priority) || current.priority;
  if (hasOwn(data, 'assigneeIds')) update.assigneeIds = normalizeStringArray(data.assigneeIds);
  if (hasOwn(data, 'tags')) update.tags = normalizeStringArray(data.tags, 20, 40);
  if (hasOwn(data, 'startDate')) update.startDate = normalizeText(data.startDate, 64) || null;
  if (hasOwn(data, 'dueDate')) update.dueDate = normalizeText(data.dueDate, 64) || null;
  if (hasOwn(data, 'completedAt')) update.completedAt = normalizeText(data.completedAt, 64) || null;
  if (hasOwn(data, 'blocked')) update.blocked = normalizeBoolean(data.blocked);
  if (hasOwn(data, 'blockedReason')) update.blockedReason = normalizeText(data.blockedReason, 300);
  if (hasOwn(data, 'archived')) update.archived = normalizeBoolean(data.archived);
  if (hasOwn(data, 'checklist')) update.checklist = normalizeChecklist(data.checklist);
  return update;
}

function runUpdate(data: Record<string, unknown>): WorkboardActionOutcome {
  const { item } = findWorkItem(normalizeText(data.itemId ?? data.workItemId, 128));
  const update = buildUpdate(data, item);
  const updated = updateUsageProjectWorkItem(item.id, update);
  const project = getUsageProject(updated.usageProjectId) || getUsageProject(item.usageProjectId);
  const columns = getColumns(updated.usageProjectId);
  return {
    result: { ok: true, action: 'update', project, item: updated, column: columnForItem(updated, columns) },
    audit: {
      title: `Updated Workboard item ${updated.title}`,
      status: 'success',
      projectId: updated.usageProjectId,
      itemId: updated.id,
      targetType: 'workboard_item',
      targetId: updated.id,
      metadata: { changedFields: Object.keys(update), statusId: updated.statusId },
    },
  };
}

function runComment(data: Record<string, unknown>): WorkboardActionOutcome {
  const { item } = findWorkItem(normalizeText(data.itemId ?? data.workItemId, 128));
  const note = makeNote(data, 'Agent comment');
  const updated = updateUsageProjectWorkItem(item.id, {
    notes: [note, ...(item.notes || [])],
  });
  return {
    result: { ok: true, action: 'comment', item: updated, note },
    audit: {
      title: `Commented on Workboard item ${updated.title}`,
      summary: note.text,
      status: 'success',
      projectId: updated.usageProjectId,
      itemId: updated.id,
      noteId: note.id,
      targetType: 'workboard_item',
      targetId: updated.id,
      metadata: { noteId: note.id, noteTitle: note.title },
    },
  };
}

function runComplete(data: Record<string, unknown>): WorkboardActionOutcome {
  const { item } = findWorkItem(normalizeText(data.itemId ?? data.workItemId, 128));
  const completedAt = normalizeText(data.completedAt, 64) || nowIso();
  const statusId = resolveColumnId(item.usageProjectId, data) || getDoneColumnId(item.usageProjectId);
  const update = maybeAppendNote(item, {
    completedAt,
    statusId,
    blocked: false,
    blockedReason: '',
  }, data, 'Completed');
  const updated = updateUsageProjectWorkItem(item.id, update);
  return {
    result: { ok: true, action: 'complete', item: updated },
    audit: {
      title: `Completed Workboard item ${updated.title}`,
      status: 'success',
      projectId: updated.usageProjectId,
      itemId: updated.id,
      targetType: 'workboard_item',
      targetId: updated.id,
      metadata: { completedAt: updated.completedAt, statusId: updated.statusId },
    },
  };
}

function runBlock(data: Record<string, unknown>): WorkboardActionOutcome {
  const { item } = findWorkItem(normalizeText(data.itemId ?? data.workItemId, 128));
  const reason = normalizeText(data.reason ?? data.blockedReason, 300) || 'Blocked';
  const statusId = resolveColumnId(item.usageProjectId, data) || getWaitingColumnId(item.usageProjectId);
  const update = maybeAppendNote(item, {
    blocked: true,
    blockedReason: reason,
    statusId,
  }, { ...data, text: data.text ?? data.comment }, 'Blocked');
  const updated = updateUsageProjectWorkItem(item.id, update);
  return {
    result: { ok: true, action: 'block', item: updated },
    audit: {
      title: `Blocked Workboard item ${updated.title}`,
      summary: reason,
      status: 'warning',
      projectId: updated.usageProjectId,
      itemId: updated.id,
      targetType: 'workboard_item',
      targetId: updated.id,
      metadata: { blockedReason: reason, statusId: updated.statusId },
    },
  };
}

function runUnblock(data: Record<string, unknown>): WorkboardActionOutcome {
  const { item } = findWorkItem(normalizeText(data.itemId ?? data.workItemId, 128));
  const statusId = resolveColumnId(item.usageProjectId, data);
  const update = maybeAppendNote(item, {
    blocked: false,
    blockedReason: '',
    statusId,
  }, data, 'Unblocked');
  const updated = updateUsageProjectWorkItem(item.id, update);
  return {
    result: { ok: true, action: 'unblock', item: updated },
    audit: {
      title: `Unblocked Workboard item ${updated.title}`,
      status: 'success',
      projectId: updated.usageProjectId,
      itemId: updated.id,
      targetType: 'workboard_item',
      targetId: updated.id,
      metadata: { statusId: updated.statusId },
    },
  };
}

function runLink(data: Record<string, unknown>): WorkboardActionOutcome {
  const { item } = findWorkItem(normalizeText(data.itemId ?? data.workItemId, 128));
  const linkKind = normalizeText(data.kind ?? data.linkKind, 32).toLowerCase();
  if (linkKind === 'document' || data.path || data.filePath || data.documentPath || data.documentUrl) {
    const documentLink = makeDocumentLink(data);
    const updated = updateUsageProjectWorkItem(item.id, {
      documents: [documentLink, ...(item.documents || [])],
    });
    return {
      result: { ok: true, action: 'link', item: updated, document: documentLink },
      audit: {
        title: `Linked document to Workboard item ${updated.title}`,
        summary: documentLink.url || documentLink.path,
        status: 'success',
        projectId: updated.usageProjectId,
        itemId: updated.id,
        targetType: 'workboard_item',
        targetId: updated.id,
        metadata: { documentId: documentLink.id, kind: documentLink.kind, url: documentLink.url, path: documentLink.path },
      },
    };
  }

  const source = makeSourceLink(data);
  const updated = updateUsageProjectWorkItem(item.id, {
    sources: [source, ...(item.sources || [])],
  });
  return {
    result: { ok: true, action: 'link', item: updated, source },
    audit: {
      title: `Linked source to Workboard item ${updated.title}`,
      summary: source.url,
      status: 'success',
      projectId: updated.usageProjectId,
      itemId: updated.id,
      targetType: 'workboard_item',
      targetId: updated.id,
      metadata: { sourceId: source.id, url: source.url, sourceTitle: source.title },
    },
  };
}

function runHeartbeat(data: Record<string, unknown>): WorkboardActionOutcome {
  const itemId = normalizeText(data.itemId ?? data.workItemId, 128);
  const message = normalizeLongText(data.message ?? data.text ?? data.status, 5000);
  const timestamp = nowIso();
  if (itemId) {
    const { item } = findWorkItem(itemId);
    let updated = item;
    let noteId: string | undefined;
    if (message) {
      const note = makeNote({ text: message, title: data.title ?? 'Heartbeat' }, 'Heartbeat');
      noteId = note.id;
      updated = updateUsageProjectWorkItem(item.id, {
        notes: [note, ...(item.notes || [])],
      });
    }
    return {
      result: { ok: true, action: 'heartbeat', item: updated, timestamp },
      audit: {
        title: `Heartbeat for Workboard item ${updated.title}`,
        summary: message || undefined,
        projectId: updated.usageProjectId,
        itemId: updated.id,
        noteId,
        targetType: 'workboard_item',
        targetId: updated.id,
        metadata: { timestamp, noteId },
      },
    };
  }

  const project = (data.projectId || data.projectName) ? resolveProject(data) : null;
  return {
    result: { ok: true, action: 'heartbeat', project, timestamp, message: message || undefined },
    audit: {
      title: project ? `Heartbeat for Workboard ${getProjectLabel(project)}` : 'Workboard heartbeat',
      summary: message || undefined,
      projectId: project?.id,
      targetType: project ? 'workboard_project' : 'workboard',
      targetId: project?.id || 'heartbeat',
      metadata: { timestamp },
    },
  };
}

function performAction(action: WorkboardAgentToolAction, data: Record<string, unknown>): WorkboardActionOutcome {
  switch (action) {
    case 'list':
      return runList(data);
    case 'show':
      return runShow(data);
    case 'create':
      return runCreate(data);
    case 'update':
      return runUpdate(data);
    case 'comment':
      return runComment(data);
    case 'complete':
      return runComplete(data);
    case 'block':
      return runBlock(data);
    case 'unblock':
      return runUnblock(data);
    case 'link':
      return runLink(data);
    case 'heartbeat':
      return runHeartbeat(data);
    default:
      throw new Error(`Unsupported Workboard action: ${action satisfies never}`);
  }
}

function recordWorkboardAudit(
  action: WorkboardAgentToolAction,
  context: WorkboardAgentContext,
  audit: WorkboardActionOutcome['audit']
): void {
  try {
    recordSystemAuditEvent({
      category: 'task',
      action: `workboard.${action}`,
      title: audit.title,
      summary: audit.summary,
      status: audit.status || 'info',
      agentId: context.agentId,
      taskId: context.taskId,
      projectId: audit.projectId,
      targetType: audit.targetType || (audit.itemId ? 'workboard_item' : 'workboard_project'),
      targetId: audit.targetId || audit.itemId || audit.projectId,
      source: 'workboard-agent-tools',
      jump: {
        kind: 'project_management',
        projectId: audit.projectId,
        workItemId: audit.itemId,
        noteId: audit.noteId,
      },
      metadata: {
        action,
        ...audit.metadata,
      },
    });
  } catch {
    // Audit should not make Workboard tool execution fail.
  }
}

function recordFailedWorkboardAudit(
  action: WorkboardAgentToolAction,
  context: WorkboardAgentContext,
  data: Record<string, unknown>,
  error: unknown
): void {
  const itemId = normalizeText(data.itemId ?? data.workItemId, 128) || undefined;
  const projectId = normalizeText(data.projectId ?? data.usageProjectId, 128) || undefined;
  const message = error instanceof Error ? error.message : String(error);
  recordWorkboardAudit(action, context, {
    title: `Workboard ${action} failed`,
    summary: message,
    status: 'error',
    projectId,
    itemId,
    targetType: itemId ? 'workboard_item' : projectId ? 'workboard_project' : 'workboard',
    targetId: itemId || projectId || action,
    metadata: { error: message },
  });
}

export function executeWorkboardAgentTool(
  action: WorkboardAgentToolAction,
  data: Record<string, unknown> = {}
): WorkboardAgentToolResult {
  const context = getContext(data);
  try {
    const outcome = performAction(action, data);
    recordWorkboardAudit(action, context, outcome.audit);
    return outcome.result;
  } catch (error) {
    recordFailedWorkboardAudit(action, context, data, error);
    throw error;
  }
}

export const __workboardAgentToolsTest = {
  normalizeStringArray,
  resolveColumnId,
  findWorkItem,
  summarizeWorkItem,
};
