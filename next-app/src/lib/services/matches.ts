import { and, count, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";

import { type Category, candidateCategories, isCategory } from "@/lib/categories";
import type { MaskedPartner, MatchableSite, RevealedPartner, ScoreContext } from "@/lib/contracts";
import { db } from "@/lib/db";
import {
    type ExchangeMatch,
    type ExchangeMember,
    type ExchangeSite,
    exchangeMatches,
    exchangeMembers,
    exchangeSites,
} from "@/lib/db/schema";
import { notifyMatchAgreed, notifyMatchProposed } from "@/lib/email/notify";
import { type MatchState, isRevealed, orderPair } from "@/lib/exchange";
import { findBestPartner } from "@/lib/matching";
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
 *
 * ON SORTING BY `lastMatchedAt`: every query that orders by it asks for NULLS
 * FIRST explicitly. A site that has never been matched is the stalest thing in
 * the pool and must surface first, which is what Mongo did for free by sorting
 * nulls low. Postgres puts NULLs last on an ascending sort, so leaving it
 * implicit would silently bury exactly the members this product cannot afford
 * to ignore.
 */

/** How long a proposed match stays open before it expires back into the pool. */
const MATCH_TTL_DAYS = 14;

/** Maximum partners any search returns. Deliberately low: this is not a directory to enumerate. */
const MAX_SEARCH_RESULTS = 20;

function toMatchable(site: ExchangeSite): MatchableSite {
    return {
        id: site.id,
        ownerId: site.ownerId,
        category: site.category,
        keywords: site.keywords,
        domainRating: site.domainRating,
        trueDr: site.trueDr,
        placementOffered: site.placementOffered,
        linksGiven: site.linksGiven,
        linksGot: site.linksGot,
        lastMatchedAt: site.lastMatchedAt,
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
    const limit = Math.min(Math.max(input.limit ?? 5, 1), MAX_SEARCH_RESULTS);

    // An unknown category name matches nothing, which is what the old query did
    // too. Returning early rather than casting keeps the column type honest.
    if (input.category != null && !isCategory(input.category)) return [];

    const filters = [
        eq(exchangeSites.status, "active"),
        input.category != null ? eq(exchangeSites.category, input.category) : undefined,
        input.drMin != null ? gte(exchangeSites.domainRating, input.drMin) : undefined,
        input.drMax != null ? lte(exchangeSites.domainRating, input.drMax) : undefined,
    ];

    const sites = await db()
        .select()
        .from(exchangeSites)
        .where(and(...filters))
        .orderBy(sql`${exchangeSites.lastMatchedAt} asc nulls first`, desc(exchangeSites.createdAt))
        .limit(limit);

    return sites.map(toMaskedPartner);
}

export type AutoPairResult =
    | { matched: true; match: ExchangeMatch; partner: MaskedPartner }
    | { matched: false; reason: "first_in_category" | "no_eligible_partner"; category: Category };

/**
 * Finds and proposes the best available partner for a site, right now.
 *
 * Called synchronously from the submit flow and from the weekly cron.
 *
 * @param site - The site needing a partner.
 * @returns The created match and a masked view of the partner, or a reason why not.
 */
export async function autoPair(site: ExchangeSite): Promise<AutoPairResult> {
    const category = site.category;

    const [active] = await db()
        .select({ n: count() })
        .from(exchangeSites)
        .where(and(eq(exchangeSites.category, category), eq(exchangeSites.status, "active")));

    const pools = candidateCategories(category, active?.n ?? 0);
    if (pools.length === 0) {
        return { matched: false, reason: "no_eligible_partner", category };
    }

    const candidates = await db()
        .select()
        .from(exchangeSites)
        .where(
            and(
                inArray(exchangeSites.category, pools),
                eq(exchangeSites.status, "active"),
                ne(exchangeSites.id, site.id),
                ne(exchangeSites.ownerId, site.ownerId),
            ),
        )
        .limit(200);

    if (candidates.length === 0) {
        // Nobody else is here yet. This is not a failure, it is the queue
        // working: this site becomes the instant match for the next joiner.
        return { matched: false, reason: "first_in_category", category };
    }

    const priorMatches = await db()
        .select({
            siteAId: exchangeMatches.siteAId,
            siteBId: exchangeMatches.siteBId,
            state: exchangeMatches.state,
        })
        .from(exchangeMatches)
        .where(or(eq(exchangeMatches.siteAId, site.id), eq(exchangeMatches.siteBId, site.id)));

    const alreadyMatched = new Set<string>();
    const previouslyDeclined = new Set<string>();
    for (const m of priorMatches) {
        const other = m.siteAId === site.id ? m.siteBId : m.siteAId;
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

    const partnerSite = candidates.find((c) => c.id === best.candidate.id);
    if (!partnerSite) return { matched: false, reason: "no_eligible_partner", category };

    const match = await upsertMatch({
        siteId: site.id,
        partnerSiteId: partnerSite.id,
        category: best.candidate.category,
        score: best.score.total,
        widened: best.candidate.category !== category,
    });

    const stamp = new Date();
    await db()
        .update(exchangeSites)
        .set({ lastMatchedAt: stamp, updatedAt: stamp })
        .where(inArray(exchangeSites.id, [site.id, partnerSite.id]));

    // Fire and forget. A member who is matched and never told is the same as
    // not being matched, but email must never be able to fail a submission.
    void notifyMatchProposed({
        matchId: match.id,
        siteA: site,
        siteB: partnerSite,
        expiresAt: match.expiresAt,
        widened: match.widened,
    });

    return { matched: true, match, partner: toMaskedPartner(partnerSite) };
}

/**
 * Creates the match for a pair, or returns the one that already exists.
 *
 * Two concurrent submissions can select each other in the same instant, so this
 * cannot be a read-then-insert. `INSERT ... ON CONFLICT DO NOTHING RETURNING`
 * against the unique `(site_a_id, site_b_id)` index makes the database the
 * arbiter: the winner gets its row back, the loser gets an empty array and
 * re-selects the row the winner wrote. Both callers end up holding the same
 * single thread for the pair, which is the entire point of the sorted-pair rule.
 *
 * The re-select is by the ordered pair rather than by id because the loser
 * never learns the winner's id, and that is exactly what `orderPair` guarantees
 * is enough to find it.
 */
async function upsertMatch(input: {
    siteId: string;
    partnerSiteId: string;
    category: Category;
    score: number;
    widened: boolean;
}): Promise<ExchangeMatch> {
    const [siteAId, siteBId] = orderPair(input.siteId, input.partnerSiteId);
    const pair = and(eq(exchangeMatches.siteAId, siteAId), eq(exchangeMatches.siteBId, siteBId));

    const [inserted] = await db()
        .insert(exchangeMatches)
        .values({
            siteAId,
            siteBId,
            category: input.category,
            score: input.score,
            widened: input.widened,
            state: "proposed",
            proposedById: null,
            expiresAt: new Date(Date.now() + MATCH_TTL_DAYS * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing({ target: [exchangeMatches.siteAId, exchangeMatches.siteBId] })
        .returning();

    if (inserted) return inserted;

    const [existing] = await db().select().from(exchangeMatches).where(pair).limit(1);
    if (!existing) {
        // Only reachable if the conflicting row was deleted between the insert
        // and this read, which nothing in the product does.
        throw new Error(`Match for pair (${siteAId}, ${siteBId}) conflicted on insert but could not be read back`);
    }
    return existing;
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
    /**
     * True when the OTHER side has accepted and the viewer has not.
     *
     * Derivable from `state` only if you also know which side of the pair the
     * viewer is on, which `MatchView` deliberately does not expose (leaking
     * `siteAId` would tell a member which half of the ordered pair they are,
     * and that ordering is an implementation detail of the uniqueness
     * constraint). So it is computed here, where `mineIsA` is already known.
     * The browser dashboard needs it to say whose turn it is; getting that
     * backwards tells someone to wait when they are the one blocking.
     */
    waitingOnMe: boolean;
    expiresAt: Date;
};

async function buildMatchView(match: ExchangeMatch, viewerSiteIds: Set<string>): Promise<MatchView | null> {
    const mineIsA = viewerSiteIds.has(match.siteAId);
    const mySiteId = mineIsA ? match.siteAId : match.siteBId;
    const partnerSiteId = mineIsA ? match.siteBId : match.siteAId;

    const [partnerSite] = await db().select().from(exchangeSites).where(eq(exchangeSites.id, partnerSiteId)).limit(1);
    if (!partnerSite) return null;

    const state = match.state;
    const revealed = isRevealed(state);

    let partner: MaskedPartner | RevealedPartner;
    if (revealed) {
        const [partnerMember] = await db()
            .select({ email: exchangeMembers.email })
            .from(exchangeMembers)
            .where(eq(exchangeMembers.userId, partnerSite.ownerId))
            .limit(1);
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
        matchId: match.id,
        state,
        category: match.category,
        mySiteId,
        partner,
        revealed,
        nextStep,
        waitingOnMe: state === theirAcceptState,
        expiresAt: match.expiresAt,
    };
}

/** The site ids a member owns. Every ownership check in this file starts here. */
async function mySiteIds(member: ExchangeMember): Promise<string[]> {
    const rows = await db()
        .select({ id: exchangeSites.id })
        .from(exchangeSites)
        .where(eq(exchangeSites.ownerId, member.userId));
    return rows.map((r) => r.id);
}

/**
 * Lists a member's matches across all of their sites.
 */
export async function listMatches(member: ExchangeMember, state?: MatchState): Promise<MatchView[]> {
    const ids = await mySiteIds(member);
    if (ids.length === 0) return [];

    const matches = await db()
        .select()
        .from(exchangeMatches)
        .where(
            and(
                or(inArray(exchangeMatches.siteAId, ids), inArray(exchangeMatches.siteBId, ids)),
                state ? eq(exchangeMatches.state, state) : undefined,
            ),
        )
        .orderBy(desc(exchangeMatches.updatedAt))
        .limit(50);

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
    member: ExchangeMember;
    matchId: string;
    accept: boolean;
    reason?: string;
}): Promise<MatchView> {
    const { member, matchId, accept } = input;

    const [match] = await db().select().from(exchangeMatches).where(eq(exchangeMatches.id, matchId)).limit(1);
    if (!match) throw new MatchError("not_found", "No match with that id.");

    const ids = await mySiteIds(member);
    const idSet = new Set(ids);
    const mineIsA = idSet.has(match.siteAId);
    const mineIsB = idSet.has(match.siteBId);
    if (!mineIsA && !mineIsB) throw new MatchError("not_yours", "That match does not involve any of your sites.");

    const myAccept = mineIsA ? "a_accepted" : "b_accepted";
    const theirAccept = mineIsA ? "b_accepted" : "a_accepted";

    // The transition is computed from a state that can be stale by the time the
    // UPDATE runs. Both sides get the match-proposed email in the same instant,
    // and two agents acting on it will accept within the same second; with an
    // unguarded UPDATE the second write overwrites the first, the match ends on
    // a single accept with the other one lost, and both members are told
    // "waiting on them" until it expires. So every write carries
    // `state = <the state it was computed from>`, and a miss means someone else
    // moved the match first: re-read and recompute, which in the concurrent
    // accept case turns this side's write into the one that lands on `agreed`.
    let current = match;
    let updated = match;
    for (let attempt = 0; ; attempt++) {
        const from = current.state;
        if (from === "declined" || from === "expired") {
            throw new MatchError("bad_state", `This match is already ${from}.`);
        }

        // Built as a patch rather than mutated in place: one UPDATE, and the
        // fields that do not change are not written at all.
        const patch: { state?: MatchState; declineReason?: string | null; agreedAt?: Date } = {};

        if (!accept) {
            patch.state = "declined";
            patch.declineReason = input.reason ?? null;
        } else if (from === "agreed" || from === "placed") {
            // Already through. Accepting again is a no-op rather than an error:
            // agents retry, and a retry should be harmless.
        } else if (from === theirAccept) {
            patch.state = "agreed";
            patch.agreedAt = new Date();
        } else {
            patch.state = myAccept;
        }

        if (Object.keys(patch).length === 0) {
            updated = current;
            break;
        }

        const [row] = await db()
            .update(exchangeMatches)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(exchangeMatches.id, match.id), eq(exchangeMatches.state, from)))
            .returning();
        if (row) {
            updated = row;
            break;
        }

        // Three misses in a row is not contention any more, something is
        // rewriting this match faster than we can read it. Stop rather than spin.
        if (attempt >= 2) {
            throw new MatchError("bad_state", "This match changed while we were saving. List your matches and retry.");
        }

        const [reread] = await db().select().from(exchangeMatches).where(eq(exchangeMatches.id, match.id)).limit(1);
        if (!reread) throw new MatchError("not_found", "No match with that id.");
        current = reread;
    }

    const justAgreed = updated.state === "agreed" && match.state !== "agreed";

    // The reveal moment. Both sides are told at once, each getting the other's
    // identity and a brief pointing at the other's URL. Building the two briefs
    // here rather than inside the notifier keeps "who links to whom" explicit:
    // getting it backwards would have everyone linking to themselves.
    if (justAgreed) {
        const sites = await db()
            .select()
            .from(exchangeSites)
            .where(inArray(exchangeSites.id, [updated.siteAId, updated.siteBId]));
        const siteA = sites.find((s) => s.id === updated.siteAId);
        const siteB = sites.find((s) => s.id === updated.siteBId);
        if (siteA && siteB) {
            const agreedMatchId = updated.id;
            void notifyMatchAgreed({
                matchId: agreedMatchId,
                siteA,
                siteB,
                // A links to B, B links to A.
                briefForA: briefFor(siteB, { matchId: agreedMatchId }),
                briefForB: briefFor(siteA, { matchId: agreedMatchId }),
            });
        }
    }

    const view = await buildMatchView(updated, idSet);
    if (!view) throw new MatchError("not_found", "The other side of this match no longer exists.");
    return view;
}
