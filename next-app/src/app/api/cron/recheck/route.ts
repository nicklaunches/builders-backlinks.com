import { NextResponse } from "next/server";

import { connectMongo } from "@/lib/db/mongoose";
import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { notifyLinkRemoved } from "@/lib/email/notify";
import { ExchangeLink, nextCheckAt } from "@/lib/models/ExchangeLink";
import { ExchangeSite } from "@/lib/models/ExchangeSite";
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

    await connectMongo();
    const now = new Date();

    // Oldest checked first, so a backlog drains fairly rather than starving the
    // links that have waited longest.
    const candidates = await ExchangeLink.find({ status: { $in: ["live", "missing"] } })
        .sort({ lastCheckedAt: 1 })
        .limit(BATCH * 3)
        .exec();

    const due = candidates
        .filter((link) => {
            const at = nextCheckAt({
                status: link.status,
                firstSeenAt: link.firstSeenAt,
                checkCount: link.checkCount,
            });
            return at === null ? false : at <= now;
        })
        .slice(0, BATCH);

    let checked = 0;
    let removed = 0;
    let inconclusive = 0;

    for (const link of due) {
        if (!link.pageUrl) continue;

        const [hostSite, beneficiarySite] = await Promise.all([
            ExchangeSite.findById(link.fromSite).exec(),
            ExchangeSite.findById(link.toSite).exec(),
        ]);
        if (!hostSite || !beneficiarySite) continue;

        const result = await verifyLink({
            pageUrl: link.pageUrl,
            targetDomain: beneficiarySite.domain,
        });
        checked++;

        link.lastCheckedAt = now;
        link.checkCount = (link.checkCount ?? 0) + 1;
        link.lastMessage = result.message;

        if (result.error !== null) {
            // Inconclusive. Leave the status alone and try again next run.
            inconclusive++;
            await link.save();
            continue;
        }

        if (result.found) {
            link.status = "live";
            link.placement = result.placement;
            link.rel = [...result.rel];
            await link.save();
            continue;
        }

        // Genuinely gone, and it was live before.
        const wasLive = link.status === "live";
        link.status = "removed";
        link.removedAt = now;
        await link.save();

        if (wasLive) {
            removed++;
            // Reciprocity is derived from what is actually live, so the giver
            // loses the credit for a link that no longer exists.
            await ExchangeSite.updateOne({ _id: hostSite._id }, { $inc: { linksGiven: -1 } });
            await ExchangeSite.updateOne({ _id: beneficiarySite._id }, { $inc: { linksGot: -1 } });

            void notifyLinkRemoved({
                matchId: String(link.match),
                hostSite,
                beneficiarySite,
                pageUrl: link.pageUrl,
                anchorText: link.anchorText ?? null,
                firstSeenAt: link.firstSeenAt ?? null,
                removedAt: now,
            });
        }
    }

    return NextResponse.json({ due: due.length, checked, removed, inconclusive });
}
