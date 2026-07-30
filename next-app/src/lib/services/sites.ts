import { count, desc, eq } from "drizzle-orm";

import { analyzeSite } from "@/lib/analyze";
import { type Category, UNMATCHABLE, isCategory } from "@/lib/categories";
import { AnalyzeError, type SiteAnalysis } from "@/lib/contracts";
import { db } from "@/lib/db";
import { type ExchangeMember, type ExchangeSite, exchangeMembers, exchangeSites } from "@/lib/db/schema";
import { notifySiteApproved, notifySiteRejected, notifySubmissionReceived } from "@/lib/email/notify";
import { PLACEMENT_OFFERS, type PlacementOffer, SITE_STATUSES, type SiteStatus, normalizeDomain } from "@/lib/exchange";
import { autoPair } from "@/lib/services/matches";

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

    // Acknowledge, and show the analysis back while it is still correctable.
    // Fire and forget: the site exists whether or not the email goes out.
    void notifySubmissionReceived({ site: created });

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

// ---------------------------------------------------------------------------
// Review
//
// Until these existed, `status` was written exactly once, by the insert above,
// and never again by any code anywhere. Every consumer filters on `active`, so
// a submission was permanently invisible and the only way to approve one was to
// UPDATE the row by hand in the SQL console. These two functions are what make
// `active`, `paused`, `rejected` and `banned` mean anything.
//
// They live here, in the service layer, because that is the seam the whole
// architecture rests on: the admin page and any future MCP tool both call the
// same function, so approving cannot come to mean two different things. The
// ESLint layering rule enforces the MCP half of that.
// ---------------------------------------------------------------------------

/** A site plus the email of the member who submitted it. Admin views only. */
export type SiteForReview = ExchangeSite & { ownerEmail: string | null };

/**
 * Every site in a given status, newest first, with the submitter's email.
 *
 * Deliberately does NOT go through `services/mask.ts`. Masking exists to keep
 * members from seeing each other before a match is agreed; a reviewer deciding
 * whether a listing is honest needs the domain and the person behind it, and
 * hiding either would make the job impossible.
 *
 * The join is on `exchangeMembers.userId = exchangeSites.ownerId`, not on a
 * member id: `ownerId` references `users.id`. That is the same route
 * `notify.ts` takes to reach a member's email.
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
 * Moves a site to a new status and tells its owner.
 *
 * The reviewer's note is written to `review_note`, a column that has existed
 * since the first migration and had no reader or writer until now.
 *
 * Approving MATCHES IMMEDIATELY, and this is the ONLY place `autoPair` is
 * called from. A site is `pending_review` from the moment it is submitted until
 * a human clears it, and `autoPair` refuses to pair anything that is not
 * `active` (that is the review promise in /terms), so approval is the first
 * moment the site can pair with anyone at all. Without the call here an approved
 * site would sit idle until the Tuesday cron, which is a week of silence at
 * exactly the moment the member has just been told they are live.
 *
 * Pairing is awaited rather than fired and forgotten, because its own
 * `match-proposed` email should land after the approval email rather than
 * racing it. The email sends here are fire and forget as everywhere else.
 *
 * @param siteId - The site to move.
 * @param status - Target status. Any value in the `site_status` enum.
 * @param reviewNote - Reviewer's reason. Required in spirit for `rejected`.
 * @returns The updated row.
 * @throws `SiteError` when the id matches nothing.
 */
export async function setSiteStatus(siteId: string, status: SiteStatus, reviewNote?: string): Promise<ExchangeSite> {
    if (!(SITE_STATUSES as readonly string[]).includes(status)) {
        throw new SiteError("invalid", `"${status}" is not a site status.`);
    }

    const note = reviewNote?.trim();
    const [updated] = await db()
        .update(exchangeSites)
        .set({
            status,
            updatedAt: new Date(),
            // Only overwrite the note when one was given. Approving a site does
            // not erase the note explaining why it was rejected last month.
            ...(note ? { reviewNote: note } : {}),
        })
        .where(eq(exchangeSites.id, siteId))
        .returning();

    if (!updated) throw new SiteError("invalid", `No site with id ${siteId}.`);

    if (status === "active") {
        void notifySiteApproved({ site: updated });
        // Best effort. A pairing failure must not make the approval look like
        // it did not happen, because the row is already committed.
        //
        // The outcome is logged rather than dropped. This is the only caller of
        // `autoPair`, so an unlogged return value would mean nothing anywhere
        // observes whether approving a site actually matched it, and "I approved
        // them and they never heard anything" would have no trail to follow.
        try {
            const pair = await autoPair(updated);
            console.log(
                pair.matched
                    ? `setSiteStatus: approved ${updated.domain} and matched it (${pair.match.id})`
                    : `setSiteStatus: approved ${updated.domain}, no match yet (${pair.reason} in ${pair.category})`,
            );
        } catch (err) {
            console.error("setSiteStatus: autoPair failed after approving", updated.domain, err);
        }
    } else if (status === "rejected") {
        void notifySiteRejected({ site: updated, reason: note ?? updated.reviewNote ?? null });
    }

    return updated;
}

export { AnalyzeError };
