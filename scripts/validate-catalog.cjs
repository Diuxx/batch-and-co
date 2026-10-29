const catalog = require("../src/_data/catalog.js")();
const prices = Object.values(catalog.pricing.items);
console.log(`${catalog.ingredients.length} ingrédients, ${catalog.recipes.length} plats et ${prices.filter(item => item.status === "verified").length} prix relevés validés.`);
