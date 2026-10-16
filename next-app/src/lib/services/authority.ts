import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDomainRatings } from "@/lib/analyze/dr-checker";
import { db } from "@/lib/db";
import { exchangeSites } from "@/lib/db/schema";

/**
 * @file Keeping Domain Rating current, a batch at a time.
 *
 * DR was written once, at submission, and never again. It is the number
 * partners judge each other on, the number matching bands on and the number the
 * floor in `lib/matching/floor` gates on, so a listing submitted in July was
 * being matched in September on a score two months old, in the direction that
 * flatters whoever grew since.
 *
 * ONCE A DAY PER SITE, IN ONE CALL. The pass runs twice a day and takes up to
 * {@link REFRESH_BATCH} of the stalest active sites older than
 * {@link STALE_AFTER_DAYS}; the age filter is what makes the cadence per-site.
 * The DR checker answers the whole batch in a single `POST /dr` and has no per-minute
 * window or monthly quota, so there is nothing to pace against: the batch is
 * bounded by the sequential row writes below, not by the vendor.
 *
 * ONLY AN ANSWER IS WRITTEN. A reading (`ok`, zero included) replaces the
 * stored DR. `unrated` keeps whatever is stored, since a missing measurement
 * must never blank the number matching runs on, and stamps `dr_checked_at`.
 * `pending` (the DR checker is buying the domain, minutes away) and every failure write
 * nothing at all, so the site stays at the head of the queue and the next run,
 * twelve hours on, asks again. Retrying costs nothing now, which is why
 * `dr_checked_at` means "when the DR checker last answered" rather than "when we asked".
 */

/**
 * How old a reading has to be before this pass asks again.
 *
 * Eighteen hours rather than twenty-four: the schedule fires every twelve, and a
 * site stamped a few seconds into one run would otherwise miss the run a day
 * later by those few seconds and slip to every other day.
 */
export const STALE_AFTER_DAYS = 0.75;

/**
 * Sites per run. Comfortably above the whole active pool today, so one run
 * covers every due site, and far under the DR checker's 5,000-a-call ceiling.
 */
export const REFRESH_BATCH = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One site whose score moved. Logged, and returned so a manual run can read it. */
export type AuthorityChange = { domain: string; from: number | null; to: number };

export type AuthorityRefresh = {
    /** Sites this run picked up. */
    picked: number;
    /** Of those, the ones the DR checker had a reading for. */
    answered: number;
    /** The DR checker answered with no rating. Their stored scores are untouched. */
    unrated: number;
    /** The DR checker is still buying these. Nothing written; the next run asks again. */
    pending: number;
    /** No answer at all: the call failed, or the DR checker errored on the domain. Nothing written. */
    failed: number;
    /** Sites whose DR actually moved. */
    changes: AuthorityChange[];
    /** True when nothing was written. */
    dryRun: boolean;
};

/**
 * Re-reads DR for the stalest active sites.
 *
 * Only `active` sites are refreshed. A rejected or banned listing is never in a
 * pool, and a paused one is picked up by the ordinary cadence the moment it
 * comes back.
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
        unrated: 0,
        pending: 0,
        failed: 0,
        changes: [],
        dryRun: input.dryRun === true,
    };
    if (input.dryRun || due.length === 0) return result;

    const ratings = await getDomainRatings(due.map((site) => site.domain));
    if (ratings.status !== "ok") {
        result.failed = due.length;
        return result;
    }

    for (const site of due) {
        const answer = ratings.answers.get(site.domain);
        const now = new Date();

        if (answer?.status === "pending") {
            result.pending++;
            continue;
        }
        if (answer?.status === "unrated") {
            result.unrated++;
            await db()
                .update(exchangeSites)
                .set({ drCheckedAt: now, updatedAt: now })
                .where(eq(exchangeSites.id, site.id));
            continue;
        }
        if (answer?.status !== "ok") {
            result.failed++;
            continue;
        }

        result.answered++;
        if (answer.dr !== site.domainRating) {
            result.changes.push({ domain: site.domain, from: site.domainRating, to: answer.dr });
        }

        await db()
            .update(exchangeSites)
            .set({ domainRating: answer.dr, drCheckedAt: now, updatedAt: now })
            .where(eq(exchangeSites.id, site.id));
    }

    return result;
}
