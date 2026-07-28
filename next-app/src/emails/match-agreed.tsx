import { Button, Link, Section, Text } from "@react-email/components";

import type { RevealedPartner } from "@/lib/contracts";
import type { LinkBrief } from "@/lib/services/links";

import { getSiteOrigin } from "./_context";
import { CodeBlock, EmailLayout, Facts, drLabel, placementOfferLabel, styles } from "./_layout";

/**
 * @file "Both of you accepted", the one message that reveals an identity.
 *
 * This is the first and only point at which a partner's domain, URL, and email
 * may appear in mail, and it is safe here for one reason: the reveal is mutual
 * and simultaneous. The partner is receiving the same message about the
 * recipient at the same time. Both consented by accepting.
 *
 * The prop type is `RevealedPartner`, which `toRevealedPartner` refuses to
 * build for a match that has not reached `agreed`. So the guarantee is not "the
 * caller remembered to check the state", it is "this type could not have been
 * constructed otherwise". Keep it that way: do not add a props shape that lets
 * a caller pass a domain string alongside a `MaskedPartner`.
 *
 * The brief is included in full rather than linked to. The recipient is often
 * an agent, or a person about to paste this into one, and every hop between
 * reading the mail and having the anchor list in hand is a hop where an agreed
 * trade quietly dies.
 */

export type MatchAgreedProps = {
    matchId: string;
    /** Revealed only because both sides accepted. See the file header. */
    partner: RevealedPartner;
    /** The placement brief, as `get_link_brief` would return it. */
    brief: LinkBrief;
};

export function MatchAgreedEmail({ matchId, partner, brief }: MatchAgreedProps) {
    const origin = getSiteOrigin();
    const anchors = brief.anchorOptions.length > 0 ? brief.anchorOptions : partner.wantedAnchors.slice(0, 4);

    return (
        <EmailLayout preview={`You are trading links with ${partner.domain}`}>
            <Text style={styles.heading}>You both accepted</Text>
            <Text style={styles.paragraph}>
                Here is who you matched with. They received the same message about you at the same moment, so you are
                both looking at each other now.
            </Text>

            <Facts
                rows={[
                    {
                        label: "Partner",
                        value: (
                            <Link href={partner.url} style={styles.link}>
                                {partner.domain}
                            </Link>
                        ),
                    },
                    {
                        label: "Contact",
                        value: (
                            <Link href={`mailto:${partner.email}`} style={styles.link}>
                                {partner.email}
                            </Link>
                        ),
                    },
                    { label: "Category", value: partner.category },
                    { label: "Domain Rating", value: drLabel(partner.domainRating) },
                    { label: "They are offering", value: placementOfferLabel(partner.placementOffered) },
                ]}
            />

            <Text style={styles.subheading}>The link you owe</Text>
            <Facts
                rows={[
                    {
                        label: "Point it at",
                        value: (
                            <Link href={brief.targetUrl} style={styles.link}>
                                {brief.targetUrl}
                            </Link>
                        ),
                    },
                    { label: "Anchor options", value: anchors.length > 0 ? anchors.join(", ") : "Your own wording" },
                ]}
            />
            <Text style={styles.paragraph}>
                Pick one of those anchors or write your own. Their site, in their words: {brief.partnerDescription}
            </Text>

            <Text style={styles.subheading}>Ready to paste</Text>
            <CodeBlock>{brief.snippet}</CodeBlock>

            <Text style={styles.subheading}>Placement guidance</Text>
            {brief.guidance.map((line) => (
                <Text key={line} style={styles.listItem}>
                    {line}
                </Text>
            ))}

            <Text style={styles.subheading}>When it is live</Text>
            <Text style={styles.paragraph}>Tell us the page and we check it immediately:</Text>
            <CodeBlock>{`mark_link_placed matchId="${matchId}" pageUrl="https://your-site.com/the-page"`}</CodeBlock>
            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app`} style={styles.button}>
                    Open your dashboard
                </Button>
            </Section>

            <Text style={styles.muted}>
                Whatever you place is reported to both of you exactly as it is found, including where on the page it
                sits and whether it is dofollow. That is disclosure, not a rule: all of it counts.
            </Text>
        </EmailLayout>
    );
}

export default MatchAgreedEmail;
