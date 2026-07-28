import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/web/page-header";
import { Prose } from "@/components/web/prose";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { ALTERNATIVES } from "@/content/alternatives";

/**
 * @file The alternatives index: every comparison in one table.
 *
 * Deliberately leads with the mechanic column rather than a feature grid with
 * ticks. Which mechanic a platform uses (blind digest, marketplace, credit
 * ledger, paid placements) predicts more about whether it will work for a
 * given person than any list of features does, and a grid of green ticks where
 * we happen to win every row is the format nobody believes anyway.
 */

const TITLE = "Backlink exchange alternatives, compared honestly";
const DESCRIPTION =
    "How builders-backlinks.com compares to the other backlink exchanges and link marketplaces, including what each one is genuinely better at.";

export const metadata: Metadata = {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/alternatives" },
};

export default function AlternativesIndexPage() {
    return (
        <>
            <SiteHeader />

            <main id="main">
                <PageHeader
                    eyebrow="Alternatives"
                    title={TITLE}
                    lede="Every one of these arranges links a different way, and the mechanic matters more than the feature list. Each page says what the other platform is better at, because a comparison that never concedes anything is not worth reading."
                />

                <div className="mx-auto max-w-5xl px-5 py-14 sm:px-6 sm:py-16">
                    {ALTERNATIVES.length === 0 ? (
                        <Prose>
                            <p>These comparisons are being written. Check back shortly.</p>
                        </Prose>
                    ) : (
                        <div className="border-line overflow-x-auto rounded-sm border">
                            <table className="w-full min-w-[46rem] border-collapse text-left text-[14.5px]">
                                <thead>
                                    <tr className="border-line bg-surface-2 border-b">
                                        {["Platform", "Mechanic", "Pricing", "Verifies links"].map((heading) => (
                                            <th
                                                key={heading}
                                                scope="col"
                                                className="text-muted px-4 py-3 font-mono text-[11.5px] tracking-[0.1em] uppercase">
                                                {heading}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {ALTERNATIVES.map((entry) => (
                                        <tr key={entry.slug} className="border-line border-b last:border-b-0">
                                            <th scope="row" className="px-4 py-4 align-top font-normal">
                                                <Link
                                                    href={`/alternatives/${entry.slug}`}
                                                    className="hover:text-accent-text font-semibold underline underline-offset-2">
                                                    {entry.name}
                                                </Link>
                                                <span className="text-muted mt-1 block text-[13px] leading-[1.6]">
                                                    {entry.oneLiner}
                                                </span>
                                            </th>
                                            <td className="px-4 py-4 align-top">{entry.mechanic}</td>
                                            <td className="px-4 py-4 align-top">{entry.pricing}</td>
                                            <td className="px-4 py-4 align-top">{entry.verifies}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Prose className="mt-12">
                        <p>
                            Ours is free, runs from your coding agent over MCP, and verifies every placement then
                            rechecks it. <Link href="/docs/mcp">Read the docs</Link> or{" "}
                            <Link href="/submit">submit a site</Link>.
                        </p>
                    </Prose>
                </div>
            </main>

            <SiteFooter />
        </>
    );
}
