import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { asJson } from "@/app/app/inbox/shared";
import { ThreadList } from "@/app/app/inbox/thread-list";
import { PageFrame, SignInPrompt } from "@/app/app/ui";
import { cn } from "@/components/web/cn";
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
 * it is why the inbox does not use the `PageFrame` the rest of `/app` uses.
 * How much of the viewport the header and tab bar take is `--app-chrome`,
 * published by `app/layout.tsx`; the `3rem` below is this shell's own `sm:my-6`.
 */

export function InboxShell({
    threads,
    selectedId,
    children,
}: {
    threads: ThreadSummary[];
    selectedId: string | null;
    children: React.ReactNode;
}) {
    return (
        <main id="main" className="mx-auto w-full max-w-6xl px-0 sm:px-6">
            <div className="border-line bg-bg grid h-[calc(100dvh-var(--app-chrome))] min-h-0 grid-cols-1 sm:my-6 sm:h-[calc(100dvh-var(--app-chrome)-3rem)] sm:rounded-sm sm:border lg:grid-cols-[21rem_1fr]">
                <div
                    className={cn(
                        "border-line flex min-h-0 flex-col lg:border-r",
                        selectedId ? "hidden lg:flex" : "flex",
                    )}>
                    <div className="border-line flex items-center gap-2 border-b px-5 py-4">
                        <h2 className="text-[15px] font-semibold">Inbox</h2>
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

/** The signed-out inbox. `callbackUrl` is the thread when there is one, so an email link round-trips. */
export function InboxSignedOut({ callbackUrl }: { callbackUrl: string }) {
    return (
        <PageFrame title="Inbox">
            <SignInPrompt
                callbackUrl={callbackUrl}
                title="Sign in to open your inbox"
                body="Your exchanges, the messages on each one, and what is still owed back to you."
            />
        </PageFrame>
    );
}
