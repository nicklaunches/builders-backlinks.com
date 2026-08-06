import { config as loadEnv } from "dotenv";
import { inArray, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { exchangeMatches, exchangeMembers, exchangeSites, users } from "@/lib/db/schema";
import { OPEN_MATCH_STATES } from "@/lib/exchange";

loadEnv({ path: ".env.local", quiet: true });

/**
 * @file End-to-end test for the daily re-pair pass in `api/cron/recheck`.
 *
 * `pnpm test:mcp` covers the agent surface and cannot reach this: the pass is a
 * cron route, not a tool. It went out with no end-to-end cover at all, and the
 * two defects it shipped with were both invisible to unit tests because both
 * were about what a SEQUENCE of calls does to a shared pool:
 *
 *  1. Three idle sites in one category produced two matches pointing at the same
 *     middle site, and two `match-proposed` emails to somebody who had answered
 *     neither. Nothing that scores one pair in isolation can see that.
 *  2. The dry run reported a pairing in exactly the state where the live run
 *     writes nothing, so the rehearsal an operator is told to trust before
 *     letting the job send overcounted.
 *
 * So the shape of this file is: put the pool in a known state, ask what the pass
 * WOULD do, let it do it, and check those two answers against each other and
 * against the database. Three sites rather than two deliberately — an odd number
 * is what forces a partner to be the best remaining choice for two subjects at
 * once, which is the whole of defect 1.
 *
 * Usage:
 *   pnpm dev                              (in another shell, on PORT=3100)
 *   pnpm test:cron
 *
 * LOCALHOST ONLY, and it refuses anything else. The live half of this really
 * does propose matches and really does send, so pointing it at production would
 * mail strangers. `?dry=1` against production is a legitimate thing to do by
 * hand — see CLAUDE.md — but it is not this.
 *
 * Seeded members use the SES simulator, so a machine that happens to have real
 * AWS credentials in `.env.local` sends into a black hole that is exempt from
 * both the suppression list and reputation, rather than hard-bouncing a `.test`
 * address and poisoning the sending domain for every other project on the
 * account.
 */

const BASE = process.env.CRON_SMOKE_BASE ?? "http://localhost:3100";
const SECRET = process.env.CRON_SECRET;
const CATEGORY = "Developer Tools";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  ok   ${label}`);
    } else {
        failed++;
        console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
    }
}

type PairRow = { site: string; partner?: string; score?: number; matchId?: string; skipped?: string };
type Repair = { dryRun: boolean; idle: number; paired: number; failed: number; pairs: PairRow[] };

async function runPass(dry: boolean): Promise<Repair> {
    const response = await fetch(`${BASE}/api/cron/recheck${dry ? "?dry=1" : ""}`, {
        headers: { Authorization: `Bearer ${SECRET}` },
    });
    if (!response.ok) {
        throw new Error(`recheck returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return ((await response.json()) as { repair: Repair }).repair;
}

/** Open matches per seeded site id, straight from the database. */
async function openMatchCounts(siteIds: string[]): Promise<Map<string, number>> {
    const rows = await db()
        .select({ a: exchangeMatches.siteAId, b: exchangeMatches.siteBId, state: exchangeMatches.state })
        .from(exchangeMatches)
        .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));

    const counts = new Map(siteIds.map((id) => [id, 0]));
    for (const row of rows) {
        if (!(OPEN_MATCH_STATES as readonly string[]).includes(row.state)) continue;
        for (const id of [row.a, row.b]) {
            if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    return counts;
}

/** The subjects a pass reported pairing, as a comparable sorted list. */
function pairedSubjects(repair: Repair): string[] {
    return repair.pairs
        .filter((p) => !p.skipped)
        .map((p) => p.site)
        .sort();
}

async function main() {
    const host = new URL(BASE).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
        console.error(`refusing to run against ${BASE}: this test proposes real matches and sends real email`);
        process.exit(1);
    }
    if (!SECRET) {
        console.error("CRON_SECRET is not set, and the route fails closed without it");
        process.exit(1);
    }

    console.log(`cron smoke test against ${BASE}\n`);

    const stamp = Date.now();
    const seeded = ["a", "b", "c"].map((letter) => ({
        letter,
        userId: undefined as string | undefined,
        siteId: undefined as string | undefined,
        domain: `cron-smoke-${letter}-${stamp}.test`,
        email: `success+cron-smoke-${letter}-${stamp}@simulator.amazonses.com`,
    }));

    const userIds: string[] = [];

    try {
        for (const site of seeded) {
            const [user] = await db().insert(users).values({ email: site.email }).returning({ id: users.id });
            site.userId = user.id;
            userIds.push(user.id);

            await db().insert(exchangeMembers).values({
                userId: user.id,
                email: site.email,
                verifiedAt: new Date(),
            });

            const [row] = await db()
                .insert(exchangeSites)
                .values({
                    ownerId: user.id,
                    domain: site.domain,
                    url: `https://${site.domain}`,
                    category: CATEGORY,
                    description: `Throwaway listing ${site.letter} for the re-pair pass test.`,
                    keywords: ["one", "two"],
                    placementOffered: "blog_post",
                    domainRating: 30,
                    status: "active",
                })
                .returning({ id: exchangeSites.id });
            site.siteId = row.id;
        }

        const siteIds = seeded.map((s) => s.siteId!);
        const domains = new Set(seeded.map((s) => s.domain));
        const ours = (repair: Repair): Repair => ({
            ...repair,
            pairs: repair.pairs.filter((p) => domains.has(p.site)),
        });

        // --- the rehearsal --------------------------------------------------
        console.log("dry run");
        const dry = ours(await runPass(true));

        // Accounted for, not necessarily listed as a subject. A site chosen as
        // somebody's partner is skipped when its own turn comes round, so a
        // three-site pool reports two rows and not three: one pairing, one
        // refusal, and the partner named inside the first row.
        const accountedFor = new Set([...dry.pairs.map((p) => p.site), ...dry.pairs.map((p) => p.partner)]);
        check(
            "every seeded site is accounted for, as a subject or as a partner",
            seeded.every((s) => accountedFor.has(s.domain)),
            `saw ${[...accountedFor].filter(Boolean).join(", ")}`,
        );

        // Defect 1, as the rehearsal would have shown it. A partner named twice
        // is a member about to be handed two matches in one night.
        const dryPartners = dry.pairs.map((p) => p.partner).filter(Boolean) as string[];
        check(
            "no partner is offered to two different sites",
            new Set(dryPartners).size === dryPartners.length,
            `partners named: ${dryPartners.join(", ")}`,
        );

        check(
            "the odd site out is reported honestly, not paired anyway",
            dry.pairs.some((p) => p.skipped === "no_eligible_partner"),
            JSON.stringify(dry.pairs),
        );

        check(
            "a rehearsed score is the integer that would be stored",
            dry.pairs.filter((p) => p.score != null).every((p) => Number.isInteger(p.score)),
            JSON.stringify(dry.pairs.map((p) => p.score)),
        );

        check(
            "the dry run wrote nothing",
            (await openMatchCounts(siteIds)).values().every((n) => n === 0),
        );

        // --- the real thing, from the same state ------------------------------
        console.log("\nlive run");
        const live = ours(await runPass(false));

        // The point of the rehearsal. These two ran against an identical pool,
        // because the dry half writes nothing for the live half to see.
        check(
            "the live run pairs exactly what the dry run predicted",
            JSON.stringify(pairedSubjects(dry)) === JSON.stringify(pairedSubjects(live)),
            `dry: ${pairedSubjects(dry).join(", ")} | live: ${pairedSubjects(live).join(", ")}`,
        );

        const counts = await openMatchCounts(siteIds);
        check(
            "no site is left holding more than one open match",
            counts.values().every((n) => n <= 1),
            [...counts].map(([id, n]) => `${seeded.find((s) => s.siteId === id)?.domain}: ${n}`).join(", "),
        );

        check(
            "the pass actually paired somebody",
            live.pairs.some((p) => p.matchId),
            JSON.stringify(live.pairs),
        );

        // --- idempotency ------------------------------------------------------
        //
        // The pass runs nightly against a pool that mostly has not changed. If a
        // second run proposes anything, every member hears from us every night.
        console.log("\nsecond live run");
        const before = await db()
            .select({ id: exchangeMatches.id })
            .from(exchangeMatches)
            .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));

        const again = ours(await runPass(false));
        check(
            "a repeat run proposes nothing",
            again.pairs.every((p) => !p.matchId),
            JSON.stringify(again.pairs),
        );

        const after = await db()
            .select({ id: exchangeMatches.id })
            .from(exchangeMatches)
            .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));
        check(
            "a repeat run writes no new match row",
            before.length === after.length,
            `${before.length} before, ${after.length} after`,
        );

        // --- the settled pair -------------------------------------------------
        //
        // `already_matched` is the branch that keeps the nightly run silent once
        // a pair has been through it, and it is reached ONLY when the best
        // remaining candidate is one this site already has a row with. Declining
        // frees both sites back into the idle pool without erasing that row.
        //
        // The third site has to be taken out of the pool to get there, and that
        // is the point rather than a convenience: leave it in and the two
        // declining sites simply pair with it instead, which is correct
        // behaviour and tests nothing. A decline is not a reason to stop
        // matching somebody, it is a reason to stop matching them TO EACH OTHER.
        console.log("\nafter a decline, with no fresh partner left");
        await db()
            .update(exchangeMatches)
            .set({ state: "declined" })
            .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));

        const [declined] = await db()
            .select({ id: exchangeMatches.id, a: exchangeMatches.siteAId, b: exchangeMatches.siteBId })
            .from(exchangeMatches)
            .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));

        const spare = siteIds.find((id) => id !== declined.a && id !== declined.b)!;
        await db()
            .update(exchangeSites)
            .set({ status: "paused" })
            .where(inArray(exchangeSites.id, [spare]));

        const dryAfter = ours(await runPass(true));
        const liveAfter = ours(await runPass(false));

        // Defect 2 exactly: this is the state where the rehearsal used to claim
        // a pairing and the run then wrote nothing.
        check(
            "the rehearsal agrees with the run once a pair has already been offered",
            JSON.stringify(pairedSubjects(dryAfter)) === JSON.stringify(pairedSubjects(liveAfter)),
            `dry: ${JSON.stringify(dryAfter.pairs)} | live: ${JSON.stringify(liveAfter.pairs)}`,
        );
        check(
            "both sides of a declined pair report already_matched",
            liveAfter.pairs.length === 2 && liveAfter.pairs.every((p) => p.skipped === "already_matched"),
            JSON.stringify(liveAfter.pairs),
        );

        const rows = await db()
            .select({ id: exchangeMatches.id, state: exchangeMatches.state })
            .from(exchangeMatches)
            .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));
        check(
            "the declined row is left alone rather than revived or duplicated",
            rows.length === 1 && rows[0].id === declined.id && rows[0].state === "declined",
            JSON.stringify(rows),
        );
    } finally {
        // Matches reference sites, which cascade off the owner. Delete the
        // matches first so nothing is left pointing at a row that is going away.
        const siteIds = seeded.map((s) => s.siteId).filter(Boolean) as string[];
        if (siteIds.length > 0) {
            await db()
                .delete(exchangeMatches)
                .where(or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds)));
        }
        if (userIds.length > 0) {
            await db().delete(users).where(inArray(users.id, userIds));
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("\ncron smoke test crashed:", err);
    process.exit(1);
});
