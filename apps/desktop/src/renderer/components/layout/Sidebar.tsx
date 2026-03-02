'use client';

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '@/stores/taskStore';
import { useFolderStore } from '@/stores/folderStore';
import { useAgentStore } from '@/stores/agentStore';
import { getAccomplish } from '@/lib/accomplish';
import { analytics } from '@/lib/analytics';
import { staggerContainer } from '@/lib/animations';
import type { Task } from '@accomplish/shared';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ConversationListItem from './ConversationListItem';
import FolderItem from './FolderItem';
import CreateFolderDialog from './CreateFolderDialog';
import SettingsDialog from './SettingsDialog';
import { Settings, MessageSquarePlus, Search, FolderPlus, MoreHorizontal, GripVertical, ChevronRight, ChevronDown, User, Check, CircleHelp, Sun, Moon, Monitor } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getIconByName } from './ProjectIconPicker';
import { AgentAvatarIcon } from './AgentAvatarPicker';
import { useTheme } from '@/contexts/ThemeContext';
import logoImage from '/assets/open-deskmate-logo.png';

export default function Sidebar() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [reorderList, setReorderList] = useState<string[]>([]);
  const [reorderDragId, setReorderDragId] = useState<string | null>(null);
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);

  const MAX_VISIBLE_PROJECTS = 5;
  const { tasks, loadTasks, updateTaskStatus, addTaskUpdate, insertTask, openLauncher, setTaskFolder } = useTaskStore();
  const { folders, loadFolders, toggleFolderExpanded, reorderFolders } = useFolderStore();
  const { agents, activeAgentId, defaultAgentId, loadAgents, setActiveAgent } = useAgentStore();
  const { theme, setTheme } = useTheme();
  const activeAgent = agents.find((agent) => agent.id === activeAgentId);

  // Folder drag state
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragTargetFolderId, setDragTargetFolderId] = useState<string | null>(null);
  const accomplish = getAccomplish();

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks, activeAgentId]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders, activeAgentId]);

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

  // Folder reordering handlers
  const handleFolderDragStart = (_e: React.DragEvent, folderId: string) => {
    setDraggedFolderId(folderId);
  };

  const handleFolderDragOver = (_e: React.DragEvent, folderId: string) => {
    if (draggedFolderId && draggedFolderId !== folderId) {
      setDragTargetFolderId(folderId);
    }
  };

  const handleFolderDragEnd = () => {
    if (draggedFolderId && dragTargetFolderId && draggedFolderId !== dragTargetFolderId) {
      // Reorder folders: move dragged folder to the position of the target folder
      const currentOrder = sortedFolders.map((f) => f.id);
      const draggedIndex = currentOrder.indexOf(draggedFolderId);
      const targetIndex = currentOrder.indexOf(dragTargetFolderId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        // Remove dragged item and insert at target position
        currentOrder.splice(draggedIndex, 1);
        currentOrder.splice(targetIndex, 0, draggedFolderId);
        reorderFolders(currentOrder);
      }
    }
    setDraggedFolderId(null);
    setDragTargetFolderId(null);
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
    navigate('/');
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
      <div className="flex h-screen w-[280px] flex-col sidebar-modern pt-4">
        {/* Agent switcher */}
        <div className="px-4 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-sm text-foreground hover:bg-accent/60 transition-all"
                title="Switch agent"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: activeAgent?.avatarColor ? `${activeAgent.avatarColor}15` : 'hsl(var(--primary) / 0.1)' }}>
                  <AgentAvatarIcon avatar={activeAgent?.avatar} color={activeAgent?.avatarColor || 'hsl(var(--primary))'} className="h-7 w-7" />
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
                        void setActiveAgent(agent.id);
                      }
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex h-4 w-4 items-center justify-center">
                        {isActive ? <Check className="h-4 w-4" /> : null}
                      </span>
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: agent.avatarColor ? `${agent.avatarColor}15` : 'hsl(var(--muted))' }}>
                        <AgentAvatarIcon avatar={agent.avatar} color={agent.avatarColor || 'hsl(var(--muted-foreground))'} className="h-6 w-6" />
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
                onClick={() => setShowSettings(true)}
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
                          onDragStart={handleFolderDragStart}
                          onDragOver={handleFolderDragOver}
                          onDragEnd={handleFolderDragEnd}
                          isDragTarget={dragTargetFolderId === folder.id}
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
                                        <span className="truncate flex-1 font-medium">{folder.name}</span>
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
                                              onClick={() => {
                                                navigate(`/execution/${task.id}`);
                                                setShowAllProjects(false);
                                              }}
                                              className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all duration-200 text-muted-foreground hover:bg-accent/60 hover:text-foreground truncate cursor-pointer"
                                            >
                                              {task.summary || task.prompt}
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
          <div className="flex items-center">
            <img
              src={logoImage}
              alt="Open Deskmate"
              className="hover-lift transition-smooth"
              style={{ height: '60px', objectFit: 'contain' }}
            />
          </div>

          {/* Help + Theme + Settings Buttons - Bottom Right */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/help')}
              title="Help"
              className="rounded-xl hover:bg-accent/80 transition-smooth"
            >
              <CircleHelp className="h-4 w-4" />
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
                setShowSettings(true);
              }}
              title="Settings"
              className="rounded-xl hover:bg-accent/80 transition-smooth"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
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
