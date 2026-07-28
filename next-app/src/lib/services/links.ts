import { connectMongo } from "@/lib/db/mongoose";
import { ExchangeLink, type ExchangeLinkDoc, type Placement } from "@/lib/models/ExchangeLink";
import { ExchangeMatch, type MatchState, isRevealed } from "@/lib/models/ExchangeMatch";
import type { ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";
import { ExchangeSite, type ExchangeSiteHydrated } from "@/lib/models/ExchangeSite";
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

/**
 * Returns everything needed to place a partner's link, once both sides agreed.
 *
 * @throws `LinkError` when the match is not the member's, or has not reached
 *   mutual accept. The target URL simply does not exist before that point.
 */
export async function getLinkBrief(input: {
    member: ExchangeMemberHydrated;
    matchId: string;
    format?: SnippetFormat;
}): Promise<LinkBrief> {
    await connectMongo();

    const match = await ExchangeMatch.findById(input.matchId).exec();
    if (!match) throw new LinkError("not_found", "No match with that id.");

    const mySites = await ExchangeSite.find({ owner: input.member.user }).select("_id").exec();
    const idSet = new Set(mySites.map((s) => String(s._id)));
    const mineIsA = idSet.has(String(match.siteA));
    if (!mineIsA && !idSet.has(String(match.siteB))) {
        throw new LinkError("not_yours", "That match does not involve any of your sites.");
    }

    if (!isRevealed(match.state as MatchState)) {
        throw new LinkError(
            "not_agreed",
            "Both sides have to accept before URLs are revealed. Call respond_to_match with accept first.",
        );
    }

    const partnerSiteId = mineIsA ? match.siteB : match.siteA;
    const partner = await ExchangeSite.findById(partnerSiteId).exec();
    if (!partner) throw new LinkError("not_found", "The other side of this match no longer exists.");

    const format = input.format ?? "html";
    const anchors = (partner.keywords ?? []).slice(0, 4);
    const anchor = anchors[0] ?? partner.domain;

    return {
        matchId: String(match._id),
        targetUrl: partner.url,
        targetDomain: partner.domain,
        anchorOptions: anchors,
        partnerDescription: partner.description,
        partnerOffers: partner.placementOffered ?? "unsure",
        snippet: buildSnippet(format, partner.url, anchor),
        guidance: GUIDANCE,
    };
}

export type PlacementReport = {
    linkId: string;
    status: ExchangeLinkDoc["status"];
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
    member: ExchangeMemberHydrated;
    matchId: string;
    pageUrl: string;
    anchorUsed?: string;
}): Promise<PlacementReport> {
    await connectMongo();

    const match = await ExchangeMatch.findById(input.matchId).exec();
    if (!match) throw new LinkError("not_found", "No match with that id.");
    if (!isRevealed(match.state as MatchState)) {
        throw new LinkError("not_agreed", "This match is not agreed yet, so there is no link to place.");
    }

    const mySites = await ExchangeSite.find({ owner: input.member.user }).exec();
    const mine = mySites.find((s) => String(s._id) === String(match.siteA) || String(s._id) === String(match.siteB));
    if (!mine) throw new LinkError("not_yours", "That match does not involve any of your sites.");

    const partnerSiteId = String(mine._id) === String(match.siteA) ? match.siteB : match.siteA;
    const partner = await ExchangeSite.findById(partnerSiteId).exec();
    if (!partner) throw new LinkError("not_found", "The other side of this match no longer exists.");

    const result = await verifyLink({
        pageUrl: input.pageUrl,
        targetDomain: partner.domain,
        detectSitewide: true,
    });

    const inconclusive = result.error !== null;
    const now = new Date();

    const link = await ExchangeLink.findOneAndUpdate(
        { match: match._id, fromSite: mine._id, toSite: partner._id },
        {
            $set: {
                pageUrl: input.pageUrl,
                anchorText: result.anchorText ?? input.anchorUsed ?? null,
                status: result.found ? "live" : inconclusive ? "promised" : "missing",
                placement: result.placement,
                rel: result.rel,
                sitewide: result.sitewide,
                lastCheckedAt: now,
                lastMessage: result.message,
                ...(result.found ? { firstSeenAt: now } : {}),
            },
            $inc: { checkCount: 1 },
            $setOnInsert: { match: match._id, fromSite: mine._id, toSite: partner._id },
        },
        { upsert: true, new: true },
    ).exec();

    if (result.found) {
        await ExchangeSite.updateOne({ _id: mine._id }, { $inc: { linksGiven: 1 } });
        await ExchangeSite.updateOne({ _id: partner._id }, { $inc: { linksGot: 1 } });

        // Both directions live promotes the match. Counted rather than assumed:
        // one side placing does not make a trade complete.
        const liveCount = await ExchangeLink.countDocuments({ match: match._id, status: "live" });
        if (liveCount >= 2 && match.state !== "placed") {
            match.state = "placed";
            await match.save();
        }
    }

    return {
        linkId: String(link._id),
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
    status: ExchangeLinkDoc["status"];
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
export async function checkLinks(member: ExchangeMemberHydrated): Promise<LinkLedgerRow[]> {
    await connectMongo();

    const mySites = await ExchangeSite.find({ owner: member.user }).select("_id").exec();
    const ids = mySites.map((s) => s._id);
    if (ids.length === 0) return [];

    const links = await ExchangeLink.find({ $or: [{ fromSite: { $in: ids } }, { toSite: { $in: ids } }] })
        .sort({ updatedAt: -1 })
        .limit(100)
        .exec();

    const idSet = new Set(ids.map(String));
    return links.map((l) => ({
        linkId: String(l._id),
        direction: idSet.has(String(l.fromSite)) ? ("given" as const) : ("received" as const),
        matchId: String(l.match),
        pageUrl: l.pageUrl ?? null,
        anchorText: l.anchorText ?? null,
        status: l.status,
        placement: l.placement as Placement,
        rel: l.rel ?? [],
        lastCheckedAt: l.lastCheckedAt ?? null,
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
export async function getStanding(member: ExchangeMemberHydrated): Promise<Standing> {
    await connectMongo();

    const sites: ExchangeSiteHydrated[] = await ExchangeSite.find({ owner: member.user }).exec();
    const given = sites.reduce((n, s) => n + (s.linksGiven ?? 0), 0);
    const received = sites.reduce((n, s) => n + (s.linksGot ?? 0), 0);

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
