import type { Metadata } from "next";

import { PageFrame, Section } from "@/app/app/ui";
import { CHANGELOG, CURRENT_VERSION } from "@/content/changelog";

/**
 * @file `/app/changelog`, the signed-in view of what shipped.
 *
 * Same entries as the public `/changelog`, rendered tighter and without the
 * marketing chrome: a member who is already inside should not be bounced out of
 * the app to read what changed in it. Both read `content/changelog.ts`, so
 * neither can claim a release the other has not heard of.
 *
 * Dates are formatted on the server, so the render and the hydration cannot
 * disagree.
 */

export const metadata: Metadata = {
    title: "Changelog",
    description: "What changed in the exchange, newest first.",
    alternates: { canonical: "/app/changelog" },
    robots: { index: false, follow: false },
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
});

function formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}

export default function AppChangelogPage() {
    return (
        <PageFrame title="Changelog" lede={`You are on v${CURRENT_VERSION}. Newest first.`}>
            <Section title="Releases" count={CHANGELOG.length}>
                <ol className="space-y-3">
                    {CHANGELOG.map((entry) => (
                        <li key={entry.slug} className="border-line bg-surface rounded-sm border p-4">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span className="text-accent-text font-mono text-[12.5px] font-medium">
                                    v{entry.version}
                                </span>
                                <h3 className="text-[14.5px] font-semibold">{entry.title}</h3>
                                <span className="text-muted ml-auto font-mono text-[11.5px] whitespace-nowrap">
                                    {formatDate(entry.date)}
                                </span>
                            </div>

                            <ul className="mt-2.5 space-y-1.5">
                                {entry.items.map((item) => (
                                    <li key={item} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                                        <span aria-hidden="true" className="text-line-strong">
                                            —
                                        </span>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </li>
                    ))}
                </ol>
            </Section>
        </PageFrame>
    );
}
