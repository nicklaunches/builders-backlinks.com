import { count, eq, isNull } from "drizzle-orm";

import { CATEGORIES, type Category, UNMATCHABLE, WIDEN_BELOW } from "@/lib/categories";
import { db } from "@/lib/db";
import { exchangeMembers, exchangeSites } from "@/lib/db/schema";

/**
 * @file Read-only catalog: what categories exist and how deep each pool is.
 *
 * These are the only anonymous surfaces on the MCP server. A visitor can see
 * whether anyone like them is here before handing over anything, which is the
 * question that actually decides whether they join. Nothing here identifies a
 * member: it is counts and medians only.
 */

export type CategoryDepth = {
    category: Category;
    /** Active sites in this exact category. */
    activeSites: number;
    /** Median Domain Rating among rated sites, or null when nothing is rated. */
    medianDomainRating: number | null;
    /**
     * Whether the category matches on its own or borrows from adjacent ones.
     * Surfaced honestly rather than hidden: "you would be first here" is a real
     * selling point in a matching product, because every later joiner in that
     * category matches with you.
     */
    open: boolean;
};

/**
 * Counts active sites and median DR per category.
 *
 * One query for the whole catalog, grouped in memory rather than in SQL. A
 * `GROUP BY` with `percentile_cont` would be the obvious translation of the old
 * aggregation, but it interpolates between the two middle values on an even
 * count where the previous implementation picked the upper one, so identical
 * data would start reporting a different median. The grouping is over active
 * sites only and returns two small columns, so doing it here costs nothing and
 * keeps the number stable across the storage change.
 *
 * Categories with no sites are still returned, with zeroes, so the caller can
 * render the full taxonomy without a second source of truth.
 */
export async function getCategoryDepths(): Promise<CategoryDepth[]> {
    const rows = await db()
        .select({ category: exchangeSites.category, domainRating: exchangeSites.domainRating })
        .from(exchangeSites)
        .where(eq(exchangeSites.status, "active"));

    // Nulls are kept in the count and filtered out of the ratings, so an
    // unrated site still counts toward the pool depth.
    const byCategory = new Map<Category, { n: number; ratings: number[] }>();
    for (const row of rows) {
        const bucket = byCategory.get(row.category) ?? { n: 0, ratings: [] };
        bucket.n += 1;
        if (row.domainRating !== null) bucket.ratings.push(row.domainRating);
        byCategory.set(row.category, bucket);
    }

    return CATEGORIES.filter((c) => !UNMATCHABLE.includes(c)).map((category) => {
        const row = byCategory.get(category);
        const rated = [...(row?.ratings ?? [])].sort((a, b) => a - b);
        return {
            category,
            activeSites: row?.n ?? 0,
            medianDomainRating: rated.length ? (rated[Math.floor(rated.length / 2)] ?? null) : null,
            open: (row?.n ?? 0) >= WIDEN_BELOW,
        };
    });
}

/**
 * How many people have actually joined.
 *
 * The one number the landing page is allowed to print, and it is read live on
 * every revalidation rather than stored anywhere, so it cannot drift away from
 * the truth the way a hardcoded figure does. Unsubscribed members are excluded
 * because they are out of matching entirely (see `exchange_members`), so
 * counting them would inflate the figure with people who are not participating.
 *
 * The caller decides how to present a small number, and is expected to print
 * nothing rather than a zero. See the header of the landing page.
 */
export async function getFounderCount(): Promise<number> {
    const [row] = await db().select({ n: count() }).from(exchangeMembers).where(isNull(exchangeMembers.unsubscribedAt));
    return row?.n ?? 0;
}

/**
 * The house rules, in the exact words members and their agents are held to.
 *
 * Exposed as an MCP tool and resource so an agent can read the rules before it
 * does anything, which is far cheaper than correcting it afterwards. The
 * placement rule in particular needs to be unambiguous: an agent that believes
 * footers are forbidden will refuse work the member is entitled to do.
 */
export const HOUSE_RULES = {
    realSitesOnly:
        "Real sites only. Pages that exist to hold links (link farms, thin doorway pages, content mills) are not matched. New sites are reviewed before they go active.",
    sameCategory:
        "Same category, or a closely adjacent one when a category is still thin. An off-topic link helps nobody and is what makes a link exchange look like a scheme.",
    oneForOne: "Every exchange is reciprocal: one relevant link each, out in the open, no money involved.",
    yourCallWhereItGoes:
        "Where the link goes is your call. We check every placement and tell BOTH sides exactly what was given and received (in content or in a footer, dofollow or nofollow, and the anchor used), but we never reject a placement. You and your partner decide what is fair.",
    weKeepChecking:
        "We verify on placement, then again at day 7, day 30, and monthly after that. If a link comes down, both parties are told.",
    hiddenUntilAgreed:
        "Your domain and email are never shown to anyone until you and a partner both accept. At that moment you are both revealed to each other and you talk directly.",
} as const;

export function getRules(): { rules: string[]; summary: string } {
    return {
        summary:
            "A free, reciprocal link exchange for people shipping products. Free forever, no fees, no marketplace.",
        rules: Object.values(HOUSE_RULES),
    };
}
