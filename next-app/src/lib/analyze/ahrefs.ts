/**
 * @file Domain Rating lookup against the free Ahrefs public API.
 *
 * DR is a sorting hint, never a gate. Members are matched on category, keyword
 * overlap, and reciprocity health, and a missing DR must degrade to "we do not
 * know yet" rather than block a submission. This module therefore swallows every
 * failure and returns null: no throw from here should ever reach a member.
 *
 * ATTRIBUTION REQUIREMENT: the Ahrefs Domain Rating Checker free API is licensed
 * on the condition that the score is displayed with visible attribution to
 * Ahrefs, linking back to their DR checker, wherever it is shown. Any UI that
 * renders `domainRating` (site cards, masked partner views, digest emails) must
 * carry that credit. Removing the credit breaks the license, not just etiquette.
 *
 * @see https://ahrefs.com/website-authority-checker
 */

/** Free public Domain Rating endpoint. */
const AHREFS_DR_URL = "https://api.ahrefs.com/v3/public/domain-rating-free";

/**
 * Timeout for the DR call.
 *
 * Kept at the same 8s budget as the page fetch because the two run in parallel
 * with the LLM call, and a slow third party must not be what makes a submission
 * feel broken.
 */
const AHREFS_TIMEOUT_MS = 8_000;

/**
 * Documented response shape. Yes, the field is nested inside itself.
 */
type AhrefsDomainRatingResponse = {
    domain_rating?: { domain_rating?: number };
};

/**
 * Fetches the Ahrefs Domain Rating for a domain.
 *
 * Any failure (missing key, network error, timeout, rate limit, unexpected body)
 * is logged and reported as null. Callers must treat null as "unknown", not as
 * zero: a DR of 0 is a real and meaningfully different value.
 *
 * Whenever the returned score is displayed, visible Ahrefs attribution is
 * required by the Domain Rating License (see the file header).
 *
 * @param domain - Canonical domain, as produced by `normalizeDomain()`.
 * @returns The DR (0 to 100), or null when it could not be determined.
 */
export async function getDomainRating(domain: string): Promise<number | null> {
    const apiKey = process.env.AHREFS_API_KEY;
    if (!apiKey) {
        console.warn("[analyze/ahrefs] AHREFS_API_KEY is not set, skipping DR lookup");
        return null;
    }

    try {
        const url = `${AHREFS_DR_URL}?target=${encodeURIComponent(domain)}&output=json`;
        const res = await fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(AHREFS_TIMEOUT_MS),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[analyze/ahrefs] DR lookup for ${domain} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
            return null;
        }

        const json = (await res.json()) as AhrefsDomainRatingResponse;
        const value = json.domain_rating?.domain_rating;
        if (typeof value !== "number" || !Number.isFinite(value)) {
            console.warn(`[analyze/ahrefs] DR lookup for ${domain} returned no usable domain_rating`);
            return null;
        }

        // Clamp rather than reject: the schema says 0 to 100, and a stored value
        // outside that range would violate the ExchangeSite min/max validators.
        return Math.min(100, Math.max(0, Math.round(value)));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[analyze/ahrefs] DR lookup for ${domain} threw: ${message}`);
        return null;
    }
}
