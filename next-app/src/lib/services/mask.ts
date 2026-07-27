import type { Category } from "@/lib/categories";
import type { MaskedPartner, RevealedPartner } from "@/lib/contracts";
import { isRevealed, type MatchState } from "@/lib/models/ExchangeMatch";
import type { ExchangeSiteDoc } from "@/lib/models/ExchangeSite";
import type { PlacementOffer } from "@/lib/models/ExchangeSite";

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
 */

/** The site fields masking needs. Accepts a lean doc or a hydrated document. */
type SiteLike = Pick<
    ExchangeSiteDoc,
    "category" | "description" | "domainRating" | "keywords" | "placementOffered" | "linksGiven" | "linksGot"
> & {
    _id: { toString(): string };
    domain: string;
    url: string;
};

/**
 * Builds the pre-accept view of a partner.
 *
 * `partnerId` is the site id. It is opaque to the caller and only useful as an
 * argument to `propose_trade`, so handing it out does not reveal anything.
 *
 * @param site - The candidate site document.
 * @returns A partner view with no identifying fields.
 */
export function toMaskedPartner(site: SiteLike): MaskedPartner {
    return {
        partnerId: site._id.toString(),
        category: site.category as Category,
        description: site.description,
        domainRating: site.domainRating ?? null,
        wantedAnchors: site.keywords ?? [],
        placementOffered: (site.placementOffered ?? "unsure") as PlacementOffer,
        linksGiven: site.linksGiven ?? 0,
        linksGot: site.linksGot ?? 0,
    };
}

/**
 * Builds the post-accept view of a partner, including how to reach them.
 *
 * @param site - The partner's site document.
 * @param ownerEmail - The partner's email, resolved from their member record.
 * @param state - The current match state. Anything before `agreed` throws.
 * @throws When called for a match that has not reached mutual accept. This is a
 *   programming error, not a user error: reaching this means a caller tried to
 *   reveal an identity the member has not consented to share yet.
 */
export function toRevealedPartner(site: SiteLike, ownerEmail: string, state: MatchState): RevealedPartner {
    if (!isRevealed(state)) {
        throw new Error(`Refusing to reveal partner identity for a match in state "${state}"`);
    }
    return {
        ...toMaskedPartner(site),
        domain: site.domain,
        url: site.url,
        email: ownerEmail,
    };
}
