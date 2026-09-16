import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getAuthorityScores } from "@/lib/analyze/verifieddr";
import { db } from "@/lib/db";
import { exchangeSites } from "@/lib/db/schema";

/**
 * @file Keeping Domain Rating current, a batch at a time.
 *
 * DR was written once, at submission, and never again. It is the number
 * partners judge each other on and the number the floor in `lib/matching/floor`
 * gates on, so a listing submitted in July was being matched in September on a
 * score two months old — in the direction that flatters whoever grew since.
 *
 * TWICE A WEEK PER SITE, NOT TWICE A WEEK IN ONE GO. The pass runs twice a day
 * and takes the {@link REFRESH_BATCH} stalest sites that are older than
 * {@link STALE_AFTER_DAYS}; the age filter is what makes the cadence per-site,
 * and the batch is what keeps one run inside VerifiedDR's sliding window of 60
 * requests a minute. A single weekly run over the whole pool would be one long
 * burst against that window and would grow into the Worker's limits as the
 * exchange does.
 *
 * WATCH THE MONTHLY QUOTA. A refresh costs one unit, or two for a site listed
 * on verifieddr.com. Ninety-five sites twice a week is roughly 820 units a
 * month before a single submission is counted, and the Pro plan is 1,000. If
 * the pool grows or the quota tightens, {@link STALE_AFTER_DAYS} is the one
 * number to raise: seven makes it weekly and halves the bill.
 *
 * A FAILED LOOKUP NEVER OVERWRITES A GOOD SCORE. `getAuthorityScores` answers
 * with nulls for every failure — a 402, a 429, a timeout — and writing those
 * would silently blank the number matching runs on. The row is left exactly as
 * it is and only `dr_checked_at` moves, which is why that column means "when we
 * last ASKED" rather than "when we last got an answer": stamping it either way
 * is what stops a permanently failing domain sitting at the head of the queue
 * and burning a unit on every run.
 */

/** How old a score has to be before this pass will spend a unit on it. */
export const STALE_AFTER_DAYS = 3.5;

/**
 * Sites per run.
 *
 * Twenty-four sites is at most forty-eight VerifiedDR calls, well inside their
 * sixty-a-minute window even though the loop below is sequential and so never
 * gets near it. Two runs a day at this size keeps a pool of ~165 sites on the
 * twice-weekly cadence.
 */
export const REFRESH_BATCH = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One site whose score moved. Logged, and returned so a manual run can read it. */
export type AuthorityChange = { domain: string; from: number | null; to: number };

export type AuthorityRefresh = {
    /** Sites this run picked up. */
    picked: number;
    /** Of those, the ones VerifiedDR answered for. */
    answered: number;
    /** Lookups that came back with nothing. Their stored scores are untouched. */
    failed: number;
    /** Sites whose DR actually moved. */
    changes: AuthorityChange[];
    /** True when nothing was written. */
    dryRun: boolean;
};

/**
 * Re-reads DR and TrueDR for the stalest active sites.
 *
 * Sequential on purpose: the calls are cheap and the pacing is free, while a
 * `Promise.all` over a batch is a burst at VerifiedDR's per-minute window for
 * no gain on a job nobody is waiting for.
 *
 * Only `active` sites are refreshed. A rejected or banned listing is never in a
 * pool, and a paused one is picked up by the ordinary cadence the moment it
 * comes back, so neither is worth a unit today.
 *
 * @param input.staleAfterDays - Pass 0 to take every active site regardless of
 *   age, which is what a manual backfill wants.
 */
export async function refreshAuthorityScores(input: {
    batch: number;
    staleAfterDays: number;
    dryRun?: boolean;
}): Promise<AuthorityRefresh> {
    const cutoff = new Date(Date.now() - input.staleAfterDays * DAY_MS);

    const due = await db()
        .select({
            id: exchangeSites.id,
            domain: exchangeSites.domain,
            domainRating: exchangeSites.domainRating,
            trueDr: exchangeSites.trueDr,
        })
        .from(exchangeSites)
        .where(
            and(
                eq(exchangeSites.status, "active"),
                or(isNull(exchangeSites.drCheckedAt), lt(exchangeSites.drCheckedAt, cutoff)),
            ),
        )
        // NULLS FIRST: a site that has never been scored is the stalest thing
        // in the table, and Postgres would otherwise bury it at the end.
        .orderBy(sql`${exchangeSites.drCheckedAt} asc nulls first`, asc(exchangeSites.createdAt))
        .limit(input.batch);

    const result: AuthorityRefresh = {
        picked: due.length,
        answered: 0,
        failed: 0,
        changes: [],
        dryRun: input.dryRun === true,
    };
    if (input.dryRun) return result;

    for (const site of due) {
        const scores = await getAuthorityScores(site.domain);
        const now = new Date();

        if (scores.domainRating === null) {
            result.failed++;
            // Asked, and got nothing. Stamp anyway, see the file header.
            await db()
                .update(exchangeSites)
                .set({ drCheckedAt: now, updatedAt: now })
                .where(eq(exchangeSites.id, site.id));
            continue;
        }

        result.answered++;
        if (scores.domainRating !== site.domainRating) {
            result.changes.push({ domain: site.domain, from: site.domainRating, to: scores.domainRating });
        }

        await db()
            .update(exchangeSites)
            .set({
                domainRating: scores.domainRating,
                trueDr: scores.trueDr,
                drCheckedAt: now,
                updatedAt: now,
            })
            .where(eq(exchangeSites.id, site.id));
    }

    return result;
}
