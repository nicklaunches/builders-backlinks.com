import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anchorPhrase } from "@/lib/services/sites";

/**
 * @file What an anchor is allowed to contain by the time it is stored.
 *
 * `anchorPhrase` is the write half of the pair that keeps a partner's keyword
 * from being markup in somebody else's source. `buildSnippet` escapes the
 * snippet it emits, but `anchorOptions` is handed to an agent raw, and an agent
 * writes its own markup around it. This is the half that means there is no
 * payload in the database to hand over in the first place.
 *
 * Pure, so it is testable without a database even though its module has one.
 * The cases that matter are the ones where a bug ADMITS a character.
 */

describe("anchorPhrase", () => {
    it("keeps an ordinary anchor intact apart from case", () => {
        assert.equal(anchorPhrase("  Uptime Monitoring  "), "uptime monitoring");
    });

    it("drops the characters that end a markdown label or open a tag", () => {
        assert.equal(anchorPhrase("x](https://elsewhere.example)"), "x https://elsewhere.example");
        assert.equal(anchorPhrase('x</a><img src=y onerror="alert(1)">'), "x /a img src=y onerror= alert 1");
    });

    it("drops the braces that open a JSX expression in mdx and jsx", () => {
        // Inert in markdown and HTML, which is why this one was missed.
        assert.equal(anchorPhrase("docs {globalThis.x=1} guides"), "docs globalthis.x=1 guides");
        assert.match(anchorPhrase("{}"), /^$/);
    });

    it("drops control characters rather than storing them", () => {
        assert.equal(anchorPhrase("dev\u0007tools"), "dev tools");
        assert.equal(anchorPhrase("dev\u007ftools"), "dev tools");
    });

    it("collapses the whitespace a dropped character leaves behind", () => {
        // Removal substitutes a space, so without this an anchor comes back
        // full of gaps where the markup used to be.
        assert.equal(anchorPhrase("a <b> c"), "a b c");
    });

    it("returns empty for an anchor that was only markup, so the caller can drop it", () => {
        // `commitSite` filters these out and refuses a listing left with none,
        // which is the behaviour that makes returning "" the right answer.
        assert.equal(anchorPhrase("<>[]{}"), "");
    });
});
