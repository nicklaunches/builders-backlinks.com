/**
 * @file Top bar. Server component: no state, no interactivity beyond links.
 */

import { Wordmark } from "@/components/web/wordmark";

const NAV = [
    { href: "#how", label: "How it works" },
    { href: "#rules", label: "House rules" },
    { href: "/docs/mcp", label: "Docs" },
] as const;

export function SiteHeader() {
    return (
        <header className="border-line bg-bg/85 sticky top-0 z-40 border-b backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
                <a href="/" className="rounded-sm" aria-label="Builders Backlinks, home">
                    <Wordmark />
                </a>

                <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
                    {NAV.map((item) => (
                        <a
                            key={item.href}
                            href={item.href}
                            className="text-muted hover:text-fg hidden rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors sm:inline-block">
                            {item.label}
                        </a>
                    ))}
                    <a
                        href="/signin"
                        className="border-line hover:border-line-strong hover:bg-surface-2 rounded-md border px-3 py-1.5 text-[13.5px] font-medium transition-colors">
                        Sign in
                    </a>
                </nav>
            </div>
        </header>
    );
}
