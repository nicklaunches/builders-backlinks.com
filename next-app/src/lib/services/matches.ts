import { and, count, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";

import { type Category, candidateCategories, isCategory } from "@/lib/categories";
import type { LiveLinkCounts, MaskedPartner, MatchableSite, RevealedPartner, ScoreContext } from "@/lib/contracts";
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
import { type MatchState, OPEN_MATCH_STATES, isRevealed, orderPair } from "@/lib/exchange";
import { findBestPartner } from "@/lib/matching";
import { briefFor } from "@/lib/services/links";
import { toMaskedPartner, toRevealedPartner } from "@/lib/services/mask";
import { NO_LINKS, liveLinkCounts, liveLinkCountsFor } from "@/lib/services/standing";

/**
 * @file Finding partners and moving a match toward agreement.
 *
 * `autoPair` has two callers: approval (`setSiteStatus`) and the daily re-pair
 * pass in `api/cron/recheck`. It used to also run on submit, which read as
 * instant matching but was the review gate leaking — a `pending_review` site was
 * being proposed to real members before anyone had looked at it. The guard
 * inside `autoPair` closed that, and the two submit surfaces stopped calling it,
 * since the call could no longer do anything.
 *
 * The cost of that is real and worth naming: time to first match is now bounded
 * by how fast the /admin queue gets worked, and this file used to argue that the
 * instant path is what makes an exchange survivable while it is small. It is
 * still the right trade, because /terms promises review first, but the queue is
 * now on the critical path and should be watched like one.
 *
 * WHY THE DAILY PASS EXISTS. Approval used to be the only trigger, which meant a
 * site that missed that one instant was invisible to matching forever. That is
 * not hypothetical: 26 of 33 active sites had never been matched on 2026-08-06,
 * because `upsertMatch` was handing a fractional score to an `integer` column
 * and throwing on almost every insert. The bug is fixed, but the shape of the
 * damage is the point — one failed instant meant a member was approved, told
 * they were live, and never matched with anyone. A pass that reconsiders the
 * whole idle pool is the difference between the next such bug costing a day and
 * costing a month.
 *
 * That pass is only safe because a repeat call is silent: `upsertMatch` reports
 * whether it actually inserted, and `autoPair` returns `already_matched` without
 * stamping or emailing when it did not. Remove that and the pass mails every
 * member every night.
 *
 * When there is no partner yet, that is reported honestly rather than papered
 * over. The weekly digest cron (`api/cron/digest`) covers the members `autoPair`
 * could not place — it does its own candidate query rather than calling in here,
 * because it shows several masked candidates instead of proposing one match.
 * An empty digest with no explanation is the single most common way a matching
 * product loses someone on day one, so it sends nothing rather than nothing-news.
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

/**
 * @param counts - Live link counts for this site, from `services/standing.ts`.
 *   The matcher's reciprocity term reads them, so passing the site row's own
 *   stale columns here would score a member on a number nothing maintains.
 */
function toMatchable(site: ExchangeSite, counts: LiveLinkCounts): MatchableSite {
    return {
        id: site.id,
        ownerId: site.ownerId,
        category: site.category,
        keywords: site.keywords,
        domainRating: site.domainRating,
        trueDr: site.trueDr,
        placementOffered: site.placementOffered,
        linksGiven: counts.linksGiven,
        linksGot: counts.linksGot,
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

    // One count query for the whole page, never one per row.
    const counts = await liveLinkCounts(sites.map((s) => s.id));
    return sites.map((site) => toMaskedPartner(site, counts.get(site.id) ?? NO_LINKS));
}

export type AutoPairResult =
    | { matched: true; match: ExchangeMatch; partner: MaskedPartner }
    | {
          matched: false;
          reason: "first_in_category" | "no_eligible_partner" | "not_active" | "already_matched";
          category: Category;
      };

/**
 * Finds and proposes the best available partner for a site, right now.
 *
 * Called from `setSiteStatus` the moment a site is approved, and from the daily
 * re-pair pass for every active site still holding no open match. NOT from the
 * submit flow: a freshly listed site is `pending_review` and the guard below
 * turns the call into a no-op, so both submit surfaces stopped making it rather
 * than carrying copy for a branch that could not be reached.
 *
 * SAFE TO CALL REPEATEDLY, and the daily pass depends on that. A call that finds
 * only a partner this site already has a match row with returns
 * `already_matched` having written and sent nothing, so re-running it over an
 * unchanged pool is free and silent.
 *
 * @param site - The site needing a partner. Ignored unless it is `active`.
 * @param exclude - Sites already paired earlier in the same batch. Optional, and
 *   redundant on the live path — a site paired a moment ago now holds an open
 *   match and {@link selectPartner} filters it out on that basis alone. Passed
 *   anyway so the live pass and its dry run are driven identically.
 * @returns The created match and a masked view of the partner, or a reason why not.
 */
export async function autoPair(site: ExchangeSite, exclude?: ReadonlySet<string>): Promise<AutoPairResult> {
    const choice = await selectPartner(site, exclude);
    if (!choice.ok) return { matched: false, reason: choice.reason, category: choice.category };

    const { partnerSite, category } = choice;

    const { match, created } = await upsertMatch({
        siteId: site.id,
        partnerSiteId: partnerSite.id,
        category: partnerSite.category,
        score: choice.score,
        widened: choice.widened,
    });

    // The pair already had a match row, so nothing was proposed just now and
    // there is nothing to announce. Stamping `lastMatchedAt` or sending
    // `match-proposed` here would describe an event that did not happen: the
    // email would carry the OLD match id and the OLD expiry, and for a pair that
    // already declined each other it would read as a proposal they had settled.
    //
    // Only reachable when the best candidate is one this site has been matched
    // with before. `scoreCandidate` deprioritises those but keeps them eligible,
    // deliberately, so a thin category re-offers a known partner rather than
    // nothing. When approval was the only caller this branch could not come up
    // twice for the same site; the daily re-pair pass makes it routine, and it
    // has to stay silent to stay idempotent.
    if (!created) {
        return { matched: false, reason: "already_matched", category };
    }

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

    return { matched: true, match, partner: toMaskedPartner(partnerSite, choice.partnerCounts) };
}

/**
 * What {@link autoPair} would do, without doing any of it.
 *
 * Exists so the daily re-pair pass can be dry-run against production before it
 * is allowed to write and send. It shares {@link selectPartner} with `autoPair`
 * rather than reimplementing the query-and-score sequence, which is the only
 * thing that makes the preview worth trusting: a rehearsal that picked partners
 * by its own logic would answer a different question than the one being asked.
 *
 * Returns the partner ROW, not a `MaskedPartner`. This is operator output bound
 * for a log, not a member-facing read, and a preview that hid the domain would
 * be unreviewable. It is not exported to any route that renders to a member.
 *
 * SHARING `selectPartner` IS NOT ENOUGH ON ITS OWN, which is the correction this
 * function needed. Selection is only half of what `autoPair` does; the other
 * half is `upsertMatch` discovering the pair already has a row and reporting
 * `already_matched`. A preview that skipped that half claimed a pairing in
 * exactly the state where the live run writes nothing, so the rehearsal
 * overcounted precisely where it was most load-bearing — the operator reads
 * `paired: 1`, then the live run pairs none. The pair lookup below is the same
 * question `upsertMatch` answers by conflicting, asked without writing.
 *
 * It is a check, not a reservation: two runs racing could both preview the same
 * pair. That is fine, because a dry run is a rehearsal, and the live path still
 * settles it with a unique index rather than a read.
 *
 * The score is rounded here for the same reason `upsertMatch` rounds it — the
 * column is `integer`. A preview reporting 79.9 for a match that would be stored
 * as 80 is a third way for the two to disagree.
 */
export async function previewPair(
    site: ExchangeSite,
    exclude?: ReadonlySet<string>,
): Promise<{ ok: true; partnerSite: ExchangeSite; score: number } | { ok: false; reason: string }> {
    const choice = await selectPartner(site, exclude);
    if (!choice.ok) return { ok: false, reason: choice.reason };

    const existing = await findPairMatch(site.id, choice.partnerSite.id);
    if (existing) return { ok: false, reason: "already_matched" };

    return { ok: true, partnerSite: choice.partnerSite, score: Math.round(choice.score) };
}

/** The empty default for `exclude`, hoisted so each call does not allocate one. */
const EMPTY_EXCLUDE: ReadonlySet<string> = new Set<string>();

/**
 * Reads the match row for a pair, in either write order.
 *
 * `orderPair` is what makes one lookup enough: the row is stored with the
 * lexicographically smaller uuid in `site_a_id` always, so the caller does not
 * have to know which side it is on. Shared by `upsertMatch`'s conflict readback
 * and `previewPair`, because two spellings of "does this pair already exist"
 * would be two chances to answer it differently.
 */
async function findPairMatch(siteId: string, partnerSiteId: string): Promise<ExchangeMatch | undefined> {
    const [siteAId, siteBId] = orderPair(siteId, partnerSiteId);
    const [row] = await db()
        .select()
        .from(exchangeMatches)
        .where(and(eq(exchangeMatches.siteAId, siteAId), eq(exchangeMatches.siteBId, siteBId)))
        .limit(1);
    return row;
}

type PartnerChoice =
    | {
          ok: true;
          partnerSite: ExchangeSite;
          partnerCounts: LiveLinkCounts;
          score: number;
          widened: boolean;
          category: Category;
      }
    | { ok: false; reason: "first_in_category" | "no_eligible_partner" | "not_active"; category: Category };

/**
 * Chooses the best partner for a site, and writes nothing.
 *
 * Split out of `autoPair` so that committing a match and rehearsing one cannot
 * drift apart. Every rule that decides WHO a site pairs with lives here; the
 * caller decides what to do about it.
 *
 * @param site - The site needing a partner.
 * @param exclude - Sites the CALLER knows are taken but the database does not
 *   show as taken yet, which in practice means a dry run: it writes nothing, so
 *   nothing it decided earlier in the batch is visible to the query here.
 */
async function selectPartner(site: ExchangeSite, exclude: ReadonlySet<string> = EMPTY_EXCLUDE): Promise<PartnerChoice> {
    const category = site.category;

    // Only an active site may be proposed to anyone. Every filter below checks
    // the status of the CANDIDATES, so without this guard the subject slips
    // through and an unreviewed listing gets proposed to a real member, with
    // both match-proposed emails, before a human has looked at it. /terms
    // promises that never happens.
    //
    // `not_active` rather than `pending_review`: `paused`, `rejected` and
    // `banned` take this branch too, and naming it after only the first one
    // would be wrong three ways out of four.
    if (site.status !== "active") {
        return { ok: false, reason: "not_active", category };
    }

    const [active] = await db()
        .select({ n: count() })
        .from(exchangeSites)
        .where(and(eq(exchangeSites.category, category), eq(exchangeSites.status, "active")));

    const pools = candidateCategories(category, active?.n ?? 0);
    if (pools.length === 0) {
        return { ok: false, reason: "no_eligible_partner", category };
    }

    const pool = await db()
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

    if (pool.length === 0) {
        // Nobody else is here yet. This is not a failure, it is the queue
        // working: this site becomes the instant match for the next joiner.
        return { ok: false, reason: "first_in_category", category };
    }

    // A SITE HOLDING AN OPEN MATCH IS NOT AVAILABLE, and leaving that out is how
    // one member could collect several. `spokenFor` in the re-pair pass only
    // ever guarded the OUTER loop — it stopped a site being processed twice, not
    // a site being CHOSEN twice — so three idle sites in one category reliably
    // produced two matches both pointing at the middle one, with two
    // `match-proposed` emails to somebody who had answered neither.
    //
    // One open match at a time is the model the rest of the codebase already
    // assumes: the weekly digest skips a member holding one, and the re-pair
    // pass treats "no open match" as the definition of idle. This is the same
    // question asked from the other side, so it reads `OPEN_MATCH_STATES` too.
    //
    // Filtered in memory rather than as a `notExists` on the query above so that
    // an empty result can still be reported honestly. A pool that is empty
    // because nobody else joined is `first_in_category`; a pool that is empty
    // because everyone is busy is `no_eligible_partner`, and answering the
    // second with the first would tell a member in a thriving category that they
    // are alone in it.
    const poolIds = pool.map((c) => c.id);
    const openRows = await db()
        .select({ a: exchangeMatches.siteAId, b: exchangeMatches.siteBId })
        .from(exchangeMatches)
        .where(
            and(
                inArray(exchangeMatches.state, [...OPEN_MATCH_STATES]),
                or(inArray(exchangeMatches.siteAId, poolIds), inArray(exchangeMatches.siteBId, poolIds)),
            ),
        );

    const busy = new Set<string>();
    for (const row of openRows) {
        busy.add(row.a);
        busy.add(row.b);
    }

    // `exclude` carries the sites already spoken for earlier in the SAME run.
    // The database cannot answer that during a dry run, because a dry run writes
    // nothing — without it the rehearsal would hand the same partner out twice
    // and report pairs the live run would never create.
    const candidates = pool.filter((c) => !busy.has(c.id) && !exclude.has(c.id));
    if (candidates.length === 0) {
        return { ok: false, reason: "no_eligible_partner", category };
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

    // The subject and the whole pool in one query, so scoring sees the same
    // derived standing every other surface shows.
    const counts = await liveLinkCounts([site.id, ...candidates.map((c) => c.id)]);
    const countsFor = (id: string) => counts.get(id) ?? NO_LINKS;

    const subject = toMatchable(site, countsFor(site.id));
    const ctx: ScoreContext = {
        alreadyMatched,
        previouslyDeclined,
        widened: pools.length > 1,
        now: new Date(),
    };

    const best = findBestPartner(
        subject,
        candidates.map((c) => toMatchable(c, countsFor(c.id))),
        ctx,
    );
    if (!best) return { ok: false, reason: "no_eligible_partner", category };

    const partnerSite = candidates.find((c) => c.id === best.candidate.id);
    if (!partnerSite) return { ok: false, reason: "no_eligible_partner", category };

    return {
        ok: true,
        partnerSite,
        partnerCounts: countsFor(partnerSite.id),
        score: best.score.total,
        widened: best.candidate.category !== category,
        category,
    };
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
 *
 * `created` distinguishes the two, and callers have to read it. The returned row
 * is a match either way, but only a `created` one was proposed by this call, and
 * announcing the other would describe an event that did not happen. The row it
 * hands back on a conflict can be in ANY state, `declined` and `expired`
 * included, since the unique index covers the pair for all time rather than the
 * open ones.
 */
async function upsertMatch(input: {
    siteId: string;
    partnerSiteId: string;
    category: Category;
    score: number;
    widened: boolean;
}): Promise<{ match: ExchangeMatch; created: boolean }> {
    const [siteAId, siteBId] = orderPair(input.siteId, input.partnerSiteId);

    const [inserted] = await db()
        .insert(exchangeMatches)
        .values({
            siteAId,
            siteBId,
            category: input.category,
            // ROUNDED BECAUSE THE COLUMN IS `integer`, and this one line is why
            // matching had barely worked since it shipped. `scoreCandidate`
            // finishes on `round2`, so a total carries two decimal places, and
            // Postgres rejects `87.16` for an integer outright: `invalid input
            // syntax for type integer`. The insert threw, `autoPair` threw with
            // it, and `setSiteStatus` caught the lot and approved the site
            // anyway — so a member was let in, told they were live, and never
            // matched with anyone.
            //
            // It hid because a match was still created whenever the score
            // happened to land on a whole number. Every match in production on
            // 2026-08-06 scored 48, 42, 90 or 55: pairing had only ever
            // succeeded by coincidence, four times in nine days.
            //
            // Rounding here rather than widening the column is the honest fix.
            // `score.ts` says the total "is only ever a display number" —
            // nothing reads it back to make a decision, and ordering happens in
            // memory on the full float before this is ever called, so the
            // hundredths were never load-bearing.
            score: Math.round(input.score),
            widened: input.widened,
            state: "proposed",
            proposedById: null,
            expiresAt: new Date(Date.now() + MATCH_TTL_DAYS * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing({ target: [exchangeMatches.siteAId, exchangeMatches.siteBId] })
        .returning();

    if (inserted) return { match: inserted, created: true };

    const existing = await findPairMatch(siteAId, siteBId);
    if (!existing) {
        // Only reachable if the conflicting row was deleted between the insert
        // and this read, which nothing in the product does.
        throw new Error(`Match for pair (${siteAId}, ${siteBId}) conflicted on insert but could not be read back`);
    }
    return { match: existing, created: false };
}

export type MatchView = {
    matchId: string;
    state: MatchState;
    category: Category;
    /**
     * True when this pair came from an adjacent category, because the exact one
     * was too thin to pair inside.
     *
     * Exposed because the landing page and house rule §02 both promise we widen
     * "and say so", and a widened match is indistinguishable from a wrong one
     * unless we say which it is. The proposal email has always disclosed this;
     * every other surface showed a bare category and left the member to
     * conclude the matching was simply bad.
     *
     * A property of the PAIR, not of the viewer: it is stored as
     * `best.candidate.category !== category`, so it is true exactly when the two
     * sites sit in different categories, which reads the same from either end.
     * Both sides can therefore render it, and each side's "adjacent" means the
     * OTHER site's category. What is not symmetric is which category was thin:
     * only the side that initiated the pairing was measured against
     * `WIDEN_BELOW`, so no surface should tell a member their own category was
     * the thin one.
     */
    widened: boolean;
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

/**
 * @param partnerCounts - Live link counts for every partner in the batch, when
 *   the caller is building more than one view. `listMatches` renders up to 50,
 *   and resolving standing per view would be 50 round trips for one page.
 *   Omitted by the single-view callers, which then pay one query.
 */
async function buildMatchView(
    match: ExchangeMatch,
    viewerSiteIds: Set<string>,
    partnerCounts?: Map<string, LiveLinkCounts>,
): Promise<MatchView | null> {
    const mineIsA = viewerSiteIds.has(match.siteAId);
    const mySiteId = mineIsA ? match.siteAId : match.siteBId;
    const partnerSiteId = mineIsA ? match.siteBId : match.siteAId;

    const [partnerSite] = await db().select().from(exchangeSites).where(eq(exchangeSites.id, partnerSiteId)).limit(1);
    if (!partnerSite) return null;

    const state = match.state;
    const revealed = isRevealed(state);
    const counts = partnerCounts
        ? (partnerCounts.get(partnerSite.id) ?? NO_LINKS)
        : await liveLinkCountsFor(partnerSite.id);

    let partner: MaskedPartner | RevealedPartner;
    if (revealed) {
        const [partnerMember] = await db()
            .select({ email: exchangeMembers.email })
            .from(exchangeMembers)
            .where(eq(exchangeMembers.userId, partnerSite.ownerId))
            .limit(1);
        partner = toRevealedPartner(partnerSite, counts, partnerMember?.email ?? "", state);
    } else {
        partner = toMaskedPartner(partnerSite, counts);
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
        widened: match.widened,
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
    // Which side is the partner is known from the row alone, so every partner's
    // standing comes back in one query rather than one per rendered match.
    const partnerCounts = await liveLinkCounts(matches.map((m) => (idSet.has(m.siteAId) ? m.siteBId : m.siteAId)));
    const views = await Promise.all(matches.map((m) => buildMatchView(m, idSet, partnerCounts)));
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

        // A match both sides are already in does not reopen from here. Accepting
        // again is the harmless retry an agent may send, and is a no-op below;
        // declining is the transition that has to be refused. Letting
        // `accept: false` through would move `agreed` or `placed` back to
        // `declined`, and a revealed match can already have a live link behind
        // it: the link row would stay live while its own match reads `declined`,
        // both sites would go back into the pool, and `get_link_brief` /
        // `mark_link_placed` would start refusing a trade that is really under
        // way. The accept side keeps its own idempotent no-op just below.
        if ((from === "agreed" || from === "placed") && !accept) {
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
