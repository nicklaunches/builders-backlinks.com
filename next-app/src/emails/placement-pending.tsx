import { Button, Link, Section, Text } from "@react-email/components";

import type { RevealedPartner } from "@/lib/contracts";

import { getSiteOrigin } from "./_context";
import { CodeBlock, EmailLayout, Facts, styles } from "./_layout";

/**
 * @file "You agreed to this and never placed it."
 *
 * The gap this fills was the widest one in the product. Between `match-agreed`
 * and the day the match expires, nothing was ever sent. Worse, the weekly digest
 * SKIPS any member holding an open match, so someone sitting on an agreed match
 * they had forgotten heard from us not at all, then found the match gone. Both
 * sides of a trade could stall indefinitely with no one told.
 *
 * WHY IT NAMES THE OTHER SIDE'S PROGRESS. When the partner has already placed,
 * the mail says so. That is the most motivating true fact available and it costs
 * nothing to disclose, because the two members are already revealed to each
 * other by the time this can send. It is the same posture as placement
 * classification: state what is, do not enforce.
 *
 * The prop type is `RevealedPartner` for the reason given in `match-agreed.tsx`:
 * `toRevealedPartner` will not build one for a match that has not reached
 * `agreed`, so the identity in this mail is guaranteed by construction rather
 * than by the caller remembering to check.
 */

export type PlacementPendingProps = {
    matchId: string;
    /** Revealed only because both sides accepted. */
    partner: RevealedPartner;
    /** The URL the recipient owes a link to. */
    targetUrl: string;
    /** Anchors the partner asked for. May be empty, in which case any wording is fine. */
    anchorOptions: readonly string[];
    /** True when the partner has already placed their half. */
    partnerPlaced: boolean;
    /** Preformatted deadline, so the template does no date maths. */
    expires: string;
};

export function PlacementPendingEmail({
    matchId,
    partner,
    targetUrl,
    anchorOptions,
    partnerPlaced,
    expires,
}: PlacementPendingProps) {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview={`Your link to ${partner.domain} is still outstanding`}>
            <Text style={styles.heading}>{partnerPlaced ? "They placed theirs" : "One link still to place"}</Text>

            <Text style={styles.paragraph}>
                {partnerPlaced
                    ? `${partner.domain} has put your link live. Yours to them is the only half still missing.`
                    : `You and ${partner.domain} agreed to trade links, and we have not been able to find yours yet.`}
            </Text>

            <Facts
                rows={[
                    {
                        label: "Point it at",
                        value: (
                            <Link href={targetUrl} style={styles.link}>
                                {targetUrl}
                            </Link>
                        ),
                    },
                    {
                        label: "Anchor options",
                        value: anchorOptions.length > 0 ? anchorOptions.join(", ") : "Your own wording",
                    },
                    { label: "Match expires", value: expires },
                ]}
            />

            <Text style={styles.paragraph}>Their site, in their words: {partner.description}</Text>

            <Text style={styles.subheading}>When it is live</Text>
            <Text style={styles.paragraph}>Tell us the page and we check it immediately:</Text>
            <CodeBlock>{`mark_link_placed matchId="${matchId}" pageUrl="https://your-site.com/the-page"`}</CodeBlock>

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app`} style={styles.button}>
                    Open your dashboard
                </Button>
            </Section>

            <Text style={styles.muted}>
                If this one no longer suits you, decline it on the dashboard. Declining is free and costs you nothing in
                standing. Letting it expire quietly is the only outcome that helps neither of you.
            </Text>
        </EmailLayout>
    );
}

export default PlacementPendingEmail;
