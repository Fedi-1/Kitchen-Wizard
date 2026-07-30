const MAX_INGREDIENTS = 15;
const MAX_INGREDIENT_LENGTH = 50;
const MAX_RECENT_SEARCHES = 5;
const STORAGE_KEYS = {
    favorites: "kitchen-wizard:favorites",
    recentSearches: "kitchen-wizard:recent-searches",
};

const form = document.querySelector("#recipeForm");
const input = document.querySelector("#ingredientsInput");
const addIngredientButton = document.querySelector("#addIngredientButton");
const ingredientsChips = document.querySelector("#ingredientsChips");
const submitButton = document.querySelector("#submitButton");
const showFavoritesButton = document.querySelector("#showFavoritesButton");
const recentSearchesSection = document.querySelector("#recentSearchesSection");
const recentSearchesElement = document.querySelector("#recentSearches");
const statusElement = document.querySelector("#status");
const resultsSection = document.querySelector("#resultsSection");
const resultsHeading = document.querySelector("#resultsHeading");
const resultsElement = document.querySelector("#results");
const sortSelect = document.querySelector("#sortSelect");
const maxMissingSelect = document.querySelector("#maxMissingSelect");
const recipeDialog = document.querySelector("#recipeDialog");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogCloseButton = document.querySelector("#dialogCloseButton");
const dialogStatus = document.querySelector("#dialogStatus");
const dialogContent = document.querySelector("#dialogContent");

let selectedIngredients = [];
let recentSearches = loadRecentSearches();
let searchRecipes = [];
let currentView = "search";
let activeRequestController = null;
let activeDetailsController = null;
let lastDialogTrigger = null;

const favoriteRecipes = loadFavoriteRecipes();
const recipeDetailsCache = new Map();

initializePage();

function initializePage() {
    renderIngredientChips();
    renderRecentSearches();
    updateFavoritesShortcut();
}

addIngredientButton.addEventListener("click", () => {
    commitPendingIngredients();
    input.focus();
});

input.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === ",") && input.value.trim()) {
        event.preventDefault();
        commitPendingIngredients();
    }
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!commitPendingIngredients()) {
        return;
    }

    if (selectedIngredients.length === 0) {
        clearResults();
        setStatus("Add at least one ingredient before searching.", true);
        input.focus();
        return;
    }

    await fetchRecipes([...selectedIngredients]);
});

sortSelect.addEventListener("change", () => {
    renderCurrentResults(true);
});

maxMissingSelect.addEventListener("change", () => {
    renderCurrentResults(true);
});

showFavoritesButton.addEventListener("click", () => {
    if (activeRequestController) {
        activeRequestController.abort();
        activeRequestController = null;
        setLoading(false);
    }

    currentView = "favorites";
    resultsHeading.textContent = "Saved recipes";
    resultsSection.hidden = false;
    const visibleCount = renderCurrentResults(false);

    if (favoriteRecipes.size === 0) {
        setStatus("You have not saved any recipes yet.");
    } else {
        setStatus(`Showing ${visibleCount} saved ${pluralize("recipe", visibleCount)}.`);
    }
});

dialogCloseButton.addEventListener("click", () => recipeDialog.close());

recipeDialog.addEventListener("click", (event) => {
    if (event.target === recipeDialog) {
        recipeDialog.close();
    }
});

recipeDialog.addEventListener("close", () => {
    if (activeDetailsController) {
        activeDetailsController.abort();
        activeDetailsController = null;
    }

    lastDialogTrigger?.focus();
    lastDialogTrigger = null;
});

function commitPendingIngredients() {
    const rawValue = input.value;
    if (!rawValue.trim()) {
        return true;
    }

    const candidates = rawValue
        .split(",")
        .map((item) => item.trim().replace(/\s+/g, " "))
        .filter(Boolean);

    const tooLong = candidates.find((ingredient) => ingredient.length > MAX_INGREDIENT_LENGTH);
    if (tooLong) {
        setStatus(`Each ingredient must be ${MAX_INGREDIENT_LENGTH} characters or fewer.`, true);
        return false;
    }

    const existing = new Set(selectedIngredients.map((ingredient) => ingredient.toLocaleLowerCase()));
    const additions = [];

    for (const candidate of candidates) {
        const comparisonValue = candidate.toLocaleLowerCase();
        if (!existing.has(comparisonValue)) {
            existing.add(comparisonValue);
            additions.push(candidate);
        }
    }

    if (selectedIngredients.length + additions.length > MAX_INGREDIENTS) {
        setStatus(`Add no more than ${MAX_INGREDIENTS} ingredients.`, true);
        return false;
    }

    selectedIngredients.push(...additions);
    input.value = "";
    renderIngredientChips();
    return true;
}

function renderIngredientChips() {
    const fragment = document.createDocumentFragment();

    for (const ingredient of selectedIngredients) {
        const chip = document.createElement("span");
        chip.className = "ingredient-chip";
        chip.setAttribute("role", "listitem");

        const label = document.createElement("span");
        label.textContent = ingredient;

        const removeButton = document.createElement("button");
        removeButton.className = "ingredient-chip__remove";
        removeButton.type = "button";
        removeButton.textContent = "×";
        removeButton.setAttribute("aria-label", `Remove ${ingredient}`);
        removeButton.addEventListener("click", () => {
            selectedIngredients = selectedIngredients.filter(
                (item) => item.toLocaleLowerCase() !== ingredient.toLocaleLowerCase(),
            );
            renderIngredientChips();
            input.focus();
        });

        chip.append(label, removeButton);
        fragment.append(chip);
    }

    ingredientsChips.replaceChildren(fragment);
    ingredientsChips.classList.toggle("ingredient-chips--empty", selectedIngredients.length === 0);
}

async function fetchRecipes(ingredients) {
    if (activeRequestController) {
        activeRequestController.abort();
    }

    const requestController = new AbortController();
    activeRequestController = requestController;
    currentView = "search";
    searchRecipes = [];
    saveRecentSearch(ingredients);
    setLoading(true);
    setStatus("Finding your best recipe matches...");
    resultsHeading.textContent = "Finding recipes";
    resultsSection.hidden = false;
    renderSkeletons(5);

    const searchParams = new URLSearchParams({
        ingredients: ingredients.join(","),
    });

    try {
        const response = await fetch(`/api/recipes?${searchParams}`, {
            headers: { Accept: "application/json" },
            signal: requestController.signal,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
            const message = payload?.error?.message || getFallbackErrorMessage(response.status);
            throw new ApplicationError(message);
        }

        if (!Array.isArray(payload?.recipes)) {
            throw new ApplicationError("The recipe service returned an unexpected response.");
        }

        searchRecipes = payload.recipes;
        resultsHeading.textContent = "Recipe ideas";
        const visibleCount = renderCurrentResults(false);

        if (searchRecipes.length === 0) {
            setStatus("No recipes matched those ingredients. Try a different combination.");
        } else if (visibleCount === 0) {
            setStatus("Recipes were found, but none fit your maximum-extras filter.");
        } else {
            setStatus(`Found ${visibleCount} ${pluralize("recipe", visibleCount)} for your kitchen.`);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            return;
        }

        searchRecipes = [];
        resultsHeading.textContent = "Recipe ideas";
        renderEmptyState("We could not load recipes. Please try again.");

        if (error instanceof ApplicationError) {
            setStatus(error.message, true);
        } else {
            setStatus("We could not reach the recipe service. Check your connection and try again.", true);
            console.error("Recipe request failed:", error);
        }
    } finally {
        if (activeRequestController === requestController) {
            activeRequestController = null;
            setLoading(false);
            setResultsBusy(false);
        }
    }
}

function renderCurrentResults(announce) {
    const sourceRecipes =
        currentView === "favorites" ? [...favoriteRecipes.values()] : [...searchRecipes];
    const visibleRecipes = filterAndSortRecipes(sourceRecipes);

    setResultsBusy(false);

    if (sourceRecipes.length === 0) {
        const message =
            currentView === "favorites"
                ? "Save a recipe and it will appear here."
                : "No recipes matched this search.";
        renderEmptyState(message);
    } else if (visibleRecipes.length === 0) {
        renderEmptyState("No recipes fit the selected maximum number of extra ingredients.");
    } else {
        renderRecipes(visibleRecipes);
    }

    if (announce) {
        const label = currentView === "favorites" ? "saved recipes" : "recipes";
        setStatus(`Showing ${visibleRecipes.length} ${label}.`);
    }

    return visibleRecipes.length;
}

function filterAndSortRecipes(recipes) {
    const maximumMissing =
        maxMissingSelect.value === "any" ? null : Number(maxMissingSelect.value);
    const filteredRecipes = recipes.filter((recipe) => {
        const missingCount = normalizeCount(recipe?.missedIngredientCount);
        return maximumMissing === null || missingCount <= maximumMissing;
    });

    filteredRecipes.sort((first, second) => {
        if (sortSelect.value === "missing-asc") {
            return compareMissing(first, second) || compareMatch(second, first);
        }

        if (sortSelect.value === "used-desc") {
            return (
                getMatchedIngredientCount(second) - getMatchedIngredientCount(first) ||
                compareMissing(first, second)
            );
        }

        if (sortSelect.value === "title-asc") {
            return String(first?.title).localeCompare(String(second?.title));
        }

        return compareMatch(second, first) || compareMissing(first, second);
    });

    return filteredRecipes;
}

function compareMissing(first, second) {
    return normalizeCount(first?.missedIngredientCount) - normalizeCount(second?.missedIngredientCount);
}

function compareMatch(first, second) {
    return normalizePercentage(first?.matchPercentage) - normalizePercentage(second?.matchPercentage);
}

function renderRecipes(recipes) {
    const fragment = document.createDocumentFragment();

    for (const recipe of recipes) {
        const card = createRecipeCard(recipe);
        if (card) {
            fragment.append(card);
        }
    }

    resultsElement.replaceChildren(fragment);
}

function createRecipeCard(recipe) {
    const recipeId = Number(recipe?.id);
    const recipeTitle = typeof recipe?.title === "string" ? recipe.title.trim() : "";

    if (!Number.isSafeInteger(recipeId) || recipeId < 1 || !recipeTitle) {
        return null;
    }

    const article = document.createElement("article");
    article.className = "recipe";

    const media = document.createElement("div");
    media.className = "recipe__media";

    const imageUrl = getTrustedSpoonacularUrl(recipe.image);
    if (imageUrl) {
        const image = document.createElement("img");
        image.className = "recipe__image";
        image.src = imageUrl;
        image.alt = recipeTitle;
        image.loading = "lazy";
        image.width = 636;
        image.height = 424;
        media.append(image);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "recipe__image-placeholder";
        placeholder.textContent = "Recipe image unavailable";
        media.append(placeholder);
    }

    const matchBadge = document.createElement("span");
    matchBadge.className = "recipe__match";
    matchBadge.textContent = `${getRecipeMatchPercentage(recipe)}% match`;
    media.append(matchBadge);
    article.append(media);

    const content = document.createElement("div");
    content.className = "recipe__content";

    const title = document.createElement("h3");
    title.textContent = recipeTitle;

    const usedCount = getMatchedIngredientCount(recipe);
    const requestedCount = Math.max(normalizeCount(recipe.requestedIngredientCount), 1);
    const usageBadge = document.createElement("p");
    usageBadge.className = "recipe__usage";
    usageBadge.textContent = `Uses ${usedCount} of your ${requestedCount} ${pluralize("ingredient", requestedCount)}`;

    content.append(title, usageBadge);

    content.append(
        createIngredientGroup("From your kitchen", recipe.usedIngredients, "used"),
        createIngredientGroup("Still needed", recipe.missedIngredients, "missing"),
    );

    const actions = document.createElement("div");
    actions.className = "recipe__actions";

    const favoriteButton = document.createElement("button");
    const isFavorite = favoriteRecipes.has(recipeId);
    favoriteButton.className = "button button--icon";
    favoriteButton.type = "button";
    favoriteButton.setAttribute("aria-pressed", String(isFavorite));
    favoriteButton.setAttribute(
        "aria-label",
        `${isFavorite ? "Remove" : "Save"} ${recipeTitle} ${isFavorite ? "from" : "to"} favorites`,
    );
    favoriteButton.textContent = isFavorite ? "♥ Saved" : "♡ Save";
    favoriteButton.addEventListener("click", () => toggleFavorite(recipe));

    const shareButton = document.createElement("button");
    shareButton.className = "button button--icon";
    shareButton.type = "button";
    shareButton.textContent = "Share";
    shareButton.setAttribute("aria-label", `Share ${recipeTitle}`);
    shareButton.addEventListener("click", () => shareRecipe(recipe));

    const detailsButton = document.createElement("button");
    detailsButton.className = "button button--primary recipe__view";
    detailsButton.type = "button";
    detailsButton.textContent = "View Recipe";
    detailsButton.addEventListener("click", () => {
        openRecipeDetails(recipeId, recipeTitle, detailsButton);
    });

    actions.append(favoriteButton, shareButton, detailsButton);
    content.append(actions);
    article.append(content);
    return article;
}

function createIngredientGroup(titleText, ingredients, variant) {
    const section = document.createElement("section");
    section.className = `recipe-ingredients recipe-ingredients--${variant}`;

    const heading = document.createElement("h4");
    const safeIngredients = normalizeIngredientArray(ingredients);
    heading.textContent = `${titleText} (${safeIngredients.length})`;
    section.append(heading);

    if (safeIngredients.length === 0) {
        const empty = document.createElement("p");
        empty.className = "recipe-ingredients__empty";
        empty.textContent = variant === "used" ? "No matched ingredients listed." : "No extras listed.";
        section.append(empty);
        return section;
    }

    const list = document.createElement("ul");
    list.className = "recipe-ingredients__list";

    for (const ingredient of safeIngredients) {
        const listItem = document.createElement("li");
        listItem.className = "recipe-ingredient";

        const imageUrl = getTrustedSpoonacularUrl(ingredient.image);
        if (imageUrl) {
            const image = document.createElement("img");
            image.src = imageUrl;
            image.alt = "";
            image.loading = "lazy";
            image.width = 40;
            image.height = 40;
            listItem.append(image);
        } else {
            const initial = document.createElement("span");
            initial.className = "recipe-ingredient__initial";
            initial.textContent = ingredient.name.charAt(0).toUpperCase();
            initial.setAttribute("aria-hidden", "true");
            listItem.append(initial);
        }

        const name = document.createElement("span");
        name.textContent = ingredient.name;
        name.title = ingredient.original;
        listItem.append(name);
        list.append(listItem);
    }

    section.append(list);
    return section;
}

function renderSkeletons(count) {
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < count; index += 1) {
        const skeleton = document.createElement("article");
        skeleton.className = "recipe recipe--skeleton";
        skeleton.setAttribute("aria-hidden", "true");

        const image = document.createElement("div");
        image.className = "skeleton skeleton--image";

        const body = document.createElement("div");
        body.className = "recipe__content";
        for (const width of ["70%", "45%", "90%", "82%"] ) {
            const line = document.createElement("div");
            line.className = "skeleton skeleton--line";
            line.style.width = width;
            body.append(line);
        }

        skeleton.append(image, body);
        fragment.append(skeleton);
    }

    resultsElement.replaceChildren(fragment);
    setResultsBusy(true);
}

function renderEmptyState(message) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";

    const icon = document.createElement("span");
    icon.className = "empty-state__icon";
    icon.textContent = "🍲";
    icon.setAttribute("aria-hidden", "true");

    const text = document.createElement("p");
    text.textContent = message;
    emptyState.append(icon, text);
    resultsElement.replaceChildren(emptyState);
}

function toggleFavorite(recipe) {
    const normalizedRecipe = normalizeRecipeForStorage(recipe);
    if (!normalizedRecipe) {
        setStatus("This recipe could not be saved.", true);
        return;
    }

    if (favoriteRecipes.has(normalizedRecipe.id)) {
        favoriteRecipes.delete(normalizedRecipe.id);
        setStatus(`${normalizedRecipe.title} was removed from saved recipes.`);
    } else {
        favoriteRecipes.set(normalizedRecipe.id, normalizedRecipe);
        setStatus(`${normalizedRecipe.title} was saved.`);
    }

    persistFavorites();
    updateFavoritesShortcut();
    renderCurrentResults(false);
}

async function shareRecipe(recipe) {
    const title = typeof recipe?.title === "string" ? recipe.title : "Kitchen Wizard recipe";
    const text = `${title} — ${getRecipeMatchPercentage(recipe)}% match in Kitchen Wizard.`;
    const url = `${window.location.origin}${window.location.pathname}`;

    if (typeof navigator.share === "function") {
        try {
            await navigator.share({ title, text, url });
            setStatus(`${title} was shared.`);
            return;
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
        }
    }

    const shareText = `${text}\n${url}`;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareText);
        } else if (!copyTextFallback(shareText)) {
            throw new Error("Clipboard access is unavailable.");
        }
        setStatus(`${title} was copied to your clipboard.`);
    } catch {
        setStatus("Sharing is not available in this browser.", true);
    }
}

function copyTextFallback(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.className = "visually-hidden-copy";
    document.body.append(textArea);
    textArea.select();

    try {
        return document.execCommand("copy");
    } finally {
        textArea.remove();
    }
}

function saveRecentSearch(ingredients) {
    const normalizedSearch = ingredients.map((ingredient) => ingredient.trim()).filter(Boolean);
    const searchKey = normalizedSearch.map((ingredient) => ingredient.toLocaleLowerCase()).join("|");

    recentSearches = [
        normalizedSearch,
        ...recentSearches.filter(
            (search) => search.map((ingredient) => ingredient.toLocaleLowerCase()).join("|") !== searchKey,
        ),
    ].slice(0, MAX_RECENT_SEARCHES);

    writeStorage(STORAGE_KEYS.recentSearches, recentSearches);
    renderRecentSearches();
}

function renderRecentSearches() {
    const fragment = document.createDocumentFragment();

    for (const search of recentSearches) {
        const button = document.createElement("button");
        button.className = "recent-search";
        button.type = "button";
        button.textContent = search.join(", ");
        button.setAttribute("aria-label", `Search again for ${search.join(", ")}`);
        button.addEventListener("click", () => {
            selectedIngredients = [...search];
            renderIngredientChips();
            form.requestSubmit();
        });
        fragment.append(button);
    }

    recentSearchesElement.replaceChildren(fragment);
    recentSearchesSection.hidden = recentSearches.length === 0;
}

function loadRecentSearches() {
    return readStorageArray(STORAGE_KEYS.recentSearches)
        .filter(Array.isArray)
        .map((search) =>
            search
                .filter((ingredient) => typeof ingredient === "string")
                .map((ingredient) => ingredient.trim().slice(0, MAX_INGREDIENT_LENGTH))
                .filter(Boolean)
                .slice(0, MAX_INGREDIENTS),
        )
        .filter((search) => search.length > 0)
        .slice(0, MAX_RECENT_SEARCHES);
}

function loadFavoriteRecipes() {
    const favorites = new Map();

    for (const recipe of readStorageArray(STORAGE_KEYS.favorites)) {
        const normalizedRecipe = normalizeRecipeForStorage(recipe);
        if (normalizedRecipe) {
            favorites.set(normalizedRecipe.id, normalizedRecipe);
        }
    }

    return favorites;
}

function normalizeRecipeForStorage(recipe) {
    const id = Number(recipe?.id);
    const title = typeof recipe?.title === "string" ? recipe.title.trim().slice(0, 200) : "";

    if (!Number.isSafeInteger(id) || id < 1 || !title) {
        return null;
    }

    const usedIngredientCount = normalizeCount(recipe.usedIngredientCount);
    const requestedIngredientCount = Math.max(
        1,
        normalizeCount(recipe.requestedIngredientCount),
    );
    const matchedIngredientCount = Math.min(
        requestedIngredientCount,
        normalizeCount(recipe.matchedIngredientCount || usedIngredientCount),
    );

    return {
        id,
        title,
        image: getTrustedSpoonacularUrl(recipe.image),
        usedIngredientCount,
        matchedIngredientCount,
        missedIngredientCount: normalizeCount(recipe.missedIngredientCount),
        requestedIngredientCount,
        matchPercentage: Math.round((matchedIngredientCount / requestedIngredientCount) * 100),
        usedIngredients: normalizeIngredientArray(recipe.usedIngredients),
        missedIngredients: normalizeIngredientArray(recipe.missedIngredients),
    };
}

function normalizeIngredientArray(ingredients) {
    if (!Array.isArray(ingredients)) {
        return [];
    }

    return ingredients
        .map((ingredient) => {
            const name = typeof ingredient?.name === "string" ? ingredient.name.trim().slice(0, 100) : "";
            if (!name) {
                return null;
            }

            return {
                name,
                original:
                    typeof ingredient.original === "string"
                        ? ingredient.original.trim().slice(0, 250)
                        : name,
                image: getTrustedSpoonacularUrl(ingredient.image),
            };
        })
        .filter(Boolean)
        .slice(0, 50);
}

function persistFavorites() {
    writeStorage(STORAGE_KEYS.favorites, [...favoriteRecipes.values()]);
}

function updateFavoritesShortcut() {
    showFavoritesButton.textContent = `Saved recipes (${favoriteRecipes.size})`;
}

function readStorageArray(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        setStatus("Your browser could not save this preference.", true);
    }
}

async function openRecipeDetails(recipeId, recipeTitle, trigger) {
    if (activeDetailsController) {
        activeDetailsController.abort();
    }

    lastDialogTrigger = trigger;
    resetRecipeDialog(recipeTitle);

    if (!recipeDialog.open) {
        recipeDialog.showModal();
    }

    const cachedRecipe = recipeDetailsCache.get(recipeId);
    if (cachedRecipe) {
        renderRecipeDetails(cachedRecipe);
        return;
    }

    const requestController = new AbortController();
    activeDetailsController = requestController;

    try {
        const response = await fetch(`/api/recipes/${recipeId}`, {
            headers: { Accept: "application/json" },
            signal: requestController.signal,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
            const message = payload?.error?.message || getFallbackErrorMessage(response.status);
            throw new ApplicationError(message);
        }

        if (!payload?.recipe || typeof payload.recipe !== "object") {
            throw new ApplicationError("The recipe service returned an unexpected response.");
        }

        recipeDetailsCache.set(recipeId, payload.recipe);
        renderRecipeDetails(payload.recipe);
    } catch (error) {
        if (error.name === "AbortError") {
            return;
        }

        const message =
            error instanceof ApplicationError
                ? error.message
                : "We could not load this recipe. Check your connection and try again.";
        setDialogStatus(message, true);
    } finally {
        if (activeDetailsController === requestController) {
            activeDetailsController = null;
        }
    }
}

function resetRecipeDialog(recipeTitle) {
    dialogTitle.textContent = recipeTitle;
    dialogContent.replaceChildren();
    dialogContent.hidden = true;
    setDialogStatus("Loading recipe details...");
}

function renderRecipeDetails(recipe) {
    dialogTitle.textContent = recipe.title || "Recipe details";
    const fragment = document.createDocumentFragment();
    const imageUrl = getTrustedSpoonacularUrl(recipe.image);

    if (imageUrl) {
        const image = document.createElement("img");
        image.className = "recipe-detail__image";
        image.src = imageUrl;
        image.alt = recipe.title || "Recipe";
        image.width = 720;
        image.height = 480;
        fragment.append(image);
    }

    const body = document.createElement("div");
    body.className = "recipe-detail__body";
    const meta = document.createElement("div");
    meta.className = "recipe-detail__meta";

    if (Number.isInteger(recipe.readyInMinutes) && recipe.readyInMinutes > 0) {
        meta.append(createDetailFact(`${recipe.readyInMinutes} minutes`));
    }

    if (Number.isInteger(recipe.servings) && recipe.servings > 0) {
        meta.append(createDetailFact(`${recipe.servings} ${pluralize("serving", recipe.servings)}`));
    }

    if (meta.childElementCount > 0) {
        body.append(meta);
    }

    if (Array.isArray(recipe.diets) && recipe.diets.length > 0) {
        const tags = document.createElement("div");
        tags.className = "recipe-detail__tags";

        for (const diet of recipe.diets) {
            if (typeof diet === "string" && diet) {
                const tag = document.createElement("span");
                tag.className = "recipe-detail__tag";
                tag.textContent = diet;
                tags.append(tag);
            }
        }

        body.append(tags);
    }

    body.append(
        createRecipeListSection("Ingredients", recipe.ingredients, false),
        createRecipeListSection("Instructions", recipe.instructions, true),
    );

    if (typeof recipe.sourceName === "string" && recipe.sourceName) {
        const source = document.createElement("p");
        source.className = "recipe-detail__source";
        source.textContent = `Recipe source: ${recipe.sourceName}`;
        body.append(source);
    }

    fragment.append(body);
    dialogContent.replaceChildren(fragment);
    dialogContent.hidden = false;
    setDialogStatus("");
}

function createDetailFact(text) {
    const fact = document.createElement("span");
    fact.className = "recipe-detail__fact";
    fact.textContent = text;
    return fact;
}

function createRecipeListSection(titleText, items, ordered) {
    const section = document.createElement("section");
    section.className = "recipe-detail__section";
    const title = document.createElement("h3");
    title.textContent = titleText;
    section.append(title);

    const validItems = Array.isArray(items)
        ? items.filter((item) => typeof item === "string" && item.trim())
        : [];

    if (validItems.length === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "recipe-detail__empty";
        emptyMessage.textContent = `${titleText} are not available for this recipe.`;
        section.append(emptyMessage);
        return section;
    }

    const list = document.createElement(ordered ? "ol" : "ul");
    for (const item of validItems) {
        const listItem = document.createElement("li");
        listItem.textContent = item;
        list.append(listItem);
    }

    section.append(list);
    return section;
}

async function readJsonResponse(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function getRecipeMatchPercentage(recipe) {
    const suppliedPercentage = normalizePercentage(recipe?.matchPercentage);
    if (suppliedPercentage > 0) {
        return suppliedPercentage;
    }

    const usedCount = getMatchedIngredientCount(recipe);
    const requestedCount = Math.max(1, normalizeCount(recipe?.requestedIngredientCount));
    return Math.min(100, Math.round((usedCount / requestedCount) * 100));
}

function getMatchedIngredientCount(recipe) {
    const requestedCount = Math.max(1, normalizeCount(recipe?.requestedIngredientCount));
    const suppliedMatchedCount = normalizeCount(recipe?.matchedIngredientCount);
    const fallbackUsedCount = normalizeCount(recipe?.usedIngredientCount);
    return Math.min(requestedCount, suppliedMatchedCount || fallbackUsedCount);
}

function normalizeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function normalizePercentage(value) {
    const percentage = Number(value);
    return Number.isFinite(percentage) ? Math.min(100, Math.max(0, Math.round(percentage))) : 0;
}

function getTrustedSpoonacularUrl(value) {
    if (typeof value !== "string") {
        return null;
    }

    try {
        const url = new URL(value);
        const isSpoonacularHost =
            url.hostname === "spoonacular.com" || url.hostname.endsWith(".spoonacular.com");
        return url.protocol === "https:" && isSpoonacularHost ? url.toString() : null;
    } catch {
        return null;
    }
}

function getFallbackErrorMessage(status) {
    if (status === 400) {
        return "Check the ingredient list and try again.";
    }

    if (status === 404) {
        return "That recipe could not be found.";
    }

    if (status === 429) {
        return "The recipe request limit has been reached. Please try again later.";
    }

    if (status >= 500) {
        return "The recipe service is temporarily unavailable. Please try again later.";
    }

    return "We could not fetch recipes at this time.";
}

function clearResults() {
    resultsElement.replaceChildren();
    resultsSection.hidden = true;
    setResultsBusy(false);
}

function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading ? "Finding Recipes..." : "Find Recipes";
}

function setResultsBusy(isBusy) {
    resultsElement.setAttribute("aria-busy", String(isBusy));
    resultsSection.classList.toggle("results-section--loading", isBusy);
}

function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("status--error", isError);
}

function setDialogStatus(message, isError = false) {
    dialogStatus.textContent = message;
    dialogStatus.classList.toggle("dialog__status--error", isError);
}

function pluralize(word, count) {
    return count === 1 ? word : `${word}s`;
}

class ApplicationError extends Error {}
