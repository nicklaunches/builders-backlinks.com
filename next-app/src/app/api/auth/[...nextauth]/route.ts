import { handlers } from "@/auth";

/**
 * @file The NextAuth catch-all endpoint: `/api/auth/*`.
 *
 * Every OAuth redirect, callback, CSRF token and session read goes through
 * here. The path is not arbitrary: `/api/auth` is the `basePath` next-auth
 * assumes, and the redirect URIs registered with Google and GitHub point at
 * `/api/auth/callback/{google,github}`. Moving this directory means updating
 * both provider consoles.
 *
 * Node runtime, not edge: the Drizzle adapter reaches Postgres over TCP, which
 * on Workers means `nodejs_compat` and the Hyperdrive binding. Stated rather
 * than inherited so nobody flips it by habit.
 */

export const runtime = "nodejs";

export const { GET, POST } = handlers;
