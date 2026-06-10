export const DEFAULT_PROMPT_CATEGORIES = [
  'Build',
  'Research',
  'Automation',
  'Files',
  'Connectors',
  'Troubleshooting',
] as const;

export type BuiltInPromptCategory = typeof DEFAULT_PROMPT_CATEGORIES[number];
export type PromptCategory = string;

export const PROMPT_CATEGORIES: PromptCategory[] = [...DEFAULT_PROMPT_CATEGORIES];

export const DEFAULT_PROMPT_CATEGORY: BuiltInPromptCategory = 'Build';

export function normalizePromptCategoryName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export function isPromptCategory(value: unknown): value is PromptCategory {
  return normalizePromptCategoryName(value).length > 0;
}

export function normalizePromptCategory(
  value: unknown,
  fallback: PromptCategory = DEFAULT_PROMPT_CATEGORY
): PromptCategory {
  const normalized = normalizePromptCategoryName(value);
  return normalized || normalizePromptCategoryName(fallback) || DEFAULT_PROMPT_CATEGORY;
}

export function mergePromptCategories(...groups: Array<readonly unknown[] | null | undefined>): PromptCategory[] {
  const seen = new Set<string>();
  const merged: PromptCategory[] = [];
  const add = (value: unknown) => {
    const normalized = normalizePromptCategory(value);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  };

  DEFAULT_PROMPT_CATEGORIES.forEach(add);
  for (const group of groups) {
    for (const value of group || []) {
      add(value);
    }
  }
  return merged;
}
