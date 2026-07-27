import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CATEGORIES } from "@/lib/categories";
import { AnalyzeError } from "@/lib/contracts";
import type { ExchangeMemberHydrated } from "@/lib/models/ExchangeMember";
import { PLACEMENT_OFFERS } from "@/lib/models/ExchangeSite";
import { getCategoryDepths, getRules } from "@/lib/services/catalog";
import { checkLinks, getLinkBrief, getStanding, LinkError, markLinkPlaced } from "@/lib/services/links";
import { autoPair, listMatches, MatchError, respondToMatch, searchPartners } from "@/lib/services/matches";
import { commitSite, draftSite, listMySites, SiteError } from "@/lib/services/sites";

/**
 * @file The MCP tool surface.
 *
 * Every handler here is a thin adapter: parse arguments, call one service
 * function, format the result for a model to read. There is no business logic
 * in this file and there must never be any, because the web routes call the
 * same services. The moment a tool does something a web route would not, the
 * agent path and the browser path have started to drift, and the agent path is
 * the one that is supposed to be first-class.
 *
 * Two conventions the whole surface follows:
 *
 * 1. Every write tool ends by telling the caller what to do next, in prose. A
 *    model reads that and keeps the loop going without the member having to
 *    prompt each individual step.
 * 2. Errors are instructions, not status codes. "You are not signed in" is
 *    useless; "run this to add your key, then retry" gets the member unstuck.
 */

/** Resolved by the transport from the bearer token. Absent for anonymous callers. */
export type ToolContext = { member: ExchangeMemberHydrated | null };

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function text(body: string): TextResult {
    return { content: [{ type: "text", text: body }] };
}

function failure(body: string): TextResult {
    return { content: [{ type: "text", text: body }], isError: true };
}

const SIGN_IN_HINT = [
    "You are not signed in, so this tool cannot run yet.",
    "",
    "Get a key at https://builders-backlinks.com/app/key and add it to the server:",
    "",
    '  claude mcp remove builders-backlinks',
    "  claude mcp add --transport http builders-backlinks \\",
    "      https://builders-backlinks.com/api/mcp \\",
    '      --header "Authorization: Bearer bb_live_..."',
    "",
    "Everything read-only (search_partners, get_categories, get_rules) works without a key.",
].join("\n");

function requireMember(ctx: ToolContext): ExchangeMemberHydrated {
    if (!ctx.member) throw new NotSignedIn();
    return ctx.member;
}

class NotSignedIn extends Error {}

/** Turns any thrown service error into a message the model can act on. */
function explain(err: unknown): TextResult {
    if (err instanceof NotSignedIn) return failure(SIGN_IN_HINT);
    if (err instanceof AnalyzeError) {
        const hint =
            err.code === "too_thin"
                ? "The exchange only lists real sites with real content. If this is a live product page, tell us and a human will look."
                : err.code === "unreachable"
                  ? "Check the URL is right and the site is publicly reachable."
                  : "";
        return failure([`Could not analyze that site: ${err.message}`, hint].filter(Boolean).join(" "));
    }
    if (err instanceof SiteError || err instanceof MatchError || err instanceof LinkError) {
        return failure(err.message);
    }
    console.error("mcp tool failed", err);
    return failure("Something went wrong on our side. Nothing was changed. Try again in a moment.");
}

/** Wraps a handler so every thrown error becomes a readable tool result. */
function guard<A>(fn: (args: A) => Promise<TextResult>): (args: A) => Promise<TextResult> {
    return async (args: A) => {
        try {
            return await fn(args);
        } catch (err) {
            return explain(err);
        }
    };
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
    // -----------------------------------------------------------------------
    // Anonymous reads
    // -----------------------------------------------------------------------

    server.registerTool(
        "get_rules",
        {
            title: "Exchange rules",
            description:
                "The house rules of the backlink exchange. Read this before submitting a site or placing a link: it explains what counts as a valid placement and what does not get matched.",
            inputSchema: {},
        },
        guard(async () => {
            const { summary, rules } = getRules();
            return text([summary, "", ...rules.map((r) => `- ${r}`)].join("\n"));
        }),
    );

    server.registerTool(
        "get_categories",
        {
            title: "Category depth",
            description:
                "Lists every category in the exchange with how many active sites it has and the median Domain Rating. Use it to see whether a category can match today, or whether the member would be first in it.",
            inputSchema: {},
        },
        guard(async () => {
            const depths = await getCategoryDepths();
            const open = depths.filter((d) => d.open);
            const thin = depths.filter((d) => !d.open && d.activeSites > 0);
            const empty = depths.filter((d) => d.activeSites === 0);

            const lines = [
                open.length
                    ? `Matching now (${open.length}):\n` +
                      open
                          .map((d) => `  ${d.category}: ${d.activeSites} sites, median DR ${d.medianDomainRating ?? "n/a"}`)
                          .join("\n")
                    : "No category has enough sites to match on its own yet.",
                thin.length
                    ? `\nStill filling up, matched against adjacent categories (${thin.length}):\n` +
                      thin.map((d) => `  ${d.category}: ${d.activeSites}`).join("\n")
                    : "",
                empty.length ? `\nNobody here yet, be first (${empty.length}): ${empty.map((d) => d.category).join(", ")}` : "",
            ];
            return text(lines.filter(Boolean).join("\n"));
        }),
    );

    server.registerTool(
        "search_partners",
        {
            title: "Search partners",
            description:
                "Finds sites in the exchange that are open to trading a link. Results are masked: you get what each site is about, its Domain Rating, and the anchors it wants, but never its domain. Domains are only revealed once both sides accept a match.",
            inputSchema: {
                category: z.enum(CATEGORIES).optional().describe("Restrict to one category."),
                dr_min: z.number().int().min(0).max(100).optional(),
                dr_max: z.number().int().min(0).max(100).optional(),
                limit: z.number().int().min(1).max(20).default(5),
            },
        },
        guard(async (args) => {
            const partners = await searchPartners({
                category: args.category,
                drMin: args.dr_min,
                drMax: args.dr_max,
                limit: args.limit,
            });
            if (partners.length === 0) {
                return text(
                    "No sites match that filter yet. The exchange is new. Submitting your own site is worth doing anyway: whoever joins your category next is matched with you immediately.",
                );
            }
            return text(
                partners
                    .map(
                        (p) =>
                            [
                                `${p.partnerId}  ${p.category}  DR ${p.domainRating ?? "unrated"}`,
                                `  ${p.description}`,
                                `  wants anchors: ${p.wantedAnchors.join(", ") || "none given"}`,
                                `  can offer: ${p.placementOffered}   given ${p.linksGiven} / received ${p.linksGot}`,
                            ].join("\n"),
                    )
                    .join("\n\n"),
            );
        }),
    );

    // -----------------------------------------------------------------------
    // Authenticated writes
    // -----------------------------------------------------------------------

    server.registerTool(
        "submit_site",
        {
            title: "Submit a site",
            description:
                "Lists a site in the exchange. Call it FIRST without `confirm` to get a drafted listing (category, description, suggested anchors) and show it to the member. Only call again with confirm=true after they have seen and approved the wording, because the description is shown to strangers.",
            inputSchema: {
                url: z.string().describe("The site's URL, e.g. https://yourproduct.com"),
                confirm: z.boolean().default(false).describe("Set true only after the member has approved the draft."),
                category: z.enum(CATEGORIES).optional().describe("Overrides the drafted category on confirm."),
                description: z.string().max(2000).optional().describe("Overrides the drafted description on confirm."),
                keywords: z.array(z.string()).max(25).optional().describe("Overrides the drafted anchors on confirm."),
                placement_offered: z
                    .enum(PLACEMENT_OFFERS)
                    .optional()
                    .describe("What the member can offer a partner in return."),
            },
        },
        guard(async (args) => {
            const member = requireMember(ctx);
            const draft = await draftSite(args.url);

            if (draft.alreadyListed) {
                return failure(`${draft.domain} is already listed in the exchange. Each domain belongs to one member.`);
            }

            if (!args.confirm) {
                return text(
                    [
                        "Drafted this listing. Show it to the member and ask them to approve or correct it, then call submit_site again with confirm=true.",
                        "",
                        `  domain       ${draft.domain}`,
                        `  category     ${draft.category}`,
                        `  DR           ${draft.domainRating ?? "unrated"} (Ahrefs)`,
                        `  anchors      ${draft.keywords.join(", ")}`,
                        `  description  ${draft.description}`,
                        "",
                        "The description is deliberately written so it does not name the product: partners see it before they know who you are.",
                    ].join("\n"),
                );
            }

            const site = await commitSite({
                member,
                url: draft.url,
                category: args.category ?? draft.category,
                description: args.description ?? draft.description,
                keywords: args.keywords ?? draft.keywords,
                placementOffered: args.placement_offered,
                domainRating: draft.domainRating,
            });

            const pair = await autoPair(site);
            const tail = pair.matched
                ? `\n\nYou already have a match: ${pair.partner.category}, DR ${pair.partner.domainRating ?? "unrated"}. Say "show my matches" to see it.`
                : pair.reason === "first_in_category"
                  ? `\n\nYou are the first site in ${pair.category}. That is a good position: the next member to join it is matched with you immediately.`
                  : "\n\nNo partner available right now. You will be matched as soon as a suitable one joins.";

            return text(`${site.domain} is listed and pending review.${tail}`);
        }),
    );

    server.registerTool(
        "list_my_sites",
        {
            title: "My sites",
            description: "Lists the sites this member has in the exchange, with status and link standing.",
            inputSchema: {},
        },
        guard(async () => {
            const member = requireMember(ctx);
            const sites = await listMySites(member);
            if (sites.length === 0) {
                return text('No sites listed yet. Say "submit my site" with a URL to add one.');
            }
            return text(
                sites
                    .map(
                        (s) =>
                            `${s.domain}  ${s.category}  DR ${s.domainRating ?? "unrated"}  [${s.status}]  given ${s.linksGiven} / received ${s.linksGot}`,
                    )
                    .join("\n"),
            );
        }),
    );

    server.registerTool(
        "list_matches",
        {
            title: "My matches",
            description:
                "Lists this member's matches. Partners are masked until both sides accept, at which point the domain and email are revealed and you can call get_link_brief.",
            inputSchema: {
                state: z
                    .enum(["proposed", "a_accepted", "b_accepted", "agreed", "placed", "declined", "expired"])
                    .optional(),
            },
        },
        guard(async (args) => {
            const member = requireMember(ctx);
            const matches = await listMatches(member, args.state);
            if (matches.length === 0) return text("No matches yet.");
            return text(
                matches
                    .map((m) => {
                        const who =
                            "domain" in m.partner
                                ? `${m.partner.domain} (${m.partner.email})`
                                : `${m.partner.category}, DR ${m.partner.domainRating ?? "unrated"} (hidden until you both accept)`;
                        return [
                            `${m.matchId}  [${m.state}]  ${who}`,
                            `  ${m.partner.description}`,
                            `  wants: ${m.partner.wantedAnchors.join(", ") || "no anchors given"}`,
                            `  next: ${m.nextStep}`,
                        ].join("\n");
                    })
                    .join("\n\n"),
            );
        }),
    );

    server.registerTool(
        "respond_to_match",
        {
            title: "Accept or decline a match",
            description:
                "Accepts or declines a proposed match. When both sides accept, the two domains and emails are revealed to each other and the link brief becomes available.",
            inputSchema: {
                match_id: z.string(),
                accept: z.boolean(),
                reason: z.string().max(500).optional().describe("Optional note when declining."),
            },
        },
        guard(async (args) => {
            const member = requireMember(ctx);
            const view = await respondToMatch({
                member,
                matchId: args.match_id,
                accept: args.accept,
                reason: args.reason,
            });
            if (view.revealed && "domain" in view.partner) {
                return text(
                    [
                        `Agreed. You are both revealed to each other now.`,
                        `  partner   ${view.partner.domain}`,
                        `  contact   ${view.partner.email}`,
                        "",
                        `Next: call get_link_brief with match_id ${view.matchId} to get their URL and approved anchors, place the link, then call mark_link_placed.`,
                    ].join("\n"),
                );
            }
            return text(`Match ${view.matchId} is now ${view.state}. ${view.nextStep}`);
        }),
    );

    server.registerTool(
        "get_link_brief",
        {
            title: "Get the link brief",
            description:
                "Returns everything needed to place a partner's link: the target URL, approved anchor options, what their site is about, and a paste-ready snippet. Use this to write the link into the member's own site, in a relevant existing page, in their own words. Where it goes is entirely the member's choice.",
            inputSchema: {
                match_id: z.string(),
                format: z.enum(["html", "markdown", "mdx", "jsx"]).default("html"),
            },
        },
        guard(async (args) => {
            const member = requireMember(ctx);
            const brief = await getLinkBrief({ member, matchId: args.match_id, format: args.format });
            return text(
                [
                    `target      ${brief.targetUrl}`,
                    `about       ${brief.partnerDescription}`,
                    `anchors     ${brief.anchorOptions.join(" | ") || "none given, write your own"}`,
                    `they offer  ${brief.partnerOffers}`,
                    "",
                    `snippet     ${brief.snippet}`,
                    "",
                    "Guidance (advice, not rules):",
                    ...brief.guidance.map((g) => `  - ${g}`),
                    "",
                    `When it is live, call mark_link_placed with match_id ${brief.matchId} and the page URL.`,
                ].join("\n"),
            );
        }),
    );

    server.registerTool(
        "mark_link_placed",
        {
            title: "Mark a link as placed",
            description:
                "Tells the exchange a partner's link is now live on a given page, and verifies it immediately. Returns what we actually found: whether it is there, whether it sits in content or in a footer, and whether it is dofollow.",
            inputSchema: {
                match_id: z.string(),
                page_url: z.string().describe("The exact page the link was placed on."),
                anchor_used: z.string().optional(),
            },
        },
        guard(async (args) => {
            const member = requireMember(ctx);
            const report = await markLinkPlaced({
                member,
                matchId: args.match_id,
                pageUrl: args.page_url,
                anchorUsed: args.anchor_used,
            });

            if (report.inconclusive) {
                return text(
                    `Recorded, but we could not confirm it yet: ${report.message} Client-rendered pages often need a moment or a human check. We will look again automatically.`,
                );
            }
            if (report.status !== "live") {
                return text(
                    `Recorded, but we did not find the link in the page's server-rendered HTML. ${report.message}`,
                );
            }
            const follow = report.rel.includes("nofollow") ? "nofollow" : "dofollow";
            return text(
                [
                    `Verified live.`,
                    `  placement  ${report.placement}${report.sitewide ? " (appears sitewide)" : ""}`,
                    `  rel        ${follow}`,
                    `  anchor     ${report.anchorText ?? "not detected"}`,
                    "",
                    "Your partner can see exactly this. We recheck at day 7, day 30, then monthly.",
                ].join("\n"),
            );
        }),
    );

    server.registerTool(
        "check_links",
        {
            title: "Check my links",
            description:
                "Every link this member has given and received, with its current verified state, placement, and rel.",
            inputSchema: {},
        },
        guard(async () => {
            const member = requireMember(ctx);
            const rows = await checkLinks(member);
            if (rows.length === 0) return text("No links yet.");
            return text(
                rows
                    .map(
                        (r) =>
                            `${r.direction.padEnd(8)} ${r.status.padEnd(9)} ${r.placement.padEnd(8)} ${
                                r.rel.includes("nofollow") ? "nofollow" : "dofollow"
                            }  ${r.pageUrl ?? "no page recorded"}`,
                    )
                    .join("\n"),
            );
        }),
    );

    server.registerTool(
        "get_my_standing",
        {
            title: "My standing",
            description: "How many links this member has given versus received, and whether matching favours them.",
            inputSchema: {},
        },
        guard(async () => {
            const member = requireMember(ctx);
            const s = await getStanding(member);
            return text(
                `${s.sites} site(s). Given ${s.linksGiven}, received ${s.linksReceived}. Standing: ${s.health}. ${s.note}`,
            );
        }),
    );
}
