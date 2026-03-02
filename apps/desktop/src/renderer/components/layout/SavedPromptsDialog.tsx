import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSavedPromptsStore, SavedPrompt } from '../../stores/savedPromptsStore';
import { X, FileText, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { springs } from '@/lib/animations';

interface SavedPromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPrompt?: (content: string) => void;
  mode?: 'manage' | 'select';
}

export default function SavedPromptsDialog({
  open,
  onOpenChange,
  onSelectPrompt,
  mode = 'manage',
}: SavedPromptsDialogProps) {
  const { prompts, loadPrompts, savePrompt, updatePrompt, deletePrompt } = useSavedPromptsStore();
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [manageTitle, setManageTitle] = useState('');
  const [manageContent, setManageContent] = useState('');

  // Select mode state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      loadPrompts();
      if (mode === 'select') {
        setSearchQuery('');
        setSelectedIndex(0);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else {
        setActivePromptId(null);
        setManageTitle('');
        setManageContent('');
      }
    }
  }, [open, loadPrompts, mode]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      loadPrompts();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [open, loadPrompts]);

  // Filter prompts by search query
  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim()) {
      return prompts;
    }
    const query = searchQuery.toLowerCase();
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        p.content.toLowerCase().includes(query)
    );
  }, [prompts, searchQuery]);

  // Clamp selected index when results change
  useEffect(() => {
    if (mode === 'select') {
      setSelectedIndex((i) => Math.min(i, Math.max(0, filteredPrompts.length - 1)));
    }
  }, [filteredPrompts.length, mode]);

  const handleSelectByIndex = useCallback(
    (index: number) => {
      const prompt = filteredPrompts[index];
      if (prompt && onSelectPrompt) {
        onSelectPrompt(prompt.content);
        onOpenChange(false);
      }
    },
    [filteredPrompts, onSelectPrompt, onOpenChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode !== 'select') return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredPrompts.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredPrompts.length > 0) {
            handleSelectByIndex(selectedIndex);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [mode, filteredPrompts.length, selectedIndex, handleSelectByIndex, onOpenChange]
  );

  const handleManageSelectPrompt = (prompt: SavedPrompt) => {
    setActivePromptId(prompt.id);
    setManageTitle(prompt.title);
    setManageContent(prompt.content);
  };

  const handleManageNew = () => {
    setActivePromptId(null);
    setManageTitle('');
    setManageContent('');
  };

  const handleManageSave = () => {
    const content = manageContent.trim();
    if (!content) return;
    const title = manageTitle.trim() || content.slice(0, 64);
    if (activePromptId) {
      updatePrompt(activePromptId, title, content);
      return;
    }
    const created = savePrompt(title, content);
    if (created && created.id) {
      setActivePromptId(created.id);
      setManageTitle(created.title);
      setManageContent(created.content);
    }
  };

  const handleManageDelete = () => {
    if (!activePromptId) return;
    deletePrompt(activePromptId);
    setActivePromptId(null);
    setManageTitle('');
    setManageContent('');
  };

  const handleSelect = (prompt: SavedPrompt) => {
    if (onSelectPrompt) {
      onSelectPrompt(prompt.content);
      onOpenChange(false);
    }
  };

  // Select mode - spotlight-style dialog
  if (mode === 'select') {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <AnimatePresence>
          {open && (
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
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search saved prompts..."
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <DialogPrimitive.Close asChild>
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </DialogPrimitive.Close>
                  </div>

                  {/* Results */}
                  <div className="max-h-80 overflow-y-auto p-2">
                    {filteredPrompts.length === 0 ? (
                      <div className="px-3 py-8 text-sm text-muted-foreground text-center">
                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        {searchQuery.trim()
                          ? 'No prompts found'
                          : 'No saved prompts yet'}
                      </div>
                    ) : (
                      filteredPrompts.map((prompt, index) => (
                        <button
                          key={prompt.id}
                          onClick={() => handleSelectByIndex(index)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-100',
                            'flex flex-col gap-1',
                            selectedIndex === index
                              ? 'bg-primary text-primary-foreground'
                              : 'text-foreground hover:bg-accent'
                          )}
                        >
                          <span className="font-medium truncate">{prompt.title}</span>
                          <span
                            className={cn(
                              'text-xs line-clamp-2',
                              selectedIndex === index
                                ? 'text-primary-foreground/70'
                                : 'text-muted-foreground'
                            )}
                          >
                            {prompt.content}
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Footer hint */}
                  <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground flex items-center gap-4">
                    <span>
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> Navigate
                    </span>
                    <span>
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↵</kbd> Select
                    </span>
                    <span>
                      <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> Close
                    </span>
                  </div>
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      </DialogPrimitive.Root>
    );
  }

  // Manage mode - standard dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Manage Saved Prompts
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Create, edit, and delete reusable prompts.</p>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          <ScrollArea className="min-h-[220px] rounded-lg border border-border bg-background p-2">
            <div className="space-y-1">
              {prompts.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No saved prompts yet.
                </div>
              ) : (
                prompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => handleManageSelectPrompt(prompt)}
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left transition-colors',
                      activePromptId === prompt.id ? 'bg-primary/10' : 'hover:bg-accent'
                    )}
                  >
                    <div className="truncate text-sm font-semibold text-foreground">{prompt.title}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{prompt.content}</div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          <div className="flex min-h-[220px] flex-col rounded-lg border border-border bg-card p-3">
            <Input
              value={manageTitle}
              onChange={(e) => setManageTitle(e.target.value)}
              placeholder="Prompt title"
              maxLength={120}
            />
            <textarea
              value={manageContent}
              onChange={(e) => setManageContent(e.target.value)}
              placeholder="Prompt content"
              className="mt-2 min-h-[160px] w-full flex-1 resize-y rounded-md border border-input bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleManageNew}>
                New
              </Button>
              <Button
                type="button"
                onClick={handleManageSave}
                disabled={!manageContent.trim()}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleManageDelete}
                disabled={!activePromptId}
              >
                Delete
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
