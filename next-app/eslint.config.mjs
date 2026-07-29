import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

const DATA_ACCESS_MSG =
    "MCP tools must go through src/lib/services rather than querying the database directly. The web routes call the same services, and reaching past them is exactly how the agent interface and the browser interface drift apart.";

/**
 * Guards the layering the whole architecture rests on.
 *
 * MCP tools and web routes must both go through `src/lib/services`. If a tool
 * handler reaches past the service layer into the database or a leaf module,
 * the agent interface and the browser interface have started to diverge, and
 * the agent one is supposed to be first-class. That is very hard to spot in
 * review and trivial to catch here.
 *
 * The globs must track where the MCP layer actually lives. An earlier version
 * pointed at `src/app/api/[transport]/**`, which stopped existing when the
 * route moved to `src/app/api/mcp/`, and the rule then guarded one directory
 * less than it claimed to while still passing. A layering rule that matches
 * nothing is worse than no rule, because the README says it is enforced.
 */
const mcpLayering = {
    files: ["src/lib/mcp/**/*.ts", "src/app/api/mcp/**/*.ts"],
    rules: {
        "no-restricted-imports": [
            "error",
            {
                paths: [
                    // The connection handle, and the Drizzle table objects
                    // specifically rather than the whole schema module. Types
                    // (`ExchangeMember` and the other $inferSelect aliases) and
                    // the pgEnum exports are fine to import here: it is direct
                    // data ACCESS that has to go through a service, so that the
                    // web routes and the tools cannot drift apart.
                    { name: "@/lib/db", message: DATA_ACCESS_MSG },
                    {
                        name: "@/lib/db/schema",
                        importNames: [
                            "users",
                            "accounts",
                            "sessions",
                            "verificationTokens",
                            "exchangeMembers",
                            "exchangeSites",
                            "exchangeMatches",
                            "exchangeLinks",
                            "rateLimits",
                        ],
                        message: DATA_ACCESS_MSG,
                    },
                ],
                patterns: [
                    {
                        group: ["@/lib/analyze", "@/lib/analyze/*", "@/lib/verify", "@/lib/verify/*"],
                        message:
                            "MCP tools must call src/lib/services, not the leaf modules directly. Web routes use the same services, and reaching past them is how the two interfaces drift.",
                    },
                    {
                        // Nothing in this layer should be assembling a query.
                        // Importing `eq` or `sql` here means the service call
                        // that belongs one level down is being written inline.
                        group: ["drizzle-orm", "drizzle-orm/*"],
                        message: DATA_ACCESS_MSG,
                    },
                ],
            },
        ],
    },
};

/**
 * On the masking boundary, and why there is no lint rule for it.
 *
 * A partner's domain and email must not leave a read path before a match is
 * agreed. The first version of this config banned reading `.domain` anywhere in
 * the MCP layer, which produced six errors that were all correct code: four
 * were a member's OWN domain, and two only typecheck because the code has
 * already narrowed to the revealed variant.
 *
 * The type system enforces this better than lint can. `MaskedPartner` has no
 * `domain` field at all, so reading one off an unrevealed partner is a compile
 * error, and `toRevealedPartner` throws unless it is handed an agreed match. A
 * lint rule on top of that only teaches people to write eslint-disable, which
 * is strictly worse than no rule. See src/lib/services/mask.ts.
 */

const eslintConfig = defineConfig([
    // Everything generated. `.open-next` matters most: it is tens of megabytes
    // of bundled server JavaScript, and with `allowJs` on, leaving it out makes
    // `pnpm lint` run out of heap the moment anyone has run a build. CI never
    // hit it because it lints before it builds.
    globalIgnores([
        ".next/**",
        ".open-next/**",
        ".wrangler/**",
        ".render/**",
        "node_modules/**",
        "next-env.d.ts",
        "worker-configuration.d.ts",
    ]),
    ...nextVitals,
    ...nextTs,
    mcpLayering,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
]);

export default eslintConfig;
