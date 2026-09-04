import { type LinkStatus, type MatchState, isRevealed } from "@/lib/exchange";

/**
 * @file The inbox's pure rules. No database, no network, no React.
 *
 * The thread view has to answer three questions that are all functions of rows
 * the caller already holds: where is this exchange on the rail, what happened
 * and when, and is a reply worth an email. Keeping them here means each one can
 * be argued about in a unit test rather than through a seeded Postgres, and it
 * is the same bargain `lib/matching/score.ts` and `lib/exchange.ts` already take.
 *
 * ON THE FOUR STEPS. They are named for what a member does, not for a match
 * state, because `agreed` alone covers three situations (nobody has placed, one
 * side has, both have but one is unconfirmed) and a rail that cannot separate
 * them is decoration. The mapping is in {@link threadSteps} and is the only
 * place it exists.
 *
 * ON DERIVED EVENTS. There is no event table. Every system line on the timeline
 * is reconstructed from timestamps the product already stores, which is why
 * `a_accepted_at` and `b_accepted_at` were added: `state` says where a match got
 * to and `agreed_at` says when both sides were in, so without them the first
 * acceptance has no time to be placed at. Matches that predate those columns
 * have NULLs and simply contribute no accept lines, which is the honest result.
 */

/**
 * The longest message the exchange accepts.
 *
 * Lives here, in the module with no database import, because the composer in the
 * browser needs the same number: importing it from the service would drag
 * Drizzle into the client bundle.
 */
export const MESSAGE_MAX_LENGTH = 4000;

/** The rail, in order. The ids are also the query-free React keys. */
export const THREAD_STEPS = ["decide", "agree", "add_links", "live"] as const;

export type ThreadStep = (typeof THREAD_STEPS)[number];

export type StepStatus = "done" | "current" | "todo";

export type ThreadStepView = {
    step: ThreadStep;
    label: string;
    status: StepStatus;
};

const STEP_LABELS: Record<ThreadStep, string> = {
    decide: "Decide",
    agree: "Agree",
    add_links: "Add links",
    live: "Live",
};

/**
 * Where an exchange sits on the four-step rail.
 *
 * A closed match (`declined`, `expired`) keeps `decide` done and advances no
 * further: a decision was reached, it just was not agreement. The thread renders
 * a closed banner over the rail rather than pretending there is a next step.
 */
export function threadSteps(input: {
    state: MatchState;
    myLinkStatus: LinkStatus | null;
    theirLinkStatus: LinkStatus | null;
}): ThreadStepView[] {
    const { state, myLinkStatus, theirLinkStatus } = input;

    const bothLive = myLinkStatus === "live" && theirLinkStatus === "live";
    const anyPlacement = myLinkStatus !== null || theirLinkStatus !== null;

    const current: ThreadStep | null = !isRevealed(state)
        ? state === "declined" || state === "expired"
            ? null
            : "decide"
        : bothLive
          ? "live"
          : anyPlacement
            ? "add_links"
            : "agree";

    const reached = current === null ? 1 : THREAD_STEPS.indexOf(current);

    return THREAD_STEPS.map((step, index) => ({
        step,
        label: STEP_LABELS[step],
        status: index < reached ? "done" : index === reached && current !== null ? "current" : "todo",
    }));
}

/** What one direction of the trade is waiting on. */
export type TaskState = "not_started" | "in_progress" | "live" | "missing";

/**
 * One direction of the trade, as the task rows above the timeline read it.
 *
 * `promised` is deliberately NOT "done": it means a page was recorded and the
 * crawl could not confirm the link on it, which is exactly the case a member
 * needs to see, and calling it done is how a half-finished exchange looks
 * finished to both sides.
 */
export function linkTaskState(link: { status: LinkStatus } | null): TaskState {
    if (!link) return "not_started";
    switch (link.status) {
        case "live":
            return "live";
        case "promised":
            return "in_progress";
        case "missing":
        case "removed":
            return "missing";
    }
}

/** How long after someone last opened a thread we assume they are still in it. */
export const NOTIFY_QUIET_MS = 15 * 60 * 1000;

/** Minimum gap between two reply emails for one thread. */
export const NOTIFY_THROTTLE_MS = 3 * 60 * 60 * 1000;

/**
 * Whether a new message is worth an email.
 *
 * Two suppressions, in order: a thread that already mailed inside the throttle
 * window stays quiet, and a recipient who has looked at the thread within
 * {@link NOTIFY_QUIET_MS} is treated as present and reading. A chat between two
 * people typing at each other would otherwise be a mail per line.
 */
export function shouldNotifyMessage(input: {
    recipientLastReadAt: Date | null;
    lastNotifiedAt: Date | null;
    now: Date;
}): boolean {
    const { recipientLastReadAt, lastNotifiedAt, now } = input;
    if (lastNotifiedAt && now.getTime() - lastNotifiedAt.getTime() < NOTIFY_THROTTLE_MS) return false;
    if (recipientLastReadAt && now.getTime() - recipientLastReadAt.getTime() < NOTIFY_QUIET_MS) return false;
    return true;
}

/** A system line on the timeline: something the exchange did, not something anyone said. */
export type ThreadEvent = {
    /** Stable across re-renders and pages, so React keys do not thrash. */
    id: string;
    at: Date;
    text: string;
};

type EventLink = {
    id: string;
    fromMine: boolean;
    status: LinkStatus;
    pageUrl: string | null;
    firstSeenAt: Date | null;
    removedAt: Date | null;
    createdAt: Date;
};

/**
 * Rebuilds the system half of a thread from the timestamps the product stores.
 *
 * Every line is anchored to a real column. A link only produces a went-live line
 * when `firstSeenAt` is set, because that column is the only record that a crawl
 * actually saw it: a `promised` row means the opposite, and announcing it as
 * live is the one lie this timeline could tell.
 */
export function threadEvents(input: {
    state: MatchState;
    proposedAt: Date;
    aAcceptedAt: Date | null;
    bAcceptedAt: Date | null;
    agreedAt: Date | null;
    expiresAt: Date;
    /** Which side of the stored pair the viewer is on, so lines can say "you". */
    mineIsA: boolean;
    /** The viewer's own domain, for the opening line. */
    myDomain: string;
    /** The partner's domain once revealed, or the masked description before. */
    partnerLabel: string;
    links: EventLink[];
}): ThreadEvent[] {
    const { state, mineIsA } = input;

    // The opener. A thread that starts with someone's first reply gives no
    // context for what the two of them are supposed to agree on, so the exchange
    // says it first, and says a different thing on each side of the reveal.
    const events: ThreadEvent[] = [
        {
            id: "opened",
            at: input.proposedAt,
            text: isRevealed(state, input.agreedAt)
                ? `${input.myDomain} and ${input.partnerLabel} are trading one editorial link each. Agree here which page each link goes on, then paste your published URL above and we will verify it.`
                : `The exchange paired ${input.myDomain} with ${input.partnerLabel}. Accept and, if they accept too, you are revealed to each other and can talk here.`,
        },
    ];

    const mineAccepted = mineIsA ? input.aAcceptedAt : input.bAcceptedAt;
    const theirsAccepted = mineIsA ? input.bAcceptedAt : input.aAcceptedAt;
    if (mineAccepted) {
        events.push({ id: `accept:${mineIsA ? "a" : "b"}`, at: mineAccepted, text: "You accepted the exchange." });
    }
    if (theirsAccepted) {
        events.push({ id: `accept:${mineIsA ? "b" : "a"}`, at: theirsAccepted, text: "They accepted the exchange." });
    }
    if (input.agreedAt) {
        events.push({
            id: "agreed",
            at: input.agreedAt,
            text: "Accepted on both sides. Domains are visible to each other and both link tasks are ready.",
        });
    }

    for (const link of input.links) {
        const who = link.fromMine ? "Your" : "Their";
        events.push({
            id: `link:${link.id}:recorded`,
            at: link.createdAt,
            text: link.pageUrl ? `${who} placement was recorded: ${link.pageUrl}` : `${who} placement was recorded.`,
        });
        if (link.firstSeenAt) {
            events.push({ id: `link:${link.id}:live`, at: link.firstSeenAt, text: `${who} link was verified live.` });
        }
        if (link.removedAt) {
            events.push({ id: `link:${link.id}:removed`, at: link.removedAt, text: `${who} link came down.` });
        }
    }

    if (state === "expired") {
        events.push({
            id: "expired",
            at: input.expiresAt,
            text: "This match expired and both sites went back in the pool.",
        });
    }

    return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export type TimelineMessage = {
    id: string;
    body: string;
    mine: boolean;
    senderLabel: string;
    createdAt: Date;
};

export type TimelineEntry =
    | { kind: "event"; id: string; at: Date; text: string }
    | { kind: "message"; id: string; at: Date; body: string; mine: boolean; senderLabel: string };

/**
 * Merges the two halves of a thread into one time-ordered list.
 *
 * Events sort ahead of a message written in the same millisecond, so "they
 * accepted" reads before the message that acceptance prompted.
 */
export function buildTimeline(input: { messages: TimelineMessage[]; events: ThreadEvent[] }): TimelineEntry[] {
    const entries: TimelineEntry[] = [
        ...input.events.map((e) => ({ kind: "event" as const, id: e.id, at: e.at, text: e.text })),
        ...input.messages.map((m) => ({
            kind: "message" as const,
            id: m.id,
            at: m.createdAt,
            body: m.body,
            mine: m.mine,
            senderLabel: m.senderLabel,
        })),
    ];
    return entries.sort((a, b) => {
        const delta = a.at.getTime() - b.at.getTime();
        if (delta !== 0) return delta;
        return a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1;
    });
}

/** One run of message text, with an href when that run is a link. */
export type TextSegment = { text: string; href: string | null };

/**
 * Splits a message body into plain runs and linkable runs.
 *
 * The scheme allowlist is the point: a member types the text, and `javascript:`
 * or `data:` in an href is a script the other member's browser would run. Only
 * `http` and `https` are ever handed back, and everything else stays text.
 * Trailing punctuation is left outside the link so "see https://a.com." does not
 * link the full stop.
 */
export function linkifySegments(body: string): TextSegment[] {
    const pattern = /https?:\/\/[^\s<>"']+/gi;
    const segments: TextSegment[] = [];
    let cursor = 0;

    for (const match of body.matchAll(pattern)) {
        const start = match.index;
        let url = match[0];
        let trailing = "";
        while (url.length > 0 && /[.,;:!?)\]}]$/.test(url)) {
            trailing = url.slice(-1) + trailing;
            url = url.slice(0, -1);
        }
        if (start > cursor) segments.push({ text: body.slice(cursor, start), href: null });
        if (url.length > 0) segments.push({ text: url, href: url });
        if (trailing) segments.push({ text: trailing, href: null });
        cursor = start + match[0].length;
    }

    if (cursor < body.length) segments.push({ text: body.slice(cursor), href: null });
    return segments;
}

/**
 * An href for a URL a member typed, or null when it must stay text.
 *
 * The same rule as {@link linkifySegments}, for a URL that arrives whole rather
 * than inside a message: a recorded page URL is rendered as a link on the OTHER
 * member's screen, and only `http` and `https` are ever handed to an anchor.
 */
export function safeHref(url: string | null): string | null {
    if (!url) return null;
    try {
        const { protocol } = new URL(url);
        return protocol === "http:" || protocol === "https:" ? url : null;
    } catch {
        return null;
    }
}
