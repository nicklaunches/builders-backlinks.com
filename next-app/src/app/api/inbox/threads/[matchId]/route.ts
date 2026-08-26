import { z } from "zod";

import { ApiError, json, requireMember, toErrorResponse } from "@/lib/api";
import { getThread } from "@/lib/services/threads";

/**
 * @file `GET /api/inbox/threads/[matchId]` — one thread, whole.
 *
 * Returns the masked or revealed partner, the rail, both link tasks and the
 * merged timeline. The reveal decision is the service's; this route has no
 * branch of its own, which is what keeps the boundary in one place.
 */

export const dynamic = "force-dynamic";

const MATCH_ID = z.uuid();

export async function GET(_request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        const member = await requireMember();
        const { matchId } = await context.params;
        if (!MATCH_ID.safeParse(matchId).success) throw new ApiError(404, "not_found", "No thread with that id.");

        return json({ thread: await getThread({ member, matchId }) });
    } catch (err) {
        return toErrorResponse("get thread", err);
    }
}
