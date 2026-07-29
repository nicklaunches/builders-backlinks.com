import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config, used only by the CLI to generate and push migrations.
 *
 * Reads DATABASE_URL directly rather than the Hyperdrive binding: migrations
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
