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
import { respondToMatch } from "@/lib/services/matches";
import { getThread } from "@/lib/services/threads";

/**
 * @file `POST /api/inbox/threads/[matchId]/respond` — accept or decline.
 *
 * Calls the same `respondToMatch` the MCP tool and the dashboard action call,
 * then re-reads the thread so the pane gets the post-reveal shape in one round
 * trip: accepting can flip the match to `agreed`, which changes the partner from
 * masked to revealed, and a client that only learned "ok" would render stale.
 */

export const dynamic = "force-dynamic";

const MATCH_ID = z.uuid();

const RespondBody = z.object({
    accept: z.boolean(),
    reason: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        assertSameOrigin(request);
        const member = await requireMember();
        const { matchId } = await context.params;
        if (!MATCH_ID.safeParse(matchId).success) throw new ApiError(404, "not_found", "No thread with that id.");

        const { accept, reason } = await readJson(request, RespondBody);
        await enforceMemberLimit("respond_to_match", member);
        await respondToMatch({ member, matchId, accept, reason: reason || undefined });

        return json({ thread: await getThread({ member, matchId }) });
    } catch (err) {
        return toErrorResponse("respond to match", err);
    }
}
