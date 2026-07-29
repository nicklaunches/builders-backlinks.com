/**
 * @file Top bar. Server component: no state, no interactivity beyond links.
 *
 * Every nav target is root-relative, including the two section links.
 *
 * They were bare `#how` / `#rules` at first, which silently did nothing on
 * /docs/mcp, /terms and /privacy: a bare fragment resolves against the CURRENT
 * document, and those pages have no such headings. `/#how` navigates home and
 * then scrolls, which is what the link has always claimed to do. This header is
 * shared by every page, so nothing in it may assume it is on the landing page.
 *
 * SIGNED-IN STATE ARRIVES AS A PROP, and this component never calls `auth()`.
 * That is deliberate. The marketing pages are static and cached hard
 * (`s-maxage=3600` on `/`), and reading the session inside a shared header
 * would opt every one of them into dynamic rendering to change two links. The
 * member surfaces are already `force-dynamic` and already hold a session, so
 * they pass it down; the cached pages keep showing "Sign in", which is the
 * right trade for a page whose job is to be fast for strangers.
 */
import Link from "next/link";

import { SignOutButton } from "@/components/web/auth/sign-out-button";
import { Wordmark } from "@/components/web/wordmark";

const NAV = [
    { href: "/#how", label: "How it works" },
    { href: "/#rules", label: "House rules" },
    { href: "/docs/mcp", label: "Docs" },
] as const;

const NAV_LINK_CLASS =
    "text-muted hover:text-fg hidden rounded-sm px-2.5 py-1.5 text-[13.5px] transition-colors sm:inline-block";

export function SiteHeader({ signedIn = false }: { signedIn?: boolean } = {}) {
    return (
        <header className="border-line bg-bg/85 sticky top-0 z-40 border-b backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
                <Link href="/" className="rounded-sm" aria-label="Builders Backlinks, home">
                    <Wordmark />
                </Link>

                <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
                    {NAV.map((item) => (
                        <Link key={item.href} href={item.href} className={NAV_LINK_CLASS}>
                            {item.label}
                        </Link>
                    ))}
                    {signedIn ? (
                        <>
                            <Link href="/app" className={NAV_LINK_CLASS}>
                                Dashboard
                            </Link>
                            {/* w-auto overrides the button's own w-full, which is
                                right in a card and wrong in a 56px-tall bar. */}
                            <SignOutButton className="w-auto px-3 py-1.5 text-[13.5px]" />
                        </>
                    ) : (
                        <Link
                            href="/signin"
                            className="border-line hover:border-line-strong hover:bg-surface-2 rounded-sm border px-3 py-1.5 text-[13.5px] font-medium transition-colors">
                            Sign in
                        </Link>
                    )}
                </nav>
            </div>
        </header>
    );
}
