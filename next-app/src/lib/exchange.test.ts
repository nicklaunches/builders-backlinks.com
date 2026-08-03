import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GIVE_UP_AFTER_CHECKS, nextCheckAt } from "@/lib/exchange";

/**
 * @file The recheck schedule.
 *
 * `nextCheckAt` is pure, and it decides how much work the daily cron does. The
 * bug these cases exist for was silent in exactly the way a schedule bug is:
 * the due date was computed from `firstSeenAt`, so from the second check onward
 * it never moved again, every live link was due on every run, and the job still
 * looked like it was working because the batch cap held the cost down.
 *
 * So the assertions are about the SEQUENCE, not a single call. A schedule that
 * advances once and then stops passes any test that only checks one hop.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Day 0 of every case below, so the expected dates read as "day N". */
const T0 = new Date("2026-01-01T00:00:00.000Z");
const day = (n: number) => new Date(T0.getTime() + n * DAY);

/**
 * Walks the schedule the way the cron does: check when due, then ask again.
 *
 * Starts where `markLinkPlaced` leaves a link — checked once, on day 0 — rather
 * than from nothing, because that is the state every real link is in by the
 * time this function first sees it.
 *
 * @returns The day number of each subsequent check.
 */
function scheduleDays(
    link: { status: "promised" | "live" | "missing"; firstSeenAt: Date | null; createdAt: Date },
    hops: number,
): number[] {
    let lastCheckedAt = T0;
    let checkCount = 1;
    const days: number[] = [];

    for (let i = 0; i < hops; i++) {
        const due = nextCheckAt({ ...link, lastCheckedAt, checkCount });
        if (due === null) break;
        lastCheckedAt = due;
        checkCount++;
        days.push(Math.round((due.getTime() - T0.getTime()) / DAY));
    }
    return days;
}

describe("nextCheckAt", () => {
    it("puts a live link on day 7, day 30, then monthly, and keeps going", () => {
        const live = { status: "live" as const, firstSeenAt: T0, createdAt: T0 };
        assert.deepEqual(scheduleDays(live, 6), [7, 30, 60, 90, 120, 150]);
    });

    it("advances the due date past the last check, never past the first sighting", () => {
        // The regression itself. A link first seen on day 0 and checked on days
        // 0, 7 and 30 is next due on day 60 — not on `firstSeenAt + 30`, which
        // is the date it was checked on and has therefore already passed.
        const due = nextCheckAt({
            status: "live",
            firstSeenAt: T0,
            lastCheckedAt: day(30),
            checkCount: 3,
        });
        assert.ok(due !== null);
        assert.deepEqual(due, day(60));
        assert.ok(due > day(30), "a link checked today must not already be due");
    });

    it("schedules a link that has never been checked from when it was created", () => {
        assert.deepEqual(nextCheckAt({ status: "promised", firstSeenAt: null, createdAt: T0, checkCount: 0 }), day(1));
    });

    it("retries a promised link daily, then backs off", () => {
        const promised = { status: "promised" as const, firstSeenAt: null, createdAt: T0 };
        assert.deepEqual(scheduleDays(promised, 5), [1, 2, 3, 10, 17]);
    });

    it("retries a missing link on the same cadence, so a restored link is noticed", () => {
        const missing = { status: "missing" as const, firstSeenAt: T0, createdAt: T0 };
        assert.deepEqual(scheduleDays(missing, 4), [1, 2, 3, 10]);
    });

    it("gives up on a link that has never been live", () => {
        assert.equal(
            nextCheckAt({
                status: "missing",
                firstSeenAt: null,
                createdAt: T0,
                lastCheckedAt: day(20),
                checkCount: GIVE_UP_AFTER_CHECKS,
            }),
            null,
        );
    });

    it("never gives up on a link that was live once", () => {
        // The whole point of the job: a link that came down six weeks ago is
        // the one most worth looking at, however many times it has been checked.
        const due = nextCheckAt({
            status: "missing",
            firstSeenAt: T0,
            createdAt: T0,
            lastCheckedAt: day(200),
            checkCount: GIVE_UP_AFTER_CHECKS * 10,
        });
        assert.deepEqual(due, day(207));
    });

    it("never schedules a removed link", () => {
        assert.equal(
            nextCheckAt({ status: "removed", firstSeenAt: T0, createdAt: T0, lastCheckedAt: T0, checkCount: 3 }),
            null,
        );
    });
});
