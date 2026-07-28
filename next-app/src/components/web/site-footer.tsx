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
 * A future row belongs above `pages:`: the reference this is modelled on opens
 * with `alternatives:` and a run of competitor comparison pages. Those are real
 * pSEO value, but ours do not exist yet, and a footer full of 404s is worse
 * than a short footer. Add the row when /alternatives/<slug> ships.
 */
import { Star } from "lucide-react";
import Link from "next/link";

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
] as const;

/** Muted underline that warms to the accent on hover. Shared by every link here. */
const LINK = "decoration-line-strong hover:text-accent-text underline underline-offset-2 transition-colors";

export function SiteFooter() {
    return (
        <footer className="border-line mt-24 border-t">
            <div className="text-muted mx-auto max-w-5xl px-5 py-9 font-mono text-[12.5px] sm:px-6">
                {/* Row one: destinations, comma separated. The commas sit
                    OUTSIDE the anchors so they are not underlined too. */}
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
