import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * @file The proof that a confirmed submission came from a draft this server made.
 *
 * The browser submit is two steps and the server keeps nothing between them, so
 * everything the confirmation screen shows has to survive the round trip in form
 * fields. Form fields are caller-controlled: a server action is a POST endpoint
 * that anyone signed in can call directly, without ever loading the page the
 * fields came from.
 *
 * That matters more for the URL than for anything else on the form. Category,
 * description and anchors are the member's to edit, which is the entire point of
 * the confirmation step. The URL is not: it is what `draftSite` fetched,
 * analyzed and found substantial enough to list, and `commitSite` derives the
 * globally unique domain from it. Accept an unproven URL there and the whole
 * analysis step becomes optional on the web path, while the `submit_site` tool
 * re-runs it on every confirm. Two interfaces, one service layer, and one of
 * them quietly skipping the gate.
 *
 * So the HMAC covers the URL as well as the Domain Rating, and
 * {@link verifyDraft} returns nothing at all rather than falling back when it
 * does not match. Domain Rating alone used to be signed (it is a public number
 * partners judge on, so a hand-edited hidden input must not inflate it) and a
 * bad signature dropped it to null; the URL cannot degrade that way, because
 * there is no safe weaker value to substitute for "some domain".
 *
 * `AUTH_SECRET` is the key. It is already required for sessions, so there is no
 * new secret to configure, and it never leaves the server.
 */

/** What the confirmation step is allowed to write, once proven. */
export type SignedDraft = {
    /** Final URL after redirects, exactly as `draftSite` returned it. */
    url: string;
    domainRating: number | null;
};

function draftSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET must be set: it signs the draft carried between submit steps.");
    return secret;
}

/**
 * Signs the fields the confirmation step is not allowed to invent.
 *
 * @param url - Final URL from the draft.
 * @param domainRating - Domain Rating from the draft, or null when unrated.
 * @returns Hex HMAC to carry in the form.
 */
export function signDraft(url: string, domainRating: number | null): string {
    return createHmac("sha256", draftSecret())
        .update(`${url}\n${domainRating ?? ""}`)
        .digest("hex");
}

/**
 * Recovers the draft fields, but only when they are provably this server's.
 *
 * @param url - `url` field from the confirmation form.
 * @param rawDomainRating - `domainRating` field, as submitted.
 * @param signature - `signature` field, as submitted.
 * @returns The verified fields, or null when the signature does not match. A
 *   null means the caller has to start again from the URL, not that the values
 *   should be used with a weaker default.
 */
export function verifyDraft(url: string, rawDomainRating: string, signature: string): SignedDraft | null {
    const parsed = rawDomainRating === "" ? null : Number.parseInt(rawDomainRating, 10);
    const domainRating = parsed == null || Number.isNaN(parsed) ? null : parsed;

    const expected = Buffer.from(signDraft(url, domainRating), "utf8");
    const given = Buffer.from(signature, "utf8");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    return { url, domainRating };
}
