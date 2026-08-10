import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * @file Rate limiting for both interfaces.
 *
 * It used to live in `lib/mcp/` and cap the tool surface only, which quietly
 * made the browser the cheap way in: a server action is a POST endpoint that
 * anyone signed in can call in a loop, and `draftSiteAction` spends a page
 * fetch, an LLM call and a VerifiedDR lookup per call exactly as `submit_site`
 * does. One capped path and one uncapped path to the same service function is
 * not a budget. The budgets are keyed by the TOOL NAME on purpose, so a member
 * shares one bucket across both interfaces rather than getting a second
 * allowance by switching surface.
 *
 * The read tools (`search_partners`, `get_categories`, `get_rules`) answer with
 * no credentials at all. That is deliberate, it is what makes `claude mcp add`
 * succeed instantly and lets someone see whether the exchange is worth joining
 * before handing over anything. It also means they are a public, machine-shaped
 * API being called by agents in loops, so leaving them uncapped hands out a
 * scrape of the member base for the price of a for-loop.
 *
 * Two axes, because they defend against different things:
 *
 * - Per identity, which is the member id when signed in and the client IP when
 *   not. This is the real limit.
 * - `search_partners` is capped harder than the other reads, because it is the
 *   only one that returns anything about other members. `get_rules` returning a
 *   constant a thousand times is rude, not dangerous.
 *
 * Writes are capped too, more loosely, and mostly to stop a runaway agent
 * listing the same site forty times or burning an LLM call per second. Site
 * analysis costs real money per call, so `submit_site` is the tightest of them.
 *
 * The limiter fails OPEN on a database error (see `rate-limit.ts`). That is the
 * right call: a database blip should not take the product down. It does mean
 * this is abuse control, not a security boundary, and the masking in
 * `services/mask.ts` is what actually protects identities.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Per-tool budgets. Anything not listed falls back to DEFAULT. */
const BUDGETS: Record<string, { limit: number; windowMs: number }> = {
    // The only read that discloses anything about other members.
    search_partners: { limit: 60, windowMs: HOUR },
    get_categories: { limit: 120, windowMs: HOUR },
    get_rules: { limit: 120, windowMs: HOUR },

    // Each call fetches a page, runs an LLM, and hits VerifiedDR, which has a
    // monthly call quota. Real cost per call, so this is the tightest budget.
    submit_site: { limit: 20, windowMs: HOUR },

    // Fetches the member's page to verify a placement.
    mark_link_placed: { limit: 60, windowMs: HOUR },
};

const DEFAULT = { limit: 240, windowMs: HOUR };

/** Raised when a caller is over budget. The tool layer turns it into guidance. */
export class RateLimited extends Error {
    constructor(public readonly retryAfterSeconds: number) {
        super("rate_limited");
        this.name = "RateLimited";
    }
}

/**
 * Derives a stable per-caller key.
 *
 * A member id is used whenever we have one, so a signed-in member is not
 * throttled by whatever else shares their NAT. Falling back to IP is imperfect
 * (a shared office egress is one bucket) which is why anonymous budgets are set
 * generously enough that ordinary use never notices them.
 */
export function callerKey(memberId: string | null, headers: Headers): string {
    if (memberId) return memberCaller(memberId);
    // CF-Connecting-IP is set by the edge and any inbound copy overwritten, so
    // it cannot be spoofed. x-forwarded-for is the fallback off-edge and IS
    // caller-controlled there, which is why the anonymous budgets assume a
    // bucket can be minted rather than treating one as an identity.
    const edge = headers.get("cf-connecting-ip")?.trim();
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return `ip:${edge || forwarded || headers.get("x-real-ip") || "unknown"}`;
}

/**
 * The bucket a signed-in member shares between the two interfaces.
 *
 * The browser knows who the caller is before it does anything, so it never
 * needs the IP fallback in {@link callerKey}. Same string either way, which is
 * the point: twenty submits from the tool and twenty from the form are forty
 * submits, not two allowances of twenty.
 */
export function memberCaller(memberId: string): string {
    return `member:${memberId}`;
}

/**
 * What a browser surface tells someone who ran out of budget.
 *
 * Kept beside the budgets rather than written out at each call site, so the
 * five server actions cannot end up saying five different things about the same
 * refusal. The tool surface has its own wording in `explain()`, which is
 * addressed to a model and tells it to stop looping.
 */
export function rateLimitedMessage(err: RateLimited): string {
    const minutes = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
    return `You are doing that faster than the exchange allows. Wait about ${minutes} minute(s) and try again.`;
}

/**
 * Enforces the budget for one tool call.
 *
 * @throws `RateLimited` when the caller is over budget for this tool.
 */
export async function enforceToolLimit(tool: string, caller: string): Promise<void> {
    const budget = BUDGETS[tool] ?? DEFAULT;
    const { allowed, retryAfter } = await enforceRateLimit({
        bucket: `mcp:${tool}`,
        userId: caller,
        limit: budget.limit,
        windowMs: budget.windowMs,
    });
    if (!allowed) throw new RateLimited(retryAfter);
}
