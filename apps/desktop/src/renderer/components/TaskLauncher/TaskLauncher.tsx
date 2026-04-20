'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command, Search, Plus, X } from 'lucide-react';
import { useTaskStore } from '@/stores/taskStore';
import { getAccomplish } from '@/lib/accomplish';
import { cn } from '@/lib/utils';
import { springs } from '@/lib/animations';
import TaskLauncherItem from './TaskLauncherItem';
import { createAppSlashCommands } from '@/lib/app-commands';
import { usePluginSlashCommands } from '@/hooks/usePluginSlashCommands';
import {
  filterSlashCommands,
  getSlashCommandIntentLabel,
  type SlashCommandDefinition,
  type SlashCommandIntent,
} from '@/lib/slash-commands';

type CommandSection = {
  title: string;
  items: Array<{
    command: SlashCommandDefinition;
    index: number;
  }>;
};

function getIntentBadgeClasses(intent?: SlashCommandIntent): string {
  switch (intent) {
    case 'navigate':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700';
    case 'inspect':
      return 'border-border/60 bg-muted text-muted-foreground';
    case 'mutate':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
    case 'danger':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-border/60 bg-muted text-muted-foreground';
  }
}

export default function TaskLauncher() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const {
    isLauncherOpen,
    closeLauncher,
    tasks,
    startTask,
    currentTask,
  } = useTaskStore();
  const accomplish = getAccomplish();
  const pluginSlashCommands = usePluginSlashCommands();
  const isCommandMode = searchQuery.startsWith('/');
  const isBuildRoute = location.pathname === '/build';
  const isExecutionRoute = location.pathname.startsWith('/execution');
  const commandItems = useMemo(() => (
    filterSlashCommands(
      searchQuery,
      createAppSlashCommands({
        navigate,
        pathname: location.pathname,
        context: 'global',
        search: location.search,
        modeSwitchTarget: location.pathname === '/build' ? 'chat' : 'build',
        pluginCommands: pluginSlashCommands,
        taskStop: { visible: isBuildRoute || isExecutionRoute },
        taskSaveSkill: {
          visible:
            isExecutionRoute
            && Boolean(currentTask)
            && ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(currentTask?.status || ''))
            && (currentTask?.messages?.length || 0) > 0,
        },
        subagentsRefresh: { visible: isBuildRoute || isExecutionRoute },
        buildHistoryOpen: { visible: isBuildRoute },
        buildHistoryNew: { visible: isBuildRoute },
        buildRuntimeStart: { visible: isBuildRoute },
        buildRuntimeStop: { visible: isBuildRoute },
        buildRuntimeRestart: { visible: isBuildRoute },
        buildRuntimeBuild: { visible: isBuildRoute },
        buildRuntimeOpenPreview: { visible: isBuildRoute },
      })
    )
  ), [currentTask, isBuildRoute, isExecutionRoute, location.pathname, location.search, navigate, pluginSlashCommands, searchQuery]);
  const commandSections = useMemo<CommandSection[]>(() => {
    const sections: CommandSection[] = [];
    const sectionMap = new Map<string, CommandSection>();
    commandItems.forEach((command, index) => {
      const title = command.group || 'Commands';
      const existing = sectionMap.get(title);
      if (existing) {
        existing.items.push({ command, index });
        return;
      }
      const section: CommandSection = {
        title,
        items: [{ command, index }],
      };
      sectionMap.set(title, section);
      sections.push(section);
    });
    return sections;
  }, [commandItems]);
  const selectedCommand = useMemo(
    () => (isCommandMode ? (commandItems[selectedIndex] || commandItems[0] || null) : null),
    [commandItems, isCommandMode, selectedIndex]
  );

  // Filter tasks by search query (title only)
  const filteredTasks = useMemo(() => {
    if (isCommandMode) return [];
    if (!searchQuery.trim()) {
      // Show last 7 days when no search
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return tasks.filter(t => new Date(t.createdAt).getTime() > sevenDaysAgo);
    }
    const query = searchQuery.toLowerCase();
    return tasks.filter(t => t.prompt.toLowerCase().includes(query));
  }, [isCommandMode, tasks, searchQuery]);

  const totalItems = isCommandMode ? commandItems.length : (1 + filteredTasks.length);

  // Reset state when modal opens
  useEffect(() => {
    if (isLauncherOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLauncherOpen]);

  // Clamp selected index when results change
  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  const handleSelect = useCallback(async (index: number) => {
    if (isCommandMode) {
      const command = commandItems[index];
      if (command) {
        closeLauncher();
        await command.execute();
      }
      return;
    }
    if (index === 0) {
      // "New task" selected
      if (searchQuery.trim()) {
        // Start task with search query as prompt
        const hasKey = await accomplish.hasAnyApiKey();
        const selectedModel = await accomplish.getSelectedModel();
        const hasOllamaConfigured = selectedModel?.provider === 'ollama';

        if (!hasKey && !hasOllamaConfigured) {
          closeLauncher();
          navigate('/');
          return;
        }
        closeLauncher();
        const taskId = `task_${Date.now()}`;
        const task = await startTask({ prompt: searchQuery.trim(), taskId });
        if (task) {
          navigate(`/execution/${task.id}`);
        }
      } else {
        // Navigate to home for empty input
        closeLauncher();
        navigate('/');
      }
    } else {
      // Task selected - navigate to it
      const task = filteredTasks[index - 1];
      if (task) {
        closeLauncher();
        navigate(`/execution/${task.id}`);
      }
    }
  }, [isCommandMode, commandItems, searchQuery, filteredTasks, closeLauncher, navigate, startTask, accomplish]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, totalItems - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        handleSelect(selectedIndex);
        break;
      case 'Escape':
        e.preventDefault();
        closeLauncher();
        break;
    }
  }, [totalItems, selectedIndex, handleSelect, closeLauncher]);

  return (
    <DialogPrimitive.Root open={isLauncherOpen} onOpenChange={(open) => !open && closeLauncher()}>
      <AnimatePresence>
        {isLauncherOpen && (
          <DialogPrimitive.Portal forceMount>
            {/* Overlay */}
            <DialogPrimitive.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
              />
            </DialogPrimitive.Overlay>

            {/* Content */}
            <DialogPrimitive.Content
              className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
              onKeyDown={handleKeyDown}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={springs.bouncy}
                className="w-full max-w-lg bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
              >
                {/* Search Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tasks or type / for commands..."
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <DialogPrimitive.Close asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                      <X className="h-4 w-4" />
                    </button>
                  </DialogPrimitive.Close>
                </div>

                {/* Results */}
                <div className="max-h-80 overflow-y-auto p-2">
                  {isCommandMode ? (
                    <>
                      {commandItems.length > 0 ? (
                        <>
                          {commandSections.map((section) => (
                            <div key={section.title}>
                              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {section.title}
                              </div>
                              {section.items.map(({ command, index }) => (
                                <button
                                  key={command.id}
                                  onClick={() => handleSelect(index)}
                                  className={cn(
                                    'w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-100',
                                    'flex items-start gap-2',
                                    selectedIndex === index
                                      ? 'bg-primary text-primary-foreground'
                                      : 'text-foreground hover:bg-accent'
                                  )}
                                >
                                  <Command className="mt-0.5 h-4 w-4 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="truncate font-medium">{command.title}</div>
                                        <div className={cn(
                                          'text-[11px]',
                                          selectedIndex === index ? 'text-primary-foreground/75' : 'text-muted-foreground'
                                        )}>
                                          /{command.command}
                                          {command.aliases?.length ? ` · ${command.aliases.map((alias) => `/${alias}`).join(' · ')}` : ''}
                                        </div>
                                      </div>
                                      <span className={cn(
                                        'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                                        selectedIndex === index
                                          ? 'border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground'
                                          : getIntentBadgeClasses(command.intent)
                                      )}>
                                        {getSlashCommandIntentLabel(command.intent)}
                                      </span>
                                    </div>
                                    <div className={cn(
                                      'mt-0.5 text-xs',
                                      selectedIndex === index ? 'text-primary-foreground/70' : 'text-muted-foreground'
                                    )}>
                                      {command.description}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                          No commands found
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleSelect(0)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-100',
                          'flex items-center gap-2',
                          selectedIndex === 0
                            ? 'bg-primary text-primary-foreground'
                            : 'text-foreground hover:bg-accent'
                        )}
                      >
                        <Plus className="h-4 w-4 shrink-0" />
                        <span>New task</span>
                        {searchQuery.trim() && (
                          <span className={cn(
                            'text-xs truncate',
                            selectedIndex === 0 ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          )}>
                            — "{searchQuery}"
                          </span>
                        )}
                      </button>

                      {filteredTasks.length > 0 && (
                        <>
                          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                            {searchQuery.trim() ? 'Results' : 'Last 7 days'}
                          </div>
                          {filteredTasks.slice(0, 10).map((task, i) => (
                            <TaskLauncherItem
                              key={task.id}
                              task={task}
                              isSelected={selectedIndex === i + 1}
                              onClick={() => handleSelect(i + 1)}
                            />
                          ))}
                        </>
                      )}

                      {searchQuery.trim() && filteredTasks.length === 0 && (
                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                          No tasks found
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer hint */}
                <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  {isCommandMode && selectedCommand ? (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
                      <span className={cn(
                        'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                        getIntentBadgeClasses(selectedCommand.intent)
                      )}>
                        {getSlashCommandIntentLabel(selectedCommand.intent)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{selectedCommand.title}</div>
                        <div className="text-muted-foreground">
                          {selectedCommand.previewText || selectedCommand.description}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-4">
                    <span><kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">↑↓</kbd> Navigate</span>
                    <span><kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">↵</kbd> Select</span>
                    <span><kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">Esc</kbd> Close</span>
                  </div>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
