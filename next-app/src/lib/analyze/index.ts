import { AnalyzeError, type AnalyzeSite, type SiteAnalysis } from "@/lib/contracts";
import { normalizeDomain } from "@/lib/models/ExchangeSite";

import { getDomainRating } from "./ahrefs";
import { describeSite } from "./describe";
import { extractPage } from "./extract";
import { FetchError, fetchSiteHtml, normalizeUrl } from "./fetch-html";

/**
 * @file Everything derived from a URL at submit time, behind one function.
 *
 * `analyzeSite()` is the only export anyone outside this folder should use. It
 * is a leaf: it touches no database, holds no session, and knows nothing about
 * members. That is what makes it runnable from the MCP tool path and the web
 * path with identical behaviour, which is the property the contracts file exists
 * to protect.
 *
 * Order of operations matters. The page fetch is first and alone, because both
 * downstream steps depend on it (the DR lookup needs the post-redirect domain,
 * the LLM needs the text). Those two are then run together: they are fully
 * independent, and running them in series would roughly double the wait on the
 * slowest, most visible step of the signup flow.
 *
 * Failure policy: anything wrong with the site is an `AnalyzeError` with a code
 * the caller can turn into a specific message. Anything wrong with Ahrefs is not
 * an error at all, it is a null DR.
 */

/**
 * Minimum body text required to analyze a page.
 *
 * A site with less prose than this is either JS-rendered (which we cannot read
 * and should not guess at) or a thin page that exists to hold outbound links.
 * Both are things this exchange should decline rather than describe badly, and
 * a wrong description is worse than a rejection because it silently poisons
 * matching for everyone paired with it.
 */
const MIN_TEXT_CHARS = 200;

/**
 * Maps a fetch-layer failure onto the analyze contract's error codes.
 *
 * The interesting case is `http_error`: an authentication or rate-limit status
 * means the site is up and is refusing us, which is actionable in a different
 * way ("your site blocks our crawler") than a 500 or a dead host.
 *
 * @param err - Error thrown by the fetcher.
 * @returns The equivalent `AnalyzeError`.
 */
function toAnalyzeError(err: FetchError): AnalyzeError {
    switch (err.code) {
        case "invalid_url":
            return new AnalyzeError("invalid_url", err.message);
        case "blocked_host":
            return new AnalyzeError("blocked", err.message);
        case "non_html":
            return new AnalyzeError("not_html", err.message);
        case "dns_failed":
            return new AnalyzeError("unreachable", err.message);
        case "timeout":
            return new AnalyzeError("unreachable", "The site took too long to respond");
        case "too_large":
            // Not "not_html": the content type was fine, the page was just too
            // big to read within our budget. Unreachable is the honest bucket.
            return new AnalyzeError("unreachable", "The page was too large to read");
        case "http_error": {
            const status = Number(err.message.match(/^HTTP (\d{3})$/)?.[1] ?? 0);
            if (status === 401 || status === 403 || status === 429 || status === 451) {
                return new AnalyzeError("blocked", `The site refused our request (HTTP ${status})`);
            }
            return new AnalyzeError("unreachable", err.message);
        }
    }
}

/**
 * Adds a scheme when the member typed a bare domain.
 *
 * People type "example.com". Rejecting that as an invalid URL is technically
 * correct and practically hostile, and the SSRF guards in `fetchSiteHtml` run on
 * the result either way, so nothing is weakened by being forgiving here.
 *
 * @param rawUrl - Whatever the member submitted.
 * @returns The input, with `https://` prepended when no scheme was present.
 */
function withScheme(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
    // A scheme-relative "//example.com" is also common in pasted markup.
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    return `https://${trimmed}`;
}

/**
 * Analyzes a submitted URL into everything the exchange needs to list it.
 *
 * Fetches the page, extracts its text, then resolves the Ahrefs DR and the LLM
 * profile in parallel. The returned `description` is identity-scrubbed and safe
 * to show to a partner pre-reveal; `title` is not, and is returned only for the
 * member's own confirmation screen.
 *
 * @param rawUrl - URL as submitted, with or without a scheme.
 * @returns The complete {@link SiteAnalysis}.
 * @throws `AnalyzeError` with code `invalid_url`, `unreachable`, `not_html`, `blocked`,
 *         `too_thin`, or `llm_failed`.
 */
export const analyzeSite: AnalyzeSite = async (rawUrl: string): Promise<SiteAnalysis> => {
    if (!rawUrl || !rawUrl.trim()) {
        throw new AnalyzeError("invalid_url", "No URL was provided");
    }

    let normalized: string;
    try {
        normalized = normalizeUrl(withScheme(rawUrl));
    } catch (err) {
        if (err instanceof FetchError) throw toAnalyzeError(err);
        throw new AnalyzeError("invalid_url", "Invalid URL");
    }

    let fetched;
    try {
        fetched = await fetchSiteHtml(normalized);
    } catch (err) {
        if (err instanceof FetchError) throw toAnalyzeError(err);
        throw new AnalyzeError("unreachable", err instanceof Error ? err.message : String(err));
    }

    // No conditional-request validators are sent above, so a 304 here means the
    // origin is misbehaving rather than that we have a cached copy.
    if (fetched.status !== 200) {
        throw new AnalyzeError("unreachable", "The site returned no page content");
    }

    const finalUrl = fetched.finalUrl;
    let domain: string;
    try {
        domain = normalizeDomain(finalUrl);
    } catch {
        throw new AnalyzeError("invalid_url", "Could not read a domain from that URL");
    }

    const extract = extractPage(fetched.html);
    if (extract.textSample.length < MIN_TEXT_CHARS) {
        throw new AnalyzeError(
            "too_thin",
            "There is not enough text on this page to describe it. If the content is loaded by JavaScript, link to a page that renders server-side.",
        );
    }

    // Independent legs, run together. The DR leg never rejects (it returns null
    // on failure), so Promise.all only ever rejects for the LLM.
    const [domainRating, described] = await Promise.all([
        getDomainRating(domain),
        describeSite(extract, domain).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            throw new AnalyzeError("llm_failed", `Could not generate a site description: ${message}`);
        }),
    ]);

    return {
        domain,
        url: finalUrl,
        category: described.category,
        description: described.description,
        keywords: described.keywords,
        domainRating,
        title: extract.title,
    };
};

export type { SiteDescription } from "./describe";
export type { PageExtract } from "./extract";
