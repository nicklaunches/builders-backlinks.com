import { and, count, eq, inArray } from "drizzle-orm";

import type { LiveLinkCounts } from "@/lib/contracts";
import { db } from "@/lib/db";
import { exchangeLinks } from "@/lib/db/schema";

/**
 * @file Give/get standing, counted rather than stored.
 *
 * This used to be two integer columns on `exchange_sites`, incremented by
 * `markLinkPlaced` and decremented by the recheck cron. Three write paths had to
 * agree for the numbers to mean anything, and two of them did not: the increment
 * was a read-modify-write, so two agents reporting at once both saw no row and
 * both counted; and `live -> missing` never decremented at all, so pulling a
 * link after it verified left the credit permanently. Standing feeds the
 * matcher's reciprocity term, which made both holes a way to pump your own
 * ratio.
 *
 * A count cannot drift, because there is no second place for the truth to live.
 * The link table already records exactly which links are live and in which
 * direction, and that record is maintained by the crawler rather than by
 * whoever remembered to adjust a counter. Do not put a cache in front of this:
 * the cache IS the bug that was removed.
 *
 * Cheap by construction. Both queries are covered by
 * `exchange_links_from_idx` / `exchange_links_to_idx`, and every caller resolves
 * a whole page of sites in one call rather than one per row.
 */

/** What a site with no live links in either direction scores. */
export const NO_LINKS: LiveLinkCounts = { linksGiven: 0, linksGot: 0 };

/**
 * Live link counts for a set of sites, keyed by site id.
 *
 * Sites with no live links are absent from the map rather than present as
 * zeroes, so callers should read through {@link NO_LINKS}.
 *
 * @param siteIds - The sites to count for. An empty list costs no query.
 */
export async function liveLinkCounts(siteIds: readonly string[]): Promise<Map<string, LiveLinkCounts>> {
    const counts = new Map<string, LiveLinkCounts>();
    if (siteIds.length === 0) return counts;

    const ids = [...new Set(siteIds)];

    const entry = (siteId: string): LiveLinkCounts => {
        const existing = counts.get(siteId);
        if (existing) return existing;
        const fresh = { ...NO_LINKS };
        counts.set(siteId, fresh);
        return fresh;
    };

    // Two grouped counts rather than one query with a UNION or a pair of
    // correlated subselects: each of these is a plain index scan on one column,
    // and the merge is cheaper in JavaScript than the plan the alternatives get.
    const [given, got] = await Promise.all([
        db()
            .select({ siteId: exchangeLinks.fromSiteId, n: count() })
            .from(exchangeLinks)
            .where(and(eq(exchangeLinks.status, "live"), inArray(exchangeLinks.fromSiteId, ids)))
            .groupBy(exchangeLinks.fromSiteId),
        db()
            .select({ siteId: exchangeLinks.toSiteId, n: count() })
            .from(exchangeLinks)
            .where(and(eq(exchangeLinks.status, "live"), inArray(exchangeLinks.toSiteId, ids)))
            .groupBy(exchangeLinks.toSiteId),
    ]);

    for (const row of given) entry(row.siteId).linksGiven = row.n;
    for (const row of got) entry(row.siteId).linksGot = row.n;

    return counts;
}

/**
 * Standing for a single site.
 *
 * A convenience over {@link liveLinkCounts} for the paths that hold one site.
 * Anything holding several must use the batch form; one query per row is how a
 * dashboard becomes slow without anybody noticing.
 */
export async function liveLinkCountsFor(siteId: string): Promise<LiveLinkCounts> {
    const counts = await liveLinkCounts([siteId]);
    return counts.get(siteId) ?? NO_LINKS;
}
