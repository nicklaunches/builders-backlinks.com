import { mintApiKey } from "@/lib/auth/api-key";
import { connectMongo } from "@/lib/db/mongoose";
import { ExchangeMember, type ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";

/**
 * @file Issuing the MCP bearer key a member installs into their agent.
 *
 * `src/lib/auth/api-key.ts` mints and verifies; this is the service layer on top
 * of it, so the web action and any future agent-side rotation tool go through
 * one function rather than each writing the member document themselves.
 *
 * The plaintext key exists exactly once, in the return value of `issueApiKey`.
 * Only its SHA-256 is persisted. There is deliberately no "fetch my key"
 * function here and there must never be one: if a key could be read back, a
 * stolen session would be a stolen key, and the store would be a list of live
 * credentials rather than a list of hashes.
 */

/** What can honestly be said about a member's key without being able to read it. */
export type ApiKeyStatus = {
    issued: boolean;
    issuedAt: Date | null;
    /** Last time the key authenticated an MCP call. Null until the agent uses it. */
    lastUsedAt: Date | null;
};

/**
 * Describes the member's current key. Reads only metadata, never a secret.
 */
export function describeApiKey(member: ExchangeMemberHydrated): ApiKeyStatus {
    return {
        issued: Boolean(member.apiKeyHash),
        issuedAt: member.apiKeyIssuedAt ?? null,
        lastUsedAt: member.apiKeyLastUsedAt ?? null,
    };
}

/** A key that has just been created. `plaintext` is displayable once and never again. */
export type IssuedApiKey = {
    plaintext: string;
    issuedAt: Date;
    /** True when this replaced a key that already existed, which invalidated it. */
    replaced: boolean;
};

/**
 * Issues a new key for a member, replacing any existing one immediately.
 *
 * There is one key per member by construction: the hash is a single field, so
 * writing a new one revokes the old one in the same operation and there is no
 * window where both work. `apiKeyLastUsedAt` is cleared because a previous
 * key's usage says nothing about this one.
 *
 * @returns The plaintext to show once, plus when it was issued.
 */
export async function issueApiKey(member: ExchangeMemberHydrated): Promise<IssuedApiKey> {
    const replaced = Boolean(member.apiKeyHash);
    const { plaintext, hash } = mintApiKey();
    const issuedAt = new Date();

    await connectMongo();
    await ExchangeMember.updateOne(
        { _id: member._id },
        { $set: { apiKeyHash: hash, apiKeyIssuedAt: issuedAt, apiKeyLastUsedAt: null } },
    ).exec();

    return { plaintext, issuedAt, replaced };
}
