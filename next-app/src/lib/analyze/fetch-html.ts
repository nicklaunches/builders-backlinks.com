import { lookup as dnsLookup } from "node:dns/promises";

/**
 * @file SSRF-hardened HTML fetcher for site analysis.
 *
 * Ported essentially verbatim from the Nick Launches prefill fetcher, with only
 * the user agent changed. It exists as its own copy rather than a shared package
 * because the two apps deploy independently, and a fetcher that takes arbitrary
 * user-supplied URLs is exactly the thing you never want to silently inherit a
 * change to.
 *
 * Anything a member types into the submit box reaches this function, so every
 * guard here (scheme allowlist, DNS resolution against private ranges, re-check
 * after redirects, body size cap, content-type check) is load-bearing. Do not
 * relax them to make an awkward site fetch.
 */

/**
 * Maximum time allowed for fetching a target page.
 */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Maximum response body size read from a target page.
 */
const MAX_BODY_BYTES = 1_500_000;

/**
 * User agent sent when fetching public product websites.
 */
const USER_AGENT = "BuildersBacklinksBot/1.0 (+https://builders-backlinks.com)";

/**
 * Successful fetch result returned to the prefill route.
 *
 * A 304 result means the caller's cached content is still valid and no HTML
 * body is available. A 200 result includes HTML plus validators for future
 * conditional requests.
 */
export type FetchResult =
    | { status: 304; html?: undefined; etag?: string | null; lastModified?: string | null; finalUrl: string }
    | { status: 200; html: string; etag: string | null; lastModified: string | null; finalUrl: string };

/**
 * Typed fetch-layer failure used by the prefill API for precise client errors.
 */
export class FetchError extends Error {
    constructor(
        public readonly code:
            "invalid_url" | "blocked_host" | "dns_failed" | "timeout" | "http_error" | "too_large" | "non_html",
        message: string,
    ) {
        super(message);
        this.name = "FetchError";
    }
}

/**
 * Normalizes user-provided URLs before fetching.
 *
 * Removes credentials and fragments, lowercases the hostname, and only permits
 * HTTP(S) schemes.
 *
 * @param input - Raw user-provided URL.
 * @returns Normalized absolute URL string.
 * @throws `FetchError` when the URL is invalid or uses an unsupported scheme.
 */
export function normalizeUrl(input: string): string {
    const trimmed = input.trim();
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new FetchError("invalid_url", "Invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new FetchError("invalid_url", "Only http(s) URLs are supported");
    }
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    // Lowercase host; preserve path/query as-is.
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
}

/**
 * Aggressive normalization for cache-key purposes only.
 *
 * Strips `www.`, removes a trailing slash on the path, drops the fragment, and
 * lowercases the host. Two visitor inputs that point at the same page should
 * collapse to the same cache key so we get high hit rates without re-running
 * the AI for trivial differences.
 *
 * Do NOT use this for fetching: `normalizeUrl` is the SSRF-safe one.
 */
export function canonicalizeUrlForCache(input: string): string {
    const normal = normalizeUrl(input);
    const u = new URL(normal);
    u.hostname = u.hostname.replace(/^www\./, "");
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
}

/**
 * Checks whether a string is a dotted-quad IPv4 literal.
 *
 * Exported for tests. This is deliberately separate from {@link isPrivateIPv4}:
 * that function used to answer both "is this an IP" and "is this IP private"
 * with one boolean, returning true for anything it could not parse. Fail-closed
 * is right for a private-range check and wrong for a validity check, and
 * conflating them is what made every Vercel-hosted domain unlistable. See
 * {@link assertPublicHost}.
 *
 * @param value - Candidate address.
 * @returns True when the string is a valid IPv4 literal.
 */
export function isIPv4Literal(value: string): boolean {
    const parts = value.split(".");
    if (parts.length !== 4) return false;
    return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Checks whether a string is an IPv6 literal, with or without a zone id.
 *
 * Exported for tests. Strict enough to reject a hostname (no colons, characters
 * outside the hex alphabet) without reimplementing a full parser: the only job
 * here is telling a real address apart from a resolver artifact.
 *
 * @param value - Candidate address.
 * @returns True when the string is a valid IPv6 literal.
 */
export function isIPv6Literal(value: string): boolean {
    // `fe80::1%eth0`: the zone id is not part of the address.
    const address = value.split("%", 1)[0] ?? "";
    if (!address.includes(":")) return false;
    if (!/^[0-9a-f:.]+$/i.test(address)) return false;
    if (address.includes(":::")) return false;
    // At most one "::" run, by definition: two would be ambiguous.
    const elisions = address.match(/::/g)?.length ?? 0;
    if (elisions > 1) return false;

    // An embedded IPv4 tail (`::ffff:127.0.0.1`) occupies the last two groups.
    const lastColon = address.lastIndexOf(":");
    const tail = address.slice(lastColon + 1);
    const hasV4Tail = tail.includes(".");
    if (hasV4Tail && !isIPv4Literal(tail)) return false;

    const groups = (hasV4Tail ? address.slice(0, lastColon) : address).split(":").filter(Boolean);
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false;

    const maxGroups = hasV4Tail ? 6 : 8;
    if (groups.length > maxGroups) return false;
    // Without an elision every group has to be written out.
    return elisions === 1 || groups.length === maxGroups;
}

/**
 * Checks whether a string is an IP literal of either family.
 *
 * @param value - Candidate address.
 * @returns True when the string is a valid IPv4 or IPv6 literal.
 */
export function isIpLiteral(value: string): boolean {
    return value.includes(":") ? isIPv6Literal(value) : isIPv4Literal(value);
}

/**
 * Checks whether an IPv4 address is private, local, or otherwise non-public.
 *
 * Assumes a valid literal; check with {@link isIPv4Literal} first.
 *
 * @param ip - IPv4 address string.
 * @returns True when the address should not be fetched.
 */
export function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
}

/**
 * Checks whether an IPv6 address is private, local, or mapped to private IPv4.
 *
 * Assumes a valid literal; check with {@link isIPv6Literal} first.
 *
 * @param ip - IPv6 address string.
 * @returns True when the address should not be fetched.
 */
export function isPrivateIPv6(ip: string): boolean {
    const lower = ip.toLowerCase().split("%", 1)[0] ?? "";
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("::ffff:")) {
        // IPv4-mapped
        const v4 = lower.slice("::ffff:".length);
        return isPrivateIPv4(v4);
    }
    return false;
}

/**
 * Resolves a hostname and rejects local/private destinations.
 *
 * This is the main SSRF guard and is called before the initial fetch and again
 * after redirects when the final host changes.
 *
 * NOT EVERY ENTRY IS AN IP. In workerd, `node:dns`'s `lookup` can hand back a
 * CNAME target hostname in `address` rather than the address it resolves to.
 * Local Node never does this, so `pnpm dev` cannot reproduce it. The old loop
 * passed that hostname to `isPrivateIPv4`, which split it on dots, got three
 * parts instead of four, and failed closed, so in production every domain whose
 * DNS goes through a CNAME was rejected as a private address. Vercel-hosted
 * sites, which is a large share of the people this exchange is for, could not be
 * submitted at all: `growstartup.uk.com` was refused as "private address
 * 4fb3bcdf0a1db88b.vercel-dns-016.com", a string that is plainly not an address.
 *
 * The invariant enforced here is unchanged: every IP this host resolves to must
 * be public. Non-literals are skipped rather than trusted, at least one real
 * public IP is required, and a CNAME whose own address is private is still
 * caught, because that address is in the same result set. What we finally
 * connect to is re-resolved by `fetch` regardless.
 *
 * @param hostname - Hostname from the target URL.
 * @throws `FetchError` when DNS fails or resolves to a blocked address.
 */
async function assertPublicHost(hostname: string): Promise<void> {
    if (!hostname) throw new FetchError("blocked_host", "Empty host");
    const lc = hostname.toLowerCase();
    if (lc === "localhost" || lc.endsWith(".localhost") || lc.endsWith(".local")) {
        throw new FetchError("blocked_host", "Localhost is not allowed");
    }
    let resolved: { address: string; family: number }[];
    try {
        resolved = await dnsLookup(hostname, { all: true });
    } catch {
        throw new FetchError("dns_failed", `We couldn’t find a website at "${hostname}". Check the URL is correct.`);
    }

    let publicAddresses = 0;
    for (const { address } of resolved) {
        // Decided on the address itself, not the reported `family`: the same
        // polyfill that leaks a hostname here is not a reason to trust its
        // labelling either.
        if (!isIpLiteral(address)) continue;
        const blocked = address.includes(":") ? isPrivateIPv6(address) : isPrivateIPv4(address);
        if (blocked) {
            throw new FetchError("blocked_host", `Resolved to private address ${address}`);
        }
        publicAddresses++;
    }

    // Nothing usable came back. `dns_failed` rather than `blocked_host` because
    // that is what actually happened: we could not resolve the host, as opposed
    // to resolving it somewhere we refuse to go.
    if (publicAddresses === 0) {
        throw new FetchError("dns_failed", `We couldn’t find a website at "${hostname}". Check the URL is correct.`);
    }
}

/**
 * Fetches public HTML with optional conditional request validators.
 *
 * The fetcher enforces DNS-based SSRF checks, follows redirects only after
 * re-validating the final host, limits response size, requires HTML content,
 * and supports ETag/Last-Modified cache short-circuiting.
 *
 * @param url - Normalized target URL.
 * @param options.etag - Optional ETag for `If-None-Match`.
 * @param options.lastModified - Optional timestamp for `If-Modified-Since`.
 * @returns A 200 result with HTML or a 304 result for unchanged cached content.
 * @throws `FetchError` with a machine-readable code for expected fetch failures.
 */
export async function fetchSiteHtml(
    url: string,
    options: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult> {
    const target = new URL(url);
    await assertPublicHost(target.hostname);

    const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.8",
    };
    if (options.etag) headers["If-None-Match"] = options.etag;
    if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;

    let response: Response;
    try {
        response = await fetch(target, {
            method: "GET",
            headers,
            redirect: "follow",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("aborted") || message.includes("timeout")) {
            throw new FetchError("timeout", "Request timed out");
        }
        throw new FetchError("http_error", message);
    }

    const finalUrl = response.url || target.toString();
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");

    if (response.status === 304) {
        return { status: 304, etag, lastModified, finalUrl };
    }
    if (!response.ok) {
        throw new FetchError("http_error", `HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new FetchError("non_html", `Unsupported content-type: ${contentType || "unknown"}`);
    }

    // Re-validate final URL host (after redirects) is still public.
    try {
        const finalHost = new URL(finalUrl).hostname;
        if (finalHost !== target.hostname) {
            await assertPublicHost(finalHost);
        }
    } catch (err) {
        if (err instanceof FetchError) throw err;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new FetchError("http_error", "Empty response body");
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            received += value.byteLength;
            if (received > MAX_BODY_BYTES) {
                try {
                    await reader.cancel();
                } catch {
                    // ignore
                }
                throw new FetchError("too_large", "Response exceeded size limit");
            }
            chunks.push(value);
        }
    }
    const buf = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
        buf.set(c, offset);
        offset += c.byteLength;
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { status: 200, html, etag, lastModified, finalUrl };
}
