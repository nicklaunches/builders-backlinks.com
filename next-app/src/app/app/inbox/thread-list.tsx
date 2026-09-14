"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RelativeTime } from "@/app/app/inbox/relative-time";
import { THREAD_EVENT, THREAD_POLL_MS, type ThreadSummaryJson, inboxFetch } from "@/app/app/inbox/shared";
import { cn } from "@/components/web/cn";
import { THREAD_STATUS_LABELS, type ThreadStatus, threadStatus } from "@/lib/inbox";

/**
 * @file The left pane: every thread, newest activity first.
 *
 * Polls itself so a reply arriving in another thread moves that thread up and
 * lights its badge while the member is reading a different one. The poll is
 * paused while the tab is hidden, which is the difference between a background
 * tab costing nothing and costing two requests a minute forever.
 *
 * The unread count for the OPEN thread is forced to zero here rather than
 * waiting for the server to agree. The pane marks it read on mount, but the
 * next list poll can still be carrying the pre-read count, and a badge that
 * reappears on a thread you are looking at reads as a bug.
 */

export function ThreadList({ initial, selectedId }: { initial: ThreadSummaryJson[]; selectedId: string | null }) {
    const [threads, setThreads] = useState(initial);
    const [rendered, setRendered] = useState(initial);

    // Adjusted during render, not in an effect: a navigation between threads
    // brings a fresh server render, which is the newest data there is, and
    // waiting a frame to adopt it shows the previous thread's list first.
    if (rendered !== initial) {
        setRendered(initial);
        setThreads(initial);
    }

    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setInterval> | null = null;

        async function refresh() {
            if (document.visibilityState !== "visible") return;
            try {
                const data = await inboxFetch<{ threads: ThreadSummaryJson[] }>("/api/inbox/threads", {
                    signal: controller.signal,
                });
                setThreads(data.threads);
            } catch {
                // A failed refresh is not worth an error state: the list on
                // screen is still true, only older. The next tick tries again.
            }
        }

        timer = setInterval(refresh, THREAD_POLL_MS);
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener(THREAD_EVENT, refresh);
        return () => {
            controller.abort();
            if (timer) clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
            window.removeEventListener(THREAD_EVENT, refresh);
        };
    }, []);

    if (threads.length === 0) {
        return (
            <p className="text-muted p-6 text-[14px] leading-relaxed">
                No threads yet. One appears the moment the exchange pairs you with someone.
            </p>
        );
    }

    return (
        <ul className="divide-line divide-y">
            {threads.map((thread) => {
                const active = thread.matchId === selectedId;
                const unread = active ? 0 : thread.unread;

                return (
                    <li key={thread.matchId}>
                        <Link
                            href={`/app/inbox/${thread.matchId}`}
                            aria-current={active ? "true" : undefined}
                            className={cn(
                                "hover:bg-surface-2/70 flex gap-3 border-l-2 px-4 py-3.5 transition-colors",
                                active ? "border-accent bg-surface-2" : "border-transparent",
                            )}>
                            <Avatar label={thread.partnerLabel} revealed={thread.revealed} />

                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span
                                        className={cn(
                                            "truncate text-[14.5px]",
                                            unread > 0 ? "font-semibold" : "font-medium",
                                        )}>
                                        {thread.partnerLabel}
                                    </span>
                                    <RelativeTime
                                        iso={thread.lastActivityAt}
                                        className="text-muted ml-auto shrink-0 font-mono text-[11px]"
                                    />
                                </div>

                                <p className="text-muted mt-0.5 truncate text-[12.5px]">{subtitle(thread)}</p>

                                <div className="mt-1.5 flex items-center gap-3">
                                    <StepChip status={threadStatus(thread)} />
                                    {thread.partnerDomainRating != null ? (
                                        <span className="text-muted font-mono text-[10.5px] tracking-[0.1em] uppercase">
                                            DR {thread.partnerDomainRating}
                                        </span>
                                    ) : null}
                                    {unread > 0 ? (
                                        <span className="bg-accent text-accent-fg ml-auto rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                                            {unread}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}

/** A masked partner has no identity to draw, so it gets a lock rather than an initial. */
function Avatar({ label, revealed }: { label: string; revealed: boolean }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "border-line mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-sm border font-mono text-[13px] font-semibold uppercase",
                revealed ? "bg-surface-2 text-fg" : "bg-surface text-muted",
            )}>
            {revealed ? label.slice(0, 2) : "··"}
        </span>
    );
}

/**
 * The row's second line: the newest thing said, or what the thread is waiting on.
 *
 * The last message comes first even on a closed thread — a match that was
 * revealed and then expired still had a conversation, and the chip beside this
 * already says it is over.
 */
function subtitle(thread: ThreadSummaryJson): string {
    if (thread.lastMessage) return `${thread.lastMessage.mine ? "You: " : ""}${thread.lastMessage.body}`;
    if (thread.state === "declined") return "Declined. Nothing further to do.";
    if (thread.state === "expired") return "Expired. Both sites went back in the pool.";
    if (thread.waitingOnMe) return "Waiting on your decision";
    if (thread.waitingOnThem) return "You accepted, waiting on them";
    // Which of YOUR sites is in this trade. The row is titled by the partner, so
    // "with" would read as naming them.
    return `Trading as ${thread.mySiteDomain}`;
}

/**
 * What the dot means. The label says which step; the dot says whether the step
 * is asking anything of you.
 *
 * Only `decide` is accent: it is the one status that cannot advance without the
 * member. `waiting`, `agree` and `add_links` are in flight, and a closed thread
 * gets a hollow dot because it is a slot with nothing in it.
 *
 * THE TWO LOUD DOTS TAKE `-text`, NOT THE FILL. A dot is a graphical object and
 * owes 3:1 against the row behind it; `--accent` is 2.61:1 on paper and `--ok`
 * is 1.74:1, so the fills that are correct under a label are wrong as the mark.
 * The `-text` values are the same hues already solved for this ground, and they
 * measure 5.09:1 and 4.93:1 here.
 *
 * The quiet dots stay under that bar on purpose. Every label names its own state
 * in words, so those dots carry nothing a reader needs — they are pacing for the
 * eye, and a thread with nothing to do should not draw it. Do not "fix" them.
 */
const DOT: Record<ThreadStatus, string> = {
    decide: "bg-accent-text ring-3 ring-accent-soft",
    waiting: "bg-line-strong",
    agree: "bg-line-strong",
    add_links: "bg-line-strong",
    live: "bg-ok-text ring-3 ring-ok-soft",
    declined: "ring-1 ring-line-strong ring-inset",
    expired: "ring-1 ring-line-strong ring-inset",
};

/**
 * Where a thread is, as a dot and a word. Shared with the Overview's rows.
 *
 * NO CONTAINER, deliberately. A pill has to spend contrast on its own edge, and
 * the edge it was spending it on measured 1.28:1 — invisible, while forcing the
 * label down to `--muted` to keep the pill from shouting. Moving the colour into
 * a dot inverts that: a dot is a non-text indicator and answers to 3:1, which
 * buys the label full `--fg` contrast and takes a box off every row.
 */
export function StepChip({ status }: { status: ThreadStatus | null }) {
    const closed = status === "declined" || status === "expired";
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.1em] uppercase",
                closed ? "text-muted" : "text-fg",
                status === "decide" && "font-semibold",
            )}>
            <span
                aria-hidden="true"
                className={cn("size-1.5 shrink-0 rounded-full", status ? DOT[status] : "bg-line-strong")}
            />
            {status ? THREAD_STATUS_LABELS[status] : "Open"}
        </span>
    );
}
