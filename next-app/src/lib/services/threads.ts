import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";

import type { Category } from "@/lib/categories";
import type { MaskedPartner, RevealedPartner } from "@/lib/contracts";
import { db } from "@/lib/db";
import {
    type ExchangeLink,
    type ExchangeMatch,
    type ExchangeMember,
    type ExchangeMessage,
    type ExchangeSite,
    exchangeLinks,
    exchangeMatches,
    exchangeMembers,
    exchangeMessages,
    exchangeSites,
    exchangeThreadReads,
} from "@/lib/db/schema";
import { notifyMessageReceived } from "@/lib/email/notify";
import { type MatchState, isRevealed } from "@/lib/exchange";
import {
    MESSAGE_MAX_LENGTH,
    type TaskState,
    type ThreadStep,
    type ThreadStepView,
    type TimelineEntry,
    buildTimeline,
    linkTaskState,
    shouldNotifyMessage,
    threadEvents,
    threadSteps,
} from "@/lib/inbox";
import { toMaskedPartner, toRevealedPartner } from "@/lib/services/mask";
import { NO_LINKS, liveLinkCountsFor } from "@/lib/services/standing";

/**
 * @file The inbox: one thread per match, and the messages inside it.
 *
 * A thread IS a match. There is no conversation id, no participants table, and
 * nothing here creates a thread: `autoPair` already made the row, and this file
 * only ever reads it and hangs messages off it.
 *
 * THE GATE, and it is the only rule in this file worth memorising: messages are
 * refused unless the match is revealed. Before mutual acceptance neither member
 * knows who the other is, and a free-text channel between them is the one thing
 * that could hand over a domain that `services/mask.ts` spent the whole product
 * withholding. Every entry point below re-checks it rather than trusting the
 * caller, because there are three callers (two routes and an MCP tool) and a
 * check in the UI protects nobody.
 *
 * Two readings of "revealed", and they differ only after a match closes. A
 * match agreed and then expired keeps its identities out — `isRevealed` with
 * `agreedAt` says so — so its thread stays readable and keeps naming both
 * sides. Writing takes the strict reading, the state alone: a closed thread is
 * read-only whatever it once was.
 *
 * Ownership is checked the same way everywhere else does it: the viewer's site
 * ids, then whether the match names one of them. A match that names none of them
 * is reported as `not_yours` rather than `not_found`, matching `MatchError`, so
 * the two services cannot disagree about what a member is allowed to learn.
 *
 * The pure half of the inbox — the rail, the derived timeline, the reply
 * throttle — lives in `lib/inbox.ts` and is unit tested there.
 */

/** How many messages a thread hands back per read. Threads are conversations, not archives. */
const MESSAGE_PAGE = 200;

/** How many threads the list returns, matching the cap on `listMatches`. */
const THREAD_LIMIT = 50;

export class ThreadError extends Error {
    constructor(
        public readonly code: "not_found" | "not_yours" | "not_revealed" | "invalid",
        message: string,
    ) {
        super(message);
        this.name = "ThreadError";
    }
}

/** A message, as both interfaces render it. */
export type MessageView = {
    id: string;
    matchId: string;
    body: string;
    /** True when the viewer wrote it. */
    mine: boolean;
    /** "You", or the partner's domain — which only exists once revealed. */
    senderLabel: string;
    createdAt: Date;
};

export type ThreadSummary = {
    matchId: string;
    state: MatchState;
    /** Identities are out: both sides accepted at some point, even if the match has since closed. */
    revealed: boolean;
    /** The partner's domain once revealed, otherwise a category description. */
    partnerLabel: string;
    partnerCategory: Category;
    partnerDomainRating: number | null;
    mySiteDomain: string;
    step: ThreadStep | null;
    /** Null on a thread nobody has written in yet. */
    lastMessage: { body: string; mine: boolean; createdAt: Date } | null;
    /** Newest of the last message and the match's own last movement. Sorts the list. */
    lastActivityAt: Date;
    unread: number;
    waitingOnMe: boolean;
    /** Open AND revealed. False on a closed thread, even one that was revealed. */
    canMessage: boolean;
};

/** One direction of the trade, as the thread's task rows render it. */
export type ThreadTask = {
    direction: "mine" | "theirs";
    /** "You" or "Them", already resolved so no surface has to phrase it twice. */
    owner: string;
    state: TaskState;
    /** The page the link sits on. Post-reveal only, so safe to show. */
    pageUrl: string | null;
    anchorText: string | null;
    /** Where this direction's link has to point. */
    targetDomain: string;
    checkedAt: Date | null;
    dofollow: boolean | null;
};

export type ThreadDetail = {
    matchId: string;
    state: MatchState;
    /** Identities are out: both sides accepted at some point, even if the match has since closed. */
    revealed: boolean;
    widened: boolean;
    /** The PARTNER's category, for the same reason the dashboard uses it. */
    category: Category;
    partner: MaskedPartner | RevealedPartner;
    partnerLabel: string;
    mySite: { id: string; domain: string; url: string; domainRating: number | null };
    steps: ThreadStepView[];
    tasks: ThreadTask[];
    timeline: TimelineEntry[];
    /** Open AND revealed. False on a closed thread, even one that was revealed. */
    canMessage: boolean;
    waitingOnMe: boolean;
    expiresAt: Date;
    lastReadAt: Date | null;
};

/** The site ids a member owns, the start of every ownership check here. */
async function mySiteIds(member: ExchangeMember): Promise<string[]> {
    const rows = await db()
        .select({ id: exchangeSites.id })
        .from(exchangeSites)
        .where(eq(exchangeSites.ownerId, member.userId));
    return rows.map((r) => r.id);
}

type ThreadContext = {
    match: ExchangeMatch;
    mineIsA: boolean;
    mySite: ExchangeSite;
    partnerSite: ExchangeSite;
};

/**
 * Loads one match with both sites, having proved the viewer is in it.
 *
 * @throws `ThreadError` when the match is missing or names none of the viewer's
 *   sites. Both are refusals, and neither says anything about a match the caller
 *   is not part of.
 */
async function loadThread(member: ExchangeMember, matchId: string): Promise<ThreadContext> {
    const [match] = await db().select().from(exchangeMatches).where(eq(exchangeMatches.id, matchId)).limit(1);
    if (!match) throw new ThreadError("not_found", "No thread with that id.");

    const ids = new Set(await mySiteIds(member));
    const mineIsA = ids.has(match.siteAId);
    if (!mineIsA && !ids.has(match.siteBId)) {
        throw new ThreadError("not_yours", "That thread does not involve any of your sites.");
    }

    const mySiteId = mineIsA ? match.siteAId : match.siteBId;
    const partnerSiteId = mineIsA ? match.siteBId : match.siteAId;
    const sites = await db()
        .select()
        .from(exchangeSites)
        .where(inArray(exchangeSites.id, [mySiteId, partnerSiteId]));

    const mySite = sites.find((s) => s.id === mySiteId);
    const partnerSite = sites.find((s) => s.id === partnerSiteId);
    if (!mySite || !partnerSite) throw new ThreadError("not_found", "One side of this thread no longer exists.");

    return { match, mineIsA, mySite, partnerSite };
}

/** What a partner is called before and after the reveal. */
function labelFor(site: ExchangeSite, revealed: boolean): string {
    return revealed ? site.domain : `A ${site.category} site`;
}

/** True when the other side accepted first and the viewer has not answered. */
function isWaitingOnMe(match: ExchangeMatch, mineIsA: boolean): boolean {
    return match.state === (mineIsA ? "b_accepted" : "a_accepted");
}

/**
 * Every thread the member is in, newest activity first.
 *
 * Four queries regardless of how many threads come back: the matches, their
 * links, one aggregate for unread counts, and one `DISTINCT ON` for the preview
 * line. Doing any of them per thread is how a fifty-row inbox becomes two
 * hundred round trips.
 */
export async function listThreads(member: ExchangeMember): Promise<ThreadSummary[]> {
    const ids = await mySiteIds(member);
    if (ids.length === 0) return [];

    const matches = await db()
        .select()
        .from(exchangeMatches)
        .where(or(inArray(exchangeMatches.siteAId, ids), inArray(exchangeMatches.siteBId, ids)))
        .orderBy(desc(exchangeMatches.updatedAt))
        .limit(THREAD_LIMIT);
    if (matches.length === 0) return [];

    const idSet = new Set(ids);
    const matchIds = matches.map((m) => m.id);
    const partnerIds = matches.map((m) => (idSet.has(m.siteAId) ? m.siteBId : m.siteAId));

    const [partners, links, unreadRows, previews, mySites] = await Promise.all([
        db().select().from(exchangeSites).where(inArray(exchangeSites.id, partnerIds)),
        db().select().from(exchangeLinks).where(inArray(exchangeLinks.matchId, matchIds)),
        db()
            .select({ matchId: exchangeMessages.matchId, unread: count() })
            .from(exchangeMessages)
            .leftJoin(
                exchangeThreadReads,
                and(
                    eq(exchangeThreadReads.matchId, exchangeMessages.matchId),
                    eq(exchangeThreadReads.userId, member.userId),
                ),
            )
            .where(
                and(
                    inArray(exchangeMessages.matchId, matchIds),
                    ne(exchangeMessages.senderUserId, member.userId),
                    or(
                        isNull(exchangeThreadReads.lastReadAt),
                        gt(exchangeMessages.createdAt, exchangeThreadReads.lastReadAt),
                    ),
                ),
            )
            .groupBy(exchangeMessages.matchId),
        db()
            .selectDistinctOn([exchangeMessages.matchId], {
                matchId: exchangeMessages.matchId,
                body: exchangeMessages.body,
                senderUserId: exchangeMessages.senderUserId,
                createdAt: exchangeMessages.createdAt,
            })
            .from(exchangeMessages)
            .where(inArray(exchangeMessages.matchId, matchIds))
            .orderBy(exchangeMessages.matchId, desc(exchangeMessages.createdAt)),
        db().select().from(exchangeSites).where(inArray(exchangeSites.id, ids)),
    ]);

    const partnerById = new Map(partners.map((p) => [p.id, p]));
    const mySiteById = new Map(mySites.map((s) => [s.id, s]));
    const unreadByMatch = new Map(unreadRows.map((r) => [r.matchId, Number(r.unread)]));
    const previewByMatch = new Map(previews.map((p) => [p.matchId, p]));
    const linksByMatch = new Map<string, ExchangeLink[]>();
    for (const link of links) {
        const bucket = linksByMatch.get(link.matchId);
        if (bucket) bucket.push(link);
        else linksByMatch.set(link.matchId, [link]);
    }

    const summaries: ThreadSummary[] = [];
    for (const match of matches) {
        const mineIsA = idSet.has(match.siteAId);
        const mySite = mySiteById.get(mineIsA ? match.siteAId : match.siteBId);
        const partner = partnerById.get(mineIsA ? match.siteBId : match.siteAId);
        if (!mySite || !partner) continue;

        const threadLinks = linksByMatch.get(match.id) ?? [];
        const myLink = threadLinks.find((l) => l.fromSiteId === mySite.id) ?? null;
        const theirLink = threadLinks.find((l) => l.fromSiteId === partner.id) ?? null;
        const steps = threadSteps({
            state: match.state,
            myLinkStatus: myLink?.status ?? null,
            theirLinkStatus: theirLink?.status ?? null,
        });
        const preview = previewByMatch.get(match.id) ?? null;
        const revealed = isRevealed(match.state, match.agreedAt);

        summaries.push({
            matchId: match.id,
            state: match.state,
            revealed,
            partnerLabel: labelFor(partner, revealed),
            partnerCategory: partner.category,
            partnerDomainRating: partner.domainRating,
            mySiteDomain: mySite.domain,
            step: steps.find((s) => s.status === "current")?.step ?? null,
            lastMessage: preview
                ? { body: preview.body, mine: preview.senderUserId === member.userId, createdAt: preview.createdAt }
                : null,
            lastActivityAt: preview && preview.createdAt > match.updatedAt ? preview.createdAt : match.updatedAt,
            unread: unreadByMatch.get(match.id) ?? 0,
            waitingOnMe: isWaitingOnMe(match, mineIsA),
            canMessage: isRevealed(match.state),
        });
    }

    return summaries.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

/** Turns one stored link row into the task line above the timeline. */
function toTask(input: { direction: "mine" | "theirs"; link: ExchangeLink | null; targetDomain: string }): ThreadTask {
    const { direction, link, targetDomain } = input;
    return {
        direction,
        owner: direction === "mine" ? "You" : "Them",
        state: linkTaskState(link),
        pageUrl: link?.pageUrl ?? null,
        anchorText: link?.anchorText ?? null,
        targetDomain,
        checkedAt: link?.lastCheckedAt ?? null,
        dofollow: link ? !link.rel.includes("nofollow") : null,
    };
}

/**
 * One thread, with everything the pane renders.
 *
 * The masking boundary is applied here and nowhere downstream: `partner` is a
 * `MaskedPartner` until the match is revealed, and that type has no domain field
 * for a route or a component to reach for. The task rows name domains, and they
 * are only populated from link rows, which `markLinkPlaced` refuses to create
 * before agreement.
 */
export async function getThread(input: { member: ExchangeMember; matchId: string }): Promise<ThreadDetail> {
    const { member } = input;
    const { match, mineIsA, mySite, partnerSite } = await loadThread(member, input.matchId);

    const [links, messages, readRow, counts] = await Promise.all([
        db().select().from(exchangeLinks).where(eq(exchangeLinks.matchId, match.id)),
        db()
            .select()
            .from(exchangeMessages)
            .where(eq(exchangeMessages.matchId, match.id))
            .orderBy(asc(exchangeMessages.createdAt))
            .limit(MESSAGE_PAGE),
        db()
            .select()
            .from(exchangeThreadReads)
            .where(and(eq(exchangeThreadReads.matchId, match.id), eq(exchangeThreadReads.userId, member.userId)))
            .limit(1),
        liveLinkCountsFor(partnerSite.id),
    ]);

    const revealed = isRevealed(match.state, match.agreedAt);
    const myLink = links.find((l) => l.fromSiteId === mySite.id) ?? null;
    const theirLink = links.find((l) => l.fromSiteId === partnerSite.id) ?? null;

    let partner: MaskedPartner | RevealedPartner;
    if (revealed) {
        const [partnerMember] = await db()
            .select({ email: exchangeMembers.email })
            .from(exchangeMembers)
            .where(eq(exchangeMembers.userId, partnerSite.ownerId))
            .limit(1);
        partner = toRevealedPartner(
            partnerSite,
            counts ?? NO_LINKS,
            partnerMember?.email ?? "",
            match.state,
            match.agreedAt,
        );
    } else {
        partner = toMaskedPartner(partnerSite, counts ?? NO_LINKS);
    }

    const partnerLabel = labelFor(partnerSite, revealed);
    const events = threadEvents({
        state: match.state,
        proposedAt: match.createdAt,
        aAcceptedAt: match.aAcceptedAt,
        bAcceptedAt: match.bAcceptedAt,
        agreedAt: match.agreedAt,
        expiresAt: match.expiresAt,
        mineIsA,
        myDomain: mySite.domain,
        partnerLabel,
        links: links.map((link) => ({
            id: link.id,
            fromMine: link.fromSiteId === mySite.id,
            status: link.status,
            pageUrl: link.pageUrl,
            firstSeenAt: link.firstSeenAt,
            removedAt: link.removedAt,
            createdAt: link.createdAt,
        })),
    });

    return {
        matchId: match.id,
        state: match.state,
        revealed,
        widened: match.widened,
        category: partnerSite.category,
        partner,
        partnerLabel,
        mySite: { id: mySite.id, domain: mySite.domain, url: mySite.url, domainRating: mySite.domainRating },
        steps: threadSteps({
            state: match.state,
            myLinkStatus: myLink?.status ?? null,
            theirLinkStatus: theirLink?.status ?? null,
        }),
        tasks: [
            toTask({ direction: "mine", link: myLink, targetDomain: revealed ? partnerSite.domain : "their site" }),
            toTask({ direction: "theirs", link: theirLink, targetDomain: mySite.domain }),
        ],
        timeline: buildTimeline({
            events,
            messages: messages.map((m) => toMessageView(m, member, partnerLabel)),
        }),
        canMessage: isRevealed(match.state),
        waitingOnMe: isWaitingOnMe(match, mineIsA),
        expiresAt: match.expiresAt,
        lastReadAt: readRow[0]?.lastReadAt ?? null,
    };
}

function toMessageView(row: ExchangeMessage, member: ExchangeMember, partnerLabel: string): MessageView {
    const mine = row.senderUserId === member.userId;
    return {
        id: row.id,
        matchId: row.matchId,
        body: row.body,
        mine,
        senderLabel: mine ? "You" : partnerLabel,
        createdAt: row.createdAt,
    };
}

/**
 * Messages in a thread, oldest first, optionally only those after a cursor.
 *
 * The `since` cursor is what makes polling cheap: an idle thread answers with an
 * empty array rather than re-sending the conversation every few seconds.
 *
 * Readable for as long as the identities are out, so a thread that closed after
 * agreement keeps its history.
 *
 * @throws `ThreadError` when the match is not the member's or was never revealed.
 */
export async function listMessages(input: {
    member: ExchangeMember;
    matchId: string;
    since?: Date;
}): Promise<MessageView[]> {
    const { member } = input;
    const { match, partnerSite } = await loadThread(member, input.matchId);
    const revealed = isRevealed(match.state, match.agreedAt);
    if (!revealed) throw new ThreadError("not_revealed", "Messages open once both sides accept the match.");

    const rows = await db()
        .select()
        .from(exchangeMessages)
        .where(
            and(
                eq(exchangeMessages.matchId, match.id),
                input.since ? gt(exchangeMessages.createdAt, input.since) : undefined,
            ),
        )
        .orderBy(asc(exchangeMessages.createdAt))
        .limit(MESSAGE_PAGE);

    const partnerLabel = labelFor(partnerSite, revealed);
    return rows.map((row) => toMessageView(row, member, partnerLabel));
}

/**
 * Writes a message into a thread, and decides whether it is worth an email.
 *
 * `notified_at` is stamped in the same INSERT as the decision to send, not after
 * SES answers. The throttle is a promise about how often we mail someone, and a
 * high-water mark that only moves on success turns a broken mailer into a mail
 * storm the moment it recovers.
 *
 * @throws `ThreadError` when the match is not the member's, is not revealed, or
 *   the body is empty or over {@link MESSAGE_MAX_LENGTH}.
 */
export async function sendMessage(input: {
    member: ExchangeMember;
    matchId: string;
    body: string;
}): Promise<MessageView> {
    const { member } = input;
    const body = input.body.trim();
    if (body.length === 0) throw new ThreadError("invalid", "A message needs some text in it.");
    if (body.length > MESSAGE_MAX_LENGTH) {
        throw new ThreadError("invalid", `Messages are capped at ${MESSAGE_MAX_LENGTH} characters.`);
    }

    const { match, mySite, partnerSite } = await loadThread(member, input.matchId);
    // The strict reading, on purpose: a closed thread is read-only even though
    // its identities stay out. The refusal says which of the two it is.
    if (!isRevealed(match.state)) {
        throw new ThreadError(
            "not_revealed",
            match.agreedAt
                ? "This exchange is closed, so its thread is read-only."
                : "Messages open once both sides accept the match.",
        );
    }

    const now = new Date();
    const [lastNotified, recipientRead] = await Promise.all([
        db()
            .select({ notifiedAt: exchangeMessages.notifiedAt })
            .from(exchangeMessages)
            .where(eq(exchangeMessages.matchId, match.id))
            .orderBy(desc(exchangeMessages.notifiedAt))
            .limit(1),
        db()
            .select({ lastReadAt: exchangeThreadReads.lastReadAt })
            .from(exchangeThreadReads)
            .where(and(eq(exchangeThreadReads.matchId, match.id), eq(exchangeThreadReads.userId, partnerSite.ownerId)))
            .limit(1),
    ]);

    const notify = shouldNotifyMessage({
        recipientLastReadAt: recipientRead[0]?.lastReadAt ?? null,
        lastNotifiedAt: lastNotified[0]?.notifiedAt ?? null,
        now,
    });

    const [row] = await db()
        .insert(exchangeMessages)
        .values({
            matchId: match.id,
            senderUserId: member.userId,
            senderSiteId: mySite.id,
            body,
            notifiedAt: notify ? now : null,
        })
        .returning();
    if (!row) throw new ThreadError("invalid", "That message could not be saved.");

    // The sender's own view is up to date the moment they send, so their read
    // cursor moves with the write rather than waiting for a poll to report
    // their own message back as unread.
    await touchRead(match.id, member.userId, now);

    if (notify) {
        void notifyMessageReceived({
            matchId: match.id,
            recipientSite: partnerSite,
            senderDomain: mySite.domain,
            body,
        });
    }

    // Past the gate above, so the partner is named.
    return toMessageView(row, member, labelFor(partnerSite, true));
}

/** Moves a reader's cursor to `at`, inserting the row the first time. */
async function touchRead(matchId: string, userId: string, at: Date): Promise<void> {
    await db()
        .insert(exchangeThreadReads)
        .values({ matchId, userId, lastReadAt: at })
        .onConflictDoUpdate({
            target: [exchangeThreadReads.matchId, exchangeThreadReads.userId],
            set: { lastReadAt: at },
        });
}

/**
 * Marks a thread read up to now.
 *
 * Allowed before reveal, unlike messaging: a member can open a proposal they
 * have not accepted, and refusing to record that would leave the unread badge
 * on a thread they are looking at.
 */
export async function markThreadRead(input: {
    member: ExchangeMember;
    matchId: string;
}): Promise<{ lastReadAt: Date }> {
    const { match } = await loadThread(input.member, input.matchId);
    const now = new Date();
    await touchRead(match.id, input.member.userId, now);
    return { lastReadAt: now };
}

/**
 * Unread messages across every thread, for the nav badge.
 *
 * One query, and it counts messages rather than threads: a member with one
 * thread and nine replies is told nine, which is what the number on a mail icon
 * has always meant.
 */
export async function unreadTotal(member: ExchangeMember): Promise<number> {
    const ids = await mySiteIds(member);
    if (ids.length === 0) return 0;

    const rows = await db()
        .select({ total: count() })
        .from(exchangeMessages)
        .innerJoin(exchangeMatches, eq(exchangeMatches.id, exchangeMessages.matchId))
        .leftJoin(
            exchangeThreadReads,
            and(
                eq(exchangeThreadReads.matchId, exchangeMessages.matchId),
                eq(exchangeThreadReads.userId, member.userId),
            ),
        )
        .where(
            and(
                or(inArray(exchangeMatches.siteAId, ids), inArray(exchangeMatches.siteBId, ids)),
                ne(exchangeMessages.senderUserId, member.userId),
                or(
                    isNull(exchangeThreadReads.lastReadAt),
                    gt(exchangeMessages.createdAt, exchangeThreadReads.lastReadAt),
                ),
            ),
        );

    return Number(rows[0]?.total ?? 0);
}
