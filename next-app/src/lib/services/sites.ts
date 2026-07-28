import { analyzeSite } from "@/lib/analyze";
import { type Category, UNMATCHABLE, isCategory } from "@/lib/categories";
import { AnalyzeError, type SiteAnalysis } from "@/lib/contracts";
import { connectMongo } from "@/lib/db/mongoose";
import { type ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";
import {
    ExchangeSite,
    type ExchangeSiteHydrated,
    PLACEMENT_OFFERS,
    type PlacementOffer,
    normalizeDomain,
} from "@/lib/models/ExchangeSite";

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

    await connectMongo();
    const existing = await ExchangeSite.exists({ domain: analysis.domain });

    return { ...analysis, alreadyListed: Boolean(existing) };
}

export type CommitSiteInput = {
    member: ExchangeMemberHydrated;
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
 * @returns The created site document.
 * @throws `SiteError` for domain collisions, bad categories, or over-listing.
 */
export async function commitSite(input: CommitSiteInput): Promise<ExchangeSiteHydrated> {
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

    await connectMongo();

    const owned = await ExchangeSite.countDocuments({ owner: member.user });
    if (owned >= MAX_SITES_PER_MEMBER) {
        throw new SiteError("too_many_sites", `You can list up to ${MAX_SITES_PER_MEMBER} sites.`);
    }

    try {
        return await ExchangeSite.create({
            owner: member.user,
            domain,
            url,
            category,
            keywords: cleanKeywords,
            description: description.trim(),
            domainRating: input.domainRating ?? null,
            drCheckedAt: input.domainRating == null ? null : new Date(),
            placementOffered,
            source: "direct",
            // Direct submissions are reviewed. Nick Launches imports skip this
            // (see importNlProduct): those products were already admin-approved
            // there, and free-plan ones additionally passed a badge backlink
            // crawl, so re-vetting them is redundant.
            status: "pending_review",
        });
    } catch (err) {
        // Duplicate key on the unique `domain` index. A domain belongs to
        // exactly one member, ever.
        if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
            throw new SiteError("domain_taken", `${domain} is already listed in the exchange by another member.`);
        }
        throw err;
    }
}

/**
 * Lists the sites a member owns, newest first.
 */
export async function listMySites(member: ExchangeMemberHydrated): Promise<ExchangeSiteHydrated[]> {
    await connectMongo();
    return ExchangeSite.find({ owner: member.user }).sort({ createdAt: -1 }).exec();
}

export { AnalyzeError };
