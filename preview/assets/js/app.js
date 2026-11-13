import { initIdentity } from './identity/controller.mjs';
import { calculateRecipeTotals, buildShoppingList } from "./domain.mjs";
/* Batch & Co — Interface et contrôleurs ; prix et recettes fournis au build Eleventy. */
(() => {
    'use strict';
    const STORAGE_KEY = 'batch-and-co.v1';
    const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const MEALS = [
        { key: 'lunch', label: 'Déjeuner', time: '12:30' },
        { key: 'dinner', label: 'Dîner', time: '19:30' }
    ];
    const EXTRA_PRESETS = [
        { key: 'breakfast', label: 'Petit-déjeuner', time: '08:00' },
        { key: 'morning', label: 'Collation du matin', time: '10:30' },
        { key: 'afternoon', label: 'Collation de l’après-midi', time: '16:00' },
        { key: 'evening', label: 'Collation du soir', time: '21:00' },
        { key: 'other', label: 'Repas libre', time: '18:00' }
    ];
    const GROUPS = ['Fruits & légumes', 'Viandes & poissons', 'Féculents & céréales', 'Légumineuses', 'Frais & œufs', 'Épicerie'];
    // Eleventy fournit le catalogue au build. Aucune requête réseau au runtime.
    const catalog = JSON.parse(document.getElementById('catalog-seed').textContent);
    const SEED_INGREDIENTS = catalog.ingredients;
    const SEED_RECIPES = catalog.recipes;
    const pricing = catalog.pricing;
    const seedSlots = {
        '0-lunch': { recipeId: 'poulet-riz', servings: 1 }, '0-dinner': { recipeId: 'curry-lentilles', servings: 1 },
        '1-lunch': { recipeId: 'poulet-riz', servings: 1 }, '1-dinner': { recipeId: 'chili', servings: 1 },
        '2-lunch': { recipeId: 'bolo', servings: 1 }, '2-dinner': { recipeId: 'chili', servings: 1 },
        '3-lunch': { recipeId: 'bolo', servings: 1 }, '4-lunch': { recipeId: 'saumon', servings: 1 },
        '5-dinner': { recipeId: 'omelette', servings: 1 },
        '0-extra-demo-afternoon': { recipeId: 'snack-yaourt-banane', servings: 1, label: 'Collation de l’après-midi', time: '16:00' },
        '2-extra-demo-morning': { recipeId: 'snack-pomme-cacahuete', servings: 1, label: 'Collation du matin', time: '10:30' }
    };
    const $ = id => document.getElementById(id);
    const html = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const euros = n => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const num = n => Math.round(n).toLocaleString('fr-FR');
    const dateISO = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const fromISO = value => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12); };
    const offsetDate = (date, days) => { const out = new Date(date); out.setDate(out.getDate() + days); return out; };
    const monday = date => offsetDate(date, -((date.getDay() + 6) % 7));
    const upcomingWeek = () => { const d = new Date(); return monday(offsetDate(d, d.getDay() >= 5 ? 7 : 0)); };
    let activeWeek = dateISO(upcomingWeek());
    const defaultState = () => ({ schemaVersion: 3, priceOverrides: {}, deletedSeedRecipeIds: [], ingredients: structuredClone(SEED_INGREDIENTS), recipes: structuredClone(SEED_RECIPES), plans: { [activeWeek]: structuredClone(seedSlots) }, stock: {}, budget: 50 });
    let state;
    let identityController;
    let chosenSlot = '3-dinner';
    let recipeFilter = 'Tous';
    let editorId = null;
    let editorItems = [];
    let catalogEditId = null;
    let editingExtraKey = null;
    let addingToDay = null;
    let toastTimer;
    const createId = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    function toast(message) { const e = $('toast'); e.textContent = message; e.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('visible'), 2800); }
    function validateData(data) {
        if (!data || ![1, 2, 3].includes(data.schemaVersion) ||
            !Array.isArray(data.ingredients) || !Array.isArray(data.recipes) ||
            !data.plans || typeof data.plans !== 'object' || Array.isArray(data.plans)) {
            throw new Error('Structure de sauvegarde incompatible.');
        }
        if (data.ingredients.length > 1500 || data.recipes.length > 1000 || Object.keys(data.plans).length > 1000) {
            throw new Error('Sauvegarde trop volumineuse.');
        }
        const validWord = value => typeof value === 'string' && value.trim().length > 0 && value.length < 140;
        if (!data.ingredients.every(item => validWord(item.id) && validWord(item.name) &&
            GROUPS.includes(item.group) && Number.isFinite(item.kcal) && item.kcal >= 0 && item.kcal <= 1000 &&
            Number.isFinite(item.price) && item.price >= 0 && item.price <= 1000)) {
            throw new Error('Un ingrédient est invalide.');
        }
        const ingredientIds = new Set(data.ingredients.map(item => item.id));
        if (ingredientIds.size !== data.ingredients.length)
            throw new Error('Identifiants d’ingrédients dupliqués.');
        if (!data.recipes.every(recipe => validWord(recipe.id) && validWord(recipe.name) &&
            Array.isArray(recipe.items) && recipe.items.length <= 80 && recipe.items.every(item => ingredientIds.has(item.ingredientId) && Number.isFinite(item.grams) && item.grams > 0 && item.grams <= 100000))) {
            throw new Error('Une recette est invalide.');
        }
        const recipes = data.recipes.map(recipe => ({
            id: recipe.id, name: recipe.name,
            emoji: typeof recipe.emoji === 'string' ? recipe.emoji.slice(0, 10) : '🍽️',
            category: ['Protéiné', 'Végétarien', 'Rapide', 'Collation'].includes(recipe.category) ? recipe.category : 'Rapide',
            batch: Boolean(recipe.batch),
            items: recipe.items.map(item => ({ ingredientId: item.ingredientId, grams: item.grams }))
        }));
        const recipeIds = new Set(recipes.map(recipe => recipe.id));
        if (recipeIds.size !== recipes.length)
            throw new Error('Identifiants de recettes dupliqués.');
        // Migration non destructive : les sauvegardes v1 conservées dans le navigateur
        // peuvent accueillir les nouvelles collations sans perdre les plats personnalisés.
        if (data.schemaVersion === 1) {
            for (const recipe of SEED_RECIPES.filter(item => item.category === 'Collation')) {
                if (!recipeIds.has(recipe.id) && recipe.items.every(item => ingredientIds.has(item.ingredientId))) {
                    recipes.push(structuredClone(recipe));
                    recipeIds.add(recipe.id);
                }
            }
        }
        const plans = {};
        for (const [week, slots] of Object.entries(data.plans)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !slots || typeof slots !== 'object' || Array.isArray(slots) || Object.keys(slots).length > 125) {
                throw new Error('Une semaine est invalide.');
            }
            const cleanSlots = {};
            for (const [key, slot] of Object.entries(slots)) {
                const isExtra = /^[0-6]-extra-[a-zA-Z0-9-]{1,70}$/.test(key);
                const isBase = /^[0-6]-(lunch|dinner)$/.test(key);
                if ((!isExtra && !isBase) || !slot ||
                    !Number.isInteger(slot.servings) || slot.servings < 1 || slot.servings > 20 ||
                    (slot.recipeId !== null && !recipeIds.has(slot.recipeId)) ||
                    (isBase && slot.recipeId === null)) {
                    throw new Error('Un repas planifié est invalide.');
                }
                if (isExtra) {
                    if (!validWord(slot.label) || slot.label.length > 70 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)) {
                        throw new Error('Un créneau personnalisé est invalide.');
                    }
                    cleanSlots[key] = { recipeId: slot.recipeId, servings: slot.servings, label: slot.label.trim(), time: slot.time };
                }
                else {
                    cleanSlots[key] = { recipeId: slot.recipeId, servings: slot.servings };
                }
            }
            plans[week] = cleanSlots;
        }
        if (!Number.isFinite(data.budget) || data.budget < 1 || data.budget > 10000)
            throw new Error('Budget invalide.');
        return {
            schemaVersion: 3,
            priceOverrides: (data.schemaVersion === 3 && data.priceOverrides && typeof data.priceOverrides === 'object' && !Array.isArray(data.priceOverrides))
                ? Object.fromEntries(Object.entries(data.priceOverrides).filter(([id, price]) => ingredientIds.has(id) && Number.isFinite(price) && price >= 0 && price <= 1000))
                : Object.fromEntries(data.ingredients.filter(i => SEED_INGREDIENTS.some(base => base.id === i.id)).map(i => [i.id, i.price])),
            deletedSeedRecipeIds: Array.isArray(data.deletedSeedRecipeIds)
                ? data.deletedSeedRecipeIds.filter(id => typeof id === 'string' && id.length < 140).slice(0, 1000) : [],
            ingredients: data.ingredients.map(item => ({ id: item.id, name: item.name, kcal: item.kcal, price: item.price, group: item.group })),
            recipes, plans,
            stock: data.stock && typeof data.stock === 'object' && !Array.isArray(data.stock) ? data.stock : {},
            budget: data.budget
        };
    }
    // Fusion à chaque ouverture : nouveaux produits, recettes et prix de data/prices.json.
    // Une modification manuelle de prix garde la priorité sur le catalogue du build.
    function hydrateCatalog(data) {
        const baseById = new Map(SEED_INGREDIENTS.map(ingredient => [ingredient.id, ingredient]));
        const known = new Set(data.ingredients.map(ingredient => ingredient.id));
        for (const ingredient of data.ingredients) {
            const base = baseById.get(ingredient.id);
            if (base)
                ingredient.price = data.priceOverrides[ingredient.id] ?? base.price;
        }
        for (const seed of SEED_INGREDIENTS) {
            if (!known.has(seed.id))
                data.ingredients.push(structuredClone(seed));
        }
        const knownRecipes = new Set(data.recipes.map(recipe => recipe.id));
        for (const recipe of SEED_RECIPES) {
            if (!knownRecipes.has(recipe.id) && !data.deletedSeedRecipeIds.includes(recipe.id))
                data.recipes.push(structuredClone(recipe));
        }
        return data;
    }
    function save() { try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        $('save-status').textContent = '✓ Enregistré localement';
        identityController?.markLocalModified();
    }
    catch {
        $('save-status').textContent = '⚠ Stockage local indisponible';
    } }
    function load() { try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw)
            return hydrateCatalog(validateData(JSON.parse(raw)));
    }
    catch {
        toast('Sauvegarde illisible : exemple initial chargé.');
    } return defaultState(); }
    const getIngredient = id => state.ingredients.find(i => i.id === id);
    const getRecipe = id => state.recipes.find(r => r.id === id);
    const plan = () => state.plans[activeWeek] || {};
    const totals = items => calculateRecipeTotals(items, state.ingredients);
    function weekLabel() { const d = fromISO(activeWeek), e = offsetDate(d, 6); const format = x => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); return `${format(d)} — ${format(e)}`; }
    function render() { renderStats(); renderWeek(); renderRecipes(); renderShopping(); $('budget').value = state.budget; }
    function renderStats() { let kcal = 0, cost = 0, meals = 0; const distinct = new Set(); for (const slot of Object.values(plan())) {
        const recipe = getRecipe(slot.recipeId);
        if (!recipe)
            continue;
        const t = totals(recipe.items);
        kcal += t.kcal * slot.servings;
        cost += t.cost * slot.servings;
        meals++;
        distinct.add(recipe.id);
    } $('total-cost').textContent = euros(cost); $('total-kcal').textContent = num(kcal); $('total-meals').textContent = meals; $('unique-recipes').textContent = distinct.size; $('budget-fill').style.width = Math.min(cost / state.budget * 100, 100) + '%'; $('budget-progress').classList.toggle('over', cost > state.budget); $('week-range').textContent = weekLabel(); }
    function dailyMealEntries(dayIndex) {
        const regular = MEALS.map(meal => ({
            key: `${dayIndex}-${meal.key}`,
            label: meal.label,
            time: meal.time,
            extra: false,
            slot: plan()[`${dayIndex}-${meal.key}`]
        }));
        const extras = Object.entries(plan())
            .filter(([key]) => key.startsWith(`${dayIndex}-extra-`))
            .map(([key, slot]) => ({ key, label: slot.label, time: slot.time, extra: true, slot }));
        return [...regular, ...extras].sort((a, b) => a.time.localeCompare(b.time) || a.key.localeCompare(b.key));
    }
    function mealLabel(key) {
        const saved = plan()[key];
        if (saved?.label)
            return saved.label;
        return MEALS.find(meal => key.endsWith('-' + meal.key))?.label || 'Repas';
    }
    function renderMealSlot(entry) {
        const { key, slot, label, time, extra } = entry;
        const recipe = slot ? getRecipe(slot.recipeId) : null;
        const sum = recipe ? totals(recipe.items) : null;
        return `<div class="slot ${chosenSlot === key ? 'active' : ''} ${recipe ? '' : 'empty'}" data-slot="${html(key)}" role="button" tabindex="0" aria-label="${html(label)} : ${html(recipe?.name || 'choisir un plat')}">
        <span class="meal-icon">${recipe ? html(recipe.emoji) : extra ? '◌' : '＋'}</span>
        <div class="slot-text">
          <div class="slot-label">${html(time)} · ${html(label)}</div>
          <div class="slot-name">${recipe ? html(recipe.name) : '+ Choisir un plat'}</div>
          ${sum ? `<div class="slot-sub">${num(sum.kcal * slot.servings)} kcal · ${euros(sum.cost * slot.servings)}</div>` : ''}
        </div>
        ${extra ? `<button class="slot-edit" type="button" data-edit-meal="${html(key)}" title="Modifier le créneau" aria-label="Modifier ${html(label)}">✎</button>` : ''}
        ${recipe ? `<button class="serving-btn" type="button" data-servings="${html(key)}" title="Changer les portions" aria-label="Portions ${slot.servings}">×${slot.servings}</button>` : ''}
        ${(extra || recipe) ? `<button class="slot-remove" type="button" data-remove="${html(key)}" title="${extra ? 'Supprimer ce créneau' : 'Retirer le plat'}" aria-label="${extra ? 'Supprimer ce créneau' : 'Retirer le plat'}">×</button>` : ''}
      </div>`;
    }
    function renderWeek() {
        const start = fromISO(activeWeek);
        const today = dateISO(new Date());
        $('week-grid').innerHTML = DAYS.map((day, index) => {
            const date = offsetDate(start, index);
            const entries = dailyMealEntries(index);
            const totalsForDay = entries.reduce((sum, { slot }) => {
                const recipe = slot ? getRecipe(slot.recipeId) : null;
                if (recipe) {
                    const values = totals(recipe.items);
                    sum.kcal += values.kcal * slot.servings;
                    sum.cost += values.cost * slot.servings;
                }
                return sum;
            }, { kcal: 0, cost: 0 });
            const dailyTotal = totalsForDay.kcal
                ? `${num(totalsForDay.kcal)} kcal <span class="day-cost">· ${euros(totalsForDay.cost)}</span>`
                : 'À composer';
            return `<article class="day-card ${dateISO(date) === today ? 'today' : ''}">
          <div class="day-card-head"><div class="day-title"><span class="day-name">${day}</span><span class="day-number">${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span></div><span class="day-total">${dailyTotal}</span></div>
          ${entries.map(renderMealSlot).join('')}
          <button class="day-add" type="button" data-add-meal="${index}">＋ Ajouter un repas ou une collation</button>
        </article>`;
        }).join('');
    }
    function renderRecipes() {
        const q = $('recipe-search').value.trim().toLocaleLowerCase('fr');
        const recipes = state.recipes.filter(r => (recipeFilter === 'Tous' || r.category === recipeFilter) && r.name.toLocaleLowerCase('fr').includes(q));
        $('recipe-list').innerHTML = recipes.length ? recipes.map(recipe => { const t = totals(recipe.items); return `<div class="recipe-item" data-recipe="${html(recipe.id)}" role="button" tabindex="0"><span class="recipe-emoji">${html(recipe.emoji)}</span><div class="recipe-main"><div class="recipe-name">${html(recipe.name)}</div><div class="recipe-details">${num(t.kcal)} kcal · ${euros(t.cost)} ${recipe.batch ? '· Batch' : ''}</div></div><button class="recipe-edit" type="button" data-edit-recipe="${html(recipe.id)}" aria-label="Modifier ${html(recipe.name)}">✎</button></div>`; }).join('') : '<div class="empty-list">Aucun plat correspondant.<br>Crée ta propre recette !</div>';
        const day = Number(chosenSlot.split('-')[0]);
        $('selected-target').textContent = `Créneau ciblé : ${DAYS[day]} · ${mealLabel(chosenSlot)} — clique sur un plat ci-dessous.`;
        $('recipe-filters').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.filter === recipeFilter));
    }
    function gatherShopping() {
        return buildShoppingList(plan(), state.recipes, state.ingredients, GROUPS);
    }
    function renderShopping() { const items = gatherShopping(); $('ingredient-count').textContent = `${items.length} article${items.length > 1 ? 's' : ''}`; $('shopping-total').textContent = euros(items.reduce((sum, item) => sum + item.grams / 1000 * item.ingredient.price, 0)); if (!items.length) {
        $('shopping-list').innerHTML = '<div class="empty-list">Ajoute un premier plat pour générer automatiquement tes courses.</div>';
        return;
    } let group = ''; $('shopping-list').innerHTML = items.map(({ ingredient, grams }) => { const newHeading = group !== ingredient.group ? (group = ingredient.group, `<div class="group-heading">${html(group)}</div>`) : ''; const checked = Boolean(state.stock[ingredient.id]); return newHeading + `<div class="course-line"><input type="checkbox" id="stock-${html(ingredient.id)}" data-stock="${html(ingredient.id)}" ${checked ? 'checked' : ''}><label for="stock-${html(ingredient.id)}" class="${checked ? 'done' : ''}">${html(ingredient.name)}<span class="quantity">${grams >= 1000 ? (grams / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kg' : num(grams) + ' g'}</span></label><strong>${euros(grams / 1000 * ingredient.price)}</strong></div>`; }).join(''); }
    function chooseRecipe(recipeId) { if (!getRecipe(recipeId))
        return; state.plans[activeWeek] ??= {}; state.plans[activeWeek][chosenSlot] = { ...state.plans[activeWeek][chosenSlot], recipeId, servings: 1 }; save(); render(); toast('Plat ajouté au planning.'); }
    function changeWeek(days) { activeWeek = dateISO(offsetDate(fromISO(activeWeek), days)); chosenSlot = '0-lunch'; render(); }
    function openMealEditor(dayIndex, existingKey = null) {
        const previous = existingKey ? plan()[existingKey] : null;
        if (existingKey && !previous)
            return;
        addingToDay = dayIndex;
        editingExtraKey = existingKey;
        $('meal-dialog-title').textContent = previous ? 'Modifier la prise alimentaire' : 'Ajouter une prise alimentaire';
        $('meal-day').textContent = DAYS[dayIndex] + ' · ' + weekLabel();
        $('meal-preset').value = previous ? (EXTRA_PRESETS.find(item => item.label === previous.label && item.time === previous.time)?.key || 'other') : 'afternoon';
        $('meal-name').value = previous?.label || EXTRA_PRESETS[2].label;
        $('meal-time').value = previous?.time || EXTRA_PRESETS[2].time;
        $('meal-dialog').showModal();
    }
    $('week-grid').addEventListener('click', event => {
        const add = event.target.closest('[data-add-meal]');
        if (add) {
            const dayIndex = Number(add.dataset.addMeal);
            if (dailyMealEntries(dayIndex).length >= 18) {
                toast('Maximum de 16 créneaux supplémentaires par jour.');
                return;
            }
            openMealEditor(dayIndex);
            return;
        }
        const edit = event.target.closest('[data-edit-meal]');
        if (edit) {
            openMealEditor(Number(edit.dataset.editMeal.split('-')[0]), edit.dataset.editMeal);
            return;
        }
        const remove = event.target.closest('[data-remove]');
        if (remove) {
            delete state.plans[activeWeek][remove.dataset.remove];
            if (chosenSlot === remove.dataset.remove)
                chosenSlot = `${remove.dataset.remove.split('-')[0]}-lunch`;
            save();
            render();
            return;
        }
        const portions = event.target.closest('[data-servings]');
        if (portions) {
            const slot = plan()[portions.dataset.servings];
            if (!slot)
                return;
            const answer = prompt('Nombre de portions pour ce repas (1 à 20) :', slot.servings);
            if (answer === null)
                return;
            const quantity = Number(answer);
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
                toast('Choisis entre 1 et 20 portions.');
                return;
            }
            slot.servings = quantity;
            save();
            render();
            return;
        }
        const target = event.target.closest('[data-slot]');
        if (target) {
            chosenSlot = target.dataset.slot;
            renderWeek();
            renderRecipes();
            focusRecipePicker();
        }
    });
    function focusRecipePicker() {
        if (window.matchMedia('(max-width:1050px)').matches) {
            $('selected-target').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    $('meal-preset').addEventListener('change', event => {
        const preset = EXTRA_PRESETS.find(item => item.key === event.target.value);
        if (!preset)
            return;
        $('meal-name').value = preset.label;
        $('meal-time').value = preset.time;
    });
    $('save-meal').addEventListener('click', () => {
        const label = $('meal-name').value.trim();
        const time = $('meal-time').value;
        if (!label || label.length > 70 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            toast('Renseigne un nom (70 caractères max.) et une heure valide.');
            return;
        }
        state.plans[activeWeek] ??= {};
        const key = editingExtraKey || `${addingToDay}-extra-${createId('meal')}`;
        const current = state.plans[activeWeek][key];
        state.plans[activeWeek][key] = {
            recipeId: current?.recipeId || null,
            servings: current?.servings || 1,
            label, time
        };
        chosenSlot = key;
        $('meal-dialog').close();
        save();
        render();
        if (!editingExtraKey)
            focusRecipePicker();
        toast(editingExtraKey ? 'Créneau mis à jour.' : 'Créneau ajouté : choisis un plat à droite.');
    });
    $('week-grid').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.hasAttribute('data-slot')) {
        e.preventDefault();
        e.target.click();
    } });
    $('recipe-list').addEventListener('click', e => { const edit = e.target.closest('[data-edit-recipe]'); if (edit) {
        openRecipeEditor(edit.dataset.editRecipe);
        return;
    } const item = e.target.closest('[data-recipe]'); if (item)
        chooseRecipe(item.dataset.recipe); });
    $('recipe-list').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.hasAttribute('data-recipe')) {
        e.preventDefault();
        e.target.click();
    } });
    $('recipe-search').addEventListener('input', renderRecipes);
    $('recipe-filters').addEventListener('click', e => { const button = e.target.closest('[data-filter]'); if (!button)
        return; recipeFilter = button.dataset.filter; renderRecipes(); });
    $('shopping-list').addEventListener('change', e => { if (e.target.matches('[data-stock]')) {
        state.stock[e.target.dataset.stock] = e.target.checked;
        save();
        renderShopping();
    } });
    $('prev-week').addEventListener('click', () => changeWeek(-7));
    $('next-week').addEventListener('click', () => changeWeek(7));
    $('current-week').addEventListener('click', () => { activeWeek = dateISO(upcomingWeek()); render(); });
    $('budget').addEventListener('change', e => { const n = Number(e.target.value); if (n >= 1 && n <= 10000) {
        state.budget = n;
        save();
    }
    else
        toast('Budget attendu entre 1 € et 10 000 €.'); renderStats(); $('budget').value = state.budget; });
    $('clear-week').addEventListener('click', () => { if (Object.keys(plan()).length === 0)
        return; if (confirm('Effacer tous les repas de cette semaine ?')) {
        state.plans[activeWeek] = {};
        save();
        render();
        toast('Semaine vidée.');
    } });
    function renderEditorItems() { const options = state.ingredients.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(i => `<option value="${html(i.id)}">${html(i.name)}</option>`).join(''); $('recipe-ingredient-rows').innerHTML = editorItems.map((item, index) => `<div class="ingredient-row"><select data-item-index="${index}" data-editor-field="ingredientId" aria-label="Ingrédient ${index + 1}">${options}</select><input type="number" min="1" max="100000" step="1" data-item-index="${index}" data-editor-field="grams" value="${item.grams}" aria-label="Grammes de l'ingrédient ${index + 1}"><button type="button" data-delete-item="${index}" aria-label="Retirer l'ingrédient">×</button></div>`).join(''); $('recipe-ingredient-rows').querySelectorAll('select').forEach(el => { el.value = editorItems[Number(el.dataset.itemIndex)].ingredientId; }); updateEditorTotals(); }
    function updateEditorTotals() { const t = totals(editorItems.filter(i => i.grams > 0)); $('recipe-summary').innerHTML = `<span>${num(t.kcal)} kcal / portion</span><span>${euros(t.cost)} / portion</span>`; }
    function openRecipeEditor(id) { const recipe = id ? getRecipe(id) : null; editorId = recipe?.id || null; editorItems = recipe ? structuredClone(recipe.items) : [{ ingredientId: state.ingredients[0]?.id, grams: 100 }]; $('recipe-dialog-title').textContent = recipe ? 'Modifier le plat' : 'Créer un plat'; $('recipe-name').value = recipe?.name || ''; $('recipe-category').value = recipe?.category || 'Protéiné'; $('recipe-emoji').value = recipe?.emoji || '🍲'; $('recipe-batch').value = String(recipe?.batch ?? true); $('delete-recipe').hidden = !recipe; renderEditorItems(); $('recipe-dialog').showModal(); }
    $('new-recipe').addEventListener('click', () => openRecipeEditor());
    $('add-recipe-ingredient').addEventListener('click', () => { if (!state.ingredients.length) {
        toast('Ajoute un ingrédient au catalogue.');
        return;
    } editorItems.push({ ingredientId: state.ingredients[0].id, grams: 100 }); renderEditorItems(); });
    $('recipe-ingredient-rows').addEventListener('input', e => { const el = e.target.closest('[data-editor-field]'); if (!el)
        return; const item = editorItems[Number(el.dataset.itemIndex)]; item[el.dataset.editorField] = el.dataset.editorField === 'grams' ? Number(el.value) : el.value; updateEditorTotals(); });
    $('recipe-ingredient-rows').addEventListener('change', e => { const el = e.target.closest('[data-editor-field]'); if (el)
        editorItems[Number(el.dataset.itemIndex)][el.dataset.editorField] = el.dataset.editorField === 'grams' ? Number(el.value) : el.value; updateEditorTotals(); });
    $('recipe-ingredient-rows').addEventListener('click', e => { const button = e.target.closest('[data-delete-item]'); if (!button)
        return; editorItems.splice(Number(button.dataset.deleteItem), 1); renderEditorItems(); });
    $('save-recipe').addEventListener('click', () => { const name = $('recipe-name').value.trim(); if (!name) {
        toast('Le nom du plat est obligatoire.');
        return;
    } if (!editorItems.length || editorItems.some(i => !getIngredient(i.ingredientId) || !Number.isFinite(i.grams) || i.grams <= 0 || i.grams > 100000)) {
        toast('Ajoute au moins un ingrédient avec une quantité valide.');
        return;
    } const recipe = { id: editorId || createId('plat'), name, category: $('recipe-category').value, emoji: $('recipe-emoji').value.trim() || '🍲', batch: $('recipe-batch').value === 'true', items: structuredClone(editorItems) }; const index = state.recipes.findIndex(r => r.id === recipe.id); if (index >= 0)
        state.recipes[index] = recipe;
    else
        state.recipes.push(recipe); $('recipe-dialog').close(); save(); render(); toast(editorId ? 'Plat mis à jour.' : 'Nouveau plat créé.'); });
    $('delete-recipe').addEventListener('click', () => { if (!editorId || !confirm('Supprimer ce plat du catalogue et de tous les plannings ?'))
        return; if (SEED_RECIPES.some(r => r.id === editorId))
        state.deletedSeedRecipeIds.push(editorId); state.recipes = state.recipes.filter(r => r.id !== editorId); for (const slots of Object.values(state.plans)) {
        for (const [key, slot] of Object.entries(slots)) {
            if (slot.recipeId !== editorId)
                continue;
            if (key.includes('-extra-')) {
                slot.recipeId = null;
                slot.servings = 1;
            }
            else
                delete slots[key];
        }
    } $('recipe-dialog').close(); save(); render(); toast('Plat supprimé.'); });
    function resetIngredientForm() { catalogEditId = null; $('ingredient-form-title').textContent = 'Nouvel ingrédient'; $('ingredient-name').value = ''; $('ingredient-kcal').value = ''; $('ingredient-price').value = ''; $('ingredient-group').value = GROUPS[0]; }
    function renderIngredients() { const q = $('ingredient-search').value.toLocaleLowerCase('fr').trim(); const items = state.ingredients.filter(i => i.name.toLocaleLowerCase('fr').includes(q)); $('ingredient-catalog').innerHTML = items.length ? items.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(i => `<div class="ingredient-catalog-row"><div class="label"><strong>${html(i.name)}</strong><div class="secondary">${html(i.group)} · ${i.kcal} kcal/100 g · ${euros(i.price)}/kg</div><div class="price-source ${pricing.items[i.id]?.status === 'verified' ? '' : 'estimate'}">${state.priceOverrides[i.id] !== undefined ? 'Prix personnalisé' : pricing.items[i.id]?.status === 'verified' ? 'Prix relevé · ' + html(pricing.items[i.id].retailer) : 'Prix estimé'}${pricing.items[i.id]?.status === 'verified' && pricing.items[i.id]?.url ? ` · <a class="price-link" href="${html(pricing.items[i.id].url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</div></div><button type="button" data-edit-ingredient="${html(i.id)}">Modifier</button></div>`).join('') : '<div class="empty-list">Aucun ingrédient trouvé.</div>'; }
    $('reset-prices').addEventListener('click', () => {
        if (!confirm('Remplacer tous les prix personnalisés des produits du catalogue par ceux du dernier build ?'))
            return;
        state.priceOverrides = {};
        hydrateCatalog(state);
        save();
        render();
        renderIngredients();
        toast('Prix du catalogue restaurés.');
    });
    $('btn-catalog').addEventListener('click', () => { $('ingredient-search').value = ''; resetIngredientForm(); renderIngredients(); $('ingredient-dialog').showModal(); });
    $('ingredient-search').addEventListener('input', renderIngredients);
    $('ingredient-catalog').addEventListener('click', e => { const button = e.target.closest('[data-edit-ingredient]'); if (!button)
        return; const i = getIngredient(button.dataset.editIngredient); if (!i)
        return; catalogEditId = i.id; $('ingredient-form-title').textContent = 'Modifier l’ingrédient'; $('ingredient-name').value = i.name; $('ingredient-kcal').value = i.kcal; $('ingredient-price').value = i.price; $('ingredient-group').value = i.group; });
    $('reset-ingredient').addEventListener('click', resetIngredientForm);
    $('save-ingredient').addEventListener('click', () => {
        const name = $('ingredient-name').value.trim(), kcal = Number($('ingredient-kcal').value), price = Number($('ingredient-price').value);
        if (!name || !$('ingredient-kcal').value || !$('ingredient-price').value || !Number.isFinite(kcal) || !Number.isFinite(price) || kcal < 0 || kcal > 1000 || price < 0 || price > 1000) {
            toast('Renseigne nom, kcal et prix valides.');
            return;
        }
        const ingredient = { id: catalogEditId || createId('ing'), name, kcal, price, group: $('ingredient-group').value };
        const index = state.ingredients.findIndex(i => i.id === ingredient.id);
        if (index >= 0)
            state.ingredients[index] = ingredient;
        else
            state.ingredients.push(ingredient);
        if (SEED_INGREDIENTS.some(base => base.id === ingredient.id))
            state.priceOverrides[ingredient.id] = price;
        save();
        render();
        renderIngredients();
        resetIngredientForm();
        toast('Ingrédient enregistré.');
    });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
    $('btn-export').addEventListener('click', () => { const content = JSON.stringify(state, null, 2); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `batch-and-co-${dateISO(new Date())}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); toast('Sauvegarde JSON exportée.'); });
    $('btn-import').addEventListener('click', () => $('file-import').click());
    $('file-import').addEventListener('change', async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file)
        return; if (file.size > 3000000) {
        toast('Fichier trop volumineux (maximum 3 Mo).');
        return;
    } try {
        const incoming = hydrateCatalog(validateData(JSON.parse(await file.text())));
        if (!confirm('Remplacer tes données locales par le contenu de ce fichier ?'))
            return;
        state = incoming;
        activeWeek = Object.keys(state.plans).sort().at(-1) || dateISO(upcomingWeek());
        chosenSlot = '0-lunch';
        save();
        render();
        toast('Session importée avec succès.');
    }
    catch (error) {
        toast('Import refusé : ' + error.message);
    } });
    state = load();
    identityController = initIdentity({
        getSnapshot: () => structuredClone(state),
        applySnapshot: async snapshot => {
            // Existing validation also migrates V1/V2 and reloads build catalog prices.
            const incoming = hydrateCatalog(validateData(snapshot));
            const formerState = state;
            state = incoming;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
            catch (error) { state = formerState; throw new Error('Impossible d’enregistrer les données Drive localement.', { cause: error }); }
            activeWeek = Object.keys(state.plans).sort().at(-1) || dateISO(upcomingWeek());
            chosenSlot = '0-lunch';
            render();
        }
    });
    document.getElementById('save-status').title = 'Catalogue des prix : relevé ' + pricing.checkedAt;
    render();
})();

