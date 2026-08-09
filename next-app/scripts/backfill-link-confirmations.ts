import { config as loadEnv } from "dotenv";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { type ExchangeSite, exchangeLinks, exchangeMembers, exchangeSites } from "@/lib/db/schema";
import { notifyLinkVerified } from "@/lib/email/notify";
import { verifyLink } from "@/lib/verify";

loadEnv({ path: ".env.prod", quiet: true });

/**
 * @file One-shot repair for confirmations the recheck cron swallowed.
 *
 * Until this was fixed, `api/cron/recheck` would confirm a `promised` link,
 * write `live`, and tell nobody. That path is reached by exactly the links whose
 * FIRST report came back inconclusive, so the last thing both members heard was
 * that we could not find their link. Nothing ever corrected it. This sends the
 * email they should have had.
 *
 * THROWAWAY. Run it, read it, run it again with `--send`, then delete the file.
 * It is not idempotent and cannot be: there is no send log anywhere in this
 * system, in the database or at SES, so "was this person already told" is
 * inferred here and can only be inferred once. Running it twice mails everyone
 * twice.
 *
 * HOW THE CANDIDATES ARE PICKED, and where the inference is.
 *
 * `markLinkPlaced` stamps `first_seen_at` in the same statement that upserts the
 * row, so a link confirmed on its first report has the two timestamps within
 * milliseconds of each other. Any real gap means confirmation came later, which
 * narrows the field to two populations:
 *
 *   a late `markLinkPlaced` retry   the member re-reported and WAS notified
 *   a cron confirmation             nobody was notified, and this is the target
 *
 * Nothing in the row distinguishes them, but the clock does: the cron fires at
 * 04:00 UTC and works one batch, so its confirmations land in the minutes after
 * that hour. A member re-reporting by hand at 04:00 UTC is possible, which is
 * why the other bucket is printed rather than discarded. Read both lists.
 *
 * EVERY CANDIDATE IS REFETCHED BEFORE ANYTHING IS SENT. Some of these are weeks
 * old and may have come down since. Mailing "your link is live" about a dead
 * link would be a worse failure than the silence being repaired, so a candidate
 * that no longer verifies is skipped and reported, not sent.
 *
 *   pnpm exec tsx scripts/backfill-link-confirmations.ts            # dry run
 *   pnpm exec tsx scripts/backfill-link-confirmations.ts --send
 */

const SEND = process.argv.includes("--send");

/** Slack around the 04:00 UTC trigger that counts as "this was the cron". */
const CRON_HOUR_UTC = 4;
const CRON_WINDOW_MINUTES = 30;

/** Below this, `first_seen_at` and `created_at` are the same write. */
const SAME_WRITE_MS = 5 * 60 * 1000;

type Candidate = {
    pageUrl: string;
    firstSeenAt: Date;
    /** Carried whole: `notifyLinkVerified` takes the site, not the domain. */
    hostSite: ExchangeSite;
    targetSite: ExchangeSite;
    hostDomain: string;
    hostEmail: string | null;
    targetDomain: string;
    targetEmail: string | null;
};

function inCronWindow(at: Date): boolean {
    const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
    const start = CRON_HOUR_UTC * 60;
    return minutes >= start && minutes < start + CRON_WINDOW_MINUTES;
}

function describe(c: Candidate): string {
    const seen = c.firstSeenAt.toISOString().replace("T", " ").slice(0, 16);
    return `  ${c.hostDomain} -> ${c.targetDomain}\n      ${c.pageUrl}\n      confirmed ${seen} UTC  |  ${c.hostEmail ?? "NO EMAIL"} + ${c.targetEmail ?? "NO EMAIL"}`;
}

async function main() {
    console.log(`Backfill of swallowed link confirmations (${SEND ? "SENDING" : "dry run"})\n`);

    // Live only. A link that has since been removed already generated its own
    // `link-removed` mail to both sides, and telling someone it went live after
    // they were told it came down would be nonsense.
    const rows = await db()
        .select()
        .from(exchangeLinks)
        .where(
            and(
                eq(exchangeLinks.status, "live"),
                isNotNull(exchangeLinks.firstSeenAt),
                sql`${exchangeLinks.firstSeenAt} > ${exchangeLinks.createdAt} + interval '5 minutes'`,
            ),
        );

    if (rows.length === 0) {
        console.log("No links were confirmed after their first report. Nothing to backfill.");
        return;
    }

    const siteIds = [...new Set(rows.flatMap((r) => [r.fromSiteId, r.toSiteId]))];
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

    const candidates: Candidate[] = [];
    for (const row of rows) {
        const host = siteById.get(row.fromSiteId);
        const target = siteById.get(row.toSiteId);
        if (!host || !target || !row.pageUrl || !row.firstSeenAt) continue;
        // Belt and braces: the SQL already excludes these, but the threshold is
        // expressed twice on purpose so a change to one is visible against the other.
        if (row.firstSeenAt.getTime() - row.createdAt.getTime() < SAME_WRITE_MS) continue;

        candidates.push({
            pageUrl: row.pageUrl,
            firstSeenAt: row.firstSeenAt,
            hostSite: host,
            targetSite: target,
            hostDomain: host.domain,
            hostEmail: emailByUser.get(host.ownerId) ?? null,
            targetDomain: target.domain,
            targetEmail: emailByUser.get(target.ownerId) ?? null,
        });
    }

    const cronConfirmed = candidates.filter((c) => inCronWindow(c.firstSeenAt));
    const ambiguous = candidates.filter((c) => !inCronWindow(c.firstSeenAt));

    console.log(`${candidates.length} link(s) confirmed after their first report.\n`);
    console.log(`CRON-CONFIRMED, nobody was told (${cronConfirmed.length}) — these get mailed:`);
    console.log(cronConfirmed.length ? cronConfirmed.map(describe).join("\n") : "  none");
    console.log(`\nCONFIRMED OUTSIDE THE CRON WINDOW (${ambiguous.length}) — almost certainly a`);
    console.log("re-report by the member, which DID notify. Not mailed. Read them anyway:");
    console.log(ambiguous.length ? ambiguous.map(describe).join("\n") : "  none");

    if (cronConfirmed.length === 0) {
        console.log("\nNothing to send.");
        return;
    }

    console.log(`\n--- Refetching ${cronConfirmed.length} page(s) to confirm each is still live ---\n`);

    let sent = 0;
    let gone = 0;
    let skipped = 0;

    for (const c of cronConfirmed) {
        const result = await verifyLink({ pageUrl: c.pageUrl, targetDomain: c.targetDomain });

        if (result.error !== null) {
            console.log(`  SKIP  ${c.pageUrl} — crawl inconclusive (${result.message})`);
            skipped++;
            continue;
        }
        if (!result.found) {
            console.log(`  GONE  ${c.pageUrl} — no longer contains the link, not mailing`);
            gone++;
            continue;
        }
        if (!c.hostEmail || !c.targetEmail) {
            console.log(`  SKIP  ${c.pageUrl} — a member row has no email`);
            skipped++;
            continue;
        }

        const report = {
            pageUrl: c.pageUrl,
            targetDomain: c.targetDomain,
            hostDomain: c.hostDomain,
            found: true,
            inconclusive: false,
            placement: result.placement,
            rel: result.rel,
            anchorText: result.anchorText,
            sitewide: result.sitewide,
            message: result.message,
            confirmedLate: { firstSeenAt: c.firstSeenAt },
        };

        if (!SEND) {
            console.log(`  WOULD  ${c.pageUrl} -> ${c.hostEmail} (given) + ${c.targetEmail} (received)`);
            sent += 2;
            continue;
        }

        // Awaited, not voided. `notify.ts` resolves its sends rather than
        // detaching them outside a Worker, and SES caps this account at fourteen
        // a second, so a sequential loop is both correct and slow enough.
        await notifyLinkVerified({ ...report, site: c.hostSite, direction: "given" });
        await notifyLinkVerified({ ...report, site: c.targetSite, direction: "received" });
        console.log(`  SENT   ${c.pageUrl} -> ${c.hostEmail} + ${c.targetEmail}`);
        sent += 2;
    }

    console.log(
        `\n${SEND ? "Sent" : "Would send"} ${sent} email(s). ${gone} link(s) gone, ${skipped} skipped.` +
            (SEND ? "\nDelete this script now: a second run mails everyone again." : "\nRe-run with --send."),
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\nbackfill crashed:", err);
        process.exit(1);
    });
