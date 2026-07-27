import mongoose, { type HydratedDocument, type InferSchemaType, type Model } from "mongoose";

/**
 * @file Everything about a member that does not belong on the shared user doc.
 *
 * Accounts are genuinely shared with Nick Launches: both apps point NextAuth's
 * MongoDB adapter at the same `users` / `accounts` collections, so the same
 * person resolves to the same `_id` on both domains. Only the session cookie is
 * per-domain. This collection holds the exchange-specific state so the shared
 * `users` documents are never written to from here.
 *
 * `nlPromptedAt` / `nlSubmittedAt` are the loop attribution. They are cheap
 * now and impossible to reconstruct later, which is the only reason they are in
 * the very first schema rather than added once there is something to measure.
 */

export const DIGEST_CADENCES = ["weekly", "biweekly", "paused"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

const ExchangeMemberSchema = new mongoose.Schema(
    {
        /** Shared Nick Launches user `_id`. */
        user: { type: mongoose.Schema.Types.ObjectId, required: true },
        /** Denormalized for sending, and for matching a bearer key to a person. */
        email: { type: String, required: true, lowercase: true, trim: true },

        /**
         * SHA-256 of the MCP bearer token. The plaintext `bb_live_...` key is
         * shown once at creation and never stored. Header tokens are the
         * day-one auth path; OAuth 2.1 with dynamic client registration
         * replaces them later without changing this model.
         */
        apiKeyHash: { type: String, default: null },
        apiKeyIssuedAt: { type: Date, default: null },
        apiKeyLastUsedAt: { type: Date, default: null },

        verifiedAt: { type: Date, default: null },

        digestCadence: { type: String, enum: DIGEST_CADENCES, default: "weekly" },
        lastDigestSentAt: { type: Date, default: null },
        /**
         * Soft disable. Digests stop and this member's sites drop out of
         * matching, but nothing is deleted: clearing this restores everything.
         */
        unsubscribedAt: { type: Date, default: null },

        /** When we asked this member to launch on Nick Launches. Ask once, ever. */
        nlPromptedAt: { type: Date, default: null },
        /** When they actually submitted there. The headline loop metric. */
        nlSubmittedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "exchange_members" },
);

ExchangeMemberSchema.index({ user: 1 }, { unique: true });
ExchangeMemberSchema.index({ email: 1 });
ExchangeMemberSchema.index({ apiKeyHash: 1 }, { sparse: true });
/** Digest sweep: who is due, oldest first. */
ExchangeMemberSchema.index({ unsubscribedAt: 1, lastDigestSentAt: 1 });

export type ExchangeMemberDoc = InferSchemaType<typeof ExchangeMemberSchema>;

export const ExchangeMember: Model<ExchangeMemberDoc> =
    (mongoose.models.ExchangeMember as Model<ExchangeMemberDoc>) ||
    mongoose.model<ExchangeMemberDoc>("ExchangeMember", ExchangeMemberSchema);

/**
 * A live document as returned by queries: ExchangeMemberDoc plus `_id` and the Mongoose
 * document methods. `InferSchemaType` describes the SHAPE of the schema and
 * deliberately omits `_id`, so passing a query result where a plain ExchangeMemberDoc is
 * expected typechecks but loses the id. Service signatures should take this.
 */
export type ExchangeMemberHydrated = HydratedDocument<ExchangeMemberDoc>;
