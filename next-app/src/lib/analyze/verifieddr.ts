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
 * TODO(verify): THE RESPONSE SCHEMA HERE IS UNCONFIRMED. VerifiedDR publishes
 * the endpoint, the auth scheme, and the rate limits, but not the JSON body it
 * returns, and this parser was written without a key to test against. The field
 * names below are plausible guesses, not verified facts. Whoever gets an API key
 * first: make ONE call to `GET /lookup/{domain}`, read the real field names, and
 * pin `DR_KEYS` / `TRUE_DR_KEYS` / `CONTAINER_PREFIXES` to them, then delete this
 * TODO. Until that happens, treat missing scores as a schema problem before
 * assuming the domain simply has none.
 *
 * Why the guessing is made loud rather than quiet: this module returns null on
 * every failure by design, so a wrong field name produces no error, no stack
 * trace, and no scores forever, while everything looks healthy. So when parsing
 * fails we log the response's actual key NAMES (never values, never the key) at
 * warn level. One real call then reveals the shape from the logs immediately.
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
 * Where the metrics might sit: at the top level, or one level down under a
 * conventional envelope key. Deliberately shallow. Searching arbitrarily deep
 * would find a plausible-looking number somewhere in almost any payload, and a
 * confidently wrong score is worse than a null one.
 */
const CONTAINER_PREFIXES: readonly (readonly string[])[] = [[], ["data"], ["result"]];

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

/** Warn about the missing key once per process, not once per submission. */
let warnedMissingKey = false;

/** Both metrics absent. The single value every failure path returns. */
const NO_SCORES = { domainRating: null, trueDr: null } as const;

/**
 * Fetches DR and TrueDR for a domain from VerifiedDR.
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

    try {
        const res = await fetch(`${VERIFIEDDR_BASE_URL}/lookup/${encodeURIComponent(domain)}`, {
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
                `[analyze/verifieddr] MONTHLY QUOTA EXHAUSTED (HTTP 402) on lookup for ${domain}. ` +
                    `EVERY submission from now on will be saved with NO DR and NO TrueDR until the quota ` +
                    `resets or the plan is upgraded, and nothing else will look wrong. ` +
                    `tier=${tier} quotaLimit=${quotaLimit} quotaRemaining=${quotaRemaining}`,
            );
            return { ...NO_SCORES };
        }

        // Per-minute sliding window (60/min). Transient: the next submission is
        // very likely fine, so this stays a warn and is not retried inline.
        if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After") ?? "unset";
            console.warn(
                `[analyze/verifieddr] per-minute rate limit hit (HTTP 429) on lookup for ${domain}, ` +
                    `Retry-After: ${retryAfter}s. This submission gets no scores.`,
            );
            return { ...NO_SCORES };
        }

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[analyze/verifieddr] lookup for ${domain} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
            return { ...NO_SCORES };
        }

        const remaining = Number(quotaRemaining);
        if (Number.isFinite(remaining) && remaining <= LOW_QUOTA_WARN_THRESHOLD) {
            console.warn(
                `[analyze/verifieddr] monthly quota nearly exhausted: ${remaining} of ${quotaLimit} left ` +
                    `on tier ${tier}. Scores stop silently when it reaches zero.`,
            );
        }

        let payload: unknown;
        try {
            payload = await res.json();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[analyze/verifieddr] lookup for ${domain} returned unparseable JSON: ${message}`);
            return { ...NO_SCORES };
        }

        const domainRating = pickScore(payload, candidatePaths(DR_KEYS));
        const trueDr = pickScore(payload, candidatePaths(TRUE_DR_KEYS));

        // Neither metric found means the guessed field names are wrong far more
        // often than it means the domain has no scores, so say so explicitly and
        // print the shape. Key names only: no values, and never the API key.
        if (domainRating === null && trueDr === null) {
            console.warn(
                `[analyze/verifieddr] SCHEMA NEEDS CONFIRMING: found neither DR nor TrueDR for ${domain}. ` +
                    `Response shape: ${describeShape(payload)}. ` +
                    `Update DR_KEYS / TRUE_DR_KEYS / CONTAINER_PREFIXES in src/lib/analyze/verifieddr.ts ` +
                    `to the real field names above, then remove the TODO(verify) in this file.`,
            );
            return { ...NO_SCORES };
        }

        // One of the two missing is worth a quieter note: it is plausible on a
        // real response (TrueDR may need more data than DR does), but it is also
        // exactly what a half-wrong candidate list looks like.
        if (domainRating === null || trueDr === null) {
            const missing = domainRating === null ? "DR" : "TrueDR";
            console.warn(
                `[analyze/verifieddr] ${missing} missing for ${domain} while the other metric parsed. ` +
                    `Either the domain has no ${missing}, or its field name is not in this file's candidate ` +
                    `list. Response shape: ${describeShape(payload)}`,
            );
        }

        return { domainRating, trueDr };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[analyze/verifieddr] lookup for ${domain} threw: ${message}`);
        return { ...NO_SCORES };
    }
}
