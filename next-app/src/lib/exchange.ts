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

/** Enum values single-sourced from the pgEnums, so the column and the union cannot drift. */
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

/**
 * The match states that still want a decision from somebody.
 *
 * "Open" is the question two different jobs ask, and they must ask it the same
 * way: the weekly digest skips a member holding one of these, and the daily
 * re-pair pass skips a site holding one. Declared here rather than in either
 * route because a copy that drifts turns into a member who is either matched
 * twice over or never nudged again, and neither surface would look wrong on its
 * own.
 *
 * `placed` is absent deliberately. It is settled, not open: both links are live
 * and nobody owes anybody an answer. `declined` and `expired` are terminal.
 */
export const OPEN_MATCH_STATES = ["proposed", "a_accepted", "b_accepted", "agreed"] as const satisfies MatchState[];

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days between checks of a live link, by how many checks it has already had.
 *
 * Read as gaps, not offsets: 7, then 23, then 30 forever, which puts the checks
 * on day 7, day 30, day 60, day 90 — the documented schedule. The last entry
 * repeats once the list runs out.
 */
export const LIVE_CHECK_INTERVAL_DAYS = [7, 23, 30] as const;

/**
 * Days between checks of a link that is not live yet, or not live any more.
 *
 * Tighter than the live schedule and for a different reason. A `promised` link
 * is one whose first crawl was inconclusive, and a `missing` one is a link the
 * member may well be in the middle of fixing; in both cases the useful answer
 * arrives within a day or two, so look again soon and then back off.
 */
export const RETRY_CHECK_INTERVAL_DAYS = [1, 1, 1, 7] as const;

/**
 * How many checks a link that has NEVER been live gets before it is dropped.
 *
 * Only ever applied to a link with no `firstSeenAt`. A link that was once live
 * is never given up on: noticing six weeks later that it quietly came down is
 * the entire point of the recheck job, and a link that is missing today is
 * exactly the one worth looking at next month.
 *
 * The bound exists because the cron orders candidates by `lastCheckedAt` and a
 * link nothing will ever confirm would otherwise sit at the head of that queue
 * for good, spending the batch on itself.
 */
export const GIVE_UP_AFTER_CHECKS = 8;

function intervalDays(schedule: readonly number[], checkCount: number): number {
    const index = Math.min(Math.max(checkCount, 1), schedule.length) - 1;
    return schedule[index]!;
}

/**
 * When a link is next due to be verified, or null when it should not be.
 *
 * THE ANCHOR IS THE LAST CHECK, NOT THE FIRST SIGHTING. `firstSeenAt` is the
 * tempting anchor and it is a trap: it never moves, so any schedule counted
 * from it stops advancing the moment the interval stops growing, and the due
 * date is then permanently in the past. That was the real behaviour here —
 * `firstSeenAt + 30 days` from the second check onward, i.e. every live link
 * due on every run, "day 7, day 30, then daily forever". Anchoring on
 * `lastCheckedAt` means the schedule advances by construction: it cannot fall
 * behind a clock it is measured from.
 *
 * `firstSeenAt` remains the fallback for a live link that has somehow never
 * been checked since, and `createdAt` for a link that has never been checked at
 * all, which is what makes a freshly reported link due rather than unschedulable.
 *
 * Three statuses are scheduled, not one. `missing` used to be selected by the
 * cron and then never be due, so those rows were fetched on every run and
 * checked on none; `promised` was never selected at all, so a first report whose
 * crawl failed was never looked at again. Both are links the record is currently
 * wrong about, which makes them the ones most worth re-crawling.
 *
 * @returns The next due date, or null for a terminal `removed` link and for one
 *   that has never been confirmed live within {@link GIVE_UP_AFTER_CHECKS}.
 */
export function nextCheckAt(link: {
    status: LinkStatus;
    firstSeenAt?: Date | null;
    lastCheckedAt?: Date | null;
    createdAt?: Date | null;
    checkCount?: number;
}): Date | null {
    if (link.status === "removed") return null;

    const checkCount = link.checkCount ?? 0;
    const wasEverLive = link.firstSeenAt != null;
    if (!wasEverLive && checkCount >= GIVE_UP_AFTER_CHECKS) return null;

    const anchor = link.lastCheckedAt ?? link.firstSeenAt ?? link.createdAt;
    if (!anchor) return null;

    const schedule = link.status === "live" ? LIVE_CHECK_INTERVAL_DAYS : RETRY_CHECK_INTERVAL_DAYS;
    return new Date(anchor.getTime() + intervalDays(schedule, checkCount) * MS_PER_DAY);
}
