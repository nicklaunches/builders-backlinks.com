/**
 * @file `/docs/mcp`: the reference a developer lands on from the hero.
 *
 * Written against three rules.
 *
 *   1. EVERY TOOL AND ARGUMENT ON THIS PAGE IS REAL. The tool reference below is
 *      a transcription of the registry in `src/lib/mcp/tools.ts`, argument for
 *      argument, including defaults and bounds. If a tool is renamed, an
 *      argument is added, or a bound moves, this page is wrong and someone will
 *      paste a call that fails. Change both together.
 *   2. UNVERIFIED THINGS ARE LABELLED. Claude Code and Cursor are confirmed
 *      working. The Codex CLI and Gemini CLI snippets are derived from those
 *      products' own MCP documentation and have not been run end to end here
 *      (see the TODO(verify) notes in `src/components/web/install-tabs.tsx`).
 *      Saying so costs nothing with this audience, and being confidently wrong
 *      to someone holding a terminal costs everything.
 *   3. NO SCALE CLAIMS, same as the landing page. No member counts anywhere.
 *
 * Server component. The only client JavaScript is the copy button inside
 * `CodeBlock`.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { OnThisPageRail } from "@/components/web/on-this-page-rail";
import { OnThisPage, PageHeader } from "@/components/web/page-header";
import { Callout, Code, CodeBlock, Prose, Section, Subheading } from "@/components/web/prose";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";

const MCP_URL = "https://builders-backlinks.com/api/mcp";

export const metadata: Metadata = {
    title: "MCP server and API docs",
    description:
        "How to add the Builders Backlinks MCP server to Claude Code, Cursor, Codex or Gemini CLI, what every tool takes and returns, " +
        "and a worked trade from an empty listing to a link we have verified is live.",
    alternates: { canonical: "/docs/mcp" },
};

const SECTIONS = [
    { href: "#server", label: "The server" },
    { href: "#install", label: "Install" },
    { href: "#auth", label: "Authentication" },
    { href: "#tools", label: "Tool reference" },
    { href: "#example", label: "A trade, end to end" },
    { href: "#privacy", label: "What the API can see" },
    { href: "#limits", label: "Limits and good behaviour" },
    { href: "#errors", label: "Errors" },
] as const;

// ---------------------------------------------------------------------------
// Install snippets. Kept in step with `install-tabs.tsx` by hand: that
// component is the hero, this is the reference, and both get copied verbatim.
// ---------------------------------------------------------------------------

type InstallDef = {
    id: string;
    label: string;
    /** Whether this has actually been run against the client. */
    status: "confirmed" | "unverified";
    where: string;
    snippet: string;
    notes: readonly string[];
};

const INSTALLS: readonly InstallDef[] = [
    {
        id: "claude-code",
        label: "Claude Code",
        status: "confirmed",
        where: "Run once in any terminal.",
        snippet: `claude mcp add --transport http builders-backlinks \\
    ${MCP_URL} \\
    --header "Authorization: Bearer bb_live_..."`,
        notes: [
            "Add --scope user to make the server available in every project instead of only the current one.",
            "Drop the --header flag to add it anonymously. The three read tools work, and the write tools reply with the command to add your key.",
        ],
    },
    {
        id: "cursor",
        label: "Cursor",
        status: "confirmed",
        where: "Create or edit .cursor/mcp.json",
        snippet: `{
    "mcpServers": {
        "builders-backlinks": {
            "url": "${MCP_URL}",
            "headers": {
                "Authorization": "Bearer bb_live_..."
            }
        }
    }
}`,
        notes: ["Use ~/.cursor/mcp.json instead to get the server in every project."],
    },
    {
        id: "codex",
        label: "Codex CLI",
        status: "unverified",
        where: "Add to ~/.codex/config.toml",
        snippet: `# export BUILDERS_BACKLINKS_TOKEN=bb_live_...

[mcp_servers.builders-backlinks]
url = "${MCP_URL}"
bearer_token_env_var = "BUILDERS_BACKLINKS_TOKEN"`,
        notes: [
            "This follows the Codex MCP documentation: remote streamable-HTTP servers take url plus bearer_token_env_var, and codex mcp add is stdio-only, so it has to be a hand-edited file. We have not yet run it against the Codex CLI ourselves.",
            "If the server does not appear at all, check whether your build still wants experimental_use_rmcp_client = true at the top level of the file before it will load remote servers.",
            "The token is read from the environment, so the key never sits in the config file.",
        ],
    },
    {
        id: "gemini",
        label: "Gemini CLI",
        status: "unverified",
        where: "Add to ~/.gemini/settings.json",
        snippet: `{
    "mcpServers": {
        "builders-backlinks": {
            "httpUrl": "${MCP_URL}",
            "headers": {
                "Authorization": "Bearer bb_live_..."
            }
        }
    }
}`,
        notes: [
            "httpUrl, not url, is the streamable-HTTP key in the Gemini CLI MCP docs, and headers is supported alongside it. Also not yet confirmed against the CLI here.",
            "Use .gemini/settings.json inside a repository to scope the server to that project.",
        ],
    },
];

// ---------------------------------------------------------------------------
// Tool reference. Transcribed from registerTools() in src/lib/mcp/tools.ts.
// ---------------------------------------------------------------------------

type ToolArg = {
    name: string;
    /** The schema, written the way a caller has to satisfy it. */
    type: string;
    required: boolean;
    note: string;
};

type ToolDef = {
    name: string;
    auth: "anonymous" | "key";
    summary: string;
    args: readonly ToolArg[];
    returns: string;
};

const READ_TOOLS: readonly ToolDef[] = [
    {
        name: "get_rules",
        auth: "anonymous",
        summary:
            "The house rules, in the exact wording members and their agents are held to. Worth calling before a first submission: it is far cheaper than correcting an agent afterwards.",
        args: [],
        returns: "A one-line summary of the exchange followed by the six rules, as plain text.",
    },
    {
        name: "get_categories",
        auth: "anonymous",
        summary:
            "Every matchable category with how many active sites it holds and the median Domain Rating, split into categories that can match today, categories still filling up, and categories with nobody in them yet.",
        args: [],
        returns:
            "Three grouped lists. The empty group is the useful one when you are deciding whether to join, because being first in a category means every later joiner is matched with you.",
    },
    {
        name: "search_partners",
        auth: "anonymous",
        summary:
            "Finds active sites open to a trade. Every row is masked: what the site is about, its Domain Rating, the anchors it wants, what it can offer, and its give and get counts. Never a domain, a URL, or an email.",
        args: [
            {
                name: "category",
                type: "one of the 38 categories",
                required: false,
                note: "Omit to search every category. Call get_categories for the exact spellings.",
            },
            { name: "dr_min", type: "integer, 0 to 100", required: false, note: "Lower bound on Domain Rating." },
            { name: "dr_max", type: "integer, 0 to 100", required: false, note: "Upper bound on Domain Rating." },
            {
                name: "limit",
                type: "integer, 1 to 20, default 5",
                required: false,
                note: "Clamped to 20 server-side. There is no cursor and no offset.",
            },
        ],
        returns:
            "One block per partner: an opaque partner id, the category, DR, the identity-scrubbed description, wanted anchors, what they can offer, and links given versus received.",
    },
];

const WRITE_TOOLS: readonly ToolDef[] = [
    {
        name: "submit_site",
        auth: "key",
        summary:
            "Lists a site. Two-phase on purpose: call it first without confirm to get a drafted listing, show the wording to the person whose site it is, then call again with confirm=true. Nothing is written on the first call.",
        args: [
            {
                name: "url",
                type: "string",
                required: true,
                note: "A bare domain is fine, a scheme is added for you.",
            },
            {
                name: "confirm",
                type: "boolean, default false",
                required: false,
                note: "Set true only after a human has read the drafted description. It is shown to strangers.",
            },
            {
                name: "category",
                type: "one of the 38 categories",
                required: false,
                note: "Overrides the drafted category on confirm. Other is a catch-all that cannot be matched relevantly, so it is refused here.",
            },
            {
                name: "description",
                type: "string, up to 2000 characters",
                required: false,
                note: "Overrides the drafted description on confirm. Keep it identity-scrubbed: partners read it before they know who you are.",
            },
            {
                name: "keywords",
                type: "string array, up to 25",
                required: false,
                note: "Overrides the drafted anchors on confirm. Lowercased, trimmed and de-duplicated server-side. At least one is required.",
            },
            {
                name: "placement_offered",
                type: "blog_post, resources_page, existing_article, unsure",
                required: false,
                note: "What you can give a partner in return. Defaults to unsure.",
            },
        ],
        returns:
            "Without confirm: the drafted domain, category, DR, anchors and description. With confirm=true: the site is listed and pending review, plus the result of an immediate matching pass (a match, or first in category, or nobody suitable yet).",
    },
    {
        name: "list_my_sites",
        auth: "key",
        summary: "The sites this key owns, newest first.",
        args: [],
        returns:
            "Domain, category, DR, status (pending_review, active, paused, rejected, banned) and links given versus received.",
    },
    {
        name: "list_matches",
        auth: "key",
        summary:
            "Every match across all of this member's sites, with the partner masked until both sides accept, and a plain-language next step on each row.",
        args: [
            {
                name: "state",
                type: "proposed, a_accepted, b_accepted, agreed, placed, declined, expired",
                required: false,
                note: "Omit for all states. Returns the 50 most recently updated matches.",
            },
        ],
        returns:
            "Match id, state, the partner (masked, or domain plus email once agreed), their description, the anchors they want, and what to do next.",
    },
    {
        name: "respond_to_match",
        auth: "key",
        summary:
            "Accepts or declines a proposed match. When the second side accepts, the two domains and emails are revealed to each other in the same instant and the link brief unlocks.",
        args: [
            { name: "match_id", type: "string", required: true, note: "From list_matches." },
            { name: "accept", type: "boolean", required: true, note: "false declines and closes the match." },
            {
                name: "reason",
                type: "string, up to 500 characters",
                required: false,
                note: "Optional note when declining. Recorded, not forwarded as an accusation.",
            },
        ],
        returns:
            "The new state. On mutual accept, the partner domain and contact email plus an instruction to call get_link_brief. Accepting an already-agreed match is a harmless no-op, so retries are safe.",
    },
    {
        name: "get_link_brief",
        auth: "key",
        summary:
            "Everything needed to write the partner link into your own repository. Only available once the match is agreed, because before that the target URL genuinely does not exist in any payload you can reach.",
        args: [
            { name: "match_id", type: "string", required: true, note: "Must be in state agreed or placed." },
            {
                name: "format",
                type: "html, markdown, mdx, jsx, default html",
                required: false,
                note: "Shapes the paste-ready snippet only.",
            },
        ],
        returns:
            "Target URL, the partner description, up to four approved anchor options, what they offer in return, a snippet in the requested format, and guidance. The guidance is advice, not rules: where the link goes is your call.",
    },
    {
        name: "mark_link_placed",
        auth: "key",
        summary:
            "Tells the exchange that a partner link is live on a given page, then fetches that page immediately and reports what was actually found.",
        args: [
            { name: "match_id", type: "string", required: true, note: "Must be agreed or placed." },
            {
                name: "page_url",
                type: "string",
                required: true,
                note: "The exact page the link is on, not the site root.",
            },
            {
                name: "anchor_used",
                type: "string",
                required: false,
                note: "Used only as a fallback when we cannot read the anchor text ourselves.",
            },
        ],
        returns:
            "Verified live, with the placement (content, footer, nav, sidebar, unknown), dofollow or nofollow, the detected anchor, and whether the same link appears sitewide. A failed crawl comes back as inconclusive, never as a missing link.",
    },
    {
        name: "check_links",
        auth: "key",
        summary:
            "The ledger: every link this member has given and received, in both directions, with the state we last verified.",
        args: [],
        returns:
            "Direction, status (promised, live, missing, removed), placement, dofollow or nofollow, and the page URL. Up to 100 rows, most recently updated first.",
    },
    {
        name: "get_my_standing",
        auth: "key",
        summary: "How many links this member has given versus received, and whether matching currently favours them.",
        args: [],
        returns:
            "Site count, links given, links received, a standing of new, healthy, watch or behind, and one sentence explaining it. Your first two exchanges are grace: nobody is behind before they have traded.",
    },
];

// ---------------------------------------------------------------------------
// The worked example. The most valuable block on the page, so it is a real
// sequence with real argument names, not a shape.
// ---------------------------------------------------------------------------

type Step = { n: string; title: string; body: string; call: string; result?: string };

const WALKTHROUGH: readonly Step[] = [
    {
        n: "01",
        title: "See whether anyone like you is here",
        body: "No key needed. Anonymous callers can read the catalog and the masked pool, which is the question that actually decides whether joining is worth anything.",
        call: `search_partners({ category: "Developer Tools", dr_min: 10, limit: 5 })`,
        result: "Masked rows only. Category, DR, description, wanted anchors. No domains.",
    },
    {
        n: "02",
        title: "Draft the listing",
        body: "The first call writes nothing at all. We fetch your homepage, send its text to an LLM to draft an identity-scrubbed description, and look up your Domain Rating. Show the draft to the person whose site it is.",
        call: `submit_site({ url: "https://myapp.dev" })`,
        result: "The drafted domain, category, DR, anchors and description, plus an instruction to confirm.",
    },
    {
        n: "03",
        title: "Confirm it, and get paired immediately",
        body: "Only now is anything written. The site is created as pending_review, and a matching pass runs synchronously, so if a partner is already waiting in your category you have a match before the call returns.",
        call: `submit_site({
    url: "https://myapp.dev",
    confirm: true,
    keywords: ["deploy health dashboard", "rollback history"],
    placement_offered: "existing_article",
})`,
        result: "myapp.dev is listed and pending review, plus the outcome of the matching pass.",
    },
    {
        n: "04",
        title: "Read the match",
        body: "The partner is masked. You are deciding on category, DR band, what the site is about and the anchors it wants, without knowing which site it is.",
        call: `list_matches({ state: "proposed" })`,
        result: "A match id, the masked partner, and the next step in plain words.",
    },
    {
        n: "05",
        title: "Accept",
        body: "When the second side accepts, both domains and both emails are released at the same moment. That is a one-way door, so accept means you are genuinely willing to place a link.",
        call: `respond_to_match({ match_id: "...", accept: true })`,
        result: "Agreed, with the partner domain and contact email, and a pointer to the link brief.",
    },
    {
        n: "06",
        title: "Get the brief",
        body: "Ask for the snippet in the format your repository actually uses, so the agent can paste it straight into the file it is about to edit.",
        call: `get_link_brief({ match_id: "...", format: "mdx" })`,
        result: "Target URL, anchor options, what their site is about, and a paste-ready snippet.",
    },
    {
        n: "07",
        title: "Place it",
        body: "This is the step every other exchange leaves to you. Your agent already has the repository open: find a relevant existing page, write a real sentence around the link, commit, deploy. There is no tool call here, and that is the entire point of the product.",
        call: `# your agent edits content/blog/deploy-checklist.mdx and ships it`,
    },
    {
        n: "08",
        title: "Mark it placed, and see what we found",
        body: "We fetch the page immediately and classify what is on it. A footer link and a nofollow link both count, and both are reported to your partner exactly as they are.",
        call: `mark_link_placed({
    match_id: "...",
    page_url: "https://myapp.dev/blog/deploy-checklist",
    anchor_used: "status page for solo devs",
})`,
        result: "Verified live, placement content, dofollow. Rechecked at day 7, day 30, then monthly.",
    },
    {
        n: "09",
        title: "Watch the ledger",
        body: "Both directions, so you can see what you actually received, not only what you gave.",
        call: `check_links()`,
    },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const PILL = "rounded-full border px-2 py-0.5 font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap uppercase";
const PILL_ACCENT = `${PILL} border-accent/40 bg-accent-soft text-accent`;
const PILL_MUTED = `${PILL} border-line text-muted`;

function ToolCard({ tool }: { tool: ToolDef }) {
    return (
        <article id={`tool-${tool.name}`} className="border-line bg-surface scroll-mt-20 rounded-sm border p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h4 className="text-accent font-mono text-[15px] font-semibold">{tool.name}</h4>
                <span className={tool.auth === "anonymous" ? PILL_MUTED : PILL_ACCENT}>
                    {tool.auth === "anonymous" ? "No key" : "Key required"}
                </span>
            </div>

            <p className="text-muted mt-3 text-[14.5px] leading-relaxed">{tool.summary}</p>

            <dl className="mt-5">
                <dt className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">Arguments</dt>
                <dd className="mt-2.5">
                    {tool.args.length === 0 ? (
                        <p className="text-muted text-[14px]">None.</p>
                    ) : (
                        <ul className="space-y-3">
                            {tool.args.map((arg) => (
                                <li key={arg.name} className="border-line border-l-2 pl-3">
                                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                        <span className="text-fg font-mono text-[13.5px] font-medium">{arg.name}</span>
                                        <span className="text-muted font-mono text-[12px]">{arg.type}</span>
                                        <span className="text-muted font-mono text-[10.5px] tracking-[0.1em] uppercase">
                                            {arg.required ? "required" : "optional"}
                                        </span>
                                    </p>
                                    <p className="text-muted mt-1 text-[13.5px] leading-relaxed">{arg.note}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </dd>

                <dt className="text-muted mt-5 font-mono text-[11px] tracking-[0.14em] uppercase">Returns</dt>
                <dd className="text-muted mt-2 text-[14px] leading-relaxed">{tool.returns}</dd>
            </dl>
        </article>
    );
}

function InstallCard({ install }: { install: InstallDef }) {
    const confirmed = install.status === "confirmed";
    return (
        <div id={`install-${install.id}`} className="scroll-mt-20">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h4 className="text-[16.5px] font-semibold">{install.label}</h4>
                <span className={confirmed ? PILL_ACCENT : PILL_MUTED}>
                    {confirmed ? "Confirmed working" : "Not yet confirmed"}
                </span>
            </div>
            <p className="text-muted mt-2 font-mono text-[13px]">{install.where}</p>
            <CodeBlock code={install.snippet} label={install.label} copyLabel={`${install.label} setup`} />
            <ul className="mt-3 space-y-1.5 pl-5">
                {install.notes.map((note) => (
                    <li key={note} className="text-muted marker:text-accent list-disc text-[13.5px] leading-relaxed">
                        {note}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function WalkthroughStep({ step }: { step: Step }) {
    return (
        <li className="scroll-mt-20">
            <div className="flex items-baseline gap-3">
                <span className="text-accent font-mono text-[12px] tracking-[0.16em]">{step.n}</span>
                <h4 className="text-[16px] font-semibold">{step.title}</h4>
            </div>
            <p className="text-muted mt-2 max-w-[68ch] text-[14.5px] leading-relaxed">{step.body}</p>
            <CodeBlock code={step.call} label="tool call" copyLabel={`step ${step.n}`} />
            {step.result ? (
                <p className="text-muted mt-3 text-[13.5px] leading-relaxed">
                    <span className="text-accent font-mono">returns </span>
                    {step.result}
                </p>
            ) : null}
        </li>
    );
}

export default function McpDocsPage() {
    return (
        <>
            <SiteHeader />

            <main id="main">
                <PageHeader
                    eyebrow="Docs · MCP and API"
                    title="The MCP server, end to end"
                    lede="One HTTP endpoint, eleven tools, and a worked trade from an empty listing to a link we have verified is live. Nothing installs on your machine."
                    meta={MCP_URL}>
                    {/* Small screens only: above lg the sticky rail takes over,
                        and showing both would be the same list twice. */}
                    <OnThisPage items={SECTIONS} className="lg:hidden" />
                </PageHeader>

                {/* The prose column keeps its max-w-3xl measure. Only the
                    OUTER wrapper widens, to make room for the rail, so the
                    reading line length is identical to every other page. */}
                <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-16 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-12">
                    <div className="max-w-3xl">
                        {/* -------------------------------------------------------
                        The server
                    ------------------------------------------------------- */}
                        <Section id="server" title="The server">
                            <Prose>
                                <p>
                                    Builders Backlinks is an MCP server first and a website second. The exchange is
                                    driven by tool calls from whatever agent you already work in, and the web pages
                                    exist so that people without one are not locked out.
                                </p>
                                <ul>
                                    <li>
                                        Endpoint: <Code>{MCP_URL}</Code>
                                    </li>
                                    <li>
                                        Transport: Streamable HTTP. A legacy SSE endpoint is also served at{" "}
                                        <Code>/api/sse</Code>, but use <Code>/api/mcp</Code> unless your client cannot.
                                    </li>
                                    <li>
                                        Server identity: <Code>builders-backlinks</Code>, version <Code>0.1.0</Code>.
                                    </li>
                                    <li>
                                        Nothing runs locally. There is no npm package, no binary, and no process on your
                                        machine.
                                    </li>
                                    <li>
                                        The request budget is 60 seconds. Nearly every call returns in well under a
                                        second. <Code>submit_site</Code> is the exception, because it does a live page
                                        fetch, a Domain Rating lookup and an LLM call before it answers.
                                    </li>
                                </ul>
                            </Prose>
                        </Section>

                        {/* -------------------------------------------------------
                        Install
                    ------------------------------------------------------- */}
                        <Section id="install" title="Install">
                            <Prose>
                                <p>
                                    Add the server once. Replace <Code>bb_live_...</Code> with the key from{" "}
                                    <a href="/app/key">your dashboard</a> (<a href="/signin">sign in</a> first). If you
                                    have not got a key yet, add the server without the header: the read tools still
                                    work.
                                </p>
                            </Prose>

                            <Callout title="Two of these four are confirmed, two are not">
                                Claude Code and Cursor are confirmed working against this server. The Codex CLI and
                                Gemini CLI snippets follow those products&rsquo; own MCP documentation, but we have not
                                run them end to end here yet, so treat them as should-work rather than known-good. If
                                one fails, the endpoint and the header are the only things that actually matter: any
                                client that can send an <Code>Authorization</Code> header to a streamable-HTTP MCP URL
                                will work.
                            </Callout>

                            <div className="mt-9 space-y-10">
                                {INSTALLS.map((install) => (
                                    <InstallCard key={install.id} install={install} />
                                ))}
                            </div>
                        </Section>

                        {/* -------------------------------------------------------
                        Authentication
                    ------------------------------------------------------- */}
                        <Section id="auth" title="Authentication">
                            <Prose>
                                <p>
                                    Authentication is optional at the server level and enforced per tool. That is
                                    deliberate: adding the server should never fail, and the first thing you can do
                                    should be to check whether the exchange is worth joining at all.
                                </p>
                                <ul>
                                    <li>
                                        <strong>Read tools work anonymously.</strong> <Code>get_rules</Code>,{" "}
                                        <Code>get_categories</Code> and <Code>search_partners</Code> need no credentials
                                        of any kind.
                                    </li>
                                    <li>
                                        <strong>Write tools need a bearer token.</strong> Everything that touches your
                                        sites, matches or links resolves a member from the{" "}
                                        <Code>Authorization: Bearer bb_live_...</Code> header, and returns the exact
                                        command to add one if it cannot.
                                    </li>
                                    <li>
                                        A key is <Code>bb_live_</Code> followed by 32 bytes of base64url randomness, so
                                        it pastes into a shell command without quoting hazards.
                                    </li>
                                    <li>
                                        Only the SHA-256 of your key is stored. The plaintext is shown once, at
                                        creation, and is unrecoverable afterwards. Lose it and you mint a new one.
                                    </li>
                                    <li>
                                        Unsubscribing disables the key. Your sites drop out of matching and tool calls
                                        behave as though you are signed out, until you resubscribe.
                                    </li>
                                </ul>
                            </Prose>

                            <Callout title="Header tokens now, OAuth 2.1 later" tone="accent">
                                The blessed path in the MCP specification is OAuth 2.1 with dynamic client registration,
                                and that is where this is going: a one-time browser sign-in and an install snippet with
                                no key in it at all. It needs an authorization server we have not built yet, and header
                                tokens work in every client today, including the ones whose OAuth support for
                                third-party servers is still uneven. When OAuth lands, the header path keeps working and
                                no tool name or argument changes.
                            </Callout>
                        </Section>

                        {/* -------------------------------------------------------
                        Tool reference
                    ------------------------------------------------------- */}
                        <Section id="tools" title="Tool reference">
                            <Prose>
                                <p>
                                    Eleven tools: three that need no key at all, and eight that act on your own account.
                                    Every tool returns plain text written to be read by a model, and every write tool
                                    ends by saying what to do next, so an agent can keep the loop going without being
                                    prompted at each step.
                                </p>
                            </Prose>

                            <Subheading id="tools-read">Anonymous reads</Subheading>
                            <div className="mt-4 space-y-4">
                                {READ_TOOLS.map((tool) => (
                                    <ToolCard key={tool.name} tool={tool} />
                                ))}
                            </div>

                            <Subheading id="tools-write">Authenticated writes</Subheading>
                            <Prose className="mt-3">
                                <p>Each of these needs the bearer header.</p>
                            </Prose>
                            <div className="mt-4 space-y-4">
                                {WRITE_TOOLS.map((tool) => (
                                    <ToolCard key={tool.name} tool={tool} />
                                ))}
                            </div>
                        </Section>

                        {/* -------------------------------------------------------
                        Worked example
                    ------------------------------------------------------- */}
                        <Section id="example" title="A trade, end to end">
                            <Prose>
                                <p>
                                    This is the whole product in nine steps. In practice you say something like{" "}
                                    <em>trade a link</em> and the agent walks it, but the calls underneath are these, in
                                    this order.
                                </p>
                            </Prose>

                            <ol className="mt-8 space-y-10">
                                {WALKTHROUGH.map((step) => (
                                    <WalkthroughStep key={step.n} step={step} />
                                ))}
                            </ol>

                            <Callout title="Both sides have to place, not just you">
                                A match only reaches <Code>placed</Code> once two links are verified live, one in each
                                direction. Your side landing first is normal and is never held against you: the first
                                two exchanges of any member are graced, because somebody has to go first.
                            </Callout>
                        </Section>

                        {/* -------------------------------------------------------
                        Privacy model
                    ------------------------------------------------------- */}
                        <Section id="privacy" title="What the API can see, and what it cannot">
                            <Prose>
                                <p>
                                    Blind matching is a product promise, so it is worth being exact about what that
                                    means at the API level rather than asking you to take it on trust.
                                </p>
                                <ul>
                                    <li>
                                        <strong>No read tool returns a partner domain, URL or email.</strong> Not{" "}
                                        <Code>search_partners</Code>, not <Code>list_matches</Code> before agreement, at
                                        no limit and under no filter. The masked partner type has no field for them, so
                                        there is nothing to populate by accident.
                                    </li>
                                    <li>
                                        <strong>Identities unlock at mutual accept, both at once.</strong> The second
                                        accept moves the match to <Code>agreed</Code>, and from that moment each side
                                        sees the other domain, URL and email. There is no one-way reveal and no way to
                                        look first.
                                    </li>
                                    <li>
                                        <strong>The partner id is opaque.</strong> The <Code>partnerId</Code> in a
                                        search result is an internal site id. It is only useful as an argument to
                                        another call, and it does not decode to anything.
                                    </li>
                                    <li>
                                        <strong>Descriptions are written not to identify you.</strong> The listing text
                                        is drafted by an LLM that is never given your domain or any URL, and a
                                        mechanical pass afterwards strips brand tokens derived from your domain and page
                                        title. An anchor that still carries a brand name is dropped rather than
                                        rewritten.
                                    </li>
                                    <li>
                                        <strong>Your own data is always fully visible to you.</strong>{" "}
                                        <Code>list_my_sites</Code>, <Code>check_links</Code> and{" "}
                                        <Code>get_my_standing</Code> show your real domains and pages, because they are
                                        yours.
                                    </li>
                                </ul>
                                <p>
                                    Two things to hold on to on the other side of that line. Your description, your
                                    anchors and your DR are readable by any anonymous caller, so treat them as public
                                    copy. And a reveal cannot be undone: once you accept a match, that partner has your
                                    domain and email for good. The full picture is on the{" "}
                                    <a href="/privacy">privacy page</a>.
                                </p>
                            </Prose>
                        </Section>

                        {/* -------------------------------------------------------
                        Limits
                    ------------------------------------------------------- */}
                        <Section id="limits" title="Limits and good behaviour">
                            <Prose>
                                <p>
                                    The exchange is a member base, not a directory to enumerate, and the anonymous read
                                    surface is the easiest thing here to abuse. The limits reflect that.
                                </p>
                                <ul>
                                    <li>
                                        <Code>search_partners</Code> takes a <Code>limit</Code> between 1 and 20 and
                                        clamps it server-side. There is no offset, no cursor and no page argument, so
                                        the pool cannot be walked from end to end.
                                    </li>
                                    <li>
                                        Results are ordered least-recently-matched first, so repeating the same query
                                        mostly returns the same rows. Narrow by category and DR rather than trying to
                                        page.
                                    </li>
                                    <li>
                                        <Code>list_matches</Code> returns at most 50 matches, and{" "}
                                        <Code>check_links</Code> at most 100 links, most recently updated first.
                                    </li>
                                    <li>
                                        One member can list up to 5 sites, and one domain belongs to one member, ever.
                                    </li>
                                    <li>
                                        A proposed match expires 14 days after it is created and returns to the pool.
                                    </li>
                                    <li>
                                        <Code>submit_site</Code> is expensive on our side: a page fetch, an Ahrefs
                                        lookup and an LLM call. Call the draft phase once, not in a retry loop.
                                    </li>
                                </ul>
                                <p>
                                    There is no published per-key request limit today, and we would rather never need
                                    one. Enumerating the member base, trying to correlate masked profiles back to
                                    domains, or driving the read tools in a tight loop are all grounds for revoking a
                                    key. If explicit rate limiting does arrive, the first thing you will see is an HTTP
                                    429, not a quiet change in what the results contain.
                                </p>
                            </Prose>
                        </Section>

                        {/* -------------------------------------------------------
                        Errors
                    ------------------------------------------------------- */}
                        <Section id="errors" title="Errors">
                            <Prose>
                                <p>
                                    Errors come back as ordinary tool results with the MCP error flag set, and a body
                                    written as an instruction rather than a status code. An agent that reads{" "}
                                    <em>run this to add your key, then retry</em> gets itself unstuck. An agent that
                                    reads <em>401 unauthorized</em> does not. The ones worth knowing:
                                </p>
                                <ul>
                                    <li>
                                        <strong>You are not signed in.</strong> A write tool was called without a valid
                                        key. The body contains the exact command to add one.
                                    </li>
                                    <li>
                                        <strong>Could not analyze that site.</strong> The page was unreachable, was not
                                        HTML, was too large, refused our crawler, or had too little text to describe
                                        honestly. Sites that render almost everything client-side are the common case.
                                    </li>
                                    <li>
                                        <strong>Already listed.</strong> That domain is in the exchange under another
                                        member. Domains are globally unique.
                                    </li>
                                    <li>
                                        <strong>Not agreed yet.</strong> <Code>get_link_brief</Code> or{" "}
                                        <Code>mark_link_placed</Code> was called on a match that has not reached mutual
                                        accept. The target URL does not exist in any payload before then.
                                    </li>
                                    <li>
                                        <strong>Recorded, but we could not confirm it.</strong> Not an error, and not an
                                        accusation. We read server-rendered HTML only, so a link injected by JavaScript
                                        is invisible to us even when it is genuinely on the page. We look again
                                        automatically.
                                    </li>
                                </ul>
                                <p>
                                    Anything else surfaces as a generic failure saying nothing was changed, which is
                                    accurate: tool handlers are thin adapters over the same services the web routes use,
                                    so a failure inside one does not half-write anything.
                                </p>
                            </Prose>
                        </Section>

                        <Prose className="border-line mt-16 border-t pt-8">
                            <p className="text-[14px]">
                                Domain Rating is provided by{" "}
                                <a href="https://ahrefs.com/website-authority-checker" rel="noopener nofollow">
                                    Ahrefs
                                </a>
                                . The house rules are on the <Link href="/#rules">landing page</Link> and are also
                                returned by <Code>get_rules</Code>. The <a href="/terms">terms</a> and{" "}
                                <a href="/privacy">privacy notice</a> cover everything else.
                            </p>
                        </Prose>
                    </div>

                    {/* top-20 clears the sticky site header (h-14 plus breathing
                        room), matching the scroll-mt-20 already on each Section. */}
                    <aside className="hidden lg:block">
                        <div className="sticky top-20">
                            <OnThisPageRail items={SECTIONS} />
                        </div>
                    </aside>
                </div>
            </main>

            <SiteFooter />
        </>
    );
}
