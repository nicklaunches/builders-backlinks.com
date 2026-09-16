import type { Metadata } from "next";

import { SiteCard } from "@/app/app/sites/site-card";
import { Empty, PageFrame, Section, SignInPrompt } from "@/app/app/ui";
import { poolCurveFor } from "@/lib/services/matches";
import { listMySites } from "@/lib/services/sites";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app/sites`, every site the member has listed.
 *
 * A list, a link to `/submit`, and the one edit the product allows: who each
 * site is willing to be matched with. The listing itself is still fixed at
 * submission — the description and category were written to be shown to
 * strangers and re-open the review question, while a floor changes nothing
 * about how the site is presented.
 *
 * Each row is closed until asked, with its floor on the row; `site-card.tsx`
 * holds that and the editor behind it.
 *
 * The pool is counted per site, before render, so the control can answer as the
 * member moves the number the moment a row is opened. One extra query per
 * listed site, capped at ten by `MAX_SITES_PER_MEMBER`.
 */

export const metadata: Metadata = {
    title: "Your sites",
    description: "The sites you have listed in the exchange.",
    alternates: { canonical: "/app/sites" },
    robots: { index: false, follow: false },
};

/** Session-dependent, and must never be cached. */
export const dynamic = "force-dynamic";

export default async function SitesPage() {
    const member = await getSessionMember();

    if (!member) {
        return (
            <PageFrame title="Your sites">
                <SignInPrompt
                    callbackUrl="/app/sites"
                    title="Sign in to see your sites"
                    body="The sites you have listed, their status in the exchange, and the links each has given and received."
                />
            </PageFrame>
        );
    }

    const sites = await listMySites(member);
    const curves = await Promise.all(sites.map((site) => poolCurveFor(site)));

    return (
        <PageFrame title="Your sites">
            <Section title="Listed" count={sites.length}>
                {sites.length === 0 ? (
                    <Empty>
                        Nothing listed yet.{" "}
                        <a href="/submit" className="text-accent-text underline underline-offset-4">
                            Submit a site
                        </a>{" "}
                        to get started.
                    </Empty>
                ) : (
                    <>
                        <ul className="space-y-3">
                            {sites.map((site, index) => (
                                <SiteCard
                                    key={site.id}
                                    site={{
                                        id: site.id,
                                        domain: site.domain,
                                        category: site.category,
                                        status: site.status,
                                        domainRating: site.domainRating,
                                        linksGiven: site.linksGiven,
                                        linksGot: site.linksGot,
                                        minPartnerDr: site.minPartnerDr,
                                        skipUnrated: site.skipUnrated,
                                    }}
                                    curve={curves[index]!}
                                />
                            ))}
                        </ul>
                        <p className="text-muted mt-3 text-[13.5px]">
                            <a href="/submit" className="text-accent-text underline underline-offset-4">
                                Submit another site
                            </a>
                        </p>
                    </>
                )}
            </Section>
        </PageFrame>
    );
}
