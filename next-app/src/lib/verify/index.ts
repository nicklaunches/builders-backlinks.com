import { FetchError, fetchSiteHtml, normalizeUrl } from "@/lib/analyze/fetch-html";
import type { LinkVerification, VerifyLink } from "@/lib/contracts";
import type { Placement } from "@/lib/models/ExchangeLink";

import {
    type ParsedAnchor,
    canonicalHost,
    canonicalPath,
    collectInternalPageUrls,
    extractAnchors,
    hrefTargetsDomain,
    maskNonMarkup,
    placementAt,
    resolveHref,
} from "./html";

/**
 * @file Does the agreed link actually exist on the page, and what is it.
 *
 * This is the product. Every other exchange in this category introduces two
 * parties and then looks away: it either never checks that a promised link was
 * placed, or checks once at signup and never again. That is why none of them
 * can offer reputation, catch a taker, or tell a member what they actually
 * received. This module closes that gap, and the recheck schedule in
 * `ExchangeLink.nextCheckAt` keeps it closed over time.
 *
 * POLICY: CLASSIFY, NEVER REJECT. Nothing in here returns a verdict. A footer
 * placement and a `rel="nofollow"` are reported plainly, to both parties, and
 * still count as a placed link. Members were promised that where each link
 * lands is 100 percent up to them; the platform's job is disclosure so both
 * sides know exactly what they gave and got, not refereeing. If you are here to
 * add a `valid` flag, a score, or an auto-fail on footer or nofollow links, you
 * are about to break the promise the product is sold on. Do not.
 *
 * Second standing rule: a miss is not an accusation. We read server-rendered
 * HTML only, so a link injected by JavaScript is invisible to us even though it
 * is really on the page. Every not-found message says what we could not see and
 * invites a human to look, and `error` results are inconclusive rather than
 * missing. The caller should treat `error !== null` as "no information", never
 * as evidence against the member.
 */

/** Hard cap on extra page fetches used for sitewide detection. */
const SITEWIDE_SAMPLE_SIZE = 3;

/** How many sampled pages must carry the link before we call it sitewide. */
const SITEWIDE_MIN_HITS = 2;

/**
 * Preference order when a page carries several links to the same target.
 *
 * We report the best one. A site that links from a blog post AND from its
 * footer has given a content link, and saying "footer" because the footer
 * anchor happened to appear first in the markup would understate what they
 * gave. Ranking sits here rather than being derived from the placement union so
 * that changing the union does not silently change what gets reported.
 */
const PLACEMENT_RANK: Record<Placement, number> = {
    content: 0,
    footer: 1,
    nav: 2,
    sidebar: 3,
    unknown: 4,
};

/** Human phrasing for each placement, used in the member-facing message. */
const PLACEMENT_PHRASE: Record<Placement, string> = {
    content: "in the page content",
    footer: "in the footer",
    nav: "in the site navigation",
    sidebar: "in a sidebar",
    unknown: "on the page",
};

type MatchedAnchor = ParsedAnchor & { placement: Placement };

/**
 * Maps a fetch-layer failure onto the four codes the contract exposes.
 *
 * The mapping is coarse on purpose: the caller only needs to know whether to
 * retry, and whether to tell the member anything other than "we could not
 * look". `too_large` lands in `unreachable` because the page did exist but we
 * declined to read it, which is operationally the same as not having read it.
 *
 * @param err - Anything thrown by the fetcher.
 */
function mapFetchError(err: unknown): { error: NonNullable<LinkVerification["error"]>; detail: string } {
    if (!(err instanceof FetchError)) {
        return { error: "unreachable", detail: err instanceof Error ? err.message : "unknown error" };
    }
    switch (err.code) {
        case "timeout":
            return { error: "timeout", detail: "the request timed out" };
        case "non_html":
            return { error: "not_html", detail: err.message };
        case "blocked_host":
            return { error: "blocked", detail: err.message };
        case "dns_failed":
            return { error: "unreachable", detail: "the domain did not resolve" };
        case "invalid_url":
            return { error: "unreachable", detail: "that is not a valid page URL" };
        case "too_large":
            return { error: "unreachable", detail: "the page was too large to read" };
        case "http_error": {
            // 401, 403, 407 and 429 are a site refusing our crawler rather than
            // a site being down, and the difference matters when we explain the
            // result to a member who can see the page perfectly well.
            const status = /\b(\d{3})\b/.exec(err.message)?.[1];
            if (status === "401" || status === "403" || status === "407" || status === "429") {
                return { error: "blocked", detail: `the site returned HTTP ${status}` };
            }
            return { error: "unreachable", detail: status ? `the site returned HTTP ${status}` : err.message };
        }
    }
}

/**
 * Wording for an inconclusive check. Never suggests the link is absent.
 */
function errorMessage(error: NonNullable<LinkVerification["error"]>, detail: string): string {
    switch (error) {
        case "timeout":
            return (
                "The page took too long to respond, so we could not check it. " +
                "That is inconclusive, not a missing link, and we will try again."
            );
        case "blocked":
            return (
                `The site blocked our checker (${detail}), so we could not read the page. ` +
                "This says nothing about the link itself: a human can confirm it by eye."
            );
        case "not_html":
            return (
                `That URL did not return an HTML page (${detail}), so there was nothing to check. ` +
                "If the link lives on a different URL, update it and we will recheck."
            );
        case "unreachable":
            return `We could not load the page (${detail}), so this check is inconclusive. We will try again later.`;
    }
}

/** Builds the result shape for a check that never got as far as reading HTML. */
function inconclusive(checkedUrl: string, err: unknown): LinkVerification {
    const { error, detail } = mapFetchError(err);
    return {
        found: false,
        placement: "unknown",
        rel: [],
        anchorText: null,
        href: null,
        sitewide: false,
        checkedUrl,
        message: errorMessage(error, detail),
        error,
    };
}

/**
 * Detects the anti-bot interstitial pattern: a tiny body that sets a cookie and
 * redirects via JavaScript. The real page is unreachable without a browser, so
 * reporting "link not found" off the back of it would be actively misleading.
 *
 * @param html - Raw response body.
 */
function isBotChallenge(html: string): boolean {
    const lower = html.toLowerCase();
    return (
        lower.length < 4000 &&
        /location\.href\s*=/.test(lower) &&
        /slowaes|__test|aes\.js|chk_jschl|cf-browser-verification|just a moment/.test(lower)
    );
}

/**
 * Finds every anchor on the page that points at the target domain and tags each
 * with its placement.
 */
function matchAnchors(
    masked: string,
    anchors: readonly ParsedAnchor[],
    baseUrl: string,
    target: string,
): MatchedAnchor[] {
    const matches: MatchedAnchor[] = [];
    for (const anchor of anchors) {
        if (!hrefTargetsDomain(anchor.href, baseUrl, target)) continue;
        matches.push({ ...anchor, placement: placementAt(masked, anchor.index) });
    }
    return matches;
}

/**
 * Picks the single anchor to report from several matches on one page.
 *
 * Best placement wins. On a tie we prefer the anchor without `nofollow`,
 * because that is also the truer statement of what the site gave: if one of two
 * content links is followed, they gave a followed content link.
 */
function pickBest(matches: readonly MatchedAnchor[]): MatchedAnchor {
    return matches.reduce((best, candidate) => {
        const rankDelta = PLACEMENT_RANK[candidate.placement] - PLACEMENT_RANK[best.placement];
        if (rankDelta !== 0) return rankDelta < 0 ? candidate : best;
        const candidateFollowed = !candidate.rel.includes("nofollow");
        const bestFollowed = !best.rel.includes("nofollow");
        if (candidateFollowed !== bestFollowed) return candidateFollowed ? candidate : best;
        return best;
    });
}

/**
 * Samples a few other pages on the same site to see whether the link is
 * sitewide (a footer or nav placement repeated on every page) rather than a
 * one-off.
 *
 * Deliberately cheap and deliberately conservative: at most
 * {@link SITEWIDE_SAMPLE_SIZE} extra fetches, all in parallel, all failures
 * swallowed. A sitewide flag is a nice-to-have detail on the disclosure, so it
 * must never be able to turn a successful verification into a failed one. When
 * sampling fails or finds nothing, we report `false`, which reads as "not
 * confirmed sitewide" rather than "confirmed not sitewide".
 *
 * The comparison is on the target URL's path, not just its domain, so a footer
 * link to the homepage is not counted as evidence that a deep content link is
 * sitewide.
 *
 * @returns True when the link was seen on at least {@link SITEWIDE_MIN_HITS}
 *   other pages.
 */
async function detectSitewidePlacement(args: {
    anchors: readonly ParsedAnchor[];
    pageUrl: string;
    target: string;
    matchedHref: string;
}): Promise<boolean> {
    const { anchors, pageUrl, target, matchedHref } = args;
    const matchedUrl = resolveHref(matchedHref, pageUrl);
    if (!matchedUrl) return false;
    const wantedPath = canonicalPath(matchedUrl);

    const candidates = collectInternalPageUrls(anchors, pageUrl, SITEWIDE_SAMPLE_SIZE);
    if (candidates.length < SITEWIDE_MIN_HITS) return false;

    const results = await Promise.all(
        candidates.map(async (candidate) => {
            try {
                const fetched = await fetchSiteHtml(normalizeUrl(candidate));
                if (fetched.status !== 200) return false;
                const masked = maskNonMarkup(fetched.html);
                return extractAnchors(masked).some((anchor) => {
                    if (!hrefTargetsDomain(anchor.href, fetched.finalUrl, target)) return false;
                    const resolved = resolveHref(anchor.href, fetched.finalUrl);
                    return resolved !== null && canonicalPath(resolved) === wantedPath;
                });
            } catch {
                // One unreachable sample tells us nothing and must not surface.
                return false;
            }
        }),
    );

    return results.filter(Boolean).length >= SITEWIDE_MIN_HITS;
}

/**
 * Crawls one page and reports whether it links to one domain, and how.
 *
 * Reads server-rendered HTML only. See the @file policy notes: this classifies,
 * it never rejects, and a miss is reported as something we could not see rather
 * than something the member failed to do.
 *
 * @param input.pageUrl - The page the link is supposed to be on.
 * @param input.targetDomain - The domain the link should point at. Canonical
 *   form is expected, but scheme, `www.`, port and path are tolerated.
 * @param input.detectSitewide - Sample up to three other internal pages to see
 *   whether the same link repeats. Costs up to three extra fetches. Default false.
 * @returns A verification that is either found, not found, or (when `error` is
 *   set) inconclusive. `error` results must never be treated as a missing link.
 */
export const verifyLink: VerifyLink = async (input): Promise<LinkVerification> => {
    const { pageUrl, targetDomain, detectSitewide = false } = input;
    const target = canonicalHost(targetDomain);

    let normalized: string;
    try {
        normalized = normalizeUrl(pageUrl);
    } catch {
        // Worth its own wording: this one is fixable by the member in seconds,
        // and the generic "we could not load the page" copy would send them
        // looking at their site instead of at the URL they typed.
        return {
            found: false,
            placement: "unknown",
            rel: [],
            anchorText: null,
            href: null,
            sitewide: false,
            checkedUrl: pageUrl,
            message: "That does not look like a valid page URL. Fix it and save again, and we will recheck.",
            error: "unreachable",
        };
    }

    let html: string;
    let checkedUrl = normalized;
    try {
        const fetched = await fetchSiteHtml(normalized);
        checkedUrl = fetched.finalUrl;
        if (fetched.status !== 200) {
            // We never send validators, so a 304 here means the server ignored
            // the request shape. Treat it as "no body to read", not as a miss.
            return inconclusive(checkedUrl, new FetchError("http_error", "HTTP 304"));
        }
        html = fetched.html;
    } catch (err) {
        return inconclusive(checkedUrl, err);
    }

    if (isBotChallenge(html)) {
        return inconclusive(checkedUrl, new FetchError("http_error", "HTTP 403"));
    }

    const masked = maskNonMarkup(html);
    const anchors = extractAnchors(masked);
    const matches = matchAnchors(masked, anchors, checkedUrl, target);

    if (matches.length === 0) {
        return {
            found: false,
            placement: "unknown",
            rel: [],
            anchorText: null,
            href: null,
            sitewide: false,
            checkedUrl,
            message:
                `We could not find a link to ${target} in the server-rendered HTML of this page. ` +
                `Links added by JavaScript after the page loads are invisible to this check, so this is not proof ` +
                `the link is missing: open the page and take a look, and tell us if it is there.`,
            error: null,
        };
    }

    const best = pickBest(matches);
    const sitewide = detectSitewide
        ? await detectSitewidePlacement({ anchors, pageUrl: checkedUrl, target, matchedHref: best.href })
        : false;

    const relNote = best.rel.length > 0 ? ` with rel="${best.rel.join(" ")}"` : "";
    const sitewideNote = sitewide ? " The same link appears on other pages of the site, so it looks sitewide." : "";
    const anchorNote = best.text ? ` Anchor text: "${best.text}".` : " The anchor has no visible text (image link).";

    return {
        found: true,
        placement: best.placement,
        rel: best.rel,
        anchorText: best.text || null,
        href: best.href,
        sitewide,
        checkedUrl,
        message: `Link to ${target} found ${PLACEMENT_PHRASE[best.placement]}${relNote}.${anchorNote}${sitewideNote}`,
        error: null,
    };
};
