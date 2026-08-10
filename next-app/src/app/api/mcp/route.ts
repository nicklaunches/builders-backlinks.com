import {
    type McpRequestContext,
    McpServer,
    localhostAllowedOrigins,
    preloadSchemas,
} from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";

import { bearerFromHeader, resolveMemberFromBearer } from "@/lib/auth/api-key";
import { callerKey } from "@/lib/limits";
import { type ToolContext, registerTools } from "@/lib/mcp/tools";

/**
 * @file The MCP server. This is the product's primary interface.
 *
 * Served at /api/mcp over Streamable HTTP. Added to a client once:
 *
 *   claude mcp add --transport http builders-backlinks \
 *     https://builders-backlinks.com/api/mcp \
 *     --header "Authorization: Bearer bb_live_..."
 *
 * WHY THIS TRANSPORT.
 *
 * Vercel's `mcp-handler` does not run on `workerd`. It bundles, then the
 * runtime kills the request with "your Worker's code had hung and would never
 * generate a response" while its Node stream shims leak timeout listeners.
 * There is no configuration that fixes that, so the transport was replaced with
 * Cloudflare's `createMcpHandler` from the `agents` package: stateless,
 * Streamable HTTP, and the supported path now that `McpAgent` is deprecated and
 * feature-frozen. It requires MCP SDK v2 (`@modelcontextprotocol/server`) and
 * refuses a v1 server, which is why the tool file imports `McpServer` from
 * there rather than from `@modelcontextprotocol/sdk`.
 *
 * The handler is stateless: one fresh `McpServer` per request, built by the
 * factory below. That is not a detail to work around, it is what makes the
 * server correct on an isolate-based runtime, where a single isolate serves
 * many concurrent requests and any per-request state parked at module scope
 * would be read by the wrong caller. The previous adapter stashed the current
 * member in a module-level `let` and got away with it only because a Vercel
 * function handles one request at a time. Do not reintroduce that here.
 *
 * The legacy lane is left at its default (`legacy: "stateless"`), so clients
 * still speaking the 2025 revision are served from the same factory on this
 * same URL. That replaces the old /api/sse endpoint, which the deprecated SSE
 * transport needed and nothing does now.
 *
 * AUTHENTICATION SHAPE, and why it is this way.
 *
 * Anonymous callers are allowed all the way through to the tools. The read
 * tools (search_partners, get_categories, get_rules) work with no credentials
 * at all, so adding the server succeeds instantly and the very first thing a
 * member can do is see whether anyone like them is here. Making someone
 * authenticate before they can see whether the product is worth anything is the
 * wrong order, and an MCP client that fails on `add` is one nobody debugs, they
 * just remove it.
 *
 * Write tools resolve the member themselves and return a sign-in instruction if
 * there is none (see `requireMember` in lib/mcp/tools.ts). That message is
 * written to be actioned by a model, not just read by a human.
 *
 * When OAuth 2.1 replaces header tokens, the verified caller arrives through
 * `getMcpAuthContext()` (which an OAuth provider in front of this handler
 * populates) and `resolveCaller` below stops reading the Authorization header.
 * Nothing in the tool layer changes.
 *
 * There is no `maxDuration` here. It was a Vercel function setting and means
 * nothing on Workers, where the budget is CPU time rather than wall clock, so
 * `submit_site` waiting on a page fetch, a VerifiedDR call and an LLM call is
 * mostly idle time that does not count against it.
 */

/**
 * The exact pathname this handler answers on.
 *
 * `createMcpHandler` compares it against the request pathname and 404s on a
 * mismatch, so it has to track the route folder rather than default to "/mcp".
 */
const ROUTE = "/api/mcp";

// Builds every lazily-constructed wire schema now, during isolate warm-up,
// instead of on the first request each fresh isolate serves. Workers bill for
// request CPU and not for module evaluation, so this is free here in a way it
// would not be on a per-process runtime.
preloadSchemas();

/**
 * Resolves the caller for one request.
 *
 * Two sources, in priority order:
 *
 * 1. `getMcpAuthContext()`. Populated when an OAuth provider has already
 *    verified the caller in front of this handler. It is checked first so that
 *    landing OAuth 2.1 is a change to this function and nothing else.
 * 2. The Authorization header, which is the live path today: `bb_live_` tokens
 *    minted at /app/key.
 *
 * Nothing from either source is logged or returned. The token is a credential,
 * and the auth context's props are the caller's, not ours to echo back.
 *
 * A failure to resolve is treated as anonymous rather than as an error. That
 * fails CLOSED on privilege (an unresolved caller gets the sign-in hint from
 * the write tools, never someone else's member) while keeping the anonymous
 * reads answering, which is the only part of the surface that has to work
 * before anyone has signed in.
 */
async function resolveCaller(request: Request | undefined): Promise<ToolContext> {
    const headers = request?.headers ?? new Headers();
    const verified = getMcpAuthContext()?.props.token;
    const token =
        typeof verified === "string"
            ? bearerFromHeader(`Bearer ${verified}`)
            : bearerFromHeader(headers.get("authorization"));

    let member = null;
    try {
        member = await resolveMemberFromBearer(token);
    } catch (err) {
        console.error("mcp auth lookup failed; treating caller as anonymous", err);
    }

    return { member, caller: callerKey(member ? member.id : null, headers) };
}

/**
 * Builds one server for one request.
 *
 * Pass the factory itself, never a constructed instance: the handler calls this
 * per request precisely so that `ctx` below cannot be shared between callers.
 */
async function createServer({ requestInfo }: McpRequestContext): Promise<McpServer> {
    const server = new McpServer({ name: "builders-backlinks", version: "0.1.0" });
    registerTools(server, await resolveCaller(requestInfo));
    return server;
}

/**
 * Browser Origins this endpoint accepts.
 *
 * Requests with no Origin header (every non-browser MCP client, including
 * Claude Code and the Inspector's proxy) are unaffected. The default would be
 * localhost only, which would lock out anything served from the site itself.
 */
function allowedOriginHostnames(): string[] {
    const hostnames = new Set(localhostAllowedOrigins());
    try {
        const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").hostname;
        if (site) hostnames.add(site);
    } catch {
        // NEXT_PUBLIC_SITE_URL is unset or not a URL. The localhost defaults stand.
    }
    return [...hostnames];
}

const handler = createMcpHandler(createServer, {
    route: ROUTE,
    allowedOriginHostnames: allowedOriginHostnames(),
    onerror: (err) => console.error("mcp transport error", err),
});

/**
 * The one handler behind all four HTTP methods.
 *
 * POST carries the JSON-RPC exchange, GET opens a subscription stream, and
 * DELETE and OPTIONS are answered by the transport itself. Next needs each one
 * exported by name to route it here.
 */
const serve = (request: Request): Promise<Response> => handler.fetch(request);

export { serve as GET, serve as POST, serve as DELETE, serve as OPTIONS };
