import { encode } from "next-auth/jwt";

/**
 * @file Mints a signed-in session for local testing, without an OAuth round trip.
 *
 * SCRIPTS ONLY. Nothing under `src/` may import this, and there is deliberately
 * no dev-login route in the app: a backdoor that exists in the code is a
 * backdoor that can ship. This works instead by doing exactly what Auth.js does
 * on a successful sign-in — encrypting a JWT with `AUTH_SECRET` and putting it
 * in the session cookie — so it needs the same secret the running app has and
 * grants nothing that a real sign-in would not.
 *
 * The salt Auth.js derives its encryption key from is the COOKIE NAME, which is
 * why that constant is shared rather than written out twice: get it wrong and
 * the app decrypts nothing and treats every request as signed out, with no
 * error anywhere to explain why.
 */

/** The insecure-origin cookie name. Production uses the `__Secure-` prefix. */
export const SESSION_COOKIE = "authjs.session-token";

/** A day is plenty for a test run and short enough to be worthless if leaked. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export async function mintSessionToken(user: { id: string; email: string }): Promise<string> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set, so no session can be minted.");

    return encode({
        // `id` is what `auth.ts` copies onto the token and reads back in the
        // session callback; `sub` is the fallback that same callback accepts.
        token: { id: user.id, sub: user.id, email: user.email },
        secret,
        salt: SESSION_COOKIE,
        maxAge: MAX_AGE_SECONDS,
    });
}

/** The `Cookie:` header value for a fetch made as this user. */
export async function sessionCookieHeader(user: { id: string; email: string }): Promise<string> {
    return `${SESSION_COOKIE}=${await mintSessionToken(user)}`;
}
