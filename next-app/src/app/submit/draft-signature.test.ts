import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { signDraft, verifyDraft } from "@/app/submit/draft-signature";

/**
 * @file The gate between the two halves of the browser submit.
 *
 * Worth testing for the same reason `admin.test.ts` is: it is short, and it is
 * the only thing standing between a forged form POST and a listing for a domain
 * this server never fetched. The cases that matter are the ones where a bug
 * ADMITS a value: a swapped URL, a missing signature, a Domain Rating edited
 * upward, or a verifier that answers "no signature, no problem".
 */

const original = process.env.AUTH_SECRET;

afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
});

const SECRET = "test-secret";
const URL_A = "https://example.com/";
const URL_B = "https://en.wikipedia.org/";

describe("verifyDraft", () => {
    it("accepts what signDraft produced", () => {
        process.env.AUTH_SECRET = SECRET;
        const signature = signDraft(URL_A, 42);
        assert.deepEqual(verifyDraft(URL_A, "42", signature), { url: URL_A, domainRating: 42 });
    });

    it("accepts an unrated draft", () => {
        process.env.AUTH_SECRET = SECRET;
        const signature = signDraft(URL_A, null);
        assert.deepEqual(verifyDraft(URL_A, "", signature), { url: URL_A, domainRating: null });
    });

    it("rejects a URL swapped for one this server never drafted", () => {
        process.env.AUTH_SECRET = SECRET;
        // The whole point: a signature minted for a domain the submitter owns
        // must not commit a listing for somebody else's.
        const signature = signDraft(URL_A, null);
        assert.equal(verifyDraft(URL_B, "", signature), null);
    });

    it("rejects a Domain Rating edited after signing", () => {
        process.env.AUTH_SECRET = SECRET;
        const signature = signDraft(URL_A, 3);
        assert.equal(verifyDraft(URL_A, "97", signature), null);
    });

    it("rejects a missing signature", () => {
        process.env.AUTH_SECRET = SECRET;
        assert.equal(verifyDraft(URL_A, "42", ""), null);
    });

    it("rejects a wrong signature of the right length", () => {
        process.env.AUTH_SECRET = SECRET;
        const signature = signDraft(URL_A, 42);
        const flipped = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
        assert.equal(verifyDraft(URL_A, "42", flipped), null);
    });

    it("rejects a signature minted under a different secret", () => {
        process.env.AUTH_SECRET = SECRET;
        const signature = signDraft(URL_A, 42);
        process.env.AUTH_SECRET = "another-secret";
        assert.equal(verifyDraft(URL_A, "42", signature), null);
    });

    it("refuses to verify anything when AUTH_SECRET is unset", () => {
        delete process.env.AUTH_SECRET;
        assert.throws(() => verifyDraft(URL_A, "42", "whatever"), /AUTH_SECRET/);
    });
});
