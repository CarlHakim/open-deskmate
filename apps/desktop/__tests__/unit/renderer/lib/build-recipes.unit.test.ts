import { describe, expect, test } from 'vitest';
import { BUILD_RECIPE_CATEGORIES, BUILD_RECIPES } from '@/lib/build-recipes';

describe('build recipe catalog', () => {
  test('has at least one recipe in each public category', () => {
    for (const category of BUILD_RECIPE_CATEGORIES) {
      expect(BUILD_RECIPES.some((recipe) => recipe.category === category)).toBe(true);
    }
  });

  test('recipes have insertable prompt content', () => {
    for (const recipe of BUILD_RECIPES) {
      expect(recipe.id.trim()).toBeTruthy();
      expect(recipe.title.trim()).toBeTruthy();
      expect(recipe.description.trim()).toBeTruthy();
      expect(recipe.prompt.trim().length).toBeGreaterThan(40);
      expect(recipe.tags.length).toBeGreaterThan(0);
    }
  });
});
