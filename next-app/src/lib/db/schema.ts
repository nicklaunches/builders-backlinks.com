import { relations, sql } from "drizzle-orm";
import {
    boolean,
    check,
    index,
    integer,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";

import { CATEGORIES } from "@/lib/categories";

/**
 * @file The Postgres schema. Replaces the four Mongoose models.
 *
 * MongoDB was dropped because its driver cannot run on Cloudflare Workers: it
 * needs `net.Socket` and `tls.TLSSocket` and fails even with `nodejs_compat`.
 * Postgres was picked over D1 mainly for real array columns, since `keywords`
 * and `rel` are arrays and SQLite would have forced them into JSON blobs or
 * join tables for no gain.
 *
 * THE INVARIANTS THAT CAME ACROSS, and why each one matters:
 *
 * 1. `exchange_sites.domain` is unique. A domain belongs to exactly one member,
 *    ever. It is the cheapest anti-abuse measure available and it stops one
 *    person listing the same site under several accounts.
 * 2. `exchange_matches` is unique on `(site_a, site_b)` with `site_a` always
 *    the smaller id, enforced by `orderPair` in code. This is the one genuinely
 *    elegant idea inherited from the reference implementation: an unordered
 *    pair maps to exactly one row no matter which side matched first, which is
 *    what stops two concurrent matching runs creating duplicate threads.
 * 3. Both authority scores are constrained 0 to 100 and nullable. Nullable
 *    because a missing score is a sorting hint we did not get, never a gate.
 *
 * ON IDS: Mongo used ObjectId, this uses uuid. The sorted-pair rule compares
 * ids lexicographically and uuid strings compare fine, so the invariant
 * survives the type change unchanged.
 */

export const categoryEnum = pgEnum("category", CATEGORIES);

export const siteStatusEnum = pgEnum("site_status", ["pending_review", "active", "paused", "rejected", "banned"]);
export const placementOfferEnum = pgEnum("placement_offer", [
    "blog_post",
    "resources_page",
    "existing_article",
    "unsure",
]);
export const matchStateEnum = pgEnum("match_state", [
    "proposed",
    "a_accepted",
    "b_accepted",
    "agreed",
    "placed",
    "declined",
    "expired",
]);
export const linkStatusEnum = pgEnum("link_status", ["promised", "live", "missing", "removed"]);
export const placementEnum = pgEnum("placement", ["content", "footer", "nav", "sidebar", "unknown"]);
export const digestCadenceEnum = pgEnum("digest_cadence", ["weekly", "biweekly", "paused"]);

// ---------------------------------------------------------------------------
// Auth. Standard Auth.js tables.
// ---------------------------------------------------------------------------

/**
 * Users. Standard Auth.js columns, owned entirely by this app.
 *
 * The adapter manages every column here, so there is nothing for application
 * code to write. Email is uniquely indexed, which is what makes
 * `allowDangerousEmailAccountLinking` in `src/auth.ts` resolve to one row.
 */
export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name"),
        email: text("email").notNull(),
        emailVerified: timestamp("email_verified", { withTimezone: true }),
        image: text("image"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const accounts = pgTable(
    "accounts",
    {
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        type: text("type").notNull(),
        provider: text("provider").notNull(),
        providerAccountId: text("provider_account_id").notNull(),
        refresh_token: text("refresh_token"),
        access_token: text("access_token"),
        expires_at: integer("expires_at"),
        token_type: text("token_type"),
        scope: text("scope"),
        id_token: text("id_token"),
        session_state: text("session_state"),
    },
    (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
    "verification_tokens",
    {
        identifier: text("identifier").notNull(),
        token: text("token").notNull(),
        expires: timestamp("expires", { withTimezone: true }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// ---------------------------------------------------------------------------
// The exchange
// ---------------------------------------------------------------------------

export const exchangeMembers = pgTable(
    "exchange_members",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        /** Denormalized for sending, and for matching a bearer key to a person. */
        email: text("email").notNull(),

        /**
         * SHA-256 of the MCP bearer token. The plaintext `bb_live_...` is shown
         * once at creation and never stored.
         */
        apiKeyHash: text("api_key_hash"),
        apiKeyIssuedAt: timestamp("api_key_issued_at", { withTimezone: true }),
        apiKeyLastUsedAt: timestamp("api_key_last_used_at", { withTimezone: true }),

        verifiedAt: timestamp("verified_at", { withTimezone: true }),
        digestCadence: digestCadenceEnum("digest_cadence").default("weekly").notNull(),
        lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
        /** Soft disable. Digests stop and sites drop out of matching, nothing is deleted. */
        unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("exchange_members_user_idx").on(table.userId),
        index("exchange_members_email_idx").on(table.email),
        uniqueIndex("exchange_members_api_key_idx").on(table.apiKeyHash),
        /** Digest sweep: who is due, oldest first. */
        index("exchange_members_digest_idx").on(table.unsubscribedAt, table.lastDigestSentAt),
    ],
);

export const exchangeSites = pgTable(
    "exchange_sites",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        /** Normalized: lowercase, no scheme, no `www.`, no path. See invariant 1. */
        domain: text("domain").notNull(),
        url: text("url").notNull(),

        category: categoryEnum("category").notNull(),
        /** Anchor hints. A real array, which is why this is Postgres and not D1. */
        keywords: text("keywords").array().notNull().default([]),
        /** LLM-written and identity-scrubbed: shown to partners pre-reveal. */
        description: text("description").notNull(),

        /** Ahrefs Domain Rating via VerifiedDR. Shown to partners. */
        domainRating: integer("domain_rating"),
        /** VerifiedDR TrueDR. What matching actually bands on, see lib/matching. */
        trueDr: integer("true_dr"),
        drCheckedAt: timestamp("dr_checked_at", { withTimezone: true }),

        placementOffered: placementOfferEnum("placement_offered").default("unsure").notNull(),

        status: siteStatusEnum("status").default("pending_review").notNull(),
        reviewNote: text("review_note"),

        /**
         * Who moved `status` last, and when. Written ONLY by `setSiteStatus`.
         *
         * These exist to answer a question the data could not answer on
         * 2026-08-06: 33 sites were `active`, 26 of them had never been matched,
         * and there was no way to tell whether they had been approved through
         * /admin (making the approval path suspect) or flipped by hand in SQL
         * (making it a process problem). Every writer of `status` in the app
         * goes through `setSiteStatus`, so from here on the inference is direct:
         * an `active` row with a NULL `status_changed_by` did not become active
         * through this application.
         *
         * Nullable forever, and not backfilled. The 33 rows that predate this
         * genuinely have no attribution, and inventing one would destroy the
         * only signal these columns carry.
         */
        statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
        statusChangedBy: uuid("status_changed_by").references(() => users.id, { onDelete: "set null" }),

        trustScore: integer("trust_score").default(50).notNull(),
        lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("exchange_sites_domain_idx").on(table.domain),
        index("exchange_sites_owner_idx").on(table.ownerId),
        /** The matching query: active candidates in a category, best DR first. */
        index("exchange_sites_matching_idx").on(table.category, table.status, table.domainRating),
        /** Staleness sweep, so quiet members get surfaced. */
        index("exchange_sites_staleness_idx").on(table.status, table.lastMatchedAt),

        /**
         * Scores stay in 0..100, or NULL for "not measured yet".
         *
         * These are worth enforcing in the database rather than at the write
         * site because the values come from a third party. `lib/analyze` parses
         * the VerifiedDR response against a documented guess at its shape, so a
         * field that turns out to be a 0..1 float, a string, or a different key
         * entirely is a live possibility. A bad DR does not fail loudly, it
         * quietly bands a site into the wrong matching tier, which is the kind
         * of wrong that nobody notices. NULL is deliberately still allowed:
         * unknown is a legitimate state and the scorer handles it.
         */
        check("exchange_sites_domain_rating_range", sql`${table.domainRating} between 0 and 100`),
        check("exchange_sites_true_dr_range", sql`${table.trueDr} between 0 and 100`),
        // Same range, though nothing writes this column yet; it only ever takes
        // its default of 50. The constraint is here so that whatever eventually
        // does write it inherits the bound rather than having to remember it.
        check("exchange_sites_trust_score_range", sql`${table.trustScore} between 0 and 100`),
    ],
);

export const exchangeMatches = pgTable(
    "exchange_matches",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        /** ALWAYS the smaller id of the pair. Enforced by `orderPair`. Invariant 2. */
        siteAId: uuid("site_a_id")
            .notNull()
            .references(() => exchangeSites.id, { onDelete: "cascade" }),
        siteBId: uuid("site_b_id")
            .notNull()
            .references(() => exchangeSites.id, { onDelete: "cascade" }),

        category: categoryEnum("category").notNull(),
        score: integer("score").default(0).notNull(),
        /** True when the pair came from a widened, adjacent category pool. */
        widened: boolean("widened").default(false).notNull(),

        state: matchStateEnum("state").default("proposed").notNull(),
        proposedById: uuid("proposed_by_id").references(() => users.id, { onDelete: "set null" }),
        declineReason: text("decline_reason"),

        /** The reveal moment: domains and emails unlock here and not before. */
        agreedAt: timestamp("agreed_at", { withTimezone: true }),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        /**
         * When the placement nudge last went out for this match.
         *
         * The nudge is decided by a pass that runs every night, so without a
         * high-water mark here every agreed match with a missing link would mail
         * someone daily until it expired. NULL means never nudged.
         */
        lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        /** Invariant 2. Without this, concurrent runs duplicate a pair. */
        uniqueIndex("exchange_matches_pair_idx").on(table.siteAId, table.siteBId),
        index("exchange_matches_state_idx").on(table.state, table.expiresAt),
        index("exchange_matches_site_a_idx").on(table.siteAId),
        index("exchange_matches_site_b_idx").on(table.siteBId),
    ],
);

export const exchangeLinks = pgTable(
    "exchange_links",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        matchId: uuid("match_id")
            .notNull()
            .references(() => exchangeMatches.id, { onDelete: "cascade" }),
        /** The site hosting the link. */
        fromSiteId: uuid("from_site_id")
            .notNull()
            .references(() => exchangeSites.id, { onDelete: "cascade" }),
        /** The site receiving it. */
        toSiteId: uuid("to_site_id")
            .notNull()
            .references(() => exchangeSites.id, { onDelete: "cascade" }),

        pageUrl: text("page_url"),
        anchorText: text("anchor_text"),

        status: linkStatusEnum("status").default("promised").notNull(),
        /** Classified and disclosed to both sides. Never used to reject a placement. */
        placement: placementEnum("placement").default("unknown").notNull(),
        rel: text("rel").array().notNull().default([]),
        sitewide: boolean("sitewide").default(false).notNull(),

        firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
        lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
        checkCount: integer("check_count").default(0).notNull(),
        removedAt: timestamp("removed_at", { withTimezone: true }),
        lastMessage: text("last_message"),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        /** One link per direction per match. */
        uniqueIndex("exchange_links_direction_idx").on(table.matchId, table.fromSiteId, table.toSiteId),
        index("exchange_links_from_idx").on(table.fromSiteId),
        index("exchange_links_to_idx").on(table.toSiteId),
        /** Drives the recheck cron: oldest-checked first. */
        index("exchange_links_recheck_idx").on(table.status, table.lastCheckedAt),
    ],
);

/**
 * Fixed-window rate limit counters, one row per (bucket, caller, window).
 *
 * Kept in Postgres rather than KV because the limiter needs an atomic
 * increment-and-read, which `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
 * gives in one round trip. KV is eventually consistent and would let a caller
 * exceed a budget by racing itself across isolates.
 *
 * Old windows are swept by the recheck cron rather than a TTL index, since
 * Postgres has no equivalent of Mongo's TTL. Nothing depends on them being
 * gone: the limiter compares on `windowStart`, not on row presence.
 */
export const rateLimits = pgTable(
    "rate_limits",
    {
        /** `${bucket}:${caller}`, so buckets share one table without colliding. */
        key: text("key").notNull(),
        /**
         * Epoch SECONDS at the start of the fixed window this row counts.
         *
         * Seconds, not milliseconds, because this is `int4`: epoch ms is about
         * 831 times larger than int4 can hold and would overflow on every
         * write. Lossless for any window of a second or more, which every
         * budget in `lib/limits.ts` is. Widen to `bigint` before adding a
         * sub-second window.
         */
        windowStart: integer("window_start").notNull(),
        count: integer("count").default(0).notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.key, table.windowStart] }),
        index("rate_limits_expiry_idx").on(table.expiresAt),
    ],
);

// ---------------------------------------------------------------------------
// Relations, for the query builder's `with` joins
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
    accounts: many(accounts),
    sites: many(exchangeSites),
    member: one(exchangeMembers, { fields: [users.id], references: [exchangeMembers.userId] }),
}));

export const exchangeSitesRelations = relations(exchangeSites, ({ one }) => ({
    owner: one(users, { fields: [exchangeSites.ownerId], references: [users.id] }),
}));

export const exchangeMatchesRelations = relations(exchangeMatches, ({ one, many }) => ({
    siteA: one(exchangeSites, { fields: [exchangeMatches.siteAId], references: [exchangeSites.id] }),
    siteB: one(exchangeSites, { fields: [exchangeMatches.siteBId], references: [exchangeSites.id] }),
    links: many(exchangeLinks),
}));

export const exchangeLinksRelations = relations(exchangeLinks, ({ one }) => ({
    match: one(exchangeMatches, { fields: [exchangeLinks.matchId], references: [exchangeMatches.id] }),
    fromSite: one(exchangeSites, { fields: [exchangeLinks.fromSiteId], references: [exchangeSites.id] }),
    toSite: one(exchangeSites, { fields: [exchangeLinks.toSiteId], references: [exchangeSites.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred types. These replace the `*Hydrated` Mongoose aliases.
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type ExchangeMember = typeof exchangeMembers.$inferSelect;
export type ExchangeSite = typeof exchangeSites.$inferSelect;
export type ExchangeMatch = typeof exchangeMatches.$inferSelect;
export type ExchangeLink = typeof exchangeLinks.$inferSelect;

export type NewExchangeSite = typeof exchangeSites.$inferInsert;
export type NewExchangeMatch = typeof exchangeMatches.$inferInsert;
export type NewExchangeLink = typeof exchangeLinks.$inferInsert;
