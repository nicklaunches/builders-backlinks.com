import mongoose, { type HydratedDocument, type InferSchemaType, type Model } from "mongoose";

/**
 * @file One promised or placed link. A match produces up to two of these.
 *
 * The reference implementation has no equivalent: it introduces two parties and
 * never records whether anything came of it. That gap is why no exchange in
 * this category can offer reputation, catch takers, or tell a member what they
 * actually received. This collection is the fix.
 *
 * POLICY: classify, never reject. `placement` and `rel` are recorded and shown
 * to BOTH parties, but a footer or nofollow link is still a real link and still
 * counts. The promise to members is that where each link lands is entirely up
 * to them; the platform's job is to make sure both sides know exactly what they
 * gave and got, not to referee it. Social pressure does the rest.
 */

export const LINK_STATUSES = [
    /** Agreed but not yet reported as placed. */
    "promised",
    /** Found on the page at the last check. */
    "live",
    /** Reported placed, but not found. Soft state: SPAs render late. */
    "missing",
    /** Was live at some point, gone at a later recheck. */
    "removed",
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const PLACEMENTS = ["content", "footer", "nav", "sidebar", "unknown"] as const;
export type Placement = (typeof PLACEMENTS)[number];

const ExchangeLinkSchema = new mongoose.Schema(
    {
        match: { type: mongoose.Schema.Types.ObjectId, ref: "ExchangeMatch", required: true },
        /** The site hosting the link. */
        fromSite: { type: mongoose.Schema.Types.ObjectId, ref: "ExchangeSite", required: true },
        /** The site receiving it. */
        toSite: { type: mongoose.Schema.Types.ObjectId, ref: "ExchangeSite", required: true },

        /** Where the giver says they put it. Supplied on `mark_link_placed`. */
        pageUrl: { type: String, default: null },
        anchorText: { type: String, default: null },

        status: { type: String, enum: LINK_STATUSES, default: "promised", required: true },
        placement: { type: String, enum: PLACEMENTS, default: "unknown" },
        /** Parsed `rel` tokens: nofollow, sponsored, ugc. Disclosed, not enforced. */
        rel: { type: [String], default: [] },
        /** True when the same href was seen on several sampled pages (sitewide). */
        sitewide: { type: Boolean, default: false },

        firstSeenAt: { type: Date, default: null },
        lastCheckedAt: { type: Date, default: null },
        checkCount: { type: Number, default: 0 },
        removedAt: { type: Date, default: null },
        /** Last human-readable verifier message, kept for the member and for admin. */
        lastMessage: { type: String, default: null },
    },
    { timestamps: true, collection: "exchange_links" },
);

ExchangeLinkSchema.index({ match: 1 });
ExchangeLinkSchema.index({ fromSite: 1 });
ExchangeLinkSchema.index({ toSite: 1 });
/** Drives the recheck cron: oldest-checked live links first. */
ExchangeLinkSchema.index({ status: 1, lastCheckedAt: 1 });

export type ExchangeLinkDoc = InferSchemaType<typeof ExchangeLinkSchema>;

export const ExchangeLink: Model<ExchangeLinkDoc> =
    (mongoose.models.ExchangeLink as Model<ExchangeLinkDoc>) ||
    mongoose.model<ExchangeLinkDoc>("ExchangeLink", ExchangeLinkSchema);

/**
 * Recheck schedule after a link is first seen live: day 7, day 30, then
 * monthly. Returns the next due date, or null when the link is not live.
 */
export function nextCheckAt(link: { status: LinkStatus; firstSeenAt?: Date | null; checkCount?: number }): Date | null {
    if (link.status !== "live" || !link.firstSeenAt) return null;
    const days = link.checkCount && link.checkCount >= 3 ? 30 : link.checkCount === 2 ? 30 : 7;
    return new Date(link.firstSeenAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * A live document as returned by queries: ExchangeLinkDoc plus `_id` and the Mongoose
 * document methods. `InferSchemaType` describes the SHAPE of the schema and
 * deliberately omits `_id`, so passing a query result where a plain ExchangeLinkDoc is
 * expected typechecks but loses the id. Service signatures should take this.
 */
export type ExchangeLinkHydrated = HydratedDocument<ExchangeLinkDoc>;
