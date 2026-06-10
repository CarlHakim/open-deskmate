import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type {
  UsageAssignee,
  UsageProject,
  UsageProjectKanbanColumn,
  UsageProjectWorkItem,
  UsageProjectWorkItemChecklistItem,
  UsageProjectWorkItemChecklistList,
  UsageProjectWorkItemDocumentLink,
  UsageProjectWorkItemDrawing,
  UsageProjectWorkItemNote,
  UsageProjectWorkItemUpdate,
} from '@accomplish/shared';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  FolderOpen,
  GripVertical,
  Link,
  Loader2,
  Lock,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import { getAccomplish } from '@/lib/accomplish';
import {
  checklistProgress,
  createChecklistList,
  createWorkItemDrawing,
  DrawingEditor,
  flattenChecklistLists,
  getChecklistListsFromItem,
  labelForDocumentTarget,
  localId,
  nowIso,
  RichWorkItemNoteEditor,
} from '@/components/usage/ProjectWorkboardTab';

type ProjectWorkTab = 'lists' | 'notes' | 'documents' | 'drawings';

type PopupBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SaveState = {
  status: 'saving' | 'saved' | 'error';
  message?: string;
};

type BuildProjectWorkPopupProps = {
  open: boolean;
  projects: UsageProject[];
  assignees: UsageAssignee[];
  linkedProjectId?: string | null;
  sourceLabel?: string | null;
  fallbackLabel?: string;
  presetProjectId?: string | null;
  selectedPresetName?: string | null;
  initialProjectId?: string | null;
  anchorRect?: RectLike | null;
  storageScope?: string;
  defaultSide?: 'left' | 'right';
  onSelectedProjectChange?: (projectId: string | null) => void;
  onClose: () => void;
};

const POPUP_BOUNDS_STORAGE_PREFIX = 'open-deskmate-build-project-work-popup-bounds:';
const POPUP_STATE_FILTER_STORAGE_PREFIX = 'open-deskmate-build-project-work-popup-state-filter:';
const STATE_FILTER_SHOW_ALL_ID = '__all__';
const POPUP_MIN_WIDTH = 360;
const POPUP_MIN_HEIGHT = 360;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function defaultBounds(anchorRect?: RectLike | null, defaultSide: 'left' | 'right' = 'right'): PopupBounds {
  const viewportWidth = Math.max(900, window.innerWidth || 1200);
  const viewportHeight = Math.max(650, window.innerHeight || 800);
  const width = clamp(Math.round(viewportWidth * 0.25), POPUP_MIN_WIDTH, Math.min(620, viewportWidth - 32));
  const height = clamp(Math.round(anchorRect?.height || viewportHeight - 160), POPUP_MIN_HEIGHT, viewportHeight - 32);
  const top = clamp(Math.round(anchorRect?.top || 120), 16, viewportHeight - height - 16);
  const defaultLeft = defaultSide === 'left'
    ? Math.round(anchorRect?.left ?? 72)
    : Math.round(viewportWidth - width - 32);
  const left = clamp(defaultLeft, 16, viewportWidth - width - 16);
  return { left, top, width, height };
}

function boundsStorageKey(scope: string): string {
  return `${POPUP_BOUNDS_STORAGE_PREFIX}${scope || 'build'}`;
}

function clampBounds(bounds: PopupBounds): PopupBounds {
  const viewportWidth = Math.max(640, window.innerWidth || 1200);
  const viewportHeight = Math.max(480, window.innerHeight || 800);
  const width = clamp(Math.round(bounds.width), POPUP_MIN_WIDTH, Math.max(POPUP_MIN_WIDTH, viewportWidth - 32));
  const height = clamp(Math.round(bounds.height), POPUP_MIN_HEIGHT, Math.max(POPUP_MIN_HEIGHT, viewportHeight - 32));
  return {
    width,
    height,
    left: clamp(Math.round(bounds.left), 16, Math.max(16, viewportWidth - width - 16)),
    top: clamp(Math.round(bounds.top), 16, Math.max(16, viewportHeight - height - 16)),
  };
}

function readStoredBounds(anchorRect?: RectLike | null, scope = 'build', defaultSide: 'left' | 'right' = 'right'): PopupBounds {
  try {
    const raw = localStorage.getItem(boundsStorageKey(scope));
    if (!raw) return defaultBounds(anchorRect, defaultSide);
    const parsed = JSON.parse(raw) as Partial<PopupBounds>;
    if (
      typeof parsed.left !== 'number'
      || typeof parsed.top !== 'number'
      || typeof parsed.width !== 'number'
      || typeof parsed.height !== 'number'
    ) {
      return defaultBounds(anchorRect, defaultSide);
    }
    return clampBounds(parsed as PopupBounds);
  } catch {
    return defaultBounds(anchorRect, defaultSide);
  }
}

function writeStoredBounds(bounds: PopupBounds, scope = 'build'): void {
  try {
    localStorage.setItem(boundsStorageKey(scope), JSON.stringify(clampBounds(bounds)));
  } catch {
    // Ignore local layout persistence failures.
  }
}

function stateFilterStorageKey(projectId: string): string {
  return `${POPUP_STATE_FILTER_STORAGE_PREFIX}${projectId}`;
}

function normalizeStateFilterIds(ids: string[], columns: UsageProjectKanbanColumn[]): string[] {
  const allowed = new Set(columns.map((column) => column.id));
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of ids) {
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function normalizeStateFilterLocks(
  locks: Record<string, boolean>,
  columns: UsageProjectKanbanColumn[]
): Record<string, boolean> {
  const allowed = new Set([STATE_FILTER_SHOW_ALL_ID, ...columns.map((column) => column.id)]);
  return Object.fromEntries(
    Object.entries(locks).filter(([key, value]) => value && allowed.has(key))
  );
}

function readStoredStateFilter(
  projectId: string,
  columns: UsageProjectKanbanColumn[]
): { ids: string[]; locks: Record<string, boolean> } {
  try {
    const raw = localStorage.getItem(stateFilterStorageKey(projectId));
    if (!raw) return { ids: [], locks: {} };
    const parsed = JSON.parse(raw) as { ids?: unknown; locks?: unknown };
    return {
      ids: normalizeStateFilterIds(Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === 'string') : [], columns),
      locks: normalizeStateFilterLocks(
        parsed.locks && typeof parsed.locks === 'object' ? parsed.locks as Record<string, boolean> : {},
        columns
      ),
    };
  } catch {
    return { ids: [], locks: {} };
  }
}

function writeStoredStateFilter(
  projectId: string,
  ids: string[],
  locks: Record<string, boolean>,
  columns: UsageProjectKanbanColumn[]
): void {
  const normalizedLocks = normalizeStateFilterLocks(locks, columns);
  try {
    if (Object.keys(normalizedLocks).length === 0) {
      localStorage.removeItem(stateFilterStorageKey(projectId));
      return;
    }
    localStorage.setItem(stateFilterStorageKey(projectId), JSON.stringify({
      ids: normalizeStateFilterIds(ids, columns),
      locks: normalizedLocks,
    }));
  } catch {
    // Ignore local filter persistence failures.
  }
}

function plainTextToNoteHtml(text: string): string {
  const escape = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return text.split(/\r?\n/).map((line) => `<p>${line ? escape(line) : '<br>'}</p>`).join('');
}

function targetForDocument(documentLink: UsageProjectWorkItemDocumentLink): string {
  return documentLink.kind === 'url' ? documentLink.url || '' : documentLink.path || '';
}

function documentKindFromTarget(target: string): UsageProjectWorkItemDocumentLink['kind'] {
  return /^https?:\/\//i.test(target.trim()) ? 'url' : 'local';
}

function formatDate(value?: string | null): string {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No date' : date.toLocaleString();
}

export default function BuildProjectWorkPopup({
  open,
  projects,
  assignees,
  linkedProjectId,
  sourceLabel,
  fallbackLabel = 'Build preset project work',
  presetProjectId,
  selectedPresetName,
  initialProjectId,
  anchorRect,
  storageScope = 'build',
  defaultSide = 'right',
  onSelectedProjectChange,
  onClose,
}: BuildProjectWorkPopupProps) {
  const api = getAccomplish();
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === 'dark';
  const [bounds, setBounds] = useState<PopupBounds>(() => defaultBounds(anchorRect, defaultSide));
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ProjectWorkTab>('lists');
  const [items, setItems] = useState<UsageProjectWorkItem[]>([]);
  const [columns, setColumns] = useState<UsageProjectKanbanColumn[]>([]);
  const [stateFilterOpen, setStateFilterOpen] = useState(false);
  const [stateFilterIds, setStateFilterIds] = useState<string[]>([]);
  const [stateFilterLocks, setStateFilterLocks] = useState<Record<string, boolean>>({});
  const [statusMenuItemId, setStatusMenuItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveStateByItemId, setSaveStateByItemId] = useState<Record<string, SaveState>>({});
  const [newWorkItemTitle, setNewWorkItemTitle] = useState('');
  const [newListNameByItemId, setNewListNameByItemId] = useState<Record<string, string>>({});
  const [newChecklistTextByKey, setNewChecklistTextByKey] = useState<Record<string, string>>({});
  const [newNoteTitleByItemId, setNewNoteTitleByItemId] = useState<Record<string, string>>({});
  const [newNoteTextByItemId, setNewNoteTextByItemId] = useState<Record<string, string>>({});
  const [newDocumentLabelByItemId, setNewDocumentLabelByItemId] = useState<Record<string, string>>({});
  const [newDocumentTargetByItemId, setNewDocumentTargetByItemId] = useState<Record<string, string>>({});
  const saveTimersRef = useRef<Record<string, number>>({});

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === 'active'),
    [projects]
  );
  const selectedProject = useMemo(
    () => activeProjects.find((project) => project.id === selectedProjectId) || null,
    [activeProjects, selectedProjectId]
  );
  const effectiveLinkedProjectId = linkedProjectId !== undefined ? linkedProjectId : presetProjectId;
  const linkedProject = useMemo(
    () => activeProjects.find((project) => project.id === effectiveLinkedProjectId) || null,
    [activeProjects, effectiveLinkedProjectId]
  );
  const subtitle = sourceLabel || (selectedPresetName ? `Preset: ${selectedPresetName}` : fallbackLabel);
  const sortedColumns = useMemo(
    () => columns.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [columns]
  );
  const filteredItems = useMemo(() => (
    stateFilterIds.length === 0
      ? items
      : items.filter((item) => stateFilterIds.includes(item.statusId))
  ), [items, stateFilterIds]);
  const stateFilterLabel = useMemo(() => {
    if (stateFilterIds.length === 0) return 'Show all';
    if (stateFilterIds.length === 1) {
      return sortedColumns.find((column) => column.id === stateFilterIds[0])?.name || '1 state';
    }
    return `${stateFilterIds.length} states`;
  }, [sortedColumns, stateFilterIds]);

  useEffect(() => () => {
    Object.values(saveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current = {};
  }, []);

  useEffect(() => {
    if (!open) return;
    setBounds(readStoredBounds(anchorRect, storageScope, defaultSide));
    const preferred = effectiveLinkedProjectId || initialProjectId || '';
    setSelectedProjectId(preferred && activeProjects.some((project) => project.id === preferred) ? preferred : '');
  }, [activeProjects, anchorRect, defaultSide, effectiveLinkedProjectId, initialProjectId, open, storageScope]);

  useEffect(() => {
    if (!open) return;
    const handleResize = () => setBounds((current) => clampBounds(current));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  const handleSelectedProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    onSelectedProjectChange?.(projectId || null);
  }, [onSelectedProjectChange]);

  const loadItems = useCallback(async () => {
    if (!selectedProjectId) {
      setItems([]);
      setColumns([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [result, projectColumns] = await Promise.all([
        api.listUsageProjectWorkItems({ projectId: selectedProjectId, includeArchived: false }),
        api.listUsageProjectKanbanColumns({ projectId: selectedProjectId }),
      ]);
      setItems(result.filter((item) => !item.archived));
      setColumns(projectColumns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, selectedProjectId]);

  useEffect(() => {
    if (open) void loadItems();
  }, [loadItems, open]);

  useEffect(() => {
    if (!selectedProjectId) {
      setStateFilterIds([]);
      setStateFilterLocks({});
      return;
    }
    const stored = readStoredStateFilter(selectedProjectId, sortedColumns);
    setStateFilterIds(stored.ids);
    setStateFilterLocks(stored.locks);
  }, [selectedProjectId, sortedColumns]);

  const updateSaveState = (itemId: string, state: SaveState) => {
    setSaveStateByItemId((current) => ({ ...current, [itemId]: state }));
    if (state.status === 'saved') {
      window.setTimeout(() => {
        setSaveStateByItemId((current) => {
          if (current[itemId]?.status !== 'saved') return current;
          const next = { ...current };
          delete next[itemId];
          return next;
        });
      }, 1600);
    }
  };

  const saveItemPatch = useCallback(async (itemId: string, patch: UsageProjectWorkItemUpdate) => {
    updateSaveState(itemId, { status: 'saving' });
    try {
      const saved = await api.updateUsageProjectWorkItem(itemId, patch);
      setItems((current) => current.map((item) => (item.id === itemId ? saved : item)));
      updateSaveState(itemId, { status: 'saved' });
    } catch (err) {
      updateSaveState(itemId, { status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [api]);

  const patchItem = useCallback((itemId: string, patch: UsageProjectWorkItemUpdate, options: { debounce?: boolean } = {}) => {
    setItems((current) => current.map((item) => (
      item.id === itemId
        ? {
            ...item,
            ...patch,
            color: patch.color === null ? undefined : patch.color ?? item.color,
            updatedAt: nowIso(),
          } as UsageProjectWorkItem
        : item
    )));
    if (options.debounce) {
      if (saveTimersRef.current[itemId]) window.clearTimeout(saveTimersRef.current[itemId]);
      updateSaveState(itemId, { status: 'saving' });
      saveTimersRef.current[itemId] = window.setTimeout(() => {
        delete saveTimersRef.current[itemId];
        void saveItemPatch(itemId, patch);
      }, 650);
      return;
    }
    void saveItemPatch(itemId, patch);
  }, [saveItemPatch]);

  const createWorkItem = async () => {
    const title = newWorkItemTitle.trim();
    if (!selectedProjectId || !title) return;
    setError('');
    try {
      const created = await api.createUsageProjectWorkItem({
        usageProjectId: selectedProjectId,
        title,
        sourceType: 'manual',
        priority: 'normal',
        statusId: sortedColumns[0]?.id,
      });
      setItems((current) => [created, ...current]);
      setNewWorkItemTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const archiveItem = async (item: UsageProjectWorkItem) => {
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    try {
      await api.archiveUsageProjectWorkItem(item.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems((current) => [item, ...current]);
    }
  };

  const patchChecklistLists = (item: UsageProjectWorkItem, lists: UsageProjectWorkItemChecklistList[]) => {
    patchItem(item.id, {
      checklistLists: lists,
      checklist: flattenChecklistLists(lists),
    });
  };

  const updateChecklistItem = (
    item: UsageProjectWorkItem,
    listId: string,
    checklistItemId: string,
    patch: Partial<UsageProjectWorkItemChecklistItem>
  ) => {
    const lists = getChecklistListsFromItem(item).map((list) => (
      list.id === listId
        ? {
            ...list,
            items: list.items.map((entry) => (
              entry.id === checklistItemId ? { ...entry, ...patch, updatedAt: nowIso() } : entry
            )),
            updatedAt: nowIso(),
          }
        : list
    ));
    patchChecklistLists(item, lists);
  };

  const addChecklistList = (item: UsageProjectWorkItem) => {
    const name = (newListNameByItemId[item.id] || '').trim() || 'Checklist';
    const lists = [...getChecklistListsFromItem(item), createChecklistList(name)];
    setNewListNameByItemId((current) => ({ ...current, [item.id]: '' }));
    patchChecklistLists(item, lists);
  };

  const addChecklistItem = (item: UsageProjectWorkItem, list: UsageProjectWorkItemChecklistList) => {
    const key = `${item.id}:${list.id}`;
    const text = (newChecklistTextByKey[key] || '').trim();
    if (!text) return;
    const lists = getChecklistListsFromItem(item).map((entry) => (
      entry.id === list.id
        ? {
            ...entry,
            items: [
              ...entry.items,
              { id: localId(), text, completed: false, assigneeIds: [], dueDate: null, createdAt: nowIso() },
            ],
            updatedAt: nowIso(),
          }
        : entry
    ));
    setNewChecklistTextByKey((current) => ({ ...current, [key]: '' }));
    patchChecklistLists(item, lists);
  };

  const deleteChecklistItem = (item: UsageProjectWorkItem, listId: string, checklistItemId: string) => {
    const lists = getChecklistListsFromItem(item).map((list) => (
      list.id === listId
        ? { ...list, items: list.items.filter((entry) => entry.id !== checklistItemId), updatedAt: nowIso() }
        : list
    ));
    patchChecklistLists(item, lists);
  };

  const deleteChecklistList = (item: UsageProjectWorkItem, listId: string) => {
    patchChecklistLists(item, getChecklistListsFromItem(item).filter((list) => list.id !== listId));
  };

  const addNote = (item: UsageProjectWorkItem) => {
    const title = (newNoteTitleByItemId[item.id] || '').trim();
    const text = (newNoteTextByItemId[item.id] || '').trim();
    if (!title && !text) return;
    const note: UsageProjectWorkItemNote = {
      id: localId(),
      title: title || undefined,
      text,
      html: plainTextToNoteHtml(text),
      createdAt: nowIso(),
    };
    setNewNoteTitleByItemId((current) => ({ ...current, [item.id]: '' }));
    setNewNoteTextByItemId((current) => ({ ...current, [item.id]: '' }));
    patchItem(item.id, { notes: [note, ...(item.notes || [])] });
  };

  const updateNote = (item: UsageProjectWorkItem, note: UsageProjectWorkItemNote) => {
    patchItem(item.id, {
      notes: (item.notes || []).map((entry) => (entry.id === note.id ? note : entry)),
    }, { debounce: true });
  };

  const deleteNote = (item: UsageProjectWorkItem, noteId: string) => {
    patchItem(item.id, { notes: (item.notes || []).filter((note) => note.id !== noteId) });
  };

  const addDocumentLink = (item: UsageProjectWorkItem) => {
    const target = (newDocumentTargetByItemId[item.id] || '').trim();
    if (!target) return;
    const label = (newDocumentLabelByItemId[item.id] || '').trim() || labelForDocumentTarget(target);
    const kind = documentKindFromTarget(target);
    const linkItem: UsageProjectWorkItemDocumentLink = {
      id: localId(),
      label,
      kind,
      ...(kind === 'url' ? { url: target } : { path: target }),
      createdAt: nowIso(),
    };
    setNewDocumentLabelByItemId((current) => ({ ...current, [item.id]: '' }));
    setNewDocumentTargetByItemId((current) => ({ ...current, [item.id]: '' }));
    patchItem(item.id, { documents: [linkItem, ...(item.documents || [])] });
  };

  const addLocalDocuments = async (item: UsageProjectWorkItem) => {
    const paths = await api.selectFiles();
    if (paths.length === 0) return;
    const links = paths.map((filePath): UsageProjectWorkItemDocumentLink => ({
      id: localId(),
      label: labelForDocumentTarget(filePath),
      kind: 'local',
      path: filePath,
      createdAt: nowIso(),
    }));
    patchItem(item.id, { documents: [...links, ...(item.documents || [])] });
  };

  const updateDocument = (item: UsageProjectWorkItem, documentLink: UsageProjectWorkItemDocumentLink, patch: Partial<UsageProjectWorkItemDocumentLink>) => {
    patchItem(item.id, {
      documents: (item.documents || []).map((entry) => (
        entry.id === documentLink.id ? { ...entry, ...patch } : entry
      )),
    }, { debounce: true });
  };

  const updateDocumentTarget = (item: UsageProjectWorkItem, documentLink: UsageProjectWorkItemDocumentLink, target: string) => {
    const kind = documentKindFromTarget(target);
    updateDocument(item, documentLink, {
      kind,
      path: kind === 'local' ? target : undefined,
      url: kind === 'url' ? target : undefined,
    });
  };

  const deleteDocument = (item: UsageProjectWorkItem, documentId: string) => {
    patchItem(item.id, { documents: (item.documents || []).filter((entry) => entry.id !== documentId) });
  };

  const openDocument = async (documentLink: UsageProjectWorkItemDocumentLink) => {
    const target = targetForDocument(documentLink);
    if (!target) return;
    if (documentLink.kind === 'url') await api.openExternal(target);
    else await api.openPath(target);
  };

  const addDrawing = (item: UsageProjectWorkItem) => {
    const drawings = [createWorkItemDrawing(`Drawing ${(item.drawings || []).length + 1}`), ...(item.drawings || [])];
    patchItem(item.id, { drawings });
  };

  const updateDrawing = (item: UsageProjectWorkItem, drawing: UsageProjectWorkItemDrawing) => {
    patchItem(item.id, {
      drawings: (item.drawings || []).map((entry) => (entry.id === drawing.id ? drawing : entry)),
    }, { debounce: true });
  };

  const deleteDrawing = (item: UsageProjectWorkItem, drawingId: string) => {
    patchItem(item.id, { drawings: (item.drawings || []).filter((drawing) => drawing.id !== drawingId) });
  };

  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = bounds;
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setBounds(clampBounds({
        ...startBounds,
        left: startBounds.left + moveEvent.clientX - startX,
        top: startBounds.top + moveEvent.clientY - startY,
      }));
    };
    const handleUp = () => {
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setBounds((current) => {
        const next = clampBounds(current);
        writeStoredBounds(next, storageScope);
        return next;
      });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>, edge: 'right' | 'bottom' | 'corner') => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = bounds;
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setBounds(clampBounds({
        ...startBounds,
        width: edge === 'right' || edge === 'corner' ? startBounds.width + moveEvent.clientX - startX : startBounds.width,
        height: edge === 'bottom' || edge === 'corner' ? startBounds.height + moveEvent.clientY - startY : startBounds.height,
      }));
    };
    const handleUp = () => {
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setBounds((current) => {
        const next = clampBounds(current);
        writeStoredBounds(next, storageScope);
        return next;
      });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const saveStateLabel = (itemId: string) => {
    const state = saveStateByItemId[itemId];
    if (!state) return null;
    if (state.status === 'saving') return <span className="text-[10px] text-muted-foreground">Saving...</span>;
    if (state.status === 'saved') return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 className="h-3 w-3" />Saved</span>;
    return <span className="text-[10px] text-destructive" title={state.message}>Save failed</span>;
  };

  const persistStateFilterIfLocked = (nextIds: string[], nextLocks = stateFilterLocks) => {
    if (!selectedProjectId) return;
    writeStoredStateFilter(selectedProjectId, nextIds, nextLocks, sortedColumns);
  };

  const setShowAllStates = () => {
    setStateFilterIds([]);
    persistStateFilterIfLocked([]);
  };

  const toggleStateFilter = (columnId: string) => {
    setStateFilterIds((current) => {
      const allColumnIds = sortedColumns.map((column) => column.id);
      const next = current.length === 0
        ? allColumnIds.filter((id) => id !== columnId)
        : current.includes(columnId)
          ? current.filter((id) => id !== columnId)
          : [...current, columnId];
      const normalizedNext = next.length === allColumnIds.length ? [] : next;
      persistStateFilterIfLocked(normalizedNext);
      return normalizedNext;
    });
  };

  const toggleStateFilterLock = (lockId: string) => {
    setStateFilterLocks((current) => {
      const next = { ...current, [lockId]: !current[lockId] };
      if (!next[lockId]) delete next[lockId];
      persistStateFilterIfLocked(stateFilterIds, next);
      return next;
    });
  };

  const renderWorkItemHeader = (item: UsageProjectWorkItem) => {
    const statusColumn = sortedColumns.find((column) => column.id === item.statusId);

    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color || '#2dd4bf' }} />
            <div className="truncate text-sm font-semibold text-foreground" title={item.title}>{item.title}</div>
            <Popover open={statusMenuItemId === item.id} onOpenChange={(nextOpen) => setStatusMenuItemId(nextOpen ? item.id : null)}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-7 max-w-[170px] items-center gap-1.5 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
                    statusMenuItemId === item.id && 'bg-accent'
                  )}
                  disabled={sortedColumns.length === 0}
                  title="Change work item state"
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusColumn?.color || '#64748b' }} />
                  <span className="min-w-0 truncate">{statusColumn?.name || 'Choose state'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="z-[45] w-48 p-1.5" style={{ zIndex: 45 }}>
                <div className="max-h-56 overflow-y-auto">
                  {sortedColumns.map((column) => {
                    const selected = column.id === item.statusId;
                    return (
                      <button
                        key={column.id}
                        type="button"
                        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!selected) patchItem(item.id, { statusId: column.id });
                          setStatusMenuItemId(null);
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: column.color || '#64748b' }} />
                          <span className="min-w-0 truncate">{column.name}</span>
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                      </button>
                    );
                  })}
                  {sortedColumns.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No states available.</div>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Updated {formatDate(item.updatedAt)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {saveStateLabel(item.id)}
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Archive work item" onClick={() => void archiveItem(item)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  const renderLists = () => (
    <div className="space-y-3">
      {filteredItems.map((item) => {
        const lists = getChecklistListsFromItem(item);
        const progress = checklistProgress(flattenChecklistLists(lists));
        return (
          <section key={item.id} className="rounded-lg border border-border bg-background/70 p-3">
            {renderWorkItemHeader(item)}
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <div className="h-1.5 min-w-16 flex-1 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
              </div>
              <span>{progress.percent}%</span>
            </div>
            <div className="mt-3 space-y-3">
              {lists.map((list) => (
                <div key={list.id} className="rounded-md border border-border/60 bg-card/60 p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      defaultValue={list.name}
                      className="h-7 text-xs"
                      onBlur={(event) => {
                        const name = event.target.value.trim() || 'Checklist';
                        const nextLists = lists.map((entry) => (entry.id === list.id ? { ...entry, name, updatedAt: nowIso() } : entry));
                        patchChecklistLists(item, nextLists);
                      }}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteChecklistList(item, list.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {list.items.map((checkItem) => (
                      <div key={checkItem.id} className="rounded border border-border/40 bg-background/60 p-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checkItem.completed}
                            onChange={(event) => updateChecklistItem(item, list.id, checkItem.id, { completed: event.target.checked })}
                          />
                          <Input
                            defaultValue={checkItem.text}
                            className={cn('h-7 flex-1 text-xs', checkItem.completed && 'text-muted-foreground line-through')}
                            onBlur={(event) => updateChecklistItem(item, list.id, checkItem.id, { text: event.target.value.trim() || checkItem.text })}
                          />
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteChecklistItem(item, list.id, checkItem.id)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2 text-[11px]">
                          <label className="min-w-0">
                            <span className="mb-1 flex items-center gap-1 text-muted-foreground"><GripVertical className="h-3 w-3" />Assignee</span>
                            <select
                              value={checkItem.assigneeIds?.[0] || ''}
                              onChange={(event) => updateChecklistItem(item, list.id, checkItem.id, { assigneeIds: event.target.value ? [event.target.value] : [] })}
                              className="h-7 w-full rounded border border-input bg-background px-1 text-xs"
                            >
                              <option value="">None</option>
                              {assignees.map((assignee) => (
                                <option key={assignee.id} value={assignee.id}>{assignee.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="min-w-0">
                            <span className="mb-1 flex items-center gap-1 text-muted-foreground"><CalendarDays className="h-3 w-3" />Due date</span>
                            <Input
                              type="date"
                              value={checkItem.dueDate ? checkItem.dueDate.slice(0, 10) : ''}
                              onChange={(event) => updateChecklistItem(item, list.id, checkItem.id, {
                                dueDate: event.target.value ? new Date(`${event.target.value}T00:00:00.000Z`).toISOString() : null,
                              })}
                              className="h-7 text-xs"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Input
                      value={newChecklistTextByKey[`${item.id}:${list.id}`] || ''}
                      onChange={(event) => setNewChecklistTextByKey((current) => ({ ...current, [`${item.id}:${list.id}`]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addChecklistItem(item, list);
                        }
                      }}
                      placeholder="Add checklist item"
                      className="h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => addChecklistItem(item, list)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <Input
                value={newListNameByItemId[item.id] || ''}
                onChange={(event) => setNewListNameByItemId((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="New list name"
                className="h-8 text-xs"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => addChecklistList(item)}>
                <Plus className="h-3.5 w-3.5" />
                List
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );

  const renderNotes = () => (
    <div className="space-y-3">
      {filteredItems.map((item) => (
        <section key={item.id} className="rounded-lg border border-border bg-background/70 p-3">
          {renderWorkItemHeader(item)}
          <div className="mt-3 rounded-md border border-border/60 bg-card/60 p-2">
            <div className="grid gap-2">
              <Input
                value={newNoteTitleByItemId[item.id] || ''}
                onChange={(event) => setNewNoteTitleByItemId((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="Note title"
                className="h-8 text-xs"
              />
              <Textarea
                value={newNoteTextByItemId[item.id] || ''}
                onChange={(event) => setNewNoteTextByItemId((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="Write a new note..."
                className="min-h-20 resize-y text-xs"
              />
              <Button type="button" variant="outline" size="sm" className="h-8 justify-self-start gap-1 px-2 text-xs" onClick={() => addNote(item)}>
                <Plus className="h-3.5 w-3.5" />
                Add note
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {(item.notes || []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">No notes for this work item.</div>
            ) : (item.notes || []).map((note) => (
              <RichWorkItemNoteEditor
                key={note.id}
                note={note}
                onChange={(nextNote) => updateNote(item, nextNote)}
                onDelete={() => deleteNote(item, note.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const renderDocuments = () => (
    <div className="space-y-3">
      {filteredItems.map((item) => (
        <section key={item.id} className="rounded-lg border border-border bg-background/70 p-3">
          {renderWorkItemHeader(item)}
          <div className="mt-3 rounded-md border border-border/60 bg-card/60 p-2">
            <div className="grid gap-2">
              <Input
                value={newDocumentLabelByItemId[item.id] || ''}
                onChange={(event) => setNewDocumentLabelByItemId((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="Document label"
                className="h-8 text-xs"
              />
              <Input
                value={newDocumentTargetByItemId[item.id] || ''}
                onChange={(event) => setNewDocumentTargetByItemId((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="Local file path, Google Doc, Microsoft 365, GitHub, or web URL"
                className="h-8 text-xs"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => addDocumentLink(item)}>
                  <Link className="h-3.5 w-3.5" />
                  Add link
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => void addLocalDocuments(item)}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Add from PC
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Local file links open the file from its current path. If the file is moved, the link will break.
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {(item.documents || []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">No linked documents.</div>
            ) : (item.documents || []).map((documentLink) => (
              <div key={documentLink.id} className="rounded-md border border-border/60 bg-card/60 p-2">
                <div className="grid gap-2">
                  <Input
                    defaultValue={documentLink.label}
                    onBlur={(event) => updateDocument(item, documentLink, { label: event.target.value.trim() || documentLink.label })}
                    className="h-8 text-xs"
                    placeholder="Label"
                  />
                  <Input
                    defaultValue={targetForDocument(documentLink)}
                    onBlur={(event) => updateDocumentTarget(item, documentLink, event.target.value.trim())}
                    className="h-8 text-xs"
                    placeholder="Path or URL"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => void openDocument(documentLink)}>
                      <FileText className="h-3.5 w-3.5" />
                      Open
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => deleteDocument(item, documentLink.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const renderDrawings = () => (
    <div className="space-y-3">
      {filteredItems.map((item) => (
        <section key={item.id} className="rounded-lg border border-border bg-background/70 p-3">
          {renderWorkItemHeader(item)}
          <div className="mt-3">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => addDrawing(item)}>
              <Plus className="h-3.5 w-3.5" />
              New drawing
            </Button>
          </div>
          <div className="mt-3 space-y-3">
            {(item.drawings || []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">No drawings for this work item.</div>
            ) : (item.drawings || []).map((drawing) => (
              <DrawingEditor
                key={drawing.id}
                drawing={drawing}
                onChange={(nextDrawing) => updateDrawing(item, nextDrawing)}
                onDelete={() => deleteDrawing(item, drawing.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  if (!open) return null;

  const popup = (
    <div
      className={cn(
        'fixed z-[40] flex min-h-0 flex-col overflow-hidden rounded-xl border text-foreground shadow-2xl',
        isDarkTheme
          ? 'border-primary/50 bg-[#0f2428] text-card-foreground shadow-primary/20'
          : 'border-teal-300 bg-teal-50 shadow-teal-700/15'
      )}
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
      role="dialog"
      aria-label="Build project work"
    >
      <div
        className={cn(
          'flex shrink-0 cursor-move items-start justify-between gap-2 border-b px-3 py-2',
          isDarkTheme
            ? 'border-primary/30 bg-[#123039]'
            : 'border-teal-200 bg-teal-100'
        )}
        onPointerDown={beginMove}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            <span>Project work</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {subtitle}
            {linkedProject ? ` - Attached to ${linkedProject.name}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7',
              isDarkTheme
                ? 'text-card-foreground hover:bg-accent/40 hover:text-accent-foreground'
                : 'text-teal-950 hover:bg-teal-200 hover:text-teal-950'
            )}
            title="Refresh project work"
            onClick={() => void loadItems()}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7',
              isDarkTheme
                ? 'text-card-foreground hover:bg-accent/40 hover:text-accent-foreground'
                : 'text-teal-950 hover:bg-teal-200 hover:text-teal-950'
            )}
            title="Reset popup position"
            onClick={() => {
              const next = defaultBounds(anchorRect, defaultSide);
              setBounds(next);
              writeStoredBounds(next, storageScope);
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7',
              isDarkTheme
                ? 'text-card-foreground hover:bg-accent/40 hover:text-accent-foreground'
                : 'text-teal-950 hover:bg-teal-200 hover:text-teal-950'
            )}
            title="Close project work"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'shrink-0 space-y-2 border-b px-3 py-2',
          isDarkTheme
            ? 'border-primary/25 bg-[#102a31]'
            : 'border-teal-200 bg-teal-50/90'
        )}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="grid min-w-0 gap-1 text-[11px] font-medium text-muted-foreground">
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => handleSelectedProjectChange(event.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              disabled={activeProjects.length === 0}
            >
              {activeProjects.length === 0 ? (
                <option value="">No projects available</option>
              ) : (
                <>
                  {!selectedProjectId ? <option value="">Choose project...</option> : null}
                  {activeProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </>
              )}
            </select>
          </label>
          <div className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            States
            <Popover open={stateFilterOpen} onOpenChange={setStateFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-8 w-[128px] justify-between gap-1 px-2 text-xs',
                    stateFilterIds.length > 0
                      ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : ''
                  )}
                  disabled={!selectedProject || sortedColumns.length === 0}
                  title="Choose which work item states are shown."
                >
                  <span className="min-w-0 truncate">{stateFilterLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="z-[45] w-64 p-1.5" style={{ zIndex: 45 }}>
                <div className="space-y-1">
                  <div className="flex items-center gap-1 rounded-md hover:bg-accent">
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
                        stateFilterLocks[STATE_FILTER_SHOW_ALL_ID] ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/45'
                      )}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleStateFilterLock(STATE_FILTER_SHOW_ALL_ID);
                      }}
                      title={stateFilterLocks[STATE_FILTER_SHOW_ALL_ID]
                        ? 'Show all is locked and will stay selected when you reopen this project work popup. Click to stop persisting it.'
                        : 'Keep Show all selected when you reopen this project work popup.'}
                      aria-label={stateFilterLocks[STATE_FILTER_SHOW_ALL_ID] ? 'Unlock show all state filter' : 'Lock show all state filter'}
                    >
                      <Lock className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setShowAllStates();
                      }}
                    >
                      <span className="min-w-0 truncate">Show all</span>
                      {stateFilterIds.length === 0 ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                  <div className="border-t border-border/60 pt-1">
                    {sortedColumns.map((column) => {
                      const checked = stateFilterIds.length === 0 || stateFilterIds.includes(column.id);
                      const locked = Boolean(stateFilterLocks[column.id]);
                      return (
                        <div key={column.id} className="flex items-center gap-1 rounded-md hover:bg-accent">
                          <button
                            type="button"
                            className={cn(
                              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground',
                              locked ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/45'
                            )}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleStateFilterLock(column.id);
                            }}
                            title={locked
                              ? `${column.name} is locked in this filter and will be remembered when you reopen the popup. Click to stop persisting this.`
                              : `Keep the current ${column.name} filter state when you reopen the popup.`}
                            aria-label={locked ? `Unlock ${column.name} state filter` : `Lock ${column.name} state filter`}
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleStateFilter(column.id);
                            }}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: column.color || '#64748b' }} />
                              <span className="min-w-0 truncate">{column.name}</span>
                            </span>
                            {checked ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={newWorkItemTitle}
            onChange={(event) => setNewWorkItemTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void createWorkItem();
              }
            }}
            placeholder="New work item title"
            className="h-8 text-xs"
            disabled={!selectedProject}
          />
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => void createWorkItem()} disabled={!selectedProject || !newWorkItemTitle.trim()}>
            <Plus className="h-3.5 w-3.5" />
            Item
          </Button>
        </div>
        <div className={cn('grid grid-cols-4 gap-1 rounded-md p-1', isDarkTheme ? 'bg-muted/40' : 'bg-teal-100/80')}>
          {([
            ['lists', 'Lists'],
            ['notes', 'Notes'],
            ['drawings', 'Drawings'],
            ['documents', 'Documents'],
          ] as Array<[ProjectWorkTab, string]>).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={cn(
                'h-7 rounded px-1 text-[11px] font-medium',
                isDarkTheme
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-teal-900 hover:bg-white/70 hover:text-teal-950',
                activeTab === tab && (isDarkTheme
                  ? 'bg-background text-foreground shadow-sm'
                  : 'bg-white text-teal-950 shadow-sm')
              )}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        ) : null}
        {activeProjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
            No usage projects exist yet. Open Project Management from the sidebar to create one, then attach it to this Build preset.
          </div>
        ) : !selectedProject ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
            Choose a project to view its lists, notes, documents, and drawings.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading project work...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
            No work items exist for {selectedProject.name}. Create one above to start adding lists, notes, documents, or drawings.
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
            No work items match the selected state filter.
          </div>
        ) : activeTab === 'lists' ? renderLists()
          : activeTab === 'notes' ? renderNotes()
          : activeTab === 'drawings' ? renderDrawings()
          : renderDocuments()}
      </div>

      <div className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(event) => beginResize(event, 'corner')}>
        <div className="absolute bottom-1 right-1 h-2 w-2 border-b border-r border-muted-foreground/70" />
      </div>
      <div className="absolute bottom-0 left-0 right-4 h-1 cursor-row-resize" onPointerDown={(event) => beginResize(event, 'bottom')} />
      <div className="absolute bottom-4 right-0 top-0 w-1 cursor-col-resize" onPointerDown={(event) => beginResize(event, 'right')} />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-border/70" />
      <div className="absolute bottom-0 right-0 top-0 w-px bg-border/70" />
    </div>
  );

  if (typeof document === 'undefined') return popup;
  return createPortal(popup, document.body);
}
