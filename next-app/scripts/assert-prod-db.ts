/**
 * @file Refuses to continue unless DATABASE_URL points somewhere deployable.
 *
 * Guards the one genuinely dangerous sequence in this repo: `pnpm deploy` runs
 * migrations and then ships code. `drizzle.config.ts` reads `DATABASE_URL`, and
 * a developer machine almost always has that set to a local Postgres. Without
 * this check, `pnpm deploy` would migrate localhost, report success, and push
 * code to production against a database that never received the migration. The
 * failure then shows up as runtime errors on a live site, which is a long way
 * from the mistake that caused it.
 *
 * The check is deliberately dumb: it only asserts the host is not local. It
 * cannot tell staging from production, and it is not trying to. It exists to
 * catch the forgetful case, not a determined one.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

const url = process.env.DATABASE_URL;

if (!url) {
    console.error(
        "DATABASE_URL is not set.\n\n" +
            "Deploying runs migrations first, so it needs the connection string for the\n" +
            "database the deployed code will talk to. Set it to the Neon connection\n" +
            "string for this deploy only, for example:\n\n" +
            '  DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" pnpm run deploy\n',
    );
    process.exit(1);
}

let host: string;
try {
    host = new URL(url).hostname;
} catch {
    console.error(`DATABASE_URL is not a valid URL: ${url.slice(0, 24)}...`);
    process.exit(1);
}

if (LOCAL_HOSTS.has(host)) {
    console.error(
        `DATABASE_URL points at ${host}, which is a local database.\n\n` +
            "Deploying would migrate your machine and ship code to production, leaving\n" +
            "the production schema untouched. Set DATABASE_URL to the Neon connection\n" +
            "string for this command:\n\n" +
            '  DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" pnpm run deploy\n',
    );
    process.exit(1);
}

console.log(`migrations will run against ${host}`);
