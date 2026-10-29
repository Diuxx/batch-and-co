/** Calculs métier : aucune dépendance au DOM, au stockage ou à Eleventy. */
export function calculateRecipeTotals(items, ingredients) {
  const byId = new Map(ingredients.map(item => [item.id, item]));
  return items.reduce((totals, item) => {
    const ingredient = byId.get(item.ingredientId);
    if (!ingredient) return totals;
    totals.kcal += ingredient.kcal * item.grams / 100;
    totals.cost += ingredient.price * item.grams / 1000;
    return totals;
  }, { kcal: 0, cost: 0 });
}

/** Regroupe toutes les matières premières de la semaine sans doubler les produits. */
export function buildShoppingList(slots, recipes, ingredients, groups) {
  const recipesById = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const ingredientsById = new Map(ingredients.map(ingredient => [ingredient.id, ingredient]));
  const quantities = new Map();

  for (const slot of Object.values(slots)) {
    const recipe = recipesById.get(slot.recipeId);
    if (!recipe) continue;
    for (const item of recipe.items) {
      quantities.set(item.ingredientId, (quantities.get(item.ingredientId) ?? 0) + item.grams * slot.servings);
    }
  }

  return [...quantities.entries()]
    .map(([id, grams]) => ({ ingredient: ingredientsById.get(id), grams }))
    .filter(row => row.ingredient)
    .sort((left, right) =>
      groups.indexOf(left.ingredient.group) - groups.indexOf(right.ingredient.group) ||
      left.ingredient.name.localeCompare(right.ingredient.name, "fr")
    );
}
