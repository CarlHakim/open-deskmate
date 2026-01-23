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
import { Plus, Pencil, Trash2, Save, X, FileText, Search } from 'lucide-react';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

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
      }
    }
  }, [open, loadPrompts, mode]);

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

  const handleStartEdit = (prompt: SavedPrompt) => {
    setEditingId(prompt.id);
    setEditTitle(prompt.title);
    setEditContent(prompt.content);
    setIsCreating(false);
  };

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim() && editContent.trim()) {
      updatePrompt(editingId, editTitle, editContent);
      setEditingId(null);
      setEditTitle('');
      setEditContent('');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setNewTitle('');
    setNewContent('');
    setEditingId(null);
  };

  const handleSaveNew = () => {
    if (newTitle.trim() && newContent.trim()) {
      savePrompt(newTitle, newContent);
      setIsCreating(false);
      setNewTitle('');
      setNewContent('');
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewTitle('');
    setNewContent('');
  };

  const handleDelete = (id: string) => {
    deletePrompt(id);
    if (editingId === id) {
      setEditingId(null);
    }
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
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Manage Saved Prompts
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Create new prompt button */}
          {!isCreating && (
            <Button
              variant="outline"
              onClick={handleStartCreate}
              className="w-full justify-start gap-2"
            >
              <Plus className="h-4 w-4" />
              Create New Prompt
            </Button>
          )}

          {/* Create new prompt form */}
          {isCreating && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <Input
                placeholder="Prompt title..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
              <textarea
                placeholder="Prompt content..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={handleCancelCreate}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveNew}
                  disabled={!newTitle.trim() || !newContent.trim()}
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          )}

          {/* Prompts list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-2 pr-4">
              {prompts.length === 0 && !isCreating && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No saved prompts yet.</p>
                  <p className="text-sm mt-1">Click "Create New Prompt" to add one.</p>
                </div>
              )}

              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="border rounded-lg p-4 transition-colors"
                >
                  {editingId === prompt.id ? (
                    // Edit mode
                    <div className="space-y-3">
                      <Input
                        placeholder="Prompt title..."
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoFocus
                      />
                      <textarea
                        placeholder="Prompt content..."
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={!editTitle.trim() || !editContent.trim()}
                        >
                          <Save className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-foreground truncate">
                            {prompt.title}
                          </h4>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {prompt.content}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleStartEdit(prompt)}
                            title="Edit prompt"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(prompt.id)}
                            title="Delete prompt"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(prompt.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
