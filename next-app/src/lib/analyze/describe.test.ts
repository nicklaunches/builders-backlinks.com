import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { describeSite } from "@/lib/analyze/describe";
import type { PageExtract } from "@/lib/analyze/extract";
import { type AnalyzeErrorCode, analyzeFailureHint } from "@/lib/contracts";

/**
 * @file Guards how the description step fails, not what it writes.
 *
 * Written after a member could not list their site at all. The LLM call took
 * longer than its 30s budget, and three separate things turned one slow response
 * into a dead end: it was not retried, the abort was not translated, and
 * workerd's raw `DOMException: The operation was aborted due to timeout` was
 * concatenated straight into the sentence the member read.
 *
 * So these tests assert the two properties that would have caught it — a
 * transient failure is retried, and no raw abort text survives to the caller —
 * plus the inverse, that a permanent failure is NOT retried. That last one
 * matters because a retry on a bad API key is money spent to be told the same
 * thing twice.
 *
 * `globalThis.fetch` is stubbed rather than an HTTP server started: the unit
 * under test is the retry and translation logic, and a real socket would make
 * the timeout cases slow and flaky.
 */

const EXTRACT: PageExtract = {
    title: "Example",
    metaDescription: "An example page.",
    headings: ["What it does", "Pricing"],
    textSample: "A tool that does a thing for people who need that thing done.".repeat(5),
};

/** A well-formed OpenRouter envelope carrying a valid analysis. */
function okResponse(): Response {
    const content = JSON.stringify({
        category: "Developer Tools",
        description: "A tool for teams that need a thing done, described without naming it.",
        keywords: ["developer tooling"],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

/**
 * Exactly what workerd throws when `AbortSignal.timeout` fires.
 *
 * The name and message are the point of the fixture: the translation matches on
 * this text, so a test that threw a plain `new Error("timeout")` would pass
 * while the real runtime still leaked.
 */
function timeoutError(): Error {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    return err;
}

const realFetch = globalThis.fetch;
const realKey = process.env.OPENROUTER_API_KEY;
const realModel = process.env.OPENROUTER_ANALYZE_MODEL;

/** Installs a stub that answers each call from `steps`, in order. */
function stubFetch(steps: (() => Response | Promise<Response>)[]): { calls: () => number } {
    let calls = 0;
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = (async () => {
        const step = steps[calls] ?? steps[steps.length - 1];
        calls++;
        return step();
    }) as typeof fetch;
    return { calls: () => calls };
}

afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = realKey;
    if (realModel === undefined) delete process.env.OPENROUTER_ANALYZE_MODEL;
    else process.env.OPENROUTER_ANALYZE_MODEL = realModel;
});

describe("describeSite", () => {
    it("retries a timeout and reports it in words a member can read", async () => {
        const stub = stubFetch([
            () => {
                throw timeoutError();
            },
        ]);

        await assert.rejects(describeSite(EXTRACT, "example.com"), (err: Error) => {
            assert.equal(err.message, "the description service took too long");
            // The specific regression: this text used to reach the browser.
            assert.doesNotMatch(err.message, /aborted|DOMException/i);
            return true;
        });
        assert.equal(stub.calls(), 2, "a timeout should be attempted twice");
    });

    it("recovers when the provider fails once", async () => {
        const stub = stubFetch([() => new Response("upstream unavailable", { status: 503 }), okResponse]);

        const result = await describeSite(EXTRACT, "example.com");
        assert.equal(result.category, "Developer Tools");
        assert.equal(stub.calls(), 2);
    });

    it("does not retry a permanent failure", async () => {
        const stub = stubFetch([() => new Response("invalid api key", { status: 401 })]);

        await assert.rejects(describeSite(EXTRACT, "example.com"), /OpenRouter 401/);
        assert.equal(stub.calls(), 1, "a 401 will fail identically forever");
    });
});

describe("analyzeFailureHint", () => {
    it("has copy for every failure code", () => {
        // Both interfaces append this to the error message. A code with no hint
        // is a member left with nothing to do next, which is how the agent path
        // ended up silent on `llm_failed`.
        const codes: AnalyzeErrorCode[] = [
            "invalid_url",
            "unreachable",
            "not_html",
            "blocked",
            "too_thin",
            "llm_failed",
        ];
        for (const code of codes) {
            assert.ok(analyzeFailureHint(code).length > 0, `no hint for ${code}`);
        }
    });
});
