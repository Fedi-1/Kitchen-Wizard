const SPOONACULAR_BASE_URL = "https://api.spoonacular.com";
const REQUEST_TIMEOUT_MS = 8_000;
const RECIPE_LIMIT = 5;

export async function findRecipes(ingredients) {
    const payload = await requestSpoonacular("/recipes/findByIngredients", {
        ingredients: ingredients.join(","),
        number: String(RECIPE_LIMIT),
    });

    if (!Array.isArray(payload)) {
        throw invalidUpstreamResponse();
    }

    return payload
        .map((recipe) => normalizeRecipe(recipe, ingredients.length))
        .filter(Boolean);
}

export async function getRecipeDetails(recipeId) {
    const payload = await requestSpoonacular(
        `/recipes/${recipeId}/information`,
        { includeNutrition: "false" },
        { allowNotFound: true },
    );

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw invalidUpstreamResponse();
    }

    const details = normalizeRecipeDetails(payload);
    if (!details) {
        throw invalidUpstreamResponse();
    }

    return details;
}

async function requestSpoonacular(pathname, parameters, { allowNotFound = false } = {}) {
    const apiKey = process.env.SPOONACULAR_API_KEY?.trim();

    if (!apiKey) {
        throw new RecipeServiceError({
            code: "SERVICE_CONFIGURATION_ERROR",
            message: "The recipe service has not been configured yet.",
            status: 503,
            shouldLog: false,
        });
    }

    const url = new URL(pathname, SPOONACULAR_BASE_URL);
    url.search = new URLSearchParams({ apiKey, ...parameters }).toString();

    let upstreamResponse;

    try {
        upstreamResponse = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        if (error.name === "TimeoutError") {
            throw new RecipeServiceError({
                code: "UPSTREAM_TIMEOUT",
                message: "The recipe service took too long to respond. Please try again.",
                status: 504,
                cause: error,
            });
        }

        throw new RecipeServiceError({
            code: "UPSTREAM_UNAVAILABLE",
            message: "The recipe service is temporarily unavailable. Please try again later.",
            status: 502,
            cause: error,
        });
    }

    if (!upstreamResponse.ok) {
        throw mapUpstreamFailure(upstreamResponse.status, allowNotFound);
    }

    try {
        return await upstreamResponse.json();
    } catch (error) {
        throw new RecipeServiceError({
            code: "INVALID_UPSTREAM_RESPONSE",
            message: "The recipe service returned an invalid response.",
            status: 502,
            cause: error,
        });
    }
}

function mapUpstreamFailure(status, allowNotFound) {
    if (status === 404 && allowNotFound) {
        return new RecipeServiceError({
            code: "RECIPE_NOT_FOUND",
            message: "That recipe could not be found.",
            status: 404,
            shouldLog: false,
        });
    }

    if (status === 401 || status === 403) {
        return new RecipeServiceError({
            code: "SERVICE_CONFIGURATION_ERROR",
            message: "The recipe service rejected its server credentials.",
            status: 503,
        });
    }

    if (status === 402 || status === 429) {
        return new RecipeServiceError({
            code: "RATE_LIMITED",
            message: "The recipe request limit has been reached. Please try again later.",
            status: 429,
            shouldLog: false,
        });
    }

    return new RecipeServiceError({
        code: "UPSTREAM_ERROR",
        message: "The recipe service is temporarily unavailable. Please try again later.",
        status: 502,
        cause: new Error(`Spoonacular responded with HTTP ${status}.`),
    });
}

function invalidUpstreamResponse() {
    return new RecipeServiceError({
        code: "INVALID_UPSTREAM_RESPONSE",
        message: "The recipe service returned an invalid response.",
        status: 502,
    });
}

function normalizeRecipe(recipe, requestedIngredientCount) {
    const id = Number(recipe?.id);
    const title = normalizePlainText(recipe?.title, 200);

    if (!Number.isSafeInteger(id) || id < 1 || !title) {
        return null;
    }

    const usedIngredientCount = normalizeCount(recipe.usedIngredientCount);
    const safeRequestedCount = Math.max(1, normalizeCount(requestedIngredientCount));
    const matchedIngredientCount = Math.min(usedIngredientCount, safeRequestedCount);

    return {
        id,
        title,
        image: getSafeSpoonacularUrl(recipe.image),
        usedIngredientCount,
        matchedIngredientCount,
        missedIngredientCount: normalizeCount(recipe.missedIngredientCount),
        requestedIngredientCount: safeRequestedCount,
        matchPercentage: Math.round((matchedIngredientCount / safeRequestedCount) * 100),
        usedIngredients: normalizeSearchIngredients(recipe.usedIngredients),
        missedIngredients: normalizeSearchIngredients(recipe.missedIngredients),
    };
}

function normalizeSearchIngredients(ingredients) {
    if (!Array.isArray(ingredients)) {
        return [];
    }

    return ingredients
        .map((ingredient) => {
            const name = normalizePlainText(
                ingredient?.originalName ?? ingredient?.name ?? ingredient?.original,
                100,
            );

            if (!name) {
                return null;
            }

            return {
                name,
                original: normalizePlainText(ingredient?.original, 250) || name,
                image: getSafeSpoonacularUrl(ingredient?.image),
            };
        })
        .filter(Boolean)
        .slice(0, 50);
}

function normalizeRecipeDetails(recipe) {
    const id = Number(recipe?.id);
    const title = normalizePlainText(recipe?.title, 200);

    if (!Number.isSafeInteger(id) || id < 1 || !title) {
        return null;
    }

    const ingredients = Array.isArray(recipe.extendedIngredients)
        ? recipe.extendedIngredients
              .map((ingredient) => normalizePlainText(ingredient?.original, 300))
              .filter(Boolean)
              .slice(0, 100)
        : [];

    const diets = Array.isArray(recipe.diets)
        ? recipe.diets
              .map((diet) => normalizePlainText(diet, 50))
              .filter(Boolean)
              .slice(0, 10)
        : [];

    return {
        id,
        title,
        image: getSafeSpoonacularUrl(recipe.image),
        servings: normalizeOptionalPositiveInteger(recipe.servings),
        readyInMinutes: normalizeOptionalPositiveInteger(recipe.readyInMinutes),
        ingredients,
        instructions: normalizeInstructions(recipe),
        diets,
        sourceName: normalizePlainText(recipe.sourceName ?? recipe.creditsText, 100),
    };
}

function normalizeInstructions(recipe) {
    const analyzedSteps = Array.isArray(recipe.analyzedInstructions)
        ? recipe.analyzedInstructions.flatMap((section) =>
              Array.isArray(section?.steps) ? section.steps : [],
          )
        : [];

    const instructions = analyzedSteps
        .map((step) => normalizePlainText(step?.step, 1_000))
        .filter(Boolean)
        .slice(0, 100);

    if (instructions.length > 0) {
        return instructions;
    }

    const fallbackInstructions = htmlToPlainText(recipe.instructions, 10_000);
    return fallbackInstructions
        ? fallbackInstructions.split(/\n+/).filter(Boolean).slice(0, 100)
        : [];
}

function normalizeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function normalizeOptionalPositiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizePlainText(value, maximumLength) {
    return htmlToPlainText(value, maximumLength);
}

function htmlToPlainText(value, maximumLength) {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\s*\/\s*(?:p|li|div|h[1-6])\s*>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/&(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, decodeHtmlEntity)
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, maximumLength);
}

function decodeHtmlEntity(entity) {
    const namedEntities = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
    };
    const normalizedEntity = entity.toLowerCase();

    if (namedEntities[normalizedEntity]) {
        return namedEntities[normalizedEntity];
    }

    const isHexadecimal = normalizedEntity.startsWith("&#x");
    const numericValue = Number.parseInt(
        normalizedEntity.slice(isHexadecimal ? 3 : 2, -1),
        isHexadecimal ? 16 : 10,
    );

    return Number.isInteger(numericValue) && numericValue >= 0 && numericValue <= 0x10ffff
        ? String.fromCodePoint(numericValue)
        : entity;
}

function getSafeSpoonacularUrl(value) {
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

export class RecipeServiceError extends Error {
    constructor({ code, message, status, cause, shouldLog = true }) {
        super(message, { cause });
        this.name = "RecipeServiceError";
        this.code = code;
        this.status = status;
        this.shouldLog = shouldLog;
    }
}
