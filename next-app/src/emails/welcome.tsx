import { Button, Link, Section, Text } from "@react-email/components";

import { getSiteOrigin } from "./_context";
import { CodeBlock, EmailLayout, styles } from "./_layout";

/**
 * @file The first email a member ever gets, on the request that creates their
 * member row.
 *
 * Its job is to answer "what happens now", because nothing visibly happens
 * after signing in. Someone can sign in, see a page, and have no idea that the
 * next step is submitting a site, that review is a human, or that the MCP
 * server already works without a key.
 *
 * Deliberately NOT a feature tour. Two actions, one snippet, done. This arrives
 * before the person has any context to hang a feature list on, and the
 * templates that matter (match-proposed, match-agreed) explain themselves when
 * they arrive.
 *
 * The install snippet is shown without a key on purpose. The read tools work
 * anonymously, so the server is useful before `/app/key` has ever been visited,
 * and a snippet someone can paste immediately beats one gated behind a step
 * they have not taken yet.
 */

export function WelcomeEmail() {
    const origin = getSiteOrigin();

    return (
        <EmailLayout preview="Submit a site, get matched, trade one link each">
            <Text style={styles.heading}>Welcome to the exchange</Text>

            <Text style={styles.paragraph}>
                This is a link exchange for people who build things. You list a site, we match you with another builder
                in your category, and the two of you trade one link each. No credits, no points, no leaderboard.
            </Text>

            <Text style={styles.subheading}>How it goes</Text>

            <Text style={styles.paragraph}>
                <strong>1. Submit a site.</strong> We read it and draft a listing: what it is, which category, the
                phrases you would like to be linked as. You confirm the words before anything is published.
            </Text>
            <Text style={styles.paragraph}>
                <strong>2. A person reviews it.</strong> Usually the same day. You will get an email either way, and if
                a listing is refused you are told why.
            </Text>
            <Text style={styles.paragraph}>
                <strong>3. You get matched.</strong> We look for a partner as soon as your site goes live, then weekly
                after that. Both sides stay anonymous until you both accept.
            </Text>

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/submit`} style={styles.button}>
                    Submit your first site
                </Button>
            </Section>

            <Text style={styles.subheading}>The part that saves you the most time</Text>

            <Text style={styles.paragraph}>
                The whole exchange is an MCP server, so your coding agent can do the trade from inside the repository
                where the link has to go. It can accept a match, write the link into a real page in your own words, and
                report it back for verification.
            </Text>

            <CodeBlock>{`claude mcp add --transport http builders-backlinks \\\n  ${origin}/api/mcp`}</CodeBlock>

            <Text style={styles.muted}>
                That works right now, with no key. Searching partners, browsing categories and reading the rules need no
                credentials at all. You only need a key from{" "}
                <Link href={`${origin}/app/key`} style={styles.link}>
                    {origin.replace(/^https?:\/\//, "")}/app/key
                </Link>{" "}
                once you want to submit or accept a match through the agent. Cursor, Codex and Gemini CLI setups are on{" "}
                <Link href={`${origin}/docs/mcp`} style={styles.link}>
                    the docs page
                </Link>
                .
            </Text>
        </EmailLayout>
    );
}

export default WelcomeEmail;
