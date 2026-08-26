"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RelativeTime } from "@/app/app/inbox/relative-time";
import { THREAD_POLL_MS, type ThreadSummaryJson, inboxFetch } from "@/app/app/inbox/shared";
import { cn } from "@/components/web/cn";

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
        return () => {
            controller.abort();
            if (timer) clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
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

                                <p className="text-muted mt-0.5 truncate text-[12.5px]">
                                    {thread.lastMessage
                                        ? `${thread.lastMessage.mine ? "You: " : ""}${thread.lastMessage.body}`
                                        : thread.waitingOnMe
                                          ? "Waiting on your decision"
                                          : `Trading with ${thread.mySiteDomain}`}
                                </p>

                                <div className="mt-1.5 flex items-center gap-2">
                                    <StepChip step={thread.step} state={thread.state} />
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

const STEP_LABELS: Record<string, string> = {
    decide: "Decide",
    agree: "Agree",
    add_links: "Add links",
    live: "Live",
};

function StepChip({ step, state }: { step: string | null; state: string }) {
    if (state === "declined" || state === "expired") {
        return (
            <span className="border-line text-muted rounded-full border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase">
                {state}
            </span>
        );
    }

    const live = step === "live";
    return (
        <span
            className={cn(
                "rounded-full border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase",
                live ? "border-term-ok/40 bg-term-ok/10 text-term-ok" : "border-line text-muted",
            )}>
            {step ? STEP_LABELS[step] : "Open"}
        </span>
    );
}
