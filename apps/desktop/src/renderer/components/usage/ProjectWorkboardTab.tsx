import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowRight, Bold, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, ClipboardCopy, Columns3, Download, Edit3, Eye, EyeOff, FileText, FolderOpen, GripVertical, Heading2, Italic, Link, List, ListOrdered, Maximize2, MessageSquareText, Minimize2, Minus, MousePointer2, Palette, Paperclip, Plus, Quote, Search, Square, Tag, Trash2, Triangle, Type, Underline, Users, X, ZoomIn, ZoomOut } from 'lucide-react';
import type {
  ChecklistListPromptGenerateRequest,
  ChecklistListPromptPurpose,
  UsageAssignee,
  UsageProject,
  UsageProjectBudgetWindow,
  UsageProjectKanbanColumn,
  UsageProjectPriority,
  UsageProjectWorkItem,
  UsageProjectWorkItemChecklistItem,
  UsageProjectWorkItemChecklistList,
  UsageProjectWorkItemDocumentLink,
  UsageProjectWorkItemDrawing,
  UsageProjectWorkItemDrawingElement,
  UsageProjectWorkItemDrawingElementKind,
  UsageProjectWorkItemDrawingLineStyle,
  UsageProjectWorkItemNote,
  UsageProjectWorkItemSourceLink,
  UsageProjectWorkItemSourceType,
  WorkItemNotePromptGenerateRequest,
} from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getAccomplish } from '@/lib/accomplish';
import {
  attachFilesToActivePrompt,
  getActivePromptAttachmentTarget,
  getActivePromptInsertionTarget,
  insertIntoActivePrompt,
  subscribePromptAttachmentTarget,
  subscribePromptInsertionTarget,
  type PromptInsertionTarget,
} from '@/lib/prompt-insertion';
import { cn } from '@/lib/utils';

export type WorkboardSourceOption = {
  sourceType: Exclude<UsageProjectWorkItemSourceType, 'manual'>;
  sourceId: string;
  label: string;
  detail?: string;
  assigneeIds?: string[];
};

type WorkboardView = 'table' | 'kanban' | 'timeline';
type WorkboardGroupBy = 'none' | 'assignee' | 'priority' | 'source';
type TimelineRangePreset = '1m' | '3m' | '6m' | '1y' | 'custom';
type TimelineDisplayMode = 'timeline' | 'calendar';

const WorkboardOverlayPortalContext = createContext<HTMLElement | null>(null);

type WorkItemDraft = {
  id?: string;
  title: string;
  description: string;
  color: string;
  sourceType: UsageProjectWorkItemSourceType;
  sourceId: string;
  statusId: string;
  priority: UsageProjectPriority;
  assigneeIds: string[];
  startDate: string;
  dueDate: string;
  completedAt: string;
  blocked: boolean;
  blockedReason: string;
  tagsText: string;
  checklist: UsageProjectWorkItemChecklistItem[];
  checklistLists: UsageProjectWorkItemChecklistList[];
  notes: UsageProjectWorkItemNote[];
  drawings: UsageProjectWorkItemDrawing[];
  documents: UsageProjectWorkItemDocumentLink[];
  sources: UsageProjectWorkItemSourceLink[];
  archived: boolean;
  newListName: string;
  newChecklistTextByListId: Record<string, string>;
  newNoteTitle: string;
  newNoteText: string;
  newDocumentLabel: string;
  newDocumentUrl: string;
  newSourceTitle: string;
  newSourceUrl: string;
  newSourceDescription: string;
};

type ColumnDraft = {
  name: string;
  color: string;
  wipLimit: string;
  doneState: boolean;
  archivedState: boolean;
};

type DocumentEditDraft = {
  id: string;
  label: string;
  target: string;
};

type DocumentPromptNotice = { documentId: string; kind: 'success' | 'error'; text: string };

type AutoGrowingTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number;
  maxRows?: number;
};

export function AutoGrowingTextarea({
  className,
  minRows = 1,
  maxRows = 6,
  onInput,
  style,
  ...props
}: AutoGrowingTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback((element: HTMLTextAreaElement | null = ref.current) => {
    if (!element) return;
    element.style.height = 'auto';
    const computed = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 16;
    const padding =
      Number.parseFloat(computed.paddingTop || '0') +
      Number.parseFloat(computed.paddingBottom || '0');
    const border =
      Number.parseFloat(computed.borderTopWidth || '0') +
      Number.parseFloat(computed.borderBottomWidth || '0');
    const minHeight = Math.ceil(lineHeight * minRows + padding + border);
    const maxHeight = Math.ceil(lineHeight * maxRows + padding + border);
    const nextHeight = Math.max(minHeight, Math.min(element.scrollHeight, maxHeight));
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxRows, minRows]);

  useEffect(() => {
    resize();
  }, [props.defaultValue, props.value, resize]);

  return (
    <textarea
      {...props}
      ref={ref}
      rows={minRows}
      onInput={(event) => {
        resize(event.currentTarget);
        onInput?.(event);
      }}
      style={style}
      className={cn('overflow-hidden', className)}
    />
  );
}

const CHECKLIST_LIST_COLLAPSE_STORAGE_KEY = 'opendeskmate:workboard-checklist-list-collapse:v1';

export function checklistListCollapseKey(projectId: string, itemId: string | undefined, listId: string): string {
  return `${projectId || 'project'}:${itemId || 'draft'}:${listId}`;
}

export function readChecklistListCollapseState(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(CHECKLIST_LIST_COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[0] === 'string' && entry[1] === true)
    );
  } catch {
    return {};
  }
}

export function writeChecklistListCollapseState(state: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(CHECKLIST_LIST_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; collapse state is a convenience preference.
  }
}

const PRIORITIES: Array<{ value: UsageProjectPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const SOURCE_LABELS: Record<UsageProjectWorkItemSourceType, string> = {
  manual: 'Manual',
  chat_project: 'Chat project',
  chat_task: 'Chat task',
  build_preset: 'Build preset',
  build_session: 'Build session',
};

function truncateSourceLabel(value: string, maxLength = 72): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function formatSourceOptionLabel(option: WorkboardSourceOption): string {
  return `${SOURCE_LABELS[option.sourceType]} - ${truncateSourceLabel(option.label)}`;
}

const COLUMN_COLORS = ['#64748b', '#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#a855f7'];
const WORK_ITEM_COLOR_SWATCHES = ['#2dd4bf', '#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#64748b'];
const WORK_ITEM_OUTLINE_SWATCHES = ['#64748b', '#94a3b8', '#2dd4bf', '#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#111827'];
const DRAWING_COLOR_SWATCHES = ['#000000', '#ffffff', '#64748b', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
const TIMELINE_PRESETS: Array<{ value: TimelineRangePreset; label: string; months?: number }> = [
  { value: '1m', label: '1 month', months: 1 },
  { value: '3m', label: '3 months', months: 3 },
  { value: '6m', label: '6 months', months: 6 },
  { value: '1y', label: '1 year', months: 12 },
  { value: 'custom', label: 'Custom' },
];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WorkItemNameTooltip({
  value,
  children,
  side = 'top',
}: {
  value: string | null | undefined;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const text = String(value || '').trim();
  if (!text) return children;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-[320px] break-words text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function localId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function formatDate(value?: string | null): string {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleString();
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function dateInputFromDate(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addLocalMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, maxDay));
  return next;
}

function dateFromInputValue(value: string, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function rangePercent(time: number, start: number, end: number): number {
  const percent = ((time - start) / Math.max(1, end - start)) * 100;
  return Math.max(0, Math.min(100, percent));
}

function buildTimelineGridMarkers(start: number, end: number): Array<{ id: string; time: number; label: string }> {
  const days = Math.max(1, Math.ceil((end - start) / 86_400_000));
  const markers: Array<{ id: string; time: number; label: string }> = [];
  if (days <= 45) {
    const current = startOfLocalDay(new Date(start));
    while (current.getTime() <= end) {
      markers.push({ id: current.toISOString(), time: current.getTime(), label: current.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
      current.setDate(current.getDate() + 7);
    }
    return markers;
  }
  const current = startOfLocalMonth(new Date(start));
  while (current.getTime() <= end) {
    markers.push({ id: current.toISOString(), time: current.getTime(), label: monthLabel(current) });
    current.setMonth(current.getMonth() + 1);
  }
  return markers;
}

function buildCalendarMonths(start: number, end: number): Date[] {
  const months: Date[] = [];
  const current = startOfLocalMonth(new Date(start));
  while (current.getTime() <= end) {
    months.push(new Date(current));
    current.setMonth(current.getMonth() + 1);
  }
  return months.slice(0, 18);
}

function buildCalendarDays(month: Date): Date[] {
  const first = startOfLocalMonth(month);
  const last = endOfLocalMonth(month);
  const current = new Date(first);
  current.setDate(current.getDate() - current.getDay());
  const end = new Date(last);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const days: Date[] = [];
  while (current.getTime() <= end.getTime()) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function workItemDateBounds(item: UsageProjectWorkItem): { start: number; end: number } | null {
  const startSource = item.startDate || item.dueDate;
  const endSource = item.dueDate || item.startDate;
  if (!startSource || !endSource) return null;
  const start = startOfLocalDay(new Date(startSource)).getTime();
  const end = endOfLocalDay(new Date(endSource)).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function workItemOverlapsRange(item: UsageProjectWorkItem, start: number, end: number): boolean {
  const bounds = workItemDateBounds(item);
  return Boolean(bounds && bounds.start <= end && bounds.end >= start);
}

function workItemCoversDay(item: UsageProjectWorkItem, day: Date): boolean {
  const bounds = workItemDateBounds(item);
  if (!bounds) return false;
  const start = startOfLocalDay(day).getTime();
  const end = endOfLocalDay(day).getTime();
  return bounds.start <= end && bounds.end >= start;
}

function parseTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(',')) {
    const tag = part.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.slice(0, 20);
}

export function createChecklistList(name = 'Checklist', items: UsageProjectWorkItemChecklistItem[] = [], outlineColor?: string): UsageProjectWorkItemChecklistList {
  return {
    id: localId(),
    name,
    items,
    outlineColor,
    createdAt: nowIso(),
  };
}

export function getChecklistListsFromItem(item: UsageProjectWorkItem): UsageProjectWorkItemChecklistList[] {
  if (item.checklistLists?.length) return item.checklistLists;
  if (item.checklist?.length) return [createChecklistList('Checklist', item.checklist)];
  return [];
}

export function flattenChecklistLists(lists: UsageProjectWorkItemChecklistList[]): UsageProjectWorkItemChecklistItem[] {
  return lists.flatMap((list) => list.items);
}

export function checklistProgress(items: UsageProjectWorkItemChecklistItem[]): { done: number; total: number; percent: number } {
  const total = items.length;
  const done = items.filter((item) => item.completed).length;
  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

export function normalizeWorkItemOutlineColor(value?: string | null): string | undefined {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

export function workItemOutlineStyle(value?: string | null): React.CSSProperties {
  const color = normalizeWorkItemOutlineColor(value);
  return color ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` } : {};
}

export function WorkItemOutlineColorPicker({
  value,
  onChange,
  className,
}: {
  value?: string | null;
  onChange: (value?: string) => void;
  className?: string;
}) {
  const color = normalizeWorkItemOutlineColor(value);
  const pickerValue = color || WORK_ITEM_OUTLINE_SWATCHES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn('h-8 w-8 shrink-0', className)}
          title={color ? `Outline color ${color}` : 'Choose outline color'}
          aria-label="Choose outline color"
        >
          <Palette className="h-3.5 w-3.5" style={color ? { color } : undefined} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2" style={{ zIndex: 2147483647 }}>
        <div className="grid gap-2">
          <div className="text-xs font-semibold text-foreground">Outline color</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={pickerValue}
              onChange={(event) => onChange(event.target.value)}
              className="h-8 w-10 rounded border border-input bg-background p-0.5"
              aria-label="Pick custom outline color"
            />
            <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => onChange(undefined)}>
              Default
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {WORK_ITEM_OUTLINE_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={cn(
                  'h-6 w-6 rounded border border-border shadow-sm transition-transform hover:scale-110',
                  color?.toLowerCase() === swatch.toLowerCase() && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                )}
                style={{ backgroundColor: swatch }}
                title={swatch}
                aria-label={`Use ${swatch} outline`}
                onClick={() => onChange(swatch)}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ChecklistListContextButton({
  value,
  onSave,
  className,
}: {
  value?: string | null;
  onSave: (value?: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const hasContext = Boolean(String(value || '').trim());
  const preview = String(value || '').trim();

  useEffect(() => {
    if (open) setDraft(value || '');
  }, [open, value]);

  const save = () => {
    const next = draft.trim();
    onSave(next || undefined);
    setOpen(false);
  };

  const clear = () => {
    setDraft('');
    onSave(undefined);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn('h-7 w-7 shrink-0', hasContext && 'border-primary/60 bg-primary/10 text-primary', className)}
          title={hasContext ? `List context:\n${preview}` : 'Add list context'}
          aria-label={hasContext ? 'View or edit list context' : 'Add list context'}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3" style={{ zIndex: 2147483647 }}>
        <div className="grid gap-2">
          <div>
            <div className="text-xs font-semibold text-foreground">List context</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Saved with this list for later prompt generation.
            </p>
          </div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-28 resize-y rounded-md border border-input bg-background px-2 py-2 text-xs leading-relaxed text-foreground"
            placeholder="Describe what this list is for, including the page, screen, or element it applies to, plus constraints, tone, requirements, or instructions to include when generating prompts from its items."
          />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clear} disabled={!hasContext && !draft.trim()}>
              Clear
            </Button>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" className="h-8 px-2 text-xs" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type ChecklistListPromptButtonProps = {
  list: UsageProjectWorkItemChecklistList;
  workItemTitle?: string;
  agentId?: string | null;
  className?: string;
  resolveAssigneeNames?: (assigneeIds?: string[]) => string[];
  onSavePromptAsNote?: (title: string, prompt: string) => void;
  onInsertPrompt?: (prompt: string) => void;
};

const PROMPT_PURPOSE_OPTIONS: Array<{ value: ChecklistListPromptPurpose; label: string }> = [
  { value: 'build', label: 'Create or build' },
  { value: 'research', label: 'Find or research' },
  { value: 'review', label: 'Review or improve' },
  { value: 'write', label: 'Write or summarize' },
  { value: 'custom', label: 'Custom' },
];

export function ChecklistListPromptButton({
  list,
  workItemTitle,
  agentId,
  className,
  resolveAssigneeNames,
  onSavePromptAsNote,
  onInsertPrompt,
}: ChecklistListPromptButtonProps) {
  const api = getAccomplish();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<ChecklistListPromptPurpose>('build');
  const [customPurpose, setCustomPurpose] = useState('');
  const [selectionMode, setSelectionMode] = useState<'all' | 'specific'>('all');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [includeWorkItemName, setIncludeWorkItemName] = useState(false);
  const [includeListName, setIncludeListName] = useState(false);
  const [includeAssignee, setIncludeAssignee] = useState(false);
  const [includeDueDate, setIncludeDueDate] = useState(false);
  const [extraInstruction, setExtraInstruction] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePromptTarget, setActivePromptTarget] = useState<PromptInsertionTarget | null>(() => getActivePromptInsertionTarget());

  const availableItems = useMemo(
    () => list.items.filter((item) => includeCompleted || !item.completed),
    [includeCompleted, list.items]
  );

  const selectedItemCount = selectionMode === 'all'
    ? availableItems.length
    : availableItems.filter((item) => selectedIds.includes(item.id)).length;
  const canGeneratePrompt = selectedItemCount > 0 || Boolean(String(list.context || '').trim());

  useEffect(() => {
    if (!open) return;
    const incompleteIds = list.items.filter((item) => !item.completed).map((item) => item.id);
    setSelectedIds(incompleteIds);
    setIncludeCompleted(false);
    setSelectionMode('all');
    setIncludeContext(true);
    setIncludeWorkItemName(false);
    setIncludeListName(false);
    setIncludeAssignee(false);
    setIncludeDueDate(false);
    setExtraInstruction('');
    setPurpose('build');
    setCustomPurpose('');
    setGeneratedPrompt('');
    setNoteTitle(`Prompt - ${list.name || 'Checklist'}`);
    setError(null);
    setNotice(null);
  }, [list.id, list.items, list.name, open]);

  useEffect(() => {
    if (includeCompleted) return;
    const incompleteIds = new Set(list.items.filter((item) => !item.completed).map((item) => item.id));
    setSelectedIds((current) => current.filter((id) => incompleteIds.has(id)));
  }, [includeCompleted, list.items]);

  useEffect(() => subscribePromptInsertionTarget(setActivePromptTarget), []);

  const generate = async () => {
    const itemsToSend = (selectionMode === 'all'
      ? availableItems
      : availableItems.filter((item) => selectedIds.includes(item.id))
    ).filter((item) => item.text.trim());

    if (itemsToSend.length === 0 && !String(list.context || '').trim()) {
      setError('Select at least one list item or add list context first.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: ChecklistListPromptGenerateRequest = {
        agentId: agentId || undefined,
        purpose,
        customPurpose: purpose === 'custom' ? customPurpose : undefined,
        workItemTitle: workItemTitle || undefined,
        listName: list.name || undefined,
        listContext: includeContext ? list.context : undefined,
        extraInstruction: extraInstruction.trim() || undefined,
        includeWorkItemName,
        includeListName,
        includeListContext: includeContext,
        includeAssignee,
        includeDueDate,
        includeCompletedItems: includeCompleted,
        items: itemsToSend.map((item) => ({
          id: item.id,
          text: item.text,
          completed: item.completed,
          dueDate: item.dueDate,
          assigneeNames: includeAssignee ? resolveAssigneeNames?.(item.assigneeIds) : undefined,
        })),
      };
      let result;
      try {
        result = await api.generateChecklistListPrompt(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("No handler registered for 'settings-assistant:list-prompt:generate'")) {
          throw err;
        }
        const fallbackQuestion = [
          'Generate one directly usable prompt from this workboard checklist list.',
          'This is not a skill configuration request. Return only the prompt text.',
          'The user will paste the prompt into Chat mode or Build mode so an AI can create, find, research, review, write, or build the requested output.',
          ...(payload.extraInstruction
            ? [
              '',
              'User extra instruction (required):',
              payload.extraInstruction,
              '',
              'Apply the user extra instruction directly to the generated prompt. Do not ignore it or merely restate it.',
            ]
            : []),
          '',
          'Prompt request data (JSON):',
          JSON.stringify(payload, null, 2),
        ].join('\n');
        const fallback = await api.askUserSkillAssistant({
          question: fallbackQuestion,
          mode: 'general',
          agentId: agentId || undefined,
        });
        result = {
          ok: Boolean(fallback.ok && fallback.answer.trim()),
          prompt: fallback.answer.trim(),
          model: fallback.model,
          error: fallback.error,
        };
      }
      if (!result.ok || !result.prompt.trim()) {
        throw new Error(result.error || 'The Settings Assistant did not return a prompt.');
      }
      setGeneratedPrompt(result.prompt);
      setNotice('Prompt generated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate prompt.');
    } finally {
      setBusy(false);
    }
  };

  const copyGeneratedPrompt = async () => {
    const text = generatedPrompt.trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setNotice('Copied.');
  };

  const saveGeneratedPromptAsNote = () => {
    const text = generatedPrompt.trim();
    if (!text || !onSavePromptAsNote) return;
    onSavePromptAsNote(noteTitle.trim() || `Prompt - ${list.name || 'Checklist'}`, text);
    setNotice('Saved as note.');
  };

  const insertGeneratedPrompt = () => {
    const text = generatedPrompt.trim();
    if (!text) return;
    if (onInsertPrompt) {
      onInsertPrompt(text);
      setNotice('Inserted into prompt.');
      return;
    }
    if (insertIntoActivePrompt(text)) {
      setNotice(`Inserted into ${activePromptTarget?.label || 'prompt'}.`);
    } else {
      setError('No active Chat or Build prompt input is available.');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-7 w-7 shrink-0 rounded bg-muted p-0 text-muted-foreground hover:text-foreground',
            className
          )}
          title="Generate a prompt from this list."
          aria-label="Generate prompt from this checklist list"
        >
          <MessageSquareText className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={24}
        sticky="always"
        hideWhenDetached={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(560px,calc(100vw-2rem))] overflow-hidden p-0"
        style={{
          zIndex: 2147483647,
          maxHeight: 'min(720px, var(--radix-popover-content-available-height, calc(100vh - 2rem)))',
        }}
      >
        <div
          className="flex flex-col overflow-hidden text-xs"
          style={{ maxHeight: 'min(720px, var(--radix-popover-content-available-height, calc(100vh - 2rem)))' }}
        >
          <div className="shrink-0 border-b border-border/70 bg-popover px-3 py-2.5">
            <div className="font-semibold text-foreground">Generate prompt</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Uses the Settings Assistant AI to turn this list into a prompt you can run.
            </p>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Prompt type</span>
              <select
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as ChecklistListPromptPurpose)}
                className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
              >
                {PROMPT_PURPOSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {purpose === 'custom' ? (
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Custom type</span>
                <input
                  value={customPurpose}
                  onChange={(event) => setCustomPurpose(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="e.g. compare options"
                />
              </label>
            ) : null}
          </div>

          <div className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-2">
            <label className="flex items-center gap-2">
              <input type="radio" checked={selectionMode === 'all'} onChange={() => setSelectionMode('all')} />
              <span>Use all available list items</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={selectionMode === 'specific'} onChange={() => setSelectionMode('specific')} />
              <span>Choose specific list items</span>
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={includeCompleted} onChange={(event) => setIncludeCompleted(event.target.checked)} />
              <span>Include completed items</span>
            </label>
            <div className="text-[11px] text-muted-foreground">
              {selectedItemCount} item{selectedItemCount === 1 ? '' : 's'} will be sent to the assistant.
            </div>
          </div>

          {selectionMode === 'specific' ? (
            <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-border/70 bg-background p-2">
              {availableItems.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">No available items. Enable completed items or add new list items.</div>
              ) : availableItems.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.includes(item.id)}
                    onChange={(event) => {
                      setSelectedIds((current) => (
                        event.target.checked
                          ? Array.from(new Set([...current, item.id]))
                          : current.filter((id) => id !== item.id)
                      ));
                    }}
                  />
                  <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words', item.completed && 'text-muted-foreground line-through')}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <div className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} />
              <span>Use list context</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeWorkItemName} onChange={(event) => setIncludeWorkItemName(event.target.checked)} />
              <span>Include work item name</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeListName} onChange={(event) => setIncludeListName(event.target.checked)} />
              <span>Include list name</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeAssignee} onChange={(event) => setIncludeAssignee(event.target.checked)} />
              <span>Include assignees</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeDueDate} onChange={(event) => setIncludeDueDate(event.target.checked)} />
              <span>Include due dates</span>
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Extra instruction for prompt generation</span>
            <textarea
              value={extraInstruction}
              onChange={(event) => setExtraInstruction(event.target.value)}
              className="min-h-20 resize-y rounded-md border border-input bg-background px-2 py-2 text-xs leading-relaxed"
              placeholder="Optional. Tell the assistant how to shape the generated prompt, for example: make it concise, target a React component, include acceptance criteria, or ask the AI to compare options."
            />
          </label>

          {generatedPrompt ? (
            <div className="grid gap-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Generated prompt</span>
                <textarea
                  value={generatedPrompt}
                  onChange={(event) => setGeneratedPrompt(event.target.value)}
                  className="min-h-48 resize-y rounded-md border border-input bg-background px-2 py-2 text-xs leading-relaxed"
                />
              </label>
              {onSavePromptAsNote ? (
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Note title</span>
                  <input
                    value={noteTitle}
                    onChange={(event) => setNoteTitle(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="Note title"
                />
              </label>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</div>
          ) : null}
          {notice ? (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] text-primary">{notice}</div>
          ) : null}
          </div>

          <div className="shrink-0 border-t border-border/70 bg-popover px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" size="sm" className="h-8 justify-center text-xs" onClick={() => void generate()} disabled={busy || !canGeneratePrompt}>
                {busy ? 'Generating...' : generatedPrompt ? 'Regenerate prompt' : 'Generate prompt'}
              </Button>
              {generatedPrompt ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => void copyGeneratedPrompt()}>
                    <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </Button>
                  {(onInsertPrompt || activePromptTarget) ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={insertGeneratedPrompt}>
                      {activePromptTarget?.mode === 'build' ? 'Insert into Build prompt' : activePromptTarget?.mode === 'chat' ? 'Insert into Chat prompt' : 'Insert into prompt'}
                    </Button>
                  ) : null}
                  {onSavePromptAsNote ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={saveGeneratedPromptAsNote}>
                      Save as note
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ChecklistListProgressBadge({ progress }: { progress: { done: number; total: number; percent: number } }) {
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center rounded-md border border-border/70 bg-muted/50 px-2 text-[10px] font-medium text-muted-foreground"
      title={`${progress.percent}% complete - ${progress.done}/${progress.total} item${progress.total === 1 ? '' : 's'}`}
    >
      {progress.percent}% · {progress.done}/{progress.total}
    </span>
  );
}

type NotePromptButtonProps = {
  note: UsageProjectWorkItemNote;
  workItemTitle?: string;
  agentId?: string | null;
  onInsertPrompt?: (prompt: string) => void;
  onSavePromptAsNote?: (title: string, prompt: string) => void;
  className?: string;
};

export function NotePromptButton({
  note,
  workItemTitle,
  agentId,
  onInsertPrompt,
  onSavePromptAsNote,
  className,
}: NotePromptButtonProps) {
  const api = getAccomplish();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<ChecklistListPromptPurpose>('build');
  const [customPurpose, setCustomPurpose] = useState('');
  const [includeWorkItemName, setIncludeWorkItemName] = useState(false);
  const [includeNoteTitle, setIncludeNoteTitle] = useState(true);
  const [extraInstruction, setExtraInstruction] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [noteSaveTitle, setNoteSaveTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePromptTarget, setActivePromptTarget] = useState<PromptInsertionTarget | null>(() => getActivePromptInsertionTarget());

  const noteHtml = useMemo(() => richNoteHtml(note), [note.html, note.id, note.text]);
  const noteText = useMemo(() => {
    const plain = String(note.text || '').trim();
    return plain || richNotePlainText(noteHtml).trim();
  }, [note.text, noteHtml]);
  const canGeneratePrompt = Boolean(noteText || noteHtml);

  useEffect(() => {
    if (!open) return;
    setPurpose('build');
    setCustomPurpose('');
    setIncludeWorkItemName(false);
    setIncludeNoteTitle(true);
    setExtraInstruction('');
    setGeneratedPrompt('');
    setNoteSaveTitle(`Prompt - ${note.title || 'Note'}`);
    setError(null);
    setNotice(null);
  }, [note.id, open]);

  useEffect(() => subscribePromptInsertionTarget(setActivePromptTarget), []);

  const generate = async () => {
    if (!canGeneratePrompt) {
      setError('Add note content before generating a prompt.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: WorkItemNotePromptGenerateRequest = {
        agentId: agentId || undefined,
        purpose,
        customPurpose: purpose === 'custom' ? customPurpose : undefined,
        workItemTitle: workItemTitle || undefined,
        noteTitle: note.title || undefined,
        noteText,
        noteHtml,
        extraInstruction: extraInstruction.trim() || undefined,
        includeWorkItemName,
        includeNoteTitle,
      };
      let result;
      try {
        result = await api.generateWorkItemNotePrompt(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("No handler registered for 'settings-assistant:note-prompt:generate'")) {
          throw err;
        }
        const fallbackQuestion = [
          'Generate one directly usable prompt from this project work item note.',
          'This is not a skill configuration request. Return only the prompt text.',
          'The user will paste the prompt into Chat mode or Build mode. Infer what the AI should do from the note.',
          ...(payload.extraInstruction
            ? [
              '',
              'HIGH-PRIORITY USER EXTRA INSTRUCTION:',
              payload.extraInstruction,
              '',
              'This is mandatory. Shape the generated prompt so it follows the high-priority user extra instruction.',
              'If the note content and the extra instruction seem to pull in different directions, follow the extra instruction and adapt the note content around it.',
            ]
            : []),
          '',
          'Note prompt request data (JSON):',
          JSON.stringify(payload, null, 2),
          ...(payload.extraInstruction
            ? [
              '',
              'Final compliance check before answering:',
              `- Does the generated prompt clearly follow this extra instruction: "${payload.extraInstruction}"?`,
              '- If not, rewrite the generated prompt before returning it.',
            ]
            : []),
        ].join('\n');
        const fallback = await api.askUserSkillAssistant({
          question: fallbackQuestion,
          mode: 'general',
          agentId: agentId || undefined,
        });
        result = {
          ok: Boolean(fallback.ok && fallback.answer.trim()),
          prompt: fallback.answer.trim(),
          model: fallback.model,
          error: fallback.error,
        };
      }
      if (!result.ok || !result.prompt.trim()) {
        throw new Error(result.error || 'The Settings Assistant did not return a prompt.');
      }
      setGeneratedPrompt(result.prompt);
      setNotice('Prompt generated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate prompt.');
    } finally {
      setBusy(false);
    }
  };

  const copyGeneratedPrompt = async () => {
    const text = generatedPrompt.trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setNotice('Copied.');
  };

  const insertGeneratedPrompt = () => {
    const text = generatedPrompt.trim();
    if (!text) return;
    if (onInsertPrompt) {
      onInsertPrompt(text);
      setNotice('Inserted into prompt.');
      return;
    }
    if (insertIntoActivePrompt(text)) {
      setNotice(`Inserted into ${activePromptTarget?.label || 'prompt'}.`);
    } else {
      setError('No active Chat or Build prompt input is available.');
    }
  };

  const saveGeneratedPromptAsNote = () => {
    const text = generatedPrompt.trim();
    if (!text || !onSavePromptAsNote) return;
    onSavePromptAsNote(noteSaveTitle.trim() || `Prompt - ${note.title || 'Note'}`, text);
    setNotice('Saved as note.');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-7 w-7 shrink-0 rounded bg-muted p-0 text-muted-foreground hover:text-foreground', className)}
          title="Generate a prompt from this note."
          aria-label="Generate prompt from this note"
        >
          <MessageSquareText className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={24}
        sticky="always"
        hideWhenDetached={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(560px,calc(100vw-2rem))] overflow-hidden p-0"
        style={{
          zIndex: 2147483647,
          maxHeight: 'min(720px, var(--radix-popover-content-available-height, calc(100vh - 2rem)))',
        }}
      >
        <div
          className="flex flex-col overflow-hidden text-xs"
          style={{ maxHeight: 'min(720px, var(--radix-popover-content-available-height, calc(100vh - 2rem)))' }}
        >
          <div className="shrink-0 border-b border-border/70 bg-popover px-3 py-2.5">
            <div className="font-semibold text-foreground">Generate prompt from note</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Uses the Settings Assistant AI to infer a runnable prompt from this note.
            </p>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Prompt type</span>
                <select
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value as ChecklistListPromptPurpose)}
                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {PROMPT_PURPOSE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              {purpose === 'custom' ? (
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Custom type</span>
                  <input
                    value={customPurpose}
                    onChange={(event) => setCustomPurpose(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="e.g. turn into acceptance criteria"
                  />
                </label>
              ) : null}
            </div>

            <div className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeNoteTitle} onChange={(event) => setIncludeNoteTitle(event.target.checked)} />
                <span>Include note title</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={includeWorkItemName} onChange={(event) => setIncludeWorkItemName(event.target.checked)} />
                <span>Include work item name</span>
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Extra instruction for prompt generation</span>
              <textarea
                value={extraInstruction}
                onChange={(event) => setExtraInstruction(event.target.value)}
                className="min-h-20 resize-y rounded-md border border-input bg-background px-2 py-2 text-xs leading-relaxed"
                placeholder="Optional. Tell the assistant how to infer the prompt from this note, for example: make it a Build task, ask for a client-ready summary, or include acceptance criteria."
              />
            </label>

            <div className="rounded-md border border-border/70 bg-muted/20 p-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Note preview</div>
              <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                {noteText || 'No note text.'}
              </div>
            </div>

            {generatedPrompt ? (
              <div className="grid gap-2">
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Generated prompt</span>
                  <textarea
                    value={generatedPrompt}
                    onChange={(event) => setGeneratedPrompt(event.target.value)}
                    className="min-h-48 resize-y rounded-md border border-input bg-background px-2 py-2 text-xs leading-relaxed"
                  />
                </label>
                {onSavePromptAsNote ? (
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">New note title</span>
                    <input
                      value={noteSaveTitle}
                      onChange={(event) => setNoteSaveTitle(event.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      placeholder="Generated prompt note title"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</div>
            ) : null}
            {notice ? (
              <div className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] text-primary">{notice}</div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border/70 bg-popover px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" size="sm" className="h-8 justify-center text-xs" onClick={() => void generate()} disabled={busy || !canGeneratePrompt}>
                {busy ? 'Generating...' : generatedPrompt ? 'Regenerate prompt' : 'Generate prompt'}
              </Button>
              {generatedPrompt ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => void copyGeneratedPrompt()}>
                    <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </Button>
                  {(onInsertPrompt || activePromptTarget) ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={insertGeneratedPrompt}>
                      {activePromptTarget?.mode === 'build' ? 'Insert into Build prompt' : activePromptTarget?.mode === 'chat' ? 'Insert into Chat prompt' : 'Insert into prompt'}
                    </Button>
                  ) : null}
                  {onSavePromptAsNote ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={saveGeneratedPromptAsNote}>
                      Save as note
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type NoteToPromptButtonProps = {
  note: UsageProjectWorkItemNote;
  onInsertPrompt?: (prompt: string) => void;
  className?: string;
};

export function NoteToPromptButton({ note, onInsertPrompt, className }: NoteToPromptButtonProps) {
  const [activePromptTarget, setActivePromptTarget] = useState<PromptInsertionTarget | null>(() => getActivePromptInsertionTarget());
  const [inserted, setInserted] = useState(false);
  const noteHtml = useMemo(() => richNoteHtml(note), [note.html, note.id, note.text]);
  const noteText = useMemo(() => {
    const plain = String(note.text || '').trim();
    return plain || richNotePlainText(noteHtml).trim();
  }, [note.text, noteHtml]);
  const notePromptText = useMemo(() => {
    const title = String(note.title || '').trim();
    if (title && noteText) return `${title}\n\n${noteText}`;
    return title || noteText;
  }, [note.title, noteText]);
  const canInsert = Boolean(notePromptText && (onInsertPrompt || activePromptTarget));

  useEffect(() => subscribePromptInsertionTarget(setActivePromptTarget), []);

  const insertNoteIntoPrompt = () => {
    const text = notePromptText.trim();
    if (!text) return;
    if (onInsertPrompt) {
      onInsertPrompt(text);
    } else {
      insertIntoActivePrompt(text);
    }
    setInserted(true);
    window.setTimeout(() => setInserted(false), 1400);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-7 w-7 shrink-0 rounded bg-muted p-0 text-muted-foreground hover:text-foreground', inserted && 'border-primary/60 text-primary', className)}
      title={canInsert ? `Copy note into ${activePromptTarget?.label || 'prompt'}` : 'Open a Chat or Build prompt to copy this note into it.'}
      aria-label="Copy note into prompt"
      disabled={!canInsert}
      onClick={insertNoteIntoPrompt}
    >
      <ArrowRight className="h-3 w-3" />
    </Button>
  );
}

function itemChecklistProgress(item: UsageProjectWorkItem): { done: number; total: number; percent: number } {
  return checklistProgress(flattenChecklistLists(getChecklistListsFromItem(item)));
}

function priorityTone(priority: UsageProjectPriority): string {
  if (priority === 'urgent') return 'border-red-500/40 bg-red-500/10 text-red-300';
  if (priority === 'high') return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
  if (priority === 'low') return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
  return 'border-blue-500/40 bg-blue-500/10 text-blue-300';
}

function isOverdue(item: UsageProjectWorkItem): boolean {
  if (!item.dueDate || item.completedAt || item.archived) return false;
  const due = new Date(item.dueDate).getTime();
  return Number.isFinite(due) && due < Date.now();
}

function itemSearchText(item: UsageProjectWorkItem, source?: WorkboardSourceOption): string {
  return [
    item.title,
    item.description,
    item.sourceType,
    source?.label,
    source?.detail,
    item.priority,
    item.tags.join(' '),
    item.blockedReason,
  ].join(' ').toLowerCase();
}

function createDraft(projectId: string, statusId: string, color = '#3b82f6'): WorkItemDraft {
  return {
    title: '',
    description: '',
    color,
    sourceType: 'manual',
    sourceId: '',
    statusId,
    priority: 'normal',
    assigneeIds: [],
    startDate: '',
    dueDate: '',
    completedAt: '',
    blocked: false,
    blockedReason: '',
    tagsText: '',
    checklist: [],
    checklistLists: [],
    notes: [],
    drawings: [],
    documents: [],
    sources: [],
    archived: false,
    newListName: '',
    newChecklistTextByListId: {},
    newNoteTitle: '',
    newNoteText: '',
    newDocumentLabel: '',
    newDocumentUrl: '',
    newSourceTitle: '',
    newSourceUrl: '',
    newSourceDescription: '',
  };
}

function draftFromItem(item: UsageProjectWorkItem): WorkItemDraft {
  const checklistLists = getChecklistListsFromItem(item);
  return {
    id: item.id,
    title: item.title,
    description: item.description || '',
    color: item.color || '#3b82f6',
    sourceType: item.sourceType,
    sourceId: item.sourceId || '',
    statusId: item.statusId,
    priority: item.priority,
    assigneeIds: item.assigneeIds || [],
    startDate: toDateInput(item.startDate),
    dueDate: toDateInput(item.dueDate),
    completedAt: toDateInput(item.completedAt),
    blocked: item.blocked,
    blockedReason: item.blockedReason || '',
    tagsText: item.tags.join(', '),
    checklist: item.checklist || flattenChecklistLists(checklistLists),
    checklistLists,
    notes: item.notes || [],
    drawings: item.drawings || [],
    documents: item.documents || [],
    sources: item.sources || [],
    archived: item.archived,
    newListName: '',
    newChecklistTextByListId: {},
    newNoteTitle: '',
    newNoteText: '',
    newDocumentLabel: '',
    newDocumentUrl: '',
    newSourceTitle: '',
    newSourceUrl: '',
    newSourceDescription: '',
  };
}

function WorkboardAssigneePicker({
  assignees,
  value,
  onChange,
}: {
  assignees: UsageAssignee[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = new Set(value);
  return (
    <div className="max-h-28 overflow-y-auto rounded-md border border-border bg-background p-2">
      {assignees.length === 0 ? (
        <div className="text-xs text-muted-foreground">No assignees yet.</div>
      ) : assignees.map((assignee) => (
        <label key={assignee.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
          <input
            type="checkbox"
            checked={selected.has(assignee.id)}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(assignee.id);
              else next.delete(assignee.id);
              onChange(Array.from(next));
            }}
          />
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: assignee.color || '#2dd4bf' }} />
          <span className="truncate">{assignee.name}</span>
        </label>
      ))}
    </div>
  );
}

const RICH_NOTE_ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);
const RICH_NOTE_DROP_TAGS = new Set(['embed', 'iframe', 'link', 'meta', 'object', 'script', 'style']);
const RICH_NOTE_HTML_MAX_LENGTH = 300_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToNoteHtml(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => `<p>${line ? escapeHtml(line) : '<br>'}</p>`).join('');
}

function sanitizeRichNoteHtml(rawHtml: string): string {
  if (!rawHtml.trim()) return '';
  if (typeof DOMParser === 'undefined') return escapeHtml(rawHtml).slice(0, RICH_NOTE_HTML_MAX_LENGTH);
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${rawHtml}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const sanitizeNode = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      if (RICH_NOTE_DROP_TAGS.has(tagName)) {
        element.remove();
        continue;
      }
      if (!RICH_NOTE_ALLOWED_TAGS.has(tagName)) {
        const parent = element.parentNode;
        if (!parent) continue;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        parent.removeChild(element);
        continue;
      }

      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (tagName === 'a' && name === 'href' && /^(https?:\/\/|mailto:|file:\/\/|[a-zA-Z]:\\|\\\\)/.test(value)) {
          element.setAttribute('rel', 'noreferrer');
          continue;
        }
        if ((tagName === 'td' || tagName === 'th') && (name === 'colspan' || name === 'rowspan') && /^\d{1,2}$/.test(value)) {
          continue;
        }
        element.removeAttribute(attribute.name);
      }
      sanitizeNode(element);
    }
  };

  sanitizeNode(root);
  return root.innerHTML.trim().slice(0, RICH_NOTE_HTML_MAX_LENGTH);
}

function richNoteHtml(note: UsageProjectWorkItemNote): string {
  return sanitizeRichNoteHtml(note.html || plainTextToNoteHtml(note.text));
}

function richNotePlainText(html: string): string {
  const sanitized = sanitizeRichNoteHtml(html);
  if (typeof DOMParser === 'undefined') {
    return sanitized
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '- ')
      .replace(/<\s*\/\s*li\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|h1|h2|h3|blockquote|tr)\s*>/gi, '\n')
      .replace(/<\s*\/\s*(td|th)\s*>/gi, '\t')
      .replace(/<\s*\/?\s*(ul|ol|table|tbody|thead|tfoot)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, '\t')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${sanitized}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'br') return '\n';
    if (tagName === 'table') {
      return `${Array.from(element.querySelectorAll('tr')).map((row) => (
        Array.from(row.children)
          .filter((cell) => cell.tagName.toLowerCase() === 'td' || cell.tagName.toLowerCase() === 'th')
          .map((cell) => richNotePlainText(cell.innerHTML))
          .join('\t')
      )).join('\n')}\n`;
    }

    const childText = Array.from(element.childNodes).map(readNode).join('');
    if (tagName === 'li') return `- ${childText.trim()}\n`;
    if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(tagName)) {
      return `${childText.trim()}\n`;
    }
    if (['ul', 'ol'].includes(tagName)) return `${childText}\n`;
    return childText;
  };

  return Array.from(root.childNodes).map(readNode).join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, '\t')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type WorkboardListCsvCandidate = {
  id: string;
  workItemTitle: string;
  list: UsageProjectWorkItemChecklistList;
};

export type WorkboardNoteCsvCandidate = {
  id: string;
  workItemTitle: string;
  note: UsageProjectWorkItemNote;
};

function csvEscape(value: unknown): string {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvDocument(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`;
}

function csvFilenameTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function csvFileSlug(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 32)
    || 'workboard';
}

function noteTitleForCsv(note: UsageProjectWorkItemNote): string {
  return String(note.title || '').trim() || 'Untitled note';
}

function listCandidateLabel(candidate: WorkboardListCsvCandidate): string {
  return `${candidate.workItemTitle} / ${candidate.list.name || 'Checklist'}`;
}

function noteCandidateLabel(candidate: WorkboardNoteCsvCandidate): string {
  return `${candidate.workItemTitle} / ${noteTitleForCsv(candidate.note)}`;
}

function buildListsCsv(
  candidates: WorkboardListCsvCandidate[],
  resolveAssigneeNames: (assigneeIds?: string[]) => string[]
): string {
  const rows: unknown[][] = [[
    'Work item',
    'List',
    'List context',
    'Item',
    'Completed',
    'Assignees',
    'Due date',
    'List created',
    'List updated',
    'Item created',
    'Item updated',
  ]];
  for (const candidate of candidates) {
    const list = candidate.list;
    if (list.items.length === 0) {
      rows.push([
        candidate.workItemTitle,
        list.name || 'Checklist',
        list.context || '',
        '',
        '',
        '',
        '',
        list.createdAt,
        list.updatedAt || '',
        '',
        '',
      ]);
      continue;
    }
    for (const item of list.items) {
      rows.push([
        candidate.workItemTitle,
        list.name || 'Checklist',
        list.context || '',
        item.text,
        item.completed ? 'Yes' : 'No',
        resolveAssigneeNames(item.assigneeIds).join('; '),
        item.dueDate || '',
        list.createdAt,
        list.updatedAt || '',
        item.createdAt,
        item.updatedAt || '',
      ]);
    }
  }
  return csvDocument(rows);
}

function buildNotesCsv(candidates: WorkboardNoteCsvCandidate[]): string {
  const noteTextForCsv = (note: UsageProjectWorkItemNote): string => {
    const text = (richNotePlainText(richNoteHtml(note)) || note.text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' | ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return text;
  };

  const rows: unknown[][] = [[
    'Work item',
    'Note title',
    'Note text',
    'Created',
    'Updated',
  ]];
  for (const candidate of candidates) {
    const note = candidate.note;
    rows.push([
      candidate.workItemTitle,
      noteTitleForCsv(note),
      noteTextForCsv(note),
      note.createdAt,
      note.updatedAt || '',
    ]);
  }
  return csvDocument(rows);
}

export function CsvExportPicker({
  type,
  candidates,
  filenameScope,
  resolveAssigneeNames,
  className,
}: {
  type: 'lists' | 'notes';
  candidates: Array<WorkboardListCsvCandidate | WorkboardNoteCsvCandidate>;
  filenameScope: string;
  resolveAssigneeNames?: (assigneeIds?: string[]) => string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => candidates.map((candidate) => candidate.id));
  const [notice, setNotice] = useState('');
  const availableIds = useMemo(() => new Set(candidates.map((candidate) => candidate.id)), [candidates]);
  const selectedCandidates = candidates.filter((candidate) => selectedIds.includes(candidate.id));
  const allSelected = candidates.length > 0 && selectedCandidates.length === candidates.length;
  const noun = type === 'lists' ? 'lists' : 'notes';

  useEffect(() => {
    setSelectedIds((current) => {
      const kept = current.filter((id) => availableIds.has(id));
      const next = kept.length > 0 ? kept : candidates.map((candidate) => candidate.id);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [availableIds, candidates]);

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : candidates.map((candidate) => candidate.id));
  };

  const toggleId = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  };

  const exportCsv = async () => {
    if (selectedCandidates.length === 0) {
      setNotice(`Choose at least one ${type === 'lists' ? 'list' : 'note'} to export.`);
      return;
    }
    try {
      const csv = type === 'lists'
        ? buildListsCsv(selectedCandidates as WorkboardListCsvCandidate[], resolveAssigneeNames || (() => []))
        : buildNotesCsv(selectedCandidates as WorkboardNoteCsvCandidate[]);
      const result = await getAccomplish().saveTextToFileAs(csv, {
        baseName: `${csvFileSlug(filenameScope)}-${noun}-${csvFilenameTimestamp()}`,
        extension: 'csv',
        title: `Export ${type === 'lists' ? 'lists' : 'notes'} CSV`,
      });
      if (result.cancelled) {
        setNotice('Export cancelled.');
        return;
      }
      setNotice(result.filePath ? `CSV saved: ${result.filePath}` : 'CSV saved.');
      window.setTimeout(() => setNotice(''), 5000);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `Unable to export ${noun}.`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-8 gap-1.5 px-2 text-xs', className)}
          disabled={candidates.length === 0}
          title={candidates.length === 0 ? `No ${noun} to export.` : `Choose ${noun} to export as CSV.`}
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3" style={{ zIndex: 2147483647 }}>
        <div className="grid gap-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Export {type === 'lists' ? 'lists' : 'notes'} to CSV</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Choose which {noun} to include, then select where to save the CSV file.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>Select all</span>
            </label>
            <span className="text-[11px] text-muted-foreground">{selectedCandidates.length} of {candidates.length}</span>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {candidates.map((candidate) => {
              const label = type === 'lists'
                ? listCandidateLabel(candidate as WorkboardListCsvCandidate)
                : noteCandidateLabel(candidate as WorkboardNoteCsvCandidate);
              const detail = type === 'lists'
                ? `${(candidate as WorkboardListCsvCandidate).list.items.length} item${(candidate as WorkboardListCsvCandidate).list.items.length === 1 ? '' : 's'}`
                : new Date((candidate as WorkboardNoteCsvCandidate).note.createdAt).toLocaleString();
              return (
                <label key={candidate.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/40">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.includes(candidate.id)}
                    onChange={() => toggleId(candidate.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground" title={label}>{label}</span>
                    <span className="block text-[11px] text-muted-foreground">{detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void exportCsv()} disabled={selectedCandidates.length === 0}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
          {notice ? (
            <div className={cn(
              'rounded-md border px-2 py-1.5 text-[11px]',
              /saved/i.test(notice)
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            )}>
              {notice}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function clipboardHtmlDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${sanitizeRichNoteHtml(html)}</body></html>`;
}

function basenameForPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

export function labelForDocumentTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Document';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.hostname.replace(/^www\./, '') || 'Document link';
    } catch {
      return 'Document link';
    }
  }
  return basenameForPath(trimmed) || 'Local document';
}

export function targetForDocumentLink(documentLink: UsageProjectWorkItemDocumentLink): string {
  return documentLink.kind === 'url' ? documentLink.url || '' : documentLink.path || '';
}

export function attachDocumentLinkToActivePrompt(documentLink: UsageProjectWorkItemDocumentLink): { ok: boolean; message: string } {
  const target = targetForDocumentLink(documentLink).trim();
  const label = documentLink.label.trim() || labelForDocumentTarget(target);
  if (!target) return { ok: false, message: 'This document does not have a saved path or link.' };

  if (documentLink.kind === 'local') {
    const attachmentTarget = getActivePromptAttachmentTarget();
    if (!attachmentTarget) return { ok: false, message: 'Open a Chat or Build prompt first.' };
    if (!attachFilesToActivePrompt([target])) {
      return { ok: false, message: 'No active Chat or Build prompt is available.' };
    }
    return { ok: true, message: `Attached "${label}" to ${attachmentTarget.label}.` };
  }

  const insertionTarget = getActivePromptInsertionTarget();
  if (!insertionTarget) return { ok: false, message: 'Open a Chat or Build prompt first.' };
  const linkText = `[${label}](${target})`;
  if (!insertIntoActivePrompt(linkText)) {
    return { ok: false, message: 'No active Chat or Build prompt is available.' };
  }
  return { ok: true, message: `Inserted "${label}" into ${insertionTarget.label}.` };
}

const RICH_NOTE_EDITOR_CONTENT_CLASS = 'min-h-20 rounded-md border border-input bg-background px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-ring [&_blockquote]:border-l-2 [&_blockquote]:border-primary/60 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-1 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-2 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:min-w-20 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:min-w-20 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_ul]:list-disc';

function clampRichNoteTableDimension(value: number): number {
  return Math.max(1, Math.min(12, Math.round(Number.isFinite(value) ? value : 3)));
}

function createRichNoteTableHtml(rows: number, columns: number): string {
  const rowCount = clampRichNoteTableDimension(rows);
  const columnCount = clampRichNoteTableDimension(columns);
  const header = `<tr>${Array.from({ length: columnCount }, (_, index) => `<th>Header ${index + 1}</th>`).join('')}</tr>`;
  const body = Array.from({ length: Math.max(1, rowCount - 1) }, () => (
    `<tr>${Array.from({ length: columnCount }, () => '<td><br></td>').join('')}</tr>`
  )).join('');
  return `<table><thead>${header}</thead><tbody>${body}</tbody></table><p><br></p>`;
}

function selectionBelongsToElement(editor: HTMLElement, range: Range): boolean {
  return editor.contains(range.startContainer) && editor.contains(range.endContainer);
}

function findRichNoteSelectedTableCell(editor: HTMLElement, savedRange: Range | null): HTMLTableCellElement | null {
  const selection = window.getSelection();
  let range: Range | null = null;
  if (selection?.rangeCount) {
    const selectedRange = selection.getRangeAt(0);
    if (selectionBelongsToElement(editor, selectedRange)) {
      range = selectedRange;
    }
  }
  if (!range && savedRange && selectionBelongsToElement(editor, savedRange)) {
    range = savedRange;
  }
  let node: Node | null = range?.startContainer || null;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === 'TD' || element.tagName === 'TH') {
        return element as HTMLTableCellElement;
      }
    }
    node = node.parentNode;
  }
  return null;
}

export function RichWorkItemNoteEditor({
  note,
  workItemTitle,
  agentId,
  onInsertPrompt,
  onSavePromptAsNote,
  onChange,
  onDelete,
}: {
  note: UsageProjectWorkItemNote;
  workItemTitle?: string;
  agentId?: string | null;
  onInsertPrompt?: (prompt: string) => void;
  onSavePromptAsNote?: (title: string, prompt: string) => void;
  onChange: (note: UsageProjectWorkItemNote) => void;
  onDelete: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const popoutEditorRef = useRef<HTMLDivElement>(null);
  const popoutPanelRef = useRef<HTMLDivElement>(null);
  const popoutScrollRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [popoutFullscreen, setPopoutFullscreen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const overlayPortalTarget = useContext(WorkboardOverlayPortalContext);
  const currentHtml = useMemo(() => richNoteHtml(note), [note.html, note.id, note.text]);
  const noteTitle = note.title || '';

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== currentHtml) editor.innerHTML = currentHtml;
  }, [currentHtml]);

  useEffect(() => {
    const editor = popoutEditorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== currentHtml) editor.innerHTML = currentHtml;
  }, [currentHtml, popoutOpen]);

  useEffect(() => {
    if (!popoutOpen) return;
    window.requestAnimationFrame(() => popoutScrollRef.current?.scrollTo({ top: 0, left: 0 }));
  }, [popoutOpen, popoutFullscreen]);

  useEffect(() => {
    if (!popoutOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.body.dataset.workboardNotePopoutOpen = 'true';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopoutOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => popoutPanelRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      if (document.body.dataset.workboardNotePopoutOpen === 'true') {
        delete document.body.dataset.workboardNotePopoutOpen;
      }
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [popoutOpen]);

  const saveSelectionForEditor = (editor: HTMLDivElement | null) => {
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (selectionBelongsToElement(editor, range)) {
      savedSelectionRef.current = range.cloneRange();
    }
  };

  const restoreSelectionForEditor = (editor: HTMLDivElement | null) => {
    if (!editor || !savedSelectionRef.current || !selectionBelongsToElement(editor, savedSelectionRef.current)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedSelectionRef.current);
  };

  const updateFromEditor = (editor: HTMLDivElement | null) => {
    const html = sanitizeRichNoteHtml(editor?.innerHTML || '');
    onChange({
      ...note,
      text: richNotePlainText(html),
      html: html || undefined,
      updatedAt: nowIso(),
    });
  };

  const runCommand = (targetRef: React.RefObject<HTMLDivElement | null>, command: string, value?: string) => {
    const editor = targetRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelectionForEditor(editor);
    document.execCommand(command, false, value);
    saveSelectionForEditor(editor);
    updateFromEditor(editor);
  };

  const copyRichNote = async (targetRef?: React.RefObject<HTMLDivElement | null>) => {
    const html = sanitizeRichNoteHtml(targetRef?.current?.innerHTML || editorRef.current?.innerHTML || currentHtml);
    const titleHtml = noteTitle.trim() ? `<h2>${escapeHtml(noteTitle.trim())}</h2>` : '';
    const copyHtml = sanitizeRichNoteHtml(`${titleHtml}${html}`);
    const plainBody = richNotePlainText(html).replace(/\u00a0/g, ' ');
    const plainText = noteTitle.trim() ? `${noteTitle.trim()}\n\n${plainBody}` : plainBody;
    try {
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([clipboardHtmlDocument(copyHtml)], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(plainText);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(plainText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    }
  };

  const toolbarButtonClass = 'h-7 w-7 rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';
  const toolbarTextButtonClass = 'h-7 rounded border border-border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';

  const insertTable = (targetRef: React.RefObject<HTMLDivElement | null>) => {
    const editor = targetRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelectionForEditor(editor);
    document.execCommand('insertHTML', false, createRichNoteTableHtml(tableRows, tableColumns));
    saveSelectionForEditor(editor);
    updateFromEditor(editor);
  };

  const mutateSelectedTable = (
    targetRef: React.RefObject<HTMLDivElement | null>,
    action: 'row-above' | 'row-below' | 'column-left' | 'column-right' | 'delete-row' | 'delete-column' | 'delete-table'
  ) => {
    const editor = targetRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelectionForEditor(editor);
    const cell = findRichNoteSelectedTableCell(editor, savedSelectionRef.current);
    const row = cell?.closest('tr') || null;
    const table = cell?.closest('table') || null;
    if (!cell || !row || !table) return;

    if (action === 'delete-table') {
      table.remove();
      updateFromEditor(editor);
      return;
    }

    const allRows = Array.from(table.querySelectorAll('tr'));
    const cellIndex = Array.from(row.children).indexOf(cell);
    const createCellForRow = (targetRow: HTMLTableRowElement): HTMLTableCellElement => {
      const useHeader = targetRow.closest('thead') !== null || targetRow.querySelector('th') !== null;
      const nextCell = document.createElement(useHeader ? 'th' : 'td') as HTMLTableCellElement;
      nextCell.innerHTML = '<br>';
      return nextCell;
    };

    if (action === 'row-above' || action === 'row-below') {
      const newRow = document.createElement('tr');
      const columnCount = Math.max(1, row.children.length);
      for (let index = 0; index < columnCount; index += 1) {
        newRow.appendChild(createCellForRow(row as HTMLTableRowElement));
      }
      if (action === 'row-above') row.parentNode?.insertBefore(newRow, row);
      else row.parentNode?.insertBefore(newRow, row.nextSibling);
    } else if (action === 'column-left' || action === 'column-right') {
      const insertAt = action === 'column-left' ? cellIndex : cellIndex + 1;
      allRows.forEach((targetRow) => {
        targetRow.insertBefore(createCellForRow(targetRow as HTMLTableRowElement), targetRow.children[insertAt] || null);
      });
    } else if (action === 'delete-row') {
      if (allRows.length <= 1) table.remove();
      else row.remove();
    } else if (action === 'delete-column') {
      const maxColumns = Math.max(...allRows.map((targetRow) => targetRow.children.length));
      if (maxColumns <= 1) table.remove();
      else {
        allRows.forEach((targetRow) => {
          targetRow.children[cellIndex]?.remove();
        });
      }
    }

    saveSelectionForEditor(editor);
    updateFromEditor(editor);
  };

  const renderToolbar = (targetRef: React.RefObject<HTMLDivElement | null>) => (
    <div className="mt-2 flex flex-wrap gap-1 rounded-md border border-border/60 bg-muted/20 p-1">
      <button type="button" className={toolbarButtonClass} title="Heading" onClick={() => runCommand(targetRef, 'formatBlock', '<h2>')}><Heading2 className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className={toolbarButtonClass} title="Paragraph" onClick={() => runCommand(targetRef, 'formatBlock', '<p>')}>P</button>
      <button type="button" className={toolbarButtonClass} title="Bold" onClick={() => runCommand(targetRef, 'bold')}><Bold className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className={toolbarButtonClass} title="Italic" onClick={() => runCommand(targetRef, 'italic')}><Italic className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className={toolbarButtonClass} title="Underline" onClick={() => runCommand(targetRef, 'underline')}><Underline className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className={toolbarButtonClass} title="Bullet list" onClick={() => runCommand(targetRef, 'insertUnorderedList')}><List className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className={toolbarButtonClass} title="Numbered list" onClick={() => runCommand(targetRef, 'insertOrderedList')}><ListOrdered className="mx-auto h-3.5 w-3.5" /></button>
      <button type="button" className={toolbarButtonClass} title="Quote" onClick={() => runCommand(targetRef, 'formatBlock', '<blockquote>')}><Quote className="mx-auto h-3.5 w-3.5" /></button>
      <div className="mx-1 h-7 w-px bg-border/70" />
      <label className="flex h-7 items-center gap-1 rounded border border-border bg-background px-1.5 text-[11px] text-muted-foreground">
        Rows
        <input
          type="number"
          min={1}
          max={12}
          value={tableRows}
          onChange={(event) => setTableRows(clampRichNoteTableDimension(Number(event.target.value)))}
          className="h-5 w-10 rounded border border-border bg-background px-1 text-foreground"
        />
      </label>
      <label className="flex h-7 items-center gap-1 rounded border border-border bg-background px-1.5 text-[11px] text-muted-foreground">
        Cols
        <input
          type="number"
          min={1}
          max={12}
          value={tableColumns}
          onChange={(event) => setTableColumns(clampRichNoteTableDimension(Number(event.target.value)))}
          className="h-5 w-10 rounded border border-border bg-background px-1 text-foreground"
        />
      </label>
      <button type="button" className={toolbarTextButtonClass} title="Insert a table at the cursor" onClick={() => insertTable(targetRef)}>
        <Columns3 className="mr-1 inline h-3.5 w-3.5" />
        Table
      </button>
      <button type="button" className={toolbarTextButtonClass} title="Add row above the current table cell" onClick={() => mutateSelectedTable(targetRef, 'row-above')}>Row above</button>
      <button type="button" className={toolbarTextButtonClass} title="Add row below the current table cell" onClick={() => mutateSelectedTable(targetRef, 'row-below')}>Row below</button>
      <button type="button" className={toolbarTextButtonClass} title="Add column left of the current table cell" onClick={() => mutateSelectedTable(targetRef, 'column-left')}>Col left</button>
      <button type="button" className={toolbarTextButtonClass} title="Add column right of the current table cell" onClick={() => mutateSelectedTable(targetRef, 'column-right')}>Col right</button>
      <button type="button" className={toolbarTextButtonClass} title="Delete the current table row" onClick={() => mutateSelectedTable(targetRef, 'delete-row')}>Delete row</button>
      <button type="button" className={toolbarTextButtonClass} title="Delete the current table column" onClick={() => mutateSelectedTable(targetRef, 'delete-column')}>Delete col</button>
      <button type="button" className={toolbarTextButtonClass} title="Delete the current table" onClick={() => mutateSelectedTable(targetRef, 'delete-table')}>Delete table</button>
    </div>
  );

  const renderEditable = (targetRef: React.RefObject<HTMLDivElement | null>, extraClassName = '') => (
    <div
      ref={targetRef}
      contentEditable
      suppressContentEditableWarning
      className={cn(RICH_NOTE_EDITOR_CONTENT_CLASS, extraClassName)}
      onInput={() => {
        saveSelectionForEditor(targetRef.current);
        updateFromEditor(targetRef.current);
      }}
      onBlur={() => updateFromEditor(targetRef.current)}
      onFocus={() => saveSelectionForEditor(targetRef.current)}
      onMouseUp={() => saveSelectionForEditor(targetRef.current)}
      onKeyUp={() => saveSelectionForEditor(targetRef.current)}
      onPaste={(event) => {
        event.preventDefault();
        const html = event.clipboardData.getData('text/html');
        const text = event.clipboardData.getData('text/plain');
        targetRef.current?.focus();
        restoreSelectionForEditor(targetRef.current);
        document.execCommand('insertHTML', false, html ? sanitizeRichNoteHtml(html) : plainTextToNoteHtml(text));
        saveSelectionForEditor(targetRef.current);
        updateFromEditor(targetRef.current);
      }}
    />
  );

  const popoutSurface = (
    <div
      className={cn(
        'pointer-events-auto fixed z-[10000] overflow-hidden overscroll-contain bg-black/70',
        popoutFullscreen ? 'bottom-0 left-0 right-0 top-0' : 'inset-0 flex items-center justify-center p-4'
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Work item note"
      tabIndex={-1}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target) event.preventDefault();
      }}
      onTouchMove={(event) => {
        if (event.currentTarget === event.target) event.preventDefault();
      }}
    >
      <div
        ref={popoutPanelRef}
        tabIndex={-1}
        className={cn(
          'flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl',
          popoutFullscreen
            ? 'absolute bottom-2 left-2 right-2 top-2 h-auto w-auto max-h-none max-w-none'
            : 'max-h-[88vh] w-[min(980px,calc(100vw-2rem))]'
        )}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border p-3">
          <div className="min-w-0 flex-1">
            <label className="text-[10px] font-medium uppercase text-muted-foreground">Note title</label>
            <WorkItemNameTooltip value={noteTitle || 'Untitled note'}>
              <input
                value={noteTitle}
                onChange={(event) => onChange({ ...note, title: event.target.value, updatedAt: nowIso() })}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                placeholder="Untitled note"
              />
            </WorkItemNameTooltip>
            <div className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(note.createdAt)}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <WorkItemOutlineColorPicker
              value={note.outlineColor}
              onChange={(outlineColor) => onChange({ ...note, outlineColor, updatedAt: nowIso() })}
            />
            <NotePromptButton
              note={note}
              workItemTitle={workItemTitle}
              agentId={agentId}
              onInsertPrompt={onInsertPrompt}
              onSavePromptAsNote={onSavePromptAsNote}
            />
            <NoteToPromptButton note={note} onInsertPrompt={onInsertPrompt} />
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => setToolbarOpen((open) => !open)}>
              {toolbarOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Toolbar
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void copyRichNote(popoutEditorRef)}>
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" title={popoutFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => setPopoutFullscreen((value) => !value)}>
              {popoutFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Close note popout" onClick={() => setPopoutOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {toolbarOpen ? (
          <div className="shrink-0 border-b border-border bg-background px-3 pb-3">
            {renderToolbar(popoutEditorRef)}
          </div>
        ) : null}
        <div
          ref={popoutScrollRef}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 outline-none"
          onWheelCapture={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {renderEditable(popoutEditorRef, 'min-h-[60vh] text-sm')}
        </div>
      </div>
    </div>
  );

  const popout = popoutOpen
    ? overlayPortalTarget
      ? createPortal(popoutSurface, overlayPortalTarget)
      : popoutSurface
    : null;

  return (
    <div className="rounded border border-border/50 p-2 text-xs" style={workItemOutlineStyle(note.outlineColor)}>
      <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-2 rounded-t border-b border-border/40 bg-background/95 px-2 pb-2 pt-2 backdrop-blur">
        <div className="mb-2 grid gap-1">
          <label className="text-[10px] font-medium uppercase text-muted-foreground">Note title</label>
          <WorkItemNameTooltip value={noteTitle || 'Untitled note'}>
            <input
              value={noteTitle}
              onChange={(event) => onChange({ ...note, title: event.target.value, updatedAt: nowIso() })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              placeholder="Untitled note"
            />
          </WorkItemNameTooltip>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{formatDateTime(note.createdAt)}</span>
          <div className="flex items-center gap-1.5">
            <WorkItemOutlineColorPicker
              value={note.outlineColor}
              onChange={(outlineColor) => onChange({ ...note, outlineColor, updatedAt: nowIso() })}
              className="h-7 w-7"
            />
            <NotePromptButton
              note={note}
              workItemTitle={workItemTitle}
              agentId={agentId}
              onInsertPrompt={onInsertPrompt}
              onSavePromptAsNote={onSavePromptAsNote}
            />
            <NoteToPromptButton note={note} onInsertPrompt={onInsertPrompt} />
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => setToolbarOpen((open) => !open)}>
              {toolbarOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Toolbar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              title="Copy rich text for Word and plain text for apps such as Notepad"
              onClick={() => void copyRichNote()}
            >
              <ClipboardCopy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              title="Open this note in a larger editor"
              onClick={() => setPopoutOpen(true)}
            >
              <Maximize2 className="h-3 w-3" />
              Pop out
            </Button>
            <button type="button" className="px-1 hover:text-foreground" onClick={onDelete}>Delete</button>
          </div>
        </div>
        {toolbarOpen ? renderToolbar(editorRef) : null}
      </div>
      {renderEditable(editorRef)}
      {popout}
    </div>
  );
}

type DrawingTool = 'select' | UsageProjectWorkItemDrawingElementKind;
type DrawingResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';
type DrawingAttachNotice = { kind: 'success' | 'error'; text: string };
const DRAWING_LINE_STYLES: UsageProjectWorkItemDrawingLineStyle[] = ['solid', 'dashed', 'dotted'];
const DRAWING_STROKE_WIDTH_PRESETS = [
  { label: 'Thin', value: 1 },
  { label: 'Regular', value: 2 },
  { label: 'Thick', value: 4 },
  { label: 'Heavy', value: 8 },
];

function drawingStrokeDasharray(style?: UsageProjectWorkItemDrawingLineStyle, strokeWidth = 2): string | undefined {
  if (style === 'dashed') return `${Math.max(4, strokeWidth * 4)} ${Math.max(3, strokeWidth * 2.5)}`;
  if (style === 'dotted') return `${Math.max(1, strokeWidth)} ${Math.max(3, strokeWidth * 2.5)}`;
  return undefined;
}

export function createWorkItemDrawing(title = 'Drawing', outlineColor?: string): UsageProjectWorkItemDrawing {
  return {
    id: localId(),
    title,
    width: 640,
    height: 360,
    elements: [],
    outlineColor,
    createdAt: nowIso(),
  };
}

function trianglePoints(element: UsageProjectWorkItemDrawingElement): string {
  const left = Math.min(element.x1, element.x2);
  const right = Math.max(element.x1, element.x2);
  const top = Math.min(element.y1, element.y2);
  const bottom = Math.max(element.y1, element.y2);
  return `${(left + right) / 2},${top} ${right},${bottom} ${left},${bottom}`;
}

function elementBox(element: UsageProjectWorkItemDrawingElement): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
  const left = Math.min(element.x1, element.x2);
  const right = Math.max(element.x1, element.x2);
  const top = Math.min(element.y1, element.y2);
  const bottom = Math.max(element.y1, element.y2);
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function drawingSvgMarkup(drawing: UsageProjectWorkItemDrawing): string {
  const markerId = `arrow-${drawing.id}`;
  const elements = drawing.elements.map((element) => {
    const dash = drawingStrokeDasharray(element.strokeStyle, element.strokeWidth);
    const dashAttribute = dash ? ` stroke-dasharray="${dash}"` : '';
    const fillOpacity = Math.max(0, Math.min(1, element.fillOpacity ?? 1));
    const common = `stroke="${escapeHtml(element.stroke)}" stroke-width="${element.strokeWidth}"${dashAttribute} fill="${escapeHtml(element.fill)}" fill-opacity="${fillOpacity}"`;
    if (element.kind === 'rectangle') {
      const x = Math.min(element.x1, element.x2);
      const y = Math.min(element.y1, element.y2);
      return `<rect x="${x}" y="${y}" width="${Math.abs(element.x2 - element.x1)}" height="${Math.abs(element.y2 - element.y1)}" rx="8" ${common}/>`;
    }
    if (element.kind === 'ellipse') {
      return `<ellipse cx="${(element.x1 + element.x2) / 2}" cy="${(element.y1 + element.y2) / 2}" rx="${Math.abs(element.x2 - element.x1) / 2}" ry="${Math.abs(element.y2 - element.y1) / 2}" ${common}/>`;
    }
    if (element.kind === 'triangle') {
      return `<polygon points="${trianglePoints(element)}" ${common}/>`;
    }
    if (element.kind === 'text') {
      const box = elementBox(element);
      const fontSize = element.fontSize || 24;
      const textY = box.top + Math.min(Math.max(fontSize + 8, fontSize), Math.max(fontSize, box.height - 6));
      const borderStroke = element.stroke === 'transparent' || element.strokeWidth <= 0 ? 'none' : element.stroke;
      const borderStrokeWidth = borderStroke === 'none' ? 0 : Math.max(1, element.strokeWidth);
      const textDash = borderStroke === 'none' ? '' : dashAttribute;
      return `<g>
        <rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="6" fill="transparent" stroke="${escapeHtml(borderStroke)}" stroke-width="${borderStrokeWidth}"${textDash}/>
        <text x="${box.left + 8}" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${escapeHtml(element.fill || '#111827')}" fill-opacity="${fillOpacity}">${escapeHtml(element.text || 'Text')}</text>
      </g>`;
    }
    const marker = element.kind === 'arrow' ? ` marker-end="url(#${markerId})"` : '';
    return `<line x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${escapeHtml(element.stroke)}" stroke-width="${element.strokeWidth}"${dashAttribute} stroke-linecap="round"${marker}/>`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}">
  <defs>
    <marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/>
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${elements}
</svg>`;
}

function exportTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

function exportDrawingSvg(drawing: UsageProjectWorkItemDrawing) {
  const svg = drawingSvgMarkup(drawing);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const title = drawing.title.trim().replace(/[^\w.-]+/g, '_') || 'drawing';
  anchor.download = `${title}_${exportTimestamp()}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function drawingStrokeDashSegments(style?: UsageProjectWorkItemDrawingLineStyle, strokeWidth = 2): number[] {
  const dash = drawingStrokeDasharray(style, strokeWidth);
  return dash ? dash.split(' ').map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0) : [];
}

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(Math.max(0, radius), Math.abs(width) / 2, Math.abs(height) / 2);
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
}

function hasVisibleStroke(element: UsageProjectWorkItemDrawingElement): boolean {
  return element.stroke !== 'transparent' && element.strokeWidth > 0;
}

function hasVisibleFill(element: UsageProjectWorkItemDrawingElement): boolean {
  return element.fill !== 'transparent' && (element.fillOpacity ?? 1) > 0;
}

function paintDrawingPath(
  context: CanvasRenderingContext2D,
  element: UsageProjectWorkItemDrawingElement,
  buildPath: () => void
) {
  const canFill = hasVisibleFill(element);
  const canStroke = hasVisibleStroke(element);
  if (!canFill && !canStroke) return;
  context.save();
  context.beginPath();
  buildPath();
  if (canFill) {
    context.globalAlpha = Math.max(0, Math.min(1, element.fillOpacity ?? 1));
    context.fillStyle = element.fill;
    context.fill();
    context.globalAlpha = 1;
  }
  if (canStroke) {
    context.strokeStyle = element.stroke;
    context.lineWidth = element.strokeWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.setLineDash(drawingStrokeDashSegments(element.strokeStyle, element.strokeWidth));
    context.stroke();
  }
  context.restore();
}

function paintDrawingLine(context: CanvasRenderingContext2D, element: UsageProjectWorkItemDrawingElement) {
  if (!hasVisibleStroke(element)) return;
  context.save();
  context.strokeStyle = element.stroke;
  context.lineWidth = element.strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(drawingStrokeDashSegments(element.strokeStyle, element.strokeWidth));
  context.beginPath();
  context.moveTo(element.x1, element.y1);
  context.lineTo(element.x2, element.y2);
  context.stroke();
  context.restore();

  if (element.kind !== 'arrow') return;
  const angle = Math.atan2(element.y2 - element.y1, element.x2 - element.x1);
  const headLength = Math.max(10, element.strokeWidth * 4);
  context.save();
  context.fillStyle = element.stroke;
  context.beginPath();
  context.moveTo(element.x2, element.y2);
  context.lineTo(
    element.x2 - headLength * Math.cos(angle - Math.PI / 6),
    element.y2 - headLength * Math.sin(angle - Math.PI / 6)
  );
  context.lineTo(
    element.x2 - headLength * Math.cos(angle + Math.PI / 6),
    element.y2 - headLength * Math.sin(angle + Math.PI / 6)
  );
  context.closePath();
  context.fill();
  context.restore();
}

function paintDrawingText(context: CanvasRenderingContext2D, element: UsageProjectWorkItemDrawingElement) {
  const box = elementBox(element);
  const fontSize = Math.max(8, element.fontSize || 24);
  if (hasVisibleStroke(element)) {
    paintDrawingPath(context, { ...element, fill: 'transparent' }, () => roundedRectPath(context, box.left, box.top, box.width, box.height, 6));
  }

  const text = String(element.text || '').trim();
  if (!text) return;
  context.save();
  context.beginPath();
  context.rect(box.left + 6, box.top + 4, Math.max(1, box.width - 12), Math.max(1, box.height - 8));
  context.clip();
  context.font = `${fontSize}px Arial, sans-serif`;
  context.textBaseline = 'top';
  context.fillStyle = element.fill && element.fill !== 'transparent' ? element.fill : '#111827';
  context.globalAlpha = Math.max(0, Math.min(1, element.fillOpacity ?? 1));
  const lineHeight = fontSize * 1.2;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    context.fillText(line, box.left + 8, box.top + 6 + index * lineHeight, Math.max(1, box.width - 16));
  });
  context.restore();
}

async function drawingPngDataUrl(drawing: UsageProjectWorkItemDrawing): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(drawing.width));
  canvas.height = Math.max(1, Math.round(drawing.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create PNG canvas.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  drawing.elements.forEach((element) => {
    if (element.kind === 'rectangle') {
      const box = elementBox(element);
      paintDrawingPath(context, element, () => roundedRectPath(context, box.left, box.top, box.width, box.height, 8));
      return;
    }
    if (element.kind === 'ellipse') {
      const box = elementBox(element);
      paintDrawingPath(context, element, () => {
        context.ellipse(
          box.left + box.width / 2,
          box.top + box.height / 2,
          Math.max(0.5, box.width / 2),
          Math.max(0.5, box.height / 2),
          0,
          0,
          Math.PI * 2
        );
      });
      return;
    }
    if (element.kind === 'triangle') {
      const box = elementBox(element);
      paintDrawingPath(context, element, () => {
        context.moveTo(box.left + box.width / 2, box.top);
        context.lineTo(box.right, box.bottom);
        context.lineTo(box.left, box.bottom);
        context.closePath();
      });
      return;
    }
    if (element.kind === 'text') {
      paintDrawingText(context, element);
      return;
    }
    paintDrawingLine(context, element);
  });

  return canvas.toDataURL('image/png');
}

function duplicateDrawingElement(element: UsageProjectWorkItemDrawingElement, offset: number): UsageProjectWorkItemDrawingElement {
  return {
    ...element,
    id: localId(),
    x1: element.x1 + offset,
    y1: element.y1 + offset,
    x2: element.x2 + offset,
    y2: element.y2 + offset,
  };
}

export function DrawingEditor({
  drawing: sourceDrawing,
  onChange,
  onDelete,
}: {
  drawing: UsageProjectWorkItemDrawing;
  onChange: (drawing: UsageProjectWorkItemDrawing) => void;
  onDelete: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    elementId: string;
    startX: number;
    startY: number;
    original: UsageProjectWorkItemDrawingElement;
    handle?: DrawingResizeHandle;
  } | null>(null);
  const [drawing, setDrawing] = useState(sourceDrawing);
  const [tool, setTool] = useState<DrawingTool>('select');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [stroke, setStroke] = useState('#38bdf8');
  const [outlineEnabled, setOutlineEnabled] = useState(true);
  const [fill, setFill] = useState('#ffffff');
  const [fillOpacity, setFillOpacity] = useState(1);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeStyle, setStrokeStyle] = useState<UsageProjectWorkItemDrawingLineStyle>('solid');
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [canvasWidthInput, setCanvasWidthInput] = useState(String(drawing.width));
  const [canvasHeightInput, setCanvasHeightInput] = useState(String(drawing.height));
  const [textSizeInput, setTextSizeInput] = useState('24');
  const [popoutPortalTarget, setPopoutPortalTarget] = useState<HTMLElement | null>(null);
  const [elementClipboard, setElementClipboard] = useState<UsageProjectWorkItemDrawingElement | null>(null);
  const [activeAttachmentTarget, setActiveAttachmentTarget] = useState<PromptInsertionTarget | null>(() => getActivePromptAttachmentTarget());
  const [attachingPng, setAttachingPng] = useState(false);
  const [attachNotice, setAttachNotice] = useState<DrawingAttachNotice | null>(null);
  const drawingRef = useRef(sourceDrawing);
  const elementPasteCountRef = useRef(0);
  const deferredDrawingCommitFrameRef = useRef<number | null>(null);
  const deferredDrawingCommitTimeoutRef = useRef<number | null>(null);
  const attachNoticeTimeoutRef = useRef<number | null>(null);

  const selectedElement = drawing.elements.find((element) => element.id === selectedElementId) || null;
  const activeStroke = selectedElement?.stroke && selectedElement.stroke !== 'transparent' ? selectedElement.stroke : stroke;
  const activeOutlineEnabled = selectedElement ? selectedElement.stroke !== 'transparent' && selectedElement.strokeWidth > 0 : outlineEnabled;
  const activeFill = selectedElement?.fill && selectedElement.fill !== 'transparent' ? selectedElement.fill : fill;
  const activeFillOpacity = selectedElement?.fillOpacity ?? fillOpacity;
  const fillControlsEnabled = selectedElement
    ? selectedElement.kind !== 'line' && selectedElement.kind !== 'arrow'
    : tool === 'rectangle' || tool === 'ellipse' || tool === 'triangle' || tool === 'text';
  const activeStrokeWidth = selectedElement?.strokeWidth || strokeWidth;
  const activeStrokeStyle = selectedElement?.strokeStyle || strokeStyle;

  useEffect(() => {
    drawingRef.current = sourceDrawing;
    setDrawing(sourceDrawing);
  }, [sourceDrawing]);

  const previewDrawing = useCallback((nextDrawing: UsageProjectWorkItemDrawing) => {
    drawingRef.current = nextDrawing;
    setDrawing(nextDrawing);
  }, []);

  const commitDrawingAfterPaint = useCallback((nextDrawing: UsageProjectWorkItemDrawing) => {
    previewDrawing(nextDrawing);
    if (deferredDrawingCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(deferredDrawingCommitFrameRef.current);
    }
    if (deferredDrawingCommitTimeoutRef.current !== null) {
      window.clearTimeout(deferredDrawingCommitTimeoutRef.current);
      deferredDrawingCommitTimeoutRef.current = null;
    }
    deferredDrawingCommitFrameRef.current = window.requestAnimationFrame(() => {
      deferredDrawingCommitFrameRef.current = null;
      deferredDrawingCommitTimeoutRef.current = window.setTimeout(() => {
        deferredDrawingCommitTimeoutRef.current = null;
        onChange(drawingRef.current);
      }, 0);
    });
  }, [onChange, previewDrawing]);

  const commitDrawing = useCallback((nextDrawing: UsageProjectWorkItemDrawing) => {
    if (deferredDrawingCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(deferredDrawingCommitFrameRef.current);
      deferredDrawingCommitFrameRef.current = null;
    }
    if (deferredDrawingCommitTimeoutRef.current !== null) {
      window.clearTimeout(deferredDrawingCommitTimeoutRef.current);
      deferredDrawingCommitTimeoutRef.current = null;
    }
    drawingRef.current = nextDrawing;
    setDrawing(nextDrawing);
    onChange(nextDrawing);
  }, [onChange]);

  useEffect(() => () => {
    if (deferredDrawingCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(deferredDrawingCommitFrameRef.current);
      deferredDrawingCommitFrameRef.current = null;
    }
    if (deferredDrawingCommitTimeoutRef.current !== null) {
      window.clearTimeout(deferredDrawingCommitTimeoutRef.current);
      deferredDrawingCommitTimeoutRef.current = null;
    }
    if (attachNoticeTimeoutRef.current !== null) {
      window.clearTimeout(attachNoticeTimeoutRef.current);
      attachNoticeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!popoutOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousDrawingPopout = document.body.dataset.workboardDrawingPopoutOpen;
    const dialogContent = rootRef.current?.closest('[data-slot="dialog-content"]');
    setPopoutPortalTarget(dialogContent instanceof HTMLElement ? dialogContent : document.body);
    document.body.style.overflow = 'hidden';
    document.body.dataset.workboardDrawingPopoutOpen = 'true';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopoutOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousDrawingPopout === undefined) delete document.body.dataset.workboardDrawingPopoutOpen;
      else document.body.dataset.workboardDrawingPopoutOpen = previousDrawingPopout;
      setPopoutPortalTarget(null);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [popoutOpen]);

  useEffect(() => {
    setCanvasWidthInput(String(drawing.width));
    setCanvasHeightInput(String(drawing.height));
  }, [drawing.height, drawing.width]);

  useEffect(() => {
    if (selectedElement?.kind !== 'text') {
      setTextSizeInput('24');
      return;
    }
    setTextSizeInput(String(selectedElement.fontSize || 24));
  }, [selectedElement?.fontSize, selectedElement?.id, selectedElement?.kind]);

  useEffect(() => subscribePromptAttachmentTarget(setActiveAttachmentTarget), []);

  const pointForEvent = (event: React.PointerEvent<SVGSVGElement | SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(drawing.width, ((event.clientX - rect.left) / Math.max(1, rect.width)) * drawing.width)),
      y: Math.max(0, Math.min(drawing.height, ((event.clientY - rect.top) / Math.max(1, rect.height)) * drawing.height)),
    };
  };

  const patchElement = (elementId: string, patch: Partial<UsageProjectWorkItemDrawingElement>, options: { preview?: boolean } = {}) => {
    const current = drawingRef.current;
    const nextDrawing = {
      ...current,
      elements: current.elements.map((element) => element.id === elementId ? { ...element, ...patch } : element),
      updatedAt: nowIso(),
    };
    if (options.preview) {
      previewDrawing(nextDrawing);
      return;
    }
    commitDrawing(nextDrawing);
  };

  const updateSurfaceSize = (patch: Partial<Pick<UsageProjectWorkItemDrawing, 'width' | 'height'>>) => {
    const current = drawingRef.current;
    commitDrawing({
      ...current,
      width: Math.max(320, Math.min(2400, Math.round(patch.width ?? current.width))),
      height: Math.max(200, Math.min(1800, Math.round(patch.height ?? current.height))),
      updatedAt: nowIso(),
    });
  };

  const commitSurfaceSize = () => {
    const nextWidth = canvasWidthInput.trim() ? Number(canvasWidthInput) : drawing.width;
    const nextHeight = canvasHeightInput.trim() ? Number(canvasHeightInput) : drawing.height;
    updateSurfaceSize({
      width: Number.isFinite(nextWidth) ? nextWidth : drawing.width,
      height: Number.isFinite(nextHeight) ? nextHeight : drawing.height,
    });
  };

  const handleCanvasWidthInput = (value: string) => {
    const nextValue = value.replace(/[^\d]/g, '');
    setCanvasWidthInput(nextValue);
    const nextWidth = Number(nextValue);
    if (nextValue && Number.isFinite(nextWidth) && nextWidth >= 320) {
      updateSurfaceSize({ width: nextWidth });
    }
  };

  const handleCanvasHeightInput = (value: string) => {
    const nextValue = value.replace(/[^\d]/g, '');
    setCanvasHeightInput(nextValue);
    const nextHeight = Number(nextValue);
    if (nextValue && Number.isFinite(nextHeight) && nextHeight >= 200) {
      updateSurfaceSize({ height: nextHeight });
    }
  };

  const showAttachNotice = useCallback((notice: DrawingAttachNotice, duration = 3200) => {
    setAttachNotice(notice);
    if (attachNoticeTimeoutRef.current !== null) {
      window.clearTimeout(attachNoticeTimeoutRef.current);
    }
    attachNoticeTimeoutRef.current = window.setTimeout(() => {
      attachNoticeTimeoutRef.current = null;
      setAttachNotice(null);
    }, duration);
  }, []);

  const attachDrawingPngToPrompt = async () => {
    if (!activeAttachmentTarget) {
      showAttachNotice({ kind: 'error', text: 'Open a Chat or Build prompt first.' });
      return;
    }
    setAttachingPng(true);
    setAttachNotice(null);
    try {
      const currentDrawing = drawingRef.current;
      const dataUrl = await drawingPngDataUrl(currentDrawing);
      const title = currentDrawing.title.trim().replace(/[^\w.-]+/g, '_') || 'drawing';
      const result = await getAccomplish().saveDataUrlToFile(dataUrl, `${title}-drawing`);
      if (!result.filePath) throw new Error('Unable to save drawing PNG.');
      if (!attachFilesToActivePrompt([result.filePath])) {
        throw new Error('No active Chat or Build prompt is available.');
      }
      showAttachNotice({ kind: 'success', text: `PNG attached to ${activeAttachmentTarget.label}.` });
    } catch (err) {
      showAttachNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Unable to attach drawing.' }, 4200);
    } finally {
      setAttachingPng(false);
    }
  };

  const addElementAt = (x: number, y: number) => {
    const current = drawingRef.current;
    const size = tool === 'line' || tool === 'arrow' ? 120 : 96;
    const isConnector = tool === 'line' || tool === 'arrow';
    const isText = tool === 'text';
    const element: UsageProjectWorkItemDrawingElement = {
      id: localId(),
      kind: tool as UsageProjectWorkItemDrawingElementKind,
      x1: x,
      y1: y,
      x2: Math.min(current.width, x + (isText ? 180 : size)),
      y2: Math.min(current.height, y + (isConnector ? 0 : isText ? 42 : 64)),
      stroke: isText || !outlineEnabled ? 'transparent' : stroke,
      fill: isConnector ? 'transparent' : isText ? '#111827' : fill,
      fillOpacity: isConnector ? 1 : fillOpacity,
      strokeWidth,
      strokeStyle,
      text: isText ? 'Text' : undefined,
      fontSize: isText ? 24 : undefined,
    };
    commitDrawingAfterPaint({ ...current, elements: [...current.elements, element], updatedAt: nowIso() });
    setSelectedElementId(isText ? element.id : null);
  };

  const startDrag = (event: React.PointerEvent<SVGElement>, element: UsageProjectWorkItemDrawingElement) => {
    event.preventDefault();
    event.stopPropagation();
    if (tool !== 'select') return;
    if (selectedElementId !== element.id) setSelectedElementId(element.id);
    const point = pointForEvent(event);
    dragRef.current = { mode: 'move', elementId: element.id, startX: point.x, startY: point.y, original: element };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startResize = (
    event: React.PointerEvent<SVGElement>,
    element: UsageProjectWorkItemDrawingElement,
    handle: DrawingResizeHandle
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedElementId !== element.id) setSelectedElementId(element.id);
    const point = pointForEvent(event);
    dragRef.current = { mode: 'resize', elementId: element.id, startX: point.x, startY: point.y, original: element, handle };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSelected = (event: React.PointerEvent<SVGSVGElement | SVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointForEvent(event);
    if (drag.mode === 'resize') {
      const patch: Partial<UsageProjectWorkItemDrawingElement> = {};
      if (drag.handle === 'start') {
        patch.x1 = point.x;
        patch.y1 = point.y;
      } else if (drag.handle === 'end') {
        patch.x2 = point.x;
        patch.y2 = point.y;
      } else if (drag.handle === 'nw') {
        patch.x1 = point.x;
        patch.y1 = point.y;
      } else if (drag.handle === 'ne') {
        patch.x2 = point.x;
        patch.y1 = point.y;
      } else if (drag.handle === 'sw') {
        patch.x1 = point.x;
        patch.y2 = point.y;
      } else if (drag.handle === 'se') {
        patch.x2 = point.x;
        patch.y2 = point.y;
      }
      patchElement(drag.elementId, patch, { preview: true });
      return;
    }
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    patchElement(drag.elementId, {
      x1: drag.original.x1 + dx,
      y1: drag.original.y1 + dy,
      x2: drag.original.x2 + dx,
      y2: drag.original.y2 + dy,
    }, { preview: true });
  };

  const finishDrag = () => {
    if (dragRef.current) {
      commitDrawing(drawingRef.current);
    }
    dragRef.current = null;
  };

  const copySelectedElement = useCallback(() => {
    const selected = drawingRef.current.elements.find((element) => element.id === selectedElementId);
    if (!selected) return;
    setElementClipboard({ ...selected });
    elementPasteCountRef.current = 0;
  }, [selectedElementId]);

  const pasteCopiedElement = useCallback(() => {
    if (!elementClipboard) return;
    const current = drawingRef.current;
    elementPasteCountRef.current += 1;
    const duplicate = duplicateDrawingElement(elementClipboard, elementPasteCountRef.current * 18);
    commitDrawing({
      ...current,
      elements: [...current.elements, duplicate],
      updatedAt: nowIso(),
    });
    setSelectedElementId(duplicate.id);
    setTool('select');
  }, [commitDrawing, elementClipboard]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!popoutOpen && rootRef.current && target instanceof Node && !rootRef.current.contains(target)) return;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
      }
      const key = event.key.toLowerCase();
      const isModifier = event.ctrlKey || event.metaKey;
      if (isModifier && key === 'c' && selectedElementId) {
        event.preventDefault();
        event.stopPropagation();
        copySelectedElement();
        return;
      }
      if (isModifier && key === 'v' && elementClipboard) {
        event.preventDefault();
        event.stopPropagation();
        pasteCopiedElement();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [copySelectedElement, elementClipboard, pasteCopiedElement, popoutOpen, selectedElementId]);

  const renderElement = (element: UsageProjectWorkItemDrawingElement) => {
    const selected = element.id === selectedElementId;
    const strokeDasharray = drawingStrokeDasharray(element.strokeStyle, element.strokeWidth);
    const common = {
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      strokeDasharray,
      fill: element.fill,
      fillOpacity: element.fillOpacity ?? 1,
      className: cn('cursor-move touch-none select-none', selected && 'drop-shadow-[0_0_5px_rgba(45,212,191,0.8)]'),
      onPointerDown: (event: React.PointerEvent<SVGElement>) => startDrag(event, element),
    };
    if (element.kind === 'rectangle') {
      return <rect key={element.id} x={Math.min(element.x1, element.x2)} y={Math.min(element.y1, element.y2)} width={Math.abs(element.x2 - element.x1)} height={Math.abs(element.y2 - element.y1)} rx={8} {...common} />;
    }
    if (element.kind === 'ellipse') {
      return <ellipse key={element.id} cx={(element.x1 + element.x2) / 2} cy={(element.y1 + element.y2) / 2} rx={Math.abs(element.x2 - element.x1) / 2} ry={Math.abs(element.y2 - element.y1) / 2} {...common} />;
    }
    if (element.kind === 'triangle') {
      return <polygon key={element.id} points={trianglePoints(element)} {...common} />;
    }
    if (element.kind === 'text') {
      const box = elementBox(element);
      const fontSize = element.fontSize || 24;
      const textY = box.top + Math.min(Math.max(fontSize + 8, fontSize), Math.max(fontSize, box.height - 6));
      const borderHidden = element.stroke === 'transparent' || element.strokeWidth <= 0;
      return (
        <g
          key={element.id}
          className={cn('cursor-move touch-none select-none', selected && 'drop-shadow-[0_0_5px_rgba(45,212,191,0.8)]')}
          onPointerDown={(event) => startDrag(event, element)}
        >
          <rect
            x={box.left}
            y={box.top}
            width={box.width}
            height={box.height}
            rx={6}
            fill="transparent"
            stroke={borderHidden ? (selected ? '#14b8a6' : 'none') : element.stroke}
            strokeWidth={borderHidden ? (selected ? 1 : 0) : Math.max(1, element.strokeWidth)}
            strokeDasharray={borderHidden && selected ? '4 3' : drawingStrokeDasharray(element.strokeStyle, element.strokeWidth)}
          />
          <text
            x={box.left + 8}
            y={textY}
            fontFamily="Arial, sans-serif"
            fontSize={fontSize}
            fill={element.fill || '#111827'}
            fillOpacity={element.fillOpacity ?? 1}
          >
            {element.text || 'Text'}
          </text>
        </g>
      );
    }
    return (
      <line
        key={element.id}
        x1={element.x1}
        y1={element.y1}
        x2={element.x2}
        y2={element.y2}
        stroke={element.stroke}
        strokeWidth={element.strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        markerEnd={element.kind === 'arrow' ? `url(#arrow-${drawing.id})` : undefined}
        className={cn('cursor-move touch-none select-none', selected && 'drop-shadow-[0_0_5px_rgba(45,212,191,0.8)]')}
        onPointerDown={(event) => startDrag(event, element)}
      />
    );
  };

  const renderResizeHandles = () => {
    if (!selectedElement) return null;
    const handleSize = 13;
    const handleCursor = (handle: DrawingResizeHandle) => {
      if (handle === 'nw' || handle === 'se') return 'cursor-nwse-resize';
      if (handle === 'ne' || handle === 'sw') return 'cursor-nesw-resize';
      return 'cursor-grab';
    };
    const handleRect = (x: number, y: number, handle: DrawingResizeHandle) => (
      <rect
        key={handle}
        x={x - handleSize / 2}
        y={y - handleSize / 2}
        width={handleSize}
        height={handleSize}
        rx={2}
        className={cn('fill-primary stroke-background stroke-[1.5] touch-none', handleCursor(handle))}
        onPointerDown={(event) => startResize(event, selectedElement, handle)}
        onPointerMove={(event) => {
          event.stopPropagation();
          moveSelected(event);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          finishDrag();
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          finishDrag();
        }}
      />
    );
    if (selectedElement.kind === 'line' || selectedElement.kind === 'arrow') {
      return (
        <>
          {handleRect(selectedElement.x1, selectedElement.y1, 'start')}
          {handleRect(selectedElement.x2, selectedElement.y2, 'end')}
        </>
      );
    }
    const left = Math.min(selectedElement.x1, selectedElement.x2);
    const right = Math.max(selectedElement.x1, selectedElement.x2);
    const top = Math.min(selectedElement.y1, selectedElement.y2);
    const bottom = Math.max(selectedElement.y1, selectedElement.y2);
    return (
      <>
        <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#14b8a6" strokeDasharray="4 3" strokeWidth={1} pointerEvents="none" />
        {handleRect(left, top, 'nw')}
        {handleRect(right, top, 'ne')}
        {handleRect(left, bottom, 'sw')}
        {handleRect(right, bottom, 'se')}
      </>
    );
  };

  const applyStrokeColor = (value: string) => {
    setStroke(value);
    setOutlineEnabled(true);
    if (selectedElement) patchElement(selectedElement.id, { stroke: value, strokeWidth: selectedElement.strokeWidth || strokeWidth });
  };

  const toggleOutline = () => {
    if (selectedElement) {
      const nextEnabled = selectedElement.stroke === 'transparent' || selectedElement.strokeWidth <= 0;
      patchElement(selectedElement.id, { stroke: nextEnabled ? stroke : 'transparent' });
      return;
    }
    setOutlineEnabled((enabled) => !enabled);
  };

  const applyFillColor = (value: string) => {
    setFill(value);
    if (selectedElement && selectedElement.kind !== 'line' && selectedElement.kind !== 'arrow') {
      patchElement(selectedElement.id, { fill: value });
    }
  };

  const applyFillOpacity = (value: number) => {
    const nextOpacity = Math.max(0, Math.min(1, value));
    setFillOpacity(nextOpacity);
    if (selectedElement && selectedElement.kind !== 'line' && selectedElement.kind !== 'arrow') {
      patchElement(selectedElement.id, { fillOpacity: nextOpacity });
    }
  };

  const applyStrokeWidth = (value: number) => {
    const nextWidth = Math.max(1, Math.min(12, value || 1));
    setStrokeWidth(nextWidth);
    if (selectedElement) patchElement(selectedElement.id, { strokeWidth: nextWidth });
  };

  const applyStrokeStyle = (value: UsageProjectWorkItemDrawingLineStyle) => {
    setStrokeStyle(value);
    if (selectedElement) patchElement(selectedElement.id, { strokeStyle: value });
  };

  const commitTextSize = () => {
    if (selectedElement?.kind !== 'text') return;
    const nextSize = textSizeInput.trim() ? Number(textSizeInput) : selectedElement.fontSize || 24;
    const normalized = Math.max(10, Math.min(72, Math.round(Number.isFinite(nextSize) ? nextSize : selectedElement.fontSize || 24)));
    setTextSizeInput(String(normalized));
    patchElement(selectedElement.id, { fontSize: normalized });
  };

  const handleTextSizeInput = (value: string) => {
    const nextValue = value.replace(/[^\d]/g, '');
    setTextSizeInput(nextValue);
    const nextSize = Number(nextValue);
    if (selectedElement?.kind === 'text' && nextValue && Number.isFinite(nextSize) && nextSize >= 10) {
      patchElement(selectedElement.id, { fontSize: Math.max(10, Math.min(72, Math.round(nextSize))) });
    }
  };

  const toolButton = (value: DrawingTool, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      className={cn('flex h-8 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground', tool === value && 'border-primary bg-primary/10 text-primary')}
      onClick={() => setTool(value)}
      title={label}
    >
      {icon}
      {label}
    </button>
  );

  const changeZoom = (delta: number) => {
    setZoom((current) => Math.max(0.25, Math.min(3, Math.round((current + delta) * 100) / 100)));
  };

  const renderDrawingToolbar = () => (
    <div className="flex flex-wrap items-center gap-1">
      {toolButton('select', <MousePointer2 className="h-3.5 w-3.5" />, 'Move')}
      {toolButton('rectangle', <Square className="h-3.5 w-3.5" />, 'Box')}
      {toolButton('ellipse', <Circle className="h-3.5 w-3.5" />, 'Circle')}
      {toolButton('triangle', <Triangle className="h-3.5 w-3.5" />, 'Triangle')}
      {toolButton('line', <Minus className="h-3.5 w-3.5" />, 'Line')}
      {toolButton('arrow', <ArrowRight className="h-3.5 w-3.5" />, 'Arrow')}
      {toolButton('text', <Type className="h-3.5 w-3.5" />, 'Text')}
      <label className="ml-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        Outline
        <input type="color" value={activeStroke} onChange={(event) => applyStrokeColor(event.target.value)} className="h-7 w-9 rounded border border-input bg-background p-0.5" />
      </label>
      <div className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-1" title="Outline color swatches">
        {DRAWING_COLOR_SWATCHES.map((color) => (
          <button
            key={`drawing-outline-${color}`}
            type="button"
            className={cn(
              'h-4.5 w-4.5 rounded-sm border border-border shadow-sm hover:ring-1 hover:ring-primary/70',
              activeStroke.toLowerCase() === color.toLowerCase() && activeOutlineEnabled && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
            )}
            style={{ backgroundColor: color, width: 18, height: 18 }}
            onClick={() => applyStrokeColor(color)}
            title={`Set outline to ${color}`}
          />
        ))}
      </div>
      <button
        type="button"
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] hover:bg-muted/60 hover:text-foreground',
          activeOutlineEnabled ? 'text-muted-foreground' : 'border-primary bg-primary/10 text-primary'
        )}
        onClick={toggleOutline}
        title={activeOutlineEnabled ? 'Remove the outline from selected/new shapes' : 'Add an outline to selected/new shapes'}
      >
        {activeOutlineEnabled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {activeOutlineEnabled ? 'Turn outline off' : 'Turn outline on'}
      </button>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Fill/Text
        <input type="color" value={activeFill} disabled={!fillControlsEnabled} onChange={(event) => applyFillColor(event.target.value)} className="h-7 w-9 rounded border border-input bg-background p-0.5 disabled:opacity-40" />
      </label>
      <div
        className={cn(
          'inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-1',
          !fillControlsEnabled && 'opacity-45'
        )}
        title={fillControlsEnabled ? 'Fill/Text color swatches' : 'Fill/Text color is not available for this selection'}
      >
        {DRAWING_COLOR_SWATCHES.map((color) => (
          <button
            key={`drawing-fill-${color}`}
            type="button"
            className={cn(
              'rounded-sm border border-border shadow-sm hover:ring-1 hover:ring-primary/70 disabled:cursor-not-allowed',
              activeFill.toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
            )}
            style={{ backgroundColor: color, width: 18, height: 18 }}
            onClick={() => applyFillColor(color)}
            disabled={!fillControlsEnabled}
            title={`Set fill/text to ${color}`}
          />
        ))}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Opacity
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(activeFillOpacity * 100)}
          disabled={!fillControlsEnabled}
          onChange={(event) => applyFillOpacity(Number(event.target.value) / 100)}
          className="h-7 w-20 disabled:opacity-40"
        />
        <span className="w-7 text-right">{Math.round(activeFillOpacity * 100)}%</span>
      </label>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>Width</span>
        <div className="inline-flex overflow-hidden rounded border border-border bg-background">
          {DRAWING_STROKE_WIDTH_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={cn(
                'flex h-7 items-center gap-1 border-r border-border px-1.5 text-[10px] last:border-r-0 hover:bg-muted/60 hover:text-foreground',
                activeStrokeWidth === preset.value && 'bg-primary/10 text-primary'
              )}
              onClick={() => applyStrokeWidth(preset.value)}
              title={`${preset.label} line thickness`}
            >
              <span className="relative h-3 w-8">
                <span
                  className="absolute left-0 right-0 top-1/2 rounded-full bg-current"
                  style={{ height: `${preset.value}px`, transform: 'translateY(-50%)' }}
                />
              </span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Line
        <select
          value={activeStrokeStyle}
          onChange={(event) => applyStrokeStyle(event.target.value as UsageProjectWorkItemDrawingLineStyle)}
          className="h-7 rounded border border-input bg-background px-1 text-xs"
        >
          {DRAWING_LINE_STYLES.map((style) => (
            <option key={style} value={style}>{style}</option>
          ))}
        </select>
      </label>
      <label className="ml-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        Canvas
        <input
          value={canvasWidthInput}
          inputMode="numeric"
          onChange={(event) => handleCanvasWidthInput(event.target.value)}
          onBlur={commitSurfaceSize}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitSurfaceSize();
            }
          }}
          className="h-7 w-14 rounded border border-input bg-background px-1 text-xs"
          title="Canvas width, 320 to 2400"
          aria-label="Canvas width"
        />
        x
        <input
          value={canvasHeightInput}
          inputMode="numeric"
          onChange={(event) => handleCanvasHeightInput(event.target.value)}
          onBlur={commitSurfaceSize}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitSurfaceSize();
            }
          }}
          className="h-7 w-14 rounded border border-input bg-background px-1 text-xs"
          title="Canvas height, 200 to 1800"
          aria-label="Canvas height"
        />
      </label>
      {selectedElement?.kind === 'text' ? (
        <>
          <input
            value={selectedElement.text || ''}
            onChange={(event) => patchElement(selectedElement.id, { text: event.target.value })}
            className="h-7 min-w-[140px] rounded border border-input bg-background px-2 text-xs"
            placeholder="Text"
          />
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Size
            <input
              value={textSizeInput}
              inputMode="numeric"
              onChange={(event) => handleTextSizeInput(event.target.value)}
              onBlur={commitTextSize}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTextSize();
                }
              }}
              className="h-7 w-12 rounded border border-input bg-background px-1 text-xs"
              title="Text size, 10 to 72"
              aria-label="Selected text size"
            />
          </label>
        </>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={copySelectedElement}
        disabled={!selectedElement}
        title={selectedElement ? 'Copy the selected drawing item.' : 'Select a drawing item to copy it.'}
      >
        <ClipboardCopy className="h-3.5 w-3.5" />
        Copy
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={pasteCopiedElement}
        disabled={!elementClipboard}
        title={elementClipboard ? 'Paste another copy of the copied drawing item.' : 'Copy a drawing item before pasting.'}
      >
        <Plus className="h-3.5 w-3.5" />
        Paste
      </Button>
      {selectedElement ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => commitDrawing({ ...drawingRef.current, elements: drawingRef.current.elements.filter((element) => element.id !== selectedElement.id), updatedAt: nowIso() })}>
          Delete selected
        </Button>
      ) : null}
    </div>
  );

  const renderCanvas = (expanded = false) => (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      className={cn(
        'touch-none select-none rounded-md border border-border bg-white',
        expanded ? 'max-w-none shadow-lg' : 'aspect-video w-full'
      )}
      style={expanded ? { width: `${drawing.width * zoom}px`, height: `${drawing.height * zoom}px` } : undefined}
      onPointerDown={(event) => {
        const point = pointForEvent(event);
        if (tool === 'select') setSelectedElementId(null);
        else addElementAt(point.x, point.y);
      }}
      onPointerMove={(event) => {
        moveSelected(event);
      }}
      onPointerUp={(event) => {
        finishDrag();
      }}
      onPointerCancel={(event) => {
        finishDrag();
      }}
    >
      <defs>
        <marker id={`arrow-${drawing.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="#ffffff" />
      {drawing.elements.map(renderElement)}
      {renderResizeHandles()}
    </svg>
  );

  const attachButtonLabel = attachingPng ? 'Attaching...' : attachNotice?.kind === 'success' ? 'Attached' : 'Attach PNG';
  const attachButtonClass = cn(
    'h-8 gap-1 px-2 text-xs transition-colors',
    attachNotice?.kind === 'success' && 'border-emerald-500/70 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200',
    attachNotice?.kind === 'error' && 'border-red-500/70 bg-red-500/15 text-red-700 hover:bg-red-500/20 dark:text-red-200'
  );
  const renderAttachNotice = (className?: string) => attachNotice ? (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium shadow-sm',
        attachNotice.kind === 'success'
          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-100'
          : 'border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-100',
        className
      )}
      role="status"
    >
      {attachNotice.kind === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <X className="h-3.5 w-3.5 shrink-0" />}
      <span>{attachNotice.text}</span>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="rounded-md border border-border/60 bg-card/50 p-2" style={workItemOutlineStyle(drawing.outlineColor)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <WorkItemNameTooltip value={drawing.title || 'Drawing'}>
          <input
            value={drawing.title}
            onChange={(event) => commitDrawing({ ...drawingRef.current, title: event.target.value, updatedAt: nowIso() })}
            className="h-8 min-w-[180px] flex-1 rounded-md border border-input bg-background px-2 text-xs font-medium"
            placeholder="Drawing title"
          />
        </WorkItemNameTooltip>
        <div className="flex items-center gap-1">
          <WorkItemOutlineColorPicker
            value={drawing.outlineColor}
            onChange={(outlineColor) => commitDrawing({ ...drawingRef.current, outlineColor, updatedAt: nowIso() })}
          />
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => setPopoutOpen(true)}>
            <Maximize2 className="h-3.5 w-3.5" />
            Pop out
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => exportDrawingSvg(drawing)}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={attachButtonClass}
            onClick={() => void attachDrawingPngToPrompt()}
            disabled={attachingPng}
            title={activeAttachmentTarget ? `Attach this drawing as a PNG to ${activeAttachmentTarget.label}.` : 'Open a Chat or Build prompt to attach this drawing as a PNG.'}
          >
            <Paperclip className="h-3.5 w-3.5" />
            {attachButtonLabel}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {popoutOpen ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          Drawing is open in the pop-out workspace.
        </div>
      ) : (
        <>
          <div className="mb-2">{renderDrawingToolbar()}</div>
          {renderCanvas(false)}
        </>
      )}
      <div className="mt-2 text-[11px] text-muted-foreground">
        Choose a tool, click the canvas to add it, then use Move to drag items or pull handles to resize. Pop out for zoom and a larger workspace.
      </div>
      {renderAttachNotice('mt-2')}
      {popoutOpen && popoutPortalTarget ? createPortal(
        <div
          className="bg-black/60 p-3"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
        >
          <div
            className="flex h-full max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="shrink-0 border-b border-border bg-card px-4 py-3 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <WorkItemNameTooltip value={drawing.title || 'Drawing'}>
                    <div className="truncate text-sm font-semibold text-foreground">{drawing.title || 'Drawing'}</div>
                  </WorkItemNameTooltip>
                  <div className="mt-0.5 text-xs text-muted-foreground">Pop-out drawing workspace</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => changeZoom(-0.25)}>
                    <ZoomOut className="h-3.5 w-3.5" />
                    Zoom out
                  </Button>
                  <button type="button" className="h-8 rounded border border-border bg-background px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setZoom(1)}>
                    {Math.round(zoom * 100)}%
                  </button>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => changeZoom(0.25)}>
                    <ZoomIn className="h-3.5 w-3.5" />
                    Zoom in
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => exportDrawingSvg(drawing)}>
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={attachButtonClass}
                    onClick={() => void attachDrawingPngToPrompt()}
                    disabled={attachingPng}
                    title={activeAttachmentTarget ? `Attach this drawing as a PNG to ${activeAttachmentTarget.label}.` : 'Open a Chat or Build prompt to attach this drawing as a PNG.'}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    {attachButtonLabel}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => setPopoutOpen(false)}>
                    <Minimize2 className="h-3.5 w-3.5" />
                    Close
                  </Button>
                </div>
              </div>
              <div className="mt-3">{renderDrawingToolbar()}</div>
              {renderAttachNotice('mt-2')}
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-6">
              <div className="inline-block min-w-full">
                {renderCanvas(true)}
              </div>
            </div>
          </div>
        </div>,
        popoutPortalTarget
      ) : null}
    </div>
  );
}

export default function ProjectWorkboardTab({
  project,
  assignees,
  budgetWindows,
  sourceOptions,
  initialItemId,
  onInitialItemOpened,
}: {
  project: UsageProject;
  assignees: UsageAssignee[];
  budgetWindows: UsageProjectBudgetWindow[];
  sourceOptions: WorkboardSourceOption[];
  initialItemId?: string | null;
  onInitialItemOpened?: () => void;
}) {
  const [view, setView] = useState<WorkboardView>('kanban');
  const [items, setItems] = useState<UsageProjectWorkItem[]>([]);
  const [columns, setColumns] = useState<UsageProjectKanbanColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | UsageProjectPriority>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | UsageProjectWorkItemSourceType>('all');
  const [groupBy, setGroupBy] = useState<WorkboardGroupBy>('none');
  const [quickTitle, setQuickTitle] = useState('');
  const [draft, setDraft] = useState<WorkItemDraft | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveNotice, setDraftSaveNotice] = useState('');
  const [timelinePreset, setTimelinePreset] = useState<TimelineRangePreset>('3m');
  const [timelineDisplayMode, setTimelineDisplayMode] = useState<TimelineDisplayMode>('timeline');
  const [timelineCustomStart, setTimelineCustomStart] = useState(() => dateInputFromDate(startOfLocalMonth(new Date())));
  const [timelineCustomEnd, setTimelineCustomEnd] = useState(() => dateInputFromDate(endOfLocalMonth(addLocalMonths(new Date(), 2))));
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [columnDrafts, setColumnDrafts] = useState<Record<string, ColumnDraft>>({});
  const [newColumnName, setNewColumnName] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [fullScreenOpen, setFullScreenOpen] = useState(false);
  const [overlayPortalElement, setOverlayPortalElement] = useState<HTMLDivElement | null>(null);
  const [expandedChecklistMeta, setExpandedChecklistMeta] = useState<Record<string, boolean>>({});
  const [collapsedChecklistLists, setCollapsedChecklistLists] = useState<Record<string, boolean>>(() => readChecklistListCollapseState());
  const [editingDocument, setEditingDocument] = useState<DocumentEditDraft | null>(null);
  const [documentPromptNotice, setDocumentPromptNotice] = useState<DocumentPromptNotice | null>(null);
  const draftSaveNoticeTimerRef = useRef<number | null>(null);
  const documentPromptNoticeTimerRef = useRef<number | null>(null);

  const api = getAccomplish();

  useEffect(() => {
    if (!initialItemId) return;
    const item = items.find(entry => entry.id === initialItemId && entry.usageProjectId === project.id);
    if (!item) return;
    setDraft(draftFromItem(item));
    onInitialItemOpened?.();
  }, [initialItemId, items, project.id, onInitialItemOpened]);

  const sortedColumns = useMemo(
    () => columns.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [columns]
  );
  const defaultStatusId = sortedColumns.find((column) => !column.doneState && !column.archivedState)?.id || sortedColumns[0]?.id || '';

  const sourceByKey = useMemo(() => {
    const map = new Map<string, WorkboardSourceOption>();
    for (const option of sourceOptions) {
      map.set(`${option.sourceType}:${option.sourceId}`, option);
    }
    return map;
  }, [sourceOptions]);

  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignee of assignees) map.set(assignee.id, assignee.name);
    return map;
  }, [assignees]);

  const resolveCsvAssigneeNames = useCallback((assigneeIds?: string[]) => (
    (assigneeIds || []).map((id) => assigneeNameById.get(id) || '').filter(Boolean)
  ), [assigneeNameById]);

  const draftListCsvCandidates = useMemo<WorkboardListCsvCandidate[]>(() => (
    draft
      ? draft.checklistLists.map((list) => ({
        id: list.id,
        workItemTitle: draft.title.trim() || 'Untitled work item',
        list,
      }))
      : []
  ), [draft?.checklistLists, draft?.title]);

  const draftNoteCsvCandidates = useMemo<WorkboardNoteCsvCandidate[]>(() => (
    draft
      ? draft.notes.map((note) => ({
        id: note.id,
        workItemTitle: draft.title.trim() || 'Untitled work item',
        note,
      }))
      : []
  ), [draft?.notes, draft?.title]);

  const loadWorkboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextColumns, nextItems] = await Promise.all([
        api.listUsageProjectKanbanColumns({ projectId: project.id }),
        api.listUsageProjectWorkItems({ projectId: project.id, includeArchived: true }),
      ]);
      setColumns(nextColumns);
      setItems(nextItems);
      setColumnDrafts(Object.fromEntries(nextColumns.map((column) => [column.id, {
        name: column.name,
        color: column.color || '#64748b',
        wipLimit: column.wipLimit == null ? '' : String(column.wipLimit),
        doneState: column.doneState === true,
        archivedState: column.archivedState === true,
      }])));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, project.id]);

  useEffect(() => {
    void loadWorkboard();
  }, [loadWorkboard]);

  useEffect(() => () => {
    if (draftSaveNoticeTimerRef.current !== null) {
      window.clearTimeout(draftSaveNoticeTimerRef.current);
    }
    if (documentPromptNoticeTimerRef.current !== null) {
      window.clearTimeout(documentPromptNoticeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!editingDocument) return;
    if (!draft || !draft.documents.some((documentLink) => documentLink.id === editingDocument.id)) {
      setEditingDocument(null);
    }
  }, [draft, editingDocument]);

  useEffect(() => {
    if (!fullScreenOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !draft) {
        setFullScreenOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [draft, fullScreenOpen]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!showArchived && item.archived) return false;
      if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false;
      if (assigneeFilter !== 'all' && !item.assigneeIds.includes(assigneeFilter)) return false;
      if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) return false;
      if (!query) return true;
      const source = sourceByKey.get(`${item.sourceType}:${item.sourceId || ''}`);
      return itemSearchText(item, source).includes(query);
    });
  }, [assigneeFilter, items, priorityFilter, search, showArchived, sourceByKey, sourceFilter]);

  const stats = useMemo(() => {
    const active = items.filter((item) => !item.archived);
    return {
      total: active.length,
      blocked: active.filter((item) => item.blocked).length,
      overdue: active.filter(isOverdue).length,
      done: active.filter((item) => sortedColumns.some((column) => column.id === item.statusId && column.doneState)).length,
    };
  }, [items, sortedColumns]);

  const showDraftSaveNotice = (message: string) => {
    if (draftSaveNoticeTimerRef.current !== null) {
      window.clearTimeout(draftSaveNoticeTimerRef.current);
    }
    setDraftSaveNotice(message);
    draftSaveNoticeTimerRef.current = window.setTimeout(() => {
      setDraftSaveNotice('');
      draftSaveNoticeTimerRef.current = null;
    }, 5000);
  };

  const showDocumentPromptNotice = (notice: DocumentPromptNotice) => {
    setDocumentPromptNotice(notice);
    if (documentPromptNoticeTimerRef.current !== null) {
      window.clearTimeout(documentPromptNoticeTimerRef.current);
    }
    documentPromptNoticeTimerRef.current = window.setTimeout(() => {
      setDocumentPromptNotice(null);
      documentPromptNoticeTimerRef.current = null;
    }, notice.kind === 'success' ? 3200 : 4400);
  };

  const saveDraft = async (closeAfterSave = false) => {
    if (!draft || !draft.title.trim()) return;
    setDraftSaving(true);
    setError('');
    const payload = {
      usageProjectId: project.id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      color: draft.color || null,
      sourceType: draft.sourceType,
      sourceId: draft.sourceType === 'manual' ? null : draft.sourceId || null,
      statusId: draft.statusId || defaultStatusId,
      priority: draft.priority,
      assigneeIds: draft.assigneeIds,
      startDate: fromDateInput(draft.startDate),
      dueDate: fromDateInput(draft.dueDate),
      completedAt: fromDateInput(draft.completedAt),
      blocked: draft.blocked,
      blockedReason: draft.blockedReason.trim(),
      tags: parseTags(draft.tagsText),
      checklist: flattenChecklistLists(draft.checklistLists),
      checklistLists: draft.checklistLists,
      notes: draft.notes,
      drawings: draft.drawings,
      documents: draft.documents,
      sources: draft.sources,
      archived: draft.archived,
    };
    try {
      let savedItem: UsageProjectWorkItem;
      if (draft.id) {
        savedItem = await api.updateUsageProjectWorkItem(draft.id, payload);
      } else {
        savedItem = await api.createUsageProjectWorkItem(payload);
      }
      showDraftSaveNotice(closeAfterSave ? 'Work item saved and closed.' : 'Work item saved.');
      if (closeAfterSave) {
        setDraft(null);
      } else {
        setDraft(draftFromItem(savedItem));
      }
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDraftSaving(false);
    }
  };

  const addDraftDrawing = () => {
    setDraft((current) => current
      ? { ...current, drawings: [createWorkItemDrawing(`Drawing ${current.drawings.length + 1}`), ...current.drawings] }
      : current);
  };

  const updateDraftDrawing = (drawing: UsageProjectWorkItemDrawing) => {
    setDraft((current) => current
      ? { ...current, drawings: current.drawings.map((entry) => entry.id === drawing.id ? drawing : entry) }
      : current);
  };

  const removeDraftDrawing = (drawingId: string) => {
    setDraft((current) => current
      ? { ...current, drawings: current.drawings.filter((drawing) => drawing.id !== drawingId) }
      : current);
  };

  const addLocalDocuments = async () => {
    try {
      const filePaths = await api.selectFiles();
      if (!filePaths.length) return;
      setDraft((current) => current
        ? {
          ...current,
          documents: [
            ...filePaths.map((filePath): UsageProjectWorkItemDocumentLink => ({
              id: localId(),
              label: labelForDocumentTarget(filePath),
              kind: 'local',
              path: filePath,
              createdAt: nowIso(),
            })),
            ...current.documents,
          ],
        }
        : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addUrlDocument = () => {
    if (!draft) return;
    const url = draft.newDocumentUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('Document link must start with http:// or https://.');
      return;
    }
    const label = draft.newDocumentLabel.trim() || labelForDocumentTarget(url);
    setDraft({
      ...draft,
      documents: [{ id: localId(), label, kind: 'url', url, createdAt: nowIso() }, ...draft.documents],
      newDocumentLabel: '',
      newDocumentUrl: '',
    });
  };

  const addSourceLink = () => {
    if (!draft) return;
    const url = draft.newSourceUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('Source link must start with http:// or https://.');
      return;
    }
    const title = draft.newSourceTitle.trim() || labelForDocumentTarget(url);
    const description = draft.newSourceDescription.trim();
    setDraft({
      ...draft,
      sources: [{
        id: localId(),
        title,
        url,
        description: description || undefined,
        createdAt: nowIso(),
      }, ...draft.sources],
      newSourceTitle: '',
      newSourceUrl: '',
      newSourceDescription: '',
    });
    setError('');
  };

  const openSourceLink = async (source: UsageProjectWorkItemSourceLink) => {
    try {
      await api.openExternal(source.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copySourceLink = (source: UsageProjectWorkItemSourceLink) => {
    void navigator.clipboard?.writeText(source.url).catch(() => undefined);
  };

  const startEditingDocument = (documentLink: UsageProjectWorkItemDocumentLink) => {
    setEditingDocument({
      id: documentLink.id,
      label: documentLink.label,
      target: documentLink.kind === 'url' ? (documentLink.url || '') : (documentLink.path || ''),
    });
  };

  const cancelEditingDocument = () => {
    setEditingDocument(null);
  };

  const relinkLocalDocument = async (documentLink: UsageProjectWorkItemDocumentLink) => {
    try {
      const filePaths = await api.selectFiles();
      const filePath = filePaths[0];
      if (!filePath) return;
      setEditingDocument({
        id: documentLink.id,
        label: editingDocument?.id === documentLink.id
          ? editingDocument.label
          : documentLink.label,
        target: filePath,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveEditedDocument = (documentLink: UsageProjectWorkItemDocumentLink) => {
    if (!draft || !editingDocument || editingDocument.id !== documentLink.id) return;
    const label = editingDocument.label.trim() || labelForDocumentTarget(editingDocument.target);
    const target = editingDocument.target.trim();
    if (!target) {
      setError('Choose a document before saving the linked document.');
      return;
    }
    if (documentLink.kind === 'url' && !/^https?:\/\//i.test(target)) {
      setError('Document link must start with http:// or https://.');
      return;
    }

    setDraft({
      ...draft,
      documents: draft.documents.map((entry) => {
        if (entry.id !== documentLink.id) return entry;
        return entry.kind === 'url'
          ? {
            ...entry,
            label,
            url: target,
          }
          : {
            ...entry,
            label,
            path: target,
          };
      }),
    });
    setEditingDocument(null);
    setError('');
  };

  const openDocumentLink = async (documentLink: UsageProjectWorkItemDocumentLink) => {
    try {
      if (documentLink.kind === 'url' && documentLink.url) {
        await api.openExternal(documentLink.url);
        return;
      }
      if (documentLink.kind === 'local' && documentLink.path) {
        const result = await api.openPath(documentLink.path);
        if (!result.ok) throw new Error(result.error || 'Failed to open local document.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const attachDocumentToPrompt = (documentLink: UsageProjectWorkItemDocumentLink) => {
    const result = attachDocumentLinkToActivePrompt(documentLink);
    showDocumentPromptNotice({
      documentId: documentLink.id,
      kind: result.ok ? 'success' : 'error',
      text: result.message,
    });
  };

  const archiveItem = async (item: UsageProjectWorkItem, archived = true) => {
    try {
      await api.archiveUsageProjectWorkItem(item.id, archived);
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateItem = async (item: UsageProjectWorkItem, update: Partial<UsageProjectWorkItem>) => {
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...update, updatedAt: nowIso() } : entry));
    try {
      await api.updateUsageProjectWorkItem(item.id, update);
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadWorkboard();
    }
  };

  const createQuickItem = async (statusId = defaultStatusId) => {
    const title = quickTitle.trim();
    if (!title || !statusId) return;
    try {
      await api.createUsageProjectWorkItem({
        usageProjectId: project.id,
        title,
        statusId,
        priority: 'normal',
        color: project.color || '#3b82f6',
        assigneeIds: project.assigneeIds || [],
      });
      setQuickTitle('');
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveColumn = async (column: UsageProjectKanbanColumn) => {
    const edit = columnDrafts[column.id];
    if (!edit?.name.trim()) return;
    try {
      await api.updateUsageProjectKanbanColumn(column.id, {
        name: edit.name,
        color: edit.color,
        wipLimit: edit.wipLimit.trim() ? Number(edit.wipLimit) : null,
        doneState: edit.doneState,
        archivedState: edit.archivedState,
      });
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const moveColumn = async (column: UsageProjectKanbanColumn, direction: -1 | 1) => {
    const index = sortedColumns.findIndex((entry) => entry.id === column.id);
    const other = sortedColumns[index + direction];
    if (!other) return;
    try {
      await Promise.all([
        api.updateUsageProjectKanbanColumn(column.id, { order: other.order }),
        api.updateUsageProjectKanbanColumn(other.id, { order: column.order }),
      ]);
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createColumn = async () => {
    const name = newColumnName.trim();
    if (!name) return;
    try {
      await api.createUsageProjectKanbanColumn({ usageProjectId: project.id, name, order: sortedColumns.length });
      setNewColumnName('');
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteColumn = async (column: UsageProjectKanbanColumn) => {
    if (sortedColumns.length <= 1) return;
    try {
      await api.deleteUsageProjectKanbanColumn(column.id);
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const archiveDoneItems = async () => {
    const doneIds = new Set(sortedColumns.filter((column) => column.doneState).map((column) => column.id));
    const doneItems = items.filter((item) => !item.archived && doneIds.has(item.statusId));
    try {
      await Promise.all(doneItems.map((item) => api.archiveUsageProjectWorkItem(item.id, true)));
      await loadWorkboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openWorkItem = (item: UsageProjectWorkItem) => {
    setDraftSaveNotice('');
    setDraft(draftFromItem(item));
  };

  const updateDraftChecklistList = (
    listId: string,
    updater: (list: UsageProjectWorkItemChecklistList) => UsageProjectWorkItemChecklistList
  ) => {
    setDraft((current) => current
      ? {
        ...current,
        checklistLists: current.checklistLists.map((list) => list.id === listId ? updater(list) : list),
      }
      : current);
  };

  const addDraftChecklistList = () => {
    setDraft((current) => {
      if (!current) return current;
      const name = current.newListName.trim() || `List ${current.checklistLists.length + 1}`;
      return {
        ...current,
        checklistLists: [...current.checklistLists, createChecklistList(name)],
        newListName: '',
      };
    });
  };

  const removeDraftChecklistList = (listId: string) => {
    setDraft((current) => current
      ? {
        ...current,
        checklistLists: current.checklistLists.filter((list) => list.id !== listId),
      }
      : current);
  };

  const updateDraftChecklistItem = (
    listId: string,
    itemId: string,
    patch: Partial<UsageProjectWorkItemChecklistItem>
  ) => {
    updateDraftChecklistList(listId, (list) => ({
      ...list,
      items: list.items.map((item) => item.id === itemId ? { ...item, ...patch, updatedAt: nowIso() } : item),
      updatedAt: nowIso(),
    }));
  };

  const removeDraftChecklistItem = (listId: string, itemId: string) => {
    updateDraftChecklistList(listId, (list) => ({
      ...list,
      items: list.items.filter((item) => item.id !== itemId),
      updatedAt: nowIso(),
    }));
  };

  const addDraftChecklistItem = (listId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const text = (current.newChecklistTextByListId[listId] || '').trim();
      if (!text) return current;
      return {
        ...current,
        checklistLists: current.checklistLists.map((list) => (
          list.id === listId
            ? {
              ...list,
              items: [...list.items, { id: localId(), text, completed: false, assigneeIds: [], dueDate: null, createdAt: nowIso() }],
              updatedAt: nowIso(),
            }
            : list
        )),
        newChecklistTextByListId: {
          ...current.newChecklistTextByListId,
          [listId]: '',
        },
      };
    });
  };

  const checklistMetaKey = (listId: string, itemId: string) => `${listId}:${itemId}`;

  const toggleChecklistListCollapsed = (collapseKey: string) => {
    setCollapsedChecklistLists((current) => {
      const next = { ...current };
      if (next[collapseKey]) delete next[collapseKey];
      else next[collapseKey] = true;
      writeChecklistListCollapseState(next);
      return next;
    });
  };

  const toggleChecklistItemMeta = (listId: string, itemId: string) => {
    const key = checklistMetaKey(listId, itemId);
    setExpandedChecklistMeta((current) => ({ ...current, [key]: !current[key] }));
  };

  const setChecklistListMetaOpen = (list: UsageProjectWorkItemChecklistList, open: boolean) => {
    setExpandedChecklistMeta((current) => {
      const next = { ...current };
      for (const item of list.items) {
        const key = checklistMetaKey(list.id, item.id);
        if (open) next[key] = true;
        else delete next[key];
      }
      return next;
    });
  };

  const renderAssignees = (ids: string[]) => {
    if (ids.length === 0) return <span className="text-muted-foreground">No assignee</span>;
    return (
      <span className="flex min-w-0 flex-wrap gap-1">
        {ids.map((id) => (
          <span key={id} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {assigneeNameById.get(id) || 'Unknown'}
          </span>
        ))}
      </span>
    );
  };

  const groupItems = (columnItems: UsageProjectWorkItem[]) => {
    if (groupBy === 'none') return [{ key: 'all', label: '', items: columnItems }];
    const groups = new Map<string, UsageProjectWorkItem[]>();
    for (const item of columnItems) {
      const source = sourceByKey.get(`${item.sourceType}:${item.sourceId || ''}`);
      const key = groupBy === 'priority'
        ? item.priority
        : groupBy === 'source'
          ? SOURCE_LABELS[item.sourceType]
          : item.assigneeIds[0]
            ? assigneeNameById.get(item.assigneeIds[0]) || 'Unknown assignee'
            : 'No assignee';
      groups.set(key, [...(groups.get(key) || []), item]);
      if (source && groupBy === 'source') {
        // Keep the source lookup warm for search/detail rendering.
      }
    }
    return Array.from(groups.entries()).map(([key, groupItems]) => ({ key, label: key, items: groupItems }));
  };

  const renderCard = (item: UsageProjectWorkItem) => {
    const source = sourceByKey.get(`${item.sourceType}:${item.sourceId || ''}`);
    const progress = itemChecklistProgress(item);
    return (
      <div
        key={item.id}
        draggable
        onDragStart={() => setDraggingItemId(item.id)}
        onDragEnd={() => setDraggingItemId(null)}
        className={cn(
          'relative overflow-hidden rounded-md border border-border/70 bg-background p-3 pl-4 text-xs shadow-sm',
          item.blocked && 'border-red-500/40 bg-red-500/5',
          isOverdue(item) && 'ring-1 ring-amber-500/40'
        )}
      >
        <span className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: item.color || '#3b82f6' }} />
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => openWorkItem(item)} className="min-w-0 text-left">
            <div className="line-clamp-2 font-semibold text-foreground">{item.title}</div>
            <div className="mt-1 truncate text-muted-foreground">{source?.label || SOURCE_LABELS[item.sourceType]}</div>
          </button>
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', priorityTone(item.priority))}>{item.priority}</span>
          {item.blocked ? <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">Blocked</span> : null}
          {isOverdue(item) ? <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">Overdue</span> : null}
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" /> Due {formatDate(item.dueDate)}</div>
          <div className="flex items-center gap-1.5"><Users className="h-3 w-3" /> {renderAssignees(item.assigneeIds)}</div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span>{progress.total ? `${progress.done}/${progress.total} checklist items` : 'No checklist items'}</span>
              <span className="font-medium text-foreground">{progress.percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
          {item.tags.length ? <div className="flex flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="rounded bg-muted px-1 py-0.5">{tag}</span>)}</div> : null}
        </div>
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => openWorkItem(item)}>
            <Edit3 className="h-3 w-3" />
            Open
          </Button>
        </div>
      </div>
    );
  };

  const timelineItems = filteredItems.filter((item) => item.startDate || item.dueDate);
  const timelineRange = useMemo(() => {
    if (timelinePreset === 'custom') {
      const fallbackStart = startOfLocalMonth(new Date());
      const startDate = startOfLocalDay(dateFromInputValue(timelineCustomStart, fallbackStart));
      const endDate = endOfLocalDay(dateFromInputValue(timelineCustomEnd, endOfLocalMonth(fallbackStart)));
      if (endDate.getTime() < startDate.getTime()) {
        return { start: startDate.getTime(), end: endOfLocalDay(startDate).getTime() };
      }
      return { start: startDate.getTime(), end: endDate.getTime() };
    }
    const preset = TIMELINE_PRESETS.find((entry) => entry.value === timelinePreset);
    const months = preset?.months || 3;
    const startDate = startOfLocalMonth(new Date());
    const endDate = endOfLocalMonth(addLocalMonths(startDate, months - 1));
    return { start: startDate.getTime(), end: endDate.getTime() };
  }, [timelineCustomEnd, timelineCustomStart, timelinePreset]);

  const visibleTimelineItems = useMemo(
    () => timelineItems.filter((item) => workItemOverlapsRange(item, timelineRange.start, timelineRange.end)),
    [timelineItems, timelineRange.end, timelineRange.start]
  );

  const timelineGridMarkers = useMemo(
    () => buildTimelineGridMarkers(timelineRange.start, timelineRange.end),
    [timelineRange.end, timelineRange.start]
  );

  const calendarMonths = useMemo(
    () => buildCalendarMonths(timelineRange.start, timelineRange.end),
    [timelineRange.end, timelineRange.start]
  );

  const positionForDate = (value?: string | null): number => {
    const time = value ? new Date(value).getTime() : Date.now();
    if (!Number.isFinite(time)) return 0;
    const percent = ((time - timelineRange.start) / Math.max(1, timelineRange.end - timelineRange.start)) * 100;
    return Math.max(0, Math.min(100, percent));
  };

  return (
    <WorkboardOverlayPortalContext.Provider value={overlayPortalElement}>
    <div
      className={cn(
        'relative space-y-4',
        fullScreenOpen && 'fixed inset-0 z-[70] overflow-y-auto bg-background p-4'
      )}
    >
      <div ref={setOverlayPortalElement} className="pointer-events-none" />
      <div className={cn('rounded-lg border border-border bg-card p-4', fullScreenOpen && 'sticky top-0 z-20 shadow-lg')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-foreground">Workboard</div>
              {fullScreenOpen ? (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                  Full screen
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Track delivery work for this budget without changing budget limits or usage blocking.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['table', 'kanban', 'timeline'] as WorkboardView[]).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setView(entry)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                  view === entry ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {entry}
              </button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setFullScreenOpen((current) => !current)}
              title={fullScreenOpen ? 'Exit full-screen Workboard' : 'Pop Workboard out full screen'}
            >
              {fullScreenOpen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {fullScreenOpen ? 'Exit full screen' : 'Full screen'}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border/70 bg-background p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Open items</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{stats.total}</div>
          </div>
          <div className="rounded-md border border-border/70 bg-background p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Done</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{stats.done}</div>
          </div>
          <div className="rounded-md border border-border/70 bg-background p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Blocked</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{stats.blocked}</div>
          </div>
          <div className="rounded-md border border-border/70 bg-background p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Overdue</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{stats.overdue}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs" placeholder="Search work..." />
          </div>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'all' | UsageProjectPriority)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
            <option value="all">All priorities</option>
            {PRIORITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
            <option value="all">All assignees</option>
            {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | UsageProjectWorkItemSourceType)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
            <option value="all">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as WorkboardGroupBy)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
            <option value="none">No grouping</option>
            <option value="assignee">Group by assignee</option>
            <option value="priority">Group by priority</option>
            <option value="source">Group by source</option>
          </select>
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            Archived
          </label>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => setColumnPanelOpen((current) => !current)}>
            <Columns3 className="h-3.5 w-3.5" />
            Columns
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => {
              setDraftSaveNotice('');
              setDraft(createDraft(project.id, defaultStatusId, project.color || '#3b82f6'));
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New item
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div> : null}
      {draftSaveNotice ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-xs text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {draftSaveNotice}
        </div>
      ) : null}
      {loading ? <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">Loading workboard...</div> : null}

      {columnPanelOpen ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">Kanban columns</div>
              <div className="mt-1 text-xs text-muted-foreground">Rename, reorder, set WIP limits, and mark Done or Archived columns.</div>
            </div>
            <div className="flex items-center gap-2">
              <input value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs" placeholder="New column" />
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={createColumn}>Add</Button>
            </div>
          </div>
          <div className="grid gap-2">
            {sortedColumns.map((column, index) => {
              const edit = columnDrafts[column.id] || { name: column.name, color: column.color || '#64748b', wipLimit: '', doneState: false, archivedState: false };
              return (
                <div key={column.id} className="grid items-end gap-2 rounded-md border border-border/70 bg-background p-2 md:grid-cols-[minmax(140px,1fr)_80px_90px_110px_110px_auto]">
                  <div className="grid gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Column name</label>
                    <input value={edit.name} onChange={(event) => setColumnDrafts((current) => ({ ...current, [column.id]: { ...edit, name: event.target.value } }))} className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Color</label>
                    <input type="color" value={edit.color} onChange={(event) => setColumnDrafts((current) => ({ ...current, [column.id]: { ...edit, color: event.target.value } }))} className="h-8 w-full rounded-md border border-input bg-background p-1" />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground">WIP limit</label>
                    <input value={edit.wipLimit} onChange={(event) => setColumnDrafts((current) => ({ ...current, [column.id]: { ...edit, wipLimit: event.target.value.replace(/[^\d]/g, '') } }))} className="h-8 rounded-md border border-input bg-background px-2 text-xs" placeholder="None" />
                  </div>
                  <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={edit.doneState} onChange={(event) => setColumnDrafts((current) => ({ ...current, [column.id]: { ...edit, doneState: event.target.checked } }))} /> Done</label>
                  <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={edit.archivedState} onChange={(event) => setColumnDrafts((current) => ({ ...current, [column.id]: { ...edit, archivedState: event.target.checked } }))} /> Archived</label>
                  <div className="flex items-center justify-end gap-1">
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={index === 0} onClick={() => void moveColumn(column, -1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={index === sortedColumns.length - 1} onClick={() => void moveColumn(column, 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => void saveColumn(column)}>Save</Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={sortedColumns.length <= 1} onClick={() => void deleteColumn(column)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createQuickItem(); }} className="h-8 min-w-[240px] flex-1 rounded-md border border-input bg-background px-2 text-xs" placeholder="Quick add a work item..." />
        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={defaultStatusId} disabled>
          <option>{sortedColumns.find((column) => column.id === defaultStatusId)?.name || 'Default column'}</option>
        </select>
        <Button type="button" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void createQuickItem()}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void archiveDoneItems()}>
          <Archive className="h-3.5 w-3.5" />
          Archive done
        </Button>
      </div>

      {view === 'table' ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[minmax(220px,1.5fr)_130px_110px_150px_130px_120px_120px_110px] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground">
              <span>Name</span><span>Status</span><span>Priority</span><span>Assignees</span><span>Due</span><span>Source</span><span>Tags</span><span />
            </div>
            {filteredItems.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">No work items match this view.</div>
            ) : filteredItems.map((item) => {
              const progress = itemChecklistProgress(item);
              return (
              <div key={item.id} className="grid grid-cols-[minmax(220px,1.5fr)_130px_110px_150px_130px_120px_120px_110px] gap-3 border-b border-border/50 px-3 py-2 text-xs last:border-b-0">
                <button type="button" onClick={() => openWorkItem(item)} className="min-w-0 text-left">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color || '#3b82f6' }} />
                    <span className="truncate font-medium text-foreground">{item.title}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{item.description || 'No description'}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="shrink-0">Checklist {progress.percent}%</span>
                    <span className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                    </span>
                  </div>
                </button>
                <select value={item.statusId} onChange={(event) => void updateItem(item, { statusId: event.target.value })} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                  {sortedColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
                </select>
                <select value={item.priority} onChange={(event) => void updateItem(item, { priority: event.target.value as UsageProjectPriority })} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                  {PRIORITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
                <div className="min-w-0 self-center">{renderAssignees(item.assigneeIds)}</div>
                <div className={cn('self-center text-muted-foreground', isOverdue(item) && 'text-amber-300')}>{formatDate(item.dueDate)}</div>
                <div className="truncate self-center text-muted-foreground">{SOURCE_LABELS[item.sourceType]}</div>
                <div className="truncate self-center text-muted-foreground">{item.tags.join(', ') || 'No tags'}</div>
                <div className="flex items-center justify-end gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => openWorkItem(item)}>
                    <Edit3 className="h-3.5 w-3.5" />
                    Open
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void archiveItem(item, !item.archived)}>{item.archived ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}</Button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === 'kanban' ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
          <div className="flex min-h-[420px] gap-3" style={{ minWidth: `${Math.max(sortedColumns.length * 280, 900)}px` }}>
            {sortedColumns.map((column) => {
              const columnItems = filteredItems.filter((item) => item.statusId === column.id);
              const wipExceeded = column.wipLimit != null && columnItems.filter((item) => !item.archived).length > column.wipLimit;
              return (
                <div
                  key={column.id}
                  className="flex w-[268px] shrink-0 flex-col rounded-lg border border-border/70 bg-background"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const item = items.find((entry) => entry.id === draggingItemId);
                    if (item && item.statusId !== column.id) void updateItem(item, { statusId: column.id });
                    setDraggingItemId(null);
                  }}
                >
                  <div className="border-b border-border/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.color || '#64748b' }} />
                          <span className="truncate text-sm font-semibold text-foreground">{column.name}</span>
                        </div>
                        <div className={cn('mt-1 text-[11px] text-muted-foreground', wipExceeded && 'text-amber-300')}>
                          {columnItems.length} item{columnItems.length === 1 ? '' : 's'}{column.wipLimit == null ? '' : ` / ${column.wipLimit} WIP`}
                        </div>
                      </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        setDraftSaveNotice('');
                        setDraft(createDraft(project.id, column.id, project.color || column.color || '#3b82f6'));
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto p-2">
                    {columnItems.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Drop work here</div>
                    ) : groupItems(columnItems).map((group) => (
                      <div key={`${column.id}:${group.key}`} className="space-y-2">
                        {group.label ? <div className="px-1 text-[10px] font-medium uppercase text-muted-foreground">{group.label}</div> : null}
                        {group.items.map(renderCard)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === 'timeline' ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">Timeline</div>
              <div className="mt-1 text-xs text-muted-foreground">Date bars use each item's start date and due date. Switch to calendar for a month grid view.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={timelinePreset}
                onChange={(event) => setTimelinePreset(event.target.value as TimelineRangePreset)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Timeline date range"
              >
                {TIMELINE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </select>
              {timelinePreset === 'custom' ? (
                <>
                  <input
                    type="date"
                    value={timelineCustomStart}
                    onChange={(event) => setTimelineCustomStart(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    aria-label="Timeline custom start date"
                  />
                  <input
                    type="date"
                    value={timelineCustomEnd}
                    onChange={(event) => setTimelineCustomEnd(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    aria-label="Timeline custom end date"
                  />
                </>
              ) : null}
              <div className="flex rounded-md border border-border bg-background p-0.5">
                {(['timeline', 'calendar'] as TimelineDisplayMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTimelineDisplayMode(mode)}
                    className={cn(
                      'rounded px-2 py-1 text-xs font-medium capitalize',
                      timelineDisplayMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-3 text-xs text-muted-foreground">
            {new Date(timelineRange.start).toLocaleDateString()} - {new Date(timelineRange.end).toLocaleDateString()}
          </div>
          {timelineDisplayMode === 'timeline' ? (
            <div className="relative overflow-x-auto">
              <div className="min-w-[900px] space-y-2">
                <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-background p-2 text-xs">
                  <div className="flex items-center font-medium text-foreground">Date grid</div>
                  <div className="relative h-14 overflow-hidden rounded bg-muted/40">
                    {timelineGridMarkers.map((marker) => {
                      const left = rangePercent(marker.time, timelineRange.start, timelineRange.end);
                      return (
                        <div key={marker.id} className="absolute bottom-0 top-0 border-l border-border/80" style={{ left: `${left}%` }}>
                          <span className="ml-1 whitespace-nowrap text-[10px] text-muted-foreground">{marker.label}</span>
                        </div>
                      );
                    })}
                    {Date.now() >= timelineRange.start && Date.now() <= timelineRange.end ? (
                      <div className="absolute bottom-0 top-0 z-10 border-l border-amber-400" style={{ left: `${rangePercent(Date.now(), timelineRange.start, timelineRange.end)}%` }}>
                        <span className="ml-1 whitespace-nowrap text-[10px] text-amber-300">Today</span>
                      </div>
                    ) : null}
                    {budgetWindows.filter((window) => {
                      const start = new Date(window.startsAt).getTime();
                      return Number.isFinite(start) && start >= timelineRange.start && start <= timelineRange.end;
                    }).map((window) => {
                      const left = positionForDate(window.startsAt);
                      return (
                        <div key={window.id} className="absolute bottom-0 top-5 z-10 border-l border-primary/70" style={{ left: `${left}%` }} title={`${window.name} starts ${formatDate(window.startsAt)}`}>
                          <span className="ml-1 whitespace-nowrap text-[10px] text-primary">{window.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {visibleTimelineItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">No dated work items in this range.</div>
                ) : visibleTimelineItems.map((item) => {
                  const start = item.startDate || item.dueDate;
                  const end = item.dueDate || item.startDate;
                  const left = positionForDate(start);
                  const right = positionForDate(end);
                  const width = Math.max(2, Math.abs(right - left));
                  const progress = itemChecklistProgress(item);
                  return (
                    <button key={item.id} type="button" onClick={() => openWorkItem(item)} className="grid w-full grid-cols-[220px_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-background p-2 text-left text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{item.title}</div>
                        <div className="mt-0.5 text-muted-foreground">{formatDate(item.startDate)} - {formatDate(item.dueDate)}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="shrink-0">Checklist {progress.percent}%</span>
                          <span className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                          </span>
                        </div>
                      </div>
                      <div className="relative h-8 overflow-hidden rounded bg-muted/50">
                        {timelineGridMarkers.map((marker) => (
                          <span
                            key={marker.id}
                            className="pointer-events-none absolute bottom-0 top-0 border-l border-border/40"
                            style={{ left: `${rangePercent(marker.time, timelineRange.start, timelineRange.end)}%` }}
                          />
                        ))}
                        <div
                          className={cn('absolute top-1 z-10 h-6 rounded border px-2 text-[11px] leading-6', item.blocked ? 'border-red-500/40 bg-red-500/20 text-red-200' : 'border-primary/40 bg-primary/20 text-primary')}
                          style={{ left: `${Math.min(left, right)}%`, width: `${width}%` }}
                        >
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: item.color || '#3b82f6' }} />
                          <span className="truncate">{item.priority}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {calendarMonths.map((month) => {
                const days = buildCalendarDays(month);
                return (
                  <div key={month.toISOString()} className="rounded-md border border-border/70 bg-background p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">{monthLabel(month)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {visibleTimelineItems.filter((item) => workItemOverlapsRange(item, startOfLocalMonth(month).getTime(), endOfLocalMonth(month).getTime())).length} item(s)
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-muted-foreground">
                      {WEEKDAY_LABELS.map((label) => <div key={label}>{label}</div>)}
                    </div>
                    <div className="mt-1 grid grid-cols-7 gap-1">
                      {days.map((day) => {
                        const dayItems = visibleTimelineItems.filter((item) => workItemCoversDay(item, day));
                        const outsideMonth = day.getMonth() !== month.getMonth();
                        const today = startOfLocalDay(day).getTime() === startOfLocalDay(new Date()).getTime();
                        return (
                          <div
                            key={day.toISOString()}
                            className={cn(
                              'min-h-[82px] rounded border border-border/50 bg-card/40 p-1 text-left',
                              outsideMonth && 'opacity-45',
                              today && 'ring-1 ring-amber-400/70'
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                              <span>{day.getDate()}</span>
                              {dayItems.length > 3 ? <span>+{dayItems.length - 3}</span> : null}
                            </div>
                            <div className="space-y-1">
                              {dayItems.slice(0, 3).map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => openWorkItem(item)}
                                  className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-primary"
                                  style={{ backgroundColor: `${item.color || '#3b82f6'}22` }}
                                  title={item.title}
                                >
                                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: item.color || '#3b82f6' }} />
                                  {item.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {draft ? (
        <div
          data-workboard-draft-overlay
          className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (document.body.dataset.workboardDrawingPopoutOpen === 'true') return;
            if (document.body.dataset.workboardNotePopoutOpen === 'true') return;
            if (event.currentTarget === event.target) setDraft(null);
          }}
          onWheel={(event) => {
            if (document.body.dataset.workboardNotePopoutOpen === 'true' && event.currentTarget === event.target) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <div className="w-full max-w-5xl rounded-lg border border-border bg-card p-4 shadow-2xl">
          <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
            <div>
              <div className="text-sm font-semibold text-foreground">{draft.id ? 'Edit work item' : 'New work item'}</div>
              <div className="mt-1 text-xs text-muted-foreground">Open, inspect, edit, and save this work item.</div>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDraft(null)}>
              <X className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Work item title" />
            </div>
            <div className="grid gap-1 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="min-h-20 rounded-md border border-input bg-background px-2 py-2 text-sm" placeholder="Scope, acceptance notes, or handoff details" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select value={draft.statusId} onChange={(event) => setDraft({ ...draft, statusId: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {sortedColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as UsageProjectPriority })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {PRIORITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Color badge</label>
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
                <input
                  type="color"
                  value={draft.color || '#3b82f6'}
                  onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                  className="h-8 w-12 rounded-md border border-input bg-background p-1"
                  aria-label="Work item color badge"
                />
                {WORK_ITEM_COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setDraft({ ...draft, color })}
                    className={cn(
                      'h-5 w-5 rounded-full border border-border transition-transform hover:scale-110',
                      (draft.color || '#3b82f6').toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Use work item color ${color}`}
                    title={color}
                  />
                ))}
                <span className="ml-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: draft.color || '#3b82f6' }} />
                  Badge preview
                </span>
              </div>
            </div>
            <div className="grid min-w-0 gap-1">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <select
                value={draft.sourceType === 'manual' ? '' : `${draft.sourceType}:${draft.sourceId}`}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) {
                    setDraft({ ...draft, sourceType: 'manual', sourceId: '' });
                    return;
                  }
                  const [sourceType, ...idParts] = value.split(':');
                  const option = sourceOptions.find((entry) => entry.sourceType === sourceType && entry.sourceId === idParts.join(':'));
                  setDraft({
                    ...draft,
                    sourceType: option?.sourceType || 'manual',
                    sourceId: option?.sourceId || '',
                    title: draft.title || option?.label || '',
                    assigneeIds: draft.assigneeIds.length ? draft.assigneeIds : option?.assigneeIds || draft.assigneeIds,
                  });
                }}
                className="h-9 w-full min-w-0 truncate rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Manual item</option>
                {sourceOptions.map((option) => (
                  <option
                    key={`${option.sourceType}:${option.sourceId}`}
                    value={`${option.sourceType}:${option.sourceId}`}
                    title={`${SOURCE_LABELS[option.sourceType]} - ${option.label}`}
                  >
                    {formatSourceOptionLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">Tags</label>
              <input value={draft.tagsText} onChange={(event) => setDraft({ ...draft, tagsText: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Comma separated tags" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">Start date</label>
              <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground">Due date</label>
              <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </div>
            <div className="grid gap-1 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Assignees</label>
              <WorkboardAssigneePicker assignees={assignees} value={draft.assigneeIds} onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })} />
            </div>
            <div className="grid gap-1 md:col-span-2">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <input type="checkbox" checked={draft.blocked} onChange={(event) => setDraft({ ...draft, blocked: event.target.checked })} />
                Blocked
              </label>
              {draft.blocked ? (
                <input value={draft.blockedReason} onChange={(event) => setDraft({ ...draft, blockedReason: event.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Why is this blocked?" />
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-background p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Lists</div>
                <div className="flex min-w-[260px] flex-1 flex-wrap justify-end gap-2 sm:flex-none">
                  <CsvExportPicker
                    type="lists"
                    candidates={draftListCsvCandidates}
                    filenameScope={`${project.name}-${draft.title || 'work-item'}`}
                    resolveAssigneeNames={resolveCsvAssigneeNames}
                  />
                  <input
                    value={draft.newListName}
                    onChange={(event) => setDraft({ ...draft, newListName: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addDraftChecklistList();
                      }
                    }}
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="New list name"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={addDraftChecklistList}>
                    Add list
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {draft.checklistLists.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No lists yet. Add a list such as Design, Build, Review, or Launch.
                  </div>
                ) : draft.checklistLists.map((list) => {
                  const listMetaOpen = list.items.length > 0 && list.items.every((item) => expandedChecklistMeta[checklistMetaKey(list.id, item.id)]);
                  const listProgress = checklistProgress(list.items);
                  const collapseKey = checklistListCollapseKey(project.id, draft.id, list.id);
                  const listCollapsed = collapsedChecklistLists[collapseKey] === true;
                  return (
                  <div key={list.id} className="rounded-md border border-border/70 bg-card/50 p-2" style={workItemOutlineStyle(list.outlineColor)}>
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        value={list.name}
                        onChange={(event) => updateDraftChecklistList(list.id, (current) => ({ ...current, name: event.target.value, updatedAt: nowIso() }))}
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs font-medium"
                        placeholder="List name"
                        title={list.name || 'Checklist'}
                      />
                      <ChecklistListProgressBadge progress={listProgress} />
                      <ChecklistListPromptButton
                        list={list}
                        workItemTitle={draft.title}
                        resolveAssigneeNames={(assigneeIds) => (assigneeIds || [])
                          .map((id) => assigneeNameById.get(id) || '')
                          .filter(Boolean)}
                        onSavePromptAsNote={(title, prompt) => {
                          const note: UsageProjectWorkItemNote = {
                            id: localId(),
                            title,
                            text: prompt,
                            html: plainTextToNoteHtml(prompt),
                            createdAt: nowIso(),
                          };
                          setDraft((current) => current ? ({ ...current, notes: [note, ...(current.notes || [])] }) : current);
                        }}
                      />
                      <WorkItemOutlineColorPicker
                        value={list.outlineColor}
                        onChange={(outlineColor) => updateDraftChecklistList(list.id, (current) => ({ ...current, outlineColor, updatedAt: nowIso() }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        title={listCollapsed ? 'Expand list' : 'Collapse list'}
                        aria-label={listCollapsed ? 'Expand list' : 'Collapse list'}
                        onClick={() => toggleChecklistListCollapsed(collapseKey)}
                      >
                        {listCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        disabled={list.items.length === 0}
                        title={listMetaOpen ? 'Hide assignee and due date fields for this list' : 'Show assignee and due date fields for this list'}
                        onClick={() => setChecklistListMetaOpen(list, !listMetaOpen)}
                      >
                        {listMetaOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => removeDraftChecklistList(list.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="mb-2 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{listProgress.percent}% complete</span>
                        <span>{listProgress.done}/{listProgress.total} item{listProgress.total === 1 ? '' : 's'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${listProgress.percent}%` }} />
                        </div>
                        <ChecklistListContextButton
                          value={list.context}
                          onSave={(context) => updateDraftChecklistList(list.id, (current) => ({ ...current, context, updatedAt: nowIso() }))}
                        />
                      </div>
                    </div>
                    {!listCollapsed ? (
                    <>
                    <div className="space-y-1.5">
                      {list.items.length === 0 ? (
                        <div className="rounded border border-dashed border-border/70 px-2 py-2 text-[11px] text-muted-foreground">
                          No items in this list.
                        </div>
                      ) : list.items.map((entry) => {
                        const metaOpen = expandedChecklistMeta[checklistMetaKey(list.id, entry.id)] === true;
                        const assigneeName = entry.assigneeIds?.[0] ? assigneeNameById.get(entry.assigneeIds[0]) || 'Unknown assignee' : 'No assignee';
                        const dueDateLabel = entry.dueDate ? formatDate(entry.dueDate) : 'No due date';
                        return (
                          <div key={entry.id} className="grid gap-1.5 rounded border border-border/60 bg-background px-2 py-2 text-xs">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={entry.completed}
                                onChange={(event) => updateDraftChecklistItem(list.id, entry.id, { completed: event.target.checked })}
                              />
                              <div className="flex min-w-0 flex-1 items-stretch rounded-md border border-input bg-background">
                                <AutoGrowingTextarea
                                  value={entry.text}
                                  onChange={(event) => updateDraftChecklistItem(list.id, entry.id, { text: event.target.value })}
                                  className={cn(
                                    'min-h-8 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-xs leading-relaxed outline-none',
                                    'whitespace-pre-wrap break-words',
                                    entry.completed && 'text-muted-foreground line-through'
                                  )}
                                  placeholder="List item"
                                />
                                <button
                                  type="button"
                                  className={cn('flex min-h-8 w-8 shrink-0 items-center justify-center border-l border-border/60 text-muted-foreground hover:text-foreground', entry.assigneeIds?.length && 'text-primary')}
                                  title={`Assignee: ${assigneeName}`}
                                  aria-label={`Assignee: ${assigneeName}`}
                                  onClick={() => toggleChecklistItemMeta(list.id, entry.id)}
                                >
                                  <Users className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className={cn('flex min-h-8 w-8 shrink-0 items-center justify-center border-l border-border/60 text-muted-foreground hover:text-foreground', entry.dueDate && 'text-primary')}
                                  title={`Due date: ${dueDateLabel}`}
                                  aria-label={`Due date: ${dueDateLabel}`}
                                  onClick={() => toggleChecklistItemMeta(list.id, entry.id)}
                                >
                                  <CalendarDays className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="flex min-h-8 w-8 shrink-0 items-center justify-center border-l border-border/60 text-muted-foreground hover:text-destructive"
                                  title="Delete list item"
                                  aria-label="Delete list item"
                                  onClick={() => removeDraftChecklistItem(list.id, entry.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            {metaOpen ? (
                              <div className="grid gap-2 pl-6 sm:grid-cols-2">
                                <div className="grid gap-1">
                                  <label className="text-[10px] font-medium uppercase text-muted-foreground">Assignee</label>
                                  <select
                                    value={entry.assigneeIds?.[0] || ''}
                                    onChange={(event) => updateDraftChecklistItem(list.id, entry.id, { assigneeIds: event.target.value ? [event.target.value] : [] })}
                                    className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
                                  >
                                    <option value="">No assignee</option>
                                    {assignees.map((assignee) => (
                                      <option key={assignee.id} value={assignee.id}>{assignee.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="grid gap-1">
                                  <label className="text-[10px] font-medium uppercase text-muted-foreground">Due date</label>
                                  <input
                                    type="date"
                                    value={toDateInput(entry.dueDate)}
                                    onChange={(event) => updateDraftChecklistItem(list.id, entry.id, { dueDate: fromDateInput(event.target.value) })}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <AutoGrowingTextarea
                        value={draft.newChecklistTextByListId[list.id] || ''}
                        onChange={(event) => setDraft({
                          ...draft,
                          newChecklistTextByListId: {
                            ...draft.newChecklistTextByListId,
                            [list.id]: event.target.value,
                          },
                        })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            addDraftChecklistItem(list.id);
                          }
                        }}
                        className="min-h-8 flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words"
                        placeholder={`Add item to ${list.name || 'list'}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => addDraftChecklistItem(list.id)}
                      >
                        Add item
                      </Button>
                    </div>
                    </>
                    ) : null}
                  </div>
                  );
                })}
              </div>
              {draft.checklistLists.length === 0 ? (
                <div className="mt-2 flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setDraft({ ...draft, checklistLists: [createChecklistList('Checklist')] })}>
                    Create first list
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-border/70 bg-background p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Tag className="h-3.5 w-3.5" /> Notes</div>
                <CsvExportPicker
                  type="notes"
                  candidates={draftNoteCsvCandidates}
                  filenameScope={`${project.name}-${draft.title || 'work-item'}`}
                />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {draft.notes.length === 0 ? <div className="text-xs text-muted-foreground">No notes yet.</div> : draft.notes.map((note) => (
                  <RichWorkItemNoteEditor
                    key={note.id}
                    note={note}
                    workItemTitle={draft.title}
                    onSavePromptAsNote={(title, prompt) => {
                      const text = prompt.trim();
                      if (!text) return;
                      const newNote: UsageProjectWorkItemNote = {
                        id: localId(),
                        title: title.trim() || 'Generated prompt',
                        text,
                        html: plainTextToNoteHtml(text),
                        createdAt: nowIso(),
                      };
                      setDraft((current) => current
                        ? { ...current, notes: [newNote, ...current.notes] }
                        : current);
                    }}
                    onChange={(nextNote) => setDraft((current) => current
                      ? { ...current, notes: current.notes.map((entry) => entry.id === note.id ? nextNote : entry) }
                      : current)}
                    onDelete={() => setDraft((current) => current
                      ? { ...current, notes: current.notes.filter((entry) => entry.id !== note.id) }
                      : current)}
                  />
                ))}
              </div>
              <div className="mt-2 grid gap-2">
                <input
                  value={draft.newNoteTitle}
                  onChange={(event) => setDraft({ ...draft, newNoteTitle: event.target.value })}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="Note title"
                />
                <div className="flex gap-2">
                <input value={draft.newNoteText} onChange={(event) => setDraft({ ...draft, newNoteText: event.target.value })} className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" placeholder="Add note" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    const text = draft.newNoteText.trim();
                    if (!text) return;
                    const title = draft.newNoteTitle.trim();
                    const html = plainTextToNoteHtml(text);
                    setDraft({
                      ...draft,
                      notes: [{ id: localId(), title: title || undefined, text, html, createdAt: nowIso() }, ...draft.notes],
                      newNoteTitle: '',
                      newNoteText: '',
                    });
                  }}
                >
                  Add
                </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-background p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Square className="h-3.5 w-3.5" />
                    Drawings
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Create simple diagrams with shapes, lines, arrows, colors, and movable elements.
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={addDraftDrawing}>
                  <Plus className="h-3.5 w-3.5" />
                  New drawing
                </Button>
              </div>
              <div className="max-h-[520px] space-y-3 overflow-y-auto">
                {draft.drawings.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No drawings yet. Add a drawing to sketch layouts, flows, or quick visual notes.
                  </div>
                ) : draft.drawings.map((drawing) => (
                  <DrawingEditor
                    key={drawing.id}
                    drawing={drawing}
                    onChange={updateDraftDrawing}
                    onDelete={() => removeDraftDrawing(drawing.id)}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border/70 bg-background p-3">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    Documents
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Link local files, Google Docs, or Microsoft 365 documents to this work item.
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void addLocalDocuments()}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Add from PC
                </Button>
              </div>
              <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                Local files are linked from their current location. If the file is moved, renamed, or deleted, this link will break.
              </div>
              <div className="grid gap-2 rounded-md border border-border/60 bg-card/50 p-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
                  <input
                    value={draft.newDocumentLabel}
                    onChange={(event) => setDraft({ ...draft, newDocumentLabel: event.target.value })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Label optional"
                  />
                  <input
                    value={draft.newDocumentUrl}
                    onChange={(event) => setDraft({ ...draft, newDocumentUrl: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addUrlDocument();
                      }
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Google Doc, Microsoft 365, or web URL"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={addUrlDocument}>
                    <Link className="h-3.5 w-3.5" />
                    Add link
                  </Button>
                </div>
              </div>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {draft.documents.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No documents linked yet.
                  </div>
                ) : draft.documents.map((documentLink) => {
                  const isEditingDocument = editingDocument?.id === documentLink.id;
                  const documentTarget = targetForDocumentLink(documentLink);
                  const promptNotice = documentPromptNotice?.documentId === documentLink.id ? documentPromptNotice : null;
                  return (
                  <div key={documentLink.id} className="rounded-md border border-border/60 bg-card/50 p-2 text-xs" style={workItemOutlineStyle(documentLink.outlineColor)}>
                    {isEditingDocument ? (
                      <div className="grid gap-2">
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                          <label className="grid gap-1">
                            <span className="text-[10px] font-medium uppercase text-muted-foreground">Label</span>
                            <WorkItemNameTooltip value={editingDocument.label || 'Untitled document'}>
                              <input
                                value={editingDocument.label}
                                onChange={(event) => setEditingDocument({ ...editingDocument, label: event.target.value })}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                placeholder="Document label"
                              />
                            </WorkItemNameTooltip>
                          </label>
                          {documentLink.kind === 'url' ? (
                            <label className="grid gap-1">
                              <span className="text-[10px] font-medium uppercase text-muted-foreground">Document link</span>
                              <input
                                value={editingDocument.target}
                                onChange={(event) => setEditingDocument({ ...editingDocument, target: event.target.value })}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                placeholder="https://docs.google.com/..."
                              />
                            </label>
                          ) : (
                            <div className="grid gap-1">
                              <span className="text-[10px] font-medium uppercase text-muted-foreground">Linked document</span>
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="min-w-0 flex-1 truncate rounded-md border border-input bg-background px-2 py-1.5 text-[11px] text-muted-foreground" title={editingDocument.target}>
                                  {editingDocument.target || 'No document selected'}
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                                  onClick={() => void relinkLocalDocument(documentLink)}
                                  title="Choose the same document again or relink this row to another local document."
                                >
                                  <FolderOpen className="h-3.5 w-3.5" />
                                  Choose file
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                          Relinking changes this saved document row only. Local file links still break if that file is moved, renamed, or deleted.
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={cancelEditingDocument}>
                            Cancel
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => saveEditedDocument(documentLink)}>
                            Save document
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            {documentLink.kind === 'url' ? <Link className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                            <WorkItemNameTooltip value={documentLink.label || 'Untitled document'}>
                              <span className="truncate">{documentLink.label || 'Untitled document'}</span>
                            </WorkItemNameTooltip>
                          </div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground" title={documentTarget}>
                            {documentTarget}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <WorkItemOutlineColorPicker
                            value={documentLink.outlineColor}
                            onChange={(outlineColor) => setDraft({
                              ...draft,
                              documents: draft.documents.map((entry) => entry.id === documentLink.id ? { ...entry, outlineColor } : entry),
                            })}
                            className="h-7 w-7"
                          />
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void openDocumentLink(documentLink)}>
                            Open
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn(
                              'h-7 gap-1 px-2 text-[11px]',
                              promptNotice?.kind === 'success' && 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
                              promptNotice?.kind === 'error' && 'border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-200'
                            )}
                            onClick={() => attachDocumentToPrompt(documentLink)}
                            title={documentLink.kind === 'local'
                              ? 'Attach this local document file to the active Chat or Build prompt.'
                              : 'Insert this document link into the active Chat or Build prompt.'}
                          >
                            {promptNotice?.kind === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
                            {promptNotice?.kind === 'success' ? 'Attached' : 'Attach'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            onClick={() => startEditingDocument(documentLink)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => {
                              if (editingDocument?.id === documentLink.id) setEditingDocument(null);
                              setDraft({ ...draft, documents: draft.documents.filter((entry) => entry.id !== documentLink.id) });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {promptNotice ? (
                      <div className={cn(
                        'mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px]',
                        promptNotice.kind === 'success'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100'
                          : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-100'
                      )}>
                        {promptNotice.kind === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <X className="h-3.5 w-3.5 shrink-0" />}
                        <span>{promptNotice.text}</span>
                      </div>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border border-border/70 bg-background p-3">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Search className="h-3.5 w-3.5" />
                    Sources
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Save research sources as title, link, and description on this work item.
                  </div>
                </div>
              </div>
              <div className="grid gap-2 rounded-md border border-border/60 bg-card/50 p-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.1fr)_auto]">
                  <input
                    value={draft.newSourceTitle}
                    onChange={(event) => setDraft({ ...draft, newSourceTitle: event.target.value })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Source title"
                  />
                  <input
                    value={draft.newSourceUrl}
                    onChange={(event) => setDraft({ ...draft, newSourceUrl: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addSourceLink();
                      }
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="https://example.com/source"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={addSourceLink}>
                    <Plus className="h-3.5 w-3.5" />
                    Add source
                  </Button>
                </div>
                <textarea
                  value={draft.newSourceDescription}
                  onChange={(event) => setDraft({ ...draft, newSourceDescription: event.target.value })}
                  className="min-h-16 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  placeholder="Why this source matters, what it supports, or citation notes"
                />
              </div>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {draft.sources.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No sources saved yet.
                  </div>
                ) : draft.sources.map((source) => (
                  <div key={source.id} className="rounded-md border border-border/60 bg-card/50 p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid min-w-0 flex-1 gap-2">
                        <input
                          value={source.title}
                          onChange={(event) => setDraft({
                            ...draft,
                            sources: draft.sources.map((entry) => entry.id === source.id ? { ...entry, title: event.target.value, updatedAt: nowIso() } : entry),
                          })}
                          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs font-medium"
                          placeholder="Source title"
                          title={source.title}
                        />
                        <input
                          value={source.url}
                          onChange={(event) => setDraft({
                            ...draft,
                            sources: draft.sources.map((entry) => entry.id === source.id ? { ...entry, url: event.target.value, updatedAt: nowIso() } : entry),
                          })}
                          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-[11px]"
                          placeholder="https://example.com/source"
                          title={source.url}
                        />
                        <textarea
                          value={source.description || ''}
                          onChange={(event) => setDraft({
                            ...draft,
                            sources: draft.sources.map((entry) => entry.id === source.id ? { ...entry, description: event.target.value || undefined, updatedAt: nowIso() } : entry),
                          })}
                          className="min-h-14 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                          placeholder="Description"
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Open source"
                          aria-label="Open source"
                          onClick={() => void openSourceLink(source)}
                        >
                          <Link className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Copy source link"
                          aria-label="Copy source link"
                          onClick={() => copySourceLink(source)}
                        >
                          <ClipboardCopy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Delete source"
                          aria-label="Delete source"
                          onClick={() => setDraft({ ...draft, sources: draft.sources.filter((entry) => entry.id !== source.id) })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={draft.archived} onChange={(event) => setDraft({ ...draft, archived: event.target.checked })} />
              Archived
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {draftSaveNotice ? (
                <span className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {draftSaveNotice}
                </span>
              ) : null}
              {draft.id ? (
                <Button type="button" variant="outline" size="sm" onClick={() => draft.id && void archiveItem({ ...items.find((item) => item.id === draft.id)!, archived: draft.archived }, !draft.archived)}>
                  {draft.archived ? 'Restore' : 'Archive'}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)} disabled={draftSaving}>Cancel</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void saveDraft(true)} disabled={!draft.title.trim() || draftSaving} title="Save and close this work item">
                Save &amp; close
              </Button>
              <Button type="button" size="sm" onClick={() => void saveDraft(false)} disabled={!draft.title.trim() || draftSaving}>
                {draftSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
          </div>
        </div>
      ) : null}
    </div>
    </WorkboardOverlayPortalContext.Provider>
  );
}
