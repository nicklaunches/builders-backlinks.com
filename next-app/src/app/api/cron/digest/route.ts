import { and, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { candidateCategories } from "@/lib/categories";
import { db } from "@/lib/db";
import { exchangeMatches, exchangeMembers, exchangeSites } from "@/lib/db/schema";
import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { notifyDigest } from "@/lib/email/notify";
import { toMaskedPartner } from "@/lib/services/mask";
import { NO_LINKS, liveLinkCounts } from "@/lib/services/standing";

/**
 * @file The weekly digest: the other half of the matching mechanic.
 *
 * Instant auto-pair covers the member who joins when a partner is already
 * waiting. This covers everyone else, which early on is nearly everyone. A
 * member who joined an empty category and never heard from us again is the
 * single most common way a matching product loses someone in its first month.
 *
 * THE RULE THAT MATTERS: never send an empty digest. An email that says "no
 * matches this week" is worse than silence, because it converts a quiet
 * expectation into a visible disappointment and gets the sender filtered. If
 * there is nothing to say, this stays quiet and tries again next week.
 *
 * Members with an open match are skipped too. They already have something to
 * act on, and nudging them toward new candidates while one is pending is how
 * you end up with a pile of half-answered proposals.
 *
 * Both sweeps here order by a nullable timestamp and both ask for NULLS FIRST
 * explicitly. A member who has never been sent a digest, and a site that has
 * never been matched, are the most overdue rows in their respective tables.
 * Postgres sorts NULLs last on an ascending sort, so left implicit this cron
 * would serve everyone except the people it exists for.
 */

export const maxDuration = 60;

/** Members per run. Keeps one invocation inside its time and send budget. */
const BATCH = 50;

/** Candidates shown per digest. */
const MAX_CANDIDATES = 5;

const CADENCE_DAYS: Record<string, number> = { weekly: 7, biweekly: 14 };

/** States that still want a decision from somebody. */
const OPEN_STATES = ["proposed", "a_accepted", "b_accepted", "agreed"] as const;

export async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    const now = new Date();

    const members = await db()
        .select()
        .from(exchangeMembers)
        .where(and(isNull(exchangeMembers.unsubscribedAt), ne(exchangeMembers.digestCadence, "paused")))
        .orderBy(sql`${exchangeMembers.lastDigestSentAt} asc nulls first`)
        .limit(BATCH * 2);

    let sent = 0;
    let skippedNoSites = 0;
    let skippedOpenMatch = 0;
    let skippedNoCandidates = 0;
    let skippedNotDue = 0;

    for (const member of members) {
        if (sent >= BATCH) break;

        const dueAfterDays = CADENCE_DAYS[member.digestCadence] ?? 7;
        if (member.lastDigestSentAt) {
            const dueAt = new Date(member.lastDigestSentAt.getTime() + dueAfterDays * 24 * 60 * 60 * 1000);
            if (dueAt > now) {
                skippedNotDue++;
                continue;
            }
        }

        const sites = await db()
            .select()
            .from(exchangeSites)
            .where(and(eq(exchangeSites.ownerId, member.userId), eq(exchangeSites.status, "active")));
        if (sites.length === 0) {
            skippedNoSites++;
            continue;
        }

        const siteIds = sites.map((s) => s.id);
        const involvesMe = or(inArray(exchangeMatches.siteAId, siteIds), inArray(exchangeMatches.siteBId, siteIds));

        // Anything still awaiting a decision counts as an open match.
        const openMatch = await db()
            .select({ id: exchangeMatches.id })
            .from(exchangeMatches)
            .where(and(involvesMe, inArray(exchangeMatches.state, [...OPEN_STATES])))
            .limit(1);
        if (openMatch.length > 0) {
            skippedOpenMatch++;
            continue;
        }

        const subject = sites[0]!;
        const category = subject.category;

        const [activeInCategory] = await db()
            .select({ n: count() })
            .from(exchangeSites)
            .where(and(eq(exchangeSites.category, category), eq(exchangeSites.status, "active")));
        const pools = candidateCategories(category, activeInCategory?.n ?? 0);
        if (pools.length === 0) {
            skippedNoCandidates++;
            continue;
        }

        // Exclude anyone already matched with, so a digest never re-offers a
        // partner this member has already seen and passed on.
        const priorMatches = await db()
            .select({ siteAId: exchangeMatches.siteAId, siteBId: exchangeMatches.siteBId })
            .from(exchangeMatches)
            .where(involvesMe);
        const seen = new Set<string>();
        for (const m of priorMatches) {
            seen.add(m.siteAId);
            seen.add(m.siteBId);
        }

        const candidates = (
            await db()
                .select()
                .from(exchangeSites)
                .where(
                    and(
                        inArray(exchangeSites.category, pools),
                        eq(exchangeSites.status, "active"),
                        ne(exchangeSites.ownerId, member.userId),
                    ),
                )
                .orderBy(sql`${exchangeSites.lastMatchedAt} asc nulls first`)
                .limit(MAX_CANDIDATES * 4)
        )
            .filter((c) => !seen.has(c.id))
            .slice(0, MAX_CANDIDATES);

        if (candidates.length === 0) {
            // See the file header. Silence beats an empty digest.
            skippedNoCandidates++;
            continue;
        }

        const widenedCount = candidates.filter((c) => c.category !== category).length;

        // One count query for the whole digest, not one per candidate.
        const counts = await liveLinkCounts(candidates.map((c) => c.id));

        await notifyDigest({
            to: member.email,
            category,
            candidates: candidates.map((c) => toMaskedPartner(c, counts.get(c.id) ?? NO_LINKS)),
            widenedCount,
        });

        await db()
            .update(exchangeMembers)
            .set({ lastDigestSentAt: now, updatedAt: now })
            .where(eq(exchangeMembers.id, member.id));
        sent++;
    }

    return NextResponse.json({
        sent,
        skippedNotDue,
        skippedNoSites,
        skippedOpenMatch,
        skippedNoCandidates,
    });
}
