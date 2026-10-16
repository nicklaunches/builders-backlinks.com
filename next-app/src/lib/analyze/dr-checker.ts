import { z } from "zod";

/**
 * @file Domain Rating from our own DR checker service.
 *
 * The DR checker keeps a cache of Ahrefs Domain Rating and answers for any domain. One
 * endpoint is used here: `POST {DR_CHECKER_URL}/dr` with `{ domains }`, up to
 * {@link RATINGS_PER_CALL} at a time, answering `{ results: [...] }` in the
 * order sent. Each result is `{ domain, query?, dr, status }`:
 *
 * - `ok` carries a reading. `dr: 0` is a real one (a domain nobody links to)
 *   and is kept as one.
 * - `unrated` is the DR checker's "nothing to say", with `dr: null`.
 * - `pending` means the DR checker did not hold the domain and is buying it in the
 *   background. It lands within minutes, so the next call has it.
 * - `query` is present when the DR checker canonicalized the spelling we sent, which is
 *   why results are keyed by `query ?? domain`: the caller looks up by what it
 *   sent.
 *
 * The DR checker returns DR only: no trust-weighted second score, no traffic, no
 * confidence. Matching bands on DR for that reason (see `matching/score.ts`).
 * There is no per-minute window and no monthly quota to pace against either,
 * which is what lets `services/authority.ts` send a whole batch in one call.
 *
 * Auth is a bearer token in `DR_CHECKER_TOKEN`, the base in `DR_CHECKER_URL`; both are
 * private and come only from the environment (Worker secrets in production).
 * The service admits only allowlisted callers, so a 403 is a CALLER the
 * allowlist refused, not a bad token (that is a 401), and is logged as an error
 * rather than mistaken for a missing rating. With either variable unset every
 * call is skipped, so local dev works without it.
 *
 * A wrong field name here would produce no error, only nulls, and nothing would
 * look broken while every site went unscored. So the body is parsed with Zod and
 * a mismatch is logged with the issue PATHS (never values) at warn level, where
 * one line names what moved.
 */

/** The DR checker's own ceiling on one batch call. Callers stay under it. */
export const RATINGS_PER_CALL = 5_000;

/** Fallback wait when a 429 arrives without a usable `Retry-After`. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

const RatingsBody = z.object({
    results: z.array(
        z.object({
            domain: z.string(),
            query: z.string().optional(),
            dr: z.number().nullish(),
            status: z.string(),
        }),
    ),
});

/** One domain's answer. Only `ok` carries a number. */
export type RatingAnswer = { status: "ok"; dr: number } | { status: "unrated" } | { status: "pending" };

/**
 * Outcome of a batch read, keyed by the domain as sent.
 *
 * Anything but `ok` means NO answer for any domain in the batch: a partial map
 * would let a caller record the unread hosts as unrated.
 */
export type RatingsResult =
    | { status: "ok"; answers: Map<string, RatingAnswer> }
    | { status: "unconfigured" }
    | { status: "rate-limited"; retryAfterMs: number }
    | { status: "error" };

/** Warn about missing config once per process, not once per submission. */
let warnedMissingConfig = false;

/** Base URL and token, or null when either is missing. */
function config(): { base: string; token: string } | null {
    const base = process.env.DR_CHECKER_URL?.trim().replace(/\/+$/, "");
    const token = process.env.DR_CHECKER_TOKEN?.trim();
    return base && token ? { base, token } : null;
}

/**
 * Rounds and clamps to 0-100. `ExchangeSite` checks that range in the database,
 * and a value outside it would fail the write far from here.
 */
function toScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Domain Ratings for up to {@link RATINGS_PER_CALL} domains in one call.
 *
 * NEVER THROWS. Every failure resolves to a non-`ok` result with its own log
 * line: `analyzeSite` runs this inside a `Promise.all` where only the LLM leg may
 * reject, so breaking that turns a missing score into a failed submission.
 *
 * @param domains - Canonical domains, lowercase, no scheme and no path.
 */
export async function getDomainRatings(domains: string[], timeoutMs = 30_000): Promise<RatingsResult> {
    const cfg = config();
    if (!cfg) {
        if (!warnedMissingConfig) {
            warnedMissingConfig = true;
            console.warn(
                "[analyze/dr-checker] DR_CHECKER_URL or DR_CHECKER_TOKEN is not set, skipping Domain Rating lookups. " +
                    "Submissions still work, they just carry no DR.",
            );
        }
        return { status: "unconfigured" };
    }
    if (domains.length === 0) return { status: "ok", answers: new Map() };

    let res: Response;
    let body: unknown;
    try {
        res = await fetch(`${cfg.base}/dr`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${cfg.token}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ domains }),
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 429) {
            const header = Number(res.headers.get("Retry-After"));
            const retryAfterMs = Number.isFinite(header) && header > 0 ? header * 1000 : DEFAULT_RETRY_AFTER_MS;
            console.warn(`[analyze/dr-checker] rate limited (HTTP 429), Retry-After ${retryAfterMs / 1000}s.`);
            return { status: "rate-limited", retryAfterMs };
        }
        if (res.status === 403) {
            console.error(
                `[analyze/dr-checker] HTTP 403 from ${cfg.base}: the IP allowlist refused this caller. ` +
                    `Not a token problem. Every lookup from here gets no DR until the address is allowed.`,
            );
            return { status: "error" };
        }
        if (res.status === 401) {
            console.error("[analyze/dr-checker] HTTP 401: DR_CHECKER_TOKEN was refused.");
            return { status: "error" };
        }
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn(`[analyze/dr-checker] /dr failed: HTTP ${res.status} ${text.slice(0, 200)}`);
            return { status: "error" };
        }
        body = await res.json();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[analyze/dr-checker] /dr threw: ${message}`);
        return { status: "error" };
    }

    const parsed = RatingsBody.safeParse(body);
    if (!parsed.success) {
        const paths = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
        console.warn(
            `[analyze/dr-checker] SCHEMA NEEDS CONFIRMING: /dr answered a shape we do not recognise. ` +
                `Issues at: ${[...new Set(paths)].slice(0, 10).join(", ")}`,
        );
        return { status: "error" };
    }

    const answers = new Map<string, RatingAnswer>();
    for (const result of parsed.data.results) {
        const key = result.query ?? result.domain;
        if (result.status === "ok" && result.dr != null) {
            answers.set(key, { status: "ok", dr: toScore(result.dr) });
        } else if (result.status === "unrated") {
            answers.set(key, { status: "unrated" });
        } else if (result.status === "pending") {
            answers.set(key, { status: "pending" });
        }
        // The DR checker's per-domain `error` is left out of the map: no answer, so the
        // caller treats it exactly like a domain that was never read.
    }
    return { status: "ok", answers };
}

/**
 * Domain Rating for one domain at submit time, or null for anything but a
 * reading. Never throws.
 *
 * A null here is common and fine for a new domain: the DR checker answers `pending`,
 * buys it within minutes, and the authority refresh picks it up once the listing
 * is active, because a site saved with no DR has no `dr_checked_at`.
 *
 * The DR checker's read is a cached lookup, so it should be fast. It runs next to an LLM
 * call in the submit flow, and a slow score is worth less than a quick
 * submission, hence the short timeout.
 *
 * @param domain - Canonical domain, lowercase, no scheme and no path.
 */
export async function getDomainRating(domain: string): Promise<number | null> {
    const result = await getDomainRatings([domain], 10_000);
    if (result.status !== "ok") return null;
    const answer = result.answers.get(domain);
    return answer?.status === "ok" ? answer.dr : null;
}
