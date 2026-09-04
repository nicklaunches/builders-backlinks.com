import { z } from "zod";

import { ApiError, enforceMemberLimit, json, requireMember, toErrorResponse } from "@/lib/api";
import { type SnippetFormat, getLinkBrief } from "@/lib/services/links";

/**
 * @file `GET /api/inbox/threads/[matchId]/brief` — the snippet to paste.
 *
 * Fetched on demand rather than with the thread, for the same reason the
 * dashboard fetches it per match: a brief contains the partner's real URL, so
 * loading one eagerly would put a revealed identity into the payload of a page
 * that also lists threads which are not revealed.
 */

export const dynamic = "force-dynamic";

const MATCH_ID = z.uuid();
const FORMATS = ["html", "markdown", "mdx", "jsx"] as const satisfies readonly SnippetFormat[];

export async function GET(request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        const member = await requireMember();
        const { matchId } = await context.params;
        if (!MATCH_ID.safeParse(matchId).success) throw new ApiError(404, "not_found", "No thread with that id.");

        const raw = new URL(request.url).searchParams.get("format");
        const format = (FORMATS as readonly string[]).includes(raw ?? "") ? (raw as SnippetFormat) : "html";

        await enforceMemberLimit("get_link_brief", member);
        return json({ brief: await getLinkBrief({ member, matchId, format }) });
    } catch (err) {
        return toErrorResponse("get link brief", err);
    }
}
