import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

/**
 * @file The database handle. Replaces `connectMongo()`.
 *
 * Postgres over TCP, through the Hyperdrive binding. Hyperdrive keeps a warm
 * pool of connections to the origin at the edge, so the per-isolate pool below
 * is talking to a local proxy rather than opening a transatlantic connection
 * per query. That is what makes a TCP driver viable on Workers at all.
 *
 * WHY NOT the Neon HTTP driver, which this file used first: `neon-http` derives
 * an `https://<host>/sql` endpoint from the connection string and speaks Neon's
 * own API. It can only ever reach a Neon host. A Hyperdrive binding hands out a
 * PostgreSQL wire-protocol connection string pointing at Hyperdrive itself, so
 * the two are mutually exclusive: with `neon-http` the binding is unusable, and
 * so is any local Postgres, which took local verification off the table too.
 *
 * The binding is also NOT an environment variable. It arrives on the Cloudflare
 * context, which is why this reads `getCloudflareContext()` rather than the
 * `HYPERDRIVE_URL` that an earlier version of this file looked for and would
 * never have found.
 *
 * The connection string is resolved at CALL time, not module load. The same
 * lesson the Mongo helper carried: scripts load their env after imports have
 * evaluated, so a module-load read sees `undefined` and poisons every later
 * call. Here it is doubly true, since the Cloudflare context does not exist
 * until a request is in flight.
 */

type Handle = ReturnType<typeof create>;

/**
 * One handle per in-flight request, keyed on that request's ExecutionContext.
 *
 * A database connection is an I/O object, and workerd binds I/O objects to the
 * request context that created them. Reusing one from a later request does not
 * throw, it HANGS, and the runtime eventually kills the request with "your
 * Worker's code had hung and would never generate a response". That was
 * observed here as a first request succeeding and every subsequent one timing
 * out, which reads like a connection-pool bug and is not one.
 *
 * A WeakMap keyed on the context gives each request its own client while still
 * letting the many `db()` calls within a single request share one connection.
 * Entries disappear with the context, so nothing needs to clean up.
 */
const perRequest = new WeakMap<object, Handle>();

/** The module-level handle, used only outside a Worker request. */
let processCached: Handle | null = null;

function create(connectionString: string) {
    const client = postgres(connectionString, {
        // Hyperdrive pools on its side; this cap is per isolate and only needs
        // to cover the concurrent queries of a single request.
        max: 5,
        // Skip the introspection round trip that postgres.js does on connect to
        // learn custom type OIDs. This schema uses no custom types, and the
        // query does not survive Hyperdrive's connection reuse cleanly.
        fetch_types: false,
        // Hyperdrive may hand the same server connection to different clients,
        // so named prepared statements cannot be assumed to persist.
        prepare: false,
    });
    return drizzle(client, { schema });
}

/**
 * The Cloudflare request context, or null when there is not one.
 *
 * `getCloudflareContext()` throws rather than returning null outside a request:
 * scripts, drizzle-kit and the unit tests all take that path, and it is
 * expected there rather than an error worth surfacing.
 */
function workerContext(): { env: CloudflareEnv; ctx: ExecutionContext } | null {
    try {
        return getCloudflareContext();
    } catch {
        return null;
    }
}

function fallbackUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("No Hyperdrive binding and DATABASE_URL is not set");
    return url;
}

/**
 * The Drizzle client: one per request on Workers, one per process elsewhere.
 *
 * @returns A typed database handle with the full schema attached.
 * @throws When no connection string is configured.
 */
export function db(): Handle {
    const cf = workerContext();

    // Node: a script, a test, or `next dev`. One long-lived client is correct
    // here, and is what the pool settings above are sized for.
    if (!cf) {
        if (!processCached) processCached = create(fallbackUrl());
        return processCached;
    }

    const existing = perRequest.get(cf.ctx);
    if (existing) return existing;

    const handle = create(cf.env.HYPERDRIVE?.connectionString ?? fallbackUrl());
    perRequest.set(cf.ctx, handle);
    return handle;
}

export { schema };
