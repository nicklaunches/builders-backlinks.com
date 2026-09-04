import { Button, Link, Section, Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { EmailLayout, Facts, styles } from "./_layout";

/**
 * @file A link that was live is no longer there.
 *
 * Sent to BOTH parties from the same data, with the wording switched by `role`.
 * Both sides being told the same thing at the same time is the design: an
 * exchange where one person quietly learns something the other does not is how
 * a trade turns into a dispute.
 *
 * ## The tone is the feature
 *
 * Links come down for ordinary reasons. A redesign, a CMS migration, a page
 * consolidated into another page, a plugin that rewrote the footer, a domain
 * moved behind a redirect. The overwhelmingly likely explanation is that nobody
 * decided anything, and this mail is written from that assumption.
 *
 * So: no "violation", no "your partner removed", no countdown, no threat about
 * standing or trust score. State what was seen, when it was last seen, and what
 * either side can do. If a member has genuinely stripped a link on purpose,
 * that shows up in their record without this email having to imply it, and
 * accusing the ninety percent who had a redesign is not worth catching the ten
 * percent who did not.
 *
 * Post-agreement, so both domains are already known to both parties.
 */

export type LinkRemovedProps = {
    /**
     * Whose page lost the link, from the recipient's point of view.
     *
     * `host` is the member whose site was hosting it. `beneficiary` is the
     * member it pointed at.
     */
    role: "host" | "beneficiary";
    matchId: string;
    /** The page the link used to be on. */
    pageUrl: string;
    /** The domain it used to point at. */
    targetDomain: string;
    /** The domain hosting the page, shown to the beneficiary. */
    hostDomain: string;
    anchorText: string | null;
    firstSeenAt: Date | null;
    /** When the recheck stopped finding it. */
    removedAt: Date;
};

function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function LinkRemovedEmail({
    role,
    matchId,
    pageUrl,
    targetDomain,
    hostDomain,
    anchorText,
    firstSeenAt,
    removedAt,
}: LinkRemovedProps) {
    const origin = getSiteOrigin();
    const isHost = role === "host";

    return (
        <EmailLayout preview={`A link we were watching is no longer on ${hostDomain}`}>
            <Text style={styles.heading}>A link came down</Text>

            {isHost ? (
                <Text style={styles.paragraph}>
                    On our latest check, the link to {targetDomain} was no longer on your page. We are telling you
                    first, before assuming anything: this is usually a redesign, a moved page, or a template change that
                    took the link with it.
                </Text>
            ) : (
                <Text style={styles.paragraph}>
                    On our latest check, the link to {targetDomain} was no longer on {hostDomain}. Most of the time this
                    is a redesign or a page that moved rather than a decision, and your partner is getting this same
                    message.
                </Text>
            )}

            <Facts
                rows={[
                    {
                        label: "Page",
                        value: (
                            <Link href={pageUrl} style={styles.link}>
                                {pageUrl}
                            </Link>
                        ),
                    },
                    { label: "Pointed at", value: targetDomain },
                    { label: "Anchor", value: anchorText ?? "Not captured" },
                    { label: "First seen", value: firstSeenAt ? formatDate(firstSeenAt) : "Not recorded" },
                    { label: "Gone as of", value: formatDate(removedAt) },
                ]}
            />

            {isHost ? (
                <>
                    <Text style={styles.paragraph}>
                        If it moved, point us at the new page and we will verify it there. Nothing else needs doing.
                    </Text>
                    <Text style={styles.paragraph}>From your agent:</Text>
                    <Text style={styles.code}>
                        {`mark_link_placed matchId="${matchId}" pageUrl="https://${hostDomain}/the-new-page"`}
                    </Text>
                    <Text style={styles.paragraph}>
                        If the page is gone for good, that is your call to make and there is nothing to reply to here.
                    </Text>
                </>
            ) : (
                <>
                    <Text style={styles.paragraph}>
                        There is nothing you need to do. Your own link is unaffected, and if it turns out the page
                        simply moved, the next check will find it again and we will tell you.
                    </Text>
                    <Text style={styles.paragraph}>
                        If you would rather sort it out directly, you already have their contact details from when you
                        matched.
                    </Text>
                </>
            )}

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app/inbox/${matchId}`} style={styles.button}>
                    See your links
                </Button>
            </Section>

            <Text style={styles.muted}>
                We keep checking either way, so if it comes back you will both hear that too.
            </Text>
        </EmailLayout>
    );
}

export default LinkRemovedEmail;
