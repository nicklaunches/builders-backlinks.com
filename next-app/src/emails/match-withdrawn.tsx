import { Button, Section, Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { EmailLayout, styles } from "./_layout";

/**
 * @file "They pulled out, and here is what that costs you: nothing."
 *
 * A withdrawal is the only way an agreed exchange ends before a link exists,
 * and the member on this side has already been told who their partner is and
 * has possibly started writing. They have to hear it from us rather than from
 * the silence, and they have to hear the two facts that decide what they do
 * next: nothing is owed either way, and they are back in the pool tonight.
 *
 * THE REASON IS QUOTED, NOT SUMMARISED, and it is optional in both directions.
 * It is free text somebody typed about a person who is reading this, so it goes
 * in as they wrote it and the mail says whose words they are.
 *
 * Post-agreement only, so the withdrawing domain is already known to this
 * reader and naming it breaches nothing.
 */

export type MatchWithdrawnProps = {
    /** The domain of the member who withdrew. Revealed to this reader already. */
    withdrawnBy: string;
    /** What they typed, verbatim, or null when they said nothing. */
    reason: string | null;
};

export function MatchWithdrawnEmail({ withdrawnBy, reason }: MatchWithdrawnProps) {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview="An exchange was withdrawn, and you are back in the pool">
            <Text style={styles.heading}>{withdrawnBy} withdrew from your exchange</Text>

            <Text style={styles.paragraph}>
                They agreed and have now pulled out. No link had gone live on either side, so nothing is owed in either
                direction and there is nothing for you to undo.
            </Text>

            {reason ? (
                <Section style={styles.card}>
                    <Text style={styles.paragraph}>&ldquo;{reason}&rdquo;</Text>
                    <Text style={{ ...styles.muted, margin: 0 }}>Their words, when they withdrew.</Text>
                </Section>
            ) : null}

            <Text style={styles.paragraph}>
                Your site went straight back into the matching pool. The nightly pass will look for someone new, and the
                weekly digest starts reaching you again &mdash; it pauses while you are holding an open match, which is
                why it had gone quiet.
            </Text>

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app/inbox`} style={styles.button}>
                    Open your inbox
                </Button>
            </Section>

            <Text style={styles.muted}>
                We will not pair the two of you again. If you had already drafted something around their link, that work
                is still good for whoever comes next.
            </Text>
        </EmailLayout>
    );
}

export default MatchWithdrawnEmail;
