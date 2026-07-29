import { Button, Link, Section, Text } from "@react-email/components";

import type { Placement } from "@/lib/exchange";

import { getSiteOrigin } from "./_context";
import { EmailLayout, Facts, palette, placementLabel, relLabel, styles } from "./_layout";

/**
 * @file The result of a placement check.
 *
 * Post-agreement only, so domains and page URLs are fine here.
 *
 * Three outcomes, and the difference between the last two is the whole point of
 * the template:
 *
 *   found          the link is there, described exactly as it was found
 *   not found      we fetched the page and the link was not in the HTML
 *   inconclusive   the crawl itself failed, so we know nothing either way
 *
 * A client-rendered page legitimately fails an HTML-only fetch, so telling
 * someone their link is missing when the crawler simply could not read the page
 * is the worst mistake this system can make. `inconclusive` exists to keep that
 * from ever being phrased as an accusation.
 *
 * On a successful check the tone is descriptive, never graded. A footer link
 * and a nofollow link are reported plainly and still count. If you find
 * yourself adding "unfortunately" to this copy, that is a product decision to
 * be made deliberately, not a wording tweak.
 */

export type LinkVerifiedProps = {
    /** Which side of the trade the recipient is on. */
    direction: "given" | "received";
    /** The page checked. Safe to show: this is the giver's own page. */
    pageUrl: string;
    /** The domain the link points at. */
    targetDomain: string;
    found: boolean;
    /** True when the crawl failed, so this is not a miss. */
    inconclusive: boolean;
    placement: Placement;
    /** Parsed `rel` tokens, lowercased. */
    rel: readonly string[];
    anchorText: string | null;
    sitewide: boolean;
    /** Verifier's own plain-language message, shown verbatim. */
    message: string;
    checkedAt: Date;
};

export function LinkVerifiedEmail({
    direction,
    pageUrl,
    targetDomain,
    found,
    inconclusive,
    placement,
    rel,
    anchorText,
    sitewide,
    message,
    checkedAt,
}: LinkVerifiedProps) {
    const origin = getSiteOrigin();
    const heading = found
        ? direction === "given"
            ? "Your link is live"
            : `Your link is live on ${targetDomain}`
        : inconclusive
          ? "We could not read that page"
          : "We did not find the link yet";

    const preview = found
        ? `Verified: ${placementLabel(placement).toLowerCase()}, ${relLabel(rel)}`
        : inconclusive
          ? "The check was inconclusive, nothing is wrong yet"
          : "The link was not in the page HTML";

    return (
        <EmailLayout preview={preview}>
            <Text style={styles.heading}>{heading}</Text>

            {found ? (
                <Text style={styles.paragraph}>
                    We fetched the page and found it. Here is exactly what is there, which is the same thing your
                    partner can see.
                </Text>
            ) : inconclusive ? (
                <Text style={styles.paragraph}>
                    The page did not come back in a form we could read, so this tells us nothing about your link. Sites
                    that render in the browser often look empty to a plain HTML fetch. We will try again on the next
                    scheduled check.
                </Text>
            ) : (
                <Text style={styles.paragraph}>
                    We fetched the page and the link was not in the HTML we got back. Common and harmless reasons: the
                    page renders client side, a build has not deployed yet, or the link went on a different URL.
                </Text>
            )}

            <Facts
                rows={[
                    { label: "Status", value: found ? "Live" : inconclusive ? "Inconclusive" : "Not found yet" },
                    {
                        label: "Page",
                        value: (
                            <Link href={pageUrl} style={styles.link}>
                                {pageUrl}
                            </Link>
                        ),
                    },
                    { label: "Points at", value: targetDomain },
                    ...(found
                        ? [
                              { label: "Placement", value: placementLabel(placement) },
                              { label: "Rel", value: relLabel(rel) },
                              { label: "Anchor used", value: anchorText ?? "Not captured" },
                              ...(sitewide ? [{ label: "Scope", value: "Appears on several pages (sitewide)" }] : []),
                          ]
                        : []),
                    {
                        label: "Checked",
                        value: checkedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
                    },
                ]}
            />

            <Text style={{ ...styles.paragraph, color: palette.muted }}>{message}</Text>

            {found ? (
                <Text style={styles.muted}>
                    We recheck at day 7, day 30, then monthly, and tell both of you if it ever comes down.
                </Text>
            ) : (
                <Section style={styles.btnWrap}>
                    <Button href={`${origin}/app`} style={styles.button}>
                        Check again
                    </Button>
                </Section>
            )}
        </EmailLayout>
    );
}

export default LinkVerifiedEmail;
