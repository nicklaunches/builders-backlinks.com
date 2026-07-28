import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * @file Signed unsubscribe tokens.
 *
 * `/unsubscribe?email=…` is a public page reached straight out of a mail
 * client, with no session and often no cookies. Without a proof, anyone who
 * knew a member's address could switch off their mail from a browser, so every
 * link this app mints carries `&t=`, an HMAC over the lowercased address, and
 * the write path refuses to act without a matching one.
 *
 * **No expiry, on purpose.** These links sit inside mail that has already been
 * delivered and will stay in inboxes for years. A token that stopped verifying
 * would turn the unsubscribe control into a dead button on old mail, which is
 * the exact compliance problem it exists to solve. The token is an authenticity
 * proof, not a session.
 *
 * **Key: `AUTH_SECRET`.** Auth.js already requires it for the app to boot, and
 * it is declared in `.env.example`, so it is the one secret guaranteed to be
 * present wherever email is rendered. A new dedicated variable would have to
 * reach every deploy target before this shipped, and a missing key means
 * unsigned links in production.
 *
 * The payload is namespaced with a purpose string so a signature minted here
 * can never be replayed against some future HMAC that reuses the same key.
 */

/** Namespace plus version. Bump only if the payload format itself changes. */
const TOKEN_PURPOSE = "bb.unsubscribe.v1";

function signingKey(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set; unsubscribe tokens cannot be signed");
    return secret;
}

/**
 * Normalizes an address the way both signing and verification must see it.
 *
 * Lowercased and trimmed, so the token survives a mail client or a relay
 * changing the casing of the query string it round-trips.
 */
function normalize(email: string): string {
    return String(email ?? "")
        .trim()
        .toLowerCase();
}

/**
 * Signs a recipient address.
 *
 * @param email - Recipient address, any casing.
 * @returns Base64url HMAC-SHA256 digest, safe to drop straight into a URL.
 * @throws When `AUTH_SECRET` is not configured.
 */
export function signUnsubscribeToken(email: string): string {
    return createHmac("sha256", signingKey())
        .update(`${TOKEN_PURPOSE}:${normalize(email)}`)
        .digest("base64url");
}

/**
 * Verifies a token against an address.
 *
 * Compares in constant time. The length guard in front of `timingSafeEqual` is
 * required (it throws on mismatched lengths) and leaks nothing: the digest
 * length is fixed and public.
 *
 * Returns `false` rather than throwing for every failure mode, including a
 * missing `AUTH_SECRET`. This is the deny side of the gate, so failing closed
 * is right even though the render side fails open.
 *
 * @param email - Address the token should belong to.
 * @param token - Candidate token from the URL.
 * @returns `true` only for a token this process would have minted.
 */
export function verifyUnsubscribeToken(email: string, token: string | null | undefined): boolean {
    if (!email || typeof token !== "string" || token.length === 0) return false;
    let expected: string;
    try {
        expected = signUnsubscribeToken(email);
    } catch {
        return false;
    }
    const expectedBuf = Buffer.from(expected, "utf8");
    const candidateBuf = Buffer.from(token, "utf8");
    if (expectedBuf.length !== candidateBuf.length) return false;
    return timingSafeEqual(expectedBuf, candidateBuf);
}

/**
 * Non-throwing variant for render paths.
 *
 * `buildUnsubscribeUrl` runs inside every send and inside `pnpm emails:render`,
 * and neither should collapse because a secret is absent. Callers omit the
 * `&t=` parameter when this returns `null`, which produces a link that lands on
 * the page in its "type your address" mode rather than a broken send.
 */
export function signUnsubscribeTokenSafe(email: string): string | null {
    try {
        return signUnsubscribeToken(email);
    } catch (error) {
        console.warn("unsubscribe token not signed:", error instanceof Error ? error.message : error);
        return null;
    }
}
