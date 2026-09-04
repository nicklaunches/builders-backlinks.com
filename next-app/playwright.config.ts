import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

/**
 * @file The browser suite. Covers what the HTTP suite cannot: the inbox itself.
 *
 * `pnpm test:inbox` proves the routes are correct. This proves the thing a
 * member actually touches — that a reply typed in one browser appears in the
 * other without a reload, that accepting swaps a masked thread for a named one
 * on screen, and that the pane a phone gets is usable.
 *
 * SERIAL, ONE WORKER, ON PURPOSE. The suite drives two members through one
 * shared exchange, and the fixtures are seeded once for the whole run. Running
 * the specs in parallel would have them mutating each other's threads.
 *
 * The dev server is started for the run unless one is already listening, so a
 * developer who already has `pnpm dev` open keeps their hot reload.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
    testDir: "./e2e",
    globalSetup: "./e2e/seed.setup.ts",
    fullyParallel: false,
    workers: 1,
    // A placement check crawls a page before answering, so the default 30s is
    // tight on a cold dev server compiling a route for the first time.
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
    use: {
        baseURL: BASE_URL,
        trace: "retain-on-failure",
        video: "off",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: `PORT=${PORT} pnpm dev`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
