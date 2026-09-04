import { Button, Link, Section, Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { EmailLayout, styles } from "./_layout";

/**
 * @file The one-off announcement of the inbox and the rebuilt dashboard.
 *
 * Sent once, on 2026-09-04, to every member who had not opted out, by
 * `scripts/announce-dashboard-update.ts`. It stays in the tree as the record of
 * what was said, and so `pnpm emails:render` keeps a preview of it.
 *
 * It is also the notice the privacy page promises: GA4 started collecting with
 * this release, and members were told they would be emailed when data started
 * going somewhere new. The closing paragraph is that notice, so it must not be
 * trimmed for length.
 *
 * No props. Everything here is the same for every recipient, and the
 * per-recipient unsubscribe link comes from `EmailLayout` via the send context.
 */

export function DashboardUpdateEmail() {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview="Every match now has a conversation, and the dashboard shows what needs you.">
            <Text style={styles.heading}>Your exchange now has an inbox</Text>

            <Text style={styles.paragraph}>
                Until now, two builders could accept each other and then had nowhere in the product to agree which page
                either link was going on. Every match is now a thread. Once you both accept, you can talk, agree the
                pages, report each placement and watch it verify, all in one place.
            </Text>

            <Text style={styles.subheading}>What changed</Text>

            <Text style={styles.listItem}>
                <strong>Inbox.</strong> A thread per match, with a four-step rail (Decide, Agree, Add links, Live), a
                suggested opening message, and a copy-ready link snippet in HTML, Markdown, MDX or JSX. Placement is
                reported from the thread and verified on the spot.
            </Text>
            <Text style={styles.listItem}>
                <strong>Overview.</strong> The dashboard now opens with your standing, three numbers, and a “Needs you”
                list of only the threads waiting on you, each saying why.
            </Text>
            <Text style={styles.listItem}>
                <strong>Sites.</strong> A tab listing every site you have submitted, with its status and a
                given/received count.
            </Text>
            <Text style={styles.listItem}>
                <strong>Agents.</strong> Two new MCP tools, list_messages and send_message, so your coding agent can
                read and write the same thread, under the same rule: nothing before both sides accept.
            </Text>
            <Text style={styles.listItem}>
                <strong>Quieter email.</strong> When a partner writes, you get their words, not a summary, and at most
                one such email per thread every few hours.
            </Text>

            <Section style={styles.btnWrap}>
                <Button style={styles.button} href={`${origin}/app/inbox`}>
                    Open your inbox
                </Button>
            </Section>

            <Text style={styles.paragraph}>
                The full list, including the fixes, is on the{" "}
                <Link href={`${origin}/changelog`} style={styles.link}>
                    changelog
                </Link>
                .
            </Text>

            <Text style={styles.muted}>
                One more thing, because we said we would tell you. The site now uses Google Analytics alongside
                Cloudflare Web Analytics. It records page views and five product events (submitting a site, issuing a
                key, accepting, declining, sending a message), never a domain, an email address or the text of a
                message. It sets cookies, and the{" "}
                <Link href={`${origin}/privacy`} style={styles.link}>
                    privacy notice
                </Link>{" "}
                now says so.
            </Text>

            <Text style={styles.muted}>
                You are getting this once, because you have a site in the exchange. There is no newsletter to follow it.
            </Text>
        </EmailLayout>
    );
}

export default DashboardUpdateEmail;
