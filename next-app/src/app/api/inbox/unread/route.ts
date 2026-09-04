import { json, requireMember, toErrorResponse } from "@/lib/api";
import { unreadCount } from "@/lib/services/threads";

/**
 * @file `GET /api/inbox/unread` — the number on the Inbox tab.
 *
 * Polled from every `/app` page, so it is one aggregate query and nothing else.
 * Read-only and session-scoped, so it needs no origin check, like the list.
 */

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const member = await requireMember();
        return json({ unread: await unreadCount(member) });
    } catch (err) {
        return toErrorResponse("unread count", err);
    }
}
