'use client';

import { ExperiencePreferencesSync } from './components/chat/ExperienceSettings';
import { FocusSceneLifecycle, supportsFocusScene } from './components/chat/FocusScene';
import { useFocusSceneStore } from './stores/focusSceneStore';
import { MotionConfig } from 'framer-motion';
import { useExperienceStore } from './stores/experienceStore';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getAccomplish, isRunningInElectron } from './lib/accomplish';
import { analytics } from './lib/analytics';

// Pages
import HomePage from './pages/Home';
import OnboardingPage from './pages/Onboarding';

// Components
import { AlertTriangle, Loader2 } from 'lucide-react';
import Sidebar from './components/layout/Sidebar';
import { TaskLauncher } from './components/TaskLauncher';
import PermissionRequestModal from './components/tasks/PermissionRequestModal';
import { GlobalUsageBanner } from './components/usage/GlobalUsageBanner';
import { useTaskStore } from './stores/taskStore';

const ExecutionPage = lazy(() => import('./pages/Execution'));
const HelpPage = lazy(() => import('./pages/Help'));
const BuildPage = lazy(() => import('./pages/Build'));
const SubagentsPage = lazy(() => import('./pages/Subagents'));
const WorkboardItemRoutePage = lazy(() => import('./pages/WorkboardItem').then(module => ({ default: module.WorkboardItemRoutePage })));

function PageLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading workspace…
    </div>
  );
}

type AppStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const focusScene = useFocusSceneStore(state => state.active);
  const experienceMode = useExperienceStore(state => state.mode);
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
    <MotionConfig reducedMotion={experienceMode === 'calm' ? 'always' : 'user'}>
    <div className="flex h-screen overflow-hidden bg-background" data-focus-scene={focusScene && supportsFocusScene(location.pathname) ? 'active' : undefined}>
      <FocusSceneLifecycle />
      <ExperiencePreferencesSync />
      <PermissionRequestModal
        request={permissionRequest}
        onRespond={handlePermissionResponse}
        testId="global-permission-modal"
      />
      {/* Invisible drag region for window dragging (macOS hiddenInset titlebar) */}
      <div className="drag-region fixed top-0 left-0 right-0 h-10 z-50 pointer-events-none" />
      <div className="contents" data-focus-secondary="navigation"><Sidebar /></div>
      <main className="min-w-0 flex-1 overflow-hidden flex flex-col">
        <div className="shrink-0">
          <GlobalUsageBanner />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={<PageLoading />}>
            <Routes location={location} key={location.pathname}>
              <Route
                path="/"
                element={
                  <div className="h-full">
                    <HomePage />
                  </div>
                }
              />
              <Route
                path="/execution/:id"
                element={
                  <div className="h-full">
                    <ExecutionPage />
                  </div>
                }
              />
              <Route
                path="/help"
                element={
                  <div className="h-full">
                    <HelpPage />
                  </div>
                }
              />
              <Route
                path="/help/:docId"
                element={
                  <div className="h-full">
                    <HelpPage />
                  </div>
                }
              />
              <Route
                path="/build"
                element={
                  <div className="h-full">
                    <BuildPage />
                  </div>
                }
              />
              <Route
                path="/subagents"
                element={
                  <div className="h-full">
                    <SubagentsPage />
                  </div>
                }
              />
              <Route
                path="/workboard/:projectId/:itemId"
                element={
                  <div className="h-full">
                    <WorkboardItemRoutePage />
                  </div>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      <TaskLauncher />
    </div>
    </MotionConfig>
  );
}
