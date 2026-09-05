'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { Download, FileSearch, History, Loader2, RefreshCw, Search } from 'lucide-react';
import type {
  AuditEventCategory,
  AuditEventRecord,
  AuditEventStatus,
  LocalSearchSource,
  SearchItemDetail,
  SearchResultItem,
} from '@accomplish/shared';
import { getAccomplish } from '@/lib/accomplish';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SearchAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ActiveTab = 'search' | 'audit';
type ExportFormat = 'json' | 'csv';

type FilterState = {
  agentId: string;
  taskId: string;
  projectId: string;
  connectorId: string;
  connectorInstanceId: string;
  skillId: string;
  memoryKind: string;
  status: string;
  since: string;
  until: string;
};

const emptyFilters: FilterState = {
  agentId: '',
  taskId: '',
  projectId: '',
  connectorId: '',
  connectorInstanceId: '',
  skillId: '',
  memoryKind: '',
  status: '',
  since: '',
  until: '',
};

const searchSources: Array<{ value: '' | LocalSearchSource; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'chat_task', label: 'Chat' },
  { value: 'build_task', label: 'Build' },
  { value: 'build_runtime', label: 'Build runtime' },
  { value: 'tool_call', label: 'Tool calls' },
  { value: 'project', label: 'Projects' },
  { value: 'workboard_item', label: 'Workboard' },
  { value: 'workboard_note', label: 'Notes' },
  { value: 'linked_document', label: 'Linked documents' },
  { value: 'memory_file', label: 'Memory files' },
  { value: 'memory_change', label: 'Memory changes' },
  { value: 'skill', label: 'Skills' },
  { value: 'git_summary', label: 'Git' },
  { value: 'connector_message', label: 'Connector messages' },
  { value: 'audit_event', label: 'Audit events' },
];

const auditCategories: Array<{ value: '' | AuditEventCategory; label: string }> = [
  { value: '', label: 'All audit events' },
  { value: 'task', label: 'Task' },
  { value: 'tool_use', label: 'Tool use' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'memory', label: 'Memory' },
  { value: 'skill', label: 'Skill' },
  { value: 'tool_discovery', label: 'Tool discovery' },
  { value: 'connector', label: 'Connector' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'always_on', label: 'Always-on' },
  { value: 'execution_profile', label: 'Execution profile' },
  { value: 'git', label: 'Git' },
  { value: 'build_runtime', label: 'Build runtime' },
  { value: 'search', label: 'Search' },
  { value: 'settings', label: 'Settings' },
  { value: 'system', label: 'System' },
];

const auditStatuses: Array<{ value: '' | AuditEventStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const memoryKinds = [
  { value: '', label: 'All memory' },
  { value: 'user', label: 'User memory' },
  { value: 'long-term', label: 'Long-term' },
  { value: 'daily', label: 'Daily' },
  { value: 'snapshot', label: 'Snapshots' },
];

function formatDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sourceLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function DetailBlock({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{title}</div>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
        {body}
      </pre>
    </div>
  );
}

function filterPayload(filters: FilterState) {
  return {
    agentId: filters.agentId || undefined,
    taskId: filters.taskId || undefined,
    projectId: filters.projectId || undefined,
    connectorId: filters.connectorId || undefined,
    connectorInstanceId: filters.connectorInstanceId || undefined,
    skillId: filters.skillId || undefined,
    memoryKind: filters.memoryKind || undefined,
    status: filters.status || undefined,
    since: filters.since || undefined,
    until: filters.until || undefined,
  };
}

function updateFilter(
  setter: Dispatch<SetStateAction<FilterState>>,
  key: keyof FilterState,
  value: string
) {
  setter((current) => ({ ...current, [key]: value }));
}

function FilterGrid({
  filters,
  onChange,
  includeDates,
  includeStatus = true,
}: {
  filters: FilterState;
  onChange: Dispatch<SetStateAction<FilterState>>;
  includeDates?: boolean;
  includeStatus?: boolean;
}) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
      <input
        value={filters.agentId}
        onChange={(event) => updateFilter(onChange, 'agentId', event.target.value)}
        placeholder="Agent"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      <input
        value={filters.taskId}
        onChange={(event) => updateFilter(onChange, 'taskId', event.target.value)}
        placeholder="Task"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      <input
        value={filters.projectId}
        onChange={(event) => updateFilter(onChange, 'projectId', event.target.value)}
        placeholder="Project"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      <input
        value={filters.connectorId}
        onChange={(event) => updateFilter(onChange, 'connectorId', event.target.value)}
        placeholder="Connector"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      <input
        value={filters.connectorInstanceId}
        onChange={(event) => updateFilter(onChange, 'connectorInstanceId', event.target.value)}
        placeholder="Instance"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      <input
        value={filters.skillId}
        onChange={(event) => updateFilter(onChange, 'skillId', event.target.value)}
        placeholder="Skill"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      <select
        value={filters.memoryKind}
        onChange={(event) => updateFilter(onChange, 'memoryKind', event.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      >
        {memoryKinds.map((kind) => (
          <option key={kind.value || 'all'} value={kind.value}>{kind.label}</option>
        ))}
      </select>
      {includeStatus && (
        <input
          value={filters.status}
          onChange={(event) => updateFilter(onChange, 'status', event.target.value)}
          placeholder="Status"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        />
      )}
      {includeDates && (
        <>
          <input
            value={filters.since}
            onChange={(event) => updateFilter(onChange, 'since', event.target.value)}
            placeholder="Since"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          />
          <input
            value={filters.until}
            onChange={(event) => updateFilter(onChange, 'until', event.target.value)}
            placeholder="Until"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
          />
        </>
      )}
    </div>
  );
}

export default function SearchAuditDialog({ open, onOpenChange }: SearchAuditDialogProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchIndexedAt, setSearchIndexedAt] = useState<string | undefined>();
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [selectedSearchDetail, setSelectedSearchDetail] = useState<SearchItemDetail | null>(null);
  const [searchSource, setSearchSource] = useState<'' | LocalSearchSource>('');
  const [searchFilters, setSearchFilters] = useState<FilterState>(emptyFilters);

  const [auditQuery, setAuditQuery] = useState('');
  const [auditCategory, setAuditCategory] = useState<'' | AuditEventCategory>('');
  const [auditStatus, setAuditStatus] = useState<'' | AuditEventStatus>('');
  const [auditFormat, setAuditFormat] = useState<ExportFormat>('json');
  const [auditFilters, setAuditFilters] = useState<FilterState>(emptyFilters);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [selectedAuditEvent, setSelectedAuditEvent] = useState<AuditEventRecord | null>(null);

  const selectedSearchResult = useMemo(
    () => searchResults.find((result) => result.id === selectedSearchId) || null,
    [searchResults, selectedSearchId]
  );

  const selectedAuditListEvent = useMemo(
    () => auditEvents.find((event) => event.id === selectedAuditId) || null,
    [auditEvents, selectedAuditId]
  );

  useEffect(() => {
    if (!open) return;
    const accomplish = getAccomplish();
    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      accomplish.querySearch({
        query: searchQuery,
        sources: searchSource ? [searchSource] : undefined,
        ...filterPayload(searchFilters),
        limit: 50,
      })
        .then((result) => {
          setSearchResults(result.results);
          setSearchIndexedAt(result.indexedAt);
          setSelectedSearchId((current) => current && result.results.some((item) => item.id === current)
            ? current
            : result.results[0]?.id ?? null);
        })
        .catch((error) => {
          console.error('Failed to query local search:', error);
          setSearchError(error instanceof Error ? error.message : 'Unable to query local search.');
        })
        .finally(() => setSearchLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, searchQuery, searchSource, searchFilters]);

  useEffect(() => {
    if (!open || !selectedSearchId) {
      setSelectedSearchDetail(null);
      return;
    }
    getAccomplish().getSearchItem({ id: selectedSearchId })
      .then(setSelectedSearchDetail)
      .catch((error) => {
        console.error('Failed to load search item:', error);
        setSelectedSearchDetail(null);
      });
  }, [open, selectedSearchId]);

  useEffect(() => {
    if (!open) return;
    const accomplish = getAccomplish();
    setAuditLoading(true);
    setAuditError(null);
    const timer = window.setTimeout(() => {
      accomplish.listAuditEvents({
        query: auditQuery || undefined,
        category: auditCategory || undefined,
        ...filterPayload(auditFilters),
        status: auditStatus || undefined,
        limit: 100,
      })
        .then((result) => {
          setAuditEvents(result.events);
          setSelectedAuditId((current) => current && result.events.some((item) => item.id === current)
            ? current
            : result.events[0]?.id ?? null);
        })
        .catch((error) => {
          console.error('Failed to load audit events:', error);
          setAuditError(error instanceof Error ? error.message : 'Unable to load audit history.');
        })
        .finally(() => setAuditLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, auditQuery, auditCategory, auditStatus, auditFilters]);

  useEffect(() => {
    if (!open || !selectedAuditId) {
      setSelectedAuditEvent(null);
      return;
    }
    getAccomplish().getAuditEvent({ id: selectedAuditId })
      .then(setSelectedAuditEvent)
      .catch((error) => {
        console.error('Failed to load audit event:', error);
        setSelectedAuditEvent(null);
      });
  }, [open, selectedAuditId]);

  const rebuildIndex = async () => {
    setRebuildLoading(true);
    setSearchError(null);
    try {
      const accomplish = getAccomplish();
      const rebuilt = await accomplish.rebuildSearchIndex({ includeGit: true });
      setSearchIndexedAt(rebuilt.indexedAt);
      const next = await accomplish.querySearch({
        query: searchQuery,
        sources: searchSource ? [searchSource] : undefined,
        ...filterPayload(searchFilters),
        limit: 50,
      });
      setSearchResults(next.results);
      setSelectedSearchId(next.results[0]?.id ?? null);
    } catch (error) {
      console.error('Failed to rebuild local search:', error);
      setSearchError(error instanceof Error ? error.message : 'Unable to rebuild local search index.');
    } finally {
      setRebuildLoading(false);
    }
  };

  const exportAudit = async () => {
    setAuditExporting(true);
    setAuditError(null);
    try {
      const accomplish = getAccomplish();
      const exported = await accomplish.exportAuditEvents({
        query: auditQuery || undefined,
        category: auditCategory || undefined,
        ...filterPayload(auditFilters),
        status: auditStatus || undefined,
        format: auditFormat,
      });
      await accomplish.saveTextToFileAs(exported.content, {
        baseName: exported.filename.replace(/\.(json|csv)$/, ''),
        extension: auditFormat,
        title: 'Export audit history',
      });
    } catch (error) {
      console.error('Failed to export audit events:', error);
      setAuditError(error instanceof Error ? error.message : 'Unable to export audit history.');
    } finally {
      setAuditExporting(false);
    }
  };

  const detailData = selectedSearchDetail?.data
    ? JSON.stringify(selectedSearchDetail.data, null, 2)
    : undefined;
  const searchJumpData = selectedSearchDetail?.item.ref.jump || selectedSearchResult?.ref.jump
    ? JSON.stringify(selectedSearchDetail?.item.ref.jump || selectedSearchResult?.ref.jump, null, 2)
    : undefined;
  const auditDetail = selectedAuditEvent || selectedAuditListEvent;
  const auditMetadata = auditDetail?.metadata
    ? JSON.stringify(auditDetail.metadata, null, 2)
    : undefined;
  const auditJumpData = auditDetail?.jump
    ? JSON.stringify(auditDetail.jump, null, 2)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[94vw] max-w-5xl max-h-[84vh] overflow-hidden flex flex-col gap-4">
        <DialogHeader className="shrink-0">
          <DialogTitle>Local search and audit</DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2 rounded-md border border-border/70 bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${activeTab === 'search' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Search className="h-4 w-4" />
            Search
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${activeTab === 'audit' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <History className="h-4 w-4" />
            Audit
          </button>
        </div>

        {activeTab === 'search' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search local history, workboard, memory, skills, Git, and audit"
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <select
                value={searchSource}
                onChange={(event) => setSearchSource(event.target.value as '' | LocalSearchSource)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                {searchSources.map((source) => (
                  <option key={source.value || 'all'} value={source.value}>{source.label}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={rebuildIndex} disabled={rebuildLoading}>
                {rebuildLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Rebuild
              </Button>
            </div>
            <FilterGrid filters={searchFilters} onChange={setSearchFilters} includeDates />
            <div className="text-xs text-muted-foreground">
              {searchLoading ? 'Searching...' : `${searchResults.length} results`}
              {searchIndexedAt ? ` - indexed ${formatDateTime(searchIndexedAt)}` : ''}
            </div>
            {searchError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{searchError}</div>}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="min-h-0 overflow-auto rounded-md border border-border/70">
                {searchResults.length === 0 ? (
                  <div className="flex h-full min-h-40 items-center justify-center p-6 text-sm text-muted-foreground">
                    No local results.
                  </div>
                ) : searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => setSelectedSearchId(result.id)}
                    className={`block w-full border-b border-border/60 p-3 text-left transition-colors last:border-b-0 ${selectedSearchId === result.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-medium text-foreground">{result.title}</div>
                      <div className="shrink-0 rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{sourceLabel(result.source)}</div>
                    </div>
                    {result.subtitle && <div className="mt-1 truncate text-xs text-muted-foreground">{result.subtitle}</div>}
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.excerpt}</div>
                  </button>
                ))}
              </div>
              <div className="min-h-0 overflow-auto rounded-md border border-border/70 p-4">
                {selectedSearchResult ? (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <FileSearch className="h-4 w-4" />
                        {selectedSearchResult.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {sourceLabel(selectedSearchResult.source)}
                        {selectedSearchResult.updatedAt ? ` - ${formatDateTime(selectedSearchResult.updatedAt)}` : ''}
                      </div>
                    </div>
                    <DetailBlock title="Content" body={selectedSearchDetail?.content || selectedSearchResult.excerpt} />
                    <DetailBlock title="Jump target" body={searchJumpData} />
                    <DetailBlock title="Raw data" body={detailData} />
                  </div>
                ) : (
                  <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                    Select a result.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 flex-col gap-2 lg:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={auditQuery}
                  onChange={(event) => setAuditQuery(event.target.value)}
                  placeholder="Filter audit history"
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <select
                value={auditCategory}
                onChange={(event) => setAuditCategory(event.target.value as '' | AuditEventCategory)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                {auditCategories.map((category) => (
                  <option key={category.value || 'all'} value={category.value}>{category.label}</option>
                ))}
              </select>
              <select
                value={auditStatus}
                onChange={(event) => setAuditStatus(event.target.value as '' | AuditEventStatus)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                {auditStatuses.map((status) => (
                  <option key={status.value || 'all'} value={status.value}>{status.label}</option>
                ))}
              </select>
              <select
                value={auditFormat}
                onChange={(event) => setAuditFormat(event.target.value as ExportFormat)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
              <Button size="sm" variant="outline" onClick={exportAudit} disabled={auditExporting}>
                {auditExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export
              </Button>
            </div>
            <FilterGrid filters={auditFilters} onChange={setAuditFilters} includeDates includeStatus={false} />
            <div className="text-xs text-muted-foreground">
              {auditLoading ? 'Loading audit history...' : `${auditEvents.length} events`}
            </div>
            {auditError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{auditError}</div>}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="min-h-0 overflow-auto rounded-md border border-border/70">
                {auditEvents.length === 0 ? (
                  <div className="flex h-full min-h-40 items-center justify-center p-6 text-sm text-muted-foreground">
                    No audit events.
                  </div>
                ) : auditEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedAuditId(event.id)}
                    className={`block w-full border-b border-border/60 p-3 text-left transition-colors last:border-b-0 ${selectedAuditId === event.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-medium text-foreground">{event.title}</div>
                      <div className="shrink-0 rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{sourceLabel(event.category)}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{event.action} - {formatDateTime(event.timestamp)}</div>
                    {event.summary && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{event.summary}</div>}
                  </button>
                ))}
              </div>
              <div className="min-h-0 overflow-auto rounded-md border border-border/70 p-4">
                {auditDetail ? (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <History className="h-4 w-4" />
                        {auditDetail.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {sourceLabel(auditDetail.category)} - {auditDetail.action} - {formatDateTime(auditDetail.timestamp)}
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>Status: {auditDetail.status}</div>
                      <div>Source: {auditDetail.source || 'local'}</div>
                      {auditDetail.agentId && <div>Agent: {auditDetail.agentId}</div>}
                      {auditDetail.taskId && <div>Task: {auditDetail.taskId}</div>}
                      {auditDetail.targetType && <div>Target type: {auditDetail.targetType}</div>}
                      {auditDetail.targetId && <div>Target: {auditDetail.targetId}</div>}
                    </div>
                    <DetailBlock title="Summary" body={auditDetail.summary} />
                    <DetailBlock title="Jump target" body={auditJumpData} />
                    <DetailBlock title="Metadata" body={auditMetadata} />
                  </div>
                ) : (
                  <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                    Select an audit event.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
