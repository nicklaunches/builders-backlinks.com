import { and, eq, inArray, isNotNull, lt, notExists, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { exchangeLinks, exchangeMatches, exchangeSites } from "@/lib/db/schema";
import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { notifyLinkRemoved } from "@/lib/email/notify";
import { GIVE_UP_AFTER_CHECKS, OPEN_MATCH_STATES, nextCheckAt } from "@/lib/exchange";
import { errorDetail } from "@/lib/log";
import { autoPair, previewPair } from "@/lib/services/matches";
import { verifyLink } from "@/lib/verify";

/**
 * @file The daily maintenance run: expire stale matches, re-pair the idle pool,
 * then recheck links.
 *
 * Three jobs, all time-based, all cheap, so they share one trigger rather than
 * spending a cron slot each. The order is not arbitrary and should not be
 * shuffled: expiry frees sites back into the pool, the re-pair pass then picks
 * them up in the same run, and only then does the slow link crawling start. Each
 * is unrelated to the next; see the comment on each for why it exists.
 *
 * The re-pair pass is the newest and the one with the least obvious reason to be
 * here. It exists because `autoPair` used to be reachable only at the instant a
 * site was approved, so a site that missed that instant was never reconsidered
 * by anything. That is not theoretical: it had silently stranded 26 of 33 active
 * sites by 2026-08-06. Pairing needed a heartbeat, and this file is where the
 * daily heartbeat already was.
 *
 * The recheck loop proper: day 7, day 30, then monthly for a live link, and a
 * tighter retry for one that is `promised` or `missing`. The schedule itself
 * lives in `nextCheckAt` (`lib/exchange.ts`), which is where the reasoning about
 * anchoring on the last check rather than the first sighting is written down.
 *
 * This is the half of the promise nobody else in the category makes. Verifying
 * a link the day it goes in is easy and most competitors do some version of it.
 * Noticing six weeks later that it quietly came down is the part that makes the
 * record worth anything, and it only works if this actually runs.
 *
 * A REMOVAL IS NOT AN ACCUSATION. Links come down for ordinary reasons: a
 * redesign, a moved page, a CMS migration. Both sides are told, in those terms.
 * The member who lost the link usually did not mean to, and the member who lost
 * the benefit is the one who most needs to know.
 *
 * Inconclusive is not the same as removed. A crawl that fails (timeout, a block
 * page, a site briefly down) leaves the link alone and tries again next run.
 * Marking a live link removed because a fetch flaked would be the worst bug
 * this file could have: it would email two people to say someone broke a
 * promise they kept.
 */

export const maxDuration = 60;

/** Kept small so one run cannot exhaust the send quota or the function budget. */
const BATCH = 40;

/**
 * Idle sites considered per run by the re-pair pass.
 *
 * Lower than {@link BATCH} because pairing is the expensive half: each match
 * sends TWO `match-proposed` emails, and `autoPair` voids them onto `waitUntil`
 * rather than awaiting, so a large batch turns into a burst against an SES
 * account capped at fourteen sends a second. Twenty-five idle sites is at most
 * twelve matches and twenty-four sends, which clears comfortably.
 */
const PAIR_BATCH = 25;

export async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    const now = new Date();

    // ---------------------------------------------------------------------
    // Expire stale matches first.
    //
    // `expiresAt` was written on every match from the day matching shipped and
    // then never compared against anything, so no match had ever actually
    // expired and the state was decoration. That is worse than cosmetic: the
    // weekly digest SKIPS any member holding an open match
    // (`OPEN_MATCH_STATES`), so a single proposal nobody ever answered silently
    // ended that member's digest permanently. They stopped hearing from us and
    // there was no way for them to find out why.
    //
    // Expiring returns both sites to the pool, since matching only excludes
    // partners with a live match, and lets the digest reach the member again.
    // `declined` and `placed` are terminal and deliberately excluded: a placed
    // match has real links behind it and must never be reopened by a clock.
    // ---------------------------------------------------------------------
    const expired = await db()
        .update(exchangeMatches)
        .set({ state: "expired", updatedAt: now })
        .where(and(inArray(exchangeMatches.state, [...OPEN_MATCH_STATES]), lt(exchangeMatches.expiresAt, now)))
        .returning({ id: exchangeMatches.id });

    if (expired.length > 0) {
        console.log(`recheck: expired ${expired.length} match(es) past their deadline`);
    }

    // ---------------------------------------------------------------------
    // Re-pair the idle pool.
    //
    // Approval used to be the only thing that ever called `autoPair`, which
    // meant a site that missed that single instant was invisible to matching
    // for good. On 2026-08-06 that was 26 of 33 active sites: `upsertMatch` was
    // handing a fractional score to an `integer` column, so the insert threw on
    // almost every approval and the error was swallowed. Fixing that bug does
    // not recover the sites it already passed over, and nothing else would have
    // either. That is what this pass is for.
    //
    // Deliberately AFTER the expiry sweep above. That sweep is what returns a
    // stale match's two sites to the pool, and running in the other order would
    // make every freshly expired site wait a further day for no reason.
    //
    // Safe to run daily because a repeat call is silent: `autoPair` returns
    // `already_matched` without writing or sending when the only partner left is
    // one this site already has a match row with. Sites already holding an open
    // match are excluded before that, so the pass is idempotent over an
    // unchanged pool.
    // ---------------------------------------------------------------------
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";

    const idle = await db()
        .select()
        .from(exchangeSites)
        .where(
            and(
                eq(exchangeSites.status, "active"),
                notExists(
                    db()
                        .select({ one: sql`1` })
                        .from(exchangeMatches)
                        .where(
                            and(
                                or(
                                    eq(exchangeMatches.siteAId, exchangeSites.id),
                                    eq(exchangeMatches.siteBId, exchangeSites.id),
                                ),
                                inArray(exchangeMatches.state, [...OPEN_MATCH_STATES]),
                            ),
                        ),
                ),
            ),
        )
        // NULLS FIRST for the same reason every other sweep in this codebase asks
        // for it: a site that has never been matched has waited longest of all,
        // and an ascending sort in Postgres would bury exactly those.
        .orderBy(sql`${exchangeSites.lastMatchedAt} asc nulls first`)
        .limit(PAIR_BATCH);

    // Pairing consumes two sites, so a site matched earlier in this loop is no
    // longer idle even though the query above said it was. Skipping it here is
    // cheaper than re-querying, and without it the partner's own turn would
    // propose a second match to somebody who just got one.
    //
    // PASSED DOWN AS WELL AS CHECKED HERE, and it has to be both. Checking it
    // only at the top of the loop guards a site from being the SUBJECT twice
    // while leaving it free to be CHOSEN twice: three idle sites in one category
    // reliably produced two matches both pointing at the middle one. The live
    // path no longer needs the hint — `selectPartner` now excludes anyone
    // holding an open match, which a just-paired site does — but the dry run
    // does, because it writes nothing for that query to see. Handing the same
    // set to both is what keeps the rehearsal honest.
    const spokenFor = new Set<string>();
    let paired = 0;
    let failed = 0;

    // Returned in the response, not just logged. A dry run exists to be read
    // before it is trusted, and an operator who has to go digging through
    // Worker logs to find out what the rehearsal decided will skip the
    // rehearsal. The live run reports the same shape so the two are comparable.
    const pairs: { site: string; partner?: string; score?: number; matchId?: string; skipped?: string }[] = [];

    for (const site of idle) {
        if (spokenFor.has(site.id)) continue;

        // One site cannot be allowed to end the run, and the cost of getting
        // this wrong is worse here than at the approval that also wraps its
        // `autoPair` call: everything below this loop is the link recheck, so a
        // single failing pair would silently stop every link in the batch from
        // being verified that day. Isolate, log, keep going.
        //
        // `errorDetail` rather than the raw error because the raw error is what
        // made the integer-score bug take a week to find: workerd printed a
        // bare minified stack for a `PostgresError`, so the log said pairing had
        // failed without ever saying that Postgres had rejected `87.16` for an
        // integer column.
        try {
            if (dryRun) {
                const preview = await previewPair(site, spokenFor);
                console.log(
                    preview.ok
                        ? `recheck: [dry] would pair ${site.domain} with ${preview.partnerSite.domain} (score ${preview.score})`
                        : `recheck: [dry] no pair for ${site.domain} (${preview.reason})`,
                );
                if (preview.ok) {
                    spokenFor.add(site.id).add(preview.partnerSite.id);
                    paired++;
                    pairs.push({ site: site.domain, partner: preview.partnerSite.domain, score: preview.score });
                } else {
                    pairs.push({ site: site.domain, skipped: preview.reason });
                }
                continue;
            }

            const result = await autoPair(site, spokenFor);
            if (result.matched) {
                spokenFor
                    .add(site.id)
                    .add(result.match.siteAId === site.id ? result.match.siteBId : result.match.siteAId);
                paired++;
                pairs.push({ site: site.domain, matchId: result.match.id, score: result.match.score });
                console.log(`recheck: paired ${site.domain} (match ${result.match.id})`);
            } else {
                pairs.push({ site: site.domain, skipped: result.reason });
                console.log(`recheck: no pair for ${site.domain} (${result.reason})`);
            }
        } catch (err) {
            failed++;
            const detail = errorDetail(err);
            pairs.push({ site: site.domain, skipped: `threw: ${detail}` });
            console.error(`recheck: autoPair threw for ${site.domain}: ${detail}`);
        }
    }

    if (failed > 0) {
        console.error(`recheck: re-pair pass had ${failed} failure(s), see the lines above`);
    }

    if (idle.length > 0) {
        console.log(
            `recheck: ${dryRun ? "[dry] " : ""}re-pair pass looked at ${idle.length} idle site(s), paired ${paired}`,
        );
    }
    // A full batch means there is more backlog than one run can clear. Say so
    // rather than letting a silent cap read as "the pool is drained".
    if (idle.length === PAIR_BATCH) {
        console.log(`recheck: re-pair batch was full at ${PAIR_BATCH}, more idle sites remain for tomorrow`);
    }

    // Oldest checked first, so a backlog drains fairly rather than starving the
    // links that have waited longest. NULLS FIRST is explicit: a link that has
    // never been checked has waited longest of all, and an ascending sort in
    // Postgres would otherwise put it at the very back of the queue.
    //
    // `promised` is in the set because a first report whose crawl was
    // inconclusive lands there, and nothing else ever looks at it again.
    //
    // The second clause drops links `nextCheckAt` has given up on. It is the
    // same predicate, expressed here rather than left to the filter below, and
    // it has to be: this ordering puts the never-confirmable links at the very
    // front of the queue forever, so filtering them in JavaScript would still
    // spend the whole window fetching them. Written as the negation of "never
    // live AND out of attempts" so it reads next to the rule it mirrors.
    const candidates = await db()
        .select()
        .from(exchangeLinks)
        .where(
            and(
                inArray(exchangeLinks.status, ["promised", "live", "missing"]),
                or(isNotNull(exchangeLinks.firstSeenAt), lt(exchangeLinks.checkCount, GIVE_UP_AFTER_CHECKS)),
            ),
        )
        .orderBy(sql`${exchangeLinks.lastCheckedAt} asc nulls first`)
        .limit(BATCH * 3);

    const due = candidates
        .filter((link) => {
            const at = nextCheckAt(link);
            return at === null ? false : at <= now;
        })
        .slice(0, BATCH);

    let checked = 0;
    let removed = 0;
    let inconclusive = 0;

    for (const link of due) {
        if (!link.pageUrl) continue;

        const sites = await db()
            .select()
            .from(exchangeSites)
            .where(inArray(exchangeSites.id, [link.fromSiteId, link.toSiteId]));
        const hostSite = sites.find((s) => s.id === link.fromSiteId);
        const beneficiarySite = sites.find((s) => s.id === link.toSiteId);
        if (!hostSite || !beneficiarySite) continue;

        const result = await verifyLink({
            pageUrl: link.pageUrl,
            targetDomain: beneficiarySite.domain,
        });
        checked++;

        // Every branch below writes these three, so they are the base of each patch.
        const touched = {
            lastCheckedAt: now,
            checkCount: link.checkCount + 1,
            lastMessage: result.message,
            updatedAt: now,
        };

        if (result.error !== null) {
            // Inconclusive. Leave the status alone and try again next run.
            inconclusive++;
            await db().update(exchangeLinks).set(touched).where(eq(exchangeLinks.id, link.id));
            continue;
        }

        if (result.found) {
            // Stamp `firstSeenAt` the first time a link is confirmed live, the
            // same as `markLinkPlaced` does. A `promised` link whose first report
            // was inconclusive — the client-rendered case this file keeps naming
            // — only ever gets confirmed here, and leaving `firstSeenAt` null
            // while moving it to `live` is a trap: `nextCheckAt` gives up on a
            // link that has NEVER been confirmed live once it passes
            // GIVE_UP_AFTER_CHECKS, so a genuinely live link would fall out of
            // the schedule and stop being rechecked, which is the one thing this
            // job exists never to do. A later miss must not move the timestamp,
            // so it is only filled when unset.
            await db()
                .update(exchangeLinks)
                .set({
                    ...touched,
                    status: "live",
                    placement: result.placement,
                    rel: [...result.rel],
                    ...(link.firstSeenAt ? {} : { firstSeenAt: now }),
                })
                .where(eq(exchangeLinks.id, link.id));
            continue;
        }

        // Confirmed absent. `removed` is reserved for a link that WAS live and
        // then went away: it is the word the ledger and the email both use, and
        // it carries a `removedAt`. A link that has never been confirmed live
        // has nothing to have been removed, so it goes to `missing` instead and
        // stays in the retry schedule until it runs out of attempts. Before
        // `promised` and `missing` were rechecked at all, only live links could
        // reach this branch and the distinction could not come up.
        const wasLive = link.status === "live";
        await db()
            .update(exchangeLinks)
            .set(wasLive ? { ...touched, status: "removed", removedAt: now } : { ...touched, status: "missing" })
            .where(eq(exchangeLinks.id, link.id));

        if (wasLive) {
            removed++;
            // Nothing to decrement: standing is a COUNT over links that are
            // live right now (`services/standing.ts`), so writing `removed`
            // above has already changed it. The counter columns this used to
            // maintain are what issue #6 was about.
            void notifyLinkRemoved({
                matchId: link.matchId,
                hostSite,
                beneficiarySite,
                pageUrl: link.pageUrl,
                anchorText: link.anchorText,
                firstSeenAt: link.firstSeenAt,
                removedAt: now,
            });
        }
    }

    return NextResponse.json({
        expired: expired.length,
        repair: { dryRun, idle: idle.length, paired, failed, pairs },
        due: due.length,
        checked,
        removed,
        inconclusive,
    });
}
