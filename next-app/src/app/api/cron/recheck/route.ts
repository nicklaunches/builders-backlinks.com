import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { exchangeLinks, exchangeMatches, exchangeSites } from "@/lib/db/schema";
import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { notifyLinkRemoved } from "@/lib/email/notify";
import { GIVE_UP_AFTER_CHECKS, nextCheckAt } from "@/lib/exchange";
import { verifyLink } from "@/lib/verify";

/**
 * @file The daily maintenance run: expire stale matches, then recheck links.
 *
 * Two jobs, both time-based, both cheap, so they share one trigger rather than
 * spending a second cron slot. The expiry sweep runs first and is unrelated to
 * link verification; see the comment on it for why it exists.
 *
 * The recheck loop proper: day 7, day 30, then monthly for a live link, and a
 * tighter retry for one that is `promised` or `missing`. The schedule itself
 * lives in `nextCheckAt` (`lib/exchange.ts`), which is where the reasoning about
 * anchoring on the last check rather than the first sighting is written down.
 *
 * This is the half of the promise nobody else in the category makes. Verifying
 * a link the day it goes in is easy and most competitors do some version of it.
 * Noticing six weeks later that it quietly came down is the part that makes the
 * record worth anything, and it only works if this actually runs.
 *
 * A REMOVAL IS NOT AN ACCUSATION. Links come down for ordinary reasons: a
 * redesign, a moved page, a CMS migration. Both sides are told, in those terms.
 * The member who lost the link usually did not mean to, and the member who lost
 * the benefit is the one who most needs to know.
 *
 * Inconclusive is not the same as removed. A crawl that fails (timeout, a block
 * page, a site briefly down) leaves the link alone and tries again next run.
 * Marking a live link removed because a fetch flaked would be the worst bug
 * this file could have: it would email two people to say someone broke a
 * promise they kept.
 */

export const maxDuration = 60;

/** Kept small so one run cannot exhaust the send quota or the function budget. */
const BATCH = 40;

export async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    const now = new Date();

    // ---------------------------------------------------------------------
    // Expire stale matches first.
    //
    // `expiresAt` was written on every match from the day matching shipped and
    // then never compared against anything, so no match had ever actually
    // expired and the state was decoration. That is worse than cosmetic: the
    // weekly digest SKIPS any member holding an open match
    // (`OPEN_STATES` in the digest route), so a single proposal nobody ever
    // answered silently ended that member's digest permanently. They stopped
    // hearing from us and there was no way for them to find out why.
    //
    // Expiring returns both sites to the pool, since matching only excludes
    // partners with a live match, and lets the digest reach the member again.
    // `declined` and `placed` are terminal and deliberately excluded: a placed
    // match has real links behind it and must never be reopened by a clock.
    // ---------------------------------------------------------------------
    const expired = await db()
        .update(exchangeMatches)
        .set({ state: "expired", updatedAt: now })
        .where(
            and(
                inArray(exchangeMatches.state, ["proposed", "a_accepted", "b_accepted", "agreed"]),
                lt(exchangeMatches.expiresAt, now),
            ),
        )
        .returning({ id: exchangeMatches.id });

    if (expired.length > 0) {
        console.log(`recheck: expired ${expired.length} match(es) past their deadline`);
    }

    // Oldest checked first, so a backlog drains fairly rather than starving the
    // links that have waited longest. NULLS FIRST is explicit: a link that has
    // never been checked has waited longest of all, and an ascending sort in
    // Postgres would otherwise put it at the very back of the queue.
    //
    // `promised` is in the set because a first report whose crawl was
    // inconclusive lands there, and nothing else ever looks at it again.
    //
    // The second clause drops links `nextCheckAt` has given up on. It is the
    // same predicate, expressed here rather than left to the filter below, and
    // it has to be: this ordering puts the never-confirmable links at the very
    // front of the queue forever, so filtering them in JavaScript would still
    // spend the whole window fetching them. Written as the negation of "never
    // live AND out of attempts" so it reads next to the rule it mirrors.
    const candidates = await db()
        .select()
        .from(exchangeLinks)
        .where(
            and(
                inArray(exchangeLinks.status, ["promised", "live", "missing"]),
                or(isNotNull(exchangeLinks.firstSeenAt), lt(exchangeLinks.checkCount, GIVE_UP_AFTER_CHECKS)),
            ),
        )
        .orderBy(sql`${exchangeLinks.lastCheckedAt} asc nulls first`)
        .limit(BATCH * 3);

    const due = candidates
        .filter((link) => {
            const at = nextCheckAt(link);
            return at === null ? false : at <= now;
        })
        .slice(0, BATCH);

    let checked = 0;
    let removed = 0;
    let inconclusive = 0;

    for (const link of due) {
        if (!link.pageUrl) continue;

        const sites = await db()
            .select()
            .from(exchangeSites)
            .where(inArray(exchangeSites.id, [link.fromSiteId, link.toSiteId]));
        const hostSite = sites.find((s) => s.id === link.fromSiteId);
        const beneficiarySite = sites.find((s) => s.id === link.toSiteId);
        if (!hostSite || !beneficiarySite) continue;

        const result = await verifyLink({
            pageUrl: link.pageUrl,
            targetDomain: beneficiarySite.domain,
        });
        checked++;

        // Every branch below writes these three, so they are the base of each patch.
        const touched = {
            lastCheckedAt: now,
            checkCount: link.checkCount + 1,
            lastMessage: result.message,
            updatedAt: now,
        };

        if (result.error !== null) {
            // Inconclusive. Leave the status alone and try again next run.
            inconclusive++;
            await db().update(exchangeLinks).set(touched).where(eq(exchangeLinks.id, link.id));
            continue;
        }

        if (result.found) {
            // Stamp `firstSeenAt` the first time a link is confirmed live, the
            // same as `markLinkPlaced` does. A `promised` link whose first report
            // was inconclusive — the client-rendered case this file keeps naming
            // — only ever gets confirmed here, and leaving `firstSeenAt` null
            // while moving it to `live` is a trap: `nextCheckAt` gives up on a
            // link that has NEVER been confirmed live once it passes
            // GIVE_UP_AFTER_CHECKS, so a genuinely live link would fall out of
            // the schedule and stop being rechecked, which is the one thing this
            // job exists never to do. A later miss must not move the timestamp,
            // so it is only filled when unset.
            await db()
                .update(exchangeLinks)
                .set({
                    ...touched,
                    status: "live",
                    placement: result.placement,
                    rel: [...result.rel],
                    ...(link.firstSeenAt ? {} : { firstSeenAt: now }),
                })
                .where(eq(exchangeLinks.id, link.id));
            continue;
        }

        // Confirmed absent. `removed` is reserved for a link that WAS live and
        // then went away: it is the word the ledger and the email both use, and
        // it carries a `removedAt`. A link that has never been confirmed live
        // has nothing to have been removed, so it goes to `missing` instead and
        // stays in the retry schedule until it runs out of attempts. Before
        // `promised` and `missing` were rechecked at all, only live links could
        // reach this branch and the distinction could not come up.
        const wasLive = link.status === "live";
        await db()
            .update(exchangeLinks)
            .set(wasLive ? { ...touched, status: "removed", removedAt: now } : { ...touched, status: "missing" })
            .where(eq(exchangeLinks.id, link.id));

        if (wasLive) {
            removed++;
            // Nothing to decrement: standing is a COUNT over links that are
            // live right now (`services/standing.ts`), so writing `removed`
            // above has already changed it. The counter columns this used to
            // maintain are what issue #6 was about.
            void notifyLinkRemoved({
                matchId: link.matchId,
                hostSite,
                beneficiarySite,
                pageUrl: link.pageUrl,
                anchorText: link.anchorText,
                firstSeenAt: link.firstSeenAt,
                removedAt: now,
            });
        }
    }

    return NextResponse.json({ expired: expired.length, due: due.length, checked, removed, inconclusive });
}
