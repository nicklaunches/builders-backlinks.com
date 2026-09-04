import { z } from "zod";

import {
    ApiError,
    assertSameOrigin,
    enforceMemberLimit,
    json,
    readJson,
    requireMember,
    toErrorResponse,
} from "@/lib/api";
import { markLinkPlaced } from "@/lib/services/links";
import { getThread } from "@/lib/services/threads";

/**
 * @file `POST /api/inbox/threads/[matchId]/placement` — "check and finish".
 *
 * SLOW ON PURPOSE, exactly as the dashboard action is: `markLinkPlaced` fetches
 * the page and parses it before answering, because a report that says "we will
 * look later" is worth much less than one that says what is on the page now.
 * The pane narrates the wait rather than spinning.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MATCH_ID = z.uuid();

const PlacementBody = z.object({
    pageUrl: z.string().trim().min(1, "Paste the URL of the page you put the link on."),
    anchorUsed: z.string().trim().max(300).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        assertSameOrigin(request);
        const member = await requireMember();
        const { matchId } = await context.params;
        if (!MATCH_ID.safeParse(matchId).success) throw new ApiError(404, "not_found", "No thread with that id.");

        const { pageUrl, anchorUsed } = await readJson(request, PlacementBody);
        await enforceMemberLimit("mark_link_placed", member);
        const report = await markLinkPlaced({ member, matchId, pageUrl, anchorUsed: anchorUsed || undefined });

        return json({ report, thread: await getThread({ member, matchId }) });
    } catch (err) {
        return toErrorResponse("mark link placed", err);
    }
}
