import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExchangeSite } from "@/lib/db/schema";
import { toMaskedPartner, toRevealedPartner } from "@/lib/services/mask";

/**
 * @file The identity boundary, from the outside.
 *
 * `toRevealedPartner` is the one function that may put a domain in a payload,
 * and it refuses unless the match has actually reached the reveal. The cases
 * here pin down what "reached" means: mutual acceptance, and nothing that
 * happens to the match afterwards can undo it.
 */

const NO_LINKS = { linksGiven: 0, linksGot: 0 };

const site = {
    id: "site-1",
    category: "Developer Tools",
    description: "A tool.",
    domain: "partner.example",
    domainRating: 40,
    keywords: ["tooling"],
    placementOffered: "blog_post",
    url: "https://partner.example/",
} as ExchangeSite;

describe("toRevealedPartner", () => {
    it("refuses before mutual acceptance", () => {
        assert.throws(() => toRevealedPartner(site, NO_LINKS, "owner@partner.example", "a_accepted"));
        assert.throws(() => toRevealedPartner(site, NO_LINKS, "owner@partner.example", "expired", null));
    });

    it("still reveals a match that expired after it was agreed", () => {
        const agreedAt = new Date("2026-08-02T00:00:00Z");
        const partner = toRevealedPartner(site, NO_LINKS, "owner@partner.example", "expired", agreedAt);
        assert.equal(partner.domain, "partner.example");
        assert.equal(partner.email, "owner@partner.example");
    });

    it("never puts a domain in the masked view", () => {
        assert.equal("domain" in toMaskedPartner(site, NO_LINKS), false);
    });
});
