import { NextResponse } from "next/server";

import { type Category, candidateCategories } from "@/lib/categories";
import { connectMongo } from "@/lib/db/mongoose";
import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { notifyDigest } from "@/lib/email/notify";
import { ExchangeMatch } from "@/lib/models/ExchangeMatch";
import { ExchangeMember } from "@/lib/models/ExchangeMember";
import { ExchangeSite } from "@/lib/models/ExchangeSite";
import { toMaskedPartner } from "@/lib/services/mask";

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
 */

export const maxDuration = 60;

/** Members per run. Keeps one invocation inside its time and send budget. */
const BATCH = 50;

/** Candidates shown per digest. */
const MAX_CANDIDATES = 5;

const CADENCE_DAYS: Record<string, number> = { weekly: 7, biweekly: 14 };

export async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    await connectMongo();
    const now = new Date();

    const members = await ExchangeMember.find({
        unsubscribedAt: null,
        digestCadence: { $ne: "paused" },
    })
        .sort({ lastDigestSentAt: 1 })
        .limit(BATCH * 2)
        .exec();

    let sent = 0;
    let skippedNoSites = 0;
    let skippedOpenMatch = 0;
    let skippedNoCandidates = 0;
    let skippedNotDue = 0;

    for (const member of members) {
        if (sent >= BATCH) break;

        const dueAfterDays = CADENCE_DAYS[member.digestCadence ?? "weekly"] ?? 7;
        if (member.lastDigestSentAt) {
            const dueAt = new Date(member.lastDigestSentAt.getTime() + dueAfterDays * 24 * 60 * 60 * 1000);
            if (dueAt > now) {
                skippedNotDue++;
                continue;
            }
        }

        const sites = await ExchangeSite.find({ owner: member.user, status: "active" }).exec();
        if (sites.length === 0) {
            skippedNoSites++;
            continue;
        }

        const siteIds = sites.map((s) => s._id);

        // Anything still awaiting a decision counts as an open match.
        const openMatch = await ExchangeMatch.exists({
            $or: [{ siteA: { $in: siteIds } }, { siteB: { $in: siteIds } }],
            state: { $in: ["proposed", "a_accepted", "b_accepted", "agreed"] },
        });
        if (openMatch) {
            skippedOpenMatch++;
            continue;
        }

        const subject = sites[0]!;
        const category = subject.category as Category;
        const activeInCategory = await ExchangeSite.countDocuments({ category, status: "active" });
        const pools = candidateCategories(category, activeInCategory);
        if (pools.length === 0) {
            skippedNoCandidates++;
            continue;
        }

        // Exclude anyone already matched with, so a digest never re-offers a
        // partner this member has already seen and passed on.
        const priorMatches = await ExchangeMatch.find({
            $or: [{ siteA: { $in: siteIds } }, { siteB: { $in: siteIds } }],
        })
            .select("siteA siteB")
            .exec();
        const seen = new Set<string>();
        for (const m of priorMatches) {
            seen.add(String(m.siteA));
            seen.add(String(m.siteB));
        }

        const candidates = (
            await ExchangeSite.find({
                category: { $in: pools },
                status: "active",
                owner: { $ne: member.user },
            })
                .sort({ lastMatchedAt: 1 })
                .limit(MAX_CANDIDATES * 4)
                .exec()
        )
            .filter((c) => !seen.has(String(c._id)))
            .slice(0, MAX_CANDIDATES);

        if (candidates.length === 0) {
            // See the file header. Silence beats an empty digest.
            skippedNoCandidates++;
            continue;
        }

        const widenedCount = candidates.filter((c) => c.category !== category).length;

        await notifyDigest({
            to: member.email,
            category,
            candidates: candidates.map(toMaskedPartner),
            widenedCount,
        });

        member.lastDigestSentAt = now;
        await member.save();
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
