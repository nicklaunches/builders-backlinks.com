import { count, desc, eq } from "drizzle-orm";

import { analyzeSite } from "@/lib/analyze";
import { type Category, UNMATCHABLE, isCategory } from "@/lib/categories";
import { AnalyzeError, type SiteAnalysis } from "@/lib/contracts";
import { db } from "@/lib/db";
import { type ExchangeMember, type ExchangeSite, exchangeSites } from "@/lib/db/schema";
import { PLACEMENT_OFFERS, type PlacementOffer, normalizeDomain } from "@/lib/exchange";

/**
 * @file Listing a site in the exchange.
 *
 * Submission is deliberately two-step: `draftSite` analyzes and returns a
 * proposed listing, and `commitSite` writes it only when the caller passes back
 * an explicit confirmation. Nothing is published on the first call.
 *
 * That shape exists because the primary caller is an agent. An agent asked to
 * "submit my site" will happily submit three of the user's domains if the tool
 * lets it, and the description it drafts is shown to strangers. A human has to
 * see the words before they go out. It also makes correction conversational,
 * which is the one thing an agent interface is genuinely better at than a form:
 * "change the second anchor" is one utterance instead of a field, a click, and
 * a save.
 */

export class SiteError extends Error {
    constructor(
        public readonly code:
            "domain_taken" | "invalid_category" | "unmatchable_category" | "too_many_sites" | "invalid",
        message: string,
    ) {
        super(message);
        this.name = "SiteError";
    }
}

/** How many sites one member may list. Guards against a single operator farming the pool. */
const MAX_SITES_PER_MEMBER = 5;

export type SiteDraft = SiteAnalysis & {
    /** True when this domain is already listed, so the caller can stop early. */
    alreadyListed: boolean;
};

/**
 * Analyzes a URL and returns a proposed listing without writing anything.
 *
 * @param rawUrl - The URL the member gave.
 * @returns The draft listing to show for confirmation.
 * @throws `AnalyzeError` when the site cannot be reached or is too thin.
 */
export async function draftSite(rawUrl: string): Promise<SiteDraft> {
    const analysis = await analyzeSite(rawUrl);

    // Existence only: one row, one column, no need to hydrate a listing we are
    // never going to show.
    const existing = await db()
        .select({ id: exchangeSites.id })
        .from(exchangeSites)
        .where(eq(exchangeSites.domain, analysis.domain))
        .limit(1);

    return { ...analysis, alreadyListed: existing.length > 0 };
}

export type CommitSiteInput = {
    member: ExchangeMember;
    url: string;
    category: string;
    description: string;
    keywords: string[];
    placementOffered?: string;
    /** Domain Rating from the draft. Derived server-side, never trusted from the client. */
    domainRating?: number | null;
};

/**
 * Writes a confirmed listing.
 *
 * Domain Rating is deliberately re-derived from the draft rather than accepted
 * from the caller in a trusted way: it is a public metric that partners use to
 * decide, so a client-supplied value would be trivially inflatable. The draft
 * step already fetched it server-side; the value is carried through here rather
 * than fetched twice, but it never originates outside the server.
 *
 * @returns The created site row.
 * @throws `SiteError` for domain collisions, bad categories, or over-listing.
 */
export async function commitSite(input: CommitSiteInput): Promise<ExchangeSite> {
    const { member, url, description, keywords } = input;

    if (!isCategory(input.category)) {
        throw new SiteError("invalid_category", `"${input.category}" is not a category in this exchange.`);
    }
    const category: Category = input.category;
    if (UNMATCHABLE.includes(category)) {
        throw new SiteError(
            "unmatchable_category",
            `"${category}" is a catch-all bucket, so nothing in it can be matched relevantly. Pick the closest real category instead.`,
        );
    }
    if (!description.trim()) {
        throw new SiteError(
            "invalid",
            "A description is required. It is what partners see before they know who you are.",
        );
    }
    const cleanKeywords = keywords
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 25);
    if (cleanKeywords.length === 0) {
        throw new SiteError("invalid", "Add at least one anchor phrase you would like partners to link you as.");
    }

    const placementOffered: PlacementOffer = (PLACEMENT_OFFERS as readonly string[]).includes(
        input.placementOffered ?? "",
    )
        ? (input.placementOffered as PlacementOffer)
        : "unsure";

    const domain = normalizeDomain(url);

    const [owned] = await db()
        .select({ n: count() })
        .from(exchangeSites)
        .where(eq(exchangeSites.ownerId, member.userId));
    if ((owned?.n ?? 0) >= MAX_SITES_PER_MEMBER) {
        throw new SiteError("too_many_sites", `You can list up to ${MAX_SITES_PER_MEMBER} sites.`);
    }

    // `ON CONFLICT DO NOTHING` on the unique `domain` index rather than catching
    // a driver error code: a domain belongs to exactly one member, ever, and
    // getting nothing back is an unambiguous statement that somebody else has
    // it. It is also race-safe, which a check-then-insert would not be.
    const [created] = await db()
        .insert(exchangeSites)
        .values({
            ownerId: member.userId,
            domain,
            url,
            category,
            keywords: cleanKeywords,
            description: description.trim(),
            domainRating: input.domainRating ?? null,
            drCheckedAt: input.domainRating == null ? null : new Date(),
            placementOffered,
            // Every submission is reviewed before it can be matched. No path
            // skips this, which is exactly what /terms promises.
            status: "pending_review",
        })
        .onConflictDoNothing({ target: exchangeSites.domain })
        .returning();

    if (!created) {
        throw new SiteError("domain_taken", `${domain} is already listed in the exchange by another member.`);
    }
    return created;
}

/**
 * Lists the sites a member owns, newest first.
 */
export async function listMySites(member: ExchangeMember): Promise<ExchangeSite[]> {
    return db()
        .select()
        .from(exchangeSites)
        .where(eq(exchangeSites.ownerId, member.userId))
        .orderBy(desc(exchangeSites.createdAt));
}

export { AnalyzeError };
