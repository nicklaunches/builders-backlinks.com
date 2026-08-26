import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// The CLI is a plain node process: nothing has loaded .env.local for it, and
// README tells a new clone to put DATABASE_URL there before `pnpm db:migrate`.
loadEnv({ path: ".env.local", quiet: true });

/**
 * Drizzle Kit config, used only by the CLI to generate and push migrations.
 *
 * Reads DATABASE_URL from the environment (or .env.local) rather than the
 * Hyperdrive binding: migrations
 * run from a developer machine or CI against Neon, never from inside the
 * Worker. The Worker has no business running DDL.
 */
export default defineConfig({
    schema: "./src/lib/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "",
    },
    strict: true,
    verbose: true,
});
