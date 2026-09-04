"use client";

import { AlertTriangle, ArrowLeft, Check, ChevronRight, Link2, Loader2, Lock, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Composer } from "@/app/app/inbox/composer";
import {
    MESSAGE_POLL_MS,
    type MessageJson,
    POLL_OVERLAP_MS,
    type PlacementReportJson,
    type ThreadDetailJson,
    formatDate,
    inboxFetch,
} from "@/app/app/inbox/shared";
import { StepRail } from "@/app/app/inbox/step-rail";
import { type PendingMessage, Timeline, type TimelineItem } from "@/app/app/inbox/timeline";
import { cn } from "@/components/web/cn";
import { CopyButton } from "@/components/web/copy-button";
import { SnippetBody } from "@/components/web/snippet-body";
import { safeHref } from "@/lib/inbox";
import type { LinkBrief } from "@/lib/services/links";

/**
 * @file The right pane: one exchange, from proposal to two live links.
 *
 * IDENTITY IS RENDERED ONLY INSIDE A `revealed` BRANCH. The server sends a
 * `MaskedPartner` until both sides accept and that type has no domain field, so
 * the protection is structural — but this file is not covered by the ESLint
 * layering rule, so the rule is stated here too: never introduce a prop that
 * carries a domain in from anywhere else.
 *
 * WHY IT POLLS RATHER THAN STREAMS. A thread asks for messages after its own
 * cursor every few seconds while the tab is visible. On workerd a long-lived
 * stream would hold a request-scoped database handle open for the life of the
 * connection, which is the trap this app is shaped around; a cursor poll is a
 * single indexed range scan that usually returns nothing.
 *
 * Everything that mutates goes through `/api/inbox/*`, which re-checks
 * ownership, the reveal gate and the origin. Nothing here is a permission
 * decision — the buttons are hidden when an action is not available, which is
 * courtesy, not enforcement.
 */

export function ThreadPane({ initial }: { initial: ThreadDetailJson }) {
    const [thread, setThread] = useState(initial);
    const [messages, setMessages] = useState<MessageJson[]>(() => messagesOf(initial));
    const [pending, setPending] = useState<PendingMessage[]>([]);
    const [error, setError] = useState<string | null>(null);
    const scroller = useRef<HTMLDivElement>(null);

    const [rendered, setRendered] = useState(initial);

    // See the same pattern in `thread-list.tsx`: a new server render is newer
    // than anything this component is holding, so it is adopted during render.
    if (rendered !== initial) {
        setRendered(initial);
        setThread(initial);
        setMessages(messagesOf(initial));
        setPending([]);
        setError(null);
    }

    // Derived from the CURRENT thread, not from the server-rendered prop:
    // accepting a match adds system lines to the timeline, and reading them off
    // `initial` would leave the pane showing the state it was loaded in.
    const events = useMemo(() => eventsOf(thread), [thread]);

    // Every mutation answers with the whole thread, so applying one is: take the
    // new facts, and take any messages that arrived with them.
    const applyThread = useCallback((next: ThreadDetailJson) => {
        setThread(next);
        setMessages((current) => merge(current, messagesOf(next)));
    }, []);

    const lastMessageAt = messages.at(-1)?.createdAt ?? null;

    /** Opening a thread is reading it, and so is a new message arriving while it is open. */
    useEffect(() => {
        void inboxFetch(`/api/inbox/threads/${thread.matchId}/read`, { method: "POST" }).catch(() => {
            // A missed read cursor only costs a stale badge.
        });
    }, [thread.matchId, lastMessageAt]);

    // Poll for the other side's replies. Paused while hidden, and keyed on the
    // newest message this client holds so an idle thread costs one empty answer.
    // The cursor sits a little behind that message: `created_at` is the
    // sender's transaction start, so a reply that committed late can carry an
    // older stamp than one already shown, and a cursor taken exactly at the
    // newest one would skip it forever. `merge` drops what it has already seen.
    useEffect(() => {
        if (!thread.canMessage) return;
        const controller = new AbortController();

        async function poll() {
            if (document.visibilityState !== "visible") return;
            try {
                const since = lastMessageAt
                    ? new Date(new Date(lastMessageAt).getTime() - POLL_OVERLAP_MS).toISOString()
                    : null;
                const query = since ? `?since=${encodeURIComponent(since)}` : "";
                const data = await inboxFetch<{ messages: MessageJson[] }>(
                    `/api/inbox/threads/${thread.matchId}/messages${query}`,
                    { signal: controller.signal },
                );
                if (data.messages.length > 0) setMessages((current) => merge(current, data.messages));
            } catch {
                // Same bargain as the list: an old view is better than an error.
            }
        }

        const timer = setInterval(poll, MESSAGE_POLL_MS);
        document.addEventListener("visibilitychange", poll);
        return () => {
            controller.abort();
            clearInterval(timer);
            document.removeEventListener("visibilitychange", poll);
        };
    }, [thread.matchId, thread.canMessage, lastMessageAt]);

    // Stick to the bottom as the conversation grows, the way every chat does.
    // After a frame, not during the effect: on the first render the pinned work
    // block above has not been laid out yet, so `scrollHeight` is still short and
    // a thread opens part-way up its own history.
    useEffect(() => {
        const node = scroller.current;
        if (!node) return;
        const frame = requestAnimationFrame(() => {
            node.scrollTop = node.scrollHeight;
        });
        return () => cancelAnimationFrame(frame);
    }, [messages.length, pending.length, thread.matchId]);

    const send = useCallback(
        async (body: string, retryId?: string) => {
            const id = retryId ?? `pending-${Date.now()}`;
            setError(null);
            setPending((current) =>
                retryId
                    ? current.map((p) => (p.id === retryId ? { ...p, failed: false } : p))
                    : [...current, { id, body, createdAt: new Date().toISOString(), failed: false }],
            );

            try {
                const data = await inboxFetch<{ message: MessageJson }>(
                    `/api/inbox/threads/${thread.matchId}/messages`,
                    { method: "POST", body: { body } },
                );
                setPending((current) => current.filter((p) => p.id !== id));
                setMessages((current) => merge(current, [data.message]));
            } catch (err) {
                setPending((current) => current.map((p) => (p.id === id ? { ...p, failed: true } : p)));
                setError(err instanceof Error ? err.message : "That message did not send.");
            }
        },
        [thread.matchId],
    );

    const retry = useCallback(
        (id: string) => {
            const message = pending.find((p) => p.id === id);
            if (message) void send(message.body, id);
        },
        [pending, send],
    );

    const items: TimelineItem[] = useMemo(() => {
        const merged: TimelineItem[] = [
            ...events,
            ...messages.map((m) => ({
                kind: "message" as const,
                id: m.id,
                at: m.createdAt,
                body: m.body,
                mine: m.mine,
                senderLabel: m.senderLabel,
            })),
        ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

        return [
            ...merged,
            ...pending.map((p) => ({
                kind: "pending" as const,
                id: p.id,
                at: p.createdAt,
                body: p.body,
                failed: p.failed,
            })),
        ];
    }, [events, messages, pending]);

    const closed = thread.state === "declined" || thread.state === "expired";

    return (
        <section className="flex h-full min-h-0 flex-col" aria-label={`Exchange with ${thread.partnerLabel}`}>
            <header className="border-line bg-bg/95 border-b px-5 py-4 backdrop-blur-md sm:px-6">
                <div className="flex items-start gap-3">
                    <Link
                        href="/app/inbox"
                        className="border-line hover:bg-surface-2 -ml-1 rounded-sm border p-1.5 lg:hidden"
                        aria-label="Back to all threads">
                        <ArrowLeft aria-hidden="true" className="size-4" />
                    </Link>

                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[16px] font-semibold">
                            Link exchange between {thread.mySite.domain} and {thread.partnerLabel}
                        </h1>
                        <p className="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tracking-[0.1em] uppercase">
                            <span>{thread.category}</span>
                            {thread.widened ? <span>· adjacent</span> : null}
                            <span>· DR {thread.partner.domainRating ?? "n/a"}</span>
                            <span>· {closed ? thread.state : `expires ${formatDate(thread.expiresAt)}`}</span>
                        </p>
                    </div>
                </div>

                <div className="mt-4">
                    <StepRail steps={thread.steps} muted={closed} />
                </div>
            </header>

            {/* The work sits ABOVE the conversation and does not scroll with it.
                A thread opens scrolled to the newest message, so anything inside
                that scroller starts off screen — which for the one control the
                member came here to use is the wrong place to put it. */}
            <div className="border-line bg-surface/40 max-h-[58%] shrink-0 overflow-y-auto border-b px-5 py-4 sm:max-h-[45%] sm:px-6">
                {closed ? (
                    <Banner tone="muted">
                        {thread.state === "declined"
                            ? "This exchange was declined. Nothing further to do — both sites are back in the pool."
                            : thread.revealed
                              ? "This exchange expired before both links went live. Both sites went back into the pool."
                              : "This exchange expired before both sides accepted. Both sites went back into the pool."}
                    </Banner>
                ) : thread.revealed ? (
                    <RevealedWork thread={thread} onThread={applyThread} />
                ) : (
                    <DecideWork thread={thread} onThread={applyThread} />
                )}
            </div>

            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
                <Timeline items={items} onRetry={retry} />
            </div>

            {error ? (
                <p role="status" className="border-line text-accent-text border-t px-5 py-2 text-[13px] sm:px-6">
                    {error}
                </p>
            ) : null}

            {thread.canMessage ? (
                <Composer
                    onSend={(body) => void send(body)}
                    suggestion={messages.length === 0 ? openerFor(thread) : undefined}
                />
            ) : (
                <p className="border-line text-muted flex items-center gap-2 border-t px-5 py-4 text-[13px] sm:px-6">
                    <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                    {closed
                        ? "Messaging is closed on a finished exchange."
                        : "Messaging opens when you both accept. Until then neither of you knows who the other is."}
                </p>
            )}
        </section>
    );
}

/** The pre-reveal half: what we can tell you, and the two buttons. */
function DecideWork({ thread, onThread }: { thread: ThreadDetailJson; onThread: (thread: ThreadDetailJson) => void }) {
    const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function respond(accept: boolean) {
        setBusy(accept ? "accept" : "decline");
        setError(null);
        try {
            const data = await inboxFetch<{ thread: ThreadDetailJson }>(
                `/api/inbox/threads/${thread.matchId}/respond`,
                { method: "POST", body: { accept, reason: reason.trim() || undefined } },
            );
            onThread(data.thread);
        } catch (err) {
            setError(err instanceof Error ? err.message : "That did not go through.");
        } finally {
            setBusy(null);
        }
    }

    return (
        <div>
            <p className="text-[14.5px] leading-relaxed">{thread.partner.description}</p>

            {thread.widened ? (
                <p className="text-muted mt-3 text-[13.5px] leading-relaxed">
                    One of your two categories was too thin to pair inside it, so we widened by a single adjacent step
                    rather than leave you both unmatched.
                </p>
            ) : null}

            <dl className="border-line mt-4 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-3">
                <Fact label="They want" value={thread.partner.wantedAnchors.join(", ") || "No anchors given"} />
                <Fact label="They offer" value={thread.partner.placementOffered.replace(/_/g, " ")} />
                <Fact
                    label="Their standing"
                    value={`${thread.partner.linksGiven} given / ${thread.partner.linksGot} received`}
                />
            </dl>

            <p className="text-muted mt-4 text-[13.5px] leading-relaxed">
                {thread.waitingOnMe
                    ? "They have accepted and are waiting on you. Accept to reveal both sides and open the thread."
                    : "Neither of you has answered yet. Accepting only reveals you to each other once they accept too."}
            </p>

            {error ? <Banner tone="warn">{error}</Banner> : null}

            {declining ? (
                <div className="border-line bg-surface-2/60 mt-4 rounded-sm border p-4">
                    <label htmlFor="decline-reason" className="block text-[13.5px] font-medium">
                        Anything worth telling us? Optional.
                    </label>
                    <p className="text-muted mt-1 text-[12.5px] leading-relaxed">
                        Used to stop matching you on the same mismatch again. Declining costs you nothing in standing.
                    </p>
                    <textarea
                        id="decline-reason"
                        rows={2}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        className="border-line bg-bg focus:border-line-strong mt-3 w-full rounded-sm border p-3 text-[13.5px] outline-none"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => void respond(false)}
                            disabled={busy !== null}
                            className="border-line-strong hover:bg-surface-2 inline-flex items-center gap-2 rounded-sm border px-4 py-2 text-[13.5px] font-semibold disabled:opacity-60">
                            {busy === "decline" ? <Spinner /> : <X aria-hidden="true" className="size-4" />}
                            Decline this match
                        </button>
                        <button
                            type="button"
                            onClick={() => setDeclining(false)}
                            className="border-line hover:bg-surface-2 rounded-sm border px-4 py-2 text-[13.5px]">
                            Keep it open
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => void respond(true)}
                        disabled={busy !== null}
                        className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center gap-2 rounded-sm px-5 py-2.5 text-[14px] font-semibold disabled:opacity-60">
                        {busy === "accept" ? <Spinner /> : <Check aria-hidden="true" className="size-4" />}
                        Accept
                    </button>
                    <button
                        type="button"
                        onClick={() => setDeclining(true)}
                        className="border-line hover:border-line-strong hover:bg-surface-2 inline-flex items-center gap-2 rounded-sm border px-4 py-2.5 text-[14px] font-medium">
                        <X aria-hidden="true" className="size-4" />
                        Decline
                    </button>
                </div>
            )}
        </div>
    );
}

/** The post-reveal half: who owes what, and the control that finishes your side. */
function RevealedWork({
    thread,
    onThread,
}: {
    thread: ThreadDetailJson;
    onThread: (thread: ThreadDetailJson) => void;
}) {
    const mine = thread.tasks.find((t) => t.direction === "mine");
    const theirs = thread.tasks.find((t) => t.direction === "theirs");
    const partnerUrl = "url" in thread.partner ? thread.partner.url : null;

    return (
        <div className="space-y-2.5">
            <div className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                <Site domain={thread.mySite.domain} rating={thread.mySite.domainRating} />
                <span aria-hidden="true">×</span>
                <Site domain={thread.partnerLabel} rating={thread.partner.domainRating} />
                <span>· one useful editorial link each</span>
            </div>

            {theirs ? (
                <TaskRow
                    task={theirs}
                    title={`Add a relevant link: ${thread.partnerLabel} → ${thread.mySite.domain}`}
                />
            ) : null}

            {mine ? (
                <MyTask
                    task={mine}
                    thread={thread}
                    onThread={onThread}
                    title={`Add a relevant link: ${thread.mySite.domain} → ${thread.partnerLabel}`}
                    targetUrl={partnerUrl}
                />
            ) : null}
        </div>
    );
}

/** A domain with its authority score, the way the pair line reads it. */
function Site({ domain, rating }: { domain: string; rating: number | null }) {
    return (
        <span className="text-fg inline-flex items-center gap-1 font-medium">
            {domain}
            {rating == null ? null : (
                <span className="border-line text-muted rounded-full border px-1.5 font-mono text-[10px]">
                    {rating}
                </span>
            )}
        </span>
    );
}

type TaskJson = ThreadDetailJson["tasks"][number];

function TaskRow({ task, title, children }: { task: TaskJson; title: string; children?: React.ReactNode }) {
    // The other member typed this URL. Anything that is not http(s) stays text
    // rather than becoming a scheme in an anchor on this member's screen.
    const href = safeHref(task.pageUrl);

    return (
        <div className="border-line bg-surface rounded-sm border">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                <StateDot state={task.state} />
                <span className="text-[13.5px]">{title}</span>
                <span className="text-muted ml-auto font-mono text-[10.5px] tracking-[0.1em] uppercase">
                    {TASK_WORDS[task.state]} · {task.direction === "mine" ? "your task" : "their task"}
                </span>
            </div>

            {task.pageUrl ? (
                <p className="border-line text-muted truncate border-t px-3.5 py-2 text-[12.5px]">
                    {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                            {task.pageUrl}
                        </a>
                    ) : (
                        task.pageUrl
                    )}
                    {task.dofollow === false ? " · nofollow" : null}
                    {task.checkedAt ? ` · checked ${formatDate(task.checkedAt)}` : null}
                </p>
            ) : null}

            {children}
        </div>
    );
}

/** The member's own side: the snippet to paste, and the page to hand back. */
function MyTask({
    task,
    thread,
    onThread,
    title,
    targetUrl,
}: {
    task: TaskJson;
    thread: ThreadDetailJson;
    onThread: (thread: ThreadDetailJson) => void;
    title: string;
    targetUrl: string | null;
}) {
    const [pageUrl, setPageUrl] = useState(task.pageUrl ?? "");
    const [anchor, setAnchor] = useState(task.anchorText ?? "");
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState<PlacementReportJson | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [brief, setBrief] = useState<LinkBrief | null>(null);
    const [loadingBrief, setLoadingBrief] = useState(false);

    async function loadBrief() {
        setLoadingBrief(true);
        setError(null);
        try {
            const data = await inboxFetch<{ brief: LinkBrief }>(`/api/inbox/threads/${thread.matchId}/brief`);
            setBrief(data.brief);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not build that snippet.");
        } finally {
            setLoadingBrief(false);
        }
    }

    async function submit() {
        if (!pageUrl.trim()) {
            setError("Paste the URL of the page you put the link on.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const data = await inboxFetch<{ report: PlacementReportJson; thread: ThreadDetailJson }>(
                `/api/inbox/threads/${thread.matchId}/placement`,
                { method: "POST", body: { pageUrl: pageUrl.trim(), anchorUsed: anchor.trim() || undefined } },
            );
            setReport(data.report);
            onThread(data.thread);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not check that page.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <TaskRow task={task} title={title}>
            <div className="border-line border-t px-3.5 py-3">
                <p className="text-muted text-[12.5px] leading-relaxed">
                    Paste your published article below. It must contain this link:{" "}
                    {targetUrl ? (
                        <a
                            href={targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-text underline underline-offset-2">
                            {targetUrl}
                        </a>
                    ) : (
                        thread.partnerLabel
                    )}
                </p>

                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                    <input
                        type="url"
                        value={pageUrl}
                        onChange={(event) => setPageUrl(event.target.value)}
                        placeholder="Published article URL"
                        aria-label="The page your link is on"
                        className="border-line bg-bg focus:border-line-strong min-w-0 flex-1 rounded-sm border px-3 py-2 text-[13.5px] outline-none"
                    />
                    <input
                        type="text"
                        value={anchor}
                        onChange={(event) => setAnchor(event.target.value)}
                        placeholder="Anchor used (optional)"
                        aria-label="The anchor text you used"
                        className="border-line bg-bg focus:border-line-strong w-full rounded-sm border px-3 py-2 text-[13.5px] outline-none sm:w-44"
                    />
                    <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={busy}
                        className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex shrink-0 items-center justify-center gap-2 rounded-sm px-4 py-2 text-[13.5px] font-semibold disabled:opacity-60">
                        {busy ? <Spinner /> : <ChevronRight aria-hidden="true" className="size-4" />}
                        {busy ? "Checking the page" : "Check and finish"}
                    </button>
                </div>

                {busy ? (
                    <p className="text-muted mt-2 text-[12.5px]">
                        We are fetching that page and reading its HTML now. It takes a few seconds.
                    </p>
                ) : null}

                {brief ? (
                    <div className="border-term-line bg-term-bg mt-2.5 flex items-center gap-3 rounded-sm border p-3">
                        <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
                            <SnippetBody snippet={brief.snippet} />
                        </div>
                        <CopyButton value={brief.snippet} label="link snippet" />
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => void loadBrief()}
                        disabled={loadingBrief}
                        className="text-muted hover:text-fg mt-2 inline-flex items-center gap-1.5 text-[12.5px] disabled:opacity-60">
                        {loadingBrief ? <Spinner /> : <Link2 aria-hidden="true" className="size-3.5" />}
                        Get the snippet to paste
                    </button>
                )}

                {report ? (
                    <Banner tone={report.status === "live" ? "ok" : "warn"}>
                        {report.message}
                        {report.status === "live"
                            ? ` Recorded as ${report.placement}, ${report.rel.includes("nofollow") ? "nofollow" : "dofollow"}.`
                            : ""}
                    </Banner>
                ) : null}

                {error ? <Banner tone="warn">{error}</Banner> : null}
            </div>
        </TaskRow>
    );
}

const TASK_WORDS: Record<TaskJson["state"], string> = {
    not_started: "not started",
    in_progress: "in progress",
    live: "live",
    missing: "not found",
};

function StateDot({ state }: { state: TaskJson["state"] }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "flex size-4 items-center justify-center rounded-full border",
                state === "live"
                    ? "border-term-ok/50 bg-term-ok/20"
                    : state === "missing"
                      ? "border-accent/50 bg-accent-soft"
                      : "border-line",
            )}>
            {state === "live" ? <Check aria-hidden="true" className="text-term-ok size-2.5" /> : null}
        </span>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface-2/50 p-3">
            <dt className="text-muted font-mono text-[10px] tracking-[0.14em] uppercase">{label}</dt>
            <dd className="mt-1 text-[13.5px]">{value}</dd>
        </div>
    );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
    return (
        <p
            className={cn(
                "mt-3 flex items-start gap-2 rounded-sm border px-3 py-2 text-[13px] leading-relaxed",
                tone === "ok"
                    ? "border-term-ok/40 bg-term-ok/10"
                    : tone === "warn"
                      ? "border-accent/40 bg-accent-soft"
                      : "border-line bg-surface-2/60 text-muted",
            )}>
            {tone === "warn" ? <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : null}
            <span>{children}</span>
        </p>
    );
}

function Spinner() {
    return <Loader2 aria-hidden="true" className="size-4 animate-spin" />;
}

type TimelineEntryJson = ThreadDetailJson["timeline"][number];

/** The message half of a server-rendered timeline, which arrives merged. */
function messagesOf(thread: ThreadDetailJson): MessageJson[] {
    const messages: MessageJson[] = [];
    for (const entry of thread.timeline) {
        if (entry.kind !== "message") continue;
        messages.push({
            id: entry.id,
            matchId: thread.matchId,
            body: entry.body,
            mine: entry.mine,
            senderLabel: entry.senderLabel,
            createdAt: entry.at,
        });
    }
    return messages;
}

/** The system half of the same timeline, which never changes after load. */
function eventsOf(thread: ThreadDetailJson): Extract<TimelineItem, { kind: "event" }>[] {
    const events: Extract<TimelineItem, { kind: "event" }>[] = [];
    for (const entry of thread.timeline as TimelineEntryJson[]) {
        if (entry.kind !== "event") continue;
        events.push({ kind: "event", id: entry.id, at: entry.at, text: entry.text });
    }
    return events;
}

/**
 * A first message worth sending, for a thread where nobody has spoken.
 *
 * Written to be edited, not sent as-is: it names both sites and asks the two
 * questions every one of these threads ends up asking anyway — which page, and
 * dofollow or not.
 */
function openerFor(thread: ThreadDetailJson): string {
    return [
        `Hi — happy to get this moving.`,
        ``,
        `On my side the link to ${thread.partnerLabel} would go inside an existing post on ${thread.mySite.domain} rather than a links page, dofollow.`,
        ``,
        `Two things: which page of yours would you rather I point at, and which post are you planning to use for mine?`,
    ].join("\n");
}

/** Appends only what we do not already hold, so a re-poll cannot duplicate a line. */
function merge(current: MessageJson[], incoming: MessageJson[]): MessageJson[] {
    const seen = new Set(current.map((m) => m.id));
    const fresh = incoming.filter((m) => !seen.has(m.id));
    if (fresh.length === 0) return current;
    // Sorted, because the overlapping poll cursor can surface a message that is
    // older than the current tail.
    return [...current, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
