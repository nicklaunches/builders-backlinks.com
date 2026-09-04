import { eq } from "drizzle-orm";
import { cache } from "react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { type ExchangeMember, exchangeMembers } from "@/lib/db/schema";
import { notifyWelcome } from "@/lib/email/notify";

/**
 * @file THE single session-lookup seam for all server-side code.
 *
 * Deliberately mirrors the same file in the Nick Launches app, name for name.
 * Both apps plan to swap NextAuth for better-auth eventually, and keeping one
 * seam per app means that swap is one file each rather than a search through
 * every route. The Mongo to Postgres move was the first time that paid off: the
 * store underneath changed completely and the two exported functions below kept
 * their names, parameters and return shapes.
 *
 * Nothing outside this file should import from `@/auth` directly.
 *
 * Both lookups are wrapped in React's `cache`, so the `/app` layout, the header
 * and the page each asking for the member in one render pass is one cookie
 * decode and one query, not three. The welcome email in `getSessionMember`
 * stays once-per-member: the row insert, not the call count, is what gates it.
 */

/** The shape the rest of the app knows a signed-in person by. */
export type SessionUser = {
    /** This app's own `users.id`, a uuid. Meaningful nowhere else. */
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
};

/**
 * The current session user, or null when signed out.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
    const session = await auth();
    const user = session?.user;
    if (!user?.id) return null;
    return {
        id: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
    };
});

/**
 * The exchange-side record for the current user, created on first use.
 *
 * A person can exist in `users` (they signed in, or they crossed over from Nick
 * Launches) long before they have anything to do with the exchange, so the
 * `exchange_members` row is created lazily the first time they touch an
 * exchange surface rather than at sign-up.
 *
 * Read first, then insert: the common case is an existing member and that is
 * one query. `user_id` is uniquely indexed, so two concurrent first requests
 * cannot both insert. The loser of that race gets nothing back from
 * `onConflictDoNothing` and re-reads the winner's row.
 *
 * @returns The member record, or null when signed out.
 */
export const getSessionMember = cache(async (): Promise<ExchangeMember | null> => {
    const user = await getSessionUser();
    if (!user?.email) return null;

    const existing = await db().query.exchangeMembers.findFirst({ where: eq(exchangeMembers.userId, user.id) });
    if (existing) return existing;

    const [created] = await db()
        .insert(exchangeMembers)
        .values({ userId: user.id, email: user.email.toLowerCase(), verifiedAt: new Date() })
        .onConflictDoNothing({ target: exchangeMembers.userId })
        .returning();
    if (created) {
        // The one place a member comes into existence, and therefore the only
        // honest place to welcome them. `onConflictDoNothing().returning()`
        // hands a row back to exactly one request even when several arrive at
        // once, so this cannot double-send and needs no "welcomed_at" column to
        // guard it. Fire and forget, like every other notify call.
        void notifyWelcome({ to: created.email });
        return created;
    }

    return (await db().query.exchangeMembers.findFirst({ where: eq(exchangeMembers.userId, user.id) })) ?? null;
});
