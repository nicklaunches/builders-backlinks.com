import { Button, Section, Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { EmailLayout, styles } from "./_layout";

/**
 * @file "That match ran out of time."
 *
 * The expiry sweep in `api/cron/recheck` has always flipped stale matches to
 * `expired` and told nobody. From the member's side a partner simply vanished
 * from the dashboard, with no message before or after.
 *
 * THE USEFUL PART IS THE SECOND PARAGRAPH, not the first. Expiring returns both
 * sites to the pool and un-blocks the weekly digest, which skips any member
 * holding an open match. So the member has gone from "silently excluded from
 * matching and from the digest" to "back in both", and that is worth more to
 * them than the news that something they had forgotten is over.
 *
 * NO PARTNER IDENTITY. A match can expire from `proposed`, where the two sides
 * were never revealed to each other, so this template takes a bare category and
 * no partner at all. Do not add a domain here to make the mail warmer: one prop
 * that is populated only on some paths is how the masking boundary gets breached
 * by accident.
 */

export type MatchExpiredProps = {
    /** The category the pairing came from. Safe at every state. */
    category: string;
    /** True when the pair had reached mutual agreement before it lapsed. */
    wasAgreed: boolean;
};

export function MatchExpiredEmail({ category, wasAgreed }: MatchExpiredProps) {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview="A match expired, and you are back in the pool">
            <Text style={styles.heading}>That match expired</Text>

            <Text style={styles.paragraph}>
                {wasAgreed
                    ? `You and another ${category} site agreed to trade links, but the links never both went live, so the match has lapsed.`
                    : `A ${category} match sat unanswered long enough to lapse.`}
            </Text>

            <Text style={styles.paragraph}>
                Nothing is lost. Both sites went straight back into the matching pool, so you can be paired again from
                now on, and the weekly digest starts reaching you again. It pauses while you are holding an open match,
                which is why you may not have heard from us in a while.
            </Text>

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app`} style={styles.button}>
                    Open your dashboard
                </Button>
            </Section>

            <Text style={styles.muted}>
                Any link you did place stays exactly where it is. We keep checking it, and it still counts toward what
                you have given.
            </Text>
        </EmailLayout>
    );
}

export default MatchExpiredEmail;
