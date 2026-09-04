"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { READ_EVENT, THREAD_POLL_MS, inboxFetch } from "@/app/app/inbox/shared";
import { cn } from "@/components/web/cn";

/**
 * @file The tab bar under the header on every signed-in `/app` page.
 *
 * LINKS, NOT TABS. Each destination is a route with its own URL, so these are
 * anchors with `aria-current="page"` on the active one: middle-click, the back
 * button and a link from an email all behave. `components/web/tab-list.tsx` is
 * the wrong primitive for this on purpose — it is `role="tablist"` buttons with
 * a controlled value, built for panels inside one page, and giving route
 * navigation tab semantics tells a screen reader the wrong thing.
 *
 * The Inbox badge is seeded by the layout and then keeps itself current: it
 * polls, refetches on navigation, and listens for the `READ_EVENT` the thread
 * pane fires after it marks a thread read, because the layout that rendered the
 * seed is not re-rendered by a soft navigation.
 */

const TABS = [
    { href: "/app", label: "Overview" },
    { href: "/app/inbox", label: "Inbox" },
    { href: "/app/sites", label: "Sites" },
    { href: "/app/key", label: "API key" },
] as const;

/** Overview is exact, because every other tab lives under it. */
function isActive(href: string, pathname: string): boolean {
    if (href === "/app") return pathname === "/app";
    return pathname === href || pathname.startsWith(`${href}/`);
}

function useUnreadCount(initial: number, pathname: string): number {
    const [unread, setUnread] = useState(initial);

    useEffect(() => {
        const controller = new AbortController();

        async function refresh() {
            if (document.visibilityState !== "visible") return;
            try {
                const data = await inboxFetch<{ unread: number }>("/api/inbox/unread", {
                    signal: controller.signal,
                });
                setUnread(data.unread);
            } catch {
                // The number on screen is still a number. The next tick tries again.
            }
        }

        void refresh();
        const timer = setInterval(refresh, THREAD_POLL_MS);
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener(READ_EVENT, refresh);
        return () => {
            controller.abort();
            clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
            window.removeEventListener(READ_EVENT, refresh);
        };
    }, [pathname]);

    return unread;
}

export function AppTabs({ initialUnread }: { initialUnread: number }) {
    const pathname = usePathname();
    const unread = useUnreadCount(initialUnread, pathname);

    return (
        <nav aria-label="Your exchange" className="border-line bg-bg/85 border-b backdrop-blur-md">
            <ul className="mx-auto flex h-11 max-w-5xl scrollbar-none items-stretch gap-1 overflow-x-auto px-5 sm:px-6">
                {TABS.map((tab) => {
                    const active = isActive(tab.href, pathname);
                    return (
                        <li key={tab.href} className="flex shrink-0">
                            <Link
                                href={tab.href}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "flex items-center gap-1.5 border-b-2 px-2.5 text-[13.5px] whitespace-nowrap transition-colors",
                                    active
                                        ? "border-accent text-fg font-medium"
                                        : "text-muted hover:text-fg border-transparent",
                                )}>
                                {tab.label}
                                {tab.href === "/app/inbox" && unread > 0 ? (
                                    <span className="bg-accent text-accent-fg rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                        {unread}
                                    </span>
                                ) : null}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
