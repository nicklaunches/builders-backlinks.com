import { LogIn } from "lucide-react";
import type { Metadata } from "next";

import { formatKeyDate } from "@/app/app/key/format";
import { KeyPanel } from "@/app/app/key/key-panel";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { describeApiKey } from "@/lib/services/api-keys";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app/key`, where the MCP tools send people who are not signed in.
 *
 * The sign-in hint printed by every authenticated tool in `src/lib/mcp/tools.ts`
 * names this exact URL, so it has to exist and it has to end the errand in one
 * visit: arrive, generate, copy one complete command, paste it, done. That is
 * why the reveal leads with the install line rather than the raw token.
 *
 * This page never renders a key from the database. It cannot: only a SHA-256 is
 * stored. It renders metadata (issued, last used) and hands the interactive
 * half to `KeyPanel`, which holds the plaintext only in the response to the
 * issue action.
 */

export const metadata: Metadata = {
    title: "Your MCP key",
    description: "Issue the bearer token that connects your coding agent to the exchange.",
    alternates: { canonical: "/app/key" },
    robots: { index: false, follow: false },
};

/** Session-dependent, and must never be cached. */
export const dynamic = "force-dynamic";

const CALLBACK = "/app/key";

export default async function ApiKeyPage() {
    const member = await getSessionMember();
    const status = member ? describeApiKey(member) : null;

    return (
        <>
            <SiteHeader />

            <main id="main">
                <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
                    <p className="text-muted mb-4 font-mono text-[11.5px] tracking-[0.14em] uppercase">
                        Connect your agent
                    </p>
                    <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.5rem]">
                        Your MCP key
                    </h1>
                    <p className="text-muted mt-4 text-[16px] leading-relaxed">
                        One key, added to your agent once as an{" "}
                        <code className="text-fg font-mono text-[14px]">Authorization</code> header. Nothing runs on
                        your machine: the exchange is an HTTP MCP server, so adding it is a single command.
                    </p>

                    <div className="mt-10">
                        {status ? (
                            <KeyPanel
                                initial={{
                                    issued: status.issued,
                                    issuedAt: formatKeyDate(status.issuedAt),
                                    lastUsedAt: formatKeyDate(status.lastUsedAt),
                                }}
                            />
                        ) : (
                            <SignInPrompt />
                        )}
                    </div>

                    <aside className="border-line bg-surface-2/60 mt-12 rounded-sm border p-5 sm:p-6">
                        <h2 className="text-[14.5px] font-semibold">What works without a key</h2>
                        <p className="text-muted mt-2.5 text-[14px] leading-relaxed">
                            The read-only tools (<code className="text-fg font-mono text-[13px]">search_partners</code>,{" "}
                            <code className="text-fg font-mono text-[13px]">get_categories</code>,{" "}
                            <code className="text-fg font-mono text-[13px]">get_rules</code>) answer without one, so you
                            can look around before committing. Everything that writes, listing a site, accepting a
                            match, marking a link placed, needs the key so we know whose site it is.
                        </p>
                        <a
                            href="/docs/mcp"
                            className="text-accent mt-3 inline-block rounded-sm text-[14px] font-medium underline underline-offset-4">
                            Read the MCP docs
                        </a>
                    </aside>
                </div>
            </main>

            <SiteFooter />
        </>
    );
}

function SignInPrompt() {
    const href = `/signin?callbackUrl=${encodeURIComponent(CALLBACK)}`;

    return (
        <section aria-labelledby="signin-heading" className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <span className="border-line bg-surface-2 text-accent mb-4 inline-flex size-10 items-center justify-center rounded-sm border">
                <LogIn aria-hidden="true" className="size-5" />
            </span>

            <h2 id="signin-heading" className="text-[1.25rem] font-semibold tracking-[-0.02em]">
                Sign in to get your key
            </h2>
            <p className="text-muted mt-3 text-[14.5px] leading-relaxed">
                The key is what tells the exchange which member an agent is acting for, so it has to be tied to an
                account. Signing in is free and takes one click, and you land straight back here.
            </p>

            <a
                href={href}
                className="bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex items-center justify-center rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors">
                Sign in and continue
            </a>

            <p className="text-muted mt-5 text-[13.5px] leading-relaxed">
                Already signed in on another tab? Reload this page and the key panel appears.
            </p>
        </section>
    );
}
