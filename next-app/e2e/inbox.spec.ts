import { type Browser, expect, test } from "@playwright/test";

import { type SeedPerson, openThread, readSeed, signIn } from "./fixtures";

/**
 * @file The inbox, driven the way a member drives it.
 *
 * Serial by declaration: these walk one seeded exchange forward, so a later spec
 * depends on what an earlier one did. That is deliberate — the point is the
 * whole trade, not five isolated screens.
 */

test.describe.configure({ mode: "serial" });

let seed: Awaited<ReturnType<typeof readSeed>>;

test.beforeAll(async () => {
    seed = await readSeed();
});

/** A signed-in page for one seeded member, in its own context. */
async function pageFor(browser: Browser, person: SeedPerson, baseURL: string) {
    const context = await browser.newContext({ baseURL });
    await signIn(context, person, baseURL);
    return { context, page: await context.newPage() };
}

test("the list shows a masked thread as a category, not a domain", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await page.goto("/app/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

    // The undecided thread is with distudio.test, whose identity is not Ada's to
    // see yet. This is the masking boundary, checked on the rendered page.
    await expect(page.getByRole("link", { name: /A Marketing site/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("distudio.test");

    await context.close();
});

test("an undecided thread offers a decision and no way to talk", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await openThread(page, seed.matches.proposed);
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(page.getByText("Messaging opens when you both accept")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Write a reply" })).toHaveCount(0);

    await context.close();
});

test("accepting a thread the partner already accepted reveals them", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await openThread(page, seed.matches.waitingOnAda);
    await expect(page.getByText("They have accepted and are waiting on you")).toBeVisible();

    await page.getByRole("button", { name: "Accept" }).click();

    // The reveal: a name where a category used to be, and a composer.
    await expect(page.getByRole("heading", { name: /cyanalytics\.test/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Write a reply" })).toBeVisible();
    await expect(page.getByText(/both link tasks are ready/)).toBeVisible();

    await context.close();
});

test("a reply typed by one member appears in the other's open thread", async ({ browser, baseURL }) => {
    const ada = await pageFor(browser, seed.people.adatools!, baseURL!);
    const bo = await pageFor(browser, seed.people.boships!, baseURL!);

    await openThread(ada.page, seed.matches.agreed);
    await openThread(bo.page, seed.matches.agreed);

    const line = `Publishing tonight — ${Date.now()}`;
    await ada.page.getByRole("textbox", { name: "Write a reply" }).fill(line);
    await ada.page.getByRole("button", { name: "Send" }).click();

    // Sender sees it immediately, optimistically, before the server answers.
    await expect(ada.page.getByText(line)).toBeVisible();

    // The recipient's pane is polling, so this arrives with no reload at all.
    await expect(bo.page.getByText(line)).toBeVisible({ timeout: 20_000 });

    await ada.context.close();
    await bo.context.close();
});

test("a URL in a message is a link, and a javascript scheme is not", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await openThread(page, seed.matches.agreed);
    await page
        .getByRole("textbox", { name: "Write a reply" })
        .fill("live at https://adatools.test/guides/http-fixtures and javascript:alert(1)");
    await page.getByRole("button", { name: "Send" }).click();

    // The seeded conversation already mentions this URL, so assert on the one
    // this test just sent rather than on the first match.
    const link = page.getByRole("link", { name: "https://adatools.test/guides/http-fixtures" }).last();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("rel", /nofollow/);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);

    await context.close();
});

test("pasting a page that cannot be crawled is reported as inconclusive, not as a miss", async ({
    browser,
    baseURL,
}) => {
    const { context, page } = await pageFor(browser, seed.people.adatools!, baseURL!);

    await openThread(page, seed.matches.agreed);
    // Localhost is refused by the SSRF guard, which is the inconclusive path.
    await page.getByRole("textbox", { name: "The page your link is on" }).fill(`${baseURL}/`);
    await page.getByRole("button", { name: "Check and finish" }).click();

    await expect(page.getByText(/could not|inconclusive|not be read/i)).toBeVisible({ timeout: 30_000 });
    // The placement is recorded even so, which is what moves the rail on.
    await expect(page.getByRole("listitem").filter({ hasText: "Add links" })).toHaveAttribute("aria-current", "step");

    await context.close();
});

test("a closed thread explains itself and refuses a reply", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.boships!, baseURL!);

    await openThread(page, seed.matches.expired);
    await expect(page.getByText(/expired before both sides accepted/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Write a reply" })).toHaveCount(0);

    await context.close();
});

test("a thread you are not part of is a 404", async ({ browser, baseURL }) => {
    const { context, page } = await pageFor(browser, seed.people.cyanalytics!, baseURL!);

    const response = await page.goto(`/app/inbox/${seed.matches.agreed}`);
    expect(response?.status()).toBe(404);

    await context.close();
});

test("a phone gets the list, then the thread, then a way back", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    await signIn(context, seed.people.adatools!, baseURL!);
    const page = await context.newPage();

    await page.goto("/app/inbox");
    await page.getByRole("link", { name: /boships\.test/ }).click();

    await expect(page.getByRole("heading", { name: /Link exchange between/ })).toBeVisible();
    // The list is out of the way on a narrow screen, and the way back is a control.
    await page.getByRole("link", { name: "Back to all threads" }).click();
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

    await context.close();
});

test("the inbox renders in light mode without a dark-only assumption", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, colorScheme: "light" });
    await signIn(context, seed.people.adatools!, baseURL!);
    const page = await context.newPage();

    await openThread(page, seed.matches.agreed);

    // The page paints its own ground rather than inheriting one: a transparent
    // body would leave the composer floating on whatever the browser defaults to.
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.getByRole("textbox", { name: "Write a reply" })).toBeVisible();

    await context.close();
});
