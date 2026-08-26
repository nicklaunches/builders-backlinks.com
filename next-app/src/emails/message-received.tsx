import { Button, Section, Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { EmailLayout, palette, styles } from "./_layout";

/**
 * @file A partner replied in a thread.
 *
 * Post-agreement only. Messages do not exist before that, so naming the sender's
 * domain here is safe by construction rather than by care.
 *
 * QUOTES, IT DOES NOT SUMMARISE. The excerpt is the partner's own words, capped
 * and never rewritten: the whole value of this email is letting someone decide
 * from the inbox whether the reply needs them today, and a paraphrase makes that
 * call impossible. It is also why there is no "you have 3 new messages" variant.
 * The throttle in `lib/inbox.ts` means one of these can stand for several
 * replies, which the closing line says out loud.
 */

export type MessageReceivedProps = {
    matchId: string;
    /** The sender's domain. Revealed by the time any message can exist. */
    senderDomain: string;
    /** The recipient's own site, so the subject line has a side to be on. */
    recipientDomain: string;
    /** The message body, already trimmed to an excerpt by the notifier. */
    excerpt: string;
    /** True when the body was longer than the excerpt shows. */
    truncated: boolean;
};

export function MessageReceivedEmail({
    matchId,
    senderDomain,
    recipientDomain,
    excerpt,
    truncated,
}: MessageReceivedProps) {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview={`${senderDomain} replied about the exchange with ${recipientDomain}`}>
            <Text style={styles.heading}>{senderDomain} replied</Text>

            <Text style={styles.paragraph}>
                A new message in your exchange thread with {senderDomain}. Everything about this trade — the links, the
                verification, the conversation — lives on one page.
            </Text>

            <Section
                style={{
                    borderLeft: `3px solid ${palette.accent}`,
                    backgroundColor: palette.surface,
                    padding: "12px 16px",
                    margin: "0 0 20px",
                }}>
                <Text style={{ ...styles.paragraph, margin: 0, whiteSpace: "pre-wrap" }}>
                    {excerpt}
                    {truncated ? "…" : ""}
                </Text>
            </Section>

            <Button style={styles.button} href={`${origin}/app/inbox/${matchId}`}>
                Open the thread
            </Button>

            <Text style={{ ...styles.muted, marginTop: "20px" }}>
                We send at most one of these per thread every few hours, so there may be more than one reply waiting.
                Replying on the site is what the other builder sees.
            </Text>
        </EmailLayout>
    );
}

export default MessageReceivedEmail;
