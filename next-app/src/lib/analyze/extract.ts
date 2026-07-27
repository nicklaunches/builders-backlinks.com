/**
 * @file Turns fetched HTML into the small bundle of text the LLM step reasons over.
 *
 * This is deliberately regex-based rather than a real parser. The module has one
 * consumer (the describe step) and one job: give the model enough of the page to
 * say what the site is about. A DOM library would buy correctness we do not need
 * here, at the cost of a dependency on every code path that analyzes a URL, so
 * the tradeoff goes the other way.
 *
 * The output is also what the "too thin" screen is measured against. A page that
 * exists only to hold outbound links has a title and almost no prose, and that
 * shows up here as a near-empty `textSample`.
 */

/** Upper bound on the body text handed to the model. */
const MAX_TEXT_SAMPLE = 3_000;

/** Upper bound on collected headings. Past this they are navigation, not content. */
const MAX_HEADINGS = 25;

/** Individual headings longer than this are almost always mis-parsed markup. */
const MAX_HEADING_LENGTH = 200;

/**
 * The page content the LLM step is allowed to see.
 *
 * Note what is absent: no favicon, no images, no links. The describe step must
 * not be tempted to identify the site, so it is given only prose.
 */
export type PageExtract = {
    /** Raw `<title>`, or null when the page has none. */
    title: string | null;
    /** First usable description meta tag, or null. */
    metaDescription: string | null;
    /** h1 through h3 in document order, deduplicated. */
    headings: string[];
    /** Visible body text, whitespace-collapsed and truncated. */
    textSample: string;
};

/**
 * Decodes the HTML entities that actually show up in page copy.
 *
 * Intentionally partial: the named-entity table is large and the model tolerates
 * a stray `&hellip;` far better than this module tolerates a dependency.
 *
 * @param input - Encoded HTML text.
 * @returns Decoded plain text.
 */
function decodeEntities(input: string): string {
    return input
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, code: string) => {
            try {
                return String.fromCodePoint(Number(code));
            } catch {
                return "";
            }
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
            try {
                return String.fromCodePoint(Number.parseInt(hex, 16));
            } catch {
                return "";
            }
        });
}

/**
 * Reads a quoted attribute value out of a raw HTML tag string.
 *
 * @param tag - Raw tag text, including angle brackets.
 * @param attr - Attribute name to read.
 * @returns Decoded, trimmed attribute value, or null when absent.
 */
function pickAttr(tag: string, attr: string): string | null {
    const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
    const match = tag.match(re);
    if (!match) return null;
    const value = decodeEntities(match[2] ?? match[3] ?? "").trim();
    return value || null;
}

/**
 * Removes markup and collapses whitespace in one step.
 *
 * @param input - HTML fragment.
 * @returns Single-line plain text.
 */
function toPlainText(input: string): string {
    return decodeEntities(input.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Extracts title, description, headings, and a body text sample from raw HTML.
 *
 * Script, style, noscript, svg, and comment content is stripped before any text
 * is read, otherwise inline JSON-LD and CSS dominate `textSample` on modern
 * framework builds and the model ends up describing a bundler.
 *
 * @param html - Fetched HTML document.
 * @returns Extracted page content, with `textSample` capped at 3000 chars.
 */
export function extractPage(html: string): PageExtract {
    // Title and meta are read from the original document: they live in <head>,
    // which the noise strip below can mangle when a page has unbalanced tags.
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? toPlainText(titleMatch[1]) || null : null;

    const metas: Record<string, string> = {};
    const metaRe = /<meta\b[^>]*>/gi;
    let metaMatch: RegExpExecArray | null;
    while ((metaMatch = metaRe.exec(html))) {
        const tag = metaMatch[0];
        const name = pickAttr(tag, "name") ?? pickAttr(tag, "property");
        const content = pickAttr(tag, "content");
        if (name && content) metas[name.toLowerCase()] = content;
    }
    const metaDescription = metas["description"] || metas["og:description"] || metas["twitter:description"] || null;

    const stripped = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
        .replace(/<template\b[\s\S]*?<\/template>/gi, " ");

    // h1 to h3 only. h4 and below are usually FAQ items or footer column labels,
    // which add length without telling us what the site does.
    const headings: string[] = [];
    const seen = new Set<string>();
    const headingRe = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = headingRe.exec(stripped)) && headings.length < MAX_HEADINGS) {
        const text = toPlainText(headingMatch[2]);
        if (!text || text.length > MAX_HEADING_LENGTH) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        headings.push(text);
    }

    // Prefer <body> when it is present so head-level leftovers stay out of the
    // sample. Falling back to the whole document keeps fragments working.
    const bodyMatch = stripped.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    const bodySource = bodyMatch ? bodyMatch[1] : stripped;
    const textSample = toPlainText(bodySource).slice(0, MAX_TEXT_SAMPLE);

    return { title, metaDescription, headings, textSample };
}
