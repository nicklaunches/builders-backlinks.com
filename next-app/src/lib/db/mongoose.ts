import mongoose, { type Mongoose } from "mongoose";

/**
 * @file Shared Mongoose connection helper for server-side data access.
 *
 * Copied from the Nick Launches app. Both apps talk to the SAME Atlas cluster:
 * this app owns the `exchange_*` collections and only ever READS a narrow
 * projection of the shared `users` / `accounts` collections that NextAuth
 * manages on the Nick Launches side. Never write to those from here.
 *
 * The connection settings are read from `process.env` at CALL time, not at
 * module load. Under Next.js the difference is invisible, but the scripts under
 * `scripts/` load their env file with dotenv AFTER their imports have already
 * been evaluated, so a module-load read saw `undefined` and made
 * `connectMongo()` throw for the rest of the process. That mattered beyond a
 * spurious warning: `sendEmail`'s per-recipient preference check calls
 * `allowsCategory`, which fails OPEN on any error, so in every campaign script
 * the backstop silently degraded to "allow" and the query-level category filter
 * was the only thing enforcing an opt-out. Reading late restores the second
 * line of defense.
 */

function mongoUri(): string | undefined {
    return process.env.MONGODB_URI;
}

type Cached = {
    conn: Mongoose | null;
    promise: Promise<Mongoose> | null;
};

/**
 * Global cache slot used to preserve the Mongoose connection across dev reloads.
 */
const globalWithMongoose = globalThis as typeof globalThis & {
    _mongooseCache?: Cached;
};

const cached: Cached = globalWithMongoose._mongooseCache ?? { conn: null, promise: null };
globalWithMongoose._mongooseCache = cached;

/**
 * Connects to MongoDB through Mongoose using a cached process-wide connection.
 *
 * @returns The active Mongoose connection wrapper.
 * @throws When `MONGODB_URI` is not configured.
 */
export async function connectMongo(): Promise<Mongoose> {
    // A cached handle is only reusable while its client is actually connected.
    // `mongoose.disconnect()` leaves this object in place but closes the socket,
    // so returning it unchecked hands back a handle whose every operation
    // throws `MongoNotConnectedError` for the rest of the process. The e2e
    // suite hits this directly: a spec that disconnects in teardown used to
    // poison every later spec sharing the module. `readyState` 1 is connected;
    // anything else means drop the dead handle and dial again.
    if (cached.conn && cached.conn.connection.readyState === 1) return cached.conn;
    if (cached.conn) {
        cached.conn = null;
        cached.promise = null;
    }
    const uri = mongoUri();
    if (!uri) throw new Error("MONGODB_URI is not set");

    if (!cached.promise) {
        cached.promise = mongoose
            .connect(uri, {
                dbName: process.env.MONGODB_DB,
                bufferCommands: false,
                maxPoolSize: 10,
                minPoolSize: 0,
                // 30s (driver default): 5s flaked during builds, where parallel
                // export workers each open a pool and TLS handshakes queue up.
                serverSelectionTimeoutMS: 30000,
                socketTimeoutMS: 45000,
                maxIdleTimeMS: 30000,
                appName: "builders-backlinks-next",
            })
            .catch((err) => {
                cached.promise = null;
                throw err;
            });
    }

    cached.conn = await cached.promise;
    return cached.conn;
}
