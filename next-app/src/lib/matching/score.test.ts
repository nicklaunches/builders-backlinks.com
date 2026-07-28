import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MatchableSite, ScoreContext } from "@/lib/contracts";

import { findBestPartner } from "./index";
import { PENALTY_ALREADY_MATCHED, RECIPROCITY_NEUTRAL, scoreCandidate } from "./score";

/**
 * @file Tests for the pair scorer, written against `node:test` and `node:assert`.
 *
 * No test framework dependency on purpose. This module is pure by design, so
 * the tests should be runnable with nothing but a Node binary. The day they
 * need a runner, a config file and a transform pipeline is the day someone
 * stops running them.
 *
 * These lock down the behaviours we deliberately changed from the reference
 * implementation, because every one of them is a rule a well meaning refactor
 * would otherwise "simplify" straight back out: DR proximity beating DR height,
 * new members not being punished for being new, and already-matched pairs being
 * deprioritised rather than excluded.
 */

const NOW = new Date("2026-07-27T12:00:00.000Z");

function site(overrides: Partial<MatchableSite> = {}): MatchableSite {
    return {
        id: "site-a",
        ownerId: "owner-a",
        category: "SEO",
        keywords: ["seo audit", "backlinks", "serp tracking"],
        domainRating: 20,
        // Null by default, so every existing case exercises the
        // `trueDr ?? domainRating` fallback that a site without a TrueDR takes.
        // Cases that care about TrueDR specifically override it.
        trueDr: null,
        placementOffered: "blog_post",
        linksGiven: 2,
        linksGot: 2,
        lastMatchedAt: null,
        ...overrides,
    };
}

function ctx(overrides: Partial<ScoreContext> = {}): ScoreContext {
    return {
        alreadyMatched: new Set<string>(),
        previouslyDeclined: new Set<string>(),
        widened: false,
        now: NOW,
        ...overrides,
    };
}

describe("scoreCandidate rejections", () => {
    it("rejects a candidate owned by the same member", () => {
        const subject = site({ id: "a", ownerId: "owner-1" });
        const candidate = site({ id: "b", ownerId: "owner-1" });

        const score = scoreCandidate(subject, candidate, ctx());

        assert.equal(score.rejected, "same_owner");
        assert.equal(score.total, 0);
        assert.equal(score.category, 0);
    });

    it("rejects the subject appearing in its own candidate pool", () => {
        const subject = site({ id: "a", ownerId: "owner-1" });

        assert.equal(scoreCandidate(subject, subject, ctx()).rejected, "same_owner");
    });

    it("rejects an unmatchable category on either side", () => {
        const subject = site({ id: "a", ownerId: "owner-1", category: "Other" });
        const candidate = site({ id: "b", ownerId: "owner-2", category: "SEO" });

        assert.equal(scoreCandidate(subject, candidate, ctx()).rejected, "unmatchable_category");
        assert.equal(scoreCandidate(candidate, subject, ctx()).rejected, "unmatchable_category");
    });

    it("rejects categories that are neither equal nor adjacent", () => {
        const subject = site({ id: "a", ownerId: "owner-1", category: "SEO" });
        const candidate = site({ id: "b", ownerId: "owner-2", category: "Food & Drink" });

        assert.equal(scoreCandidate(subject, candidate, ctx()).rejected, "no_category_overlap");
    });

    it("accepts an adjacent category and scores it below an exact one", () => {
        const subject = site({ id: "a", ownerId: "owner-1", category: "SEO" });
        const exact = site({ id: "b", ownerId: "owner-2", category: "SEO" });
        const adjacent = site({ id: "c", ownerId: "owner-3", category: "Marketing" });

        const exactScore = scoreCandidate(subject, exact, ctx());
        const adjacentScore = scoreCandidate(subject, adjacent, ctx());

        assert.equal(exactScore.rejected, null);
        assert.equal(adjacentScore.rejected, null);
        assert.ok(exactScore.category > adjacentScore.category);
    });

    it("treats adjacency as symmetric even where the map only lists one direction", () => {
        const subject = site({ id: "a", ownerId: "owner-1", category: "Lifestyle" });
        const candidate = site({ id: "b", ownerId: "owner-2", category: "Sustainability" });

        assert.equal(scoreCandidate(subject, candidate, ctx()).rejected, null);
    });
});

describe("DR band fit", () => {
    it("scores a DR 5 / DR 70 pair far below a DR 20 / DR 25 pair", () => {
        const wideSubject = site({ id: "a", ownerId: "owner-1", domainRating: 5 });
        const wideCandidate = site({ id: "b", ownerId: "owner-2", domainRating: 70 });
        const tightSubject = site({ id: "c", ownerId: "owner-3", domainRating: 20 });
        const tightCandidate = site({ id: "d", ownerId: "owner-4", domainRating: 25 });

        const wide = scoreCandidate(wideSubject, wideCandidate, ctx());
        const tight = scoreCandidate(tightSubject, tightCandidate, ctx());

        assert.ok(wide.drBand < 5, `expected a wide band to score poorly, got ${wide.drBand}`);
        assert.ok(tight.drBand > 20, `expected a tight band to score well, got ${tight.drBand}`);
        assert.ok(
            tight.total - wide.total > 15,
            `expected a material gap between tight and wide bands, got ${tight.total - wide.total}`,
        );
    });

    it("means the same thing at the top of the DR scale as at the bottom", () => {
        const low = scoreCandidate(
            site({ id: "a", ownerId: "owner-1", domainRating: 20 }),
            site({ id: "b", ownerId: "owner-2", domainRating: 25 }),
            ctx(),
        );
        const high = scoreCandidate(
            site({ id: "c", ownerId: "owner-3", domainRating: 70 }),
            site({ id: "d", ownerId: "owner-4", domainRating: 80 }),
            ctx(),
        );

        assert.ok(
            Math.abs(low.drBand - high.drBand) < 2,
            `expected comparable band fit, got ${low.drBand} vs ${high.drBand}`,
        );
    });

    it("treats a null DR as a neutral mid value rather than as zero", () => {
        const subject = site({ id: "a", ownerId: "owner-1", domainRating: null });
        const nearMid = site({ id: "b", ownerId: "owner-2", domainRating: 18 });
        const veryHigh = site({ id: "c", ownerId: "owner-3", domainRating: 90 });
        const veryLow = site({ id: "d", ownerId: "owner-4", domainRating: 0 });

        const mid = scoreCandidate(subject, nearMid, ctx());
        const high = scoreCandidate(subject, veryHigh, ctx());
        const low = scoreCandidate(subject, veryLow, ctx());

        // Unrated is unknown, not worthless: it bands with the middle of the
        // range, not with DR 0, and it is not shoved at the strongest sites.
        assert.ok(mid.drBand > high.drBand);
        assert.ok(mid.drBand > low.drBand);
        assert.ok(high.drBand < 5);
    });

    it("never claims a confirmed perfect band when a rating is only assumed", () => {
        const bothUnrated = scoreCandidate(
            site({ id: "a", ownerId: "owner-1", domainRating: null }),
            site({ id: "b", ownerId: "owner-2", domainRating: null }),
            ctx(),
        );
        const bothMeasured = scoreCandidate(
            site({ id: "c", ownerId: "owner-3", domainRating: 30 }),
            site({ id: "d", ownerId: "owner-4", domainRating: 30 }),
            ctx(),
        );

        assert.ok(bothUnrated.drBand > 0);
        assert.ok(bothUnrated.drBand < bothMeasured.drBand);
    });
});

describe("TrueDR overrides DR for banding", () => {
    it("bands on trueDr when it is present, ignoring a far-apart DR", () => {
        // DR says these two are miles apart. TrueDR says they are peers, and
        // TrueDR is the one that should decide.
        const subject = site({ id: "a", ownerId: "owner-1", domainRating: 5, trueDr: 24 });
        const candidate = site({ id: "b", ownerId: "owner-2", domainRating: 70, trueDr: 26 });

        const scored = scoreCandidate(subject, candidate, ctx());

        assert.ok(
            scored.drBand > 20,
            `expected a tight TrueDR band to score well despite the DR gap, got ${scored.drBand}`,
        );
    });

    it("falls back to domainRating when trueDr is null", () => {
        const withFallback = scoreCandidate(
            site({ id: "a", ownerId: "owner-1", domainRating: 20, trueDr: null }),
            site({ id: "b", ownerId: "owner-2", domainRating: 25, trueDr: null }),
            ctx(),
        );
        const withTrueDr = scoreCandidate(
            site({ id: "c", ownerId: "owner-3", domainRating: 99, trueDr: 20 }),
            site({ id: "d", ownerId: "owner-4", domainRating: 1, trueDr: 25 }),
            ctx(),
        );

        // Same effective band, reached two different ways, so the fallback is
        // not a degraded path: an unrated site stays fully matchable.
        assert.ok(Math.abs(withFallback.drBand - withTrueDr.drBand) < 0.01);
    });

    it("stops an inflated DR from buying a better partner", () => {
        // This is the whole reason TrueDR is stored. Someone inflates DR to 80
        // to look like a peer of a strong site, but their TrueDR is unchanged,
        // so the band must still read them as far apart.
        const strongSite = site({ id: "strong", ownerId: "owner-1", domainRating: 80, trueDr: 78 });
        const honestPeer = site({ id: "honest", ownerId: "owner-2", domainRating: 76, trueDr: 74 });
        const inflated = site({ id: "inflated", ownerId: "owner-3", domainRating: 80, trueDr: 9 });

        const honest = scoreCandidate(strongSite, honestPeer, ctx());
        const gamed = scoreCandidate(strongSite, inflated, ctx());

        assert.ok(
            honest.drBand - gamed.drBand > 15,
            `expected the inflated site to band far worse, got honest ${honest.drBand} vs gamed ${gamed.drBand}`,
        );
        assert.ok(honest.total > gamed.total, "an inflated DR must not win the match");
    });
});

describe("keyword overlap", () => {
    it("rewards shared anchors and ignores case and padding", () => {
        const subject = site({ id: "a", ownerId: "owner-1", keywords: ["SEO Audit", " backlinks "] });
        const overlapping = site({ id: "b", ownerId: "owner-2", keywords: ["seo audit", "backlinks"] });
        const unrelated = site({ id: "c", ownerId: "owner-3", keywords: ["rank tracker", "sitemap"] });

        assert.ok(scoreCandidate(subject, overlapping, ctx()).keywordOverlap > 10);
        assert.equal(scoreCandidate(subject, unrelated, ctx()).keywordOverlap, 0);
    });

    it("does not let keyword stuffing buy a full score", () => {
        const subject = site({ id: "a", ownerId: "owner-1", keywords: ["seo audit", "backlinks"] });
        const focused = site({ id: "b", ownerId: "owner-2", keywords: ["seo audit", "backlinks"] });
        const stuffed = site({
            id: "c",
            ownerId: "owner-3",
            keywords: ["seo audit", "backlinks", ...Array.from({ length: 20 }, (_, i) => `filler ${i}`)],
        });

        const focusedScore = scoreCandidate(subject, focused, ctx()).keywordOverlap;
        const stuffedScore = scoreCandidate(subject, stuffed, ctx()).keywordOverlap;

        assert.ok(stuffedScore > 0);
        assert.ok(stuffedScore < focusedScore);
    });
});

describe("placement fit", () => {
    it("ranks two concrete offers above one unsure above two unsure", () => {
        const subject = site({ id: "a", ownerId: "owner-1", placementOffered: "blog_post" });
        const concrete = scoreCandidate(
            subject,
            site({ id: "b", ownerId: "owner-2", placementOffered: "resources_page" }),
            ctx(),
        );
        const oneUnsure = scoreCandidate(
            subject,
            site({ id: "c", ownerId: "owner-3", placementOffered: "unsure" }),
            ctx(),
        );
        const bothUnsure = scoreCandidate(
            site({ id: "d", ownerId: "owner-4", placementOffered: "unsure" }),
            site({ id: "e", ownerId: "owner-5", placementOffered: "unsure" }),
            ctx(),
        );

        assert.ok(concrete.placementFit > oneUnsure.placementFit);
        assert.ok(oneUnsure.placementFit > bothUnsure.placementFit);
    });
});

describe("reciprocity health", () => {
    it("gives a brand new site a neutral score rather than a penalty", () => {
        const subject = site({ id: "a", ownerId: "owner-1" });
        const brandNew = site({ id: "b", ownerId: "owner-2", linksGiven: 0, linksGot: 0 });

        const score = scoreCandidate(subject, brandNew, ctx());

        assert.equal(score.reciprocityHealth, RECIPROCITY_NEUTRAL);
        assert.ok(score.reciprocityHealth > 0, "a new member must not be punished for having no history");
    });

    it("ranks a giver above a new site above a taker", () => {
        const subject = site({ id: "a", ownerId: "owner-1" });
        const giver = scoreCandidate(site(), site({ id: "b", ownerId: "owner-2", linksGiven: 6, linksGot: 2 }), ctx());
        const fresh = scoreCandidate(subject, site({ id: "c", ownerId: "owner-3", linksGiven: 0, linksGot: 0 }), ctx());
        const taker = scoreCandidate(subject, site({ id: "d", ownerId: "owner-4", linksGiven: 0, linksGot: 5 }), ctx());

        assert.ok(giver.reciprocityHealth > fresh.reciprocityHealth);
        assert.ok(fresh.reciprocityHealth > taker.reciprocityHealth);
        assert.equal(taker.reciprocityHealth, 0);
    });
});

describe("staleness", () => {
    it("gives a never-matched site the full bonus", () => {
        const score = scoreCandidate(site(), site({ id: "b", ownerId: "owner-2", lastMatchedAt: null }), ctx());

        assert.equal(score.staleness, 10);
    });

    it("surfaces a long-quiet member above one matched yesterday", () => {
        const yesterday = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
        const longAgo = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);

        const recent = scoreCandidate(site(), site({ id: "b", ownerId: "owner-2", lastMatchedAt: yesterday }), ctx());
        const quiet = scoreCandidate(site(), site({ id: "c", ownerId: "owner-3", lastMatchedAt: longAgo }), ctx());

        assert.ok(quiet.staleness > recent.staleness);
        assert.equal(quiet.staleness, 10);
    });
});

describe("penalties", () => {
    it("applies the widened penalty only to off-category candidates", () => {
        const subject = site({ id: "a", ownerId: "owner-1", category: "SEO" });
        const sameCategory = site({ id: "b", ownerId: "owner-2", category: "SEO" });
        const adjacent = site({ id: "c", ownerId: "owner-3", category: "Marketing" });

        assert.equal(scoreCandidate(subject, sameCategory, ctx({ widened: true })).penalties, 0);
        assert.equal(scoreCandidate(subject, adjacent, ctx({ widened: true })).penalties, -10);
        assert.equal(scoreCandidate(subject, adjacent, ctx({ widened: false })).penalties, 0);
    });

    it("stacks already-matched and previously-declined penalties", () => {
        const subject = site({ id: "a", ownerId: "owner-1" });
        const candidate = site({ id: "b", ownerId: "owner-2" });

        const score = scoreCandidate(
            subject,
            candidate,
            ctx({ alreadyMatched: new Set(["b"]), previouslyDeclined: new Set(["b"]) }),
        );

        assert.equal(score.penalties, -80);
        assert.equal(score.rejected, null, "penalised is not the same as rejected");
    });
});

describe("findBestPartner", () => {
    it("returns null when every candidate is rejected", () => {
        const subject = site({ id: "a", ownerId: "owner-1", category: "SEO" });
        const candidates = [
            site({ id: "b", ownerId: "owner-1" }),
            site({ id: "c", ownerId: "owner-2", category: "Other" }),
            site({ id: "d", ownerId: "owner-3", category: "Travel" }),
        ];

        assert.equal(findBestPartner(subject, candidates, ctx()), null);
    });

    it("returns null for an empty pool", () => {
        assert.equal(findBestPartner(site(), [], ctx()), null);
    });

    it("prefers a well banded partner over the highest DR one", () => {
        const subject = site({ id: "a", ownerId: "owner-1", domainRating: 12 });
        const wellBanded = site({ id: "b", ownerId: "owner-2", domainRating: 15 });
        const bigSite = site({ id: "c", ownerId: "owner-3", domainRating: 78 });

        const best = findBestPartner(subject, [bigSite, wellBanded], ctx());

        assert.ok(best !== null);
        assert.equal(best.candidate.id, "b");
    });

    it("deprioritises an already-matched candidate but still picks it when it is the only one", () => {
        const subject = site({ id: "a", ownerId: "owner-1" });
        const known = site({ id: "b", ownerId: "owner-2" });
        const fresh = site({ id: "c", ownerId: "owner-3" });
        const history = ctx({ alreadyMatched: new Set(["b"]) });

        const withAlternative = findBestPartner(subject, [known, fresh], history);
        assert.ok(withAlternative !== null);
        assert.equal(withAlternative.candidate.id, "c", "a fresh partner must win over a repeat");

        const onlyOption = findBestPartner(subject, [known], history);
        assert.ok(onlyOption !== null, "a repeat pair still beats sending nothing");
        assert.equal(onlyOption.candidate.id, "b");
        assert.equal(onlyOption.score.penalties, PENALTY_ALREADY_MATCHED);
        assert.equal(onlyOption.score.rejected, null);
    });

    it("breaks a total tie on higher DR, then on lower site id", () => {
        const subject = site({ id: "a", ownerId: "owner-1", domainRating: 30 });
        const lowerDr = site({ id: "z", ownerId: "owner-2", domainRating: 28 });
        const higherDr = site({ id: "y", ownerId: "owner-3", domainRating: 32 });

        const byDr = findBestPartner(subject, [lowerDr, higherDr], ctx());
        assert.ok(byDr !== null);
        assert.equal(byDr.candidate.id, "y");

        const twinA = site({ id: "b-second", ownerId: "owner-4", domainRating: 30 });
        const twinB = site({ id: "a-first", ownerId: "owner-5", domainRating: 30 });

        const byId = findBestPartner(subject, [twinA, twinB], ctx());
        assert.ok(byId !== null);
        assert.equal(byId.candidate.id, "a-first");
        assert.equal(byId.score.total, scoreCandidate(subject, twinA, ctx()).total);
    });

    it("is independent of the order candidates arrive in", () => {
        const subject = site({ id: "a", ownerId: "owner-1", domainRating: 25 });
        const pool = [
            site({ id: "b", ownerId: "owner-2", domainRating: 24, category: "Marketing" }),
            site({ id: "c", ownerId: "owner-3", domainRating: 90 }),
            site({ id: "d", ownerId: "owner-4", domainRating: 27, linksGiven: 4, linksGot: 1 }),
            site({ id: "e", ownerId: "owner-5", domainRating: null }),
            site({ id: "f", ownerId: "owner-6", domainRating: 27, linksGiven: 4, linksGot: 1 }),
        ];

        const forward = findBestPartner(subject, pool, ctx());
        const reversed = findBestPartner(subject, [...pool].reverse(), ctx());

        assert.ok(forward !== null);
        assert.ok(reversed !== null);
        assert.equal(forward.candidate.id, reversed.candidate.id);
        assert.equal(forward.score.total, reversed.score.total);
    });
});
