import { Button, Section, Text } from "@react-email/components";

import type { Category } from "@/lib/categories";

import { getSiteOrigin } from "./_context";
import { EmailLayout, Facts, styles } from "./_layout";

/**
 * @file A listing passed review and can now be matched.
 *
 * This is the moment the product actually starts for someone, so it says what
 * happens next rather than congratulating them.
 *
 * Deliberately makes NO claim about whether a match was found. Approving runs
 * `autoPair` immediately, which either finds a partner or does not, and it
 * sends its own email when it does. Promising a match here and having
 * `match-proposed` fail to arrive would be worse than saying nothing, so the
 * copy commits only to what is certain: the site is now visible to matching,
 * and the pool is re-swept weekly.
 *
 * Category depth is why the honest version matters. A category with one other
 * builder in it can take weeks, and a member who was told "you will be matched"
 * reads that silence as the product being broken rather than the pool being
 * thin.
 */

export type SiteApprovedProps = {
    domain: string;
    category: Category;
};

export function SiteApprovedEmail({ domain, category }: SiteApprovedProps) {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview={`${domain} is live and can be matched`}>
            <Text style={styles.heading}>{domain} is live</Text>

            <Text style={styles.paragraph}>
                Review is done and your listing is in the exchange. It is now visible to matching, counts toward the
                depth of its category, and can appear as a candidate in other builders&apos; weekly digests.
            </Text>

            <Facts
                rows={[
                    { label: "Site", value: domain },
                    { label: "Category", value: category },
                    { label: "Status", value: "Active" },
                ]}
            />

            <Text style={styles.subheading}>What happens now</Text>

            <Text style={styles.paragraph}>
                We look for a partner straight away, then re-sweep the pool every week. If we find someone in your
                category you will get a separate email with a masked profile: you will see what the site is about and
                how strong it is, but not who it is, and neither will they. Identities unlock only when you both accept.
            </Text>

            <Text style={styles.paragraph}>
                How long that takes depends entirely on how many other builders are listed in {category}. A thin
                category can be quiet for a while. That is the pool being small, not something being broken.
            </Text>

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/docs/mcp`} style={styles.button}>
                    Trade from your agent
                </Button>
            </Section>

            <Text style={styles.muted}>
                When a match does arrive, `list_matches` and `respond_to_match` let your coding agent handle it from
                inside the repository, which is where the link has to be written anyway.
            </Text>
        </EmailLayout>
    );
}

export default SiteApprovedEmail;
