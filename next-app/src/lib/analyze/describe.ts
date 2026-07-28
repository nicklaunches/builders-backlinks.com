import { CATEGORIES, type Category, isCategory } from "@/lib/categories";

import type { PageExtract } from "./extract";

/**
 * @file The LLM step: category, identity-scrubbed description, anchor keywords.
 *
 * This is the module the whole product rests on. Blind matching only works if a
 * member can read what a candidate site is about and decide whether a link
 * between them is editorially sensible, WITHOUT learning which site it is. The
 * moment a description says "Acme's Slack alerts for Postgres", the reveal step
 * is decoration and the exchange stops being blind.
 *
 * Scrubbing is enforced twice on purpose:
 *
 *  1. In the prompt, as the primary instruction with worked good/bad examples.
 *     Models follow a demonstrated transformation far more reliably than a rule.
 *  2. Mechanically afterwards, in {@link scrubIdentity}, against tokens derived
 *     from the domain and page title. The model will occasionally leak a brand
 *     name anyway, and a silent leak is unrecoverable once it has been shown to
 *     a partner, so the cheap deterministic pass is worth the false positives.
 *
 * The extraction step feeds this module prose only (no links, no images), which
 * keeps the model from having an easy identifier to reach for in the first place.
 */

/** OpenRouter chat completions endpoint. */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Default model when `OPENROUTER_ANALYZE_MODEL` is not set.
 *
 * Checked against the live OpenRouter model list: this one advertises
 * `response_format` in its supported parameters, which this module requires
 * because the whole prompt depends on getting strict JSON back. If you swap it,
 * confirm the replacement supports `response_format` first, or the parse below
 * fails on every single call.
 */
const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

/** Request budget. Generous: this call is the slow leg of the submit flow and retrying costs more. */
const LLM_TIMEOUT_MS = 30_000;

/** Hard cap from the `ExchangeSite.description` schema. */
const MAX_DESCRIPTION = 2_000;

/** Contract cap on suggested anchors. */
const MAX_KEYWORDS = 25;

/** Anchor phrases longer than this are sentences, not anchors. */
const MAX_KEYWORD_LENGTH = 60;

/** What the model is asked to produce. */
export type SiteDescription = {
    category: Category;
    description: string;
    keywords: string[];
};

/**
 * Words that must never be treated as a brand token during the mechanical scrub.
 *
 * Domains like `getflow.com` or `email-tools.io` would otherwise cause common
 * nouns to be redacted out of an otherwise fine description.
 */
const GENERIC_TOKENS = new Set([
    "app",
    "apps",
    "get",
    "try",
    "use",
    "my",
    "the",
    "web",
    "site",
    "online",
    "tool",
    "tools",
    "io",
    "ai",
    "co",
    "com",
    "net",
    "org",
    "dev",
    "hq",
    "labs",
    "studio",
    "cloud",
    "digital",
    "software",
    "solutions",
    "group",
    "team",
]);

/**
 * Builds the list of tokens that must not appear in member-visible text.
 *
 * Sources are the domain labels and the leading segment of the page title, which
 * between them cover almost every way a model names a product. Tokens shorter
 * than three characters and anything in {@link GENERIC_TOKENS} are skipped: the
 * cost of redacting a real word is higher than the cost of missing an unlikely
 * two-letter brand.
 *
 * @param domain - Canonical domain for the site.
 * @param title - Raw page title, or null.
 * @returns Lowercased tokens to redact, longest first so compounds match before parts.
 */
function identityTokens(domain: string, title: string | null): string[] {
    const tokens = new Set<string>();

    const labels = domain.split(".");
    // The registrable label plus any subdomain labels. The TLD is dropped by the
    // generic list, but splitting first also catches "acme" in "app.acme.com".
    for (const label of labels) {
        for (const part of label.split(/[-_]/)) {
            if (part.length >= 3 && !GENERIC_TOKENS.has(part)) tokens.add(part);
        }
        if (label.length >= 3 && !GENERIC_TOKENS.has(label)) tokens.add(label);
    }
    // Also the whole bare domain, so "acme.com" is caught as a unit.
    tokens.add(domain);

    if (title) {
        // Titles are near-universally "Brand | Tagline" or "Brand: Tagline".
        // Escapes rather than literal dash characters, so the separator set stays
        // readable in a codebase that bans typing those characters directly.
        const lead = title.split(/[|:\u2013\u2014\u00b7>]|\s-\s/)[0]?.trim() ?? "";
        if (lead && lead.split(/\s+/).length <= 3) {
            for (const word of lead.split(/\s+/)) {
                const clean = word.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
                if (clean.length >= 3 && !GENERIC_TOKENS.has(clean)) tokens.add(clean);
            }
        }
    }

    return [...tokens].sort((a, b) => b.length - a.length);
}

/**
 * Escapes a string for safe use inside a RegExp.
 *
 * @param input - Literal text.
 * @returns Regex-safe text.
 */
function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes leaked identifiers from model-written text.
 *
 * Replaces whole-word occurrences with a neutral noun rather than deleting them,
 * because deletion leaves sentences ungrammatical and members read these. The
 * result is not always elegant, but an inelegant description is recoverable
 * (the member edits it at review) and a leaked one is not.
 *
 * @param text - Model-written text.
 * @param tokens - Identity tokens from {@link identityTokens}.
 * @param replacement - Neutral noun substituted for each hit.
 * @returns Text with identifiers replaced and whitespace collapsed.
 */
export function scrubIdentity(text: string, tokens: readonly string[], replacement = "the site"): string {
    let out = text;
    for (const token of tokens) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, "giu");
        out = out.replace(re, (_full, lead: string) => `${lead}${replacement}`);
    }
    // A leak often sits in a possessive ("Acme's dashboard"), which the pass above
    // turns into "the site's dashboard". That reads fine, so nothing to do there.
    return out
        .replace(/\s+/g, " ")
        .replace(/\s+([.,;:!?])/g, "$1")
        .trim();
}

/**
 * Composes the system and user prompts.
 *
 * The identity rule leads the system prompt and is restated with examples,
 * because burying it under schema instructions is exactly how it gets dropped.
 *
 * @param extract - Page content to describe.
 * @returns System and user message contents.
 */
function buildPrompt(extract: PageExtract): { system: string; user: string } {
    const system = [
        "You write blind, identity-scrubbed profiles of websites for a link exchange.",
        "",
        "THE ONE RULE THAT MATTERS: the description you write is shown to a potential link",
        "partner BEFORE either side learns who the other is. It must describe what the site",
        "does without revealing which site it is. That means NO product name, NO brand name,",
        "NO company name, NO domain or URL, NO founder or author name, NO app name, and no",
        "distinctive slogan or tagline that could be pasted into a search engine to identify",
        "the site. Do not use the name even once, and do not hint at it. If the source text",
        'keeps repeating a name, replace it with a neutral noun such as "the site", "the',
        'tool", "the platform", or "the blog".',
        "",
        "GOOD (identity-scrubbed):",
        '  "A hosted uptime and status-page tool for small SaaS teams. It runs HTTP and',
        "   cron-job checks on a schedule, alerts through Slack and email when a check fails,",
        "   and publishes a public status page. Content is mostly product pages plus a",
        '   reliability-engineering blog aimed at solo founders."',
        "",
        "BAD (leaks identity, never write like this):",
        '  "PingKit is an uptime monitor. PingKit lets you..."   <- names the product',
        '  "Available at pingkit.io, this monitor..."            <- names the domain',
        '  "Built by Sarah Chen, this uptime tool..."            <- names the founder',
        "  \"The home of 'Never miss an outage again'...\"         <- quotes the tagline",
        "",
        "Write 2 to 5 sentences, plain and factual, present tense, third person. Cover what",
        "the site offers, who it is for, and what kind of content or pages it publishes,",
        "since a partner is judging whether a link between the two sites would look",
        "editorially reasonable. Do not sell, do not use marketing adjectives, and do not",
        "speculate beyond the page. Never use em dashes.",
        "",
        `Pick exactly one category from this list, copied exactly: ${CATEGORIES.join(", ")}.`,
        'Use "Other" only when nothing else is defensible.',
        "",
        "Also suggest 1 to 25 keywords: short lowercase phrases (1 to 4 words) that would",
        "work as natural anchor text for a link pointing at this site. Topic phrases only.",
        "They must be identity-scrubbed too: no brand or product names.",
        "",
        "Return ONLY valid JSON. No markdown, no commentary.",
    ].join("\n");

    const schemaHint = `{
  "category": string,
  "description": string,
  "keywords": string[]
}`;

    // The domain and any URLs are deliberately NOT in the payload. The model
    // cannot leak an identifier it was never given.
    const payload = {
        title: extract.title,
        metaDescription: extract.metaDescription,
        headings: extract.headings,
        text: extract.textSample,
    };

    const user = [
        "Schema:",
        schemaHint,
        "",
        "Page content:",
        JSON.stringify(payload, null, 2),
        "",
        "Return JSON only. Remember: the description must not name the site, its product,",
        "its company, or its domain.",
    ].join("\n");

    return { system, user };
}

/**
 * Coerces model output into 1 to 25 clean lowercase anchor phrases.
 *
 * @param raw - Unknown `keywords` value from the model.
 * @param tokens - Identity tokens; any phrase containing one is dropped rather than rewritten.
 * @returns Deduplicated keyword list, possibly empty (the caller backfills).
 */
function normalizeKeywords(raw: unknown, tokens: readonly string[]): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (typeof item !== "string") continue;
        const phrase = item.toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
        if (!phrase || phrase.length > MAX_KEYWORD_LENGTH) continue;
        // Anchors are shown pre-reveal, so a brand-bearing phrase is dropped
        // outright: unlike a description, a two-word anchor cannot be repaired.
        if (scrubIdentity(phrase, tokens) !== phrase) continue;
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        out.push(phrase);
        if (out.length >= MAX_KEYWORDS) break;
    }
    return out;
}

/**
 * Last-resort anchor phrases when the model returns none that survive cleaning.
 *
 * `ExchangeSite.keywords` requires at least one entry, so returning an empty
 * array here would fail the write later with a much less obvious error.
 *
 * @param extract - Page content, used for heading-derived phrases.
 * @param category - Chosen category, used as the final fallback.
 * @param tokens - Identity tokens to filter against.
 * @returns At least one lowercase phrase.
 */
function fallbackKeywords(extract: PageExtract, category: Category, tokens: readonly string[]): string[] {
    const fromHeadings = normalizeKeywords(
        extract.headings.filter((h) => h.split(/\s+/).length <= 4),
        tokens,
    );
    if (fromHeadings.length > 0) return fromHeadings.slice(0, 5);
    return [category.toLowerCase()];
}

/**
 * Generates the category, identity-scrubbed description, and anchor keywords.
 *
 * The API key is read here rather than at module load so a missing key surfaces
 * as a request-time failure instead of breaking the build or the import graph.
 *
 * @param extract - Page content from `extractPage()`.
 * @param domain - Canonical domain, used only for the mechanical scrub (never sent to the model).
 * @returns Validated category, scrubbed description, and 1 to 25 keywords.
 * @throws `Error` when the key is missing or OpenRouter fails; the caller maps this to `AnalyzeError`.
 */
export async function describeSite(extract: PageExtract, domain: string): Promise<SiteDescription> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    const model = process.env.OPENROUTER_ANALYZE_MODEL || DEFAULT_MODEL;

    const { system, user } = buildPrompt(extract);

    const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://builders-backlinks.com",
            "X-Title": "Builders Backlinks Site Analysis",
        },
        body: JSON.stringify({
            model,
            response_format: { type: "json_object" },
            // Low but not zero: the description is prose a human reads, and greedy
            // decoding on these models produces noticeably more template-y copy.
            temperature: 0.2,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned no content");

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        // Some models still fence their output despite json_object mode.
        const cleaned = content
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            throw new Error("OpenRouter returned unparseable JSON");
        }
    }
    if (!parsed || typeof parsed !== "object") throw new Error("OpenRouter returned a non-object");
    const obj = parsed as Record<string, unknown>;

    // Category is constrained by the union, not by the model. An invented value
    // falls back to "Other", which is unmatchable and therefore forces a human
    // to pick again at review. That is the safe direction to fail in.
    const rawCategory = typeof obj.category === "string" ? obj.category.trim() : "";
    const category: Category = isCategory(rawCategory) ? rawCategory : "Other";

    const rawDescription = typeof obj.description === "string" ? obj.description.trim() : "";
    if (!rawDescription) throw new Error("OpenRouter returned no description");

    const tokens = identityTokens(domain, extract.title);
    const description = scrubIdentity(rawDescription, tokens).slice(0, MAX_DESCRIPTION);
    if (!description) throw new Error("Description was empty after identity scrubbing");

    const modelKeywords = normalizeKeywords(obj.keywords, tokens);
    const keywords = modelKeywords.length > 0 ? modelKeywords : fallbackKeywords(extract, category, tokens);

    return { category, description, keywords };
}
