import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedCron } from "@/lib/email/cron-auth";
import { errorDetail } from "@/lib/log";
import { REFRESH_BATCH, STALE_AFTER_DAYS, refreshAuthorityScores } from "@/lib/services/authority";

/**
 * @file `GET /api/cron/authority` — re-read Domain Rating for the stalest sites.
 *
 * Twice a day, taking a batch. Why that shape, what it costs in VerifiedDR
 * quota, and why a failed lookup never overwrites a stored score are all in
 * `services/authority.ts`; this end is the bearer check, the query parameters a
 * manual run needs, and a summary somebody can read in the Worker log.
 *
 * THE PARAMETERS ARE FOR A HUMAN AT A TERMINAL, not for the schedule, which
 * passes none and gets the defaults. `stale=0` takes every active site whatever
 * its age, which is how a backfill is run; `dry=1` writes nothing and says how
 * many sites are due.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A manual run may go wider than the schedule, but not without a ceiling. */
const MAX_BATCH = 100;

const Params = z.object({
    batch: z.coerce.number().int().min(1).max(MAX_BATCH).default(REFRESH_BATCH),
    stale: z.coerce.number().min(0).max(365).default(STALE_AFTER_DAYS),
    dry: z.coerce.boolean().default(false),
});

export async function GET(request: Request) {
    if (!isAuthorizedCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsed = Params.safeParse({
        batch: url.searchParams.get("batch") ?? undefined,
        stale: url.searchParams.get("stale") ?? undefined,
        dry: url.searchParams.get("dry") ?? undefined,
    });
    if (!parsed.success) {
        return NextResponse.json(
            { error: "bad_request", message: "batch, stale and dry must be numbers." },
            { status: 400 },
        );
    }

    const { batch, stale, dry } = parsed.data;

    try {
        const result = await refreshAuthorityScores({ batch, staleAfterDays: stale, dryRun: dry });

        // One line per run in the Worker log, and the moves spelled out: a score
        // that changed is the only thing here anybody would want to look up
        // afterwards, and it is not recorded anywhere else.
        const moves = result.changes.map((c) => `${c.domain} ${c.from ?? "none"}→${c.to}`).join(", ");
        console.log(
            `authority: picked ${result.picked}, answered ${result.answered}, failed ${result.failed}` +
                (result.dryRun ? " (dry run, nothing written)" : "") +
                (moves ? `. Moved: ${moves}` : "."),
        );

        return NextResponse.json(result);
    } catch (err) {
        console.error("authority: refresh failed", errorDetail(err));
        return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
}
