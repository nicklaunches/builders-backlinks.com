import { type Browser, expect, test } from "@playwright/test";

import { type SeedPerson, openThread, readSeed, signIn } from "./fixtures";

/**
 * @file The chrome around the app: where a member lands, and the tab bar.
 *
 * Read-only against the seed, so it can run before `inbox.spec.ts` walks the
 * shared exchange forward. The one thing it depends on is that Bo has unread
 * replies in the agreed thread, which the seed guarantees and the HTTP suite
 * also leans on.
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

test("a signed-in member is sent from the landing page to the app, unless they ask to stay", async ({
    browser,
    baseURL,
}) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await page.goto("/");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    await page.goto("/?stay=1#rules");
    await expect(page).toHaveURL(/\/\?stay=1#rules$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await context.close();
});

test("a stranger keeps the landing page", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL! });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();

    await context.close();
});

test("the tab bar marks where you are, one level deep", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);
    const tabs = page.getByRole("navigation", { name: "Your exchange" });

    await page.goto("/app");
    await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: /^Inbox/ })).not.toHaveAttribute("aria-current", "page");

    await openThread(page, seed.matches.agreed);
    await expect(tabs.getByRole("link", { name: /^Inbox/ })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current", "page");

    await context.close();
});

test("the inbox badge counts unread replies and clears when the thread is opened", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.boships!, baseURL!);
    const inboxTab = page.getByRole("navigation", { name: "Your exchange" }).getByRole("link", { name: /^Inbox/ });

    await page.goto("/app");
    await expect(inboxTab).toHaveText(/Inbox\s*\d+/);
    await expect(page.getByRole("link", { name: /adatools\.test/ })).toBeVisible();

    await openThread(page, seed.matches.agreed);
    await expect(inboxTab).toHaveText(/^Inbox$/);

    await context.close();
});

test("on a phone the tabs are visible without the header nav", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 } });
    await signIn(context, seed.people.adatools!, baseURL!);
    const page = await context.newPage();

    await page.goto("/app");
    const tabs = page.getByRole("navigation", { name: "Your exchange" });
    for (const name of ["Overview", /^Inbox/, "Sites", "API key"]) {
        await expect(tabs.getByRole("link", { name })).toBeVisible();
    }

    await context.close();
});
