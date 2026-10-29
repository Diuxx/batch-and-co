import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecipeTotals, buildShoppingList } from '../src/assets/js/domain.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const catalog = require('../src/_data/catalog.js')();

test('toutes les recettes ont des ingrédients existants et un coût calculable', () => {
  for (const recipe of catalog.recipes) {
    const result = calculateRecipeTotals(recipe.items, catalog.ingredients);
    assert.ok(result.kcal > 0, recipe.id);
    assert.ok(result.cost > 0, recipe.id);
  }
});

test('le coût change directement avec le fichier de prix', () => {
  const items = [{ ingredientId: 'riz', grams: 100 }];
  const ingredients = [{ id: 'riz', price: 2, kcal: 360 }];
  assert.deepEqual(calculateRecipeTotals(items, ingredients), { kcal: 360, cost: 0.2 });
  ingredients[0].price = 3;
  assert.deepEqual(calculateRecipeTotals(items, ingredients), { kcal: 360, cost: 0.3 });
});

test('une collation et un repas de deux portions alimentent les courses', () => {
  const slots = { lunch: { recipeId: 'riz', servings: 2 }, snack: { recipeId: 'avoine', servings: 1 } };
  const recipes = [
    { id: 'riz', items: [{ ingredientId: 'riz', grams: 80 }] },
    { id: 'avoine', items: [{ ingredientId: 'riz', grams: 20 }, { ingredientId: 'lait', grams: 150 }] }
  ];
  const ingredients = [
    { id: 'riz', name: 'Riz', group: 'Féculents & céréales', price: 2, kcal: 360 },
    { id: 'lait', name: 'Lait', group: 'Frais & œufs', price: 1, kcal: 47 }
  ];
  const courses = buildShoppingList(slots, recipes, ingredients, ['Féculents & céréales', 'Frais & œufs']);
  assert.equal(courses.find(item => item.ingredient.id === 'riz').grams, 180);
  assert.equal(courses.find(item => item.ingredient.id === 'lait').grams, 150);
});

test('les prix relevés fournissent une source et un conditionnement', () => {
  for (const item of Object.values(catalog.pricing.items)) {
    if (item.status !== 'verified') continue;
    assert.ok(item.url?.startsWith('https://'));
    assert.ok(item.pack);
    assert.ok(item.packagePrice > 0);
  }
});
