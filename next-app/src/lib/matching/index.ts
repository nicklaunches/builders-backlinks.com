import type { FindBestPartner, MatchableSite, ScoreBreakdown } from "@/lib/contracts";

import { scoreCandidate } from "./score";

/**
 * @file Public surface of the matching engine.
 *
 * One entry point, {@link findBestPartner}, used by both callers: the
 * synchronous auto-pair on `submit_site` and the weekly cron. That is the whole
 * reason this module is pure. The moment matching needs a database connection,
 * the instant path grows a cheaper lookalike, the two drift, and a member's
 * first ever match stops resembling every match after it.
 *
 * Selection is deterministic all the way down. Given the same candidates in any
 * order, the same partner comes back every time, which is what makes the
 * behaviour testable at all and what makes a support question ("why did I get
 * matched with them?") answerable from the stored breakdown.
 */

/** Re-exported so callers never need to know the file layout: `scoreCandidate` plus every tuning constant. */
export * from "./score";

type Scored = { candidate: MatchableSite; score: ScoreBreakdown };

/**
 * Total ordering over scored candidates. Returns < 0 when `a` should win.
 *
 * Tie-breaks go total, then higher DR, then lower site id. The DR step is only
 * ever reached once the band fit already agrees, so it is not the old "biggest
 * site wins" rule sneaking back in: it just means that among genuinely equal
 * partners the stronger one is the better link. Site id is the final
 * tie-break purely because it is unique and stable, which makes the result
 * independent of the order the candidates arrived in.
 */
function compareScored(a: Scored, b: Scored): number {
    if (a.score.total !== b.score.total) return b.score.total - a.score.total;

    // An unrated site sorts last on this step only, never on the score itself.
    const aDr = a.candidate.domainRating ?? -1;
    const bDr = b.candidate.domainRating ?? -1;
    if (aDr !== bDr) return bDr - aDr;

    if (a.candidate.id === b.candidate.id) return 0;
    return a.candidate.id < b.candidate.id ? -1 : 1;
}

/**
 * Picks the best partner for a site from a candidate pool.
 *
 * Scores every candidate, drops the ones that must not be matched at all
 * (`rejected` non-null), and returns the highest remaining scorer with the
 * breakdown that produced it. Deprioritised candidates are deliberately still
 * eligible: in a thin category, re-matching a known partner beats sending
 * nothing.
 *
 * @param subject - The site we are finding a partner for.
 * @param candidates - Pool to choose from. May include the subject; it is rejected.
 * @param ctx - Match history, pool widening flag and the current time.
 * @returns The winning candidate with its breakdown, or `null` when the pool
 *   holds nobody eligible.
 */
export const findBestPartner: FindBestPartner = (subject, candidates, ctx) => {
    let best: Scored | null = null;

    for (const candidate of candidates) {
        const score = scoreCandidate(subject, candidate, ctx);
        if (score.rejected !== null) continue;

        const scored: Scored = { candidate, score };
        if (best === null || compareScored(scored, best) < 0) {
            best = scored;
        }
    }

    return best;
};
