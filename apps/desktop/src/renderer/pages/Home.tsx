'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo, type CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TaskInputBar, { type TaskInputBarHandle } from '../components/landing/TaskInputBar';
import { DeferredSettingsDialog as SettingsDialog } from '../components/layout/DeferredDialogs';
import ModeSwitch from '../components/layout/ModeSwitch';
import BuildRuntimeIndicator from '../components/layout/BuildRuntimeIndicator';
import { useTaskStore } from '../stores/taskStore';
import { useAgentStore } from '../stores/agentStore';
import { getAccomplish } from '../lib/accomplish';
import { springs, staggerContainer, staggerItem } from '../lib/animations';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ChevronDown, Code, Sparkles, User } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AgentAppearance, SelectedModel } from '@accomplish/shared';
import { createAppSlashCommands } from '../lib/app-commands';
import { usePluginSlashCommands } from '../hooks/usePluginSlashCommands';
import {
  normalizeSelectedModel,
  SELECTED_MODEL_CHANGED_EVENT,
} from '../lib/selected-model-events';
import { cn } from '@/lib/utils';
import ChatBackgroundSwitcher from '@/components/chat/ChatBackgroundSwitcher';
import {
  DEFAULT_CHAT_BACKGROUND_ID,
  getChatBackground,
  normalizeChatBackgroundId,
} from '@/lib/chat-backgrounds';
import { useTopBarControls } from '../stores/topBarControlsStore';

// Import use case images for proper bundling in production
import calendarPrepNotesImg from '/assets/usecases/calendar-prep-notes.png';
import inboxPromoCleanupImg from '/assets/usecases/inbox-promo-cleanup.png';
import competitorPricingDeckImg from '/assets/usecases/competitor-pricing-deck.png';
import notionApiAuditImg from '/assets/usecases/notion-api-audit.png';
import stagingVsProdVisualImg from '/assets/usecases/staging-vs-prod-visual.png';
import prodBrokenLinksImg from '/assets/usecases/prod-broken-links.png';
import stockPortfolioAlertsImg from '/assets/usecases/stock-portfolio-alerts.png';
import jobApplicationAutomationImg from '/assets/usecases/job-application-automation.png';
import eventCalendarBuilderImg from '/assets/usecases/event-calendar-builder.png';

const USE_CASE_EXAMPLES = [
  {
    title: 'Calendar Prep Notes',
    description: 'Review tomorrow\'s meetings and draft a prep notes doc.',
    prompt: 'Check my Google Calendar for tomorrow\'s meetings and draft preparation notes in a new Google Doc.',
    image: calendarPrepNotesImg,
  },
  {
    title: 'Inbox Promo Cleanup',
    description: 'Clear promotional emails from the last 24 hours.',
    prompt: 'Go to my Gmail inbox and delete all promotional emails from the last 24 hours.',
    image: inboxPromoCleanupImg,
  },
  {
    title: 'Competitor Pricing Deck',
    description: 'Analyze competitor pricing and draft a slide with recommendations.',
    prompt: 'Pull pricing and features from these 5 competitor sites [list URLs], save to a CSV, analyze our pricing gaps, and draft a recommendation slide in Google Slides for Monday\'s meeting.',
    image: competitorPricingDeckImg,
  },
  {
    title: 'Notion API Audit',
    description: 'Scan a Notion wiki for old API mentions with direct links.',
    prompt: 'Read through this Notion wiki at [URL] and find all mentions of the old API, listing them with page links.',
    image: notionApiAuditImg,
  },
  {
    title: 'Staging vs Prod Visual Check',
    description: 'Compare staging and production visuals with screenshots.',
    prompt: 'Compare my staging site at [URL] to production at [URL] and screenshot any visual differences.',
    image: stagingVsProdVisualImg,
  },
  {
    title: 'Production Broken Links',
    description: 'Check my website for broken links.',
    prompt: 'Open [URL], click through every link, and report any 404 errors.',
    image: prodBrokenLinksImg,
  },
  {
    title: 'Portfolio Monitoring',
    description: 'Watch stock prices, and alert on drops and spikes.',
    prompt: 'Monitor my stock portfolio on [broker site], alert on price drops and spikes.',
    image: stockPortfolioAlertsImg,
  },
  {
    title: 'Job Application Automation',
    description: 'Filter jobs and submit applications with saved profiles.',
    prompt: 'Find job listings from Indeed for [query], sort by salary, and apply to the top 5 using my profile.',
    image: jobApplicationAutomationImg,
  },
  {
    title: 'Event Calendar Builder',
    description: 'Select top events and add them to the calendar.',
    prompt: 'Scrape event listings from Eventbrite, filter by location, and add top 5 to my calendar.',
    image: eventCalendarBuilderImg,
  },
];

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  xai: 'xAI',
  ollama: 'Ollama',
};

function formatSelectedModelBadgeLabel(model: SelectedModel | null | undefined): string {
  if (!model || typeof model !== 'object') return '';
  const providerId = typeof model.provider === 'string' ? model.provider.trim() : '';
  const modelFullId = typeof model.model === 'string' ? model.model.trim() : '';
  if (!modelFullId) return '';

  const providerPrefix = providerId ? `${providerId}/`.toLowerCase() : '';
  let modelName = modelFullId;
  if (providerPrefix && modelFullId.toLowerCase().startsWith(providerPrefix)) {
    modelName = modelFullId.slice(providerPrefix.length);
  } else if (modelFullId.includes('/')) {
    modelName = modelFullId.slice(modelFullId.indexOf('/') + 1);
  }

  const providerLabel = PROVIDER_LABELS[providerId.toLowerCase()] || providerId;
  return providerLabel ? `${providerLabel}: ${modelName}` : modelName;
}

// Memoized examples grid — prevents 9 animated image cards from
// re-rendering on every keystroke in the prompt textarea.
const ExamplesGrid = memo(function ExamplesGrid({ onExampleClick }: { onExampleClick: (prompt: string) => void }) {
  return (
    <div
      className="px-5 pt-2 pb-5 overflow-y-auto max-h-[360px]"
      style={{
        background: 'linear-gradient(to bottom, hsl(var(--muted) / 0.3) 0%, transparent 100%)',
      }}
    >
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid grid-cols-3 gap-3"
      >
        {USE_CASE_EXAMPLES.map((example, index) => (
          <motion.button
            key={index}
            data-testid={`home-example-${index}`}
            variants={staggerItem}
            transition={springs.gentle}
            whileHover={{ scale: 1.02, y: -2, transition: { duration: 0.15 } }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onExampleClick(example.prompt)}
            className="flex flex-col items-center gap-2.5 p-3.5 rounded-xl border border-border/50 bg-card/80 hover:border-primary/30 hover:bg-accent/50 hover:shadow-soft transition-all duration-200"
          >
            <div className="w-14 h-14 rounded-xl overflow-hidden shadow-soft">
              <img
                src={example.image}
                alt={example.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col items-center gap-1 w-full">
              <div className="font-semibold text-xs text-foreground text-center">
                {example.title}
              </div>
              <div className="text-[11px] text-muted-foreground text-center line-clamp-2 leading-relaxed">
                {example.description}
              </div>
            </div>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
});

export default function HomePage() {
  const taskInputRef = useRef<TaskInputBarHandle>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [planningJobs, setPlanningJobs] = useState(false);
  const [proactiveOpen, setProactiveOpen] = useState(false);
  const [proactiveError, setProactiveError] = useState<string | null>(null);
  const [proactiveSuggestions, setProactiveSuggestions] = useState<
    Array<{ id: string; title: string; why: string; prompt: string; confirmation: string }>
  >([]);
  const [globalWorkspace, setGlobalWorkspace] = useState<string | null>(null);
  const [globalSelectedModel, setGlobalSelectedModel] = useState<SelectedModel | null>(null);
  const [privacyMode, setPrivacyMode] = useState<'normal' | 'incognito'>('normal');
  const { startTask, isLoading, addTaskUpdate, error } = useTaskStore();
  const { agents, activeAgentId, loadAgents, upsertAgent } = useAgentStore();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const [pendingAgentChatBackgroundId, setPendingAgentChatBackgroundId] = useState<string | null>(null);
  const [pendingAgentAppearance, setPendingAgentAppearance] = useState<Partial<AgentAppearance>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const accomplish = getAccomplish();
  const pluginSlashCommands = usePluginSlashCommands();
  const homeSlashCommands = useMemo(() => (
    createAppSlashCommands({
      navigate,
      pathname: location.pathname,
      context: 'home',
      search: location.search,
      modeSwitchTarget: 'build',
      pluginCommands: pluginSlashCommands,
    })
  ), [location.pathname, location.search, navigate, pluginSlashCommands]);

  const refreshGlobalSelectedModel = useCallback(async () => {
    try {
      const selected = await accomplish.getSelectedModel();
      setGlobalSelectedModel(selected ?? null);
    } catch {
      setGlobalSelectedModel(null);
    }
  }, [accomplish]);

  // Subscribe to task events
  useEffect(() => {
    const unsubscribeTask = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    return () => {
      unsubscribeTask();
    };
  }, [addTaskUpdate, accomplish]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    accomplish.getAppSettings()
      .then((settings) => {
        setGlobalWorkspace(settings.workspaceRoot || null);
      })
      .catch((err) => {
        console.warn('Failed to load app settings for workspace default:', err);
      });
  }, [accomplish]);

  useEffect(() => {
    void refreshGlobalSelectedModel();
  }, [refreshGlobalSelectedModel]);

  useEffect(() => {
    const handleSelectedModelChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setGlobalSelectedModel(normalizeSelectedModel(detail));
    };
    window.addEventListener(SELECTED_MODEL_CHANGED_EVENT, handleSelectedModelChanged);
    return () => {
      window.removeEventListener(SELECTED_MODEL_CHANGED_EVENT, handleSelectedModelChanged);
    };
  }, []);

  const executeTask = useCallback(async (
    prompt: string,
    workingFolder?: string,
    attachedFiles?: string[],
    mode: 'normal' | 'incognito' = privacyMode,
    usageProjectId?: string | null
  ) => {
    if (!prompt.trim() || isLoading) return;

    const taskId = `task_${Date.now()}`;
    const taskPromise = startTask({
      prompt: prompt.trim(),
      taskId,
      workingDirectory: workingFolder,
      attachedFiles: attachedFiles && attachedFiles.length > 0 ? attachedFiles : undefined,
      privacyMode: mode,
      usageProjectId: usageProjectId ?? null,
    });
    navigate(`/execution/${taskId}`);
    void taskPromise.then((task) => {
      if (task?.id && task.id !== taskId) {
        navigate(`/execution/${task.id}`, { replace: true });
      }
    }).catch(() => {
      // startTask records the error in the shared task store.
    });
  }, [isLoading, navigate, startTask, privacyMode]);

  const handlePlanNextJobs = useCallback(async () => {
    setPlanningJobs(true);
    setProactiveError(null);
    try {
      const plan = await accomplish.planNextJobs(activeAgentId);
      setProactiveSuggestions(Array.isArray(plan?.suggestions) ? plan.suggestions : []);
      setProactiveOpen(true);
    } catch (err) {
      setProactiveSuggestions([]);
      setProactiveError(err instanceof Error ? err.message : String(err));
      setProactiveOpen(true);
    } finally {
      setPlanningJobs(false);
    }
  }, [accomplish, activeAgentId]);

  const handleSubmit = useCallback(async (
    prompt: string,
    workingFolder?: string,
    attachedFiles?: string[],
    mode: 'normal' | 'incognito' = privacyMode,
    usageProjectId?: string | null
  ) => {
    if (!prompt.trim() || isLoading) return false;
    setSubmitError(null);

    // Check if user has any API key (Anthropic, OpenAI, Google, etc.) or Ollama configured before sending
    let hasKey = false;
    let hasOllamaConfigured = false;
    try {
      hasKey = await accomplish.hasAnyApiKey();
      const selectedModel = await accomplish.getSelectedModel();
      hasOllamaConfigured = selectedModel?.provider === 'ollama';
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to check API key status.');
      setShowSettingsDialog(true);
      return false;
    }

    if (!hasKey && !hasOllamaConfigured) {
      setShowSettingsDialog(true);
      return false;
    }

    await executeTask(prompt, workingFolder, attachedFiles, mode, usageProjectId);
    return true;
  }, [isLoading, accomplish, executeTask, privacyMode]);

  const handleSettingsDialogChange = useCallback((open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      void refreshGlobalSelectedModel();
    }
  }, [refreshGlobalSelectedModel]);

  const handleApiKeySaved = useCallback(async () => {
    // API key was saved - close dialog and execute the task
    setShowSettingsDialog(false);
    await refreshGlobalSelectedModel();
    const currentText = taskInputRef.current?.getValue() ?? '';
    if (currentText.trim()) {
      await executeTask(currentText, undefined, undefined, privacyMode);
    }
  }, [executeTask, privacyMode, refreshGlobalSelectedModel]);

  const handleExampleClick = useCallback((examplePrompt: string) => {
    taskInputRef.current?.setValue(examplePrompt);
  }, []);

  const defaultWorkspace = activeAgent?.workspaceRoot ?? globalWorkspace ?? null;
  const activeAgentDisplayName = activeAgent?.name || activeAgentId || 'main';
  const effectiveSelectedModel = activeAgent?.selectedModel ?? globalSelectedModel;
  useEffect(() => {
    setPendingAgentChatBackgroundId(null);
    setPendingAgentAppearance({});
  }, [
    activeAgent?.id,
    activeAgent?.appearance?.accentColor,
    activeAgent?.appearance?.answerStyle,
    activeAgent?.appearance?.avatarFrame,
    activeAgent?.appearance?.chatBackgroundId,
    activeAgent?.appearance?.presenceAnimation,
    activeAgent?.appearance?.reactionMode,
    activeAgent?.appearance?.showAvatarOnAnswers,
  ]);

  const agentChatBackgroundId = normalizeChatBackgroundId(
    pendingAgentChatBackgroundId
    ?? activeAgent?.appearance?.chatBackgroundId
    ?? DEFAULT_CHAT_BACKGROUND_ID
  );
  const effectiveAgentAppearance = useMemo<AgentAppearance>(() => ({
    ...(activeAgent?.appearance || {}),
    ...pendingAgentAppearance,
  }), [activeAgent?.appearance, pendingAgentAppearance]);
  const selectedBackground = getChatBackground(agentChatBackgroundId);
  const chatBackgroundStyle = useMemo<CSSProperties>(() => {
    if (!selectedBackground) return {};
    return {
      backgroundImage: `linear-gradient(135deg, hsl(var(--background) / 0.22), hsl(var(--background) / 0.38)), url("${selectedBackground.src}")`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
    };
  }, [selectedBackground]);
  const handleUpdateAgentAppearance = useCallback((patch: Partial<AgentAppearance>) => {
    const normalizedPatch: Partial<AgentAppearance> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'chatBackgroundId')) {
      const normalized = normalizeChatBackgroundId(patch.chatBackgroundId);
      setPendingAgentChatBackgroundId(normalized);
      normalizedPatch.chatBackgroundId = normalized === DEFAULT_CHAT_BACKGROUND_ID ? undefined : normalized;
    }
    setPendingAgentAppearance((prev) => ({ ...prev, ...normalizedPatch }));
    const targetAgentId = String(activeAgentId || '').trim();
    const targetAgent = useAgentStore.getState().agents.find((agent) => agent.id === targetAgentId);
    if (!targetAgent) return;

    const nextAppearance = {
      ...(targetAgent.appearance || {}),
      ...normalizedPatch,
    };
    const hasAppearance = Object.values(nextAppearance).some((value) => value !== undefined);
    void upsertAgent({
      id: targetAgent.id,
      name: targetAgent.name,
      appearance: hasAppearance ? nextAppearance : null,
    }).catch(() => {
      setPendingAgentChatBackgroundId(null);
      setPendingAgentAppearance({});
    });
  }, [activeAgentId, upsertAgent]);
  const handleSelectAgentChatBackground = useCallback((id: string) => {
    handleUpdateAgentAppearance({ chatBackgroundId: id });
  }, [handleUpdateAgentAppearance]);
  const landingModelBadgeLabel = useMemo(
    () => formatSelectedModelBadgeLabel(effectiveSelectedModel),
    [effectiveSelectedModel]
  );
  const homeTopBarControls = useMemo(() => (
    <div
      className={cn(
        'flex max-w-[min(64vw,860px)] items-center gap-2 overflow-x-auto rounded-full border border-border/60 px-2 py-1 shadow-md backdrop-blur-md',
        selectedBackground ? 'bg-background/28' : 'bg-card/85'
      )}
    >
      <div className="shrink-0">
        <ModeSwitch />
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <BuildRuntimeIndicator agentId={activeAgentId} />
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700">
          <CheckCircle2 className="h-3 w-3" />
          Ready
        </span>
        {landingModelBadgeLabel && (
          <span
            title={landingModelBadgeLabel}
            className="inline-flex max-w-[260px] shrink-0 items-center gap-1.5 truncate rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
          >
            <Code className="h-3 w-3 shrink-0" />
            <span className="truncate">Model: {landingModelBadgeLabel}</span>
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <User className="h-3 w-3" />
          Agent: {activeAgentDisplayName}
        </span>
      </div>
    </div>
  ), [activeAgentDisplayName, activeAgentId, landingModelBadgeLabel, selectedBackground]);
  useTopBarControls(homeTopBarControls);

  return (
    <>
      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={handleSettingsDialogChange}
        onApiKeySaved={handleApiKeySaved}
      />
      <div
        className="h-full flex flex-col bg-background"
        style={selectedBackground ? chatBackgroundStyle : undefined}
      >
        <div
          className={cn('relative flex-1 overflow-y-auto bg-background', !selectedBackground && 'gradient-subtle')}
          style={chatBackgroundStyle}
        >
          <ChatBackgroundSwitcher
            selectedId={agentChatBackgroundId}
            onSelect={handleSelectAgentChatBackground}
            appearance={effectiveAgentAppearance}
            onAppearanceChange={handleUpdateAgentAppearance}
            agentAvatar={activeAgent?.avatar}
            agentAvatarColor={activeAgent?.avatarColor}
            agentAvatarImageDataUrl={activeAgent?.avatarImageDataUrl}
          />
          <div className="min-h-full flex items-center justify-center p-8">
            <div className="w-full max-w-4xl flex flex-col items-center gap-10">
        {/* Main Title */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.gentle}
          className="text-center"
        >
          <h1
            data-testid="home-title"
            className="text-4xl font-semibold tracking-tight text-gradient mb-3"
          >
            What will you accomplish today?
          </h1>
          <p className="text-muted-foreground text-base">
            Describe a task and let AI handle the rest
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: 0.1 }}
          className="w-full"
        >
          <Card
            className={cn(
              'w-full shadow-glow gap-0 py-0 flex flex-col max-h-[calc(100vh-4rem)] overflow-visible',
              selectedBackground
                ? 'border-border/45 bg-background/30 backdrop-blur-md'
                : 'card-glass'
            )}
          >
            <CardContent className="p-6 pb-4 flex-shrink-0 overflow-visible">
              {/* Input Section */}
              <TaskInputBar
                ref={taskInputRef}
                onSubmit={handleSubmit}
                isLoading={isLoading}
                placeholder="Type your task here..."
                large={true}
                autoFocus={true}
                defaultWorkingFolder={defaultWorkspace}
                initialWorkingFolder={typeof location.state?.buildWorkspace === 'string' ? location.state.buildWorkspace : undefined}
                onPlanNextJobs={handlePlanNextJobs}
                planningJobs={planningJobs}
                agentId={activeAgentId}
                privacyMode={privacyMode}
                onPrivacyModeChange={setPrivacyMode}
                slashCommands={homeSlashCommands}
              />
              {planningJobs && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Planning suggestions from memory…
                </div>
              )}
              {(submitError || error) && (
                <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError || error}
                </div>
              )}
            </CardContent>

            {/* Proactive suggestions dialog */}
            <Dialog
              open={proactiveOpen}
              onOpenChange={(open) => {
                setProactiveOpen(open);
                if (!open) {
                  setProactiveError(null);
                  setProactiveSuggestions([]);
                }
              }}
            >
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Suggestions from memory
                  </DialogTitle>
                  <DialogDescription>
                    Deskmate proposes a few tasks you might want to run next. Nothing runs until you click Yes.
                  </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {planningJobs ? (
                    <div className="text-sm text-muted-foreground">Planning…</div>
                  ) : proactiveError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {proactiveError}
                    </div>
                  ) : proactiveSuggestions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No strong suggestions right now.</div>
                  ) : (
                    <div className="space-y-3">
                      {proactiveSuggestions.map((s) => (
                        <Card key={s.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-foreground">{s.title}</div>
                              {s.why && <div className="mt-1 text-sm text-muted-foreground">{s.why}</div>}
                              <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground whitespace-pre-wrap">
                                {s.prompt}
                              </div>
                              <div className="mt-3 text-xs text-muted-foreground">
                                {s.confirmation || 'Run this task now?'}
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setProactiveSuggestions((prev) => {
                                    const next = prev.filter((entry) => entry.id !== s.id);
                                    if (next.length === 0) setProactiveOpen(false);
                                    return next;
                                  });
                                }}
                              >
                                No
                              </Button>
                              <Button
                                onClick={() => {
                                  setProactiveOpen(false);
                                  setProactiveError(null);
                                  setProactiveSuggestions([]);
                                  void executeTask(s.prompt);
                                }}
                              >
                                Yes
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setProactiveOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Examples Toggle */}
            <div className="border-t border-border/50">
              <button
                onClick={() => setShowExamples(!showExamples)}
                className="w-full px-6 py-3.5 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-all duration-200"
              >
                <span className="font-medium">Example prompts</span>
                <motion.div
                  animate={{ rotate: showExamples ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="bg-muted rounded-full p-1"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </motion.div>
              </button>

              <AnimatePresence>
                {showExamples && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <ExamplesGrid onExampleClick={handleExampleClick} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>
        </motion.div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
