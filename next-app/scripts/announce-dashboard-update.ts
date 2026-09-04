import { config as loadEnv } from "dotenv";
import { isNull } from "drizzle-orm";

import { DashboardUpdateEmail } from "@/emails/dashboard-update";
import { db } from "@/lib/db";
import { exchangeMembers } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";

loadEnv({ path: ".env.prod", quiet: true });

/**
 * @file One-shot announcement of the inbox and the rebuilt dashboard.
 *
 * THROWAWAY. Run it, read the list, run it again with `--send`, then delete the
 * file. There is no send log anywhere in this system, in the database or at
 * SES, so a second `--send` mails everyone a second time.
 *
 * Recipients are every member without `unsubscribed_at`, and the send goes out
 * as category `digest`, so `sendEmail` re-checks the opt-out per recipient and
 * adds the `List-Unsubscribe` header. Sequential and awaited: SES caps this
 * account at fourteen sends a second.
 *
 *   pnpm exec tsx scripts/announce-dashboard-update.ts                       # dry run
 *   pnpm exec tsx scripts/announce-dashboard-update.ts --to you@example.com --send   # one test copy
 *   pnpm exec tsx scripts/announce-dashboard-update.ts --send                # everyone
 */

const SUBJECT = "Your exchange now has an inbox";
const SEND = process.argv.includes("--send");
const toIndex = process.argv.indexOf("--to");
const ONLY = toIndex === -1 ? null : process.argv[toIndex + 1];

async function recipients(): Promise<string[]> {
    if (ONLY) return [ONLY.trim().toLowerCase()];
    const rows = await db()
        .select({ email: exchangeMembers.email })
        .from(exchangeMembers)
        .where(isNull(exchangeMembers.unsubscribedAt));
    return [...new Set(rows.map((r) => r.email.trim().toLowerCase()))].sort();
}

async function main() {
    console.log(`Dashboard update announcement (${SEND ? "SENDING" : "dry run"}${ONLY ? `, only ${ONLY}` : ""})\n`);

    const list = await recipients();
    console.log(`${list.length} recipient(s):`);
    for (const email of list) console.log(`  ${email}`);

    if (!SEND) {
        console.log("\nRe-run with --send.");
        return;
    }

    let sent = 0;
    let failed = 0;
    for (const to of list) {
        const ok = await sendEmail({
            to,
            subject: SUBJECT,
            react: DashboardUpdateEmail(),
            category: "digest",
            emailType: "dashboard-update",
        });
        console.log(`  ${ok ? "SENT  " : "FAILED"} ${to}`);
        if (ok) sent++;
        else failed++;
    }

    console.log(
        `\nSent ${sent}, failed ${failed}.` +
            (ONLY ? "" : "\nDelete this script now: a second run mails everyone again."),
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\nannounce crashed:", err);
        process.exit(1);
    });
