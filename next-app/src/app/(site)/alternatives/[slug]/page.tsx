import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/web/page-header";
import { Callout, Prose, Section } from "@/components/web/prose";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { ALTERNATIVES, type Alternative, alternativeBySlug } from "@/content/alternatives";

/**
 * @file One honest comparison per alternative.
 *
 * Content lives in `src/content/alternatives.ts` and this file only renders it,
 * so there is exactly one place to correct a claim about another company. The
 * routes are generated from the same array the footer reads, which is what
 * guarantees the footer cannot link to a page that does not exist.
 *
 * Outbound links to competitors carry `nofollow`. Running a link exchange while
 * passing authority to every rival by accident would be a poor advertisement
 * for the product, and these are references rather than endorsements.
 */

export function generateStaticParams() {
    return ALTERNATIVES.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const entry = alternativeBySlug(slug);
    if (!entry) return {};

    const title = `A ${entry.name} alternative for builders who ship`;
    const description = `How builders-backlinks.com compares to ${entry.name}: ${entry.oneLiner} We trade links from inside your coding agent and verify every placement.`;
    return {
        title,
        description,
        alternates: { canonical: `/alternatives/${entry.slug}` },
        openGraph: { title, description, type: "article" },
    };
}

function Bullets({ items }: { items: readonly string[] }) {
    return (
        <ul className="mt-4 max-w-[70ch] space-y-2.5">
            {items.map((item) => (
                <li key={item} className="text-[15.5px] leading-[1.7]">
                    <span aria-hidden="true" className="text-accent-text mr-2.5 font-mono text-[13px]">
                        ·
                    </span>
                    {item}
                </li>
            ))}
        </ul>
    );
}

function FactRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-line grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-6">
            <dt className="text-muted font-mono text-[12px] tracking-[0.08em] uppercase">{label}</dt>
            <dd className="text-[15px] leading-[1.7]">{value}</dd>
        </div>
    );
}

function DifferenceTable({ entry }: { entry: Alternative }) {
    return (
        <div className="border-line mt-6 overflow-x-auto rounded-sm border">
            <table className="w-full min-w-[36rem] border-collapse text-left text-[14.5px]">
                <thead>
                    <tr className="border-line bg-surface-2 border-b">
                        <th
                            scope="col"
                            className="text-muted px-4 py-3 font-mono text-[11.5px] tracking-[0.1em] uppercase">
                            &nbsp;
                        </th>
                        <th scope="col" className="px-4 py-3 font-semibold">
                            {entry.name}
                        </th>
                        <th scope="col" className="text-accent-text px-4 py-3 font-semibold">
                            builders-backlinks
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {entry.differences.map((row) => (
                        <tr key={row.label} className="border-line border-b last:border-b-0">
                            <th
                                scope="row"
                                className="text-muted px-4 py-3.5 align-top font-mono text-[12px] font-normal">
                                {row.label}
                            </th>
                            <td className="px-4 py-3.5 align-top leading-[1.6]">{row.them}</td>
                            <td className="px-4 py-3.5 align-top leading-[1.6]">{row.us}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default async function AlternativePage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const entry = alternativeBySlug(slug);
    if (!entry) notFound();

    return (
        <>
            <SiteHeader />

            <main id="main">
                <PageHeader
                    eyebrow={`Alternatives · ${entry.name}`}
                    title={`builders-backlinks.com vs ${entry.name}`}
                    lede={entry.oneLiner}
                    meta={`Checked against ${new URL(entry.url).hostname} on ${entry.checkedAt}`}
                />

                <div className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-16">
                    {entry.note ? (
                        <Callout title="Read this first" tone="accent">
                            {entry.note}
                        </Callout>
                    ) : null}

                    <Section id="at-a-glance" title="At a glance">
                        <dl className="border-line mt-2 border-t">
                            <FactRow label="Mechanic" value={entry.mechanic} />
                            <FactRow label="Pricing" value={entry.pricing} />
                            <FactRow label="Vetting" value={entry.vetting} />
                            <FactRow label="Verifies links" value={entry.verifies} />
                            <FactRow label="Built for" value={entry.audience} />
                        </dl>
                    </Section>

                    <Section id="how-it-works" title={`How ${entry.name} works`}>
                        <Bullets items={entry.howItWorks} />
                    </Section>

                    <Section id="strengths" title={`What ${entry.name} is good at`}>
                        <Prose>
                            <p>
                                Written straight. If one of these matters more to you than anything below, use them
                                instead of us.
                            </p>
                        </Prose>
                        <Bullets items={entry.goodAt} />
                    </Section>

                    <Section id="differences" title="Where we differ">
                        <DifferenceTable entry={entry} />
                    </Section>

                    <Section id="which" title="Which one to pick">
                        <Prose>
                            <p className="font-semibold">Pick {entry.name} if:</p>
                        </Prose>
                        <Bullets items={entry.pickThemIf} />
                        <Prose className="mt-8">
                            <p className="font-semibold">Pick builders-backlinks.com if:</p>
                        </Prose>
                        <Bullets items={entry.pickUsIf} />
                    </Section>

                    <Prose className="border-line mt-16 border-t pt-8">
                        <p>
                            Free forever, and the whole exchange runs from your coding agent.{" "}
                            <Link href="/docs/mcp">Read the MCP docs</Link> or{" "}
                            <Link href="/submit">submit a site on the web</Link>. Everything here was checked against{" "}
                            <a href={entry.url} rel="nofollow noopener noreferrer" target="_blank">
                                {new URL(entry.url).hostname}
                            </a>{" "}
                            on {entry.checkedAt}. If something is out of date, tell us and we will correct it.
                        </p>
                    </Prose>
                </div>
            </main>

            <SiteFooter />
        </>
    );
}
