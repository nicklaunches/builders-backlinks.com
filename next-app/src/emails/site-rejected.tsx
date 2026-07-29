import { Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { EmailLayout, Facts, palette, styles } from "./_layout";

/**
 * @file A listing did not pass review.
 *
 * The hardest email here to get right, because it goes to someone who did work
 * and is being told no.
 *
 * `/terms` section 4 makes two commitments this template has to keep. First,
 * "if your site is refused you will be told why", so the reason is the body of
 * the email rather than a line at the bottom, and a rejection recorded without
 * a note still says plainly that no reason was given rather than inventing one.
 * Second, "a wrong rejection is a bug and we would rather hear about it than
 * lose a real site", so it says exactly that.
 *
 * Inviting a challenge is NOT the same as inviting an argument, and the
 * difference is in the framing: this points at fixing the cause, and mentions
 * disagreement once, plainly, without softening the decision into something
 * negotiable. It does not apologise, does not say "unfortunately", and does not
 * pad the refusal with encouragement. Someone reading a no wants the reason and
 * the route back, not consolation.
 *
 * Nothing is deleted on rejection, which the copy says because it is both true
 * and the thing that makes resubmitting feel worth doing.
 */

export type SiteRejectedProps = {
    domain: string;
    /** The admin's `review_note`. Null when the rejection was recorded without one. */
    reason: string | null;
};

export function SiteRejectedEmail({ domain, reason }: SiteRejectedProps) {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview={`${domain} was not listed`}>
            <Text style={styles.heading}>We did not list {domain}</Text>

            <Text style={styles.paragraph}>
                A person read the listing and decided it is not a fit for the exchange right now. Here is why.
            </Text>

            {reason ? (
                <Text style={{ ...styles.paragraph, color: palette.muted }}>{reason}</Text>
            ) : (
                <Text style={{ ...styles.paragraph, color: palette.muted }}>
                    No reason was recorded, which is our mistake rather than yours. Reply to this email and we will tell
                    you what happened.
                </Text>
            )}

            <Facts
                rows={[
                    { label: "Site", value: domain },
                    { label: "Status", value: "Rejected" },
                    { label: "Your data", value: "Kept, nothing deleted" },
                ]}
            />

            <Text style={styles.paragraph}>
                A rejected site simply stops being matched. The listing stays where it is, so if the cause is something
                you can change, fix it and submit the domain again at {origin.replace(/^https?:\/\//, "")}/submit.
            </Text>

            <Text style={styles.muted}>
                If you think this is wrong, say so. A wrong rejection is a bug, and we would rather hear about it than
                lose a real site over a bad call.
            </Text>
        </EmailLayout>
    );
}

export default SiteRejectedEmail;
