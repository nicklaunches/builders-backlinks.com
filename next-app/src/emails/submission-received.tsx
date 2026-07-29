import { Text } from "@react-email/components";

import type { Category } from "@/lib/categories";
import type { PlacementOffer } from "@/lib/exchange";

import { EmailLayout, Facts, drLabel, palette, placementOfferLabel, styles } from "./_layout";

/**
 * @file Acknowledges a submission and shows back what we understood.
 *
 * Two jobs, and the second is the important one.
 *
 * The obvious job is closing the silence. Before this existed, submitting put a
 * site into `pending_review` and the member heard nothing at all until a
 * stranger got matched to them, which could be days. "We have it" is worth an
 * email on its own.
 *
 * The real job is showing the LISTING BACK. The description and category are
 * drafted by a model reading the site, and that draft is what strangers use to
 * decide whether to trade with them. A wrong category is the difference between
 * being matched and never being matched at all. Putting the analysis in front of
 * the member while it is still in review is the cheapest possible moment to
 * catch it, and much cheaper than discovering it after a bad match.
 *
 * So this template is mostly a `Facts` block, and the copy exists to make
 * someone actually read it.
 */

export type SubmissionReceivedProps = {
    domain: string;
    category: Category;
    /** The listing description, as drafted or as the member rewrote it. */
    description: string;
    /** Anchor phrases the member wants to be linked as. */
    keywords: readonly string[];
    domainRating: number | null;
    placementOffered: PlacementOffer;
};

export function SubmissionReceivedEmail({
    domain,
    category,
    description,
    keywords,
    domainRating,
    placementOffered,
}: SubmissionReceivedProps) {
    return (
        <EmailLayout preview={`${domain} is in review`}>
            <Text style={styles.heading}>We have {domain}</Text>

            <Text style={styles.paragraph}>
                It is in review now. A person reads every listing before it goes live, usually the same day. You will
                get an email either way, and nothing is matched or shown publicly until it is approved.
            </Text>

            <Text style={styles.subheading}>What we will show partners</Text>

            <Text style={styles.paragraph}>
                This is the listing other builders see when deciding whether to trade with you. Worth thirty seconds
                now: the category in particular decides who you get matched with, and a wrong one is the difference
                between good matches and none.
            </Text>

            <Facts
                rows={[
                    { label: "Site", value: domain },
                    { label: "Category", value: category },
                    { label: "Domain Rating", value: drLabel(domainRating) },
                    { label: "Offering", value: placementOfferLabel(placementOffered) },
                    { label: "Anchor phrases", value: keywords.join(", ") || "None given" },
                ]}
            />

            <Text style={{ ...styles.paragraph, color: palette.muted }}>{description}</Text>

            <Text style={styles.muted}>
                If any of that misreads the site, reply to this email and say what is wrong. Fixing it before review is
                a minute; fixing it after you have been matched on the wrong category is not.
            </Text>
        </EmailLayout>
    );
}

export default SubmissionReceivedEmail;
