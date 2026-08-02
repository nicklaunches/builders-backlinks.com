import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAuthorityScores } from "@/lib/analyze/verifieddr";

/**
 * @file Guards the VerifiedDR response shape.
 *
 * This test exists because the bug it prevents already happened. The parser
 * guessed the key names right (`dr`, `trueDr`) and the container wrong, looking
 * at the top level and under `data` / `result` while the real payload nests
 * them under `lookup.authority`. Every lookup returned null, every submission
 * was stored with no Domain Rating, and nothing anywhere looked broken: the
 * module returns nulls on failure by design, so there was no error and no stack
 * trace, just a column that was quietly always empty.
 *
 * The fixture below is a real response, trimmed. If VerifiedDR moves the fields
 * again this fails in CI in a second, rather than after a month of empty DRs.
 *
 * It then happened a second time, differently. The container was right by then,
 * but the module was calling `/lookup/{domain}`, which only serves domains
 * approved on verifieddr.com, so almost every site 404'd and was stored with no
 * DR anyway. `/dr/{domain}` answers for any domain and is now the primary call,
 * which is why `DR_RESPONSE` is here: its `{"dr":{"dr":18}}` shape needs the
 * `["dr"]` container prefix, and without it the right key name still parses to
 * null.
 */

/** Real `GET /api/v1/lookup/nicklaunches.com`, 2026-07-29, tier `partner`. */
const REAL_RESPONSE = {
    lookup: {
        domain: "nicklaunches.com",
        slug: "nicklaunches-com",
        url: "https://nicklaunches.com",
        title: "Nick Launches",
        authority: {
            dr: 68,
            trueDr: 50,
            trustScore: 50,
            confidence: "medium",
            confidenceScore: 74,
            trafficValidated: true,
        },
        changes: { drWeeklyChange: 2, drMonthlyChange: 8 },
        evidence: { traffic: 2762, globalRank: 494749, referringDomains: 290, backlinks: 100317 },
        verified: true,
    },
};

/** Real `GET /api/v1/dr/aihub.group`, 2026-08-01. Ahrefs showed the same 18. */
const DR_RESPONSE = {
    dr: {
        domain: "aihub.group",
        dr: 18,
        source: "ahrefs",
        listed: false,
        slug: null,
    },
};

describe("parseAuthorityScores", () => {
    it("reads dr from the real /dr envelope", () => {
        // The bare `dr` key resolves to an OBJECT here, so this only works
        // because CONTAINER_PREFIXES carries a ["dr"] entry. Drop it and the
        // whole response silently parses to null with the key name still right.
        assert.deepEqual(parseAuthorityScores(DR_RESPONSE), { domainRating: 18, trueDr: null });
    });

    it("reads dr and trueDr from the real lookup.authority envelope", () => {
        // /lookup is still called for sites approved on verifieddr.com, because
        // it is the only source of TrueDR.
        assert.deepEqual(parseAuthorityScores(REAL_RESPONSE), { domainRating: 68, trueDr: 50 });
    });

    it("still reads a flattened payload, in case the envelope is ever dropped", () => {
        assert.deepEqual(parseAuthorityScores({ dr: 40, trueDr: 31 }), { domainRating: 40, trueDr: 31 });
    });

    it("returns nulls rather than guessing when the shape is unrecognised", () => {
        // The caller logs the real key names when this happens, which is how the
        // wrong container was eventually found.
        assert.deepEqual(parseAuthorityScores({ something: { else: 12 } }), { domainRating: null, trueDr: null });
        assert.deepEqual(parseAuthorityScores(null), { domainRating: null, trueDr: null });
        assert.deepEqual(parseAuthorityScores("not json"), { domainRating: null, trueDr: null });
    });

    it("does not mistake a nested unrelated number for a score", () => {
        // CONTAINER_PREFIXES is deliberately shallow. `evidence.traffic` is four
        // digits and would be a confidently wrong DR if this searched deeply.
        const noAuthority = { lookup: { evidence: { traffic: 2762, referringDomains: 290 } } };
        assert.deepEqual(parseAuthorityScores(noAuthority), { domainRating: null, trueDr: null });
    });

    it("clamps and rounds, since ExchangeSite validates 0-100", () => {
        assert.deepEqual(parseAuthorityScores({ lookup: { authority: { dr: 142.6, trueDr: -3 } } }), {
            domainRating: 100,
            trueDr: 0,
        });
    });

    it("accepts numeric strings", () => {
        assert.deepEqual(parseAuthorityScores({ lookup: { authority: { dr: "68", trueDr: "50" } } }), {
            domainRating: 68,
            trueDr: 50,
        });
    });
});
