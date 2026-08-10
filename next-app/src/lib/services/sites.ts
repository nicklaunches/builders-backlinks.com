import { count, desc, eq } from "drizzle-orm";

import { analyzeSite } from "@/lib/analyze";
import { type Category, UNMATCHABLE, isCategory } from "@/lib/categories";
import { AnalyzeError, type LiveLinkCounts, type SiteAnalysis } from "@/lib/contracts";
import { db } from "@/lib/db";
import { type ExchangeMember, type ExchangeSite, exchangeMembers, exchangeSites } from "@/lib/db/schema";
import { notifySiteApproved, notifySiteRejected, notifySubmissionReceived } from "@/lib/email/notify";
import { PLACEMENT_OFFERS, type PlacementOffer, SITE_STATUSES, type SiteStatus, normalizeDomain } from "@/lib/exchange";
import { errorDetail } from "@/lib/log";
import { autoPair } from "@/lib/services/matches";
import { NO_LINKS, liveLinkCounts } from "@/lib/services/standing";

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
const MAX_SITES_PER_MEMBER = 10;

/**
 * Reduces a submitted anchor to the phrase it claims to be.
 *
 * An anchor ends up pasted into a partner's page, by an agent, as the label of a
 * real link, so the characters that close a markdown label or open a tag are
 * dropped here rather than escaped at every read site. Braces are in the set
 * because `{` opens a JSX expression in the `mdx` and `jsx` snippets.
 * `buildSnippet` escapes too, but only what it emits — an agent handed
 * `anchorOptions` writes its own markup, and this is the half that keeps the
 * payload out of the database at all. Nothing rewrites a stored anchor, so a
 * character admitted here is admitted for good.
 *
 * Exported for `sites.test.ts`, the same way `briefFor` is.
 */
export function anchorPhrase(raw: string): string {
    return raw
        .replace(/[<>[\](){}\\`"']/g, " ")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

export type SiteDraft = SiteAnalysis & {
    /** True when this domain is already listed, so the caller can stop early. */
    alreadyListed: boolean;
};

/**
 * Analyzes a URL and returns a proposed listing without writing anything.
 *
 * @throws `AnalyzeError` when the site cannot be reached or is too thin.
 */
export async function draftSite(rawUrl: string): Promise<SiteDraft> {
    const analysis = await analyzeSite(rawUrl);

    // Existence only: no need to hydrate a listing we will never show.
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
 * Domain Rating is carried through from the draft, which fetched it server-side,
 * rather than fetched twice — but it never originates outside the server. It is
 * the metric partners decide on, so a client-supplied value would be inflatable.
 *
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
    const cleanKeywords = keywords.map(anchorPhrase).filter(Boolean).slice(0, 25);
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

    // `ON CONFLICT DO NOTHING` rather than catching a driver error code: getting
    // nothing back unambiguously means somebody else holds the domain, and it is
    // race-safe where a check-then-insert would not be.
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
            // No path skips review, which is what /terms promises.
            status: "pending_review",
        })
        .onConflictDoNothing({ target: exchangeSites.domain })
        .returning();

    if (!created) {
        throw new SiteError("domain_taken", `${domain} is already listed in the exchange by another member.`);
    }

    // Fire and forget: the site exists whether or not the email goes out.
    void notifySubmissionReceived({ site: created });

    return created;
}

/**
 * Lists the sites a member owns, newest first, with their live link counts.
 *
 * The counts are spread OVER the row's own `links_given` / `links_got` columns,
 * which are stale and awaiting a drop.
 */
export async function listMySites(member: ExchangeMember): Promise<(ExchangeSite & LiveLinkCounts)[]> {
    const sites = await db()
        .select()
        .from(exchangeSites)
        .where(eq(exchangeSites.ownerId, member.userId))
        .orderBy(desc(exchangeSites.createdAt));

    const counts = await liveLinkCounts(sites.map((s) => s.id));
    return sites.map((site) => ({ ...site, ...(counts.get(site.id) ?? NO_LINKS) }));
}

/** A site plus the email of the member who submitted it. Admin views only. */
export type SiteForReview = ExchangeSite & { ownerEmail: string | null };

/**
 * Every site in a given status, newest first, with the submitter's email.
 *
 * Deliberately does NOT go through `services/mask.ts`: masking keeps members from
 * seeing each other before a match is agreed, and a reviewer judging whether a
 * listing is honest needs the domain and the person behind it.
 *
 * @param status - Omit to list every site regardless of status.
 */
export async function listSitesForReview(status?: SiteStatus): Promise<SiteForReview[]> {
    const rows = await db()
        .select({ site: exchangeSites, ownerEmail: exchangeMembers.email })
        .from(exchangeSites)
        .leftJoin(exchangeMembers, eq(exchangeMembers.userId, exchangeSites.ownerId))
        .where(status ? eq(exchangeSites.status, status) : undefined)
        .orderBy(desc(exchangeSites.createdAt));

    return rows.map((row) => ({ ...row.site, ownerEmail: row.ownerEmail ?? null }));
}

/**
 * Moves a site to a new status and tells its owner. The only writer of `status`.
 *
 * Approving pairs immediately: `autoPair` refuses anything that is not `active`,
 * so approval is the first moment the site can pair at all, and without the call
 * here it would wait a day for the re-pair pass. That pass is the guarantee;
 * this is only the fast path.
 *
 * KEEP THE CATCH, and keep it swallowing — the row is already committed, so
 * throwing would tell the reviewer an approval failed when it did not. Pairing
 * is awaited so its `match-proposed` email lands after the approval email.
 *
 * @param reviewNote - Reviewer's reason. Required in spirit for `rejected`.
 * @throws `SiteError` when the id matches nothing.
 */
export async function setSiteStatus(
    siteId: string,
    status: SiteStatus,
    reviewNote?: string,
    actorUserId?: string,
): Promise<ExchangeSite> {
    if (!(SITE_STATUSES as readonly string[]).includes(status)) {
        throw new SiteError("invalid", `"${status}" is not a site status.`);
    }

    const note = reviewNote?.trim();
    const now = new Date();
    const [updated] = await db()
        .update(exchangeSites)
        .set({
            status,
            updatedAt: now,
            // Written even with no actor: a status that moved without leaving a
            // `status_changed_at` behind did not move through here at all.
            statusChangedAt: now,
            statusChangedBy: actorUserId ?? null,
            // Approving must not erase the note explaining last month's rejection.
            ...(note ? { reviewNote: note } : {}),
        })
        .where(eq(exchangeSites.id, siteId))
        .returning();

    if (!updated) throw new SiteError("invalid", `No site with id ${siteId}.`);

    if (status === "active") {
        void notifySiteApproved({ site: updated });
        // Logged rather than dropped: nothing else observes whether approving a
        // site actually matched it.
        try {
            const pair = await autoPair(updated);
            console.log(
                pair.matched
                    ? `setSiteStatus: approved ${updated.domain} and matched it (${pair.match.id})`
                    : `setSiteStatus: approved ${updated.domain}, no match yet (${pair.reason} in ${pair.category})`,
            );
        } catch (err) {
            console.error(`setSiteStatus: autoPair failed after approving ${updated.domain}: ${errorDetail(err)}`);
        }
    } else if (status === "rejected") {
        void notifySiteRejected({ site: updated, reason: note ?? updated.reviewNote ?? null });
    }

    return updated;
}

export { AnalyzeError };
