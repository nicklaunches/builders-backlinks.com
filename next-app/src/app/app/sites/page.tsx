import type { Metadata } from "next";

import { Empty, PageFrame, Section, SignInPrompt } from "@/app/app/ui";
import { cn } from "@/components/web/cn";
import { listMySites } from "@/lib/services/sites";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app/sites`, every site the member has listed.
 *
 * A list and a link to `/submit`. Editing a listing is not a thing the product
 * does yet; a site is analysed on submission and that is its record.
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
                        <ul className="border-line grid gap-px overflow-hidden rounded-sm border">
                            {sites.map((site) => (
                                <li
                                    key={site.id}
                                    className="bg-surface flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
                                    <span className="text-[15px] font-medium">{site.domain}</span>
                                    <span className="text-muted text-[13.5px]">{site.category}</span>
                                    <span
                                        className={cn(
                                            "rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase",
                                            site.status === "active"
                                                ? "border-term-ok/40 bg-term-ok/10 text-term-ok"
                                                : "border-line text-muted bg-surface-2",
                                        )}>
                                        {site.status.replace(/_/g, " ")}
                                    </span>
                                    <span className="text-muted ml-auto font-mono text-[11.5px]">
                                        {site.linksGiven} given · {site.linksGot} received
                                    </span>
                                </li>
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
