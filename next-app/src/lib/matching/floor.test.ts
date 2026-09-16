import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    type DrGate,
    acceptsPartner,
    admittedAt,
    buildPoolCurve,
    mutualAt,
    mutuallyAcceptable,
} from "@/lib/matching/floor";

/**
 * @file The floor is the only matching rule that can empty a member's pool.
 *
 * Every case here is one a bug would silently pass: admitting a site the member
 * asked us to keep out, or keeping out one they never asked about.
 */

const OPEN: DrGate = { domainRating: 40, minPartnerDr: 0, skipUnrated: false };

function site(overrides: Partial<DrGate> = {}): DrGate {
    return { ...OPEN, ...overrides };
}

describe("acceptsPartner", () => {
    it("takes anyone by default", () => {
        assert.equal(acceptsPartner(site(), site({ domainRating: 0 })), true);
        assert.equal(acceptsPartner(site(), site({ domainRating: null })), true);
    });

    it("refuses a rated site under the floor and takes one on it", () => {
        const picky = site({ domainRating: 66, minPartnerDr: 30 });
        assert.equal(acceptsPartner(picky, site({ domainRating: 29 })), false);
        assert.equal(acceptsPartner(picky, site({ domainRating: 30 })), true);
    });

    it("decides an unrated site by the second control, never by the floor", () => {
        // A missing score is a measurement we did not get, not a zero.
        assert.equal(acceptsPartner(site({ minPartnerDr: 30 }), site({ domainRating: null })), true);
        assert.equal(acceptsPartner(site({ skipUnrated: true }), site({ domainRating: null })), false);
    });
});

describe("mutuallyAcceptable", () => {
    it("refuses a pair when either side's floor is not met", () => {
        const high = site({ domainRating: 66, minPartnerDr: 30 });
        const low = site({ domainRating: 12, minPartnerDr: 0 });
        assert.equal(mutuallyAcceptable(high, low), false);
        assert.equal(mutuallyAcceptable(low, high), false);
    });

    it("pairs two sites that each clear the other", () => {
        const a = site({ domainRating: 66, minPartnerDr: 30 });
        // Their floor is above his DR, so wanting them is not enough.
        assert.equal(mutuallyAcceptable(a, site({ domainRating: 40, minPartnerDr: 70 })), false);
        assert.equal(mutuallyAcceptable(a, site({ domainRating: 40, minPartnerDr: 60 })), true);
    });
});

describe("buildPoolCurve", () => {
    const subject = site({ domainRating: 66, minPartnerDr: 0 });
    const pool = [
        site({ domainRating: 10, minPartnerDr: 0 }),
        site({ domainRating: 30, minPartnerDr: 0 }),
        site({ domainRating: 80, minPartnerDr: 70 }), // Wants better than DR 66.
        site({ domainRating: null, minPartnerDr: 0 }),
    ];

    it("counts every floor at once, cumulatively", () => {
        const curve = buildPoolCurve(subject, pool);
        assert.equal(curve.total, 4);
        assert.equal(curve.unrated, 1);
        assert.equal(admittedAt(curve, 0, false), 4);
        assert.equal(admittedAt(curve, 30, false), 3);
        assert.equal(admittedAt(curve, 31, false), 2);
        // Above every rated site, the unrated one is all that is left.
        assert.equal(admittedAt(curve, 100, false), 1);
    });

    it("drops the unrated from both halves when they are skipped", () => {
        const curve = buildPoolCurve(subject, pool);
        assert.equal(admittedAt(curve, 0, true), 3);
        assert.equal(admittedAt(curve, 30, true), 2);
    });

    it("counts a partner whose own floor refuses this site as admitted, never mutual", () => {
        // The DR 80 site is the point: wanted, and not available.
        const curve = buildPoolCurve(subject, pool);
        assert.equal(admittedAt(curve, 70, false), 2);
        assert.equal(mutualAt(curve, 70, false), 1);
        assert.equal(mutualAt(curve, 70, true), 0);
    });
});
