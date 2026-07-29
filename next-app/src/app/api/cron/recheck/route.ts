import { eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { exchangeLinks, exchangeSites } from "@/lib/db/schema";
import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { notifyLinkRemoved } from "@/lib/email/notify";
import { nextCheckAt } from "@/lib/exchange";
import { verifyLink } from "@/lib/verify";

/**
 * @file The recheck loop: day 7, day 30, then monthly.
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

    // Oldest checked first, so a backlog drains fairly rather than starving the
    // links that have waited longest. NULLS FIRST is explicit: a link that has
    // never been checked has waited longest of all, and an ascending sort in
    // Postgres would otherwise put it at the very back of the queue.
    const candidates = await db()
        .select()
        .from(exchangeLinks)
        .where(inArray(exchangeLinks.status, ["live", "missing"]))
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
            await db()
                .update(exchangeLinks)
                .set({ ...touched, status: "live", placement: result.placement, rel: [...result.rel] })
                .where(eq(exchangeLinks.id, link.id));
            continue;
        }

        // Genuinely gone, and it was live before.
        const wasLive = link.status === "live";
        await db()
            .update(exchangeLinks)
            .set({ ...touched, status: "removed", removedAt: now })
            .where(eq(exchangeLinks.id, link.id));

        if (wasLive) {
            removed++;
            // Reciprocity is derived from what is actually live, so the giver
            // loses the credit for a link that no longer exists. Floored at
            // zero in SQL: the counters are non-negative by definition, and an
            // unmatched decrement would otherwise be permanent.
            await db()
                .update(exchangeSites)
                .set({ linksGiven: sql`greatest(${exchangeSites.linksGiven} - 1, 0)`, updatedAt: now })
                .where(eq(exchangeSites.id, hostSite.id));
            await db()
                .update(exchangeSites)
                .set({ linksGot: sql`greatest(${exchangeSites.linksGot} - 1, 0)`, updatedAt: now })
                .where(eq(exchangeSites.id, beneficiarySite.id));

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

    return NextResponse.json({ due: due.length, checked, removed, inconclusive });
}
