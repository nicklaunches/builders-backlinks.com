import type { BrowserContext, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SeedOutput } from "../scripts/seed";

/**
 * @file Reading the seeded fixtures, and signing a browser in as one of them.
 *
 * SIGNING IN IS A COOKIE, NOT A FLOW. The app authenticates with Google and
 * GitHub only, which a test cannot drive, so the seeder mints the same encrypted
 * session JWT that a real sign-in would leave behind. That keeps the app free of
 * any test-only login route — there is nothing here that could ship.
 */

const SEED_FILE = path.join(".seed", "inbox.json");

export async function readSeed(): Promise<SeedOutput> {
    return JSON.parse(await readFile(SEED_FILE, "utf8")) as SeedOutput;
}

export type SeedPerson = SeedOutput["people"][string];

/** Puts a seeded member's session cookie on a context. */
export async function signIn(context: BrowserContext, person: SeedPerson, baseURL: string): Promise<void> {
    const [name, value] = person.cookie.split("=");
    const url = new URL(baseURL);
    await context.addCookies([
        {
            name: name!,
            value: value!,
            domain: url.hostname,
            path: "/",
            httpOnly: true,
            secure: url.protocol === "https:",
            sameSite: "Lax",
        },
    ]);
}

/** The thread pane, once its header has rendered. */
export async function openThread(page: Page, matchId: string): Promise<void> {
    await page.goto(`/app/inbox/${matchId}`);
    await page.getByRole("heading", { name: /Link exchange between/ }).waitFor();
}
