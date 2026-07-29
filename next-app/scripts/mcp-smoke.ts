import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

import { hashApiKey, mintApiKey } from "@/lib/auth/api-key";
import { db } from "@/lib/db";
import { exchangeMembers, users } from "@/lib/db/schema";

// Next loads .env.local automatically; a plain node script does not. Load it
// before anything imports a module that reads process.env at call time.
loadEnv({ path: ".env.local", quiet: true });

/**
 * @file End-to-end smoke test for the MCP server.
 *
 * This is the Phase 1 ship gate. Unit tests prove the pieces work; this proves
 * a real MCP client can add the server, list its tools, and call them over
 * Streamable HTTP exactly as Claude Code will. Everything below goes over the
 * wire against a running dev server: no mocks, no direct service calls.
 *
 * Usage:
 *   pnpm dev                              (in another shell, on PORT=3100)
 *   pnpm test:mcp
 *
 * Or against the real runtime, which is the one that matters:
 *   npx opennextjs-cloudflare build && npx wrangler dev --port 8788 --local
 *   MCP_SMOKE_BASE=http://localhost:8788 pnpm test:mcp
 *
 * Requires a reachable Postgres. It writes one throwaway user and member, and
 * deletes them again.
 */

const BASE = process.env.MCP_SMOKE_BASE ?? "http://localhost:3100";
const ENDPOINT = `${BASE}/api/mcp`;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  ok   ${label}`);
    } else {
        failed++;
        console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
    }
}

/** Reads the first text block out of a tool result. */
function textOf(result: unknown): string {
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    return content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
}

async function connect(bearer?: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
        requestInit: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
    });
    const client = new Client({ name: "mcp-smoke", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);
    return client;
}

async function main() {
    console.log(`MCP smoke test against ${ENDPOINT}\n`);

    // --- anonymous session -------------------------------------------------
    console.log("anonymous");
    const anon = await connect();

    const tools = await anon.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    check("server responds to tools/list", names.length > 0, `got: ${names.join(", ")}`);

    const expected = [
        "check_links",
        "get_categories",
        "get_link_brief",
        "get_my_standing",
        "get_rules",
        "list_matches",
        "list_my_sites",
        "mark_link_placed",
        "respond_to_match",
        "search_partners",
        "submit_site",
    ];
    const missing = expected.filter((n) => !names.includes(n));
    check(
        "every expected tool is registered",
        missing.length === 0,
        missing.length ? `missing: ${missing}` : undefined,
    );

    const rules = textOf(await anon.callTool({ name: "get_rules", arguments: {} }));
    check("get_rules works without auth", rules.includes("reciprocal"), rules.slice(0, 120));
    check(
        "get_rules states the placement policy honestly",
        rules.toLowerCase().includes("never reject"),
        "the disclose-do-not-enforce promise must be in the rules an agent reads",
    );

    const cats = textOf(await anon.callTool({ name: "get_categories", arguments: {} }));
    check("get_categories works without auth", cats.length > 0, cats.slice(0, 120));

    const search = textOf(await anon.callTool({ name: "search_partners", arguments: { limit: 5 } }));
    check("search_partners works without auth", search.length > 0, search.slice(0, 120));

    // The whole blindness promise: a read tool must never emit a domain.
    check(
        "search_partners leaks no domain",
        !/https?:\/\//.test(search) && !/\b[a-z0-9-]+\.(com|dev|io|app|net|org)\b/i.test(search),
        search.slice(0, 200),
    );

    const denied = await anon.callTool({ name: "submit_site", arguments: { url: "https://example.com" } });
    const deniedText = textOf(denied);
    check("submit_site is gated for anonymous callers", (denied as { isError?: boolean }).isError === true);
    check(
        "the auth error tells the caller how to fix it",
        deniedText.includes("claude mcp add") && deniedText.includes("bb_live_"),
        deniedText.slice(0, 160),
    );

    await anon.close();

    // --- authenticated session ---------------------------------------------
    console.log("\nauthenticated");
    const key = mintApiKey();
    const email = `smoke+${Date.now()}@builders-backlinks.test`;
    const [user] = await db().insert(users).values({ email }).returning({ id: users.id });
    await db().insert(exchangeMembers).values({
        userId: user.id,
        email,
        apiKeyHash: key.hash,
        apiKeyIssuedAt: new Date(),
        verifiedAt: new Date(),
    });

    try {
        check("mintApiKey round-trips through hashApiKey", hashApiKey(key.plaintext) === key.hash);

        const auth = await connect(key.plaintext);

        const sites = textOf(await auth.callTool({ name: "list_my_sites", arguments: {} }));
        check("bearer token resolves to the member", !sites.includes("not signed in"), sites.slice(0, 160));
        check("list_my_sites reports an empty state usefully", sites.includes("submit my site"), sites.slice(0, 160));

        const standing = textOf(await auth.callTool({ name: "get_my_standing", arguments: {} }));
        check("get_my_standing works", standing.includes("Standing"), standing.slice(0, 160));
        check(
            "a brand new member is 'new', never 'behind'",
            standing.includes("new") && !standing.includes("behind"),
            standing,
        );

        const matches = textOf(await auth.callTool({ name: "list_matches", arguments: {} }));
        check("list_matches works", matches.length > 0, matches.slice(0, 120));

        const badBrief = await auth.callTool({ name: "get_link_brief", arguments: { match_id: user.id } });
        check("get_link_brief refuses an unknown match", (badBrief as { isError?: boolean }).isError === true);

        const badKey = await connect("bb_live_totally-not-a-real-key");
        const rejected = await badKey.callTool({ name: "list_my_sites", arguments: {} });
        check("an invalid bearer token is treated as anonymous", (rejected as { isError?: boolean }).isError === true);
        await badKey.close();

        await auth.close();
    } finally {
        // The member row cascades off the user row, so one delete is enough.
        await db().delete(users).where(eq(users.id, user.id));
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("\nsmoke test crashed:", err);
    process.exit(1);
});
