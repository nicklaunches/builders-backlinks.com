import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { type ExchangeMember, type ExchangeSite, exchangeLinks, exchangeMatches, exchangeSites } from "@/lib/db/schema";
import { notifyLinkVerified } from "@/lib/email/notify";
import { type LinkStatus, type Placement, isRevealed } from "@/lib/exchange";
import { verifyLink } from "@/lib/verify";

/**
 * @file The placement loop: brief, place, verify.
 *
 * This is the part of the product no competitor has. Everywhere else, an agreed
 * trade ends with "now go add the link yourself", and roughly half of them die
 * there because it means opening an editor, finding the right page, writing a
 * sentence, committing, and deploying. When the caller is an agent already
 * sitting in the member's repository, that entire gap collapses into one tool
 * call and one edit.
 *
 * POLICY, stated once and enforced nowhere: we classify placements, we do not
 * referee them. A footer link and a nofollow link are recorded as exactly what
 * they are and shown to both sides, and both still count. Members were promised
 * that where the link lands is their call, and the guidance below is advice, not
 * a rule. If you are tempted to add a rejection branch here, that is a product
 * decision to be made deliberately, not a bug fix.
 */

export class LinkError extends Error {
    constructor(
        public readonly code: "not_found" | "not_yours" | "not_agreed" | "invalid_url",
        message: string,
    ) {
        super(message);
        this.name = "LinkError";
    }
}

export type SnippetFormat = "html" | "markdown" | "mdx" | "jsx";

export type LinkBrief = {
    matchId: string;
    /** Where the link must point. Only available once the match is agreed. */
    targetUrl: string;
    targetDomain: string;
    /** What the partner would like to be linked as. Pick one, or write your own. */
    anchorOptions: string[];
    /** What the partner's site is about, so the agent can write a real sentence. */
    partnerDescription: string;
    /** What the partner said they can offer you in return. */
    partnerOffers: string;
    snippet: string;
    /** Advisory only. Nothing here is enforced. */
    guidance: string[];
};

const GUIDANCE: string[] = [
    "Put it somewhere a reader would genuinely find it useful. A sentence inside an existing, relevant page beats a new page made to hold links.",
    "Write the surrounding sentence in your own voice. A link with real context around it is worth more to both of you than a bare list entry.",
    "Vary the anchor. If everyone uses the same phrase for a site, that pattern is visible and helps nobody.",
    "A footer or sidebar link is allowed and still counts. It is simply worth less, and your partner will see exactly what you gave, as you will see theirs.",
];

function buildSnippet(format: SnippetFormat, url: string, anchor: string): string {
    switch (format) {
        case "markdown":
        case "mdx":
            return `[${anchor}](${url})`;
        case "jsx":
            return `<a href="${url}">${anchor}</a>`;
        case "html":
        default:
            return `<a href="${url}">${anchor}</a>`;
    }
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
 * Returns everything needed to place a partner's link, once both sides agreed.
 *
 * @throws `LinkError` when the match is not the member's, or has not reached
 *   mutual accept. The target URL simply does not exist before that point.
 */
export async function getLinkBrief(input: {
    member: ExchangeMember;
    matchId: string;
    format?: SnippetFormat;
}): Promise<LinkBrief> {
    const [match] = await db().select().from(exchangeMatches).where(eq(exchangeMatches.id, input.matchId)).limit(1);
    if (!match) throw new LinkError("not_found", "No match with that id.");

    const idSet = new Set(await mySiteIds(input.member));
    const mineIsA = idSet.has(match.siteAId);
    if (!mineIsA && !idSet.has(match.siteBId)) {
        throw new LinkError("not_yours", "That match does not involve any of your sites.");
    }

    if (!isRevealed(match.state)) {
        throw new LinkError(
            "not_agreed",
            "Both sides have to accept before URLs are revealed. Call respond_to_match with accept first.",
        );
    }

    const partnerSiteId = mineIsA ? match.siteBId : match.siteAId;
    const [partner] = await db().select().from(exchangeSites).where(eq(exchangeSites.id, partnerSiteId)).limit(1);
    if (!partner) throw new LinkError("not_found", "The other side of this match no longer exists.");

    return briefFor(partner, { matchId: match.id, format: input.format });
}

/**
 * Builds a brief from a partner site, with no ownership or state checks.
 *
 * `getLinkBrief` is the guarded entry point and does those checks first. This
 * exists because the agreed-match email needs the same brief for a member who
 * is not the current caller, and duplicating the shape in the email layer is
 * how the two drift apart.
 *
 * The CALLER decides whose site this is. Pass the partner, never the recipient,
 * or everyone is told to link to themselves.
 */
export function briefFor(
    partner: ExchangeSite,
    options: { matchId: string; format?: SnippetFormat } = { matchId: "" },
): LinkBrief {
    const format = options.format ?? "html";
    const anchors = partner.keywords.slice(0, 4);
    const anchor = anchors[0] ?? partner.domain;

    return {
        matchId: options.matchId,
        targetUrl: partner.url,
        targetDomain: partner.domain,
        anchorOptions: anchors,
        partnerDescription: partner.description,
        partnerOffers: partner.placementOffered,
        snippet: buildSnippet(format, partner.url, anchor),
        guidance: GUIDANCE,
    };
}

export type PlacementReport = {
    linkId: string;
    status: LinkStatus;
    placement: Placement;
    rel: string[];
    anchorText: string | null;
    sitewide: boolean;
    /** Plain-language outcome, safe to show the member verbatim. */
    message: string;
    /** True when the crawl itself failed, so this is inconclusive, not a miss. */
    inconclusive: boolean;
};

/**
 * Records a placement and verifies it immediately.
 *
 * Verification runs inline rather than on a queue because the caller is
 * usually an agent that just made the edit: telling it "verified, in content,
 * dofollow" while it still has the context is worth far more than an email an
 * hour later.
 *
 * A crawl failure is reported as inconclusive, never as a missing link.
 * Client-rendered sites legitimately fail an HTML-only fetch, and accusing a
 * member of not placing a link they did place is the worst error this system
 * can make.
 */
export async function markLinkPlaced(input: {
    member: ExchangeMember;
    matchId: string;
    pageUrl: string;
    anchorUsed?: string;
}): Promise<PlacementReport> {
    const [match] = await db().select().from(exchangeMatches).where(eq(exchangeMatches.id, input.matchId)).limit(1);
    if (!match) throw new LinkError("not_found", "No match with that id.");
    if (!isRevealed(match.state)) {
        throw new LinkError("not_agreed", "This match is not agreed yet, so there is no link to place.");
    }

    const mySites = await db().select().from(exchangeSites).where(eq(exchangeSites.ownerId, input.member.userId));
    const mine = mySites.find((s) => s.id === match.siteAId || s.id === match.siteBId);
    if (!mine) throw new LinkError("not_yours", "That match does not involve any of your sites.");

    const partnerSiteId = mine.id === match.siteAId ? match.siteBId : match.siteAId;
    const [partner] = await db().select().from(exchangeSites).where(eq(exchangeSites.id, partnerSiteId)).limit(1);
    if (!partner) throw new LinkError("not_found", "The other side of this match no longer exists.");

    const result = await verifyLink({
        pageUrl: input.pageUrl,
        targetDomain: partner.domain,
        detectSitewide: true,
    });

    const inconclusive = result.error !== null;
    const now = new Date();
    const status: LinkStatus = result.found ? "live" : inconclusive ? "promised" : "missing";

    // Upsert on the unique `(match, from, to)` index: one link per direction per
    // match, and re-reporting the same placement is a correction rather than a
    // second link. `checkCount` is incremented in SQL rather than read and
    // written back, so two agents reporting at once cannot lose a count.
    const [link] = await db()
        .insert(exchangeLinks)
        .values({
            matchId: match.id,
            fromSiteId: mine.id,
            toSiteId: partner.id,
            pageUrl: input.pageUrl,
            anchorText: result.anchorText ?? input.anchorUsed ?? null,
            status,
            placement: result.placement,
            rel: [...result.rel],
            sitewide: result.sitewide,
            firstSeenAt: result.found ? now : null,
            lastCheckedAt: now,
            checkCount: 1,
            lastMessage: result.message,
        })
        .onConflictDoUpdate({
            target: [exchangeLinks.matchId, exchangeLinks.fromSiteId, exchangeLinks.toSiteId],
            set: {
                pageUrl: input.pageUrl,
                anchorText: result.anchorText ?? input.anchorUsed ?? null,
                status,
                placement: result.placement,
                rel: [...result.rel],
                sitewide: result.sitewide,
                lastCheckedAt: now,
                lastMessage: result.message,
                checkCount: sql`${exchangeLinks.checkCount} + 1`,
                updatedAt: now,
                // Stamped only on a hit, exactly as before: a miss must not
                // erase the date the recheck schedule counts from.
                ...(result.found ? { firstSeenAt: now } : {}),
            },
        })
        .returning();

    if (!link) throw new LinkError("not_found", "The placement could not be recorded.");

    if (result.found) {
        await db()
            .update(exchangeSites)
            .set({ linksGiven: sql`${exchangeSites.linksGiven} + 1`, updatedAt: now })
            .where(eq(exchangeSites.id, mine.id));
        await db()
            .update(exchangeSites)
            .set({ linksGot: sql`${exchangeSites.linksGot} + 1`, updatedAt: now })
            .where(eq(exchangeSites.id, partner.id));

        // Both directions live promotes the match. Counted rather than assumed:
        // one side placing does not make a trade complete.
        const [live] = await db()
            .select({ n: count() })
            .from(exchangeLinks)
            .where(and(eq(exchangeLinks.matchId, match.id), eq(exchangeLinks.status, "live")));

        if ((live?.n ?? 0) >= 2 && match.state !== "placed") {
            await db()
                .update(exchangeMatches)
                .set({ state: "placed", updatedAt: now })
                .where(eq(exchangeMatches.id, match.id));
        }
    }

    // Both sides hear the same result. The giver learns whether their placement
    // registered; the receiver learns what they actually got, which is the
    // whole point of classifying rather than refereeing placements.
    const report = {
        direction: "given" as const,
        pageUrl: input.pageUrl,
        targetDomain: partner.domain,
        found: result.found,
        inconclusive,
        placement: result.placement,
        rel: result.rel,
        anchorText: result.anchorText,
        sitewide: result.sitewide,
        message: result.message,
    };
    void notifyLinkVerified({ ...report, site: mine });
    if (result.found) {
        void notifyLinkVerified({ ...report, site: partner, direction: "received" });
    }

    return {
        linkId: link.id,
        status: link.status,
        placement: result.placement,
        rel: result.rel,
        anchorText: result.anchorText,
        sitewide: result.sitewide,
        message: result.message,
        inconclusive,
    };
}

export type LinkLedgerRow = {
    linkId: string;
    direction: "given" | "received";
    matchId: string;
    pageUrl: string | null;
    anchorText: string | null;
    status: LinkStatus;
    placement: Placement;
    rel: string[];
    lastCheckedAt: Date | null;
};

/**
 * Every link this member has given and received, with what it actually is.
 *
 * Both directions on purpose. Seeing what you received, classified honestly, is
 * the whole reason disclosure beats enforcement.
 */
export async function checkLinks(member: ExchangeMember): Promise<LinkLedgerRow[]> {
    const ids = await mySiteIds(member);
    if (ids.length === 0) return [];

    const links = await db()
        .select()
        .from(exchangeLinks)
        .where(or(inArray(exchangeLinks.fromSiteId, ids), inArray(exchangeLinks.toSiteId, ids)))
        .orderBy(desc(exchangeLinks.updatedAt))
        .limit(100);

    const idSet = new Set(ids);
    return links.map((l) => ({
        linkId: l.id,
        direction: idSet.has(l.fromSiteId) ? ("given" as const) : ("received" as const),
        matchId: l.matchId,
        pageUrl: l.pageUrl,
        anchorText: l.anchorText,
        status: l.status,
        placement: l.placement,
        rel: l.rel,
        lastCheckedAt: l.lastCheckedAt,
    }));
}

export type Standing = {
    sites: number;
    linksGiven: number;
    linksReceived: number;
    ratio: number | null;
    health: "new" | "healthy" | "watch" | "behind";
    note: string;
};

/**
 * A member's give/get standing.
 *
 * New members are explicitly `new`, never `behind`. Someone has to place the
 * first link in any pair, and penalising the person who does is exactly
 * backwards.
 */
export async function getStanding(member: ExchangeMember): Promise<Standing> {
    const sites = await db()
        .select({ linksGiven: exchangeSites.linksGiven, linksGot: exchangeSites.linksGot })
        .from(exchangeSites)
        .where(eq(exchangeSites.ownerId, member.userId));

    const given = sites.reduce((n, s) => n + s.linksGiven, 0);
    const received = sites.reduce((n, s) => n + s.linksGot, 0);

    if (given + received < 2) {
        return {
            sites: sites.length,
            linksGiven: given,
            linksReceived: received,
            ratio: null,
            health: "new",
            note: "Your first two exchanges are grace: nothing is expected back yet.",
        };
    }

    const ratio = given / Math.max(received, 1);
    const health = ratio >= 0.8 ? "healthy" : ratio >= 0.5 ? "watch" : "behind";
    const note =
        health === "healthy"
            ? "You give about as much as you get. Matching favours members like you."
            : health === "watch"
              ? "You are receiving a little more than you give. Worth evening up."
              : "You have received noticeably more links than you have given. Place what you owe and matching picks back up.";

    return { sites: sites.length, linksGiven: given, linksReceived: received, ratio, health, note };
}
