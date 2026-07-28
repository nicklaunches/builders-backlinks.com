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
 */
import Link from "next/link";

import { Wordmark } from "@/components/web/wordmark";

const NAV = [
    { href: "/#how", label: "How it works" },
    { href: "/#rules", label: "House rules" },
    { href: "/docs/mcp", label: "Docs" },
] as const;

const NAV_LINK_CLASS =
    "text-muted hover:text-fg hidden rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors sm:inline-block";

export function SiteHeader() {
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
                    <Link
                        href="/signin"
                        className="border-line hover:border-line-strong hover:bg-surface-2 rounded-md border px-3 py-1.5 text-[13.5px] font-medium transition-colors">
                        Sign in
                    </Link>
                </nav>
            </div>
        </header>
    );
}
