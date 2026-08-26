import { z } from "zod";

import { ApiError, assertSameOrigin, json, requireMember, toErrorResponse } from "@/lib/api";
import { markThreadRead } from "@/lib/services/threads";

/**
 * @file `POST /api/inbox/threads/[matchId]/read` — moves the read cursor.
 *
 * A mutation, so it takes the origin check, and it is the one mutation allowed
 * before a match is revealed: opening a proposal you have not accepted is still
 * reading it.
 */

export const dynamic = "force-dynamic";

const MATCH_ID = z.uuid();

export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        assertSameOrigin(request);
        const member = await requireMember();
        const { matchId } = await context.params;
        if (!MATCH_ID.safeParse(matchId).success) throw new ApiError(404, "not_found", "No thread with that id.");

        return json(await markThreadRead({ member, matchId }));
    } catch (err) {
        return toErrorResponse("mark thread read", err);
    }
}
