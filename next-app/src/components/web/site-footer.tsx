/**
 * @file Footer. Dense, mono, two rows, no chrome.
 *
 * Deliberately typographic rather than a card grid: small mono type, underlined
 * links, comma separators. It should read like the end of a man page, which
 * matches the spec-ledger treatment House rules already uses.
 *
 * No counts and no badges. The exchange has no members yet, and inventing
 * social proof on the one page that claims to verify things for a living is
 * exactly the wrong trade.
 *
 * The `alternatives:` row is generated from the same ALTERNATIVES array the
 * pages are generated from, so the footer physically cannot advertise a
 * comparison that does not exist. It renders nothing while the array is empty.
 * That coupling is the point: a hand-maintained list here would drift into
 * 404s the first time a competitor page was renamed or dropped.
 */
import { Star } from "lucide-react";
import Link from "next/link";

import { ALTERNATIVES } from "@/content/alternatives";

/**
 * Every sibling property lives at github.com/nicklaunches/<domain>, so this
 * follows the same convention. One constant, so renaming the repo is one edit.
 */
const REPO_URL = "https://github.com/nicklaunches/builders-backlinks.com";
const PARENT_URL = "https://nicklaunches.com";
const X_URL = "https://x.com/nicklaunches";

const PAGES = [
    { href: "/docs/mcp", label: "MCP docs" },
    { href: "/submit", label: "Submit a site" },
    { href: "/terms", label: "Terms" },
    { href: "/privacy", label: "Privacy" },
    { href: "/changelog", label: "Changelog" },
] as const;

/** Muted underline that warms to the accent on hover. Shared by every link here. */
const LINK = "decoration-line-strong hover:text-accent-text underline underline-offset-2 transition-colors";

export function SiteFooter() {
    return (
        <footer className="border-line mt-24 border-t">
            <div className="text-muted mx-auto max-w-5xl px-5 py-9 font-mono text-[12.5px] sm:px-6">
                {ALTERNATIVES.length > 0 ? (
                    <p className="mb-2 leading-[2]">
                        <Link href="/alternatives" className={`text-fg ${LINK}`}>
                            alternatives:
                        </Link>{" "}
                        {ALTERNATIVES.map((entry, index) => (
                            <span key={entry.slug}>
                                <Link href={`/alternatives/${entry.slug}`} className={LINK}>
                                    {entry.name}
                                </Link>
                                {index < ALTERNATIVES.length - 1 ? ", " : null}
                            </span>
                        ))}
                    </p>
                ) : null}

                {/* Destinations, comma separated. The commas sit OUTSIDE the
                    anchors so they are not underlined along with them. */}
                <p className="leading-[2]">
                    <span className="text-fg">pages:</span>{" "}
                    {PAGES.map((page, index) => (
                        <span key={page.href}>
                            <Link href={page.href} className={LINK}>
                                {page.label}
                            </Link>
                            {index < PAGES.length - 1 ? ", " : null}
                        </span>
                    ))}
                </p>

                {/* Row two: three groups, each wrapping as a unit on narrow screens. */}
                <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2.5">
                    <span>© {new Date().getFullYear()} builders-backlinks.com</span>

                    <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-accent-text inline-flex items-center gap-1.5 ${LINK}`}>
                        <Star aria-hidden="true" className="size-3.5" />
                        Star on GitHub
                    </a>

                    <span>
                        built by{" "}
                        <a
                            href={PARENT_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-accent-text ${LINK}`}>
                            nicklaunches.com
                        </a>{" "}
                        ·{" "}
                        <a href={X_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                            @nicklaunches
                        </a>
                    </span>
                </div>
            </div>
        </footer>
    );
}
