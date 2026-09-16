import { type Browser, expect, test } from "@playwright/test";

import { type SeedPerson, readSeed, signIn } from "./fixtures";

/**
 * @file `/app/sites`: the list, and the floor behind each row.
 *
 * The invariant worth a browser for is the CHIP. It is fed by what the save
 * returned, not by what is in the fields, so a floor that failed to save cannot
 * leave a row claiming it holds one. Everything else about the panel is covered
 * by the unit tests over `lib/matching/floor`.
 *
 * Runs after `inbox.spec.ts` by filename, and touches nothing that spec reads:
 * a floor applies to the next pairing, never to a match that already exists.
 */

let seed: Awaited<ReturnType<typeof readSeed>>;

test.beforeAll(async () => {
    seed = await readSeed();
});

async function pageFor(browser: Browser, person: SeedPerson, baseURL: string) {
    const context = await browser.newContext({ baseURL });
    await signIn(context, person, baseURL);
    return { context, page: await context.newPage() };
}

test("every row is closed until its own control is asked for", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await page.goto("/app/sites");
    await expect(page.getByRole("heading", { name: "Your sites" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Minimum partner DR" })).toHaveCount(0);

    await page.getByRole("button", { name: /Who adatools\.test matches with/ }).click();
    await expect(page.getByRole("spinbutton", { name: "Minimum partner DR" })).toBeVisible();

    await context.close();
});

test("a saved floor shows on the closed row and survives a reload", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await page.goto("/app/sites");
    const row = page.getByRole("listitem").filter({ hasText: "adatools.test" });
    await expect(row.getByText(/min DR/i)).toHaveCount(0);

    await page.getByRole("button", { name: /Who adatools\.test matches with/ }).click();
    await page.getByRole("spinbutton", { name: "Minimum partner DR" }).fill("30");
    await page.getByRole("button", { name: "Save" }).click();

    // The chip is the point: it reads what came back from the server.
    await expect(row.getByText("min DR 30")).toBeVisible();
    await expect(page.getByText("Saved. The next pairing uses it.")).toBeVisible();

    await page.reload();
    await expect(row.getByText("min DR 30")).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Minimum partner DR" })).toHaveCount(0);

    await context.close();
});
