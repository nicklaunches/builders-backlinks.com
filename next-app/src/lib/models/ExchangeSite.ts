import mongoose, { type HydratedDocument, type InferSchemaType, type Model } from "mongoose";

import { CATEGORIES } from "@/lib/categories";

/**
 * @file A single website listed in the exchange.
 *
 * `domain` is globally unique: a domain belongs to exactly one member, ever.
 * That single constraint is the cheapest anti-abuse measure available. It stops
 * one person listing the same site under several accounts to farm matches, and
 * it makes "who owns this site" answerable without a resolution step.
 *
 * The identity-scrubbed `description` is what makes blind matching possible at
 * all: partners are shown what a site is about without being shown which site
 * it is. `domain` and the owner's email are only revealed to the other party
 * once a match reaches `agreed` (see ExchangeMatch).
 */

export const PLACEMENT_OFFERS = ["blog_post", "resources_page", "existing_article", "unsure"] as const;
export type PlacementOffer = (typeof PLACEMENT_OFFERS)[number];

export const SITE_STATUSES = ["pending_review", "active", "paused", "rejected", "banned"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const SITE_SOURCES = ["direct", "nl_import"] as const;
export type SiteSource = (typeof SITE_SOURCES)[number];

const ExchangeSiteSchema = new mongoose.Schema(
    {
        /** Shared Nick Launches user `_id`. This app never writes to `users`. */
        owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

        /** Normalized: lowercase, no protocol, no `www.`, no path. Globally unique. */
        domain: { type: String, required: true, lowercase: true, trim: true },
        /** Full canonical URL as submitted, used for crawling and display after reveal. */
        url: { type: String, required: true, trim: true },

        category: { type: String, required: true, enum: CATEGORIES },
        /** Anchor-text hints partners can choose from. 1 to 25. */
        keywords: {
            type: [String],
            default: [],
            validate: {
                validator: (v: string[]) => v.length >= 1 && v.length <= 25,
                message: "Provide 1 to 25 keywords",
            },
        },
        /**
         * LLM-written, identity-scrubbed. Must describe what the site does
         * without naming it, because it is shown to partners pre-reveal.
         */
        description: { type: String, required: true, trim: true, maxlength: 2000 },

        /** Ahrefs Domain Rating via VerifiedDR, 0-100. Nullable: it is a sorting hint, never a gate. */
        domainRating: { type: Number, default: null, min: 0, max: 100 },
        /**
         * VerifiedDR's TrueDR, their manipulation-discounted recalculation of
         * the same 0-100 scale. Matching bands on this rather than on
         * `domainRating`, so an inflated DR cannot buy a better partner.
         */
        trueDr: { type: Number, default: null, min: 0, max: 100 },
        drCheckedAt: { type: Date, default: null },

        /**
         * What this member can offer a partner. Collected because a mismatch of
         * expectations (one side wants a blog post, the other adds a footer
         * link) is what kills most agreed exchanges.
         */
        placementOffered: { type: String, enum: PLACEMENT_OFFERS, default: "unsure" },

        source: { type: String, enum: SITE_SOURCES, default: "direct" },
        /** Set when imported from a Nick Launches product. Skips review. */
        nlProductSlug: { type: String, default: null },

        status: { type: String, enum: SITE_STATUSES, default: "pending_review", required: true },
        reviewNote: { type: String, default: null },

        /** Maintained by the verification job. Drives reciprocity health in scoring. */
        linksGiven: { type: Number, default: 0, min: 0 },
        linksGot: { type: Number, default: 0, min: 0 },
        trustScore: { type: Number, default: 50, min: 0, max: 100 },

        lastMatchedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "exchange_sites" },
);

ExchangeSiteSchema.index({ domain: 1 }, { unique: true });
/** The matching query: active candidates in a category, best DR first. */
ExchangeSiteSchema.index({ category: 1, status: 1, domainRating: -1 });
/** Staleness sweep: surface members who have not been matched recently. */
ExchangeSiteSchema.index({ status: 1, lastMatchedAt: 1 });

export type ExchangeSiteDoc = InferSchemaType<typeof ExchangeSiteSchema>;

export const ExchangeSite: Model<ExchangeSiteDoc> =
    (mongoose.models.ExchangeSite as Model<ExchangeSiteDoc>) ||
    mongoose.model<ExchangeSiteDoc>("ExchangeSite", ExchangeSiteSchema);

/**
 * Normalizes a hostname or URL into the canonical `domain` form.
 *
 * Lowercase, no scheme, no `www.`, no port, no path. Must be used on every
 * write path or the global uniqueness constraint is meaningless.
 */
export function normalizeDomain(input: string): string {
    const trimmed = input.trim().toLowerCase();
    const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    let host: string;
    try {
        host = new URL(withScheme).hostname;
    } catch {
        throw new Error(`Not a valid domain: ${input}`);
    }
    return host.replace(/^www\./, "");
}

/**
 * A live document as returned by queries: ExchangeSiteDoc plus `_id` and the Mongoose
 * document methods. `InferSchemaType` describes the SHAPE of the schema and
 * deliberately omits `_id`, so passing a query result where a plain ExchangeSiteDoc is
 * expected typechecks but loses the id. Service signatures should take this.
 */
export type ExchangeSiteHydrated = HydratedDocument<ExchangeSiteDoc>;
