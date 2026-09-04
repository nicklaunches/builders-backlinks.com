/**
 * @file Validation for the `?callbackUrl=` parameter on the sign-in page.
 *
 * WHY THIS EXISTS: `?callbackUrl=` is attacker-controlled. Someone can mail a
 * victim `https://builders-backlinks.com/signin?callbackUrl=https://evil.tld`,
 * and if we hand that value straight to `signIn()` the victim completes a real
 * sign-in on our real domain and is then dropped on the attacker's page. That
 * is an open redirect, and it is worth more to a phisher than a broken page
 * because the link genuinely starts on our origin.
 *
 * The rule here is deliberately narrow: a same-origin RELATIVE path, or
 * nothing. Absolute URLs are rejected even when they carry our own origin,
 * because comparing origins invites the whole family of parser-mismatch bugs
 * (userinfo `@`, trailing dots, case, ports) and the sign-in flow has never
 * needed anything but a path.
 *
 * Used in two places, on purpose. The page validates before putting the value
 * in the form, and the server action validates again before using it, because
 * a server action is a public endpoint and its form data can be forged.
 */

/**
 * Where a signed-in person lands when there is no usable callback.
 *
 * The app, not the landing page: a member who just signed in from the header
 * or the hero has nothing left to read on `/`, and `/` sends them here anyway.
 */
export const DEFAULT_CALLBACK_URL = "/app";

/** Where signing out lands. The marketing page, deliberately not the app. */
export const SIGNED_OUT_URL = "/";

/**
 * Reduces an untrusted `callbackUrl` to a safe same-origin path.
 *
 * @param raw - The value from a query string or form field. Anything at all.
 * @returns A relative path beginning with `/`, or {@link DEFAULT_CALLBACK_URL}.
 */
export function safeCallbackUrl(raw: unknown): string {
    // Next gives repeated query params as an array; a forged form can too.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") return DEFAULT_CALLBACK_URL;

    const candidate = value.trim();

    // Must be rooted. Rejects `evil.tld`, `javascript:...`, `https://evil.tld`.
    if (!candidate.startsWith("/")) return DEFAULT_CALLBACK_URL;

    // Protocol-relative. `//evil.tld` is a different origin, and browsers treat
    // a backslash the same way, so `/\evil.tld` and `/\/evil.tld` go too.
    if (candidate.startsWith("//") || candidate.startsWith("/\\")) return DEFAULT_CALLBACK_URL;

    // Control characters and whitespace are only ever there to smuggle
    // something past a check like this one (`/\tjavascript:`, header splitting).
    if (/[\s\u0000-\u001f\u007f]/.test(candidate)) return DEFAULT_CALLBACK_URL;

    // Nothing under /api renders a page, and `/api/auth/signout` would sign the
    // person straight back out the moment they finished signing in.
    if (candidate === "/api" || candidate.startsWith("/api/")) return DEFAULT_CALLBACK_URL;

    return candidate;
}
