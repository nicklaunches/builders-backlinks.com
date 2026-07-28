import { MongoClient } from "mongodb";

/**
 * @file The raw MongoDB driver handle that NextAuth's MongoDB adapter needs.
 *
 * SHARED STORE. This dials the SAME Atlas cluster and the SAME database as
 * nicklaunches.com, because the two sites share one `users` collection and one
 * `accounts` collection, and therefore one `_id` per person. Point this at a
 * different cluster or a different `MONGODB_DB` and the shared-account story
 * silently breaks: people would get a second, unrelated identity here. See the
 * header of `src/auth.ts` for the whole contract.
 *
 * Mirrors `nicklaunches.com/next-app/src/lib/db/mongodb-client.ts`. Keep the
 * two in step.
 *
 * Separate from `src/lib/db/mongoose.ts` on purpose: the adapter speaks the
 * native driver, not Mongoose, so it needs its own client. Two small pools
 * against one cluster is the documented Auth.js setup and costs little
 * (`maxPoolSize` 10, `minPoolSize` 0, so an idle process holds no sockets).
 *
 * The client is created lazily, on first use, rather than at module load.
 * `@/auth` gets imported by page code that frequently never touches the
 * database (a signed-out `/signin` render, for one), and a module-load connect
 * would dial Mongo for those requests and, worse, throw during `next build`
 * whenever `MONGODB_URI` is absent from the build environment.
 */

/** Cache slot on `globalThis` so dev hot reloads reuse one pool instead of leaking one per reload. */
const globalWithMongo = globalThis as typeof globalThis & {
    _bbMongoClientPromise?: Promise<MongoClient>;
};

/**
 * The connected MongoDB client, created on first call and cached after that.
 *
 * Passed to `MongoDBAdapter` as a function (the adapter accepts one) so that
 * nothing connects until an auth request actually needs the database.
 *
 * @returns A promise resolving to a connected MongoDB client.
 * @throws When `MONGODB_URI` is not configured.
 */
export function mongoClientPromise(): Promise<MongoClient> {
    const cached = globalWithMongo._bbMongoClientPromise;
    if (cached) return cached;

    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");

    const promise = new MongoClient(uri, {
        maxPoolSize: 10,
        minPoolSize: 0,
        // 30s (the driver default): 5s flaked during builds, where parallel
        // workers each open a pool and the TLS handshakes queue up.
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxIdleTimeMS: 30000,
        appName: "builders-backlinks-next-auth",
    })
        .connect()
        .catch((err: unknown) => {
            // Drop the failed attempt so the next request redials. Caching a
            // rejected promise would poison auth for the life of the process.
            globalWithMongo._bbMongoClientPromise = undefined;
            throw err;
        });

    globalWithMongo._bbMongoClientPromise = promise;
    return promise;
}
