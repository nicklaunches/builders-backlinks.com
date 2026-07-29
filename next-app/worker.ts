// Aliased to .open-next/worker.js in wrangler.jsonc; typed in
// open-next-worker.d.ts. See that file for why it is not a relative import.
import openNextWorker from "open-next/worker";

/**
 * @file The Worker entry point. Wraps OpenNext's generated handler.
 *
 * OpenNext emits a fetch-only worker, but Cloudflare Cron Triggers invoke a
 * `scheduled()` handler and never make an HTTP request. That is the one real
 * shape difference from Vercel, where `vercel.json` crons simply hit a URL. So
 * this wrapper adds `scheduled()` and leaves everything else alone.
 *
 * The scheduled handler DISPATCHES THROUGH `fetch` rather than importing the
 * cron route modules directly. That is deliberate: the routes already carry the
 * bearer check, the batching, the notify calls and the error handling, and
 * calling them over a synthetic request means there is exactly one
 * implementation of each job. Importing the handlers would work today and drift
 * tomorrow, and a cron path that silently diverges from the manually-invocable
 * one is the sort of thing nobody notices until a digest goes out twice.
 *
 * The routes stay reachable over real HTTP too, for manual runs and for
 * debugging a failed schedule. They keep failing closed without `CRON_SECRET`.
 */

/** Maps each cron expression in wrangler.jsonc to the route it should run. */
const CRON_ROUTES: Record<string, string> = {
    // Weekly digest, Tuesdays 09:00 UTC.
    "0 9 * * 2": "/api/cron/digest",
    // Link rechecks, daily 04:00 UTC.
    "0 4 * * *": "/api/cron/recheck",
};

type Env = { CRON_SECRET?: string; NEXT_PUBLIC_SITE_URL?: string };

const worker = {
    fetch: openNextWorker.fetch,

    async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
        const path = CRON_ROUTES[event.cron];
        if (!path) {
            console.error(`scheduled: no route mapped for cron "${event.cron}". Check wrangler.jsonc and worker.ts.`);
            return;
        }

        if (!env.CRON_SECRET) {
            // The routes would reject this anyway (they fail closed), but say so
            // here: a silent no-op every night is much harder to notice than a
            // log line naming the missing secret.
            console.error(`scheduled: CRON_SECRET is not set, so ${path} will refuse to run.`);
            return;
        }

        // The origin only has to be well-formed. The request never leaves the
        // Worker, it goes straight back into the Next handler.
        const origin = env.NEXT_PUBLIC_SITE_URL ?? "https://builders-backlinks.com";
        const request = new Request(new URL(path, origin), {
            method: "GET",
            headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        });

        const run = (async () => {
            try {
                const response = await openNextWorker.fetch(request, env, ctx);
                const body = await response.text();
                // Log the outcome either way. These jobs send email and mutate
                // link state, so "it ran and did nothing" and "it never ran"
                // must be distinguishable after the fact.
                if (response.ok) console.log(`scheduled ${path}: ${response.status} ${body.slice(0, 300)}`);
                else console.error(`scheduled ${path} failed: ${response.status} ${body.slice(0, 300)}`);
            } catch (err) {
                console.error(`scheduled ${path} threw:`, err);
            }
        })();

        // Hold the invocation open until the job finishes. Without this the
        // runtime may cancel mid-run once the handler returns, which for the
        // recheck job means links updated but partners never told.
        ctx.waitUntil(run);
        await run;
    },
};

export default worker;

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "open-next/worker";
