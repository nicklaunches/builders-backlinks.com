import { Button, Section, Text } from "@react-email/components";

import type { MaskedPartner } from "@/lib/contracts";
import { timeLeft } from "@/lib/exchange";

import { getSiteOrigin } from "./_context";
import { CodeBlock, EmailLayout, Facts, drLabel, palette, placementOfferLabel, styles } from "./_layout";

/**
 * @file "A DR 40 site accepted your match, 12 days left", sent to the side that
 * has not answered yet.
 *
 * Two sends share this template. `respondToMatch` sends it the moment the first
 * side accepts, and the recheck cron sends it once more as the last call when
 * under 48 hours remain. One template so the two cannot drift; `lastCall` only
 * changes the words around the countdown.
 *
 * A specific person waiting moves people faster than a generic reminder, which
 * is why the DR leads the subject and the heading. It is the most concrete fact
 * we may show before the reveal.
 *
 * THIS TEMPLATE IS ON THE MASKED SIDE OF THE IDENTITY BOUNDARY, exactly like
 * `match-proposed.tsx`: the recipient has not accepted, so nothing here may
 * carry the partner's domain, URL or email. The prop is a `MaskedPartner` for
 * that reason. Read that file's header before widening it.
 */

export type MatchWaitingProps = {
    /** Match id, quoted so an agent can act on it straight from the mail. */
    matchId: string;
    /** The side that accepted, masked. */
    partner: MaskedPartner;
    expiresAt: Date;
    /** The send time. The subject is computed from the same instant, so the two agree. */
    now: Date;
    /** The cron's final reminder rather than the send on accept. */
    lastCall?: boolean;
};

/**
 * "A DR 40 site", or "An Analytics site" when the DR is unknown. Never "DR null".
 *
 * The article goes by sound, so the acronyms read aloud with a vowel ("an SEO
 * site", "an HR & Recruiting site") are listed with the vowel-initial names.
 */
export function waitingPartnerPhrase(partner: MaskedPartner): string {
    if (partner.domainRating !== null) return `A DR ${partner.domainRating} site`;
    if (partner.category === "Other") return "A site";
    const article = /^([AEIOU]|SEO|HR)/.test(partner.category) ? "An" : "A";
    return `${article} ${partner.category} site`;
}

function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function MatchWaitingEmail({ matchId, partner, expiresAt, now, lastCall = false }: MatchWaitingProps) {
    const origin = getSiteOrigin();
    const who = waitingPartnerPhrase(partner);
    const left = timeLeft(expiresAt, now);

    return (
        <EmailLayout preview={`${who} accepted. ${left} to answer.`}>
            <Text style={styles.heading}>
                {lastCall ? `${who} is still waiting on you` : `${who} accepted your match`}
            </Text>

            <Section style={clock}>
                <Text style={clockBig}>{left}</Text>
                <Text style={clockSmall}>Open until {formatDate(expiresAt)}</Text>
            </Section>

            <Text style={styles.paragraph}>
                {lastCall
                    ? "They accepted and are still waiting for your answer. Accept and you are both revealed right away. If you don't, the match lapses and both sites go back into the pool."
                    : "They said yes. Neither of you knows who the other is yet. Accept too, and you both see each other's domain at the same moment, with the link brief."}
            </Text>

            <Facts
                rows={[
                    { label: "Category", value: partner.category },
                    { label: "Domain Rating", value: drLabel(partner.domainRating) },
                    { label: "They can offer", value: placementOfferLabel(partner.placementOffered) },
                    { label: "Track record", value: `${partner.linksGiven} given, ${partner.linksGot} received` },
                ]}
            />

            <Section style={styles.btnWrap}>
                <Button href={`${origin}/app/inbox/${matchId}`} style={styles.button}>
                    Review and accept
                </Button>
            </Section>

            <Text style={styles.subheading}>Or from your agent</Text>
            <CodeBlock>{`respond_to_match matchId="${matchId}" accept=true`}</CodeBlock>

            <Text style={styles.muted}>
                {lastCall
                    ? "This is the only reminder we send about this match."
                    : `If you do nothing, the match expires on ${formatDate(expiresAt)} and both sites go back into the pool. Declining costs you nothing.`}
            </Text>
        </EmailLayout>
    );
}

const clock = {
    backgroundColor: palette.accentSoft,
    borderRadius: "10px",
    padding: "16px 18px",
    margin: "0 0 20px",
};

const clockBig = {
    ...styles.heading,
    fontSize: "26px",
    lineHeight: "32px",
    color: palette.accentFg,
    margin: 0,
};

const clockSmall = {
    ...styles.muted,
    fontSize: "13px",
    lineHeight: "20px",
    color: palette.accentText,
    margin: 0,
};

export default MatchWaitingEmail;
