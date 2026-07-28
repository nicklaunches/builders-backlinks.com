import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

const DATA_ACCESS_MSG =
    "MCP tools must go through src/lib/services rather than querying a model directly. The web routes call the same services, and reaching past them is exactly how the agent interface and the browser interface drift apart.";

/**
 * Guards the layering the whole architecture rests on.
 *
 * MCP tools and web routes must both go through `src/lib/services`. If a tool
 * handler reaches past the service layer into a model or a leaf module, the
 * agent interface and the browser interface have started to diverge, and the
 * agent one is supposed to be first-class. That is very hard to spot in review
 * and trivial to catch here.
 */
const mcpLayering = {
    files: ["src/lib/mcp/**/*.ts", "src/app/api/[transport]/**/*.ts"],
    rules: {
        "no-restricted-imports": [
            "error",
            {
                paths: [
                    // The Mongoose model objects specifically, not the module.
                    // Types and constants (PLACEMENT_OFFERS, the Hydrated
                    // aliases) are fine to import here: it is direct data
                    // ACCESS that has to go through a service, so that the web
                    // routes and the tools cannot drift apart.
                    { name: "@/lib/models/ExchangeSite", importNames: ["ExchangeSite"], message: DATA_ACCESS_MSG },
                    { name: "@/lib/models/ExchangeMatch", importNames: ["ExchangeMatch"], message: DATA_ACCESS_MSG },
                    { name: "@/lib/models/ExchangeLink", importNames: ["ExchangeLink"], message: DATA_ACCESS_MSG },
                    { name: "@/lib/models/ExchangeMember", importNames: ["ExchangeMember"], message: DATA_ACCESS_MSG },
                ],
                patterns: [
                    {
                        group: ["@/lib/analyze", "@/lib/analyze/*", "@/lib/verify", "@/lib/verify/*"],
                        message:
                            "MCP tools must call src/lib/services, not the leaf modules directly. Web routes use the same services, and reaching past them is how the two interfaces drift.",
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
    globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
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
