import type { LiveLinkCounts, MaskedPartner, RevealedPartner } from "@/lib/contracts";
import type { ExchangeSite } from "@/lib/db/schema";
import { type MatchState, isRevealed } from "@/lib/exchange";

/**
 * @file The identity boundary.
 *
 * Everything a member sees about a potential partner passes through here. The
 * rule the whole product rests on: a partner's domain, url, and email do not
 * exist in any payload until the match reaches `agreed`, and at that point both
 * sides are revealed to each other simultaneously.
 *
 * This is enforced structurally rather than by discipline. `MaskedPartner` has
 * no domain field to accidentally populate, and `toRevealedPartner` refuses to
 * build the wider type unless it is handed a revealed match state. That matters
 * most for the MCP server: it is a machine-readable API that agents will call
 * in loops, so a leak there is a scrape of the entire member base, not a single
 * slip on one screen.
 *
 * The predicate the boundary turns on, `isRevealed`, is imported from
 * `lib/exchange` rather than defined here. It is a pure rule about a match
 * state, and keeping it there means this file imports nothing from the service
 * layer: no service can end up in an import cycle with the one module that
 * decides what may be revealed.
 */

/**
 * The site fields masking needs.
 *
 * A `Pick` of the row rather than the row itself, for the same reason
 * `MaskedPartner` has no domain field: this type states exactly what masking is
 * allowed to read. `domain` and `url` are in the set only because
 * `toRevealedPartner` needs them, and that function is the only thing here that
 * touches them.
 *
 * `linksGiven` and `linksGot` are deliberately NOT in the set, though the row
 * still carries columns by those names. They are stale — standing is counted
 * from live links now, not stored — and leaving them out means this file cannot
 * read the wrong number even by accident. The counts arrive as an argument
 * instead.
 */
type SiteLike = Pick<
    ExchangeSite,
    "id" | "category" | "description" | "domain" | "domainRating" | "keywords" | "placementOffered" | "url"
>;

/**
 * Builds the pre-accept view of a partner.
 *
 * `partnerId` is the site id. It is opaque to the caller and only useful as an
 * argument to `propose_trade`, so handing it out does not reveal anything.
 *
 * @param site - The candidate site row.
 * @param counts - Live link counts for this site, from `services/standing.ts`.
 *   Required rather than optional so that a caller who has not resolved them
 *   fails to compile instead of quietly publishing zeroes or stale columns.
 * @returns A partner view with no identifying fields.
 */
export function toMaskedPartner(site: SiteLike, counts: LiveLinkCounts): MaskedPartner {
    return {
        partnerId: site.id,
        category: site.category,
        description: site.description,
        domainRating: site.domainRating,
        wantedAnchors: site.keywords,
        placementOffered: site.placementOffered,
        linksGiven: counts.linksGiven,
        linksGot: counts.linksGot,
    };
}

/**
 * Builds the post-accept view of a partner, including how to reach them.
 *
 * @param site - The partner's site row.
 * @param counts - Live link counts for this site, as {@link toMaskedPartner}.
 * @param ownerEmail - The partner's email, resolved from their member record.
 * @param state - The current match state. Anything before `agreed` throws.
 * @throws When called for a match that has not reached mutual accept. This is a
 *   programming error, not a user error: reaching this means a caller tried to
 *   reveal an identity the member has not consented to share yet.
 */
export function toRevealedPartner(
    site: SiteLike,
    counts: LiveLinkCounts,
    ownerEmail: string,
    state: MatchState,
): RevealedPartner {
    if (!isRevealed(state)) {
        throw new Error(`Refusing to reveal partner identity for a match in state "${state}"`);
    }
    return {
        ...toMaskedPartner(site, counts),
        domain: site.domain,
        url: site.url,
        email: ownerEmail,
    };
}
