import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";

/**
 * @file Persistent fixed-window rate limiter backed by Postgres.
 *
 * Copied from the Nick Launches app, then ported off Mongo with the rest of
 * the data layer. It matters more here than it does there: the MCP read tools
 * are callable with no credentials at all, by agents, in loops. That is a
 * machine-optimised public API, and an uncapped one is a free scrape of the
 * member base.
 *
 * Limits live in the database rather than in memory so they survive isolate
 * recycling and apply consistently across every edge location. On Cloudflare
 * that is not a nicety: there is no single long-lived process to hold a
 * counter, so an in-memory bucket would reset on a schedule nobody controls.
 *
 * Algorithm: classic fixed window. The current window-start is
 * `Math.floor(now / windowMs) * windowMs`, so a single bucket's quota resets
 * every `windowMs`. Good enough for abuse prevention. If you need bursting,
 * smooth refill, or strict cross-window fairness later, switch to a token
 * bucket here without touching callers.
 *
 * One round trip per call. `INSERT ... ON CONFLICT (key, window_start) DO
 * UPDATE SET count = rate_limits.count + 1 RETURNING count` does the increment
 * and the read in a single atomic statement, so two concurrent requests on the
 * same bucket cannot both read a stale count. Over Neon's HTTP driver each
 * extra round trip is a whole HTTP request, so collapsing read-then-write into
 * one statement is a latency win as well as a correctness one.
 *
 * FAIL-OPEN BEHAVIOR, and why it is deliberate. Any unexpected database error
 * logs and returns `allowed: true`. Rate limiting must never deny legitimate
 * traffic because the database is the thing that is actually broken: we would
 * rather serve through a transient blip than 429 every caller. The consequence
 * is that this is abuse control, not a security boundary. The masking in
 * `services/mask.ts` is what actually protects member identities, and nothing
 * there depends on this.
 *
 * Expiry: rows carry `expiresAt` and there is an index on it, but Postgres has
 * no TTL of its own, so old windows are swept rather than self-pruned the way
 * the Mongo collection was. Nothing ever reads an expired row (the window-start
 * is part of the primary key), so a late sweep costs disk, not correctness.
 */

/** Inputs accepted by `enforceRateLimit`. */
export type RateLimitInput = {
    /** Logical bucket name, e.g. `"mcp:search"` or `"mcp:submit"`. */
    bucket: string;
    /** Stable per-caller identifier. A member id when signed in, else a client IP. */
    userId: string;
    /** Maximum allowed requests per window. */
    limit: number;
    /** Window length in milliseconds. */
    windowMs: number;
};

/** Result returned by `enforceRateLimit`. */
export type RateLimitResult = {
    allowed: boolean;
    /** Seconds until the next window starts, when `allowed === false`. */
    retryAfter: number;
};

/**
 * Atomically increments and checks the bucket. Returns `allowed: false` once
 * the count crosses `limit` for the current window. Safe under concurrency
 * because the increment and the read are the same statement.
 *
 * @param input - Bucket, caller identity, and the budget to enforce.
 * @returns Whether this call is allowed, and how long until the window resets.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
    const { bucket, userId, limit, windowMs } = input;
    const now = Date.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const retryAfter = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
    const key = `${bucket}:${userId}`;

    try {
        const [row] = await db()
            .insert(rateLimits)
            .values({
                key,
                // `window_start` is an int4 column and epoch milliseconds do not
                // fit in one. Every window boundary is a whole number of seconds
                // (the shortest window in use is a minute), so seconds are a
                // lossless bucket key. Widen the column to int8 before anyone
                // wants sub-second windows.
                windowStart: Math.floor(windowStartMs / 1000),
                count: 1,
                expiresAt: new Date(windowStartMs + windowMs * 2),
            })
            .onConflictDoUpdate({
                target: [rateLimits.key, rateLimits.windowStart],
                // Reads the stored row, not the one we tried to insert, so this
                // is a true increment rather than a reset to 1.
                set: { count: sql<number>`${rateLimits.count} + 1` },
            })
            .returning({ count: rateLimits.count });

        const count = row?.count ?? 1;
        if (count > limit) {
            return { allowed: false, retryAfter };
        }
        return { allowed: true, retryAfter: 0 };
    } catch (err) {
        console.error("rate-limit DB error; failing open:", bucket, userId, err);
        return { allowed: true, retryAfter: 0 };
    }
}
