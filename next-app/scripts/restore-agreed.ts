import { config as loadEnv } from "dotenv";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { exchangeMatches, exchangeMembers, exchangeSites } from "@/lib/db/schema";
import { OPEN_MATCH_STATES } from "@/lib/exchange";

loadEnv({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

/**
 * @file One-shot repair for agreements the expiry sweep closed (v0.6.4).
 *
 * `expires_at` is stamped once at proposal and nothing moves it, and until
 * v0.6.4 the sweep ran on `agreed` too. So an acceptance landing late in the
 * proposal window produced an agreement the next nightly run expired — reveal
 * emails out, both link tasks ready, then gone. This puts those matches back.
 *
 * RUN IT ONLY AGAINST A DEPLOY THAT HAS v0.6.4. On an older build the next
 * recheck run re-expires everything restored here, and both members get a
 * second "that match expired" mail for the same match.
 *
 * WHAT "RUNWAY" MEANS, and why it is the number to read. It is
 * `expires_at - agreed_at`: how long the agreement had before a deadline set
 * before it existed. Near zero or negative is this bug outright. Several days
 * is an agreement that had a fair run and stalled anyway, which was the
 * intended behaviour at the time — restoring those is a product decision, not
 * a repair, so `--runway-under` exists to leave them out.
 *
 * THE SKIPS ARE THE POINT. Expiry put both sites back in the pool and many have
 * been paired since. Restoring one of those would leave a site holding two open
 * matches, which is the invariant `selectPartner` and the re-pair pass are both
 * built on. A site already spoken for is skipped and reported, never restored,
 * and a match restored earlier in the run makes its own two sites spoken for.
 *
 * `expires_at` is deliberately left where it is. It is the historical proposal
 * deadline and nothing reads it for an agreed match any more.
 *
 * No mail is sent from here. The next recheck run nudges whoever owes a link,
 * which is both sides when neither placed, and that mail already says the match
 * stays open until somebody places or withdraws.
 *
 *   pnpm exec tsx scripts/restore-agreed.ts                      # dry run, everything
 *   pnpm exec tsx scripts/restore-agreed.ts --runway-under=2     # dry run, the bug population
 *   pnpm exec tsx scripts/restore-agreed.ts --runway-under=2 --apply
 */

const APPLY = process.argv.includes("--apply");

/** `--runway-under=<days>`, or null for every candidate. */
const RUNWAY_UNDER_DAYS = ((): number | null => {
    const arg = process.argv.find((a) => a.startsWith("--runway-under="));
    if (!arg) return null;
    const days = Number(arg.split("=")[1]);
    if (!Number.isFinite(days)) {
        console.error(`Not a number of days: ${arg}`);
        process.exit(1);
    }
    return days;
})();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Candidate = {
    id: string;
    siteAId: string;
    siteBId: string;
    label: string;
    agreedAt: Date;
    /** `expires_at - agreed_at`. Negative when the deadline had already passed. */
    runwayMs: number;
    /** Why it cannot be restored, or null when it can. */
    blocked: string | null;
};

function formatRunway(ms: number): string {
    const hours = ms / HOUR_MS;
    if (Math.abs(hours) < 48) return `${hours.toFixed(1)}h`;
    return `${(ms / DAY_MS).toFixed(1)}d`;
}

function describe(c: Candidate): string {
    const agreed = c.agreedAt.toISOString().replace("T", " ").slice(0, 16);
    return `  ${c.label}\n      agreed ${agreed} UTC  |  runway ${formatRunway(c.runwayMs)}  |  ${c.id}${
        c.blocked ? `\n      SKIP: ${c.blocked}` : ""
    }`;
}

async function main() {
    console.log(`Restore of agreements closed by the expiry sweep (${APPLY ? "APPLYING" : "dry run"})`);
    console.log(RUNWAY_UNDER_DAYS === null ? "Every candidate.\n" : `Runway under ${RUNWAY_UNDER_DAYS}d only.\n`);

    const rows = await db()
        .select()
        .from(exchangeMatches)
        .where(and(eq(exchangeMatches.state, "expired"), isNotNull(exchangeMatches.agreedAt)));

    if (rows.length === 0) {
        console.log("No expired match ever reached agreement. Nothing to restore.");
        return;
    }

    const siteIds = [...new Set(rows.flatMap((r) => [r.siteAId, r.siteBId]))];
    const sites = await db().select().from(exchangeSites).where(inArray(exchangeSites.id, siteIds));
    const siteById = new Map(sites.map((s) => [s.id, s]));

    const owners = await db()
        .select({ userId: exchangeMembers.userId, email: exchangeMembers.email })
        .from(exchangeMembers)
        .where(
            inArray(
                exchangeMembers.userId,
                sites.map((s) => s.ownerId),
            ),
        );
    const emailByUser = new Map(owners.map((o) => [o.userId, o.email]));

    // Every site in the candidate set that is already holding an open match.
    // One query for all of them: this is the check that keeps a restore from
    // double-booking somebody who was re-paired after their match lapsed.
    const openRows = await db()
        .select({
            a: exchangeMatches.siteAId,
            b: exchangeMatches.siteBId,
            state: exchangeMatches.state,
            expiresAt: exchangeMatches.expiresAt,
        })
        .from(exchangeMatches)
        .where(
            and(
                inArray(exchangeMatches.state, [...OPEN_MATCH_STATES]),
                or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)),
            ),
        );

    // The blocking match's OTHER side is usually outside the candidate set, so
    // its domain has to be fetched to be named.
    const strangers = [...new Set(openRows.flatMap((r) => [r.a, r.b]))].filter((id) => !siteById.has(id));
    const strangerRows = strangers.length
        ? await db()
              .select({ id: exchangeSites.id, domain: exchangeSites.domain })
              .from(exchangeSites)
              .where(inArray(exchangeSites.id, strangers))
        : [];
    const domainById = new Map<string, string>([
        ...sites.map((s) => [s.id, s.domain] as const),
        ...strangerRows.map((s) => [s.id, s.domain] as const),
    ]);

    // What is blocking each site, who it is with, and when it clears — not just
    // that something is. A `proposed` that lapses on Friday is a wait, an
    // `agreed` is not, and an unanswered proposal is the one an operator can
    // decide to clear by hand. Soonest-clearing first, so a site blocked twice
    // reports the nearer date.
    const blockedBy = new Map<string, string>();
    for (const row of [...openRows].sort((x, y) => x.expiresAt.getTime() - y.expiresAt.getTime())) {
        for (const [id, otherId] of [
            [row.a, row.b],
            [row.b, row.a],
        ]) {
            if (blockedBy.has(id)) continue;
            const withWhom = `with ${domainById.get(otherId) ?? otherId}`;
            blockedBy.set(
                id,
                row.state === "agreed"
                    ? `agreed ${withWhom}, no deadline`
                    : `${row.state} ${withWhom}, lapses ${row.expiresAt.toISOString().slice(0, 10)}`,
            );
        }
    }
    const busy = new Set(blockedBy.keys());

    // Oldest agreement first, so a site that lost two matches to this gets the
    // one it agreed to first rather than whichever the query happened to return.
    const ordered = [...rows].sort((x, y) => (x.agreedAt?.getTime() ?? 0) - (y.agreedAt?.getTime() ?? 0));

    const candidates: Candidate[] = [];
    for (const row of ordered) {
        const agreedAt = row.agreedAt;
        if (!agreedAt) continue;

        const siteA = siteById.get(row.siteAId);
        const siteB = siteById.get(row.siteBId);
        const label = `${siteA?.domain ?? row.siteAId} <-> ${siteB?.domain ?? row.siteBId}`;
        const runwayMs = row.expiresAt.getTime() - agreedAt.getTime();

        let blocked: string | null = null;
        if (!siteA || !siteB) {
            blocked = "a site row is gone";
        } else if (siteA.status !== "active" || siteB.status !== "active") {
            const which = siteA.status !== "active" ? siteA : siteB;
            blocked = `${which.domain} is ${which.status}, not active`;
        } else if (busy.has(row.siteAId) || busy.has(row.siteBId)) {
            const which = busy.has(row.siteAId) ? siteA : siteB;
            blocked = `${which.domain} already holds an open match (${blockedBy.get(which.id)})`;
        } else if (RUNWAY_UNDER_DAYS !== null && runwayMs >= RUNWAY_UNDER_DAYS * DAY_MS) {
            blocked = `runway ${formatRunway(runwayMs)} is over the threshold`;
        }

        // A restore occupies both sites for every candidate after it, exactly as
        // the real match would. Without this, two lapsed matches sharing a site
        // both look free and the run creates the double-booking it is avoiding.
        if (blocked === null) {
            for (const id of [row.siteAId, row.siteBId]) {
                busy.add(id);
                blockedBy.set(id, "restored earlier in this run");
            }
        }

        candidates.push({ id: row.id, siteAId: row.siteAId, siteBId: row.siteBId, label, agreedAt, runwayMs, blocked });
    }

    const restorable = candidates.filter((c) => c.blocked === null);
    const skipped = candidates.filter((c) => c.blocked !== null);

    console.log(`${candidates.length} expired match(es) had reached agreement.\n`);
    console.log(`RESTORABLE (${restorable.length}):`);
    console.log(restorable.length ? restorable.map(describe).join("\n") : "  none");
    console.log(`\nSKIPPED (${skipped.length}):`);
    console.log(skipped.length ? skipped.map(describe).join("\n") : "  none");

    if (restorable.length === 0) {
        console.log("\nNothing to restore.");
        return;
    }

    const contacts = restorable.flatMap((c) =>
        [c.siteAId, c.siteBId].map((id) => {
            const site = siteById.get(id);
            return site ? `${site.domain} (${emailByUser.get(site.ownerId) ?? "NO EMAIL"})` : id;
        }),
    );
    console.log(`\nThe next recheck run nudges whoever owes a link among:\n  ${contacts.join("\n  ")}`);

    if (!APPLY) {
        console.log(`\nDry run. ${restorable.length} match(es) would go back to agreed. Re-run with --apply.`);
        return;
    }

    let restored = 0;
    let missed = 0;
    for (const c of restorable) {
        // Guarded on the state it was read in: this runs against a live database
        // and a member may have been doing something with the row meanwhile.
        const [row] = await db()
            .update(exchangeMatches)
            .set({ state: "agreed", updatedAt: new Date() })
            .where(and(eq(exchangeMatches.id, c.id), eq(exchangeMatches.state, "expired")))
            .returning({ id: exchangeMatches.id });

        if (row) {
            console.log(`  RESTORED  ${c.label}`);
            restored++;
        } else {
            console.log(`  MOVED     ${c.label} — no longer expired, left alone`);
            missed++;
        }
    }

    console.log(`\n${restored} restored, ${missed} left alone.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
