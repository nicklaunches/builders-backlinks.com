import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { isAdminEmail } from "@/lib/auth/admin";

/**
 * @file The moderation allowlist.
 *
 * Worth testing despite being twenty lines, because it is the entire access
 * control mechanism for a surface that can approve, reject and ban listings.
 * There is no admin column in the database and no second check behind this one.
 *
 * The cases that matter are the ones where a bug ADMITS someone: an unset
 * variable read as "no restriction", an empty string splitting into a `[""]`
 * that matches a null email, or whitespace in the env var meaning a legitimate
 * admin silently stops matching.
 */

const original = process.env.ADMIN_EMAILS;

afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
});

describe("isAdminEmail", () => {
    it("admits an address on the list", () => {
        process.env.ADMIN_EMAILS = "admin@example.com";
        assert.equal(isAdminEmail("admin@example.com"), true);
    });

    it("admits any address in a comma separated list, ignoring spacing", () => {
        process.env.ADMIN_EMAILS = " first@example.com ,second@example.com,  third@example.com ";
        for (const email of ["first@example.com", "second@example.com", "third@example.com"]) {
            assert.equal(isAdminEmail(email), true, email);
        }
    });

    it("matches case insensitively in both directions", () => {
        // users.email carries whatever the OAuth provider returned, which is not
        // necessarily lowercase, and neither is a hand-edited env var.
        process.env.ADMIN_EMAILS = "Admin@Example.COM";
        assert.equal(isAdminEmail("admin@example.com"), true);
        assert.equal(isAdminEmail("ADMIN@EXAMPLE.COM"), true);
    });

    it("refuses an address that is not on the list", () => {
        process.env.ADMIN_EMAILS = "admin@example.com";
        assert.equal(isAdminEmail("someone@example.com"), false);
    });

    it("refuses everyone when the variable is unset", () => {
        // Fails CLOSED. An unconfigured allowlist admitting everyone would hand
        // a stranger the ability to approve their own listings.
        delete process.env.ADMIN_EMAILS;
        assert.equal(isAdminEmail("admin@example.com"), false);
    });

    it("refuses everyone when the variable is empty or only whitespace", () => {
        for (const value of ["", "   ", ","]) {
            process.env.ADMIN_EMAILS = value;
            assert.equal(isAdminEmail("admin@example.com"), false, JSON.stringify(value));
        }
    });

    it("refuses a missing email even when the list has empty entries", () => {
        // ",,".split(",") is ["", "", ""]. Without the null guard and the
        // Boolean filter, an empty entry would match an empty address.
        process.env.ADMIN_EMAILS = "admin@example.com,,";
        assert.equal(isAdminEmail(null), false);
        assert.equal(isAdminEmail(undefined), false);
        assert.equal(isAdminEmail(""), false);
    });

    it("does not match on a substring or a lookalike domain", () => {
        process.env.ADMIN_EMAILS = "admin@example.com";
        assert.equal(isAdminEmail("admin@example.com.attacker.test"), false);
        assert.equal(isAdminEmail("notadmin@example.com"), false);
        assert.equal(isAdminEmail("admin@example.co"), false);
    });
});
