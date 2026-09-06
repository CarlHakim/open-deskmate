'use client';

import { Button } from '@/components/ui/button';
import {
Dialog,
DialogContent,
DialogHeader,
DialogTitle,
} from '@/components/ui/dialog';
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuLabel,
DropdownMenuRadioGroup,
DropdownMenuRadioItem,
DropdownMenuSeparator,
DropdownMenuSub,
DropdownMenuSubContent,
DropdownMenuSubTrigger,
DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
Popover,
PopoverContent,
PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/contexts/ThemeContext';
import { getAccomplish } from '@/lib/accomplish';
import { isAgentCharacterAvatar } from '@/lib/agent-character-gallery';
import { analytics } from '@/lib/analytics';
import { staggerContainer } from '@/lib/animations';
import { APP_COMMAND_EVENTS } from '@/lib/app-commands';
import {
normalizeSelectedModel,
SELECTED_MODEL_CHANGED_EVENT,
} from '@/lib/selected-model-events';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { useFolderStore } from '@/stores/folderStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUsageProjectStore } from '@/stores/usageProjectStore';
import type { ProviderConfig, SelectedModel, Task } from '@accomplish/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Briefcase, Check, ChevronDown, ChevronRight, CircleHelp, FileSearch, FolderPlus, GitBranch, GripVertical, MessageSquarePlus, Monitor, Moon, MoreHorizontal, Search, Settings, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import appFavicon from '../../../../resources/icon.png';
import { AgentAvatarIcon } from './AgentAvatarPicker';
import ConversationListItem, { getTaskDisplayTitle, getTaskHoverTitle } from './ConversationListItem';
import CreateFolderDialog from './CreateFolderDialog';
import { DeferredProjectManagementDialog as ProjectManagementDialog, DeferredSearchAuditDialog as SearchAuditDialog, DeferredSettingsDialog as SettingsDialog } from './DeferredDialogs';
import FolderItem from './FolderItem';
import { getIconByName } from './ProjectIconPicker';
import logoImage from '/assets/open-deskmate-logo.png';

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google AI',
  xai: 'xAI',
  ollama: 'Ollama',
};

function isPictureAvatar(avatar: string | undefined, imageDataUrl: string | undefined): boolean {
  return Boolean(imageDataUrl || isAgentCharacterAvatar(avatar));
}

const CHAT_SIDEBAR_WIDTH_KEY = 'open-deskmate-chat-sidebar-width';
const CHAT_SIDEBAR_DEFAULT_WIDTH = 280;
const CHAT_SIDEBAR_MIN_WIDTH = 220;
const CHAT_SIDEBAR_MAX_WIDTH = 460;

function clampSidebarWidth(value: number): number {
  return Math.max(CHAT_SIDEBAR_MIN_WIDTH, Math.min(CHAT_SIDEBAR_MAX_WIDTH, Math.round(value)));
}

function readChatSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_KEY);
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : CHAT_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return CHAT_SIDEBAR_DEFAULT_WIDTH;
  }
}

function formatSelectedModelLabel(model: SelectedModel | null | undefined): string {
  if (!model) return 'Global default';
  const providerId = typeof model.provider === 'string' ? model.provider.trim() : '';
  const modelFullId = typeof model.model === 'string' ? model.model.trim() : '';
  if (!providerId && !modelFullId) return 'Global default';

  let modelName = modelFullId;
  const providerPrefix = providerId ? `${providerId}/`.toLowerCase() : '';
  if (providerPrefix && modelFullId.toLowerCase().startsWith(providerPrefix)) {
    modelName = modelFullId.slice(providerPrefix.length);
  }

  const providerLabel = PROVIDER_LABELS[providerId.toLowerCase()] || providerId;
  return providerLabel ? `${providerLabel}: ${modelName}` : modelName;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [showSearchAudit, setShowSearchAudit] = useState(false);
  const [showProjectManagement, setShowProjectManagement] = useState(false);
  const [projectManagementInitialProjectId, setProjectManagementInitialProjectId] = useState<string | null>(null);
  const [pendingSettingsSectionQuery, setPendingSettingsSectionQuery] = useState('');
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [reorderList, setReorderList] = useState<string[]>([]);
  const [reorderDragId, setReorderDragId] = useState<string | null>(null);
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [providerCatalog, setProviderCatalog] = useState<ProviderConfig[]>([]);
  const [globalSelectedModel, setGlobalSelectedModel] = useState<SelectedModel | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, { exists: boolean; prefix?: string }>>({});
  const [agentModelUpdating, setAgentModelUpdating] = useState(false);
  const [chatSidebarWidth, setChatSidebarWidth] = useState(readChatSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  const MAX_VISIBLE_PROJECTS = 5;
  const { tasks, loadTasks, updateTaskStatus, addTaskUpdate, insertTask, openLauncher, setTaskFolder, clearCurrentTask } = useTaskStore();
  const { folders, loadFolders, toggleFolderExpanded, reorderFolders } = useFolderStore();
  const { agents, activeAgentId, defaultAgentId, loadAgents, setActiveAgent, upsertAgent } = useAgentStore();
  const { projects: usageProjects, archivedProjects: archivedUsageProjects, loadProjects: loadUsageProjects } = useUsageProjectStore();
  const { theme, setTheme } = useTheme();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const isBuildModeRoute = location.pathname === '/build';
  const isSubagentsRoute = location.pathname === '/subagents';

  const accomplish = getAccomplish();

  const openProjectManagement = (projectId?: string | null) => {
    setProjectManagementInitialProjectId(projectId || null);
    setShowProjectManagement(true);
  };

  const getUsageProjectColor = (projectId?: string | null): string => {
    if (!projectId) return '#2dd4bf';
    return [...usageProjects, ...archivedUsageProjects].find((project) => project.id === projectId)?.color || '#2dd4bf';
  };

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isBuildModeRoute) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = chatSidebarWidth;
    setSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setChatSidebarWidth(nextWidth);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const finalWidth = clampSidebarWidth(startWidth + upEvent.clientX - startX);
      setChatSidebarWidth(finalWidth);
      try {
        window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_KEY, String(finalWidth));
      } catch {
        // Ignore storage failures.
      }
      setSidebarResizing(false);
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

  const resetSidebarWidth = () => {
    setChatSidebarWidth(CHAT_SIDEBAR_DEFAULT_WIDTH);
    try {
      window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_KEY, String(CHAT_SIDEBAR_DEFAULT_WIDTH));
    } catch {
      // Ignore storage failures.
    }
  };

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks, activeAgentId]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders, activeAgentId]);

  useEffect(() => {
    void loadUsageProjects(true);
  }, [loadUsageProjects]);

  useEffect(() => {
    let cancelled = false;
    void accomplish.getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => {
        if (!cancelled) setAppVersion('');
      });
    return () => {
      cancelled = true;
    };
  }, [accomplish]);

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { query?: unknown } | undefined : undefined;
      setPendingSettingsSectionQuery(typeof detail?.query === 'string' ? detail.query : '');
      setShowSettings(true);
    };
    window.addEventListener('opendeskmate:open-settings', handleOpenSettings as EventListener);
    return () => {
      window.removeEventListener('opendeskmate:open-settings', handleOpenSettings as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleSearchOpen = () => setShowSearchAudit(true);
    window.addEventListener(APP_COMMAND_EVENTS.searchOpen, handleSearchOpen);
    return () => window.removeEventListener(APP_COMMAND_EVENTS.searchOpen, handleSearchOpen);
  }, []);

  // Get tasks organized by folder
  const unfiledTasks = tasks.filter((task) => !task.folderId);
  const getTasksForFolder = (folderId: string) =>
    tasks.filter((task) => task.folderId === folderId);

  // Sort folders by order (already filtered by agent from backend)
  const sortedFolders = [...folders].sort((a, b) => a.order - b.order);

  // Handle drop on unfiled area
  const handleUnfiledDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-primary/10');
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      setTaskFolder(taskId, null);
    }
  };

  const handleUnfiledDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('bg-primary/10');
  };

  const handleUnfiledDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('bg-primary/10');
  };

  // Subscribe to task status changes (queued -> running) and task updates (complete/error)
  // This ensures sidebar always reflects current task status
  useEffect(() => {
    const unsubscribeStatusChange = accomplish.onTaskStatusChange?.((data) => {
      updateTaskStatus(data.taskId, data.status);
    });

    const unsubscribeTaskUpdate = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    const unsubscribeTaskCreated = accomplish.onTaskCreated?.((task) => {
      insertTask(task as Task);
    });

    return () => {
      unsubscribeStatusChange?.();
      unsubscribeTaskUpdate();
      unsubscribeTaskCreated?.();
    };
  }, [updateTaskStatus, addTaskUpdate, insertTask, accomplish]);

  const handleNewConversation = () => {
    analytics.trackNewTask();
    clearCurrentTask();
    window.dispatchEvent(new CustomEvent('opendeskmate:new-chat-task'));
    navigate('/');
  };

  const handleAgentSwitch = async (agentId: string) => {
    if (!agentId || agentId === activeAgentId) return;
    try {
      await setActiveAgent(agentId);
      clearCurrentTask();
      window.dispatchEvent(new CustomEvent('opendeskmate:new-chat-task'));
      navigate('/');
    } catch (error) {
      console.error('Failed to switch agent:', error);
    }
  };

  useEffect(() => {
    if (!agentMenuOpen) return;
    let cancelled = false;

    void (async () => {
      try {
        const [providers, selected, keys] = await Promise.all([
          accomplish.listModelProviders(),
          accomplish.getSelectedModel(),
          accomplish.getAllApiKeys(),
        ]);
        if (cancelled) return;
        setProviderCatalog(Array.isArray(providers) ? providers : []);
        setGlobalSelectedModel((selected as SelectedModel | null) ?? null);
        setApiKeyStatus(keys ?? {});
      } catch {
        if (cancelled) return;
        setProviderCatalog([]);
        setApiKeyStatus({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accomplish, agentMenuOpen]);

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

  const quickSwitchProviders = useMemo(
    () => providerCatalog.filter((provider) => {
      const hasModels = Array.isArray(provider.models) && provider.models.length > 0;
      if (!hasModels) return false;
      if (provider.requiresApiKey === false || provider.id === 'ollama') return true;
      return Boolean(apiKeyStatus?.[provider.id]?.exists);
    }),
    [apiKeyStatus, providerCatalog]
  );

  const quickSwitchValue = activeAgent?.selectedModel?.model || '__global__';

  const handleQuickAgentModelSwitch = async (selection: SelectedModel | null) => {
    if (!activeAgent || agentModelUpdating) return;
    setAgentModelUpdating(true);
    try {
      await upsertAgent({
        id: activeAgent.id,
        name: activeAgent.name,
        roleName: activeAgent.roleName,
        description: activeAgent.description,
        avatar: activeAgent.avatar,
        avatarColor: activeAgent.avatarColor,
        avatarImageDataUrl: activeAgent.avatarImageDataUrl,
        workspaceRoot: activeAgent.workspaceRoot,
        systemPromptAppend: activeAgent.systemPromptAppend,
        selectedModel: selection,
        agenticLoopEnabled: activeAgent.agenticLoopEnabled,
        agenticLoopMaxIterations: activeAgent.agenticLoopMaxIterations,
        agenticLoopTimeoutMs: activeAgent.agenticLoopTimeoutMs,
        heartbeatEnabled: activeAgent.heartbeatEnabled,
        heartbeatIntervalSeconds: activeAgent.heartbeatIntervalSeconds,
        heartbeatScheduleMode: activeAgent.heartbeatScheduleMode,
        heartbeatIntervalMinutes: activeAgent.heartbeatIntervalMinutes,
        heartbeatDailyTime: activeAgent.heartbeatDailyTime,
        heartbeatTimeZone: activeAgent.heartbeatTimeZone,
        heartbeatWindowEnabled: activeAgent.heartbeatWindowEnabled,
        heartbeatWindowStartTime: activeAgent.heartbeatWindowStartTime,
        heartbeatWindowEndTime: activeAgent.heartbeatWindowEndTime,
        heartbeatPrompt: activeAgent.heartbeatPrompt,
        autoSkillEnabled: activeAgent.autoSkillEnabled,
        autoSkillAutoPromoteLowRisk: activeAgent.autoSkillAutoPromoteLowRisk,
      });
    } finally {
      setAgentModelUpdating(false);
    }
  };

  // Open reorder dialog
  const openReorderDialog = () => {
    setReorderList(sortedFolders.map((f) => f.id));
    setShowReorderDialog(true);
  };

  // Reorder dialog drag handlers
  const handleReorderDragStart = (folderId: string) => {
    setReorderDragId(folderId);
  };

  const handleReorderDragOver = (folderId: string) => {
    if (reorderDragId && reorderDragId !== folderId) {
      setReorderTargetId(folderId);
    }
  };

  const handleReorderDragEnd = () => {
    if (reorderDragId && reorderTargetId && reorderDragId !== reorderTargetId) {
      const newOrder = [...reorderList];
      const draggedIndex = newOrder.indexOf(reorderDragId);
      const targetIndex = newOrder.indexOf(reorderTargetId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, reorderDragId);
        setReorderList(newOrder);
      }
    }
    setReorderDragId(null);
    setReorderTargetId(null);
  };

  const saveReorder = () => {
    reorderFolders(reorderList);
    setShowReorderDialog(false);
  };

  const getFolderById = (id: string) => folders.find((f) => f.id === id);
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <>
      <div
        className={cn(
          'relative flex h-screen shrink-0 flex-col sidebar-modern pt-4',
          sidebarResizing ? '' : 'transition-[width] duration-200'
        )}
        style={{ width: isBuildModeRoute ? 56 : chatSidebarWidth }}
      >
        {!isBuildModeRoute && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize task sidebar"
              title="Drag to resize task sidebar"
              onPointerDown={startSidebarResize}
              onDoubleClick={resetSidebarWidth}
              className="absolute right-0 top-0 z-30 h-full w-2 translate-x-1 cursor-col-resize touch-none bg-transparent"
            />
          </>
        )}
        {isBuildModeRoute ? (
          <>
            <div className="px-1.5 pb-2">
              <DropdownMenu open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full flex-col items-center gap-1 rounded-xl border border-border/60 bg-card/80 px-1 py-2 text-foreground transition-all hover:bg-accent/60"
                    title={`${activeAgent?.name || 'Agent'}${activeAgent?.roleName ? `\n${activeAgent.roleName}` : activeAgent?.id || activeAgentId ? `\n${activeAgent?.id || activeAgentId}` : ''}`}
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg"
                      style={{ backgroundColor: activeAgent?.avatarColor ? `${activeAgent.avatarColor}15` : 'hsl(var(--primary) / 0.1)' }}
                    >
                      <AgentAvatarIcon avatar={activeAgent?.avatar} color={activeAgent?.avatarColor || 'hsl(var(--primary))'} imageDataUrl={activeAgent?.avatarImageDataUrl} className={isPictureAvatar(activeAgent?.avatar, activeAgent?.avatarImageDataUrl) ? 'h-full w-full' : 'h-6 w-6'} />
                    </div>
                    <div className="w-full truncate px-0.5 text-center text-[10px] font-medium leading-tight">
                      {activeAgent?.name || 'Agent'}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-60">
                  <DropdownMenuLabel className="pb-1 text-[11px] uppercase tracking-wider text-muted-foreground/80">
                    Quick Model
                  </DropdownMenuLabel>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm">Model</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {activeAgent?.selectedModel
                            ? formatSelectedModelLabel(activeAgent.selectedModel)
                            : `Global (${formatSelectedModelLabel(globalSelectedModel)})`}
                        </div>
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-72">
                      <DropdownMenuRadioGroup
                        value={quickSwitchValue}
                        onValueChange={(value) => {
                          if (value === quickSwitchValue) return;
                          if (value === '__global__') {
                            void handleQuickAgentModelSwitch(null);
                            return;
                          }
                          const selectedProvider = quickSwitchProviders.find((provider) => (
                            provider.models.some((model) => model.fullId === value)
                          ));
                          if (!selectedProvider) return;
                          const selectedModel = selectedProvider.models.find((model) => model.fullId === value);
                          if (!selectedModel) return;
                          void handleQuickAgentModelSwitch({
                            provider: selectedProvider.id,
                            model: selectedModel.fullId,
                          });
                        }}
                      >
                        <DropdownMenuRadioItem value="__global__" disabled={agentModelUpdating}>
                          <div className="min-w-0">
                            <div className="text-sm">Use global default</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {formatSelectedModelLabel(globalSelectedModel)}
                            </div>
                          </div>
                        </DropdownMenuRadioItem>
                        <DropdownMenuSeparator />
                        {quickSwitchProviders.map((provider) => (
                          <DropdownMenuSub key={provider.id}>
                            <DropdownMenuSubTrigger className="text-sm">
                              {provider.name}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-72">
                              <DropdownMenuRadioGroup
                                value={quickSwitchValue}
                                onValueChange={(value) => {
                                  if (value === quickSwitchValue) return;
                                  const selectedModel = provider.models.find((model) => model.fullId === value);
                                  if (!selectedModel) return;
                                  void handleQuickAgentModelSwitch({
                                    provider: provider.id,
                                    model: selectedModel.fullId,
                                  });
                                }}
                              >
                                {provider.models.map((model) => (
                                  <DropdownMenuRadioItem
                                    key={model.fullId}
                                    value={model.fullId}
                                    disabled={agentModelUpdating}
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm">{model.displayName}</div>
                                      <div className="truncate text-[11px] text-muted-foreground">{model.fullId}</div>
                                    </div>
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Agents
                  </div>
                  {agents.map((agent) => {
                    const isActive = agent.id === activeAgentId;
                    const isDefault = agent.id === defaultAgentId;
                    return (
                      <DropdownMenuItem
                        key={agent.id}
                        onClick={() => {
                          if (!isActive) {
                            void handleAgentSwitch(agent.id);
                          }
                        }}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-4 w-4 items-center justify-center">
                            {isActive ? <Check className="h-4 w-4" /> : null}
                          </span>
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md" style={{ backgroundColor: agent.avatarColor ? `${agent.avatarColor}15` : 'hsl(var(--muted))' }}>
                            <AgentAvatarIcon avatar={agent.avatar} color={agent.avatarColor || 'hsl(var(--muted-foreground))'} imageDataUrl={agent.avatarImageDataUrl} className={isPictureAvatar(agent.avatar, agent.avatarImageDataUrl) ? 'h-full w-full' : 'h-6 w-6'} />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm">{agent.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{agent.roleName || agent.id}</div>
                          </div>
                        </div>
                        {isDefault && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Default
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuItem
                    onClick={() => {
                      setPendingSettingsSectionQuery('');
                      setShowSettings(true);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Manage agents
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex-1" />
            <div className="px-2 py-4 border-t border-border/50 flex flex-col items-center gap-2 bg-gradient-to-t from-muted/30 to-transparent">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/subagents', { state: { from: `${location.pathname}${location.search}` } })}
                title="Subagents"
                className={cn(
                  'h-9 w-9 rounded-xl transition-smooth',
                  isSubagentsRoute ? 'bg-accent/90 text-foreground' : 'hover:bg-accent/80'
                )}
              >
                <GitBranch className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSearchAudit(true)}
                title="Search & Audit"
                className="h-9 w-9 rounded-xl hover:bg-accent/80 transition-smooth"
              >
                <FileSearch className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={`Theme: ${theme}`}
                    className="h-9 w-9 rounded-xl hover:bg-accent/80 transition-smooth"
                  >
                    <ThemeIcon className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-40">
                  <DropdownMenuItem
                    onClick={() => setTheme('light')}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <Sun className="h-3.5 w-3.5" />
                      Light
                    </span>
                    {theme === 'light' && <Check className="h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setTheme('dark')}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <Moon className="h-3.5 w-3.5" />
                      Dark
                    </span>
                    {theme === 'dark' && <Check className="h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setTheme('system')}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <Monitor className="h-3.5 w-3.5" />
                      System
                    </span>
                    {theme === 'system' && <Check className="h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                data-testid="sidebar-settings-button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  analytics.trackOpenSettings();
                  setPendingSettingsSectionQuery('');
                  setShowSettings(true);
                }}
                title="Settings"
                className="h-9 w-9 rounded-xl hover:bg-accent/80 transition-smooth"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openProjectManagement()}
                title="Project Management"
                className="h-9 w-9 rounded-xl hover:bg-accent/80 transition-smooth"
              >
                <Briefcase className="h-4 w-4" />
              </Button>
              <TooltipProvider delayDuration={180}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="mt-3 flex items-center justify-center overflow-hidden"
                      aria-label={`Open Deskmate${appVersion ? ` version ${appVersion}` : ''}`}
                    >
                      <img
                        src={appFavicon}
                        alt="Open Deskmate"
                        className="hover-lift transition-smooth select-none"
                        style={{ width: '28px', height: '28px', objectFit: 'contain' }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" sideOffset={10} className="min-w-40">
                    <div className="text-sm font-semibold leading-tight">Open Deskmate</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {appVersion ? `Version ${appVersion}` : 'Version unavailable'}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </>
        ) : (
          <>
        {/* Agent switcher */}
        <div className="px-4 pb-2">
          <DropdownMenu open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-sm text-foreground hover:bg-accent/60 transition-all"
                title="Switch agent"
              >
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: activeAgent?.avatarColor ? `${activeAgent.avatarColor}15` : 'hsl(var(--primary) / 0.1)' }}>
                  <AgentAvatarIcon avatar={activeAgent?.avatar} color={activeAgent?.avatarColor || 'hsl(var(--primary))'} imageDataUrl={activeAgent?.avatarImageDataUrl} className={isPictureAvatar(activeAgent?.avatar, activeAgent?.avatarImageDataUrl) ? 'h-full w-full' : 'h-7 w-7'} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="font-medium truncate">{activeAgent?.name || 'Agent'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {activeAgent?.roleName || activeAgent?.id || activeAgentId || 'main'}
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="pb-1 text-[11px] uppercase tracking-wider text-muted-foreground/80">
                Quick Model
              </DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">Model</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {activeAgent?.selectedModel
                        ? formatSelectedModelLabel(activeAgent.selectedModel)
                        : `Global (${formatSelectedModelLabel(globalSelectedModel)})`}
                    </div>
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72">
                  <DropdownMenuRadioGroup
                    value={quickSwitchValue}
                    onValueChange={(value) => {
                      if (value === quickSwitchValue) return;
                      if (value === '__global__') {
                        void handleQuickAgentModelSwitch(null);
                        return;
                      }
                      const selectedProvider = quickSwitchProviders.find((provider) => (
                        provider.models.some((model) => model.fullId === value)
                      ));
                      if (!selectedProvider) return;
                      const selectedModel = selectedProvider.models.find((model) => model.fullId === value);
                      if (!selectedModel) return;
                      void handleQuickAgentModelSwitch({
                        provider: selectedProvider.id,
                        model: selectedModel.fullId,
                      });
                    }}
                  >
                    <DropdownMenuRadioItem value="__global__" disabled={agentModelUpdating}>
                      <div className="min-w-0">
                        <div className="text-sm">Use global default</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {formatSelectedModelLabel(globalSelectedModel)}
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {quickSwitchProviders.map((provider) => (
                      <DropdownMenuSub key={provider.id}>
                        <DropdownMenuSubTrigger className="text-sm">
                          {provider.name}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-72">
                          <DropdownMenuRadioGroup
                            value={quickSwitchValue}
                            onValueChange={(value) => {
                              if (value === quickSwitchValue) return;
                              const selectedModel = provider.models.find((model) => model.fullId === value);
                              if (!selectedModel) return;
                              void handleQuickAgentModelSwitch({
                                provider: provider.id,
                                model: selectedModel.fullId,
                              });
                            }}
                          >
                            {provider.models.map((model) => (
                              <DropdownMenuRadioItem
                                key={model.fullId}
                                value={model.fullId}
                                disabled={agentModelUpdating}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm">{model.displayName}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">{model.fullId}</div>
                                </div>
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                Agents
              </div>
              {agents.map((agent) => {
                const isActive = agent.id === activeAgentId;
                const isDefault = agent.id === defaultAgentId;
                return (
                  <DropdownMenuItem
                    key={agent.id}
                    onClick={() => {
                      if (!isActive) {
                        void handleAgentSwitch(agent.id);
                      }
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex h-4 w-4 items-center justify-center">
                        {isActive ? <Check className="h-4 w-4" /> : null}
                      </span>
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md" style={{ backgroundColor: agent.avatarColor ? `${agent.avatarColor}15` : 'hsl(var(--muted))' }}>
                        <AgentAvatarIcon avatar={agent.avatar} color={agent.avatarColor || 'hsl(var(--muted-foreground))'} imageDataUrl={agent.avatarImageDataUrl} className={isPictureAvatar(agent.avatar, agent.avatarImageDataUrl) ? 'h-full w-full' : 'h-6 w-6'} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{agent.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{agent.roleName || agent.id}</div>
                      </div>
                    </div>
                    {isDefault && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Default
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem
                onClick={() => {
                  setPendingSettingsSectionQuery('');
                  setShowSettings(true);
                }}
                className="flex items-center gap-2"
              >
                <Settings className="h-3.5 w-3.5" />
                Manage agents
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Action Buttons */}
        <div className="px-4 py-4 border-b border-border/50 flex gap-2">
          <Button
            data-testid="sidebar-new-task-button"
            onClick={handleNewConversation}
            variant="default"
            size="sm"
            className="flex-1 justify-center gap-2 btn-modern shadow-soft hover:shadow-glow rounded-xl h-10"
            title="New Task"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New Task
          </Button>
          <Button
            onClick={() => setShowCreateFolder(true)}
            variant="outline"
            size="sm"
            className="px-3 rounded-xl h-10 hover:bg-accent/80"
            title="New Project"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button
            onClick={openLauncher}
            variant="outline"
            size="sm"
            className="px-3 rounded-xl h-10 hover:bg-accent/80"
            title="Search Tasks (⌘K)"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Conversation List */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            <AnimatePresence mode="wait">
              {tasks.length === 0 && folders.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="px-4 py-12 text-center"
                >
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                    <MessageSquarePlus className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No conversations yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Start a new task to begin</p>
                </motion.div>
              ) : (
                <motion.div
                  key="task-list"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  className="space-y-1"
                >
                  {/* Projects */}
                  {sortedFolders.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                          Projects
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="p-1 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={openReorderDialog}>
                              <GripVertical className="h-3.5 w-3.5 mr-2" />
                              Reorder
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {sortedFolders.slice(0, MAX_VISIBLE_PROJECTS).map((folder) => (
                        <FolderItem
                          key={folder.id}
                          folder={folder}
                          tasks={getTasksForFolder(folder.id)}
                          onOpenBudgetProject={openProjectManagement}
                        />
                      ))}
                      {/* See more button when there are more than 5 projects */}
                      {sortedFolders.length > MAX_VISIBLE_PROJECTS && (
                        <Popover open={showAllProjects} onOpenChange={setShowAllProjects}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 rounded-xl text-sm transition-all duration-200 text-muted-foreground hover:bg-accent/60 hover:text-foreground flex items-center gap-2 cursor-pointer"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              <span className="text-xs">
                                See more ({sortedFolders.length - MAX_VISIBLE_PROJECTS} more)
                              </span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            side="right"
                            align="start"
                            className="w-72 p-2"
                          >
                            <div className="font-medium text-sm mb-2 px-2">More Projects</div>
                            <ScrollArea className="max-h-[400px]">
                              <div className="space-y-1">
                                {sortedFolders.slice(MAX_VISIBLE_PROJECTS).map((folder) => {
                                  const IconComponent = getIconByName(folder.icon || 'Folder');
                                  const folderTasks = getTasksForFolder(folder.id);
                                  return (
                                    <div key={folder.id} className="space-y-0.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          toggleFolderExpanded(folder.id);
                                        }}
                                        className="w-full text-left px-2 py-2 rounded-lg text-sm transition-all duration-200 text-foreground/80 hover:bg-accent/60 hover:text-foreground flex items-center gap-2 cursor-pointer"
                                      >
                                        <ChevronRight
                                          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${folder.isExpanded ? 'rotate-90' : ''}`}
                                        />
                                        <div
                                          className="relative flex items-center justify-center w-6 h-6 rounded-lg shrink-0"
                                          style={{
                                            backgroundColor: folder.color ? `${folder.color}20` : 'hsl(var(--muted) / 0.5)',
                                          }}
                                          title={folder.usageProjectId ? 'Budget applied' : undefined}
                                        >
                                          <IconComponent
                                            className="h-3.5 w-3.5"
                                            style={{ color: folder.color || 'hsl(var(--muted-foreground))' }}
                                          />
                                          {folder.usageProjectId && (
                                            <span
                                              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background"
                                              style={{ backgroundColor: getUsageProjectColor(folder.usageProjectId) }}
                                            />
                                          )}
                                        </div>
                                        <span className="truncate flex-1 font-medium" title={folder.name}>{folder.name}</span>
                                        {folder.usageProjectId && (
                                          <button
                                            type="button"
                                            className="rounded-full border border-teal-400/40 bg-teal-400/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-400/20"
                                            title="Open budget in Project Management"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setShowAllProjects(false);
                                              openProjectManagement(folder.usageProjectId);
                                            }}
                                          >
                                            Budget
                                          </button>
                                        )}
                                        <span className="text-xs text-muted-foreground/70">
                                          {folderTasks.length}
                                        </span>
                                      </button>
                                      {/* Expanded tasks */}
                                      {folder.isExpanded && folderTasks.length > 0 && (
                                        <div className="pl-6 space-y-0.5">
                                          {folderTasks.map((task) => (
                                            <button
                                              key={task.id}
                                              type="button"
                                              title={getTaskHoverTitle(task)}
                                              onClick={() => {
                                                navigate(`/execution/${task.id}`);
                                                setShowAllProjects(false);
                                              }}
                                              className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all duration-200 text-muted-foreground hover:bg-accent/60 hover:text-foreground truncate cursor-pointer"
                                            >
                                              {getTaskDisplayTitle(task)}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  )}

                  {/* Unfiled Tasks */}
                  {unfiledTasks.length > 0 && (
                    <div
                      className="space-y-0.5 rounded-xl transition-colors"
                      onDragOver={handleUnfiledDragOver}
                      onDragLeave={handleUnfiledDragLeave}
                      onDrop={handleUnfiledDrop}
                    >
                      {sortedFolders.length > 0 && (
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                          Unfiled
                        </div>
                      )}
                      {unfiledTasks.map((task) => (
                        <ConversationListItem key={task.id} task={task} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Bottom Section - Logo and Settings */}
        <div className="px-4 py-4 border-t border-border/50 flex items-center justify-between bg-gradient-to-t from-muted/30 to-transparent">
          {/* Logo - Bottom Left */}
          <TooltipProvider delayDuration={180}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center" aria-label={`Open Deskmate${appVersion ? ` version ${appVersion}` : ''}`}>
                  <img
                    src={logoImage}
                    alt="Open Deskmate"
                    className="hover-lift transition-smooth"
                    style={{ height: '60px', objectFit: 'contain' }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" sideOffset={10} className="min-w-40">
                <div className="text-sm font-semibold leading-tight">Open Deskmate</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {appVersion ? `Version ${appVersion}` : 'Version unavailable'}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Help + Theme + Settings Buttons - Bottom Right */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/subagents', { state: { from: `${location.pathname}${location.search}` } })}
              title="Subagents"
              className={cn(
                'rounded-xl transition-smooth',
                isSubagentsRoute ? 'bg-accent/90 text-foreground' : 'hover:bg-accent/80'
              )}
            >
              <GitBranch className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/help')}
              title="Help"
              className="rounded-xl hover:bg-accent/80 transition-smooth"
            >
              <CircleHelp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSearchAudit(true)}
              title="Search & Audit"
              className="rounded-xl hover:bg-accent/80 transition-smooth"
            >
              <FileSearch className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title={`Theme: ${theme}`}
                  className="rounded-xl hover:bg-accent/80 transition-smooth"
                >
                  <ThemeIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={() => setTheme('light')}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <Sun className="h-3.5 w-3.5" />
                    Light
                  </span>
                  {theme === 'light' && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme('dark')}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <Moon className="h-3.5 w-3.5" />
                    Dark
                  </span>
                  {theme === 'dark' && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme('system')}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <Monitor className="h-3.5 w-3.5" />
                    System
                  </span>
                  {theme === 'system' && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              data-testid="sidebar-settings-button"
              variant="ghost"
              size="icon"
              onClick={() => {
                analytics.trackOpenSettings();
                setPendingSettingsSectionQuery('');
                setShowSettings(true);
              }}
              title="Settings"
              className="rounded-xl hover:bg-accent/80 transition-smooth"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openProjectManagement()}
              title="Project Management"
              className="rounded-xl hover:bg-accent/80 transition-smooth"
            >
              <Briefcase className="h-4 w-4" />
            </Button>
          </div>
        </div>
          </>
        )}
      </div>

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        initialSectionQuery={pendingSettingsSectionQuery}
      />
      <SearchAuditDialog
        open={showSearchAudit}
        onOpenChange={setShowSearchAudit}
      />
      <ProjectManagementDialog
        open={showProjectManagement}
        onOpenChange={setShowProjectManagement}
        initialProjectId={projectManagementInitialProjectId}
      />
      <CreateFolderDialog open={showCreateFolder} onOpenChange={setShowCreateFolder} />

      {/* Reorder Projects Dialog */}
      <Dialog open={showReorderDialog} onOpenChange={setShowReorderDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Reorder Projects</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-xs text-muted-foreground mb-4">
              Drag projects to reorder. The first {MAX_VISIBLE_PROJECTS} will appear in the sidebar.
            </p>

            {/* Visible in sidebar section */}
            <div className="mb-4">
              <div className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-2 px-1">
                Visible in Sidebar
              </div>
              <div className="border border-border rounded-lg p-1 min-h-[60px] bg-accent/20">
                {reorderList.slice(0, MAX_VISIBLE_PROJECTS).map((folderId) => {
                  const folder = getFolderById(folderId);
                  if (!folder) return null;
                  const IconComponent = getIconByName(folder.icon || 'Folder');
                  return (
                    <div
                      key={folder.id}
                      draggable
                      onDragStart={() => handleReorderDragStart(folder.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        handleReorderDragOver(folder.id);
                      }}
                      onDragEnd={handleReorderDragEnd}
                      className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors ${
                        reorderTargetId === folder.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-accent/60'
                      }`}
                    >
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div
                        className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0"
                        style={{
                          backgroundColor: folder.color ? `${folder.color}20` : 'hsl(var(--muted) / 0.5)',
                        }}
                      >
                        <IconComponent
                          className="h-3.5 w-3.5"
                          style={{ color: folder.color || 'hsl(var(--muted-foreground))' }}
                        />
                      </div>
                      <span className="text-sm truncate flex-1">{folder.name}</span>
                    </div>
                  );
                })}
                {reorderList.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    No projects yet
                  </div>
                )}
              </div>
            </div>

            {/* See more section */}
            {reorderList.length > MAX_VISIBLE_PROJECTS && (
              <div>
                <div className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-2 px-1">
                  In "See More" Menu
                </div>
                <div className="border border-dashed border-border rounded-lg p-1 min-h-[60px]">
                  {reorderList.slice(MAX_VISIBLE_PROJECTS).map((folderId) => {
                    const folder = getFolderById(folderId);
                    if (!folder) return null;
                    const IconComponent = getIconByName(folder.icon || 'Folder');
                    return (
                      <div
                        key={folder.id}
                        draggable
                        onDragStart={() => handleReorderDragStart(folder.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          handleReorderDragOver(folder.id);
                        }}
                        onDragEnd={handleReorderDragEnd}
                        className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors ${
                          reorderTargetId === folder.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-accent/60'
                        }`}
                      >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div
                          className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0"
                          style={{
                            backgroundColor: folder.color ? `${folder.color}20` : 'hsl(var(--muted) / 0.5)',
                          }}
                        >
                          <IconComponent
                            className="h-3.5 w-3.5"
                            style={{ color: folder.color || 'hsl(var(--muted-foreground))' }}
                          />
                        </div>
                        <span className="text-sm truncate flex-1">{folder.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowReorderDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveReorder}>
              Save Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
