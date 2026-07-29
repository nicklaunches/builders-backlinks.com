import { linkStatusEnum, matchStateEnum, placementEnum, placementOfferEnum, siteStatusEnum } from "@/lib/db/schema";

/**
 * @file The pure domain rules, and the enum value lists derived from the schema.
 *
 * These previously lived alongside the Mongoose models. When those were deleted
 * for the Postgres move, the rules went with them even though none of them ever
 * touched the database. This is their proper home: no storage import beyond the
 * enum definitions, no I/O, trivially testable.
 *
 * The value lists are DERIVED from the pgEnums rather than re-declared, so the
 * database constraint and the TypeScript union cannot drift apart. Adding a
 * status in `schema.ts` makes it valid everywhere automatically, and removing
 * one becomes a compile error at every use site rather than a runtime surprise.
 */

// ---------------------------------------------------------------------------
// Enum values and types, single-sourced from the schema
// ---------------------------------------------------------------------------

export const SITE_STATUSES = siteStatusEnum.enumValues;
export const PLACEMENT_OFFERS = placementOfferEnum.enumValues;
export const MATCH_STATES = matchStateEnum.enumValues;
export const LINK_STATUSES = linkStatusEnum.enumValues;
export const PLACEMENTS = placementEnum.enumValues;

export type SiteStatus = (typeof SITE_STATUSES)[number];
export type PlacementOffer = (typeof PLACEMENT_OFFERS)[number];
export type MatchState = (typeof MATCH_STATES)[number];
export type LinkStatus = (typeof LINK_STATUSES)[number];
export type Placement = (typeof PLACEMENTS)[number];

// ---------------------------------------------------------------------------
// Domain rules
// ---------------------------------------------------------------------------

/**
 * Normalizes a hostname or URL into the canonical `domain` form.
 *
 * Lowercase, no scheme, no `www.`, no port, no path. Must be used on every
 * write path: `exchange_sites.domain` is uniquely indexed, and that constraint
 * is meaningless if two spellings of one host can both get in.
 *
 * @throws When the input cannot be parsed as a host.
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
 * Orders an unordered pair so it maps to exactly one match row.
 *
 * Every read and write touching a pair must go through this. `site_a_id` is
 * always the smaller id, which combined with the unique index on
 * `(site_a_id, site_b_id)` is what stops two concurrent matching runs creating
 * duplicate threads for the same pair. Skipping it reintroduces exactly the bug
 * the index exists to prevent.
 */
export function orderPair<T extends { toString(): string }>(x: T, y: T): [T, T] {
    return x.toString() < y.toString() ? [x, y] : [y, x];
}

/**
 * Whether a match has reached the point where identities are revealed.
 *
 * `services/mask.ts` gates on this: before it, a partner has no domain or email
 * in any payload; from it, both sides are revealed to each other at once.
 */
export function isRevealed(state: MatchState): boolean {
    return state === "agreed" || state === "placed";
}

/**
 * Recheck schedule after a link is first seen live: day 7, day 30, then monthly.
 *
 * @returns The next due date, or null when the link is not live (nothing to
 *   recheck, and a link that was never seen has no anchor date to count from).
 */
export function nextCheckAt(link: { status: LinkStatus; firstSeenAt?: Date | null; checkCount?: number }): Date | null {
    if (link.status !== "live" || !link.firstSeenAt) return null;
    const days = link.checkCount && link.checkCount >= 2 ? 30 : 7;
    return new Date(link.firstSeenAt.getTime() + days * 24 * 60 * 60 * 1000);
}
