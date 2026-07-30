import assert from "node:assert/strict";
import test from "node:test";

import { findRecipes, getRecipeDetails } from "../server/services/spoonacular.js";

test("normalizes ingredient match data for recipe search results", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SPOONACULAR_API_KEY;
    let requestedUrl;

    process.env.SPOONACULAR_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
        requestedUrl = new URL(url);
        return new Response(
            JSON.stringify([
                {
                    id: 456,
                    title: "Tomato &amp; Basil Pasta",
                    image: "https://img.spoonacular.com/recipes/456-312x231.jpg",
                    usedIngredientCount: 2,
                    missedIngredientCount: 1,
                    usedIngredients: [
                        {
                            name: "tomato",
                            original: "2 ripe tomatoes",
                            image: "https://img.spoonacular.com/ingredients_100x100/tomato.png",
                        },
                    ],
                    missedIngredients: [
                        {
                            name: "pasta",
                            original: "8 ounces pasta",
                            image: "https://img.spoonacular.com/ingredients_100x100/fusilli.jpg",
                        },
                    ],
                },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    try {
        const recipes = await findRecipes(["tomato", "basil", "cheese"]);
        const recipe = recipes[0];

        assert.equal(requestedUrl.pathname, "/recipes/findByIngredients");
        assert.equal(requestedUrl.searchParams.get("ingredients"), "tomato,basil,cheese");
        assert.equal(recipe.title, "Tomato & Basil Pasta");
        assert.equal(recipe.requestedIngredientCount, 3);
        assert.equal(recipe.matchedIngredientCount, 2);
        assert.equal(recipe.matchPercentage, 67);
        assert.equal(recipe.usedIngredients[0].name, "tomato");
        assert.equal(recipe.missedIngredients[0].name, "pasta");
    } finally {
        globalThis.fetch = originalFetch;

        if (originalKey === undefined) {
            delete process.env.SPOONACULAR_API_KEY;
        } else {
            process.env.SPOONACULAR_API_KEY = originalKey;
        }
    }
});

test("normalizes recipe details and converts provider HTML to plain text", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SPOONACULAR_API_KEY;
    let requestedUrl;

    process.env.SPOONACULAR_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
        requestedUrl = new URL(url);
        return new Response(
            JSON.stringify({
                id: 123,
                title: "<b>Safe &amp; Tasty</b>",
                image: "https://img.spoonacular.com/recipes/123-556x370.jpg",
                servings: 4,
                readyInMinutes: 25,
                diets: ["vegetarian"],
                extendedIngredients: [
                    { original: "<b>1 cup</b> tomatoes &amp; basil" },
                ],
                analyzedInstructions: [],
                instructions: "<ol><li>Mix &amp; stir.</li><li>Bake.</li></ol>",
                sourceName: "<b>Example Kitchen</b>",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    try {
        const recipe = await getRecipeDetails(123);

        assert.equal(requestedUrl.pathname, "/recipes/123/information");
        assert.equal(requestedUrl.searchParams.get("includeNutrition"), "false");
        assert.equal(requestedUrl.searchParams.get("apiKey"), "test-key");
        assert.equal(recipe.title, "Safe & Tasty");
        assert.deepEqual(recipe.ingredients, ["1 cup tomatoes & basil"]);
        assert.deepEqual(recipe.instructions, ["Mix & stir.", "Bake."]);
        assert.deepEqual(recipe.diets, ["vegetarian"]);
        assert.equal(recipe.sourceName, "Example Kitchen");
    } finally {
        globalThis.fetch = originalFetch;

        if (originalKey === undefined) {
            delete process.env.SPOONACULAR_API_KEY;
        } else {
            process.env.SPOONACULAR_API_KEY = originalKey;
        }
    }
});
