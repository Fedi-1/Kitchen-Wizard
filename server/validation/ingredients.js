export const MAX_INGREDIENTS = 15;
export const MAX_INGREDIENT_LENGTH = 50;

export function parseIngredients(value) {
    if (typeof value !== "string") {
        throw new IngredientValidationError(
            "Enter at least one ingredient.",
            "INVALID_INGREDIENTS",
        );
    }

    const ingredients = [];
    const seen = new Set();

    for (const rawIngredient of value.split(",")) {
        const ingredient = rawIngredient.trim().replace(/\s+/g, " ");
        if (!ingredient) {
            continue;
        }

        if (ingredient.length > MAX_INGREDIENT_LENGTH) {
            throw new IngredientValidationError(
                `Each ingredient must be ${MAX_INGREDIENT_LENGTH} characters or fewer.`,
                "INGREDIENT_TOO_LONG",
            );
        }

        const comparisonValue = ingredient.toLocaleLowerCase();
        if (!seen.has(comparisonValue)) {
            seen.add(comparisonValue);
            ingredients.push(ingredient);
        }
    }

    if (ingredients.length === 0) {
        throw new IngredientValidationError(
            "Enter at least one ingredient.",
            "INVALID_INGREDIENTS",
        );
    }

    if (ingredients.length > MAX_INGREDIENTS) {
        throw new IngredientValidationError(
            `Enter no more than ${MAX_INGREDIENTS} ingredients.`,
            "TOO_MANY_INGREDIENTS",
        );
    }

    return ingredients;
}

export class IngredientValidationError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "IngredientValidationError";
        this.code = code;
    }
}
