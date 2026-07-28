import { auth } from "@/auth";
import { connectMongo } from "@/lib/db/mongoose";
import { ExchangeMember, type ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";

/**
 * @file THE single session-lookup seam for all server-side code.
 *
 * Deliberately mirrors the same file in the Nick Launches app, name for name.
 * Both apps plan to swap NextAuth for better-auth eventually, and keeping one
 * seam per app means that swap is one file each rather than a search through
 * every route.
 *
 * Nothing outside this file should import from `@/auth` directly.
 */

/** The shape the rest of the app knows a signed-in person by. */
export type SessionUser = {
    /** The shared Nick Launches user `_id`. Same person, same id, on both sites. */
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
};

/**
 * The current session user, or null when signed out.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
    const session = await auth();
    const user = session?.user;
    if (!user?.id) return null;
    return {
        id: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
    };
}

/**
 * The exchange-side record for the current user, created on first use.
 *
 * A person can exist in the shared `users` collection (because they signed in
 * on Nick Launches) long before they have anything to do with the exchange, so
 * the `ExchangeMember` row is created lazily the first time they touch an
 * exchange surface rather than at sign-up. `user` is uniquely indexed, so the
 * upsert is safe against two concurrent first requests.
 *
 * @returns The member record, or null when signed out.
 */
export async function getSessionMember(): Promise<ExchangeMemberHydrated | null> {
    const user = await getSessionUser();
    if (!user?.email) return null;

    await connectMongo();
    return ExchangeMember.findOneAndUpdate(
        { user: user.id },
        { $setOnInsert: { user: user.id, email: user.email.toLowerCase(), verifiedAt: new Date() } },
        { upsert: true, new: true },
    ).exec();
}
