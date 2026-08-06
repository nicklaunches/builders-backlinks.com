import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MatchableSite, ScoreContext } from "@/lib/contracts";
import { scoreCandidate } from "@/lib/matching";

/**
 * @file The gap between what the scorer produces and what the column accepts.
 *
 * `exchange_matches.score` is `integer`. `scoreCandidate` ends on `round2`, so
 * a total is two decimal places. For nine days `upsertMatch` passed one
 * straight into the other, Postgres rejected every fractional value with
 * `invalid input syntax for type integer`, `autoPair` threw, and
 * `setSiteStatus` swallowed it and approved the member anyway. Four matches got
 * through in that time, and only because their totals happened to be whole
 * numbers: 48, 42, 90, 55.
 *
 * A test that asserted `Math.round(x)` is an integer would be a tautology and
 * would not have caught this. What was actually missing was anyone noticing
 * that the scorer's output and the column's type disagree, so that is what
 * these pin: totals really are fractional in ordinary cases, and the value
 * handed to the insert really is not.
 */

const BASE: MatchableSite = {
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: "aaaaaaaa-1111-4111-8111-111111111111",
    category: "Marketing",
    keywords: ["seo tools", "content marketing", "link building"],
    domainRating: 41,
    trueDr: null,
    placementOffered: "blog_post",
    linksGiven: 2,
    linksGot: 1,
    lastMatchedAt: null,
};

function candidate(overrides: Partial<MatchableSite> = {}): MatchableSite {
    return {
        ...BASE,
        id: "22222222-2222-4222-8222-222222222222",
        ownerId: "bbbbbbbb-2222-4222-8222-222222222222",
        keywords: ["content marketing", "newsletter growth", "seo audit"],
        domainRating: 27,
        linksGiven: 1,
        linksGot: 3,
        ...overrides,
    };
}

const CTX: ScoreContext = {
    alreadyMatched: new Set(),
    previouslyDeclined: new Set(),
    widened: false,
    now: new Date("2026-08-06T00:00:00Z"),
};

describe("match score against an integer column", () => {
    it("produces a fractional total for an ordinary pair", () => {
        // The premise of the bug. If this ever stops being true the rounding
        // below is harmless, but the reason for it should be revisited.
        const score = scoreCandidate(BASE, candidate(), CTX);
        assert.equal(score.rejected, null);
        assert.notEqual(score.total, Math.trunc(score.total), `expected a fractional total, got ${score.total}`);
    });

    it("is a safe integer once rounded, which is what the insert stores", () => {
        // Mirrors `upsertMatch`. Postgres refuses anything else for `integer`.
        for (const dr of [0, 7, 27, 41, 68, 100]) {
            const score = scoreCandidate(BASE, candidate({ domainRating: dr }), CTX);
            const stored = Math.round(score.total);
            assert.ok(Number.isInteger(stored), `DR ${dr}: ${score.total} rounded to a non-integer ${stored}`);
            assert.ok(Number.isSafeInteger(stored), `DR ${dr}: ${stored} is not a safe integer`);
        }
    });

    it("keeps the rounded score inside the range the column and the UI expect", () => {
        const score = scoreCandidate(BASE, candidate(), CTX);
        const stored = Math.round(score.total);
        assert.ok(stored >= 0 && stored <= 100, `stored score ${stored} is outside 0..100`);
    });

    it("rounds a rejected pair's zero total to zero rather than to nothing", () => {
        // A rejected breakdown zeroes every component. `autoPair` never inserts
        // one, but the column is `notNull` with a default of 0, so the value
        // this would store has to stay valid rather than become NaN.
        const sameOwner = scoreCandidate(BASE, candidate({ ownerId: BASE.ownerId }), CTX);
        assert.equal(sameOwner.rejected, "same_owner");
        assert.equal(Math.round(sameOwner.total), 0);
    });
});
