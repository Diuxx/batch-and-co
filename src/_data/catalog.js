const fs = require("node:fs");
const path = require("node:path");

const dataDirectory = path.join(__dirname, "../../data");

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(dataDirectory, filename), "utf8"));
}

function buildCatalog() {
  const ingredients = readJson("ingredients.json");
  const recipes = readJson("recipes.json");
  const pricing = readJson("prices.json");

  const ingredientIds = new Set();
  for (const ingredient of ingredients) {
    if (!ingredient.id || ingredientIds.has(ingredient.id)) {
      throw new Error(`Identifiant ingrédient invalide ou dupliqué : ${ingredient.id}`);
    }
    const price = pricing.items[ingredient.id];
    if (!price || !Number.isFinite(price.eurPerKg) || price.eurPerKg < 0 || price.eurPerKg > 1000 ||
        !["verified", "estimated"].includes(price.status)) {
      throw new Error(`Prix absent ou invalide pour ${ingredient.id}`);
    }
    ingredientIds.add(ingredient.id);
    ingredient.price = price.eurPerKg;
  }
  const recipeIds = new Set();
  for (const recipe of recipes) {
    if (!recipe.id || recipeIds.has(recipe.id) || !Array.isArray(recipe.items) ||
        recipe.items.length === 0 || recipe.items.some(item =>
          !ingredientIds.has(item.ingredientId) || !Number.isFinite(item.grams) || item.grams <= 0)) {
      throw new Error(`Recette incorrecte : ${recipe.id}`);
    }
    recipeIds.add(recipe.id);
  }
  return { ingredients, recipes, pricing };
}

// Fonction plutôt que JSON importé statiquement : prise en compte des changements avant chaque build.
module.exports = buildCatalog;
