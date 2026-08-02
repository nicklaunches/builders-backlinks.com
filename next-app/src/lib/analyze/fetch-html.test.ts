import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isIPv4Literal, isIPv6Literal, isIpLiteral, isPrivateIPv4, isPrivateIPv6 } from "@/lib/analyze/fetch-html";

/**
 * @file Guards the address checks behind the SSRF guard.
 *
 * These exist because of a production-only bug. `assertPublicHost` asked
 * `isPrivateIPv4` about every entry `node:dns` returned, and that function
 * answered two questions with one boolean: it returned true both for a private
 * address and for anything it could not parse. In workerd, `lookup` sometimes
 * returns a CNAME target HOSTNAME in `address` instead of an address, so the
 * check split `4fb3bcdf0a1db88b.vercel-dns-016.com` on dots, got three parts,
 * and reported it as a private address. Every Vercel-hosted domain was
 * unlistable, with an error message naming an "address" that is obviously a
 * hostname.
 *
 * Local Node returns clean IPs for the same hosts, so no amount of `pnpm dev`
 * would have found it, and a test that resolves real DNS would not either. The
 * fix splits validity from privacy, which is what makes both testable here
 * without a network call.
 */

describe("isIPv4Literal", () => {
    it("accepts dotted quads and rejects hostnames", () => {
        assert.equal(isIPv4Literal("216.150.1.1"), true);
        assert.equal(isIPv4Literal("127.0.0.1"), true);
        // The exact string that took down Vercel-hosted submissions.
        assert.equal(isIPv4Literal("4fb3bcdf0a1db88b.vercel-dns-016.com"), false);
        assert.equal(isIPv4Literal("example.com"), false);
    });

    it("rejects malformed quads", () => {
        assert.equal(isIPv4Literal("1.2.3"), false);
        assert.equal(isIPv4Literal("1.2.3.4.5"), false);
        assert.equal(isIPv4Literal("256.1.1.1"), false);
        assert.equal(isIPv4Literal("1.2.3.x"), false);
        assert.equal(isIPv4Literal(""), false);
    });
});

describe("isIPv6Literal", () => {
    it("accepts real addresses, elided or written out", () => {
        assert.equal(isIPv6Literal("::1"), true);
        assert.equal(isIPv6Literal("::"), true);
        assert.equal(isIPv6Literal("fe80::1"), true);
        assert.equal(isIPv6Literal("2001:0db8:0000:0000:0000:ff00:0042:8329"), true);
        assert.equal(isIPv6Literal("::ffff:127.0.0.1"), true);
    });

    it("keeps a zone id out of the address", () => {
        assert.equal(isIPv6Literal("fe80::1%eth0"), true);
    });

    it("rejects hostnames and malformed addresses", () => {
        assert.equal(isIPv6Literal("vercel-dns-016.com"), false);
        assert.equal(isIPv6Literal("2001::db8::1"), false);
        assert.equal(isIPv6Literal("gggg::1"), false);
        assert.equal(isIPv6Literal("1:2:3:4:5:6:7"), false);
        assert.equal(isIPv6Literal("::ffff:999.1.1.1"), false);
    });
});

describe("isIpLiteral", () => {
    it("routes on the address rather than on a reported family", () => {
        // `assertPublicHost` no longer trusts the `family` field, because the
        // polyfill that leaks a hostname is not a reliable narrator about it.
        assert.equal(isIpLiteral("216.150.1.1"), true);
        assert.equal(isIpLiteral("::1"), true);
        assert.equal(isIpLiteral("4fb3bcdf0a1db88b.vercel-dns-016.com"), false);
    });
});

describe("private ranges", () => {
    it("blocks the ranges an SSRF guard exists for", () => {
        for (const ip of ["10.0.0.1", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.0.1", "192.168.1.1"]) {
            assert.equal(isPrivateIPv4(ip), true, ip);
        }
        // CGNAT and multicast, which are equally not somewhere to fetch from.
        assert.equal(isPrivateIPv4("100.64.0.1"), true);
        assert.equal(isPrivateIPv4("239.1.1.1"), true);
    });

    it("allows real public addresses", () => {
        // Vercel's anycast address, where the two blocked domains actually live.
        assert.equal(isPrivateIPv4("216.150.1.1"), false);
        assert.equal(isPrivateIPv4("8.8.8.8"), false);
    });

    it("blocks local and mapped-private IPv6", () => {
        assert.equal(isPrivateIPv6("::1"), true);
        assert.equal(isPrivateIPv6("fd00::1"), true);
        assert.equal(isPrivateIPv6("fe80::1"), true);
        assert.equal(isPrivateIPv6("fe80::1%eth0"), true);
        assert.equal(isPrivateIPv6("::ffff:127.0.0.1"), true);
        assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false);
    });
});
