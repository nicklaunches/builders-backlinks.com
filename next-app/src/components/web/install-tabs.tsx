/**
 * @file The hero install block: pick your agent, copy one line, watch the trade.
 *
 * Two independent tab strips share one panel:
 *   1. client   -> which install snippet is shown (Claude Code, Cursor, ...)
 *   2. view     -> which transcript the terminal body plays back
 *
 * The view strip PLAYS ITSELF. connect -> submit -> match -> place is one story
 * told in four beats, and a static strip left most readers on whichever beat
 * happened to be selected. It advances on a timer with a progress bar, and the
 * first deliberate interaction (click or arrow key) stops it for good: an
 * animation that keeps yanking the panel away from someone who is reading it is
 * worse than no animation.
 *
 * The transcript half also COLLAPSES, and the choice is remembered. It is the
 * tall part of a very tall card, and a returning visitor who already watched it
 * should not have to scroll past it again. The install command and the key
 * button deliberately stay visible in the collapsed state: the card must keep
 * its primary action at every size.
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

import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/components/web/cn";
import { CopyButton } from "@/components/web/copy-button";
import { SnippetBody } from "@/components/web/snippet-body";
import { type TabItem, TabList, panelId, tabId } from "@/components/web/tab-list";

const MCP_URL = "https://builders-backlinks.com/api/mcp";

/** The agents an install snippet exists for. */
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
        // TODO(verify): matches the Codex MCP docs — remote streamable-HTTP takes
        // `url` plus `bearer_token_env_var`, and `codex mcp add` is stdio-only, so
        // this must be hand-edited. Still to check against the installed CLI:
        // (1) whether older builds need `experimental_use_rmcp_client = true`,
        // (2) whether a literal `bearer_token` works instead of the env-var form.
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

/** How one span of transcript text is coloured. Maps to the `--term-*` custom properties. */
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

/**
 * How long each step holds before the demo advances, in milliseconds.
 *
 * Not a constant, and not derived from a formula: the panels are between 14 and
 * 33 lines and a single interval either rushes `place` or strands the reader on
 * `connect`. These are roughly "long enough to read it once", written out so
 * the pacing can be judged and adjusted by reading the table rather than by
 * simulating an expression.
 */
const VIEW_DURATION_MS: Record<ViewId, number> = {
    connect: 5500,
    submit: 8000,
    match: 7000,
    place: 9500,
};

const VIEW_CAPTION: Record<ViewId, string> = {
    connect: "One HTTP server. Nothing to install locally, nothing running on your machine.",
    submit: "Your listing is drafted from the page itself, and scrubbed of anything that names you.",
    match: "You judge a partner on category, DR and what the site does. Not on who they are.",
    place: "This is the step every other exchange leaves to you, and the step where most trades die.",
};

/**
 * Where the collapsed/expanded choice is kept.
 *
 * Namespaced because this is the first thing in the app to touch localStorage
 * and it will not be the last. Values are `"open"` and `"closed"`; anything
 * else, including an unreadable store, means open.
 */
const DEMO_STORAGE_KEY = "bb.hero.demo";

/** Same-tab change notification. `storage` only fires in the OTHER tabs. */
const DEMO_CHANGE_EVENT = "bb:hero-demo-change";

/**
 * localStorage read as an external store, rather than as state seeded from an
 * effect.
 *
 * The obvious version, `useState(true)` plus an effect that reads storage and
 * calls `setDemoOpen`, is a cascading render and the React compiler's lint
 * rejects it. `useSyncExternalStore` is the shape this actually is: a value
 * that lives outside React, with a server snapshot that pins the SSR output to
 * `true` so hydration cannot mismatch. React re-renders with the real value
 * immediately after.
 */
function subscribeToDemoPreference(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(DEMO_CHANGE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(DEMO_CHANGE_EVENT, onChange);
    };
}

function readDemoPreference(): boolean {
    try {
        return window.localStorage.getItem(DEMO_STORAGE_KEY) !== "closed";
    } catch {
        // Storage access throws outright in some hardened and private browsing
        // profiles. The demo simply does not remember there.
        return true;
    }
}

/** Open on the server, always. Anything else is a hydration mismatch. */
function demoPreferenceOnServer(): boolean {
    return true;
}

function writeDemoPreference(open: boolean): void {
    try {
        window.localStorage.setItem(DEMO_STORAGE_KEY, open ? "open" : "closed");
        window.dispatchEvent(new Event(DEMO_CHANGE_EVENT));
    } catch {
        // See above. Not remembering is acceptable; throwing out of a click
        // handler is not.
    }
}

/** Renders one transcript as terminal lines, tone by tone. */
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
    // Starts at the beginning of the story now that the strip plays itself. It
    // used to open on `place`, the payoff step, because a static strip only
    // ever showed one. The cycle reaches `place` on its own and holds it
    // longest, which keeps that intent.
    const [view, setView] = useState<ViewId>("connect");
    const [cycling, setCycling] = useState(true);
    const demoOpen = useSyncExternalStore(subscribeToDemoPreference, readDemoPreference, demoPreferenceOnServer);
    const demoId = useId();
    const demoRef = useRef<HTMLDivElement>(null);
    const [demoOnScreen, setDemoOnScreen] = useState(true);

    useEffect(() => {
        const node = demoRef.current;
        if (!node || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver((entries) => setDemoOnScreen(entries[0].isIntersecting));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    // One pending timeout at a time, re-armed on every step. The reduced-motion
    // check is what makes this safe rather than polite: globals.css clamps
    // animation-duration to 0.01ms under that setting, so without this the
    // progress bar would snap to full on every tick while the panel kept
    // changing underneath a reader who asked for exactly the opposite.
    useEffect(() => {
        if (!cycling || !demoOpen || !demoOnScreen) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const timer = window.setTimeout(() => {
            setView((current) => {
                const index = VIEW_TABS.findIndex((tab) => tab.id === current);
                return VIEW_TABS[(index + 1) % VIEW_TABS.length].id;
            });
        }, VIEW_DURATION_MS[view]);

        return () => window.clearTimeout(timer);
    }, [view, cycling, demoOpen, demoOnScreen]);

    /**
     * Any deliberate choice of step ends the cycle for this visit.
     *
     * Arrow-key navigation routes through the same `onChange` as a click (see
     * `TabList.move`), so this covers the keyboard too.
     */
    function selectView(next: ViewId) {
        setView(next);
        setCycling(false);
    }

    // No local state to update: the write notifies the store, and the store is
    // what this component renders from.
    function toggleDemo() {
        writeDemoPreference(!demoOpen);
    }

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

                <button
                    type="button"
                    onClick={toggleDemo}
                    aria-expanded={demoOpen}
                    aria-controls={demoId}
                    className="text-term-dim hover:bg-term-bg/50 hover:text-term-fg ml-auto inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[11px] tracking-wide transition-colors">
                    {demoOpen ? "Hide demo" : "Show demo"}
                    <ChevronDown
                        aria-hidden="true"
                        className={cn("size-3.5 transition-transform duration-200", demoOpen && "rotate-180")}
                    />
                </button>
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

                    {/*
                        The command above carries a `bb_live_...` placeholder, so
                        nobody can finish the install without a key. This is the
                        moment they find that out, so the way to get one belongs
                        here rather than in the footer strip.

                        The copy points at /app/key first on purpose: that page
                        hands back the WHOLE command with the key already in it,
                        so going there beats copying this one and patching it by
                        hand. Accent fill with near-black text, the same pairing
                        as the RECOMMENDED pill, which is the readable orange
                        combination inside the terminal.
                    */}
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Link
                            href="/app/key"
                            className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 font-mono text-[11.5px] font-semibold tracking-wide uppercase transition-colors">
                            Get your key
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                        </Link>
                        <p className="text-term-dim text-[12px] leading-relaxed">
                            It hands you this line with the key already in it, so there is nothing to paste over.
                        </p>
                    </div>

                    {definition.footnote ? (
                        <p className="text-term-dim mt-3 text-[12px] leading-relaxed">{definition.footnote}</p>
                    ) : null}
                </div>
            ))}

            {/* The collapsible half: view picker plus transcripts. Everything
                outside it survives collapse, so the install command and the key
                button are never the thing that gets hidden. */}
            <div id={demoId} ref={demoRef} hidden={!demoOpen}>
                {/* View picker. */}
                <div className="border-term-line bg-term-chrome border-b px-2">
                    <TabList
                        label="What the agent does"
                        idBase="view"
                        items={VIEW_TABS}
                        value={view}
                        onChange={selectView}
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
            </div>

            {/* Footer of the panel, and the rail the step timer runs along. */}
            <div className="border-term-line bg-term-chrome relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-3">
                {/*
                    The timer sits on the card's bottom edge rather than under
                    the tab strip it describes. It is one uninterrupted line the
                    full width of the card, so it reads as the card's own
                    progress instead of as a fifth underline competing with the
                    four tabs directly above it.

                    Remounted by `key` on every step, which is what restarts the
                    animation; the duration is the only per-step input. Hidden
                    while collapsed, because the thing it is timing is not on
                    screen. aria-hidden because the strip already announces the
                    current step through aria-selected, and a second channel for
                    the same fact is noise in a screen reader.

                    Unmounted while the transcript is off screen for the same
                    reason the timeout is not armed there, and it has to be
                    unmounted rather than merely invisible: scrolling back
                    re-arms a full-length timeout, and a bar that had kept
                    animating in the meantime would come back part-drained and
                    lie about how long the step has left.
                */}
                {cycling && demoOpen && demoOnScreen ? (
                    <span
                        key={view}
                        aria-hidden="true"
                        style={{ animationDuration: `${VIEW_DURATION_MS[view]}ms` }}
                        className="bg-accent tab-progress absolute inset-x-0 -top-px h-[2px]"
                    />
                ) : null}

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
