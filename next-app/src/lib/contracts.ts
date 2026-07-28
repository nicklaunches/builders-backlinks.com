/**
 * @file The contracts the independent modules implement.
 *
 * `src/lib/analyze`, `src/lib/verify`, and `src/lib/matching` are built as
 * self-contained leaves. This file is the only thing they share, so it is the
 * single place where their shapes are agreed. The service layer in
 * `src/lib/services` composes them, and both the MCP tools and the oRPC
 * procedures call the services. Nothing calls a leaf directly.
 *
 * Rule that keeps the agent path first-class: an MCP tool must never contain
 * logic. If a tool handler does anything a web route would not, the two
 * interfaces have already started to drift.
 */
import type { Category } from "@/lib/categories";
import type { Placement } from "@/lib/models/ExchangeLink";
import type { PlacementOffer } from "@/lib/models/ExchangeSite";

// ---------------------------------------------------------------------------
// src/lib/analyze  ->  analyzeSite()
// ---------------------------------------------------------------------------

/**
 * Everything derived from a URL at submit time.
 *
 * `description` must be identity-scrubbed: it is shown to potential partners
 * before either side knows who the other is, so it has to say what the site
 * does without naming it or quoting its brand.
 */
export type SiteAnalysis = {
    /** Canonical form: lowercase, no scheme, no `www.`, no path. */
    domain: string;
    /** Final URL after redirects. */
    url: string;
    /** Best-guess category. The member confirms or changes it. */
    category: Category;
    /** Identity-scrubbed, <= 2000 chars. */
    description: string;
    /** Suggested anchor phrases, 1 to 25. */
    keywords: string[];
    /** Ahrefs Domain Rating via VerifiedDR, 0-100, or null on failure. Never fail the flow over this. */
    domainRating: number | null;
    /**
     * VerifiedDR's TrueDR: the same 0-100 idea recalculated to discount
     * manipulated authority. Null when unavailable.
     *
     * This, not `domainRating`, is what matching bands on. Inflating DR is the
     * way someone buys a better partner than they deserve, and DR banding is
     * the main quality lever in the engine, so the number it trusts has to be
     * the one that is hard to inflate. DR stays for display because it is what
     * members recognise.
     */
    trueDr: number | null;
    /** Raw page title, for the confirmation screen only. Never shown to partners. */
    title: string | null;
};

export class AnalyzeError extends Error {
    constructor(
        public readonly code: "invalid_url" | "unreachable" | "not_html" | "blocked" | "too_thin" | "llm_failed",
        message: string,
    ) {
        super(message);
        this.name = "AnalyzeError";
    }
}

export type AnalyzeSite = (rawUrl: string) => Promise<SiteAnalysis>;

// ---------------------------------------------------------------------------
// src/lib/verify  ->  verifyLink()
// ---------------------------------------------------------------------------

/**
 * Result of crawling one page looking for a link to one domain.
 *
 * POLICY REMINDER: this classifies, it does not judge. A `footer` placement or
 * a `nofollow` rel is reported plainly to both parties and still counts as a
 * placed link. Members were promised that where the link lands is up to them.
 */
export type LinkVerification = {
    found: boolean;
    /** Where the anchor sits in the document. */
    placement: Placement;
    /** Parsed `rel` tokens, lowercased: nofollow, sponsored, ugc. */
    rel: string[];
    anchorText: string | null;
    /** The exact href that matched. */
    href: string | null;
    /** True when the same href appears on other sampled pages too. */
    sitewide: boolean;
    /** Final URL fetched, after redirects. */
    checkedUrl: string;
    /**
     * Short human-readable outcome, persisted and shown to the member.
     * On a miss this should be helpful, not accusatory: client-rendered pages
     * legitimately false-negative against an HTML-only fetch.
     */
    message: string;
    /** Set when the crawl itself failed, as opposed to the link being absent. */
    error: "unreachable" | "not_html" | "blocked" | "timeout" | null;
};

export type VerifyLink = (input: {
    /** The page the link is supposed to be on. */
    pageUrl: string;
    /** The domain the link is supposed to point at, canonical form. */
    targetDomain: string;
    /** Sample a few internal pages to detect sitewide placement. Default false. */
    detectSitewide?: boolean;
}) => Promise<LinkVerification>;

// ---------------------------------------------------------------------------
// src/lib/matching  ->  scoreCandidate() / findBestPartner()
// ---------------------------------------------------------------------------

/** The subset of a site the matching engine needs. Keeps it testable without Mongo. */
export type MatchableSite = {
    id: string;
    ownerId: string;
    category: Category;
    keywords: string[];
    /** Shown to partners. Not what the band score uses: see `trueDr`. */
    domainRating: number | null;
    /** What DR banding actually scores on, falling back to `domainRating` when null. */
    trueDr: number | null;
    placementOffered: PlacementOffer;
    linksGiven: number;
    linksGot: number;
    lastMatchedAt: Date | null;
};

export type ScoreContext = {
    /** Site ids already matched to the subject, at any time. */
    alreadyMatched: ReadonlySet<string>;
    /** Site ids that declined the subject before. */
    previouslyDeclined: ReadonlySet<string>;
    /** True when the candidate came from a widened (adjacent) category pool. */
    widened: boolean;
    now: Date;
};

export type ScoreBreakdown = {
    total: number;
    category: number;
    drBand: number;
    keywordOverlap: number;
    placementFit: number;
    reciprocityHealth: number;
    staleness: number;
    penalties: number;
    /** Set when the pair must not be matched at all. */
    rejected: null | "same_owner" | "unmatchable_category" | "no_category_overlap";
};

export type ScoreCandidate = (subject: MatchableSite, candidate: MatchableSite, ctx: ScoreContext) => ScoreBreakdown;

/**
 * The single entry point matching is called through, both synchronously from
 * `submit_site` (instant auto-pair) and from the weekly cron. One code path,
 * two callers: if these ever diverge the instant path will quietly rot.
 */
export type FindBestPartner = (
    subject: MatchableSite,
    candidates: readonly MatchableSite[],
    ctx: ScoreContext,
) => { candidate: MatchableSite; score: ScoreBreakdown } | null;

// ---------------------------------------------------------------------------
// Shared view models returned to MCP tools and web routes
// ---------------------------------------------------------------------------

/**
 * A partner as seen BEFORE mutual accept. There is deliberately no domain,
 * url, or email field on this type: making it structurally impossible to leak
 * an identity through a read path is worth more than remembering not to.
 */
export type MaskedPartner = {
    partnerId: string;
    category: Category;
    description: string;
    domainRating: number | null;
    wantedAnchors: string[];
    placementOffered: PlacementOffer;
    linksGiven: number;
    linksGot: number;
};

/** A partner AFTER mutual accept. Only ever built from an `agreed` match. */
export type RevealedPartner = MaskedPartner & {
    domain: string;
    url: string;
    email: string;
};
