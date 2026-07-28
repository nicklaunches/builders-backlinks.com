import { type Category, candidateCategories } from "@/lib/categories";
import type { MaskedPartner, MatchableSite, RevealedPartner, ScoreContext } from "@/lib/contracts";
import { connectMongo } from "@/lib/db/mongoose";
import { notifyMatchAgreed, notifyMatchProposed } from "@/lib/email/notify";
import { findBestPartner } from "@/lib/matching";
import {
    ExchangeMatch,
    type ExchangeMatchHydrated,
    type MatchState,
    isRevealed,
    orderPair,
} from "@/lib/models/ExchangeMatch";
import { ExchangeMember, type ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";
import { ExchangeSite, type ExchangeSiteHydrated } from "@/lib/models/ExchangeSite";
import { briefFor } from "@/lib/services/links";
import { toMaskedPartner, toRevealedPartner } from "@/lib/services/mask";

/**
 * @file Finding partners and moving a match toward agreement.
 *
 * One matching path, two callers. `autoPair` runs synchronously the moment a
 * site is listed, and the weekly digest cron calls the same function for
 * members with nothing open. Keeping them on one code path is not tidiness: if
 * the instant path were a separate implementation it would quietly rot, and the
 * instant path is the one that makes an exchange survivable while it is small.
 *
 * When there is no partner yet, that is reported honestly rather than papered
 * over. A member told "you are first in this category, the next person to join
 * matches with you" is being told something true and mildly flattering. An
 * empty digest with no explanation is the single most common way a matching
 * product loses someone on day one.
 */

/** How long a proposed match stays open before it expires back into the pool. */
const MATCH_TTL_DAYS = 14;

/** Maximum partners any search returns. Deliberately low: this is not a directory to enumerate. */
const MAX_SEARCH_RESULTS = 20;

function toMatchable(site: ExchangeSiteHydrated): MatchableSite {
    return {
        id: String(site._id),
        ownerId: String(site.owner),
        category: site.category as Category,
        keywords: site.keywords ?? [],
        domainRating: site.domainRating ?? null,
        trueDr: site.trueDr ?? null,
        placementOffered: site.placementOffered ?? "unsure",
        linksGiven: site.linksGiven ?? 0,
        linksGot: site.linksGot ?? 0,
        lastMatchedAt: site.lastMatchedAt ?? null,
    };
}

/**
 * Anonymous partner search.
 *
 * This is the one surface an unauthenticated agent can call, so it is also the
 * easiest thing on the server to abuse. Three defences, all deliberate:
 * results are capped hard, every row goes through the masking boundary so no
 * domain can escape, and there is no offset or cursor, so the member base
 * cannot be walked page by page.
 */
export async function searchPartners(input: {
    category?: string;
    drMin?: number;
    drMax?: number;
    limit?: number;
}): Promise<MaskedPartner[]> {
    await connectMongo();

    const limit = Math.min(Math.max(input.limit ?? 5, 1), MAX_SEARCH_RESULTS);
    const query: Record<string, unknown> = { status: "active" };
    if (input.category) query.category = input.category;
    if (input.drMin != null || input.drMax != null) {
        query.domainRating = {
            ...(input.drMin != null ? { $gte: input.drMin } : {}),
            ...(input.drMax != null ? { $lte: input.drMax } : {}),
        };
    }

    const sites = await ExchangeSite.find(query).sort({ lastMatchedAt: 1, createdAt: -1 }).limit(limit).exec();
    return sites.map(toMaskedPartner);
}

export type AutoPairResult =
    | { matched: true; match: ExchangeMatchHydrated; partner: MaskedPartner }
    | { matched: false; reason: "first_in_category" | "no_eligible_partner"; category: Category };

/**
 * Finds and proposes the best available partner for a site, right now.
 *
 * Called synchronously from the submit flow and from the weekly cron.
 *
 * @param site - The site needing a partner.
 * @returns The created match and a masked view of the partner, or a reason why not.
 */
export async function autoPair(site: ExchangeSiteHydrated): Promise<AutoPairResult> {
    await connectMongo();

    const category = site.category as Category;
    const activeInCategory = await ExchangeSite.countDocuments({ category, status: "active" });
    const pools = candidateCategories(category, activeInCategory);
    if (pools.length === 0) {
        return { matched: false, reason: "no_eligible_partner", category };
    }

    const candidates = await ExchangeSite.find({
        category: { $in: pools },
        status: "active",
        _id: { $ne: site._id },
        owner: { $ne: site.owner },
    })
        .limit(200)
        .exec();

    if (candidates.length === 0) {
        // Nobody else is here yet. This is not a failure, it is the queue
        // working: this site becomes the instant match for the next joiner.
        return { matched: false, reason: "first_in_category", category };
    }

    const priorMatches = await ExchangeMatch.find({ $or: [{ siteA: site._id }, { siteB: site._id }] })
        .select("siteA siteB state")
        .exec();

    const alreadyMatched = new Set<string>();
    const previouslyDeclined = new Set<string>();
    for (const m of priorMatches) {
        const other = String(m.siteA) === String(site._id) ? String(m.siteB) : String(m.siteA);
        alreadyMatched.add(other);
        if (m.state === "declined") previouslyDeclined.add(other);
    }

    const subject = toMatchable(site);
    const ctx: ScoreContext = {
        alreadyMatched,
        previouslyDeclined,
        widened: pools.length > 1,
        now: new Date(),
    };

    const best = findBestPartner(subject, candidates.map(toMatchable), ctx);
    if (!best) return { matched: false, reason: "no_eligible_partner", category };

    const partnerDoc = candidates.find((c) => String(c._id) === best.candidate.id);
    if (!partnerDoc) return { matched: false, reason: "no_eligible_partner", category };

    const [siteA, siteB] = orderPair(String(site._id), String(partnerDoc._id));

    // Upsert rather than create: two concurrent submissions can select each
    // other in the same instant, and the unique (siteA, siteB) index is what
    // stops that becoming two matches for one pair.
    const match = await ExchangeMatch.findOneAndUpdate(
        { siteA, siteB },
        {
            $setOnInsert: {
                siteA,
                siteB,
                category: best.candidate.category,
                score: best.score.total,
                widened: best.candidate.category !== category,
                state: "proposed" as MatchState,
                proposedBy: null,
                expiresAt: new Date(Date.now() + MATCH_TTL_DAYS * 24 * 60 * 60 * 1000),
            },
        },
        { upsert: true, new: true },
    ).exec();

    const stamp = new Date();
    await ExchangeSite.updateMany({ _id: { $in: [site._id, partnerDoc._id] } }, { $set: { lastMatchedAt: stamp } });

    // Fire and forget. A member who is matched and never told is the same as
    // not being matched, but email must never be able to fail a submission.
    void notifyMatchProposed({
        matchId: String(match._id),
        siteA: site,
        siteB: partnerDoc,
        expiresAt: match.expiresAt,
        widened: Boolean(match.widened),
    });

    return { matched: true, match, partner: toMaskedPartner(partnerDoc) };
}

export type MatchView = {
    matchId: string;
    state: MatchState;
    category: Category;
    /** The viewer's own site in this match. */
    mySiteId: string;
    /** Masked before mutual accept, revealed after. */
    partner: MaskedPartner | RevealedPartner;
    revealed: boolean;
    /** What the viewer should do next, in plain words. Agents act on this. */
    nextStep: string;
    expiresAt: Date;
};

async function buildMatchView(match: ExchangeMatchHydrated, viewerSiteIds: Set<string>): Promise<MatchView | null> {
    const aId = String(match.siteA);
    const bId = String(match.siteB);
    const mineIsA = viewerSiteIds.has(aId);
    const mySiteId = mineIsA ? aId : bId;
    const partnerSiteId = mineIsA ? bId : aId;

    const partnerSite = await ExchangeSite.findById(partnerSiteId).exec();
    if (!partnerSite) return null;

    const state = match.state as MatchState;
    const revealed = isRevealed(state);

    let partner: MaskedPartner | RevealedPartner;
    if (revealed) {
        const partnerMember = await ExchangeMember.findOne({ user: partnerSite.owner }).select("email").exec();
        partner = toRevealedPartner(partnerSite, partnerMember?.email ?? "", state);
    } else {
        partner = toMaskedPartner(partnerSite);
    }

    const myAcceptState = mineIsA ? "a_accepted" : "b_accepted";
    const theirAcceptState = mineIsA ? "b_accepted" : "a_accepted";
    const nextStep =
        state === "proposed"
            ? "They have not responded yet either. Accept to signal you are in, and if they accept too you are both revealed to each other."
            : state === myAcceptState
              ? "You have accepted. Waiting on them."
              : state === theirAcceptState
                ? "They have accepted and are waiting on you. Accept to reveal both sides and get the link brief."
                : state === "agreed"
                  ? "Agreed. Call get_link_brief for this match, place their link on your site, then call mark_link_placed."
                  : state === "placed"
                    ? "Both links are placed. We recheck at day 7, day 30, then monthly."
                    : state === "declined"
                      ? "Declined. Nothing further to do."
                      : "This match expired and went back into the pool.";

    return {
        matchId: String(match._id),
        state,
        category: match.category as Category,
        mySiteId,
        partner,
        revealed,
        nextStep,
        expiresAt: match.expiresAt,
    };
}

/**
 * Lists a member's matches across all of their sites.
 */
export async function listMatches(member: ExchangeMemberHydrated, state?: MatchState): Promise<MatchView[]> {
    await connectMongo();

    const mySites = await ExchangeSite.find({ owner: member.user }).select("_id").exec();
    const ids = mySites.map((s) => String(s._id));
    if (ids.length === 0) return [];

    const query: Record<string, unknown> = { $or: [{ siteA: { $in: ids } }, { siteB: { $in: ids } }] };
    if (state) query.state = state;

    const matches = await ExchangeMatch.find(query).sort({ updatedAt: -1 }).limit(50).exec();
    const idSet = new Set(ids);

    const views = await Promise.all(matches.map((m) => buildMatchView(m, idSet)));
    return views.filter((v): v is MatchView => v !== null);
}

export class MatchError extends Error {
    constructor(
        public readonly code: "not_found" | "not_yours" | "bad_state",
        message: string,
    ) {
        super(message);
        this.name = "MatchError";
    }
}

/**
 * Accepts or declines a match on the viewer's behalf.
 *
 * When both sides have accepted the state becomes `agreed`, which is the single
 * moment identities unlock. Everything downstream keys off that: the returned
 * view is the first time this member sees the partner's domain.
 *
 * @throws `MatchError` when the match is missing, belongs to someone else, or
 *   has already been resolved.
 */
export async function respondToMatch(input: {
    member: ExchangeMemberHydrated;
    matchId: string;
    accept: boolean;
    reason?: string;
}): Promise<MatchView> {
    const { member, matchId, accept } = input;
    await connectMongo();

    const match = await ExchangeMatch.findById(matchId).exec();
    if (!match) throw new MatchError("not_found", "No match with that id.");

    const mySites = await ExchangeSite.find({ owner: member.user }).select("_id").exec();
    const idSet = new Set(mySites.map((s) => String(s._id)));
    const mineIsA = idSet.has(String(match.siteA));
    const mineIsB = idSet.has(String(match.siteB));
    if (!mineIsA && !mineIsB) throw new MatchError("not_yours", "That match does not involve any of your sites.");

    const state = match.state as MatchState;
    const previousState = state;
    if (state === "declined" || state === "expired") {
        throw new MatchError("bad_state", `This match is already ${state}.`);
    }

    if (!accept) {
        match.state = "declined";
        match.declineReason = input.reason ?? null;
    } else if (state === "agreed" || state === "placed") {
        // Already through. Accepting again is a no-op rather than an error:
        // agents retry, and a retry should be harmless.
    } else {
        const myAccept = mineIsA ? "a_accepted" : "b_accepted";
        const theirAccept = mineIsA ? "b_accepted" : "a_accepted";
        if (state === theirAccept) {
            match.state = "agreed";
            match.agreedAt = new Date();
        } else {
            match.state = myAccept as MatchState;
        }
    }

    const justAgreed = match.state === "agreed" && previousState !== "agreed";
    await match.save();

    // The reveal moment. Both sides are told at once, each getting the other's
    // identity and a brief pointing at the other's URL. Building the two briefs
    // here rather than inside the notifier keeps "who links to whom" explicit:
    // getting it backwards would have everyone linking to themselves.
    if (justAgreed) {
        const [siteA, siteB] = await Promise.all([
            ExchangeSite.findById(match.siteA).exec(),
            ExchangeSite.findById(match.siteB).exec(),
        ]);
        if (siteA && siteB) {
            const matchId = String(match._id);
            void notifyMatchAgreed({
                matchId,
                siteA,
                siteB,
                // A links to B, B links to A.
                briefForA: briefFor(siteB, { matchId }),
                briefForB: briefFor(siteA, { matchId }),
            });
        }
    }

    const view = await buildMatchView(match, idSet);
    if (!view) throw new MatchError("not_found", "The other side of this match no longer exists.");
    return view;
}
