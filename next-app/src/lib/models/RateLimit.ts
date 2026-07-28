import mongoose, { type InferSchemaType, type Model } from "mongoose";

/**
 * @file Persistent rate-limit counters.
 *
 * One row per (bucket, user, window-start) tuple. The TTL index on
 * `expiresAt` prunes old windows automatically so the collection never grows
 * unbounded. The unique compound index on `(key, windowStart)` lets concurrent
 * requests collapse onto the same row via atomic `$inc` upserts.
 */

const RateLimitSchema = new mongoose.Schema(
    {
        // `${bucket}:${userId}` so multiple buckets (prefill, upload, etc.)
        // share one collection without colliding.
        key: { type: String, required: true },
        // Epoch ms at the start of the fixed window this row counts toward.
        windowStart: { type: Number, required: true },
        count: { type: Number, default: 0 },
        // Deletion target for the TTL index. Set on insert to
        // `windowStart + 2 * windowMs` so we keep a small grace period for
        // diagnostics before MongoDB sweeps the row.
        expiresAt: { type: Date, required: true },
    },
    { timestamps: false, collection: "rate_limits" },
);

RateLimitSchema.index({ key: 1, windowStart: 1 }, { unique: true });
// MongoDB TTL monitor runs about once a minute, so rows survive briefly past
// `expiresAt`. That's fine: limits compare on `windowStart`, not row presence.
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimitDoc = InferSchemaType<typeof RateLimitSchema>;

export const RateLimit: Model<RateLimitDoc> =
    (mongoose.models.RateLimit as Model<RateLimitDoc>) || mongoose.model<RateLimitDoc>("RateLimit", RateLimitSchema);
