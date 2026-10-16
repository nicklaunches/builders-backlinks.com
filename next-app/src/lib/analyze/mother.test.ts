import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { getDomainRating, getDomainRatings } from "@/lib/analyze/mother";

/**
 * @file How the Mother client reads the service's answers.
 *
 * The bodies below are the shapes the live service returned on 2026-10-16. The
 * contract that matters is the split between an answer (`ok`, `unrated`,
 * `pending`) and no answer at all (`error`, `rate-limited`, `unconfigured`):
 * the authority refresh writes on the first and must write nothing on the rest.
 *
 * `fetch` is swapped on `globalThis` by hand, since there is no mocking library.
 */

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

/** Answers every `fetch` with `reply` and records what was asked. */
function respond(reply: Reply) {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
        return new Response(text, { status: reply.status ?? 200, headers: reply.headers });
    }) as typeof fetch;
}

const saved = { url: process.env.MOTHER_URL, token: process.env.MOTHER_TOKEN };
const quiet = { warn: console.warn, error: console.error };

beforeEach(() => {
    calls = [];
    process.env.MOTHER_URL = "https://mother.example.com/";
    process.env.MOTHER_TOKEN = "mth_test";
    console.warn = () => {};
    console.error = () => {};
});

afterEach(() => {
    globalThis.fetch = realFetch;
    // Assigning undefined to process.env stores the string "undefined".
    if (saved.url === undefined) delete process.env.MOTHER_URL;
    else process.env.MOTHER_URL = saved.url;
    if (saved.token === undefined) delete process.env.MOTHER_TOKEN;
    else process.env.MOTHER_TOKEN = saved.token;
    console.warn = quiet.warn;
    console.error = quiet.error;
});

describe("getDomainRatings", () => {
    it("posts the batch with the bearer token and keys answers by the spelling sent", async () => {
        respond({
            body: {
                count: 4,
                results: [
                    { domain: "aihub.group", dr: 15, status: "ok" },
                    { query: "WWW.Ahrefs.com", domain: "ahrefs.com", dr: 91, status: "ok" },
                    { domain: "fresh.example", dr: null, status: "pending" },
                    { domain: "not_a_domain", dr: null, status: "unrated" },
                ],
            },
        });

        const result = await getDomainRatings(["aihub.group", "WWW.Ahrefs.com", "fresh.example", "not_a_domain"]);

        assert.deepEqual(result, {
            status: "ok",
            answers: new Map([
                ["aihub.group", { status: "ok", dr: 15 }],
                ["WWW.Ahrefs.com", { status: "ok", dr: 91 }],
                ["fresh.example", { status: "pending" }],
                ["not_a_domain", { status: "unrated" }],
            ]),
        });
        const [{ url, init }] = calls;
        assert.equal(url, "https://mother.example.com/dr");
        assert.equal(init.method, "POST");
        assert.equal((init.headers as Record<string, string>).Authorization, "Bearer mth_test");
        assert.deepEqual(JSON.parse(String(init.body)), {
            domains: ["aihub.group", "WWW.Ahrefs.com", "fresh.example", "not_a_domain"],
        });
    });

    it("keeps a zero, which is a real reading", async () => {
        respond({ body: { results: [{ domain: "nobody.example", dr: 0, status: "ok" }] } });
        assert.equal(await getDomainRating("nobody.example"), 0);
    });

    it("reports a 429 with the server's Retry-After", async () => {
        respond({ status: 429, body: "", headers: { "Retry-After": "30" } });
        assert.deepEqual(await getDomainRatings(["ahrefs.com"]), { status: "rate-limited", retryAfterMs: 30_000 });
    });

    it("reports an allowlist 403 as an error, not as a domain with no rating", async () => {
        respond({ status: 403, body: "<html>403 Forbidden</html>" });
        assert.deepEqual(await getDomainRatings(["ahrefs.com"]), { status: "error" });
    });

    it("refuses a body in a shape it does not recognise rather than reading nulls out of it", async () => {
        respond({ body: { dr: { domain: "ahrefs.com", dr: 91 } } });
        assert.deepEqual(await getDomainRatings(["ahrefs.com"]), { status: "error" });
    });

    it("makes no call without config", async () => {
        process.env.MOTHER_TOKEN = "";
        respond({ body: { results: [] } });
        assert.deepEqual(await getDomainRatings(["ahrefs.com"]), { status: "unconfigured" });
        assert.equal(calls.length, 0);
    });
});

describe("getDomainRating", () => {
    it("is null for a domain Mother is still buying", async () => {
        respond({ body: { results: [{ domain: "fresh.example", dr: null, status: "pending" }] } });
        assert.equal(await getDomainRating("fresh.example"), null);
    });
});
