import { json, requireMember, toErrorResponse } from "@/lib/api";
import { listThreads } from "@/lib/services/threads";

/**
 * @file `GET /api/inbox/threads` — the left pane.
 *
 * Read-only and session-scoped, so it needs no origin check: a cross-site
 * caller cannot read the response body without CORS, and nothing here mutates.
 */

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const member = await requireMember();
        return json({ threads: await listThreads(member) });
    } catch (err) {
        return toErrorResponse("list threads", err);
    }
}
