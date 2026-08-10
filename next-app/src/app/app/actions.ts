"use server";

import { RateLimited, enforceToolLimit, memberCaller, rateLimitedMessage } from "@/lib/limits";
import { type LinkBrief, LinkError, type PlacementReport, getLinkBrief, markLinkPlaced } from "@/lib/services/links";
import { MatchError, respondToMatch } from "@/lib/services/matches";
import { getSessionMember } from "@/lib/session";

/**
 * @file The dashboard's three mutations.
 *
 * Every one of these already existed as an MCP tool and had no browser path at
 * all, which quietly made a coding agent mandatory rather than preferred. These
 * call the same service functions the tools call, so the two interfaces cannot
 * drift: `respond_to_match` and this file both end up in `respondToMatch`.
 *
 * Each one spends the budget of the tool it twins, under that tool's name, so a
 * member has one allowance rather than one per interface. `mark_link_placed` is
 * the one that matters: it crawls a URL the caller chose, and an uncapped
 * surface that fetches on demand is a request proxy with our name on the
 * outbound packets.
 *
 * Conventions, matching `submit/actions.ts` and `app/key/actions.ts`: file-level
 * "use server", a discriminated union with an "idle" arm, the member fetched
 * first and a `signed_out` arm rather than a redirect, errors RETURNED not
 * thrown (a thrown error reaches the client as an opaque digest), and no
 * `revalidatePath` anywhere. The client holds enough state to update itself.
 */

export type RespondState =
    | { status: "idle" }
    | { status: "signed_out" }
    | { status: "error"; matchId: string; message: string }
    | { status: "done"; matchId: string; accepted: boolean; revealed: boolean };

/**
 * Accepts or declines a proposed match.
 *
 * `revealed` comes back on the done arm because accepting is only half of a
 * reveal: identities appear when BOTH sides have accepted, so the client cannot
 * infer it from its own click.
 */
export async function respondToMatchAction(_previous: RespondState, formData: FormData): Promise<RespondState> {
    const member = await getSessionMember();
    if (!member) return { status: "signed_out" };

    const matchId = String(formData.get("matchId") ?? "");
    const accept = String(formData.get("accept") ?? "") === "true";
    const reason = String(formData.get("reason") ?? "").trim();

    if (!matchId) return { status: "error", matchId, message: "No match was submitted." };

    try {
        await enforceToolLimit("respond_to_match", memberCaller(member.id));

        const view = await respondToMatch({ member, matchId, accept, reason: reason || undefined });
        return { status: "done", matchId, accepted: accept, revealed: view.revealed };
    } catch (err) {
        if (err instanceof RateLimited) return { status: "error", matchId, message: rateLimitedMessage(err) };
        if (err instanceof MatchError) return { status: "error", matchId, message: err.message };
        console.error("dashboard: respondToMatch failed", err);
        return { status: "error", matchId, message: "Could not record that. The error was logged." };
    }
}

export type BriefState =
    | { status: "idle" }
    | { status: "signed_out" }
    | { status: "error"; matchId: string; message: string }
    | { status: "done"; matchId: string; brief: LinkBrief };

/**
 * Fetches the brief on demand rather than with the page.
 *
 * Deliberate: a brief contains the partner's real URL, so loading one for every
 * agreed match up front would put revealed identities into the initial payload
 * of a page that also lists un-agreed matches. Fetching per match keeps the
 * reveal boundary aligned with an explicit user action.
 */
export async function getLinkBriefAction(_previous: BriefState, formData: FormData): Promise<BriefState> {
    const member = await getSessionMember();
    if (!member) return { status: "signed_out" };

    const matchId = String(formData.get("matchId") ?? "");
    const rawFormat = String(formData.get("format") ?? "html");
    const format = (["html", "markdown", "mdx", "jsx"] as const).includes(rawFormat as "html")
        ? (rawFormat as "html" | "markdown" | "mdx" | "jsx")
        : "html";

    if (!matchId) return { status: "error", matchId, message: "No match was submitted." };

    try {
        await enforceToolLimit("get_link_brief", memberCaller(member.id));

        const brief = await getLinkBrief({ member, matchId, format });
        return { status: "done", matchId, brief };
    } catch (err) {
        if (err instanceof RateLimited) return { status: "error", matchId, message: rateLimitedMessage(err) };
        if (err instanceof LinkError) return { status: "error", matchId, message: err.message };
        console.error("dashboard: getLinkBrief failed", err);
        return { status: "error", matchId, message: "Could not build that brief. The error was logged." };
    }
}

export type PlaceState =
    | { status: "idle" }
    | { status: "signed_out" }
    | { status: "error"; matchId: string; message: string }
    | { status: "done"; matchId: string; report: PlacementReport };

/**
 * Records a placement and verifies it inline.
 *
 * SLOW ON PURPOSE. `markLinkPlaced` fetches the page and parses it before
 * returning, the same latency class as the submit analyzer, because a report
 * that says "we will check later" is worth much less than one that says what is
 * actually on the page right now. The UI has to explain the wait rather than
 * spin, which is why `submit-flow.tsx` narrates its steps.
 *
 * Three outcomes, and the third is why this is not a boolean: found, not found,
 * and INCONCLUSIVE when the crawl itself failed. Reporting a failed crawl as a
 * missing link would accuse someone of breaking a promise they kept.
 */
export async function markLinkPlacedAction(_previous: PlaceState, formData: FormData): Promise<PlaceState> {
    const member = await getSessionMember();
    if (!member) return { status: "signed_out" };

    const matchId = String(formData.get("matchId") ?? "");
    const pageUrl = String(formData.get("pageUrl") ?? "").trim();
    const anchorUsed = String(formData.get("anchorUsed") ?? "").trim();

    if (!matchId) return { status: "error", matchId, message: "No match was submitted." };
    if (!pageUrl) {
        return { status: "error", matchId, message: "Paste the URL of the page you put the link on." };
    }

    try {
        await enforceToolLimit("mark_link_placed", memberCaller(member.id));

        const report = await markLinkPlaced({
            member,
            matchId,
            pageUrl,
            anchorUsed: anchorUsed || undefined,
        });
        return { status: "done", matchId, report };
    } catch (err) {
        if (err instanceof RateLimited) return { status: "error", matchId, message: rateLimitedMessage(err) };
        if (err instanceof LinkError) return { status: "error", matchId, message: err.message };
        console.error("dashboard: markLinkPlaced failed", err);
        return { status: "error", matchId, message: "Could not check that page. The error was logged." };
    }
}
