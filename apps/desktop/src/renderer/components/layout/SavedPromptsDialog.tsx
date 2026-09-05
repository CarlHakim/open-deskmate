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
import { BookOpen, X, FileText, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { springs } from '@/lib/animations';
import { BUILD_RECIPES } from '@/lib/build-recipes';
import {
  DEFAULT_PROMPT_CATEGORY,
  mergePromptCategories,
  type PromptCategory,
} from '@/lib/prompt-categories';

interface SavedPromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPrompt?: (content: string) => void;
  mode?: 'manage' | 'select';
  includeRecipes?: boolean;
}

type PromptSelectItem = {
  id: string;
  title: string;
  content: string;
  category: PromptCategory;
  source: 'recipe' | 'saved';
  description?: string;
  icon?: string;
  color?: string;
};

const CATEGORY_VISUALS: Record<string, { icon: string; color: string }> = {
  Build: { icon: 'B', color: '#2563eb' },
  Research: { icon: 'R', color: '#0891b2' },
  Automation: { icon: 'A', color: '#7c3aed' },
  Files: { icon: 'F', color: '#16a34a' },
  Connectors: { icon: 'C', color: '#ea580c' },
  Troubleshooting: { icon: 'T', color: '#dc2626' },
};

function getPromptVisual(prompt: PromptSelectItem | SavedPrompt): { icon: string; color: string } {
  const fallback = CATEGORY_VISUALS[prompt.category] || { icon: 'P', color: '#64748b' };
  return {
    icon: prompt.icon?.trim() || fallback.icon,
    color: prompt.color || fallback.color,
  };
}

export default function SavedPromptsDialog({
  open,
  onOpenChange,
  onSelectPrompt,
  mode = 'manage',
  includeRecipes,
}: SavedPromptsDialogProps) {
  const { prompts, categories, loadPrompts, savePrompt, updatePrompt, deletePrompt } = useSavedPromptsStore();
  const shouldIncludeRecipes = includeRecipes ?? mode === 'select';
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [manageTitle, setManageTitle] = useState('');
  const [manageContent, setManageContent] = useState('');
  const [manageCategory, setManageCategory] = useState<PromptCategory>(DEFAULT_PROMPT_CATEGORY);
  const [manageDescription, setManageDescription] = useState('');
  const [manageIcon, setManageIcon] = useState('');
  const [manageColor, setManageColor] = useState('#2563eb');

  // Select mode state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | PromptCategory>('All');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      loadPrompts();
      if (mode === 'select') {
        setSearchQuery('');
        setSelectedCategory('All');
        setSelectedIndex(0);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else {
        setActivePromptId(null);
        setManageTitle('');
        setManageContent('');
        setManageCategory(DEFAULT_PROMPT_CATEGORY);
        setManageDescription('');
        setManageIcon('');
        setManageColor(CATEGORY_VISUALS[DEFAULT_PROMPT_CATEGORY]?.color || '#2563eb');
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

  const selectablePrompts = useMemo<PromptSelectItem[]>(() => {
    const recipeItems: PromptSelectItem[] = shouldIncludeRecipes
      ? BUILD_RECIPES.map((recipe) => ({
        id: `recipe:${recipe.id}`,
        title: recipe.title,
        content: recipe.prompt,
        category: recipe.category,
        source: 'recipe',
        description: recipe.description,
      }))
      : [];
    const savedItems: PromptSelectItem[] = prompts.map((prompt) => ({
      id: `saved:${prompt.id}`,
      title: prompt.title,
      content: prompt.content,
      category: prompt.category,
      source: 'saved',
      description: prompt.description,
      icon: prompt.icon,
      color: prompt.color,
    }));
    return [...recipeItems, ...savedItems];
  }, [prompts, shouldIncludeRecipes]);

  const selectableCategories = useMemo(
    () => mergePromptCategories(categories, selectablePrompts.map((prompt) => prompt.category)),
    [categories, selectablePrompts]
  );

  // Filter prompts and recipes by category and search query
  const filteredPrompts = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return selectablePrompts.filter((p) => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) {
        return false;
      }
      if (!query.trim()) {
        return true;
      }
      return (
        p.title.toLowerCase().includes(query) ||
        p.content.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        p.source.toLowerCase().includes(query) ||
        Boolean(p.description?.toLowerCase().includes(query))
      );
    });
  }, [selectablePrompts, searchQuery, selectedCategory]);

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
    setManageCategory(prompt.category);
    setManageDescription(prompt.description || '');
    setManageIcon(prompt.icon || '');
    setManageColor(prompt.color || CATEGORY_VISUALS[prompt.category]?.color || '#2563eb');
  };

  const handleManageNew = () => {
    setActivePromptId(null);
    setManageTitle('');
    setManageContent('');
    setManageCategory(DEFAULT_PROMPT_CATEGORY);
    setManageDescription('');
    setManageIcon('');
    setManageColor(CATEGORY_VISUALS[DEFAULT_PROMPT_CATEGORY]?.color || '#2563eb');
  };

  const handleManageSave = () => {
    const content = manageContent.trim();
    if (!content) return;
    const title = manageTitle.trim() || content.slice(0, 64);
    const metadata = {
      description: manageDescription,
      icon: manageIcon,
      color: manageColor,
    };
    if (activePromptId) {
      updatePrompt(activePromptId, title, content, manageCategory, metadata);
      return;
    }
    const created = savePrompt(title, content, manageCategory, metadata);
    if (created && created.id) {
      setActivePromptId(created.id);
      setManageTitle(created.title);
      setManageContent(created.content);
      setManageCategory(created.category);
      setManageDescription(created.description || '');
      setManageIcon(created.icon || '');
      setManageColor(created.color || CATEGORY_VISUALS[created.category]?.color || '#2563eb');
    }
  };

  const handleManageDelete = () => {
    if (!activePromptId) return;
    deletePrompt(activePromptId);
    setActivePromptId(null);
    setManageTitle('');
    setManageContent('');
    setManageCategory(DEFAULT_PROMPT_CATEGORY);
    setManageDescription('');
    setManageIcon('');
    setManageColor(CATEGORY_VISUALS[DEFAULT_PROMPT_CATEGORY]?.color || '#2563eb');
  };

  const openCategorySettings = () => {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent('opendeskmate:open-settings', {
      detail: { query: 'Saved Prompts & Recipes' },
    }));
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
                      placeholder={shouldIncludeRecipes ? 'Search prompts and recipes...' : 'Search saved prompts...'}
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

                  <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
                    {(['All', ...selectableCategories] as Array<'All' | PromptCategory>).map((category) => {
                      const active = selectedCategory === category;
                      const count = category === 'All'
                        ? selectablePrompts.length
                        : selectablePrompts.filter((prompt) => prompt.category === category).length;
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(category);
                            setSelectedIndex(0);
                          }}
                          className={cn(
                            'shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors',
                            active
                              ? 'bg-primary/15 text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          {category} <span className="text-[10px] opacity-70">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Results */}
                  <div className="max-h-80 overflow-y-auto p-2">
                    {filteredPrompts.length === 0 ? (
                      <div className="px-3 py-8 text-sm text-muted-foreground text-center">
                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        {searchQuery.trim()
                          ? 'No prompts found'
                          : shouldIncludeRecipes ? 'No prompts or recipes yet' : 'No saved prompts yet'}
                      </div>
                    ) : (
                      filteredPrompts.map((prompt, index) => {
                        const visual = getPromptVisual(prompt);
                        return (
                        <button
                          key={prompt.id}
                          onClick={() => handleSelectByIndex(index)}
                          className={cn(
                            'relative w-full overflow-hidden rounded-md border px-3 py-2 text-left text-sm transition-colors duration-100',
                            'grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5',
                            selectedIndex === index
                              ? 'border-primary/50 bg-primary text-primary-foreground'
                              : 'border-border/60 bg-background/70 text-foreground hover:bg-accent'
                          )}
                        >
                          <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: visual.color }} />
                          <span
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold',
                              selectedIndex === index ? 'bg-primary-foreground/15 text-primary-foreground' : 'text-white'
                            )}
                            style={selectedIndex === index ? undefined : { backgroundColor: visual.color }}
                          >
                            {visual.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{prompt.title}</span>
                              <span
                                className={cn(
                                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
                                  selectedIndex === index
                                    ? 'bg-primary-foreground/15 text-primary-foreground/80'
                                    : 'bg-muted text-muted-foreground'
                                )}
                              >
                                {prompt.category}
                              </span>
                              <span
                                className={cn(
                                  'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
                                  selectedIndex === index
                                    ? 'bg-primary-foreground/15 text-primary-foreground/80'
                                    : prompt.source === 'recipe'
                                      ? 'bg-teal-500/10 text-teal-700 dark:text-teal-200'
                                      : 'bg-muted text-muted-foreground'
                                )}
                              >
                                {prompt.source === 'recipe' ? <BookOpen className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                                {prompt.source === 'recipe' ? 'Recipe' : 'Saved'}
                              </span>
                            </span>
                            <span
                              className={cn(
                                'mt-1 block text-xs line-clamp-2',
                                selectedIndex === index
                                  ? 'text-primary-foreground/70'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {prompt.description || prompt.content}
                            </span>
                          </span>
                        </button>
                        );
                      })
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Create, edit, and delete reusable prompts.</p>
          <Button type="button" variant="outline" size="sm" onClick={openCategorySettings}>
            <Settings className="mr-2 h-3.5 w-3.5" />
            Manage categories
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          <ScrollArea className="min-h-[220px] rounded-lg border border-border bg-background p-2">
            <div className="space-y-1">
              {prompts.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No saved prompts yet.
                </div>
              ) : (
                prompts.map((prompt) => {
                  const visual = getPromptVisual(prompt);
                  return (
                    <button
                      key={prompt.id}
                      type="button"
                      onClick={() => handleManageSelectPrompt(prompt)}
                      className={cn(
                        'grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-2 rounded-md px-3 py-2 text-left transition-colors',
                        activePromptId === prompt.id ? 'bg-primary/10' : 'hover:bg-accent'
                      )}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold text-white" style={{ backgroundColor: visual.color }}>
                        {visual.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">{prompt.title}</span>
                        <span className="mt-1 inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {prompt.category}
                        </span>
                        <span className="block line-clamp-2 text-xs text-muted-foreground">{prompt.description || prompt.content}</span>
                      </span>
                    </button>
                  );
                })
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
            <select
              value={manageCategory}
              onChange={(e) => setManageCategory(e.target.value as PromptCategory)}
              className="mt-2 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <Input
              value={manageDescription}
              onChange={(e) => setManageDescription(e.target.value)}
              placeholder="Short description"
              maxLength={240}
              className="mt-2"
            />
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                value={manageIcon}
                onChange={(e) => setManageIcon(e.target.value)}
                placeholder="Icon text"
                maxLength={12}
              />
              <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground">
                <span>Color</span>
                <input
                  type="color"
                  value={manageColor}
                  onChange={(e) => setManageColor(e.target.value)}
                  className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
                  aria-label="Prompt card color"
                />
              </label>
            </div>
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
