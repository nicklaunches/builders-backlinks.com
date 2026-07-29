import { notFound } from "next/navigation";

import { type SessionUser, getSessionUser } from "@/lib/session";

/**
 * @file Who is allowed to moderate the exchange.
 *
 * An allowlist of email addresses in `ADMIN_EMAILS`, comma separated. There is
 * no admin flag on `users` and deliberately no way to grant one from inside the
 * app: the set of people who can approve a listing changes about once a year,
 * and a database column would mean an account takeover is also a moderation
 * takeover. Editing an environment variable and redeploying is the friction we
 * want here.
 *
 * Fails CLOSED when `ADMIN_EMAILS` is unset, matching `email/cron-auth.ts` and
 * for the same reason. An unconfigured rate limiter should let real traffic
 * through; an unconfigured moderation surface that admits everyone would hand a
 * stranger the ability to approve their own listings.
 */

/**
 * True when this address appears in `ADMIN_EMAILS`.
 *
 * Both sides are lowercased and trimmed. Addresses arrive from two places that
 * normalise differently: `exchangeMembers.email` is written lowercase, but
 * `users.email` comes from whatever the OAuth provider returned.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false;

    const raw = process.env.ADMIN_EMAILS;
    if (!raw?.trim()) {
        console.error("admin: ADMIN_EMAILS is not set, refusing everyone");
        return false;
    }

    const needle = email.trim().toLowerCase();
    return raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .includes(needle);
}

/**
 * Gate for every admin surface. Returns the signed-in admin, or renders 404.
 *
 * Uses `getSessionUser` rather than `getSessionMember` on purpose: reading the
 * review queue must not have side effects, and `getSessionMember` lazily INSERTS
 * an `exchange_members` row. An admin who has never listed a site should not
 * become a member of the exchange by opening this page.
 *
 * Answers 404 rather than 403, and does the same to signed-out visitors instead
 * of offering a sign-in prompt. A 403 confirms the route exists and tells a
 * stranger there is something here worth finding credentials for. The member
 * surfaces (`/submit`, `/app/key`) do show a sign-in prompt, because they want
 * to be discovered. This one does not.
 */
export async function requireAdmin(): Promise<SessionUser> {
    const user = await getSessionUser();
    if (!isAdminEmail(user?.email)) notFound();
    return user as SessionUser;
}
