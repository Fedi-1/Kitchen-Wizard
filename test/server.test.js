import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import app from "../server/app.js";

test("serves the browser application", async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(baseUrl);
        const html = await response.text();

        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.match(html, /<h1>Kitchen Wizard<\/h1>/);
        assert.match(html, /id="ingredientsChips"/);
        assert.match(html, /id="sortSelect"/);
        assert.doesNotMatch(html, /SPOONACULAR_API_KEY|apiKey\s*=/);
    });
});

test("rejects an empty ingredient request", async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/recipes?ingredients=,,,`);
        const payload = await response.json();

        assert.equal(response.status, 400);
        assert.equal(payload.error.code, "INVALID_INGREDIENTS");
    });
});

test("rejects an invalid recipe detail id without contacting Spoonacular", async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/recipes/not-a-number`);
        const payload = await response.json();

        assert.equal(response.status, 400);
        assert.equal(payload.error.code, "INVALID_RECIPE_ID");
    });
});

test("reports a missing server-side API key without contacting Spoonacular", async () => {
    const originalKey = process.env.SPOONACULAR_API_KEY;
    delete process.env.SPOONACULAR_API_KEY;

    try {
        await withServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/recipes?ingredients=tomato`);
            const payload = await response.json();

            assert.equal(response.status, 503);
            assert.equal(payload.error.code, "SERVICE_CONFIGURATION_ERROR");
        });
    } finally {
        if (originalKey === undefined) {
            delete process.env.SPOONACULAR_API_KEY;
        } else {
            process.env.SPOONACULAR_API_KEY = originalKey;
        }
    }
});

async function withServer(callback) {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        await callback(baseUrl);
    } finally {
        server.close();
        await once(server, "close");
    }
}
