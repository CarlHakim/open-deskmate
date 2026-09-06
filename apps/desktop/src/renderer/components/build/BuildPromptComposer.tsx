import ContextInspector from "@/components/chat/ContextInspector";
import ActionShelf from "@/components/chat/ActionShelf";
import ComposerOptions from "@/components/chat/ComposerOptions";
import ContextWindowIndicator from "@/components/chat/ContextWindowIndicator";
import InlineSlashCommandMenu from "@/components/commands/InlineSlashCommandMenu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { UsageProjectSelector } from "@/components/usage/UsageProjectSelector";
import { addPromptHistoryEntry, BUILD_PROMPT_HISTORY_STORAGE_KEY, readPromptHistory, shouldHandlePromptHistoryRecall } from "@/lib/prompt-history";
import { registerPromptAttachmentTarget, registerPromptInsertionTarget } from "@/lib/prompt-insertion";
import { filterSlashCommands, type SlashCommandDefinition } from "@/lib/slash-commands";
import type { ContextWindowEstimateResponse } from "@accomplish/shared";
import { CheckCircle2, ClipboardList, FileDiff, FileText, Folder, FolderOpen, Loader2, Maximize2, Minimize2, Plus, Save, Square, Wrench, X } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pathLeaf } from '../../lib/workspace-paths';

export type BuildPresetFieldHelpProps = {
  helpTitle: string;
  helpDescription: string;
  optional?: boolean;
  children: ReactNode;
};

export function BuildPresetFieldHelp({
  helpTitle,
  helpDescription,
  optional = false,
  children,
}: BuildPresetFieldHelpProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocusCapture={() => setOpen(true)}
          onBlurCapture={() => setOpen(false)}
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-xs leading-relaxed text-foreground" align="start">
        <div className="space-y-1">
          <div className="font-medium text-foreground">
            {helpTitle}
            {optional ? <span className="ml-1 text-muted-foreground">(optional)</span> : null}
          </div>
          <div className="text-muted-foreground">{helpDescription}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type BuildPromptComposerProps = {
  resetKey: number;
  initialValue: string;
  attachedFiles: string[];
  aiBusy: boolean;
  interruptingAiTask: boolean;
  autoRepairBusy: boolean;
  contextStats: ContextWindowEstimateResponse | null;
  agentId?: string | null;
  workspace?: string | null;
  usageProjectId?: string | null;
  askAiToRunTests: boolean;
  showWorkingFolder?: boolean;
  showProposedDiffPopupButton?: boolean;
  promptsCount: number;
  onDraftChange?: (value: string) => void;
  onUsageProjectChange?: (projectId: string | null) => void;
  onAskAiToRunTestsChange: (enabled: boolean) => void;
  onRun: (value: string) => void;
  onStop: () => void;
  onAttachFiles: () => void;
  onAddAttachedFiles: (files: string[]) => void;
  onRemoveFile: (filePath: string) => void;
  onOpenSavedPrompts: (mode: 'select' | 'manage') => void;
  onSaveCurrentPrompt: (value: string) => void;
  onOpenProjectWork: () => void;
  onOpenProposedDiffPopup?: () => void;
  slashCommands: SlashCommandDefinition[];
};

export const BuildPromptComposer = memo(function BuildPromptComposer({
  resetKey,
  initialValue,
  attachedFiles,
  aiBusy,
  interruptingAiTask,
  autoRepairBusy,
  contextStats,
  agentId,
  workspace,
  usageProjectId,
  askAiToRunTests,
  showWorkingFolder = false,
  showProposedDiffPopupButton = false,
  promptsCount,
  onDraftChange,
  onUsageProjectChange,
  onAskAiToRunTestsChange,
  onRun,
  onStop,
  onAttachFiles,
  onAddAttachedFiles,
  onRemoveFile,
  onOpenSavedPrompts,
  onSaveCurrentPrompt,
  onOpenProjectWork,
  onOpenProposedDiffPopup,
  slashCommands,
}: BuildPromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef(initialValue);
  const promptHistoryEntriesRef = useRef<string[]>([]);
  const promptHistoryCursorRef = useRef<number | null>(null);
  const promptHistoryDraftRef = useRef('');
  const [slashCommandInput, setSlashCommandInput] = useState(
    initialValue.startsWith('/') ? initialValue : ''
  );
  const [canRun, setCanRun] = useState(Boolean(initialValue.trim()));
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [savedPromptFlash, setSavedPromptFlash] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const inputRowRef = useRef<HTMLDivElement>(null);
  const resizeFrame = useRef(0);
  // Coalesce typing and width changes into one layout measurement per frame.
  const resizeInput = useCallback(() => {
    cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input) return;
      const scrollTop = input.scrollTop;
      input.style.height = 'auto';
      const maxHeight = expandedRef.current ? Math.min(360, window.innerHeight * 0.4) : 136;
      const height = expandedRef.current
        ? maxHeight
        : Math.min(maxHeight, Math.max(56, input.scrollHeight));
      input.style.height = `${height}px`;
      input.scrollTop = scrollTop;
    });
  }, []);
  useEffect(() => {
    resizeInput();
    const row = inputRowRef.current;
    let previousWidth = row?.clientWidth;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (row?.clientWidth !== previousWidth) {
        previousWidth = row?.clientWidth;
        resizeInput();
      }
    });
    if (row) observer?.observe(row);
    window.addEventListener('resize', resizeInput);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resizeInput);
      cancelAnimationFrame(resizeFrame.current);
    };
  }, [resizeInput, expanded]);
  const workingFolderLabel = useMemo(() => {
    const value = workspace?.trim();
    if (!value) return '';
    return pathLeaf(value) || value;
  }, [workspace]);

  useEffect(() => {
    draftRef.current = initialValue;
    onDraftChange?.(initialValue);
    setSlashCommandInput(initialValue.startsWith('/') ? initialValue : '');
    setCanRun(Boolean(initialValue.trim()));
    if (textareaRef.current && textareaRef.current.value !== initialValue) {
      textareaRef.current.value = initialValue;
    }
    resizeInput();
  }, [initialValue, onDraftChange, resetKey, resizeInput]);

  useEffect(() => {
    promptHistoryEntriesRef.current = readPromptHistory(BUILD_PROMPT_HISTORY_STORAGE_KEY);
  }, []);

  const resetPromptHistoryNavigation = useCallback(() => {
    promptHistoryCursorRef.current = null;
    promptHistoryDraftRef.current = '';
  }, []);

  const setDraftValue = useCallback((value: string) => {
    draftRef.current = value;
    onDraftChange?.(value);
    setSlashCommandInput(value.startsWith('/') ? value : '');
    setCanRun(Boolean(value.trim()));
    if (textareaRef.current) {
      textareaRef.current.value = value;
      textareaRef.current.focus();
      const cursor = value.length;
      textareaRef.current.setSelectionRange(cursor, cursor);
    }
    resizeInput();
  }, [onDraftChange, resizeInput]);

  useEffect(() => registerPromptInsertionTarget(
    { mode: 'build', label: 'Build prompt' },
    (text) => {
      const insertion = text.trim();
      if (!insertion) return;
      resetPromptHistoryNavigation();
      const current = (textareaRef.current?.value ?? draftRef.current).trim();
      setDraftValue(current ? `${current}\n\n${insertion}` : insertion);
    }
  ), [resetPromptHistoryNavigation, setDraftValue]);

  useEffect(() => registerPromptAttachmentTarget(
    { mode: 'build', label: 'Build prompt' },
    onAddAttachedFiles
  ), [onAddAttachedFiles]);

  const recallPromptHistory = useCallback((direction: 'older' | 'newer') => {
    const entries = promptHistoryEntriesRef.current;
    if (entries.length === 0) return;

    const currentCursor = promptHistoryCursorRef.current;
    if (direction === 'older') {
      if (currentCursor === null) {
        promptHistoryDraftRef.current = textareaRef.current?.value ?? draftRef.current;
        promptHistoryCursorRef.current = entries.length - 1;
      } else {
        promptHistoryCursorRef.current = Math.max(0, currentCursor - 1);
      }
    } else if (currentCursor !== null) {
      if (currentCursor >= entries.length - 1) {
        promptHistoryCursorRef.current = null;
        setDraftValue(promptHistoryDraftRef.current);
        return;
      }
      promptHistoryCursorRef.current = currentCursor + 1;
    }

    const nextCursor = promptHistoryCursorRef.current;
    if (nextCursor !== null) {
      setDraftValue(entries[nextCursor] ?? '');
    }
  }, [setDraftValue]);

  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommandInput, slashCommands),
    [slashCommandInput, slashCommands]
  );

  useEffect(() => {
    setSelectedSlashIndex((current) => {
      if (filteredSlashCommands.length === 0) return 0;
      return Math.min(current, filteredSlashCommands.length - 1);
    });
  }, [filteredSlashCommands]);

  const handleChange = useCallback((event: { target: HTMLTextAreaElement }) => {
    const next = event.target.value;
    resetPromptHistoryNavigation();
    draftRef.current = next;
    onDraftChange?.(next);
    setSlashCommandInput((current) => {
      const nextSlashInput = next.startsWith('/') ? next : '';
      return current === nextSlashInput ? current : nextSlashInput;
    });
    setCanRun(Boolean(next.trim()));
    resizeInput();
  }, [onDraftChange, resetPromptHistoryNavigation, resizeInput]);

  const handleRun = useCallback(() => {
    const rawValue = textareaRef.current?.value ?? draftRef.current;
    const next = rawValue.trim();
    if (!next || aiBusy) return;
    onRun(next);
    promptHistoryEntriesRef.current = addPromptHistoryEntry(
      BUILD_PROMPT_HISTORY_STORAGE_KEY,
      next,
      promptHistoryEntriesRef.current
    );
    resetPromptHistoryNavigation();
    // The parent clears via resetKey only after the runner accepts the prompt.
    // Keep the draft if submission is rejected or an automatic turn is active.
  }, [aiBusy, onRun, resetPromptHistoryNavigation]);

  const handleExecuteSlashCommand = useCallback(async (command: SlashCommandDefinition) => {
    await command.execute();
    resetPromptHistoryNavigation();
    draftRef.current = '';
    onDraftChange?.('');
    setSlashCommandInput('');
    if (textareaRef.current) {
      textareaRef.current.value = '';
    }
    setCanRun(false);
    setSelectedSlashIndex(0);
    resizeInput();
  }, [onDraftChange, resetPromptHistoryNavigation, resizeInput]);

  const attachmentChip = (filePath: string) => <div key={filePath} className="flex min-w-0 items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-foreground">
    <FileText className="h-3 w-3 shrink-0 text-primary" />
    <span className="max-w-28 truncate" title={filePath}>{pathLeaf(filePath)}</span>
    <button type="button" onClick={() => onRemoveFile(filePath)} aria-label={`Remove attachment ${pathLeaf(filePath)}`} title="Remove file" className="shrink-0 rounded p-0.5 hover:bg-accent"><X className="h-3 w-3" /></button>
  </div>;
  return (
    <div aria-label="Build prompt composer" role="region" className="min-w-0 space-y-1">
      <div ref={inputRowRef} className="flex items-end gap-1 rounded-lg border border-input bg-background p-1 focus-within:border-ring">
        <button type="button" onClick={onAttachFiles} aria-label="Attach files to Build prompt" title="Attach files to this build prompt." className="mb-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="h-4 w-4" /></button>
        <div className="relative min-w-0 flex-1">
          <Textarea aria-label="Build prompt" ref={textareaRef} defaultValue={initialValue} onChange={handleChange} rows={2}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              handleRun();
              return;
            }
            if (filteredSlashCommands.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedSlashIndex((current) => (
                  current >= filteredSlashCommands.length - 1 ? 0 : current + 1
                ));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedSlashIndex((current) => (
                  current <= 0 ? filteredSlashCommands.length - 1 : current - 1
                ));
                return;
              }
              if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault();
                const selected = filteredSlashCommands[selectedSlashIndex] || filteredSlashCommands[0];
                if (selected) {
                  void handleExecuteSlashCommand(selected);
                }
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                resetPromptHistoryNavigation();
                draftRef.current = '';
                setSlashCommandInput('');
                if (textareaRef.current) {
                  textareaRef.current.value = '';
                }
                onDraftChange?.('');
                resizeInput();
                setCanRun(false);
                setSelectedSlashIndex(0);
              }
            }
            if (event.key === 'ArrowUp') {
              const shouldRecall = shouldHandlePromptHistoryRecall({
                key: event.key,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                currentTarget: event.currentTarget,
              }, 'older', promptHistoryCursorRef.current !== null);
              if (shouldRecall) {
                event.preventDefault();
                recallPromptHistory('older');
                return;
              }
            }
            if (event.key === 'ArrowDown') {
              const shouldRecall = shouldHandlePromptHistoryRecall({
                key: event.key,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                currentTarget: event.currentTarget,
              }, 'newer', promptHistoryCursorRef.current !== null);
              if (shouldRecall) {
                event.preventDefault();
                recallPromptHistory('newer');
                return;
              }
            }
          }}
            placeholder="Describe what to build or change…"
            className="min-h-[56px] resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-sm leading-5 shadow-none field-sizing-fixed focus-visible:ring-0 dark:bg-transparent"
          />
          <InlineSlashCommandMenu commands={filteredSlashCommands} selectedIndex={selectedSlashIndex} placement="top" onSelect={(command, index) => { setSelectedSlashIndex(index); void handleExecuteSlashCommand(command); }} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <button type="button" aria-label={expanded ? 'Collapse Build prompt editor' : 'Expand Build prompt editor'} aria-pressed={expanded} title={expanded ? 'Collapse prompt editor' : 'Expand prompt editor'} onClick={() => { setExpanded(value => !value); textareaRef.current?.focus(); }} className="inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">{expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
          {aiBusy ? <Button type="button" size="sm" variant="outline" onClick={onStop} disabled={interruptingAiTask} aria-label={interruptingAiTask ? 'Stopping current build task' : 'Stop current build task'} title="Stop the current build task" className="h-8 gap-1 border-destructive/40 px-2 text-destructive hover:bg-destructive/10">
            {interruptingAiTask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}{interruptingAiTask ? 'Stopping' : 'Stop'}
          </Button> : <Button type="button" size="sm" onClick={handleRun} disabled={!canRun} aria-label="Run AI task" title="Run task (Ctrl+Enter / Cmd+Enter)" className="h-8 gap-1 px-2"><Wrench className="h-3.5 w-3.5" />Run</Button>}
        </div>
      </div>
      {attachedFiles.length > 0 && <div aria-label="Build attachments" className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto">
        {attachedFiles.slice(0, 2).map(attachmentChip)}
        {attachedFiles.length > 2 && <Popover><PopoverTrigger asChild><button type="button" className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-foreground hover:bg-accent" aria-label="Show remaining attachments">+{attachedFiles.length - 2} files</button></PopoverTrigger><PopoverContent side="top" align="start" aria-label="Remaining Build attachments" className="max-h-64 space-y-2 overflow-y-auto"><h3 className="text-sm font-medium">More attachments</h3>{attachedFiles.slice(2).map(attachmentChip)}</PopoverContent></Popover>}
      </div>}
      <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto py-1">
        <UsageProjectSelector mode="build" value={usageProjectId ?? null} onChange={onUsageProjectChange} compact disabled={aiBusy} className="shrink-0" />
        <div className="inline-flex min-w-[280px] flex-1 items-center gap-1.5">
          <ComposerOptions side="top">
            <label className="flex w-full items-start gap-2 rounded-md border border-border p-2 text-sm">
              <input type="checkbox" checked={askAiToRunTests} onChange={event => onAskAiToRunTestsChange(event.target.checked)} disabled={aiBusy} aria-label="Ask AI to run tests" className="mt-1" />
              <span><span className="flex items-center gap-1 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-primary" />Ask AI to run tests</span><span className="mt-1 block text-xs text-muted-foreground">Adds instructions to update relevant tests, run checks, and fix failures for code changes.</span></span>
            </label>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenSavedPrompts('select')} disabled={aiBusy || promptsCount === 0} aria-label="Use saved prompt"><FileText className="mr-1 h-4 w-4" />Use saved prompt ({promptsCount})</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenSavedPrompts('manage')} disabled={aiBusy} aria-label="Manage saved prompts"><ClipboardList className="mr-1 h-4 w-4" />Manage prompts</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => {
              const value = (textareaRef.current?.value ?? draftRef.current).trim();
              if (value) { onSaveCurrentPrompt(value); setSavedPromptFlash(true); window.setTimeout(() => setSavedPromptFlash(false), 1600); }
            }} disabled={aiBusy || !canRun} aria-label="Save current Build prompt"><Save className="mr-1 h-4 w-4" />Save current prompt</Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenProjectWork} aria-label="Open project work linked to this preset"><FolderOpen className="mr-1 h-4 w-4" />Project work</Button>
            <div className="flex items-center gap-2 text-xs text-foreground"><ContextInspector stats={contextStats} agentId={agentId} workspace={workspace} attachedFiles={attachedFiles} usageProjectId={usageProjectId} /><span>Inspect context</span></div>
            {showWorkingFolder && workingFolderLabel && <div className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground" title={workspace || workingFolderLabel}><Folder className="h-3.5 w-3.5 shrink-0" /><span className="shrink-0">Working in</span><span className="truncate text-foreground">{workspace || workingFolderLabel}</span></div>}
            {showProposedDiffPopupButton && <Button type="button" size="sm" variant="outline" onClick={onOpenProposedDiffPopup} aria-label="Open Changes & Git popup"><FileDiff className="mr-1 h-3.5 w-3.5" />Changes & Git</Button>}
          </ComposerOptions>
          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
          <ActionShelf compact key={resetKey} mode="build" projectId={usageProjectId}
            getDraft={() => draftRef.current}
            onInsert={text => {
              resetPromptHistoryNavigation();
              const current = draftRef.current.trim();
              setDraftValue(current ? `${current}\n\n${text}` : text);
            }}
            onManage={() => onOpenSavedPrompts('manage')}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <ContextWindowIndicator compact stats={contextStats} className="mb-0" />
        {askAiToRunTests && <span title="Ask AI to run tests is enabled in More options" className="inline-flex items-center gap-1 text-primary"><CheckCircle2 className="h-3 w-3" />Tests on</span>}
        {autoRepairBusy && <span role="status" className="text-muted-foreground">Auto-repair queued…</span>}
        {savedPromptFlash && <span role="status" className="text-emerald-600 dark:text-emerald-300">Saved prompt</span>}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.resetKey === next.resetKey
  && prev.initialValue === next.initialValue
  && prev.aiBusy === next.aiBusy
  && prev.interruptingAiTask === next.interruptingAiTask
  && prev.autoRepairBusy === next.autoRepairBusy
  && prev.contextStats === next.contextStats
  && prev.agentId === next.agentId
  && prev.workspace === next.workspace
  && prev.usageProjectId === next.usageProjectId
  && prev.askAiToRunTests === next.askAiToRunTests
  && prev.showWorkingFolder === next.showWorkingFolder
  && prev.showProposedDiffPopupButton === next.showProposedDiffPopupButton
  && prev.promptsCount === next.promptsCount
  && prev.onRun === next.onRun
  && prev.onStop === next.onStop
  && prev.onAttachFiles === next.onAttachFiles
  && prev.onAddAttachedFiles === next.onAddAttachedFiles
  && prev.onRemoveFile === next.onRemoveFile
  && prev.onOpenSavedPrompts === next.onOpenSavedPrompts
  && prev.onSaveCurrentPrompt === next.onSaveCurrentPrompt
  && prev.onOpenProjectWork === next.onOpenProjectWork
  && prev.onOpenProposedDiffPopup === next.onOpenProposedDiffPopup
  && prev.onDraftChange === next.onDraftChange
  && prev.onUsageProjectChange === next.onUsageProjectChange
  && prev.onAskAiToRunTestsChange === next.onAskAiToRunTestsChange
  && prev.slashCommands === next.slashCommands
  && prev.attachedFiles.length === next.attachedFiles.length
  && prev.attachedFiles.every((entry, index) => entry === next.attachedFiles[index])
));
