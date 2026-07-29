import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { db, schema } from "@/lib/db";

/**
 * @file NextAuth v5 configuration. The identity source for this app.
 *
 * SELF-CONTAINED ACCOUNTS. This app is its own identity boundary: it owns its
 * `users` and `accounts` tables and shares them with nothing. Signing in here
 * creates a user here.
 *
 * `AUTH_SECRET` is this app's JWT signing key and nothing else. It does not need
 * to match any other app's, and should not: no token crosses between them, so a
 * shared key would only widen the blast radius if either side leaked it.
 *
 * `session.user.id` is this app's own `users.id` (a uuid). `src/lib/session.ts`
 * hands it to the rest of the app as `SessionUser.id`, and
 * `exchange_members.user_id` references it.
 *
 * SESSION STRATEGY is `jwt`. A normal page render reads the cookie only, with
 * no round trip to Postgres: the adapter is touched on sign-in, not on every
 * request.
 *
 * PROVIDERS are Google and GitHub only, for now. Magic-link sign-in is DEFERRED
 * until the SES email stack is wired up in this app: a sign-in path that
 * silently fails to deliver mail is worse than one that is absent. Password
 * sign-in is deliberately absent too, since it would need the password-reset
 * mail that same stack sends.
 *
 * WRITES: the adapter is the only thing in this app that writes to `users` or
 * `accounts`, and it manages every column in both. No custom profile syncing
 * lives here.
 *
 * LAZY CONFIG: the config is a function rather than an object so `db()` runs per
 * request instead of at module load. `src/lib/db/index.ts` reads its connection
 * string at call time on purpose (a build or a script that imports this module
 * before its env is loaded would otherwise throw), and an eagerly constructed
 * adapter would have thrown that property away.
 *
 * PRODUCTION NOTE: Auth.js only trusts the request host automatically on Vercel
 * or outside production. Anywhere else, set `AUTH_URL` (or `AUTH_TRUST_HOST`)
 * or every callback fails with `UntrustedHost`.
 */

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
    // Tables are passed explicitly rather than left to the adapter's defaults,
    // so a future default change cannot quietly point auth at other tables.
    adapter: DrizzleAdapter(db(), {
        usersTable: schema.users,
        accountsTable: schema.accounts,
        sessionsTable: schema.sessions,
        verificationTokensTable: schema.verificationTokens,
    }),

    // Credentials come from `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and
    // `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` by Auth.js env inference.
    //
    // `allowDangerousEmailAccountLinking` lets someone who first signed up with
    // Google sign in later with GitHub on the same verified email, instead of
    // dead-ending on `OAuthAccountNotLinked` with no way forward. Members here
    // arrive months apart from an agent, a digest email or a match notification,
    // and will not reliably remember which button they pressed the first time.
    //
    // On the security tradeoff: the flag is dangerous when a provider does not
    // verify email ownership, since someone could register that email at a
    // second provider and attach themselves to an existing row. Google and
    // GitHub both verify, which is why these two are the only providers here.
    // Adding one that does not verify email means revisiting this flag.
    //
    // The `?error=OAuthAccountNotLinked` copy on /signin is kept: the code is
    // still reachable (a provider can decline to release a verified email), and
    // the message is correct when it happens.
    providers: [
        Google({ allowDangerousEmailAccountLinking: true }),
        GitHub({ allowDangerousEmailAccountLinking: true }),
    ],

    session: { strategy: "jwt" as const },

    // Both point at our own page so users never see the stock Auth.js screens.
    // `error` matters as much as `signIn`: OAuth failures redirect to the error
    // page, and `/signin` renders those `?error=` codes as readable copy.
    pages: { signIn: "/signin", error: "/signin" },

    callbacks: {
        /**
         * `user` is only populated on the sign-in pass. `user.id` is this app's
         * `users.id` uuid, handed back by the adapter, which is exactly the id
         * that has to survive into every later request. Copy it onto the token
         * explicitly rather than relying on `sub`, so the field the session
         * callback below reads is one this file actually sets.
         */
        async jwt({ token, user }) {
            if (user?.id) token.id = user.id;
            return token;
        },

        /**
         * The contract `src/lib/session.ts` is written against:
         * `session.user.id` is this app's `users.id` as a string.
         *
         * `token.id` is `unknown` (the JWT is an open record), so it is
         * type-checked rather than cast. Falling back to `token.sub` covers
         * tokens minted before `token.id` existed. If neither is a string we
         * leave the id empty and the session seam treats the request as signed
         * out, which is the right way to fail.
         */
        async session({ session, token }) {
            if (session.user) {
                const id = typeof token.id === "string" ? token.id : typeof token.sub === "string" ? token.sub : "";
                session.user.id = id;
            }
            return session;
        },
    },
}));
