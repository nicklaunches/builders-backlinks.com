import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { mongoClientPromise } from "@/lib/db/mongodb-client";

/**
 * @file NextAuth v5 configuration. The identity source for this app.
 *
 * ONE ACCOUNT ACROSS TWO DOMAINS. This is the part a future reader will most
 * easily break, so it is spelled out:
 *
 *   - This app and nicklaunches.com run separate NextAuth instances against the
 *     SAME Atlas cluster, the SAME database, and the SAME `users` / `accounts`
 *     collections. The adapter is what makes that true, and the collection
 *     names below are pinned rather than left to the adapter's defaults so a
 *     future default change cannot quietly fork the two stores.
 *   - Consequence: someone who signed in on nicklaunches.com already has a row
 *     in `users`. Signing in here with the same provider resolves to that row,
 *     so they get the SAME `_id` on both sites. `src/lib/session.ts` hands that
 *     `_id` to the rest of the app as `SessionUser.id`, and `ExchangeMember`
 *     rows key off it. If the `_id` ever stopped being shared, every exchange
 *     record would attach to the wrong person.
 *   - `AUTH_SECRET` MUST be the same value as the Nick Launches app. Sessions
 *     are JWTs, and the secret is what signs and encrypts them, so a shared
 *     secret is what lets a token minted by either side be read by the other
 *     (which the planned cross-domain handoff depends on). Only the cookie is
 *     per-domain: each site issues its own, on its own host.
 *
 * SESSION STRATEGY is `jwt`, matching Nick Launches. That app cannot use
 * database sessions because its Credentials provider does not support them, and
 * having one side write `sessions` rows while the other does not would be a
 * pointless asymmetry on a shared cluster. It also means a normal page render
 * here reads the cookie only, with no round trip to Atlas.
 *
 * PROVIDERS are Google and GitHub only, for now. Nick Launches additionally has
 * X (Twitter), email + password, and magic links. Magic-link sign-in is
 * DEFERRED here until the SES email stack is wired up in this app: a sign-in
 * path that silently fails to deliver mail is worse than one that is absent.
 * Password sign-in is deliberately not mirrored either, since it would need the
 * password-reset mail that same stack sends.
 *
 * WRITES: the adapter is the only thing in this app that writes to `users` or
 * `accounts` (it has to, since a person can start on this domain). No custom
 * profile syncing lives here. Nick Launches owns the extra user fields
 * (`firstName`, `avatar`, `role`, `createdAt`) and backfills them in its own
 * `signIn` event, so a row created here fills out the first time that person
 * visits Nick Launches. See the note in `src/lib/db/mongoose.ts`.
 *
 * PRODUCTION NOTE: Auth.js only trusts the request host automatically on Vercel
 * or outside production. Anywhere else, set `AUTH_URL` (or `AUTH_TRUST_HOST`)
 * or every callback fails with `UntrustedHost`.
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: MongoDBAdapter(mongoClientPromise, {
        databaseName: process.env.MONGODB_DB,
        // Pinned, not defaulted. These two names ARE the integration with
        // nicklaunches.com; see the file header.
        collections: {
            Users: "users",
            Accounts: "accounts",
            Sessions: "sessions",
            VerificationTokens: "verification_tokens",
        },
    }),

    // Credentials come from `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and
    // `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` by Auth.js env inference.
    //
    // `allowDangerousEmailAccountLinking` is set to MATCH Nick Launches, which
    // sets it on GitHub, Google, and Twitter. Two apps writing one shared
    // `users`/`accounts` store must apply the same linking policy: with
    // different policies, the same action (sign in with GitHub on an account
    // created with Google) succeeds on one domain and dead-ends with
    // `OAuthAccountNotLinked` on the other, which is incoherent for a product
    // whose pitch is that it is the same account.
    //
    // On the security tradeoff, and why the stricter setting bought nothing
    // here: the flag is dangerous when a provider does not verify email
    // ownership, since someone could register that email at a second provider
    // and attach themselves to an existing row. Google and GitHub both verify.
    // More decisively, Nick Launches already links on this exact store with
    // these exact providers, so refusing to link here does not protect the
    // account: the same linking is available one domain over. It only made this
    // site worse at the thing it exists to do.
    //
    // The `?error=OAuthAccountNotLinked` copy on /signin is kept: the code is
    // still reachable (a provider can decline to release a verified email), and
    // the message is correct when it happens.
    providers: [
        Google({ allowDangerousEmailAccountLinking: true }),
        GitHub({ allowDangerousEmailAccountLinking: true }),
    ],

    session: { strategy: "jwt" },

    // Both point at our own page so users never see the stock Auth.js screens.
    // `error` matters as much as `signIn`: OAuth failures redirect to the error
    // page, and `/signin` renders those `?error=` codes as readable copy.
    pages: { signIn: "/signin", error: "/signin" },

    callbacks: {
        /**
         * `user` is only populated on the sign-in pass. `user.id` is the Mongo
         * `_id` as a hex string, handed back by the adapter, which is exactly
         * the shared id we need to survive into every later request. Copy it
         * onto the token explicitly rather than relying on `sub`, because Nick
         * Launches writes `token.id` too and the two token shapes should match.
         */
        async jwt({ token, user }) {
            if (user?.id) token.id = user.id;
            return token;
        },

        /**
         * The contract `src/lib/session.ts` is written against:
         * `session.user.id` is the shared Mongo `_id` as a string.
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
});
