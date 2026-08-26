import { ArrowRight, LogIn } from "lucide-react";
import Link from "next/link";

import { asJson } from "@/app/app/inbox/shared";
import { ThreadList } from "@/app/app/inbox/thread-list";
import { cn } from "@/components/web/cn";
import { SiteHeader } from "@/components/web/site-header";
import type { ThreadSummary } from "@/lib/services/threads";

/**
 * @file The inbox chrome: header, thread list, and whatever pane is open.
 *
 * TWO PANES ON ONE URL EACH. `/app/inbox` is the list, `/app/inbox/<match>` is a
 * thread, and on a wide screen the second renders both. That keeps a thread
 * linkable — the reply email points straight at one — while a phone gets the
 * ordinary list-then-detail drill-down for free, with no client-side router
 * state to get out of step with the address bar.
 *
 * The layout is fixed to the viewport rather than the document, so the
 * conversation scrolls inside its own pane and the composer stays put. That is
 * the one place this app departs from its otherwise document-shaped pages, and
 * it is why the inbox does not use the centred `max-w-3xl` column the rest of
 * `/app` uses.
 */

/** The sticky site header, and the vertical margin the framed layout adds on `sm`. */
const CHROME_HEIGHT = "3.5rem";
const FRAMED_CHROME_HEIGHT = "6.5rem";

export function InboxShell({
    threads,
    selectedId,
    children,
}: {
    threads: ThreadSummary[];
    selectedId: string | null;
    children: React.ReactNode;
}) {
    const unread = threads.reduce((total, thread) => total + thread.unread, 0);

    return (
        <>
            <SiteHeader />
            <main id="main" className="mx-auto max-w-6xl px-0 sm:px-6">
                {/* Two heights, because the framed layout on `sm` adds its own
                    margin: one calc would either overflow the viewport or leave
                    a gap under the composer. */}
                <div
                    className="border-line bg-bg grid h-[var(--inbox-height)] min-h-0 grid-cols-1 sm:my-6 sm:h-[var(--inbox-framed-height)] sm:rounded-sm sm:border lg:grid-cols-[21rem_1fr]"
                    style={
                        {
                            "--inbox-height": `calc(100dvh - ${CHROME_HEIGHT})`,
                            "--inbox-framed-height": `calc(100dvh - ${FRAMED_CHROME_HEIGHT})`,
                        } as React.CSSProperties
                    }>
                    <div
                        className={cn(
                            "border-line flex min-h-0 flex-col lg:border-r",
                            selectedId ? "hidden lg:flex" : "flex",
                        )}>
                        <div className="border-line flex items-center gap-2 border-b px-5 py-4">
                            <h2 className="text-[15px] font-semibold">Inbox</h2>
                            {unread > 0 ? (
                                <span className="bg-accent text-accent-fg rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                    {unread}
                                </span>
                            ) : null}
                            <Link
                                href="/app"
                                className="text-muted hover:text-fg ml-auto font-mono text-[11px] tracking-[0.14em] uppercase">
                                Dashboard
                            </Link>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <ThreadList initial={asJson(threads)} selectedId={selectedId} />
                        </div>
                    </div>

                    <div className={cn("min-h-0", selectedId ? "flex flex-col" : "hidden lg:flex lg:flex-col")}>
                        {children}
                    </div>
                </div>
            </main>
        </>
    );
}

/** Shown in the right pane when nothing is selected on a wide screen. */
export function NoThreadSelected({ hasThreads }: { hasThreads: boolean }) {
    return (
        <div className="flex h-full items-center justify-center p-10">
            <div className="max-w-sm text-center">
                <h2 className="text-[17px] font-semibold">{hasThreads ? "Pick a thread" : "No exchanges yet"}</h2>
                <p className="text-muted mt-2 text-[14px] leading-relaxed">
                    {hasThreads
                        ? "Every match has a thread. Open one to accept it, agree where the two links go, and paste your page back for verification."
                        : "We pair a site the moment it is approved, and a thread appears here as soon as that happens."}
                </p>
                {hasThreads ? null : (
                    <Link
                        href="/submit"
                        className="bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex items-center gap-2 rounded-sm px-5 py-2.5 text-[14px] font-semibold transition-colors">
                        Submit a site
                        <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                )}
            </div>
        </div>
    );
}

/** The signed-out state, worded like the one on `/app`. */
export function InboxSignInPrompt() {
    return (
        <>
            <SiteHeader />
            <main id="main">
                <div className="mx-auto max-w-3xl px-5 py-16 sm:px-6">
                    <section className="border-line bg-surface rounded-sm border p-6 sm:p-8">
                        <div className="border-line flex size-10 items-center justify-center rounded-sm border">
                            <LogIn aria-hidden="true" className="size-4" />
                        </div>
                        <h1 className="mt-4 text-[19px] font-semibold">Sign in to open your inbox</h1>
                        <p className="text-muted mt-2 text-[14.5px] leading-relaxed">
                            Your exchanges, the messages on each one, and what is still owed back to you.
                        </p>
                        <a
                            href={`/signin?callbackUrl=${encodeURIComponent("/app/inbox")}`}
                            className="bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex items-center gap-2 rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors">
                            Sign in
                            <ArrowRight aria-hidden="true" className="size-4" />
                        </a>
                    </section>
                </div>
            </main>
        </>
    );
}
