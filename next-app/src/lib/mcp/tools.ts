import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { CATEGORIES } from "@/lib/categories";
import { AnalyzeError, analyzeFailureHint } from "@/lib/contracts";
import type { ExchangeMember } from "@/lib/db/schema";
import { PLACEMENT_OFFERS } from "@/lib/exchange";
import { RateLimited, enforceToolLimit } from "@/lib/limits";
import { getCategoryDepths, getRules } from "@/lib/services/catalog";
import { LinkError, checkLinks, getLinkBrief, getStanding, markLinkPlaced } from "@/lib/services/links";
import { MatchError, listMatches, respondToMatch, searchPartners } from "@/lib/services/matches";
import { SiteError, commitSite, draftSite, listMySites } from "@/lib/services/sites";

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
 *
 * `registerTool` is SDK-level, so this file survived the move off Vercel's
 * transport onto Cloudflare's untouched apart from where the two SDK versions
 * differ: v2 takes a Standard Schema rather than a raw Zod shape, so each
 * `inputSchema` is wrapped in `z.object()`. Argument names are unchanged and
 * deliberately snake_case (`dr_min`, `match_id`, `page_url`) because that is
 * what the published tool contract already says.
 */

/**
 * Per-request context, built by the transport.
 *
 * `caller` is the rate-limit identity: the member id when signed in, else the
 * client IP. It is on the context rather than derived per tool so that
 * `guard()` can enforce a budget around EVERY tool without each handler having
 * to remember to, which is the kind of thing that gets forgotten on the one
 * tool that most needed it.
 */
export type ToolContext = { member: ExchangeMember | null; caller: string };

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
    "  claude mcp remove builders-backlinks",
    "  claude mcp add --transport http builders-backlinks \\",
    "      https://builders-backlinks.com/api/mcp \\",
    '      --header "Authorization: Bearer bb_live_..."',
    "",
    "Everything read-only (search_partners, get_categories, get_rules) works without a key.",
].join("\n");

function requireMember(ctx: ToolContext): ExchangeMember {
    if (!ctx.member) throw new NotSignedIn();
    return ctx.member;
}

class NotSignedIn extends Error {}

/** Turns any thrown service error into a message the model can act on. */
function explain(err: unknown): TextResult {
    if (err instanceof NotSignedIn) return failure(SIGN_IN_HINT);
    if (err instanceof RateLimited) {
        const mins = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
        return failure(
            `You are calling this faster than the exchange allows. Wait about ${mins} minute(s) and try again. If you are looping over partners, slow down: the read tools are shared and deliberately capped.`,
        );
    }
    if (err instanceof AnalyzeError) {
        // Shared with the web path rather than copied from it. The copy here was
        // missing four of the six codes, which is exactly the drift the comment
        // in `src/app/submit/actions.ts` promised would not happen.
        return failure(
            [`Could not analyze that site: ${err.message}`, analyzeFailureHint(err.code)].filter(Boolean).join(" "),
        );
    }
    if (err instanceof SiteError || err instanceof MatchError || err instanceof LinkError) {
        return failure(err.message);
    }
    console.error("mcp tool failed", err);
    return failure("Something went wrong on our side. Nothing was changed. Try again in a moment.");
}

/**
 * Wraps a handler with the two things every tool needs: a rate-limit check and
 * error translation.
 *
 * Rate limiting lives here rather than in each handler so it cannot be missed
 * on a new tool. Adding a tool without a budget gets the DEFAULT one, which is
 * the safe direction to fail.
 */
function guard<A>(
    ctx: ToolContext,
    tool: string,
    fn: (args: A) => Promise<TextResult>,
): (args: A) => Promise<TextResult> {
    return async (args: A) => {
        try {
            await enforceToolLimit(tool, ctx.caller);
            return await fn(args);
        } catch (err) {
            return explain(err);
        }
    };
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
        "get_rules",
        {
            title: "Exchange rules",
            description:
                "The house rules of the backlink exchange. Read this before submitting a site or placing a link: it explains what counts as a valid placement and what does not get matched.",
            inputSchema: z.object({}),
        },
        guard(ctx, "get_rules", async () => {
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
            inputSchema: z.object({}),
        },
        guard(ctx, "get_categories", async () => {
            const depths = await getCategoryDepths();
            const open = depths.filter((d) => d.open);
            const thin = depths.filter((d) => !d.open && d.activeSites > 0);
            const empty = depths.filter((d) => d.activeSites === 0);

            const lines = [
                open.length
                    ? `Matching now (${open.length}):\n` +
                      open
                          .map(
                              (d) =>
                                  `  ${d.category}: ${d.activeSites} sites, median DR ${d.medianDomainRating ?? "n/a"}`,
                          )
                          .join("\n")
                    : "No category has enough sites to match on its own yet.",
                thin.length
                    ? `\nStill filling up, matched against adjacent categories (${thin.length}):\n` +
                      thin.map((d) => `  ${d.category}: ${d.activeSites}`).join("\n")
                    : "",
                empty.length
                    ? `\nNobody here yet, be first (${empty.length}): ${empty.map((d) => d.category).join(", ")}`
                    : "",
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
            inputSchema: z.object({
                category: z.enum(CATEGORIES).optional().describe("Restrict to one category."),
                dr_min: z.number().int().min(0).max(100).optional(),
                dr_max: z.number().int().min(0).max(100).optional(),
                limit: z.number().int().min(1).max(20).default(5),
            }),
        },
        guard(ctx, "search_partners", async (args) => {
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
                [
                    partners
                        .map((p) =>
                            [
                                `${p.partnerId}  ${p.category}  DR ${p.domainRating ?? "unrated"}`,
                                `  ${p.description}`,
                                `  wants anchors: ${p.wantedAnchors.join(", ") || "none given"}`,
                                `  can offer: ${p.placementOffered}   given ${p.linksGiven} / received ${p.linksGot}`,
                            ].join("\n"),
                        )
                        .join("\n\n"),
                    // Said out loud because the id leading each row invites the
                    // obvious next move, and there is no tool to make it. This
                    // is browsing, not a shortlist. See issue #18.
                    "This is a browse: no tool takes a partner id, and picking one of these is not something the exchange supports yet. Matching is automatic. Submit a site with submit_site and you are paired when a partner is approved near your category, then told by email and in list_matches.",
                ].join("\n\n"),
            );
        }),
    );

    // Everything above this line answers an anonymous caller, by design: the
    // server has to be useful before anyone signs in. Everything below it calls
    // `requireMember` first.
    server.registerTool(
        "submit_site",
        {
            title: "Submit a site",
            description:
                "Lists a site in the exchange. Call it FIRST without `confirm` to get a drafted listing (category, description, suggested anchors) and show it to the member. Only call again with confirm=true after they have seen and approved the wording, because the description is shown to strangers.",
            inputSchema: z.object({
                url: z.string().describe("The site's URL, e.g. https://yourproduct.com"),
                confirm: z.boolean().default(false).describe("Set true only after the member has approved the draft."),
                category: z.enum(CATEGORIES).optional().describe("Overrides the drafted category on confirm."),
                description: z.string().max(2000).optional().describe("Overrides the drafted description on confirm."),
                keywords: z.array(z.string()).max(25).optional().describe("Overrides the drafted anchors on confirm."),
                placement_offered: z
                    .enum(PLACEMENT_OFFERS)
                    .optional()
                    .describe("What the member can offer a partner in return."),
            }),
        },
        guard(ctx, "submit_site", async (args) => {
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
                        `  DR           ${draft.domainRating ?? "unrated"} (Ahrefs DR via VerifiedDR)`,
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

            // No pairing call here. `autoPair` refuses anything that is not
            // `active` and a fresh listing is `pending_review`, so calling it
            // would do nothing but return a reason. Matching happens at
            // approval, in `setSiteStatus`.
            return text(
                `${site.domain} is listed and pending review.` +
                    "\n\nA human reads the listing, usually the same day. Matching runs the moment it is approved, and if a partner is waiting in your category the member hears by email right then.",
            );
        }),
    );

    server.registerTool(
        "list_my_sites",
        {
            title: "My sites",
            description: "Lists the sites this member has in the exchange, with status and link standing.",
            inputSchema: z.object({}),
        },
        guard(ctx, "list_my_sites", async () => {
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
            inputSchema: z.object({
                state: z
                    .enum(["proposed", "a_accepted", "b_accepted", "agreed", "placed", "declined", "expired"])
                    .optional(),
            }),
        },
        guard(ctx, "list_matches", async (args) => {
            const member = requireMember(ctx);
            const matches = await listMatches(member, args.state);
            if (matches.length === 0) return text("No matches yet.");
            return text(
                matches
                    .map((m) => {
                        // Say when a pair was widened. Unlabelled, an adjacent
                        // match is indistinguishable from a wrong one, which is
                        // exactly what house rule §02 promises not to do.
                        const category = m.widened ? `${m.partner.category} (adjacent to yours)` : m.partner.category;
                        const who =
                            "domain" in m.partner
                                ? `${m.partner.domain} (${m.partner.email}), ${category}`
                                : `${category}, DR ${m.partner.domainRating ?? "unrated"} (hidden until you both accept)`;
                        return [
                            `${m.matchId}  [${m.state}]  ${who}`,
                            `  ${m.partner.description}`,
                            ...(m.widened
                                ? [
                                      "  widened: one of your two categories was too thin to pair inside, so we went one adjacent step out.",
                                  ]
                                : []),
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
            inputSchema: z.object({
                match_id: z.string(),
                accept: z.boolean(),
                reason: z.string().max(500).optional().describe("Optional note when declining."),
            }),
        },
        guard(ctx, "respond_to_match", async (args) => {
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
            inputSchema: z.object({
                match_id: z.string(),
                format: z.enum(["html", "markdown", "mdx", "jsx"]).default("html"),
            }),
        },
        guard(ctx, "get_link_brief", async (args) => {
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
            inputSchema: z.object({
                match_id: z.string(),
                page_url: z.string().describe("The exact page the link was placed on."),
                anchor_used: z.string().optional(),
            }),
        },
        guard(ctx, "mark_link_placed", async (args) => {
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
            inputSchema: z.object({}),
        },
        guard(ctx, "check_links", async () => {
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
            inputSchema: z.object({}),
        },
        guard(ctx, "get_my_standing", async () => {
            const member = requireMember(ctx);
            const s = await getStanding(member);
            return text(
                `${s.sites} site(s). Given ${s.linksGiven}, received ${s.linksReceived}. Standing: ${s.health}. ${s.note}`,
            );
        }),
    );
}
