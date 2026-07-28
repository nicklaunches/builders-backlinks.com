import { Button, Hr, Section, Text } from "@react-email/components";

import type { Category } from "@/lib/categories";
import type { MaskedPartner } from "@/lib/contracts";

import { getSiteOrigin } from "./_context";
import { CodeBlock, EmailLayout, drLabel, palette, placementOfferLabel, styles } from "./_layout";

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
 * `partnerId` is safe to print: it is an opaque site id whose only use is as an
 * argument to `propose_trade`, and it reveals nothing on its own.
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
            <Text style={{ ...styles.muted, margin: "0 0 4px" }}>
                Can offer: {placementOfferLabel(partner.placementOffered)}
            </Text>
            {anchors.length > 0 ? (
                <Text style={{ ...styles.muted, margin: "0 0 8px" }}>Wants anchors: {anchors.join(", ")}</Text>
            ) : null}
            <Text style={{ ...styles.mono, color: palette.muted, margin: 0 }}>
                propose_trade partnerId=&quot;{partner.partnerId}&quot;
            </Text>
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

            <Text style={styles.subheading}>To start one</Text>
            <Text style={styles.paragraph}>Ask your agent, using the id under any row above:</Text>
            <CodeBlock>{`propose_trade partnerId="${candidates[0].partnerId}"`}</CodeBlock>
            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app`} style={styles.button}>
                    Browse in the dashboard
                </Button>
            </Section>

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
