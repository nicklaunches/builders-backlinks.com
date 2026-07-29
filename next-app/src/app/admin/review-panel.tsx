"use client";

import { AlertTriangle, Check, Loader2, Pause, Ban as SlashCircle, X } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { type ReviewState, setSiteStatusAction } from "@/app/admin/actions";
import { cn } from "@/components/web/cn";
import { TabList } from "@/components/web/tab-list";
import type { SiteStatus } from "@/lib/exchange";

/**
 * @file The review queue.
 *
 * The reviewer's actual job is not "approve or reject", it is judging whether
 * the LISTING is honest, because the listing is what strangers use to decide
 * whether to trade. So the description, category and anchor phrases are the
 * body of each row rather than metadata tucked underneath it. The model drafted
 * them by reading the site, and a wrong category is the difference between
 * useful matches and none at all.
 *
 * Acted-on rows leave the list immediately instead of the page refetching. The
 * queue is worked top to bottom, and having it reorder under the cursor after
 * every decision is how you end up reviewing the same site twice.
 */

/** Serialisable row. Dates arrive pre-formatted so this never re-formats them. */
export type ReviewRow = {
    id: string;
    domain: string;
    url: string;
    ownerEmail: string | null;
    category: string;
    description: string;
    keywords: readonly string[];
    domainRating: number | null;
    placementOffered: string;
    status: SiteStatus;
    submitted: string;
    reviewNote: string | null;
};

const FILTERS = [
    { id: "pending_review", label: "Pending" },
    { id: "active", label: "Active" },
    { id: "rejected", label: "Rejected" },
    { id: "paused", label: "Paused" },
    { id: "banned", label: "Banned" },
] as const satisfies readonly { id: SiteStatus; label: string }[];

const INITIAL: ReviewState = { status: "idle" };

export function ReviewPanel({ rows, status }: { rows: readonly ReviewRow[]; status: SiteStatus }) {
    // Seeded from the server, then only ever shrunk as rows are acted on.
    const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
    const visible = rows.filter((row) => !handled.has(row.id));

    function onFilter(next: SiteStatus) {
        // A plain navigation, so the server does the querying. The alternative
        // is shipping every status to the browser and filtering there, which
        // means the whole table travels to render one slice of it.
        window.location.search = `?status=${next}`;
    }

    return (
        <div>
            <TabList
                label="Listing status"
                idBase="admin-status"
                items={FILTERS}
                value={status}
                onChange={onFilter}
                variant="underline"
            />

            {visible.length === 0 ? (
                <p className="border-line bg-surface text-muted mt-6 rounded-sm border p-8 text-center text-[14.5px]">
                    {handled.size > 0
                        ? "Queue cleared. Reload to see anything that arrived while you were working."
                        : `Nothing ${FILTERS.find((f) => f.id === status)?.label.toLowerCase()}.`}
                </p>
            ) : (
                <ul className="mt-6 space-y-4">
                    {visible.map((row) => (
                        <ReviewCard key={row.id} row={row} onHandled={(id) => setHandled((s) => new Set(s).add(id))} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function ReviewCard({ row, onHandled }: { row: ReviewRow; onHandled: (id: string) => void }) {
    const [state, formAction, pending] = useActionState(setSiteStatusAction, INITIAL);
    const [rejecting, setRejecting] = useState(false);
    const [note, setNote] = useState("");
    const noteId = useId();

    // The action resolved for this row: drop it from the queue.
    if (state.status === "done" && state.siteId === row.id) {
        onHandled(row.id);
        return null;
    }

    const error = state.status === "error" && state.siteId === row.id ? state.message : null;

    return (
        <li className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent-text text-[17px] font-semibold underline underline-offset-4">
                    {row.domain}
                </a>
                <StatusPill status={row.status} />
                <span className="text-muted ml-auto font-mono text-[11.5px] tracking-[0.14em] uppercase">
                    {row.submitted}
                </span>
            </div>

            {/* The listing itself. This is the thing being judged. */}
            <p className="mt-4 text-[14.5px] leading-relaxed">{row.description}</p>

            <dl className="border-line mt-5 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-2">
                <Fact label="Category" value={row.category} />
                <Fact
                    label="Domain Rating"
                    value={row.domainRating == null ? "Not measured" : String(row.domainRating)}
                />
                <Fact label="Offering" value={row.placementOffered.replace(/_/g, " ")} />
                <Fact label="Submitted by" value={row.ownerEmail ?? "Member row missing"} />
                <Fact
                    label="Anchor phrases"
                    value={row.keywords.join(", ") || "None given"}
                    className="sm:col-span-2"
                />
                {row.reviewNote ? (
                    <Fact label="Previous note" value={row.reviewNote} className="sm:col-span-2" />
                ) : null}
            </dl>

            {error ? (
                <p
                    role="alert"
                    className="border-line bg-surface-2 mt-5 flex items-start gap-2.5 rounded-sm border p-4 text-[13.5px] leading-relaxed">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                </p>
            ) : null}

            <form action={formAction} className="mt-6">
                <input type="hidden" name="siteId" value={row.id} />

                {rejecting ? (
                    <div className="border-line bg-surface-2/60 rounded-sm border p-5">
                        <label htmlFor={noteId} className="block text-[14px] font-medium">
                            Why is this refused?
                        </label>
                        <p className="text-muted mt-1 text-[13px] leading-relaxed">
                            Sent to the member verbatim. /terms promises they are told why, so write it for them rather
                            than for the log.
                        </p>
                        <textarea
                            id={noteId}
                            name="reviewNote"
                            required
                            rows={3}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            className="border-line bg-bg focus:border-line-strong mt-3 w-full rounded-sm border p-3 text-[14px] leading-relaxed outline-none"
                        />
                        <div className="mt-4 flex flex-wrap gap-3">
                            <Action name="status" value="rejected" pending={pending} tone="danger" icon={X}>
                                Send rejection
                            </Action>
                            <button
                                type="button"
                                onClick={() => setRejecting(false)}
                                className="border-line hover:border-line-strong hover:bg-surface-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors">
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-3">
                        {row.status !== "active" ? (
                            <Action name="status" value="active" pending={pending} tone="primary" icon={Check}>
                                Approve
                            </Action>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => setRejecting(true)}
                            className="border-line hover:border-line-strong hover:bg-surface-2 inline-flex items-center gap-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors">
                            <X aria-hidden="true" className="size-4" />
                            Reject
                        </button>
                        {row.status !== "paused" ? (
                            <Action name="status" value="paused" pending={pending} icon={Pause}>
                                Pause
                            </Action>
                        ) : null}
                        {row.status !== "banned" ? (
                            <Action name="status" value="banned" pending={pending} icon={SlashCircle}>
                                Ban
                            </Action>
                        ) : null}
                    </div>
                )}
            </form>
        </li>
    );
}

function Action({
    name,
    value,
    pending,
    tone = "default",
    icon: Icon,
    children,
}: {
    name: string;
    value: string;
    pending: boolean;
    tone?: "default" | "primary" | "danger";
    icon: typeof Check;
    children: React.ReactNode;
}) {
    return (
        <button
            type="submit"
            name={name}
            value={value}
            disabled={pending}
            className={cn(
                "inline-flex items-center gap-2 rounded-sm px-5 py-2.5 text-[14.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                // --accent is a fill, never a text colour. See globals.css.
                tone === "primary" && "bg-accent text-accent-fg hover:bg-accent-hover",
                tone === "danger" && "border-line-strong hover:bg-surface-2 border",
                tone === "default" && "border-line hover:border-line-strong hover:bg-surface-2 border font-medium",
            )}>
            {pending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
                <Icon aria-hidden="true" className="size-4" />
            )}
            {children}
        </button>
    );
}

function Fact({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className={cn("bg-surface-2/60 p-4", className)}>
            <dt className="text-muted font-mono text-[10.5px] tracking-[0.14em] uppercase">{label}</dt>
            <dd className="mt-1 text-[14px] break-words">{value}</dd>
        </div>
    );
}

function StatusPill({ status }: { status: SiteStatus }) {
    return (
        <span
            className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase",
                status === "active"
                    ? "border-term-ok/40 bg-term-ok/10 text-term-ok"
                    : "border-line text-muted bg-surface-2",
            )}>
            {status.replace(/_/g, " ")}
        </span>
    );
}
