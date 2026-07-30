"use server";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Category } from "@/lib/categories";
import { AnalyzeError } from "@/lib/contracts";
import { SiteError, commitSite, draftSite } from "@/lib/services/sites";
import { getSessionMember } from "@/lib/session";

/**
 * @file Server actions behind `/submit`, the browser twin of the `submit_site` MCP tool.
 *
 * These two actions are deliberately the same shape as the one tool: call
 * `draftSiteAction` first and nothing is written, call `commitSiteAction` only
 * after a human has read the drafted words. Both call the exact same service
 * functions (`draftSite`, `commitSite`) in the exact same order as
 * `src/lib/mcp/tools.ts`, and the error text is copied from `explain()` there.
 * If the two ever say different things about the same failure, one of the two
 * interfaces has started to drift and the agent one is supposed to be
 * first-class.
 *
 * Neither surface pairs on submit. `autoPair` refuses anything that is not
 * `active` and a listing is `pending_review` until review clears it, so both
 * used to carry copy for four outcomes when only one was reachable. The call is
 * gone from both; matching happens at approval, in `setSiteStatus`.
 *
 * One place the web path is deliberately NOT identical: Domain Rating is signed
 * between the two steps (see `signDraft`). The MCP tool re-derives it from a
 * draft it holds in memory; a browser has to round-trip it through a form field,
 * and DR is a public number partners judge on, so a hand-edited hidden input
 * must not be able to inflate it. A bad signature drops the score to null rather
 * than failing the submit.
 */

// ---------------------------------------------------------------------------
// Draft signing
// ---------------------------------------------------------------------------

function draftSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET must be set: it signs the Domain Rating carried between submit steps.");
    return secret;
}

function signDraft(url: string, domainRating: number | null): string {
    return createHmac("sha256", draftSecret())
        .update(`${url}\n${domainRating ?? ""}`)
        .digest("hex");
}

/**
 * Returns the Domain Rating only when it is provably the one this server
 * produced during the draft step. Anything else is treated as unknown.
 */
function verifiedDomainRating(url: string, raw: string, signature: string): number | null {
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    const domainRating = parsed == null || Number.isNaN(parsed) ? null : parsed;

    const expected = Buffer.from(signDraft(url, domainRating), "utf8");
    const given = Buffer.from(signature, "utf8");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    return domainRating;
}

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

/** Mirrors `explain()` in `src/lib/mcp/tools.ts`, word for word where it applies. */
function explainAnalyzeFailure(err: unknown): string {
    if (err instanceof AnalyzeError) {
        const hint =
            err.code === "too_thin"
                ? "The exchange only lists real sites with real content. If this is a live product page, tell us and a human will look."
                : err.code === "unreachable"
                  ? "Check the URL is right and the site is publicly reachable."
                  : err.code === "invalid_url"
                    ? "Include the full address, starting with https://."
                    : err.code === "not_html"
                      ? "That address did not return a web page we could read."
                      : err.code === "blocked"
                        ? "The site refused our request. If it sits behind a bot wall, tell us and a human will look."
                        : err.code === "llm_failed"
                          ? "We could not draft a description just now. Try again in a moment."
                          : "";
        return [`Could not analyze that site: ${err.message}`, hint].filter(Boolean).join(" ");
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
    const domainRating = verifiedDomainRating(url, String(formData.get("domainRating") ?? ""), signature);

    const category = String(formData.get("category") ?? "");
    const description = String(formData.get("description") ?? "");
    const keywords = parseKeywords(String(formData.get("keywords") ?? ""));
    const placementOffered = String(formData.get("placementOffered") ?? "");

    try {
        const site = await commitSite({
            member,
            url,
            category,
            description,
            keywords,
            placementOffered,
            domainRating,
        });

        return {
            status: "done",
            domain: site.domain,
            headline: `${site.domain} is listed and pending review.`,
            outcome: PENDING_REVIEW_OUTCOME,
        };
    } catch (err) {
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
