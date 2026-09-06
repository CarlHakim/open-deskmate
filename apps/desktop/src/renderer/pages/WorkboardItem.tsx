import type { UsageProject, UsageProjectWorkItem } from "@accomplish/shared";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getAccomplish } from "../lib/accomplish";

export function decodeRouteParam(value: string | undefined): string {
  try {
    return decodeURIComponent(value || '').trim();
  } catch {
    return String(value || '').trim();
  }
}

export function formatRouteDate(value?: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleString();
}

export function WorkboardItemRoutePage() {
  const { projectId: rawProjectId, itemId: rawItemId } = useParams<{ projectId: string; itemId: string }>();
  const [project, setProject] = useState<UsageProject | null>(null);
  const [item, setItem] = useState<UsageProjectWorkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accomplish = getAccomplish();
  const projectId = decodeRouteParam(rawProjectId);
  const itemId = decodeRouteParam(rawItemId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const projects = await accomplish.listUsageProjects({ includeArchived: true });
        const nextProject = projects.find((entry) => entry.id === projectId) || null;
        if (!nextProject) {
          throw new Error('Workboard project not found.');
        }
        const items = await accomplish.listUsageProjectWorkItems({ projectId: nextProject.id, includeArchived: true });
        const nextItem = items.find((entry) => entry.id === itemId) || null;
        if (!nextItem) {
          throw new Error('Workboard item not found.');
        }
        if (cancelled) return;
        setProject(nextProject);
        setItem(nextItem);
      } catch (err) {
        if (!cancelled) {
          setProject(null);
          setItem(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accomplish, itemId, projectId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading Workboard item...
      </div>
    );
  }

  if (error || !project || !item) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <div className="max-w-md rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Workboard item unavailable
          </div>
          {error || 'The requested Workboard item could not be loaded.'}
        </div>
      </div>
    );
  }

  const checklistLists = item.checklistLists?.length
    ? item.checklistLists
    : item.checklist.length > 0
      ? [{ id: 'default', name: 'Checklist', items: item.checklist }]
      : [];
  const documents = item.documents || [];
  const sources = item.sources || [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase text-muted-foreground">{project.name}</div>
              <h1 className="mt-1 break-words text-2xl font-semibold text-foreground">{item.title}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-1">Priority: {item.priority}</span>
                <span className="rounded-full bg-muted px-2 py-1">{item.archived ? 'Archived' : 'Active'}</span>
                {item.blocked ? <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">Blocked</span> : null}
                <span className="rounded-full bg-muted px-2 py-1">Updated {formatRouteDate(item.updatedAt)}</span>
              </div>
            </div>
            {item.color ? <span className="h-8 w-8 shrink-0 rounded-md border border-border" style={{ backgroundColor: item.color }} /> : null}
          </div>
          {item.description ? <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/85">{item.description}</p> : null}
          {item.blocked && item.blockedReason ? (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{item.blockedReason}</div>
          ) : null}
          <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="font-medium text-foreground">Source:</span> {item.sourceType}</div>
            <div><span className="font-medium text-foreground">Start:</span> {formatRouteDate(item.startDate)}</div>
            <div><span className="font-medium text-foreground">Due:</span> {formatRouteDate(item.dueDate)}</div>
            <div><span className="font-medium text-foreground">Completed:</span> {formatRouteDate(item.completedAt)}</div>
          </div>
          {item.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}
            </div>
          ) : null}
        </div>

        {checklistLists.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Checklist</h2>
            <div className="mt-3 space-y-4">
              {checklistLists.map((list) => (
                <div key={list.id} className="rounded-md border border-border/70 bg-background p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">{list.name}</div>
                  <div className="space-y-2">
                    {list.items.map((check) => (
                      <div key={check.id} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5">{check.completed ? '[x]' : '[ ]'}</span>
                        <span className={check.completed ? 'text-muted-foreground line-through' : 'text-foreground'}>{check.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {item.notes.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Notes</h2>
            <div className="mt-3 space-y-3">
              {item.notes.map((note) => (
                <div key={note.id} className="rounded-md border border-border/70 bg-background p-3">
                  {note.title ? <div className="mb-1 text-sm font-medium text-foreground">{note.title}</div> : null}
                  <div className="whitespace-pre-wrap text-sm text-foreground/85">{note.text}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(documents.length > 0 || sources.length > 0) ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Links</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {documents.map((document) => {
                const target = document.kind === 'local' ? document.path : document.url;
                return (
                  <button
                    key={document.id}
                    type="button"
                    disabled={!target}
                    onClick={() => {
                      if (!target) return;
                      if (document.kind === 'local') {
                        void accomplish.openPath(target);
                      } else {
                        void accomplish.openExternal(target);
                      }
                    }}
                    className="rounded-md border border-border/70 bg-background p-3 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="font-medium text-foreground">{document.label || 'Document'}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{target || 'No target'}</div>
                  </button>
                );
              })}
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => void accomplish.openExternal(source.url)}
                  className="rounded-md border border-border/70 bg-background p-3 text-left text-sm hover:bg-muted"
                >
                  <div className="font-medium text-foreground">{source.title || source.url}</div>
                  {source.description ? <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{source.description}</div> : null}
                  <div className="mt-1 truncate text-xs text-muted-foreground">{source.url}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
