import { connectMongo } from "@/lib/db/mongoose";
import { RateLimit } from "@/lib/models/RateLimit";

/**
 * @file Persistent fixed-window rate limiter backed by MongoDB.
 *
 * Copied from the Nick Launches app. It matters more here than it does there:
 * the MCP read tools are callable with no credentials at all, by agents, in
 * loops. That is a machine-optimised public API, and an uncapped one is a free
 * scrape of the member base.
 *
 * Replaces the previous in-memory buckets so limits survive server restarts
 * and apply consistently across horizontally-scaled instances. Each call
 * performs one atomic upsert plus an optional `$inc`. The collection is
 * self-pruning via the TTL index defined on `RateLimit`.
 *
 * Algorithm: classic fixed window. The current window-start is
 * `Math.floor(now / windowMs) * windowMs`, so a single bucket's quota resets
 * every `windowMs`. Good enough for abuse prevention. If you need bursting,
 * smooth refill, or strict cross-window fairness later, switch to a token
 * bucket here without touching callers.
 *
 * Fail-open behavior: any unexpected DB error logs and returns `allowed:
 * true`. Rate limiting must never deny legitimate traffic when the database
 * is the one that's actually broken; we'd rather serve through a transient
 * Mongo blip than 429 every user.
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
 * the count crosses `limit` for the current window. Idempotent across replicas
 * because the underlying `$inc` upsert is.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
    const { bucket, userId, limit, windowMs } = input;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
    const key = `${bucket}:${userId}`;

    try {
        await connectMongo();
        const doc = await RateLimit.findOneAndUpdate(
            { key, windowStart },
            {
                $inc: { count: 1 },
                $setOnInsert: { expiresAt: new Date(windowStart + windowMs * 2) },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean<{ count: number } | null>();

        const count = doc?.count ?? 1;
        if (count > limit) {
            return { allowed: false, retryAfter };
        }
        return { allowed: true, retryAfter: 0 };
    } catch (err) {
        console.error("rate-limit DB error; failing open:", bucket, userId, err);
        return { allowed: true, retryAfter: 0 };
    }
}
