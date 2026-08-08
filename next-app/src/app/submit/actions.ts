"use server";

import { signDraft, verifyDraft } from "@/app/submit/draft-signature";
import type { Category } from "@/lib/categories";
import { AnalyzeError, analyzeFailureHint } from "@/lib/contracts";
import { RateLimited, enforceToolLimit, memberCaller, rateLimitedMessage } from "@/lib/limits";
import { SiteError, commitSite, draftSite } from "@/lib/services/sites";
import { getSessionMember } from "@/lib/session";

/**
 * @file Server actions behind `/submit`, the browser twin of the `submit_site` MCP tool.
 *
 * These two actions are deliberately the same shape as the one tool: call
 * `draftSiteAction` first and nothing is written, call `commitSiteAction` only
 * after a human has read the drafted words. Both call the exact same service
 * functions (`draftSite`, `commitSite`) in the exact same order as
 * `src/lib/mcp/tools.ts`, and the error text comes from `analyzeFailureHint()`
 * in `@/lib/contracts`, which `explain()` there calls too. It used to be copied,
 * with a comment here promising the copy stayed word for word; it did not, and
 * the agent path lost four of the six hints. If the two ever say different
 * things about the same failure, one of the two interfaces has started to drift
 * and the agent one is supposed to be first-class.
 *
 * Neither surface pairs on submit. `autoPair` refuses anything that is not
 * `active` and a listing is `pending_review` until review clears it, so both
 * used to carry copy for four outcomes when only one was reachable. The call is
 * gone from both; matching happens at approval, in `setSiteStatus`.
 *
 * One place the web path is deliberately NOT identical: the URL and the Domain
 * Rating are signed between the two steps (see `draft-signature.ts`). The MCP
 * tool re-runs `draftSite` on confirm and reads both off the fresh draft; a
 * browser has to round-trip them through form fields, and a server action is a
 * POST endpoint that can be called without ever loading the page those fields
 * came from. An unproven URL there would mean the web path lists a domain this
 * server never fetched, while the tool analyzes every single one.
 */

// ---------------------------------------------------------------------------
// Step one: draft
// ---------------------------------------------------------------------------

/** Everything the confirmation screen needs, plus the signature tying DR to this server. */
export type DraftPayload = {
    domain: string;
    /** Final URL after redirects. This, not the typed one, is what gets listed. */
    url: string;
    category: Category;
    description: string;
    keywords: string[];
    domainRating: number | null;
    /** Raw page title, shown only on the confirmation screen. Partners never see it. */
    title: string | null;
    signature: string;
};

export type DraftState =
    | { status: "idle" }
    | { status: "signed_out"; url: string }
    | { status: "error"; message: string; url: string }
    | { status: "ok"; draft: DraftPayload };

/**
 * Analyzes a URL and returns a listing to confirm. Writes nothing.
 *
 * @param _previous - Previous action state, unused: each draft starts clean.
 * @param formData - Expects a `url` field.
 */
export async function draftSiteAction(_previous: DraftState, formData: FormData): Promise<DraftState> {
    const url = String(formData.get("url") ?? "").trim();
    if (!url) {
        return { status: "error", message: "Enter the URL of the site you want to list.", url };
    }

    // Checked before the analysis, exactly as the tool checks `requireMember`
    // first: an anonymous request must not spend an LLM call and a DR lookup.
    const member = await getSessionMember();
    if (!member) return { status: "signed_out", url };

    try {
        // Same bucket the `submit_site` tool spends, because this costs the same
        // money: a page fetch, an LLM call, and one of a monthly quota of
        // VerifiedDR lookups. Charged before the work, not after.
        await enforceToolLimit("submit_site", memberCaller(member.id));

        const draft = await draftSite(url);

        if (draft.alreadyListed) {
            return {
                status: "error",
                message: `${draft.domain} is already listed in the exchange. Each domain belongs to one member.`,
                url,
            };
        }

        return {
            status: "ok",
            draft: {
                domain: draft.domain,
                url: draft.url,
                category: draft.category,
                description: draft.description,
                keywords: draft.keywords,
                domainRating: draft.domainRating,
                title: draft.title,
                signature: signDraft(draft.url, draft.domainRating),
            },
        };
    } catch (err) {
        return { status: "error", message: explainAnalyzeFailure(err), url };
    }
}

/**
 * Says the same thing as `explain()` in `src/lib/mcp/tools.ts`, by calling the
 * same function rather than by promising to. This used to be a second copy of
 * the hints, and the two drifted.
 */
function explainAnalyzeFailure(err: unknown): string {
    if (err instanceof RateLimited) return rateLimitedMessage(err);
    if (err instanceof AnalyzeError) {
        return [`Could not analyze that site: ${err.message}`, analyzeFailureHint(err.code)].filter(Boolean).join(" ");
    }
    console.error("submit: draft failed", err);
    return "Something went wrong on our side. Nothing was changed. Try again in a moment.";
}

// ---------------------------------------------------------------------------
// Step two: commit
// ---------------------------------------------------------------------------

export type CommitState =
    | { status: "idle" }
    | { status: "signed_out" }
    | { status: "error"; message: string; field: "category" | "description" | "keywords" | null }
    | {
          status: "done";
          domain: string;
          /** "yourapp.com is listed and pending review." */
          headline: string;
          /** What happens next, in plain words. Never empty. */
          outcome: string;
      };

/**
 * What happens next, in the same words the `submit_site` tool uses.
 *
 * A constant rather than a computed sentence: nothing is matched at submit any
 * more, so there is no per-submission outcome left to describe. Kept in the
 * state object anyway, because the panel that renders it does not need to know
 * that, and the day matching says something per-submission again this is where
 * it goes.
 */
const PENDING_REVIEW_OUTCOME =
    "A human reads the listing, usually the same day. Matching runs the moment it is approved, and if a partner is waiting in your category you will hear by email right then.";

/**
 * Shown when the confirmation form does not carry a signature this server made.
 *
 * A member who used the page never sees it: `draftSiteAction` always signs what
 * it hands to the confirmation screen. It is reachable by posting to the action
 * directly, which is exactly the case worth refusing, so the wording says what
 * to do rather than accusing anybody of anything.
 */
const UNPROVEN_DRAFT =
    "That confirmation did not come with a draft this server made, so nothing was written. Start again from the URL and we will re-analyze the site.";

/**
 * Splits the anchors textarea into keywords.
 *
 * One per line is what the field asks for, but people paste comma-separated
 * lists, so both separators are accepted rather than silently producing one
 * very long "anchor".
 */
function parseKeywords(raw: string): string[] {
    return raw
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
}

/**
 * Writes the confirmed listing.
 *
 * It used to look for a partner here too. It no longer does: `autoPair` pairs
 * nothing that is not `active`, and a listing is `pending_review` until a human
 * clears it, so the call could only ever have come back empty. Matching happens
 * at approval, in `setSiteStatus`.
 *
 * @param _previous - Previous action state, unused.
 * @param formData - The confirmation form, including the signed draft fields.
 */
export async function commitSiteAction(_previous: CommitState, formData: FormData): Promise<CommitState> {
    const member = await getSessionMember();
    if (!member) return { status: "signed_out" };

    const url = String(formData.get("url") ?? "").trim();
    const signature = String(formData.get("signature") ?? "");

    // The URL is the one field on this form the member does not get to write.
    // `draftSite` fetched it, read it, and judged it substantial enough to list,
    // and `commitSite` turns it into the globally unique domain that is then
    // that member's forever. Nothing here re-analyzes, so an unsigned URL would
    // list any domain at all on one POST, with no fetch and no LLM call.
    const draft = verifyDraft(url, String(formData.get("domainRating") ?? ""), signature);
    if (!draft) {
        return { status: "error", message: UNPROVEN_DRAFT, field: null };
    }

    const category = String(formData.get("category") ?? "");
    const description = String(formData.get("description") ?? "");
    const keywords = parseKeywords(String(formData.get("keywords") ?? ""));
    const placementOffered = String(formData.get("placementOffered") ?? "");

    try {
        // Both halves of a submit are charged, exactly as they are on the tool
        // path, where the draft call and the confirm call each pass through
        // `guard`. One submitted listing costs two either way.
        await enforceToolLimit("submit_site", memberCaller(member.id));

        const site = await commitSite({
            member,
            url: draft.url,
            category,
            description,
            keywords,
            placementOffered,
            domainRating: draft.domainRating,
        });

        return {
            status: "done",
            domain: site.domain,
            headline: `${site.domain} is listed and pending review.`,
            outcome: PENDING_REVIEW_OUTCOME,
        };
    } catch (err) {
        if (err instanceof RateLimited) {
            return { status: "error", message: rateLimitedMessage(err), field: null };
        }
        if (err instanceof SiteError) {
            const field =
                err.code === "invalid_category" || err.code === "unmatchable_category"
                    ? ("category" as const)
                    : err.message.startsWith("A description")
                      ? ("description" as const)
                      : err.message.startsWith("Add at least one anchor")
                        ? ("keywords" as const)
                        : null;
            return { status: "error", message: err.message, field };
        }
        console.error("submit: commit failed", err);
        return {
            status: "error",
            message: "Something went wrong on our side. Try again in a moment.",
            field: null,
        };
    }
}
