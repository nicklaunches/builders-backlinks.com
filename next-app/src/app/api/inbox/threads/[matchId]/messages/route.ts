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
import { MESSAGE_MAX_LENGTH } from "@/lib/inbox";
import { listMessages, sendMessage } from "@/lib/services/threads";

/**
 * @file The messages in one thread: `GET` to poll, `POST` to write.
 *
 * The `since` cursor is why polling is affordable. A thread nobody has written
 * in answers with an empty array and one indexed range scan, so a tab left open
 * costs about as much as leaving it closed.
 */

export const dynamic = "force-dynamic";

const MATCH_ID = z.uuid();

const SendBody = z.object({
    body: z
        .string()
        .trim()
        .min(1, "A message needs some text in it.")
        .max(MESSAGE_MAX_LENGTH, `Messages are capped at ${MESSAGE_MAX_LENGTH} characters.`),
});

async function readMatchId(context: { params: Promise<{ matchId: string }> }): Promise<string> {
    const { matchId } = await context.params;
    if (!MATCH_ID.safeParse(matchId).success) throw new ApiError(404, "not_found", "No thread with that id.");
    return matchId;
}

export async function GET(request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        const member = await requireMember();
        const matchId = await readMatchId(context);

        const raw = new URL(request.url).searchParams.get("since");
        let since: Date | undefined;
        if (raw) {
            const parsed = new Date(raw);
            if (Number.isNaN(parsed.getTime())) {
                throw new ApiError(400, "bad_request", "`since` must be an ISO timestamp.");
            }
            since = parsed;
        }

        await enforceMemberLimit("list_messages", member);
        return json({ messages: await listMessages({ member, matchId, since }) });
    } catch (err) {
        return toErrorResponse("list messages", err);
    }
}

export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
    try {
        assertSameOrigin(request);
        const member = await requireMember();
        const matchId = await readMatchId(context);
        const { body } = await readJson(request, SendBody);

        await enforceMemberLimit("send_message", member);
        return json({ message: await sendMessage({ member, matchId, body }) }, 201);
    } catch (err) {
        return toErrorResponse("send message", err);
    }
}
