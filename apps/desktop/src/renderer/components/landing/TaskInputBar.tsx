import ComposerOptions from '../chat/ComposerOptions';
import ActionShelf from '../chat/ActionShelf';
'use client';

import { useRef, useEffect, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { getAccomplish } from '../../lib/accomplish';
import { analytics } from '../../lib/analytics';
import { CornerDownLeft, Loader2, Folder, FolderOpen, X, FileText, Settings, Mic, Plus, Image, Sparkles, Shield } from 'lucide-react';
import SavedPromptsDialog from '../layout/SavedPromptsDialog';
import BuildProjectWorkPopup from '../build/BuildProjectWorkPopup';
import { useSavedPromptsStore } from '../../stores/savedPromptsStore';
import { useAttachmentStore } from '../../stores/attachmentStore';
import { useVoiceWakeTalkMode } from '../../hooks/useVoiceWakeTalkMode';
import ContextWindowIndicator from '../chat/ContextWindowIndicator';
import ContextInspector from '../chat/ContextInspector';
import { UsageProjectSelector } from '../usage/UsageProjectSelector';
import { UsageBudgetPill } from '../usage/UsageBudgetPill';
import type { ContextWindowEstimateResponse } from '@accomplish/shared';
import InlineSlashCommandMenu from '../commands/InlineSlashCommandMenu';
import { filterSlashCommands, type SlashCommandDefinition } from '../../lib/slash-commands';
import { APP_COMMAND_EVENTS } from '../../lib/app-commands';
import { registerPromptAttachmentTarget, registerPromptInsertionTarget } from '../../lib/prompt-insertion';
import {
  addPromptHistoryEntry,
  CHAT_PROMPT_HISTORY_STORAGE_KEY,
  readPromptHistory,
  shouldHandlePromptHistoryRecall,
} from '../../lib/prompt-history';
import { BUILD_RECIPES } from '../../lib/build-recipes';
import { writeChatProjectWorkPopupSession } from '../../lib/project-work-popup-session';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useUsageProjectStore } from '@/stores/usageProjectStore';

export interface TaskInputBarHandle {
  setValue: (text: string) => void;
  getValue: () => string;
  focus: () => void;
}

interface TaskInputBarProps {
  /**
   * Return `false` to indicate submission was not accepted (e.g. needs auth),
   * so the input should not be cleared.
   */
  onSubmit: (
    prompt: string,
    workingFolder?: string,
    attachedFiles?: string[],
    privacyMode?: 'normal' | 'incognito',
    usageProjectId?: string | null
  ) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
  large?: boolean;
  autoFocus?: boolean;
  defaultWorkingFolder?: string | null;
  initialWorkingFolder?: string;
  onPlanNextJobs?: () => void | Promise<void>;
  planningJobs?: boolean;
  agentId?: string;
  taskId?: string;
  privacyMode?: 'normal' | 'incognito';
  onPrivacyModeChange?: (mode: 'normal' | 'incognito') => void;
  slashCommands?: SlashCommandDefinition[];
}

const TaskInputBar = forwardRef<TaskInputBarHandle, TaskInputBarProps>(function TaskInputBar({
  onSubmit,
  placeholder = 'Assign a task or ask anything',
  isLoading = false,
  disabled = false,
  large = false,
  autoFocus = false,
  defaultWorkingFolder = null,
  initialWorkingFolder,
  onPlanNextJobs,
  planningJobs = false,
  agentId,
  taskId,
  privacyMode = 'normal',
  onPrivacyModeChange,
  slashCommands = [],
}, ref) {
  const isInputDisabled = disabled;
  const isActionDisabled = disabled || isLoading;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const accomplish = getAccomplish();
  const [text, setText] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const textRef = useRef(text);
  textRef.current = text;
  const promptHistoryEntriesRef = useRef<string[]>([]);
  const promptHistoryCursorRef = useRef<number | null>(null);
  const promptHistoryDraftRef = useRef('');
  const [contextStats, setContextStats] = useState<ContextWindowEstimateResponse | null>(null);
  const [draftUsageProjectId, setDraftUsageProjectId] = useState<string | null>(null);
  const usageProjects = useUsageProjectStore((state) => state.projects);
  const usageAssignees = useUsageProjectStore((state) => state.assignees);
  const loadUsageProjects = useUsageProjectStore((state) => state.loadProjects);

  useImperativeHandle(ref, () => ({
    setValue: (t: string) => {
      promptHistoryCursorRef.current = null;
      promptHistoryDraftRef.current = '';
      setText(t);
    },
    getValue: () => textRef.current,
    focus: () => textareaRef.current?.focus(),
  }));

  const appendPromptText = useCallback((prompt: string) => {
    const insertion = prompt.trim();
    if (!insertion) return;
    promptHistoryCursorRef.current = null;
    promptHistoryDraftRef.current = '';
    setText((current) => (current.trim() ? `${current.trim()}\n\n${insertion}` : insertion));
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const cursor = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }, []);

  useEffect(() => registerPromptInsertionTarget(
    { mode: 'chat', label: 'Chat prompt' },
    appendPromptText
  ), [appendPromptText]);
  const [workingFolder, setWorkingFolder] = useState<string | null>(initialWorkingFolder || defaultWorkingFolder);
  const previousDefaultRef = useRef<string | null>(defaultWorkingFolder);
  const [showSavedPromptsDialog, setShowSavedPromptsDialog] = useState(false);
  const [savedPromptsMode, setSavedPromptsMode] = useState<'select' | 'manage'>('select');
  const [savedPromptsIncludeRecipes, setSavedPromptsIncludeRecipes] = useState(true);
  const [projectWorkPopupOpen, setProjectWorkPopupOpen] = useState(false);
  const attachedFiles = useAttachmentStore((state) => state.files);
  const addAttachedFiles = useAttachmentStore((state) => state.addFiles);
  const removeAttachedFile = useAttachmentStore((state) => state.removeFile);
  const clearAttachedFiles = useAttachmentStore((state) => state.clearFiles);
  const { prompts, loadPrompts } = useSavedPromptsStore();
  const promptPickerCount = prompts.length + BUILD_RECIPES.length;

  useEffect(() => registerPromptAttachmentTarget(
    { mode: 'chat', label: 'Chat prompt' },
    addAttachedFiles
  ), [addAttachedFiles]);

  useEffect(() => {
    void loadUsageProjects(true);
  }, [loadUsageProjects]);

  useEffect(() => {
    const handleNewChatTask = () => {
      setDraftUsageProjectId(null);
      setProjectWorkPopupOpen(false);
      writeChatProjectWorkPopupSession(false);
    };
    window.addEventListener('opendeskmate:new-chat-task', handleNewChatTask);
    return () => window.removeEventListener('opendeskmate:new-chat-task', handleNewChatTask);
  }, []);

  useEffect(() => {
    const openPromptPicker = () => {
      setSavedPromptsIncludeRecipes(false);
      setSavedPromptsMode('select');
      setShowSavedPromptsDialog(true);
    };
    const openRecipePicker = () => {
      setSavedPromptsIncludeRecipes(true);
      setSavedPromptsMode('select');
      setShowSavedPromptsDialog(true);
    };
    const openProjectWork = () => {
      setProjectWorkPopupOpen(true);
    };
    const openAgentSettings = () => {
      window.dispatchEvent(new CustomEvent('opendeskmate:open-settings', { detail: { query: 'agent' } }));
    };
    const focusProjectPicker = () => {
      const selector = document.querySelector<HTMLSelectElement>('select[data-usage-project-selector="chat"]');
      selector?.focus();
    };
    window.addEventListener(APP_COMMAND_EVENTS.promptPickerOpen, openPromptPicker);
    window.addEventListener(APP_COMMAND_EVENTS.recipePickerOpen, openRecipePicker);
    window.addEventListener(APP_COMMAND_EVENTS.workboardOpen, openProjectWork);
    window.addEventListener(APP_COMMAND_EVENTS.agentPickerOpen, openAgentSettings);
    window.addEventListener(APP_COMMAND_EVENTS.projectPickerOpen, focusProjectPicker);
    return () => {
      window.removeEventListener(APP_COMMAND_EVENTS.promptPickerOpen, openPromptPicker);
      window.removeEventListener(APP_COMMAND_EVENTS.recipePickerOpen, openRecipePicker);
      window.removeEventListener(APP_COMMAND_EVENTS.workboardOpen, openProjectWork);
      window.removeEventListener(APP_COMMAND_EVENTS.agentPickerOpen, openAgentSettings);
      window.removeEventListener(APP_COMMAND_EVENTS.projectPickerOpen, focusProjectPicker);
    };
  }, []);

  useEffect(() => {
    if (!projectWorkPopupOpen) return;
    writeChatProjectWorkPopupSession(true, draftUsageProjectId);
  }, [projectWorkPopupOpen, draftUsageProjectId]);

  useEffect(() => {
    promptHistoryEntriesRef.current = readPromptHistory(CHAT_PROMPT_HISTORY_STORAGE_KEY);
  }, []);

  const resetPromptHistoryNavigation = useCallback(() => {
    promptHistoryCursorRef.current = null;
    promptHistoryDraftRef.current = '';
  }, []);

  const setTextFromHistory = useCallback((value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }, []);

  const recallPromptHistory = useCallback((direction: 'older' | 'newer') => {
    const entries = promptHistoryEntriesRef.current;
    if (entries.length === 0) return;

    const currentCursor = promptHistoryCursorRef.current;
    if (direction === 'older') {
      if (currentCursor === null) {
        promptHistoryDraftRef.current = textareaRef.current?.value ?? textRef.current;
        promptHistoryCursorRef.current = entries.length - 1;
      } else {
        promptHistoryCursorRef.current = Math.max(0, currentCursor - 1);
      }
    } else if (currentCursor !== null) {
      if (currentCursor >= entries.length - 1) {
        promptHistoryCursorRef.current = null;
        setTextFromHistory(promptHistoryDraftRef.current);
        return;
      }
      promptHistoryCursorRef.current = currentCursor + 1;
    }

    const nextCursor = promptHistoryCursorRef.current;
    if (nextCursor !== null) {
      setTextFromHistory(entries[nextCursor] ?? '');
    }
  }, [setTextFromHistory]);

  const handleTextChange = useCallback((value: string) => {
    resetPromptHistoryNavigation();
    setText(value);
  }, [resetPromptHistoryNavigation]);

  const addChatPromptToHistory = useCallback((value: string) => {
    if (privacyMode === 'incognito') return;
    promptHistoryEntriesRef.current = addPromptHistoryEntry(
      CHAT_PROMPT_HISTORY_STORAGE_KEY,
      value,
      promptHistoryEntriesRef.current
    );
  }, [privacyMode]);

  const handleVoiceAutoSubmit = useCallback(() => {
    const currentText = textRef.current;
    if (!currentText.trim()) return;
    const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    Promise.resolve(onSubmit(currentText.trim(), workingFolder || undefined, files, privacyMode, draftUsageProjectId))
      .then((accepted) => {
        if (accepted === false) return;
        addChatPromptToHistory(currentText.trim());
        resetPromptHistoryNavigation();
        setText('');
        setDraftUsageProjectId(null);
        clearAttachedFiles();
      })
      .catch(() => {
        // If submission fails, keep user input so they can retry.
      });
  }, [onSubmit, workingFolder, attachedFiles, privacyMode, draftUsageProjectId, clearAttachedFiles, addChatPromptToHistory, resetPromptHistoryNavigation]);
  const {
    voiceEnabled,
    voiceAccessKeySet,
    voiceToggleBusy,
    toggleVoiceWake,
    talkModeActive,
    talkModeInterim,
    talkModeError,
    talkModeLevel,
    voiceMeterLevel,
  } = useVoiceWakeTalkMode({
    value: text,
    onChange: handleTextChange,
    onSubmit: handleVoiceAutoSubmit,
    focusRef: textareaRef,
    disabled: isActionDisabled,
  });

  // Load saved prompts on mount
  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(text, slashCommands),
    [slashCommands, text]
  );

  useEffect(() => {
    setSelectedSlashIndex((current) => {
      if (filteredSlashCommands.length === 0) return 0;
      return Math.min(current, filteredSlashCommands.length - 1);
    });
  }, [filteredSlashCommands]);

  // Live context window estimation (debounced)
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      accomplish
        .estimateContextWindow({
          prompt: text,
          taskId,
          agentId,
          attachedFiles: attachedFiles.length ? attachedFiles : undefined,
        })
        .then((stats) => {
          if (cancelled) return;
          setContextStats(stats);
        })
        .catch(() => {
          if (cancelled) return;
          setContextStats(null);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [accomplish, text, attachedFiles, agentId, taskId]);

  // Apply default working folder if provided and no custom folder set
  useEffect(() => {
    const previousDefault = previousDefaultRef.current;
    if (defaultWorkingFolder && (workingFolder === null || workingFolder === previousDefault)) {
      setWorkingFolder(defaultWorkingFolder);
    }
    if (!defaultWorkingFolder && workingFolder === previousDefault) {
      setWorkingFolder(null);
    }
    previousDefaultRef.current = defaultWorkingFolder;
  }, [defaultWorkingFolder, workingFolder]);

  const handleSelectSavedPrompt = (content: string) => {
    handleTextChange(content);
    textareaRef.current?.focus();
  };

  const handleSelectFolder = async () => {
    const folder = await accomplish.selectFolder();
    if (folder) {
      setWorkingFolder(folder);
    }
  };

  const clearWorkingFolder = () => {
    setWorkingFolder(null);
  };

  const handleSelectFiles = async () => {
    const files = await accomplish.selectFiles();
    if (files.length > 0) {
      addAttachedFiles(files);
    }
  };

  const removeFile = (filePath: string) => {
    removeAttachedFile(filePath);
  };

  // Auto-focus on mount with multiple retry attempts
  // This handles cases where dropdown menus or other components may delay focus availability
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      const focusInput = () => textareaRef.current?.focus();

      // Immediate attempt
      focusInput();

      // Retry with requestAnimationFrame
      requestAnimationFrame(focusInput);

      // Additional retry attempts with small delays to handle dropdown close animations
      const timer1 = setTimeout(focusInput, 50);
      const timer2 = setTimeout(focusInput, 150);
      const timer3 = setTimeout(focusInput, 300);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [autoFocus]);

  // Auto-resize textarea — batched with the browser paint frame to avoid
  // synchronous layout-reflow thrashing on every keystroke.
  const resizeRafRef = useRef<number>(0);
  useEffect(() => {
    cancelAnimationFrame(resizeRafRef.current);
    resizeRafRef.current = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      }
    });
    return () => cancelAnimationFrame(resizeRafRef.current);
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((current) => (
          current >= filteredSlashCommands.length - 1 ? 0 : current + 1
        ));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((current) => (
          current <= 0 ? filteredSlashCommands.length - 1 : current - 1
        ));
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredSlashCommands[selectedSlashIndex] || filteredSlashCommands[0];
        if (selected) {
          Promise.resolve(selected.execute()).then(() => {
            resetPromptHistoryNavigation();
            setText('');
            setSelectedSlashIndex(0);
          });
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        resetPromptHistoryNavigation();
        setText('');
        setSelectedSlashIndex(0);
        return;
      }
    }
    if (e.key === 'ArrowUp') {
      const shouldRecall = shouldHandlePromptHistoryRecall({
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        currentTarget: e.currentTarget as HTMLTextAreaElement,
      }, 'older', promptHistoryCursorRef.current !== null);
      if (shouldRecall) {
        e.preventDefault();
        recallPromptHistory('older');
        return;
      }
    }
    if (e.key === 'ArrowDown') {
      const shouldRecall = shouldHandlePromptHistoryRecall({
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        currentTarget: e.currentTarget as HTMLTextAreaElement,
      }, 'newer', promptHistoryCursorRef.current !== null);
      if (shouldRecall) {
        e.preventDefault();
        recallPromptHistory('newer');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!text.trim()) return;
      const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
      Promise.resolve(onSubmit(text.trim(), workingFolder || undefined, files, privacyMode, draftUsageProjectId))
        .then((accepted) => {
          if (accepted === false) return;
          addChatPromptToHistory(text.trim());
          resetPromptHistoryNavigation();
          setText('');
          setDraftUsageProjectId(null);
          clearAttachedFiles();
        })
        .catch(() => {
          // If submission fails, keep user input so they can retry.
        });
    }
  };

  return (
    <div className="relative z-20 flex flex-col gap-2">
      {/* Main input area */}
      <div className="relative flex flex-col rounded-xl border-2 border-border/60 bg-background px-3 py-2 shadow-soft transition-[border-color,box-shadow] duration-200 ease-out focus-within:border-primary/50 focus-within:shadow-glow">
        {privacyMode === 'incognito' && (
          <p className="mb-1.5 text-[10px] leading-tight text-muted-foreground">
            Chat content is not saved. Usage totals still include this session.
          </p>
        )}
        {/* Text input row */}
        <div className="flex items-center gap-2">
          {/* Add files button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={isActionDisabled}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/85 text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-200 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title="Add photos and files"
                aria-label="Add photos and files"
              >
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={handleSelectFiles}>
                <Image className="h-4 w-4" />
                Add photos & files
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Text input */}
          <div className="relative min-w-0 flex-1">
            <textarea
              data-testid="task-input-textarea"
              ref={textareaRef}
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isInputDisabled}
              rows={1}
              className={`block max-h-[160px] min-h-10 w-full resize-none bg-transparent pb-1.5 pt-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 leading-6 ${large ? 'text-lg' : 'text-sm'}`}
            />
            <InlineSlashCommandMenu
              commands={filteredSlashCommands}
              selectedIndex={selectedSlashIndex}
              onSelect={(command, index) => {
                setSelectedSlashIndex(index);
                Promise.resolve(command.execute()).then(() => {
                  resetPromptHistoryNavigation();
                  setText('');
                  setSelectedSlashIndex(0);
                });
              }}
            />
          </div>

          {onPlanNextJobs && (
            <button
              type="button"
              onClick={() => void onPlanNextJobs()}
              disabled={isActionDisabled || planningJobs}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background/60 text-foreground shadow-soft transition-[background-color,opacity] duration-200 ease-out hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
              title="Get ideas from memory"
            >
              {planningJobs ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Submit button */}
          <button
            data-testid="task-input-submit"
            type="button"
            onClick={() => {
              if (!text.trim()) return;
              analytics.trackSubmitTask();
              accomplish.logEvent({
                level: 'info',
                message: 'Task input submit clicked',
                context: { prompt: text, workingFolder },
              });
              const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
              Promise.resolve(onSubmit(text.trim(), workingFolder || undefined, files, privacyMode, draftUsageProjectId))
                .then((accepted) => {
                  if (accepted === false) return;
                  addChatPromptToHistory(text.trim());
                  resetPromptHistoryNavigation();
                  setText('');
                  setDraftUsageProjectId(null);
                  clearAttachedFiles();
                })
                .catch(() => {
                  // If submission fails, keep user input so they can retry.
                });
            }}
            disabled={!text.trim() || isActionDisabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft transition-[background-color,opacity] duration-200 ease-out hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            title="Submit (Enter)"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Attached files display */}
        {attachedFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachedFiles.map((file) => (
              <div key={file} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-foreground">
                <FileText className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate max-w-[200px]" title={file}>
                  {file.split(/[\\/]/).pop()}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(file)}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons row */}
        <div className="mt-1.5 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-t border-border/30 py-1.5">
          <ContextWindowIndicator compact stats={contextStats} className="mb-0" />

          <UsageProjectSelector
            mode="chat"
            value={draftUsageProjectId}
            onChange={setDraftUsageProjectId}
            compact
            disabled={isActionDisabled}
            persistSelection={false}
          />
          <UsageBudgetPill usageProjectId={draftUsageProjectId} label="Task budget" className="max-w-[220px]" />

          <button
            type="button"
            onClick={handleSelectFolder}
            disabled={isActionDisabled}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Select a working folder"
            aria-label="Select a working folder"
          >
            <Folder className="h-3.5 w-3.5" />
          </button>

{privacyMode === 'incognito' && <span className="text-xs font-medium text-amber-700">Incognito</span>}
          {(voiceEnabled || talkModeActive) && <span className="text-xs font-medium text-emerald-700" role="status">{talkModeActive ? 'Listening…' : 'Voice wake on'}</span>}
          <div className="inline-flex min-w-[280px] flex-1 items-center gap-1.5">
          <ComposerOptions activeCount={Number(privacyMode === 'incognito') + Number(voiceEnabled || talkModeActive)}>
<ContextInspector
            stats={contextStats}
            agentId={agentId}
            workspace={workingFolder || defaultWorkingFolder}
            attachedFiles={attachedFiles}
            privacyMode={privacyMode}
            usageProjectId={draftUsageProjectId}
          />
{onPrivacyModeChange && (
            <button
              type="button"
              onClick={() => onPrivacyModeChange(privacyMode === 'incognito' ? 'normal' : 'incognito')}
              disabled={isActionDisabled}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-medium shadow-sm backdrop-blur-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                privacyMode === 'incognito'
                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-700'
                  : 'border-border/70 bg-background/85 text-foreground/80 hover:border-border hover:bg-background hover:text-foreground'
              }`}
              title="Toggle incognito mode for this task/session"
              aria-label="Toggle incognito mode for this task/session"
              data-option-label="Incognito"
              aria-pressed={privacyMode === 'incognito'}
            >
              <Shield className="h-3.5 w-3.5" />
            </button>
          )}
<button
            type="button"
            onClick={() => {
              setSavedPromptsIncludeRecipes(true);
              setSavedPromptsMode('select');
              setShowSavedPromptsDialog(true);
            }}
            disabled={isActionDisabled || promptPickerCount === 0}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-background/85 px-2 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title={promptPickerCount === 0 ? 'No saved prompts or recipes' : 'Use a saved prompt or recipe'}
            aria-label={promptPickerCount === 0 ? 'No saved prompts or recipes' : 'Use a saved prompt or recipe'}
          >
            <FileText className="h-3.5 w-3.5" />
            {promptPickerCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">
                {promptPickerCount}
              </span>
            )}
          </button>
<button
            type="button"
            onClick={() => {
              setSavedPromptsIncludeRecipes(true);
              setSavedPromptsMode('manage');
              setShowSavedPromptsDialog(true);
            }}
            disabled={isActionDisabled}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Manage saved prompts"
            aria-label="Manage saved prompts"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
<button
            type="button"
            onClick={() => {
              setProjectWorkPopupOpen(true);
              writeChatProjectWorkPopupSession(true, draftUsageProjectId);
            }}
            disabled={isActionDisabled}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/85 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm transition-colors duration-150 hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Open project work linked to this Chat prompt."
            aria-label="Open project work linked to this Chat prompt"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
<button
            type="button"
            data-option-label="Voice wake" aria-pressed={voiceEnabled} onClick={toggleVoiceWake}
            disabled={voiceToggleBusy || isActionDisabled || !voiceAccessKeySet || talkModeActive}
            className={`flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition-colors ${
              voiceEnabled ? 'bg-emerald-500/20 text-emerald-700' : 'bg-background/85 text-foreground/80'
            } ${voiceToggleBusy ? 'opacity-60' : ''} ${talkModeActive ? 'ring-2 ring-emerald-400/40 shadow-glow' : ''}`}
            title={
              !voiceAccessKeySet
                ? 'Add access key to activate Picovoice'
                : talkModeActive
                  ? 'Listening for speech...'
                : voiceEnabled
                  ? 'Click to turn off voice wake'
                  : 'Click to turn on voice wake'
            }
          >
            <Mic className="h-3.5 w-3.5" />
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide">
              <span
                className={`h-2 w-2 rounded-full ${
                  talkModeActive ? 'bg-emerald-500 animate-pulse' : voiceEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                }`}
              />
              {voiceEnabled ? 'On' : 'Off'}
            </span>
            {talkModeActive && (
              <span className="text-[10px] font-semibold text-emerald-600 animate-pulse">Listening...</span>
            )}
            <div className="flex items-end gap-[2px] h-4">
              {(() => {
                const thresholds = [0.12, 0.24, 0.36, 0.5, 0.65, 0.8];
                const level = voiceMeterLevel;
                return thresholds.map((threshold, index) => (
                  <span
                    key={threshold}
                    className={`w-1 rounded-sm transition-colors ${
                      level >= threshold
                        ? 'bg-emerald-500'
                        : voiceEnabled
                          ? 'bg-emerald-500/30'
                          : 'bg-muted-foreground/30'
                    }`}
                    style={{ height: `${6 + index * 2}px` }}
                  />
                ));
              })()}
            </div>
          </button>
</ComposerOptions>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
            <ActionShelf compact mode="chat" projectId={draftUsageProjectId} side="bottom" disabled={isInputDisabled} incognito={privacyMode === 'incognito'} getDraft={() => textRef.current} onInsert={appendPromptText} onManage={() => { setSavedPromptsMode('manage'); setShowSavedPromptsDialog(true); }} />
          </div>
</div>

        {(talkModeActive || talkModeError) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {talkModeActive && (
              <span className="text-emerald-600 animate-pulse">Listening...</span>
            )}
            {talkModeActive && (
              <div className="flex items-center gap-1">
                {Array.from({ length: 6 }).map((_, index) => {
                  const threshold = (index + 1) / 6;
                  return (
                    <span
                      key={`talk-meter-${index}`}
                      className={`w-1 rounded-sm transition-colors ${
                        talkModeLevel >= threshold ? 'bg-emerald-500' : 'bg-emerald-500/30'
                      }`}
                      style={{ height: `${6 + index * 2}px` }}
                    />
                  );
                })}
              </div>
            )}
            {talkModeActive && talkModeInterim && (
              <span className="text-emerald-500/70">"{talkModeInterim}"</span>
            )}
            {talkModeError && (
              <span className="text-destructive">{talkModeError}</span>
            )}
          </div>
        )}
      </div>

      {/* Saved Prompts Dialog */}
      <SavedPromptsDialog
        open={showSavedPromptsDialog}
        onOpenChange={setShowSavedPromptsDialog}
        onSelectPrompt={handleSelectSavedPrompt}
        mode={savedPromptsMode}
        includeRecipes={savedPromptsIncludeRecipes}
      />
      <BuildProjectWorkPopup
        open={projectWorkPopupOpen}
        projects={usageProjects}
        assignees={usageAssignees}
        linkedProjectId={draftUsageProjectId}
        initialProjectId={draftUsageProjectId}
        sourceLabel={draftUsageProjectId ? 'Selected Chat budget project' : 'Chat project work'}
        fallbackLabel="Chat project work"
        storageScope="chat"
        agentId={agentId}
        onInsertPrompt={appendPromptText}
        onSelectedProjectChange={(projectId) => writeChatProjectWorkPopupSession(true, projectId)}
        onClose={() => {
          setProjectWorkPopupOpen(false);
          writeChatProjectWorkPopupSession(false);
        }}
      />

      {/* Working folder display - below the input box */}
      {workingFolder && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm">
          <Folder className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">Working in:</span>
          <span className="text-foreground truncate flex-1" title={workingFolder}>
            {workingFolder}
          </span>
          {defaultWorkingFolder && workingFolder === defaultWorkingFolder && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Default
            </span>
          )}
          <button
            type="button"
            onClick={clearWorkingFolder}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Clear working folder"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

export default TaskInputBar;
