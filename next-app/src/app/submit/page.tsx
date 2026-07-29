import { LogIn, Terminal } from "lucide-react";
import type { Metadata } from "next";

import { SubmitFlow } from "@/app/submit/submit-flow";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/submit`, the browser equivalent of the `submit_site` MCP tool.
 *
 * The whole architecture rests on both interfaces calling the same services, so
 * this page contains no listing logic at all: it resolves the session, and the
 * server actions in `./actions.ts` call `draftSite`, `commitSite`, and
 * `autoPair` in the same order the tool does.
 *
 * A URL typed into the landing page's fallback form is carried through the
 * sign-in round trip in `callbackUrl`, so someone who is signed out never has
 * to type their address twice.
 */

export const metadata: Metadata = {
    title: "Submit your site",
    description:
        "List your site in the exchange from the browser. We read the page, draft the listing, and you confirm the wording before anything is saved.",
    alternates: { canonical: "/submit" },
    robots: { index: false, follow: true },
};

/** Session-dependent: there is nothing here to prerender. */
export const dynamic = "force-dynamic";

type SubmitPageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
}

export default async function SubmitPage({ searchParams }: SubmitPageProps) {
    const params = await searchParams;
    const initialUrl = firstValue(params.url).trim();

    const callbackUrl = initialUrl ? `/submit?url=${encodeURIComponent(initialUrl)}` : "/submit";
    const signInHref = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;

    const member = await getSessionMember();

    return (
        <>
            <SiteHeader signedIn={Boolean(member)} />

            <main id="main">
                <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
                    <p className="text-muted mb-4 font-mono text-[11.5px] tracking-[0.14em] uppercase">
                        Submit on the web
                    </p>
                    <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.5rem]">
                        List your site in the exchange
                    </h1>
                    <p className="text-muted mt-4 text-[16px] leading-relaxed">
                        Same exchange, same rules, same two steps an agent walks through: we draft the listing, you
                        approve the words, then we look for a partner straight away.
                    </p>

                    <div className="mt-10">
                        {member ? (
                            <SubmitFlow initialUrl={initialUrl} signInHref={signInHref} />
                        ) : (
                            <SignInPrompt initialUrl={initialUrl} signInHref={signInHref} />
                        )}
                    </div>

                    <AgentAside />
                </div>
            </main>

            <SiteFooter />
        </>
    );
}

function SignInPrompt({ initialUrl, signInHref }: { initialUrl: string; signInHref: string }) {
    return (
        <section aria-labelledby="signin-heading" className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <span className="border-line bg-surface-2 text-accent mb-4 inline-flex size-10 items-center justify-center rounded-sm border">
                <LogIn aria-hidden="true" className="size-5" />
            </span>

            <h2 id="signin-heading" className="text-[1.25rem] font-semibold tracking-[-0.02em]">
                Sign in to list a site
            </h2>
            <p className="text-muted mt-3 text-[14.5px] leading-relaxed">
                A listing has to belong to somebody: a domain belongs to exactly one member, and your partner needs a
                real person to reach once you both accept. Signing in is free and takes one click.
            </p>

            {initialUrl ? (
                <p className="border-line bg-surface-2 mt-5 rounded-sm border p-4 text-[13.5px] leading-relaxed">
                    We kept the URL you typed: <span className="text-fg font-mono break-all">{initialUrl}</span>. It
                    will be waiting in the form when you get back.
                </p>
            ) : null}

            <a
                href={signInHref}
                className="bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex items-center justify-center rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors">
                Sign in and continue
            </a>
        </section>
    );
}

function AgentAside() {
    return (
        <aside className="border-line bg-surface-2/60 mt-12 rounded-sm border p-5 sm:p-6">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                <Terminal aria-hidden="true" className="text-accent size-4" />
                You can do all of this from your agent instead
            </p>
            <p className="text-muted mt-2.5 text-[14px] leading-relaxed">
                The web form and the <code className="text-fg font-mono text-[13px]">submit_site</code> tool run the
                same code and produce the same listing. The agent is worth having anyway for the step after this one:
                when a trade is agreed, it writes the link into your repo instead of you doing it by hand.
            </p>
            <a
                href="/app/key"
                className="text-accent mt-3 inline-block rounded-sm text-[14px] font-medium underline underline-offset-4">
                Get your MCP key
            </a>
        </aside>
    );
}
