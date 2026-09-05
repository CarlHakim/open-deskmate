import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BUILD_RECIPES } from '@/lib/build-recipes';
import {
  DEFAULT_PROMPT_CATEGORIES,
  DEFAULT_PROMPT_CATEGORY,
  mergePromptCategories,
  normalizePromptCategory,
  type PromptCategory,
} from '@/lib/prompt-categories';
import { useSavedPromptsStore, type SavedPrompt } from '@/stores/savedPromptsStore';

const BUILT_IN_CATEGORY_KEYS = new Set(DEFAULT_PROMPT_CATEGORIES.map((category) => category.toLowerCase()));

function firstPromptTitle(content: string): string {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Saved prompt';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export default function PromptLibrarySettingsPanel() {
  const {
    prompts,
    categories,
    loadPrompts,
    savePrompt,
    updatePrompt,
    deletePrompt,
    createCategory,
    renameCategory,
    deleteCategory,
  } = useSavedPromptsStore();

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<PromptCategory>(DEFAULT_PROMPT_CATEGORY);
  const [contentInput, setContentInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [iconInput, setIconInput] = useState('');
  const [colorInput, setColorInput] = useState('#2563eb');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PromptCategory>(DEFAULT_PROMPT_CATEGORY);
  const [renameDraft, setRenameDraft] = useState<PromptCategory>(DEFAULT_PROMPT_CATEGORY);
  const [replacementCategory, setReplacementCategory] = useState<PromptCategory>(DEFAULT_PROMPT_CATEGORY);
  const [filterCategory, setFilterCategory] = useState<'All' | string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const allCategories = useMemo(() => mergePromptCategories(
    categories,
    prompts.map((prompt) => prompt.category),
    BUILD_RECIPES.map((recipe) => recipe.category)
  ), [categories, prompts]);

  useEffect(() => {
    if (!allCategories.some((category) => category === categoryInput)) {
      setCategoryInput(allCategories[0] || DEFAULT_PROMPT_CATEGORY);
    }
    if (!allCategories.some((category) => category === selectedCategory)) {
      setSelectedCategory(allCategories[0] || DEFAULT_PROMPT_CATEGORY);
    }
    if (!allCategories.some((category) => category === replacementCategory)) {
      setReplacementCategory(allCategories.find((category) => category !== selectedCategory) || DEFAULT_PROMPT_CATEGORY);
    }
  }, [allCategories, categoryInput, replacementCategory, selectedCategory]);

  useEffect(() => {
    setRenameDraft(selectedCategory);
    const fallbackReplacement = allCategories.find((category) => category !== selectedCategory) || DEFAULT_PROMPT_CATEGORY;
    setReplacementCategory(fallbackReplacement);
  }, [allCategories, selectedCategory]);

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) || null,
    [prompts, selectedPromptId]
  );

  const filteredPrompts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return prompts.filter((prompt) => {
      if (filterCategory !== 'All' && prompt.category !== filterCategory) return false;
      if (!query) return true;
      return `${prompt.title} ${prompt.category} ${prompt.description || ''} ${prompt.content}`.toLowerCase().includes(query);
    });
  }, [filterCategory, prompts, searchQuery]);

  const filteredRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return BUILD_RECIPES.filter((recipe) => {
      if (filterCategory !== 'All' && recipe.category !== filterCategory) return false;
      if (!query) return true;
      return `${recipe.title} ${recipe.category} ${recipe.description} ${recipe.prompt}`.toLowerCase().includes(query);
    });
  }, [filterCategory, searchQuery]);

  const promptCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const prompt of prompts) {
      counts.set(prompt.category, (counts.get(prompt.category) || 0) + 1);
    }
    return counts;
  }, [prompts]);

  const selectPrompt = (prompt: SavedPrompt) => {
    setSelectedPromptId(prompt.id);
    setTitleInput(prompt.title);
    setCategoryInput(prompt.category);
    setContentInput(prompt.content);
    setDescriptionInput(prompt.description || '');
    setIconInput(prompt.icon || '');
    setColorInput(prompt.color || '#2563eb');
  };

  const startNewPrompt = () => {
    setSelectedPromptId(null);
    setTitleInput('');
    setCategoryInput(filterCategory === 'All' ? DEFAULT_PROMPT_CATEGORY : filterCategory);
    setContentInput('');
    setDescriptionInput('');
    setIconInput('');
    setColorInput('#2563eb');
  };

  const saveCurrentPrompt = () => {
    const content = contentInput.trim();
    if (!content) return;
    const title = titleInput.trim() || firstPromptTitle(content);
    const category = normalizePromptCategory(categoryInput);
    const metadata = {
      description: descriptionInput,
      icon: iconInput,
      color: colorInput,
    };
    if (selectedPromptId) {
      updatePrompt(selectedPromptId, title, content, category, metadata);
      return;
    }
    const created = savePrompt(title, content, category, metadata);
    setSelectedPromptId(created.id);
    setTitleInput(created.title);
    setCategoryInput(created.category);
    setContentInput(created.content);
    setDescriptionInput(created.description || '');
    setIconInput(created.icon || '');
    setColorInput(created.color || '#2563eb');
  };

  const addCategory = () => {
    const category = normalizePromptCategory(categoryDraft, '');
    if (!category) return;
    createCategory(category);
    setSelectedCategory(category);
    setFilterCategory(category);
    setCategoryDraft('');
  };

  const renameSelectedCategory = () => {
    const next = normalizePromptCategory(renameDraft, '');
    if (!next || next === selectedCategory || isSelectedCategoryBuiltIn) return;
    renameCategory(selectedCategory, next);
    setSelectedCategory(next);
    setFilterCategory((current) => (current === selectedCategory ? next : current));
  };

  const deleteSelectedCategory = () => {
    if (isSelectedCategoryBuiltIn) return;
    deleteCategory(selectedCategory, replacementCategory);
    setSelectedCategory(replacementCategory);
    setFilterCategory((current) => (current === selectedCategory ? replacementCategory : current));
  };

  const deleteCurrentPrompt = () => {
    if (!selectedPromptId) return;
    deletePrompt(selectedPromptId);
    startNewPrompt();
  };

  const saveRecipe = (recipe: typeof BUILD_RECIPES[number]) => {
    const created = savePrompt(`Recipe: ${recipe.title}`, recipe.prompt, recipe.category);
    selectPrompt(created);
  };

  const selectedCategoryKey = selectedCategory.toLowerCase();
  const isSelectedCategoryBuiltIn = BUILT_IN_CATEGORY_KEYS.has(selectedCategoryKey);
  const replacementOptions = allCategories.filter((category) => category !== selectedCategory);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Categories</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Built-in recipe categories stay available so recipes and saved prompts remain aligned. Add custom categories for your own prompts.
            </div>
          </div>

          <div className="space-y-1">
            {allCategories.map((category) => {
              const active = selectedCategory === category;
              const isBuiltIn = BUILT_IN_CATEGORY_KEYS.has(category.toLowerCase());
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                    active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <span className="truncate">{category}</span>
                  <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {promptCountByCategory.get(category) || 0}
                    {isBuiltIn ? ' builtin' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-md border border-border/50 bg-background/70 p-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Add category</div>
            <div className="flex gap-2">
              <input
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCategory();
                  }
                }}
                placeholder="Client work"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={addCategory}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/70 p-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Rename category</div>
            <div className="flex gap-2">
              <input
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                disabled={isSelectedCategoryBuiltIn}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={isSelectedCategoryBuiltIn} onClick={renameSelectedCategory}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/70 p-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Delete category</div>
            <select
              value={replacementCategory}
              onChange={(event) => setReplacementCategory(event.target.value)}
              disabled={replacementOptions.length === 0}
              className="mb-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              {replacementOptions.map((category) => (
                <option key={category} value={category}>
                  Move prompts to {category}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 w-full justify-start px-2 text-xs"
              disabled={isSelectedCategoryBuiltIn || replacementOptions.length === 0}
              onClick={deleteSelectedCategory}
              title={isSelectedCategoryBuiltIn ? 'Built-in recipe categories cannot be deleted' : undefined}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete selected category
            </Button>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search saved prompts and recipes..."
                className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="All">All categories</option>
              {allCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" onClick={startNewPrompt}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New prompt
            </Button>
          </div>

          <div className="grid gap-3">
            <div className="min-h-[320px] rounded-lg border border-border/60 bg-muted/10 p-2">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Saved prompts
              </div>
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {filteredPrompts.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                    No saved prompts match this view.
                  </div>
                ) : filteredPrompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => selectPrompt(prompt)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                      selectedPromptId === prompt.id ? 'bg-primary/15' : 'hover:bg-accent/50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {prompt.icon || prompt.color ? (
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white"
                            style={{ backgroundColor: prompt.color || '#64748b' }}
                          >
                            {prompt.icon || prompt.title.slice(0, 1)}
                          </span>
                        ) : null}
                        <span className="truncate text-sm font-medium text-foreground">{prompt.title}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {prompt.category}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{prompt.description || prompt.content}</div>
                  </button>
                ))}
              </div>

              <div className="mt-3 border-t border-border/60 pt-2">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" />
                  Bundled recipes
                </div>
                <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                  {filteredRecipes.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                      No recipes match this view.
                    </div>
                  ) : filteredRecipes.map((recipe) => (
                    <div key={recipe.id} className="rounded-md border border-border/50 bg-background/70 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{recipe.title}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{recipe.description}</div>
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {recipe.category}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => saveRecipe(recipe)}>
                          Save as prompt
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/70 p-3">
              <div className="mb-2 text-sm font-semibold text-foreground">
                {selectedPrompt ? 'Edit saved prompt' : 'Create saved prompt'}
              </div>
              <div className="space-y-2">
                <input
                  value={titleInput}
                  onChange={(event) => setTitleInput(event.target.value)}
                  placeholder="Prompt title"
                  maxLength={120}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  value={categoryInput}
                  onChange={(event) => setCategoryInput(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {allCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <input
                  value={descriptionInput}
                  onChange={(event) => setDescriptionInput(event.target.value)}
                  placeholder="Short description"
                  maxLength={240}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input
                    value={iconInput}
                    onChange={(event) => setIconInput(event.target.value)}
                    placeholder="Icon text"
                    maxLength={12}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground">
                    <span>Color</span>
                    <input
                      type="color"
                      value={colorInput}
                      onChange={(event) => setColorInput(event.target.value)}
                      className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
                      aria-label="Prompt card color"
                    />
                  </label>
                </div>
                <textarea
                  value={contentInput}
                  onChange={(event) => setContentInput(event.target.value)}
                  placeholder="Prompt content"
                  className="min-h-[260px] w-full resize-y rounded-md border border-input bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={saveCurrentPrompt} disabled={!contentInput.trim()}>
                    Save prompt
                  </Button>
                  <Button type="button" variant="outline" onClick={startNewPrompt}>
                    New
                  </Button>
                  <Button type="button" variant="outline" disabled={!selectedPromptId} onClick={deleteCurrentPrompt}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
