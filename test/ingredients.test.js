import assert from "node:assert/strict";
import test from "node:test";

import {
    IngredientValidationError,
    MAX_INGREDIENT_LENGTH,
    MAX_INGREDIENTS,
    parseIngredients,
} from "../server/validation/ingredients.js";

test("trims ingredients, removes blanks, and deduplicates case-insensitively", () => {
    assert.deepEqual(
        parseIngredients(" chicken, garlic, CHICKEN, , red   onion "),
        ["chicken", "garlic", "red onion"],
    );
});

test("rejects an empty ingredient list", () => {
    assert.throws(
        () => parseIngredients(" ,  , "),
        (error) =>
            error instanceof IngredientValidationError && error.code === "INVALID_INGREDIENTS",
    );
});

test("rejects an ingredient that is too long", () => {
    assert.throws(
        () => parseIngredients("a".repeat(MAX_INGREDIENT_LENGTH + 1)),
        (error) =>
            error instanceof IngredientValidationError && error.code === "INGREDIENT_TOO_LONG",
    );
});

test("rejects too many unique ingredients", () => {
    const ingredients = Array.from(
        { length: MAX_INGREDIENTS + 1 },
        (_, index) => `ingredient-${index}`,
    ).join(",");

    assert.throws(
        () => parseIngredients(ingredients),
        (error) =>
            error instanceof IngredientValidationError && error.code === "TOO_MANY_INGREDIENTS",
    );
});
