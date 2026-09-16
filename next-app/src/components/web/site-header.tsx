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
 * THIS COMPONENT READS THE SESSION, which makes every page that renders it
 * dynamic. That is the deliberate cost of a header that tells the truth.
 *
 * A statically cached page has ONE html body shared by every visitor, so it
 * cannot know who is asking: purging the cache just regenerates the same
 * anonymous markup, and caching a signed-in render would serve "Sign out" to
 * strangers. Shared caching and a per-viewer header are mutually exclusive.
 * The first version of this passed `signedIn` down from the four member
 * surfaces to keep `/` static, which worked and was wrong: the marketing pages
 * still greeted signed-in members with "Sign in".
 *
 * The cost is bounded on purpose. Sessions are JWT (`auth.ts`), so this is a
 * cookie decode and not a database round trip.
 *
 * NO IN-APP NAVIGATION HERE. The way back into the app is Dashboard inside the
 * account menu, and moving between Overview, Inbox, Sites and the key is the
 * tab bar's job in `app/layout.tsx`; a Dashboard link in the bar as well would
 * be the same destination twice, two centimetres apart. The two section links
 * carry `?stay=1` for a member because `/` otherwise redirects them into the
 * app (see the landing page's `@file` block).
 */
import Link from "next/link";

import { AccountMenu } from "@/components/web/auth/account-menu";
import { cn } from "@/components/web/cn";
import { GitHubStars } from "@/components/web/github-stars";
import { Wordmark } from "@/components/web/wordmark";
import { getSessionUser } from "@/lib/session";

const NAV_LINK_CLASS =
    "text-muted hover:text-fg hidden rounded-sm px-2.5 py-1.5 text-[13.5px] transition-colors sm:inline-block";

/** The header is sticky on its own unless a layout stacks something under it and takes over. */
export async function SiteHeader({ sticky = true }: { sticky?: boolean } = {}) {
    const user = await getSessionUser();
    const signedIn = user !== null;

    // A member is redirected off `/`, so their section links have to ask to stay.
    const home = signedIn ? "/?stay=1" : "/";
    const nav = [
        { href: `${home}#how`, label: "How it works" },
        { href: `${home}#rules`, label: "House rules" },
        { href: "/docs/mcp", label: "Docs" },
    ];

    return (
        <header
            className={cn(
                "border-line bg-bg/85 border-b backdrop-blur-md",
                // `backdrop-blur` makes each bar its own stacking context, so
                // without a z-index here the tab bar under this one — later in
                // the DOM, blurring whatever is behind it — paints over the
                // account menu. See the note in `app/layout.tsx`.
                sticky ? "sticky top-0 z-40" : "relative z-20",
            )}>
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
                <Link href="/" className="rounded-sm" aria-label="Builders Backlinks, home">
                    <Wordmark />
                </Link>

                <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
                    {nav.map((item) => (
                        <Link key={item.href} href={item.href} className={NAV_LINK_CLASS}>
                            {item.label}
                        </Link>
                    ))}
                    <GitHubStars />

                    {signedIn ? (
                        <AccountMenu user={{ name: user.name, email: user.email, image: user.image }} />
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
