import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import recipesRouter from "./routes/recipes.js";

const app = express();
const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const publicDirectory = path.resolve(currentDirectory, "../public");
const localEnvironmentFile = path.resolve(currentDirectory, "../.env");

if (existsSync(localEnvironmentFile)) {
    process.loadEnvFile(localEnvironmentFile);
}

app.disable("x-powered-by");

app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
});

app.use("/api/recipes", recipesRouter);
app.use(express.static(publicDirectory));

app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
        response.status(404).json({
            error: {
                code: "NOT_FOUND",
                message: "The requested API endpoint does not exist.",
            },
        });
        return;
    }

    response.status(404).type("text/plain").send("Page not found.");
});

app.use((error, request, response, next) => {
    console.error("Unexpected server error:", error);

    if (response.headersSent) {
        next(error);
        return;
    }

    response.status(500).json({
        error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected server error occurred.",
        },
    });
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === currentFilePath;

if (isMainModule) {
    const port = Number.parseInt(process.env.PORT ?? "3000", 10);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }

    app.listen(port, () => {
        console.log(`Kitchen Wizard is running at http://localhost:${port}`);
    });
}

export default app;
