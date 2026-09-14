import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RelativeTime } from "@/app/app/inbox/relative-time";
import { StepChip } from "@/app/app/inbox/thread-list";
import { Empty, PageFrame, Section, SignInPrompt } from "@/app/app/ui";
import { cn } from "@/components/web/cn";
import { attentionReason, safeHref, threadStatus } from "@/lib/inbox";
import { checkLinks, getStanding } from "@/lib/services/links";
import { listThreads } from "@/lib/services/threads";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app`, the Overview: what needs the member, and how the exchange is going.
 *
 * Six email templates link here, so the route has to exist and has to answer
 * "what now" in one screen. It does not repeat the inbox: a thread is a match,
 * and accepting, agreeing and placing all happen in the thread pane. This page
 * points at the threads that need someone and shows the numbers.
 *
 * IDENTITY ARRIVES ALREADY MASKED. `listThreads` names a partner by
 * `partnerLabel`, which is a category until both sides accept, and nothing here
 * reaches for a site row. The ESLint layering rule that guards MCP handlers
 * does NOT cover `src/app/app/**`, so this comment is the guard rail: never add
 * a raw `db()` call to a dashboard page.
 */

export const metadata: Metadata = {
    title: "Overview",
    description: "What needs you, and how your exchange is going.",
    alternates: { canonical: "/app" },
    robots: { index: false, follow: false },
};

/** Session-dependent, and must never be cached. */
export const dynamic = "force-dynamic";

/** Fixed locale and time zone, matching app/key/format.ts, to avoid hydration drift. */
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

export default async function OverviewPage() {
    const member = await getSessionMember();

    if (!member) {
        return (
            <PageFrame title="Overview">
                <SignInPrompt
                    callbackUrl="/app"
                    title="Sign in to see your exchange"
                    body="Your matches, the links you have placed, and what is owed back to you."
                />
            </PageFrame>
        );
    }

    const [standing, threads, ledger] = await Promise.all([
        getStanding(member),
        listThreads(member),
        checkLinks(member),
    ]);

    const needsYou = threads.flatMap((thread) => {
        const reason = attentionReason(thread);
        return reason ? [{ thread, reason }] : [];
    });
    const open = threads.filter((t) => t.state !== "declined" && t.state !== "expired").length;

    return (
        <PageFrame
            title="Overview"
            lede={
                needsYou.length === 0
                    ? "Nothing is waiting on you."
                    : `${needsYou.length === 1 ? "One exchange needs" : `${needsYou.length} exchanges need`} you.`
            }>
            <Section title="Needs you" count={needsYou.length}>
                {needsYou.length === 0 ? (
                    <Empty>
                        {open === 0 ? (
                            <>
                                No open exchanges. We pair a site the moment it is approved, and yours is in the pool
                                from then on. Every Tuesday we email you who is in that pool.
                            </>
                        ) : (
                            <>
                                Nothing waiting on you. Your open exchanges are in the{" "}
                                <Link href="/app/inbox" className="text-accent-text underline underline-offset-4">
                                    inbox
                                </Link>
                                .
                            </>
                        )}
                    </Empty>
                ) : (
                    <ul className="border-line grid gap-px overflow-hidden rounded-sm border">
                        {needsYou.map(({ thread, reason }) => (
                            <li key={thread.matchId} className="bg-surface">
                                <Link
                                    href={`/app/inbox/${thread.matchId}`}
                                    className="hover:bg-surface-2/70 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4 transition-colors">
                                    <span className="text-[15px] font-medium">{thread.partnerLabel}</span>
                                    <StepChip status={threadStatus(thread)} />
                                    <span className="text-accent-text text-[13.5px] font-medium">{reason}</span>
                                    <span className="ml-auto flex items-center gap-2">
                                        <RelativeTime
                                            iso={thread.lastActivityAt.toISOString()}
                                            className="text-muted font-mono text-[11px]"
                                        />
                                        <ChevronRight aria-hidden="true" className="text-muted size-4" />
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Section title="Standing">
                <div className="border-line bg-surface rounded-sm border p-5 sm:p-6">
                    <Reciprocity given={standing.linksGiven} received={standing.linksReceived} sites={standing.sites} />
                    <p className="text-muted mt-4 text-[14px] leading-relaxed">{standing.note}</p>
                </div>
            </Section>

            {/* The ledger shows real page URLs, including the partner's own page
                for a received link. That is safe, and only because a link row
                cannot exist before agreement: markLinkPlaced refuses unless
                isRevealed(state). If that ever changes, this section leaks a
                domain. */}
            {ledger.length > 0 ? (
                <Section title="Links" count={ledger.length}>
                    <div className="border-line overflow-x-auto rounded-sm border">
                        <table className="w-full text-left text-[13.5px]">
                            <thead className="bg-surface-2/60 text-muted font-mono text-[10.5px] tracking-[0.14em] uppercase">
                                <tr>
                                    <th className="px-4 py-2.5 font-medium">Direction</th>
                                    <th className="px-4 py-2.5 font-medium">Page</th>
                                    <th className="px-4 py-2.5 font-medium">Placement</th>
                                    <th className="px-4 py-2.5 font-medium">Status</th>
                                    <th className="px-4 py-2.5 font-medium">Checked</th>
                                </tr>
                            </thead>
                            <tbody className="divide-line divide-y">
                                {ledger.map((link) => {
                                    const href = safeHref(link.pageUrl);
                                    return (
                                        <tr key={link.linkId} className="bg-surface">
                                            <td className="text-muted px-4 py-3 font-mono text-[11px] tracking-[0.14em] uppercase">
                                                {link.direction}
                                            </td>
                                            <td className="max-w-[24rem] truncate px-4 py-3">
                                                {href ? (
                                                    <a
                                                        href={href}
                                                        rel="nofollow noopener"
                                                        target="_blank"
                                                        className="underline underline-offset-4">
                                                        {link.pageUrl}
                                                    </a>
                                                ) : (
                                                    (link.pageUrl ?? "No page recorded")
                                                )}
                                            </td>
                                            <td className="text-muted px-4 py-3">
                                                {link.placement}
                                                {link.rel.includes("nofollow") ? " · nofollow" : ""}
                                            </td>
                                            <td
                                                className={cn(
                                                    "px-4 py-3 font-mono text-[11px] tracking-[0.14em] uppercase",
                                                    link.status === "live" ? "text-ok-text" : "text-muted",
                                                )}>
                                                {link.status}
                                            </td>
                                            <td className="text-muted px-4 py-3 font-mono text-[11.5px] whitespace-nowrap">
                                                {link.lastCheckedAt ? DATE.format(link.lastCheckedAt) : "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Section>
            ) : null}
        </PageFrame>
    );
}

/**
 * Given against received, as one bar.
 *
 * The two numbers are one relationship rather than two facts: this is a
 * reciprocal exchange, so the balance between them IS the standing. Three stat
 * tiles showed both figures side by side and hid the only thing they add up to.
 *
 * The bar is `aria-hidden` because the legend under it already carries both
 * numbers as text. A screen reader should get the values, not a description of
 * a picture of them.
 *
 * It takes the FILL tokens, where the inbox dots take `-text`, and the split is
 * the point rather than an inconsistency: this is a solid area of colour read
 * against the segment beside it, which is what `--accent` and `--ok` are for. A
 * dot is a small mark read against the page, which is what `-text` is for.
 */
function Reciprocity({ given, received, sites }: { given: number; received: number; sites: number }) {
    const total = given + received;

    return (
        <div>
            <div aria-hidden="true" className="bg-surface-2 flex h-2 gap-0.5 overflow-hidden rounded-full">
                {total > 0 ? (
                    <>
                        <span className="bg-accent" style={{ width: `${(given / total) * 100}%` }} />
                        <span className="bg-ok" style={{ width: `${(received / total) * 100}%` }} />
                    </>
                ) : null}
            </div>

            <p className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
                <Leg swatch="bg-accent" value={given} label="given" />
                <Leg swatch="bg-ok" value={received} label="received" />
                <span className="text-muted ml-auto text-[13.5px]">{sites === 1 ? "1 site" : `${sites} sites`}</span>
            </p>
        </div>
    );
}

function Leg({ swatch, value, label }: { swatch: string; value: number; label: string }) {
    return (
        <span className="flex items-baseline gap-2">
            <span aria-hidden="true" className={cn("size-2 shrink-0 self-center rounded-[2px]", swatch)} />
            <span className="text-[17px] font-semibold tabular-nums">{value}</span>
            <span className="text-muted text-[13.5px]">{label}</span>
        </span>
    );
}
