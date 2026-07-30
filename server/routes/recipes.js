import { Router } from "express";

import {
    findRecipes,
    getRecipeDetails,
    RecipeServiceError,
} from "../services/spoonacular.js";
import {
    IngredientValidationError,
    parseIngredients,
} from "../validation/ingredients.js";

const router = Router();

router.get("/", async (request, response) => {
    try {
        const ingredients = parseIngredients(request.query.ingredients);
        const recipes = await findRecipes(ingredients);
        response.status(200).json({ recipes });
    } catch (error) {
        if (error instanceof IngredientValidationError) {
            response.status(400).json({
                error: {
                    code: error.code,
                    message: error.message,
                },
            });
            return;
        }

        if (sendRecipeServiceError(error, response)) {
            return;
        }

        throw error;
    }
});

router.get("/:id", async (request, response) => {
    const recipeId = parseRecipeId(request.params.id);

    if (recipeId === null) {
        response.status(400).json({
            error: {
                code: "INVALID_RECIPE_ID",
                message: "The recipe id must be a positive integer.",
            },
        });
        return;
    }

    try {
        const recipe = await getRecipeDetails(recipeId);
        response.status(200).json({ recipe });
    } catch (error) {
        if (sendRecipeServiceError(error, response)) {
            return;
        }

        throw error;
    }
});

function parseRecipeId(value) {
    if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) {
        return null;
    }

    const recipeId = Number(value);
    return Number.isSafeInteger(recipeId) && recipeId > 0 ? recipeId : null;
}

function sendRecipeServiceError(error, response) {
    if (!(error instanceof RecipeServiceError)) {
        return false;
    }

    if (error.shouldLog) {
        console.error(`Recipe service error [${error.code}]:`, error.cause ?? error.message);
    }

    response.status(error.status).json({
        error: {
            code: error.code,
            message: error.message,
        },
    });
    return true;
}

export default router;
