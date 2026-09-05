'use client';

import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { UsageProject, UsageProjectWorkItem } from '@accomplish/shared';
import { isRunningInElectron, getAccomplish } from './lib/accomplish';
import { springs, variants } from './lib/animations';
import { analytics } from './lib/analytics';

// Pages
import HomePage from './pages/Home';
import ExecutionPage from './pages/Execution';
import OnboardingPage from './pages/Onboarding';
import HelpPage from './pages/Help';
import BuildPage from './pages/Build';
import SubagentsPage from './pages/Subagents';

// Components
import Sidebar from './components/layout/Sidebar';
import { TaskLauncher } from './components/TaskLauncher';
import { useTaskStore } from './stores/taskStore';
import { Loader2, AlertTriangle } from 'lucide-react';
import { GlobalUsageBanner } from './components/usage/GlobalUsageBanner';
import PermissionRequestModal from './components/tasks/PermissionRequestModal';

type AppStatus = 'loading' | 'ready' | 'error';

function decodeRouteParam(value: string | undefined): string {
  try {
    return decodeURIComponent(value || '').trim();
  } catch {
    return String(value || '').trim();
  }
}

function formatRouteDate(value?: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleString();
}

function WorkboardItemRoutePage() {
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

export default function App() {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Get launcher actions
  const {
    openLauncher,
    permissionRequest,
    respondToPermission,
    setPermissionRequest,
  } = useTaskStore();

  // Track page views on route changes
  useEffect(() => {
    analytics.trackPageView(location.pathname);
  }, [location.pathname]);

  // Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openLauncher();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openLauncher]);

  useEffect(() => {
    const checkStatus = async () => {
      // Check if running in Electron
      if (!isRunningInElectron()) {
        setErrorMessage('This application must be run inside the Open Deskmate desktop app.');
        setStatus('error');
        return;
      }

      try {
        const accomplish = getAccomplish();
        const complete = await accomplish.getOnboardingComplete();
        setOnboardingComplete(complete);
        setStatus('ready');
      } catch (error) {
        console.error('Failed to initialize app:', error);
        // Still allow app to run even if setting fails
        setOnboardingComplete(true);
        setStatus('ready');
      }
    };

    checkStatus();
  }, []);

  useEffect(() => {
    if (!isRunningInElectron()) return;
    const accomplish = getAccomplish();
    const unsubscribe = accomplish.onHelpNavigate?.((payload) => {
      const docId = typeof payload?.docId === 'string' ? payload.docId.trim() : '';
      const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
      const path = docId
        ? `/help/${encodeURIComponent(docId)}`
        : '/help';
      const search = query ? `?q=${encodeURIComponent(query)}` : '';
      navigate(`${path}${search}`);
    });
    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (!isRunningInElectron()) return;
    const accomplish = getAccomplish();
    let disposed = false;

    const unsubscribePermission = accomplish.onPermissionRequest((request) => {
      setPermissionRequest(request);
    });

    void accomplish.getPendingPermissionRequests()
      .then((requests) => {
        if (!disposed && requests[0]) {
          setPermissionRequest(requests[0]);
        }
      })
      .catch((err) => {
        console.warn('Failed to load pending permission requests:', err);
      });

    return () => {
      disposed = true;
      unsubscribePermission();
    };
  }, [setPermissionRequest]);

  const handlePermissionResponse = async (decision: 'allow' | 'allow_all' | 'deny') => {
    if (!permissionRequest) return;
    await respondToPermission({
      requestId: permissionRequest.id,
      taskId: permissionRequest.taskId,
      decision,
    });
  };

  // Loading state
  if (status === 'loading' || onboardingComplete === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-foreground">Unable to Start</h1>
          <p className="text-muted-foreground">{errorMessage}</p>
        </div>
      </div>
    );
  }

  // Onboarding - render wizard without main app chrome
  if (!onboardingComplete) {
    return <OnboardingPage onComplete={() => setOnboardingComplete(true)} />;
  }

  // Ready - render the app with sidebar
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PermissionRequestModal
        request={permissionRequest}
        onRespond={handlePermissionResponse}
        testId="global-permission-modal"
      />
      {/* Invisible drag region for window dragging (macOS hiddenInset titlebar) */}
      <div className="drag-region fixed top-0 left-0 right-0 h-10 z-50 pointer-events-none" />
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="shrink-0">
          <GlobalUsageBanner />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route
                path="/"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <HomePage />
                  </motion.div>
                }
              />
              <Route
                path="/execution/:id"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <ExecutionPage />
                  </motion.div>
                }
              />
              <Route
                path="/help"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <HelpPage />
                  </motion.div>
                }
              />
              <Route
                path="/help/:docId"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <HelpPage />
                  </motion.div>
                }
              />
              <Route
                path="/build"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <BuildPage />
                  </motion.div>
                }
              />
              <Route
                path="/subagents"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <SubagentsPage />
                  </motion.div>
                }
              />
              <Route
                path="/workboard/:projectId/:itemId"
                element={
                  <motion.div
                    className="h-full"
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    variants={variants.fadeUp}
                    transition={springs.gentle}
                  >
                    <WorkboardItemRoutePage />
                  </motion.div>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AnimatePresence>
        </div>
      </main>
      <TaskLauncher />
    </div>
  );
}
