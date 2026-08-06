import { Button, Hr, Section, Text } from "@react-email/components";

import type { Category } from "@/lib/categories";
import type { MaskedPartner } from "@/lib/contracts";

import { getSiteOrigin } from "./_context";
import { EmailLayout, drLabel, palette, placementOfferLabel, styles } from "./_layout";

/**
 * @file The weekly digest: who is available to trade with right now.
 *
 * THIS TEMPLATE IS ON THE MASKED SIDE OF THE IDENTITY BOUNDARY, and it is the
 * riskiest one, because it renders a LIST. A single template bug here does not
 * leak one identity, it leaks a page of them into a page of inboxes, where it
 * cannot be recalled. Everything in the row below is drawn from `MaskedPartner`,
 * which has no `domain`, `url`, or `email` field to interpolate by mistake.
 *
 * Do not widen `candidates` to site documents. The tempting version of that
 * change is "pass the docs and pick the safe fields off them", which works
 * exactly until the day someone adds a favicon to the row.
 *
 * `partnerId` IS NOT PRINTED, and that is a correction rather than a style
 * choice. Every row used to end with `propose_trade partnerId="<uuid>"`, and the
 * primary call to action was the same string in a code block. No such tool has
 * ever existed: the only writer of `exchange_matches` is `upsertMatch`, called
 * only by `autoPair`, which is reached only from `setSiteStatus` on approval and
 * from the daily re-pair pass in `api/cron/recheck`. Both are server-initiated,
 * so there was nothing a member could do with a candidate, and this email spent
 * its most prominent line telling them to do it anyway. A member reported it
 * publicly on 2026-08-03 after pasting the line into an agent and getting
 * nowhere.
 *
 * The id itself is still safe to print — it is opaque and decodes to nothing —
 * but an argument to a call that does not exist is worse than no argument at
 * all, so a row now ends at the anchors. See issue #18: if `propose_trade` is
 * ever built, this is where the id goes back.
 *
 * The empty case is a real case, not an error. Matching reports "you are first
 * in this category" honestly rather than sending a blank list, because an
 * unexplained empty digest is the most reliable way to lose a member in week
 * one.
 */

export type DigestProps = {
    /** The member's category, which is the pool these candidates came from. */
    category: Category;
    /** Up to N masked candidates. See the file header before changing this type. */
    candidates: readonly MaskedPartner[];
    /** How many of these rows came from an adjacent category. */
    widenedCount?: number;
    /** One line about the member's give/get standing, from `getStanding`. */
    standingNote?: string;
};

function CandidateRow({ partner, index }: { partner: MaskedPartner; index: number }) {
    const anchors = partner.wantedAnchors.slice(0, 4);
    return (
        <Section style={styles.card}>
            <Text style={{ ...styles.listItem, fontWeight: 600, margin: "0 0 6px" }}>
                {index + 1}. {partner.category}
                <span style={{ color: palette.muted, fontWeight: 400 }}>
                    {"  ·  "}DR {drLabel(partner.domainRating)}
                    {"  ·  "}
                    {partner.linksGiven} given / {partner.linksGot} received
                </span>
            </Text>
            <Text style={{ ...styles.listItem, margin: "0 0 6px" }}>{partner.description}</Text>
            {/* The row used to end in a mono `propose_trade` line, so every
                block above it carried a bottom margin. Now that whichever of
                these lands last IS the last thing in the card, the final one
                has to drop its margin or the card gains 4px of dead space. */}
            <Text style={{ ...styles.muted, margin: anchors.length > 0 ? "0 0 4px" : 0 }}>
                Can offer: {placementOfferLabel(partner.placementOffered)}
            </Text>
            {anchors.length > 0 ? (
                <Text style={{ ...styles.muted, margin: 0 }}>Wants anchors: {anchors.join(", ")}</Text>
            ) : null}
        </Section>
    );
}

export function DigestEmail({ category, candidates, widenedCount = 0, standingNote }: DigestProps) {
    const origin = getSiteOrigin();
    const count = candidates.length;

    if (count === 0) {
        return (
            <EmailLayout preview={`Nothing in ${category} to trade with yet`}>
                <Text style={styles.heading}>Nothing new in {category} this week</Text>
                <Text style={styles.paragraph}>
                    There is no one available in your category right now. That is not a fault in your listing: you are
                    early here, which means the next site that joins in {category} gets matched with you immediately.
                </Text>
                <Text style={styles.paragraph}>Nothing to do. We will mail you the moment there is someone.</Text>
                <Section style={styles.btnWrap}>
                    <Button href={`${origin}/app`} style={styles.button}>
                        Open your dashboard
                    </Button>
                </Section>
            </EmailLayout>
        );
    }

    return (
        <EmailLayout preview={`${count} ${category} site${count === 1 ? "" : "s"} available to trade with`}>
            <Text style={styles.heading}>
                {count} site{count === 1 ? "" : "s"} you could trade with
            </Text>
            <Text style={styles.paragraph}>
                Everyone below is listed in {category} or next to it, and is open to an exchange. You are seeing what
                they do, not who they are: names are exchanged only after you have both accepted.
            </Text>
            {widenedCount > 0 ? (
                <Text style={styles.muted}>
                    {widenedCount} of these {widenedCount === 1 ? "is" : "are"} from an adjacent category, because{" "}
                    {category} is still thin.
                </Text>
            ) : null}

            {candidates.map((partner, index) => (
                <CandidateRow key={partner.partnerId} partner={partner} index={index} />
            ))}

            <Text style={styles.subheading}>How a match starts</Text>
            <Text style={styles.paragraph}>
                We pair you, you do not pick. We look for the best partner for a site the moment it is approved, and
                again every day for anyone not currently in a match, so the sites above are the pool you are being
                matched against right now. When one of them becomes your match you get a separate email with a match id,
                and you accept or decline it from your agent or the dashboard.
            </Text>
            <Text style={styles.paragraph}>
                So there is nothing to answer here. This is the pool, sent so you can see it is not empty.
            </Text>
            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app`} style={styles.button}>
                    Open your dashboard
                </Button>
            </Section>
            <Text style={styles.muted}>Your sites, the links you have placed, and what is owed back to you.</Text>

            {standingNote ? (
                <>
                    <Hr style={styles.hr} />
                    <Text style={styles.muted}>{standingNote}</Text>
                </>
            ) : null}
        </EmailLayout>
    );
}

export default DigestEmail;
