import { Button, Section, Text } from "@react-email/components";

import type { MaskedPartner } from "@/lib/contracts";

import { getSiteOrigin } from "./_context";
import { CodeBlock, EmailLayout, Facts, drLabel, placementOfferLabel, styles } from "./_layout";

/**
 * @file "You have a new match", sent the moment a pair is proposed.
 *
 * THIS TEMPLATE IS ON THE MASKED SIDE OF THE IDENTITY BOUNDARY. Neither party
 * has accepted yet, so the recipient must not learn who the partner is: no
 * domain, no URL, no email address, and no image or link that would carry one.
 *
 * That is enforced by the prop type rather than by care. This component accepts
 * a `MaskedPartner`, which structurally has no `domain`, `url`, or `email`
 * field, so there is nothing here to accidentally interpolate. Do NOT widen the
 * prop to a site document, a `RevealedPartner`, or an intersection that happens
 * to carry the fields, "just to show the DR properly" or for any other reason.
 * The masking rule holds in email exactly as it holds in the API, and email is
 * the harder surface to take back: a leak here is already in someone's inbox.
 *
 * The description is written by the analyzer to be identity-scrubbed, so
 * rendering it verbatim is safe by construction. If that ever stops being true,
 * the fix belongs in `src/lib/analyze`, not in a conditional here.
 */

export type MatchProposedProps = {
    /** Match id, quoted so an agent can act on it straight from the mail. */
    matchId: string;
    /** The other side, masked. See the file header before changing this type. */
    partner: MaskedPartner;
    /** When the proposal lapses back into the pool. */
    expiresAt: Date;
    /**
     * True when the pair came from an adjacent category because the exact one
     * was thin. Said out loud: a member who spots the mismatch themselves
     * assumes the matching is sloppy.
     */
    widened?: boolean;
};

function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function MatchProposedEmail({ matchId, partner, expiresAt, widened = false }: MatchProposedProps) {
    const origin = getSiteOrigin();
    const anchors = partner.wantedAnchors.slice(0, 5);

    return (
        <EmailLayout preview={`A ${partner.category} site is available to trade with`}>
            <Text style={styles.heading}>You have a new match</Text>
            <Text style={styles.paragraph}>
                We found a site that fits yours. Neither of you knows who the other is yet, and that is on purpose:
                identities are revealed only when you have both accepted, at the same moment, to each other.
            </Text>

            <Facts
                rows={[
                    {
                        label: "Category",
                        value: widened ? `${partner.category} (adjacent to yours)` : partner.category,
                    },
                    { label: "Domain Rating", value: drLabel(partner.domainRating) },
                    { label: "They can offer", value: placementOfferLabel(partner.placementOffered) },
                    {
                        label: "Track record",
                        value: `${partner.linksGiven} given, ${partner.linksGot} received`,
                    },
                    { label: "Open until", value: formatDate(expiresAt) },
                ]}
            />

            <Text style={styles.subheading}>What they do</Text>
            <Text style={styles.paragraph}>{partner.description}</Text>

            {anchors.length > 0 ? (
                <>
                    <Text style={styles.subheading}>Anchors they would like</Text>
                    <Text style={styles.paragraph}>{anchors.join(", ")}</Text>
                </>
            ) : null}

            <Text style={styles.subheading}>To accept or decline</Text>
            <Text style={styles.paragraph}>From your agent, with the MCP server connected:</Text>
            <CodeBlock>{`respond_to_match matchId="${matchId}" accept=true`}</CodeBlock>
            <Text style={styles.paragraph}>Or do it in the browser:</Text>
            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app/inbox/${matchId}`} style={styles.button}>
                    Review this match
                </Button>
            </Section>

            <Text style={styles.muted}>
                Declining costs you nothing and is not held against you. An expired match goes back into the pool for
                both sides, so ignoring this is a slower version of declining.
            </Text>
        </EmailLayout>
    );
}

export default MatchProposedEmail;
