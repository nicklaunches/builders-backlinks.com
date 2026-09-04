/**
 * @file `/changelog`: what shipped, for members.
 *
 * Rendered from `src/content/changelog.ts` so the page, the footer link and
 * the announcement emails that deep-link to an entry all agree on which
 * entries exist and what their anchors are. Dates are formatted here, on the
 * server, so the render and the hydration cannot disagree.
 *
 * Server component.
 */
import type { Metadata } from "next";

import { OnThisPage, PageHeader } from "@/components/web/page-header";
import { Prose, Section, Subheading } from "@/components/web/prose";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { CHANGELOG } from "@/content/changelog";

export const metadata: Metadata = {
    title: "Changelog",
    description: "What changed in the Builders Backlinks exchange, newest first, written for the members who use it.",
    alternates: { canonical: "/changelog" },
};

const SECTIONS = CHANGELOG.map((entry) => ({ href: `#${entry.slug}`, label: entry.title }));

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
});

function formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}

export default function ChangelogPage() {
    return (
        <>
            <SiteHeader />

            <main id="main">
                <PageHeader
                    eyebrow="Changelog"
                    title="What changed"
                    lede="Every release that changes what you can do in the exchange, newest first. Internal changes are in the repository's CHANGELOG.md."
                    meta={`Last release ${formatDate(CHANGELOG[0].date)}`}>
                    <OnThisPage items={SECTIONS} />
                </PageHeader>

                <div className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-16">
                    {CHANGELOG.map((entry) => (
                        <Section key={entry.slug} id={entry.slug} title={entry.title}>
                            <p className="text-muted font-mono text-[12px]">{formatDate(entry.date)}</p>
                            <Prose className="mt-4">
                                <p>{entry.summary}</p>
                            </Prose>
                            {entry.sections.map((section) => (
                                <div key={section.heading}>
                                    <Subheading>{section.heading}</Subheading>
                                    <Prose>
                                        <ul>
                                            {section.items.map((item) => (
                                                <li key={item}>{item}</li>
                                            ))}
                                        </ul>
                                    </Prose>
                                </div>
                            ))}
                        </Section>
                    ))}
                </div>
            </main>

            <SiteFooter />
        </>
    );
}
