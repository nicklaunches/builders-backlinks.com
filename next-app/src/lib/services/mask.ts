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
 *
 * ON `partnerId`, WHICH THIS FILE USED TO OVERSELL. It said the id existed to
 * be passed to `propose_trade`. There is no such tool and there never was, so
 * the weekly digest — reading that comment in good faith — printed the id under
 * every candidate with a call nobody could make, and a member said so in public
 * on 2026-08-03. The id is still handed out, and is still safe to hand out: it
 * is opaque and decodes to nothing. It simply has no consumer yet. Tracked in
 * issue #18; whatever eventually consumes it should be named here.
 */

/**
 * The site fields masking needs.
 *
 * A `Pick` rather than the row itself, for the same reason `MaskedPartner` has
 * no domain field: it states exactly what masking may read. `domain` and `url`
 * are here only for `toRevealedPartner`.
 *
 * `linksGiven` / `linksGot` are deliberately excluded even though the columns
 * exist: they are stale, and leaving them out means this file cannot read the
 * wrong number by accident. Counts arrive as an argument instead.
 */
type SiteLike = Pick<
    ExchangeSite,
    "id" | "category" | "description" | "domain" | "domainRating" | "keywords" | "placementOffered" | "url"
>;

/**
 * Builds the pre-accept view of a partner.
 *
 * `partnerId` is the site id. It is opaque to the caller and decodes to nothing,
 * so handing it out does not reveal anything. What it is FOR is a different
 * question, and the honest answer today is: nothing. See the `@file` block.
 *
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
 * @param counts - Live link counts for this site, as {@link toMaskedPartner}.
 * @param state - Anything before `agreed` throws.
 * @param agreedAt - When the match was agreed, if the caller holds the row. A
 *   match that closed after agreement is still revealed: see `isRevealed`.
 * @throws When the match has not reached mutual accept. A programming error, not
 *   a user one: a caller tried to reveal an identity nobody consented to share.
 */
export function toRevealedPartner(
    site: SiteLike,
    counts: LiveLinkCounts,
    ownerEmail: string,
    state: MatchState,
    agreedAt?: Date | null,
): RevealedPartner {
    if (!isRevealed(state, agreedAt)) {
        throw new Error(`Refusing to reveal partner identity for a match in state "${state}"`);
    }
    return {
        ...toMaskedPartner(site, counts),
        domain: site.domain,
        url: site.url,
        email: ownerEmail,
    };
}
