/**
 * @file The hero install block: pick your agent, copy one line, watch the trade.
 *
 * Two independent tab strips share one panel:
 *   1. client   -> which install snippet is shown (Claude Code, Cursor, ...)
 *   2. view     -> which transcript the terminal body plays back
 *
 * The transcripts are illustrations, not recordings, and they are written to be
 * honest about the product's actual promises:
 *   - partner domains are MASKED before mutual accept, because blindness until
 *     both sides say yes is a real guarantee and the page must not undercut it
 *   - placement is reported, never refereed
 *   - no member counts, site counts, or "N builders in X" appear anywhere
 *
 * The tool names in the transcripts are the real ones, checked against the
 * registry in `src/lib/mcp/tools.ts`. This page is aimed at people who will
 * paste the install command and then call the tools, so a name that does not
 * exist is not a cosmetic slip, it is the page lying about the product.
 */

"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/components/web/cn";
import { CopyButton } from "@/components/web/copy-button";
import { type TabItem, TabList, panelId, tabId } from "@/components/web/tab-list";

const MCP_URL = "https://builders-backlinks.com/api/mcp";

// ---------------------------------------------------------------------------
// Install snippets
// ---------------------------------------------------------------------------

type ClientId = "claude" | "cursor" | "codex" | "gemini";

type ClientDef = {
    id: ClientId;
    label: string;
    /** Where the snippet goes, in plain words. */
    where: string;
    /** Mono path badge, when the snippet is a config file rather than a command. */
    path?: string;
    /** Copied verbatim. This is the real command, people will paste it. */
    snippet: string;
    /** Caveat shown under the block. Kept honest, not decorative. */
    footnote?: string;
};

const CLIENTS: readonly ClientDef[] = [
    {
        id: "claude",
        label: "Claude Code",
        where: "Run this once, in any terminal",
        snippet: `claude mcp add --transport http builders-backlinks ${MCP_URL} --header "Authorization: Bearer bb_live_..."`,
        footnote: "Add --scope user to make it available in every project instead of just this one.",
    },
    {
        id: "cursor",
        label: "Cursor",
        where: "Create or edit",
        path: ".cursor/mcp.json",
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
        footnote: "Use ~/.cursor/mcp.json instead if you want the server in every project.",
    },
    {
        id: "codex",
        label: "Codex",
        where: "Add to",
        path: "~/.codex/config.toml",
        // TODO(verify): confirmed against the Codex "Model Context Protocol" docs
        // (learn.chatgpt.com/docs/extend/mcp): remote streamable-HTTP servers take
        // `url` plus `bearer_token_env_var`, and `codex mcp add` is stdio-only, so
        // this has to be a hand-edited file. Two things still to check against the
        // installed CLI version before launch:
        //   1. whether older builds still require `experimental_use_rmcp_client = true`
        //      at the top level for remote servers to load at all
        //   2. whether a literal `bearer_token = "..."` is accepted as an alternative
        //      to the env-var indirection used here
        snippet: `# export BUILDERS_BACKLINKS_TOKEN=bb_live_...

[mcp_servers.builders-backlinks]
url = "${MCP_URL}"
bearer_token_env_var = "BUILDERS_BACKLINKS_TOKEN"`,
        footnote: "Codex reads the token from the environment variable, so the key never sits in the config file.",
    },
    {
        id: "gemini",
        label: "Gemini CLI",
        where: "Add to",
        path: "~/.gemini/settings.json",
        // TODO(verify): `httpUrl` (not `url`) is the streamable-HTTP key in the
        // Gemini CLI MCP docs, and `headers` is supported alongside it. Re-check
        // against the CLI version pinned at launch, and check whether the newer
        // `gemini mcp add --transport http` subcommand is stable enough to show
        // here instead of the settings file.
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
        footnote: "Use .gemini/settings.json inside a repo to scope the server to that project.",
    },
];

const CLIENT_TABS: readonly TabItem<ClientId>[] = CLIENTS.map((client) => ({
    id: client.id,
    label: client.label,
}));

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

type Tone = "plain" | "dim" | "bright" | "prompt" | "tool" | "key" | "ok" | "add" | "mask" | "warn";

type Segment = { text: string; tone?: Tone };
type Line = readonly Segment[];

const TONE_CLASS: Record<Tone, string> = {
    plain: "text-term-fg",
    dim: "text-term-dim",
    bright: "text-term-bright",
    prompt: "text-term-bright font-medium",
    tool: "text-term-tool",
    key: "text-term-key",
    ok: "text-term-ok",
    add: "text-term-add",
    mask: "text-term-mask",
    warn: "text-term-warn",
};

/** Segment helper. Keeps the transcripts below readable as data. */
function s(text: string, tone: Tone = "plain"): Segment {
    return { text, tone };
}

/** Single-tone line helper. */
function l(text: string, tone: Tone = "plain"): Line {
    return [s(text, tone)];
}

const BLANK: Line = [];
const RULE: Line = l("  " + "─".repeat(58), "dim");

type ViewId = "connect" | "submit" | "match" | "place";

const VIEW_TABS: readonly TabItem<ViewId>[] = [
    { id: "connect", label: "connect" },
    { id: "submit", label: "submit" },
    { id: "match", label: "match" },
    { id: "place", label: "place" },
];

const TRANSCRIPTS: Record<ViewId, readonly Line[]> = {
    connect: [
        [s("$ ", "dim"), s("claude mcp add --transport http builders-backlinks \\", "bright")],
        l("      https://builders-backlinks.com/api/mcp \\", "bright"),
        l('      --header "Authorization: Bearer bb_live_..."', "bright"),
        BLANK,
        l("Added HTTP MCP server builders-backlinks", "plain"),
        BLANK,
        [s("$ ", "dim"), s("claude", "bright")],
        [s("> ", "dim"), s("/mcp", "prompt")],
        BLANK,
        [s("  builders-backlinks   ", "plain"), s("✓ connected", "ok")],
        [s("  tools  ", "dim"), s("submit_site · list_matches · respond_to_match", "tool")],
        l("         get_link_brief · mark_link_placed", "tool"),
        BLANK,
        l("  Nothing installed locally. It is an HTTP server.", "dim"),
    ],

    submit: [
        [s("> ", "dim"), s("submit my site", "prompt")],
        BLANK,
        [s("⏺ ", "tool"), s("builders-backlinks · submit_site", "tool")],
        [s("  url  ", "dim"), s('"https://myapp.dev"', "key")],
        BLANK,
        l("  Drafted your listing", "bright"),
        RULE,
        [s("  domain       ", "dim"), s("myapp.dev", "plain"), s("   never shown to partners", "dim")],
        [s("  category     ", "dim"), s("Developer Tools", "plain")],
        [s("  DR           ", "dim"), s("14", "plain")],
        [s("  description  ", "dim"), s("A dashboard and CLI for tracking deploy health", "plain")],
        l("               across a small team. Surfaces failed builds,", "plain"),
        l("               rollback history and per-environment drift", "plain"),
        l("               without running a full observability stack.", "plain"),
        [s("  anchors      ", "dim"), s('"deploy health dashboard", "rollback history",', "plain")],
        l('               "track failed builds"', "plain"),
        RULE,
        BLANK,
        l("  The description names no brand on purpose. Partners read it", "dim"),
        l("  before either of you knows who the other one is.", "dim"),
        BLANK,
        [s("  Submit this listing? ", "bright"), s("(y / n)", "dim")],
    ],

    match: [
        [s("> ", "dim"), s("any matches?", "prompt")],
        BLANK,
        [s("⏺ ", "tool"), s("builders-backlinks · list_matches", "tool")],
        BLANK,
        l("  1 match waiting on you", "bright"),
        RULE,
        [s("  partner      ", "dim"), s("▓▓▓▓▓▓▓▓▓.dev", "mask"), s("   hidden until you both accept", "dim")],
        [s("  category     ", "dim"), s("Developer Tools", "plain")],
        [s("  DR           ", "dim"), s("17", "plain"), s("   your band: 10 to 25", "dim")],
        [s("  about        ", "dim"), s("Uptime checks and a hosted status page for", "plain")],
        l("               solo operators. Ping monitors, incident", "plain"),
        l("               timeline, public history page.", "plain"),
        [s("  wants        ", "dim"), s('"status page for solo devs",', "plain")],
        l('               "uptime monitoring"', "plain"),
        [s("  offers       ", "dim"), s("a link from an existing article", "plain")],
        RULE,
        BLANK,
        [s("  ", "dim"), s("respond_to_match", "tool"), s("(match_id, accept: true | false)", "dim")],
    ],

    place: [
        [s("> ", "dim"), s("place our side of the trade", "prompt")],
        BLANK,
        [s("⏺ ", "tool"), s("builders-backlinks · get_link_brief", "tool")],
        [s("  match  ", "dim"), s("mt_8f21c4", "key")],
        BLANK,
        [s("  partner    ", "dim"), s("statusloop.dev", "plain"), s("   revealed: you both accepted", "dim")],
        [s("  you give   ", "dim"), s("myapp.dev  →  statusloop.dev", "plain")],
        [s("  you get    ", "dim"), s("statusloop.dev  →  myapp.dev", "plain")],
        [s("  anchor     ", "dim"), s('"status page for solo devs"', "plain"), s("   or a variant", "dim")],
        [s("  placement  ", "dim"), s("your call. We classify it and tell you both.", "plain")],
        BLANK,
        [s("⏺ ", "tool"), s("Read", "bright"), s("(content/blog/deploy-checklist.mdx)", "plain")],
        [s("  ⎿  ", "dim"), s("142 lines", "dim")],
        BLANK,
        [s("⏺ ", "tool"), s("Edit", "bright"), s("(content/blog/deploy-checklist.mdx)", "plain")],
        [s("  ⎿  ", "dim"), s("@@ -63,6 +63,9 @@", "key")],
        l("       Once the rollback path is proven, the last gap is", "dim"),
        l("       telling everyone else that it happened.", "dim"),
        l("     +", "add"),
        l("     +  A [status page for solo devs](https://statusloop.dev)", "add"),
        l("     +  covers that without another dashboard to babysit.", "add"),
        BLANK,
        [s("⏺ ", "tool"), s("builders-backlinks · mark_link_placed", "tool")],
        [s("  page    ", "dim"), s("https://myapp.dev/blog/deploy-checklist", "key")],
        [s("  anchor  ", "dim"), s('"status page for solo devs"', "key")],
        BLANK,
        l("  ✓ verified live · placement: content · dofollow", "ok"),
        BLANK,
        l("  Rechecked on day 7, day 30, then monthly. You will hear from", "dim"),
        l("  us if it ever stops resolving, and the moment their side", "dim"),
        l("  lands on your domain.", "dim"),
    ],
};

const VIEW_CAPTION: Record<ViewId, string> = {
    connect: "One HTTP server. Nothing to install locally, nothing running on your machine.",
    submit: "Your listing is drafted from the page itself, and scrubbed of anything that names you.",
    match: "You judge a partner on category, DR and what the site does. Not on who they are.",
    place: "This is the step every other exchange leaves to you, and the step where most trades die.",
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function SnippetBody({ snippet }: { snippet: string }) {
    return (
        <pre className="min-w-max font-mono text-[12.5px] leading-[1.75] sm:text-[13px]">
            <code>
                {snippet.split("\n").map((line, index) => {
                    const isComment = line.trimStart().startsWith("#");
                    return (
                        <span
                            key={index}
                            className={cn("block whitespace-pre", isComment ? "text-term-dim" : "text-term-bright")}>
                            {line === "" ? " " : line}
                        </span>
                    );
                })}
            </code>
        </pre>
    );
}

function TranscriptBody({ lines }: { lines: readonly Line[] }) {
    return (
        <pre className="min-w-max font-mono text-[12px] leading-[1.75] sm:text-[12.5px]">
            <code>
                {lines.map((line, index) => (
                    <span key={index} className="block whitespace-pre">
                        {line.length === 0
                            ? " "
                            : line.map((segment, segmentIndex) => (
                                  <span key={segmentIndex} className={TONE_CLASS[segment.tone ?? "plain"]}>
                                      {segment.text}
                                  </span>
                              ))}
                    </span>
                ))}
            </code>
        </pre>
    );
}

export function InstallTabs() {
    const [client, setClient] = useState<ClientId>("claude");
    const [view, setView] = useState<ViewId>("place");

    return (
        <div className="border-term-line bg-term-bg overflow-hidden rounded-sm border shadow-2xl shadow-black/20">
            {/* Chrome: eyebrow + recommendation. */}
            <div className="border-term-line bg-term-chrome flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
                <span className="text-term-dim font-mono text-[11px] tracking-[0.14em] uppercase">
                    From your agent · MCP
                </span>
                <span className="bg-accent text-accent-fg rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                    Recommended
                </span>
            </div>

            {/* Client picker. */}
            <div className="border-term-line bg-term-chrome border-b px-2 py-2">
                <TabList
                    label="Agent client"
                    idBase="client"
                    items={CLIENT_TABS}
                    value={client}
                    onChange={setClient}
                    variant="solid"
                />
            </div>

            {/* Install snippet, one panel per client. */}
            {CLIENTS.map((definition) => (
                <div
                    key={definition.id}
                    role="tabpanel"
                    id={panelId("client", definition.id)}
                    aria-labelledby={tabId("client", definition.id)}
                    hidden={definition.id !== client}
                    tabIndex={0}
                    className="border-term-line border-b px-4 py-4">
                    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-term-dim text-[12px]">{definition.where}</span>
                        {definition.path ? (
                            <code className="border-term-line text-term-fg rounded-sm border px-1.5 py-0.5 font-mono text-[11.5px]">
                                {definition.path}
                            </code>
                        ) : null}
                    </div>

                    {/* items-center, not items-start: the common case is a
                        one-line command sitting next to a taller bordered
                        button, and top-aligning those reads as a misalignment. */}
                    <div className="border-term-line flex items-center gap-3 rounded-sm border bg-black/25 p-3">
                        <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
                            <SnippetBody snippet={definition.snippet} />
                        </div>
                        <CopyButton value={definition.snippet} label={`${definition.label} setup`} />
                    </div>

                    {definition.footnote ? (
                        <p className="text-term-dim mt-2.5 text-[12px] leading-relaxed">{definition.footnote}</p>
                    ) : null}

                    <p className="text-term-dim mt-2.5 text-[12px] leading-relaxed">
                        Replace <code className="text-term-fg font-mono">bb_live_...</code> with the key on your
                        dashboard. It is the only secret involved.
                    </p>
                </div>
            ))}

            {/* View picker. */}
            <div className="border-term-line bg-term-chrome border-b px-2">
                <TabList
                    label="What the agent does"
                    idBase="view"
                    items={VIEW_TABS}
                    value={view}
                    onChange={setView}
                    variant="underline"
                />
            </div>

            {/* Transcript, one panel per view. */}
            {VIEW_TABS.map((tab) => (
                <div
                    key={tab.id}
                    role="tabpanel"
                    id={panelId("view", tab.id)}
                    aria-labelledby={tabId("view", tab.id)}
                    hidden={tab.id !== view}
                    tabIndex={0}>
                    {/* Horizontal scroll lives here, not on the page. No max height:
                        the `place` payoff line must never sit below a hidden fold. */}
                    <div className="min-h-[20rem] scrollbar-none overflow-x-auto px-4 py-4">
                        <TranscriptBody lines={TRANSCRIPTS[tab.id]} />
                    </div>
                    <p className="border-term-line text-term-dim border-t px-4 py-3 text-[12.5px] leading-relaxed">
                        {VIEW_CAPTION[tab.id]}
                    </p>
                </div>
            ))}

            {/* Footer of the panel. */}
            <div className="border-term-line bg-term-chrome flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-3">
                <p className="text-term-fg text-[12.5px] leading-relaxed">
                    Add the server once. Then just say{" "}
                    <span className="text-term-bright font-mono">&ldquo;trade a link&rdquo;</span> in any session.
                </p>
                <a
                    href="/docs/mcp"
                    className="text-term-tool hover:text-term-bright inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors">
                    Full MCP + API docs
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                </a>
            </div>
        </div>
    );
}
