import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";

import { hashApiKey, mintApiKey } from "@/lib/auth/api-key";
import { db } from "@/lib/db";
import { exchangeMembers, exchangeSites, users } from "@/lib/db/schema";
import { LINK_STATUSES, MATCH_STATES, PLACEMENTS, PLACEMENT_OFFERS, SITE_STATUSES } from "@/lib/exchange";

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
 * Requires a reachable Postgres. It writes a throwaway member and a throwaway
 * partner site, and deletes them again.
 *
 * IT SEEDS A PARTNER SITE, and that is not incidental. `search_partners` returns
 * early with a "nothing here yet" sentence when no site is active, so against an
 * empty database — a fresh clone, and any CI container — every assertion about
 * masked output was being made about a sentence with no partner in it. The
 * blindness check below is the single most important thing this file does and it
 * could not fail. It now runs against a real row whose domain ends in `.com`, so
 * both the specific check and the generic one have something to catch.
 *
 * FOR THE SAME REASON, EVERY READ GOES THROUGH `callOk`. A tool that returns an
 * error still returns text, and text with no domain in it passes a "leaks no
 * domain" assertion perfectly. That is not hypothetical: with one migration
 * unapplied, `search_partners` answered "Something went wrong on our side" and
 * this file reported two passes for it.
 */

const BASE = process.env.MCP_SMOKE_BASE ?? "http://localhost:3100";
const ENDPOINT = `${BASE}/api/mcp`;

let passed = 0;
let failed = 0;

/** Every text body this run has seen, for the tool-name audit at the end. */
const seenText: string[] = [];

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

/**
 * Calls a tool that is expected to succeed, and fails the run if it did not.
 *
 * Everything downstream asserts on the SHAPE of a tool's answer, and the server
 * answers an internal error with prose like any other result. Without this the
 * failure surfaces as whichever content assertion happened to be strict enough
 * to notice, or as nothing at all.
 */
async function callOk(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await client.callTool({ name, arguments: args });
    const body = textOf(result);
    seenText.push(body);
    if ((result as { isError?: boolean }).isError === true) {
        check(`${name} returns a result, not an error`, false, body.slice(0, 200));
        return "";
    }
    return body;
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

    const stamp = Date.now();

    // The partner the anonymous reads will find. A `.com` domain deliberately:
    // the generic leak regex below only recognises real-looking TLDs, so a
    // `.test` fixture would sail past it however badly the masking broke.
    const partnerDomain = `smoke-partner-${stamp}.com`;
    const partnerEmail = `smoke-partner+${stamp}@builders-backlinks.test`;
    const memberEmail = `smoke+${stamp}@builders-backlinks.test`;

    const [partnerUser] = await db().insert(users).values({ email: partnerEmail }).returning({ id: users.id });
    const [member] = await db().insert(users).values({ email: memberEmail }).returning({ id: users.id });

    const key = mintApiKey();

    try {
        await db().insert(exchangeMembers).values({
            userId: member.id,
            email: memberEmail,
            apiKeyHash: key.hash,
            apiKeyIssuedAt: new Date(),
            verifiedAt: new Date(),
        });

        await db()
            .insert(exchangeSites)
            .values({
                ownerId: partnerUser.id,
                domain: partnerDomain,
                url: `https://${partnerDomain}`,
                category: "Developer Tools",
                description: "A throwaway listing that exists so the masking assertions have a real row to inspect.",
                keywords: ["smoke anchor one", "smoke anchor two"],
                placementOffered: "blog_post",
                domainRating: 21,
                status: "active",
            });

        // --- anonymous session ---------------------------------------------
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

        const rules = await callOk(anon, "get_rules");
        check("get_rules works without auth", rules.includes("reciprocal"), rules.slice(0, 120));
        check(
            "get_rules states the placement policy honestly",
            rules.toLowerCase().includes("never reject"),
            "the disclose-do-not-enforce promise must be in the rules an agent reads",
        );

        const cats = await callOk(anon, "get_categories");
        check("get_categories works without auth", cats.length > 0, cats.slice(0, 120));

        const search = await callOk(anon, "search_partners", { limit: 5 });
        check("search_partners works without auth", search.length > 0, search.slice(0, 120));

        // Proves the assertions below are looking at a partner listing rather
        // than at the empty-state sentence or an error. Without this the whole
        // masking check is vacuous and silently so.
        check(
            "search_partners returns the seeded partner, not an empty state",
            search.includes("Developer Tools") && search.includes("smoke anchor one"),
            search.slice(0, 200),
        );

        // The whole blindness promise: a read tool must never emit a domain.
        check(
            "search_partners leaks no domain",
            !search.includes(partnerDomain) &&
                !/https?:\/\//.test(search) &&
                !/\b[a-z0-9-]+\.(com|dev|io|app|net|org)\b/i.test(search),
            search.slice(0, 200),
        );

        // The listing leads with an opaque id, which reads as an invitation to
        // pass it somewhere. It went out in the weekly digest for weeks as
        // `propose_trade partnerId="…"`, a call that has never existed, and a
        // member hit it in public on 2026-08-03. The trailer is the correction.
        check(
            "search_partners says matching is automatic",
            search.includes("no tool takes a partner id") && search.includes("Matching is automatic"),
            search.slice(-240),
        );

        const denied = await anon.callTool({ name: "submit_site", arguments: { url: "https://example.com" } });
        const deniedText = textOf(denied);
        seenText.push(deniedText);
        check("submit_site is gated for anonymous callers", (denied as { isError?: boolean }).isError === true);
        check(
            "the auth error tells the caller how to fix it",
            deniedText.includes("claude mcp add") && deniedText.includes("bb_live_"),
            deniedText.slice(0, 160),
        );

        await anon.close();

        // --- authenticated session -----------------------------------------
        console.log("\nauthenticated");

        check("mintApiKey round-trips through hashApiKey", hashApiKey(key.plaintext) === key.hash);

        const auth = await connect(key.plaintext);

        const sites = await callOk(auth, "list_my_sites");
        check("bearer token resolves to the member", !sites.includes("not signed in"), sites.slice(0, 160));
        check("list_my_sites reports an empty state usefully", sites.includes("submit my site"), sites.slice(0, 160));

        const standing = await callOk(auth, "get_my_standing");
        check("get_my_standing works", standing.includes("Standing"), standing.slice(0, 160));
        check(
            "a brand new member is 'new', never 'behind'",
            standing.includes("new") && !standing.includes("behind"),
            standing,
        );

        const matches = await callOk(auth, "list_matches");
        check("list_matches works", matches.length > 0, matches.slice(0, 120));

        const badBrief = await auth.callTool({ name: "get_link_brief", arguments: { match_id: member.id } });
        check("get_link_brief refuses an unknown match", (badBrief as { isError?: boolean }).isError === true);

        const badKey = await connect("bb_live_totally-not-a-real-key");
        const rejected = await badKey.callTool({ name: "list_my_sites", arguments: {} });
        check("an invalid bearer token is treated as anonymous", (rejected as { isError?: boolean }).isError === true);
        await badKey.close();

        await auth.close();

        // --- what the server tells an agent to do ---------------------------
        //
        // The `propose_trade` incident was not a broken tool, it was working
        // prose describing a tool that did not exist, and nothing could have
        // caught it: no type covers a sentence. This does. A snake_case token in
        // a description or an answer is a tool name, a value from one of the
        // pgEnums, or a lie.
        //
        // The enums are subtracted by IMPORTING them rather than by listing the
        // strings, which is the only version of this that stays true. Add a
        // placement offer and it is excluded here the same day it exists; add a
        // call to action for a tool nobody built and no amount of enum churn
        // hides it. Resist turning that into a plain allowlist to quiet a
        // failure — the failure is the whole point of the check.
        console.log("\nwhat the server advertises");

        const prose = [...tools.tools.map((t) => `${t.name} ${t.description ?? ""}`), ...seenText]
            .join("\n")
            // The api key prefix is a literal, not an identifier. It is the one
            // snake_case-shaped string here that denotes neither a call nor a
            // value from the schema.
            .replace(/bb_live_\S*/g, "");

        const notACall = new Set<string>([
            ...names,
            ...SITE_STATUSES,
            ...PLACEMENT_OFFERS,
            ...MATCH_STATES,
            ...LINK_STATUSES,
            ...PLACEMENTS,
        ]);
        const phantom = new Set(
            [...prose.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)]
                .map((m) => m[0])
                .filter((token) => !notACall.has(token)),
        );
        check(
            "every tool the server names in prose actually exists",
            phantom.size === 0,
            phantom.size ? `named but not registered: ${[...phantom].join(", ")}` : undefined,
        );
    } finally {
        // Sites cascade off their owner and the member row cascades off the
        // user, so deleting the two users is enough. Done by id rather than by
        // email pattern: a cleanup that guesses at rows is one bad glob away
        // from deleting somebody's real listing.
        await db()
            .delete(users)
            .where(inArray(users.id, [member.id, partnerUser.id]));

        const [orphan] = await db().select().from(exchangeSites).where(eq(exchangeSites.domain, partnerDomain));
        if (orphan) {
            console.log(`\n  WARN seeded site ${partnerDomain} outlived its owner and was left behind`);
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("\nsmoke test crashed:", err);
    process.exit(1);
});
