import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, CheckCircle2, ChevronDown, Columns3, Download, ExternalLink, Info, Pencil, Plus, Search, Tag, Trash2, UserPlus, Users, X } from 'lucide-react';
import type {
  BuildProjectPreset,
  BuildTaskSession,
  BuildTaskSessionListItem,
  Folder as ChatFolder,
  Task,
  UsageAssignee,
  UsageProjectBillingType,
  UsageProjectAnalytics,
  UsageProjectLink,
  UsageProjectNote,
  UsageProjectPriority,
  UsageProjectSummary,
} from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getAccomplish } from '@/lib/accomplish';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { useFolderStore } from '@/stores/folderStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUsageProjectStore } from '@/stores/usageProjectStore';
import ProjectWorkboardTab, { type WorkboardSourceOption } from './ProjectWorkboardTab';

type BuildPresetBudgetGroup = {
  key: string;
  agentId: string;
  presetId: string;
  preset: BuildProjectPreset | null;
  name: string;
  workspaceRelativePath?: string;
  presetAttached: boolean;
  sessions: BuildTaskSessionListItem[];
};

type AssignmentTypeFilter = 'all' | 'chat-project' | 'chat-task' | 'build-preset' | 'build-session';
type AssignmentStatusFilter = 'all' | 'unassigned' | 'this-budget' | 'elsewhere';
type AssignmentColumnId = 'name' | 'type' | 'context' | 'count' | 'assignees' | 'budget';
type AssignmentColumnWidths = Record<AssignmentColumnId, number>;
type AssignmentHiddenColumns = Partial<Record<AssignmentColumnId, boolean>>;
type ProjectManagementTab = 'overview' | 'analytics' | 'workboard' | 'work' | 'assignees' | 'budgets' | 'usage' | 'details' | 'notes';
type AnalyticsRangeMode = 'last-30' | 'last-3-months' | 'last-6-months' | 'custom' | `window:${string}`;

type WorkAssignmentRow = {
  key: string;
  type: Exclude<AssignmentTypeFilter, 'all'>;
  typeLabel: string;
  name: string;
  detail: string;
  countLabel: string;
  usageProjectId: string | null;
  assigneeIds?: string[] | null;
  effectiveAssigneeIds: string[];
  assigneeMode: 'inherit' | 'override' | 'none' | 'unavailable';
  note: string;
  searchText: string;
  folder?: ChatFolder;
  task?: Task;
  preset?: BuildProjectPreset;
  session?: BuildTaskSessionListItem;
};

const USAGE_PROJECT_COLOR_SWATCHES = [
  '#2dd4bf',
  '#22c55e',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
  '#3b82f6',
  '#06b6d4',
  '#64748b',
];

const USAGE_PROJECT_BILLING_TYPES: Array<{ value: UsageProjectBillingType; label: string }> = [
  { value: 'internal', label: 'Internal' },
  { value: 'client_billable', label: 'Client billable' },
  { value: 'fixed_fee', label: 'Fixed fee' },
  { value: 'retainer', label: 'Retainer' },
  { value: 'r_and_d', label: 'R&D' },
  { value: 'support', label: 'Support' },
  { value: 'other', label: 'Other' },
];

const USAGE_PROJECT_PRIORITIES: Array<{ value: UsageProjectPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const PROJECT_MANAGEMENT_TABS: Array<{ id: ProjectManagementTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'workboard', label: 'Workboard' },
  { id: 'work', label: 'Work' },
  { id: 'assignees', label: 'Assignees' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'usage', label: 'Usage' },
  { id: 'details', label: 'Details' },
  { id: 'notes', label: 'Notes' },
];

const SOURCE_TYPE_SORT_ORDER: Record<WorkboardSourceOption['sourceType'], number> = {
  chat_project: 0,
  chat_task: 1,
  build_preset: 2,
  build_session: 3,
};

const ASSIGNMENT_COLUMN_WIDTHS_KEY = 'open-deskmate-project-management-assignment-column-widths';
const ASSIGNMENT_COLUMN_VISIBILITY_KEY = 'open-deskmate-project-management-assignment-column-visibility';
const ASSIGNMENT_ROW_CONTROL_WIDTH = 32;
const ASSIGNMENT_GRID_GAP = 8;
const ASSIGNMENT_TABLE_X_PADDING = 16;
const DAY_MS = 86_400_000;
const ASSIGNMENT_COLUMN_CONFIG: Array<{
  id: AssignmentColumnId;
  label: string;
  defaultWidth: number;
  minWidth: number;
}> = [
  { id: 'name', label: 'Name', defaultWidth: 220, minWidth: 140 },
  { id: 'type', label: 'Type', defaultWidth: 110, minWidth: 90 },
  { id: 'context', label: 'Context', defaultWidth: 260, minWidth: 140 },
  { id: 'count', label: 'Count', defaultWidth: 95, minWidth: 70 },
  { id: 'assignees', label: 'Assignees', defaultWidth: 190, minWidth: 140 },
  { id: 'budget', label: 'Budget', defaultWidth: 180, minWidth: 140 },
];

function defaultAssignmentColumnWidths(): AssignmentColumnWidths {
  return ASSIGNMENT_COLUMN_CONFIG.reduce((acc, column) => {
    acc[column.id] = column.defaultWidth;
    return acc;
  }, {} as AssignmentColumnWidths);
}

function readAssignmentColumnWidths(): AssignmentColumnWidths {
  const defaults = defaultAssignmentColumnWidths();
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ASSIGNMENT_COLUMN_WIDTHS_KEY) || '{}') as Partial<Record<AssignmentColumnId, unknown>>;
    for (const column of ASSIGNMENT_COLUMN_CONFIG) {
      const value = parsed[column.id];
      if (typeof value === 'number' && Number.isFinite(value)) {
        defaults[column.id] = Math.max(column.minWidth, Math.min(520, Math.round(value)));
      }
    }
  } catch {
    // Use defaults when stored settings are unavailable.
  }
  return defaults;
}

function readAssignmentHiddenColumns(): AssignmentHiddenColumns {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ASSIGNMENT_COLUMN_VISIBILITY_KEY) || '{}') as Partial<Record<AssignmentColumnId, unknown>>;
    const next: AssignmentHiddenColumns = {};
    for (const column of ASSIGNMENT_COLUMN_CONFIG) {
      if (parsed[column.id] === true) next[column.id] = true;
    }
    if (ASSIGNMENT_COLUMN_CONFIG.every((column) => next[column.id])) {
      delete next.name;
    }
    return next;
  } catch {
    return {};
  }
}

function AssignmentTextTooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-[360px] text-xs">
          <span className="break-words">{text}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BudgetDetailReadout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border/70 bg-background p-3">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 min-h-5 break-words text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

function AssigneeMultiSelect({
  assignees,
  value,
  onChange,
  disabled,
  label = 'Assignees',
  placeholder = 'No assignees',
}: {
  assignees: UsageAssignee[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const selected = new Set(value);
  return (
    <div className="rounded-md border border-border/70 bg-background p-2">
      <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      {assignees.length === 0 ? (
        <div className="text-xs text-muted-foreground">{placeholder}</div>
      ) : (
        <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
          {assignees.map((assignee) => (
            <label key={assignee.id} className={cn('flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted', disabled && 'cursor-not-allowed opacity-60')}>
              <input
                type="checkbox"
                checked={selected.has(assignee.id)}
                disabled={disabled}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange([...value, assignee.id]);
                  } else {
                    onChange(value.filter((id) => id !== assignee.id));
                  }
                }}
              />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: assignee.color || '#64748b' }} />
              <span className="min-w-0 truncate text-foreground">{assignee.name}</span>
              {assignee.role ? <span className="ml-auto truncate text-muted-foreground">{assignee.role}</span> : null}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyticsMetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
      {detail ? <div className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function DailySpendChart({ analytics }: { analytics: UsageProjectAnalytics }) {
  const maxCost = Math.max(0, ...analytics.daily.map((point) => point.cost ?? 0));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">Spend over time</div>
      <div className="mb-3 text-xs text-muted-foreground">{formatDateRange(analytics.daily[0]?.rangeStart, analytics.daily[analytics.daily.length - 1]?.rangeEnd)}</div>
      {analytics.daily.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No usage data in this range.</div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-40 items-end gap-1 border-b border-border/70 px-1">
            {analytics.daily.map((point) => {
              const value = point.cost ?? 0;
              const height = maxCost > 0 ? Math.max(2, (value / maxCost) * 100) : 2;
              return (
                <TooltipProvider key={point.date} delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex h-full min-w-[5px] flex-1 items-end">
                        <div
                          className={cn('w-full rounded-t-sm', value > 0 ? 'bg-amber-500' : 'bg-muted')}
                          style={{ height: `${height}%` }}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {formatShortDate(point.date)}: {formatMoney(point.cost, analytics.summary.currency)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{formatShortDate(analytics.daily[0]?.date)}</span>
            <span>{formatMoney(maxCost, analytics.summary.currency)} peak day</span>
            <span>{formatShortDate(analytics.daily[analytics.daily.length - 1]?.date)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DailyTokenChart({ analytics }: { analytics: UsageProjectAnalytics }) {
  const maxTokens = Math.max(0, ...analytics.daily.map((point) => point.totalTokens));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">Token mix over time</div>
      <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-500" />Input hit</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-cyan-500" />Input miss</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-violet-500" />Output</span>
      </div>
      {analytics.daily.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No token data in this range.</div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-40 items-end gap-1 border-b border-border/70 px-1">
            {analytics.daily.map((point) => {
              const total = point.totalTokens;
              const height = maxTokens > 0 ? Math.max(2, (total / maxTokens) * 100) : 2;
              const hitPct = total > 0 ? (point.inputHitTokens / total) * 100 : 0;
              const missPct = total > 0 ? (point.inputMissTokens / total) * 100 : 0;
              const outputPct = Math.max(0, 100 - hitPct - missPct);
              return (
                <TooltipProvider key={point.date} delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex h-full min-w-[5px] flex-1 items-end">
                        <div className="flex w-full flex-col overflow-hidden rounded-t-sm bg-muted" style={{ height: `${height}%` }}>
                          <div className="bg-violet-500" style={{ height: `${outputPct}%` }} />
                          <div className="bg-cyan-500" style={{ height: `${missPct}%` }} />
                          <div className="bg-emerald-500" style={{ height: `${hitPct}%` }} />
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {formatShortDate(point.date)}: {formatInt(point.totalTokens)} tokens
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{formatShortDate(analytics.daily[0]?.date)}</span>
            <span>{formatInt(maxTokens)} peak day</span>
            <span>{formatShortDate(analytics.daily[analytics.daily.length - 1]?.date)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatMoney(amount: number | null | undefined, currency = 'USD'): string {
  if (amount == null || !Number.isFinite(amount)) return 'unpriced';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

function formatInt(value: number | null | undefined): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.max(0, value ?? 0));
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value)}%`;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function toIsoFromDateInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toIsoEndFromDateInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateInputDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateInput(date.toISOString());
}

function dateInputMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return toDateInput(date.toISOString());
}

function inclusiveDaysBetween(startIso: string | null | undefined, endIso: string | null | undefined): number {
  const start = startIso ? new Date(startIso) : null;
  const end = endIso ? new Date(endIso) : new Date();
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 30;
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const startLabel = formatShortDate(start);
  const endLabel = formatShortDate(end);
  if (!startLabel && !endLabel) return 'No date range';
  return `${startLabel || 'Start'} - ${endLabel || 'Now'}`;
}

function formatFilenameTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day}_at_${time}`;
}

function billingTypeLabel(value: UsageProjectBillingType | undefined): string {
  return USAGE_PROJECT_BILLING_TYPES.find((entry) => entry.value === value)?.label || 'Internal';
}

function priorityLabel(value: UsageProjectPriority | undefined): string {
  return USAGE_PROJECT_PRIORITIES.find((entry) => entry.value === value)?.label || 'Normal';
}

function parseTagsText(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  value.split(',').forEach((raw) => {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function projectSlug(name: string | undefined): string {
  return (name || 'usage-project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'usage-project';
}

function buildPresetKey(agentId: string | null | undefined, presetId: string | null | undefined): string {
  return `${agentId || 'main'}:${presetId || ''}`;
}

export default function ProjectManagementDialog({
  open,
  onOpenChange,
  initialProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProjectId?: string | null;
}) {
  const {
    projects,
    archivedProjects,
    assignees,
    archivedAssignees,
    windows,
    statuses,
    loading,
    error,
    loadProjects,
    createProject,
    updateProject,
    archiveProject,
    createAssignee,
    updateAssignee,
    archiveAssignee,
    createWindow,
    updateWindow,
    deleteWindow,
  } = useUsageProjectStore();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState('#2dd4bf');
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [clientName, setClientName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [projectOwner, setProjectOwner] = useState('');
  const [billingType, setBillingType] = useState<UsageProjectBillingType>('internal');
  const [billingReference, setBillingReference] = useState('');
  const [projectPriority, setProjectPriority] = useState<UsageProjectPriority>('normal');
  const [projectDueDate, setProjectDueDate] = useState('');
  const [projectNotes, setProjectNotes] = useState<UsageProjectNote[]>([]);
  const [newProjectNoteText, setNewProjectNoteText] = useState('');
  const [editingProjectNoteId, setEditingProjectNoteId] = useState<string | null>(null);
  const [projectLinks, setProjectLinks] = useState<UsageProjectLink[]>([]);
  const [projectTagsText, setProjectTagsText] = useState('');
  const [budgetAssigneeIds, setBudgetAssigneeIds] = useState<string[]>([]);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(null);
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeRole, setAssigneeRole] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [assigneePhone, setAssigneePhone] = useState('');
  const [assigneeCompany, setAssigneeCompany] = useState('');
  const [assigneeNotes, setAssigneeNotes] = useState('');
  const [assigneeColor, setAssigneeColor] = useState('#2dd4bf');
  const [assigneeFilterId, setAssigneeFilterId] = useState('all');
  const [activeProjectTab, setActiveProjectTab] = useState<ProjectManagementTab>('overview');
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);
  const [windowName, setWindowName] = useState('Budget window');
  const [startsAt, setStartsAt] = useState(toDateInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState('');
  const [moneyLimit, setMoneyLimit] = useState('');
  const [tokenLimit, setTokenLimit] = useState('');
  const [windowMode, setWindowMode] = useState<'warn' | 'block'>('warn');
  const [windowEnabled, setWindowEnabled] = useState(true);
  const [summaries, setSummaries] = useState<UsageProjectSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [analyticsRangeMode, setAnalyticsRangeMode] = useState<AnalyticsRangeMode>('last-30');
  const [analyticsCustomStartsAt, setAnalyticsCustomStartsAt] = useState(dateInputDaysAgo(29));
  const [analyticsCustomEndsAt, setAnalyticsCustomEndsAt] = useState(toDateInput(new Date().toISOString()));
  const [analytics, setAnalytics] = useState<UsageProjectAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [buildSessions, setBuildSessions] = useState<BuildTaskSessionListItem[]>([]);
  const [buildSessionDetails, setBuildSessionDetails] = useState<Record<string, BuildTaskSession>>({});
  const [buildPresets, setBuildPresets] = useState<BuildProjectPreset[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentRefreshKey, setAssignmentRefreshKey] = useState(0);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [assignmentTypeFilter, setAssignmentTypeFilter] = useState<AssignmentTypeFilter>('all');
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<AssignmentStatusFilter>('all');
  const [expandedAssignmentRows, setExpandedAssignmentRows] = useState<Record<string, boolean>>({});
  const [assignExistingWorkOpen, setAssignExistingWorkOpen] = useState(false);
  const [assignmentColumnWidths, setAssignmentColumnWidths] = useState<AssignmentColumnWidths>(readAssignmentColumnWidths);
  const [assignmentHiddenColumns, setAssignmentHiddenColumns] = useState<AssignmentHiddenColumns>(readAssignmentHiddenColumns);
  const [assignmentColumnsOpen, setAssignmentColumnsOpen] = useState(false);
  const [assignmentCsvNotice, setAssignmentCsvNotice] = useState('');
  const [budgetSummaryCsvNotice, setBudgetSummaryCsvNotice] = useState('');
  const assignmentTopScrollerRef = useRef<HTMLDivElement | null>(null);
  const assignmentBottomScrollerRef = useRef<HTMLDivElement | null>(null);
  const assignmentScrollSyncingRef = useRef(false);
  const assignmentCsvNoticeTimerRef = useRef<number | null>(null);
  const assignmentCsvNoticeDelayTimerRef = useRef<number | null>(null);
  const assignmentCsvNoticeFallbackTimerRef = useRef<number | null>(null);
  const assignmentCsvNoticeBlurHandlerRef = useRef<(() => void) | null>(null);
  const assignmentCsvNoticeFocusHandlerRef = useRef<(() => void) | null>(null);

  const agents = useAgentStore((state) => state.agents);
  const activeAgentId = useAgentStore((state) => state.activeAgentId);
  const loadAgents = useAgentStore((state) => state.loadAgents);
  const folders = useFolderStore((state) => state.folders);
  const loadFolders = useFolderStore((state) => state.loadFolders);
  const updateFolder = useFolderStore((state) => state.updateFolder);
  const tasks = useTaskStore((state) => state.tasks);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const setTaskUsageProject = useTaskStore((state) => state.setTaskUsageProject);

  useEffect(() => {
    if (!open) return;
    void loadProjects(true);
    void loadFolders();
    void loadAgents();
    void loadTasks();
  }, [loadAgents, loadFolders, loadProjects, loadTasks, open]);

  useEffect(() => () => {
    if (assignmentCsvNoticeTimerRef.current != null) {
      window.clearTimeout(assignmentCsvNoticeTimerRef.current);
    }
    if (assignmentCsvNoticeDelayTimerRef.current != null) {
      window.clearTimeout(assignmentCsvNoticeDelayTimerRef.current);
    }
    if (assignmentCsvNoticeFallbackTimerRef.current != null) {
      window.clearTimeout(assignmentCsvNoticeFallbackTimerRef.current);
    }
    if (assignmentCsvNoticeBlurHandlerRef.current) {
      window.removeEventListener('blur', assignmentCsvNoticeBlurHandlerRef.current);
    }
    if (assignmentCsvNoticeFocusHandlerRef.current) {
      window.removeEventListener('focus', assignmentCsvNoticeFocusHandlerRef.current);
    }
  }, []);

  const allProjects = useMemo(() => [...projects, ...archivedProjects], [archivedProjects, projects]);
  const allAssignees = useMemo(() => [...assignees, ...archivedAssignees], [archivedAssignees, assignees]);
  const folderById = useMemo(() => {
    const map = new Map<string, ChatFolder>();
    for (const folder of folders) {
      map.set(folder.id, folder);
    }
    return map;
  }, [folders]);
  const selectedProject = allProjects.find((project) => project.id === selectedProjectId) || projects[0] || null;
  const selectedAssignee = allAssignees.find((assignee) => assignee.id === selectedAssigneeId) || assignees[0] || null;
  const selectedProjectWindows = windows.filter((window) => window.projectId === selectedProject?.id);
  const analyticsSelectedWindowId = analyticsRangeMode.startsWith('window:') ? analyticsRangeMode.slice('window:'.length) : '';
  const analyticsSelectedWindow = analyticsSelectedWindowId
    ? selectedProjectWindows.find((window) => window.id === analyticsSelectedWindowId) || null
    : null;
  const analyticsRangeLabel = analyticsRangeMode === 'last-30'
    ? 'Last 30 days'
    : analyticsRangeMode === 'last-3-months'
      ? 'Last 3 months'
      : analyticsRangeMode === 'last-6-months'
        ? 'Last 6 months'
        : analyticsRangeMode === 'custom'
          ? 'Custom date range'
          : analyticsSelectedWindow?.name || 'Budget window';
  const projectOptions = allProjects;
  const activeAssigneeOptions = assignees;
  const assigneeNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const assignee of allAssignees) {
      names.set(assignee.id, assignee.name);
    }
    return names;
  }, [allAssignees]);
  const formatAssigneeNames = (ids?: string[] | null): string => {
    if (!ids || ids.length === 0) return 'No assignees';
    return ids.map((id) => assigneeNameById.get(id) || 'Unknown assignee').join(', ');
  };
  const projectNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const project of allProjects) {
      names.set(project.id, project.name);
    }
    return names;
  }, [allProjects]);
  const buildAgentIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeAgentId) ids.add(activeAgentId);
    for (const agent of agents) {
      if (agent.id) ids.add(agent.id);
    }
    return Array.from(ids);
  }, [activeAgentId, agents]);
  const buildAgentKey = buildAgentIds.join('|');
  const agentLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const agent of agents) {
      labels.set(agent.id, agent.name || agent.id);
    }
    return labels;
  }, [agents]);
  const getAgentLabel = (agentId: string): string => agentLabelById.get(agentId) || agentId;

  useEffect(() => {
    if (!open) return;
    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [open, projects, selectedProjectId]);

  useEffect(() => {
    if (!open || !initialProjectId) return;
    setSelectedProjectId(initialProjectId);
  }, [initialProjectId, open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedAssigneeId && assignees[0]) {
      setSelectedAssigneeId(assignees[0].id);
    }
  }, [assignees, open, selectedAssigneeId]);

  useEffect(() => {
    if (!selectedAssignee) {
      setAssigneeName('');
      setAssigneeRole('');
      setAssigneeEmail('');
      setAssigneePhone('');
      setAssigneeCompany('');
      setAssigneeNotes('');
      setAssigneeColor('#2dd4bf');
      return;
    }
    setAssigneeName(selectedAssignee.name);
    setAssigneeRole(selectedAssignee.role || '');
    setAssigneeEmail(selectedAssignee.email || '');
    setAssigneePhone(selectedAssignee.phone || '');
    setAssigneeCompany(selectedAssignee.company || '');
    setAssigneeNotes(selectedAssignee.notes || '');
    setAssigneeColor(selectedAssignee.color || '#2dd4bf');
  }, [selectedAssignee?.id]);

  useEffect(() => {
    if (!selectedProject) {
      setProjectName('');
      setProjectColor('#2dd4bf');
      setTrackingEnabled(true);
      setClientName('');
      setProjectCode('');
      setProjectOwner('');
      setBillingType('internal');
      setBillingReference('');
      setProjectPriority('normal');
      setProjectDueDate('');
      setProjectNotes([]);
      setNewProjectNoteText('');
      setEditingProjectNoteId(null);
      setProjectLinks([]);
      setProjectTagsText('');
      setBudgetAssigneeIds([]);
      return;
    }
    setProjectName(selectedProject.name);
    setProjectColor(selectedProject.color || '#2dd4bf');
    setTrackingEnabled(selectedProject.trackingEnabled);
    setClientName(selectedProject.clientName || '');
    setProjectCode(selectedProject.projectCode || '');
    setProjectOwner(selectedProject.owner || '');
    setBillingType(selectedProject.billingType || 'internal');
    setBillingReference(selectedProject.billingReference || '');
    setProjectPriority(selectedProject.priority || 'normal');
    setProjectDueDate(toDateInput(selectedProject.dueDate));
    setProjectNotes(selectedProject.noteEntries || (selectedProject.notes ? [{
      id: `legacy-${selectedProject.id}`,
      text: selectedProject.notes,
      createdAt: selectedProject.updatedAt || selectedProject.createdAt,
    }] : []));
    setNewProjectNoteText('');
    setEditingProjectNoteId(null);
    setProjectLinks(selectedProject.links || []);
    setProjectTagsText((selectedProject.tags || []).join(', '));
    setBudgetAssigneeIds(selectedProject.assigneeIds || []);
    setAnalyticsRangeMode('last-30');
    setAnalyticsCustomStartsAt(dateInputDaysAgo(29));
    setAnalyticsCustomEndsAt(toDateInput(new Date().toISOString()));
    setAnalytics(null);
    setActiveProjectTab('overview');
  }, [selectedProject?.id]);

  const selectedWindow = selectedProjectWindows.find((window) => window.id === selectedWindowId) || null;

  useEffect(() => {
    if (!selectedWindow) {
      setWindowName('Budget window');
      setStartsAt(toDateInput(new Date().toISOString()));
      setEndsAt('');
      setMoneyLimit('');
      setTokenLimit('');
      setWindowMode('warn');
      setWindowEnabled(true);
      return;
    }
    setWindowName(selectedWindow.name);
    setStartsAt(toDateInput(selectedWindow.startsAt));
    setEndsAt(toDateInput(selectedWindow.endsAt));
    setMoneyLimit(selectedWindow.moneyLimit == null ? '' : String(selectedWindow.moneyLimit));
    setTokenLimit(selectedWindow.tokenLimit == null ? '' : String(selectedWindow.tokenLimit));
    setWindowMode(selectedWindow.mode);
    setWindowEnabled(selectedWindow.enabled);
  }, [selectedWindow?.id]);

  useEffect(() => {
    if (!open || !selectedProject) {
      setSummaries([]);
      return;
    }
    let cancelled = false;
    setSummaryLoading(true);
    const api = getAccomplish();
    Promise.all([
      api.getUsageProjectSummary({ projectId: selectedProject.id }),
      ...selectedProjectWindows.map((window) => api.getUsageProjectSummary({ projectId: selectedProject.id, windowId: window.id })),
    ]).then((rows) => {
      if (!cancelled) setSummaries(rows);
    }).catch(() => {
      if (!cancelled) setSummaries([]);
    }).finally(() => {
      if (!cancelled) setSummaryLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [assignmentRefreshKey, open, selectedProject?.id, selectedProjectWindows.map((window) => window.id).join('|')]);

  useEffect(() => {
    if (!open || !selectedProject || activeProjectTab !== 'analytics') {
      return;
    }
    if (analyticsSelectedWindowId && !analyticsSelectedWindow) {
      setAnalyticsRangeMode('last-30');
      return;
    }

    let cancelled = false;
    setAnalyticsLoading(true);
    const now = new Date();
    const analyticsPayload: {
      projectId: string;
      startsAt?: string;
      endsAt?: string | null;
      windowId?: string;
      days?: number;
    } = { projectId: selectedProject.id, days: 30 };

    if (analyticsRangeMode === 'last-3-months') {
      const startsAt = toIsoFromDateInput(dateInputMonthsAgo(3));
      analyticsPayload.startsAt = startsAt || undefined;
      analyticsPayload.endsAt = now.toISOString();
      analyticsPayload.days = inclusiveDaysBetween(analyticsPayload.startsAt, analyticsPayload.endsAt);
    } else if (analyticsRangeMode === 'last-6-months') {
      const startsAt = toIsoFromDateInput(dateInputMonthsAgo(6));
      analyticsPayload.startsAt = startsAt || undefined;
      analyticsPayload.endsAt = now.toISOString();
      analyticsPayload.days = inclusiveDaysBetween(analyticsPayload.startsAt, analyticsPayload.endsAt);
    } else if (analyticsRangeMode === 'custom') {
      const startsAt = toIsoFromDateInput(analyticsCustomStartsAt);
      const endsAt = toIsoEndFromDateInput(analyticsCustomEndsAt);
      analyticsPayload.startsAt = startsAt || undefined;
      analyticsPayload.endsAt = endsAt || now.toISOString();
      analyticsPayload.days = inclusiveDaysBetween(analyticsPayload.startsAt, analyticsPayload.endsAt);
    } else if (analyticsSelectedWindowId) {
      analyticsPayload.windowId = analyticsSelectedWindowId;
      analyticsPayload.days = 366;
    }

    getAccomplish().getUsageProjectAnalytics(analyticsPayload)
      .then((result) => {
        if (!cancelled) setAnalytics(result);
      })
      .catch(() => {
        if (!cancelled) setAnalytics(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectTab,
    analyticsCustomEndsAt,
    analyticsCustomStartsAt,
    analyticsRangeMode,
    analyticsSelectedWindowId,
    assignmentRefreshKey,
    open,
    selectedProject?.id,
    selectedProjectWindows.map((window) => window.id).join('|'),
  ]);

  const buildProjectMetadataPayload = () => ({
    clientName,
    projectCode,
    owner: projectOwner,
    billingType,
    billingReference,
    priority: projectPriority,
    dueDate: toIsoFromDateInput(projectDueDate),
    notes: '',
    noteEntries: projectNotes,
    links: projectLinks,
    tags: parseTagsText(projectTagsText),
    assigneeIds: budgetAssigneeIds,
  });

  const handleCreateProject = async () => {
    const project = await createProject({ name: 'New project', color: '#2dd4bf', trackingEnabled: true });
    if (project) setSelectedProjectId(project.id);
  };

  const handleSaveProject = async () => {
    const metadata = buildProjectMetadataPayload();
    if (!selectedProject) {
      const project = await createProject({ name: projectName || 'Usage project', color: projectColor, trackingEnabled, ...metadata });
      if (project) setSelectedProjectId(project.id);
      return;
    }
    await updateProject(selectedProject.id, { name: projectName, color: projectColor, trackingEnabled, ...metadata });
  };

  const saveProjectWithNotes = async (noteEntries: UsageProjectNote[]) => {
    if (!selectedProject) return;
    const metadata = { ...buildProjectMetadataPayload(), noteEntries };
    await updateProject(selectedProject.id, { name: projectName, color: projectColor, trackingEnabled, ...metadata });
  };

  const handleCreateAssignee = async () => {
    const assignee = await createAssignee({ name: 'New assignee', color: '#2dd4bf' });
    if (assignee) setSelectedAssigneeId(assignee.id);
  };

  const handleSaveAssignee = async () => {
    if (!selectedAssignee) {
      const assignee = await createAssignee({
        name: assigneeName || 'Assignee',
        role: assigneeRole,
        email: assigneeEmail,
        phone: assigneePhone,
        company: assigneeCompany,
        notes: assigneeNotes,
        color: assigneeColor,
      });
      if (assignee) setSelectedAssigneeId(assignee.id);
      return;
    }
    await updateAssignee(selectedAssignee.id, {
      name: assigneeName,
      role: assigneeRole,
      email: assigneeEmail,
      phone: assigneePhone,
      company: assigneeCompany,
      notes: assigneeNotes,
      color: assigneeColor,
    });
  };

  const addProjectLink = () => {
    setProjectLinks((current) => [...current, { id: `link-${Date.now()}`, label: '', url: '' }]);
  };

  const updateProjectLink = (id: string, patch: Partial<UsageProjectLink>) => {
    setProjectLinks((current) => current.map((link) => (
      link.id === id ? { ...link, ...patch } : link
    )));
  };

  const removeProjectLink = (id: string) => {
    setProjectLinks((current) => current.filter((link) => link.id !== id));
  };

  const addProjectNote = async () => {
    const text = newProjectNoteText.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const nextNotes = [{
      id: `note-${Date.now()}`,
      text,
      createdAt: now,
    }, ...projectNotes];
    setProjectNotes(nextNotes);
    setNewProjectNoteText('');
    await saveProjectWithNotes(nextNotes);
  };

  const updateProjectNote = (id: string, text: string) => {
    setProjectNotes((current) => current.map((note) => (
      note.id === id ? { ...note, text, updatedAt: new Date().toISOString() } : note
    )));
  };

  const deleteProjectNote = (id: string) => {
    const nextNotes = projectNotes.filter((note) => note.id !== id);
    setProjectNotes(nextNotes);
    setEditingProjectNoteId((current) => current === id ? null : current);
    void saveProjectWithNotes(nextNotes);
  };

  const handleSaveWindow = async () => {
    if (!selectedProject) return;
    const startsIso = toIsoFromDateInput(startsAt) || new Date().toISOString();
    const endsIso = toIsoFromDateInput(endsAt);
    const payload = {
      projectId: selectedProject.id,
      name: windowName || 'Budget window',
      startsAt: startsIso,
      endsAt: endsIso,
      enabled: windowEnabled,
      mode: windowMode,
      moneyLimit: moneyLimit.trim() ? Number(moneyLimit) : null,
      tokenLimit: tokenLimit.trim() ? Number(tokenLimit) : null,
      currency: 'USD' as const,
    };
    const saved = selectedWindow
      ? await updateWindow(selectedWindow.id, payload)
      : await createWindow(payload);
    if (saved) setSelectedWindowId(saved.id);
  };

  const selectedProjectStatus = statuses.filter((status) => status.projectId === selectedProject?.id);

  useEffect(() => {
    if (!open || buildAgentIds.length === 0) {
      setBuildSessions([]);
      setBuildPresets([]);
      return;
    }
    let cancelled = false;
    setAssignmentLoading(true);
    const api = getAccomplish();
    Promise.all(buildAgentIds.map(async (agentId) => {
      try {
        const [historyResult, presetResult] = await Promise.all([
          api.listBuildTaskHistorySessions({
            agentId,
            includeArchived: true,
            limit: 200,
          }),
          api.listBuildPresets({ agentId }),
        ]);
        return {
          sessions: historyResult.sessions || [],
          presets: presetResult.presets || [],
        };
      } catch {
        return { sessions: [], presets: [] };
      }
    })).then((rows) => {
      if (cancelled) return;
      const sessionMap = new Map<string, BuildTaskSessionListItem>();
      const presetMap = new Map<string, BuildProjectPreset>();
      for (const row of rows) {
        for (const session of row.sessions) {
          sessionMap.set(session.id, session);
        }
        for (const preset of row.presets) {
          presetMap.set(buildPresetKey(preset.agentId, preset.id), preset);
        }
      }
      setBuildSessions(Array.from(sessionMap.values()).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)));
      setBuildPresets(Array.from(presetMap.values()).sort((a, b) => (
        getAgentLabel(a.agentId).localeCompare(getAgentLabel(b.agentId)) || a.name.localeCompare(b.name)
      )));
    }).catch(() => {
      if (cancelled) return;
      setBuildSessions([]);
      setBuildPresets([]);
    }).finally(() => {
      if (!cancelled) setAssignmentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [assignmentRefreshKey, buildAgentKey, open]);

  useEffect(() => {
    if (!open || buildSessions.length === 0) {
      setBuildSessionDetails({});
      return;
    }
    let cancelled = false;
    const api = getAccomplish();
    Promise.all(buildSessions.map((session) => (
      api.getBuildTaskHistorySession({ sessionId: session.id })
    ))).then((rows) => {
      if (cancelled) return;
      const next: Record<string, BuildTaskSession> = {};
      for (const row of rows) {
        if (row) next[row.id] = row;
      }
      setBuildSessionDetails(next);
    }).catch(() => {
      if (!cancelled) setBuildSessionDetails({});
    });
    return () => {
      cancelled = true;
    };
  }, [buildSessions, open]);

  const assignFolderToUsageProject = async (folderId: string, usageProjectId: string | null) => {
    setAssignmentLoading(true);
    try {
      await updateFolder(folderId, { usageProjectId });
      await loadProjects(true);
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignChatTaskToUsageProject = async (taskId: string, usageProjectId: string | null) => {
    setAssignmentLoading(true);
    try {
      await setTaskUsageProject(taskId, usageProjectId);
      await loadProjects(true);
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignFolderAssignees = async (folderId: string, assigneeIds: string[] | null) => {
    setAssignmentLoading(true);
    try {
      await updateFolder(folderId, { assigneeIds });
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignBuildSessionToUsageProject = async (sessionId: string, usageProjectId: string | null) => {
    setAssignmentLoading(true);
    try {
      const updated = await getAccomplish().updateBuildTaskHistorySession({ sessionId, usageProjectId });
      setBuildSessions((current) => current.map((session) => (
        session.id === sessionId
          ? { ...session, usageProjectId: updated.execution.usageProjectId ?? null }
          : session
      )));
      await loadProjects(true);
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignBuildPresetToUsageProject = async (preset: BuildProjectPreset, usageProjectId: string | null) => {
    setAssignmentLoading(true);
    try {
      const updated = await getAccomplish().upsertBuildPreset({
        id: preset.id,
        agentId: preset.agentId,
        name: preset.name,
        workspaceRelativePath: preset.workspaceRelativePath,
        usageProjectId,
        commands: preset.commands,
        envProfiles: preset.envProfiles,
        activeEnvProfileId: preset.activeEnvProfileId,
      });
      setBuildPresets((current) => current.map((entry) => (
        entry.agentId === updated.agentId && entry.id === updated.id ? updated : entry
      )));
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignBuildPresetAssignees = async (preset: BuildProjectPreset, assigneeIds: string[] | null) => {
    setAssignmentLoading(true);
    try {
      const updated = await getAccomplish().upsertBuildPreset({
        id: preset.id,
        agentId: preset.agentId,
        name: preset.name,
        workspaceRelativePath: preset.workspaceRelativePath,
        usageProjectId: preset.usageProjectId ?? null,
        assigneeIds,
        commands: preset.commands,
        envProfiles: preset.envProfiles,
        activeEnvProfileId: preset.activeEnvProfileId,
      });
      setBuildPresets((current) => current.map((entry) => (
        entry.agentId === updated.agentId && entry.id === updated.id ? updated : entry
      )));
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const linkedChatProjects = selectedProject
    ? folders.filter((folder) => folder.usageProjectId === selectedProject.id)
    : [];
  const directLinkedChatTasks = selectedProject
    ? tasks.filter((task) => (
      (task.usageProjectId ?? null) === selectedProject.id
      && (!task.folderId || (folderById.get(task.folderId)?.usageProjectId ?? null) !== selectedProject.id)
    ))
    : [];
  const linkedBuildPresets = selectedProject
    ? buildPresets.filter((preset) => preset.usageProjectId === selectedProject.id)
    : [];
  const presetByKey = useMemo(() => {
    const presets = new Map<string, BuildProjectPreset>();
    for (const preset of buildPresets) {
      presets.set(buildPresetKey(preset.agentId, preset.id), preset);
    }
    return presets;
  }, [buildPresets]);
  const presetNameByKey = useMemo(() => {
    const names = new Map<string, string>();
    for (const preset of buildPresets) {
      names.set(buildPresetKey(preset.agentId, preset.id), preset.name);
    }
    return names;
  }, [buildPresets]);
  const buildPresetGroups = useMemo<BuildPresetBudgetGroup[]>(() => {
    if (!selectedProject) return [];

    const groups = new Map<string, BuildPresetBudgetGroup>();
    for (const preset of linkedBuildPresets) {
      const key = buildPresetKey(preset.agentId, preset.id);
      groups.set(key, {
        key,
        agentId: preset.agentId,
        presetId: preset.id,
        preset,
        name: preset.name,
        workspaceRelativePath: preset.workspaceRelativePath,
        presetAttached: true,
        sessions: [],
      });
    }

    for (const session of buildSessions) {
      if (session.usageProjectId !== selectedProject.id || !session.selectedPresetId) continue;
      const key = buildPresetKey(session.agentId, session.selectedPresetId);
      const existingGroup = groups.get(key);
      if (existingGroup) {
        existingGroup.sessions.push(session);
        continue;
      }

      const preset = presetByKey.get(key) || null;
      groups.set(key, {
        key,
        agentId: session.agentId,
        presetId: session.selectedPresetId,
        preset,
        name: preset?.name || session.selectedPresetId,
        workspaceRelativePath: preset?.workspaceRelativePath || session.workspaceRelativePath,
        presetAttached: preset?.usageProjectId === selectedProject.id,
        sessions: [session],
      });
    }

    return Array.from(groups.values()).sort((a, b) => (
      a.agentId.localeCompare(b.agentId)
      || a.name.localeCompare(b.name)
    ));
  }, [buildSessions, linkedBuildPresets, presetByKey, selectedProject?.id]);
  const buildPresetGroupKeys = new Set(buildPresetGroups.map((group) => group.key));
  const otherLinkedBuildSessions = selectedProject
    ? buildSessions.filter((session) => (
      session.usageProjectId === selectedProject.id
      && (!session.selectedPresetId || !buildPresetGroupKeys.has(buildPresetKey(session.agentId, session.selectedPresetId)))
    ))
    : [];
  const linkedBuildSessionCount = buildPresetGroups.reduce((total, group) => total + group.sessions.length, 0) + otherLinkedBuildSessions.length;
  const attachedWorkCount = linkedChatProjects.length + directLinkedChatTasks.length + buildPresetGroups.length + otherLinkedBuildSessions.length;
  const totalUsageSummary = summaries.find((row) => !row.window)?.summary || summaries[0]?.summary || null;
  const statusTone = selectedProjectStatus.some((status) => status.blocking)
    ? 'destructive'
    : selectedProjectStatus.some((status) => status.exceeded)
      ? 'warning'
      : selectedProjectStatus.some((status) => Math.max(status.moneyPercent ?? 0, status.tokenPercent ?? 0) >= 80)
        ? 'warning'
        : 'muted';
  const statusLabel = !selectedProject?.trackingEnabled
    ? 'Tracking off'
    : selectedProjectStatus.some((status) => status.blocking)
      ? 'Blocking'
      : selectedProjectStatus.some((status) => status.exceeded)
        ? 'Over limit'
        : selectedProjectStatus.some((status) => Math.max(status.moneyPercent ?? 0, status.tokenPercent ?? 0) >= 80)
          ? 'Near limit'
          : selectedProjectStatus.length > 0
            ? 'Within budget'
            : 'Tracking only';
  useEffect(() => {
    if (!selectedProject) return;
    setAssignExistingWorkOpen(attachedWorkCount === 0);
  }, [selectedProject?.id]);
  const tasksForFolder = (folderId: string): Task[] =>
    tasks.filter((task) => task.folderId === folderId);
  const sessionsForPreset = (preset: BuildProjectPreset): BuildTaskSessionListItem[] =>
    buildSessions.filter((session) => session.agentId === preset.agentId && session.selectedPresetId === preset.id);
  const getSessionPresetLabel = (session: BuildTaskSessionListItem): string => {
    if (!session.selectedPresetId) return 'No preset';
    return presetNameByKey.get(buildPresetKey(session.agentId, session.selectedPresetId)) || session.selectedPresetId;
  };
  const getBuildSessionBudgetNote = (session: BuildTaskSessionListItem): string => {
    if (!session.usageProjectId) return session.selectedPresetId ? `Preset: ${getSessionPresetLabel(session)}` : 'No preset';
    if (!session.selectedPresetId) return 'Direct session budget';
    const preset = presetByKey.get(buildPresetKey(session.agentId, session.selectedPresetId));
    return preset?.usageProjectId === session.usageProjectId
      ? `Inherited from ${preset.name}`
      : 'Direct session budget';
  };
  const getBudgetAssigneeIds = (usageProjectId?: string | null): string[] => (
    usageProjectId ? (allProjects.find((project) => project.id === usageProjectId)?.assigneeIds || []) : []
  );
  const getEffectiveFolderAssigneeIds = (folder: ChatFolder): string[] => (
    folder.assigneeIds === null || folder.assigneeIds === undefined
      ? getBudgetAssigneeIds(folder.usageProjectId)
      : folder.assigneeIds
  );
  const getEffectiveTaskAssigneeIds = (task: Task): string[] => {
    const folder = task.folderId ? folderById.get(task.folderId) : null;
    if (folder) return getEffectiveFolderAssigneeIds(folder);
    return getBudgetAssigneeIds(task.usageProjectId);
  };
  const getEffectivePresetAssigneeIds = (preset: BuildProjectPreset): string[] => (
    preset.assigneeIds === null || preset.assigneeIds === undefined
      ? getBudgetAssigneeIds(preset.usageProjectId)
      : preset.assigneeIds
  );
  const getEffectiveSessionAssigneeIds = (session: BuildTaskSessionListItem): string[] => {
    const preset = session.selectedPresetId ? presetByKey.get(buildPresetKey(session.agentId, session.selectedPresetId)) : null;
    if (preset) return getEffectivePresetAssigneeIds(preset);
    return getBudgetAssigneeIds(session.usageProjectId);
  };
  const getOverrideMode = (assigneeIds?: string[] | null): WorkAssignmentRow['assigneeMode'] => {
    if (assigneeIds === undefined || assigneeIds === null) return 'inherit';
    return assigneeIds.length === 0 ? 'none' : 'override';
  };
  const analyticsSummary = analytics?.summary;
  const analyticsCacheHitRate = analyticsSummary && analyticsSummary.inputTokens > 0
    ? (analyticsSummary.inputHitTokens / analyticsSummary.inputTokens) * 100
    : null;
  const analyticsStatus = analytics?.window
    ? selectedProjectStatus.find((status) => status.windowId === analytics.window?.id) || null
    : null;
  const analyticsMoneyPercent = analytics?.window?.moneyLimit && analyticsSummary?.cost != null
    ? (analyticsSummary.cost / analytics.window.moneyLimit) * 100
    : null;
  const analyticsTokenPercent = analytics?.window?.tokenLimit
    ? (analyticsSummary?.totalTokens ?? 0) / analytics.window.tokenLimit * 100
    : null;
  const analyticsBudgetPercent = analyticsStatus
    ? Math.max(analyticsStatus.moneyPercent ?? 0, analyticsStatus.tokenPercent ?? 0)
    : Math.max(analyticsMoneyPercent ?? 0, analyticsTokenPercent ?? 0) || null;
  const analyticsBudgetLabel = !analytics?.window
    ? analyticsRangeLabel
    : analyticsStatus?.blocking
      ? 'Blocking'
      : analyticsStatus?.exceeded || (analyticsBudgetPercent ?? 0) >= 100
        ? 'Over limit'
        : (analyticsBudgetPercent ?? 0) >= 80
          ? 'Near limit'
          : 'Within budget';
  const analyticsDaysRemaining = analytics?.window?.endsAt
    ? Math.max(0, Math.ceil((new Date(analytics.window.endsAt).getTime() - Date.now()) / 86_400_000))
    : null;
  const analyticsProjectedCost = analytics?.window && analyticsSummary?.cost != null
    ? (() => {
        const start = new Date(analytics.window?.startsAt || analytics.rangeStart).getTime();
        const end = analytics.window?.endsAt ? new Date(analytics.window.endsAt).getTime() : Date.now();
        const elapsed = Math.max(1, Date.now() - start);
        const total = Math.max(elapsed, end - start);
        return analyticsSummary.cost * (total / elapsed);
      })()
    : null;
  const analyticsWorkRows = useMemo(() => {
    if (!analytics) return [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const buildRunByTaskId = new Map<string, { session: BuildTaskSession; runId: string; status: string }>();
    for (const session of Object.values(buildSessionDetails)) {
      for (const run of session.runs || []) {
        if (run.taskId) {
          buildRunByTaskId.set(run.taskId, {
            session,
            runId: run.id,
            status: run.status,
          });
        }
      }
    }

    return analytics.workBreakdown.slice(0, 10).map((row) => {
      const task = taskById.get(row.taskId);
      if (task) {
        return {
          ...row,
          label: task.summary || task.prompt || row.taskId,
          type: 'Chat task',
          detail: task.status,
        };
      }

      const buildRun = buildRunByTaskId.get(row.taskId);
      if (buildRun) {
        return {
          ...row,
          label: buildRun.session.title,
          type: 'Build run',
          detail: `${getAgentLabel(buildRun.session.agentId)} · ${buildRun.status}`,
        };
      }

      return {
        ...row,
        label: row.taskId,
        type: 'Task',
        detail: 'Usage log',
      };
    });
  }, [analytics, buildSessionDetails, tasks]);
  const assigneeOverviewRows = useMemo(() => {
    const people = assigneeFilterId === 'all'
      ? allAssignees
      : allAssignees.filter((assignee) => assignee.id === assigneeFilterId);
    return people.map((assignee) => {
      const budgetWork = allProjects.filter((project) => (project.assigneeIds || []).includes(assignee.id));
      const chatWork = folders.filter((folder) => getEffectiveFolderAssigneeIds(folder).includes(assignee.id));
      const presetWork = buildPresets.filter((preset) => getEffectivePresetAssigneeIds(preset).includes(assignee.id));
      const sessionWork = buildSessions.filter((session) => getEffectiveSessionAssigneeIds(session).includes(assignee.id));
      const taskCount = chatWork.reduce((total, folder) => total + tasksForFolder(folder.id).length, 0);
      const runCount = sessionWork.reduce((total, session) => total + (session.runCount || 0), 0);
      const attachedToSelectedBudget = selectedProject ? (
        budgetWork.some((project) => project.id === selectedProject.id)
        || chatWork.some((folder) => folder.usageProjectId === selectedProject.id)
        || presetWork.some((preset) => preset.usageProjectId === selectedProject.id)
        || sessionWork.some((session) => session.usageProjectId === selectedProject.id)
      ) : false;
      return {
        assignee,
        budgetWork,
        chatWork,
        presetWork,
        sessionWork,
        taskCount,
        runCount,
        selectedBudgetSummary: attachedToSelectedBudget ? totalUsageSummary : null,
      };
    });
  }, [allAssignees, allProjects, assigneeFilterId, buildPresets, buildSessions, folders, presetByKey, selectedProject?.id, tasks, totalUsageSummary]);
  const assignBuildPresetGroupToUsageProject = async (group: BuildPresetBudgetGroup, usageProjectId: string | null) => {
    if (group.preset) {
      await assignBuildPresetToUsageProject(group.preset, usageProjectId);
      return;
    }
    setAssignmentLoading(true);
    try {
      await Promise.all(group.sessions.map((session) => (
        getAccomplish().updateBuildTaskHistorySession({ sessionId: session.id, usageProjectId })
      )));
      setBuildSessions((current) => current.map((session) => (
        group.sessions.some((entry) => entry.id === session.id)
          ? { ...session, usageProjectId }
          : session
      )));
      await loadProjects(true);
      setAssignmentRefreshKey((key) => key + 1);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const assignmentRows = useMemo<WorkAssignmentRow[]>(() => {
    const rows: WorkAssignmentRow[] = [];

    for (const folder of folders) {
      const folderTasks = tasks.filter((task) => task.folderId === folder.id);
      const countLabel = `${folderTasks.length} task${folderTasks.length === 1 ? '' : 's'}`;
      const usageProjectId = folder.usageProjectId ?? null;
      rows.push({
        key: `chat-project:${folder.id}`,
        type: 'chat-project',
        typeLabel: 'Chat project',
        name: folder.name,
        detail: countLabel,
        countLabel,
        usageProjectId,
        assigneeIds: folder.assigneeIds,
        effectiveAssigneeIds: getEffectiveFolderAssigneeIds(folder),
        assigneeMode: getOverrideMode(folder.assigneeIds),
        note: usageProjectId ? `Assigned to ${projectNameById.get(usageProjectId) || 'budget'}` : 'Tasks inherit when assigned',
        searchText: `${folder.name} chat project ${countLabel}`.toLowerCase(),
        folder,
      });
    }

    for (const task of tasks) {
      const folder = task.folderId ? folderById.get(task.folderId) : null;
      const folderUsageProjectId = folder?.usageProjectId ?? null;
      const taskUsageProjectId = task.usageProjectId ?? null;
      const isStandaloneTask = !task.folderId;
      const hasDirectTaskBudget = Boolean(taskUsageProjectId && taskUsageProjectId !== folderUsageProjectId);
      if (!isStandaloneTask && !hasDirectTaskBudget) continue;
      const taskName = task.summary || task.prompt || task.id;
      const detail = folder ? `${folder.name} · ${task.status}` : `Unfiled · ${task.status}`;
      rows.push({
        key: `chat-task:${task.id}`,
        type: 'chat-task',
        typeLabel: 'Chat task',
        name: taskName,
        detail,
        countLabel: '1 task',
        usageProjectId: taskUsageProjectId,
        assigneeIds: undefined,
        effectiveAssigneeIds: getEffectiveTaskAssigneeIds(task),
        assigneeMode: 'unavailable',
        note: taskUsageProjectId
          ? `Directly assigned to ${projectNameById.get(taskUsageProjectId) || 'budget'}`
          : 'Can be assigned directly',
        searchText: `${taskName} chat task ${detail}`.toLowerCase(),
        task,
      });
    }

    for (const preset of buildPresets) {
      const presetSessions = sessionsForPreset(preset);
      const countLabel = `${presetSessions.length} session${presetSessions.length === 1 ? '' : 's'}`;
      const usageProjectId = preset.usageProjectId ?? null;
      rows.push({
        key: `build-preset:${buildPresetKey(preset.agentId, preset.id)}`,
        type: 'build-preset',
        typeLabel: 'Build preset',
        name: preset.name,
        detail: `${getAgentLabel(preset.agentId)} · ${preset.workspaceRelativePath || '.'}`,
        countLabel,
        usageProjectId,
        assigneeIds: preset.assigneeIds,
        effectiveAssigneeIds: getEffectivePresetAssigneeIds(preset),
        assigneeMode: getOverrideMode(preset.assigneeIds),
        note: usageProjectId ? `Future sessions inherit ${projectNameById.get(usageProjectId) || 'budget'}` : 'Future sessions inherit when assigned',
        searchText: `${preset.name} build preset ${getAgentLabel(preset.agentId)} ${preset.workspaceRelativePath || '.'} ${countLabel}`.toLowerCase(),
        preset,
      });
    }

    for (const session of buildSessions) {
      const runCount = session.runCount || 0;
      const countLabel = `${runCount} run${runCount === 1 ? '' : 's'}`;
      rows.push({
        key: `build-session:${session.id}`,
        type: 'build-session',
        typeLabel: 'Build session',
        name: session.title,
        detail: `${getAgentLabel(session.agentId)} · ${getSessionPresetLabel(session)} · ${session.lifecycleStatus}`,
        countLabel,
        usageProjectId: session.usageProjectId ?? null,
        assigneeIds: undefined,
        effectiveAssigneeIds: getEffectiveSessionAssigneeIds(session),
        assigneeMode: 'unavailable',
        note: getBuildSessionBudgetNote(session),
        searchText: `${session.title} build session ${getAgentLabel(session.agentId)} ${getSessionPresetLabel(session)} ${session.lifecycleStatus} ${countLabel}`.toLowerCase(),
        session,
      });
    }

    return rows;
  }, [allProjects, buildPresets, buildSessions, folderById, folders, projectNameById, presetByKey, presetNameByKey, tasks]);

  const workboardSourceOptions = useMemo<WorkboardSourceOption[]>(() => {
    const options: WorkboardSourceOption[] = [];
    for (const folder of folders) {
      options.push({
        sourceType: 'chat_project',
        sourceId: folder.id,
        label: folder.name,
        detail: `${tasksForFolder(folder.id).length} task${tasksForFolder(folder.id).length === 1 ? '' : 's'}`,
        assigneeIds: getEffectiveFolderAssigneeIds(folder),
      });
      for (const task of tasksForFolder(folder.id)) {
        options.push({
          sourceType: 'chat_task',
          sourceId: task.id,
          label: task.summary || task.prompt || task.id,
          detail: `${folder.name} · ${task.status}`,
          assigneeIds: getEffectiveFolderAssigneeIds(folder),
        });
      }
    }
    for (const task of tasks) {
      const folder = task.folderId ? folderById.get(task.folderId) : null;
      if (folder) continue;
      options.push({
        sourceType: 'chat_task',
        sourceId: task.id,
        label: task.summary || task.prompt || task.id,
        detail: `Unfiled · ${task.status}`,
        assigneeIds: getEffectiveTaskAssigneeIds(task),
      });
    }
    for (const preset of buildPresets) {
      options.push({
        sourceType: 'build_preset',
        sourceId: buildPresetKey(preset.agentId, preset.id),
        label: preset.name,
        detail: `${getAgentLabel(preset.agentId)} · ${preset.workspaceRelativePath || '.'}`,
        assigneeIds: getEffectivePresetAssigneeIds(preset),
      });
    }
    for (const session of buildSessions) {
      options.push({
        sourceType: 'build_session',
        sourceId: session.id,
        label: session.title,
        detail: `${getAgentLabel(session.agentId)} · ${getSessionPresetLabel(session)} · ${session.runCount || 0} run${(session.runCount || 0) === 1 ? '' : 's'}`,
        assigneeIds: getEffectiveSessionAssigneeIds(session),
      });
    }
    return options.sort((a, b) => SOURCE_TYPE_SORT_ORDER[a.sourceType] - SOURCE_TYPE_SORT_ORDER[b.sourceType] || a.label.localeCompare(b.label));
  }, [buildPresets, buildSessions, folderById, folders, presetByKey, tasks]);

  const filteredAssignmentRows = useMemo(() => {
    const query = assignmentSearch.trim().toLowerCase();
    return assignmentRows.filter((row) => {
      if (assignmentTypeFilter !== 'all' && row.type !== assignmentTypeFilter) return false;
      if (assignmentStatusFilter === 'unassigned' && row.usageProjectId) return false;
      if (assignmentStatusFilter === 'this-budget' && row.usageProjectId !== selectedProject?.id) return false;
      if (assignmentStatusFilter === 'elsewhere' && (!row.usageProjectId || row.usageProjectId === selectedProject?.id)) return false;
      if (query && !row.searchText.includes(query)) return false;
      return true;
    });
  }, [assignmentRows, assignmentSearch, assignmentStatusFilter, assignmentTypeFilter, selectedProject?.id]);

  const visibleAssignmentColumns = useMemo(
    () => ASSIGNMENT_COLUMN_CONFIG.filter((column) => !assignmentHiddenColumns[column.id]),
    [assignmentHiddenColumns]
  );
  const assignmentGridTemplateColumns = useMemo(
    () => `32px ${visibleAssignmentColumns.map((column) => `${assignmentColumnWidths[column.id]}px`).join(' ')}`,
    [assignmentColumnWidths, visibleAssignmentColumns]
  );
  const assignmentTableWidth = useMemo(() => {
    const columnsWidth = visibleAssignmentColumns.reduce((total, column) => (
      total + (assignmentColumnWidths[column.id] || column.defaultWidth)
    ), 0);
    const gapWidth = visibleAssignmentColumns.length * ASSIGNMENT_GRID_GAP;
    return ASSIGNMENT_ROW_CONTROL_WIDTH + columnsWidth + gapWidth + ASSIGNMENT_TABLE_X_PADDING;
  }, [assignmentColumnWidths, visibleAssignmentColumns]);

  const persistAssignmentColumnWidths = (next: AssignmentColumnWidths) => {
    try {
      window.localStorage.setItem(ASSIGNMENT_COLUMN_WIDTHS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const persistAssignmentHiddenColumns = (next: AssignmentHiddenColumns) => {
    try {
      window.localStorage.setItem(ASSIGNMENT_COLUMN_VISIBILITY_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const startAssignmentColumnResize = (event: React.PointerEvent<HTMLSpanElement>, columnId: AssignmentColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    const column = ASSIGNMENT_COLUMN_CONFIG.find((entry) => entry.id === columnId);
    if (!column) return;
    const startX = event.clientX;
    const startWidth = assignmentColumnWidths[columnId];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(column.minWidth, Math.min(520, Math.round(startWidth + moveEvent.clientX - startX)));
      setAssignmentColumnWidths((current) => ({ ...current, [columnId]: nextWidth }));
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const nextWidth = Math.max(column.minWidth, Math.min(520, Math.round(startWidth + upEvent.clientX - startX)));
      setAssignmentColumnWidths((current) => {
        const next = { ...current, [columnId]: nextWidth };
        persistAssignmentColumnWidths(next);
        return next;
      });
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const setAssignmentColumnHidden = (columnId: AssignmentColumnId, hidden: boolean) => {
    setAssignmentHiddenColumns((current) => {
      const currentVisibleCount = ASSIGNMENT_COLUMN_CONFIG.filter((column) => !current[column.id]).length;
      if (hidden && !current[columnId] && currentVisibleCount <= 1) return current;
      const next = { ...current, [columnId]: hidden };
      if (!hidden) delete next[columnId];
      persistAssignmentHiddenColumns(next);
      return next;
    });
  };

  const resetAssignmentColumns = () => {
    const widths = defaultAssignmentColumnWidths();
    setAssignmentColumnWidths(widths);
    setAssignmentHiddenColumns({});
    persistAssignmentColumnWidths(widths);
    persistAssignmentHiddenColumns({});
  };

  const syncAssignmentHorizontalScroll = (source: 'top' | 'bottom') => {
    if (assignmentScrollSyncingRef.current) return;
    const sourceElement = source === 'top' ? assignmentTopScrollerRef.current : assignmentBottomScrollerRef.current;
    const targetElement = source === 'top' ? assignmentBottomScrollerRef.current : assignmentTopScrollerRef.current;
    if (!sourceElement || !targetElement) return;

    assignmentScrollSyncingRef.current = true;
    targetElement.scrollLeft = sourceElement.scrollLeft;
    window.requestAnimationFrame(() => {
      assignmentScrollSyncingRef.current = false;
    });
  };

  const showAssignmentCsvNotice = (message: string) => {
    if (assignmentCsvNoticeTimerRef.current != null) {
      window.clearTimeout(assignmentCsvNoticeTimerRef.current);
    }
    setAssignmentCsvNotice(message);
    assignmentCsvNoticeTimerRef.current = window.setTimeout(() => {
      setAssignmentCsvNotice('');
      assignmentCsvNoticeTimerRef.current = null;
    }, 6000);
  };

  const clearPendingAssignmentCsvNotice = () => {
    if (assignmentCsvNoticeDelayTimerRef.current != null) {
      window.clearTimeout(assignmentCsvNoticeDelayTimerRef.current);
      assignmentCsvNoticeDelayTimerRef.current = null;
    }
    if (assignmentCsvNoticeFallbackTimerRef.current != null) {
      window.clearTimeout(assignmentCsvNoticeFallbackTimerRef.current);
      assignmentCsvNoticeFallbackTimerRef.current = null;
    }
    if (assignmentCsvNoticeBlurHandlerRef.current) {
      window.removeEventListener('blur', assignmentCsvNoticeBlurHandlerRef.current);
      assignmentCsvNoticeBlurHandlerRef.current = null;
    }
    if (assignmentCsvNoticeFocusHandlerRef.current) {
      window.removeEventListener('focus', assignmentCsvNoticeFocusHandlerRef.current);
      assignmentCsvNoticeFocusHandlerRef.current = null;
    }
  };

  const showAssignmentCsvNoticeAfterDownloadDialog = (message: string) => {
    clearPendingAssignmentCsvNotice();
    let nativeDialogOpened = false;

    const revealNotice = () => {
      clearPendingAssignmentCsvNotice();
      showAssignmentCsvNotice(message);
    };

    const handleBlur = () => {
      nativeDialogOpened = true;
    };
    const handleFocus = () => {
      if (!nativeDialogOpened) return;
      assignmentCsvNoticeDelayTimerRef.current = window.setTimeout(revealNotice, 200);
    };

    assignmentCsvNoticeBlurHandlerRef.current = handleBlur;
    assignmentCsvNoticeFocusHandlerRef.current = handleFocus;
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    assignmentCsvNoticeDelayTimerRef.current = window.setTimeout(() => {
      assignmentCsvNoticeDelayTimerRef.current = null;
      if (!nativeDialogOpened && document.hasFocus()) {
        revealNotice();
        return;
      }
      if (nativeDialogOpened && document.hasFocus()) {
        revealNotice();
      }
    }, 1200);

    assignmentCsvNoticeFallbackTimerRef.current = window.setTimeout(revealNotice, 120000);
  };

  const handleAssignmentRowBudgetChange = (row: WorkAssignmentRow, usageProjectId: string | null) => {
    if (row.type === 'chat-project' && row.folder) {
      void assignFolderToUsageProject(row.folder.id, usageProjectId);
      return;
    }
    if (row.type === 'chat-task' && row.task) {
      void assignChatTaskToUsageProject(row.task.id, usageProjectId);
      return;
    }
    if (row.type === 'build-preset' && row.preset) {
      void assignBuildPresetToUsageProject(row.preset, usageProjectId);
      return;
    }
    if (row.type === 'build-session' && row.session) {
      void assignBuildSessionToUsageProject(row.session.id, usageProjectId);
    }
  };

  const handleAssignmentRowAssigneeChange = (row: WorkAssignmentRow, assigneeIds: string[] | null) => {
    if (row.type === 'chat-project' && row.folder) {
      void assignFolderAssignees(row.folder.id, assigneeIds);
      return;
    }
    if (row.type === 'build-preset' && row.preset) {
      void assignBuildPresetAssignees(row.preset, assigneeIds);
    }
  };

  const toggleAssignmentRow = (rowKey: string) => {
    setExpandedAssignmentRows((current) => ({
      ...current,
      [rowKey]: !current[rowKey],
    }));
  };

  const getAssignmentColumnText = (row: WorkAssignmentRow, columnId: AssignmentColumnId): string => {
    switch (columnId) {
      case 'name':
        return row.name;
      case 'type':
        return row.typeLabel;
      case 'context':
        return `${row.detail}${row.note ? ` - ${row.note}` : ''}`;
      case 'count':
        return row.countLabel;
      case 'budget':
        return row.usageProjectId ? (projectNameById.get(row.usageProjectId) || 'Budget') : 'No budget';
      case 'assignees':
        return `${formatAssigneeNames(row.effectiveAssigneeIds)}${row.assigneeMode === 'inherit' ? ' (inherited)' : row.assigneeMode === 'none' ? ' (none)' : row.assigneeMode === 'unavailable' ? ' (read-only)' : ''}`;
      default:
        return '';
    }
  };

  const renderAssignmentCell = (row: WorkAssignmentRow, columnId: AssignmentColumnId) => {
    const fullText = getAssignmentColumnText(row, columnId);
    if (columnId === 'name') {
      return (
        <AssignmentTextTooltip text={row.name}>
          <button type="button" onClick={() => toggleAssignmentRow(row.key)} className="block w-full min-w-0 text-left">
            <span className="block truncate font-medium text-foreground">{row.name}</span>
          </button>
        </AssignmentTextTooltip>
      );
    }
    if (columnId === 'type') {
      return <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{row.typeLabel}</span>;
    }
    if (columnId === 'context') {
      return (
        <AssignmentTextTooltip text={fullText}>
          <div className="w-full min-w-0">
            <div className="truncate text-muted-foreground">{row.detail}</div>
            <div className="truncate text-[11px] text-muted-foreground/80">{row.note}</div>
          </div>
        </AssignmentTextTooltip>
      );
    }
    if (columnId === 'count') {
      return <span className="block truncate text-muted-foreground">{row.countLabel}</span>;
    }
    if (columnId === 'assignees') {
      if (row.assigneeMode === 'unavailable') {
        return (
          <AssignmentTextTooltip text={fullText}>
            <div className="w-full min-w-0">
              <div className="truncate text-muted-foreground">{formatAssigneeNames(row.effectiveAssigneeIds)}</div>
              <div className="truncate text-[11px] text-muted-foreground/80">Inherited</div>
            </div>
          </AssignmentTextTooltip>
        );
      }
      const overrideValue = row.assigneeIds === undefined || row.assigneeIds === null ? '__inherit__' : row.assigneeIds.length === 0 ? '__none__' : '__custom__';
      return (
        <div className="space-y-1">
          <select
            value={overrideValue}
            disabled={assignmentLoading}
            onChange={(event) => {
              if (event.target.value === '__inherit__') handleAssignmentRowAssigneeChange(row, null);
              if (event.target.value === '__none__') handleAssignmentRowAssigneeChange(row, []);
              if (event.target.value === '__custom__') handleAssignmentRowAssigneeChange(row, row.effectiveAssigneeIds);
            }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="__inherit__">Inherit budget</option>
            <option value="__custom__">Choose people</option>
            <option value="__none__">No assignees</option>
          </select>
          {overrideValue === '__custom__' ? (
            <AssigneeMultiSelect
              assignees={activeAssigneeOptions}
              value={row.assigneeIds || []}
              onChange={(ids) => handleAssignmentRowAssigneeChange(row, ids)}
              disabled={assignmentLoading}
              label="People"
              placeholder="Create people in the Assignees tab."
            />
          ) : (
            <AssignmentTextTooltip text={fullText}>
              <div className="truncate text-[11px] text-muted-foreground">{formatAssigneeNames(row.effectiveAssigneeIds)}</div>
            </AssignmentTextTooltip>
          )}
        </div>
      );
    }
    return (
      <select
        value={row.usageProjectId || ''}
        disabled={assignmentLoading}
        onChange={(event) => handleAssignmentRowBudgetChange(row, event.target.value || null)}
        className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">No budget</option>
        {projectOptions.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}{project.status === 'archived' ? ' (archived)' : ''}
          </option>
        ))}
      </select>
    );
  };

  const escapeCsvValue = (value: string): string => {
    const escaped = value.replace(/"/g, '""');
    return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const normalizeCsvValue = (value: string): string => value
    .replace(/\s*·\s*/g, ' - ')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ');

  const exportAssignmentsCsv = () => {
    const columns = visibleAssignmentColumns.length > 0 ? visibleAssignmentColumns : ASSIGNMENT_COLUMN_CONFIG;
    const csvColumns = columns.some((column) => column.id === 'assignees')
      ? columns
      : [...columns, ASSIGNMENT_COLUMN_CONFIG.find((column) => column.id === 'assignees')!];
    const metadataColumns = selectedProject
      ? ['Budget name', 'Client name', 'Project code', 'Owner', 'Billing type', 'Billing reference', 'Default assignees']
      : [];
    const header = [...metadataColumns, ...csvColumns.map((column) => column.label)].map(escapeCsvValue).join(',');
    const rows = filteredAssignmentRows.map((row) => (
      [
        ...(selectedProject ? [
          selectedProject.name,
          selectedProject.clientName || '',
          selectedProject.projectCode || '',
          selectedProject.owner || '',
          billingTypeLabel(selectedProject.billingType),
          selectedProject.billingReference || '',
          formatAssigneeNames(selectedProject.assigneeIds || []),
        ] : []),
        ...csvColumns.map((column) => normalizeCsvValue(getAssignmentColumnText(row, column.id))),
      ].map(escapeCsvValue).join(',')
    ));
    const csv = `\uFEFF${[header, ...rows].join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `${projectSlug(selectedProject?.name)}-assigned-work-${formatFilenameTimestamp()}.csv`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    showAssignmentCsvNoticeAfterDownloadDialog(`CSV download ready: ${filename}`);
  };

  const exportBudgetSummaryCsv = () => {
    if (!selectedProject || summaries.length === 0) return;
    const header = [
      'Budget name',
      'Client name',
      'Project code',
      'Owner',
      'Billing type',
      'Billing reference',
      'Default assignees',
      'Window',
      'Window starts',
      'Window ends',
      'Input hit tokens',
      'Input miss tokens',
      'Output tokens',
      'Total tokens',
      'Input hit cost',
      'Input miss cost',
      'Output cost',
      'Total cost',
      'Currency',
    ];
    const rows = summaries.map((row) => [
      selectedProject.name,
      selectedProject.clientName || '',
      selectedProject.projectCode || '',
      selectedProject.owner || '',
      billingTypeLabel(selectedProject.billingType),
      selectedProject.billingReference || '',
      formatAssigneeNames(selectedProject.assigneeIds || []),
      row.window?.name || 'All tracked usage',
      row.window?.startsAt || row.summary.rangeStart,
      row.window?.endsAt || row.summary.rangeEnd,
      String(row.summary.inputHitTokens),
      String(row.summary.inputMissTokens),
      String(row.summary.outputTokens),
      String(row.summary.totalTokens),
      row.summary.inputHitCost == null ? '' : String(row.summary.inputHitCost),
      row.summary.inputMissCost == null ? '' : String(row.summary.inputMissCost),
      row.summary.outputCost == null ? '' : String(row.summary.outputCost),
      row.summary.cost == null ? '' : String(row.summary.cost),
      row.summary.currency || 'USD',
    ]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map((value) => escapeCsvValue(normalizeCsvValue(value))).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `${projectSlug(selectedProject.name)}-budget-summary-${formatFilenameTimestamp()}.csv`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setBudgetSummaryCsvNotice(`CSV download ready: ${filename}`);
    window.setTimeout(() => setBudgetSummaryCsvNotice(''), 6000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[88vh] max-h-[88vh] w-[94vw] max-w-5xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Project Management</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden pr-1">
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">Usage projects</div>
                <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleCreateProject}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-1">
                  {projects.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                      No active projects yet.
                    </div>
                  ) : projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setSelectedProjectId(project.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        selectedProject?.id === project.id ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color || '#2dd4bf' }} />
                      <span className="min-w-0">
                        <span className="block truncate">{project.name}</span>
                        {project.clientName ? (
                          <span className="block truncate text-[11px] text-muted-foreground">{project.clientName}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
                {archivedProjects.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Archived</div>
                    {archivedProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => setSelectedProjectId(project.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        <span className="min-w-0">
                          <span className="block truncate">{project.name}</span>
                          {project.clientName ? (
                            <span className="block truncate text-[11px] text-muted-foreground">{project.clientName}</span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="h-full min-h-0 space-y-4 overflow-y-auto pr-1">
              {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
              {loading && <div className="text-xs text-muted-foreground">Loading projects...</div>}

              <div className="sticky top-0 z-20 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="Project name"
                    className="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm font-medium"
                  />
                  {projectCode ? (
                    <TooltipProvider delayDuration={250}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                            {projectCode}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center" className="text-xs">
                          Project code
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                  <input
                    type="color"
                    value={projectColor}
                    onChange={(event) => setProjectColor(event.target.value)}
                    className="h-9 w-12 rounded-md border border-input bg-background p-1"
                    aria-label="Budget color"
                  />
                  <TooltipProvider delayDuration={250}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={trackingEnabled}
                            onChange={(event) => setTrackingEnabled(event.target.checked)}
                          />
                          Track
                        </label>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="center" className="max-w-[280px] text-xs">
                        When Track is on, assigned Chat and Build work counts toward this budget's usage totals, warnings, and blocking limits.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <span className={cn(
                    'rounded-md border px-2 py-1 text-xs',
                    statusTone === 'destructive'
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : statusTone === 'warning'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                        : 'border-border bg-muted text-muted-foreground'
                  )}>
                    {statusLabel}
                  </span>
                  <Button size="sm" onClick={handleSaveProject}>Save</Button>
                  {selectedProject && selectedProject.status === 'active' && (
                    <TooltipProvider delayDuration={250}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => void archiveProject(selectedProject.id, true)}>
                            Archive
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center" className="max-w-[260px] text-xs">
                          Hide this budget from normal selectors while keeping its history, assigned work, and usage reports available.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {selectedProject && selectedProject.status === 'archived' && (
                    <Button size="sm" variant="outline" onClick={() => void archiveProject(selectedProject.id, false)}>
                      Restore
                    </Button>
                  )}
                  <TooltipProvider delayDuration={250}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActiveProjectTab('work');
                            setAssignExistingWorkOpen(true);
                          }}
                        >
                          Assign work
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="center" className="max-w-[260px] text-xs">
                        Open the Work tab so Chat projects, Build presets, and Build sessions can be attached to this budget.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider delayDuration={250}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActiveProjectTab('budgets');
                            setSelectedWindowId(null);
                          }}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          New budget window
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="center" className="max-w-[280px] text-xs">
                        Create a dated budget period with optional money or token limits for this budget.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase text-muted-foreground">Colors</span>
                  {USAGE_PROJECT_COLOR_SWATCHES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setProjectColor(color)}
                      className={cn(
                        'h-5 w-5 rounded-full border border-border transition-transform hover:scale-110',
                        projectColor.toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      )}
                      style={{ backgroundColor: color }}
                      aria-label={`Use color ${color}`}
                      title={color}
                    />
                  ))}
                </div>
                <div className="mt-2 max-w-xl">
                  <AssigneeMultiSelect
                    assignees={activeAssigneeOptions}
                    value={budgetAssigneeIds}
                    onChange={setBudgetAssigneeIds}
                    label="Default assignees"
                    placeholder="Create people in the Assignees tab."
                  />
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Chat projects and Build presets inherit these people unless their Work tab row overrides them.
                  </div>
                </div>
              </div>

              {selectedProject && (
                <div className="space-y-4">
                  <div className="grid grid-cols-9 gap-1 rounded-lg border border-border bg-card p-1">
                    {PROJECT_MANAGEMENT_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveProjectTab(tab.id)}
                        className={cn(
                          'min-w-0 rounded-md px-1.5 py-1.5 text-center text-[11px] font-medium transition-colors xl:text-xs',
                          activeProjectTab === tab.id
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                        title={tab.label}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {activeProjectTab === 'overview' ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 lg:grid-cols-4">
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Client</div>
                          <div className="mt-1 truncate text-sm font-medium text-foreground">{selectedProject.clientName || 'No client set'}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Project code</div>
                          <div className="mt-1 truncate text-sm font-medium text-foreground">{selectedProject.projectCode || 'No code'}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Owner</div>
                          <div className="mt-1 truncate text-sm font-medium text-foreground">{selectedProject.owner || 'No owner'}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Billing</div>
                          <div className="mt-1 truncate text-sm font-medium text-foreground">{billingTypeLabel(selectedProject.billingType)}</div>
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-4">
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Spend</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{formatMoney(totalUsageSummary?.cost, totalUsageSummary?.currency)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Tokens</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{formatInt(totalUsageSummary?.totalTokens)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Chat projects</div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {linkedChatProjects.length} project{linkedChatProjects.length === 1 ? '' : 's'}
                            {directLinkedChatTasks.length > 0 ? ` · ${directLinkedChatTasks.length} direct task${directLinkedChatTasks.length === 1 ? '' : 's'}` : ''}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-card p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Build work</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{buildPresetGroups.length} presets · {linkedBuildSessionCount} sessions</div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">Budget details</div>
                            <div className="mt-1 text-xs text-muted-foreground">Read-only summary of the Details tab.</div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setActiveProjectTab('details')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit details
                          </Button>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <BudgetDetailReadout label="Billing reference">
                            {selectedProject.billingReference || 'No reference'}
                          </BudgetDetailReadout>
                          <BudgetDetailReadout label="Priority">
                            {priorityLabel(selectedProject.priority)}
                          </BudgetDetailReadout>
                          <BudgetDetailReadout label="Due date">
                            {selectedProject.dueDate ? formatDateOnly(selectedProject.dueDate) : 'No due date'}
                          </BudgetDetailReadout>
                          <BudgetDetailReadout label="Tags">
                            {selectedProject.tags?.length ? (
                              <span className="flex flex-wrap gap-1.5">
                                {selectedProject.tags.map((tag) => (
                                  <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{tag}</span>
                                ))}
                              </span>
                            ) : 'No tags'}
                          </BudgetDetailReadout>
                          <BudgetDetailReadout label="Default assignees">
                            {formatAssigneeNames(selectedProject.assigneeIds || [])}
                          </BudgetDetailReadout>
                        </div>
                        <div className="mt-3 rounded-md border border-border/70 bg-background p-3">
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">Links</div>
                          {selectedProject.links?.length ? (
                            <div className="mt-2 grid gap-2">
                              {selectedProject.links.map((link) => (
                                <div key={link.id} className="grid gap-2 rounded-md border border-border/60 bg-card px-2 py-2 text-sm md:grid-cols-[180px_minmax(0,1fr)_auto]">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium uppercase text-muted-foreground">Link label</div>
                                    <div className="mt-0.5 truncate font-medium text-foreground">{link.label || 'Untitled link'}</div>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium uppercase text-muted-foreground">Link URL or path</div>
                                    <div className="mt-0.5 truncate text-muted-foreground">{link.url || 'No URL or path'}</div>
                                  </div>
                                  <Button type="button" variant="outline" size="sm" className="h-8 self-end px-2" onClick={() => link.url && void getAccomplish().openExternal(link.url)} disabled={!link.url}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-1 text-sm font-medium text-foreground">No links</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeProjectTab === 'analytics' ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">Analytics</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Read-only usage patterns for this budget project.
                            </div>
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="grid gap-1">
                              <label className="text-xs font-medium text-muted-foreground">Range</label>
                              <select
                                value={analyticsRangeMode}
                                onChange={(event) => setAnalyticsRangeMode(event.target.value as AnalyticsRangeMode)}
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                              >
                                <option value="last-30">Last 30 days</option>
                                <option value="last-3-months">Last 3 months</option>
                                <option value="last-6-months">Last 6 months</option>
                                <option value="custom">Choose date range</option>
                                {selectedProjectWindows.length > 0 ? (
                                  <optgroup label="Budget windows">
                                    {selectedProjectWindows.map((window) => (
                                      <option key={window.id} value={`window:${window.id}`}>{window.name}</option>
                                    ))}
                                  </optgroup>
                                ) : null}
                              </select>
                            </div>
                            {analyticsRangeMode === 'custom' ? (
                              <>
                                <div className="grid gap-1">
                                  <label className="text-xs font-medium text-muted-foreground">Start date</label>
                                  <input
                                    type="date"
                                    value={analyticsCustomStartsAt}
                                    onChange={(event) => setAnalyticsCustomStartsAt(event.target.value)}
                                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <label className="text-xs font-medium text-muted-foreground">End date</label>
                                  <input
                                    type="date"
                                    value={analyticsCustomEndsAt}
                                    onChange={(event) => setAnalyticsCustomEndsAt(event.target.value)}
                                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {analyticsLoading ? (
                        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">Loading analytics...</div>
                      ) : !analytics ? (
                        <div className="rounded-lg border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">No analytics available for this budget yet.</div>
                      ) : (
                        <>
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <AnalyticsMetricCard
                              label="Spend"
                              value={formatMoney(analytics.summary.cost, analytics.summary.currency)}
                              detail={formatDateRange(analytics.rangeStart, analytics.rangeEnd)}
                            />
                            <AnalyticsMetricCard
                              label="Budget health"
                              value={analyticsBudgetLabel}
                              detail={analyticsBudgetPercent != null ? `${formatPercent(analyticsBudgetPercent)} used` : 'No limit selected'}
                            />
                            <AnalyticsMetricCard
                              label="Tokens"
                              value={formatInt(analytics.summary.totalTokens)}
                              detail={`${formatInt(analytics.summary.totalEvents)} request${analytics.summary.totalEvents === 1 ? '' : 's'}`}
                            />
                            <AnalyticsMetricCard
                              label="Cache hit rate"
                              value={formatPercent(analyticsCacheHitRate)}
                              detail={`${formatInt(analytics.summary.inputHitTokens)} hit input tokens`}
                            />
                            <AnalyticsMetricCard
                              label="Input miss"
                              value={formatInt(analytics.summary.inputMissTokens)}
                              detail={formatMoney(analytics.summary.inputMissCost, analytics.summary.currency)}
                            />
                            <AnalyticsMetricCard
                              label="Output"
                              value={formatInt(analytics.summary.outputTokens)}
                              detail={formatMoney(analytics.summary.outputCost, analytics.summary.currency)}
                            />
                            <AnalyticsMetricCard
                              label="Projected spend"
                              value={formatMoney(analyticsProjectedCost, analytics.summary.currency)}
                              detail={analytics.window ? 'Current window forecast' : 'Select a budget window'}
                            />
                            <AnalyticsMetricCard
                              label="Days remaining"
                              value={analyticsDaysRemaining == null ? 'n/a' : analyticsDaysRemaining}
                              detail={analytics.window?.endsAt ? `Ends ${formatDateOnly(analytics.window.endsAt)}` : 'Open-ended range'}
                            />
                          </div>

                          <div className="grid gap-4 xl:grid-cols-2">
                            <DailySpendChart analytics={analytics} />
                            <DailyTokenChart analytics={analytics} />
                          </div>

                          <div className="grid gap-4 xl:grid-cols-2">
                            <div className="rounded-lg border border-border bg-card p-4">
                              <div className="mb-3 text-sm font-semibold text-foreground">Budget health</div>
                              <div className="space-y-3 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Selected range</span>
                                  <span className="text-right font-medium text-foreground">{analytics.window?.name || analyticsRangeLabel}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Money limit</span>
                                  <span className="text-right font-medium text-foreground">{analytics.window?.moneyLimit == null ? 'No money limit' : formatMoney(analytics.window.moneyLimit, analytics.window.currency || analytics.summary.currency)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Token limit</span>
                                  <span className="text-right font-medium text-foreground">{analytics.window?.tokenLimit == null ? 'No token limit' : formatInt(analytics.window.tokenLimit)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Unpriced providers</span>
                                  <span className="text-right font-medium text-foreground">{analytics.summary.unpricedProviders.length ? analytics.summary.unpricedProviders.join(', ') : 'None'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Estimated events</span>
                                  <span className="text-right font-medium text-foreground">{formatInt(analytics.summary.estimatedEvents)} of {formatInt(analytics.summary.totalEvents)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-border bg-card p-4">
                              <div className="mb-3 text-sm font-semibold text-foreground">By provider and model</div>
                              {analytics.modelBreakdown.length === 0 ? (
                                <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No model usage in this range.</div>
                              ) : (
                                <div className="space-y-2">
                                  {analytics.modelBreakdown.slice(0, 6).map((row) => (
                                    <div key={`${row.provider}:${row.model}`} className="rounded-md border border-border/70 bg-background p-3 text-xs">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="truncate font-medium text-foreground">{row.provider}: {row.model}</div>
                                          <div className="mt-1 text-muted-foreground">
                                            {formatInt(row.inputHitTokens)} hit · {formatInt(row.inputMissTokens)} miss · {formatInt(row.outputTokens)} output
                                          </div>
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <div className="font-medium text-foreground">{formatMoney(row.cost, analytics.summary.currency)}</div>
                                          <div className="mt-1 text-muted-foreground">{formatInt(row.totalTokens)} tokens</div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-foreground">Top work items</div>
                                <div className="mt-1 text-xs text-muted-foreground">Highest-cost Chat tasks and Build runs in this range.</div>
                              </div>
                            </div>
                            {analyticsWorkRows.length === 0 ? (
                              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No task or session usage in this range.</div>
                            ) : (
                              <div className="overflow-hidden rounded-md border border-border/70">
                                <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_120px] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground">
                                  <span>Name</span>
                                  <span>Type</span>
                                  <span className="text-right">Tokens</span>
                                  <span className="text-right">Cost</span>
                                </div>
                                {analyticsWorkRows.map((row) => (
                                  <div key={row.taskId} className="grid grid-cols-[minmax(0,1fr)_120px_120px_120px] gap-3 border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-foreground" title={row.label}>{row.label}</div>
                                      <div className="mt-0.5 truncate text-muted-foreground">{row.detail}</div>
                                    </div>
                                    <span className="text-muted-foreground">{row.type}</span>
                                    <span className="text-right text-muted-foreground">{formatInt(row.totalTokens)}</span>
                                    <span className="text-right font-medium text-foreground">{formatMoney(row.cost, analytics.summary.currency)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}

                  {activeProjectTab === 'workboard' ? (
                    <ProjectWorkboardTab
                      project={selectedProject}
                      assignees={allAssignees}
                      budgetWindows={selectedProjectWindows}
                      sourceOptions={workboardSourceOptions}
                    />
                  ) : null}

                  {activeProjectTab === 'work' ? (
                    <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-1 text-sm font-semibold text-foreground">Budget contents</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Work currently attached to "{selectedProject.name}". Move projects, tasks, presets, or sessions to another budget or remove them from budget tracking.
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase text-muted-foreground">
                          Chat projects ({linkedChatProjects.length})
                        </div>
                        {linkedChatProjects.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                            No Chat projects are attached to this budget.
                          </div>
                        ) : linkedChatProjects.map((folder) => {
                          const folderTasks = tasksForFolder(folder.id);
                          return (
                            <div key={folder.id} className="rounded-md border border-border/70 bg-background p-3">
                              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">{folder.name}</div>
                                  <div className="text-[11px] text-muted-foreground">{folderTasks.length} task{folderTasks.length === 1 ? '' : 's'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <select
                                    value={folder.usageProjectId || ''}
                                    disabled={assignmentLoading}
                                    onChange={(event) => void assignFolderToUsageProject(folder.id, event.target.value || null)}
                                    className="h-7 w-36 rounded-md border border-input bg-background px-2 text-[11px]"
                                  >
                                    <option value="">No budget</option>
                                    {projectOptions.map((project) => (
                                      <option key={project.id} value={project.id}>
                                        {project.name}{project.status === 'archived' ? ' (archived)' : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px]"
                                    disabled={assignmentLoading}
                                    onClick={() => void assignFolderToUsageProject(folder.id, null)}
                                  >
                                    <X className="mr-1 h-3 w-3" />
                                    Remove
                                  </Button>
                                </div>
                              </div>
                              <div className="space-y-1">
                                {folderTasks.length === 0 ? (
                                  <div className="text-[11px] text-muted-foreground">No tasks in this project.</div>
                                ) : folderTasks.map((task) => (
                                  <div key={task.id} className="rounded border border-border/50 px-2 py-1.5 text-xs">
                                    <div className="truncate font-medium text-foreground">{task.summary || task.prompt}</div>
                                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                      <span>{task.status}</span>
                                      <span>{formatDateTime(task.createdAt)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-2 text-xs font-medium uppercase text-muted-foreground">
                          Direct Chat tasks ({directLinkedChatTasks.length})
                        </div>
                        {directLinkedChatTasks.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                            No standalone Chat tasks are directly attached to this budget.
                          </div>
                        ) : directLinkedChatTasks.map((task) => (
                          <div key={task.id} className="rounded-md border border-border/70 bg-background p-3">
                            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{task.summary || task.prompt || task.id}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {task.status} · {formatDateTime(task.createdAt)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={task.usageProjectId || ''}
                                  disabled={assignmentLoading}
                                  onChange={(event) => void assignChatTaskToUsageProject(task.id, event.target.value || null)}
                                  className="h-7 w-36 rounded-md border border-input bg-background px-2 text-[11px]"
                                >
                                  <option value="">No budget</option>
                                  {projectOptions.map((project) => (
                                    <option key={project.id} value={project.id}>
                                      {project.name}{project.status === 'archived' ? ' (archived)' : ''}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px]"
                                  disabled={assignmentLoading}
                                  onClick={() => void assignChatTaskToUsageProject(task.id, null)}
                                >
                                  <X className="mr-1 h-3 w-3" />
                                  Remove
                                </Button>
                              </div>
                            </div>
                            {task.folderId ? (
                              <div className="rounded border border-border/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                                In Chat project: {folderById.get(task.folderId)?.name || task.folderId}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase text-muted-foreground">
                          Build presets ({buildPresetGroups.length})
                        </div>
                        {buildPresetGroups.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                            No Build presets are attached to this budget.
                          </div>
                        ) : buildPresetGroups.map((group) => {
                          const presetSessions = group.sessions;
                          return (
                            <div key={group.key} className="rounded-md border border-border/70 bg-background p-3">
                              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">{group.name}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {getAgentLabel(group.agentId)} · {group.workspaceRelativePath || '.'} · {presetSessions.length} session{presetSessions.length === 1 ? '' : 's'}
                                  </div>
                                  {!group.presetAttached && group.preset ? (
                                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                                      Sessions are tracked here; the preset default is not attached.
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  {group.preset && !group.presetAttached ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-[11px]"
                                      disabled={assignmentLoading}
                                      onClick={() => void assignBuildPresetGroupToUsageProject(group, selectedProject.id)}
                                    >
                                      Attach preset
                                    </Button>
                                  ) : null}
                                  <select
                                    value={selectedProject.id}
                                    disabled={assignmentLoading}
                                    onChange={(event) => void assignBuildPresetGroupToUsageProject(group, event.target.value || null)}
                                    className="h-7 w-36 rounded-md border border-input bg-background px-2 text-[11px]"
                                  >
                                    <option value="">No budget</option>
                                    {projectOptions.map((project) => (
                                      <option key={project.id} value={project.id}>
                                        {project.name}{project.status === 'archived' ? ' (archived)' : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px]"
                                    disabled={assignmentLoading}
                                    onClick={() => void assignBuildPresetGroupToUsageProject(group, null)}
                                  >
                                    <X className="mr-1 h-3 w-3" />
                                    Remove
                                  </Button>
                                </div>
                              </div>
                              <div className="space-y-1">
                                {presetSessions.length === 0 ? (
                                  <div className="text-[11px] text-muted-foreground">No Build sessions have used this preset yet.</div>
                                ) : presetSessions.map((session) => {
                                  const detail = buildSessionDetails[session.id];
                                  return (
                                    <div key={session.id} className="rounded border border-border/50 px-2 py-1.5 text-xs">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="truncate font-medium text-foreground">{session.title}</span>
                                        <span className="text-[11px] text-muted-foreground">{session.lifecycleStatus}</span>
                                      </div>
                                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                                        {(detail?.runs?.length ?? session.runCount ?? 0)} run{(detail?.runs?.length ?? session.runCount ?? 0) === 1 ? '' : 's'} · {formatDateTime(session.lastActivityAt)}
                                      </div>
                                      {detail?.runs?.length ? (
                                        <div className="mt-1 space-y-1">
                                          {detail.runs.map((run) => (
                                            <div key={run.id} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                                              <span className="truncate">{run.taskId || run.sessionId || run.id}</span>
                                              <span>{run.status}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {otherLinkedBuildSessions.length > 0 ? (
                          <div className="rounded-md border border-border/70 bg-background p-3">
                            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Other Build sessions</div>
                            <div className="space-y-1">
                              {otherLinkedBuildSessions.map((session) => (
                                <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 px-2 py-1.5 text-xs">
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-foreground">{session.title}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {getAgentLabel(session.agentId)} · {getSessionPresetLabel(session)} · {session.runCount || 0} run{(session.runCount || 0) === 1 ? '' : 's'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <select
                                      value={session.usageProjectId || ''}
                                      disabled={assignmentLoading}
                                      onChange={(event) => void assignBuildSessionToUsageProject(session.id, event.target.value || null)}
                                      className="h-7 w-36 rounded-md border border-input bg-background px-2 text-[11px]"
                                    >
                                      <option value="">No budget</option>
                                      {projectOptions.map((project) => (
                                        <option key={project.id} value={project.id}>
                                          {project.name}{project.status === 'archived' ? ' (archived)' : ''}
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-[11px]"
                                      disabled={assignmentLoading}
                                      onClick={() => void assignBuildSessionToUsageProject(session.id, null)}
                                    >
                                      Remove
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">Assign existing work</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Assign or move existing Chat projects, standalone Chat tasks, Build presets, and Build sessions.
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5"
                        onClick={() => setAssignExistingWorkOpen((current) => !current)}
                      >
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', assignExistingWorkOpen ? 'rotate-180' : '')} />
                        {assignExistingWorkOpen ? 'Collapse' : 'Expand'}
                      </Button>
                    </div>

                    {!assignExistingWorkOpen ? (
                      <div className="mt-3 text-[11px] text-muted-foreground">
                        {assignmentRows.length} available item{assignmentRows.length === 1 ? '' : 's'}.
                      </div>
                    ) : (
                      <div className="mt-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <div className="relative min-w-[220px] flex-1">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <input
                              value={assignmentSearch}
                              onChange={(event) => setAssignmentSearch(event.target.value)}
                              placeholder="Search work..."
                              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs"
                            />
                          </div>
                          <select
                            value={assignmentTypeFilter}
                            onChange={(event) => setAssignmentTypeFilter(event.target.value as AssignmentTypeFilter)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="all">All types</option>
                            <option value="chat-project">Chat projects</option>
                            <option value="chat-task">Chat tasks</option>
                            <option value="build-preset">Build presets</option>
                            <option value="build-session">Build sessions</option>
                          </select>
                          <select
                            value={assignmentStatusFilter}
                            onChange={(event) => setAssignmentStatusFilter(event.target.value as AssignmentStatusFilter)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="all">All assignments</option>
                            <option value="unassigned">Unassigned</option>
                            <option value="this-budget">This budget</option>
                            <option value="elsewhere">Other budgets</option>
                          </select>
                          <div className="relative">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 px-2 text-xs"
                              onClick={() => setAssignmentColumnsOpen((current) => !current)}
                            >
                              <Columns3 className="h-3.5 w-3.5" />
                              Columns
                            </Button>
                            {assignmentColumnsOpen ? (
                              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-md border border-border bg-popover p-2 shadow-lg">
                                <div className="mb-1 px-1 text-[11px] font-medium uppercase text-muted-foreground">Show columns</div>
                                {ASSIGNMENT_COLUMN_CONFIG.map((column) => {
                                  const checked = !assignmentHiddenColumns[column.id];
                                  const visibleCount = visibleAssignmentColumns.length;
                                  return (
                                    <label
                                      key={column.id}
                                      className={cn(
                                        'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground hover:bg-muted',
                                        checked && visibleCount <= 1 && 'cursor-not-allowed opacity-60'
                                      )}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={checked && visibleCount <= 1}
                                        onChange={(event) => setAssignmentColumnHidden(column.id, !event.target.checked)}
                                      />
                                      <span>{column.label}</span>
                                    </label>
                                  );
                                })}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 h-7 w-full justify-start px-1.5 text-xs"
                                  onClick={resetAssignmentColumns}
                                >
                                  Reset columns
                                </Button>
                              </div>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 px-2 text-xs"
                            onClick={exportAssignmentsCsv}
                            disabled={filteredAssignmentRows.length === 0}
                          >
                            <Download className="h-3.5 w-3.5" />
                            CSV
                          </Button>
                          {assignmentCsvNotice ? (
                            <div
                              role="status"
                              aria-live="polite"
                              className="flex h-8 max-w-[260px] items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] text-emerald-700 dark:text-emerald-300"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{assignmentCsvNotice}</span>
                            </div>
                          ) : null}
                          <div className="ml-auto text-[11px] text-muted-foreground">
                            {filteredAssignmentRows.length} of {assignmentRows.length}
                          </div>
                        </div>

                        <div
                          ref={assignmentTopScrollerRef}
                          className="mb-1 h-4 overflow-x-auto overflow-y-hidden"
                          onScroll={() => syncAssignmentHorizontalScroll('top')}
                          aria-label="Assign existing work horizontal scroll"
                        >
                          <div style={{ width: `${assignmentTableWidth}px`, height: 1 }} />
                        </div>

                        <div
                          ref={assignmentBottomScrollerRef}
                          className="overflow-x-auto rounded-md border border-border/70"
                          onScroll={() => syncAssignmentHorizontalScroll('bottom')}
                        >
                          <div className="min-w-full" style={{ width: `${assignmentTableWidth}px` }}>
                            <div
                              className="grid gap-2 border-b border-border/70 bg-muted/30 px-2 py-1.5 text-[11px] font-medium uppercase text-muted-foreground"
                              style={{ gridTemplateColumns: assignmentGridTemplateColumns }}
                            >
                              <div />
                              {visibleAssignmentColumns.map((column) => (
                                <div key={column.id} className="relative min-w-0 border-r border-border/50 pr-4 last:border-r-0">
                                  <span className="block truncate">{column.label}</span>
                                  <span
                                    role="separator"
                                    aria-orientation="vertical"
                                    aria-label={`Resize ${column.label} column`}
                                    className="absolute -right-1.5 top-0 z-10 h-full w-3 cursor-col-resize"
                                    onPointerDown={(event) => startAssignmentColumnResize(event, column.id)}
                                  />
                                </div>
                              ))}
                            </div>

                            {filteredAssignmentRows.length === 0 ? (
                              <div className="p-3 text-xs text-muted-foreground">No matching work.</div>
                            ) : filteredAssignmentRows.map((row) => {
                              const expanded = expandedAssignmentRows[row.key] === true;
                              return (
                                <div key={row.key} className="border-b border-border/50 last:border-b-0">
                                  <div
                                    className="grid gap-2 px-2 py-2 text-xs"
                                    style={{ gridTemplateColumns: assignmentGridTemplateColumns }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleAssignmentRow(row.key)}
                                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                      aria-label={expanded ? 'Collapse row' : 'Expand row'}
                                    >
                                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded ? 'rotate-180' : '')} />
                                    </button>
                                    {visibleAssignmentColumns.map((column) => (
                                      <div key={column.id} className="min-w-0 self-center">
                                        {renderAssignmentCell(row, column.id)}
                                      </div>
                                    ))}
                                  </div>

                                  {expanded ? (
                                    <div className="border-t border-border/40 bg-background/60 px-3 py-2">
                                      {row.type === 'chat-project' && row.folder ? (
                                        <div className="max-h-36 space-y-1 overflow-y-auto">
                                          {tasksForFolder(row.folder.id).length === 0 ? (
                                            <div className="text-[11px] text-muted-foreground">No tasks in this Chat project.</div>
                                          ) : tasksForFolder(row.folder.id).map((task) => (
                                            <div key={task.id} className="grid grid-cols-[minmax(0,1fr)_85px_135px] gap-2 rounded border border-border/50 px-2 py-1 text-[11px]">
                                              <span className="truncate text-foreground">{task.summary || task.prompt}</span>
                                              <span className="text-muted-foreground">{task.status}</span>
                                              <span className="text-right text-muted-foreground">{formatDateTime(task.createdAt)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}

                                      {row.type === 'chat-task' && row.task ? (
                                        <div className="rounded border border-border/50 px-2 py-1.5 text-[11px]">
                                          <div className="truncate font-medium text-foreground">{row.task.summary || row.task.prompt || row.task.id}</div>
                                          <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-3">
                                            <span>Status: {row.task.status}</span>
                                            <span>Created: {formatDateTime(row.task.createdAt)}</span>
                                            <span>Project: {row.task.folderId ? folderById.get(row.task.folderId)?.name || row.task.folderId : 'Unfiled'}</span>
                                          </div>
                                        </div>
                                      ) : null}

                                      {row.type === 'build-preset' && row.preset ? (
                                        <div className="max-h-36 space-y-1 overflow-y-auto">
                                          {sessionsForPreset(row.preset).length === 0 ? (
                                            <div className="text-[11px] text-muted-foreground">No Build sessions have used this preset yet.</div>
                                          ) : sessionsForPreset(row.preset).map((session) => (
                                            <div key={session.id} className="grid grid-cols-[minmax(0,1fr)_90px_135px] gap-2 rounded border border-border/50 px-2 py-1 text-[11px]">
                                              <span className="truncate text-foreground">{session.title}</span>
                                              <span className="text-muted-foreground">{session.runCount || 0} run{(session.runCount || 0) === 1 ? '' : 's'}</span>
                                              <span className="text-right text-muted-foreground">{formatDateTime(session.lastActivityAt)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}

                                      {row.type === 'build-session' && row.session ? (
                                        <div className="max-h-36 space-y-1 overflow-y-auto">
                                          {(() => {
                                            const runs = buildSessionDetails[row.session.id]?.runs || [];
                                            return runs.length === 0 ? (
                                              <div className="text-[11px] text-muted-foreground">No run details available.</div>
                                            ) : runs.map((run) => (
                                              <div key={run.id} className="grid grid-cols-[minmax(0,1fr)_90px_135px] gap-2 rounded border border-border/50 px-2 py-1 text-[11px]">
                                                <span className="truncate text-foreground">{run.taskId || run.sessionId || run.id}</span>
                                                <span className="text-muted-foreground">{run.status}</span>
                                                <span className="text-right text-muted-foreground">{formatDateTime(run.completedAt || run.startedAt)}</span>
                                              </div>
                                            ));
                                          })()}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                    </div>
                  ) : null}

                  {activeProjectTab === 'assignees' ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                        <div className="rounded-lg border border-border bg-card p-4">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Users className="h-4 w-4" />
                                People directory
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">Real people who do the work, separate from AI agents.</div>
                            </div>
                            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => void handleCreateAssignee()}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="space-y-1">
                            {allAssignees.length === 0 ? (
                              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                                No people yet.
                              </div>
                            ) : allAssignees.map((assignee) => (
                              <button
                                key={assignee.id}
                                type="button"
                                onClick={() => setSelectedAssigneeId(assignee.id)}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                                  selectedAssignee?.id === assignee.id ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                              >
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: assignee.color || '#64748b' }} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{assignee.name}</span>
                                  <span className="block truncate text-[11px] text-muted-foreground">
                                    {assignee.role || assignee.company || (assignee.status === 'archived' ? 'Archived' : 'No role set')}
                                  </span>
                                </span>
                                {assignee.status === 'archived' ? <Archive className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-foreground">Person details</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button size="sm" onClick={() => void handleSaveAssignee()}>Save person</Button>
                                {selectedAssignee && selectedAssignee.status === 'active' ? (
                                  <Button size="sm" variant="outline" onClick={() => void archiveAssignee(selectedAssignee.id, true)}>
                                    Archive
                                  </Button>
                                ) : null}
                                {selectedAssignee && selectedAssignee.status === 'archived' ? (
                                  <Button size="sm" variant="outline" onClick={() => void archiveAssignee(selectedAssignee.id, false)}>
                                    Restore
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Name</label>
                                <input value={assigneeName} onChange={(event) => setAssigneeName(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Name" />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Role</label>
                                <input value={assigneeRole} onChange={(event) => setAssigneeRole(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Developer, designer, PM..." />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Email</label>
                                <input value={assigneeEmail} onChange={(event) => setAssigneeEmail(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="email@example.com" />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                                <input value={assigneePhone} onChange={(event) => setAssigneePhone(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Phone" />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Company</label>
                                <input value={assigneeCompany} onChange={(event) => setAssigneeCompany(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Company" />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Color</label>
                                <div className="flex items-center gap-2">
                                  <input type="color" value={assigneeColor} onChange={(event) => setAssigneeColor(event.target.value)} className="h-9 w-12 rounded-md border border-input bg-background p-1" aria-label="Assignee color" />
                                  <div className="flex flex-wrap gap-1">
                                    {USAGE_PROJECT_COLOR_SWATCHES.slice(0, 8).map((color) => (
                                      <button
                                        key={color}
                                        type="button"
                                        onClick={() => setAssigneeColor(color)}
                                        className={cn('h-5 w-5 rounded-full border border-border', assigneeColor.toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
                                        style={{ backgroundColor: color }}
                                        aria-label={`Use color ${color}`}
                                      />
                                    ))}
                                  </div>
                                </div>
                              </div>
                              <div className="grid gap-1 md:col-span-2">
                                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                                <textarea value={assigneeNotes} onChange={(event) => setAssigneeNotes(event.target.value)} className="min-h-20 rounded-md border border-input bg-background px-2 py-2 text-sm" placeholder="Availability, responsibilities, or handoff notes" />
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 text-sm font-semibold text-foreground">Default assignees for this budget</div>
                            <AssigneeMultiSelect
                              assignees={activeAssigneeOptions}
                              value={budgetAssigneeIds}
                              onChange={setBudgetAssigneeIds}
                              label="Budget defaults"
                              placeholder="Create a person first."
                            />
                            <div className="mt-3 flex justify-end">
                              <Button size="sm" onClick={() => void handleSaveProject()}>Save default assignees</Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">Assignee workload overview</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Shows assigned budgets, Chat projects, Build presets, Build sessions, task counts, run counts, and current budget usage.
                            </div>
                          </div>
                          <select value={assigneeFilterId} onChange={(event) => setAssigneeFilterId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                            <option value="all">All people</option>
                            {allAssignees.map((assignee) => (
                              <option key={assignee.id} value={assignee.id}>{assignee.name}{assignee.status === 'archived' ? ' (archived)' : ''}</option>
                            ))}
                          </select>
                        </div>
                        {assigneeOverviewRows.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No assignee workload yet.</div>
                        ) : (
                          <div className="grid gap-3">
                            {assigneeOverviewRows.map((row) => (
                              <div key={row.assignee.id} className="rounded-md border border-border/70 bg-background p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.assignee.color || '#64748b' }} />
                                      <span className="truncate text-sm font-semibold text-foreground">{row.assignee.name}</span>
                                      {row.assignee.status === 'archived' ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Archived</span> : null}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {[row.assignee.role, row.assignee.company, row.assignee.email].filter(Boolean).join(' · ') || 'No contact details'}
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-right text-xs sm:grid-cols-4">
                                    <div>
                                      <div className="font-semibold text-foreground">{row.budgetWork.length}</div>
                                      <div className="text-muted-foreground">budgets</div>
                                    </div>
                                    <div>
                                      <div className="font-semibold text-foreground">{row.chatWork.length}</div>
                                      <div className="text-muted-foreground">Chat projects</div>
                                    </div>
                                    <div>
                                      <div className="font-semibold text-foreground">{row.presetWork.length}</div>
                                      <div className="text-muted-foreground">presets</div>
                                    </div>
                                    <div>
                                      <div className="font-semibold text-foreground">{row.runCount}</div>
                                      <div className="text-muted-foreground">runs</div>
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
                                  <div className="rounded border border-border/60 bg-card px-2 py-2">
                                    <div className="text-[11px] uppercase text-muted-foreground">Current budget cost</div>
                                    <div className="mt-1 font-semibold text-foreground">{formatMoney(row.selectedBudgetSummary?.cost, row.selectedBudgetSummary?.currency)}</div>
                                  </div>
                                  <div className="rounded border border-border/60 bg-card px-2 py-2">
                                    <div className="text-[11px] uppercase text-muted-foreground">Current budget tokens</div>
                                    <div className="mt-1 font-semibold text-foreground">{formatInt(row.selectedBudgetSummary?.totalTokens)}</div>
                                  </div>
                                  <div className="rounded border border-border/60 bg-card px-2 py-2">
                                    <div className="text-[11px] uppercase text-muted-foreground">Tasks</div>
                                    <div className="mt-1 font-semibold text-foreground">{row.taskCount}</div>
                                  </div>
                                  <div className="rounded border border-border/60 bg-card px-2 py-2">
                                    <div className="text-[11px] uppercase text-muted-foreground">Build sessions</div>
                                    <div className="mt-1 font-semibold text-foreground">{row.sessionWork.length}</div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                                  <div>
                                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Budgets</div>
                                    <div className="space-y-1">
                                      {row.budgetWork.length ? row.budgetWork.slice(0, 5).map((project) => (
                                        <div key={project.id} className="truncate rounded border border-border/50 px-2 py-1 text-xs text-foreground">{project.name}</div>
                                      )) : <div className="text-xs text-muted-foreground">No budget defaults</div>}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Chat projects</div>
                                    <div className="space-y-1">
                                      {row.chatWork.length ? row.chatWork.slice(0, 5).map((folder) => (
                                        <div key={folder.id} className="truncate rounded border border-border/50 px-2 py-1 text-xs text-foreground">{folder.name}</div>
                                      )) : <div className="text-xs text-muted-foreground">No Chat projects</div>}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Build presets</div>
                                    <div className="space-y-1">
                                      {row.presetWork.length ? row.presetWork.slice(0, 5).map((preset) => (
                                        <div key={buildPresetKey(preset.agentId, preset.id)} className="truncate rounded border border-border/50 px-2 py-1 text-xs text-foreground">{preset.name}</div>
                                      )) : <div className="text-xs text-muted-foreground">No Build presets</div>}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Build sessions</div>
                                    <div className="space-y-1">
                                      {row.sessionWork.length ? row.sessionWork.slice(0, 5).map((session) => (
                                        <div key={session.id} className="truncate rounded border border-border/50 px-2 py-1 text-xs text-foreground">{session.title}</div>
                                      )) : <div className="text-xs text-muted-foreground">No Build sessions</div>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {activeProjectTab === 'budgets' || activeProjectTab === 'usage' ? (
                  <div className="grid gap-4">
                  {activeProjectTab === 'budgets' ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-card p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          Budget windows
                          <TooltipProvider delayDuration={250}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="What are budget windows?">
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" align="center" className="max-w-[300px] text-xs">
                                Budget windows are dated periods inside a budget project. Use them for monthly client limits, phases, retainers, or trials with optional money and token limits.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setSelectedWindowId(null)}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          New window
                        </Button>
                      </div>
                      <div className="mb-3 grid gap-2">
                        {selectedProjectWindows.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                            No budget windows. Tracking can still be on without a budget.
                          </div>
                        ) : selectedProjectWindows.map((window) => {
                          const status = selectedProjectStatus.find((entry) => entry.windowId === window.id);
                          return (
                            <button
                              key={window.id}
                              type="button"
                              onClick={() => setSelectedWindowId(window.id)}
                              className={cn(
                                'rounded-md border border-border px-3 py-2 text-left text-xs',
                                selectedWindowId === window.id ? 'bg-primary/10' : 'hover:bg-muted/40'
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{window.name}</span>
                                <span className={status?.blocking ? 'text-destructive' : status?.exceeded ? 'text-warning' : 'text-muted-foreground'}>
                                  {status?.blocking ? 'blocking' : status?.exceeded ? 'over' : window.mode}
                                </span>
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {toDateInput(window.startsAt)} to {toDateInput(window.endsAt) || 'open'}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-muted-foreground">Window name</label>
                          <input value={windowName} onChange={(event) => setWindowName(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Budget window" />
                        </div>
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-muted-foreground">Budget mode</label>
                          <select value={windowMode} onChange={(event) => setWindowMode(event.target.value === 'block' ? 'block' : 'warn')} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                            <option value="warn">Warn only</option>
                            <option value="block">Block new tasks</option>
                          </select>
                        </div>
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-muted-foreground">Start date</label>
                          <input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
                        </div>
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-muted-foreground">End date</label>
                          <input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
                        </div>
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-muted-foreground">Money limit (USD)</label>
                          <input type="number" min="0" step="0.01" value={moneyLimit} onChange={(event) => setMoneyLimit(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="No money limit" />
                        </div>
                        <div className="grid gap-1">
                          <label className="text-xs font-medium text-muted-foreground">Token limit</label>
                          <input type="number" min="0" step="1" value={tokenLimit} onChange={(event) => setTokenLimit(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="No token limit" />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input type="checkbox" checked={windowEnabled} onChange={(event) => setWindowEnabled(event.target.checked)} />
                          Enabled
                        </label>
                        <Button onClick={handleSaveWindow}>Save window</Button>
                        <Button variant="outline" disabled={!selectedWindow} onClick={() => selectedWindow && void deleteWindow(selectedWindow.id)}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                  ) : null}

                  {activeProjectTab === 'usage' ? (
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">Project usage</div>
                      <div className="flex flex-wrap items-center gap-2">
                        {budgetSummaryCsvNotice ? (
                          <div role="status" aria-live="polite" className="flex h-8 max-w-[260px] items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{budgetSummaryCsvNotice}</span>
                          </div>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-xs"
                          onClick={exportBudgetSummaryCsv}
                          disabled={summaries.length === 0}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export summary CSV
                        </Button>
                      </div>
                    </div>
                    {summaryLoading ? (
                      <div className="text-xs text-muted-foreground">Loading summary...</div>
                    ) : summaries.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No usage yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {summaries.map((row) => (
                          <div key={row.window?.id || 'all'} className="rounded-md border border-border/70 bg-background p-3 text-xs">
                            <div className="mb-2 font-medium text-foreground">{row.window?.name || 'All tracked usage'}</div>
                            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                              <span>Input hit</span><span className="text-right">{formatInt(row.summary.inputHitTokens)}</span>
                              <span>Input miss</span><span className="text-right">{formatInt(row.summary.inputMissTokens)}</span>
                              <span>Output</span><span className="text-right">{formatInt(row.summary.outputTokens)}</span>
                              <span>Total tokens</span><span className="text-right">{formatInt(row.summary.totalTokens)}</span>
                              <span>Hit cost</span><span className="text-right">{formatMoney(row.summary.inputHitCost, row.summary.currency)}</span>
                              <span>Miss cost</span><span className="text-right">{formatMoney(row.summary.inputMissCost, row.summary.currency)}</span>
                              <span>Output cost</span><span className="text-right">{formatMoney(row.summary.outputCost, row.summary.currency)}</span>
                              <span>Total cost</span><span className="text-right font-medium text-foreground">{formatMoney(row.summary.cost, row.summary.currency)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  ) : null}
                </div>
                  ) : null}

                  {activeProjectTab === 'details' ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Tag className="h-4 w-4" />
                          Budget details
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Client name</label>
                            <input value={clientName} onChange={(event) => setClientName(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Client name" />
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Project code</label>
                            <input value={projectCode} onChange={(event) => setProjectCode(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Project code" />
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Owner</label>
                            <input value={projectOwner} onChange={(event) => setProjectOwner(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Owner" />
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Billing type</label>
                            <select value={billingType} onChange={(event) => setBillingType(event.target.value as UsageProjectBillingType)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                              {USAGE_PROJECT_BILLING_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                            </select>
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Billing reference</label>
                            <input value={billingReference} onChange={(event) => setBillingReference(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="PO, invoice, contract, or CRM reference" />
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Priority</label>
                            <select value={projectPriority} onChange={(event) => setProjectPriority(event.target.value as UsageProjectPriority)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                              {USAGE_PROJECT_PRIORITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                            </select>
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Due date</label>
                            <input type="date" value={projectDueDate} onChange={(event) => setProjectDueDate(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
                          </div>
                          <div className="grid gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Tags</label>
                            <input value={projectTagsText} onChange={(event) => setProjectTagsText(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Comma separated tags" />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-foreground">Links</div>
                          <Button size="sm" variant="outline" onClick={addProjectLink}>
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Add link
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {projectLinks.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                              No links yet. Add a repo, folder, ticket board, CRM record, contract, or invoice link.
                            </div>
                          ) : projectLinks.map((link) => (
                            <div key={link.id} className="grid items-end gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto_auto]">
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Link label</label>
                                <input value={link.label} onChange={(event) => updateProjectLink(link.id, { label: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Label" />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs font-medium text-muted-foreground">Link URL or path</label>
                                <input value={link.url} onChange={(event) => updateProjectLink(link.id, { url: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="URL or local path" />
                              </div>
                              <Button type="button" variant="outline" size="sm" className="h-9 px-2" onClick={() => link.url && void getAccomplish().openExternal(link.url)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                              <Button type="button" variant="outline" size="sm" className="h-9 px-2" onClick={() => removeProjectLink(link.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button size="sm" onClick={() => void handleSaveProject()}>Save details and links</Button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeProjectTab === 'notes' ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">Notes</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Add dated notes for this budget. Existing notes can be edited or deleted.
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <textarea
                            value={newProjectNoteText}
                            onChange={(event) => setNewProjectNoteText(event.target.value)}
                            className="min-h-24 rounded-md border border-input bg-background px-2 py-2 text-sm"
                            placeholder="Write a new note..."
                          />
                          <div className="flex justify-end">
                            <Button type="button" size="sm" variant="outline" onClick={() => void addProjectNote()} disabled={!newProjectNoteText.trim()}>
                              <Plus className="mr-1.5 h-3.5 w-3.5" />
                              Add note
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {projectNotes.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
                            No notes yet.
                          </div>
                        ) : projectNotes.map((note) => {
                          const editing = editingProjectNoteId === note.id;
                          return (
                            <div key={note.id} className="rounded-lg border border-border bg-card p-4">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[11px] text-muted-foreground">
                                  {formatDateTime(note.createdAt)}
                                  {note.updatedAt ? ` · edited ${formatDateTime(note.updatedAt)}` : ''}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => {
                                      if (editing) {
                                        setEditingProjectNoteId(null);
                                        void saveProjectWithNotes(projectNotes);
                                      } else {
                                        setEditingProjectNoteId(note.id);
                                      }
                                    }}
                                  >
                                    <Pencil className="mr-1 h-3 w-3" />
                                    {editing ? 'Done' : 'Edit'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => deleteProjectNote(note.id)}
                                  >
                                    <Trash2 className="mr-1 h-3 w-3" />
                                    Delete
                                  </Button>
                                </div>
                              </div>
                              {editing ? (
                                <textarea
                                  value={note.text}
                                  onChange={(event) => updateProjectNote(note.id, event.target.value)}
                                  className="min-h-24 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                                />
                              ) : (
                                <div className="whitespace-pre-wrap text-sm text-foreground">{note.text}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
