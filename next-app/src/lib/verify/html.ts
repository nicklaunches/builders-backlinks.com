import type { Placement } from "@/lib/exchange";

/**
 * @file Tolerant HTML scanning helpers used by link verification.
 *
 * There is deliberately no DOM parser here. The pages we crawl are arbitrary
 * third-party HTML, often malformed, and a real parser adds a dependency plus a
 * meaningful cost per check while giving us very little: everything we report
 * (an anchor, its rel, its text, and the landmark it sits in) can be derived
 * from a forward scan over the raw markup. Regex scanning is the right size of
 * tool for a job whose output is advisory, never an enforcement gate.
 *
 * The tradeoffs we accept, all of which lean towards under-reporting rather
 * than inventing a link that is not there:
 * - Attribute values containing a literal ">" will truncate a tag match.
 * - Unclosed or mis-nested tags degrade the ancestor stack, which can soften a
 *   placement to "content".
 * - Only server-rendered HTML is visible, so client-rendered links are missed
 *   entirely. That is why the caller's not-found copy is written as "we could
 *   not see it", never "you did not place it".
 */

/**
 * Elements that never have a closing tag, so they must not be pushed onto the
 * ancestor stack. `<img>` inside an anchor would otherwise swallow every later
 * close tag.
 */
const VOID_ELEMENTS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

/**
 * Named entities worth decoding in hrefs and anchor text. Anything else is left
 * verbatim: a stray "&copy;" in anchor text is far less harmful than mangling
 * text we do not understand.
 */
const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

/** Matches any open or close tag. See the @file note on the ">" limitation. */
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;

/** Matches an opening anchor tag and captures its raw attribute text. */
const ANCHOR_OPEN_RE = /<a\b([^>]*)>/gi;

/** Matches one attribute, quoted or bare, with or without a value. */
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * File extensions that mark a URL as an asset rather than a page. Used to keep
 * sitewide sampling from spending one of its three fetches on a PDF.
 */
const ASSET_EXT_RE =
    /\.(?:jpe?g|png|gif|svg|webp|avif|ico|bmp|css|js|mjs|cjs|json|xml|txt|pdf|zip|gz|tgz|rar|7z|mp3|mp4|m4a|webm|mov|avi|wav|woff2?|ttf|otf|eot|rss|atom|csv|tsv|docx?|xlsx?|pptx?|dmg|exe)$/i;

/** Paths that are never a normal content page worth sampling. */
const NON_PAGE_PATH_RE =
    /(?:^|\/)(?:wp-json|wp-admin|wp-login|wp-content|xmlrpc|cdn-cgi|feed|rss|atom|api|graphql)(?:\/|$)/i;

/** One element on the ancestor chain above an anchor. */
export type ElementRef = {
    /** Lowercased tag name. */
    name: string;
    /** Lowercased attribute names mapped to raw (entity-decoded) values. */
    attrs: Record<string, string>;
};

/** An anchor found in the server-rendered HTML. */
export type ParsedAnchor = {
    /** Href exactly as authored, entity-decoded but not resolved. */
    href: string;
    /** Lowercased, deduped `rel` tokens. */
    rel: string[];
    /** Visible text, tags stripped and whitespace collapsed. Empty when image-only. */
    text: string;
    /** Offset of the anchor's `<a` in the masked HTML, used for placement. */
    index: number;
};

/**
 * Decodes the handful of HTML entities that actually show up in hrefs and
 * anchor text (`&amp;` above all). One pass, so nothing is double-decoded.
 *
 * @param value - Raw attribute value or text run.
 * @returns The decoded string, with unrecognised entities left untouched.
 */
export function decodeEntities(value: string): string {
    return value.replace(ENTITY_RE, (whole: string, body: string) => {
        const key = body.toLowerCase();
        if (key.startsWith("#")) {
            const hex = key.startsWith("#x");
            const code = Number.parseInt(hex ? key.slice(2) : key.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
            try {
                return String.fromCodePoint(code);
            } catch {
                return whole;
            }
        }
        return NAMED_ENTITIES[key] ?? whole;
    });
}

/**
 * Blanks out regions whose contents are not real markup: HTML comments and the
 * bodies of `<script>` and `<style>`.
 *
 * Each region is replaced by spaces of the same length so every offset in the
 * result still lines up with the original document. Placement classification
 * depends on that: it walks backwards through the same string it found the
 * anchor in.
 *
 * @param html - Raw response body.
 * @returns Same-length HTML with non-markup regions masked.
 */
export function maskNonMarkup(html: string): string {
    const regions = [/<!--[\s\S]*?-->/g, /<script\b[\s\S]*?<\/script\s*>/gi, /<style\b[\s\S]*?<\/style\s*>/gi];
    let out = html;
    for (const re of regions) {
        out = out.replace(re, (match) => " ".repeat(match.length));
    }
    return out;
}

/**
 * Parses a raw attribute string into a lowercased-name map.
 *
 * First occurrence wins, matching how browsers treat duplicate attributes.
 *
 * @param raw - Everything between the tag name and the closing ">".
 */
export function parseAttributes(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTR_RE.exec(raw)) !== null) {
        const name = match[1].toLowerCase();
        if (name in attrs) continue;
        const value = match[2] ?? match[3] ?? match[4] ?? "";
        attrs[name] = decodeEntities(value);
    }
    return attrs;
}

/**
 * Collapses an anchor's inner HTML into the text a visitor would see.
 *
 * @param inner - Raw HTML between the anchor's tags.
 */
function anchorTextOf(inner: string): string {
    return decodeEntities(inner.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Extracts every anchor with an href from masked HTML, in document order.
 *
 * Anchors with no href are skipped: they are in-page targets, not links.
 *
 * @param masked - Output of {@link maskNonMarkup}.
 */
export function extractAnchors(masked: string): ParsedAnchor[] {
    const lower = masked.toLowerCase();
    const anchors: ParsedAnchor[] = [];
    ANCHOR_OPEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ANCHOR_OPEN_RE.exec(masked)) !== null) {
        const index = match.index;
        const attrs = parseAttributes(match[1] ?? "");
        const href = (attrs.href ?? "").trim();
        if (!href) continue;

        // Nested anchors are invalid HTML, so the first close tag is ours. A
        // missing close tag means we take nothing rather than the rest of the
        // page as anchor text.
        const contentStart = index + match[0].length;
        const closeIndex = lower.indexOf("</a", contentStart);
        const inner = closeIndex === -1 ? "" : masked.slice(contentStart, closeIndex);

        const rel = [
            ...new Set(
                (attrs.rel ?? "")
                    .toLowerCase()
                    .split(/[\s,]+/)
                    .filter(Boolean),
            ),
        ];
        anchors.push({ href, rel, text: anchorTextOf(inner), index });
    }
    return anchors;
}

/**
 * Rebuilds the chain of open elements above a position in the document.
 *
 * Forward scan with a stack, outermost first. Mis-nesting is handled the way a
 * browser roughly would: a close tag pops back to the nearest matching open
 * tag, and a close tag with no matching open tag is ignored.
 *
 * @param masked - Output of {@link maskNonMarkup}.
 * @param index - Offset of the anchor whose ancestors we want.
 */
export function ancestorsAt(masked: string, index: number): ElementRef[] {
    const stack: ElementRef[] = [];
    const re = new RegExp(TAG_RE.source, TAG_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(masked)) !== null) {
        if (match.index >= index) break;
        const closing = match[1] === "/";
        const name = match[2].toLowerCase();
        const rawAttrs = match[3] ?? "";
        if (VOID_ELEMENTS.has(name)) continue;
        if (closing) {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].name === name) {
                    stack.length = i;
                    break;
                }
            }
            continue;
        }
        // Self-closing form, common in inline SVG and hand-written JSX-ish HTML.
        if (rawAttrs.trimEnd().endsWith("/")) continue;
        stack.push({ name, attrs: parseAttributes(rawAttrs) });
    }
    return stack;
}

/**
 * Reads one ancestor for a landmark signal.
 *
 * Order inside the function is the judgment call: semantic tag first, then
 * ARIA role, then class/id text. Within the text patterns footer is tested
 * before nav so that a "footer-nav" wrapper reports as footer, which is what a
 * member looking at the page would say it is.
 *
 * @param el - The candidate ancestor.
 * @param outer - Ancestors above `el`, outermost first.
 * @returns A placement, or null when this element says nothing.
 */
function landmarkSignal(el: ElementRef, outer: readonly ElementRef[]): Placement | null {
    // A footer or header nested inside an article belongs to that article, so
    // it is content, not the site chrome.
    const insideArticle = outer.some((a) => a.name === "article");

    switch (el.name) {
        case "footer":
            return insideArticle ? "content" : "footer";
        case "header":
            // Site header links are navigation in every practical sense.
            return insideArticle ? "content" : "nav";
        case "nav":
            return "nav";
        case "aside":
            return "sidebar";
        case "main":
        case "article":
            return "content";
    }

    const role = (el.attrs.role ?? "").toLowerCase().trim();
    if (role === "contentinfo") return "footer";
    if (role === "navigation" || role === "banner" || role === "menubar") return "nav";
    if (role === "complementary") return "sidebar";
    if (role === "main" || role === "article") return "content";

    const token = `${el.attrs.class ?? ""} ${el.attrs.id ?? ""}`.toLowerCase();
    if (!token.trim()) return null;
    if (/footer|colophon|site-info|copyright/.test(token)) return "footer";
    if (/sidebar|widget|secondary|right-rail|left-rail/.test(token)) return "sidebar";
    if (/(?:^|[^a-z])nav|navbar|menu|breadcrumb|topbar|masthead/.test(token)) return "nav";
    if (/(?:^|[^a-z])(?:content|article|post|entry|prose|main|body-copy)/.test(token)) return "content";
    return null;
}

/**
 * Classifies where an anchor sits by finding its nearest landmark ancestor.
 *
 * Walks inward-out and takes the first ancestor that says anything, so a link
 * in a nav bar inside a header reports as nav rather than being flattened to
 * the outermost signal.
 *
 * Falls back to `content`: an anchor in the body with no landmark ancestor at
 * all is body copy far more often than it is anything else, and `unknown` is
 * reserved for the cases where we genuinely could not look.
 *
 * @param ancestors - Output of {@link ancestorsAt}, outermost first.
 */
export function classifyPlacement(ancestors: readonly ElementRef[]): Placement {
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const signal = landmarkSignal(ancestors[i], ancestors.slice(0, i));
        if (signal) return signal;
    }
    return "content";
}

/**
 * Classifies the anchor at `index` in a masked document.
 *
 * @param masked - Output of {@link maskNonMarkup}.
 * @param index - Offset of the anchor's opening tag.
 */
export function placementAt(masked: string, index: number): Placement {
    // An anchor before <body> (inside <head>, or in a document we clearly did
    // not understand) is the one case where we admit we cannot tell.
    const bodyIndex = masked.toLowerCase().indexOf("<body");
    if (bodyIndex >= 0 && index < bodyIndex) return "unknown";
    return classifyPlacement(ancestorsAt(masked, index));
}

/**
 * Resolves an href against the page it was found on.
 *
 * @param href - Raw href attribute value.
 * @param baseUrl - Absolute URL of the page containing the anchor.
 * @returns The absolute http(s) URL, or null for fragments, mailto/tel/js
 *   links, and anything unparseable.
 */
export function resolveHref(href: string, baseUrl: string): URL | null {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    if (/^(?:mailto|tel|sms|javascript|data|file|ftp|about|blob):/i.test(trimmed)) return null;
    try {
        const url = new URL(trimmed, baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url;
    } catch {
        return null;
    }
}

/**
 * Reduces a hostname to the form both sides of a comparison use: lowercased,
 * `www.` stripped, no trailing dot.
 */
export function canonicalHost(value: string): string {
    let host = value.trim().toLowerCase();
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    host = host.split(/[/?#]/)[0];
    host = host.split("@").pop() ?? host;
    host = host.split(":")[0];
    host = host.replace(/^www\./, "");
    return host.replace(/\.$/, "");
}

/**
 * Path form used to decide whether two hrefs point at the same page: no query,
 * no fragment, no trailing slash, lowercased.
 */
export function canonicalPath(url: URL): string {
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return path === "" ? "/" : path;
}

/**
 * True when an href points at the target domain itself.
 *
 * Subdomains deliberately do not count. `blog.example.com` is a different
 * property from `example.com` in every way that matters here (it can be a
 * different owner, a different host, a different SEO profile), so counting it
 * would let a member satisfy an agreement with a link the receiving side never
 * asked for. Only the bare domain and its `www.` form match.
 *
 * @param href - Raw href attribute value.
 * @param baseUrl - Absolute URL of the page containing the anchor.
 * @param targetDomain - Already canonicalised target host.
 */
export function hrefTargetsDomain(href: string, baseUrl: string, targetDomain: string): boolean {
    const url = resolveHref(href, baseUrl);
    if (!url) return false;
    return canonicalHost(url.hostname) === targetDomain;
}

/**
 * Picks internal pages worth sampling for sitewide detection.
 *
 * Same host as the page, different path, no assets, no obvious non-pages, and
 * shortest paths first: a top-level page is the likeliest place a sitewide
 * footer or nav link would also appear, and it is usually the cheapest to
 * fetch.
 *
 * @param anchors - All anchors from the page.
 * @param pageUrl - Absolute URL of the page that was crawled.
 * @param limit - Hard cap on returned URLs.
 */
export function collectInternalPageUrls(anchors: readonly ParsedAnchor[], pageUrl: string, limit: number): string[] {
    let base: URL;
    try {
        base = new URL(pageUrl);
    } catch {
        return [];
    }
    const basePath = canonicalPath(base);
    const seen = new Map<string, URL>();

    for (const anchor of anchors) {
        const url = resolveHref(anchor.href, pageUrl);
        if (!url) continue;
        if (canonicalHost(url.hostname) !== canonicalHost(base.hostname)) continue;
        const path = canonicalPath(url);
        if (path === basePath) continue;
        if (ASSET_EXT_RE.test(path)) continue;
        if (NON_PAGE_PATH_RE.test(path)) continue;
        if (seen.has(path)) continue;
        // Drop query and fragment: two links to the same page with different
        // tracking params must not eat two of our three fetches.
        const clean = new URL(url.toString());
        clean.search = "";
        clean.hash = "";
        seen.set(path, clean);
    }

    return [...seen.entries()]
        .sort((a, b) => {
            const depth = a[0].split("/").length - b[0].split("/").length;
            return depth !== 0 ? depth : a[0].length - b[0].length;
        })
        .slice(0, limit)
        .map(([, url]) => url.toString());
}
