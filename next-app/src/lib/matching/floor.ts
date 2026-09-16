import type { ExchangeSite } from "@/lib/db/schema";

/**
 * @file The Domain Rating floor: the one hard gate in matching.
 *
 * Everything else in `lib/matching` is a preference expressed as a score, and
 * `scoreDrBand` is the DR half of that — it rewards a small gap between two
 * sites and never refuses anybody. This module is the opposite and is kept
 * separate for that reason: a floor removes candidates from the pool, so it is
 * the only DR rule that can leave a member unmatched.
 *
 * TWO AXES, NOT ONE, and the split is the whole design. A site sets a floor,
 * which gates the sites we have a rating for, and separately says whether it
 * will take a site we could not rate at all. `domain_rating` being NULL means
 * VerifiedDR gave us no score, which is a measurement we are missing and not a
 * score of zero — folding it into the number would quietly turn "at least 30"
 * into "and nothing unmeasured", which is a different request. A member who
 * wants that says so with the second control.
 *
 * APPLIED IN BOTH DIRECTIONS, always through {@link mutuallyAcceptable}. A pool
 * filtered by one side's floor alone proposes matches the other side has
 * already said it does not want, and those come back as declines that read to
 * the member like the exchange ignoring their settings.
 */

/** What deciding a floor needs from a site row. Satisfied by `ExchangeSite`. */
export type DrGate = Pick<ExchangeSite, "domainRating" | "minPartnerDr" | "skipUnrated">;

/**
 * Whether `candidate` satisfies what `chooser` asked for. One direction only.
 *
 * An unrated candidate is decided by `skipUnrated` alone and never by the
 * floor, per the file header.
 */
export function acceptsPartner(chooser: DrGate, candidate: DrGate): boolean {
    if (candidate.domainRating === null) return !chooser.skipUnrated;
    return candidate.domainRating >= chooser.minPartnerDr;
}

/** Whether two sites each satisfy the other's floor. The rule matching applies. */
export function mutuallyAcceptable(a: DrGate, b: DrGate): boolean {
    return acceptsPartner(a, b) && acceptsPartner(b, a);
}

/** The highest floor anybody can set, and the top of {@link PoolCurve.rated}. */
export const MAX_FLOOR = 100;

/**
 * What a site's pool looks like at every floor it could set, as counts alone.
 *
 * A curve rather than one pair of numbers so the control that sets a floor can
 * answer instantly as the member moves it, without a round trip per keystroke
 * and without ever handing the browser a row: these are aggregates and name
 * nobody, which is the only form this may take. The unrated half sits outside
 * the arrays because no floor decides it — see the file header.
 */
export type PoolCurve = {
    /** Active sites in the pools this one draws from, whatever their DR. */
    total: number;
    /** How many of `total` have no DR measured at all. */
    unrated: number;
    /** Of the unrated, the ones whose own floor admits this site back. */
    unratedMutual: number;
    /** `rated[dr]` is how many rated candidates sit at DR `dr` or above. */
    rated: number[];
    /** `mutualRated[dr]` is how many of `rated[dr]` also admit this site back. */
    mutualRated: number[];
};

/**
 * Builds the curve for one site over its candidate pool.
 *
 * Counted per DR and then swept downward, so the whole curve costs one pass
 * over the pool rather than one per possible floor.
 */
export function buildPoolCurve(subject: DrGate, candidates: readonly DrGate[]): PoolCurve {
    const rated = new Array<number>(MAX_FLOOR + 1).fill(0);
    const mutualRated = new Array<number>(MAX_FLOOR + 1).fill(0);
    let unrated = 0;
    let unratedMutual = 0;

    for (const candidate of candidates) {
        const theyTakeUs = acceptsPartner(candidate, subject);
        if (candidate.domainRating === null) {
            unrated++;
            if (theyTakeUs) unratedMutual++;
            continue;
        }
        // A DR outside the column's range cannot exist, but a clamp here is
        // cheaper than an out-of-bounds write going unnoticed.
        const dr = Math.min(Math.max(candidate.domainRating, 0), MAX_FLOOR);
        rated[dr]!++;
        if (theyTakeUs) mutualRated[dr]!++;
    }

    for (let dr = MAX_FLOOR - 1; dr >= 0; dr--) {
        rated[dr]! += rated[dr + 1]!;
        mutualRated[dr]! += mutualRated[dr + 1]!;
    }

    return { total: candidates.length, unrated, unratedMutual, rated, mutualRated };
}

/** How many candidates this site would take at `floor`. */
export function admittedAt(curve: PoolCurve, floor: number, skipUnrated: boolean): number {
    return countAt(curve.rated, floor) + (skipUnrated ? 0 : curve.unrated);
}

/** How many of those would take this site back. The number that predicts a match. */
export function mutualAt(curve: PoolCurve, floor: number, skipUnrated: boolean): number {
    return countAt(curve.mutualRated, floor) + (skipUnrated ? 0 : curve.unratedMutual);
}

function countAt(counts: readonly number[], floor: number): number {
    const index = Math.min(Math.max(Math.round(floor), 0), MAX_FLOOR);
    return counts[index] ?? 0;
}
