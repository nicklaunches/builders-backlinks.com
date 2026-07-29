"use server";

import { signIn, signOut } from "@/auth";
import { DEFAULT_CALLBACK_URL, safeCallbackUrl } from "@/components/web/auth/callback-url";

/**
 * @file The server actions behind the sign-in and sign-out buttons.
 *
 * WHY SERVER ACTIONS instead of the client `signIn()` helper: the sign-in page
 * stays a server component and ships no JavaScript at all. The buttons are
 * plain form submits, so sign-in works before (or without) hydration, which is
 * a good property for the one page every user has to get through.
 *
 * IMPORT NOTE: `src/lib/session.ts` says nothing outside it should import
 * `@/auth`. That rule is about session READS, so that swapping the auth library
 * later is one file. Starting and ending a session is the other half of the
 * seam and has to come from somewhere: this file is that somewhere, and it is
 * deliberately tiny for the same reason.
 *
 * A server action is a public HTTP endpoint. Everything read out of `formData`
 * below is attacker-supplied and is validated here, not trusted because the
 * page that normally submits it is ours.
 */

const PROVIDERS = ["google", "github"] as const;

/** The OAuth providers this app offers. Google and GitHub only, see `src/auth.ts`. */
export type ProviderName = (typeof PROVIDERS)[number];

function isProviderName(value: unknown): value is ProviderName {
    return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Starts an OAuth sign-in and redirects to the provider.
 *
 * @param formData - Must carry `provider`, and may carry `callbackUrl`.
 * @throws When `provider` is missing or is not one we offer. Passing the raw
 *   value through would let anyone drive `signIn()` with an arbitrary provider
 *   id, which at best 500s and at worst reaches a provider we did not mean to
 *   expose.
 */
export async function signInWithProvider(formData: FormData): Promise<void> {
    const provider = formData.get("provider");
    if (!isProviderName(provider)) throw new Error("Unsupported sign-in provider");

    // Re-validated here even though the page already validated it: this
    // endpoint can be POSTed to directly, with any `callbackUrl` at all.
    const redirectTo = safeCallbackUrl(formData.get("callbackUrl"));

    // `signIn` completes by throwing Next's redirect signal, so there is
    // deliberately no try/catch around it: catching would swallow the redirect.
    await signIn(provider, { redirectTo });
}

/**
 * Clears the session cookie and returns the person to the home page.
 *
 * The session is a JWT in a cookie on this host, so clearing that cookie is the
 * whole of signing out. There is no server-side session row to revoke.
 */
export async function signOutAction(): Promise<void> {
    await signOut({ redirectTo: DEFAULT_CALLBACK_URL });
}
