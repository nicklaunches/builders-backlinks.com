/**
 * @file Minimal footer. No counts, no badges, no social proof we do not have.
 *
 * One row of links, the wordmark, a copyright line. The four destinations are
 * the only pages a visitor can need from here: the docs, the web fallback for
 * submitting without an agent, and the two legal pages.
 */
import { Wordmark } from "@/components/web/wordmark";

const LINKS = [
    { href: "/docs/mcp", label: "MCP docs" },
    { href: "/submit", label: "Submit a site" },
    { href: "/terms", label: "Terms" },
    { href: "/privacy", label: "Privacy" },
] as const;

export function SiteFooter() {
    return (
        <footer className="border-line border-t">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex flex-col gap-1">
                    <Wordmark />
                    <p className="text-muted font-mono text-[12px]">
                        © {new Date().getFullYear()} Builders Backlinks. A free link exchange for people who ship.
                    </p>
                </div>

                <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="text-muted hover:text-fg rounded-sm text-[13px] transition-colors">
                            {link.label}
                        </a>
                    ))}
                </nav>
            </div>
        </footer>
    );
}
