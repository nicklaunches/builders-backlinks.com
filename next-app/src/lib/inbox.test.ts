import assert from "node:assert/strict";
import { test } from "node:test";

import {
    NOTIFY_QUIET_MS,
    NOTIFY_THROTTLE_MS,
    attentionReason,
    buildTimeline,
    linkTaskState,
    linkifySegments,
    safeHref,
    shouldNotifyMessage,
    threadEvents,
    threadSteps,
} from "@/lib/inbox";

/**
 * @file The inbox's pure rules: the step rail, the derived timeline, the reply
 * throttle, and the linkifier.
 *
 * Everything here is a function of data the caller already has, which is the
 * whole reason `lib/inbox.ts` holds no database access: the rail and the
 * timeline are the two things most likely to be argued about, and arguing about
 * them should not need a Postgres.
 */

const HOUR = 60 * 60 * 1000;

/** A step rail keyed by step name, which is what every assertion below reads. */
function rail(input: Parameters<typeof threadSteps>[0]): Record<string, string> {
    return Object.fromEntries(threadSteps(input).map((s) => [s.step, s.status]));
}

test("the rail sits on decide until both sides have accepted", () => {
    assert.deepEqual(rail({ state: "b_accepted", myLinkStatus: null, theirLinkStatus: null }), {
        decide: "current",
        agree: "todo",
        add_links: "todo",
        live: "todo",
    });
});

test("agreement moves the rail to agree, and the first placement moves it to add links", () => {
    assert.equal(rail({ state: "agreed", myLinkStatus: null, theirLinkStatus: null }).agree, "current");
    assert.equal(rail({ state: "agreed", myLinkStatus: "live", theirLinkStatus: null }).add_links, "current");
});

test("both links live is the only thing that lights up live", () => {
    const both = rail({ state: "placed", myLinkStatus: "live", theirLinkStatus: "live" });
    assert.equal(both.add_links, "done");
    assert.equal(both.live, "current");
});

test("a closed match keeps decide done and never advances", () => {
    assert.deepEqual(rail({ state: "declined", myLinkStatus: null, theirLinkStatus: null }), {
        decide: "done",
        agree: "todo",
        add_links: "todo",
        live: "todo",
    });
});

test("a link that is recorded but not confirmed is in progress, not done", () => {
    assert.equal(linkTaskState(null), "not_started");
    assert.equal(linkTaskState({ status: "promised" }), "in_progress");
    assert.equal(linkTaskState({ status: "live" }), "live");
    assert.equal(linkTaskState({ status: "removed" }), "missing");
});

test("a reply is not mailed while the recipient is still looking at the thread", () => {
    const now = new Date("2026-08-26T12:00:00Z");
    assert.equal(
        shouldNotifyMessage({
            recipientLastReadAt: new Date(now.getTime() - NOTIFY_QUIET_MS + 1000),
            lastNotifiedAt: null,
            now,
        }),
        false,
    );
});

test("a reply is not mailed twice inside the throttle window", () => {
    const now = new Date("2026-08-26T12:00:00Z");
    assert.equal(
        shouldNotifyMessage({
            recipientLastReadAt: null,
            lastNotifiedAt: new Date(now.getTime() - NOTIFY_THROTTLE_MS + 1000),
            now,
        }),
        false,
    );
    assert.equal(
        shouldNotifyMessage({
            recipientLastReadAt: null,
            lastNotifiedAt: new Date(now.getTime() - NOTIFY_THROTTLE_MS - 1000),
            now,
        }),
        true,
    );
});

test("each side's acceptance is a separate event, told from the viewer's side", () => {
    const events = threadEvents({
        state: "agreed",
        proposedAt: new Date("2026-08-01T00:00:00Z"),
        aAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        bAcceptedAt: new Date("2026-08-03T00:00:00Z"),
        agreedAt: new Date("2026-08-03T00:00:00Z"),
        expiresAt: new Date("2026-09-01T00:00:00Z"),
        mineIsA: true,
        myDomain: "mine.com",
        partnerLabel: "theirs.com",
        links: [],
    });
    const accepts = events.filter((e) => e.id.startsWith("accept:"));
    assert.deepEqual(
        accepts.map((e) => e.text),
        ["You accepted the exchange.", "They accepted the exchange."],
    );
});

test("a link that was never confirmed produces no went-live event", () => {
    const events = threadEvents({
        state: "agreed",
        proposedAt: new Date("2026-08-01T00:00:00Z"),
        aAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        bAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        agreedAt: new Date("2026-08-02T00:00:00Z"),
        expiresAt: new Date("2026-09-01T00:00:00Z"),
        mineIsA: true,
        myDomain: "mine.com",
        partnerLabel: "theirs.com",
        links: [
            {
                id: "l1",
                fromMine: true,
                status: "promised",
                pageUrl: "https://mine.com/post",
                firstSeenAt: null,
                removedAt: null,
                createdAt: new Date("2026-08-03T00:00:00Z"),
            },
        ],
    });
    assert.equal(
        events.some((e) => e.id === "link:l1:live"),
        false,
    );
});

test("the timeline interleaves messages with events in time order", () => {
    const entries = buildTimeline({
        messages: [
            {
                id: "m1",
                body: "hi",
                mine: true,
                senderLabel: "You",
                createdAt: new Date("2026-08-02T12:00:00Z"),
            },
        ],
        events: [
            { id: "e1", at: new Date("2026-08-01T00:00:00Z"), text: "Matched." },
            { id: "e2", at: new Date("2026-08-03T00:00:00Z"), text: "They accepted." },
        ],
    });
    assert.deepEqual(
        entries.map((e) => e.id),
        ["e1", "m1", "e2"],
    );
});

test("the opening message names the partner only once identities are out", () => {
    const base = {
        proposedAt: new Date("2026-08-01T00:00:00Z"),
        aAcceptedAt: null,
        bAcceptedAt: null,
        agreedAt: null,
        expiresAt: new Date("2026-09-01T00:00:00Z"),
        mineIsA: true,
        myDomain: "mine.com",
        links: [],
    };

    const masked = threadEvents({ ...base, state: "proposed", partnerLabel: "A Marketing site" })[0];
    assert.equal(masked?.id, "opened");
    assert.equal(masked?.text.includes("A Marketing site"), true);

    const revealed = threadEvents({
        ...base,
        state: "agreed",
        agreedAt: new Date("2026-08-02T00:00:00Z"),
        partnerLabel: "theirs.com",
    })[0];
    assert.equal(revealed?.text.includes("theirs.com"), true);
    assert.equal(revealed?.text.includes("mine.com"), true);
});

test("agreement announces that both link tasks are ready", () => {
    const events = threadEvents({
        state: "agreed",
        proposedAt: new Date("2026-08-01T00:00:00Z"),
        aAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        bAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        agreedAt: new Date("2026-08-02T00:00:00Z"),
        expiresAt: new Date("2026-09-01T00:00:00Z"),
        mineIsA: true,
        myDomain: "mine.com",
        partnerLabel: "theirs.com",
        links: [],
    });
    assert.equal(
        events.some((e) => e.id === "agreed" && e.text.includes("link tasks are ready")),
        true,
    );
});

test("linkify only ever hands back an http or https href", () => {
    const segments = linkifySegments("see https://a.com and javascript:alert(1) and http://b.com/x?y=1");
    assert.deepEqual(
        segments.filter((s) => s.href).map((s) => s.href),
        ["https://a.com", "http://b.com/x?y=1"],
    );
});

test("linkify keeps the whole message, not just its links", () => {
    const body = "before https://a.com after";
    assert.equal(
        linkifySegments(body)
            .map((s) => s.text)
            .join(""),
        body,
    );
});

test("an expired match says so on the timeline", () => {
    const events = threadEvents({
        state: "expired",
        proposedAt: new Date("2026-08-01T00:00:00Z"),
        aAcceptedAt: null,
        bAcceptedAt: null,
        agreedAt: null,
        expiresAt: new Date("2026-08-15T00:00:00Z"),
        mineIsA: false,
        myDomain: "mine.com",
        partnerLabel: "A Marketing site",
        links: [],
    });
    assert.equal(events.at(-1)?.id, "expired");
    assert.equal(events.at(-1)?.at.getTime(), new Date("2026-08-15T00:00:00Z").getTime() + 0 * HOUR);
});

test("the opening message keeps naming the partner after an agreed match expires", () => {
    // Expiry closes the thread; it does not re-mask two members who have
    // already been introduced to each other.
    const opened = threadEvents({
        state: "expired",
        proposedAt: new Date("2026-08-01T00:00:00Z"),
        aAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        bAcceptedAt: new Date("2026-08-02T00:00:00Z"),
        agreedAt: new Date("2026-08-02T00:00:00Z"),
        expiresAt: new Date("2026-08-16T00:00:00Z"),
        mineIsA: true,
        myDomain: "mine.com",
        partnerLabel: "theirs.com",
        links: [],
    })[0];
    assert.equal(opened?.text.includes("are trading one editorial link each"), true);
});

test("safeHref hands back only http and https URLs", () => {
    assert.equal(safeHref("https://a.com/page?x=1"), "https://a.com/page?x=1");
    assert.equal(safeHref("http://a.com"), "http://a.com");
    assert.equal(safeHref("javascript:alert(1)"), null);
    assert.equal(safeHref("data:text/html,hi"), null);
    assert.equal(safeHref("not a url"), null);
    assert.equal(safeHref(null), null);
});

const QUIET = {
    state: "agreed" as const,
    step: "add_links" as const,
    unread: 0,
    waitingOnMe: false,
    canMessage: true,
    myTask: "live" as const,
};

test("an unread reply outranks an open task, and a closed thread needs nobody", () => {
    assert.equal(attentionReason({ ...QUIET, unread: 2, myTask: "not_started" }), "2 new messages");
    assert.equal(attentionReason({ ...QUIET, myTask: "not_started" }), "Add your link");
    assert.equal(attentionReason({ ...QUIET, state: "expired", unread: 2 }), null);
});

test("an undecided proposal needs a decision, one waiting on the other side does not", () => {
    const decide = { ...QUIET, step: "decide" as const, canMessage: false };
    assert.equal(attentionReason({ ...decide, state: "proposed" }), "Accept or decline");
    assert.equal(attentionReason({ ...decide, state: "b_accepted", waitingOnMe: true }), "Accept or decline");
    assert.equal(attentionReason({ ...decide, state: "a_accepted" }), null);
});
