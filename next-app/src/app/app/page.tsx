import { ArrowRight, LogIn } from "lucide-react";
import type { Metadata } from "next";

import { MatchCard, type MatchRow } from "@/app/app/match-card";
import { cn } from "@/components/web/cn";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { checkLinks, getStanding } from "@/lib/services/links";
import { listMatches } from "@/lib/services/matches";
import { listMySites } from "@/lib/services/sites";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app`, the dashboard. Everything the MCP server does, in a browser.
 *
 * This route did not exist, and six email templates linked to it: every "View
 * match" and "Check again" button the product has ever sent landed on a 404.
 * Past submission the entire trade loop was MCP-only, so a member who does not
 * use a coding agent could list a site and then do nothing with it. That made
 * the agent path mandatory when it is supposed to be merely better.
 *
 * THE MASKING BOUNDARY IS ENFORCED HERE, not in the component. `listMatches`
 * returns a `MaskedPartner` until both sides accept, and that type has no
 * `domain` field to read. The mapping below therefore takes `domain` from the
 * partner only inside a `revealed` check, and there is no other query in this
 * file that could reach a site row directly. Note the ESLint layering rule that
 * guards this for MCP handlers does NOT cover `src/app/app/**`, so this comment
 * is the guard rail: never add a raw `db()` call to a dashboard page.
 */

export const metadata: Metadata = {
    title: "Your exchange",
    description: "Your sites, matches and links.",
    alternates: { canonical: "/app" },
    robots: { index: false, follow: false },
};

/** Session-dependent, and must never be cached. */
export const dynamic = "force-dynamic";

const CALLBACK = "/app";

/** Fixed locale and time zone, matching app/key/format.ts, to avoid hydration drift. */
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

export default async function DashboardPage() {
    const member = await getSessionMember();

    if (!member) {
        return (
            <Shell signedIn={false}>
                <SignInPrompt />
            </Shell>
        );
    }

    const [sites, matches, ledger, standing] = await Promise.all([
        listMySites(member),
        listMatches(member),
        checkLinks(member),
        getStanding(member),
    ]);

    const rows: MatchRow[] = matches.map((match) => {
        // `revealed` is the ONLY gate on identity. `partner` is a MaskedPartner
        // until it is true, and that type has no domain to read.
        const revealed = match.revealed;
        const partnerDomain = revealed && "domain" in match.partner ? match.partner.domain : null;

        return {
            matchId: match.matchId,
            state: match.state,
            category: match.category,
            revealed,
            partnerDomain,
            partnerDescription: match.partner.description,
            partnerDomainRating: match.partner.domainRating,
            partnerOffers: match.partner.placementOffered,
            wantedAnchors: match.partner.wantedAnchors,
            expires: `expires ${DATE.format(match.expiresAt)}`,
            // From the service, which knows which side of the pair the viewer is
            // on. Deriving it from `state` here is impossible without that.
            waitingOnMe: match.waitingOnMe,
            waitingOnThem: !match.waitingOnMe && (match.state === "a_accepted" || match.state === "b_accepted"),
        };
    });

    const open = rows.filter((r) => !["declined", "expired"].includes(r.state));
    const closed = rows.filter((r) => ["declined", "expired"].includes(r.state));

    return (
        <Shell signedIn>
            {/* Standing first: it is the one number that says whether this is working. */}
            <section className="border-line bg-surface rounded-sm border p-6 sm:p-8">
                <h2 className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">Standing</h2>
                <p className="mt-3 text-[17px] leading-relaxed">{standing.note}</p>
                <dl className="border-line mt-5 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-3">
                    <Stat label="Sites" value={String(standing.sites)} />
                    <Stat label="Links given" value={String(standing.linksGiven)} />
                    <Stat label="Links received" value={String(standing.linksReceived)} />
                </dl>
            </section>

            <Section title="Matches" count={open.length}>
                {open.length === 0 ? (
                    <Empty>
                        No open matches. We look as soon as a site of yours goes active, then sweep the pool every
                        Tuesday. How fast that lands depends on how many builders are listed in your category.
                    </Empty>
                ) : (
                    <ul className="space-y-4">
                        {open.map((row) => (
                            <MatchCard key={row.matchId} row={row} />
                        ))}
                    </ul>
                )}
            </Section>

            <Section title="Your sites" count={sites.length}>
                {sites.length === 0 ? (
                    <Empty>
                        Nothing listed yet.{" "}
                        <a href="/submit" className="text-accent-text underline underline-offset-4">
                            Submit a site
                        </a>{" "}
                        to get started.
                    </Empty>
                ) : (
                    <ul className="border-line grid gap-px overflow-hidden rounded-sm border">
                        {sites.map((site) => (
                            <li key={site.id} className="bg-surface flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
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
                )}
            </Section>

            {/* The ledger shows real page URLs, including the partner's own page
                for a received link. That is safe, and only because a link row
                cannot exist before agreement: markLinkPlaced refuses unless
                isRevealed(state). If that ever changes, this section leaks a
                domain. */}
            {ledger.length > 0 ? (
                <Section title="Links" count={ledger.length}>
                    <ul className="border-line grid gap-px overflow-hidden rounded-sm border">
                        {ledger.map((link) => (
                            <li
                                key={link.linkId}
                                className="bg-surface flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
                                <span className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">
                                    {link.direction}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[14px]">
                                    {link.pageUrl ?? "No page recorded"}
                                </span>
                                <span className="text-muted text-[13px]">{link.placement}</span>
                                <span
                                    className={cn(
                                        "font-mono text-[11px] tracking-[0.14em] uppercase",
                                        link.status === "live" ? "text-term-ok" : "text-muted",
                                    )}>
                                    {link.status}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : null}

            {closed.length > 0 ? (
                <Section title="Closed" count={closed.length}>
                    <ul className="space-y-4">
                        {closed.map((row) => (
                            <MatchCard key={row.matchId} row={row} />
                        ))}
                    </ul>
                </Section>
            ) : null}
        </Shell>
    );
}

/** Page chrome, matching the hand-rolled block /submit and /app/key both use. */
function Shell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
    return (
        <>
            {/* Passed in rather than hardcoded: this shell also wraps the
                signed-out prompt, and a stranger must not see "Sign out". */}
            <SiteHeader signedIn={signedIn} />
            <main id="main">
                <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
                    <p className="text-muted mb-4 font-mono text-[11.5px] tracking-[0.14em] uppercase">Your exchange</p>
                    <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.5rem]">
                        Sites, matches and links
                    </h1>
                    <p className="text-muted mt-4 text-[16px] leading-relaxed">
                        Everything the MCP server does, without the MCP server. Your agent is still faster at the part
                        where a link has to be written into a repository.
                    </p>
                    <div className="mt-10 space-y-10">{children}</div>
                </div>
            </main>
            <SiteFooter />
        </>
    );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="text-muted mb-4 font-mono text-[11px] tracking-[0.14em] uppercase">
                {title} {count > 0 ? `· ${count}` : ""}
            </h2>
            {children}
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <p className="border-line bg-surface text-muted rounded-sm border p-8 text-center text-[14.5px] leading-relaxed">
            {children}
        </p>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface-2/60 p-4">
            <dt className="text-muted font-mono text-[10.5px] tracking-[0.14em] uppercase">{label}</dt>
            <dd className="mt-1 text-[20px] font-semibold">{value}</dd>
        </div>
    );
}

/** Same shape as the prompts on /submit and /app/key. */
function SignInPrompt() {
    const href = `/signin?callbackUrl=${encodeURIComponent(CALLBACK)}`;
    return (
        <section aria-labelledby="signin-heading" className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <div className="border-line flex size-10 items-center justify-center rounded-sm border">
                <LogIn aria-hidden="true" className="size-4" />
            </div>
            <h2 id="signin-heading" className="mt-4 text-[19px] font-semibold">
                Sign in to see your exchange
            </h2>
            <p className="text-muted mt-2 text-[14.5px] leading-relaxed">
                Your matches, the links you have placed, and what is owed back to you.
            </p>
            <a
                href={href}
                className="bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex items-center gap-2 rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors">
                Sign in
                <ArrowRight aria-hidden="true" className="size-4" />
            </a>
        </section>
    );
}
