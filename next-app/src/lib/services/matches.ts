import { and, count, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";

import { type Category, candidateCategories, isCategory } from "@/lib/categories";
import type { LiveLinkCounts, MaskedPartner, MatchableSite, RevealedPartner, ScoreContext } from "@/lib/contracts";
import { db } from "@/lib/db";
import {
    type ExchangeLink,
    type ExchangeMatch,
    type ExchangeMember,
    type ExchangeSite,
    exchangeLinks,
    exchangeMatches,
    exchangeMembers,
    exchangeSites,
} from "@/lib/db/schema";
import { notifyMatchAgreed, notifyMatchProposed } from "@/lib/email/notify";
import {
    type LinkStatus,
    type MatchState,
    OPEN_MATCH_STATES,
    type Placement,
    isRevealed,
    orderPair,
} from "@/lib/exchange";
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
 * the pool and must surface first, and Postgres puts NULLs LAST on an ascending
 * sort, so leaving it implicit would silently bury exactly the members this
 * product cannot afford to ignore.
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
 * Called from `setSiteStatus` on approval and from the daily re-pair pass, never
 * from submit — a freshly listed site is `pending_review`, which the guard below
 * turns into a no-op. SAFE TO CALL REPEATEDLY, and the daily pass depends on it:
 * a call finding only a partner this site already has a row with returns
 * `already_matched` having written and sent nothing.
 *
 * @param site - Ignored unless it is `active`.
 * @param exclude - Sites paired earlier in the same batch. Redundant on the live
 *   path, where {@link selectPartner} already filters them; passed anyway so the
 *   live pass and its dry run are driven identically.
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

    // The pair already had a row, so nothing was proposed and there is nothing to
    // announce. Stamping or emailing here would describe an event that did not
    // happen, and this branch has to stay silent for the daily pass to stay
    // idempotent.
    if (!created) {
        return { matched: false, reason: "already_matched", category };
    }

    const stamp = new Date();
    await db()
        .update(exchangeSites)
        .set({ lastMatchedAt: stamp, updatedAt: stamp })
        .where(inArray(exchangeSites.id, [site.id, partnerSite.id]));

    // Fire and forget: email must never be able to fail a pairing.
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
 * Lets the daily re-pair pass be dry-run against production before it is allowed
 * to write. Shares {@link selectPartner} with `autoPair` and must also repeat the
 * pair lookup below: selection is only half of `autoPair`, the other half being
 * `upsertMatch` finding an existing row. A preview skipping that half reports
 * `paired: 1` where the live run pairs none. The score is rounded for the same
 * reason `upsertMatch` rounds it — the column is `integer`.
 *
 * Returns the partner ROW rather than a `MaskedPartner`: operator output for a
 * log, exported to no route that renders to a member.
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
 * Split out of `autoPair` so committing a match and rehearsing one cannot drift.
 * Every rule deciding WHO a site pairs with lives here; the caller decides what
 * to do about it.
 *
 * @param exclude - Sites the CALLER knows are taken but the database does not,
 *   which in practice means a dry run: it writes nothing, so nothing it decided
 *   earlier in the batch is visible to the query here.
 */
async function selectPartner(site: ExchangeSite, exclude: ReadonlySet<string> = EMPTY_EXCLUDE): Promise<PartnerChoice> {
    const category = site.category;

    // Every filter below checks the CANDIDATES' status, so without this guard the
    // subject slips through and an unreviewed listing is proposed to a real
    // member. `not_active` rather than `pending_review` because `paused`,
    // `rejected` and `banned` take this branch too.
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

    // A SITE HOLDING AN OPEN MATCH IS NOT AVAILABLE. Without this, three idle
    // sites in one category produce two matches both pointing at the middle one.
    // Filtered in memory rather than as a `notExists` above so an empty pool can
    // be reported honestly: nobody joined is `first_in_category`, everyone busy
    // is `no_eligible_partner`.
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
 * arbiter: the loser gets an empty array and re-selects by the ordered pair,
 * which is what `orderPair` guarantees is enough to find without knowing the id.
 *
 * Callers MUST read `created`. Only a created row was proposed by this call, and
 * the row returned on conflict can be in any state, `declined` and `expired`
 * included, since the index covers the pair for all time.
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
            // ROUNDED BECAUSE THE COLUMN IS `integer`. `scoreCandidate` finishes
            // on `round2`, and Postgres rejects `87.16` outright. Rounding here
            // rather than widening the column: ordering happens in memory on the
            // full float before this is called, so the hundredths are only ever a
            // display number. See `matching/score-integer.test.ts`.
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

/**
 * One direction of a trade, as much of it as a match view needs.
 *
 * Deliberately NOT `LinkLedgerRow`. That type is the ledger's contract and
 * carries `direction`, which here is already said by the field name (`myLink`
 * vs `theirLink`); reusing it would mean two callers pinning one shape for
 * unrelated reasons.
 */
export type MatchLinkSummary = {
    pageUrl: string | null;
    anchorText: string | null;
    status: LinkStatus;
    placement: Placement;
    rel: string[];
    lastCheckedAt: Date | null;
};

export type MatchView = {
    matchId: string;
    state: MatchState;
    category: Category;
    /**
     * True when this pair came from an adjacent category, because the exact one
     * was too thin to pair inside.
     *
     * Exposed because house rule §02 promises we widen "and say so", and a
     * widened match is indistinguishable from a wrong one otherwise.
     *
     * A property of the PAIR, not the viewer, so both sides can render it and
     * each side's "adjacent" means the OTHER site's category. Which category was
     * thin is NOT symmetric — only the initiating side was measured against
     * `WIDEN_BELOW` — so no surface should tell a member theirs was the thin one.
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
     * Derivable from `state` only if you know which side of the pair the viewer
     * is on, which `MatchView` deliberately does not expose — the ordering is an
     * implementation detail of the uniqueness constraint. Computed here, where
     * `mineIsA` is already known.
     */
    waitingOnMe: boolean;
    expiresAt: Date;
    /**
     * The viewer's own placement, once they have reported one. Null until then.
     *
     * Without this both surfaces are blind to work that is already done: the
     * dashboard re-renders an empty "where did you put it" form on every reload,
     * and `nextStep` keeps asking for a placement that exists. Neither could tell,
     * because a match stays `agreed` until BOTH directions are live, so `state`
     * alone cannot distinguish "you have not placed" from "they have not".
     *
     * Safe against the masking boundary: `markLinkPlaced` refuses unless the
     * match is revealed, so a link row cannot exist before agreement.
     */
    myLink: MatchLinkSummary | null;
    /** The partner's placement back. Null until they report one. */
    theirLink: MatchLinkSummary | null;
};

/** The columns a match view needs, from the row the database already handed us. */
function toLinkSummary(link: ExchangeLink): MatchLinkSummary {
    return {
        pageUrl: link.pageUrl,
        anchorText: link.anchorText,
        status: link.status,
        placement: link.placement,
        rel: link.rel,
        lastCheckedAt: link.lastCheckedAt,
    };
}

/**
 * @param partnerCounts - Live link counts for every partner in the batch, when
 *   the caller is building more than one view. `listMatches` renders up to 50,
 *   and resolving standing per view would be 50 round trips for one page.
 *   Omitted by the single-view callers, which then pay one query.
 * @param linksByMatch - Same bargain for the links on each match, keyed by match
 *   id. Built once by `listMatches`; omitted by the single-view callers, which
 *   then pay one query each.
 */
async function buildMatchView(
    match: ExchangeMatch,
    viewerSiteIds: Set<string>,
    partnerCounts?: Map<string, LiveLinkCounts>,
    linksByMatch?: Map<string, ExchangeLink[]>,
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

    const links = linksByMatch
        ? (linksByMatch.get(match.id) ?? [])
        : await db().select().from(exchangeLinks).where(eq(exchangeLinks.matchId, match.id));
    const myLinkRow = links.find((l) => l.fromSiteId === mySiteId) ?? null;
    const theirLinkRow = links.find((l) => l.fromSiteId === partnerSiteId) ?? null;
    const myLink = myLinkRow ? toLinkSummary(myLinkRow) : null;
    const theirLink = theirLinkRow ? toLinkSummary(theirLinkRow) : null;

    const myAcceptState = mineIsA ? "a_accepted" : "b_accepted";
    const theirAcceptState = mineIsA ? "b_accepted" : "a_accepted";

    // `agreed` covers three different situations for the viewer, and telling all
    // three to go place a link is wrong for two of them. The state cannot
    // separate them on its own: it only leaves `agreed` when BOTH directions are
    // live, so it says nothing about which side is the holdup.
    const agreedStep =
        myLink === null
            ? "Agreed. Call get_link_brief for this match, place their link on your site, then call mark_link_placed."
            : myLink.status === "live"
              ? "Your link is live. Waiting on them to place theirs. Nothing to do."
              : "We recorded your page but could not confirm the link yet. Call mark_link_placed again if you have since fixed it.";

    const nextStep =
        state === "proposed"
            ? "They have not responded yet either. Accept to signal you are in, and if they accept too you are both revealed to each other."
            : state === myAcceptState
              ? "You have accepted. Waiting on them."
              : state === theirAcceptState
                ? "They have accepted and are waiting on you. Accept to reveal both sides and get the link brief."
                : state === "agreed"
                  ? agreedStep
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
        myLink,
        theirLink,
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

    // Same bargain as `partnerCounts` above: one query for the whole page rather
    // than one per rendered match.
    const linksByMatch = new Map<string, ExchangeLink[]>();
    if (matches.length > 0) {
        const rows = await db()
            .select()
            .from(exchangeLinks)
            .where(
                inArray(
                    exchangeLinks.matchId,
                    matches.map((m) => m.id),
                ),
            );
        for (const row of rows) {
            const bucket = linksByMatch.get(row.matchId);
            if (bucket) bucket.push(row);
            else linksByMatch.set(row.matchId, [row]);
        }
    }

    const views = await Promise.all(matches.map((m) => buildMatchView(m, idSet, partnerCounts, linksByMatch)));
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

    // Compare-and-set, because both sides get the proposal email in the same
    // instant and two agents will accept within the same second. An unguarded
    // UPDATE loses the first write and leaves both members told "waiting on
    // them" until it expires. Every write carries the state it was computed
    // from; a miss means someone moved first, so re-read and recompute.
    let current = match;
    let updated = match;
    for (let attempt = 0; ; attempt++) {
        const from = current.state;
        if (from === "declined" || from === "expired") {
            throw new MatchError("bad_state", `This match is already ${from}.`);
        }

        // Declining an agreed match must be refused: a revealed match can already
        // have a live link behind it, and the link row would stay live while its
        // match read `declined`. Re-accepting is the harmless agent retry and is
        // a no-op just below.
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
