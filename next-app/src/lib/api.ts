import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import type { ExchangeMember } from "@/lib/db/schema";
import { RateLimited, enforceToolLimit, memberCaller, rateLimitedMessage } from "@/lib/limits";
import { errorDetail } from "@/lib/log";
import { LinkError } from "@/lib/services/links";
import { MatchError } from "@/lib/services/matches";
import { ThreadError } from "@/lib/services/threads";
import { getSessionMember } from "@/lib/session";

/**
 * @file The seam every `/api/inbox` route goes through.
 *
 * The rest of this app writes through server actions, which Next hardens for
 * us: an action POST carries a per-build id and Next rejects a cross-origin
 * one. A plain route handler gets none of that, and these routes are
 * cookie-authenticated, so any page on the internet could otherwise POST a
 * message as whoever is signed in. {@link assertSameOrigin} is that missing
 * check and it runs on every mutation here.
 *
 * The routes exist rather than more actions because the inbox polls: a client
 * asking "anything since this timestamp" every few seconds wants a cacheable,
 * cancellable GET, and the same URLs are what the end-to-end suite drives.
 *
 * ONE ERROR VOCABULARY. Services throw their own typed errors, and
 * {@link toErrorResponse} is the only place that decides what each one is worth
 * in HTTP. A route that invents its own status for `not_yours` is how one
 * surface starts leaking the difference between "no such thread" and "not
 * yours", which is exactly the distinction the services are careful about.
 */

/** A refusal raised by the route layer itself, rather than by a service. */
export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

/** Signed-in payloads are per-member and must never sit in a shared cache. */
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

export function json(data: unknown, status = 200): NextResponse {
    return NextResponse.json(data, { status, headers: PRIVATE_HEADERS });
}

/**
 * Rejects a cookie-authenticated mutation that did not come from our own pages.
 *
 * Two independent signals, and either one being wrong is fatal. `Sec-Fetch-Site`
 * is set by the browser and cannot be forged by page script; `Origin` is sent on
 * every cross-site POST. A request carrying NEITHER is not a browser — curl, the
 * smoke suite, an agent — and cannot be a confused-deputy attack, so it passes.
 *
 * @throws `ApiError` 403 when the request came from another origin.
 */
export function assertSameOrigin(request: Request): void {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
        throw new ApiError(403, "cross_origin", "This endpoint only accepts requests from the site itself.");
    }

    const origin = request.headers.get("origin");
    if (!origin) return;

    let originHost: string;
    try {
        originHost = new URL(origin).host;
    } catch {
        throw new ApiError(403, "cross_origin", "Unreadable Origin header.");
    }

    const allowed = new Set<string>();
    allowed.add(new URL(request.url).host);
    const forwarded = request.headers.get("host");
    if (forwarded) allowed.add(forwarded);
    const configured = process.env.NEXT_PUBLIC_SITE_URL;
    if (configured) {
        try {
            allowed.add(new URL(configured).host);
        } catch {
            // A malformed NEXT_PUBLIC_SITE_URL must not widen the allowlist.
        }
    }

    if (!allowed.has(originHost)) {
        throw new ApiError(403, "cross_origin", "This endpoint only accepts requests from the site itself.");
    }
}

/**
 * The signed-in member, or a 401.
 *
 * @throws `ApiError` 401 when there is no session.
 */
export async function requireMember(): Promise<ExchangeMember> {
    const member = await getSessionMember();
    if (!member) throw new ApiError(401, "signed_out", "Sign in to use the inbox.");
    return member;
}

/**
 * Parses and validates a JSON body.
 *
 * The content-type check is a second CSRF hurdle rather than pedantry: a form
 * post, which is the one cross-origin request a page can make without CORS,
 * cannot set `application/json`.
 *
 * @throws `ApiError` 415 or 400.
 */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().includes("application/json")) {
        throw new ApiError(415, "unsupported_media_type", "Send a JSON body.");
    }

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        throw new ApiError(400, "bad_json", "That request body was not valid JSON.");
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        throw new ApiError(400, "bad_request", parsed.error.issues[0]?.message ?? "That request was not valid.");
    }
    return parsed.data;
}

/** Spends the shared per-member budget for a capability, by its tool name. */
export async function enforceMemberLimit(tool: string, member: ExchangeMember): Promise<void> {
    await enforceToolLimit(tool, memberCaller(member.id));
}

/**
 * The one mapping from a thrown error to an HTTP answer.
 *
 * `not_found` and `not_yours` both answer 404 on purpose. A member who guesses
 * a thread id belonging to strangers learns nothing from the status either way,
 * and 403 would confirm the id exists.
 */
export function toErrorResponse(label: string, err: unknown): NextResponse {
    if (err instanceof ApiError) {
        return json({ error: err.code, message: err.message }, err.status);
    }
    if (err instanceof RateLimited) {
        return json({ error: "rate_limited", message: rateLimitedMessage(err) }, 429);
    }
    if (err instanceof ThreadError) {
        const status = err.code === "invalid" ? 400 : err.code === "not_revealed" ? 409 : 404;
        return json({ error: err.code, message: err.message }, status);
    }
    if (err instanceof MatchError) {
        return json({ error: err.code, message: err.message }, err.code === "bad_state" ? 409 : 404);
    }
    if (err instanceof LinkError) {
        const status = err.code === "not_agreed" ? 409 : err.code === "invalid_url" ? 400 : 404;
        return json({ error: err.code, message: err.message }, status);
    }

    console.error(`api: ${label} failed`, errorDetail(err));
    return json({ error: "server_error", message: "Something went wrong on our side. The error was logged." }, 500);
}
