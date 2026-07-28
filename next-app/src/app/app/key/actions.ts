"use server";

import { formatKeyDate } from "@/app/app/key/format";
import { issueApiKey } from "@/lib/services/api-keys";
import { getSessionMember } from "@/lib/session";

/**
 * @file The one mutation on `/app/key`.
 *
 * The plaintext key is returned to the browser here and nowhere else. It is not
 * stored, not revalidated into a server render, and not readable afterwards, so
 * this action's return value is the only moment in the key's life where it is
 * legible. The page is written around that fact.
 *
 * Deliberately not calling `revalidatePath`: refreshing the server render would
 * be cosmetic (it only updates an issue date this action already knows) and it
 * risks remounting the panel holding the one copy of the key.
 */

export type IssueKeyState =
    | { status: "idle" }
    | { status: "signed_out" }
    | { status: "error"; message: string }
    | {
          status: "issued";
          /** Shown once. Never re-fetchable, not even by us. */
          plaintext: string;
          /** Preformatted server-side so both renders agree on the string. */
          issuedAt: string;
          /** True when this revoked a key that already existed. */
          replaced: boolean;
      };

/**
 * Mints a key, stores only its hash, and hands the plaintext back once.
 *
 * @param _previous - Previous action state, unused: issuing always starts clean.
 */
export async function issueKeyAction(_previous: IssueKeyState): Promise<IssueKeyState> {
    const member = await getSessionMember();
    if (!member) return { status: "signed_out" };

    try {
        const issued = await issueApiKey(member);
        return {
            status: "issued",
            plaintext: issued.plaintext,
            issuedAt: formatKeyDate(issued.issuedAt) ?? "just now",
            replaced: issued.replaced,
        };
    } catch (err) {
        console.error("app/key: issuing failed", err);
        return {
            status: "error",
            message: "We could not issue a key just now. Nothing changed, your existing key still works. Try again.",
        };
    }
}
