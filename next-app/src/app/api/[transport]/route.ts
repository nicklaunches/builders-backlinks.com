import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { bearerFromHeader, resolveMemberFromBearer } from "@/lib/auth/api-key";
import { callerKey } from "@/lib/mcp/limits";
import { registerTools } from "@/lib/mcp/tools";
import type { ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";

/**
 * @file The MCP server. This is the product's primary interface.
 *
 * Served at /api/mcp (Streamable HTTP) and /api/sse (legacy). Added to a client
 * once:
 *
 *   claude mcp add --transport http builders-backlinks \
 *     https://builders-backlinks.com/api/mcp \
 *     --header "Authorization: Bearer bb_live_..."
 *
 * AUTHENTICATION SHAPE, and why it is this way.
 *
 * `required: false` is deliberate. The read tools (search_partners,
 * get_categories, get_rules) work with no credentials at all, so adding the
 * server succeeds instantly and the very first thing a member can do is see
 * whether anyone like them is here. Making someone authenticate before they can
 * see whether the product is worth anything is the wrong order, and an MCP
 * client that fails on `add` is one nobody debugs, they just remove it.
 *
 * Write tools resolve the member themselves and return a sign-in instruction if
 * there is none (see `requireMember` in lib/mcp/tools.ts). That message is
 * written to be actioned by a model, not just read by a human.
 *
 * When OAuth 2.1 replaces header tokens, `verifyToken` gains a second branch
 * for JWTs and `resourceMetadataPath` starts pointing at a real authorization
 * server. Nothing in the tool layer changes.
 */

// Site analysis on submit_site does a live fetch, an Ahrefs call, and an LLM
// call. Comfortably inside this, but well beyond the default.
export const maxDuration = 60;

/**
 * The member for the current request, keyed by the bearer token.
 *
 * Resolved once per request in `verifyToken` and stashed here so the tool
 * registration closure can read it without re-querying. Module scope is safe
 * because each Vercel function invocation handles one request at a time; if
 * that ever stops being true, this moves into the handler closure.
 */
let currentMember: ExchangeMemberHydrated | null = null;

/**
 * The rate-limit identity for the current request.
 *
 * Set alongside `currentMember` in `verifyToken`, which is the only place with
 * access to the raw Request and therefore to the client IP. Anonymous callers
 * are bucketed by IP, signed-in ones by member id.
 */
let currentCaller = "ip:unknown";

const handler = createMcpHandler(
    (server) => {
        registerTools(server, {
            get member() {
                return currentMember;
            },
            get caller() {
                return currentCaller;
            },
        });
    },
    {
        serverInfo: { name: "builders-backlinks", version: "0.1.0" },
    },
    {
        basePath: "/api",
        maxDuration: 60,
        verboseLogs: process.env.NODE_ENV !== "production",
    },
);

/**
 * Resolves a bearer token to auth info, and records the member for this request.
 *
 * Returning `undefined` is not a rejection here: with `required: false` it
 * simply means the caller is anonymous, which the read tools allow.
 */
const verifyToken = async (req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    const token = bearerFromHeader(bearerToken ? `Bearer ${bearerToken}` : null);
    const member = await resolveMemberFromBearer(token);
    currentMember = member;
    currentCaller = callerKey(member ? String(member._id) : null, req.headers);
    if (!member || !token) return undefined;

    return {
        token,
        scopes: ["exchange:read", "exchange:write"],
        clientId: String(member.user),
        extra: { memberId: String(member._id), userId: String(member.user) },
    };
};

const authHandler = withMcpAuth(handler, verifyToken, {
    // Anonymous callers are allowed through; individual write tools gate
    // themselves. See the @file note above.
    required: false,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
