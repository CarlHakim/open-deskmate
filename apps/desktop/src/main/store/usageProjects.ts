import { randomUUID } from 'crypto';
import Store from 'electron-store';
import type {
  CurrencyCode,
  UsageAssignee,
  UsageAssigneeInput,
  UsageAssigneeUpdate,
  UsageProject,
  UsageProjectBillingType,
  UsageProjectBudgetWindow,
  UsageProjectBudgetWindowInput,
  UsageProjectBudgetWindowUpdate,
  UsageProjectChatTheme,
  UsageProjectKanbanColumn,
  UsageProjectKanbanColumnInput,
  UsageProjectKanbanColumnUpdate,
  UsageProjectInput,
  UsageProjectLink,
  UsageProjectNote,
  UsageProjectPriority,
  UsageProjectUpdate,
  UsageProjectWorkItem,
  UsageProjectWorkItemChecklistItem,
  UsageProjectWorkItemChecklistList,
  UsageProjectWorkItemDocumentLink,
  UsageProjectWorkItemDrawing,
  UsageProjectWorkItemDrawingElement,
  UsageProjectWorkItemInput,
  UsageProjectWorkItemNote,
  UsageProjectWorkItemSourceLink,
  UsageProjectWorkItemSourceType,
  UsageProjectWorkItemUpdate,
} from '@accomplish/shared';

type UsageProjectsSchema = {
  projects: UsageProject[];
  budgetWindows: UsageProjectBudgetWindow[];
  assignees: UsageAssignee[];
  workItems: UsageProjectWorkItem[];
  kanbanColumns: UsageProjectKanbanColumn[];
};

const store = new Store<UsageProjectsSchema>({
  name: 'usage-projects',
  defaults: {
    projects: [],
    budgetWindows: [],
    assignees: [],
    workItems: [],
    kanbanColumns: [],
  },
});

const DEFAULT_KANBAN_COLUMNS: Array<Pick<UsageProjectKanbanColumn, 'name' | 'order' | 'color' | 'doneState' | 'archivedState'>> = [
  { name: 'Backlog', order: 0, color: '#64748b' },
  { name: 'Ready', order: 1, color: '#3b82f6' },
  { name: 'In progress', order: 2, color: '#f59e0b' },
  { name: 'Waiting', order: 3, color: '#a855f7' },
  { name: 'Review', order: 4, color: '#06b6d4' },
  { name: 'Done', order: 5, color: '#22c55e', doneState: true },
  { name: 'Archived', order: 6, color: '#64748b', archivedState: true },
];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim().replace(/\s+/g, ' ');
}

function normalizeColor(value: unknown): string | undefined {
  const color = normalizeText(value).slice(0, 32);
  return color || undefined;
}

function normalizeOutlineColor(value: unknown): string | undefined {
  const color = normalizeText(value).slice(0, 32);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

function normalizeLongText(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim();
}

function normalizeBillingType(value: unknown): UsageProjectBillingType {
  const raw = normalizeText(value).toLowerCase();
  const allowed: UsageProjectBillingType[] = ['internal', 'client_billable', 'fixed_fee', 'retainer', 'r_and_d', 'support', 'other'];
  return allowed.includes(raw as UsageProjectBillingType) ? raw as UsageProjectBillingType : 'internal';
}

function normalizePriority(value: unknown): UsageProjectPriority {
  const raw = normalizeText(value).toLowerCase();
  const allowed: UsageProjectPriority[] = ['low', 'normal', 'high', 'urgent'];
  return allowed.includes(raw as UsageProjectPriority) ? raw as UsageProjectPriority : 'normal';
}

function isAllowedProjectLinkUrl(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (/^\\\\/.test(value)) return true;
  if (/^\//.test(value)) return true;
  if (/^\.{1,2}[\\/]/.test(value)) return true;
  return false;
}

function normalizeProjectLinks(value: unknown): UsageProjectLink[] {
  if (!Array.isArray(value)) return [];
  const links: UsageProjectLink[] = [];
  for (const entry of value.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Partial<UsageProjectLink>;
    const url = normalizeLongText(source.url).slice(0, 1024);
    if (!url || !isAllowedProjectLinkUrl(url)) continue;
    const label = normalizeText(source.label || 'Link').slice(0, 80) || 'Link';
    links.push({
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      label,
      url,
    });
  }
  return links;
}

function normalizeProjectTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tag = normalizeText(item).slice(0, 40);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
}

function normalizeProjectChatTheme(value: unknown): UsageProjectChatTheme | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<UsageProjectChatTheme>;
  const theme: UsageProjectChatTheme = {
    backgroundId: normalizeText(source.backgroundId).slice(0, 80) || undefined,
    accentColor: normalizeColor(source.accentColor),
    defaultPromptCategory: normalizeText(source.defaultPromptCategory).slice(0, 80) || undefined,
    defaultPromptIds: normalizeIdList(source.defaultPromptIds).slice(0, 20),
    avatarFrame: normalizeText(source.avatarFrame).slice(0, 80) || undefined,
  };
  if (theme.defaultPromptIds?.length === 0) {
    delete theme.defaultPromptIds;
  }
  return Object.values(theme).some((entry) => entry !== undefined) ? theme : undefined;
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = normalizeText(item).slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 80) break;
  }
  return ids;
}

function normalizeProjectNotes(value: unknown, legacyNotes: unknown): UsageProjectNote[] {
  const notes: UsageProjectNote[] = [];
  const hasStructuredNotes = Array.isArray(value);
  const source = hasStructuredNotes ? value.slice(0, 100) : [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Partial<UsageProjectNote>;
    const text = normalizeLongText(item.text).slice(0, 5000);
    if (!text) continue;
    const createdAt = normalizeDateString(item.createdAt, nowIso());
    notes.push({
      id: normalizeText(item.id).slice(0, 80) || randomUUID(),
      text,
      createdAt,
      updatedAt: item.updatedAt ? normalizeDateString(item.updatedAt, createdAt) : undefined,
    });
  }

  if (notes.length === 0 && !hasStructuredNotes) {
    const legacy = normalizeLongText(legacyNotes).slice(0, 5000);
    if (legacy) {
      const timestamp = nowIso();
      notes.push({
        id: randomUUID(),
        text: legacy,
        createdAt: timestamp,
      });
    }
  }

  return notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeWorkItemSourceType(value: unknown): UsageProjectWorkItemSourceType {
  const raw = normalizeText(value).toLowerCase();
  const allowed: UsageProjectWorkItemSourceType[] = ['manual', 'chat_project', 'chat_task', 'build_preset', 'build_session'];
  return allowed.includes(raw as UsageProjectWorkItemSourceType) ? raw as UsageProjectWorkItemSourceType : 'manual';
}

function normalizeWorkItemChecklist(value: unknown): UsageProjectWorkItemChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).flatMap((entry): UsageProjectWorkItemChecklistItem[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<UsageProjectWorkItemChecklistItem>;
    const text = normalizeText(source.text).slice(0, 300);
    if (!text) return [];
    const createdAt = normalizeDateString(source.createdAt, nowIso());
    return [{
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      text,
      completed: source.completed === true,
      assigneeIds: normalizeIdList(source.assigneeIds),
      dueDate: normalizeOptionalDateString(source.dueDate),
      createdAt,
      updatedAt: source.updatedAt ? normalizeDateString(source.updatedAt, createdAt) : undefined,
    }];
  });
}

function normalizeWorkItemChecklistLists(value: unknown, legacyChecklist: unknown): UsageProjectWorkItemChecklistList[] {
  const lists: UsageProjectWorkItemChecklistList[] = [];
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) {
      if (!entry || typeof entry !== 'object') continue;
      const source = entry as Partial<UsageProjectWorkItemChecklistList>;
      const items = normalizeWorkItemChecklist(source.items);
      const name = normalizeText(source.name, 'List').slice(0, 80) || 'List';
      const createdAt = normalizeDateString(source.createdAt, nowIso());
      lists.push({
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      name,
      items,
      context: normalizeLongText(source.context).slice(0, 5000) || undefined,
      outlineColor: normalizeOutlineColor(source.outlineColor),
      createdAt,
      updatedAt: source.updatedAt ? normalizeDateString(source.updatedAt, createdAt) : undefined,
    });
    }
  }

  if (lists.length === 0) {
    const items = normalizeWorkItemChecklist(legacyChecklist);
    if (items.length > 0) {
      const timestamp = nowIso();
      lists.push({
        id: randomUUID(),
        name: 'Checklist',
        items,
        context: undefined,
        outlineColor: undefined,
        createdAt: timestamp,
      });
    }
  }

  return lists;
}

const WORK_ITEM_NOTE_TEXT_MAX_LENGTH = 100_000;
const WORK_ITEM_NOTE_HTML_MAX_LENGTH = 300_000;

function normalizeWorkItemNotes(value: unknown): UsageProjectWorkItemNote[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry): UsageProjectWorkItemNote[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<UsageProjectWorkItemNote>;
    const text = normalizeLongText(source.text).slice(0, WORK_ITEM_NOTE_TEXT_MAX_LENGTH);
    const html = normalizeLongText(source.html)
      .slice(0, WORK_ITEM_NOTE_HTML_MAX_LENGTH)
      .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
      .trim();
    if (!text) return [];
    const createdAt = normalizeDateString(source.createdAt, nowIso());
    return [{
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      title: normalizeText(source.title).slice(0, 160) || undefined,
      text,
      html: html || undefined,
      outlineColor: normalizeOutlineColor(source.outlineColor),
      createdAt,
      updatedAt: source.updatedAt ? normalizeDateString(source.updatedAt, createdAt) : undefined,
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeDrawingNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(-10000, Math.min(10000, num));
}

function normalizeDrawingColor(value: unknown, fallback: string): string {
  const raw = normalizeText(value).slice(0, 32);
  return /^#[0-9a-f]{6}$/i.test(raw) || raw === 'transparent' ? raw : fallback;
}

function normalizeDrawingStrokeStyle(value: unknown): UsageProjectWorkItemDrawingElement['strokeStyle'] {
  const raw = normalizeText(value).toLowerCase();
  return raw === 'dashed' || raw === 'dotted' ? raw : 'solid';
}

function normalizeDrawingOpacity(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(0, Math.min(1, num));
}

function normalizeWorkItemDrawingElements(value: unknown): UsageProjectWorkItemDrawingElement[] {
  if (!Array.isArray(value)) return [];
  const allowedKinds = new Set(['rectangle', 'ellipse', 'triangle', 'line', 'arrow', 'text']);
  return value.slice(0, 80).flatMap((entry): UsageProjectWorkItemDrawingElement[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<UsageProjectWorkItemDrawingElement>;
    const kind = normalizeText(source.kind);
    if (!allowedKinds.has(kind)) return [];
    return [{
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      kind: kind as UsageProjectWorkItemDrawingElement['kind'],
      x1: normalizeDrawingNumber(source.x1),
      y1: normalizeDrawingNumber(source.y1),
      x2: normalizeDrawingNumber(source.x2),
      y2: normalizeDrawingNumber(source.y2),
      stroke: normalizeDrawingColor(source.stroke, '#38bdf8'),
      fill: normalizeDrawingColor(source.fill, 'transparent'),
      fillOpacity: normalizeDrawingOpacity(source.fillOpacity),
      strokeWidth: Math.max(1, Math.min(12, normalizeDrawingNumber(source.strokeWidth, 2))),
      strokeStyle: normalizeDrawingStrokeStyle(source.strokeStyle),
      text: normalizeLongText(source.text).slice(0, 500) || undefined,
      fontSize: Math.max(10, Math.min(72, normalizeDrawingNumber(source.fontSize, 24))),
    }];
  });
}

function normalizeWorkItemDrawings(value: unknown): UsageProjectWorkItemDrawing[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry): UsageProjectWorkItemDrawing[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<UsageProjectWorkItemDrawing>;
    const elements = normalizeWorkItemDrawingElements(source.elements);
    const title = normalizeText(source.title, 'Drawing').slice(0, 120) || 'Drawing';
    const createdAt = normalizeDateString(source.createdAt, nowIso());
    return [{
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      title,
      width: Math.max(320, Math.min(1600, normalizeDrawingNumber(source.width, 640))),
      height: Math.max(200, Math.min(1200, normalizeDrawingNumber(source.height, 360))),
      elements,
      outlineColor: normalizeOutlineColor(source.outlineColor),
      createdAt,
      updatedAt: source.updatedAt ? normalizeDateString(source.updatedAt, createdAt) : undefined,
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeWorkItemDocuments(value: unknown): UsageProjectWorkItemDocumentLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((entry): UsageProjectWorkItemDocumentLink[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<UsageProjectWorkItemDocumentLink>;
    const kind = source.kind === 'url' ? 'url' : 'local';
    const rawPath = normalizeLongText(source.path).slice(0, 1024);
    const rawUrl = normalizeLongText(source.url).slice(0, 2048);
    const hasTarget = kind === 'url' ? /^https?:\/\//i.test(rawUrl) : rawPath.length > 0;
    if (!hasTarget) return [];
    const fallbackLabel = kind === 'url'
      ? rawUrl.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || 'Document link'
      : rawPath.split(/[\\/]/).filter(Boolean).pop() || 'Local document';
    return [{
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      label: normalizeText(source.label, fallbackLabel).slice(0, 160) || fallbackLabel,
      kind,
      path: kind === 'local' ? rawPath : undefined,
      url: kind === 'url' ? rawUrl : undefined,
      outlineColor: normalizeOutlineColor(source.outlineColor),
      createdAt: normalizeDateString(source.createdAt, nowIso()),
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeWorkItemSources(value: unknown): UsageProjectWorkItemSourceLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry): UsageProjectWorkItemSourceLink[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Partial<UsageProjectWorkItemSourceLink>;
    const url = normalizeLongText(source.url).slice(0, 2048);
    if (!/^https?:\/\//i.test(url)) return [];
    let fallbackTitle = 'Source';
    try {
      fallbackTitle = new URL(url).hostname.replace(/^www\./i, '') || fallbackTitle;
    } catch {
      fallbackTitle = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || fallbackTitle;
    }
    const createdAt = normalizeDateString(source.createdAt, nowIso());
    return [{
      id: normalizeText(source.id).slice(0, 80) || randomUUID(),
      title: normalizeText(source.title, fallbackTitle).slice(0, 180) || fallbackTitle,
      url,
      description: normalizeLongText(source.description).slice(0, 1000) || undefined,
      createdAt,
      updatedAt: source.updatedAt ? normalizeDateString(source.updatedAt, createdAt) : undefined,
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeLimit(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function normalizeCurrency(value: unknown): CurrencyCode | undefined {
  const currency = normalizeText(value).toUpperCase();
  return ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].includes(currency)
    ? currency as CurrencyCode
    : undefined;
}

function normalizeDateString(value: unknown, fallback?: string): string {
  const raw = normalizeText(value, fallback || '');
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? (fallback || nowIso()) : parsed.toISOString();
}

function normalizeOptionalDateString(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeProject(input: UsageProject): UsageProject {
  const createdAt = normalizeDateString(input.createdAt, nowIso());
  const status = input.status === 'archived' ? 'archived' : 'active';
  return {
    id: normalizeText(input.id) || randomUUID(),
    name: normalizeText(input.name, 'Usage project').slice(0, 120) || 'Usage project',
    color: normalizeColor(input.color),
    status,
    trackingEnabled: input.trackingEnabled !== false,
    clientName: normalizeText(input.clientName).slice(0, 120),
    projectCode: normalizeText(input.projectCode).slice(0, 64),
    owner: normalizeText(input.owner).slice(0, 120),
    billingType: normalizeBillingType(input.billingType),
    billingReference: normalizeText(input.billingReference).slice(0, 160),
    priority: normalizePriority(input.priority),
    dueDate: normalizeOptionalDateString(input.dueDate),
    notes: normalizeLongText(input.notes).slice(0, 5000),
    noteEntries: normalizeProjectNotes(input.noteEntries, input.notes),
    links: normalizeProjectLinks(input.links),
    tags: normalizeProjectTags(input.tags),
    chatTheme: normalizeProjectChatTheme(input.chatTheme),
    assigneeIds: normalizeIdList(input.assigneeIds),
    createdAt,
    updatedAt: normalizeDateString(input.updatedAt, createdAt),
    archivedAt: status === 'archived' ? normalizeOptionalDateString(input.archivedAt) || normalizeDateString(input.updatedAt, createdAt) : undefined,
  };
}

function normalizeBudgetWindow(input: UsageProjectBudgetWindow): UsageProjectBudgetWindow {
  const createdAt = normalizeDateString(input.createdAt, nowIso());
  return {
    id: normalizeText(input.id) || randomUUID(),
    projectId: normalizeText(input.projectId),
    name: normalizeText(input.name, 'Budget window').slice(0, 120) || 'Budget window',
    startsAt: normalizeDateString(input.startsAt, createdAt),
    endsAt: normalizeOptionalDateString(input.endsAt),
    enabled: input.enabled !== false,
    mode: input.mode === 'block' ? 'block' : 'warn',
    moneyLimit: normalizeLimit(input.moneyLimit),
    tokenLimit: normalizeLimit(input.tokenLimit),
    currency: normalizeCurrency(input.currency),
    createdAt,
    updatedAt: normalizeDateString(input.updatedAt, createdAt),
  };
}

function normalizeKanbanColumn(input: UsageProjectKanbanColumn): UsageProjectKanbanColumn {
  const createdAt = normalizeDateString(input.createdAt, nowIso());
  const order = typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : 0;
  return {
    id: normalizeText(input.id).slice(0, 128) || randomUUID(),
    usageProjectId: normalizeText(input.usageProjectId).slice(0, 128),
    name: normalizeText(input.name, 'Column').slice(0, 80) || 'Column',
    order,
    color: normalizeColor(input.color),
    wipLimit: normalizeLimit(input.wipLimit),
    doneState: input.doneState === true,
    archivedState: input.archivedState === true,
    createdAt,
    updatedAt: normalizeDateString(input.updatedAt, createdAt),
  };
}

function normalizeWorkItem(input: UsageProjectWorkItem): UsageProjectWorkItem {
  const createdAt = normalizeDateString(input.createdAt, nowIso());
  const sourceType = normalizeWorkItemSourceType(input.sourceType);
  const completedAt = normalizeOptionalDateString(input.completedAt);
  return {
    id: normalizeText(input.id).slice(0, 128) || randomUUID(),
    usageProjectId: normalizeText(input.usageProjectId).slice(0, 128),
    title: normalizeText(input.title, 'Work item').slice(0, 180) || 'Work item',
    description: normalizeLongText(input.description).slice(0, 5000),
    color: normalizeColor(input.color),
    sourceType,
    sourceId: normalizeText(input.sourceId).slice(0, 160) || undefined,
    statusId: normalizeText(input.statusId).slice(0, 128),
    priority: normalizePriority(input.priority),
    assigneeIds: normalizeIdList(input.assigneeIds),
    startDate: normalizeOptionalDateString(input.startDate),
    dueDate: normalizeOptionalDateString(input.dueDate),
    completedAt,
    blocked: input.blocked === true,
    blockedReason: normalizeText(input.blockedReason).slice(0, 300),
    tags: normalizeProjectTags(input.tags),
    checklist: normalizeWorkItemChecklist(input.checklist),
    checklistLists: normalizeWorkItemChecklistLists(input.checklistLists, input.checklist),
    notes: normalizeWorkItemNotes(input.notes),
    drawings: normalizeWorkItemDrawings(input.drawings),
    documents: normalizeWorkItemDocuments(input.documents),
    sources: normalizeWorkItemSources(input.sources),
    archived: input.archived === true,
    createdAt,
    updatedAt: normalizeDateString(input.updatedAt, createdAt),
  };
}

function getProjectList(): UsageProject[] {
  const projects = (store.get('projects') || []).map(normalizeProject);
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

function getWindowList(): UsageProjectBudgetWindow[] {
  const projects = new Set(getProjectList().map((project) => project.id));
  const windows = (store.get('budgetWindows') || [])
    .map(normalizeBudgetWindow)
    .filter((window) => projects.has(window.projectId));
  return windows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function getKanbanColumnList(): UsageProjectKanbanColumn[] {
  const projects = new Set(getProjectList().map((project) => project.id));
  const columns = (store.get('kanbanColumns') || [])
    .map(normalizeKanbanColumn)
    .filter((column) => projects.has(column.usageProjectId));
  return columns.sort((a, b) => a.usageProjectId.localeCompare(b.usageProjectId) || a.order - b.order || a.name.localeCompare(b.name));
}

function getWorkItemList(): UsageProjectWorkItem[] {
  const projects = new Set(getProjectList().map((project) => project.id));
  const columns = new Set(getKanbanColumnList().map((column) => column.id));
  const items = (store.get('workItems') || [])
    .map(normalizeWorkItem)
    .filter((item) => projects.has(item.usageProjectId));
  return items
    .map((item) => ({
      ...item,
      statusId: item.statusId && columns.has(item.statusId) ? item.statusId : getDefaultKanbanColumnId(item.usageProjectId),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function setProjects(projects: UsageProject[]): void {
  store.set('projects', projects.map(normalizeProject));
}

function setBudgetWindows(windows: UsageProjectBudgetWindow[]): void {
  store.set('budgetWindows', windows.map(normalizeBudgetWindow));
}

function setKanbanColumns(columns: UsageProjectKanbanColumn[]): void {
  store.set('kanbanColumns', columns.map(normalizeKanbanColumn));
}

function setWorkItems(items: UsageProjectWorkItem[]): void {
  store.set('workItems', items.map(normalizeWorkItem));
}

function ensureDefaultKanbanColumns(projectId: string): UsageProjectKanbanColumn[] {
  const id = normalizeText(projectId);
  const existing = getKanbanColumnList().filter((column) => column.usageProjectId === id);
  if (existing.length > 0) return existing;
  const now = nowIso();
  const defaults = DEFAULT_KANBAN_COLUMNS.map((column) => normalizeKanbanColumn({
    id: randomUUID(),
    usageProjectId: id,
    name: column.name,
    order: column.order,
    color: column.color,
    wipLimit: null,
    doneState: column.doneState === true,
    archivedState: column.archivedState === true,
    createdAt: now,
    updatedAt: now,
  }));
  setKanbanColumns([...getKanbanColumnList(), ...defaults]);
  return defaults;
}

function getDefaultKanbanColumnId(projectId: string): string {
  const columns = ensureDefaultKanbanColumns(projectId);
  return columns.find((column) => !column.doneState && !column.archivedState)?.id || columns[0]?.id || '';
}

export function listUsageProjects(opts: { includeArchived?: boolean } = {}): UsageProject[] {
  const projects = getProjectList();
  return opts.includeArchived ? projects : projects.filter((project) => project.status === 'active');
}

export function getUsageProject(projectId: string | null | undefined): UsageProject | null {
  const id = normalizeText(projectId);
  if (!id) return null;
  return getProjectList().find((project) => project.id === id) || null;
}

export function createUsageProject(input: UsageProjectInput): UsageProject {
  const now = nowIso();
  const project: UsageProject = normalizeProject({
    id: randomUUID(),
    name: input.name,
    color: input.color,
    status: 'active',
    trackingEnabled: input.trackingEnabled !== false,
    clientName: input.clientName,
    projectCode: input.projectCode,
    owner: input.owner,
    billingType: input.billingType,
    billingReference: input.billingReference,
    priority: input.priority,
    dueDate: input.dueDate,
    notes: input.notes,
    noteEntries: input.noteEntries,
    links: input.links,
    tags: input.tags,
    chatTheme: input.chatTheme ?? undefined,
    assigneeIds: input.assigneeIds,
    createdAt: now,
    updatedAt: now,
  });
  setProjects([...getProjectList(), project]);
  return project;
}

export function updateUsageProject(projectId: string, update: UsageProjectUpdate): UsageProject {
  const id = normalizeText(projectId);
  const projects = getProjectList();
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) throw new Error('Usage project not found.');
  const existing = projects[index];
  const next: UsageProject = normalizeProject({
    ...existing,
    name: update.name !== undefined ? update.name : existing.name,
    color: update.color === null ? undefined : update.color !== undefined ? update.color : existing.color,
    trackingEnabled: update.trackingEnabled !== undefined ? Boolean(update.trackingEnabled) : existing.trackingEnabled,
    status: update.status === 'archived' ? 'archived' : update.status === 'active' ? 'active' : existing.status,
    clientName: update.clientName !== undefined ? update.clientName : existing.clientName,
    projectCode: update.projectCode !== undefined ? update.projectCode : existing.projectCode,
    owner: update.owner !== undefined ? update.owner : existing.owner,
    billingType: update.billingType !== undefined ? update.billingType : existing.billingType,
    billingReference: update.billingReference !== undefined ? update.billingReference : existing.billingReference,
    priority: update.priority !== undefined ? update.priority : existing.priority,
    dueDate: update.dueDate !== undefined ? update.dueDate : existing.dueDate,
    notes: update.notes !== undefined ? update.notes : existing.notes,
    noteEntries: update.noteEntries !== undefined ? update.noteEntries : existing.noteEntries,
    links: update.links !== undefined ? update.links : existing.links,
    tags: update.tags !== undefined ? update.tags : existing.tags,
    chatTheme: update.chatTheme === null ? undefined : update.chatTheme !== undefined ? update.chatTheme : existing.chatTheme,
    assigneeIds: update.assigneeIds !== undefined ? update.assigneeIds : existing.assigneeIds,
    updatedAt: nowIso(),
    archivedAt: update.status === 'archived' ? nowIso() : update.status === 'active' ? undefined : existing.archivedAt,
  });
  projects[index] = next;
  setProjects(projects);
  return next;
}

export function archiveUsageProject(projectId: string, archived = true): UsageProject {
  return updateUsageProject(projectId, { status: archived ? 'archived' : 'active' });
}

function normalizeAssignee(input: UsageAssignee): UsageAssignee {
  const createdAt = normalizeDateString(input.createdAt, nowIso());
  const status = input.status === 'archived' ? 'archived' : 'active';
  return {
    id: normalizeText(input.id).slice(0, 128) || randomUUID(),
    name: normalizeText(input.name, 'Assignee').slice(0, 120) || 'Assignee',
    role: normalizeText(input.role).slice(0, 120),
    email: normalizeText(input.email).slice(0, 160),
    phone: normalizeText(input.phone).slice(0, 80),
    company: normalizeText(input.company).slice(0, 120),
    notes: normalizeLongText(input.notes).slice(0, 5000),
    color: normalizeColor(input.color),
    status,
    createdAt,
    updatedAt: normalizeDateString(input.updatedAt, createdAt),
    archivedAt: status === 'archived' ? normalizeOptionalDateString(input.archivedAt) || normalizeDateString(input.updatedAt, createdAt) : undefined,
  };
}

function getAssigneeList(): UsageAssignee[] {
  const assignees = (store.get('assignees') || []).map(normalizeAssignee);
  return assignees.sort((a, b) => a.name.localeCompare(b.name));
}

function setAssignees(assignees: UsageAssignee[]): void {
  store.set('assignees', assignees.map(normalizeAssignee));
}

export function listUsageAssignees(opts: { includeArchived?: boolean } = {}): UsageAssignee[] {
  const assignees = getAssigneeList();
  return opts.includeArchived ? assignees : assignees.filter((assignee) => assignee.status === 'active');
}

export function getUsageAssignee(assigneeId: string | null | undefined): UsageAssignee | null {
  const id = normalizeText(assigneeId);
  if (!id) return null;
  return getAssigneeList().find((assignee) => assignee.id === id) || null;
}

export function createUsageAssignee(input: UsageAssigneeInput): UsageAssignee {
  const now = nowIso();
  const assignee = normalizeAssignee({
    id: randomUUID(),
    name: input.name,
    role: input.role,
    email: input.email,
    phone: input.phone,
    company: input.company,
    notes: input.notes,
    color: input.color,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  setAssignees([...getAssigneeList(), assignee]);
  return assignee;
}

export function updateUsageAssignee(assigneeId: string, update: UsageAssigneeUpdate): UsageAssignee {
  const id = normalizeText(assigneeId);
  const assignees = getAssigneeList();
  const index = assignees.findIndex((assignee) => assignee.id === id);
  if (index < 0) throw new Error('Assignee not found.');
  const existing = assignees[index];
  const next = normalizeAssignee({
    ...existing,
    name: update.name !== undefined ? update.name : existing.name,
    role: update.role !== undefined ? update.role : existing.role,
    email: update.email !== undefined ? update.email : existing.email,
    phone: update.phone !== undefined ? update.phone : existing.phone,
    company: update.company !== undefined ? update.company : existing.company,
    notes: update.notes !== undefined ? update.notes : existing.notes,
    color: update.color === null ? undefined : update.color !== undefined ? update.color : existing.color,
    status: update.status === 'archived' ? 'archived' : update.status === 'active' ? 'active' : existing.status,
    updatedAt: nowIso(),
    archivedAt: update.status === 'archived' ? nowIso() : update.status === 'active' ? undefined : existing.archivedAt,
  });
  assignees[index] = next;
  setAssignees(assignees);
  return next;
}

export function archiveUsageAssignee(assigneeId: string, archived = true): UsageAssignee {
  return updateUsageAssignee(assigneeId, { status: archived ? 'archived' : 'active' });
}

export function listUsageProjectBudgetWindows(projectId?: string | null): UsageProjectBudgetWindow[] {
  const id = normalizeText(projectId);
  return getWindowList().filter((window) => !id || window.projectId === id);
}

export function createUsageProjectBudgetWindow(input: UsageProjectBudgetWindowInput): UsageProjectBudgetWindow {
  const project = getUsageProject(input.projectId);
  if (!project) throw new Error('Usage project not found.');
  const now = nowIso();
  const window = normalizeBudgetWindow({
    id: randomUUID(),
    projectId: project.id,
    name: input.name || 'Budget window',
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    enabled: input.enabled !== false,
    mode: input.mode === 'block' ? 'block' : 'warn',
    moneyLimit: input.moneyLimit ?? null,
    tokenLimit: input.tokenLimit ?? null,
    currency: input.currency,
    createdAt: now,
    updatedAt: now,
  });
  setBudgetWindows([...getWindowList(), window]);
  if (!project.trackingEnabled) {
    updateUsageProject(project.id, { trackingEnabled: true });
  }
  return window;
}

export function updateUsageProjectBudgetWindow(windowId: string, update: UsageProjectBudgetWindowUpdate): UsageProjectBudgetWindow {
  const id = normalizeText(windowId);
  const windows = getWindowList();
  const index = windows.findIndex((window) => window.id === id);
  if (index < 0) throw new Error('Budget window not found.');
  const existing = windows[index];
  const projectId = update.projectId ? normalizeText(update.projectId) : existing.projectId;
  if (!getUsageProject(projectId)) throw new Error('Usage project not found.');
  const next = normalizeBudgetWindow({
    ...existing,
    projectId,
    name: update.name !== undefined ? update.name : existing.name,
    startsAt: update.startsAt !== undefined ? update.startsAt : existing.startsAt,
    endsAt: update.endsAt !== undefined ? update.endsAt : existing.endsAt,
    enabled: update.enabled !== undefined ? Boolean(update.enabled) : existing.enabled,
    mode: update.mode === 'block' ? 'block' : update.mode === 'warn' ? 'warn' : existing.mode,
    moneyLimit: update.moneyLimit !== undefined ? update.moneyLimit : existing.moneyLimit,
    tokenLimit: update.tokenLimit !== undefined ? update.tokenLimit : existing.tokenLimit,
    currency: update.currency !== undefined ? update.currency : existing.currency,
    updatedAt: nowIso(),
  });
  windows[index] = next;
  setBudgetWindows(windows);
  return next;
}

export function deleteUsageProjectBudgetWindow(windowId: string): { ok: true } {
  const id = normalizeText(windowId);
  setBudgetWindows(getWindowList().filter((window) => window.id !== id));
  return { ok: true };
}

export function listUsageProjectKanbanColumns(projectId: string): UsageProjectKanbanColumn[] {
  const project = getUsageProject(projectId);
  if (!project) throw new Error('Usage project not found.');
  return ensureDefaultKanbanColumns(project.id);
}

export function createUsageProjectKanbanColumn(input: UsageProjectKanbanColumnInput): UsageProjectKanbanColumn {
  const project = getUsageProject(input.usageProjectId);
  if (!project) throw new Error('Usage project not found.');
  const now = nowIso();
  const existing = ensureDefaultKanbanColumns(project.id);
  const column = normalizeKanbanColumn({
    id: randomUUID(),
    usageProjectId: project.id,
    name: input.name,
    order: typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : existing.length,
    color: input.color,
    wipLimit: input.wipLimit ?? null,
    doneState: input.doneState === true,
    archivedState: input.archivedState === true,
    createdAt: now,
    updatedAt: now,
  });
  setKanbanColumns([...getKanbanColumnList(), column]);
  return column;
}

export function updateUsageProjectKanbanColumn(columnId: string, update: UsageProjectKanbanColumnUpdate): UsageProjectKanbanColumn {
  const id = normalizeText(columnId);
  const columns = getKanbanColumnList();
  const index = columns.findIndex((column) => column.id === id);
  if (index < 0) throw new Error('Kanban column not found.');
  const existing = columns[index];
  const usageProjectId = update.usageProjectId ? normalizeText(update.usageProjectId) : existing.usageProjectId;
  if (!getUsageProject(usageProjectId)) throw new Error('Usage project not found.');
  const next = normalizeKanbanColumn({
    ...existing,
    usageProjectId,
    name: update.name !== undefined ? update.name : existing.name,
    order: update.order !== undefined ? update.order : existing.order,
    color: update.color !== undefined ? update.color : existing.color,
    wipLimit: update.wipLimit !== undefined ? update.wipLimit : existing.wipLimit,
    doneState: update.doneState !== undefined ? update.doneState : existing.doneState,
    archivedState: update.archivedState !== undefined ? update.archivedState : existing.archivedState,
    updatedAt: nowIso(),
  });
  columns[index] = next;
  setKanbanColumns(columns);
  return next;
}

export function deleteUsageProjectKanbanColumn(columnId: string): { ok: true } {
  const id = normalizeText(columnId);
  const columns = getKanbanColumnList();
  const target = columns.find((column) => column.id === id);
  if (!target) return { ok: true };
  const projectColumns = columns.filter((column) => column.usageProjectId === target.usageProjectId && column.id !== id);
  if (projectColumns.length === 0) throw new Error('Cannot delete the last Kanban column.');
  const fallbackId = projectColumns.find((column) => !column.archivedState)?.id || projectColumns[0].id;
  const movedItems = getWorkItemList().map((item) => (
    item.statusId === id ? { ...item, statusId: fallbackId, updatedAt: nowIso() } : item
  ));
  setWorkItems(movedItems);
  setKanbanColumns(columns.filter((column) => column.id !== id));
  return { ok: true };
}

export function listUsageProjectWorkItems(projectId: string, opts: { includeArchived?: boolean } = {}): UsageProjectWorkItem[] {
  const project = getUsageProject(projectId);
  if (!project) throw new Error('Usage project not found.');
  ensureDefaultKanbanColumns(project.id);
  return getWorkItemList().filter((item) => (
    item.usageProjectId === project.id && (opts.includeArchived || !item.archived)
  ));
}

export function createUsageProjectWorkItem(input: UsageProjectWorkItemInput): UsageProjectWorkItem {
  const project = getUsageProject(input.usageProjectId);
  if (!project) throw new Error('Usage project not found.');
  const now = nowIso();
  const columns = ensureDefaultKanbanColumns(project.id);
  const statusId = normalizeText(input.statusId);
  const validStatusId = columns.some((column) => column.id === statusId)
    ? statusId
    : getDefaultKanbanColumnId(project.id);
  const item = normalizeWorkItem({
    id: randomUUID(),
    usageProjectId: project.id,
    title: input.title,
    description: input.description,
    color: input.color ?? undefined,
    sourceType: input.sourceType || 'manual',
    sourceId: input.sourceId || undefined,
    statusId: validStatusId,
    priority: input.priority || 'normal',
    assigneeIds: input.assigneeIds || [],
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    completedAt: input.completedAt ?? null,
    blocked: input.blocked === true,
    blockedReason: input.blockedReason,
    tags: input.tags || [],
    checklist: input.checklist || [],
    checklistLists: input.checklistLists || [],
    notes: input.notes || [],
    drawings: input.drawings || [],
    documents: input.documents || [],
    sources: input.sources || [],
    archived: input.archived === true,
    createdAt: now,
    updatedAt: now,
  });
  setWorkItems([...getWorkItemList(), item]);
  return item;
}

export function updateUsageProjectWorkItem(itemId: string, update: UsageProjectWorkItemUpdate): UsageProjectWorkItem {
  const id = normalizeText(itemId);
  const items = getWorkItemList();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('Work item not found.');
  const existing = items[index];
  const usageProjectId = update.usageProjectId ? normalizeText(update.usageProjectId) : existing.usageProjectId;
  if (!getUsageProject(usageProjectId)) throw new Error('Usage project not found.');
  const columns = ensureDefaultKanbanColumns(usageProjectId);
  const requestedStatus = update.statusId !== undefined ? normalizeText(update.statusId) : existing.statusId;
  const validStatusId = columns.some((column) => column.id === requestedStatus)
    ? requestedStatus
    : getDefaultKanbanColumnId(usageProjectId);
  const doneColumn = columns.find((column) => column.id === validStatusId && column.doneState);
  const completedAt = update.completedAt !== undefined
    ? update.completedAt
    : doneColumn && !existing.completedAt
      ? nowIso()
      : !doneColumn
        ? null
        : existing.completedAt;
  const next = normalizeWorkItem({
    ...existing,
    usageProjectId,
    title: update.title !== undefined ? update.title : existing.title,
    description: update.description !== undefined ? update.description : existing.description,
    color: update.color === null ? undefined : update.color !== undefined ? update.color : existing.color,
    sourceType: update.sourceType !== undefined ? update.sourceType : existing.sourceType,
    sourceId: update.sourceId === null ? undefined : update.sourceId !== undefined ? update.sourceId : existing.sourceId,
    statusId: validStatusId,
    priority: update.priority !== undefined ? update.priority : existing.priority,
    assigneeIds: update.assigneeIds !== undefined ? update.assigneeIds : existing.assigneeIds,
    startDate: update.startDate !== undefined ? update.startDate : existing.startDate,
    dueDate: update.dueDate !== undefined ? update.dueDate : existing.dueDate,
    completedAt,
    blocked: update.blocked !== undefined ? update.blocked : existing.blocked,
    blockedReason: update.blockedReason !== undefined ? update.blockedReason : existing.blockedReason,
    tags: update.tags !== undefined ? update.tags : existing.tags,
    checklist: update.checklist !== undefined ? update.checklist : existing.checklist,
    checklistLists: update.checklistLists !== undefined ? update.checklistLists : existing.checklistLists,
    notes: update.notes !== undefined ? update.notes : existing.notes,
    drawings: update.drawings !== undefined ? update.drawings : existing.drawings,
    documents: update.documents !== undefined ? update.documents : existing.documents,
    sources: update.sources !== undefined ? update.sources : existing.sources,
    archived: update.archived !== undefined ? update.archived : existing.archived,
    updatedAt: nowIso(),
  });
  items[index] = next;
  setWorkItems(items);
  return next;
}

export function archiveUsageProjectWorkItem(itemId: string, archived = true): UsageProjectWorkItem {
  return updateUsageProjectWorkItem(itemId, { archived });
}
