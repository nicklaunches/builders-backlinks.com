import type { PlacementReport } from "@/lib/services/links";
import type { MessageView, ThreadDetail, ThreadSummary } from "@/lib/services/threads";

/**
 * @file What the inbox client and the inbox routes agree on.
 *
 * The client receives the same shape twice: once from the server component that
 * renders the page, and again from `/api/inbox/*` as it polls. Those two must be
 * the same type or every component ends up handling a `Date` and a string for
 * the same field. {@link Jsonified} states the difference once — JSON has no
 * date — and the server component runs its props through {@link asJson} so both
 * paths deliver the string form.
 */

/** A value as it survives `JSON.stringify`: dates become ISO strings. */
export type Jsonified<T> = T extends Date
    ? string
    : T extends (infer U)[]
      ? Jsonified<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonified<T[K]> }
        : T;

export type ThreadSummaryJson = Jsonified<ThreadSummary>;
export type ThreadDetailJson = Jsonified<ThreadDetail>;
export type MessageJson = Jsonified<MessageView>;
export type PlacementReportJson = Jsonified<PlacementReport>;

/**
 * Serializes server data exactly the way the API routes will.
 *
 * A round trip through JSON rather than a hand-written mapper: the mapper would
 * be a second definition of the payload, and the two would drift the first time
 * a field was added to only one of them.
 */
export function asJson<T>(value: T): Jsonified<T> {
    return JSON.parse(JSON.stringify(value)) as Jsonified<T>;
}

/** Fixed locale and zone, so a server render and a client render agree. */
const ABSOLUTE = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
});

const ABSOLUTE_WITH_TIME = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

export function formatDate(iso: string): string {
    return ABSOLUTE.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
    return `${ABSOLUTE_WITH_TIME.format(new Date(iso))} UTC`;
}

/**
 * "3m", "2h", "5d" — the inbox's own clock.
 *
 * Only ever rendered after mount (see `useMounted` in `relative-time.tsx`),
 * because "2h ago" computed on the server is a different string by the time it
 * hydrates and React would call that a mismatch.
 */
export function formatRelative(iso: string, now: number): string {
    const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return "now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d`;
    return formatDate(iso);
}

/** The error body every inbox route answers with. */
type ApiErrorBody = { error?: string; message?: string };

export class InboxRequestError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "InboxRequestError";
    }
}

/**
 * Calls an inbox route and unwraps it, or throws something worth showing.
 *
 * `credentials: "same-origin"` and the JSON content type are not decoration:
 * the routes refuse a mutation that does not look like it came from our own
 * pages, and that check is the CSRF defence a server action would have got for
 * free.
 */
export async function inboxFetch<T>(
    path: string,
    init?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
): Promise<T> {
    const method = init?.method ?? "GET";
    const response = await fetch(path, {
        method,
        credentials: "same-origin",
        signal: init?.signal,
        headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (!response.ok) {
        let message = "Something went wrong. Try again in a moment.";
        try {
            const body = (await response.json()) as ApiErrorBody;
            if (body.message) message = body.message;
        } catch {
            // A non-JSON error body (a proxy error page) leaves the default.
        }
        throw new InboxRequestError(response.status, message);
    }

    return (await response.json()) as T;
}

/** How often an open thread asks for new messages while the tab is visible. */
export const MESSAGE_POLL_MS = 6000;

/**
 * How far behind the newest message a poll's `since` cursor sits.
 *
 * Long enough to cover a slow commit on the other side, short enough that the
 * overlap re-fetches a handful of messages at most, all of which the client
 * already holds and drops by id.
 */
export const POLL_OVERLAP_MS = 10_000;

/**
 * Fired on `window` after a thread's read cursor moves.
 *
 * The tab bar lives in the `/app` layout, which a soft navigation does not
 * re-render, so its unread badge cannot learn from the server that the thread
 * just opened was read. This event is how the pane tells it, without a
 * `router.refresh()` that would reset the pane's own state.
 */
export const READ_EVENT = "inbox:read";

/** How often the thread list refreshes itself. Slower: it only moves badges. */
export const THREAD_POLL_MS = 30000;
