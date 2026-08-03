import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExchangeSite } from "@/lib/db/schema";
import { briefFor } from "@/lib/services/links";

/**
 * @file The snippet a member pastes into their own source.
 *
 * `briefFor` is pure, so it is testable without a database even though it lives
 * in a module that has one. Worth testing because the snippet is the one string
 * this product hands over with the instruction "put this in a file and deploy
 * it", and half of it comes from the other member.
 *
 * The cases are the two ways an anchor stops being text: closing the markdown
 * label so the URL after it is the attacker's, and closing the anchor tag so
 * what follows is markup on the victim's page.
 */

/** A partner row with only the fields `briefFor` reads populated. */
function partner(overrides: Partial<ExchangeSite> = {}): ExchangeSite {
    return {
        keywords: ["uptime monitoring"],
        url: "https://partner.example/",
        domain: "partner.example",
        description: "A hosted uptime tool.",
        placementOffered: "blog_post",
        ...overrides,
    } as ExchangeSite;
}

describe("briefFor snippets", () => {
    it("builds the ordinary link in each format", () => {
        assert.equal(
            briefFor(partner(), { matchId: "m", format: "html" }).snippet,
            '<a href="https://partner.example/">uptime monitoring</a>',
        );
        assert.equal(
            briefFor(partner(), { matchId: "m", format: "markdown" }).snippet,
            "[uptime monitoring](<https://partner.example/>)",
        );
    });

    it("does not let an anchor close the markdown label and repoint the link", () => {
        const snippet = briefFor(partner({ keywords: ["best dev tool](https://elsewhere.example)"] }), {
            matchId: "m",
            format: "markdown",
        }).snippet;

        // The bracket the anchor supplied is escaped, so the label runs to the
        // last `]` and the one destination markdown reads is the partner's.
        assert.equal(snippet, "[best dev tool\\](https://elsewhere.example)](<https://partner.example/>)");
        assert.equal(snippet.match(/(^|[^\\])\]\(/g)?.length, 1, snippet);
    });

    it("does not let an anchor close the tag in the HTML and JSX forms", () => {
        for (const format of ["html", "jsx"] as const) {
            const snippet = briefFor(partner({ keywords: ['x</a><img src=y onerror="alert(1)">'] }), {
                matchId: "m",
                format,
            }).snippet;

            assert.ok(!snippet.includes("</a><img"), snippet);
            assert.equal(snippet.match(/</g)?.length, 2, `${format}: only the anchor tag's own brackets`);
        }
    });

    it("escapes an ampersand rather than leaving a stray entity", () => {
        assert.equal(
            briefFor(partner({ keywords: ["docs & guides"] }), { matchId: "m", format: "html" }).snippet,
            '<a href="https://partner.example/">docs &amp; guides</a>',
        );
    });

    it("falls back to the domain when a partner listed no anchors", () => {
        const brief = briefFor(partner({ keywords: [] }), { matchId: "m", format: "markdown" });
        assert.equal(brief.snippet, "[partner.example](<https://partner.example/>)");
    });

    /**
     * The formats where a brace is not a brace.
     *
     * These rows can exist: `anchorPhrase` drops braces now, but it did not
     * when the earliest listings were written, and the read path has to hold on
     * its own anyway. The payload is deliberately one that survives
     * `anchorPhrase` today, so this is the escape being tested and not the
     * sanitizer standing in for it.
     */
    it("does not let an anchor open a JSX expression in the mdx and jsx forms", () => {
        const anchor = "docs {globalthis.x=1} guides";

        assert.equal(
            briefFor(partner({ keywords: [anchor] }), { matchId: "m", format: "mdx" }).snippet,
            "[docs \\{globalthis.x=1\\} guides](<https://partner.example/>)",
        );
        assert.equal(
            briefFor(partner({ keywords: [anchor] }), { matchId: "m", format: "jsx" }).snippet,
            '<a href="https://partner.example/">docs &#123;globalthis.x=1&#125; guides</a>',
        );
    });

    it("leaves braces alone in the formats that do not read them", () => {
        // Escaping here would be a visible regression: a brace is an ordinary
        // character in CommonMark and in HTML text.
        const anchor = "the {beta} plan";

        assert.equal(
            briefFor(partner({ keywords: [anchor] }), { matchId: "m", format: "markdown" }).snippet,
            "[the {beta} plan](<https://partner.example/>)",
        );
        assert.equal(
            briefFor(partner({ keywords: [anchor] }), { matchId: "m", format: "html" }).snippet,
            '<a href="https://partner.example/">the {beta} plan</a>',
        );
    });
});
