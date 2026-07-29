import { eq } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";
import { type ExchangeMember, exchangeMembers } from "@/lib/db/schema";

/**
 * @file MCP bearer tokens.
 *
 * Day-one authentication for the MCP server is a header token:
 *
 *   claude mcp add --transport http builders-backlinks \
 *     https://builders-backlinks.com/api/mcp \
 *     --header "Authorization: Bearer bb_live_..."
 *
 * This is deliberately the simple option. The MCP specification's blessed path
 * is OAuth 2.1 with dynamic client registration, which gives a cleaner install
 * snippet (no key to copy) and a one-time browser sign-in. That is the target,
 * but it needs an authorization server, and header tokens work in every client
 * today including the ones whose OAuth support for third-party servers is
 * uneven. When OAuth lands, `resolveMemberFromBearer` gains a second branch and
 * nothing above it changes.
 *
 * Only the SHA-256 of a key is stored. The plaintext is shown once, at
 * creation, and is unrecoverable afterwards.
 */

const KEY_PREFIX = "bb_live_";
/** 32 bytes of entropy. base64url, so no shell-quoting hazards in an install command. */
const KEY_BYTES = 32;

/** A freshly minted key. `plaintext` is shown to the member exactly once. */
export type MintedKey = { plaintext: string; hash: string };

/**
 * Generates a new API key and its stored hash.
 *
 * @returns The plaintext key to display once, and the hash to persist.
 */
export function mintApiKey(): MintedKey {
    const plaintext = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString("base64url")}`;
    return { plaintext, hash: hashApiKey(plaintext) };
}

/**
 * Hashes an API key for storage and lookup.
 *
 * Plain SHA-256 rather than bcrypt or argon2 on purpose: unlike a password,
 * this is 32 bytes of full-entropy random, so there is no dictionary to attack
 * and no work factor worth paying on every single tool call. The stored hash is
 * also the lookup index, which a salted KDF would make impossible.
 */
export function hashApiKey(plaintext: string): string {
    return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Extracts a bearer token from an Authorization header value.
 *
 * @returns The token, or null when the header is missing or malformed.
 */
export function bearerFromHeader(headerValue: string | null | undefined): string | null {
    if (!headerValue) return null;
    const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
    const token = match?.[1]?.trim();
    if (!token || !token.startsWith(KEY_PREFIX)) return null;
    return token;
}

/**
 * Resolves a bearer token to the member it belongs to.
 *
 * Looks the key up by hash, then re-compares in constant time. The constant
 * time compare is belt-and-braces here (the index lookup already happened on
 * the hash) but it costs nothing and keeps the pattern correct if this is ever
 * refactored into a scan.
 *
 * Unsubscribed members are treated as signed out: their sites are already
 * excluded from matching, so letting their tools keep working would be
 * confusing rather than helpful.
 *
 * @param token - The raw `bb_live_...` token from the Authorization header.
 * @returns The member row, or null when the token is unknown or disabled.
 */
export async function resolveMemberFromBearer(token: string | null): Promise<ExchangeMember | null> {
    if (!token) return null;
    const hash = hashApiKey(token);

    const member = await db().query.exchangeMembers.findFirst({ where: eq(exchangeMembers.apiKeyHash, hash) });
    if (!member?.apiKeyHash) return null;

    const a = Buffer.from(member.apiKeyHash, "utf8");
    const b = Buffer.from(hash, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    if (member.unsubscribedAt) return null;

    // Best-effort last-used stamp. Never block a tool call on this write, and
    // never fail the request if it errors: it is telemetry, not authorization.
    void db()
        .update(exchangeMembers)
        .set({ apiKeyLastUsedAt: new Date() })
        .where(eq(exchangeMembers.id, member.id))
        .catch(() => {});

    return member;
}
