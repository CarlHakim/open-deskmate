'use client';

import { useRef, useEffect, useState } from 'react';
import { getAccomplish } from '../../lib/accomplish';
import { analytics } from '../../lib/analytics';
import { CornerDownLeft, Loader2, Folder, X, FileText, Settings } from 'lucide-react';
import SavedPromptsDialog from '../layout/SavedPromptsDialog';
import { useSavedPromptsStore } from '../../stores/savedPromptsStore';

interface TaskInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (workingFolder?: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
  large?: boolean;
  autoFocus?: boolean;
}

export default function TaskInputBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Assign a task or ask anything',
  isLoading = false,
  disabled = false,
  large = false,
  autoFocus = false,
}: TaskInputBarProps) {
  const isDisabled = disabled || isLoading;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const accomplish = getAccomplish();
  const [workingFolder, setWorkingFolder] = useState<string | null>(null);
  const [showSavedPromptsDialog, setShowSavedPromptsDialog] = useState(false);
  const [savedPromptsMode, setSavedPromptsMode] = useState<'select' | 'manage'>('select');
  const { prompts, loadPrompts } = useSavedPromptsStore();

  // Load saved prompts on mount
  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const handleSelectSavedPrompt = (content: string) => {
    onChange(content);
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

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(workingFolder || undefined);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Main input area */}
      <div className="relative flex flex-col rounded-2xl border-2 border-border/60 bg-background/80 backdrop-blur-sm px-4 py-3 shadow-soft transition-all duration-300 ease-out focus-within:border-primary/50 focus-within:shadow-glow focus-within:bg-background">
        {/* Text input row */}
        <div className="flex items-end gap-3">
          {/* Text input */}
          <textarea
            data-testid="task-input-textarea"
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            className={`max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 leading-relaxed ${large ? 'text-lg' : 'text-sm'}`}
          />

          {/* Submit button */}
          <button
            data-testid="task-input-submit"
            type="button"
            onClick={() => {
              analytics.trackSubmitTask();
              accomplish.logEvent({
                level: 'info',
                message: 'Task input submit clicked',
                context: { prompt: value, workingFolder },
              });
              onSubmit(workingFolder || undefined);
            }}
            disabled={!value.trim() || isDisabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft transition-all duration-200 ease-out hover:bg-primary/90 hover:shadow-glow hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-soft"
            title="Submit (Enter)"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Action buttons row */}
        <div className="mt-2 pt-2 border-t border-border/30 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectFolder}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
            title="Select a working folder"
          >
            <Folder className="h-3.5 w-3.5" />
            <span>Work in a folder</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSavedPromptsMode('select');
              setShowSavedPromptsDialog(true);
            }}
            disabled={isDisabled || prompts.length === 0}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
            title={prompts.length === 0 ? 'No saved prompts' : 'Use a saved prompt'}
          >
            <FileText className="h-3.5 w-3.5" />
            {prompts.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">
                {prompts.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setSavedPromptsMode('manage');
              setShowSavedPromptsDialog(true);
            }}
            disabled={isDisabled}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 border border-border/50 hover:border-border"
            title="Manage saved prompts"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Saved Prompts Dialog */}
      <SavedPromptsDialog
        open={showSavedPromptsDialog}
        onOpenChange={setShowSavedPromptsDialog}
        onSelectPrompt={handleSelectSavedPrompt}
        mode={savedPromptsMode}
      />

      {/* Working folder display - below the input box */}
      {workingFolder && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm">
          <Folder className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">Working in:</span>
          <span className="text-foreground truncate flex-1" title={workingFolder}>
            {workingFolder}
          </span>
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
}
