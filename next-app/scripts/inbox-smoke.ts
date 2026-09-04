import { config as loadEnv } from "dotenv";

import { type SeedOutput, seedInbox } from "./seed";

loadEnv({ path: ".env.local", quiet: true });

/**
 * @file End-to-end smoke test for the inbox API.
 *
 * Everything below goes over the wire against a running server with real
 * session cookies: no mocks, no direct service calls. It is the counterpart to
 * `test:mcp` for the browser-facing half of the same capability, and it seeds
 * its own fixtures so a fresh clone has something to assert against.
 *
 * Usage:
 *   PORT=3100 pnpm dev            (in another shell)
 *   pnpm test:inbox
 *
 * Or against the real runtime, which is the one that matters:
 *   pnpm exec opennextjs-cloudflare build
 *   pnpm exec wrangler dev --port 8788
 *   INBOX_SMOKE_BASE=http://localhost:8788 pnpm test:inbox
 *
 * THE THREE CHECKS THAT ARE NOT NEGOTIABLE, and why each exists:
 *
 * 1. BLINDNESS. A thread that has not been mutually accepted must not carry the
 *    partner's domain anywhere in its payload — not in a field, not in a task
 *    row, not in a timeline line. The assertion greps the whole serialized body
 *    for the string, because a type cannot catch a domain that arrives inside a
 *    sentence.
 * 2. THE ORIGIN GATE. These routes are cookie-authenticated, so a cross-origin
 *    POST that succeeds is a CSRF hole. Server actions get that check from Next;
 *    a route handler does not, which is why `assertSameOrigin` exists and why it
 *    is tested from the outside rather than trusted.
 * 3. OWNERSHIP. A member who is not in a thread gets the same answer as one
 *    asking for a thread that does not exist.
 *
 * It seeds LOCAL data only: `seedInbox` refuses any database that is not local,
 * so pointing this at production fails before it writes anything.
 */

const BASE = process.env.INBOX_SMOKE_BASE ?? "http://localhost:3100";
const ORIGIN = new URL(BASE).origin;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  ok   ${label}`);
    } else {
        failed++;
        console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
    }
}

type Call = {
    path: string;
    method?: "GET" | "POST";
    cookie?: string;
    body?: unknown;
    /** Overrides the same-origin header, for the CSRF checks. */
    origin?: string | null;
    contentType?: string | null;
};

async function call(input: Call): Promise<{ status: number; body: unknown; text: string }> {
    const headers: Record<string, string> = {};
    if (input.cookie) headers.cookie = input.cookie;
    if (input.origin !== null) headers.origin = input.origin ?? ORIGIN;
    if (input.body !== undefined && input.contentType !== null) {
        headers["content-type"] = input.contentType ?? "application/json";
    }

    const response = await fetch(`${BASE}${input.path}`, {
        method: input.method ?? "GET",
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: "manual",
    });

    const text = await response.text();
    let body: unknown = null;
    try {
        body = JSON.parse(text);
    } catch {
        // An HTML error page is a legitimate answer to assert on.
    }
    return { status: response.status, body, text };
}

async function main(): Promise<void> {
    console.log(`inbox smoke against ${BASE}\n`);

    console.log("seeding");
    let seed: SeedOutput;
    try {
        seed = await seedInbox();
    } catch (err) {
        console.error(`  FAIL could not seed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    const ada = seed.people.adatools!;
    const bo = seed.people.boships!;
    const cy = seed.people.cyanalytics!;
    const { agreed, proposed, expired } = seed.matches;
    console.log(`  ok   4 members, 5 threads\n`);

    console.log("authentication");
    {
        const anon = await call({ path: "/api/inbox/threads" });
        check("a signed-out caller cannot list threads", anon.status === 401, `got ${anon.status}`);

        const signedIn = await call({ path: "/api/inbox/threads", cookie: ada.cookie });
        check(
            "a member can list their own threads",
            signedIn.status === 200,
            `got ${signedIn.status}: ${signedIn.text.slice(0, 120)}`,
        );

        const threads = (signedIn.body as { threads?: Array<{ matchId: string }> }).threads ?? [];
        check("Ada sees her three threads", threads.length === 3, `got ${threads.length}`);
    }

    console.log("\nthe masking boundary");
    {
        const view = await call({ path: `/api/inbox/threads/${proposed}`, cookie: ada.cookie });
        check("an unaccepted thread still renders", view.status === 200, `got ${view.status}`);
        // The blindness check. A sentence can carry a domain no type would catch.
        check(
            "no partner domain appears anywhere in an unaccepted thread",
            !view.text.includes("distudio.test"),
            view.text.slice(0, 200),
        );
        check(
            "the pane is told it may not message yet",
            (view.body as { thread?: { canMessage?: boolean } }).thread?.canMessage === false,
        );

        const blocked = await call({
            path: `/api/inbox/threads/${proposed}/messages`,
            method: "POST",
            cookie: ada.cookie,
            body: { body: "trying to talk before we agreed" },
        });
        check("writing to an unaccepted thread is refused", blocked.status === 409, `got ${blocked.status}`);
    }

    console.log("\nownership");
    {
        const stranger = await call({ path: `/api/inbox/threads/${agreed}`, cookie: cy.cookie });
        check("a thread you are not in answers 404", stranger.status === 404, `got ${stranger.status}`);

        const write = await call({
            path: `/api/inbox/threads/${agreed}/messages`,
            method: "POST",
            cookie: cy.cookie,
            body: { body: "not mine to write in" },
        });
        check("and cannot be written to", write.status === 404, `got ${write.status}`);
    }

    console.log("\nmalformed ids");
    {
        const page = await call({ path: "/app/inbox/not-a-thread", cookie: ada.cookie });
        check("a malformed thread id is a 404 page, not a 500", page.status === 404, `got ${page.status}`);
    }

    console.log("\nthe origin gate");
    {
        const crossOrigin = await call({
            path: `/api/inbox/threads/${agreed}/messages`,
            method: "POST",
            cookie: ada.cookie,
            body: { body: "from somewhere else" },
            origin: "https://evil.example",
        });
        check("a cross-origin write is refused", crossOrigin.status === 403, `got ${crossOrigin.status}`);

        const formPost = await call({
            path: `/api/inbox/threads/${agreed}/messages`,
            method: "POST",
            cookie: ada.cookie,
            body: { body: "posted as a form" },
            contentType: "application/x-www-form-urlencoded",
        });
        check("a non-JSON write is refused", formPost.status === 415, `got ${formPost.status}`);
    }

    console.log("\nmessages");
    let sentAt = "";
    {
        const before = await call({ path: `/api/inbox/threads/${agreed}/messages`, cookie: ada.cookie });
        const beforeCount = ((before.body as { messages?: unknown[] }).messages ?? []).length;

        const sent = await call({
            path: `/api/inbox/threads/${agreed}/messages`,
            method: "POST",
            cookie: ada.cookie,
            body: { body: "Posting the guide tomorrow morning, will paste the URL here." },
        });
        check(
            "a member can write in an agreed thread",
            sent.status === 201,
            `got ${sent.status}: ${sent.text.slice(0, 160)}`,
        );
        const message = (sent.body as { message?: { id: string; mine: boolean; createdAt: string } }).message;
        check("the write comes back attributed to the sender", message?.mine === true);
        sentAt = message?.createdAt ?? "";

        const empty = await call({
            path: `/api/inbox/threads/${agreed}/messages`,
            method: "POST",
            cookie: ada.cookie,
            body: { body: "   " },
        });
        check("an empty message is refused", empty.status === 400, `got ${empty.status}`);

        const tooLong = await call({
            path: `/api/inbox/threads/${agreed}/messages`,
            method: "POST",
            cookie: ada.cookie,
            body: { body: "x".repeat(4001) },
        });
        check("an over-long message is refused", tooLong.status === 400, `got ${tooLong.status}`);

        const after = await call({ path: `/api/inbox/threads/${agreed}/messages`, cookie: bo.cookie });
        const afterMessages =
            (after.body as { messages?: Array<{ mine: boolean; senderLabel: string }> }).messages ?? [];
        check("the other side sees it", afterMessages.length === beforeCount + 1, `got ${afterMessages.length}`);
        check(
            "and sees it as theirs, not his own",
            afterMessages.at(-1)?.mine === false && afterMessages.at(-1)?.senderLabel === ada.domain,
            JSON.stringify(afterMessages.at(-1)),
        );
    }

    console.log("\npolling");
    {
        const idle = await call({
            path: `/api/inbox/threads/${agreed}/messages?since=${encodeURIComponent(sentAt)}`,
            cookie: ada.cookie,
        });
        const messages = (idle.body as { messages?: unknown[] }).messages ?? [];
        // The whole reason polling is affordable: a quiet thread answers empty.
        check("a poll after the newest message returns nothing", messages.length === 0, `got ${messages.length}`);

        const bad = await call({ path: `/api/inbox/threads/${agreed}/messages?since=yesterday`, cookie: ada.cookie });
        check("an unparseable cursor is rejected", bad.status === 400, `got ${bad.status}`);
    }

    console.log("\nunread and read cursors");
    {
        const before = await call({ path: "/api/inbox/threads", cookie: bo.cookie });
        const beforeThread = (
            (before.body as { threads?: Array<{ matchId: string; unread: number }> }).threads ?? []
        ).find((t) => t.matchId === agreed);
        check("Bo has an unread message waiting", (beforeThread?.unread ?? 0) > 0, `got ${beforeThread?.unread}`);

        const read = await call({ path: `/api/inbox/threads/${agreed}/read`, method: "POST", cookie: bo.cookie });
        check("marking a thread read succeeds", read.status === 200, `got ${read.status}`);

        const after = await call({ path: "/api/inbox/threads", cookie: bo.cookie });
        const afterThread = (
            (after.body as { threads?: Array<{ matchId: string; unread: number }> }).threads ?? []
        ).find((t) => t.matchId === agreed);
        check("and clears the badge", afterThread?.unread === 0, `got ${afterThread?.unread}`);
    }

    console.log("\naccepting");
    {
        const { waitingOnAda } = seed.matches;
        const before = await call({ path: `/api/inbox/threads/${waitingOnAda}`, cookie: ada.cookie });
        check(
            "the pane knows the ball is with Ada",
            (before.body as { thread?: { waitingOnMe?: boolean } }).thread?.waitingOnMe === true,
        );

        const accepted = await call({
            path: `/api/inbox/threads/${waitingOnAda}/respond`,
            method: "POST",
            cookie: ada.cookie,
            body: { accept: true },
        });
        check("accepting works", accepted.status === 200, `got ${accepted.status}: ${accepted.text.slice(0, 160)}`);

        const thread = (
            accepted.body as { thread?: { revealed?: boolean; canMessage?: boolean; partnerLabel?: string } }
        ).thread;
        check("the second acceptance reveals both sides", thread?.revealed === true);
        check("and the partner is now named", thread?.partnerLabel === cy.domain, thread?.partnerLabel);
        check("and messaging is open", thread?.canMessage === true);
    }

    console.log("\nplacement");
    {
        // What a member pastes here is rendered as a link on the PARTNER's
        // screen, so anything that is not an http(s) URL is refused outright
        // rather than stored as an inconclusive placement.
        const badScheme = await call({
            path: `/api/inbox/threads/${agreed}/placement`,
            method: "POST",
            cookie: ada.cookie,
            body: { pageUrl: "javascript:alert(1)" },
        });
        check(
            "a non-http page URL is refused",
            badScheme.status === 400,
            `got ${badScheme.status}: ${badScheme.text.slice(0, 120)}`,
        );

        // A localhost URL is refused by the SSRF guard in `lib/analyze`, which is
        // exactly the inconclusive path worth asserting: the placement is still
        // recorded, and the member is not accused of failing to place it.
        const placement = await call({
            path: `/api/inbox/threads/${agreed}/placement`,
            method: "POST",
            cookie: ada.cookie,
            body: { pageUrl: `${BASE}/`, anchorUsed: "deployment dashboard" },
        });
        check(
            "a placement report comes back",
            placement.status === 200,
            `got ${placement.status}: ${placement.text.slice(0, 160)}`,
        );

        const payload = placement.body as {
            report?: { status: string; inconclusive: boolean };
            thread?: { steps?: Array<{ step: string; status: string }> };
        };
        check(
            "an unreachable page is inconclusive, never a miss",
            payload.report?.inconclusive === true,
            JSON.stringify(payload.report),
        );
        const current = payload.thread?.steps?.find((s) => s.status === "current")?.step;
        check("and the rail moves on to the links step", current === "add_links", `got ${current}`);
    }

    console.log("\nclosed threads");
    {
        const view = await call({ path: `/api/inbox/threads/${expired}`, cookie: bo.cookie });
        check("an expired thread still opens", view.status === 200, `got ${view.status}`);
        check(
            "but refuses a message",
            (
                await call({
                    path: `/api/inbox/threads/${expired}/messages`,
                    method: "POST",
                    cookie: bo.cookie,
                    body: { body: "still there?" },
                })
            ).status === 409,
        );
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
