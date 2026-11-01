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
 * The check is deliberately dumb: it only asserts the database is not local
 * (`scripts/database-url.ts`), which admits the tunnel to production. It
 * cannot tell staging from production, and it is not trying to. It exists to
 * catch the forgetful case, not a determined one.
 */
import { isLocalDatabase } from "./database-url";

const url = process.env.DATABASE_URL;

if (!url) {
    console.error(
        "DATABASE_URL is not set.\n\n" +
            "Deploying runs migrations first, so it needs the connection string for the\n" +
            "database the deployed code will talk to. Open the tunnel (ssh -fN db-tunnel)\n" +
            "and set it to the production connection string, for example:\n\n" +
            '  DATABASE_URL="postgresql://builders_backlinks:...@localhost:15432/builders_backlinks" pnpm run deploy\n',
    );
    process.exit(1);
}

let parsed: URL;
try {
    parsed = new URL(url);
} catch {
    console.error(`DATABASE_URL is not a valid URL: ${url.slice(0, 24)}...`);
    process.exit(1);
}
const host = parsed.host;

if (isLocalDatabase(parsed)) {
    console.error(
        `DATABASE_URL points at ${host}, which is a local database.\n\n` +
            "Deploying would migrate your machine and ship code to production, leaving\n" +
            "the production schema untouched. Open the tunnel (ssh -fN db-tunnel) and set\n" +
            "DATABASE_URL to the production connection string for this command:\n\n" +
            '  DATABASE_URL="postgresql://builders_backlinks:...@localhost:15432/builders_backlinks" pnpm run deploy\n',
    );
    process.exit(1);
}

console.log(`migrations will run against ${host}`);
