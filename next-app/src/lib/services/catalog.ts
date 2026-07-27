import { CATEGORIES, type Category, UNMATCHABLE, WIDEN_BELOW } from "@/lib/categories";
import { connectMongo } from "@/lib/db/mongoose";
import { ExchangeSite } from "@/lib/models/ExchangeSite";

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
 * One aggregation for the whole catalog. Categories with no sites are still
 * returned, with zeroes, so the caller can render the full taxonomy without a
 * second source of truth.
 */
export async function getCategoryDepths(): Promise<CategoryDepth[]> {
    await connectMongo();

    const rows = await ExchangeSite.aggregate<{ _id: string; n: number; ratings: number[] }>([
        { $match: { status: "active" } },
        {
            $group: {
                _id: "$category",
                n: { $sum: 1 },
                // Nulls are filtered below rather than in the group, so an
                // unrated site still counts toward `n`.
                ratings: { $push: "$domainRating" },
            },
        },
    ]).exec();

    const byCategory = new Map(rows.map((r) => [r._id, r]));

    return CATEGORIES.filter((c) => !UNMATCHABLE.includes(c)).map((category) => {
        const row = byCategory.get(category);
        const rated = (row?.ratings ?? []).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
        return {
            category,
            activeSites: row?.n ?? 0,
            medianDomainRating: rated.length ? (rated[Math.floor(rated.length / 2)] ?? null) : null,
            open: (row?.n ?? 0) >= WIDEN_BELOW,
        };
    });
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
        summary: "A free, reciprocal link exchange for people shipping products. Free forever, no fees, no marketplace.",
        rules: Object.values(HOUSE_RULES),
    };
}
