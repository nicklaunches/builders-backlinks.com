/**
 * @file Domain authority lookup against VerifiedDR, returning both DR and TrueDR.
 *
 * Replaces the DataForSEO integration. Two things are better here: the score is
 * real Ahrefs Domain Rating rather than a comparable-but-different vendor rank,
 * and the same call also returns TrueDR, VerifiedDR's recalculation that
 * discounts manipulated authority. TrueDR is what the matching engine bands on
 * (see `SiteAnalysis.trueDr` in `src/lib/contracts.ts`), because DR is the
 * number someone can buy their way up and the band is the main quality lever.
 * DR is kept for display because it is what members recognise.
 *
 * SCHEMA CONFIRMED 2026-07-29 against a live key, on tier `partner`. The scores
 * sit two levels down, under `lookup.authority`:
 *
 *     { "lookup": { "domain": "...", "authority": { "dr": 68, "trueDr": 50,
 *       "trustScore": 50, "confidence": "medium", "trafficValidated": true },
 *       "evidence": { "traffic": ..., "referringDomains": ..., ... } } }
 *
 * The original parser guessed the key NAMES right (`dr`, `trueDr`) and the
 * CONTAINER wrong: it tried the top level, `data` and `result`, so every lookup
 * silently returned nulls and every submission was stored with no DR. That is
 * the exact failure this module was built to make visible, and it still took a
 * real call to see, so the self-revealing logging below stays.
 *
 * That logging is why: this module returns null on every failure by design, so a
 * wrong field name produces no error, no stack trace, and no scores forever,
 * while everything looks healthy. When parsing fails we log the response's
 * actual key NAMES (never values, never the key) at warn level, so a schema
 * change on their side shows up in one line rather than as months of quiet
 * nulls.
 *
 * THE ENDPOINT WAS THE REAL LIMIT, not coverage. This module used to call
 * `/lookup/{domain}` for everything. That route serves only domains approved on
 * verifieddr.com and 404s for anything else, so nearly every site was stored
 * with no DR, and the 404 was documented right here as "the vendor does not
 * cover this site, do not read it as a broken integration". That was wrong.
 * `/dr/{domain}` relays Ahrefs DR for ANY domain, approved or not. Confirmed
 * 2026-08-01 against a live key: `lookup/aihub.group` answered 404 while
 * `dr/aihub.group` answered 18, matching what Ahrefs shows for the same domain.
 *
 * So `/dr/{domain}` is the primary call and a site with no DR is now worth
 * investigating rather than shrugging at. TrueDR still comes from `/lookup` and
 * still exists only for approved sites, which is what the `listed` flag in the
 * `/dr` response is for: it decides whether the second call is worth a quota
 * unit. `SiteAnalysis` keeps both scores optional and matching still bands sites
 * with no score rather than excluding them, because a null TrueDR remains the
 * normal case for most members.
 *
 * Auth is a bearer token (`vdr_...`) in `VERIFIEDDR_API_KEY`. Limits are 60
 * requests per minute on a sliding window, and a monthly quota that depends on
 * the plan (1,000 on Pro, 10,000 on Ultra). A 429 is the per-minute limit and is
 * survivable; a 402 means the MONTH is gone, which is why it gets the loudest
 * log in this file.
 *
 * @see https://verifieddr.com/api/v1
 */

const VERIFIEDDR_BASE_URL = "https://verifieddr.com/api/v1";

/**
 * Their lookup is a cached scalar read rather than a live crawl, so it should be
 * fast. This runs inside the submit flow next to an LLM call, and a slow score
 * is worth less than a quick submission.
 */
const VERIFIEDDR_TIMEOUT_MS = 10_000;

/** Warn when the monthly allowance drops to this, so a 402 is not the first sign. */
const LOW_QUOTA_WARN_THRESHOLD = 25;

/**
 * Candidate key spellings for Ahrefs Domain Rating.
 *
 * `dr` and `true_dr` are the names VerifiedDR uses in its own product copy, so
 * they lead. `domain_rating` / `domainRating` cover the two casing conventions a
 * JSON API usually picks between, and `ahrefs_dr` covers the case where they
 * name the field after the source to distinguish it from their own metric.
 */
const DR_KEYS = ["dr", "domain_rating", "domainRating", "ahrefs_dr"] as const;

/** Candidate key spellings for TrueDR, same reasoning as {@link DR_KEYS}. */
const TRUE_DR_KEYS = ["true_dr", "trueDr", "truedr", "trueDR", "true_domain_rating"] as const;

/**
 * Where the metrics sit. Two CONFIRMED paths lead, one per endpoint: `dr` for
 * `/dr/{domain}` and `lookup.authority` for `/lookup/{domain}`.
 *
 * The `dr` prefix is load-bearing rather than defensive. `/dr` answers
 * `{"dr":{"dr":18,...}}`, so the bare `dr` key resolves to an OBJECT, `toScore`
 * rejects it, and without this prefix the whole response parses to null even
 * though the key name was right all along.
 *
 * The rest are kept as fallbacks rather than deleted, because they cost one
 * failed object lookup each and would otherwise have to be re-derived if
 * VerifiedDR ever flattens the envelope. Still deliberately shallow: searching
 * arbitrarily deep would find a plausible-looking number somewhere in almost
 * any payload, and a confidently wrong score is worse than a null one.
 */
const CONTAINER_PREFIXES: readonly (readonly string[])[] = [
    ["dr"],
    ["lookup", "authority"],
    ["authority"],
    [],
    ["data"],
    ["result"],
];

/** A dotted path into the response, e.g. `["data", "dr"]`. */
type Path = readonly string[];

/**
 * Expands metric key spellings into every path worth trying.
 *
 * @param keys - Candidate key spellings for one metric.
 * @returns Each key under each container prefix, top level first.
 */
function candidatePaths(keys: readonly string[]): Path[] {
    return CONTAINER_PREFIXES.flatMap((prefix) => keys.map((key) => [...prefix, key]));
}

/**
 * Reads a path out of a parsed JSON value without assuming any shape.
 *
 * @param payload - Parsed response body.
 * @param path - Keys to walk, in order.
 * @returns The value at that path, or undefined if any step is missing.
 */
function readPath(payload: unknown, path: Path): unknown {
    let current = payload;
    for (const key of path) {
        if (typeof current !== "object" || current === null) return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

/**
 * Coerces a candidate value into a 0-100 score.
 *
 * Numeric strings are accepted because the schema is unconfirmed and a JSON API
 * returning `"42"` is common enough to be worth surviving. Clamping happens here
 * so no caller can forget it: `ExchangeSite` validates both fields in 0-100, and
 * an unexpected scale reaching the database would fail validation far from here.
 *
 * @param raw - Whatever sat at a candidate path.
 * @returns The rounded, clamped score, or null when the value is unusable.
 */
function toScore(raw: unknown): number | null {
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Finds the first candidate path holding a usable score.
 *
 * @param payload - Parsed response body.
 * @param paths - Paths to try, in priority order.
 * @returns The score, or null when no path held one.
 */
function pickScore(payload: unknown, paths: readonly Path[]): number | null {
    for (const path of paths) {
        const score = toScore(readPath(payload, path));
        if (score !== null) return score;
    }
    return null;
}

/**
 * Lists the key names of an object, for logging.
 *
 * Names only. The values could contain anything, including something a member
 * submitted, and this ends up in server logs.
 *
 * @param value - Any parsed JSON value.
 * @returns The keys as a bracketed list, or a note about what it was instead.
 */
function keyNames(value: unknown): string {
    if (value === null || typeof value !== "object") return `(not an object: ${typeof value})`;
    if (Array.isArray(value)) return `(array, length ${value.length})`;
    return `[${Object.keys(value).join(", ")}]`;
}

/**
 * Describes the response's shape by key name, top level plus known envelopes.
 *
 * This is the whole point of the self-revealing design: one real call prints the
 * field names, and the candidate lists above can then be pinned to them.
 *
 * @param payload - Parsed response body.
 * @returns A short, value-free description of the shape.
 */
function describeShape(payload: unknown): string {
    const parts = [`top-level keys ${keyNames(payload)}`];
    for (const prefix of CONTAINER_PREFIXES) {
        if (prefix.length === 0) continue;
        const nested = readPath(payload, prefix);
        if (nested !== undefined) parts.push(`${prefix.join(".")} keys ${keyNames(nested)}`);
    }
    return parts.join("; ");
}

/**
 * Pulls DR and TrueDR out of a parsed response body.
 *
 * Exported so the shape can be tested against a real captured payload without a
 * network call or a quota unit, which is what would have caught the wrong
 * container in the first place.
 *
 * @param payload - Parsed response body.
 * @returns Both scores, either or both possibly null.
 */
export function parseAuthorityScores(payload: unknown): { domainRating: number | null; trueDr: number | null } {
    return {
        domainRating: pickScore(payload, candidatePaths(DR_KEYS)),
        trueDr: pickScore(payload, candidatePaths(TRUE_DR_KEYS)),
    };
}

/** Warn about the missing key once per process, not once per submission. */
let warnedMissingKey = false;

/** Both metrics absent. The single value every failure path returns. */
const NO_SCORES = { domainRating: null, trueDr: null } as const;

/**
 * Reads the `listed` flag out of a `/dr` response.
 *
 * It says whether the domain is approved on verifieddr.com, which is the only
 * case where a TrueDR exists to go and fetch. Anything other than an explicit
 * `true` counts as not listed: being wrong in that direction costs a quota unit
 * on a lookup that was going to 404 anyway.
 *
 * @param payload - Parsed `/dr` response body.
 * @returns True only when the response says the domain is listed.
 */
function isListedOnVerifiedDr(payload: unknown): boolean {
    return readPath(payload, ["dr", "listed"]) === true;
}

/**
 * Performs one authority request and applies the shared failure handling.
 *
 * Never throws. Every failure resolves to null with its own log line, which is
 * what lets {@link getAuthorityScores} keep its own never-rejects contract while
 * making up to two calls.
 *
 * @param path - Path under the API base, already encoded.
 * @param domain - Domain being looked up, for logging.
 * @param apiKey - Bearer token.
 * @returns The parsed body, or null when the call produced no usable one.
 */
async function requestAuthority(path: string, domain: string, apiKey: string): Promise<unknown | null> {
    try {
        const res = await fetch(`${VERIFIEDDR_BASE_URL}/${path}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(VERIFIEDDR_TIMEOUT_MS),
        });

        const tier = res.headers.get("X-API-Tier") ?? "unknown";
        const quotaLimit = res.headers.get("X-API-Quota-Limit") ?? "unknown";
        const quotaRemaining = res.headers.get("X-API-Quota-Remaining") ?? "unknown";

        // The month is gone. Logged loudest because a silent 402 is indistinguishable
        // from a site that genuinely has no score, and someone could lose a month of
        // scores across every submission without a single thing looking broken.
        if (res.status === 402) {
            console.error(
                `[analyze/verifieddr] MONTHLY QUOTA EXHAUSTED (HTTP 402) on ${path}. ` +
                    `EVERY submission from now on will be saved with NO DR and NO TrueDR until the quota ` +
                    `resets or the plan is upgraded, and nothing else will look wrong. ` +
                    `tier=${tier} quotaLimit=${quotaLimit} quotaRemaining=${quotaRemaining}`,
            );
            return null;
        }

        // Per-minute sliding window (60/min). Transient: the next submission is
        // very likely fine, so this stays a warn and is not retried inline.
        if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After") ?? "unset";
            console.warn(
                `[analyze/verifieddr] per-minute rate limit hit (HTTP 429) on ${path}, ` +
                    `Retry-After: ${retryAfter}s. This submission gets no scores.`,
            );
            return null;
        }

        // This used to be logged as routine, back when every call went to
        // `/lookup/{domain}` and a 404 really did mean "not one of ours". Filing
        // it under expected is precisely what hid the wrong-endpoint bug for
        // weeks, so it is a warn now. On `/dr` it should never happen at all.
        if (res.status === 404) {
            console.warn(
                `[analyze/verifieddr] HTTP 404 on ${path} for ${domain}. On /dr this is unexpected, since ` +
                    `that route relays Ahrefs DR for any domain; on /lookup it means the domain is not ` +
                    `approved on verifieddr.com.`,
            );
            return null;
        }

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[analyze/verifieddr] ${path} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
            return null;
        }

        const remaining = Number(quotaRemaining);
        if (Number.isFinite(remaining) && remaining <= LOW_QUOTA_WARN_THRESHOLD) {
            console.warn(
                `[analyze/verifieddr] monthly quota nearly exhausted: ${remaining} of ${quotaLimit} left ` +
                    `on tier ${tier}. Scores stop silently when it reaches zero.`,
            );
        }

        try {
            return await res.json();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[analyze/verifieddr] ${path} returned unparseable JSON: ${message}`);
            return null;
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[analyze/verifieddr] ${path} threw: ${message}`);
        return null;
    }
}

/**
 * Fetches DR and TrueDR for a domain from VerifiedDR.
 *
 * DR comes from `/dr/{domain}`, which answers for any domain at all. TrueDR
 * needs `/lookup/{domain}` and exists only for sites approved on verifieddr.com,
 * so that second call is made only when the first says `listed`: one quota unit
 * in the common case, two for an approved site.
 *
 * Never throws and never rejects. Every failure path (missing API key, 429, 402,
 * any other non-2xx, an unparseable or unrecognised body, a timeout, a thrown
 * exception) resolves to nulls, each with its own log line. `analyzeSite` runs
 * this inside a `Promise.all` where only the LLM leg is allowed to reject, so
 * breaking that guarantee would turn a missing score into a failed submission.
 *
 * Both values are clamped to 0-100 and rounded before they are returned.
 *
 * @param domain - Canonical domain, lowercase, no scheme and no path.
 * @returns `domainRating` (Ahrefs DR) and `trueDr`, either or both possibly null.
 */
export async function getAuthorityScores(
    domain: string,
): Promise<{ domainRating: number | null; trueDr: number | null }> {
    const apiKey = process.env.VERIFIEDDR_API_KEY;
    if (!apiKey) {
        if (!warnedMissingKey) {
            warnedMissingKey = true;
            console.warn(
                "[analyze/verifieddr] VERIFIEDDR_API_KEY is not set, skipping authority lookups. " +
                    "Submissions still work, they just carry no DR or TrueDR.",
            );
        }
        return { ...NO_SCORES };
    }

    const encoded = encodeURIComponent(domain);

    const payload = await requestAuthority(`dr/${encoded}`, domain, apiKey);
    if (payload === null) return { ...NO_SCORES };

    const { domainRating } = parseAuthorityScores(payload);

    // `/dr` answers for every domain, so no DR here means the field names moved,
    // not that this site has no score. Print the shape rather than returning a
    // quiet null: silent nulls are the exact failure this module exists to make
    // visible, and they already cost this integration weeks once.
    if (domainRating === null) {
        console.warn(
            `[analyze/verifieddr] SCHEMA NEEDS CONFIRMING: no DR found for ${domain} on /dr, which answers ` +
                `for any domain. Response shape: ${describeShape(payload)}. Update DR_KEYS or ` +
                `CONTAINER_PREFIXES in src/lib/analyze/verifieddr.ts to the real field names above.`,
        );
        return { ...NO_SCORES };
    }

    // Not approved on their platform means there is no TrueDR to go and get.
    if (!isListedOnVerifiedDr(payload)) {
        return { domainRating, trueDr: null };
    }

    const lookup = await requestAuthority(`lookup/${encoded}`, domain, apiKey);
    if (lookup === null) return { domainRating, trueDr: null };

    const { trueDr } = parseAuthorityScores(lookup);

    // Plausible on a real response, since TrueDR needs more data than DR does,
    // but also exactly what a half-wrong candidate list looks like.
    if (trueDr === null) {
        console.warn(
            `[analyze/verifieddr] ${domain} is listed on verifieddr.com but its lookup carried no TrueDR. ` +
                `Either it has none yet, or the field name is not in TRUE_DR_KEYS. ` +
                `Response shape: ${describeShape(lookup)}`,
        );
    }

    return { domainRating, trueDr };
}
